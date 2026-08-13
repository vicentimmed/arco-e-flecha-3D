/* ---------------------------------------------------------------------------
   O processo que roda na VPS.

   Um só: serve o `dist/` estático E aceita o WebSocket em /ws, na mesma porta e
   na mesma origem. Isso não é economia de container — é o que elimina CORS,
   certificado separado e configuração de proxy. No EasyPanel basta apontar o
   domínio para esta porta; o Traefik faz o proxy do `Upgrade` sozinho.

   Sem framework de propósito: servir arquivo estático e um upgrade de socket
   são ~100 linhas de Node, e a única dependência de runtime do projeto acaba
   sendo o `ws`.
   --------------------------------------------------------------------------- */

import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { attachRoom, serveSalas, WS_PATH } from "./wsAdapter.js";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
};

const log = (msg) => console.log(`[sala] ${msg}`);

const server = http.createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return end(res, 405, "método não permitido");
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    return end(res, 400, "URL inválida");
  }

  if (pathname === "/healthz") return end(res, 200, "ok");
  // Quem está jogando o quê — é o que a tela de entrada mostra nas portas.
  if (sala && serveSalas(sala.host, req, res, pathname)) return;

  const file = safeJoin(DIST, pathname === "/" ? "index.html" : pathname);
  // Fora do dist/ significa `..` na URL: nem confirma se existe.
  if (!file) return end(res, 403, "proibido");

  const info = await stat(file).catch(() => null);
  if (info?.isFile()) return sendFile(res, file, req.method === "HEAD");

  // Qualquer outra rota cai no index: o jogo é uma página só.
  const index = join(DIST, "index.html");
  if (await stat(index).catch(() => null)) {
    return sendFile(res, index, req.method === "HEAD");
  }
  return end(res, 404, "dist/ não encontrado — rode `npm run build` antes");
});

/* DEPOIS do `createServer` e ANTES do `listen`: o manipulador de requisições
   acima consulta `sala` para responder `/salas`, e ele só roda quando chega
   requisição — ou seja, sempre depois desta linha. */
const sala = attachRoom(server, { log });

server.listen(PORT, HOST, () => {
  console.log(`Arco & Flecha em http://${HOST}:${PORT}  ·  WebSocket em ${WS_PATH}`);
});

// O EasyPanel para o container com SIGTERM. Fechar limpo evita que os clientes
// vejam a conexão cair sem motivo no meio de um deploy.
for (const sinal of ["SIGTERM", "SIGINT"]) {
  process.on(sinal, () => {
    log("encerrando…");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

/* ------------------------------------------------------------------ auxiliares */

/** Junta e confirma que o resultado continua DENTRO da raiz. */
function safeJoin(root, pathname) {
  const full = resolve(root, `.${pathname}`);
  const base = resolve(root);
  return full === base || full.startsWith(base + sep) ? full : null;
}

function sendFile(res, file, headOnly) {
  const ext = extname(file).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    // Os nomes dos assets do Vite carregam hash do conteúdo, então podem ficar
    // no cache para sempre. O index.html não pode: é ele que aponta para a
    // versão nova depois de um deploy.
    "Cache-Control": file.endsWith("index.html")
      ? "no-cache"
      : "public, max-age=31536000, immutable",
  });
  if (headOnly) return res.end();
  createReadStream(file).pipe(res);
}

function end(res, code, text) {
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}
