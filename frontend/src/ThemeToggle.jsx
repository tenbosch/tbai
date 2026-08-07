import { useState } from "react";
import { Sun, Moon } from "lucide-react";
import { useAuth } from "./AuthContext";
import { useTheme } from "./ThemeContext";

// Header icon-button that flips the user's theme mode (persisted via PATCH /users/me).
// Shows the mode you'd switch *to*: a moon while light, a sun while dark.
export default function ThemeToggle() {
  const { user, updateProfile } = useAuth();
  const theme = useTheme();
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const next = theme.mode === "dark" ? "light" : "dark";

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await updateProfile({ theme_mode: next });
    } catch {
      /* non-fatal — leave the current theme */
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={toggle}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      style={{
        width: 44,
        height: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "none",
        border: "none",
        color: theme.text,
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
      }}
    >
      {theme.mode === "dark" ? (
        <Sun size={19} strokeWidth={1.75} />
      ) : (
        <Moon size={19} strokeWidth={1.75} />
      )}
    </button>
  );
}
