// Theme tokens — ten Bosch Family Design System.
// One warm brand palette (forest green), two modes (light / dark). The actual
// color values live in styles/theme.css as --tbai-* CSS variables, switched by
// [data-theme] on <html>; here we just reference them so inline styles resolve
// against whichever mode is active. `mode` stays a real string for JS branching.

export const THEME_MODES = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

// Design-system fonts (from styles/tokens/typography.css).
const FONT_DISPLAY = "var(--font-display)"; // Lora — headings, wordmark
const FONT_BODY = "var(--font-body)"; // Public Sans — UI/body

export function getTheme(mode) {
  const safeMode = mode === "dark" ? "dark" : "light";

  const theme = {
    mode: safeMode,

    // Surfaces
    bg: "var(--tbai-bg)",
    surface: "var(--tbai-surface)",
    surfaceAlt: "var(--tbai-surface-alt)",
    surfaceWarm: "var(--tbai-surface-warm)",
    overlay: "var(--tbai-surface-alt)", // legacy alias: hover/active rows, neutral fills

    // Text
    text: "var(--tbai-text)",
    subtext: "var(--tbai-subtext)",
    muted: "var(--tbai-muted)",

    // Lines
    border: "var(--tbai-border)",
    borderStrong: "var(--tbai-border-strong)",

    // Brand
    accent: "var(--tbai-accent)",
    accentHover: "var(--tbai-accent-hover)",
    accentSoft: "var(--tbai-accent-soft)",

    // Feedback
    error: "var(--tbai-error)",
    errorSoft: "var(--tbai-error-soft)",
    warn: "var(--tbai-warn)",
    warnSoft: "var(--tbai-warn-soft)",

    // Chat bubbles
    userBubble: "var(--tbai-accent)",
    userBubbleText: "var(--tbai-on-accent)",
    assistantBubble: "var(--tbai-assistant-bubble)",

    // Scrim for modals/drawers
    scrim: "var(--tbai-scrim)",

    // Type
    fontDisplay: FONT_DISPLAY,
    fontBody: FONT_BODY,
  };

  // Markdown-table CSS vars pushed onto :root by ThemeContext.
  theme.cssVars = {
    "--tbai-md-border": "var(--tbai-border)",
    "--tbai-md-th-bg": "var(--tbai-surface-alt)",
    "--tbai-md-th-text": "var(--tbai-text)",
    "--tbai-md-row-alt": "var(--tbai-surface-alt)",
    "--tbai-md-row-hover": "var(--tbai-surface-warm)",
  };

  return theme;
}
