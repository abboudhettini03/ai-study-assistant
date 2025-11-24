import React, { useState } from "react";

function App() {
  const [file, setFile] = useState(null);
  const [text, setText] = useState("");
  const [summary, setSummary] = useState("");
  const [questions, setQuestions] = useState("");
  const [flashcards, setFlashcards] = useState("");
  const [error, setError] = useState("");
  const [loadingAction, setLoadingAction] = useState(null); // "upload" | "summary" | "questions" | "flashcards" | null

  const [level, setLevel] = useState("university");
  const [numQuestions, setNumQuestions] = useState(5);
  const [numCards, setNumCards] = useState(6);

  // 🔁 حالة اللغة: en أو ar
  const [lang, setLang] = useState("en");

  const API_BASE = "http://127.0.0.1:8000";

  // دالة ترجمة بسيطة
  const t = (key) => {
    const dict = {
      title: {
        en: "AI Study Assistant",
        ar: "مساعد الدراسة بالذكاء الاصطناعي",
      },
      subtitle: {
        en: "Upload your lecture PDF or paste text, then generate a summary, exam questions, and flashcards.",
        ar: "ارفع ملف المحاضرة (PDF) أو الصق نصًا، ثم أنشئ ملخصًا، وأسئلة اختبار، وبطاقات مراجعة بضغطة زر.",
      },
      modeLabel: {
        en: "Mode: GenAI Study Tool",
        ar: "الوضع: أداة دراسة بالذكاء الاصطناعي",
      },
      backendLabel: {
        en: "Backend: FastAPI + Groq LLM",
        ar: "الخلفية: FastAPI + Groq LLM",
      },
      pdfFile: {
        en: "PDF File",
        ar: "ملف PDF",
      },
      uploadBtn: {
        en: "Upload & Extract",
        ar: "رفع واستخراج النص",
      },
      uploadHint: {
        en: "You can also skip the PDF and paste text directly in the box below.",
        ar: "يمكنك أيضًا تجاوز رفع الملف ولصق النص مباشرة في الصندوق أدناه.",
      },
      levelLabel: {
        en: "Level",
        ar: "المستوى",
      },
      levelSchool: {
        en: "School",
        ar: "مدرسة",
      },
      levelUni: {
        en: "University",
        ar: "جامعة",
      },
      levelAdv: {
        en: "Advanced",
        ar: "متقدم",
      },
      numQuestionsLabel: {
        en: "# Questions",
        ar: "عدد الأسئلة",
      },
      numCardsLabel: {
        en: "# Flashcards",
        ar: "عدد البطاقات",
      },
      textLabel: {
        en: "Extracted / Input Text",
        ar: "النص المستخرج / النص المدخل",
      },
      textPlaceholder: {
        en: "Paste any lecture notes or let the assistant fill this by uploading a PDF...",
        ar: "الصق أي ملاحظات محاضرة هنا، أو دع المساعد يملؤها بعد رفع ملف PDF...",
      },
      summaryBtn: {
        en: "Generate Summary",
        ar: "إنشاء ملخص",
      },
      summaryLoading: {
        en: "Summarizing...",
        ar: "جاري إنشاء الملخص...",
      },
      questionsBtn: {
        en: "Generate Questions",
        ar: "إنشاء أسئلة",
      },
      questionsLoading: {
        en: "Generating...",
        ar: "جاري إنشاء الأسئلة...",
      },
      flashcardsBtn: {
        en: "Generate Flashcards",
        ar: "Generate Flashcards", // نقدر نترجمها لو حاب
      },
      flashcardsLoading: {
        en: "Generating...",
        ar: "جاري إنشاء البطاقات...",
      },
      downloadBtn: {
        en: "Download Study Pack",
        ar: "تحميل ملف المذاكرة",
      },
      noSummary: {
        en: "No summary yet.",
        ar: "لا يوجد ملخص بعد.",
      },
      noQuestions: {
        en: "No questions yet.",
        ar: "لا توجد أسئلة بعد.",
      },
      noFlashcards: {
        en: "No flashcards yet.",
        ar: "لا توجد بطاقات بعد.",
      },
      summaryTitle: {
        en: "Summary",
        ar: "الملخص",
      },
      questionsTitle: {
        en: "Questions",
        ar: "الأسئلة",
      },
      flashcardsTitle: {
        en: "Flashcards",
        ar: "البطاقات",
      },
      errorNoText: {
        en: "No text available. Upload a PDF first or paste some text.",
        ar: "لا يوجد نص متاح. ارفع ملف PDF أولاً أو الصق نصًا.",
      },
      errorChoosePDF: {
        en: "Please choose a PDF file first.",
        ar: "يرجى اختيار ملف PDF أولاً.",
      },
      errorNoContentToDownload: {
        en: "Nothing to download yet. Generate at least one of summary, questions, or flashcards.",
        ar: "لا يوجد شيء للتحميل بعد. أنشئ على الأقل الملخص أو الأسئلة أو البطاقات.",
      },
    };
    return dict[key]?.[lang] || key;
  };

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setError("");
    setSummary("");
    setQuestions("");
    setFlashcards("");
  };

  const handleUpload = async () => {
    if (!file) {
      setError(t("errorChoosePDF"));
      return;
    }
    setLoadingAction("upload");
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Failed to upload file.");
      }

      if (!data.text || data.text.trim() === "") {
        setError(data.message || "Could not extract text from PDF.");
      } else {
        setText(data.text);
      }
    } catch (err) {
      setError(err.message || "Error uploading file.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSummarize = async () => {
    if (!text.trim()) {
      setError(t("errorNoText"));
      return;
    }
    setLoadingAction("summary");
    setError("");
    setSummary("");
    try {
      const res = await fetch(`${API_BASE}/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, level }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Failed to generate summary.");
      }
      setSummary(data.summary);
    } catch (err) {
      setError(err.message || "Error generating summary.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleQuestions = async () => {
    if (!text.trim()) {
      setError(t("errorNoText"));
      return;
    }
    setLoadingAction("questions");
    setError("");
    setQuestions("");
    try {
      const res = await fetch(`${API_BASE}/generate-questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          num_questions: Number(numQuestions) || 5,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Failed to generate questions.");
      }
      setQuestions(data.questions);
    } catch (err) {
      setError(err.message || "Error generating questions.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleFlashcards = async () => {
    if (!text.trim()) {
      setError(t("errorNoText"));
      return;
    }
    setLoadingAction("flashcards");
    setError("");
    setFlashcards("");
    try {
      const res = await fetch(`${API_BASE}/generate-flashcards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          num_cards: Number(numCards) || 6,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Failed to generate flashcards.");
      }
      setFlashcards(data.flashcards);
    } catch (err) {
      setError(err.message || "Error generating flashcards.");
    } finally {
      setLoadingAction(null);
    }
  };

  // 📥 زر تحميل ملف نصي يجمع الثلاثة
  const handleDownload = () => {
    if (!summary && !questions && !flashcards) {
      setError(t("errorNoContentToDownload"));
      return;
    }

    let content = "";
    content += "==== SUMMARY ====\n\n";
    content += summary || t("noSummary");
    content += "\n\n==== QUESTIONS ====\n\n";
    content += questions || t("noQuestions");
    content += "\n\n==== FLASHCARDS ====\n\n";
    content += flashcards || t("noFlashcards");

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const fileName =
      lang === "ar" ? "ملف_المذاكرة.txt" : "study_pack.txt";

    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const isLoading = (action) => loadingAction === action;

  const dir = lang === "ar" ? "rtl" : "ltr";
  const align = lang === "ar" ? "right" : "left";

  return (
    <div
      style={{
        minHeight: "100vh",
        margin: 0,
        padding: "24px",
        background:
          "radial-gradient(circle at top, #1d4ed8 0, #020617 45%, #000000 100%)",
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "#e5e7eb",
      }}
      dir={dir}
    >
      <div
        style={{
          maxWidth: "1100px",
          margin: "0 auto",
          background: "rgba(15,23,42,0.96)",
          borderRadius: "20px",
          border: "1px solid rgba(148,163,184,0.25)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
          padding: "24px 24px 28px",
        }}
      >
        {/* Header */}
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "16px",
            marginBottom: "20px",
            textAlign: align,
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "26px",
                fontWeight: 700,
                margin: 0,
              }}
            >
              {t("title")}
            </h1>
            <p
              style={{
                marginTop: "6px",
                marginBottom: 0,
                color: "#9ca3af",
                maxWidth: "480px",
                fontSize: "14px",
              }}
            >
              {t("subtitle")}
            </p>
          </div>

          <div
            style={{
              fontSize: "12px",
              color: "#9ca3af",
              textAlign: align,
            }}
          >
            {/* زر تبديل اللغة */}
            <div
              style={{
                marginBottom: "6px",
                display: "flex",
                gap: "6px",
                justifyContent: align === "right" ? "flex-end" : "flex-start",
              }}
            >
              <button
                onClick={() => setLang("en")}
                style={{
                  padding: "4px 8px",
                  borderRadius: "999px",
                  border:
                    lang === "en"
                      ? "1px solid #e5e7eb"
                      : "1px solid #4b5563",
                  background:
                    lang === "en" ? "#e5e7eb" : "rgba(15,23,42,0.9)",
                  color: lang === "en" ? "#020617" : "#e5e7eb",
                  cursor: "pointer",
                  fontSize: "11px",
                  fontWeight: 600,
                }}
              >
                EN
              </button>
              <button
                onClick={() => setLang("ar")}
                style={{
                  padding: "4px 8px",
                  borderRadius: "999px",
                  border:
                    lang === "ar"
                      ? "1px solid #e5e7eb"
                      : "1px solid #4b5563",
                  background:
                    lang === "ar" ? "#e5e7eb" : "rgba(15,23,42,0.9)",
                  color: lang === "ar" ? "#020617" : "#e5e7eb",
                  cursor: "pointer",
                  fontSize: "11px",
                  fontWeight: 600,
                }}
              >
                AR
              </button>
            </div>
            <div>{t("modeLabel")}</div>
            <div style={{ opacity: 0.7 }}>{t("backendLabel")}</div>
          </div>
        </header>

        {/* Top controls: file + settings */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
            gap: "16px",
            marginBottom: "16px",
          }}
        >
          {/* File upload */}
          <div
            style={{
              padding: "12px",
              borderRadius: "14px",
              border: "1px solid rgba(55,65,81,0.7)",
              background:
                "linear-gradient(135deg, rgba(15,23,42,0.9), rgba(15,23,42,0.6))",
            }}
          >
            <label
              style={{
                display: "block",
                marginBottom: "6px",
                fontSize: "13px",
                color: "#9ca3af",
              }}
            >
              {t("pdfFile")}
            </label>
            <div
              style={{
                display: "flex",
                gap: "8px",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <input
                type="file"
                accept="application/pdf"
                onChange={handleFileChange}
                style={{ color: "#e5e7eb", fontSize: "13px" }}
              />
              <button
                onClick={handleUpload}
                disabled={isLoading("upload")}
                style={{
                  background:
                    "linear-gradient(135deg, #3b82f6, #2563eb, #1d4ed8)",
                  border: "none",
                  padding: "8px 16px",
                  borderRadius: "999px",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "13px",
                  opacity: isLoading("upload") ? 0.7 : 1,
                }}
              >
                {isLoading("upload") ? "..." : t("uploadBtn")}
              </button>
            </div>
            <div
              style={{
                marginTop: "6px",
                fontSize: "12px",
                color: "#6b7280",
              }}
            >
              {t("uploadHint")}
            </div>
          </div>

          {/* Settings */}
          <div
            style={{
              padding: "12px",
              borderRadius: "14px",
              border: "1px solid rgba(55,65,81,0.7)",
              background:
                "linear-gradient(135deg, rgba(15,23,42,0.95), rgba(15,23,42,0.7))",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                gap: "10px",
                fontSize: "13px",
              }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "4px",
                    color: "#9ca3af",
                  }}
                >
                  {t("levelLabel")}
                </label>
                <select
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "6px 8px",
                    borderRadius: "999px",
                    border: "1px solid #4b5563",
                    background: "#020617",
                    color: "#e5e7eb",
                    fontSize: "13px",
                  }}
                >
                  <option value="school">{t("levelSchool")}</option>
                  <option value="university">{t("levelUni")}</option>
                  <option value="advanced">{t("levelAdv")}</option>
                </select>
              </div>
              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "4px",
                    color: "#9ca3af",
                  }}
                >
                  {t("numQuestionsLabel")}
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={numQuestions}
                  onChange={(e) => setNumQuestions(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "6px 8px",
                    borderRadius: "999px",
                    border: "1px solid #4b5563",
                    background: "#020617",
                    color: "#e5e7eb",
                    fontSize: "13px",
                  }}
                />
              </div>
              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "4px",
                    color: "#9ca3af",
                  }}
                >
                  {t("numCardsLabel")}
                </label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={numCards}
                  onChange={(e) => setNumCards(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "6px 8px",
                    borderRadius: "999px",
                    border: "1px solid #4b5563",
                    background: "#020617",
                    color: "#e5e7eb",
                    fontSize: "13px",
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Text area */}
        <div style={{ marginBottom: "14px", textAlign: align }}>
          <label
            style={{
              display: "block",
              marginBottom: "4px",
              fontSize: "13px",
              color: "#9ca3af",
            }}
          >
            {t("textLabel")}
          </label>
          <textarea
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("textPlaceholder")}
            style={{
              width: "100%",
              borderRadius: "12px",
              padding: "10px",
              border: "1px solid #4b5563",
              background: "#020617",
              color: "#e5e7eb",
              fontSize: "13px",
              resize: "vertical",
            }}
          />
        </div>

        {/* Action buttons */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "10px",
            marginBottom: "14px",
            justifyContent: align === "right" ? "flex-end" : "flex-start",
          }}
        >
          <button
            onClick={handleSummarize}
            disabled={isLoading("summary")}
            style={{
              background:
                "linear-gradient(135deg, #22c55e, #16a34a, #15803d)",
              border: "none",
              padding: "8px 18px",
              borderRadius: "999px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "13px",
              opacity: isLoading("summary") ? 0.7 : 1,
            }}
          >
            {isLoading("summary") ? t("summaryLoading") : t("summaryBtn")}
          </button>
          <button
            onClick={handleQuestions}
            disabled={isLoading("questions")}
            style={{
              background:
                "linear-gradient(135deg, #a855f7, #8b5cf6, #7c3aed)",
              border: "none",
              padding: "8px 18px",
              borderRadius: "999px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "13px",
              opacity: isLoading("questions") ? 0.7 : 1,
            }}
          >
            {isLoading("questions")
              ? t("questionsLoading")
              : t("questionsBtn")}
          </button>
          <button
            onClick={handleFlashcards}
            disabled={isLoading("flashcards")}
            style={{
              background:
                "linear-gradient(135deg, #f97316, #ea580c, #c2410c)",
              border: "none",
              padding: "8px 18px",
              borderRadius: "999px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "13px",
              opacity: isLoading("flashcards") ? 0.7 : 1,
            }}
          >
            {isLoading("flashcards")
              ? t("flashcardsLoading")
              : t("flashcardsBtn")}
          </button>

          {/* زر Download */}
          <button
            onClick={handleDownload}
            style={{
              background: "transparent",
              border: "1px solid #9ca3af",
              padding: "8px 18px",
              borderRadius: "999px",
              cursor: "pointer",
              fontWeight: 500,
              fontSize: "13px",
              color: "#e5e7eb",
            }}
          >
            {t("downloadBtn")}
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div
            style={{
              marginBottom: "14px",
              padding: "8px 12px",
              borderRadius: "10px",
              background: "#7f1d1d",
              color: "#fecaca",
              fontSize: "13px",
              textAlign: align,
            }}
          >
            {error}
          </div>
        )}

        {/* Results grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "14px",
            marginTop: "8px",
          }}
        >
          <ResultCard
            title={t("summaryTitle")}
            content={summary}
            placeholder={t("noSummary")}
          />
          <ResultCard
            title={t("questionsTitle")}
            content={questions}
            placeholder={t("noQuestions")}
          />
          <ResultCard
            title={t("flashcardsTitle")}
            content={flashcards}
            placeholder={t("noFlashcards")}
          />
        </div>
      </div>
    </div>
  );
}

function ResultCard({ title, content, placeholder }) {
  return (
    <div
      style={{
        borderRadius: "14px",
        border: "1px solid rgba(55,65,81,0.8)",
        background:
          "linear-gradient(145deg, rgba(15,23,42,0.95), rgba(15,23,42,0.8))",
        padding: "12px",
        minHeight: "160px",
        maxHeight: "260px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <h2
        style={{
          fontSize: "15px",
          margin: 0,
          marginBottom: "6px",
          fontWeight: 600,
        }}
      >
        {title}
      </h2>
      <div
        style={{
          flexGrow: 1,
          overflowY: "auto",
          paddingRight: "4px",
          fontSize: "13px",
          whiteSpace: "pre-wrap",
          wordWrap: "break-word",
          color: "#d1d5db",
        }}
      >
        {content ? content : <span style={{ opacity: 0.5 }}>{placeholder}</span>}
      </div>
    </div>
  );
}

export default App;
