import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

// Mirrors backend/skills.py — MAX_NAME_LEN, MAX_DESCRIPTION_LEN, MAX_SKILL_CHARS.
// The backend re-checks all three; these only drive the counters and the
// disabled Save button, so a mismatch degrades to a 400 rather than corruption.
const MAX_NAME = 64;
const MAX_DESCRIPTION = 200;
const MAX_BODY = 8000;

const BLANK = { name: "", description: "", body: "", enabled: true, error: null };

/**
 * Create/edit modal for one markdown skill.
 *
 * `slug === null` means "create". Otherwise the current file is fetched from
 * GET /admin/skills/{slug} — never from the list payload, because the body there
 * is already truncated to MAX_BODY and saving it back would eat the tail.
 *
 * On success `onSaved` receives the refreshed skills payload, so AdminPage can
 * update its list without a second round-trip.
 */
export default function SkillEditor({ slug, onClose, onSaved, authFetch }) {
  const isNew = slug === null;
  const [form, setForm] = useState(BLANK);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null); // the file's own parse error, if any
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`/admin/skills/${encodeURIComponent(slug)}`);
        const data = await res.json();
        if (cancelled) return;
        setForm({
          name: data.name || "",
          description: data.description || "",
          body: data.body || "",
          enabled: data.enabled !== false,
        });
        setLoadError(data.error || null);
      } catch (err) {
        if (!cancelled) setError(err.message || "Couldn't load this skill.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug, isNew, authFetch]);

  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
    setConfirmDiscard(false);
    setError(null);
  };

  const attemptClose = () => {
    if (!dirty || confirmDiscard) return onClose();
    setConfirmDiscard(true);  // second click discards — cheaper than a nested dialog
  };

  // Tab belongs to the markdown, not to focus traversal, while the body has focus.
  const handleBodyKeyDown = (e) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const el = bodyRef.current;
    const { selectionStart: start, selectionEnd: end, value } = el;
    const next = value.slice(0, start) + "  " + value.slice(end);
    set({ body: next });
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2; });
  };

  const nameOk = form.name.trim().length > 0 && form.name.length <= MAX_NAME;
  const descOk = form.description.trim().length > 0 && form.description.length <= MAX_DESCRIPTION;
  const bodyOk = form.body.trim().length > 0 && form.body.length <= MAX_BODY;
  const canSave = !saving && !loading && nameOk && descOk && bodyOk;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch(
        isNew ? "/admin/skills" : `/admin/skills/${encodeURIComponent(slug)}`,
        {
          method: isNew ? "POST" : "PUT",
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description.trim(),
            body: form.body,
            enabled: form.enabled,
          }),
        }
      );
      onSaved(await res.json());
      onClose();
    } catch (err) {
      // useAuthFetch throws with the backend's `detail` as the message.
      setError(err.message || "Couldn't save this skill.");
      setSaving(false);
    }
  };

  const counter = (len, max) => ({
    ...styles.counter,
    ...(len > max ? styles.counterOver : null),
  });

  return (
    <div style={styles.backdrop} onClick={attemptClose}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.head}>
          <h3 style={styles.title}>{isNew ? "New skill" : "Edit skill"}</h3>
          <button style={styles.closeBtn} onClick={attemptClose} title="Close" aria-label="Close">
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>

        {loading ? (
          <p style={styles.empty}>Loading…</p>
        ) : (
          <>
            {loadError && (
              <p style={styles.warnBanner}>
                This file currently fails to load: {loadError} — its raw contents are in the body
                below. Fill in the name and description and save to rewrite it.
              </p>
            )}

            <label style={styles.label}>
              <span style={styles.labelText}>
                Name
                <span style={counter(form.name.length, MAX_NAME)}>
                  {form.name.length}/{MAX_NAME}
                </span>
              </span>
              <input
                style={styles.input}
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="meal-planning"
                autoFocus
              />
              <span style={styles.hint}>
                Exactly what tBai passes to <code style={styles.code}>load_skill</code>. Short
                kebab-case works best.
              </span>
            </label>

            <label style={styles.label}>
              <span style={styles.labelText}>
                Description
                <span style={counter(form.description.length, MAX_DESCRIPTION)}>
                  {form.description.length}/{MAX_DESCRIPTION}
                </span>
              </span>
              <input
                style={styles.input}
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="Plan a week of family dinners and turn the plan into a shopping list."
              />
              <span style={styles.hint}>
                This one line is the only part in every system prompt — it does all the routing
                work, so say when the skill applies.
              </span>
            </label>

            <label style={styles.checkRow}>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => set({ enabled: e.target.checked })}
              />
              <span>
                Enabled
                <span style={styles.hint}> — when off, tBai isn't told the skill exists.</span>
              </span>
            </label>

            <label style={styles.label}>
              <span style={styles.labelText}>
                Instructions (markdown)
                <span style={counter(form.body.length, MAX_BODY)}>
                  {form.body.length.toLocaleString()}/{MAX_BODY.toLocaleString()}
                </span>
              </span>
              <textarea
                ref={bodyRef}
                style={styles.textarea}
                value={form.body}
                onChange={(e) => set({ body: e.target.value })}
                onKeyDown={handleBodyKeyDown}
                spellCheck={false}
                placeholder={"## Instructions\n\nFollow these steps in order.\n\n1. Call `show_list` with …"}
              />
              <span style={styles.hint}>
                A local model reads this — name the tools it should call explicitly.
              </span>
            </label>

            {error && <p style={styles.error}>{error}</p>}

            <div style={styles.actions}>
              <button style={styles.secondaryBtn} onClick={attemptClose} disabled={saving}>
                {confirmDiscard ? "Discard changes?" : "Cancel"}
              </button>
              <button style={canSave ? styles.primaryBtn : styles.primaryBtnOff} onClick={handleSave} disabled={!canSave}>
                {saving ? "Saving…" : isNew ? "Create skill" : "Save changes"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// AdminPage deliberately sits outside the theme system (it's a utility view with
// a fixed light palette), so these are literals matching AdminPage's own styles
// rather than the --tbai-* vars the rest of the app uses.
const styles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 400,
  },
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    width: "min(720px, calc(100vw - 32px))",
    maxHeight: "calc(100dvh - 32px)",
    overflowY: "auto",
    background: "#fff",
    border: "1px solid #ddd",
    borderRadius: 12,
    padding: "clamp(20px, 5vw, 28px)",
    fontFamily: "sans-serif",
    boxShadow: "0 16px 32px rgba(0, 0, 0, 0.18)",
  },
  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    margin: 0,
    fontSize: 20,
    color: "#333",
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "#888",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    padding: 0,
    flexShrink: 0,
  },
  empty: {
    color: "#888",
    fontSize: 13,
    margin: 0,
  },
  warnBanner: {
    margin: 0,
    padding: "10px 12px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    fontSize: 12,
    color: "#b91c1c",
    lineHeight: 1.5,
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 0,
  },
  labelText: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
    fontSize: 13,
    fontWeight: 600,
    color: "#374151",
  },
  counter: {
    fontSize: 11,
    fontWeight: 400,
    color: "#aaa",
  },
  counterOver: {
    color: "#b91c1c",
    fontWeight: 600,
  },
  hint: {
    fontSize: 11,
    color: "#888",
    lineHeight: 1.5,
  },
  input: {
    padding: "9px 12px",
    border: "1px solid #ccc",
    borderRadius: 8,
    fontSize: 14,
    fontFamily: "inherit",
    minWidth: 0,
  },
  checkRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    fontWeight: 600,
    color: "#374151",
    cursor: "pointer",
  },
  textarea: {
    height: "min(55vh, 460px)",
    resize: "vertical",
    padding: "10px 12px",
    border: "1px solid #ccc",
    borderRadius: 8,
    fontSize: 13,
    lineHeight: 1.55,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    minWidth: 0,
  },
  error: {
    margin: 0,
    fontSize: 13,
    color: "#b91c1c",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    flexWrap: "wrap",
  },
  secondaryBtn: {
    padding: "12px 18px",
    minHeight: 44,
    background: "#f3f4f6",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    fontSize: 14,
    cursor: "pointer",
    color: "#374151",
    fontWeight: 500,
  },
  primaryBtn: {
    padding: "12px 18px",
    minHeight: 44,
    background: "#0070f3",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    cursor: "pointer",
    fontWeight: 600,
  },
  primaryBtnOff: {
    padding: "12px 18px",
    minHeight: 44,
    background: "#9dc7f8",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    cursor: "not-allowed",
    fontWeight: 600,
  },
  code: {
    fontFamily: "monospace",
    fontSize: "0.92em",
    background: "#f3f4f6",
    padding: "1px 4px",
    borderRadius: 4,
  },
};
