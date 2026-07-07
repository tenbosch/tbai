import { memo, useState, useCallback, useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import TbaiLogo from "./TbaiLogo";
import ProfileMenu from "./ProfileMenu";
import NotificationsBell from "./NotificationsBell";
import useAuthFetch from "./useAuthFetch";
import { useAuth } from "./AuthContext";
import { useTheme } from "./ThemeContext";
import { onDesktopCommand, postDesktopState } from "./desktopBridge";

const API = "";
const HEADER_H = 56;
const SIDEBAR_W = 240;
const DEFAULT_MODEL = "gemma4";

// The backend windows history to the newest messages within these budgets before
// sending them to the model (keep in sync with agent_logic.py:16-17). Beyond the
// window the oldest turns are silently dropped, so we warn the user before then.
const MAX_HISTORY_MESSAGES = 40;
const MAX_HISTORY_CHARS = 16000;
const CHARS_PER_TOKEN = 4; // rough char→token estimate for comparing to a model's context length
const WARN_AT = 0.75; // show the "start a new chat" banner at 75% of the effective budget

// Cited-source links must open in a new tab — same-tab navigation loses the chat.
const markdownComponents = {
  a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
};

// Coarse-pointer (touch) devices: Enter is the natural newline key and half-typed
// sends are hostile, so Enter-to-send is desktop-only.
const isCoarsePointer = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

export default function ChatComponent({ onNavigateAdmin, onNavigateHome, initialSessionId }) {
  const authFetch = useAuthFetch();
  const { user } = useAuth();
  const theme = useTheme();
  const styles = useMemo(() => getStyles(theme), [theme]);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(user?.default_model || DEFAULT_MODEL);
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [currentSessionTitle, setCurrentSessionTitle] = useState("New Chat");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [initError, setInitError] = useState(null);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [inputRowHeight, setInputRowHeight] = useState(96);
  const [attachments, setAttachments] = useState([]); // [{id, name, mime, previewUrl}]
  const [isRecording, setIsRecording] = useState(false);
  const [ctxWarnDismissed, setCtxWarnDismissed] = useState(false);
  const bottomRef = useRef(null);
  const inputRowRef = useRef(null);
  const abortRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    // "auto" not "smooth": smooth-scrolling on every streamed token animates
    // continuously and janks, especially on mobile.
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages]);

  // Cancel any in-flight stream when the component unmounts (e.g. nav home).
  useEffect(() => () => abortRef.current?.abort(), []);

  // Model picker choices (local models for everyone, cloud for admins).
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(`${API}/models`);
        const data = await res.json();
        setModels(data);
        // If the saved default is no longer offered, fall back to the first option.
        if (data.length > 0 && !data.some((m) => m.id === (user?.default_model || DEFAULT_MODEL))) {
          setSelectedModel(data[0].id);
        }
      } catch (err) {
        console.error("Failed to load models:", err);
      }
    })();
  }, [authFetch]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectModel = async (id) => {
    setSelectedModel(id);
    try {
      await authFetch("/users/me", {
        method: "PATCH",
        body: JSON.stringify({ default_model: id }),
      });
    } catch (err) {
      console.error("Failed to persist model choice:", err);
    }
  };

  // A fresh conversation starts with a clean slate: re-arm the "getting long" banner.
  useEffect(() => {
    setCtxWarnDismissed(false);
  }, [currentSessionId]);

  // How full is the effective context? Measured against the app's own history
  // window (the real limit on what the model receives), tightened to the selected
  // model's true context length when the backend knows it.
  const contextUsage = useMemo(() => {
    const totalChars = messages.reduce((sum, m) => sum + (m.text ? m.text.length : 0), 0);
    const modelCtxTokens = models.find((m) => m.id === selectedModel)?.context_length;
    const modelCharBudget = modelCtxTokens ? modelCtxTokens * CHARS_PER_TOKEN : Infinity;
    const charBudget = Math.min(MAX_HISTORY_CHARS, modelCharBudget);
    const ratio = Math.max(totalChars / charBudget, messages.length / MAX_HISTORY_MESSAGES);
    return { ratio, modelCtxTokens };
  }, [messages, models, selectedModel]);

  const showCtxWarning = contextUsage.ratio >= WARN_AT && !ctxWarnDismissed;

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Track how much the iOS keyboard has shrunk the visual viewport, so the
  // input row can stay pinned just above it instead of being covered.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardInset(inset);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // Measure the input row's live height so the message list can reserve
  // enough bottom padding for it (it's no longer a normal flex child).
  useEffect(() => {
    if (!inputRowRef.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      setInputRowHeight(entries[0].contentRect.height);
    });
    ro.observe(inputRowRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Session helpers ────────────────────────────────────────────────────────

  const loadSessions = useCallback(async () => {
    const res = await authFetch(`${API}/sessions`);
    const data = await res.json();
    setSessions(data);
    return data;
  }, [authFetch]);

  const loadSession = useCallback(async (id) => {
    const res = await authFetch(`${API}/sessions/${id}`);
    const data = await res.json();
    setCurrentSessionId(data.id);
    setCurrentSessionTitle(data.title);
    setMessages(data.messages);
  }, [authFetch]);

  const createSession = useCallback(async () => {
    const res = await authFetch(`${API}/sessions`, { method: "POST" });
    const session = await res.json();
    setCurrentSessionId(session.id);
    setCurrentSessionTitle(session.title);
    setMessages([]);
    setSessions((prev) => [session, ...prev]);
    return session;
  }, [authFetch]);

  // On mount: open the session the user picked, start a new one, or (fallback)
  // restore the most recent session / create a fresh one. The ref guard keeps
  // StrictMode's double-invoked effect from creating two sessions (a real
  // duplicate POST, not just wasted work).
  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    (async () => {
      try {
        setInitError(null);
        const data = await loadSessions();
        if (initialSessionId === "new") {
          await createSession();
        } else if (initialSessionId != null) {
          await loadSession(initialSessionId);
        } else if (data.length > 0) {
          await loadSession(data[0].id);
        } else {
          await createSession();
        }
      } catch (err) {
        setInitError("Cannot reach backend at " + API + ". Is it running?");
        console.error("Init error:", err);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Event handlers ─────────────────────────────────────────────────────────

  const handleNewSession = useCallback(async () => {
    if (isStreaming) return;
    const session = await createSession();
    setSessions((prev) => {
      const without = prev.filter((s) => s.id !== session.id);
      return [session, ...without];
    });
    if (isMobile) setSidebarOpen(false);
  }, [isStreaming, createSession, isMobile]);

  const handleSelectSession = useCallback(
    async (id) => {
      if (isStreaming || id === currentSessionId) return;
      await loadSession(id);
      if (isMobile) setSidebarOpen(false);
    },
    [isStreaming, currentSessionId, loadSession, isMobile]
  );

  // Desktop toolbar: handle new-chat / set-model commands (this component owns
  // new-chat while mounted, so App defers to it), and keep the toolbar's model
  // dropdown in sync with in-chat changes.
  useEffect(() => {
    return onDesktopCommand((cmd) => {
      if (cmd?.type === "new-chat") handleNewSession();
      else if (cmd?.type === "set-model" && cmd.model) setSelectedModel(cmd.model);
    });
  }, [handleNewSession]);

  useEffect(() => {
    postDesktopState({ models, currentModel: selectedModel });
  }, [models, selectedModel]);

  const handleDeleteSession = useCallback(
    async (e, id) => {
      e.stopPropagation();
      if (isStreaming) return;
      try {
        await authFetch(`${API}/sessions/${id}`, { method: "DELETE" });
      } catch (err) {
        console.error("Delete failed:", err);
        return; // keep the session in the list — the server still has it
      }
      const remaining = sessions.filter((s) => s.id !== id);
      setSessions(remaining);
      if (id === currentSessionId) {
        if (remaining.length > 0) {
          await loadSession(remaining[0].id);
        } else {
          await createSession();
        }
      }
    },
    [isStreaming, sessions, currentSessionId, authFetch, loadSession, createSession]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ── Attachments (images for vision, text files as context) ────────────────

  const handlePickFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // allow re-selecting the same file
    for (const file of files.slice(0, 4 - attachments.length)) {
      const form = new FormData();
      form.append("file", file);
      try {
        const res = await authFetch(`${API}/uploads`, { method: "POST", body: form });
        const meta = await res.json();
        setAttachments((prev) => [
          ...prev,
          {
            id: meta.id,
            name: file.name,
            mime: meta.mime,
            previewUrl: meta.mime.startsWith("image/") ? URL.createObjectURL(file) : null,
          },
        ]);
      } catch (err) {
        console.error("Upload failed:", err);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: "", error: `Upload of "${file.name}" failed: ${err.message}` },
        ]);
      }
    }
  };

  const removeAttachment = (id) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  };

  // ── Voice input (browser Web Speech API — Chrome/Brave) ───────────────────

  const speechSupported =
    typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const transcript = Array.from(e.results)
        .slice(e.resultIndex)
        .map((r) => r[0].transcript)
        .join(" ");
      setInput((prev) => (prev ? prev + " " : "") + transcript.trim());
    };
    rec.onend = () => setIsRecording(false);
    rec.onerror = () => setIsRecording(false);
    recognitionRef.current = rec;
    rec.start();
    setIsRecording(true);
  };

  const handleSendMessage = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || isStreaming || !currentSessionId) return;

    const sentAttachments = attachments;
    setMessages((prev) => [
      ...prev,
      { role: "user", text: prompt, attachments: sentAttachments },
      { role: "assistant", text: "", status: null, error: null },
    ]);
    setInput("");
    setAttachments([]);
    setIsStreaming(true);

    // Optimistically update title on first message
    if (currentSessionTitle === "New Chat") {
      const newTitle = prompt.slice(0, 60);
      setCurrentSessionTitle(newTitle);
      setSessions((prev) =>
        prev.map((s) => (s.id === currentSessionId ? { ...s, title: newTitle } : s))
      );
    }

    const updateLast = (fn) =>
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = fn(updated[updated.length - 1]);
        return updated;
      });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await authFetch(`${API}/chat`, {
        method: "POST",
        body: JSON.stringify({
          model: selectedModel,
          prompt,
          session_id: currentSessionId,
          attachment_ids: sentAttachments.map((a) => a.id),
        }),
        signal: controller.signal,
      });

      // NDJSON stream: one JSON event per line (token/status/sources/error/done).
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep any partial trailing line for the next chunk
        for (const line of lines) {
          if (!line.trim()) continue;
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event.type === "token") {
            updateLast((m) => ({ ...m, text: m.text + event.text, status: null }));
          } else if (event.type === "status") {
            updateLast((m) => ({ ...m, status: event.text }));
          } else if (event.type === "sources") {
            updateLast((m) => ({ ...m, text: m.text + renderSourcesMarkdown(event.items) }));
          } else if (event.type === "error") {
            updateLast((m) => ({ ...m, status: null, error: event.text }));
          } else if (event.type === "done") {
            // Real DB id arrives in-stream — no session refetch needed for feedback.
            updateLast((m) => ({ ...m, id: event.message_id, status: null }));
          }
        }
      }
    } catch (err) {
      if (err.name === "AbortError") {
        updateLast((m) => ({ ...m, status: null })); // partial text stays; backend saved it
      } else {
        console.error("Stream error:", err);
        updateLast((m) => ({ ...m, status: null, error: err.message || "Error connecting to backend" }));
      }
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
      // Bump this session locally instead of two refetch round-trips per message.
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      setSessions((prev) => {
        const current = prev.find((s) => s.id === currentSessionId);
        if (!current) return prev;
        const bumped = {
          ...current,
          message_count: (current.message_count ?? 0) + 2,
          updated_at: now,
        };
        return [bumped, ...prev.filter((s) => s.id !== currentSessionId)];
      });
    }
  }, [input, isStreaming, currentSessionId, currentSessionTitle, authFetch, selectedModel, attachments]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !isCoarsePointer()) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  const formatDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso.replace(" ", "T") + "Z");
    const diffDays = Math.floor((Date.now() - d) / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const sidebarContent = (
    <>
      <button style={styles.newChatBtn} onClick={handleNewSession} disabled={isStreaming}>
        + New Chat
      </button>
      <div style={styles.sessionList}>
        {sessions.map((s) => (
          <div
            key={s.id}
            className="session-item"
            style={{
              ...styles.sessionItem,
              ...(s.id === currentSessionId ? styles.sessionItemActive : {}),
            }}
            onClick={() => handleSelectSession(s.id)}
          >
            <div style={styles.sessionTitle}>{s.title}</div>
            <div style={styles.sessionMeta}>
              {s.message_count} msg · {formatDate(s.updated_at)}
            </div>
            <button
              className="session-delete"
              style={styles.deleteBtn}
              onClick={(e) => handleDeleteSession(e, s.id)}
              title="Delete session"
              aria-label={`Delete chat "${s.title}"`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );

  return (
    <div style={styles.root} className="tbai-vh">
      {/* ── Header ── */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          {isMobile && (
            <button
              style={styles.hamburger}
              onClick={() => setSidebarOpen((o) => !o)}
              aria-label="Toggle chat list"
              aria-expanded={sidebarOpen}
            >
              ☰
            </button>
          )}
          <button style={styles.logoBtn} onClick={onNavigateHome} title="Home">
            <TbaiLogo style={{ padding: "4px 2px" }} />
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {models.length > 1 && (
            <select
              style={styles.modelPicker}
              value={selectedModel}
              onChange={(e) => handleSelectModel(e.target.value)}
              disabled={isStreaming}
              aria-label="Model"
              title="Choose which AI model answers"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.kind === "cloud" ? `☁️ ${m.id}` : m.id}
                </option>
              ))}
            </select>
          )}
          <NotificationsBell />
          <ProfileMenu onNavigateAdmin={onNavigateAdmin} />
        </div>
      </div>

      {/* ── Body ── */}
      <div style={styles.body}>
        {/* Mobile backdrop */}
        {isMobile && sidebarOpen && (
          <div style={styles.backdrop} onClick={() => setSidebarOpen(false)} />
        )}

        {/* Sidebar — static on desktop, drawer overlay on mobile */}
        {(!isMobile || sidebarOpen) && (
          <div style={isMobile ? styles.sidebarDrawer : styles.sidebar}>
            {sidebarContent}
          </div>
        )}

        {/* Chat area */}
        <div style={styles.chatArea}>
          {initError && <div style={styles.errorBanner}>{initError}</div>}
          <h2 style={styles.title}>{currentSessionTitle}</h2>

          <div style={{ ...styles.messageList, paddingBottom: inputRowHeight }}>
            {messages.map((msg, i) => (
              <MessageBubble
                key={msg.id != null ? `m-${msg.id}` : `draft-${i}`}
                msg={msg}
                isStreamingThis={isStreaming && i === messages.length - 1}
                styles={styles}
                authFetch={authFetch}
              />
            ))}
            <div ref={bottomRef} />
          </div>

          <div
            ref={inputRowRef}
            style={{
              ...styles.inputRow,
              bottom: keyboardInset,
              left: isMobile ? 0 : SIDEBAR_W,
              flexWrap: "wrap",
            }}
          >
            {showCtxWarning && (
              <div style={styles.contextWarning} role="status" aria-live="polite">
                <span style={styles.contextWarningText}>
                  💡 This chat is getting long — the assistant only keeps the most recent
                  {" "}~{MAX_HISTORY_MESSAGES} messages
                  {contextUsage.modelCtxTokens
                    ? `, and ${selectedModel} can hold about ${Math.round(
                        contextUsage.modelCtxTokens / 1000
                      )}k tokens`
                    : ""}
                  . Starting a fresh chat will give you the best answers.
                </span>
                <button style={styles.contextWarningNewBtn} onClick={handleNewSession}>
                  + New Chat
                </button>
                <button
                  style={styles.contextWarningDismiss}
                  onClick={() => setCtxWarnDismissed(true)}
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
            )}
            {attachments.length > 0 && (
              <div style={styles.attachmentChips}>
                {attachments.map((a) => (
                  <span key={a.id} style={styles.attachmentChip}>
                    {a.previewUrl ? (
                      <img src={a.previewUrl} alt={a.name} style={styles.attachmentThumb} />
                    ) : (
                      "📄"
                    )}
                    <span style={styles.attachmentName}>{a.name}</span>
                    <button
                      style={styles.attachmentRemove}
                      onClick={() => removeAttachment(a.id)}
                      aria-label={`Remove attachment ${a.name}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,text/plain,text/markdown,text/csv,.md,.txt,.csv"
              multiple
              style={{ display: "none" }}
              onChange={handlePickFiles}
            />
            <button
              style={styles.iconBtn}
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming || !currentSessionId || attachments.length >= 4}
              aria-label="Attach a file"
              title="Attach an image or text file"
            >
              📎
            </button>
            {speechSupported && (
              <button
                style={{ ...styles.iconBtn, ...(isRecording ? styles.iconBtnActive : {}) }}
                onClick={toggleRecording}
                disabled={isStreaming || !currentSessionId}
                aria-label={isRecording ? "Stop dictation" : "Start dictation"}
                title={isRecording ? "Stop dictation" : "Dictate a message"}
              >
                {isRecording ? "🔴" : "🎙️"}
              </button>
            )}
            <textarea
              style={{ ...styles.textarea, resize: isMobile ? "none" : "vertical" }}
              rows={3}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="Message"
              placeholder={
                currentSessionId ? "Type a message… (Enter to send)" : "Connecting to backend…"
              }
              disabled={isStreaming || !currentSessionId}
            />
            <button
              style={styles.button}
              onClick={isStreaming ? handleStop : handleSendMessage}
              disabled={!isStreaming && (!input.trim() || !currentSessionId)}
              aria-label={isStreaming ? "Stop generating" : "Send message"}
            >
              {isStreaming ? "◼ Stop" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Must render identically to the backend's _render_sources_markdown so a live
// stream and a reloaded session show the same thing.
function renderSourcesMarkdown(items) {
  if (!items?.length) return "";
  return (
    "\n\n---\n**Sources:**\n" + items.map((s) => `- [${s.title}](${s.url})`).join("\n") + "\n"
  );
}

// Memoized so ReactMarkdown only re-parses the actively streaming message —
// settled messages keep their object identity and skip re-render entirely.
const MessageBubble = memo(function MessageBubble({ msg, isStreamingThis, styles, authFetch }) {
  const [speaking, setSpeaking] = useState(false);
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

  const toggleSpeak = () => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    // Strip the most common markdown noise so it reads naturally.
    const plain = msg.text
      .replace(/```[\s\S]*?```/g, " code block omitted ")
      .replace(/[*_#>`|-]/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    const utterance = new SpeechSynthesisUtterance(plain);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };

  return (
    <div style={msg.role === "user" ? styles.userBubble : styles.assistantBubble}>
      <strong>{msg.role === "user" ? "You" : "Assistant"}:</strong>
      {msg.role === "user" ? (
        <>
          <span> {msg.text}</span>
          {msg.attachments?.length > 0 && (
            <div style={styles.bubbleAttachments}>
              {msg.attachments.map((a) =>
                a.previewUrl ? (
                  <img key={a.id} src={a.previewUrl} alt={a.name} style={styles.bubbleImage} />
                ) : (
                  <span key={a.id} style={styles.bubbleFileTag}>📄 {a.name}</span>
                )
              )}
            </div>
          )}
        </>
      ) : (
        <div style={styles.markdown} className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {msg.text}
          </ReactMarkdown>
          {msg.status && (
            <div style={styles.statusChip} aria-live="polite" role="status">
              🔍 <em>{msg.status}</em>
            </div>
          )}
          {msg.error && <div style={styles.bubbleError}>⚠️ {msg.error}</div>}
          {isStreamingThis && !msg.status && <span style={styles.cursor}>▍</span>}
        </div>
      )}
      {msg.role === "assistant" && msg.id != null && !isStreamingThis && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <FeedbackButtons messageId={msg.id} authFetch={authFetch} styles={styles} />
          {canSpeak && msg.text && (
            <button
              style={styles.feedbackIconBtn}
              onClick={toggleSpeak}
              title={speaking ? "Stop reading" : "Read aloud"}
              aria-label={speaking ? "Stop reading aloud" : "Read this reply aloud"}
            >
              {speaking ? "⏹️" : "🔊"}
            </button>
          )}
        </div>
      )}
    </div>
  );
});

function FeedbackButtons({ messageId, authFetch, styles }) {
  const [phase, setPhase] = useState("idle"); // idle | awaiting_down_text | sending | submitted
  const [vote, setVote] = useState(null); // "up" | "down"
  const [text, setText] = useState("");

  const sendFeedback = async (rating, feedbackText) => {
    setPhase("sending");
    try {
      const res = await authFetch(`${API}/messages/${messageId}/feedback`, {
        method: "POST",
        body: JSON.stringify({ rating, text: feedbackText || undefined }),
      });
      if (!res.ok) throw new Error(`Feedback request failed: ${res.status}`);
      setVote(rating);
      setPhase("submitted");
    } catch (err) {
      console.error("Feedback error:", err);
      setPhase(rating === "down" ? "awaiting_down_text" : "idle");
    }
  };

  const handleUp = () => sendFeedback("up");
  const handleDownClick = () => setPhase("awaiting_down_text");
  const handleDownSubmit = () => sendFeedback("down", text.trim());
  const handleDownCancel = () => {
    setPhase("idle");
    setText("");
  };

  if (phase === "submitted") {
    return (
      <div style={styles.feedbackRow}>
        <span style={styles.feedbackThanks}>
          {vote === "up" ? "👍" : "👎"} Thanks for the feedback
        </span>
      </div>
    );
  }

  if (phase === "awaiting_down_text" || phase === "sending") {
    return (
      <div style={styles.feedbackRow}>
        <div style={styles.feedbackBox}>
          <textarea
            style={styles.feedbackTextarea}
            rows={2}
            placeholder="What could be better? (optional)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={phase === "sending"}
          />
          <div style={styles.feedbackBoxActions}>
            <button
              style={styles.feedbackCancelBtn}
              onClick={handleDownCancel}
              disabled={phase === "sending"}
            >
              Cancel
            </button>
            <button
              style={styles.feedbackSubmitBtn}
              onClick={handleDownSubmit}
              disabled={phase === "sending"}
            >
              {phase === "sending" ? "Sending…" : "Submit"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.feedbackRow}>
      <button style={styles.feedbackIconBtn} onClick={handleUp} title="Good response">
        👍
      </button>
      <button style={styles.feedbackIconBtn} onClick={handleDownClick} title="Bad response">
        👎
      </button>
    </div>
  );
}

function getStyles(theme) {
  const errorBg = theme.mode === "dark" ? "rgba(243,139,168,0.15)" : "#fee2e2";
  // Warm/amber notice — advisory, not an error, so it reads distinctly from errorBanner.
  const warnColor = theme.mode === "dark" ? "#f9e2af" : "#a16207";
  const warnBg = theme.mode === "dark" ? "rgba(249,226,175,0.12)" : "#fefce8";
  const warnBorder = theme.mode === "dark" ? "rgba(249,226,175,0.4)" : "#fde68a";

  return {
    root: {
      display: "flex",
      flexDirection: "column",
      fontFamily: "sans-serif",
      overflow: "hidden",
      background: theme.bg,
      color: theme.text,
    },

    // Header
    header: {
      height: HEADER_H,
      background: theme.bg,
      color: theme.text,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 16px",
      gap: 12,
      flexShrink: 0,
      borderBottom: `1px solid ${theme.border}`,
    },
    headerLeft: {
      display: "flex",
      alignItems: "center",
      gap: 12,
    },
    hamburger: {
      background: "none",
      border: "none",
      color: theme.text,
      fontSize: 22,
      cursor: "pointer",
      minWidth: 44,
      minHeight: 44,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      lineHeight: 1,
    },
    logoBtn: {
      background: "none",
      border: "none",
      padding: "10px 6px",
      cursor: "pointer",
      lineHeight: 1,
    },

    // Body
    body: {
      display: "flex",
      flex: 1,
      overflow: "hidden",
      position: "relative",
    },

    // Mobile overlay backdrop (sits below header)
    backdrop: {
      position: "fixed",
      top: HEADER_H,
      bottom: 0,
      left: 0,
      right: 0,
      background: "rgba(0,0,0,0.45)",
      zIndex: 199,
    },

    // Sidebar — desktop (static left panel)
    sidebar: {
      width: SIDEBAR_W,
      minWidth: SIDEBAR_W,
      background: theme.bg,
      color: theme.text,
      display: "flex",
      flexDirection: "column",
      padding: "12px 8px",
      gap: 8,
      overflow: "hidden",
    },

    // Sidebar — mobile (fixed drawer below header)
    sidebarDrawer: {
      position: "fixed",
      top: HEADER_H,
      bottom: 0,
      left: 0,
      width: 260,
      background: theme.bg,
      color: theme.text,
      display: "flex",
      flexDirection: "column",
      padding: "12px 8px",
      gap: 8,
      overflow: "hidden",
      zIndex: 200,
    },

    newChatBtn: {
      background: theme.overlay,
      color: theme.text,
      border: `1px solid ${theme.overlay2}`,
      borderRadius: 8,
      padding: "13px 12px",
      minHeight: 44,
      cursor: "pointer",
      fontWeight: "bold",
      fontSize: 14,
      textAlign: "left",
      flexShrink: 0,
    },
    sessionList: {
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      gap: 2,
      flex: 1,
    },
    sessionItem: {
      padding: "8px 10px",
      borderRadius: 6,
      cursor: "pointer",
      position: "relative",
    },
    sessionItemActive: {
      background: theme.overlay,
    },
    sessionTitle: {
      fontSize: 13,
      fontWeight: 500,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      paddingRight: 22,
      color: theme.text,
    },
    sessionMeta: {
      fontSize: 11,
      color: theme.muted,
      marginTop: 2,
    },
    deleteBtn: {
      position: "absolute",
      top: 4,
      right: 2,
      width: 32,
      height: 32,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "none",
      border: "none",
      color: theme.muted,
      cursor: "pointer",
      fontSize: 20,
      lineHeight: 1,
      padding: 0,
      opacity: 0,
      transition: "opacity 0.1s",
    },

    errorBanner: {
      background: errorBg,
      border: `1px solid ${theme.error}`,
      borderRadius: 8,
      padding: "10px 14px",
      color: theme.error,
      fontSize: 13,
      flexShrink: 0,
    },
    contextWarning: {
      flexBasis: "100%",
      display: "flex",
      alignItems: "center",
      gap: 8,
      background: warnBg,
      border: `1px solid ${warnBorder}`,
      borderRadius: 8,
      padding: "8px 12px",
      color: warnColor,
      fontSize: 13,
    },
    contextWarningText: {
      flex: 1,
      lineHeight: 1.4,
    },
    contextWarningNewBtn: {
      flexShrink: 0,
      background: "transparent",
      border: `1px solid ${warnColor}`,
      borderRadius: 6,
      padding: "4px 10px",
      color: warnColor,
      fontSize: 12,
      fontWeight: 600,
      cursor: "pointer",
      whiteSpace: "nowrap",
    },
    contextWarningDismiss: {
      flexShrink: 0,
      background: "transparent",
      border: "none",
      color: warnColor,
      fontSize: 18,
      lineHeight: 1,
      cursor: "pointer",
      padding: "0 2px",
    },

    // Chat area
    chatArea: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      padding: "16px 16px",
      gap: 16,
      overflow: "hidden",
      minWidth: 0,
      background: theme.bg,
    },
    title: {
      textAlign: "center",
      margin: 0,
      fontSize: 18,
      color: theme.text,
      flexShrink: 0,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    messageList: {
      flex: 1,
      border: `1px solid ${theme.border}`,
      borderRadius: 8,
      padding: 16,
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      gap: 12,
      background: theme.surfaceAlt,
      color: theme.text,
    },
    userBubble: {
      alignSelf: "flex-end",
      background: theme.userBubble,
      color: theme.userBubbleText,
      padding: "8px 12px",
      borderRadius: 12,
      maxWidth: "80%",
      whiteSpace: "pre-wrap",
    },
    assistantBubble: {
      alignSelf: "flex-start",
      background: theme.assistantBubble,
      border: `1px solid ${theme.border}`,
      padding: "8px 12px",
      borderRadius: 12,
      maxWidth: "80%",
    },
    markdown: { lineHeight: 1.6 },
    cursor: { animation: "blink 1s step-end infinite" },
    iconBtn: {
      background: "none",
      border: `1px solid ${theme.border}`,
      borderRadius: 8,
      minWidth: 44,
      minHeight: 44,
      fontSize: 18,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    iconBtnActive: {
      border: `1px solid ${theme.error}`,
      background: theme.mode === "dark" ? "rgba(243,139,168,0.15)" : "#fee2e2",
    },
    attachmentChips: {
      width: "100%",
      display: "flex",
      gap: 8,
      flexWrap: "wrap",
      marginBottom: 6,
    },
    attachmentChip: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "4px 8px",
      borderRadius: 8,
      background: theme.overlay,
      border: `1px solid ${theme.border}`,
      fontSize: 12,
      color: theme.text,
    },
    attachmentThumb: {
      width: 28,
      height: 28,
      objectFit: "cover",
      borderRadius: 4,
    },
    attachmentName: {
      maxWidth: 140,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    attachmentRemove: {
      background: "none",
      border: "none",
      color: theme.muted,
      fontSize: 16,
      lineHeight: 1,
      cursor: "pointer",
      padding: "0 2px",
    },
    bubbleAttachments: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap",
      marginTop: 8,
    },
    bubbleImage: {
      maxWidth: 220,
      maxHeight: 220,
      borderRadius: 8,
      display: "block",
    },
    bubbleFileTag: {
      fontSize: 12,
      padding: "4px 8px",
      borderRadius: 8,
      background: "rgba(0,0,0,0.15)",
    },
    modelPicker: {
      maxWidth: "min(180px, 34vw)",
      minWidth: 0,
      padding: "8px 10px",
      borderRadius: 8,
      border: `1px solid ${theme.border}`,
      background: theme.surface,
      color: theme.text,
      fontSize: 13,
      fontFamily: "inherit",
      cursor: "pointer",
    },
    statusChip: {
      marginTop: 6,
      fontSize: 13,
      color: theme.muted,
    },
    bubbleError: {
      marginTop: 6,
      padding: "8px 12px",
      background: errorBg,
      border: `1px solid ${theme.error}`,
      borderRadius: 8,
      color: theme.error,
      fontSize: 13,
    },
    feedbackRow: {
      marginTop: 6,
      display: "flex",
      gap: 6,
    },
    feedbackIconBtn: {
      background: "none",
      border: `1px solid ${theme.border}`,
      borderRadius: 6,
      minWidth: 44,
      minHeight: 44,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 16,
      cursor: "pointer",
      color: theme.text,
    },
    feedbackThanks: {
      fontSize: 12,
      color: theme.muted,
    },
    feedbackBox: {
      display: "flex",
      flexDirection: "column",
      gap: 6,
      width: "100%",
      maxWidth: 320,
    },
    feedbackTextarea: {
      padding: 8,
      borderRadius: 6,
      border: `1px solid ${theme.border}`,
      resize: "vertical",
      fontFamily: "inherit",
      fontSize: 13,
      background: theme.surface,
      color: theme.text,
    },
    feedbackBoxActions: {
      display: "flex",
      justifyContent: "flex-end",
      gap: 6,
    },
    feedbackCancelBtn: {
      padding: "12px 14px",
      minHeight: 44,
      background: "none",
      border: `1px solid ${theme.border}`,
      borderRadius: 6,
      fontSize: 12,
      cursor: "pointer",
      color: theme.text,
    },
    feedbackSubmitBtn: {
      padding: "12px 14px",
      minHeight: 44,
      background: theme.accent,
      border: "none",
      borderRadius: 6,
      fontSize: 12,
      cursor: "pointer",
      color: theme.userBubbleText,
      fontWeight: 600,
    },
    inputRow: {
      position: "fixed",
      right: 0,
      display: "flex",
      gap: 8,
      flexShrink: 0,
      padding: "8px 16px",
      paddingBottom: "calc(8px + env(safe-area-inset-bottom))",
      background: theme.bg,
      borderTop: `1px solid ${theme.border}`,
      zIndex: 150,
    },
    textarea: {
      flex: 1,
      padding: 10,
      borderRadius: 8,
      border: `1px solid ${theme.border}`,
      resize: "vertical",
      minHeight: 60,
      fontFamily: "inherit",
      fontSize: 14,
      background: theme.surface,
      color: theme.text,
    },
    button: {
      padding: "13px 20px",
      minHeight: 44,
      borderRadius: 8,
      border: "none",
      background: theme.accent,
      color: theme.userBubbleText,
      cursor: "pointer",
      fontWeight: "bold",
      alignSelf: "flex-end",
    },
  };
}
