import { defineConfig } from "vite";

// VITE_BASE=/bot-bazaar/ for GitHub Pages
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  server: { fs: { allow: [".."] } },
});
