from fastapi import FastAPI, UploadFile, File, HTTPException, Depends  # pyright: ignore[reportMissingImports]
from fastapi.middleware.cors import CORSMiddleware  # type: ignore
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field  # type: ignore
from io import BytesIO
import PyPDF2  # type: ignore
import os
import requests  # type: ignore
import uuid
from typing import Dict, List, Any, Optional
from datetime import datetime

from sklearn.feature_extraction.text import TfidfVectorizer  # type: ignore
from sklearn.metrics.pairwise import cosine_similarity  # type: ignore

# ====== SQLAlchemy (Postgres) ======
from sqlalchemy import create_engine, Column, String, Integer, Text, LargeBinary, DateTime, ForeignKey
from sqlalchemy.orm import sessionmaker, declarative_base, Session

Base = declarative_base()


def _normalize_db_url(url: str) -> str:
    # Render sometimes provides postgres:// ; SQLAlchemy expects postgresql://
    url = (url or "").strip()
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql://", 1)
    return url


DATABASE_URL = _normalize_db_url(os.environ.get("DATABASE_URL", ""))

ENGINE = create_engine(DATABASE_URL, pool_pre_ping=True) if DATABASE_URL else None
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=ENGINE) if ENGINE else None


class Document(Base):
    __tablename__ = "documents"
    doc_id = Column(String, primary_key=True, index=True)  # uuid as string
    filename = Column(String, nullable=False)
    num_pages = Column(Integer, nullable=False)
    full_text = Column(Text, nullable=False)
    pdf_bytes = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Chunk(Base):
    __tablename__ = "chunks"
    id = Column(Integer, primary_key=True, autoincrement=True)
    doc_id = Column(String, ForeignKey("documents.doc_id", ondelete="CASCADE"), index=True, nullable=False)
    page = Column(Integer, nullable=False)
    text = Column(Text, nullable=False)


def get_db():
    """
    DB dependency. If DATABASE_URL not set, endpoints that depend on DB will fail.
    Upload/chat still work in-memory (non-persistent) if DB is missing.
    """
    if not SessionLocal:
        raise HTTPException(status_code=500, detail="DATABASE_URL not configured.")
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


app = FastAPI(
    title="StudySpark AI API",
    description="Backend for summarizing PDFs, generating questions, flashcards, and chatting with PDFs.",
    version="3.1.0",
    docs_url="/api-docs",
    redoc_url="/redoc",
)


# ====== CORS ======
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # لاحقاً خصصها
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ====== Stores (in-memory cache) ======
DOC_STORE: Dict[str, str] = {}                     # doc_id -> full text
PAGE_STORE: Dict[str, List[str]] = {}              # doc_id -> pages text
CHUNK_STORE: Dict[str, List[Dict[str, Any]]] = {}  # doc_id -> [{"text":..., "page":...}]
VEC_STORE: Dict[str, dict] = {}                    # doc_id -> {"vectorizer":..., "matrix":...}
DOC_META: Dict[str, Dict[str, Any]] = {}           # doc_id -> {"filename":..., "num_pages":...}
PDF_STORE: Dict[str, bytes] = {}                   # doc_id -> original pdf bytes (for preview)


# ====== Helpers ======
def detect_lang(text: str) -> str:
    """If Arabic chars exist => ar else en."""
    try:
        if any("\u0600" <= c <= "\u06FF" for c in (text or "")):
            return "ar"
    except Exception:
        pass
    return "en"


# ====== PDF Extraction (Page-aware) ======
def extract_pages_from_pdf(file_bytes: bytes) -> List[str]:
    reader = PyPDF2.PdfReader(BytesIO(file_bytes))
    pages: List[str] = []
    for page in reader.pages:
        pages.append((page.extract_text() or "").strip())
    return pages


def chunk_pages(pages: List[str], chunk_size: int = 1200, overlap: int = 200) -> List[Dict[str, Any]]:
    """
    Chunk within each page (so each chunk has a reliable page number).
    """
    chunks: List[Dict[str, Any]] = []
    for page_idx, page_text in enumerate(pages, start=1):
        text = (page_text or "").replace("\r", "")
        if not text.strip():
            continue

        i = 0
        while i < len(text):
            chunk = text[i: i + chunk_size]
            chunks.append({"text": chunk, "page": page_idx})
            i += max(1, chunk_size - overlap)
    return chunks


def build_tfidf_index(doc_id: str, chunks: List[Dict[str, Any]]) -> None:
    texts = [c.get("text", "") for c in chunks]
    vectorizer = TfidfVectorizer(stop_words=None)
    matrix = vectorizer.fit_transform(texts)
    VEC_STORE[doc_id] = {"vectorizer": vectorizer, "matrix": matrix}


def retrieve_chunks_for_doc(doc_id: str, query: str, k: int = 5) -> List[Dict[str, Any]]:
    data = VEC_STORE.get(doc_id)
    chunks = CHUNK_STORE.get(doc_id, [])
    if not data or not chunks:
        return []

    vectorizer = data["vectorizer"]
    matrix = data["matrix"]

    q = vectorizer.transform([query])
    sims = cosine_similarity(q, matrix).flatten()
    top_idx = sims.argsort()[::-1][:k]

    results: List[Dict[str, Any]] = []
    for rank, i in enumerate(top_idx, start=1):
        i_int = int(i)
        if i_int < 0 or i_int >= len(chunks):
            continue
        chunk_obj = chunks[i_int]
        score = float(sims[i_int])
        results.append(
            {
                "id": f"S{rank}",  # temp label; re-labeled after merge
                "doc_id": doc_id,
                "score": score,
                "text": chunk_obj.get("text", ""),
                "page": int(chunk_obj.get("page", 0) or 0),
            }
        )
    return results


def merge_retrieval(doc_ids: List[str], query: str, top_k_total: int = 7, k_per_doc: int = 5) -> List[Dict[str, Any]]:
    all_hits: List[Dict[str, Any]] = []
    for did in doc_ids:
        all_hits.extend(retrieve_chunks_for_doc(did, query, k=k_per_doc))

    all_hits.sort(key=lambda x: x.get("score", 0.0), reverse=True)
    merged = all_hits[:top_k_total]

    for idx, item in enumerate(merged, start=1):
        item["id"] = f"S{idx}"
    return merged


def call_llm(prompt: str) -> str:
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return "LLM Error: GROQ_API_KEY is not set."

    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    body = {
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": "You are a helpful AI study assistant."},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 700,
        "temperature": 0.35,
    }

    try:
        res = requests.post(url, headers=headers, json=body, timeout=75)
        res.raise_for_status()
        data = res.json()
        return data["choices"][0]["message"]["content"]
    except Exception as e:
        return f"LLM Error: {str(e)}"


def translate_to_english_if_needed(text: str) -> str:
    """
    If Arabic => translate for retrieval only.
    """
    try:
        if detect_lang(text) == "ar":
            prompt = f"""
Translate the following question to English.
Return ONLY the translated question.

Question:
{text}
"""
            translated = (call_llm(prompt) or "").strip()
            if (not translated) or translated.startswith("LLM Error"):
                return text
            return translated
        return text
    except Exception:
        return text


# ====== Request Models ======
class SummaryRequest(BaseModel):
    text: str
    level: str = "university"


class QuestionsRequest(BaseModel):
    text: str
    num_questions: int = 5


class FlashcardsRequest(BaseModel):
    text: str
    num_cards: int = 10


class ChatRequest(BaseModel):
    doc_ids: List[str] = Field(default_factory=list)
    doc_id: Optional[str] = None

    message: str
    mode: str = "strict"  # "strict" | "simple" | "exam" | "chatty"
    lang: str = "auto"    # "auto" | "ar" | "en"
    history: List[Dict[str, str]] = Field(default_factory=list)


# ====== Mode + Output formatting ======
def build_mode_instructions(mode: str) -> str:
    mode = (mode or "strict").strip().lower()

    if mode == "chatty":
        return (
            "MODE: CHATTY.\n"
            "- Be conversational and natural, like ChatGPT.\n"
            "- Ask ONE short clarifying question if needed.\n"
            "- Prefer short paragraphs, not rigid bullet templates.\n"
            "- Use the PDF context as primary; do not invent citations.\n"
            "- If a detail is not supported by the PDF context, say it is general knowledge.\n"
        )

    if mode == "simple":
        return (
            "MODE: SIMPLE.\n"
            "- Explain in very simple terms.\n"
            "- Use short sentences.\n"
            "- Give a tiny example if possible.\n"
            "- Use ONLY the PDF context.\n"
        )
    if mode == "exam":
        return (
            "MODE: EXAM.\n"
            "- Answer like a model exam answer.\n"
            "- Use structured points (definition → key ideas → steps → notes).\n"
            "- Use ONLY the PDF context.\n"
        )
    return (
        "MODE: STRICT.\n"
        "- Answer ONLY from the provided PDF context.\n"
        "- If missing, say you couldn't find it in the PDF.\n"
    )


def build_output_format(answer_lang: str) -> str:
    """
    Force stable Arabic formatting to avoid RTL/LTR mess.
    Keep citations like [S1] in body; page/file in Sources section.
    """
    if answer_lang == "ar":
        return (
            "OUTPUT FORMAT (Arabic):\n"
            "1) عنوان قصير: **الخلاصة**\n"
            "2) نقاط مرتبة (•) من 3 إلى 7 نقاط.\n"
            "3) داخل النقاط: استخدم [S1] أو [S2] فقط (بدون كلمة Page داخل الجملة).\n"
            "4) في النهاية: **المصادر**\n"
            "5) كل سطر:\n"
            "   - S1 — صفحة 9 — Handout-2.pdf\n"
            "مهم: لا تضع رقم الصفحة داخل الجملة العربية.\n"
        )
    return (
        "OUTPUT FORMAT (English):\n"
        "1) Heading: **Summary**\n"
        "2) Bullet points (•) 3–7 bullets.\n"
        "3) Cite as [S1], [S2] only (no 'Page' inside bullet).\n"
        "4) End with **Sources**\n"
        "5) One source per line:\n"
        "   - S1 — Page 9 — Handout-2.pdf\n"
    )


# ====== Persistence loader ======
def load_all_docs_from_db(db: Session) -> None:
    # clear in-memory
    DOC_STORE.clear()
    PAGE_STORE.clear()
    CHUNK_STORE.clear()
    VEC_STORE.clear()
    DOC_META.clear()
    PDF_STORE.clear()

    docs = db.query(Document).order_by(Document.created_at.desc()).all()
    for d in docs:
        doc_id = d.doc_id
        DOC_STORE[doc_id] = d.full_text
        DOC_META[doc_id] = {"filename": d.filename, "num_pages": d.num_pages}
        PDF_STORE[doc_id] = bytes(d.pdf_bytes)

        chunk_rows = (
            db.query(Chunk)
            .filter(Chunk.doc_id == doc_id)
            .order_by(Chunk.id.asc())
            .all()
        )
        chunks = [{"text": c.text, "page": int(c.page)} for c in chunk_rows]
        CHUNK_STORE[doc_id] = chunks

        if chunks:
            build_tfidf_index(doc_id, chunks)


@app.on_event("startup")
def on_startup():
    if not ENGINE:
        # No DB configured; app still runs in-memory (non-persistent)
        print("INFO: DATABASE_URL not set; running in-memory (non-persistent).")
        return

    Base.metadata.create_all(bind=ENGINE)

    db = SessionLocal()
    try:
        load_all_docs_from_db(db)
        print(f"INFO: Loaded {len(DOC_META)} documents from DB.")
    finally:
        db.close()


# ====== Upload ======
@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...), db: Optional[Session] = Depends(get_db)):
    """
    Persistent upload (requires DATABASE_URL).
    """
    content = await file.read()
    pages = extract_pages_from_pdf(content)
    full_text = "\n\n".join([p for p in pages if p.strip()])

    if not full_text.strip():
        return {
            "doc_id": "",
            "text": "",
            "message": "لم يتم استخراج أي نص من الملف. تأكد أن الـ PDF ليس عبارة عن صور فقط.",
        }

    doc_id = str(uuid.uuid4())
    filename = file.filename or "document.pdf"
    num_pages = len(pages)

    chunks = chunk_pages(pages, chunk_size=1200, overlap=200)

    # --- persist to DB ---
    # (db dependency will raise if DATABASE_URL missing)
    doc_row = Document(
        doc_id=doc_id,
        filename=filename,
        num_pages=num_pages,
        full_text=full_text,
        pdf_bytes=content,
    )
    db.add(doc_row)
    db.flush()

    for c in chunks:
        db.add(Chunk(doc_id=doc_id, page=int(c.get("page", 0) or 0), text=c.get("text", "")))

    db.commit()

    # --- update in-memory cache ---
    PDF_STORE[doc_id] = content
    DOC_STORE[doc_id] = full_text
    PAGE_STORE[doc_id] = pages
    DOC_META[doc_id] = {"filename": filename, "num_pages": num_pages}
    CHUNK_STORE[doc_id] = chunks
    build_tfidf_index(doc_id, chunks)

    return {"doc_id": doc_id, "text": full_text, "filename": filename, "num_pages": num_pages}


# ====== PDF Preview endpoint ======
@app.get("/pdf/{doc_id}")
async def get_pdf(doc_id: str, db: Session = Depends(get_db)):
    pdf = PDF_STORE.get(doc_id)
    meta = DOC_META.get(doc_id, {})

    if not pdf:
        d = db.query(Document).filter(Document.doc_id == doc_id).first()
        if not d:
            raise HTTPException(status_code=404, detail="PDF not found. Re-upload the PDF.")
        pdf = bytes(d.pdf_bytes)
        meta = {"filename": d.filename, "num_pages": d.num_pages}
        PDF_STORE[doc_id] = pdf
        DOC_META[doc_id] = {"filename": d.filename, "num_pages": d.num_pages}

    filename = meta.get("filename", "document.pdf")

    return StreamingResponse(
        BytesIO(pdf),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


# ====== Docs API (Library) ======
@app.get("/docs")
async def list_docs(db: Session = Depends(get_db)):
    docs = db.query(Document).order_by(Document.created_at.desc()).all()
    return [
        {
            "doc_id": d.doc_id,
            "filename": d.filename,
            "num_pages": d.num_pages,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        }
        for d in docs
    ]


@app.get("/docs/{doc_id}")
async def get_doc(doc_id: str, db: Session = Depends(get_db)):
    d = db.query(Document).filter(Document.doc_id == doc_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Document not found.")
    return {
        "doc_id": d.doc_id,
        "filename": d.filename,
        "num_pages": d.num_pages,
        "text": d.full_text,
    }


@app.delete("/docs/{doc_id}")
async def delete_doc(doc_id: str, db: Session = Depends(get_db)):
    d = db.query(Document).filter(Document.doc_id == doc_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Document not found.")

    db.query(Chunk).filter(Chunk.doc_id == doc_id).delete()
    db.query(Document).filter(Document.doc_id == doc_id).delete()
    db.commit()

    # remove from memory if present
    PDF_STORE.pop(doc_id, None)
    DOC_STORE.pop(doc_id, None)
    PAGE_STORE.pop(doc_id, None)
    CHUNK_STORE.pop(doc_id, None)
    VEC_STORE.pop(doc_id, None)
    DOC_META.pop(doc_id, None)

    return {"ok": True, "doc_id": doc_id}


# ====== Summarize / Questions / Flashcards ======
@app.post("/summarize")
async def summarize(req: SummaryRequest):
    prompt = f"""
Summarize the following text in clear bullet points.
Target level: {req.level} student.

Text:
{req.text}
"""
    summary = call_llm(prompt)
    return {"summary": summary}


@app.post("/generate-questions")
async def generate_questions(req: QuestionsRequest):
    prompt = f"""
You are an exam question generator.

Read the following text and create {req.num_questions} exam questions.
Mix:
- MCQ (4 options) + mark correct answer
- Short-answer questions

Return a clear numbered list.

Text:
{req.text}
"""
    questions = call_llm(prompt)
    return {"questions": questions}


@app.post("/generate-flashcards")
async def generate_flashcards(req: FlashcardsRequest):
    prompt = f"""
Create {req.num_cards} flashcards from the text.

Format:
1) Front: ...
   Back: ...

Text:
{req.text}
"""
    flashcards = call_llm(prompt)
    return {"flashcards": flashcards}


# ====== Chat ======
@app.post("/chat")
async def chat_with_pdf(req: ChatRequest):
    doc_ids = req.doc_ids if req.doc_ids else ([req.doc_id] if req.doc_id else [])
    doc_ids = [d for d in doc_ids if d and d in DOC_STORE]

    if not doc_ids:
        return {"answer": "No valid doc_id(s). Upload a PDF first.", "sources": [], "answer_lang": "en"}

    user_lang = detect_lang(req.message)
    answer_lang = (req.lang or "auto").strip().lower()
    if answer_lang not in ("auto", "ar", "en"):
        answer_lang = "auto"
    if answer_lang == "auto":
        answer_lang = user_lang

    retrieval_query = translate_to_english_if_needed(req.message)
    retrieved = merge_retrieval(doc_ids, retrieval_query, top_k_total=7, k_per_doc=5)

    if (not retrieved) or (retrieved[0].get("score", 0.0) < 0.05):
        if answer_lang == "ar":
            return {"answer": "لم أجد محتوى مناسبًا داخل الـ PDF(s) المحددة للإجابة على سؤالك.", "sources": [], "answer_lang": "ar"}
        return {"answer": "I couldn't find relevant content in the selected PDF(s).", "sources": [], "answer_lang": "en"}

    numbered_context = []
    for item in retrieved:
        meta = DOC_META.get(item["doc_id"], {})
        filename = meta.get("filename", item["doc_id"])
        numbered_context.append(
            f"{item['id']} (File: {filename}, Page {item['page']}):\n{item['text']}"
        )
    context = "\n\n---\n\n".join(numbered_context)

    history_text = ""
    if req.history:
        last = req.history[-16:]
        lines = []
        for h in last:
            role = (h.get("role") or "").strip()
            content = (h.get("content") or "").strip()
            if content:
                lines.append(f"{role.upper()}: {content}")
        history_text = "\n".join(lines)

    mode_instructions = build_mode_instructions(req.mode)

    use_rigid_format = (req.mode or "strict").strip().lower() in ("strict", "exam", "simple")
    out_fmt = build_output_format(answer_lang) if use_rigid_format else (
        "OUTPUT (Chatty):\n"
        "- Write naturally in short paragraphs.\n"
        "- Use inline citations like [S1] when referencing the PDF.\n"
        "- If you used any sources, end with a short **Sources** list:\n"
        "  - S1 — Page 9 — FileName.pdf\n"
        "- Important for Arabic: do NOT put page numbers inside Arabic sentences.\n"
    )

    lang_rule = "Answer in Arabic only." if answer_lang == "ar" else "Answer in English only."

    prompt = f"""
You are a helpful AI assistant.

{mode_instructions}
{out_fmt}

Rules:
- Use ONLY the PDF context below.
- If the answer isn't in the context, say so clearly.
- Do NOT invent sources.
- Keep it clean and well-structured.

Conversation (optional):
{history_text}

PDF Context:
{context}

User Question:
{req.message}

{lang_rule}
"""
    answer = call_llm(prompt)

    sources = []
    for item in retrieved:
        meta = DOC_META.get(item["doc_id"], {})
        sources.append(
            {
                "id": item["id"],
                "doc_id": item["doc_id"],
                "filename": meta.get("filename", ""),
                "page": int(item.get("page", 0) or 0),
                "score": float(item.get("score", 0.0) or 0.0),
                "excerpt": (item.get("text", "")[:350]).replace("\n", " ").strip(),
            }
        )

    return {"answer": answer, "sources": sources, "answer_lang": answer_lang}


@app.get("/")
async def root():
    return {"message": "StudySpark AI API is running ✅"}
