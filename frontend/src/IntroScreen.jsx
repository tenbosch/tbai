import { Component, useEffect, useRef, useState } from "react";
import { animate, createScope, stagger } from "animejs";
import TbaiLogo from "./TbaiLogo";

// "Designed by Jeff and Claude, powered by Gemma from Google, and brought to
// you by CloudFlare directly from Jeffs Home Computer!" — split into words so
// each can cascade in independently; a few brand names get their real colors.
const SENTENCE =
  "Designed by Jeff and Claude, powered by Gemma from Google, and brought to you by CloudFlare directly from Jeffs Home Computer!";

const BRAND_COLORS = {
  Claude: "#cba6f7",
  Gemma: "#89b4fa",
  Google: "#89b4fa",
  CloudFlare: "#f6821f",
};

const WORDS = SENTENCE.split(" ").map((word, i) => {
  const clean = word.replace(/[.,!]/g, "");
  return { key: `${clean}-${i}`, text: word, color: BRAND_COLORS[clean] || "#f4f6fb" };
});

const SESSION_KEY = "tbai_intro_shown";

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
  const [reduceMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const rootRef = useRef(null);
  const scopeRef = useRef(null);
  const finishRef = useRef(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!visible) return;

    finishedRef.current = false;

    const finish = () => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      setIntroSeen();
      animate(rootRef.current, {
        opacity: [1, 0],
        duration: 700,
        ease: "outQuad",
        onComplete: () => setVisible(false),
      });
    };
    finishRef.current = finish;

    scopeRef.current = createScope({ root: rootRef }).add(() => {
      if (reduceMotion) {
        animate(".intro-logo, .intro-word", {
          opacity: [0, 1],
          duration: 200,
          ease: "linear",
        });
        return;
      }

      animate(".intro-logo", {
        opacity: [0, 1],
        scale: [0.85, 1],
        duration: 900,
        ease: "outExpo",
      });

      animate(".intro-word", {
        opacity: [0, 1],
        translateY: [16, 0],
        duration: 840,
        delay: stagger(80, { start: 600 }),
        ease: "outQuad",
      });
    });

    return () => scopeRef.current?.revert();
  }, [visible, reduceMotion]);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = () => finishRef.current?.();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      ref={rootRef}
      className="tbai-vh"
      onClick={() => finishRef.current?.()}
      style={styles.root}
      role="button"
      aria-label="Skip intro"
      tabIndex={-1}
    >
      <div className="intro-glow" style={styles.glow} aria-hidden="true" />
      <div style={styles.content}>
        <div className="intro-logo" style={styles.logoWrap}>
          <TbaiLogo showTagline={false} />
        </div>
        <p style={styles.words}>
          {WORDS.map((w) => (
            <span
              key={w.key}
              className="intro-word"
              style={{ ...styles.word, color: w.color }}
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
    background: "#1e1e2e",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    cursor: "pointer",
  },
  glow: {
    position: "absolute",
    width: "min(140vw, 1100px)",
    height: "min(140vw, 1100px)",
    borderRadius: "50%",
    background:
      "conic-gradient(from 0deg, #cba6f7, #89b4fa, #f6821f, #cba6f7)",
    filter: "blur(90px)",
    opacity: 0.3,
    animation: "intro-glow-pulse 2.4s ease-in-out infinite alternate",
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
  logoWrap: {
    opacity: 0,
  },
  words: {
    margin: 0,
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: "0.3em 0.5em",
    fontFamily: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
    fontSize: "clamp(1.05rem, 4vw, 1.7rem)",
    lineHeight: 1.5,
    textAlign: "center",
    fontWeight: 500,
  },
  word: {
    display: "inline-block",
    opacity: 0,
  },
  hint: {
    margin: 0,
    color: "#8790a6",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    fontSize: "clamp(0.75rem, 2.4vw, 0.9rem)",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
};
