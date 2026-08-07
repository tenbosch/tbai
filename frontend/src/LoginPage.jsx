import { useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { useAuth } from "./AuthContext";
import TbaiLogo from "./TbaiLogo";

export default function LoginPage() {
  const { login } = useAuth();
  const [error, setError] = useState(null);

  const handleSuccess = async (credentialResponse) => {
    setError(null);
    try {
      await login(credentialResponse.credential);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={styles.root} className="tbai-vh">
      <div style={styles.card}>
        <div style={styles.logoWrap}>
          <TbaiLogo />
        </div>
        <h1 style={styles.heading}>Welcome home.</h1>
        <p style={styles.tagline}>Your family's own AI assistant. Sign in to get started.</p>
        <div style={styles.buttonWrap}>
          <GoogleLogin
            onSuccess={handleSuccess}
            onError={() => setError("Couldn't sign in with Google — try again?")}
            theme="outline"
            shape="pill"
            size="large"
            use_fedcm_for_button={false}
          />
        </div>
        {error && <p style={styles.error}>{error}</p>}
      </div>
    </div>
  );
}

// Rendered before login, when the theme defaults to light. Colors reference the
// --tbai-* variables so the page picks up the design-system palette.
const styles = {
  root: {
    background: "var(--tbai-bg)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "var(--font-body)",
    padding: 16,
  },
  card: {
    background: "var(--tbai-surface)",
    border: "1px solid var(--tbai-border)",
    borderRadius: 16,
    padding: "44px 32px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 14,
    width: "min(420px, calc(100vw - 48px))",
    overflow: "hidden",
    boxShadow: "0 2px 6px rgba(var(--shadow-color), 0.09)",
  },
  logoWrap: {
    marginBottom: 4,
  },
  heading: {
    margin: 0,
    fontFamily: "var(--font-display)",
    fontWeight: 700,
    fontSize: 28,
    letterSpacing: "-0.01em",
    color: "var(--tbai-text)",
    textAlign: "center",
  },
  tagline: {
    color: "var(--tbai-subtext)",
    fontSize: 16,
    margin: 0,
    textAlign: "center",
    lineHeight: 1.5,
    maxWidth: 300,
  },
  buttonWrap: {
    marginTop: 10,
    maxWidth: "100%",
    overflow: "hidden",
  },
  error: {
    color: "var(--tbai-error)",
    fontSize: 13,
    margin: 0,
    textAlign: "center",
    maxWidth: 300,
  },
};
