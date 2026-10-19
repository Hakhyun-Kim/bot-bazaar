import { defineConfig, type Plugin } from "vite";

// A Content-Security-Policy for the built site (not the dev server, whose hot reload needs inline
// scripts). The browser wallet keeps its key in this origin's localStorage, so only the site's own
// scripts may run: no inline scripts or event-handler attributes, no other script hosts. Network
// calls stay open to https/wss (BOT Chain RPCs, the free-gas relayer, the Nostr relays that
// introduce players to each other).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss: data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const csp = (): Plugin => ({
  name: "bazaar-csp",
  apply: "build",
  transformIndexHtml: (html) => html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

// VITE_BASE=./ for GitHub Pages (relative, so the project path and a custom domain both work)
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  server: { fs: { allow: [".."] } },
  plugins: [csp()],
});
