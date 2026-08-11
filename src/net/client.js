/* ---------------------------------------------------------------------------
   A conexão com a sala.

   Três responsabilidades, e nada de jogo:

   1. CONECTAR E RECONECTAR. A rede cai — wi-fi oscila, o notebook dorme, o
      servidor reinicia num deploy. Reconectar sozinho e pedir o mundo de novo
      é o que transforma isso num soluço de meio segundo em vez de um F5.

   2. SINCRONIZAR O RELÓGIO. Sem um tempo comum não existe interpolação (não dá
      para saber o que é "100 ms atrás") nem vento igual para todos — e o vento
      igual é o que permite mandar um evento de disparo em vez da trajetória
      inteira. O método é o de sempre: manda o próprio relógio, recebe de volta
      junto com o do servidor, e o desvio sai do RTT.

   3. ENTREGAR MENSAGENS. Um `on(tipo, fn)` e pronto. Quem interpreta é o jogo.

   `?lag=120` na URL atrasa tudo o que sai, para conferir se a interpolação está
   absorvendo o jitter em vez de dar borracha.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../config.js";
import { C2S, S2C, PROTOCOL_VERSION, RejectReason } from "../shared/protocol.js";

/** Quantas amostras de RTT considerar ao escolher o desvio do relógio. */
const CLOCK_SAMPLES = 8;

export class NetClient {
  constructor(url = defaultUrl()) {
    this.url = url;
    this.socket = null;
    this.name = "";
    /** Dados do WELCOME: quem eu sou nesta sala. */
    this.me = null;
    this.connected = false;
    /** A entrada escolhida na tela inicial: `{ level, mode }`. Ver `connect`. */
    this.entry = null;

    this.listeners = new Map();
    this.clockOffset = 0;
    this.rtt = 0;
    this.samples = [];

    this.attempt = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.wantConnection = false;

    // Latência artificial para teste — só o que SAI, que é o suficiente para
    // ver a interpolação trabalhar.
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
   * Entra na sala. Resolve quando o `welcome` chega; rejeita se for recusado.
   * A partir daí a conexão se mantém sozinha.
   *
   * @param {string} name
   * @param {{level?: string, mode?: string}} [entrada] a PORTA escolhida na tela
   *   inicial. Ela decide em qual sala esta conexão entra (ver `RoomHost`), e é
   *   guardada aqui porque a RECONEXÃO precisa da mesma porta: cair da rede e
   *   voltar no vale, tendo entrado pela Lua, seria trocar de jogo sozinho.
   */
  connect(name, entrada = null) {
    this.name = name;
    this.entry = entrada ?? this.entry ?? null;
    this.wantConnection = true;
    this.attempt = 0;
    return new Promise((resolve, reject) => {
      this.open(resolve, reject);
    });
  }

  open(resolve, reject) {
    let socket;
    try {
      socket = new WebSocket(this.url);
    } catch (err) {
      reject?.(new Error(`não consegui abrir ${this.url}: ${err.message}`));
      return;
    }
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.raw({
        t: C2S.HELLO,
        name: this.name,
        version: PROTOCOL_VERSION,
        ...(this.entry?.level ? { level: this.entry.level } : {}),
        ...(this.entry?.mode ? { mode: this.entry.mode } : {}),
      });
    });

    socket.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this.receive(msg, resolve, reject);
    });

    socket.addEventListener("close", () => {
      const eraConectado = this.connected;
      this.connected = false;
      this.stopPinging();
      if (this.socket === socket) this.socket = null;

      // Fechou antes do `welcome` na PRIMEIRA tentativa: é falha de entrada, e
      // quem está olhando o lobby precisa saber. Depois de dentro, é queda de
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
      case S2C.WELCOME: {
        const reconexao = this.me !== null;
        this.me = msg.you;
        this.connected = true;
        this.attempt = 0;
        // Primeiro palpite do relógio, antes do primeiro pong: melhor que zero.
        this.clockOffset = msg.time - performance.now();
        this.startPinging();
        this.emit("welcome", { ...msg, reconexao });
        resolve?.(msg);
        return;
      }

      case S2C.REJECT: {
        // Recusa é definitiva: insistir só produziria um laço de reconexão
        // contra um servidor que já disse não.
        this.wantConnection = false;
        const erro = new Error(describeReject(msg));
        erro.reason = msg.reason;
        erro.info = msg;
        if (reject) reject(erro);
        else this.emit("rejected", msg);
        return;
      }

      case S2C.PONG:
        this.onPong(msg);
        return;

      default:
        this.emit(msg.t, msg);
    }
  }

  scheduleReconnect(resolve, reject) {
    if (this.reconnectTimer) return;
    const delays = CONFIG.net.reconnectDelays;
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
    const ping = () => this.raw({ t: C2S.PING, c: performance.now(), rtt: this.rtt });
    ping();
    // Duas medidas rápidas logo na entrada para o relógio assentar antes do
    // primeiro tiro, em vez de esperar o intervalo cheio.
    setTimeout(ping, 250);
    setTimeout(ping, 750);
    this.pingTimer = setInterval(ping, CONFIG.net.heartbeat * 1000);
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

    /* Vale o desvio da amostra de MENOR RTT, não a média. Um pacote que
       demorou demais quase sempre demorou só num sentido, e é justamente essa
       assimetria que envenena a estimativa — a amostra mais rápida é a que
       menos sofreu dela. */
    let melhor = this.samples[0];
    for (const s of this.samples) if (s.rtt < melhor.rtt) melhor = s;
    this.clockOffset = melhor.offset;
    this.rtt = melhor.rtt;
  }

  /* ----------------------------------------------------------- expedição --- */

  /**
   * O `t: type` vem DEPOIS do payload de propósito.
   *
   * Com ele antes, um payload que por acaso tivesse um `t` — um carimbo de
   * tempo, digamos — apagava o tipo da mensagem, e o servidor recebia algo que
   * não sabia rotear. Falha silenciosa: nada quebra, o outro lado só nunca vê
   * nada acontecer. Pondo o tipo por último, ele sempre ganha.
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
  if (CONFIG.net.url) return CONFIG.net.url;
  const esquema = location.protocol === "https:" ? "wss:" : "ws:";
  return `${esquema}//${location.host}/ws`;
}

function describeReject(msg) {
  if (msg.reason === RejectReason.FULL) {
    return `sala cheia (${msg.players}/${msg.max})`;
  }
  if (msg.reason === RejectReason.VERSION) {
    return "versão do jogo desatualizada — recarregue a página";
  }
  return "entrada recusada pelo servidor";
}
