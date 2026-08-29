import { Component, useEffect, useRef, useState } from "react";
import TbaiLogo from "./TbaiLogo";

// "Designed by Jeff and Claude, powered by Gemma from Google, and brought to
// you by CloudFlare directly from Jeffs Home Computer!" — split into words so
// each can cascade in independently; a few brand names get their real colors.
const SENTENCE =
  "Designed by Jeff and Claude, powered by Gemma and Databricks, and brought to you by CloudFlare directly from Jeffs Home Computer!";

// The one brand color (forest green) picks out the names — no rainbow of
// external brand colors, per the design system's single-accent rule.
const EMPHASIS = new Set(["Jeff", "Jeffs", "Claude", "Gemma", "Databricks", "Google", "CloudFlare"]);

const WORDS = SENTENCE.split(" ").map((word, i) => {
  const clean = word.replace(/[.,!]/g, "");
  return { key: `${clean}-${i}`, text: word, emphasis: EMPHASIS.has(clean) };
});

const SESSION_KEY = "tbai_intro_shown";

// Per-word cascade timing — mirrors the old animejs stagger (600ms start, 80ms
// step). Delays are applied inline; the keyframes themselves live in index.html.
const WORD_START_MS = 600;
const WORD_STEP_MS = 80;
const FADE_OUT_MS = 700;

// Some mobile browser privacy modes throw on sessionStorage access instead
// of just being unavailable, so every call here is guarded.
function getIntroSeen() {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function setIntroSeen() {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // ignore — worst case the intro replays next load
  }
}

function IntroScreenInner() {
  const [visible, setVisible] = useState(
    () => typeof window !== "undefined" && !getIntroSeen()
  );
  const [leaving, setLeaving] = useState(false);
  const [reduceMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const finishedRef = useRef(false);
  const timerRef = useRef(null);

  // Dismiss = fade the overlay out via a CSS opacity transition, then unmount.
  // Everything here is plain state + a setTimeout — no animation library — so
  // the overlay can never get stuck on-screen waiting for an animation callback
  // that a mobile browser failed to fire.
  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setIntroSeen();
    setLeaving(true);
    timerRef.current = window.setTimeout(
      () => setVisible(false),
      reduceMotion ? 200 : FADE_OUT_MS
    );
  };

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = () => finish();
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
    // finish only reads refs/immutable state, so a stable [visible] dep is fine
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="tbai-vh"
      onClick={finish}
      style={{
        ...styles.root,
        opacity: leaving ? 0 : 1,
        transition: `opacity ${reduceMotion ? 200 : FADE_OUT_MS}ms ease`,
      }}
      role="button"
      aria-label="Skip intro"
      tabIndex={-1}
    >
      <div style={styles.content}>
        <div className="intro-logo" style={styles.logoWrap}>
          <TbaiLogo showTagline={false} />
        </div>
        <p style={styles.words}>
          {WORDS.map((w, i) => (
            <span
              key={w.key}
              className="intro-word"
              style={{
                ...styles.word,
                ...(w.emphasis ? styles.wordEmphasis : {}),
                animationDelay: reduceMotion
                  ? "0ms"
                  : `${WORD_START_MS + i * WORD_STEP_MS}ms`,
              }}
            >
              {w.text}
            </span>
          ))}
        </p>
        <p
          className={`intro-hint${reduceMotion ? " intro-hint-reduced" : ""}`}
          style={styles.hint}
        >
          Click or tap to continue
        </p>
      </div>
    </div>
  );
}

// The intro is a purely decorative overlay — if it throws on some unforeseen
// mobile browser quirk, fail silently rather than blanking the whole app.
class IntroBoundary extends Component {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error) {
    console.error("IntroScreen failed, skipping it:", error);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

export default function IntroScreen() {
  return (
    <IntroBoundary>
      <IntroScreenInner />
    </IntroBoundary>
  );
}

const styles = {
  root: {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    background: "var(--tbai-bg, #FBF8F2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    cursor: "pointer",
  },
  content: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 28,
    padding: "0 24px",
    maxWidth: "min(640px, 92vw)",
  },
  logoWrap: {},
  words: {
    margin: 0,
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: "0.2em 0.4em",
    fontFamily: "var(--font-display, Georgia, serif)",
    fontSize: "clamp(1.1rem, 4vw, 1.8rem)",
    lineHeight: 1.5,
    textAlign: "center",
    fontWeight: 500,
    color: "var(--tbai-text, #332317)",
  },
  word: {
    display: "inline-block",
  },
  wordEmphasis: {
    color: "var(--tbai-accent, #3F5A34)",
    fontWeight: 600,
  },
  hint: {
    margin: 0,
    color: "var(--tbai-muted, #948374)",
    fontFamily: "var(--font-body, sans-serif)",
    fontSize: "clamp(0.75rem, 2.4vw, 0.85rem)",
    letterSpacing: "0.09em",
    textTransform: "uppercase",
  },
};
