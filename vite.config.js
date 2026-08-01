import { defineConfig } from "vite";

export default defineConfig({
  // Caminhos relativos: o build roda igual em subpasta, file:// ou hospedagem.
  base: "./",
  server: { open: true },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1600,
  },
  // O Rapier compat já traz o WASM embutido em base64; nada a copiar.
  optimizeDeps: { exclude: [] },
});
