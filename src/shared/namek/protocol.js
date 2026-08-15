/* ---------------------------------------------------------------------------
   O protocolo de Namekusei — importado pelo cliente E pela sala.

   **Separado do protocolo do arqueiro, de propósito.** As duas salas nunca
   trocam mensagem: uma conexão entra numa ou na outra e morre lá. Compartilhar
   a tabela de tipos criaria a dependência que o §0 do plano existe para evitar
   — a primeira mensagem nova daqui obrigaria a subir a `PROTOCOL_VERSION` de lá,
   e uma aba do vale seria recusada por causa de uma bola de ki.

   As convenções são as MESMAS do outro protocolo, e isso não é contradição: são
   convenções boas e o repositório inteiro as segue. Vale a pena repetir a mais
   importante — **`t` é sempre o TIPO da mensagem, nunca um tempo.** Instantes
   usam `w`.

   Coordenadas viajam como `[x, y, z]`. Chaves curtas no que sai 20 vezes por
   segundo, longas no que sai uma vez na vida.
   --------------------------------------------------------------------------- */

/**
 * Sobe quando o formato quebra. A sala recusa quem não bate.
 *
 * 1 — o modo nasceu.
 */
export const NAMEK_PROTOCOL_VERSION = 1;

/** O que o `hello` precisa carregar para cair NESTA sala e não na do arqueiro. */
export const NAMEK_LEVEL = "namek";
export const NAMEK_MODE = "deathmatch";

/* --------------------------------------------------------- cliente → servidor */

export const NC2S = {
  /** Entrada: `{ name, version, level, mode, char }`.
   *  `level`/`mode` são o que faz o `RoomHost` rotear para cá. */
  HELLO: "hello",

  /** Pose própria, 20 Hz: `{ s: packFighter(), w }`. */
  STATE: "state",

  /** Rajada básica: `{ id, o:[x,y,z], d:[x,y,z], hand, target, w }`.
   *
   *  `target` é o id escolhido NO DISPARO e nunca reavaliado (§6.1): quem manda
   *  é quem atirou, e mandá-lo junto é o que faz a bola perseguir a mesma
   *  pessoa em todas as telas. Sem ele, cada cliente escolheria o alvo mais
   *  perto do SEU ponto de vista e a mesma bola voaria para lados diferentes. */
  BLAST: "blast",

  /** "A minha bola acertou": `{ id, victim, p:[x,y,z] }`.
   *  Mesmo contrato do `C2S.IMPACT` do arqueiro — quem atira é a autoridade
   *  sobre o próprio acerto; a sala é a autoridade sobre a vida. */
  BLAST_HIT: "blastHit",

  /** Especial disparado: `{ kind, o:[x,y,z], d:[x,y,z], w }`.
   *  A direção é TRAVADA aqui: girar depois não entorta o feixe. */
  SPECIAL: "special",

  /** "O meu especial está queimando fulano": `{ victim, kind, dt }`.
   *  `dt` são os segundos de exposição desde o último aviso — é assim que um
   *  feixe SUSTENTADO cobra por segundo sem mandar uma mensagem por quadro. */
  SPECIAL_HIT: "specialHit",

  /** "O meu golpe bateu no chão aqui": `{ p:[x,y,z], power }`.
   *  Vira cratera para a sala inteira. Ver §7 do plano. */
  GROUND_HIT: "groundHit",

  /** "Quebrei este objeto do cenário": `{ kind, i }`.
   *  `kind` é "rocha" | "arvore" | "casa"; `i` é o índice na instância. */
  PROP_HIT: "propHit",

  /** Onda de empurrão: `{ p:[x,y,z] }`. Custa ki e empurra quem está perto. */
  BURST: "burst",

  /** "Caí de muito alto": `{ p:[x,y,z], speed }`. Cratera + poeira + dano. */
  SLAM: "slam",

  /** Pedido de renascimento antecipado (depois do tempo mínimo). */
  RESPAWN: "respawn",

  /** Põe ou tira um bot: `{ remove?: boolean }`. */
  BOT: "bot",

  /** Muda o clima da sala: `{ id: "dia"|"tempestade" }`. Vale para todos. */
  WEATHER: "weather",

  /** Sincronismo de relógio: `{ c: clientClock }`. */
  PING: "ping",
};

/* --------------------------------------------------------- servidor → cliente */

export const NS2C = {
  /** Aceito: `{ you, time, weather, fighters, craters, scores }`.
   *  `craters` é a lista INTEIRA — é o que faz quem entra no meio ver o chão
   *  já deformado (critério 6 do §12). */
  WELCOME: "welcome",
  /** Recusado: `{ reason, players, max }`. */
  REJECT: "reject",

  /** Alguém entrou: `{ fighter }`. */
  JOIN: "join",
  /** Alguém saiu: `{ id, name }`. */
  LEAVE: "leave",

  /** Poses de todos os OUTROS, 20 Hz.
   *
   *  `{ time, s: [ { id, w, ...packFighter() }, ... ] }` — a pose vem
   *  **ACHATADA** dentro da entrada, não aninhada num campo `s`. Fica dito em
   *  letra e não em reticências porque as duas metades já divergiram aqui uma
   *  vez: a sala achatava, o cliente procurava `entrada.s`, e o resultado foi
   *  cinco lutadores existindo, brigando e perdendo vida — todos parados na
   *  origem do mundo. Nenhum erro em lugar nenhum.
   *
   *  Achatada porque é mais barata: são 15 poses 20 vezes por segundo, e o
   *  objeto intermediário custaria três bytes por lutador por pacote para não
   *  dizer nada.
   *
   *  E ela vem PODADA: todo canal que valha o padrão é omitido (ver
   *  `unpackFighter`, que por isso lê tudo com `?? 0`). Numa sala de quinze isso
   *  cortou a descida de 55,6 para 41,0 KB/s. */
  STATES: "states",

  /** Vida e ki de todos, 10 Hz: `{ h: [[id, health, ki], ...] }`.
   *  Num array de arrays e não de objetos: 15 lutadores a 10 Hz são a segunda
   *  mensagem mais cara do modo, e as chaves seriam metade dos bytes. */
  VITALS: "vitals",

  /** Retransmissão de rajada, com `owner`. */
  BLAST: "blast",
  /** Retransmissão de especial, com `owner`. */
  SPECIAL: "special",
  /** Retransmissão da onda, com `owner`. */
  BURST: "burst",

  /** Alguém levou dano: `{ id, health, by, amount, kind }`.
   *  Vira o clarão vermelho, o número subindo e a pose de dor. */
  HURT: "hurt",

  /** Morte confirmada: `{ victim, killer, kind, p:[x,y,z], d:[x,y,z] }`.
   *  `d` é a direção do golpe — é ela que joga o corpo para o lado certo. */
  DEATH: "death",

  /** Onde renascer: `{ id, p:[x,y,z], yaw, invulnUntil }`. */
  SPAWN: "spawn",

  /** Cratera nova, para todos: `{ i, p:[x,y,z], power, by }`.
   *  `i` é o id da sala — é ele que deixa o cliente reaplicar sem duplicar.
   *  `by` é quem a abriu (ou null): quem atirou já tocou o próprio estouro no
   *  instante do impacto, e sem este campo ele o tocaria de novo ao receber o
   *  carimbo de volta. */
  CRATER: "crater",

  /** Objeto do cenário quebrado: `{ kind, i, by }`. */
  PROP_DOWN: "propDown",

  /** Clima: `{ id, w }`. `w` é o instante em que a transição começou. */
  WEATHER: "weather",

  /** Raio da tempestade: `{ p:[x,z], w }`. A sala decide para todos verem o
   *  mesmo relâmpago no mesmo lugar — meio do céu piscando em horas diferentes
   *  em cada tela seria o oposto de um planeta explodindo JUNTO. */
  BOLT: "bolt",

  /** Placar completo (sempre que muda): `{ s: [{id, name, kills, deaths}] }`. */
  SCORES: "scores",

  /** Resposta do sincronismo: `{ c, s }`. */
  PONG: "pong",
};

export const NamekReject = {
  FULL: "full",
  VERSION: "version",
  KEY: "key",
};

/* ------------------------------------------------------------------ estado -- */

/**
 * A pose de um lutador, compactada.
 *
 * O princípio é o mesmo do `packState` do arqueiro, e ele é a razão de a rede
 * deste modo ser barata: **o corpo é montado por procedimento nos dois lados**,
 * então não se transmite osso nenhum — só os relógios que alimentam as poses.
 *
 * Treze números e dois bits por lutador, 20 vezes por segundo. Com 15 em campo
 * dá ~9 KB/s de descida por cliente, que é a mesma ordem do jogo do arqueiro.
 */
export function packFighter(f) {
  return {
    p: r3v(f.position),
    /** velocidade — o interpolador precisa dela para extrapolar sem borracha */
    v: r2v(f.velocity),
    y: r3(f.yaw),
    i: r3(f.pitch),
    /** rolagem: o lutador INCLINA na curva, e sem isso o voo fica de trilho */
    r: r3(f.roll ?? 0),
    /** fase da marcha/corrida */
    g: r3(f.gaitPhase ?? 0),
    /** 0 andando … 1 correndo */
    n: r3(f.runBlend ?? 0),
    /** 0 no chão … 1 voando */
    fl: r3(f.flyBlend ?? 0),
    /** 0 … 1 — o quanto o arranque de ki está aceso */
    bo: r3(f.boostBlend ?? 0),
    /** 0 … 1 — a pose de carregar ki */
    ch: r3(f.chargeBlend ?? 0),
    /** fração da animação do especial em curso; 0 quando não há */
    sp: r3(f.specialFraction ?? 0),
    /** qual especial está sendo feito — índice em `NAMEK.specialOrder`, -1 = nenhum */
    sk: f.specialIndex ?? -1,
    /** 0 … 1 — a pose de dor, decaindo */
    hu: r3(f.hurtBlend ?? 0),
    /** mão que atirou por último e há quanto tempo: alimenta o braço estendido */
    ha: f.lastHand ?? 0,
    hp: r3(f.handPose ?? 0),
    /** bits: 1 = caído, 2 = invulnerável (piscando) */
    b: (f.down ? 1 : 0) | (f.invuln ? 2 : 0),
  };
}

/**
 * Escreve um `packFighter()` numa amostra do buffer de interpolação.
 *
 * **Todo campo é opcional.** A sala poda da mensagem tudo o que valha o padrão
 * (ver `NS2C.STATES`), então uma pose legítima pode chegar sem `v`, sem `y` e
 * sem mais nada além da posição. Ler qualquer um deles direto produz `undefined`
 * — e `undefined` em conta de interpolação vira `NaN`, que é a pior falha
 * possível aqui: o corpo some da tela sem erro nenhum, porque o Three.js
 * simplesmente não desenha uma matriz com `NaN`. Daí o `?? 0` em tudo, inclusive
 * nos vetores.
 */
export function unpackFighter(s, out) {
  const p = s.p ?? VEC_ZERO;
  const v = s.v ?? VEC_ZERO;
  out.x = p[0] ?? 0;
  out.y = p[1] ?? 0;
  out.z = p[2] ?? 0;
  out.vx = v[0] ?? 0;
  out.vy = v[1] ?? 0;
  out.vz = v[2] ?? 0;
  out.yaw = s.y ?? 0;
  out.pitch = s.i ?? 0;
  out.roll = s.r ?? 0;
  out.gaitPhase = s.g ?? 0;
  out.runBlend = s.n ?? 0;
  out.flyBlend = s.fl ?? 0;
  out.boostBlend = s.bo ?? 0;
  out.chargeBlend = s.ch ?? 0;
  out.specialFraction = s.sp ?? 0;
  out.specialIndex = s.sk ?? -1;
  out.hurtBlend = s.hu ?? 0;
  out.lastHand = s.ha ?? 0;
  out.handPose = s.hp ?? 0;
  const b = s.b ?? 0;
  out.down = (b & 1) === 1;
  out.invuln = (b & 2) === 2;
  return out;
}

/** Lido quando a pose chega sem posição ou sem velocidade. Ver `unpackFighter`. */
const VEC_ZERO = [0, 0, 0];

/* -------------------------------------------------------------------- ids --- */

/*
 * Espaço de nomes PRÓPRIO. Os ids do arqueiro (`p3`, `b7`) não circulam aqui e
 * os daqui não circulam lá — as duas salas não se falam —, mas o prefixo
 * continua valendo a pena pelo motivo de sempre: um log de rede em que se lê
 * `k4` e `q12` se explica sozinho.
 */
/** `k` de Kakarot: um lutador. */
export const fighterEntity = (id) => `k${id}`;
/** `q` de ki: uma bola em voo. */
export const blastEntity = (id) => `q${id}`;

/* ------------------------------------------------------------------ nomes --- */

/* A limpeza de nome é a MESMA do arqueiro, e é importada de lá em vez de
   copiada: é a única coisa deste protocolo que já existe pronta, é código de
   segurança (as faixas de caractere invisível), e duas cópias de uma defesa são
   uma defesa que envelhece em metades. Importar não acopla nada — `protocol.js`
   é puro e não conhece sala nenhuma. */
export { sanitizeName, displayName } from "../protocol.js";

/* ---------------------------------------------------------------- vetores --- */

const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;

/** Posição com precisão de milímetro. */
export function r3v(v) {
  return [r3(v.x), r3(v.y), r3(v.z)];
}

/** Velocidade com precisão de centímetro por segundo: de sobra, e menos bytes.
 *  Ela só alimenta extrapolação de 100 ms — o terceiro decimal ali é ruído. */
export function r2v(v) {
  return [r2(v.x), r2(v.y), r2(v.z)];
}

export function vecFrom(a) {
  return { x: a[0], y: a[1], z: a[2] };
}
