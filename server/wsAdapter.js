/* ---------------------------------------------------------------------------
   A ponte entre o WebSocket e a sala.

   É o único arquivo que sabe o que é um socket. A sala (`room.js`) só conhece
   objetos com `send()` e `close()`, então este adaptador serve tanto ao
   servidor de produção quanto ao dev server do Vite — e é por isso que
   `npm run dev` exercita exatamente o mesmo código de jogo que vai para a VPS.

   O `upgrade` é tratado com `noServer` e filtrado por caminho de propósito: no
   desenvolvimento, o Vite tem o PRÓPRIO WebSocket para o hot reload, no mesmo
   servidor HTTP. Sequestrar todo upgrade quebraria o HMR.
   --------------------------------------------------------------------------- */

import { WebSocketServer } from "ws";
import { RoomHost } from "./room.js";

export const WS_PATH = "/ws";

/**
 * @param {import("node:http").Server} httpServer
 * @param {{ path?: string, log?: (msg: string) => void }} [options]
 */
export function attachRoom(httpServer, { path = WS_PATH, log } = {}) {
  const host = new RoomHost({ log });
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url, "http://localhost").pathname;
    } catch {
      return;
    }
    // Não é para nós (HMR do Vite, por exemplo): sai sem tocar no socket.
    if (pathname !== path) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws) => {
    const conn = {
      send(data) {
        if (ws.readyState === ws.OPEN) ws.send(data);
      },
      close() {
        ws.close();
      },
    };

    ws.on("message", (data) => host.handleMessage(conn, data.toString()));
    ws.on("close", () => host.handleClose(conn));
    ws.on("error", () => {
      host.handleClose(conn);
      ws.terminate();
    });
  });

  return { host, wss };
}
