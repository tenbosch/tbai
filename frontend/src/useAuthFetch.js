import { useCallback } from "react";
import { useAuth } from "./AuthContext";

/**
 * Shared authenticated fetch. Attaches the Bearer token, logs out on any 401
 * (the single choke point for expired/revoked tokens), and throws on non-2xx
 * responses with the backend's `detail` message and an `err.status` code so
 * callers can special-case statuses (e.g. 409) without re-checking `res.ok`.
 */
export default function useAuthFetch() {
  const { token, logout } = useAuth();

  return useCallback(
    async (url, options = {}) => {
      const headers = {
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      };
      // FormData sets its own multipart boundary — forcing JSON breaks uploads.
      if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
      const res = await fetch(url, { ...options, headers });
      if (res.status === 401) {
        logout();
        const err = new Error("Your session has expired — please sign in again.");
        err.status = 401;
        throw err;
      }
      if (!res.ok) {
        let detail = `Request failed (${res.status})`;
        try {
          const data = await res.json();
          if (data?.detail) {
            detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
          }
        } catch {
          // non-JSON error body — keep the generic message
        }
        const err = new Error(detail);
        err.status = res.status;
        throw err;
      }
      return res;
    },
    [token, logout]
  );
}
