/* ---------------------------------------------------------------------------
   O protocolo, num arquivo só — importado pelo cliente E pelo servidor.

   Tudo é JSON. Nessa escala (12 jogadores, ~10 KB/s por cliente) o binário não
   compraria nada que valha perder a legibilidade: um bug de rede se resolve
   abrindo a aba Network e LENDO o que passou, e isso vale mais do que os bytes.

   Duas convenções que explicam o formato:

   • Chaves curtas nas mensagens de alta frequência (`state`, `boars`), longas
     nas de evento. O `state` sai 20 vezes por segundo por jogador; o `welcome`,
     uma vez na vida.

   • Coordenadas viajam como array `[x, y, z]`, não como `{x,y,z}`. É metade dos
     bytes e não custa nada de clareza porque só existe uma ordem possível.

   Uma reserva importante: **`t` é sempre o TIPO da mensagem**, nunca um tempo.
   Instantes usam `w` (de *when*). Não é gosto — um payload com `t` sobrescrevia
   o tipo, o servidor recebia uma mensagem que não sabia rotear e nada quebrava:
   simplesmente nunca acontecia nada do outro lado.
   --------------------------------------------------------------------------- */

/** Sobe quando o formato quebra. O servidor recusa quem não bate. */
export const PROTOCOL_VERSION = 1;

/* --------------------------------------------------------- cliente → servidor */

export const C2S = {
  /** Entrada na sala: `{ name, version }`. */
  HELLO: "hello",
  /** Pose própria, 20 Hz: `{ s: packState(), w: quandoFoiCapturada }`. */
  STATE: "state",
  /** Disparo: `{ id, o:[x,y,z], d:[x,y,z], v:speed, w:quandoSaiu }`. */
  SHOT: "shot",
  /** Impacto da PRÓPRIA flecha — quem atirou é a autoridade. */
  IMPACT: "impact",
  /** "Matei fulano": `{ victim, arrow }`. */
  KILL: "kill",
  /** Pedido de renascimento manual (tecla K). */
  RESPAWN: "respawn",
  /** Modo de jogo: `{ mode, ready }`. */
  MODE: "mode",
  /** "Acertei este porco": `{ id, distance }`. */
  BOAR_HIT: "boarHit",
  /** Soltar um porco avulso, só por diversão — não vale ponto. */
  SPAWN_BOAR: "spawnBoar",
  /** "Acertei o alvo da série": `{ seq }`. */
  SERIES_HIT: "seriesHit",
  /** Zerar o placar de todos. */
  RESET_SCORES: "resetScores",
  /** Sincronismo de relógio: `{ c: clientClock }`. */
  PING: "ping",
};

/* --------------------------------------------------------- servidor → cliente */

export const S2C = {
  /** Aceito: `{ you, time, snapshot }`. */
  WELCOME: "welcome",
  /** Recusado: `{ reason, players, max }`. */
  REJECT: "reject",
  /** Alguém entrou: `{ player }`. */
  JOIN: "join",
  /** Alguém saiu: `{ id, name }`. */
  LEAVE: "leave",
  /** Poses de todos os OUTROS, 20 Hz: `{ time, s: [ ... ] }`. */
  STATES: "states",
  /** Retransmissão de disparo, com `owner`. */
  SHOT: "shot",
  /** Retransmissão de impacto, com `owner` e `distance`. */
  IMPACT: "impact",
  /** Morte confirmada: `{ victim, killer }`. */
  KILL: "kill",
  /** Onde nascer: `{ id, x, z, drop, invulnUntil }`. */
  SPAWN: "spawn",
  /** Estado dos modos: `{ mode, members, invites, until }`. */
  MODE: "mode",
  /** Transformações dos porcos, 10 Hz. */
  BOARS: "boars",
  /** Porco morto: `{ id, killer, points, distance }`. */
  BOAR_DEATH: "boarDeath",
  /** O alvo da vez na série (ou null quando o modo sai). */
  SERIES: "series",
  /** Alvo da série derrubado — explosão, pontos e o próximo. */
  SERIES_HIT: "seriesHit",
  /** Placar completo (sempre que muda). */
  SCORES: "scores",
  /** Alguém zerou o placar: `{ by }`. */
  SCORES_RESET: "scoresReset",
  /** Resposta do sincronismo: `{ c, s }`. */
  PONG: "pong",
};

export const RejectReason = {
  FULL: "full",
  VERSION: "version",
};

/* ------------------------------------------------------------------ estado -- */

/**
 * A pose de um arqueiro, compactada.
 *
 * Vão junto a posição, os ângulos de mira E a fase da marcha. Mandar a fase é o
 * que faz as pernas do outro andarem de verdade: o `Player.update()` já monta o
 * corpo inteiro a partir desses números, então não é preciso transmitir osso
 * nenhum — só o relógio da caminhada.
 */
export function packState(player) {
  return {
    p: round3(player.position),
    y: r3(player.yaw),
    i: r3(player.pitch),
    g: r3(player.gaitPhase),
    b: r3(player.gaitBlend),
    r: r3(player.runBlend),
    d: r3(player.drawFraction),
    f: r3(player.moveF),
    s: r3(player.moveS),
    a: player.airborne ? 1 : 0,
  };
}

/** Escreve um `packState()` num objeto simples (amostra do buffer de interpolação). */
export function unpackState(state, out) {
  out.x = state.p[0];
  out.y = state.p[1];
  out.z = state.p[2];
  out.yaw = state.y;
  out.pitch = state.i;
  out.gaitPhase = state.g;
  out.gaitBlend = state.b;
  out.runBlend = state.r;
  out.drawFraction = state.d;
  out.moveF = state.f;
  out.moveS = state.s;
  out.airborne = state.a === 1;
  return out;
}

/* ------------------------------------------------------------------- nomes -- */

// Faixas de caracteres invisíveis que não podem entrar num nome: controle C0 e
// C1, largura zero, marcas de direção e o BOM. Não é preciosismo — são eles que
// produzem nomes idênticos na tela mas diferentes na memória, nomes que parecem
// vazios, e texto que se reordena sozinho ao ser desenhado.
const INVISIBLE = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2064],
  [0xfeff, 0xfeff],
];

/**
 * Limpa um nome vindo da rede.
 *
 * NÃO escapa HTML de propósito: quem desenha na tela usa `textContent`, e
 * escapar aqui só produziria etiquetas cheias de `&amp;`. A defesa mora no
 * ponto de saída — que é onde ela não pode ser esquecida.
 */
export function sanitizeName(raw, max) {
  let out = "";
  for (const ch of String(raw ?? "")) {
    const c = ch.codePointAt(0);
    if (INVISIBLE.some(([lo, hi]) => c >= lo && c <= hi)) continue;
    out += ch;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, max);
}

/** O nome pronto para a tela: nunca vazio, nunca só espaço. */
export function displayName(raw, max, fallback = "Arqueiro") {
  return sanitizeName(raw, max) || fallback;
}

/* ------------------------------------------------------------------- ids ---- */

/*
 * Ids de entidade com prefixo.
 *
 * O `entityRegistry` é um espaço de nomes só, e os ids da sala (1, 2, 3…) e os
 * dos porcos colidiriam nele — o jogador #2 e o porco #2 viram a mesma chave, e
 * uma flecha mirada num acerta o outro. O prefixo separa os dois espaços e, de
 * quebra, torna qualquer log de rede legível: `p3` e `b7` se explicam sozinhos.
 */
export const playerEntity = (id) => `p${id}`;
export const boarEntity = (id) => `b${id}`;

/** O caminho de volta: `"p3"` → `3`. Devolve null se não for de jogador. */
export function playerIdFrom(entityId) {
  return idFrom(entityId, "p");
}

/** `"b7"` → `7`. */
export function boarIdFrom(entityId) {
  return idFrom(entityId, "b");
}

function idFrom(entityId, prefixo) {
  if (typeof entityId !== "string" || entityId[0] !== prefixo) return null;
  const n = Number(entityId.slice(1));
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ vetores - */

const r3 = (v) => Math.round(v * 1000) / 1000;

/** Vetor com precisão de milímetro — de sobra, e metade dos bytes. */
export function round3(v) {
  return [r3(v.x), r3(v.y), r3(v.z)];
}

export function vecFrom(a) {
  return { x: a[0], y: a[1], z: a[2] };
}
