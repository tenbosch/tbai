import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useGoogleLogin } from "@react-oauth/google";
import { useAuth } from "./AuthContext";
import { useTheme } from "./ThemeContext";
import { THEME_MODES } from "./themes";
import useAuthFetch from "./useAuthFetch";

const GOOGLE_SCOPES =
  "https://www.googleapis.com/auth/calendar.readonly " +
  "https://www.googleapis.com/auth/gmail.readonly " +
  "https://www.googleapis.com/auth/drive.metadata.readonly";

export default function ProfileSettings({ onClose }) {
  const { user, updateProfile } = useAuth();
  const theme = useTheme();
  const authFetch = useAuthFetch();
  const styles = getStyles(theme);

  const [name, setName] = useState(user?.custom_name || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [facts, setFacts] = useState([]);
  const [factsError, setFactsError] = useState(null);
  const [googleStatus, setGoogleStatus] = useState(null); // null | {connected, ...}
  const [googleError, setGoogleError] = useState(null);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch("/auth/google/status");
        setGoogleStatus(await res.json());
      } catch (err) {
        console.error("Failed to load Google status:", err);
      }
    })();
  }, [authFetch]);

  const connectGoogle = useGoogleLogin({
    flow: "auth-code",
    scope: GOOGLE_SCOPES,
    onSuccess: async ({ code }) => {
      setGoogleBusy(true);
      setGoogleError(null);
      try {
        await authFetch("/auth/google/connect", {
          method: "POST",
          body: JSON.stringify({ code }),
        });
        setGoogleStatus({ connected: true });
      } catch (err) {
        setGoogleError(err.message);
      } finally {
        setGoogleBusy(false);
      }
    },
    onError: () => setGoogleError("Google sign-in was cancelled or failed."),
  });

  const disconnectGoogle = async () => {
    setGoogleBusy(true);
    setGoogleError(null);
    try {
      await authFetch("/auth/google/connect", { method: "DELETE" });
      setGoogleStatus({ connected: false });
    } catch (err) {
      setGoogleError(err.message);
    } finally {
      setGoogleBusy(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch("/users/me/facts");
        setFacts(await res.json());
      } catch (err) {
        setFactsError("Could not load memory.");
        console.error("Failed to load facts:", err);
      }
    })();
  }, [authFetch]);

  const handleDeleteFact = async (id) => {
    try {
      await authFetch(`/users/me/facts/${id}`, { method: "DELETE" });
      setFacts((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      setFactsError("Could not delete that fact.");
      console.error("Failed to delete fact:", err);
    }
  };

  const namePlaceholder = user?.given_name || (user?.email || "").split("@")[0];

  const handleSaveName = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateProfile({ custom_name: name.trim() || null });
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSetMode = async (mode) => {
    setError(null);
    try {
      await updateProfile({ theme_mode: mode });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>Profile settings</h3>
          <button style={styles.closeBtn} onClick={onClose} title="Close" aria-label="Close">
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>

        <div style={styles.section}>
          <label style={styles.label}>Display name</label>
          <input
            style={styles.input}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            placeholder={namePlaceholder}
            maxLength={60}
          />
          <div style={styles.row}>
            <button style={styles.saveBtn} onClick={handleSaveName} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && <span style={styles.savedNote}>Saved</span>}
          </div>
        </div>

        <div style={styles.section}>
          <label style={styles.label}>Appearance</label>
          <div style={styles.modeRow}>
            {THEME_MODES.map((m) => (
              <button
                key={m.id}
                style={{
                  ...styles.modeBtn,
                  ...(user?.theme_mode === m.id ? styles.modeBtnActive : {}),
                }}
                onClick={() => handleSetMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div style={styles.section}>
          <label style={styles.label}>Google services</label>
          {googleStatus?.connected ? (
            <div style={styles.row}>
              <span style={styles.googleConnected}>Connected — calendar, email &amp; Drive (read-only)</span>
              <button style={styles.googleDisconnectBtn} onClick={disconnectGoogle} disabled={googleBusy}>
                {googleBusy ? "…" : "Disconnect"}
              </button>
            </div>
          ) : (
            <>
              <button style={styles.saveBtn} onClick={() => connectGoogle()} disabled={googleBusy}>
                {googleBusy ? "Connecting…" : "Connect Google services"}
              </button>
              <p style={styles.factsEmpty}>
                Lets tBai check your calendar, search your email, and find Drive files — read-only,
                never modifies anything. Each family member connects their own account.
              </p>
            </>
          )}
          {googleError && <div style={styles.error}>{googleError}</div>}
        </div>

        <div style={styles.section}>
          <label style={styles.label}>Daily briefing</label>
          <select
            style={styles.input}
            value={user?.briefing_hour ?? ""}
            onChange={async (e) => {
              setError(null);
              try {
                await updateProfile({
                  briefing_hour: e.target.value === "" ? null : Number(e.target.value),
                });
              } catch (err) {
                setError(err.message);
              }
            }}
          >
            <option value="">Off</option>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
          <p style={styles.factsEmpty}>
            A morning summary of your reminders and open list items, delivered to the bell.
          </p>
        </div>

        <div style={styles.section}>
          <label style={styles.label}>What tBai knows about you</label>
          {facts.length === 0 && !factsError && (
            <p style={styles.factsEmpty}>
              Nothing yet — when you share preferences or important details in chat, they'll
              show up here and you can remove them anytime.
            </p>
          )}
          {facts.length > 0 && (
            <div style={styles.factsList}>
              {facts.map((f) => (
                <div key={f.id} style={styles.factRow}>
                  <span style={styles.factText}>{f.fact}</span>
                  <button
                    style={styles.factDeleteBtn}
                    onClick={() => handleDeleteFact(f.id)}
                    title="Forget this"
                    aria-label={`Forget "${f.fact}"`}
                  >
                    <X size={16} strokeWidth={1.75} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {factsError && <div style={styles.error}>{factsError}</div>}
        </div>

        {error && <div style={styles.error}>{error}</div>}
      </div>
    </div>
  );
}

function getStyles(theme) {
  return {
    backdrop: {
      position: "fixed",
      inset: 0,
      background: theme.scrim,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 400,
    },
    panel: {
      background: theme.surface,
      border: `1px solid ${theme.border}`,
      borderRadius: 14,
      padding: 24,
      width: "min(400px, calc(100vw - 32px))",
      maxHeight: "calc(100dvh - 32px)",
      overflowY: "auto",
      WebkitOverflowScrolling: "touch",
      display: "flex",
      flexDirection: "column",
      gap: 18,
      boxShadow: "0 16px 32px rgba(var(--shadow-color), 0.16)",
    },
    header: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    },
    title: {
      margin: 0,
      fontFamily: theme.fontDisplay,
      fontWeight: 600,
      fontSize: 22,
      color: theme.text,
    },
    closeBtn: {
      background: "none",
      border: "none",
      color: theme.muted,
      lineHeight: 1,
      cursor: "pointer",
      width: 44,
      height: 44,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 0,
    },
    section: {
      display: "flex",
      flexDirection: "column",
      gap: 8,
    },
    label: {
      fontSize: 12,
      fontWeight: 600,
      color: theme.subtext,
      textTransform: "uppercase",
      letterSpacing: "0.04em",
    },
    input: {
      padding: "10px 12px",
      borderRadius: 10,
      border: `1px solid ${theme.border}`,
      background: theme.bg,
      color: theme.text,
      fontSize: 14,
      fontFamily: theme.fontBody,
    },
    row: {
      display: "flex",
      alignItems: "center",
      gap: 10,
    },
    saveBtn: {
      padding: "12px 16px",
      minHeight: 44,
      borderRadius: 10,
      border: "1px solid transparent",
      background: theme.accent,
      color: theme.userBubbleText,
      fontFamily: theme.fontBody,
      fontWeight: 600,
      fontSize: 13,
      cursor: "pointer",
    },
    savedNote: {
      fontSize: 12,
      color: theme.accent,
    },
    modeRow: {
      display: "flex",
      gap: 8,
    },
    modeBtn: {
      flex: 1,
      padding: "13px 10px",
      minHeight: 44,
      borderRadius: 10,
      border: `1px solid ${theme.border}`,
      background: "none",
      color: theme.text,
      fontFamily: theme.fontBody,
      fontSize: 13,
      cursor: "pointer",
    },
    modeBtnActive: {
      background: theme.accentSoft,
      border: `1px solid ${theme.accent}`,
      fontWeight: 600,
    },
    error: {
      color: theme.error,
      fontSize: 13,
    },
    factsEmpty: {
      margin: 0,
      fontSize: 13,
      color: theme.muted,
      lineHeight: 1.5,
    },
    factsList: {
      display: "flex",
      flexDirection: "column",
      gap: 6,
      maxHeight: 180,
      overflowY: "auto",
    },
    factRow: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      padding: "6px 10px",
      borderRadius: 8,
      background: theme.bg,
      border: `1px solid ${theme.border}`,
    },
    factText: {
      fontSize: 13,
      color: theme.text,
      lineHeight: 1.4,
    },
    googleConnected: {
      fontSize: 13,
      color: theme.text,
      flex: 1,
    },
    googleDisconnectBtn: {
      padding: "8px 12px",
      borderRadius: 8,
      border: `1px solid ${theme.border}`,
      background: "none",
      color: theme.error,
      fontSize: 12,
      fontWeight: 600,
      cursor: "pointer",
      flexShrink: 0,
    },
    factDeleteBtn: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "none",
      border: "none",
      color: theme.muted,
      lineHeight: 1,
      cursor: "pointer",
      padding: "4px 6px",
      flexShrink: 0,
    },
  };
}
