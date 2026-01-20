import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const API_BASE =
  process.env.REACT_APP_API_BASE || "https://ai-study-assistant-j5eu.onrender.com";

function hasArabic(text = "") {
  return /[\u0600-\u06FF]/.test(text);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Render text with inline citation badges:
 * Converts [S1] / (S1) into a styled LTR badge span.
 */
function renderWithCitations(text, dir) {
  if (!text) return null;
  const parts = [];
  const re = /(\[S\d+\]|\(S\d+\))/g;
  let last = 0;
  let m;

  while ((m = re.exec(text)) !== null) {
    const before = text.slice(last, m.index);
    if (before) parts.push(before);

    const raw = m[0];
    const id = raw.replace("[", "").replace("]", "").replace("(", "").replace(")", "");
    parts.push(
      <span
        key={`${m.index}-${id}`}
        className="citeBadge codeLike"
        dir="ltr"
        title="Citation"
      >
        {id}
      </span>
    );
    last = m.index + raw.length;
  }

  const rest = text.slice(last);
  if (rest) parts.push(rest);

  // bidiSafe prevents RTL/LTR scrambling
  return (
    <span dir={dir} className="bidiSafe">
      {parts}
    </span>
  );
}

function App() {
  // ====== Language UI
  const [uiLang, setUiLang] = useState("en");
  const uiDir = uiLang === "ar" ? "rtl" : "ltr";
  const t = (en, ar) => (uiLang === "ar" ? ar : en);

  // ====== PDFs
  const [file, setFile] = useState(null);
  const [pdfs, setPdfs] = useState([]); // [{doc_id, filename, num_pages, text}]
  const [selectedDocIds, setSelectedDocIds] = useState([]);

  // ====== Study Text
  const [text, setText] = useState("");
  const [level, setLevel] = useState("university");
  const [numQuestions, setNumQuestions] = useState(5);
  const [numCards, setNumCards] = useState(6);

  // ====== Outputs
  const [summary, setSummary] = useState("");
  const [questions, setQuestions] = useState("");
  const [flashcards, setFlashcards] = useState("");

  // ====== Chat
  const [mode, setMode] = useState("strict");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([]); // [{role, content, sources, lang}]
  const [isTyping, setIsTyping] = useState(false);

  // ====== UX
  const [tab, setTab] = useState("chat");
  const [loadingAction, setLoadingAction] = useState(null);
  const [error, setError] = useState("");
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isTyping, tab]);

  const selectedPdfs = useMemo(
    () => pdfs.filter((p) => selectedDocIds.includes(p.doc_id)),
    [pdfs, selectedDocIds]
  );

  useEffect(() => {
    if (selectedPdfs.length === 0) return;
    const combined = selectedPdfs
      .map((p) => p.text || "")
      .filter(Boolean)
      .join("\n\n---\n\n");
    setText(combined);
  }, [selectedPdfs]);

  const isLoading = (k) => loadingAction === k;

  const handleFileChange = (e) => {
    setFile(e.target.files?.[0] || null);
    setError("");
  };

  const toggleSelect = (doc_id) => {
    setSelectedDocIds((prev) => {
      if (prev.includes(doc_id)) return prev.filter((x) => x !== doc_id);
      return [...prev, doc_id];
    });
  };

  const handleClearPdfs = () => {
    setPdfs([]);
    setSelectedDocIds([]);
    setText("");
    setSummary("");
    setQuestions("");
    setFlashcards("");
    setChatMessages([]);
    setError("");
  };

  const handleUpload = async () => {
    if (!file) {
      setError(t("Please choose a PDF first.", "اختر ملف PDF أولاً."));
      return;
    }

    setLoadingAction("upload");
    setError("");

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: form });
      const data = await res.json();

      if (!res.ok) throw new Error(data?.detail || "Upload failed.");
      if (!data?.doc_id) throw new Error(data?.message || "No doc_id returned.");

      const item = {
        doc_id: data.doc_id,
        filename: data.filename || file.name || "document.pdf",
        num_pages: data.num_pages || null,
        text: data.text || "",
      };

      setPdfs((prev) => [item, ...prev]);
      setSelectedDocIds((prev) => (prev.includes(item.doc_id) ? prev : [item.doc_id, ...prev]));
      setFile(null);

      setChatMessages([]);
      setSummary("");
      setQuestions("");
      setFlashcards("");
    } catch (e) {
      setError(e?.message || "Upload error.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSummarize = async () => {
    if (!text.trim()) {
      setError(t("No text available.", "لا يوجد نص متاح."));
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
      if (!res.ok) throw new Error(data?.detail || "Summary failed.");
      setSummary(data.summary || "");
      setTab("summary");
    } catch (e) {
      setError(e?.message || "Summary error.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleQuestions = async () => {
    if (!text.trim()) {
      setError(t("No text available.", "لا يوجد نص متاح."));
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
      if (!res.ok) throw new Error(data?.detail || "Questions failed.");
      setQuestions(data.questions || "");
      setTab("questions");
    } catch (e) {
      setError(e?.message || "Questions error.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleFlashcards = async () => {
    if (!text.trim()) {
      setError(t("No text available.", "لا يوجد نص متاح."));
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
      if (!res.ok) throw new Error(data?.detail || "Flashcards failed.");
      setFlashcards(data.flashcards || "");
      setTab("flashcards");
    } catch (e) {
      setError(e?.message || "Flashcards error.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDownload = () => {
    if (!summary && !questions && !flashcards) {
      setError(t("Nothing to download yet.", "لا يوجد شيء للتحميل بعد."));
      return;
    }

    const content =
      `==== SUMMARY ====\n\n${summary || "—"}\n\n` +
      `==== QUESTIONS ====\n\n${questions || "—"}\n\n` +
      `==== FLASHCARDS ====\n\n${flashcards || "—"}\n`;

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = uiLang === "ar" ? "ملف_المذاكرة.txt" : "study_pack.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleClearChat = () => {
    setChatMessages([]);
    setChatInput("");
    setError("");
  };

  const buildHistoryPayload = (msgs) => msgs.slice(-8).map((m) => ({ role: m.role, content: m.content }));

  const handleChatSend = async () => {
    const msg = chatInput.trim();
    if (!msg) return;

    if (selectedDocIds.length === 0) {
      setError(t("Select at least one PDF first.", "اختر ملف PDF واحد على الأقل أولاً."));
      return;
    }
    if (loadingAction === "chat") return;

    const userLang = hasArabic(msg) ? "ar" : "en";

    const userMsg = { role: "user", content: msg, sources: [], lang: userLang };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput("");

    setLoadingAction("chat");
    setIsTyping(true);
    setError("");

    try {
      const payload = {
        doc_ids: selectedDocIds,
        message: msg,
        mode,
        lang: "auto",
        history: buildHistoryPayload([...chatMessages, userMsg]),
      };

      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Chat failed.");

      const answer = data?.answer || "";
      const answerLang = data?.answer_lang || (hasArabic(answer) ? "ar" : "en");

      const botMsg = {
        role: "assistant",
        content: answer,
        sources: data?.sources || [],
        lang: answerLang,
      };

      setChatMessages((prev) => [...prev, botMsg]);
      setTab("chat");
    } catch (e) {
      setError(e?.message || t("Chat error.", "خطأ في الدردشة."));
    } finally {
      setIsTyping(false);
      setLoadingAction(null);
    }
  };

  const ui = {
    title: t("AI Study Assistant", "مساعد الدراسة بالذكاء الاصطناعي"),
    subtitle: t(
      "Upload one or more PDFs, chat with sources + page numbers, and generate study materials.",
      "ارفع ملف/ملفات PDF، اسأل مع مصادر + أرقام الصفحات، وأنشئ ملخص وأسئلة وبطاقات."
    ),
  };

  return (
    <div className="appRoot" dir={uiDir}>
      <div className="bgGlow" />

      <header className="topBar">
        <div className="brand">
          <div className="logoDot" />
          <div>
            <div className="brandTitle">{ui.title}</div>
            <div className="brandSub">{ui.subtitle}</div>
          </div>
        </div>

        <div className="topActions">
          <div className="pillToggle">
            <button className={`pill ${uiLang === "en" ? "active" : ""}`} onClick={() => setUiLang("en")}>
              EN
            </button>
            <button className={`pill ${uiLang === "ar" ? "active" : ""}`} onClick={() => setUiLang("ar")}>
              AR
            </button>
          </div>
          <div className="tinyMeta">
            <div className="metaLine">
              {t("Backend:", "الخلفية:")} <span>{t("FastAPI + Groq", "FastAPI + Groq")}</span>
            </div>
            <div className="metaLine">
              {t("Chat:", "الدردشة:")} <span>{t("Multi-PDF + Sources", "Multi-PDF + مصادر")}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="layout">
        {/* Sidebar */}
        <aside className="side">
          <section className="card">
            <div className="cardHeader">
              <div className="cardTitle">{t("PDF Library", "مكتبة ملفات PDF")}</div>
              <div className="cardHint">{t("Upload then select", "ارفع ثم اختر")}</div>
            </div>

            <div className="uploadRow">
              <label className="filePick">
                <input type="file" accept="application/pdf" onChange={handleFileChange} />
                <span>{file ? file.name : t("Choose PDF", "اختر PDF")}</span>
              </label>

              <button
                className={`btn primary ${isLoading("upload") ? "loading" : ""}`}
                onClick={handleUpload}
                disabled={isLoading("upload")}
              >
                {isLoading("upload") ? t("Uploading…", "جاري الرفع…") : t("Upload & Extract", "رفع واستخراج")}
              </button>
            </div>

            <div className="pdfListWrap">
              {pdfs.length === 0 ? (
                <div className="empty">
                  <div className="emptyTitle">{t("No PDFs yet", "لا يوجد ملفات بعد")}</div>
                  <div className="emptySub">{t("Upload a PDF to start chatting.", "ارفع ملفًا لتبدأ الدردشة.")}</div>
                </div>
              ) : (
                <div className="pdfList">
                  {pdfs.map((p) => {
                    const checked = selectedDocIds.includes(p.doc_id);
                    return (
                      <button
                        key={p.doc_id}
                        className={`pdfItem ${checked ? "checked" : ""}`}
                        onClick={() => toggleSelect(p.doc_id)}
                        title={p.filename}
                      >
                        <div className="checkBox">
                          <div className={`checkDot ${checked ? "on" : ""}`} />
                        </div>
                        <div className="pdfMeta">
                          <div className="pdfName">{p.filename}</div>
                          <div className="pdfSub">
                            {t("Pages:", "الصفحات:")} <span>{p.num_pages ?? "—"}</span>{" "}
                            <span className="sep">•</span> <span className="mono">{p.doc_id.slice(0, 8)}</span>
                          </div>
                        </div>
                        <div className="chip">{checked ? t("Selected", "محدد") : t("Tap", "اضغط")}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="sideActions">
              <button className="btn ghost" onClick={handleClearPdfs}>
                {t("Clear PDFs", "مسح الملفات")}
              </button>
            </div>
          </section>

          <section className="card">
            <div className="cardHeader">
              <div className="cardTitle">{t("Study Settings", "إعدادات الدراسة")}</div>
              <div className="cardHint">{t("Tweak output", "خصص النتائج")}</div>
            </div>

            <div className="formGrid">
              <div className="field">
                <div className="label">{t("Level", "المستوى")}</div>
                <select value={level} onChange={(e) => setLevel(e.target.value)}>
                  <option value="school">{t("School", "مدرسة")}</option>
                  <option value="university">{t("University", "جامعة")}</option>
                  <option value="advanced">{t("Advanced", "متقدم")}</option>
                </select>
              </div>

              <div className="field">
                <div className="label">{t("# Questions", "عدد الأسئلة")}</div>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={numQuestions}
                  onChange={(e) => setNumQuestions(clamp(Number(e.target.value || 5), 1, 20))}
                />
              </div>

              <div className="field">
                <div className="label">{t("# Flashcards", "عدد البطاقات")}</div>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={numCards}
                  onChange={(e) => setNumCards(clamp(Number(e.target.value || 6), 1, 30))}
                />
              </div>

              <div className="field">
                <div className="label">{t("Mode", "الوضع")}</div>
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="strict">{t("Strict (PDF only)", "صارم (من الـ PDF فقط)")}</option>
                  <option value="simple">{t("Simple", "مبسّط")}</option>
                  <option value="exam">{t("Exam-ready", "إجابة امتحانية")}</option>
                </select>
              </div>
            </div>

            <div className="sideActions row">
              <button className={`btn accent ${isLoading("summary") ? "loading" : ""}`} onClick={handleSummarize} disabled={isLoading("summary")}>
                {isLoading("summary") ? t("Working…", "جاري…") : t("Generate Summary", "إنشاء ملخص")}
              </button>
              <button className={`btn violet ${isLoading("questions") ? "loading" : ""}`} onClick={handleQuestions} disabled={isLoading("questions")}>
                {isLoading("questions") ? t("Working…", "جاري…") : t("Generate Questions", "إنشاء أسئلة")}
              </button>
              <button className={`btn orange ${isLoading("flashcards") ? "loading" : ""}`} onClick={handleFlashcards} disabled={isLoading("flashcards")}>
                {isLoading("flashcards") ? t("Working…", "جاري…") : t("Generate Flashcards", "إنشاء بطاقات")}
              </button>
              <button className="btn ghost" onClick={handleDownload}>
                {t("Download Pack", "تحميل ملف المذاكرة")}
              </button>
            </div>
          </section>
        </aside>

        {/* Main */}
        <section className="main">
          <section className="card big">
            <div className="tabs">
              <button className={`tab ${tab === "chat" ? "on" : ""}`} onClick={() => setTab("chat")}>
                {t("Chat", "الدردشة")}
              </button>
              <button className={`tab ${tab === "summary" ? "on" : ""}`} onClick={() => setTab("summary")}>
                {t("Summary", "الملخص")}
              </button>
              <button className={`tab ${tab === "questions" ? "on" : ""}`} onClick={() => setTab("questions")}>
                {t("Questions", "الأسئلة")}
              </button>
              <button className={`tab ${tab === "flashcards" ? "on" : ""}`} onClick={() => setTab("flashcards")}>
                {t("Flashcards", "البطاقات")}
              </button>

              <div className="tabsMeta">
                <span className="miniChip">
                  {t("Selected:", "المحدد:")} {selectedDocIds.length}
                </span>
              </div>
            </div>

            {error && <div className="alert">{error}</div>}

            {tab === "chat" && (
              <div className="chatWrap">
                <div className="chatHeader">
                  <div>
                    <div className="hTitle">{t("Chat with selected PDFs", "الدردشة مع الملفات المحددة")}</div>
                    <div className="hSub">
                      {t(
                        "Ask in Arabic or English — citations stay clean as [S1].",
                        "اسأل بالعربي أو الإنجليزي — الاستشهادات تبقى مرتبة مثل [S1]."
                      )}
                    </div>
                  </div>
                  <button className="btn ghost" onClick={handleClearChat}>
                    {t("Clear chat", "مسح الدردشة")}
                  </button>
                </div>

                <div className="chatBody">
                  {chatMessages.length === 0 ? (
                    <div className="chatEmpty">
                      <div className="chatEmptyTitle">{t("Start with a question…", "ابدأ بسؤال…")}</div>
                      <div className="chatEmptySub">
                        {t(
                          "Example: What is class imbalance? / ما هو عدم توازن الفئات؟",
                          "مثال: What is class imbalance? / ما هو عدم توازن الفئات؟"
                        )}
                      </div>
                    </div>
                  ) : (
                    chatMessages.map((m, idx) => {
                      const mDir = m.lang === "ar" ? "rtl" : "ltr";
                      return (
                        <ChatBubble
                          key={idx}
                          role={m.role}
                          dir={mDir}
                          content={m.content}
                          sources={m.sources || []}
                          uiLang={uiLang}
                        />
                      );
                    })
                  )}

                  {isTyping && (
                    <div className="typingRow">
                      <div className="typingDot" />
                      <div className="typingDot" />
                      <div className="typingDot" />
                      <span className="typingText">{t("Assistant is thinking…", "المساعد يفكر…")}</span>
                    </div>
                  )}

                  <div ref={chatEndRef} />
                </div>

                <div className="chatComposer">
                  <textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder={t(
                      "Ask anything about the selected PDFs… (Enter to send, Shift+Enter new line)",
                      "اسأل أي شيء عن الملفات المحددة… (Enter للإرسال، Shift+Enter لسطر جديد)"
                    )}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleChatSend();
                      }
                    }}
                    disabled={loadingAction === "chat"}
                  />
                  <button
                    className={`btn primary bigBtn ${loadingAction === "chat" ? "loading" : ""}`}
                    onClick={handleChatSend}
                    disabled={loadingAction === "chat"}
                  >
                    {loadingAction === "chat" ? t("Sending…", "جاري الإرسال…") : t("Send", "إرسال")}
                  </button>
                </div>
              </div>
            )}

            {tab !== "chat" && (
              <div className="studyWrap">
                <div className="split">
                  <div className="panel">
                    <div className="panelTitle">{t("Extracted / Input Text", "النص المستخرج / المدخل")}</div>
                    <textarea
                      className="bigText"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={t(
                        "Paste notes here or upload PDFs from the sidebar…",
                        "الصق ملاحظاتك هنا أو ارفع ملفات من الشريط الجانبي…"
                      )}
                    />
                  </div>

                  <div className="panel">
                    <div className="panelTitle">
                      {tab === "summary"
                        ? t("Summary", "الملخص")
                        : tab === "questions"
                        ? t("Questions", "الأسئلة")
                        : t("Flashcards", "البطاقات")}
                    </div>
                    <div className="outputBox" dir={uiLang === "ar" ? "rtl" : "ltr"}>
                      <pre className="bidiSafe">
                        {tab === "summary"
                          ? summary || t("No summary yet.", "لا يوجد ملخص بعد.")
                          : tab === "questions"
                          ? questions || t("No questions yet.", "لا توجد أسئلة بعد.")
                          : flashcards || t("No flashcards yet.", "لا توجد بطاقات بعد.")}
                      </pre>
                    </div>

                    <div className="miniRow">
                      <button className="btn ghost" onClick={() => setTab("chat")}>
                        {t("Back to chat", "العودة للدردشة")}
                      </button>
                      <button className="btn ghost" onClick={handleDownload}>
                        {t("Download Pack", "تحميل ملف المذاكرة")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          <footer className="footer">
            <div className="footNote">
              {t(
                "Pro tip: Upload multiple PDFs then select them to compare concepts.",
                "نصيحة: ارفع عدة ملفات ثم حددها للمقارنة بين المفاهيم."
              )}
            </div>
          </footer>
        </section>
      </main>
    </div>
  );
}

function ChatBubble({ role, content, sources, dir, uiLang }) {
  const [open, setOpen] = useState(false);
  const isUser = role === "user";
  const title = isUser ? (uiLang === "ar" ? "أنت" : "You") : uiLang === "ar" ? "المساعد" : "Assistant";

  const lines = (content || "")
    .split("\n")
    .map((x) => x.trimEnd())
    .filter((x) => x.trim().length > 0);

  const hasSources = Array.isArray(sources) && sources.length > 0;

  const copyText = async (txt) => {
    try {
      await navigator.clipboard.writeText(txt);
    } catch {
      // ignore
    }
  };

  return (
    <div className={`bubbleRow ${isUser ? "user" : "assistant"}`}>
      <div className={`bubble ${isUser ? "user" : "assistant"}`} dir={dir}>
        <div className="bubbleTop">
          <span className="bubbleTitle">{title}</span>
          {!isUser && hasSources && (
            <button className="miniLink" onClick={() => setOpen((v) => !v)}>
              {open
                ? uiLang === "ar"
                  ? "إخفاء المصادر"
                  : "Hide sources"
                : uiLang === "ar"
                ? `عرض المصادر (${sources.length})`
                : `Show sources (${sources.length})`}
            </button>
          )}
        </div>

        <div className="bubbleContent bidiSafe">
          {lines.map((line, idx) => {
            const isBullet = line.trim().startsWith("•") || line.trim().startsWith("- ");
            const isHeading =
              (!isBullet && idx === 0 && line.length <= 60) ||
              line.startsWith("**") ||
              line.endsWith(":");

            return (
              <div key={idx} className={isBullet ? "line bullet" : isHeading ? "line heading" : "line"}>
                {renderWithCitations(line, dir)}
              </div>
            );
          })}
        </div>

        {!isUser && hasSources && open && (
          <div className="sourcesGrid" dir={uiLang === "ar" ? "rtl" : "ltr"}>
            {sources.map((s) => {
              const citation = `${s.id} — Page ${s.page} — ${s.filename}`;
              return (
                <div key={s.id} className="sourceCard">
                  <div className="sourceTop">
                    <span className="badge codeLike" dir="ltr">
                      {s.id}
                    </span>
                    <span className="badge subtle">{uiLang === "ar" ? `صفحة ${s.page}` : `Page ${s.page}`}</span>
                    <span className="badge subtle file" title={s.filename}>
                      {s.filename}
                    </span>
                  </div>
                  <div className="sourceExcerpt bidiSafe">{s.excerpt}</div>
                  <div className="sourceActions">
                    <button className="tinyBtn" onClick={() => copyText(s.excerpt)}>
                      {uiLang === "ar" ? "نسخ المقتطف" : "Copy excerpt"}
                    </button>
                    <button className="tinyBtn" onClick={() => copyText(citation)}>
                      {uiLang === "ar" ? "نسخ الاستشهاد" : "Copy citation"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!isUser && (
          <div className="bubbleFooter">
            <button className="tinyBtn" onClick={() => copyText(content || "")}>
              {uiLang === "ar" ? "نسخ الإجابة" : "Copy answer"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
