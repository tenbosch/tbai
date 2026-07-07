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
        <p style={styles.tagline}>Your local AI chat companion</p>
        <div style={styles.buttonWrap}>
          <GoogleLogin
            onSuccess={handleSuccess}
            onError={() => setError("Google sign-in failed. Please try again.")}
            theme="filled_black"
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

const styles = {
  root: {
    background: "#1e1e2e",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    background: "#181825",
    border: "1px solid #313244",
    borderRadius: 16,
    padding: "40px 32px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 20,
    width: "min(400px, calc(100vw - 48px))",
    overflow: "hidden",
  },
  logoWrap: {
    marginBottom: 4,
  },
  tagline: {
    color: "#6c7086",
    fontSize: 14,
    margin: 0,
    textAlign: "center",
  },
  buttonWrap: {
    marginTop: 8,
    maxWidth: "100%",
    overflow: "hidden",
  },
  error: {
    color: "#f38ba8",
    fontSize: 13,
    margin: 0,
    textAlign: "center",
    maxWidth: 280,
  },
};
