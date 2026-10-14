import { defineConfig } from "vite";

// VITE_BASE=./ for GitHub Pages (relative, so the project path and a custom domain both work)
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  server: { fs: { allow: [".."] } },
});
