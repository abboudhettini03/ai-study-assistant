# 🧠 AI Study Assistant  
**Your intelligent companion for summarizing PDFs, generating study questions, and creating flashcards — powered by FastAPI, React, and Groq LLM.**

🔗 **Live Demo (Frontend):**  
https://ai-study-assistant-nu.vercel.app  

🔗 **Backend (Render):**  
https://ai-study-assistant-j5eu.onrender.com  

🔗 **API Docs (Swagger):**  
https://ai-study-assistant-j5eu.onrender.com/docs  

---

## 📘 Overview

AI Study Assistant is a full-stack intelligent tool designed for students and educators.  
It allows you to:

- Upload PDF files  
- Extract text  
- Generate summaries  
- Create exam questions  
- Convert text to flashcards  
- Switch UI language (Arabic / English)  
- Access everything from a clean, modern, mobile-friendly interface  

---

## ✨ Features

✔️ AI-powered summarization  
✔️ AI-generated questions  
✔️ Flashcards generation  
✔️ PDF upload and text extraction  
✔️ Arabic & English UI  
✔️ Fast responses using Groq LLM  
✔️ Full deployment (Render + Vercel)  

---

## 🧩 Tech Stack

### Frontend
- React (CRA)
- Axios
- Tailwind (optional)
- Vercel Hosting

### Backend
- FastAPI  
- Uvicorn  
- PyPDF2  
- Groq API  
- Render Hosting  

### AI
- Groq LLM (`mixtral-8x7b-32768`)

---

## 🏛️ Architecture

```
AI-Study-Assistant/
│
├── backend/
│   ├── main.py             
│   ├── requirements.txt
│
└── frontend/
    ├── public/             
    └── src/
        ├── App.js          
        └── components/     
```

---

## ⚙️ Environment Variables (Backend Only)

> ⚠️ **Important:**  
> Do NOT share your real Groq API key anywhere publicly.  
> Set it ONLY inside Render → Environment Variables.

```
GROQ_API_KEY=your_key_here
```

---

## 🛠️ How to Run the Project Locally

### 1️⃣ Clone the repo

```bash
git clone https://github.com/abboudhettini03/ai-study-assistant
cd ai-study-assistant
```

---

### 2️⃣ Backend Setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Backend runs at:  
http://127.0.0.1:8000/docs

---

### 3️⃣ Frontend Setup

```bash
cd ../frontend
npm install
npm start
```

Frontend runs at:  
http://localhost:3000

---

## 🔮 Future Features

- Chat with the PDF  
- Support .docx files  
- Export notes to PDF  
- Dark/Light Mode  
- Teacher dashboard  
- User accounts  

---

## 👨‍💻 Author

**ِAbboud hettini**  
AI Developer — Jordan 🇯🇴  

GitHub: https://github.com/abboudhettini03 

---

## ⭐ Support This Project  
If you like this project, please ⭐ star the repository!
