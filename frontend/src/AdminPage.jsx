import { useCallback, useEffect, useRef, useState } from "react";
import TbaiLogo from "./TbaiLogo";
import useAuthFetch from "./useAuthFetch";

const HEADER_H = 56;
const API = "";

export default function AdminPage({ onBack }) {
  const authFetch = useAuthFetch();
  const [emails, setEmails] = useState([]);
  const [newEmail, setNewEmail] = useState("");
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [activityLog, setActivityLog] = useState([]);
  const [activityPage, setActivityPage] = useState(1);
  const ACTIVITY_PAGE_SIZE = 15;

  const loadEmails = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/admin/allowed-emails`);
      setEmails(await res.json());
    } catch (err) {
      console.error("Failed to load allowed emails:", err);
    }
  }, [authFetch]);

  const loadEvents = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/admin/activity`);
      setActivityLog(await res.json());
      setActivityPage(1);
    } catch (err) {
      console.error("Failed to load activity log:", err);
    }
  }, [authFetch]);

  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    loadEmails();
    loadEvents();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = async () => {
    const email = newEmail.trim();
    if (!email) return;
    setAdding(true);
    setError(null);
    try {
      await authFetch(`${API}/admin/allowed-emails`, {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setNewEmail("");
      await loadEmails();
    } catch (err) {
      setError(err.status === 409 ? "Email already whitelisted." : "Failed to add email.");
    } finally {
      setAdding(false);
    }
  };

  const handleToggleAdmin = async (userId, makeAdmin) => {
    try {
      await authFetch(`${API}/admin/users/${userId}/admin`, {
        method: "PATCH",
        body: JSON.stringify({ is_admin: makeAdmin }),
      });
    } catch (err) {
      console.error("Failed to change admin status:", err);
    }
    await loadEmails();
  };

  const handleRemove = async (email) => {
    try {
      await authFetch(`${API}/admin/allowed-emails/${encodeURIComponent(email)}`, {
        method: "DELETE",
      });
    } catch (err) {
      console.error("Failed to remove email:", err);
    }
    await loadEmails();
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleAdd();
  };

  return (
    <div style={styles.root} className="tbai-vh">
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onBack}>← Back</button>
        <TbaiLogo />
      </div>

      <div style={styles.body}>
        <div style={styles.card}>
          <h2 style={styles.heading}>Allowed Users</h2>
          <p style={styles.sub}>Only users with whitelisted emails can sign in.</p>

          <div style={styles.addRow}>
            <input
              style={styles.input}
              type="email"
              placeholder="user@gmail.com"
              value={newEmail}
              onChange={(e) => { setNewEmail(e.target.value); setError(null); }}
              onKeyDown={handleKeyDown}
              disabled={adding}
            />
            <button style={styles.addBtn} onClick={handleAdd} disabled={adding || !newEmail.trim()}>
              {adding ? "Adding…" : "Add"}
            </button>
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <div style={styles.list}>
            {emails.length === 0 && (
              <p style={styles.empty}>No emails added yet.</p>
            )}
            {emails.map((entry) => (
              <div key={entry.id} style={styles.listItem}>
                <div style={styles.listLeft}>
                  <span style={styles.listEmail}>{entry.email}</span>
                  {entry.display_name && (
                    <span style={styles.listName}>{entry.display_name}</span>
                  )}
                  {!entry.user_id && (
                    <span style={styles.neverLogged}>never logged in</span>
                  )}
                </div>
                <div style={styles.listRight}>
                  {entry.is_admin && (
                    <span style={styles.adminBadge}>
                      {entry.is_env_admin ? "Admin (env)" : "Admin"}
                    </span>
                  )}
                  {entry.user_id && !entry.is_env_admin && (
                    <button
                      style={entry.is_admin ? styles.removeAdminBtn : styles.makeAdminBtn}
                      onClick={() => handleToggleAdmin(entry.user_id, !entry.is_admin)}
                    >
                      {entry.is_admin ? "Remove admin" : "Make admin"}
                    </button>
                  )}
                  <button
                    style={styles.removeBtn}
                    onClick={() => handleRemove(entry.email)}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.eventsCard}>
          <div style={styles.cardHeader}>
            <div>
              <h2 style={styles.heading}>Activity Log</h2>
              <p style={styles.sub}>Last 500 events across all users, newest first.</p>
            </div>
            <button style={styles.refreshBtn} onClick={loadEvents}>Refresh</button>
          </div>
          {activityLog.length === 0 ? (
            <p style={styles.empty}>No activity recorded yet.</p>
          ) : (
            <>
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Time</th>
                      <th style={styles.th}>User</th>
                      <th style={styles.th}>Event</th>
                      <th style={styles.th}>Detail</th>
                      <th style={styles.th}>IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityLog
                      .slice(
                        (activityPage - 1) * ACTIVITY_PAGE_SIZE,
                        activityPage * ACTIVITY_PAGE_SIZE
                      )
                      .map((ev, i) => (
                        <tr key={i} style={i % 2 === 0 ? styles.rowEven : styles.rowOdd}>
                          <td style={{...styles.td, whiteSpace: "nowrap"}}>{new Date(ev.created_at + "Z").toLocaleString()}</td>
                          <td style={styles.td}>
                            <div style={{fontWeight: 500}}>{ev.display_name || ev.email || "—"}</div>
                            {ev.display_name && <div style={{fontSize: 11, color: "#888"}}>{ev.email}</div>}
                          </td>
                          <td style={styles.td}>
                            <span style={eventBadgeStyle(ev.event)}>{eventLabel(ev.event)}</span>
                          </td>
                          <td style={{...styles.td, fontSize: 12, color: "#555", maxWidth: 280}}>
                            <div>
                              {ev.model && <span>model: {ev.model} </span>}
                              {ev.session_id && <span>session #{ev.session_id} </span>}
                              {ev.message_id && <span>msg #{ev.message_id}</span>}
                            </div>
                            {ev.feedback_text && (
                              <div style={{marginTop: 4, color: "#374151", fontStyle: "italic"}}>
                                "{ev.feedback_text}"
                              </div>
                            )}
                          </td>
                          <td style={{...styles.td, fontFamily: "monospace", fontSize: 12, color: "#888"}}>{ev.ip_address || "—"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button
                  style={styles.pageBtn}
                  onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
                  disabled={activityPage === 1}
                >
                  ← Prev
                </button>
                <span style={styles.pageInfo}>
                  Page {activityPage} of {Math.ceil(activityLog.length / ACTIVITY_PAGE_SIZE)}
                </span>
                <button
                  style={styles.pageBtn}
                  onClick={() =>
                    setActivityPage((p) =>
                      Math.min(Math.ceil(activityLog.length / ACTIVITY_PAGE_SIZE), p + 1)
                    )
                  }
                  disabled={activityPage >= Math.ceil(activityLog.length / ACTIVITY_PAGE_SIZE)}
                >
                  Next →
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const EVENT_META = {
  login:             { label: "Logged in",       bg: "#d1fae5", color: "#065f46" },
  login_denied:      { label: "Login denied",     bg: "#fee2e2", color: "#991b1b" },
  session_created:   { label: "New session",      bg: "#dbeafe", color: "#1e40af" },
  session_deleted:   { label: "Session deleted",  bg: "#fef3c7", color: "#92400e" },
  chat:              { label: "Chat message",     bg: "#f3e8ff", color: "#6b21a8" },
  feedback_positive: { label: "👍 Feedback",       bg: "#d1fae5", color: "#065f46" },
  feedback_negative: { label: "👎 Feedback",       bg: "#fee2e2", color: "#991b1b" },
};

function eventLabel(event) {
  return EVENT_META[event]?.label ?? event;
}

function eventBadgeStyle(event) {
  const meta = EVENT_META[event] ?? { bg: "#f3f4f6", color: "#374151" };
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 12,
    background: meta.bg,
    color: meta.color,
    fontWeight: 600,
    fontSize: 12,
    whiteSpace: "nowrap",
  };
}

const styles = {
  root: {
    display: "flex",
    flexDirection: "column",
    fontFamily: "sans-serif",
    overflow: "hidden",
    background: "#f5f5f5",
  },
  header: {
    height: HEADER_H,
    background: "#1e1e2e",
    color: "#cdd6f4",
    display: "flex",
    alignItems: "center",
    padding: "0 16px",
    gap: 16,
    flexShrink: 0,
    borderBottom: "1px solid #313244",
  },
  backBtn: {
    background: "none",
    border: "none",
    color: "#cdd6f4",
    fontSize: 14,
    cursor: "pointer",
    padding: "12px 16px",
    minHeight: 44,
    borderRadius: 6,
    flexShrink: 0,
  },
  body: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "40px 16px",
    gap: 32,
  },
  card: {
    background: "#fff",
    border: "1px solid #ddd",
    borderRadius: 12,
    padding: "clamp(20px, 5vw, 32px) clamp(16px, 5vw, 36px)",
    width: "100%",
    maxWidth: 520,
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  refreshBtn: {
    padding: "12px 16px",
    minHeight: 44,
    background: "#f3f4f6",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    fontSize: 13,
    cursor: "pointer",
    color: "#374151",
    fontWeight: 500,
    flexShrink: 0,
  },
  eventsCard: {
    background: "#fff",
    border: "1px solid #ddd",
    borderRadius: 12,
    padding: "clamp(20px, 5vw, 32px) clamp(16px, 5vw, 36px)",
    width: "100%",
    maxWidth: 900,
  },
  tableWrap: {
    overflowX: "auto",
    marginTop: 16,
    WebkitOverflowScrolling: "touch",
  },
  pagination: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    marginTop: 16,
  },
  pageBtn: {
    padding: "12px 14px",
    minHeight: 44,
    background: "#f3f4f6",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    fontSize: 13,
    cursor: "pointer",
    color: "#374151",
    fontWeight: 500,
  },
  pageInfo: {
    fontSize: 13,
    color: "#555",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    textAlign: "left",
    padding: "8px 12px",
    borderBottom: "2px solid #eee",
    color: "#555",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  td: {
    padding: "8px 12px",
    color: "#333",
    verticalAlign: "middle",
  },
  rowEven: {
    background: "#fff",
  },
  rowOdd: {
    background: "#f9f9f9",
  },
  heading: {
    margin: "0 0 4px",
    fontSize: 20,
    color: "#333",
  },
  sub: {
    margin: "0 0 24px",
    fontSize: 13,
    color: "#888",
  },
  addRow: {
    display: "flex",
    gap: 8,
    marginBottom: 8,
  },
  input: {
    flex: 1,
    padding: "9px 12px",
    border: "1px solid #ccc",
    borderRadius: 8,
    fontSize: 14,
    fontFamily: "inherit",
  },
  addBtn: {
    padding: "12px 18px",
    minHeight: 44,
    background: "#0070f3",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    cursor: "pointer",
    fontWeight: 600,
    flexShrink: 0,
  },
  error: {
    color: "#f38ba8",
    fontSize: 13,
    margin: "0 0 8px",
  },
  list: {
    marginTop: 16,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  empty: {
    color: "#888",
    fontSize: 13,
    margin: 0,
  },
  listItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    rowGap: 8,
    padding: "8px 12px",
    background: "#f9f9f9",
    borderRadius: 8,
    border: "1px solid #eee",
  },
  listLeft: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  },
  listRight: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    rowGap: 6,
    flexShrink: 0,
  },
  listEmail: {
    fontSize: 14,
    color: "#333",
  },
  listName: {
    fontSize: 12,
    color: "#888",
  },
  neverLogged: {
    fontSize: 11,
    color: "#bbb",
    fontStyle: "italic",
  },
  adminBadge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 12,
    background: "#fef9c3",
    color: "#854d0e",
    fontWeight: 600,
    fontSize: 12,
  },
  makeAdminBtn: {
    padding: "11px 14px",
    minHeight: 44,
    background: "none",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: 12,
    cursor: "pointer",
    color: "#374151",
  },
  removeAdminBtn: {
    padding: "11px 14px",
    minHeight: 44,
    background: "none",
    border: "1px solid #fca5a5",
    borderRadius: 6,
    fontSize: 12,
    cursor: "pointer",
    color: "#dc2626",
  },
  removeBtn: {
    background: "none",
    border: "none",
    color: "#aaa",
    fontSize: 20,
    cursor: "pointer",
    lineHeight: 1,
    width: 40,
    height: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    flexShrink: 0,
  },
};
