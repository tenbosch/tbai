// TbaiLogo — sidebar wordmark for the "ten Bosch AI assistant" (tBai) app.
//
// Setup: add the Space Grotesk font once (e.g. in index.html <head>):
//   <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
//
// Usage: place at the top of your sidebar, above the "New Chat" button:
//   import TbaiLogo from "./TbaiLogo";
//   <TbaiLogo />
//
// Props:
//   variant   "dark" (default, for the navy sidebar) | "light" (for light backgrounds)
//   showTagline  true (default) | false — hide the "ten Bosch / AI assistant" tagline
//   style     extra styles merged onto the wrapper

export default function TbaiLogo({ variant = "dark", showTagline = true, style = {} }) {
  const onDark = variant === "dark";

  const ink = onDark ? "#f4f6fb" : "#151a28";
  const accent = onDark ? "#4d86f5" : "#2f6fed";
  const rule = onDark ? "rgba(255,255,255,0.16)" : "#d3d7e0";
  const tagline = onDark ? "#8790a6" : "#8b91a2";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontFamily: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
        ...style,
      }}
    >
      <span
        style={{
          fontWeight: 500,
          fontSize: 26,
          lineHeight: 1,
          letterSpacing: "-0.03em",
          color: ink,
        }}
      >
        tB<span style={{ color: accent, fontWeight: 600 }}>ai</span>
      </span>

      {showTagline && (
        <>
          <span style={{ width: 1, height: 22, background: rule, flex: "none" }} />
          <span
            style={{
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
              fontWeight: 500,
              fontSize: 9,
              lineHeight: 1.35,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: tagline,
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
