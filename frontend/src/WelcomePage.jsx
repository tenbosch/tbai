import { useAuth } from "./AuthContext";
import { useTheme } from "./ThemeContext";
import TbaiLogo from "./TbaiLogo";
import ProfileMenu from "./ProfileMenu";
import NotificationsBell from "./NotificationsBell";

const HEADER_H = 56;

const CARDS = [
  {
    icon: "💬",
    title: "Streaming chat",
    text: "Ask anything and watch responses stream in token-by-token, powered by a local LLM.",
  },
  {
    icon: "🔍",
    title: "Automatic web search",
    text: "For anything from 2025 onward, tBai searches the web on its own and cites its sources.",
  },
  {
    icon: "🧠",
    title: "Remembers you",
    text: "Share preferences, allergies, or important dates and tBai remembers them across chats — review or erase anytime in Settings.",
  },
  {
    icon: "📝",
    title: "Family lists",
    text: "Shared shopping and todo lists — say \"add milk to the shopping list\" in chat, or manage them on the Lists page.",
  },
  {
    icon: "⏰",
    title: "Reminders",
    text: "Ask tBai to remind you about anything — reminders pop up in the notification bell, with an optional daily briefing.",
  },
  {
    icon: "🗂️",
    title: "Multiple sessions",
    text: "Keep conversations organized in the sidebar — create, switch, and delete chats anytime.",
  },
  {
    icon: "👍",
    title: "Give feedback",
    text: "Rate any response with a thumbs up or down to help improve future answers.",
  },
  {
    icon: "🎨",
    title: "Make it yours",
    text: "Set a custom display name and pick a color theme anytime from your profile icon above.",
  },
];

export default function WelcomePage({ onNavigateChat, onNavigateAdmin, onNavigateLists }) {
  const { user } = useAuth();
  const theme = useTheme();
  const styles = getStyles(theme);

  const greetingName =
    user?.custom_name || user?.given_name || (user?.email || "").split("@")[0] || "there";
  const cards = user?.is_admin
    ? [
        ...CARDS,
        {
          icon: "🛡️",
          title: "Admin panel",
          text: "Manage the whitelist, promote admins, and review the activity log.",
        },
      ]
    : CARDS;

  return (
    <div style={styles.root} className="tbai-vh">
      <div style={styles.header}>
        <TbaiLogo style={{ padding: "4px 2px" }} variant={theme.mode === "dark" ? "dark" : "light"} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <NotificationsBell />
          <ProfileMenu onNavigateAdmin={onNavigateAdmin} />
        </div>
      </div>

      <div style={styles.body}>
        <h1 style={styles.greeting}>Welcome back, {greetingName}!</h1>
        <p style={styles.tagline}>Here's what you can do with tBai.</p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <button style={styles.cta} onClick={onNavigateChat}>
            Start Chatting →
          </button>
          <button style={styles.ctaSecondary} onClick={onNavigateLists}>
            📝 Family Lists
          </button>
        </div>

        <div style={styles.cardGrid}>
          {cards.map((c, i) => (
            <div key={i} style={styles.card}>
              <div style={styles.cardIcon}>{c.icon}</div>
              <div style={styles.cardTitle}>{c.title}</div>
              <div style={styles.cardText}>{c.text}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function getStyles(theme) {
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
    body: {
      flex: 1,
      overflowY: "auto",
      padding: "clamp(24px, 6vw, 48px) clamp(14px, 4vw, 24px)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      textAlign: "center",
    },
    greeting: {
      margin: 0,
      fontSize: 32,
      fontWeight: 700,
      color: theme.text,
    },
    tagline: {
      margin: "8px 0 36px",
      fontSize: 15,
      color: theme.subtext,
    },
    cardGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
      gap: 16,
      width: "100%",
      maxWidth: 900,
    },
    card: {
      background: theme.surface,
      border: `1px solid ${theme.border}`,
      borderTop: `3px solid ${theme.accent}`,
      borderRadius: 12,
      padding: "20px 18px",
      textAlign: "left",
    },
    cardIcon: {
      fontSize: 24,
      marginBottom: 8,
    },
    cardTitle: {
      fontWeight: 600,
      fontSize: 15,
      marginBottom: 6,
      color: theme.text,
    },
    cardText: {
      fontSize: 13,
      lineHeight: 1.5,
      color: theme.subtext,
    },
    cta: {
      marginBottom: 40,
      padding: "14px 32px",
      borderRadius: 10,
      border: "none",
      background: theme.accent,
      color: theme.userBubbleText,
      fontSize: 16,
      fontWeight: 700,
      cursor: "pointer",
    },
    ctaSecondary: {
      marginBottom: 40,
      padding: "14px 32px",
      borderRadius: 10,
      border: `1px solid ${theme.border}`,
      background: theme.surface,
      color: theme.text,
      fontSize: 16,
      fontWeight: 700,
      cursor: "pointer",
    },
  };
}
