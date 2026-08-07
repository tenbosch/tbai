import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

// Disable all caching of the dev server's own responses.
//
// This is a Vite DEV server exposed publicly through a Cloudflare tunnel. Vite
// serves its pre-bundled dependency chunks as `Cache-Control: immutable` (cached
// for a year), so Cloudflare's edge — and browsers — cache them. When Vite
// re-optimizes deps (new `?v=` hash) the edge ends up holding chunks from several
// generations at once; a page then loads two copies of React → "Invalid hook
// call / Cannot read properties of null (reading 'useCallback')" → blank screen,
// and a hard refresh doesn't help because the stale bytes live at the CDN, not
// the browser. (An earlier, milder version of this only affected the HTML entry
// on mobile Brave.)
//
// Since this origin is a live dev server whose asset URLs/hashes are not stable
// across restarts, nothing it serves should be cached anywhere. We force
// `no-store` on every response (overriding Vite's `immutable`/`no-cache` via a
// setHeader lock). The cost — re-fetching modules each load — is negligible for a
// handful of family users and permanently removes this whole class of stale-cache
// outage. `optimizeDeps.include` above independently stops the re-optimization
// churn that triggered it.
function noStoreDevAssets() {
  const middleware = (req, res, next) => {
    res.setHeader("Cache-Control", "no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    const setHeader = res.setHeader.bind(res);
    res.setHeader = (name, value) =>
      String(name).toLowerCase() === "cache-control" ? res : setHeader(name, value);
    next();
  };
  return {
    name: "tbai-no-store-dev-assets",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

// 'unsafe-inline' is required for script-src/style-src: index.html has an
// inline <script> polyfill (Brave/Vite compatibility workaround) and every
// React component styles itself via inline style={} attributes rather than
// CSS classes — a stricter policy would break both. Kept in sync with the
// equivalent policy in backend/main.py's security_headers middleware.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https://accounts.google.com",
  "frame-src https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

export default defineConfig({
  plugins: [react({ fastRefresh: false }), basicSsl(), noStoreDevAssets()],
  // Pre-bundle every runtime dependency at server startup in a single optimize
  // pass. Otherwise Vite discovers deps lazily (e.g. lucide-react's many icon
  // entry points) and re-optimizes mid-session, minting new dep hashes. With
  // `hmr: false` connected pages are never told to reload, so they end up mixing
  // an old and a new React bundle — "Invalid hook call / two copies of React" —
  // which blanks the screen. Pinning the list keeps the hashes stable for the
  // whole server run; `dedupe` guarantees a single React/React-DOM instance.
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "lucide-react",
      "react-markdown",
      "remark-gfm",
      "animejs",
      "@react-oauth/google",
    ],
  },
  resolve: {
    dedupe: ["react", "react-dom"],
  },
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
