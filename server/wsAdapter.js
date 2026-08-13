/* ---------------------------------------------------------------------------
   A ponte entre o WebSocket e a sala.

   É o único arquivo que sabe o que é um socket. A sala (`room.js`) só conhece
   objetos com `send()` e `close()`, então este adaptador serve tanto ao
   servidor de produção quanto ao dev server do Vite — e é por isso que
   `npm run dev` exercita exatamente o mesmo código de jogo que vai para a VPS.

   O `upgrade` é tratado com `noServer` e filtrado por caminho de propósito: no
   desenvolvimento, o Vite tem o PRÓPRIO WebSocket para o hot reload, no mesmo
   servidor HTTP. Sequestrar todo upgrade quebraria o HMR.

   A CHAVE DA SALA (`ROOM_KEY`) é a porta. O site é público — qualquer robô que
   ache o domínio carrega a página —, mas entrar na sala exige o `?k=` que só
   está no link que você mandou. Sem `ROOM_KEY` definida a sala fica aberta, que
   é o que se quer em `npm run dev`: a trava existe só onde há domínio exposto.

   A chave é ESTÁTICA: sem expiração, sem carimbo de tempo, sem nonce. É uma
   partida longa em que se sai e se volta pelo link, e uma chave que envelhece
   viraria exatamente o "deu pau no meio da jogatina" que não pode acontecer.
   Aceitar uma LISTA separada por vírgula é o que permite trocar a chave sem
   derrubar ninguém: publica-se a nova, deixa-se a velha valendo, e ela sai da
   lista quando não houver mais ninguém usando.
   --------------------------------------------------------------------------- */

import { WebSocketServer } from "ws";
import { RoomHost } from "./room.js";
import { CLOSE_BAD_KEY } from "../src/shared/protocol.js";

export const WS_PATH = "/ws";
/** Onde a tela de entrada pergunta quem está jogando o quê. Ver `SALAS_PATH`. */
export const SALAS_PATH = "/salas";

const CHAVES = String(process.env.ROOM_KEY ?? "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

/**
 * @param {import("node:http").Server} httpServer
 * @param {{ path?: string, log?: (msg: string) => void }} [options]
 */
export function attachRoom(httpServer, { path = WS_PATH, log } = {}) {
  const host = new RoomHost({ log });
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      return;
    }
    // Não é para nós (HMR do Vite, por exemplo): sai sem tocar no socket.
    if (url.pathname !== path) return;

    /* Chave errada: completa o aperto de mão só para poder FECHAR com um
       código. Um `socket.destroy()` seria mais seco, mas o navegador entrega
       toda queda como 1006 — e aí quem abriu um link velho não teria como saber
       que o problema é a chave, e não o servidor fora do ar. O custo é um
       socket que vive um milissegundo e nunca vê a sala: quem é robô continua
       sem entrar, quem é gente lê o motivo na tela. */
    if (!chaveVale(url.searchParams.get("k"))) {
      log?.(`entrada recusada: chave inválida (${req.socket.remoteAddress})`);
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.close(CLOSE_BAD_KEY, "chave inválida");
      });
      return;
    }

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

/**
 * O JSON que a tela de entrada lê para dizer quem está jogando o quê.
 *
 * HTTP e não WebSocket de propósito: quem pergunta isso ainda não entrou na
 * sala — está olhando as portas —, e abrir um socket só para contar cabeças
 * seria criar uma conexão que a chave (`ROOM_KEY`) teria de deixar passar. Uma
 * requisição sem estado responde a mesma coisa e não abre porta nenhuma.
 *
 * Fica aqui, e não em `index.js`, porque o dev server do Vite precisa
 * exatamente do mesmo comportamento — é a mesma razão pela qual `attachRoom`
 * mora neste arquivo.
 *
 * @returns {boolean} true se a requisição era esta e já foi respondida
 */
export function serveSalas(host, req, res, pathname = SALAS_PATH) {
  if (pathname !== SALAS_PATH) return false;
  const corpo = JSON.stringify(host.publicStatus());
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    // A resposta muda a cada entrada e saída: guardá-la é mostrar sala cheia
    // para quem chega num lugar que já esvaziou.
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(corpo),
  });
  res.end(corpo);
  return true;
}

/** Sem `ROOM_KEY` a sala é aberta — é assim que `npm run dev` segue sem senha. */
function chaveVale(k) {
  if (!CHAVES.length) return true;
  return typeof k === "string" && CHAVES.includes(k);
}
