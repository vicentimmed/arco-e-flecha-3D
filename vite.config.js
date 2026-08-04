import { defineConfig } from "vite";
import { roomPlugin } from "./server/vitePlugin.js";

export default defineConfig({
  // Caminhos relativos: o build roda igual em subpasta, file:// ou hospedagem.
  base: "./",
  // A sala roda DENTRO do dev server: mesma porta, mesma origem, sem proxy.
  // Duas abas em localhost já são dois jogadores.
  plugins: [roomPlugin()],
  server: { open: true },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1600,
  },
  // O Rapier compat já traz o WASM embutido em base64; nada a copiar.
  optimizeDeps: { exclude: [] },
});
