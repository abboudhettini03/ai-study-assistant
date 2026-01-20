from fastapi import FastAPI, UploadFile, File  # pyright: ignore[reportMissingImports]
from fastapi.middleware.cors import CORSMiddleware  # type: ignore
from pydantic import BaseModel, Field  # type: ignore
from io import BytesIO
import PyPDF2  # type: ignore
import os
import requests  # type: ignore
import uuid
from typing import Dict, List, Any, Optional

from sklearn.feature_extraction.text import TfidfVectorizer  # type: ignore
from sklearn.metrics.pairwise import cosine_similarity  # type: ignore


app = FastAPI(
    title="AI Study Assistant API",
    description="Backend for summarizing PDFs, generating questions, flashcards, and chatting with PDFs.",
    version="2.0.1",
)

# ====== CORS ======
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ====== Stores ======
DOC_STORE: Dict[str, str] = {}                    # doc_id -> full text
PAGE_STORE: Dict[str, List[str]] = {}             # doc_id -> pages text
CHUNK_STORE: Dict[str, List[Dict[str, Any]]] = {} # doc_id -> [{"text":..., "page":...}]
VEC_STORE: Dict[str, dict] = {}                   # doc_id -> {"vectorizer":..., "matrix":...}
DOC_META: Dict[str, Dict[str, Any]] = {}          # doc_id -> {"filename":..., "num_pages":...}


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
            chunk = text[i : i + chunk_size]
            chunks.append({"text": chunk, "page": page_idx})
            i += max(1, chunk_size - overlap)
    return chunks


def build_tfidf_index(doc_id: str, chunks: List[Dict[str, Any]]) -> None:
    texts = [c["text"] for c in chunks]
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
                "id": f"S{rank}",  # per-doc temporary label
                "doc_id": doc_id,
                "score": score,
                "text": chunk_obj.get("text", ""),
                "page": int(chunk_obj.get("page", 0) or 0),
            }
        )
    return results


def merge_retrieval(doc_ids: List[str], query: str, top_k_total: int = 7, k_per_doc: int = 5) -> List[Dict[str, Any]]:
    """
    Retrieve per document then merge by score, return top_k_total overall.
    Re-label sources as S1..Sn across merged list.
    """
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
        "max_tokens": 500,
        "temperature": 0.4,
    }

    try:
        res = requests.post(url, headers=headers, json=body, timeout=60)
        res.raise_for_status()
        data = res.json()
        return data["choices"][0]["message"]["content"]
    except Exception as e:
        return f"LLM Error: {str(e)}"


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
    # Multi-doc support: send doc_ids; if empty, fallback to doc_id
    doc_ids: List[str] = Field(default_factory=list)
    doc_id: Optional[str] = None

    message: str
    mode: str = "strict"  # "strict" | "simple" | "exam"

    history: List[Dict[str, str]] = Field(default_factory=list)


# ====== Upload (single) ======
@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
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

    DOC_STORE[doc_id] = full_text
    PAGE_STORE[doc_id] = pages
    DOC_META[doc_id] = {"filename": filename, "num_pages": num_pages}

    chunks = chunk_pages(pages, chunk_size=1200, overlap=200)
    CHUNK_STORE[doc_id] = chunks
    build_tfidf_index(doc_id, chunks)

    return {"doc_id": doc_id, "text": full_text, "filename": filename, "num_pages": num_pages}


# ====== Summarize ======
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


# ====== Questions ======
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


# ====== Flashcards ======
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


def build_mode_instructions(mode: str) -> str:
    mode = (mode or "strict").strip().lower()
    if mode == "simple":
        return (
            "Mode: SIMPLE EXPLANATION.\n"
            "- Explain in very simple terms.\n"
            "- Use short sentences.\n"
            "- Give a tiny example if possible.\n"
            "- Still ONLY use PDF context.\n"
        )
    if mode == "exam":
        return (
            "Mode: EXAM-READY.\n"
            "- Answer like a model exam answer.\n"
            "- Use structured points (definitions, steps, key terms).\n"
            "- Still ONLY use PDF context.\n"
        )
    return (
        "Mode: STRICT PDF.\n"
        "- Answer ONLY from the provided PDF context.\n"
        "- If missing, say you couldn't find it in the PDF.\n"
    )


def translate_to_english_if_needed(text: str) -> str:
    """
    If the input looks Arabic, translate it to English for retrieval.
    Safe fallback if LLM fails.
    """
    try:
        if any("\u0600" <= c <= "\u06FF" for c in text):
            prompt = f"""
Translate the following question to English.
Return ONLY the translated question.

Question:
{text}
"""
            translated = call_llm(prompt).strip()
            if not translated or translated.startswith("LLM Error"):
                return text
            return translated
        return text
    except Exception:
        return text


# ====== Chat (multi-pdf + pages + modes) ======
@app.post("/chat")
async def chat_with_pdf(req: ChatRequest):
    # Determine doc_ids
    doc_ids = req.doc_ids if req.doc_ids else ([req.doc_id] if req.doc_id else [])
    doc_ids = [d for d in doc_ids if d and d in DOC_STORE]

    if not doc_ids:
        return {"answer": "No valid doc_id(s). Upload a PDF first.", "sources": []}

    retrieval_query = translate_to_english_if_needed(req.message)

    # ✅ FIX: use merge_retrieval (multi-pdf) instead of missing retrieve_chunks
    retrieved = merge_retrieval(doc_ids, retrieval_query, top_k_total=7, k_per_doc=5)

    if not retrieved or retrieved[0]["score"] < 0.05:
        return {"answer": "I couldn't find relevant content in the selected PDF(s).", "sources": []}

    # Context with source + file + page
    numbered_context = []
    for item in retrieved:
        meta = DOC_META.get(item["doc_id"], {})
        filename = meta.get("filename", item["doc_id"])
        numbered_context.append(
            f"{item['id']} (File: {filename}, Page {item['page']}):\n{item['text']}"
        )
    context = "\n\n---\n\n".join(numbered_context)

    # history (last 6)
    history_text = ""
    if req.history:
        last = req.history[-6:]
        lines = []
        for h in last:
            role = (h.get("role") or "").strip()
            content = (h.get("content") or "").strip()
            if content:
                lines.append(f"{role.upper()}: {content}")
        history_text = "\n".join(lines)

    mode_instructions = build_mode_instructions(req.mode)

    prompt = f"""
You are a helpful AI assistant.

{mode_instructions}

Rules:
- Cite sources like (S1), (S2) when stating facts.
- Mention page when helpful, e.g. Page 3 (S2).
- Keep the answer focused.

Conversation (optional):
{history_text}

PDF Context:
{context}

User Question:
{req.message}
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
                "page": item["page"],
                "score": item["score"],
                "excerpt": item["text"][:350].replace("\n", " ").strip(),
            }
        )

    return {"answer": answer, "sources": sources}


@app.get("/")
async def root():
    return {"message": "AI Study Assistant API is running ✅"}
