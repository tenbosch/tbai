import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, ClipboardList, AlarmClock, X } from "lucide-react";
import { useTheme } from "./ThemeContext";
import useAuthFetch from "./useAuthFetch";
import { onDesktopCommand, postDesktopState } from "./desktopBridge";

const POLL_MS = 60_000;

export default function NotificationsBell() {
  const authFetch = useAuthFetch();
  const theme = useTheme();
  const styles = getStyles(theme);
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/notifications?unread=1");
      setItems(await res.json());
    } catch {
      // polling failure is non-fatal; try again next tick
    }
  }, [authFetch]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Desktop toolbar: let the 🔔 button toggle this dropdown, and mirror the unread
  // count into the toolbar badge.
  useEffect(() => {
    return onDesktopCommand((cmd) => {
      if (cmd?.type === "toggle-notifications") setOpen((o) => !o);
    });
  }, []);

  useEffect(() => {
    postDesktopState({ unreadCount: items.length });
  }, [items]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const markRead = async (id) => {
    try {
      await authFetch(`/notifications/${id}/read`, { method: "POST" });
      setItems((prev) => prev.filter((n) => n.id !== id));
    } catch {
      /* leave it unread */
    }
  };

  const markAllRead = async () => {
    try {
      await authFetch("/notifications/read-all", { method: "POST" });
      setItems([]);
      setOpen(false);
    } catch {
      /* leave them */
    }
  };

  return (
    <div ref={wrapRef} style={styles.wrap}>
      <button
        style={styles.bellBtn}
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications (${items.length} unread)`}
        aria-expanded={open}
        title="Notifications"
      >
        <Bell size={19} strokeWidth={1.75} />
        {items.length > 0 && <span style={styles.badge}>{items.length}</span>}
      </button>

      {open && (
        <div style={styles.dropdown}>
          {items.length === 0 && <div style={styles.empty}>No new notifications</div>}
          {items.map((n) => (
            <div key={n.id} style={styles.item}>
              <div style={styles.itemMain}>
                <div style={styles.itemTitle}>
                  {n.kind === "briefing" ? (
                    <ClipboardList size={15} strokeWidth={1.75} style={styles.itemIcon} />
                  ) : (
                    <AlarmClock size={15} strokeWidth={1.75} style={styles.itemIcon} />
                  )}
                  <span>{n.title}</span>
                </div>
                {n.body && <div style={styles.itemBody}>{n.body}</div>}
              </div>
              <button
                style={styles.itemDismiss}
                onClick={() => markRead(n.id)}
                aria-label="Dismiss notification"
                title="Dismiss"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>
          ))}
          {items.length > 1 && (
            <button style={styles.markAllBtn} onClick={markAllRead}>
              Mark all read
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function getStyles(theme) {
  return {
    wrap: { position: "relative", flexShrink: 0 },
    bellBtn: {
      position: "relative",
      background: "none",
      border: "none",
      color: theme.text,
      cursor: "pointer",
      width: 44,
      height: 44,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 0,
    },
    badge: {
      position: "absolute",
      top: 4,
      right: 4,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      background: theme.error,
      color: "#fff",
      fontSize: 10,
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0 4px",
      lineHeight: 1,
    },
    dropdown: {
      position: "absolute",
      right: 0,
      top: "calc(100% + 8px)",
      background: theme.surface,
      border: `1px solid ${theme.border}`,
      borderRadius: 10,
      boxShadow: "0 16px 32px rgba(var(--shadow-color), 0.16)",
      width: "min(320px, calc(100vw - 32px))",
      maxHeight: 400,
      overflowY: "auto",
      zIndex: 300,
    },
    empty: {
      padding: "16px",
      color: theme.muted,
      fontSize: 13,
      textAlign: "center",
    },
    item: {
      display: "flex",
      alignItems: "flex-start",
      gap: 8,
      padding: "10px 12px",
      borderBottom: `1px solid ${theme.border}`,
    },
    itemMain: { flex: 1, minWidth: 0 },
    itemTitle: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      color: theme.text,
      fontSize: 13,
      fontWeight: 600,
      lineHeight: 1.4,
    },
    itemIcon: { color: theme.accent, flexShrink: 0 },
    itemBody: {
      color: theme.muted,
      fontSize: 12,
      lineHeight: 1.4,
      marginTop: 2,
    },
    itemDismiss: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "none",
      border: "none",
      color: theme.muted,
      lineHeight: 1,
      cursor: "pointer",
      padding: "2px 6px",
      flexShrink: 0,
    },
    markAllBtn: {
      display: "block",
      width: "100%",
      padding: "10px",
      background: "none",
      border: "none",
      color: theme.accent,
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer",
    },
  };
}
