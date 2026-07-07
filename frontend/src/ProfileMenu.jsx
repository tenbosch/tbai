import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext";
import { useTheme } from "./ThemeContext";
import ProfileSettings from "./ProfileSettings";
import { onDesktopCommand } from "./desktopBridge";

export default function ProfileMenu({ onNavigateAdmin }) {
  const { user, logout } = useAuth();
  const theme = useTheme();
  const styles = getStyles(theme);
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Desktop toolbar: the ⚙️ button opens the Settings modal.
  useEffect(() => {
    return onDesktopCommand((cmd) => {
      if (cmd?.type === "open-settings") setSettingsOpen(true);
    });
  }, []);

  if (!user) return null;

  const initial = (user.display_name || user.email || "?")[0].toUpperCase();

  return (
    <div ref={menuRef} style={styles.wrap}>
      <button style={styles.avatar} onClick={() => setOpen((o) => !o)} title={user.display_name}>
        {user.avatar_url ? (
          <img src={user.avatar_url} alt={user.display_name} style={styles.avatarImg} />
        ) : (
          <span style={styles.avatarInitial}>{initial}</span>
        )}
      </button>

      {open && (
        <div style={styles.dropdown}>
          <div style={styles.userInfo}>
            <div style={styles.displayName}>{user.display_name}</div>
            <div style={styles.email}>{user.email}</div>
          </div>
          <div style={styles.divider} />
          <button
            style={styles.menuItem}
            onClick={() => {
              setOpen(false);
              setSettingsOpen(true);
            }}
          >
            Settings
          </button>
          {user.is_admin && (
            <button
              style={styles.menuItem}
              onClick={() => {
                setOpen(false);
                onNavigateAdmin();
              }}
            >
              Admin
            </button>
          )}
          <button
            style={{ ...styles.menuItem, color: theme.error }}
            onClick={() => {
              setOpen(false);
              logout();
            }}
          >
            Sign out
          </button>
        </div>
      )}

      {settingsOpen && <ProfileSettings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function getStyles(theme) {
  return {
    wrap: {
      position: "relative",
      flexShrink: 0,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: "50%",
      overflow: "hidden",
      border: `2px solid ${theme.overlay2}`,
      background: theme.overlay,
      cursor: "pointer",
      padding: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    avatarImg: {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      display: "block",
    },
    avatarInitial: {
      color: theme.text,
      fontSize: 16,
      fontWeight: 600,
      lineHeight: 1,
    },
    dropdown: {
      position: "absolute",
      right: 0,
      top: "calc(100% + 8px)",
      background: theme.surface,
      border: `1px solid ${theme.border}`,
      borderRadius: 10,
      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      minWidth: 200,
      maxWidth: "calc(100vw - 32px)",
      zIndex: 300,
      overflow: "hidden",
    },
    userInfo: {
      padding: "12px 16px",
    },
    displayName: {
      color: theme.text,
      fontSize: 14,
      fontWeight: 600,
      marginBottom: 2,
    },
    email: {
      color: theme.muted,
      fontSize: 12,
    },
    divider: {
      height: 1,
      background: theme.border,
      margin: "0 8px",
    },
    menuItem: {
      display: "flex",
      alignItems: "center",
      width: "100%",
      minHeight: 44,
      textAlign: "left",
      background: "none",
      border: "none",
      color: theme.text,
      fontSize: 14,
      padding: "13px 16px",
      cursor: "pointer",
    },
  };
}
