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

/**
 * Sobe quando o formato quebra. O servidor recusa quem não bate.
 *
 * 2 — entraram alces, pássaros e o reinício de mundo, e a mensagem de morte
 * passou a carregar o impacto (`c`, `v`) que alimenta o corpo mole. Uma aba
 * antiga que continuasse conectada não veria bicho nenhum e cairia sempre para
 * o mesmo lado: melhor recusar e pedir para recarregar do que deixar duas
 * pessoas jogando partidas diferentes na mesma sala.
 *
 * 3 — entrou o modo zumbi, com hordas, vidas, tochas quebráveis e um sexto
 * valor possível para `mode`. Uma aba antiga que continuasse conectada veria a
 * sala anunciar um modo que ela não sabe desenhar: ficaria de dia, sem tochas e
 * sem zumbi nenhum, atirando num campo vazio enquanto todos os outros defendem
 * um quadrado de luz.
 *
 * 4 — vento na flecha sincronizado pela sala, fim da série com placar de
 * vitória, e hordas de zumbi por tabela. Uma aba antiga divergiria na física
 * da flecha e reiniciaria a série no último alvo.
 *
 * 5 — caçada ao alce com fim de partida (vitória/derrota), respawn longo do
 * jogador e placar de flechas/golpe final. Uma aba antiga não mostraria a
 * tela de vitória nem o countdown de renascimento.
 *
 * 6 — `spawn` passou a poder trazer o rumo da câmera (`yaw`) e `elkHit` avisa
 * quando a investida foi quebrada. Uma aba antiga nasceria de costas para o
 * alce e não explicaria por que o bicho desistiu no meio da corrida.
 *
 * 7 — entrou a pose curta do golpe de faca e o comando de melee.
 *
 * 8 — o golpe de faca também passou a ter um canal próprio para acertar players.
 */
export const PROTOCOL_VERSION = 8;

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
  /** "Acertei este alce": `{ id }`. O dano e a morte quem decide é a sala. */
  ELK_HIT: "elkHit",
  /** Soltar um alce avulso (tecla L), em qualquer modo. */
  SPAWN_ELK: "spawnElk",
  /** Antecipar horda de lobos na caçada ao alce (tecla O, teste). */
  SPAWN_ELK_WOLVES: "spawnElkWolves",
  /** "Acertei este pássaro": `{ id }`. */
  BIRD_HIT: "birdHit",
  /** "Acertei o alvo da série": `{ seq }`. */
  SERIES_HIT: "seriesHit",
  /** Liga/desliga o vento na flecha para a sala: `{ on?: boolean }`. */
  WIND: "wind",
  /** Zerar o placar de todos. */
  RESET_SCORES: "resetScores",
  /** "Acertei este zumbi": `{ id, head, d }`. `head` decide se morre na hora. */
  ZOMBIE_HIT: "zombieHit",
  /** "Matei este zumbi/lobo com a faca": `{ id, d }`. */
  KNIFE_HIT: "knifeHit",
  /** "Acertei este player com a faca": `{ victim, p, d }`. */
  KNIFE_PLAYER_HIT: "knifePlayerHit",
  /** "Acertei esta tocha": `{ i }`. Apaga a chama e a luz dela. */
  TORCH_HIT: "torchHit",
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
  /** Onde nascer: `{ id, x, z, y, drop, invulnUntil, yaw? }`. `yaw` só vem
   *  quando a sala quer decidir para onde a pessoa olha (caçada ao alce). */
  SPAWN: "spawn",
  /** Estado dos modos: `{ mode, members, invites, until }`. */
  MODE: "mode",
  /** Transformações dos porcos, 10 Hz. */
  BOARS: "boars",
  /** Porco morto: `{ id, killer, points, distance }`. */
  BOAR_DEATH: "boarDeath",
  /** Nova onda da caçada: `{ n, size }`. Vira faixa na tela e toque de trompa. */
  WAVE: "wave",
  /**
   * A caçada acabou: a quinta onda esgotou.
   * `{ ranking: [{ id, name, color, boars }, ...] }`, do maior abatedor ao
   * menor. Vira a tela de vitória — os porcos que sobraram continuam vivos.
   */
  HUNT_OVER: "huntOver",
  /** Transformações dos alces, 10 Hz — com a fração de vida de cada um. */
  ELKS: "elks",
  /** Alce levou uma flecha: `{ id, health, killer }` — dor, não morte. */
  ELK_HIT: "elkHit",
  /** Alce derrubado: `{ id, killer, points }`. */
  ELK_DEATH: "elkDeath",
  /** Alce chifrou alguém: a morte vem pela mensagem `KILL`, esta é o aviso. */
  ELK_GORE: "elkGore",
  /** Caídos e fim da caçada ao alce. Ver `Room.elkStatus()`. */
  ELK_STATUS: "elkStatus",
  /**
   * A caçada ao alce acabou.
   * `{ reason: "win"|"wipe", ranking?, finisher? }`.
   * Vitória carrega o placar de flechas e quem deu o golpe final.
   */
  ELK_OVER: "elkOver",
  /** Transformações dos pássaros, 10 Hz. */
  BIRDS: "birds",
  /** Pássaro abatido: `{ id, killer, points }`. */
  BIRD_DEATH: "birdDeath",
  /**
   * O mundo recomeçou (troca de modo).
   *
   * Existe porque "trocar de modo" passou a significar recomeçar de verdade:
   * bichos, flechas cravadas e placar. Sem uma mensagem própria, cada cliente
   * teria de deduzir isso da mudança de modo — e deduzir dá margem a cada um
   * limpar uma coisa diferente.
   */
  WORLD_RESET: "worldReset",
  /** O alvo da vez na série (ou null quando o modo sai). */
  SERIES: "series",
  /** Alvo da série derrubado — explosão, pontos e o próximo. */
  SERIES_HIT: "seriesHit",
  /**
   * A série acabou: o último alvo caiu.
   * `{ ranking: [{ id, name, color, targets, points }, ...] }`.
   */
  SERIES_OVER: "seriesOver",
  /** Vento na flecha (sala): `{ on, silent? }`. */
  WIND: "wind",
  /** Placar completo (sempre que muda). */
  SCORES: "scores",
  /** Alguém zerou o placar: `{ by }`. */
  SCORES_RESET: "scoresReset",
  /** Transformações dos zumbis, 10 Hz: `{ z: [...] }`. */
  ZOMBIES: "zombies",
  /** Zumbi derrubado: `{ id, killer, points, head }`. `head` = pegou fogo. */
  ZOMBIE_DEATH: "zombieDeath",
  /** Horda nova: `{ n, size, boss? }`. Vira a faixa "HORDA n" na tela. */
  HORDE: "horde",
  /** Estado das quatro tochas: `{ t4: [true,true,false,true] }`.
   *  A chave é `t4` e não `t` porque `t` é o tipo da mensagem — ver o cabeçalho. */
  TORCHES: "torches",
  /** Vidas, caídos e contadores do modo zumbi. Ver `Room.zombieStatus()`. */
  ZOMBIE_STATUS: "zombieStatus",
  /** Acabou: `{ reason, horde, ranking? }`. Todos caíram, ou a horda 10 foi
   *  vencida — só a vitória carrega `ranking` (abates e mortes de cada um),
   *  para a tela final. */
  ZOMBIE_OVER: "zombieOver",
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
    l: r3(player.reloadFraction ?? 0),
    k: r3(player.knifeFraction ?? 0),
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
  out.reloadFraction = state.l ?? 0;
  out.knifeFraction = state.k ?? 0;
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
export const elkEntity = (id) => `e${id}`;
export const birdEntity = (id) => `v${id}`; // v de "voador": o `b` já é do porco
export const zombieEntity = (id) => `z${id}`;
export const torchEntity = (id) => `t${id}`;

/** O caminho de volta: `"p3"` → `3`. Devolve null se não for de jogador. */
export function playerIdFrom(entityId) {
  return idFrom(entityId, "p");
}

/** `"b7"` → `7`. */
export function boarIdFrom(entityId) {
  return idFrom(entityId, "b");
}

/** `"e2"` → `2`. */
export function elkIdFrom(entityId) {
  return idFrom(entityId, "e");
}

/** `"v9"` → `9`. */
export function birdIdFrom(entityId) {
  return idFrom(entityId, "v");
}

/** `"z12"` → `12`. */
export function zombieIdFrom(entityId) {
  return idFrom(entityId, "z");
}

/** `"t2"` → `2`. */
export function torchIdFrom(entityId) {
  return idFrom(entityId, "t");
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
