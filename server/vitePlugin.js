/* ---------------------------------------------------------------------------
   A sala dentro do dev server do Vite.

   É o que faz `npm run dev` ser um teste de multiplayer DE VERDADE, e não uma
   aproximação: a mesma `Room`, o mesmo adaptador de WebSocket, o mesmo caminho
   `/ws`, na mesma origem — com hot reload do cliente por cima. Abrir duas abas
   em localhost já é dois jogadores na sala.

   Sem isto seriam dois processos e duas portas, com proxy e CORS no meio; e o
   que se testa deixaria de ser o que se implanta.
   --------------------------------------------------------------------------- */

import { attachRoom, serveSalas, SALAS_PATH, WS_PATH } from "./wsAdapter.js";

export function roomPlugin() {
  return {
    name: "arco-flecha-sala",
    apply: "serve",
    configureServer(server) {
      if (!server.httpServer) return; // modo middleware: nada a que se prender
      const sala = attachRoom(server.httpServer, {
        log: (msg) => server.config.logger.info(`[sala] ${msg}`),
      });
      /* A MESMA rota `/salas` da produção, pelo mesmo código.
         Middleware do Vite e não `httpServer.on("request")`: o Vite já tem a
         própria pilha, e pendurar um segundo ouvinte no servidor cru responderia
         em paralelo com ela. */
      server.middlewares.use((req, res, next) => {
        if (!serveSalas(sala.host, req, res, req.url?.split("?")[0])) next();
      });
      server.config.logger.info(`  ➜  Sala:     ws://localhost:<porta>${WS_PATH}`);
      server.config.logger.info(`  ➜  Quem está jogando: <porta>${SALAS_PATH}`);
    },
  };
}
