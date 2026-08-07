import { useCallback, useEffect, useRef, useState } from "react";
import SkillEditor from "./SkillEditor";
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
  const [skills, setSkills] = useState({ skills: [], load_errors: [] });
  const [mcpServers, setMcpServers] = useState([]);
  const [reloading, setReloading] = useState(null); // "skills" | "mcp" | null
  // Null until a fetch settles. Without this, "the backend is down" renders
  // identically to "you haven't defined any skills yet", which is misleading.
  const [skillsFetchError, setSkillsFetchError] = useState(null);
  const [mcpFetchError, setMcpFetchError] = useState(null);
  // `null` is a valid editor target (it means "create"), so openness needs its
  // own flag rather than being inferred from the slug.
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSlug, setEditorSlug] = useState(null);
  const [busySlug, setBusySlug] = useState(null);      // a row mid-request
  const [confirmSlug, setConfirmSlug] = useState(null); // a delete awaiting its second click

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

  // Skills and MCP servers both live on disk (backend/skills/*.md and
  // backend/mcp_servers.json). Reload makes the backend re-read the files
  // without a restart; skills can additionally be authored from here, since a
  // SKILL.md is inert markdown.
  const loadSkills = useCallback(async (reload = false) => {
    if (reload) setReloading("skills");
    try {
      const res = reload
        ? await authFetch(`${API}/admin/skills/reload`, { method: "POST" })
        : await authFetch(`${API}/admin/skills`);
      setSkills(await res.json());
      setSkillsFetchError(null);
    } catch (err) {
      console.error("Failed to load skills:", err);
      setSkillsFetchError(
        err.status
          ? `Request failed (HTTP ${err.status}).`
          : "Couldn't reach the backend — is it running on port 8000?"
      );
    } finally {
      if (reload) setReloading(null);
    }
  }, [authFetch]);

  const loadMcp = useCallback(async (reload = false) => {
    if (reload) setReloading("mcp");
    try {
      const res = reload
        ? await authFetch(`${API}/admin/mcp-servers/reload`, { method: "POST" })
        : await authFetch(`${API}/admin/mcp-servers`);
      setMcpServers((await res.json()).servers || []);
      setMcpFetchError(null);
    } catch (err) {
      console.error("Failed to load MCP servers:", err);
      setMcpFetchError(
        err.status
          ? `Request failed (HTTP ${err.status}).`
          : "Couldn't reach the backend — is it running on port 8000?"
      );
    } finally {
      if (reload) setReloading(null);
    }
  }, [authFetch]);

  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    loadEmails();
    loadEvents();
    loadSkills();
    loadMcp();
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

  const openEditor = (slug) => {
    setEditorSlug(slug);
    setEditorOpen(true);
    setConfirmSlug(null);
  };

  // Every skill mutation answers with the same payload GET /admin/skills does,
  // so one round-trip both applies the change and refreshes the list.
  const mutateSkill = async (slug, request) => {
    setBusySlug(slug);
    setSkillsFetchError(null);
    try {
      const res = await authFetch(`${API}/admin/skills/${encodeURIComponent(slug)}${request.suffix || ""}`, {
        method: request.method,
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      setSkills(await res.json());
    } catch (err) {
      console.error("Skill update failed:", err);
      setSkillsFetchError(err.message || "Failed to update the skill.");
    } finally {
      setBusySlug(null);
      setConfirmSlug(null);
    }
  };

  const handleToggleSkill = (slug, enabled) =>
    mutateSkill(slug, { method: "PATCH", suffix: "/enabled", body: { enabled } });

  // Two-step in place of window.confirm: a browser modal here would sit on top of
  // the editor modal, and the first click already tells us the intent.
  const handleDeleteSkill = (slug) => {
    if (confirmSlug !== slug) {
      setConfirmSlug(slug);
      return;
    }
    mutateSkill(slug, { method: "DELETE" });
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

        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <h2 style={styles.heading}>Skills</h2>
              <p style={styles.sub}>
                Markdown files in <code style={styles.code}>backend/skills/</code>. Only the
                description is in the system prompt; tBai loads the rest on demand.
              </p>
            </div>
            <div style={styles.headerBtns}>
              <button style={styles.addBtn} onClick={() => openEditor(null)}>
                + New skill
              </button>
              <button
                style={styles.refreshBtn}
                onClick={() => loadSkills(true)}
                disabled={reloading === "skills"}
              >
                {reloading === "skills" ? "Reloading…" : "Reload"}
              </button>
            </div>
          </div>

          {skillsFetchError ? (
            <p style={styles.fetchError}>{skillsFetchError}</p>
          ) : (
            skills.skills.length === 0 &&
            skills.load_errors.length === 0 && (
              <p style={styles.empty}>No skills defined yet.</p>
            )
          )}

          <div style={styles.list}>
            {skills.skills.map((s) => (
              <div
                key={s.slug}
                style={s.enabled ? styles.listItem : { ...styles.listItem, ...styles.disabledRow }}
              >
                <div style={styles.listLeft}>
                  <span style={styles.listEmail}>{s.name}</span>
                  <span style={styles.listName}>{s.description}</span>
                  <span style={styles.neverLogged}>
                    {s.path} · {s.chars.toLocaleString()} chars
                  </span>
                </div>
                <div style={styles.listRight}>
                  {!s.enabled && <span style={badgeStyle(DISABLED_META)}>disabled</span>}
                  {s.truncated && <span style={styles.warnBadge}>truncated</span>}
                  <button style={styles.makeAdminBtn} onClick={() => openEditor(s.slug)}>
                    Edit
                  </button>
                  <button
                    style={styles.makeAdminBtn}
                    onClick={() => handleToggleSkill(s.slug, !s.enabled)}
                    disabled={busySlug === s.slug}
                  >
                    {busySlug === s.slug ? "…" : s.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    style={styles.removeAdminBtn}
                    onClick={() => handleDeleteSkill(s.slug)}
                    onBlur={() => setConfirmSlug((c) => (c === s.slug ? null : c))}
                    disabled={busySlug === s.slug}
                  >
                    {confirmSlug === s.slug ? "Confirm delete?" : "Delete"}
                  </button>
                </div>
              </div>
            ))}
            {skills.load_errors.map((e) => (
              <div key={e.path} style={{ ...styles.listItem, ...styles.errorItem }}>
                <div style={styles.listLeft}>
                  <span style={styles.listEmail}>{e.path}</span>
                  <span style={styles.errorText}>{e.error}</span>
                </div>
                {e.slug && (
                  <div style={styles.listRight}>
                    <button style={styles.makeAdminBtn} onClick={() => openEditor(e.slug)}>
                      Fix
                    </button>
                    <button
                      style={styles.removeAdminBtn}
                      onClick={() => handleDeleteSkill(e.slug)}
                      onBlur={() => setConfirmSlug((c) => (c === e.slug ? null : c))}
                      disabled={busySlug === e.slug}
                    >
                      {confirmSlug === e.slug ? "Confirm delete?" : "Delete"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <h2 style={styles.heading}>MCP Servers</h2>
              <p style={styles.sub}>
                Configured in <code style={styles.code}>backend/mcp_servers.json</code>.
                Reloading restarts every server process.
              </p>
            </div>
            <button
              style={styles.refreshBtn}
              onClick={() => loadMcp(true)}
              disabled={reloading === "mcp"}
            >
              {reloading === "mcp" ? "Reloading…" : "Reload"}
            </button>
          </div>

          {mcpFetchError ? (
            <p style={styles.fetchError}>{mcpFetchError}</p>
          ) : (
            mcpServers.length === 0 && (
              <p style={styles.empty}>
                No MCP servers configured. Copy{" "}
                <code style={styles.code}>mcp_servers.example.json</code> to{" "}
                <code style={styles.code}>mcp_servers.json</code> to add one.
              </p>
            )
          )}

          <div style={styles.list}>
            {mcpServers.map((srv) => (
              <div key={srv.name} style={styles.listItem}>
                <div style={styles.listLeft}>
                  <span style={styles.listEmail}>{srv.name}</span>
                  {srv.error && <span style={styles.errorText}>{srv.error}</span>}
                  {srv.tools.length > 0 && (
                    <span style={styles.listName}>
                      {srv.tools.map((t) => t.name).join(", ")}
                    </span>
                  )}
                  {srv.skipped.length > 0 && (
                    <span style={styles.neverLogged}>
                      {srv.skipped.length} tool{srv.skipped.length === 1 ? "" : "s"} not exposed
                    </span>
                  )}
                </div>
                <div style={styles.listRight}>
                  <span style={mcpBadgeStyle(srv.status)}>{srv.status}</span>
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

      {editorOpen && (
        <SkillEditor
          slug={editorSlug}
          authFetch={authFetch}
          onClose={() => setEditorOpen(false)}
          onSaved={(payload) => { setSkills(payload); setSkillsFetchError(null); }}
        />
      )}
    </div>
  );
}

const DISABLED_META = { bg: "#e5e7eb", color: "#4b5563" };

const EVENT_META = {
  login:             { label: "Logged in",       bg: "#d1fae5", color: "#065f46" },
  login_denied:      { label: "Login denied",     bg: "#fee2e2", color: "#991b1b" },
  session_created:   { label: "New session",      bg: "#dbeafe", color: "#1e40af" },
  session_deleted:   { label: "Session deleted",  bg: "#fef3c7", color: "#92400e" },
  chat:              { label: "Chat message",     bg: "#f3e8ff", color: "#6b21a8" },
  feedback_positive: { label: "👍 Feedback",       bg: "#d1fae5", color: "#065f46" },
  feedback_negative: { label: "👎 Feedback",       bg: "#fee2e2", color: "#991b1b" },
  skill_created:     { label: "Skill created",    bg: "#ccfbf1", color: "#115e59" },
  skill_updated:     { label: "Skill updated",    bg: "#e0e7ff", color: "#3730a3" },
  skill_deleted:     { label: "Skill deleted",    bg: "#fef3c7", color: "#92400e" },
};

function eventLabel(event) {
  return EVENT_META[event]?.label ?? event;
}

function eventBadgeStyle(event) {
  const meta = EVENT_META[event] ?? { bg: "#f3f4f6", color: "#374151" };
  return badgeStyle(meta);
}

const MCP_STATUS_META = {
  connected:  { bg: "#d1fae5", color: "#065f46" },
  connecting: { bg: "#dbeafe", color: "#1e40af" },
  failed:     { bg: "#fee2e2", color: "#991b1b" },
  stopped:    { bg: "#fef3c7", color: "#92400e" },
};

function mcpBadgeStyle(status) {
  return badgeStyle(MCP_STATUS_META[status] ?? { bg: "#f3f4f6", color: "#374151" });
}

function badgeStyle(meta) {
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
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 4,
  },
  headerBtns: {
    display: "flex",
    gap: 8,
    flexShrink: 0,
  },
  disabledRow: {
    opacity: 0.6,
    background: "#f3f4f6",
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
  warnBadge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 12,
    background: "#fef3c7",
    color: "#92400e",
    fontWeight: 600,
    fontSize: 12,
  },
  errorItem: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
  },
  errorText: {
    fontSize: 12,
    color: "#b91c1c",
    overflowWrap: "anywhere",
  },
  fetchError: {
    fontSize: 13,
    color: "#b91c1c",
    margin: 0,
  },
  code: {
    fontFamily: "monospace",
    fontSize: "0.92em",
    background: "#f3f4f6",
    padding: "1px 4px",
    borderRadius: 4,
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
