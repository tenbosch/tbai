// TbaiLogo — wordmark for the "ten Bosch AI assistant" (tBai) app.
// ten Bosch Family Design System: Lora serif, forest-green brand accent on "ai".
// Colors come from the --tbai-* theme layer so it works in light and dark.
//
// Props:
//   variant     accepted for backward-compat (call sites pass theme.mode); the
//               wordmark is theme-aware via CSS vars, so it's otherwise unused
//   showTagline true (default) | false — hide the "ten Bosch / AI assistant" tagline
//   style       extra styles merged onto the wrapper

export default function TbaiLogo({ variant, showTagline = false, style = {} }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontFamily: "var(--font-display, Georgia, serif)",
        ...style,
      }}
    >
      <span
        style={{
          fontWeight: 700,
          fontSize: 28,
          lineHeight: 1,
          letterSpacing: "-0.01em",
          color: "var(--tbai-text)",
        }}
      >
        tB<span style={{ color: "var(--tbai-accent)" }}>ai</span>
      </span>

      {showTagline && (
        <>
          <span
            style={{
              width: 1,
              height: 22,
              background: "var(--tbai-border-strong)",
              flex: "none",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-body, sans-serif)",
              fontWeight: 600,
              fontSize: 9,
              lineHeight: 1.35,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: "var(--tbai-muted)",
            }}
          >
            ten Bosch
            <br />
            AI assistant
          </span>
        </>
      )}
    </div>
  );
}
