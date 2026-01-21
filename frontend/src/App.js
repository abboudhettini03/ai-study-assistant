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
      <span key={`${m.index}-${id}`} className="citeBadge" dir="ltr" title="Citation">
        {id}
      </span>
    );
    last = m.index + raw.length;
  }
  const rest = text.slice(last);
  if (rest) parts.push(rest);

  return <span dir={dir}>{parts}</span>;
}

function App() {
  // ====== Language UI
  const [uiLang, setUiLang] = useState("en"); // UI language toggle
  const uiDir = uiLang === "ar" ? "rtl" : "ltr";
  const t = (en, ar) => (uiLang === "ar" ? ar : en);

  // ====== PDFs
  const [file, setFile] = useState(null);
  const [pdfs, setPdfs] = useState([]); // [{doc_id, filename, num_pages, text}]
  const [selectedDocIds, setSelectedDocIds] = useState([]); // multi selection

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
  const [chatMessages, setChatMessages] = useState([]); // [{role, content, sources, lang, pending?}]
  const [isTyping, setIsTyping] = useState(false);

  // ====== UX
  const [tab, setTab] = useState("chat"); // chat | summary | questions | flashcards
  const [loadingAction, setLoadingAction] = useState(null);
  const [error, setError] = useState("");
  const chatEndRef = useRef(null);

  // ====== Toasts
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(1);

  // ====== PDF Preview Modal
  const [preview, setPreview] = useState({
    open: false,
    doc_id: "",
    filename: "",
    page: 1,
  });

  const selectedPdfs = useMemo(
    () => pdfs.filter((p) => selectedDocIds.includes(p.doc_id)),
    [pdfs, selectedDocIds]
  );

  // ====== Toast helpers
  const pushToast = (type, message) => {
    const id = toastIdRef.current++;
    const toast = { id, type, message };
    setToasts((prev) => [toast, ...prev].slice(0, 5));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 3400);
  };

  // ====== Load docs from server
  const refreshDocs = async () => {
    const res = await fetch(`${API_BASE}/docs`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.detail || "Failed to load docs.");
    const items = (data || []).map((d) => ({
      doc_id: d.doc_id,
      filename: d.filename,
      num_pages: d.num_pages,
      text: "", // lazy-load when selected
    }));
    setPdfs(items);
  };

  // initial load
  useEffect(() => {
    const load = async () => {
      try {
        await refreshDocs();
      } catch (e) {
        // keep silent-ish to avoid annoying; you can enable toast if you want
        // pushToast("error", e?.message || "Failed to load library.");
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isTyping, tab]);

  // Keep the big text area synced with selected PDFs
  useEffect(() => {
    if (selectedPdfs.length === 0) {
      // if none selected, do not force-clear user typed text; keep current behavior? (you can uncomment next line)
      // setText("");
      return;
    }
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

  // Select/deselect + lazy-load document text
  const toggleSelect = async (doc_id) => {
    setError("");

    const alreadySelected = selectedDocIds.includes(doc_id);
    const doc = pdfs.find((p) => p.doc_id === doc_id);

    // If selecting and text missing, lazy-load it
    if (!alreadySelected && doc && !doc.text) {
      try {
        const res = await fetch(`${API_BASE}/docs/${doc_id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.detail || "Failed to load doc text.");

        setPdfs((prev) =>
          prev.map((p) =>
            p.doc_id === doc_id
              ? {
                  ...p,
                  text: data.text || "",
                  filename: data.filename || p.filename,
                  num_pages: data.num_pages || p.num_pages,
                }
              : p
          )
        );
      } catch (e) {
        setError(e?.message || t("Failed to load document.", "فشل تحميل الملف."));
        pushToast("error", e?.message || t("Failed to load document.", "فشل تحميل الملف."));
        return;
      }
    }

    setSelectedDocIds((prev) => {
      if (prev.includes(doc_id)) return prev.filter((x) => x !== doc_id);
      return [...prev, doc_id];
    });
  };

  const handleClearPdfs = async () => {
    // This clears local UI state only (does NOT delete server docs)
    setSelectedDocIds([]);
    setText("");
    setSummary("");
    setQuestions("");
    setFlashcards("");
    setChatMessages([]);
    setError("");
    pushToast("info", t("Selection cleared.", "تم مسح التحديد."));
    // If you want to reload from server too:
    try {
      await refreshDocs();
    } catch {
      // ignore
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError(t("Please choose a PDF first.", "اختر ملف PDF أولاً."));
      pushToast("error", t("Choose a PDF first.", "اختر PDF أولاً."));
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

      // refresh library from server (source of truth)
      await refreshDocs();

      // auto-select the uploaded doc
      setSelectedDocIds((prev) => (prev.includes(data.doc_id) ? prev : [data.doc_id, ...prev]));

      setFile(null);
      setChatMessages([]);
      setSummary("");
      setQuestions("");
      setFlashcards("");

      pushToast("success", t("Uploaded & extracted successfully.", "تم الرفع والاستخراج بنجاح."));
    } catch (e) {
      setError(e?.message || "Upload error.");
      pushToast("error", e?.message || t("Upload error.", "خطأ في الرفع."));
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSummarize = async () => {
    if (!text.trim()) {
      setError(t("No text available.", "لا يوجد نص متاح."));
      pushToast("error", t("No text to summarize.", "لا يوجد نص للتلخيص."));
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
      pushToast("success", t("Summary generated.", "تم إنشاء الملخص."));
    } catch (e) {
      setError(e?.message || "Summary error.");
      pushToast("error", e?.message || t("Summary error.", "خطأ في التلخيص."));
    } finally {
      setLoadingAction(null);
    }
  };

  const handleQuestions = async () => {
    if (!text.trim()) {
      setError(t("No text available.", "لا يوجد نص متاح."));
      pushToast("error", t("No text for questions.", "لا يوجد نص للأسئلة."));
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
      pushToast("success", t("Questions generated.", "تم إنشاء الأسئلة."));
    } catch (e) {
      setError(e?.message || "Questions error.");
      pushToast("error", e?.message || t("Questions error.", "خطأ في إنشاء الأسئلة."));
    } finally {
      setLoadingAction(null);
    }
  };

  const handleFlashcards = async () => {
    if (!text.trim()) {
      setError(t("No text available.", "لا يوجد نص متاح."));
      pushToast("error", t("No text for flashcards.", "لا يوجد نص للبطاقات."));
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
      pushToast("success", t("Flashcards generated.", "تم إنشاء البطاقات."));
    } catch (e) {
      setError(e?.message || "Flashcards error.");
      pushToast("error", e?.message || t("Flashcards error.", "خطأ في إنشاء البطاقات."));
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDownload = () => {
    if (!summary && !questions && !flashcards) {
      setError(t("Nothing to download yet.", "لا يوجد شيء للتحميل بعد."));
      pushToast("info", t("Generate something first.", "أنشئ شيئًا أولًا."));
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

    pushToast("success", t("Downloaded.", "تم التحميل."));
  };

  const handleClearChat = () => {
    setChatMessages([]);
    setChatInput("");
    setError("");
    pushToast("info", t("Chat cleared.", "تم مسح الدردشة."));
  };

  const buildHistoryPayload = (msgs) => {
    // keep longer history for better "ChatGPT-like" continuity
    const tail = msgs.slice(-16).map((m) => ({ role: m.role, content: m.content }));
    return tail;
  };

  const openPreview = (source) => {
    // iframe supports #page=
    setPreview({
      open: true,
      doc_id: source.doc_id,
      filename: source.filename || "document.pdf",
      page: source.page || 1,
    });
  };

  const handleChatSend = async () => {
  const msg = chatInput.trim();
  if (!msg) return;

  if (selectedDocIds.length === 0) {
    setError(t("Select at least one PDF first.", "اختر ملف PDF واحد على الأقل أولاً."));
    pushToast("error", t("Select PDFs first.", "اختر ملفات أولاً."));
    return;
  }
  if (loadingAction === "chat") return;

  const userLang = hasArabic(msg) ? "ar" : "en";
  const userMsg = { role: "user", content: msg, sources: [], lang: userLang };

  // add user + pending assistant skeleton bubble
  const pendingBot = {
    role: "assistant",
    content: "",
    sources: [],
    lang: uiLang === "ar" ? "ar" : "en",
    pending: true,
  };

  setChatMessages((prev) => [...prev, userMsg, pendingBot]);
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

    const res = await fetch(`${API_BASE}/chat-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error((txt || "").slice(0, 200) || "Chat failed.");
    }

    if (!res.body) throw new Error("Streaming not supported by the browser.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let buffer = "";
    let accumulated = "";
    let finalAnswerLang = hasArabic(msg) ? "ar" : "en";
    let finalSources = [];

    const updatePending = (partialText, langGuess) => {
      setChatMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i]?.pending) {
            next[i] = { ...next[i], content: partialText, lang: langGuess || next[i].lang };
            break;
          }
        }
        return next;
      });
    };

    const finalize = () => {
      const botMsg = {
        role: "assistant",
        content: accumulated,
        sources: finalSources,
        lang: finalAnswerLang,
        pending: false,
      };

      setChatMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i]?.pending) {
            next[i] = botMsg;
            return next;
          }
        }
        return [...next, botMsg];
      });
    };

    const handleEventBlock = (block) => {
      const lines = block.split("\n");
      let eventName = "message";
      let dataStr = "";

      for (const line of lines) {
        if (line.startsWith("event:")) eventName = line.replace("event:", "").trim();
        if (line.startsWith("data:")) dataStr += line.replace("data:", "").trim();
      }

      if (!dataStr) return;

      let obj = null;
      try {
        obj = JSON.parse(dataStr);
      } catch {
        obj = null;
      }

      if (eventName === "meta") {
        if (obj?.answer_lang) finalAnswerLang = obj.answer_lang;
        return;
      }

      if (eventName === "delta") {
        const part = obj?.text || "";
        accumulated += part;
        updatePending(accumulated, finalAnswerLang);
        return;
      }

      if (eventName === "sources") {
        finalSources = obj?.sources || [];
        return;
      }

      if (eventName === "done") {
        finalize();
        return;
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE blocks separated by blank line
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (block.trim()) handleEventBlock(block);
      }
    }

    // لو انتهى الستريم بدون "done"
    finalize();

    setTab("chat");
    pushToast("success", t("Answer ready.", "تمت الإجابة."));
  } catch (e) {
    setError(e?.message || t("Chat error.", "خطأ في الدردشة."));
    pushToast("error", e?.message || t("Chat error.", "خطأ في الدردشة."));
    setChatMessages((prev) => prev.filter((m) => !m.pending));
  } finally {
    setIsTyping(false);
    setLoadingAction(null);
  }
};


  const handleDeleteDoc = async (doc_id) => {
    const ok = window.confirm(t("Delete this PDF from library?", "حذف هذا الملف من المكتبة؟"));
    if (!ok) return;

    try {
      const res = await fetch(`${API_BASE}/docs/${doc_id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Delete failed.");

      setPdfs((prev) => prev.filter((x) => x.doc_id !== doc_id));
      setSelectedDocIds((prev) => prev.filter((id) => id !== doc_id));

      pushToast("success", t("Deleted.", "تم الحذف."));
    } catch (e) {
      pushToast("error", e?.message || t("Delete error.", "خطأ في الحذف."));
    }
  };

  const brand = {
    name: "StudySpark AI",
    name_ar: "StudySpark AI",
    tag: t("From PDF to mastery — beautifully.", "من PDF إلى الإتقان — بشكل جميل."),
  };

  const showLanding = pdfs.length === 0;

  return (
    <div className="appRoot" dir={uiDir}>
      <div className="bgGlow" />

      {/* Toasts */}
      <div className="toastStack" aria-live="polite" aria-atomic="true">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.type}`}>
            <div className="toastDot" />
            <div className="toastMsg">{x.message}</div>
            <button
              className="toastX"
              onClick={() => setToasts((p) => p.filter((t) => t.id !== x.id))}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* PDF Preview Modal */}
      {preview.open && (
        <div className="modalOverlay" onMouseDown={() => setPreview((p) => ({ ...p, open: false }))}>
          <div className="modalCard" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalTop">
              <div className="modalTitle">
                {t("PDF Preview", "معاينة PDF")}{" "}
                <span className="modalSubtle" dir="ltr">
                  — {preview.filename} — {t("Page", "صفحة")} {preview.page}
                </span>
              </div>
              <div className="modalActions">
                <a
                  className="tinyBtn"
                  href={`${API_BASE}/pdf/${preview.doc_id}#page=${preview.page}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("Open in new tab", "فتح في تبويب")}
                </a>
                <button className="tinyBtn" onClick={() => setPreview((p) => ({ ...p, open: false }))}>
                  {t("Close", "إغلاق")}
                </button>
              </div>
            </div>

            <div className="modalBody">
              <iframe
                title="pdf-preview"
                className="pdfFrame"
                src={`${API_BASE}/pdf/${preview.doc_id}#page=${preview.page}`}
              />
            </div>
          </div>
        </div>
      )}

      <header className="topBar">
        <div className="brand">
          <div className="logoDot" />
          <div>
            <div className="brandTitle">{uiLang === "ar" ? brand.name_ar : brand.name}</div>
            <div className="brandSub">{brand.tag}</div>
          </div>
        </div>

        <div className="topActions">
          <div className="pillToggle">
            <button
              className={`pill ${uiLang === "en" ? "active" : ""}`}
              onClick={() => setUiLang("en")}
            >
              EN
            </button>
            <button
              className={`pill ${uiLang === "ar" ? "active" : ""}`}
              onClick={() => setUiLang("ar")}
            >
              AR
            </button>
          </div>

          <div className="tinyMeta">
            <div className="metaLine">
              {t("Backend:", "الخلفية:")} <span>{t("FastAPI + Groq", "FastAPI + Groq")}</span>
            </div>
            <div className="metaLine">
              {t("Features:", "المميزات:")} <span>{t("Sources + Preview", "مصادر + معاينة")}</span>
            </div>
          </div>
        </div>
      </header>

      {showLanding && (
        <section className="landing">
          <div className="landingHero">
            <div className="heroKicker">{t("Premium Study Experience", "تجربة مذاكرة فخمة")}</div>
            <div className="heroTitle">
              {t(
                "Turn PDFs into clean answers, summaries, and exam material.",
                "حوّل ملفات PDF إلى إجابات مرتبة وملخص وأسئلة امتحانية."
              )}
            </div>
            <div className="heroSub">
              {t(
                "Upload multiple PDFs, ask in Arabic or English, and cite sources with page numbers — instantly.",
                "ارفع عدة ملفات، اسأل بالعربي أو الإنجليزي، واحصل على استشهادات مع أرقام الصفحات فورًا."
              )}
            </div>

            <div className="heroCTA">
              <button
                className="btn primary bigBtn"
                onClick={() =>
                  pushToast("info", t("Start by uploading a PDF from the left panel.", "ابدأ برفع PDF من اللوحة اليسرى."))
                }
              >
                {t("Get Started", "ابدأ الآن")}
              </button>
              <div className="heroMiniNote">
                {t("No accounts yet — just pure productivity.", "بدون حسابات حالياً — إنتاجية مباشرة.")}
              </div>
            </div>
          </div>

          <div className="featureGrid">
            <FeatureCard
              title={t("Chat with sources", "دردشة مع مصادر")}
              sub={t("Citations like [S1] + page numbers.", "استشهادات [S1] + أرقام صفحات.")}
              icon="📌"
            />
            <FeatureCard
              title={t("Multi-PDF", "عدة ملفات")}
              sub={t("Select multiple PDFs and compare concepts.", "حدد عدة ملفات وقارن المفاهيم.")}
              icon="📚"
            />
            <FeatureCard
              title={t("Preview instantly", "معاينة فورية")}
              sub={t("Open the PDF at the cited page.", "افتح الـ PDF على صفحة المصدر.")}
              icon="🔍"
            />
            <FeatureCard
              title={t("Study modes", "أوضاع مذاكرة")}
              sub={t("Strict / Simple / Exam-ready / Chatty.", "صارم / مبسط / امتحاني / محادثة.")}
              icon="⚡"
            />
          </div>
        </section>
      )}

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
              {isLoading("upload") && (
                <div className="pdfList">
                  <SkeletonPdfItem />
                  <SkeletonPdfItem />
                </div>
              )}

              {!isLoading("upload") && pdfs.length === 0 ? (
                <div className="empty">
                  <div className="emptyTitle">{t("No PDFs yet", "لا يوجد ملفات بعد")}</div>
                  <div className="emptySub">{t("Upload a PDF to start chatting.", "ارفع ملفًا لتبدأ الدردشة.")}</div>
                </div>
              ) : (
                !isLoading("upload") && (
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

                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <div className="chip">{checked ? t("Selected", "محدد") : t("Tap", "اضغط")}</div>
                            <button
                              className="tinyBtn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteDoc(p.doc_id);
                              }}
                              title={t("Delete", "حذف")}
                            >
                              {t("Delete", "حذف")}
                            </button>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )
              )}
            </div>

            <div className="sideActions">
              <button className="btn ghost" onClick={handleClearPdfs}>
                {t("Clear Selection", "مسح التحديد")}
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
                  <option value="chatty">{t("Chatty (like ChatGPT)", "محادثة (مثل ChatGPT)")}</option>
                  <option value="simple">{t("Simple", "مبسّط")}</option>
                  <option value="exam">{t("Exam-ready", "إجابة امتحانية")}</option>
                </select>
              </div>
            </div>

            <div className="sideActions row">
              <button
                className={`btn accent ${isLoading("summary") ? "loading" : ""}`}
                onClick={handleSummarize}
                disabled={isLoading("summary")}
              >
                {isLoading("summary") ? t("Working…", "جاري…") : t("Generate Summary", "إنشاء ملخص")}
              </button>

              <button
                className={`btn violet ${isLoading("questions") ? "loading" : ""}`}
                onClick={handleQuestions}
                disabled={isLoading("questions")}
              >
                {isLoading("questions") ? t("Working…", "جاري…") : t("Generate Questions", "إنشاء أسئلة")}
              </button>

              <button
                className={`btn orange ${isLoading("flashcards") ? "loading" : ""}`}
                onClick={handleFlashcards}
                disabled={isLoading("flashcards")}
              >
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

            {/* CHAT TAB */}
            {tab === "chat" && (
              <div className="chatWrap">
                <div className="chatHeader">
                  <div>
                    <div className="hTitle">{t("Chat with selected PDFs", "الدردشة مع الملفات المحددة")}</div>
                    <div className="hSub">
                      {t(
                        "Tip: Ask in Arabic or English — citations stay clean.",
                        "نصيحة: اسأل بالعربي أو الإنجليزي — والاستشهادات ستبقى مرتبة."
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
                      <div className="chatEmptySub">{t("Example: What is class imbalance?", "مثال: ما هو عدم توازن الفئات؟")}</div>
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
                          pending={!!m.pending}
                          onOpenPreview={openPreview}
                        />
                      );
                    })
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

            {/* STUDY TABS */}
            {tab !== "chat" && (
              <div className="studyWrap">
                <div className="split">
                  <div className="panel">
                    <div className="panelTitle">{t("Extracted / Input Text", "النص المستخرج / المدخل")}</div>
                    <textarea
                      className="bigText"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={t("Paste notes here…", "الصق ملاحظاتك هنا…")}
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
                      {(isLoading("summary") && tab === "summary") ||
                      (isLoading("questions") && tab === "questions") ||
                      (isLoading("flashcards") && tab === "flashcards") ? (
                        <div>
                          <SkeletonLine />
                          <SkeletonLine />
                          <SkeletonLine w="78%" />
                          <SkeletonLine w="62%" />
                          <SkeletonLine w="88%" />
                        </div>
                      ) : (
                        <pre>
                          {tab === "summary"
                            ? summary || t("No summary yet.", "لا يوجد ملخص بعد.")
                            : tab === "questions"
                            ? questions || t("No questions yet.", "لا توجد أسئلة بعد.")
                            : flashcards || t("No flashcards yet.", "لا توجد بطاقات بعد.")}
                        </pre>
                      )}
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
              {t("Pro tip: Upload multiple PDFs then select them to compare concepts.", "نصيحة: ارفع عدة ملفات ثم حددها للمقارنة بين المفاهيم.")}
            </div>
          </footer>
        </section>
      </main>
    </div>
  );
}

function FeatureCard({ title, sub, icon }) {
  return (
    <div className="featureCard">
      <div className="featureIcon">{icon}</div>
      <div className="featureTitle">{title}</div>
      <div className="featureSub">{sub}</div>
    </div>
  );
}

function SkeletonPdfItem() {
  return (
    <div className="pdfItem skeletonItem" aria-hidden="true">
      <div className="skBox" />
      <div className="skMeta">
        <div className="skLine" />
        <div className="skLine short" />
      </div>
      <div className="skChip" />
    </div>
  );
}

function SkeletonLine({ w }) {
  return <div className="skLineOut" style={{ width: w || "100%" }} />;
}

function ChatBubble({ role, content, sources, dir, uiLang, pending, onOpenPreview }) {
  const [open, setOpen] = useState(false);
  const isUser = role === "user";
  const title = isUser ? (uiLang === "ar" ? "أنت" : "You") : uiLang === "ar" ? "المساعد" : "Assistant";

  const lines = (content || "").split("\n").filter((x) => x.trim().length > 0);
  const messageLangDir = dir;

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
      <div className={`bubble ${isUser ? "user" : "assistant"}`} dir={messageLangDir}>
        <div className="bubbleTop">
          <span className="bubbleTitle">{title}</span>

          {!isUser && hasSources && !pending && (
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

        <div className="bubbleContent">
          {pending ? (
            <div className="bubbleSkeleton">
              <div className="skLineOut" />
              <div className="skLineOut" style={{ width: "88%" }} />
              <div className="skLineOut" style={{ width: "70%" }} />
            </div>
          ) : (
            lines.map((line, idx) => {
              const isBullet = line.trim().startsWith("•") || line.trim().startsWith("- ");
              const isHeading =
                line.includes("الخلاصة") ||
                line.includes("Summary") ||
                line.includes("المصادر") ||
                line.includes("Sources");
              return (
                <div key={idx} className={`line ${isBullet ? "bullet" : ""} ${isHeading ? "heading" : ""}`}>
                  {renderWithCitations(line, messageLangDir)}
                </div>
              );
            })
          )}
        </div>

        {!isUser && hasSources && open && !pending && (
          <div className="sourcesGrid" dir={uiLang === "ar" ? "rtl" : "ltr"}>
            {sources.map((s) => {
              const citation = `${s.id} — Page ${s.page} — ${s.filename}`;
              return (
                <div key={`${s.id}-${s.doc_id}-${s.page}`} className="sourceCard">
                  <div className="sourceTop">
                    <span className="badge" dir="ltr">
                      {s.id}
                    </span>
                    <span className="badge subtle">{uiLang === "ar" ? `صفحة ${s.page}` : `Page ${s.page}`}</span>
                    <span className="badge subtle file" title={s.filename}>
                      {s.filename}
                    </span>
                  </div>
                  <div className="sourceExcerpt">{s.excerpt}</div>
                  <div className="sourceActions">
                    <button className="tinyBtn" onClick={() => copyText(s.excerpt)}>
                      {uiLang === "ar" ? "نسخ المقتطف" : "Copy excerpt"}
                    </button>
                    <button className="tinyBtn" onClick={() => copyText(citation)}>
                      {uiLang === "ar" ? "نسخ الاستشهاد" : "Copy citation"}
                    </button>
                    <button className="tinyBtn" onClick={() => onOpenPreview(s)}>
                      {uiLang === "ar" ? "فتح الصفحة" : "Open page"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!isUser && !pending && (
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
