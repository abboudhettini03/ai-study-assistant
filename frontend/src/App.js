import React, { useEffect, useRef, useState } from "react";

function App() {
  const [file, setFile] = useState(null);
  const [text, setText] = useState("");
  const [summary, setSummary] = useState("");
  const [questions, setQuestions] = useState("");
  const [flashcards, setFlashcards] = useState("");
  const [error, setError] = useState("");
  const [loadingAction, setLoadingAction] = useState(null); // "upload" | "summary" | "questions" | "flashcards" | "chat" | null

  const [level, setLevel] = useState("university");
  const [numQuestions, setNumQuestions] = useState(5);
  const [numCards, setNumCards] = useState(6);

  // Multi-PDF
  const [docs, setDocs] = useState([]); // [{doc_id, filename, num_pages, selected}]
  const selectedDocIds = docs.filter((d) => d.selected).map((d) => d.doc_id);

  // Study mode
  const [chatMode, setChatMode] = useState("strict"); // strict | simple | exam

  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  // chatMessages: [{role, content, sources?, query?}]
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef(null);

  const [lang, setLang] = useState("en");

  const API_BASE = "https://ai-study-assistant-j5eu.onrender.com";

  const t = (key) => {
    const dict = {
      title: { en: "AI Study Assistant", ar: "مساعد الدراسة بالذكاء الاصطناعي" },
      subtitle: {
        en: "Upload one or more PDFs, then chat (with sources + page numbers), and generate summaries, questions, and flashcards.",
        ar: "ارفع ملف PDF واحد أو عدة ملفات، ثم اسأل (مع مصادر ورقم الصفحة)، وأنشئ ملخصًا وأسئلة وبطاقات مراجعة.",
      },
      pdfFile: { en: "PDF File", ar: "ملف PDF" },
      uploadBtn: { en: "Upload & Extract", ar: "رفع واستخراج النص" },
      uploadHint: {
        en: "Upload multiple PDFs one by one. Select which PDFs to chat with.",
        ar: "يمكنك رفع عدة ملفات PDF واحدًا تلو الآخر، ثم اختيار الملفات التي تريد السؤال عنها.",
      },
      levelLabel: { en: "Level", ar: "المستوى" },
      levelSchool: { en: "School", ar: "مدرسة" },
      levelUni: { en: "University", ar: "جامعة" },
      levelAdv: { en: "Advanced", ar: "متقدم" },
      numQuestionsLabel: { en: "# Questions", ar: "عدد الأسئلة" },
      numCardsLabel: { en: "# Flashcards", ar: "عدد البطاقات" },
      textLabel: { en: "Extracted / Input Text", ar: "النص المستخرج / النص المدخل" },
      textPlaceholder: {
        en: "Paste lecture notes or use extracted text from last uploaded PDF...",
        ar: "الصق ملاحظات المحاضرة أو استخدم النص المستخرج من آخر ملف PDF مرفوع...",
      },
      summaryBtn: { en: "Generate Summary", ar: "إنشاء ملخص" },
      questionsBtn: { en: "Generate Questions", ar: "إنشاء أسئلة" },
      flashcardsBtn: { en: "Generate Flashcards", ar: "Generate Flashcards" },
      downloadBtn: { en: "Download Study Pack", ar: "تحميل ملف المذاكرة" },
      summaryTitle: { en: "Summary", ar: "الملخص" },
      questionsTitle: { en: "Questions", ar: "الأسئلة" },
      flashcardsTitle: { en: "Flashcards", ar: "البطاقات" },
      errorNoText: { en: "No text available.", ar: "لا يوجد نص متاح." },
      errorChoosePDF: { en: "Please choose a PDF file first.", ar: "يرجى اختيار ملف PDF أولاً." },
      errorUploadFirst: { en: "Upload/select at least one PDF first.", ar: "ارفع/اختر ملف PDF واحد على الأقل أولاً." },
      chatError: { en: "Chat error.", ar: "حدث خطأ في الشات." },
      sourcesTitle: { en: "Sources", ar: "المصادر" },
      sourceScore: { en: "score", ar: "التشابه" },
      selectedPdfs: { en: "Selected PDFs", ar: "الملفات المختارة" },
      noneSelected: { en: "None selected", ar: "لا يوجد ملفات مختارة" },
      clearAllPdfs: { en: "Clear PDFs", ar: "مسح الملفات" },
      chatTitle: { en: "Chat with selected PDF(s)", ar: "الدردشة مع الملفات المختارة" },
      modeLabel: { en: "Mode", ar: "الوضع" },
      modeStrict: { en: "Strict (PDF only)", ar: "صارم (من PDF فقط)" },
      modeSimple: { en: "Simple explanation", ar: "شرح مبسط" },
      modeExam: { en: "Exam-ready", ar: "إجابة امتحانية" },
    };
    return dict[key]?.[lang] || key;
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isTyping]);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setError("");
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

      const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to upload file.");

      if (!data.text || data.text.trim() === "") {
        setError(data.message || "Could not extract text from PDF.");
        return;
      }

      // Keep extracted text in textarea (last uploaded)
      setText(data.text);

      // Add to docs list + auto-select
      setDocs((prev) => {
        const newDoc = {
          doc_id: data.doc_id,
          filename: data.filename || (file?.name ?? "document.pdf"),
          num_pages: data.num_pages || 0,
          selected: true,
        };

        // keep previous docs, but DO NOT duplicate same doc_id
        const filtered = prev.filter((d) => d.doc_id !== newDoc.doc_id);

        // Option: keep previous selection as-is and also select this new one
        return [...filtered, newDoc].map((d) =>
          d.doc_id === newDoc.doc_id ? { ...d, selected: true } : d
        );
      });

      // reset chat (because context set changed)
      setChatMessages([]);
      setChatInput("");
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
      if (!res.ok) throw new Error(data.detail || "Failed to generate summary.");
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
        body: JSON.stringify({ text, num_questions: Number(numQuestions) || 5 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to generate questions.");
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
        body: JSON.stringify({ text, num_cards: Number(numCards) || 6 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to generate flashcards.");
      setFlashcards(data.flashcards);
    } catch (err) {
      setError(err.message || "Error generating flashcards.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleChatSend = async () => {
    const msg = chatInput.trim();

    if (selectedDocIds.length === 0) {
      setError(t("errorUploadFirst"));
      return;
    }
    if (!msg) return;
    if (loadingAction === "chat") return;

    const userMsg = { role: "user", content: msg };

    const historyToSend = [...chatMessages, userMsg]
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));

    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput("");

    setLoadingAction("chat");
    setIsTyping(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_ids: selectedDocIds, // ✅ multi-pdf
          message: msg,
          mode: chatMode,          // ✅ study mode
          history: historyToSend,  // ✅ history
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Chat failed.");

      const botMsg = {
        role: "assistant",
        content: data.answer || "No answer.",
        sources: Array.isArray(data.sources) ? data.sources : [],
        query: msg, // ✅ for highlight
      };

      setChatMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      setError(err?.message || t("chatError"));
    } finally {
      setIsTyping(false);
      setLoadingAction(null);
    }
  };

  const handleClearChat = () => {
    setChatMessages([]);
    setChatInput("");
    setError("");
  };

  const handleClearDocs = () => {
    setDocs([]);
    setChatMessages([]);
    setChatInput("");
    setError("");
  };

  const toggleDocSelected = (doc_id) => {
    setDocs((prev) =>
      prev.map((d) => (d.doc_id === doc_id ? { ...d, selected: !d.selected } : d))
    );
    // chat context changed
    setChatMessages([]);
    setChatInput("");
  };

  const handleDownload = () => {
    if (!summary && !questions && !flashcards) {
      setError(lang === "ar"
        ? "لا يوجد شيء للتحميل بعد. أنشئ على الأقل الملخص أو الأسئلة أو البطاقات."
        : "Nothing to download yet. Generate at least one of summary, questions, or flashcards."
      );
      return;
    }

    let content = "";
    content += "==== SUMMARY ====\n\n" + (summary || "") + "\n\n";
    content += "==== QUESTIONS ====\n\n" + (questions || "") + "\n\n";
    content += "==== FLASHCARDS ====\n\n" + (flashcards || "") + "\n\n";

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = lang === "ar" ? "ملف_المذاكرة.txt" : "study_pack.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const isLoading = (action) => loadingAction === action;

  const dir = lang === "ar" ? "rtl" : "ltr";
  const align = lang === "ar" ? "right" : "left";

  // ===== Highlight helpers =====
  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const getQueryTerms = (query) => {
    if (!query) return [];
    return query
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 3)
      .slice(0, 12);
  };

  const highlightText = (text, terms) => {
    if (!text || !terms || terms.length === 0) return text;

    const unique = Array.from(new Set(terms)).filter(Boolean);
    if (!unique.length) return text;

    const pattern = unique.map(escapeRegExp).join("|");
    const regex = new RegExp(`(${pattern})`, "giu");

    const parts = text.split(regex);

    return parts.map((part, idx) => {
      const isMatch = unique.some((t) => part.toLowerCase() === t.toLowerCase());
      if (!isMatch) return <span key={idx}>{part}</span>;

      return (
        <mark
          key={idx}
          style={{
            background: "rgba(250,204,21,0.25)",
            color: "#e5e7eb",
            padding: "0 2px",
            borderRadius: "6px",
            border: "1px solid rgba(250,204,21,0.25)",
          }}
        >
          {part}
        </mark>
      );
    });
  };

  // ===== Sources Cards (Collapse) =====
  const SourceCards = ({ sources, query }) => {
    const [open, setOpen] = useState(false);
    if (!sources || !sources.length) return null;

    const terms = getQueryTerms(query);

    return (
      <div style={{ marginTop: "8px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "6px",
          }}
        >
          <div style={{ fontSize: "12px", color: "#9ca3af", fontWeight: 700 }}>
            {t("sourcesTitle")}
          </div>

          <button
            onClick={() => setOpen((v) => !v)}
            style={{
              background: "transparent",
              border: "1px solid #4b5563",
              borderRadius: "999px",
              padding: "4px 10px",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
              color: "#e5e7eb",
            }}
          >
            {open ? (lang === "ar" ? "إخفاء" : "Hide") : (lang === "ar" ? "إظهار" : "Show")}
          </button>
        </div>

        {open && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "8px",
            }}
          >
            {sources.map((s, i) => (
              <div
                key={i}
                style={{
                  border: "1px solid rgba(75,85,99,0.8)",
                  background: "rgba(2,6,23,0.7)",
                  borderRadius: "12px",
                  padding: "10px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "10px",
                    alignItems: "center",
                    marginBottom: "6px",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: "12px",
                      display: "flex",
                      gap: "8px",
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <span>{s.id}</span>

                    {s.filename ? (
                      <span
                        style={{
                          fontSize: "11px",
                          color: "#9ca3af",
                          border: "1px solid rgba(75,85,99,0.8)",
                          padding: "2px 8px",
                          borderRadius: "999px",
                          background: "rgba(15,23,42,0.6)",
                        }}
                      >
                        {s.filename}
                      </span>
                    ) : null}

                    {s.page ? (
                      <span
                        style={{
                          fontSize: "11px",
                          color: "#9ca3af",
                          border: "1px solid rgba(75,85,99,0.8)",
                          padding: "2px 8px",
                          borderRadius: "999px",
                          background: "rgba(15,23,42,0.6)",
                        }}
                      >
                        {lang === "ar" ? `صفحة ${s.page}` : `Page ${s.page}`}
                      </span>
                    ) : null}
                  </div>

                  <div style={{ fontSize: "11px", color: "#9ca3af" }}>
                    {t("sourceScore")}:{" "}
                    <span style={{ color: "#e5e7eb", fontWeight: 700 }}>
                      {typeof s.score === "number" ? s.score.toFixed(3) : s.score}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    fontSize: "12px",
                    color: "#d1d5db",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {highlightText(s.excerpt || "", terms)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        margin: 0,
        padding: "24px",
        background: "radial-gradient(circle at top, #1d4ed8 0, #020617 45%, #000000 100%)",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
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
            <h1 style={{ fontSize: "26px", fontWeight: 700, margin: 0 }}>{t("title")}</h1>
            <p style={{ marginTop: "6px", marginBottom: 0, color: "#9ca3af", maxWidth: "560px", fontSize: "14px" }}>
              {t("subtitle")}
            </p>
          </div>

          <div style={{ fontSize: "12px", color: "#9ca3af", textAlign: align }}>
            <div style={{ marginBottom: "6px", display: "flex", gap: "6px", justifyContent: align === "right" ? "flex-end" : "flex-start" }}>
              <button
                onClick={() => setLang("en")}
                style={{
                  padding: "4px 8px",
                  borderRadius: "999px",
                  border: lang === "en" ? "1px solid #e5e7eb" : "1px solid #4b5563",
                  background: lang === "en" ? "#e5e7eb" : "rgba(15,23,42,0.9)",
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
                  border: lang === "ar" ? "1px solid #e5e7eb" : "1px solid #4b5563",
                  background: lang === "ar" ? "#e5e7eb" : "rgba(15,23,42,0.9)",
                  color: lang === "ar" ? "#020617" : "#e5e7eb",
                  cursor: "pointer",
                  fontSize: "11px",
                  fontWeight: 600,
                }}
              >
                AR
              </button>
            </div>
          </div>
        </header>

        {/* File + Settings */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: "16px", marginBottom: "16px" }}>
          {/* Upload */}
          <div
            style={{
              padding: "12px",
              borderRadius: "14px",
              border: "1px solid rgba(55,65,81,0.7)",
              background: "linear-gradient(135deg, rgba(15,23,42,0.9), rgba(15,23,42,0.6))",
              textAlign: align,
            }}
          >
            <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", color: "#9ca3af" }}>
              {t("pdfFile")}
            </label>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <input type="file" accept="application/pdf" onChange={handleFileChange} style={{ color: "#e5e7eb", fontSize: "13px" }} />
              <button
                onClick={handleUpload}
                disabled={isLoading("upload")}
                style={{
                  background: "linear-gradient(135deg, #3b82f6, #2563eb, #1d4ed8)",
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

              <button
                onClick={handleClearDocs}
                disabled={docs.length === 0}
                style={{
                  background: "transparent",
                  border: "1px solid #4b5563",
                  padding: "8px 14px",
                  borderRadius: "999px",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: "13px",
                  opacity: docs.length === 0 ? 0.5 : 1,
                  color: "#e5e7eb",
                }}
              >
                {t("clearAllPdfs")}
              </button>
            </div>

            <div style={{ marginTop: "6px", fontSize: "12px", color: "#6b7280" }}>{t("uploadHint")}</div>

            {/* Docs selector */}
            <div style={{ marginTop: "10px" }}>
              <div style={{ fontSize: "12px", color: "#9ca3af", fontWeight: 700, marginBottom: "6px" }}>
                {t("selectedPdfs")}:{" "}
                <span style={{ color: "#e5e7eb", fontWeight: 700 }}>
                  {selectedDocIds.length ? selectedDocIds.length : t("noneSelected")}
                </span>
              </div>

              {docs.length > 0 && (
                <div style={{ display: "grid", gap: "6px" }}>
                  {docs.map((d) => (
                    <label
                      key={d.doc_id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "8px 10px",
                        borderRadius: "12px",
                        border: "1px solid rgba(75,85,99,0.6)",
                        background: "rgba(2,6,23,0.45)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!!d.selected}
                        onChange={() => toggleDocSelected(d.doc_id)}
                      />
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <div style={{ fontSize: "12px", fontWeight: 800 }}>{d.filename}</div>
                        <div style={{ fontSize: "11px", color: "#9ca3af" }}>
                          {lang === "ar" ? `عدد الصفحات: ${d.num_pages || 0}` : `Pages: ${d.num_pages || 0}`}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Settings */}
          <div
            style={{
              padding: "12px",
              borderRadius: "14px",
              border: "1px solid rgba(55,65,81,0.7)",
              background: "linear-gradient(135deg, rgba(15,23,42,0.95), rgba(15,23,42,0.7))",
              textAlign: align,
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "10px", fontSize: "13px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "4px", color: "#9ca3af" }}>{t("levelLabel")}</label>
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
                <label style={{ display: "block", marginBottom: "4px", color: "#9ca3af" }}>{t("numQuestionsLabel")}</label>
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
                <label style={{ display: "block", marginBottom: "4px", color: "#9ca3af" }}>{t("numCardsLabel")}</label>
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

              {/* Study mode */}
              <div>
                <label style={{ display: "block", marginBottom: "4px", color: "#9ca3af" }}>
                  {t("modeLabel")}
                </label>
                <select
                  value={chatMode}
                  onChange={(e) => setChatMode(e.target.value)}
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
                  <option value="strict">{t("modeStrict")}</option>
                  <option value="simple">{t("modeSimple")}</option>
                  <option value="exam">{t("modeExam")}</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Text area */}
        <div style={{ marginBottom: "14px", textAlign: align }}>
          <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", color: "#9ca3af" }}>
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

        {/* Chat */}
        <div
          style={{
            marginTop: "14px",
            padding: "12px",
            borderRadius: "14px",
            border: "1px solid rgba(55,65,81,0.7)",
            background: "linear-gradient(135deg, rgba(15,23,42,0.95), rgba(15,23,42,0.7))",
            textAlign: align,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>{t("chatTitle")}</h2>
            <div style={{ fontSize: "12px", color: "#9ca3af" }}>
              {selectedDocIds.length
                ? (lang === "ar" ? `ملفات مختارة: ${selectedDocIds.length} ✅` : `Selected: ${selectedDocIds.length} ✅`)
                : (lang === "ar" ? "اختر ملفًا أولاً" : "Select at least one PDF")}
            </div>
          </div>

          <div
            style={{
              marginTop: "10px",
              height: "240px",
              overflowY: "auto",
              padding: "10px",
              borderRadius: "12px",
              border: "1px solid #4b5563",
              background: "#020617",
              fontSize: "13px",
              whiteSpace: "pre-wrap",
            }}
          >
            {chatMessages.length === 0 ? (
              <div style={{ opacity: 0.6 }}>
                {lang === "ar"
                  ? "اسأل سؤالًا… مثال: لخص الفكرة الرئيسية واذكر الصفحة."
                  : "Ask a question… e.g., Summarize the main idea and cite page."}
              </div>
            ) : (
              chatMessages.map((m, idx) => (
                <div key={idx} style={{ marginBottom: "12px" }}>
                  <div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "2px" }}>
                    {m.role === "user" ? (lang === "ar" ? "أنت" : "You") : (lang === "ar" ? "المساعد" : "Assistant")}
                  </div>
                  <div style={{ lineHeight: 1.5 }}>{m.content}</div>
                  {m.role === "assistant" && <SourceCards sources={m.sources} query={m.query} />}
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          {isTyping && (
            <div style={{ opacity: 0.7, fontSize: "13px", marginTop: "10px" }}>
              {lang === "ar" ? "المساعد يكتب..." : "Assistant is typing..."}
            </div>
          )}

          <div style={{ marginTop: "10px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={
                lang === "ar"
                  ? "اكتب سؤالك هنا... (Enter لإرسال، Shift+Enter لسطر جديد)"
                  : "Type your question... (Enter to send, Shift+Enter for new line)"
              }
              style={{
                flex: "1 1 320px",
                padding: "10px 14px",
                borderRadius: "16px",
                border: "1px solid #4b5563",
                background: "#020617",
                color: "#e5e7eb",
                fontSize: "13px",
                outline: "none",
                minHeight: "44px",
                resize: "vertical",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleChatSend();
                }
              }}
              disabled={loadingAction === "chat"}
            />

            <button
              onClick={handleChatSend}
              disabled={loadingAction === "chat"}
              style={{
                background: "linear-gradient(135deg, #06b6d4, #0891b2, #0e7490)",
                border: "none",
                padding: "10px 16px",
                borderRadius: "999px",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: "13px",
                opacity: loadingAction === "chat" ? 0.7 : 1,
              }}
            >
              {loadingAction === "chat" ? (lang === "ar" ? "جاري..." : "Sending...") : (lang === "ar" ? "إرسال" : "Send")}
            </button>

            <button
              onClick={handleClearChat}
              disabled={chatMessages.length === 0 && !chatInput}
              style={{
                background: "transparent",
                border: "1px solid #4b5563",
                padding: "10px 14px",
                borderRadius: "999px",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: "13px",
                opacity: chatMessages.length === 0 && !chatInput ? 0.5 : 1,
                color: "#e5e7eb",
              }}
            >
              {lang === "ar" ? "مسح" : "Clear"}
            </button>
          </div>
        </div>

        {/* Actions */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "10px",
            marginBottom: "14px",
            justifyContent: align === "right" ? "flex-end" : "flex-start",
            marginTop: "14px",
          }}
        >
          <button
            onClick={handleSummarize}
            disabled={isLoading("summary")}
            style={{
              background: "linear-gradient(135deg, #22c55e, #16a34a, #15803d)",
              border: "none",
              padding: "8px 18px",
              borderRadius: "999px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "13px",
              opacity: isLoading("summary") ? 0.7 : 1,
            }}
          >
            {lang === "ar" ? "إنشاء ملخص" : "Generate Summary"}
          </button>

          <button
            onClick={handleQuestions}
            disabled={isLoading("questions")}
            style={{
              background: "linear-gradient(135deg, #a855f7, #8b5cf6, #7c3aed)",
              border: "none",
              padding: "8px 18px",
              borderRadius: "999px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "13px",
              opacity: isLoading("questions") ? 0.7 : 1,
            }}
          >
            {lang === "ar" ? "إنشاء أسئلة" : "Generate Questions"}
          </button>

          <button
            onClick={handleFlashcards}
            disabled={isLoading("flashcards")}
            style={{
              background: "linear-gradient(135deg, #f97316, #ea580c, #c2410c)",
              border: "none",
              padding: "8px 18px",
              borderRadius: "999px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "13px",
              opacity: isLoading("flashcards") ? 0.7 : 1,
            }}
          >
            {lang === "ar" ? "إنشاء بطاقات" : "Generate Flashcards"}
          </button>

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

        {/* Error */}
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px", marginTop: "8px" }}>
          <ResultCard title={t("summaryTitle")} content={summary} placeholder={lang === "ar" ? "لا يوجد ملخص بعد." : "No summary yet."} />
          <ResultCard title={t("questionsTitle")} content={questions} placeholder={lang === "ar" ? "لا توجد أسئلة بعد." : "No questions yet."} />
          <ResultCard title={t("flashcardsTitle")} content={flashcards} placeholder={lang === "ar" ? "لا توجد بطاقات بعد." : "No flashcards yet."} />
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
        background: "linear-gradient(145deg, rgba(15,23,42,0.95), rgba(15,23,42,0.8))",
        padding: "12px",
        minHeight: "160px",
        maxHeight: "260px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <h2 style={{ fontSize: "15px", margin: 0, marginBottom: "6px", fontWeight: 600 }}>{title}</h2>
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
