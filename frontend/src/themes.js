// Theme tokens — Catppuccin Mocha (dark) / Latte (light) bases, each paired with
// one of five Catppuccin accent colors that exist (with different hex) in both flavors.

const BASES = {
  dark: {
    bg: "#1e1e2e",
    surface: "#181825",
    surfaceAlt: "#11111b",
    overlay: "#313244",
    overlay2: "#45475a",
    text: "#cdd6f4",
    subtext: "#a6adc8",
    muted: "#6c7086",
    border: "#313244",
    error: "#f38ba8",
    accentContrast: "#1e1e2e",
  },
  light: {
    bg: "#eff1f5",
    surface: "#ffffff",
    surfaceAlt: "#e6e9ef",
    overlay: "#dce0e8",
    overlay2: "#ccd0da",
    text: "#4c4f69",
    subtext: "#5c5f77",
    muted: "#8c8fa1",
    border: "#dce0e8",
    error: "#d20f39",
    accentContrast: "#ffffff",
  },
};

const ACCENT_HEX = {
  blue: { dark: "#89b4fa", light: "#1e66f5" },
  mauve: { dark: "#cba6f7", light: "#8839ef" },
  green: { dark: "#a6e3a1", light: "#40a02b" },
  pink: { dark: "#f5c2e7", light: "#ea76cb" },
  peach: { dark: "#fab387", light: "#fe640b" },
};

export const THEME_MODES = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
];

export const ACCENTS = [
  { id: "blue", label: "Blue", swatch: ACCENT_HEX.blue.dark },
  { id: "mauve", label: "Mauve", swatch: ACCENT_HEX.mauve.dark },
  { id: "green", label: "Green", swatch: ACCENT_HEX.green.dark },
  { id: "pink", label: "Pink", swatch: ACCENT_HEX.pink.dark },
  { id: "peach", label: "Peach", swatch: ACCENT_HEX.peach.dark },
];

export function getTheme(mode, accent) {
  const safeMode = BASES[mode] ? mode : "dark";
  const safeAccent = ACCENT_HEX[accent] ? accent : "mauve";
  const base = BASES[safeMode];
  const accentHex = ACCENT_HEX[safeAccent][safeMode];

  const theme = {
    mode: safeMode,
    accentName: safeAccent,
    ...base,
    accent: accentHex,
    userBubble: accentHex,
    userBubbleText: base.accentContrast,
    assistantBubble: base.surface,
  };

  theme.cssVars = {
    "--tbai-md-border": base.border,
    "--tbai-md-th-bg": base.overlay,
    "--tbai-md-th-text": base.text,
    "--tbai-md-row-alt": base.surfaceAlt,
    "--tbai-md-row-hover": base.overlay,
  };

  return theme;
}
