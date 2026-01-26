from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from io import BytesIO
import PyPDF2
import os
import requests
import uuid
import json
import asyncio
import re
from collections import defaultdict
from typing import Dict, List, Any, Optional

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


app = FastAPI(
    title="StudySpark AI API",
    description="Backend for summarizing PDFs, generating questions, flashcards, and chatting with PDFs.",
    version="3.2.0",
    docs_url="/api-docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://ai-study-assistant-nu.vercel.app",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ====== Stores (in-memory only) ======
DOC_STORE: Dict[str, str] = {}                     # doc_id -> full text
PAGE_STORE: Dict[str, List[str]] = {}              # doc_id -> pages text
CHUNK_STORE: Dict[str, List[Dict[str, Any]]] = {}  # doc_id -> [{"text":..., "page":...}]
VEC_STORE: Dict[str, dict] = {}                    # doc_id -> {"vectorizer":..., "matrix":...}
DOC_META: Dict[str, Dict[str, Any]] = {}           # doc_id -> {"filename":..., "num_pages":..., "client_id":...}
PDF_STORE: Dict[str, bytes] = {}                   # doc_id -> original pdf bytes (for preview)


def detect_lang(text: str) -> str:
    try:
        if any("\u0600" <= c <= "\u06FF" for c in (text or "")):
            return "ar"
    except Exception:
        pass
    return "en"


def extract_pages_from_pdf(file_bytes: bytes) -> List[str]:
    reader = PyPDF2.PdfReader(BytesIO(file_bytes))
    pages: List[str] = []
    for page in reader.pages:
        pages.append((page.extract_text() or "").strip())
    return pages


def chunk_pages(pages: List[str], chunk_size: int = 1200, overlap: int = 200) -> List[Dict[str, Any]]:
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
                "id": f"S{rank}",
                "doc_id": doc_id,
                "score": score,
                "text": chunk_obj.get("text", ""),
                "page": int(chunk_obj.get("page", 0) or 0),
            }
        )
    return results


def merge_retrieval(doc_ids: List[str], query: str, top_k_total: int = 12, k_per_doc: int = 5) -> List[Dict[str, Any]]:
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
    client_id: str = "public"
    doc_ids: List[str] = Field(default_factory=list)
    doc_id: Optional[str] = None
    message: str
    mode: str = "strict"  # "strict" | "simple" | "exam" | "chatty"
    lang: str = "auto"    # "auto" | "ar" | "en"
    history: List[Dict[str, str]] = Field(default_factory=list)


class ClearRequest(BaseModel):
    client_id: str


def build_mode_instructions(mode: str) -> str:
    mode = (mode or "strict").strip().lower()

    if mode == "chatty":
        return (
            "MODE: CHATTY.\n"
            "- Be conversational and natural, like ChatGPT.\n"
            "- Ask ONE short clarifying question if needed.\n"
            "- Prefer short paragraphs.\n"
            "- Use the PDF context as primary; do not invent citations.\n"
        )

    if mode == "simple":
        return (
            "MODE: SIMPLE.\n"
            "- Explain in very simple terms.\n"
            "- Use short sentences.\n"
            "- Use ONLY the PDF context.\n"
        )

    if mode == "exam":
        return (
            "MODE: EXAM.\n"
            "- Answer like a model exam answer.\n"
            "- Use structured points.\n"
            "- Use ONLY the PDF context.\n"
        )

    return (
        "MODE: STRICT.\n"
        "- Answer ONLY from the provided PDF context.\n"
        "- If missing, say you couldn't find it in the PDF.\n"
    )


def build_output_format(answer_lang: str) -> str:
    if answer_lang == "ar":
        return (
            "OUTPUT FORMAT (Arabic):\n"
            "1) عنوان قصير: **الخلاصة**\n"
            "2) نقاط مرتبة (•) من 3 إلى 7 نقاط.\n"
            "3) داخل النقاط: استخدم [S1] أو [S2] فقط.\n"
            "4) في النهاية: **المصادر**\n"
            "5) كل سطر:\n"
            "   - S1 — صفحة 9 — File.pdf\n"
            "مهم: لا تضع رقم الصفحة داخل الجملة العربية.\n"
        )
    return (
        "OUTPUT FORMAT (English):\n"
        "1) Heading: **Summary**\n"
        "2) Bullet points (•) 3–7 bullets.\n"
        "3) Cite as [S1], [S2] only.\n"
        "4) End with **Sources**\n"
        "5) One source per line:\n"
        "   - S1 — Page 9 — File.pdf\n"
    )


def _tokenize_simple(s: str) -> List[str]:
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9\u0600-\u06ff\s]+", " ", s)
    return [t for t in s.split() if len(t) >= 2]


def _keyword_overlap_boost(query: str, chunk_text: str) -> float:
    q = set(_tokenize_simple(query))
    if not q:
        return 0.0
    c = set(_tokenize_simple(chunk_text))
    hit = len(q.intersection(c))
    return hit / max(6, len(q))


def rerank_hits(query: str, hits: List[Dict[str, Any]], alpha: float = 0.35) -> List[Dict[str, Any]]:
    for h in hits:
        boost = _keyword_overlap_boost(query, h.get("text", ""))
        h["score2"] = float(h.get("score", 0.0)) + alpha * boost
    hits.sort(key=lambda x: x.get("score2", x.get("score", 0.0)), reverse=True)
    return hits


def diversify_hits(hits: List[Dict[str, Any]], max_per_page: int = 1, max_per_doc: int = 3, k: int = 8) -> List[Dict[str, Any]]:
    picked = []
    per_doc = defaultdict(int)
    per_page = defaultdict(int)  # key: (doc_id, page)

    for h in hits:
        doc_id = h.get("doc_id")
        page = int(h.get("page") or 0)
        if per_doc[doc_id] >= max_per_doc:
            continue
        if per_page[(doc_id, page)] >= max_per_page:
            continue

        picked.append(h)
        per_doc[doc_id] += 1
        per_page[(doc_id, page)] += 1
        if len(picked) >= k:
            break

    return picked


# ====== Upload (in-memory, isolated by client_id) ======
@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...), client_id: str = Form(...)):
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

    PDF_STORE[doc_id] = content
    DOC_STORE[doc_id] = full_text
    PAGE_STORE[doc_id] = pages
    DOC_META[doc_id] = {"filename": filename, "num_pages": num_pages, "client_id": client_id}
    CHUNK_STORE[doc_id] = chunks
    build_tfidf_index(doc_id, chunks)

    return {"doc_id": doc_id, "text": full_text, "filename": filename, "num_pages": num_pages}


# ====== PDF Preview (must match client_id) ======
@app.get("/pdf/{doc_id}")
async def get_pdf(doc_id: str, client_id: str):
    meta = DOC_META.get(doc_id)
    if not meta or meta.get("client_id") != client_id:
        raise HTTPException(status_code=404, detail="PDF not found for this client.")

    pdf = PDF_STORE.get(doc_id)
    if not pdf:
        raise HTTPException(status_code=404, detail="PDF not found. Re-upload the PDF.")

    filename = meta.get("filename", "document.pdf")
    return StreamingResponse(
        BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"', "Cache-Control": "no-store"},
    )


# ====== Docs API (Library) ======
@app.get("/docs")
async def list_docs(client_id: str):
    items = []
    for doc_id, meta in DOC_META.items():
        if meta.get("client_id") == client_id:
            items.append(
                {
                    "doc_id": doc_id,
                    "filename": meta.get("filename", ""),
                    "num_pages": meta.get("num_pages", 0),
                }
            )
    return items


@app.get("/docs/{doc_id}")
async def get_doc(doc_id: str, client_id: str):
    meta = DOC_META.get(doc_id)
    if not meta or meta.get("client_id") != client_id:
        raise HTTPException(status_code=404, detail="Document not found for this client.")

    return {
        "doc_id": doc_id,
        "filename": meta.get("filename", ""),
        "num_pages": meta.get("num_pages", 0),
        "text": DOC_STORE.get(doc_id, ""),
    }


@app.delete("/docs/{doc_id}")
async def delete_doc(doc_id: str, client_id: str):
    meta = DOC_META.get(doc_id)
    if not meta or meta.get("client_id") != client_id:
        raise HTTPException(status_code=404, detail="Document not found for this client.")

    PDF_STORE.pop(doc_id, None)
    DOC_STORE.pop(doc_id, None)
    PAGE_STORE.pop(doc_id, None)
    CHUNK_STORE.pop(doc_id, None)
    VEC_STORE.pop(doc_id, None)
    DOC_META.pop(doc_id, None)

    return {"ok": True, "doc_id": doc_id}


# ====== Clear all docs for a client (used when leaving the site) ======
@app.post("/clear")
async def clear_client(req: ClearRequest):
    to_delete = [doc_id for doc_id, meta in DOC_META.items() if meta.get("client_id") == req.client_id]
    for doc_id in to_delete:
        PDF_STORE.pop(doc_id, None)
        DOC_STORE.pop(doc_id, None)
        PAGE_STORE.pop(doc_id, None)
        CHUNK_STORE.pop(doc_id, None)
        VEC_STORE.pop(doc_id, None)
        DOC_META.pop(doc_id, None)
    return {"ok": True, "deleted": len(to_delete)}


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


# ====== Chat logic (isolated by client_id) ======
async def run_chat_logic(req: ChatRequest) -> Dict[str, Any]:
    doc_ids = req.doc_ids if req.doc_ids else ([req.doc_id] if req.doc_id else [])

    # only docs belonging to this client
    doc_ids = [
        d for d in doc_ids
        if d and d in DOC_STORE and DOC_META.get(d, {}).get("client_id") == req.client_id
    ]

    if not doc_ids:
        return {"answer": "No valid doc_id(s) for this client. Upload a PDF first.", "sources": [], "answer_lang": "en"}

    user_lang = detect_lang(req.message)
    answer_lang = (req.lang or "auto").strip().lower()
    if answer_lang not in ("auto", "ar", "en"):
        answer_lang = "auto"
    if answer_lang == "auto":
        answer_lang = user_lang

    retrieval_query = translate_to_english_if_needed(req.message)

    hits = merge_retrieval(doc_ids, retrieval_query, top_k_total=12, k_per_doc=5)
    hits = rerank_hits(retrieval_query, hits, alpha=0.35)
    hits = diversify_hits(hits, max_per_page=1, max_per_doc=3, k=8)

    for i, item in enumerate(hits, start=1):
        item["id"] = f"S{i}"

    if (not hits) or (hits[0].get("score", 0.0) < 0.05):
        if answer_lang == "ar":
            return {"answer": "لم أجد محتوى مناسبًا داخل الـ PDF(s) المحددة للإجابة على سؤالك.", "sources": [], "answer_lang": "ar"}
        return {"answer": "I couldn't find relevant content in the selected PDF(s).", "sources": [], "answer_lang": "en"}

    numbered_context = []
    for item in hits:
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
        "- If you used any sources, end with a short **Sources** list.\n"
    )

    lang_rule = "Answer in Arabic only." if answer_lang == "ar" else "Answer in English only."

    prompt = f"""
You are a helpful AI assistant.

{mode_instructions}
{out_fmt}

Rules:
- Use ONLY the PDF context below.
- Do NOT invent sources.

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
    for item in hits:
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


@app.post("/chat-stream")
async def chat_stream(req: ChatRequest):
    result = await run_chat_logic(req)
    answer = result.get("answer", "")
    sources = result.get("sources", [])
    answer_lang = result.get("answer_lang", "en")

    # slower typing
    chunk_size = 18
    delay_seconds = 0.03

    async def gen():
        yield f"event: meta\ndata: {json.dumps({'answer_lang': answer_lang})}\n\n"
        for i in range(0, len(answer), chunk_size):
            part = answer[i:i + chunk_size]
            yield f"event: delta\ndata: {json.dumps({'text': part})}\n\n"
            await asyncio.sleep(delay_seconds)

        yield f"event: sources\ndata: {json.dumps({'sources': sources})}\n\n"
        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/")
async def root():
    return {"message": "StudySpark AI API is running ✅"}
