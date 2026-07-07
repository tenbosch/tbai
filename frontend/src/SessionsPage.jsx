import { useEffect, useMemo, useState } from "react";
import { useTheme } from "./ThemeContext";
import TbaiLogo from "./TbaiLogo";
import ProfileMenu from "./ProfileMenu";
import NotificationsBell from "./NotificationsBell";
import useAuthFetch from "./useAuthFetch";

const HEADER_H = 56;
const PAGE_SIZE = 10;          // chats shown per page
const RETENTION_DAYS = 90;     // keep in sync with backend scheduler RETENTION_DAYS

export default function SessionsPage({ onNavigateAdmin, onNavigateHome, onOpenSession, onNewChat }) {
  const authFetch = useAuthFetch();
  const theme = useTheme();
  const styles = useMemo(() => getStyles(theme), [theme]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(sessions.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);           // clamp after deletes
  const pageSessions = sessions.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch("/sessions");
        const data = await res.json();
        setSessions(data);
      } catch (err) {
        setError("Cannot reach backend. Is it running?");
        console.error("Failed to load sessions:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [authFetch]);

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    try {
      await authFetch(`/sessions/${id}`, { method: "DELETE" });
    } catch (err) {
      console.error("Delete failed:", err);
      return; // keep the card — the server still has the session
    }
    setSessions((prev) => prev.filter((s) => s.id !== id));
  };

  const formatDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso.replace(" ", "T") + "Z");
    const diffDays = Math.floor((Date.now() - d) / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  };

  return (
    <div style={styles.root} className="tbai-vh">
      <div style={styles.header}>
        <button style={styles.logoBtn} onClick={onNavigateHome} title="Home">
          <TbaiLogo style={{ padding: "4px 2px" }} variant={theme.mode === "dark" ? "dark" : "light"} />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <NotificationsBell />
          <ProfileMenu onNavigateAdmin={onNavigateAdmin} />
        </div>
      </div>

      <div style={styles.body}>
        <h1 style={styles.heading}>Your Chats</h1>
        <p style={styles.tagline}>Pick up where you left off, or start something new.</p>

        <button style={styles.newChatBtn} onClick={onNewChat}>
          + New Chat
        </button>

        {error && <div style={styles.errorBanner}>{error}</div>}

        {!loading && !error && sessions.length === 0 && (
          <p style={styles.empty}>No previous chats yet — start a new one above.</p>
        )}

        <div style={styles.list}>
          {pageSessions.map((s) => (
            <div
              key={s.id}
              className="session-card"
              style={styles.card}
              onClick={() => onOpenSession(s.id)}
            >
              <div style={styles.cardTitle}>{s.title}</div>
              <div style={styles.cardMeta}>
                {s.message_count} msg · {formatDate(s.updated_at)}
              </div>
              <button
                className="session-card-delete"
                style={styles.deleteBtn}
                onClick={(e) => handleDelete(e, s.id)}
                title="Delete session"
                aria-label={`Delete chat "${s.title}"`}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {totalPages > 1 && (
          <div style={styles.pager}>
            <button
              style={{ ...styles.pagerBtn, ...(pageSafe <= 1 ? styles.pagerBtnDisabled : {}) }}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pageSafe <= 1}
            >
              ← Prev
            </button>
            <span style={styles.pagerLabel}>
              Page {pageSafe} of {totalPages}
            </span>
            <button
              style={{ ...styles.pagerBtn, ...(pageSafe >= totalPages ? styles.pagerBtnDisabled : {}) }}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={pageSafe >= totalPages}
            >
              Next →
            </button>
          </div>
        )}

        {!loading && !error && sessions.length > 0 && (
          <p style={styles.retentionNote}>
            Chats are automatically deleted after {RETENTION_DAYS} days of inactivity.
          </p>
        )}
      </div>
    </div>
  );
}

function getStyles(theme) {
  const errorBg = theme.mode === "dark" ? "rgba(243,139,168,0.15)" : "#fee2e2";

  return {
    root: {
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      background: theme.bg,
      color: theme.text,
      fontFamily: "sans-serif",
    },
    header: {
      height: HEADER_H,
      background: theme.bg,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 16px",
      flexShrink: 0,
      borderBottom: `1px solid ${theme.border}`,
    },
    logoBtn: {
      background: "none",
      border: "none",
      padding: 0,
      cursor: "pointer",
      lineHeight: 1,
    },
    body: {
      flex: 1,
      overflowY: "auto",
      padding: "clamp(24px, 6vw, 48px) clamp(14px, 4vw, 24px)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      textAlign: "center",
    },
    heading: {
      margin: 0,
      fontSize: 28,
      fontWeight: 700,
      color: theme.text,
    },
    tagline: {
      margin: "8px 0 28px",
      fontSize: 15,
      color: theme.subtext,
    },
    newChatBtn: {
      marginBottom: 36,
      padding: "14px 32px",
      borderRadius: 10,
      border: "none",
      background: theme.accent,
      color: theme.userBubbleText,
      fontSize: 16,
      fontWeight: 700,
      cursor: "pointer",
    },
    errorBanner: {
      background: errorBg,
      border: `1px solid ${theme.error}`,
      borderRadius: 8,
      padding: "10px 14px",
      color: theme.error,
      fontSize: 13,
      marginBottom: 24,
      width: "100%",
      maxWidth: 640,
    },
    empty: {
      color: theme.subtext,
      fontSize: 14,
    },
    list: {
      display: "flex",
      flexDirection: "column",
      gap: 10,
      width: "100%",
      maxWidth: 640,
    },
    card: {
      position: "relative",
      background: theme.surface,
      border: `1px solid ${theme.border}`,
      borderRadius: 10,
      padding: "14px 40px 14px 18px",
      textAlign: "left",
      cursor: "pointer",
    },
    cardTitle: {
      fontWeight: 600,
      fontSize: 14,
      color: theme.text,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    cardMeta: {
      fontSize: 12,
      color: theme.muted,
      marginTop: 4,
    },
    pager: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 14,
      marginTop: 20,
      width: "100%",
      maxWidth: 640,
    },
    pagerBtn: {
      padding: "8px 14px",
      minHeight: 40,
      borderRadius: 8,
      border: `1px solid ${theme.border}`,
      background: theme.surface,
      color: theme.text,
      fontSize: 14,
      fontWeight: 600,
      cursor: "pointer",
    },
    pagerBtnDisabled: {
      opacity: 0.4,
      cursor: "default",
    },
    pagerLabel: {
      fontSize: 13,
      color: theme.subtext,
    },
    retentionNote: {
      marginTop: 24,
      fontSize: 12,
      color: theme.muted,
      textAlign: "center",
    },
    deleteBtn: {
      position: "absolute",
      top: 8,
      right: 8,
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
  };
}
