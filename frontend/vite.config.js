import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

// 'unsafe-inline' is required for script-src/style-src: index.html has an
// inline <script> polyfill (Brave/Vite compatibility workaround) and every
// React component styles itself via inline style={} attributes rather than
// CSS classes — a stricter policy would break both. Kept in sync with the
// equivalent policy in backend/main.py's security_headers middleware.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https://accounts.google.com",
  "frame-src https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

export default defineConfig({
  plugins: [react({ fastRefresh: false }), basicSsl()],
  server: {
    host: "127.0.0.1",
    hmr: false,
    allowedHosts: "all",
    headers: {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": CSP,
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    },
    proxy: {
      "/sessions": "http://localhost:8000",
      "/chat": "http://localhost:8000",
      "/auth": "http://localhost:8000",
      "/admin": "http://localhost:8000",
      "/messages": "http://localhost:8000",
      "/users": "http://localhost:8000",
      "/lists": "http://localhost:8000",
      "/reminders": "http://localhost:8000",
      "/notifications": "http://localhost:8000",
      "/models": "http://localhost:8000",
      "/uploads": "http://localhost:8000",
    },
  },
});
