/* ---------------------------------------------------------------------------
   A sala dentro do dev server do Vite.

   É o que faz `npm run dev` ser um teste de multiplayer DE VERDADE, e não uma
   aproximação: a mesma `Room`, o mesmo adaptador de WebSocket, o mesmo caminho
   `/ws`, na mesma origem — com hot reload do cliente por cima. Abrir duas abas
   em localhost já é dois jogadores na sala.

   Sem isto seriam dois processos e duas portas, com proxy e CORS no meio; e o
   que se testa deixaria de ser o que se implanta.
   --------------------------------------------------------------------------- */

import { attachRoom, WS_PATH } from "./wsAdapter.js";

export function roomPlugin() {
  return {
    name: "arco-flecha-sala",
    apply: "serve",
    configureServer(server) {
      if (!server.httpServer) return; // modo middleware: nada a que se prender
      attachRoom(server.httpServer, {
        log: (msg) => server.config.logger.info(`[sala] ${msg}`),
      });
      server.config.logger.info(`  ➜  Sala:     ws://localhost:<porta>${WS_PATH}`);
    },
  };
}
