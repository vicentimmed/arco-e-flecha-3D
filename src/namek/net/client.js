/* ---------------------------------------------------------------------------
   A conexão com a sala de Namekusei.

   ------------------------------------------------------- por que é um IRMÃO

   `src/net/client.js` já resolve conectar, reconectar e sincronizar relógio, e
   resolve BEM. Este arquivo é deliberadamente parecido com ele, e a pergunta
   honesta é por que não importá-lo direto.

   Porque ele carrega a `PROTOCOL_VERSION` do arqueiro no `hello`, e essa é uma
   incompatibilidade DURA: a nossa sala recusa quem não manda
   `NAMEK_PROTOCOL_VERSION`. Parametrizar a versão exigiria editar o cliente do
   arqueiro — que é justamente o que o §0 e o §11 do plano proíbem, e por um
   motivo prático: no dia em que o cerco subir o protocolo dele para 23, um
   cliente compartilhado faria a sala de Namekusei recusar todo mundo por causa
   de uma mudança que não tem nada a ver com ela.

   O que NÃO foi copiado, e é a diferença que justifica o arquivo existir:

   • **Sem quadro binário.** O `arraybuffer` existe lá para as poses do cerco.
     Aqui não há nada binário, e declarar o tipo seria carregar a explicação de
     um mecanismo que este modo não tem.
   • **`char` no lugar de `skin`.**
   • **Números próprios** (`NAMEK.net`), não `CONFIG.net`.

   O que é IMPORTADO e não copiado: `roomKey.js`. Ele é puro, não conhece sala
   nenhuma, e a chave é a MESMA do site — quem entra pelo link do convite entra
   em qualquer porta dele. Duas cópias disso dariam duas memórias de chave e um
   convite que funciona no vale e falha aqui.
   --------------------------------------------------------------------------- */

import { NAMEK } from "../../shared/namek/config.js";
import {
  NC2S,
  NS2C,
  NAMEK_PROTOCOL_VERSION,
  NAMEK_LEVEL,
  NAMEK_MODE,
  NamekReject,
} from "../../shared/namek/protocol.js";
import { roomKey, storedKey, rememberKey, forgetKey } from "../../net/roomKey.js";

/* O mesmo código de fechamento do arqueiro, e de propósito: a recusa por chave
   acontece no `upgrade`, ANTES de existir sala com quem falar — quem barra é o
   servidor HTTP, que é um só para as duas salas. Um código diferente aqui seria
   um número inventado para o mesmo acontecimento. */
const CLOSE_BAD_KEY = 4003;

/** Quantas amostras de RTT considerar ao escolher o desvio do relógio. */
const CLOCK_SAMPLES = 8;

export class NamekClient {
  constructor(url = defaultUrl()) {
    this.url = url;
    this.socket = null;
    this.name = "";
    this.key = null;
    this.useStoredKey = false;
    /** Quem eu sou nesta sala, vindo do `welcome`. */
    this.me = null;
    this.connected = false;

    this.listeners = new Map();
    this.clockOffset = 0;
    this.rtt = 0;
    this.samples = [];

    this.attempt = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.wantConnection = false;

    const lag = Number(new URLSearchParams(location.search).get("lag"));
    this.fakeLag = Number.isFinite(lag) && lag > 0 ? lag : 0;
  }

  /* ------------------------------------------------------------- eventos --- */

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type)?.delete(fn);
  }

  emit(type, msg) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of set) fn(msg);
  }

  /* ------------------------------------------------------------- relógio --- */

  /** Milissegundos no relógio da SALA. É o tempo em que todo mundo concorda. */
  get serverTime() {
    return performance.now() + this.clockOffset;
  }

  get ping() {
    return Math.round(this.rtt);
  }

  /* ------------------------------------------------------------- conexão --- */

  /**
   * Entra na sala. Resolve no `welcome`; rejeita se for recusado.
   *
   * @param {string} name
   * @param {string} personagem qual lutador — viaja UMA vez, como o nome.
   */
  connect(name, personagem = "kakarot") {
    this.name = name;
    this.char = personagem;
    this.wantConnection = true;
    this.attempt = 0;
    return new Promise((resolve, reject) => this.open(resolve, reject));
  }

  open(resolve, reject) {
    /* A chave é lida a CADA tentativa e não uma vez no construtor: numa partida
       longa a reconexão acontece muito depois, e é aqui que ela pega a chave que
       valeu da última vez. */
    this.key = this.useStoredKey ? storedKey() : roomKey();
    let socket;
    try {
      socket = new WebSocket(comChave(this.url, this.key));
    } catch (err) {
      reject?.(new Error(`não consegui abrir ${this.url}: ${err.message}`));
      return;
    }
    this.socket = socket;

    socket.addEventListener("open", () => {
      /* `level` e `mode` são o que faz o `RoomHost` rotear esta conexão para a
         `NamekRoom` em vez de uma sala do arqueiro. Sem eles a conexão cairia no
         vale — com um cliente que só sabe desenhar Namekusei. */
      this.raw({
        t: NC2S.HELLO,
        name: this.name,
        version: NAMEK_PROTOCOL_VERSION,
        level: NAMEK_LEVEL,
        mode: NAMEK_MODE,
        char: this.char,
      });
    });

    socket.addEventListener("message", (event) => {
      /* Só texto. Ver o cabeçalho: este modo não tem canal binário, e um
         `ArrayBuffer` chegando aqui é sinal de que a conexão caiu na sala
         errada — melhor ignorar em silêncio do que estourar num `JSON.parse`
         que o `catch` engoliria de qualquer jeito. */
      if (typeof event.data !== "string") return;
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this.receive(msg, resolve, reject);
    });

    socket.addEventListener("close", (event) => {
      const eraConectado = this.connected;
      this.connected = false;
      this.stopPinging();
      if (this.socket === socket) this.socket = null;

      /* Chave recusada não é queda de rede: reconectar com a mesma chave seria
         bater para sempre na mesma porta trancada. Antes de desistir, o segundo
         palpite — o link clicado pode ser o antigo que ficou no grupo, enquanto
         a chave que este navegador já usou continua boa. */
      if (event.code === CLOSE_BAD_KEY) {
        const salva = storedKey();
        if (!this.useStoredKey && salva && salva !== this.key) {
          this.useStoredKey = true;
          this.open(resolve, reject);
          return;
        }
        this.wantConnection = false;
        forgetKey();
        const erro = new Error(descreverRecusa({ reason: NamekReject.KEY }));
        erro.reason = NamekReject.KEY;
        if (reject) reject(erro);
        else this.emit("rejected", { t: NS2C.REJECT, reason: NamekReject.KEY });
        return;
      }

      // Fechou antes do `welcome` na PRIMEIRA tentativa: é falha de entrada, e
      // quem está olhando o lobby precisa saber. Depois de dentro é queda de
      // rede — reconecta calado.
      if (!eraConectado && reject && this.attempt === 0) {
        reject(new Error("não foi possível conectar ao servidor"));
        return;
      }
      if (eraConectado) this.emit("disconnected", {});
      if (this.wantConnection) this.scheduleReconnect(resolve, reject);
    });

    socket.addEventListener("error", () => {
      /* o `close` vem logo atrás e é lá que a reconexão é decidida */
    });
  }

  receive(msg, resolve, reject) {
    switch (msg.t) {
      case NS2C.WELCOME: {
        const reconexao = this.me !== null;
        this.me = msg.you;
        this.connected = true;
        this.attempt = 0;
        // Entrou: só AGORA a chave é digna de memória. Guardar antes deixaria um
        // link errado sobrescrever a chave boa que já estava salva.
        rememberKey(this.key);
        // Primeiro palpite do relógio, antes do primeiro pong: melhor que zero.
        this.clockOffset = msg.time - performance.now();
        this.startPinging();
        this.emit("welcome", { ...msg, reconexao });
        resolve?.(msg);
        return;
      }

      case NS2C.REJECT: {
        // Recusa é definitiva: insistir produziria um laço contra um servidor
        // que já disse não.
        this.wantConnection = false;
        const erro = new Error(descreverRecusa(msg));
        erro.reason = msg.reason;
        erro.info = msg;
        if (reject) reject(erro);
        else this.emit("rejected", msg);
        return;
      }

      case NS2C.PONG:
        this.onPong(msg);
        return;

      default:
        this.emit(msg.t, msg);
    }
  }

  scheduleReconnect(resolve, reject) {
    if (this.reconnectTimer) return;
    const delays = NAMEK.net.reconnectDelays;
    const espera = delays[Math.min(this.attempt, delays.length - 1)] * 1000;
    this.attempt++;
    this.emit("reconnecting", { attempt: this.attempt, delay: espera });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wantConnection) this.open(resolve, reject);
    }, espera);
  }

  disconnect() {
    this.wantConnection = false;
    this.stopPinging();
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
    this.connected = false;
  }

  /* --------------------------------------------------------- sincronismo --- */

  startPinging() {
    this.stopPinging();
    const ping = () => this.raw({ t: NC2S.PING, c: performance.now() });
    ping();
    /* Duas medidas rápidas na entrada para o relógio assentar antes do primeiro
       tiro, em vez de esperar o intervalo cheio de 15 s. Aqui isso importa mais
       que no arqueiro: a bola de ki tem 2,6 s de vida e um relógio torto no
       primeiro segundo põe o projétil dos outros no lugar errado justamente
       enquanto a pessoa está aprendendo o modo. */
    setTimeout(ping, 250);
    setTimeout(ping, 750);
    this.pingTimer = setInterval(ping, NAMEK.net.heartbeat * 1000);
  }

  stopPinging() {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  onPong(msg) {
    const agora = performance.now();
    const rtt = agora - msg.c;
    // Supõe caminho simétrico: o servidor estava em `s` há rtt/2.
    this.samples.push({ rtt, offset: msg.s + rtt / 2 - agora });
    if (this.samples.length > CLOCK_SAMPLES) this.samples.shift();

    /* Vale o desvio da amostra de MENOR RTT, não a média. Um pacote que demorou
       demais quase sempre demorou só num sentido, e é essa assimetria que
       envenena a estimativa — a amostra mais rápida é a que menos sofreu dela. */
    let melhor = this.samples[0];
    for (const s of this.samples) if (s.rtt < melhor.rtt) melhor = s;
    this.clockOffset = melhor.offset;
    this.rtt = melhor.rtt;
  }

  /* ----------------------------------------------------------- expedição --- */

  /**
   * O `t: type` vem DEPOIS do payload, e isso não é estilo.
   *
   * Com ele antes, um payload que por acaso trouxesse um `t` apagaria o tipo da
   * mensagem e a sala receberia algo que não sabe rotear — falha silenciosa, em
   * que nada quebra e simplesmente nunca acontece nada do outro lado. É a
   * armadilha que o cabeçalho de `shared/protocol.js` documenta, e pôr o tipo
   * por último é o que faz ele sempre ganhar.
   */
  send(type, payload = {}) {
    this.raw({ ...payload, t: type });
  }

  raw(msg) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const data = JSON.stringify(msg);
    if (this.fakeLag) setTimeout(() => trySend(socket, data), this.fakeLag);
    else trySend(socket, data);
  }
}

function trySend(socket, data) {
  if (socket.readyState === WebSocket.OPEN) socket.send(data);
}

function defaultUrl() {
  if (NAMEK.net.url) return NAMEK.net.url;
  const esquema = location.protocol === "https:" ? "wss:" : "ws:";
  return `${esquema}//${location.host}/ws`;
}

/** Acrescenta `?k=` sem atropelar o que já houver de query na URL. */
function comChave(url, chave) {
  if (!chave) return url;
  const separador = url.includes("?") ? "&" : "?";
  return `${url}${separador}k=${encodeURIComponent(chave)}`;
}

function descreverRecusa(msg) {
  if (msg.reason === NamekReject.FULL) {
    return `arena cheia (${msg.players}/${msg.max})`;
  }
  if (msg.reason === NamekReject.VERSION) {
    return "versão do jogo desatualizada — recarregue a página";
  }
  if (msg.reason === NamekReject.KEY) {
    return "entrada só pelo link do convite — peça o link atualizado a quem te chamou";
  }
  return "entrada recusada pelo servidor";
}
