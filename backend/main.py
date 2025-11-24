from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from io import BytesIO
import PyPDF2
import os
import requests


app = FastAPI(
    title="AI Study Assistant API",
    description="Backend for summarizing PDFs, generating questions, and flashcards.",
    version="1.0.0"
)

# ====== CORS ======
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # لاحقاً ممكن تخصصها
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ====== استخراج نص من PDF ======
def extract_text_from_pdf(file_bytes: bytes) -> str:
    reader = PyPDF2.PdfReader(BytesIO(file_bytes))
    text = ""
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            text += page_text + "\n"
    return text

# ====== نماذج الطلب ======
class SummaryRequest(BaseModel):
    text: str
    level: str = "university"

class QuestionsRequest(BaseModel):
    text: str
    num_questions: int = 5

class FlashcardsRequest(BaseModel):
    text: str
    num_cards: int = 10

def call_llm(prompt: str) -> str:
    """
    استدعاء Groq API (متوافق مع OpenAI) لإرجاع نص من نموذج LLM.
    """
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return "LLM Error: GROQ_API_KEY is not set."

    url = "https://api.groq.com/openai/v1/chat/completions"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    body = {
        "model": "llama-3.3-70b-versatile",  # نموذج قوي ومجاني غالباً
        "messages": [
            {"role": "system", "content": "You are a helpful AI study assistant."},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 400,
        "temperature": 0.4,
    }

    try:
        response = requests.post(url, headers=headers, json=body)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]
    except Exception as e:
        return f"LLM Error: {str(e)}"


# ====== رفع PDF ======
@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    content = await file.read()
    text = extract_text_from_pdf(content)

    if not text.strip():
        return {"text": "", "message": "لم يتم استخراج أي نص من الملف. تأكد أن الـ PDF ليس عبارة عن صور فقط."}

    return {"text": text}

# ====== تلخيص ======
@app.post("/summarize")
async def summarize(req: SummaryRequest):
    prompt = f"""
You are an AI study assistant. Summarize the following text in clear bullet points.
Target level: {req.level} student.

Text:
{req.text}
"""
    summary = call_llm(prompt)
    return {"summary": summary}

# ====== أسئلة امتحان ======
@app.post("/generate-questions")
async def generate_questions(req: QuestionsRequest):
    prompt = f"""
You are an exam question generator for university students.

Read the following text and create {req.num_questions} exam questions.
Use a mix of:
- Multiple-choice questions (MCQ) with 4 options and indicate the correct answer.
- Short-answer questions.

Return them in a clear, numbered list.

Text:
{req.text}
"""
    questions = call_llm(prompt)
    return {"questions": questions}

# ====== Flashcards ======
@app.post("/generate-flashcards")
async def generate_flashcards(req: FlashcardsRequest):
    prompt = f"""
You are a flashcard generator.

From the following text, create {req.num_cards} flashcards.
Each flashcard should have:
- Front: a question or a term
- Back: the answer or explanation

Return them in a numbered list, clearly separating front and back.

Text:
{req.text}
"""
    flashcards = call_llm(prompt)
    return {"flashcards": flashcards}

# ====== اختبار ======
@app.get("/")
async def root():
    return {"message": "AI Study Assistant API is running ✅"}
