import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { useTheme } from "./ThemeContext";

// How the enclosing message is doing. Markdown components are module-level
// constants, so this context is how a ```mermaid block learns about the message
// it lives in:
//   settled      — the reply has finished streaming (a half-written diagram
//                  would only ever be a parse error)
//   unterminated — the reply's last fence never closed, i.e. it was cut short by
//                  Stop or a disconnect. remark parses an unclosed fence as a
//                  code block running to EOF, so the block is genuinely partial
//                  and failing to draw it is expected, not an error worth
//                  shouting about.
export const MermaidBlockContext = createContext({ settled: true, unterminated: false });

// Renders a fenced ```mermaid code block as a diagram, falling back to the
// source whenever a diagram isn't possible (still streaming, truncated, or
// unparseable).
//
// The SVG is injected via dangerouslySetInnerHTML, but only ever mermaid's own
// render output: initialize() pins securityLevel "strict", under which mermaid
// sanitizes with DOMPurify and disables HTML labels/click handlers — the
// model's raw text never reaches the DOM directly. securityLevel is also in
// mermaid's frozen `secure` config list, so a `%%{init: ...}%%` directive
// inside model output cannot downgrade it.

// Mermaid derives contrast and computed colors in JS, so it needs concrete
// values, not var() references — resolve the design-system tokens off <html>.
// The real colors stay in styles/theme.css (see ten-bosch-family-design);
// fallbacks are only for a missing var, mirroring index.html's table rules.
function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function mermaidThemeVariables() {
  return {
    background: "transparent",
    primaryColor: cssVar("--tbai-accent-soft", "#E1E8D9"),
    primaryTextColor: cssVar("--tbai-text", "#332317"),
    primaryBorderColor: cssVar("--tbai-accent", "#3F5A34"),
    nodeBorder: cssVar("--tbai-accent", "#3F5A34"),
    lineColor: cssVar("--tbai-muted", "#948374"),
    secondaryColor: cssVar("--tbai-surface-alt", "#ECE4D3"),
    tertiaryColor: cssVar("--tbai-surface-warm", "#F5F0E6"),
    clusterBkg: cssVar("--tbai-surface-warm", "#F5F0E6"),
    clusterBorder: cssVar("--tbai-border", "#DFD3B9"),
    edgeLabelBackground: cssVar("--tbai-surface", "#FFFFFF"),
    fontFamily: cssVar("--font-body", "sans-serif"),
  };
}

// One shared dynamic import — the ~1 MB renderer stays out of the main bundle
// until the first diagram actually appears.
let mermaidPromise = null;
function loadMermaid() {
  if (!mermaidPromise) mermaidPromise = import("mermaid");
  return mermaidPromise;
}

// The mermaid text itself, shown wherever a diagram can't be (or alongside one,
// since the source is the portable thing you'd paste elsewhere).
function SourceBlock({ code, style }) {
  return (
    <pre style={{ margin: "8px 0", overflowX: "auto", ...style }}>
      <code>{code}</code>
    </pre>
  );
}

export default function MermaidDiagram({ code }) {
  const { settled, unterminated } = useContext(MermaidBlockContext);
  const { mode } = useTheme();
  const [svg, setSvg] = useState(null);
  const [error, setError] = useState(null);
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  // Not a stale-response guard — `cancelled` below is. This only keeps the DOM
  // id mermaid renders into unique per attempt, so a re-render can't collide
  // with the element a previous one is still tearing down.
  const renderSeq = useRef(0);

  // Cases we never hand to mermaid. Kept as one flag so the effect guard and
  // the render path can't drift apart — when they did, an empty fence skipped
  // the render and then sat on the "Drawing the diagram…" placeholder forever.
  const empty = !code.trim();
  const sourceOnly = empty || !settled || unterminated;

  useEffect(() => {
    if (sourceOnly) return undefined;
    const seq = ++renderSeq.current;
    let cancelled = false;
    (async () => {
      try {
        const { default: mermaid } = await loadMermaid();
        // Wait for webfonts so mermaid measures text with the real font.
        if (document.fonts?.ready) await document.fonts.ready;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: "base",
          // Resolve the theme tokens HERE, after the awaits above — never in the
          // effect body. Passive effects flush child-before-parent, so this
          // effect runs *before* ThemeProvider has written the new data-theme
          // onto <html>; the awaits are what defer us past that whole flush.
          // Hoist this call above them and every diagram renders one theme flip
          // behind, silently and with no error.
          themeVariables: mermaidThemeVariables(),
        });
        const { svg: out } = await mermaid.render(`tbai-mermaid-${reactId}-${seq}`, code);
        if (!cancelled) {
          setSvg(out);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setSvg(null);
          setError(err?.message ? String(err.message) : "Mermaid couldn't parse this diagram");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, sourceOnly, mode, reactId]);

  if (empty) return null;

  // Still streaming, or cut short mid-fence — show it like any code block. A
  // truncated diagram is not a failure, so it gets no error chrome.
  if (sourceOnly) return <SourceBlock code={code} />;

  if (error) {
    return (
      <div
        style={{
          margin: "8px 0",
          border: "1px solid var(--tbai-error)",
          background: "var(--tbai-error-soft)",
          borderRadius: 10,
          padding: "10px 12px",
          fontSize: 13,
          color: "var(--tbai-text)",
        }}
      >
        <div style={{ fontWeight: 600 }}>Couldn't render this diagram — here's the source</div>
        <div style={{ color: "var(--tbai-error)", marginTop: 2 }}>{error}</div>
        <SourceBlock code={code} style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }} />
      </div>
    );
  }

  if (!svg) {
    return (
      <div
        style={{
          margin: "8px 0",
          padding: "8px 0",
          color: "var(--tbai-muted)",
          fontSize: 13,
          fontStyle: "italic",
        }}
      >
        Drawing the diagram…
      </div>
    );
  }

  // No role/aria-label on the wrapper: mermaid's own SVG already carries
  // role="graphics-document", a <title>, and whatever accTitle/accDescr the
  // diagram declares. Wrapping it in role="img" would collapse all of that into
  // a single generic label for screen readers.
  return (
    <div style={{ margin: "8px 0" }}>
      <div
        className="tbai-mermaid"
        style={{
          maxWidth: "100%",
          overflowX: "auto",
          lineHeight: 0, // kill the inline-SVG baseline gap
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <details>
        <summary
          style={{
            cursor: "pointer",
            fontSize: 12,
            color: "var(--tbai-muted)",
            userSelect: "none",
          }}
        >
          Diagram source
        </summary>
        <SourceBlock code={code} style={{ marginBottom: 0 }} />
      </details>
    </div>
  );
}
