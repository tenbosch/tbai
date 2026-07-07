import { createContext, useCallback, useContext, useEffect, useState } from "react";

const TOKEN_KEY = "tbai_token";

const AuthContext = createContext(null);

function decodeJwt(token) {
  try {
    let b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8").decode(bytes));
  } catch {
    return null;
  }
}

function isExpired(payload) {
  return payload.exp * 1000 < Date.now();
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const stored = localStorage.getItem(TOKEN_KEY);
      if (stored) {
        const payload = decodeJwt(stored);
        if (payload && !isExpired(payload)) {
          setToken(stored);
          setUser({
            id: parseInt(payload.sub, 10),
            email: payload.email,
            display_name: payload.display_name,
            given_name: payload.given_name,
            avatar_url: payload.avatar_url,
            is_admin: payload.is_admin,
          });
          // custom_name/theme fields aren't in the JWT — hydrate from the profile endpoint
          try {
            const res = await fetch("/users/me", {
              headers: { Authorization: `Bearer ${stored}` },
            });
            if (res.status === 401) {
              // Backend rejects the token (revoked/stale) even if exp hasn't passed
              localStorage.removeItem(TOKEN_KEY);
              setToken(null);
              setUser(null);
            } else if (res.ok) {
              const profile = await res.json();
              // Guard against logout() having run during the await — never
              // resurrect a logged-out user from a stale profile response.
              setUser((u) => (u ? { ...u, ...profile } : u));
            }
          } catch {
            // offline/backend down — proceed with JWT-only user info
          }
        } else {
          localStorage.removeItem(TOKEN_KEY);
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = useCallback(async (googleIdToken) => {
    const res = await fetch("/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_token: googleIdToken }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Login failed" }));
      throw new Error(err.detail || "Login failed");
    }
    const data = await res.json();
    localStorage.setItem(TOKEN_KEY, data.token);
    setToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  // Auto-logout the moment the token's exp passes, instead of leaving a dead
  // token that every request would then 401 against.
  useEffect(() => {
    if (!token) return;
    const payload = decodeJwt(token);
    if (!payload?.exp) return;
    const msLeft = payload.exp * 1000 - Date.now();
    if (msLeft <= 0) {
      logout();
      return;
    }
    const timer = setTimeout(logout, msLeft);
    return () => clearTimeout(timer);
  }, [token, logout]);

  const updateProfile = useCallback(
    async (patch) => {
      const res = await fetch("/users/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(patch),
      });
      if (res.status === 401) {
        logout();
        throw new Error("Your session has expired — please sign in again.");
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to update profile" }));
        throw new Error(err.detail || "Failed to update profile");
      }
      const profile = await res.json();
      setUser((u) => (u ? { ...u, ...profile } : u));
      return profile;
    },
    [token, logout]
  );

  return (
    <AuthContext.Provider
      value={{ user, token, loading, isAuthenticated: !!user, login, logout, updateProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
