import {
  BookOpen,
  MessageSquare,
  Search,
  Sparkles,
  ClipboardList,
  AlarmClock,
  ThumbsUp,
  Moon,
  Shield,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "./AuthContext";
import { useTheme } from "./ThemeContext";
import TbaiLogo from "./TbaiLogo";
import ProfileMenu from "./ProfileMenu";
import NotificationsBell from "./NotificationsBell";
import ThemeToggle from "./ThemeToggle";

const HEADER_H = 64;

const CARDS = [
  {
    Icon: MessageSquare,
    title: "Streaming chat",
    text: "Ask anything and watch responses stream in token-by-token, powered by a local LLM.",
  },
  {
    Icon: Search,
    title: "Automatic web search",
    text: "For anything from 2025 onward, tBai searches the web on its own and cites its sources.",
  },
  {
    Icon: Sparkles,
    title: "Remembers you",
    text: "Share preferences, allergies, or important dates and tBai remembers them across chats — review or erase anytime in Settings.",
  },
  {
    Icon: ClipboardList,
    title: "Family lists",
    text: "Shared shopping and todo lists — say \"add milk to the shopping list\" in chat, or manage them on the Lists page.",
  },
  {
    Icon: AlarmClock,
    title: "Reminders",
    text: "Ask tBai to remind you about anything — reminders pop up in the notification bell, with an optional daily briefing.",
  },
  {
    Icon: MessageSquare,
    title: "Multiple sessions",
    text: "Keep conversations organized in the sidebar — create, switch, and delete chats anytime.",
  },
  {
    Icon: BookOpen,
    title: "Skills",
    text: "Step-by-step routines — like planning a week of meals — written as markdown files. tBai picks the right one up when you ask.",
  },
  {
    Icon: ThumbsUp,
    title: "Give feedback",
    text: "Rate any response with a thumbs up or down to help improve future answers.",
  },
  {
    Icon: Moon,
    title: "Make it yours",
    text: "Set a custom display name and switch between light and dark anytime from the header.",
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
          Icon: Shield,
          title: "Admin panel",
          text: "Manage the whitelist, promote admins, review the activity log, and check which skills and MCP servers are loaded.",
        },
      ]
    : CARDS;

  return (
    <div style={styles.root} className="tbai-vh">
      <div style={styles.header}>
        <TbaiLogo variant={theme.mode} />
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <ThemeToggle />
          <NotificationsBell />
          <ProfileMenu onNavigateAdmin={onNavigateAdmin} />
        </div>
      </div>

      <div style={styles.body}>
        <h1 style={styles.greeting}>Welcome back, {greetingName}.</h1>
        <p style={styles.tagline}>Here's what you can do with tBai.</p>

        <div style={styles.ctaRow}>
          <button style={styles.cta} onClick={onNavigateChat}>
            Start chatting
            <ArrowRight size={18} strokeWidth={2} />
          </button>
          <button style={styles.ctaSecondary} onClick={onNavigateLists}>
            <ClipboardList size={18} strokeWidth={1.75} />
            Family lists
          </button>
        </div>

        <div style={styles.cardGrid}>
          {cards.map((c, i) => (
            <div key={i} style={styles.card}>
              <div style={styles.cardIcon}>
                <c.Icon size={19} strokeWidth={1.75} />
              </div>
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
      fontFamily: theme.fontBody,
    },
    header: {
      height: HEADER_H,
      background: theme.surface,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 clamp(14px, 4vw, 24px)",
      flexShrink: 0,
      borderBottom: `1px solid ${theme.border}`,
    },
    body: {
      flex: 1,
      overflowY: "auto",
      padding: "clamp(28px, 6vw, 56px) clamp(14px, 4vw, 24px)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      textAlign: "center",
    },
    greeting: {
      margin: 0,
      fontFamily: theme.fontDisplay,
      fontSize: "clamp(28px, 6vw, 36px)",
      fontWeight: 700,
      letterSpacing: "-0.01em",
      color: theme.text,
    },
    tagline: {
      margin: "10px 0 36px",
      fontSize: 18,
      color: theme.subtext,
    },
    ctaRow: {
      display: "flex",
      gap: 12,
      flexWrap: "wrap",
      justifyContent: "center",
      marginBottom: 44,
    },
    cta: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      height: 52,
      padding: "0 28px",
      borderRadius: 10,
      border: "1px solid transparent",
      background: theme.accent,
      color: theme.userBubbleText,
      fontFamily: theme.fontBody,
      fontSize: 16,
      fontWeight: 600,
      cursor: "pointer",
    },
    ctaSecondary: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      height: 52,
      padding: "0 24px",
      borderRadius: 10,
      border: `1px solid ${theme.borderStrong}`,
      background: "transparent",
      color: theme.text,
      fontFamily: theme.fontBody,
      fontSize: 16,
      fontWeight: 600,
      cursor: "pointer",
    },
    cardGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
      gap: 18,
      width: "100%",
      maxWidth: 940,
    },
    card: {
      background: theme.surfaceWarm,
      border: `1px solid ${theme.border}`,
      borderRadius: 16,
      padding: "22px 20px",
      textAlign: "left",
      boxShadow: "0 2px 6px rgba(var(--shadow-color), 0.09)",
    },
    cardIcon: {
      width: 38,
      height: 38,
      borderRadius: 10,
      background: theme.accentSoft,
      color: theme.accent,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },
    cardTitle: {
      fontFamily: theme.fontDisplay,
      fontWeight: 600,
      fontSize: 18,
      marginBottom: 6,
      color: theme.text,
    },
    cardText: {
      fontSize: 14,
      lineHeight: 1.55,
      color: theme.subtext,
    },
  };
}
