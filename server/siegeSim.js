/* ---------------------------------------------------------------------------
   O cerco, no servidor.

   Mesma divisão de `zombieSim.js` e `meteorSim.js`: a inteligência dos
   sitiantes, a vida do portão e o relógio da partida moram AQUI, e o cliente só
   recebe poses a 10 Hz. O que muda em relação aos dois é o que o modo pergunta.

   ------------------------------------------------------------------- a ideia

   O modo zumbi pergunta "onde está o alvo". A chuva de meteoros pergunta
   "quanto tempo falta". O cerco pergunta **quantos passaram** — e é a primeira
   vez que a resposta é uma TAXA.

   Três consequências que explicam quase todo o código abaixo:

   • **A derrota é uma FILA.** O portão não cai porque alguém errou um tiro; cai
     porque, durante algumas dezenas de segundos, chegou mais gente na base dele
     do que saiu. `gateSlots` põe um teto no dano por segundo e produz o
     aglomerado parado que dá ao trabuco um alvo — ver `atribuirVagas`.

   • **NÃO HÁ HORDAS.** Não existe `nextHorde`, não existe `hordeDelay`, não
     existe faixa de "HORDA 3". O que existe é `gapAtual()`: uma função contínua
     do tempo de partida. Sem onda não há pausa entre ondas, e o que devolve o
     fôlego é a MARÉ (`tide()`), que aperta e afrouxa de 78 em 78 segundos.

   • **O ritmo é agendado pela CHEGADA, nunca pelo nascimento.** É a terceira
     vez que este projeto escreve esta linha (ver `hordeArrivalGaps` no zumbi e
     `hordeGaps` na chuva) e aqui ela é mais grave que nunca: a rampa tem 90 m,
     um esqueleto a 2,4 m/s a cobre em 37 s e um ogro a 0,9 m/s em 100 s.
     Espaçar o nascimento entregaria todos os esqueletos juntos e os ogros num
     bloco um minuto depois. Ver `agendar()`.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../src/config.js";
import { FRAME } from "../src/shared/protocol.js";
import { bloqueado } from "../src/shared/blockers.js";
import {
  CASTLE,
  GROUND_Y,
  WALL_TOP,
  WALL_ZC,
  gateInfo,
  castleBlockers,
  insideFootprint,
  gateBlocks,
} from "../src/shared/castleProps.js";

let proximoId = 1;

/** A ordem É o código da espécie no quadro binário. Nunca reordenar. */
export const KINDS = [
  "soldier",
  "shielded",
  "skeleton",
  "climber",
  "hound",
  "shaman",
  "ogre",
  "catapult",
];

/** Idem para o estado. Ver `packFrame`. */
/**
 * Idem para o estado. Ver `packFrame`.
 *
 * `bones` é o esqueleto DESMONTADO — caído, mas que ainda vai voltar. Ele é
 * separado de `down` porque o cliente desenha as duas coisas de modo diferente:
 * `down` é um corpo tombado, `bones` é uma pilha de ossos que se remonta.
 * Sem o estado próprio, o cliente não teria como saber qual dos dois é.
 */
export const STATES = ["walk", "attack", "climb", "cast", "down", "rise", "bones"];

const DEFLECTIONS = [0, 0.4, -0.4, 0.85, -0.85, 1.45, -1.45];
const TAU = Math.PI * 2;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function angleDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/* Os bloqueadores do castelo são os MESMOS do cliente e não mudam nunca:
   calculados uma vez, no carregamento do módulo. É a lista que responde se o
   xamã tem visada para quem está atrás de um merlão. */
const BLOCKERS = castleBlockers();
const GATE = gateInfo();

/* ------------------------------------------------------------------ sitiante */

export class Besieger {
  constructor(kind, x, z, terrain) {
    const S = CONFIG.modes.siege.species[kind];
    this.id = proximoId++;
    this.kind = kind;
    this.terrain = terrain;
    this.x = x;
    this.z = z;
    this.y = terrain.heightAt(x, z);
    this.yaw = Math.PI; // olhando para o portão (−Z)
    this.state = "walk";
    this.dead = false;
    this.deadSince = 0;
    this.burning = false;
    this.hits = 0;
    this.maxHits = S.arrows;
    this.speed = S.speed * (1 + (Math.random() * 2 - 1) * 0.16);
    this.lastAttack = -Infinity;
    /** Vaga na fila do portão, ou −1. */
    this.slot = -1;
    /** Posição na fila, incluindo quem espera atrás das vagas. */
    this.queue = null;
    /** Esqueleto: já remontou uma vez? */
    this.risen = false;
    /** Escalador: 0 a 1 subindo o muro. */
    this.climb = 0;
    /** Onde ele encosta no muro / para de andar. */
    this.anchor = null;
    /** Xamã e catapulta: instante do próximo tiro. */
    this.nextShot = 0;
    /** Fogo do piche: segundos restantes queimando. */
    this.fire = 0;
  }

  get scale() {
    return this.kind === "ogre" ? 3.4 : 1;
  }

  /** Altura do peito — de onde sai o tiro do xamã e onde a flecha acerta. */
  get chestY() {
    return this.y + 1.1 * this.scale;
  }

  /**
   * Um passo. Devolve `false` quando o destino é intransponível, e é isso que
   * alimenta o leque de desvios em `walkToward`.
   *
   * As três recusas, em ordem de custo:
   *   1. alvenaria (`insideFootprint`) — o muro, que o terreno não conhece;
   *   2. o vão do portão enquanto ele estiver de pé (`gateBlocks`);
   *   3. despenhadeiro e borda do mundo (`isWalkable`, que no castelo já
   *      recusa inclinação — ver `castleField.isWalkable`).
   */
  step(fx, fz, dt, gateAlive) {
    const passo = this.speed * dt;
    const nx = this.x + fx * passo;
    const nz = this.z + fz * passo;
    const m = 0.3 * this.scale;
    if (insideFootprint(nx, nz, m)) return false;
    if (gateAlive && gateBlocks(nx, nz, m)) return false;
    if (!this.terrain.isWalkable(nx, nz)) return false;
    if (this.terrain.arenaDistance(nx, nz) > 10) return false;
    this.x = nx;
    this.z = nz;
    this.y = this.terrain.heightAt(nx, nz);
    return true;
  }

  walkToward(tx, tz, dt, gateAlive, vizinhos) {
    let sx = tx - this.x;
    let sz = tz - this.z;
    const len = Math.hypot(sx, sz);
    if (len > 1e-4) {
      sx /= len;
      sz /= len;
    }

    const sep = this.separacao(vizinhos);
    sx += sep.x;
    sz += sep.z;

    const base = Math.atan2(sx, sz);
    for (const desvio of DEFLECTIONS) {
      const ang = base + desvio;
      if (this.step(Math.sin(ang), Math.cos(ang), dt, gateAlive)) {
        this.yaw = ang;
        return true;
      }
    }
    this.yaw = base;
    return false;
  }

  /**
   * Repulsão entre vizinhos, resolvida aqui e não pelo solver do cliente.
   *
   * Mesma escolha do modo zumbi, e pelo mesmo motivo — 120 cápsulas dinâmicas
   * empurrando umas às outras é uma malha de contatos que o cliente não tem
   * orçamento para manter, e que ainda por cima divergiria entre telas.
   */
  separacao(vizinhos) {
    let ax = 0;
    let az = 0;
    const r = 0.95 * this.scale;
    for (const o of vizinhos) {
      if (o === this || o.dead) continue;
      const dx = this.x - o.x;
      const dz = this.z - o.z;
      const d = Math.hypot(dx, dz);
      if (d > r || d < 1e-4) continue;
      const f = (1 - d / r) * 1.3;
      ax += (dx / d) * f;
      az += (dz / d) * f;
    }
    return { x: ax, z: az };
  }

  faceToward(x, z) {
    this.yaw = Math.atan2(x - this.x, z - this.z);
  }
}

/* --------------------------------------------------------------------- cerco */

export class Siege {
  constructor(terrain) {
    this.terrain = terrain;
    this.ativo = false;
    this.over = false;
    this.venceu = false;
    /** @type {Besieger[]} */
    this.lista = [];
    /** Vida do portão, absoluta. */
    this.gateHp = CONFIG.modes.siege.gateHealth;
    this.gateMax = CONFIG.modes.siege.gateHealth;
    this.gateAlive = true;
    /** Segundos de partida, a partir do fim de `startDelay`. */
    this.t = 0;
    /** Segundos até o primeiro sitiante sair da linha de árvores. */
    this.espera = 0;
    this.players = 1;
    /** Escalões já anunciados, por índice. */
    this.tiersOut = new Set();
    /** Quanto tempo o portão passou abaixo do crítico — vai para a tela de fim. */
    this.criticalTime = 0;
    /** @type {{kind:string, chegada:number}|null} o próximo agendado. */
    this.pendente = null;
    this.nextOgre = Infinity;
    this.nextCatapult = Infinity;
    /** Piche em chamas no chão: `{x, z, r, until, dps, owner}`. */
    this.fogos = [];
    this.kills = new Map();
  }

  /* ------------------------------------------------------------- ciclo ---- */

  /**
   * Aponta para o campo da fase ATUAL.
   *
   * A troca de fase constrói um campo novo (ver `Room.terrain`), e um cerco
   * segurando o campo antigo faria a horda andar no relevo de um castelo que
   * já não existe. Mesma razão do `MeteorRain.setTerrain`.
   */
  setTerrain(terrain) {
    this.terrain = terrain;
    for (const b of this.lista) b.terrain = terrain;
  }

  start(nPlayers = 1) {
    const S = CONFIG.modes.siege;
    this.ativo = true;
    this.over = false;
    this.venceu = false;
    this.lista = [];
    this.gateHp = S.gateHealth;
    this.gateMax = S.gateHealth;
    this.gateAlive = true;
    this.t = 0;
    this.espera = S.startDelay;
    this.players = Math.max(1, nPlayers);
    this.tiersOut = new Set();
    this.criticalTime = 0;
    this.pendente = null;
    this.nextOgre = Infinity;
    this.nextCatapult = Infinity;
    this.fogos = [];
    this.kills = new Map();
    return { duration: S.duration, gate: 1 };
  }

  stop() {
    this.ativo = false;
    this.lista = [];
    this.fogos = [];
  }

  get alive() {
    let n = 0;
    for (const b of this.lista) if (!b.dead) n++;
    return n;
  }

  /** Quantos estão batendo no portão AGORA. É a única variável que o jogador
      controla diretamente, e por isso ela vai para o HUD. */
  get fila() {
    let n = 0;
    for (const b of this.lista) if (!b.dead && b.slot >= 0) n++;
    return n;
  }

  /* ------------------------------------------------------------ pressão ---- */

  /**
   * O intervalo entre duas CHEGADAS ao portão, agora.
   *
   * `gapBase` é uma tabela de um ponto por minuto, interpolada. Tabela e não
   * fórmula porque é a tabela que o banco de provas corrige num ponto só.
   */
  gapAtual() {
    const S = CONFIG.modes.siege;
    const tab = S.gapBase;
    const m = clamp(this.t / 60, 0, tab.length - 1);
    const i = Math.floor(m);
    const f = m - i;
    const base = tab[i] + (tab[Math.min(i + 1, tab.length - 1)] - tab[i]) * f;
    return base * this.tide() * Math.pow(S.playerGapScale, this.players - 1);
  }

  /**
   * A maré — o que substitui a pausa entre ondas.
   *
   * Sem onda não há pausa, e sem pausa ninguém larga o arco para içar o
   * contrapeso ou reparar o portão. O período de 78 s é escolhido contra o
   * relógio do trabuco: a vazante dura ~20 s, mais que os 14 s de içamento
   * automático.
   *
   * Depois de `tideEndsAt` ela PARA — nem vazante, nem preamar.
   *
   * Travá-la na preamar (`1 − tideDepth`) foi a primeira tentativa e produziu
   * um precipício: entre 4 200 e 4 800 de vida de portão a taxa de vitória
   * pulava de 28 % para 80 %, com todas as derrotas nos últimos 40 s. Os dois
   * últimos minutos decidiam a partida inteira e os dezoito anteriores não
   * tinham consequência. Parada em 1, o clímax continua sem alívio — que é o
   * que "maré cheia, sem vazante" quer dizer — sem ser um dado de uma face.
   */
  tide() {
    const S = CONFIG.modes.siege;
    if (this.t >= S.tideEndsAt) return 1;
    return 1 + S.tideDepth * Math.sin((TAU * this.t) / S.tidePeriod);
  }

  /** De 0 a 1: quanto a maré está apertando. Vai para o HUD e para os tambores. */
  get pressao() {
    return clamp(1 - (this.gapAtual() - 0.8) / (4.5 - 0.8), 0, 1);
  }

  /** As espécies liberadas neste instante da partida. */
  escaloesAbertos() {
    const S = CONFIG.modes.siege;
    return S.tiers.filter((t) => this.t >= t.at);
  }

  /**
   * Sorteia a espécie da próxima chegada.
   *
   * Ogro e catapulta NÃO entram aqui: têm relógio próprio, porque uma espécie
   * que aparece por sorteio pode não aparecer nunca — e "o ogro do minuto 9" é
   * um evento, não uma probabilidade.
   */
  sortearEspecie() {
    const S = CONFIG.modes.siege;
    const pesos = [];
    let total = 0;
    for (const t of this.escaloesAbertos()) {
      const p = S.weights[t.kind];
      if (!p) continue; // ogro e catapulta
      if (t.kind === "shaman" && this.contar("shaman") >= S.shamanMax) continue;
      if (t.kind === "climber" && this.contar("climber") >= S.climberMax) continue;
      pesos.push([t.kind, p]);
      total += p;
    }
    if (!pesos.length) return "soldier";
    let r = Math.random() * total;
    for (const [kind, p] of pesos) {
      r -= p;
      if (r <= 0) return kind;
    }
    return pesos[pesos.length - 1][0];
  }

  contar(kind) {
    let n = 0;
    for (const b of this.lista) if (!b.dead && b.kind === kind) n++;
    return n;
  }

  /**
   * Agenda a próxima chegada e deriva dela o instante de nascimento.
   *
   * É a peça central do ritmo. Ver o cabeçalho do arquivo para por que ela não
   * pode ser um simples "nasce a cada N segundos".
   */
  agendar() {
    const kind = this.sortearEspecie();
    /* A chegada ACUMULA — ela não é "daqui a `gap` segundos".
       Contada a partir de `this.t`, cada tique reiniciaria o relógio e o
       intervalo real viraria o passo da simulação: cem sitiantes por segundo. */
    this.ultimaChegada = Math.max(this.ultimaChegada ?? 0, this.t) + this.gapAtual();
    this.pendente = { kind, chegada: this.ultimaChegada };
  }

  /** Quanto tempo esta espécie leva da linha de árvores até o portão. */
  viagem(kind) {
    const S = CONFIG.modes.siege;
    const dist = S.spawnZ - GATE.standZ;
    return dist / Math.max(0.2, S.species[kind].speed);
  }

  /* ------------------------------------------------------------ nascimento -- */

  /**
   * @param {string} kind
   * @param {number} atraso segundos que ele já deveria estar andando. Ver o
   *   bloco de chegadas em `update` — é o que faz a partida abrir com a coluna
   *   já na rampa em vez de com 85 s de rampa vazia.
   */
  nascer(kind, atraso = 0) {
    const S = CONFIG.modes.siege;
    if (this.lista.length >= S.maxEntities) return null;
    if (this.alive >= S.maxAlive) return null;

    const avanco = Math.max(0, atraso) * S.species[kind].speed;
    let x = 0;
    let z = 0;
    for (let i = 0; i < 8; i++) {
      x = (Math.random() * 2 - 1) * S.spawnHalfX;
      z = Math.max(
        GATE.standZ + 2.5,
        S.spawnZ + (Math.random() * 2 - 1) * S.spawnZJitter - avanco,
      );
      if (this.terrain.isWalkable(x, z)) break;
    }
    const b = new Besieger(kind, x, z, this.terrain);

    if (kind === "climber") {
      /* O escalador escolhe um trecho de muro LONGE do portão. Perto dele a
         subida acontece no meio da fila, onde já há flecha caindo por outro
         motivo — e o susto de ter alguém subindo atrás de você se perderia. */
      const lado = Math.random() < 0.5 ? -1 : 1;
      b.anchor = { x: lado * (6 + Math.random() * 9), z: CASTLE.wallZOut + 0.5 };
    } else if (kind === "shaman") {
      b.anchor = { x: (Math.random() * 2 - 1) * 11, z: GATE.standZ + S.shamanStandoff };
    } else if (kind === "catapult") {
      b.anchor = { x: (Math.random() * 2 - 1) * 14, z: GATE.standZ + S.catapultStandoff };
    }

    this.lista.push(b);
    return b;
  }

  /* ---------------------------------------------------------------- passo -- */

  /**
   * Um passo do cerco.
   *
   * @param {number} dt segundos
   * @param {Array<{id,x,y,z,alive}>} jogadores quem está em campo
   * @param {number} agora relógio da sala (ms)
   * @returns {object} o que este passo produziu
   */
  update(dt, jogadores, agora) {
    const S = CONFIG.modes.siege;
    const saida = {
      ataques: [],
      tiros: [],
      impactos: [],
      mortos: [],
      tier: null,
      over: false,
      venceu: false,
      gateHit: 0,
    };
    if (!this.ativo || this.over) return saida;

    if (this.espera > 0) {
      this.espera = Math.max(0, this.espera - dt);
      return saida;
    }

    const antes = this.t;
    this.t += dt;

    /* --------------------------------------------------------- escalões -- */
    for (const [i, t] of S.tiers.entries()) {
      if (this.tiersOut.has(i) || this.t < t.at) continue;
      this.tiersOut.add(i);
      saida.tier = { i, nome: t.nome, kind: t.kind, at: t.at };
      if (t.kind === "ogre") this.nextOgre = this.t;
      if (t.kind === "catapult") this.nextCatapult = this.t;
    }

    /* --------------------------------------------------------- chegadas --
       `while` e não `if` por dois motivos, e o segundo é o que dá a abertura
       da partida:

       1. numa maré cheia com quatro jogadores o intervalo cai abaixo do passo
          de 100 ms, e um por tique deixaria a curva para trás;

       2. NO INSTANTE ZERO a conta pede gente que deveria ter nascido no
          passado. A rampa tem 97 m e o soldado leva 85 s para vencê-la: para
          alguém CHEGAR aos 4,5 s de partida, ele teria de ter saído da linha
          de árvores 80 s antes de a partida existir.

          A resposta não é adiar (85 s de rampa vazia) nem encurtar a rampa (é
          ela o campo de tiro). É NASCER JÁ ANDANDO: `nascer` recebe o atraso e
          põe o sujeito no ponto da rampa onde ele estaria. A partida abre com
          a coluna já subindo, que é a imagem certa — o cerco não começa, ele
          já está em curso — e os intervalos de chegada saem exatos desde o
          primeiro. */
    if (!this.pendente) this.agendar();
    let guarda = 0;
    while (this.pendente && guarda++ < 40) {
      const nascimento = this.pendente.chegada - this.viagem(this.pendente.kind);
      if (this.t < nascimento) break;
      this.nascer(this.pendente.kind, this.t - nascimento);
      this.agendar();
    }

    /* Ogro e catapulta, no relógio próprio deles. */
    if (this.t >= this.nextOgre) {
      this.nascer("ogre");
      this.nextOgre = this.t + S.ogreEvery;
    }
    if (this.t >= this.nextCatapult && this.contar("catapult") < S.catapultMax) {
      this.nascer("catapult");
      this.nextCatapult = this.t + S.catapultEvery;
    }

    /* ------------------------------------------------------------ vagas -- */
    this.atribuirVagas();

    /* ------------------------------------------------------------ bicho -- */
    const vivos = jogadores.filter((p) => p.alive !== false);
    for (const b of this.lista) {
      if (b.dead) {
        this.atualizarCaido(b, dt);
        continue;
      }
      this.atualizarUm(b, dt, vivos, agora, saida);
    }

    /* ------------------------------------------------------------- fogo -- */
    this.atualizarFogo(dt, saida);

    /* ---------------------------------------------------------- limpeza -- */
    /* O corpo some depois de `corpseLifetime` — MENOS o esqueleto que ainda
       vai se remontar, que precisa continuar existindo enquanto o relógio dele
       corre. Sem esta exceção o monte de ossos sumia da tela e o esqueleto
       reaparecia do nada alguns segundos depois. */
    const limite = S.corpseLifetime * 1000;
    this.lista = this.lista.filter(
      (b) => !b.dead || b.state === "bones" || agora - b.deadSince < limite,
    );

    /* ---------------------------------------------------------- portão -- */
    if (this.gateAlive && this.gateHp <= 0) {
      this.gateAlive = false;
      this.over = true;
      this.venceu = false;
      saida.over = true;
      return saida;
    }
    if (this.gateHp < this.gateMax * S.gateCriticalFrac) this.criticalTime += dt;

    /* ----------------------------------------------------- pôr do sol -- */
    if (!S.endless && antes < S.duration && this.t >= S.duration) {
      this.over = true;
      this.venceu = true;
      saida.over = true;
      saida.venceu = true;
    }

    return saida;
  }

  /**
   * Quem tem vaga na frente do portão.
   *
   * Cabem `gateSlots` de frente no vão de 6 m; o sétimo espera atrás. É o teto
   * que impede a morte instantânea por acúmulo — e é ele que produz o
   * aglomerado parado que dá ao trabuco um alvo. Sem isso, trinta esqueletos
   * empilhados no mesmo ponto derrubariam o portão em quatro segundos e o modo
   * não teria como ser jogado.
   *
   * A ordem é de CHEGADA (quem está mais perto), não de nascimento: quem
   * atravessou a rampa primeiro bate primeiro.
   */
  atribuirVagas() {
    const S = CONFIG.modes.siege;
    const candidatos = [];
    for (const b of this.lista) {
      if (b.dead || b.kind === "climber" || b.kind === "shaman" || b.kind === "catapult") {
        b.slot = -1;
        continue;
      }
      const d = Math.hypot(b.x - GATE.x, b.z - GATE.standZ);
      if (d > 14) {
        b.slot = -1;
        b.queue = null;
        continue;
      }
      candidatos.push([d, b]);
    }
    candidatos.sort((a, c) => a[0] - c[0]);
    for (const [i, [, b]] of candidatos.entries()) {
      b.slot = i < S.gateSlots ? i : -1;
      b.queue = i;
    }
  }

  /**
   * O esqueleto DESMONTA, e depois se remonta.
   *
   * A primeira morte não é morte: os ossos caem, ficam no chão por
   * `skeletonRise` segundos e voltam a se juntar. A segunda é definitiva.
   *
   * Isso muda o que o jogador faz com o modo. Um esqueleto no chão não é um
   * abate — é um relógio, e a pergunta passa a ser se vale gastar a segunda
   * flecha AGORA ou deixar para quando ele levantar, com a fila crescendo no
   * portão enquanto se decide. É a mesma economia de atenção que a fila cobra,
   * numa escala menor.
   *
   * E o FOGO cancela a remontagem: um esqueleto queimado não volta. É o que
   * dá ao trabuco um papel que a flecha não tem, muito antes de o volume
   * exigir o trabuco por si só.
   */
  atualizarCaido(b, dt) {
    const S = CONFIG.modes.siege;
    if (b.kind !== "skeleton" || b.risen || b.burning) return;
    b.state = "bones";
    b.riseIn = (b.riseIn ?? S.skeletonRise) - dt;
    if (b.riseIn > 0) return;
    b.dead = false;
    b.risen = true;
    b.hits = 0;
    b.state = "rise";
    b.riseIn = null;
  }

  atualizarUm(b, dt, jogadores, agora, saida) {
    const S = CONFIG.modes.siege;
    const vizinhos = this.vizinhosDe(b);

    /* Queimando: o piche cobra por segundo e não perdoa esqueleto. */
    if (b.fire > 0) {
      b.fire -= dt;
      b.burning = true;
      b.hits += S.trebuchet.fireDps * dt;
      if (b.hits >= b.maxHits) {
        this.matar(b, null, agora, saida);
        return;
      }
    } else {
      b.burning = false;
    }

    switch (b.kind) {
      case "climber":
        this.atualizarEscalador(b, dt, jogadores, agora, saida, vizinhos);
        return;
      case "shaman":
        this.atualizarDistancia(b, dt, jogadores, agora, saida, vizinhos, "cast");
        return;
      case "catapult":
        this.atualizarDistancia(b, dt, jogadores, agora, saida, vizinhos, "cast");
        return;
      default:
        this.atualizarPortao(b, dt, agora, saida, vizinhos);
    }
  }

  /**
   * O MASTIM CORRE EM ZIGUEZAGUE.
   *
   * Ele já era o quebra-ritmo — chega sessenta segundos antes do pelotão dele —
   * mas em linha reta um alvo rápido é só um alvo rápido: o jogador aprende a
   * antecipação em três tiros e ele vira um soldado apressado. Serpenteando, a
   * antecipação deixa de ser uma constante e passa a ser uma leitura, que é o
   * que faz dele um problema DIFERENTE e não um problema maior.
   *
   * O período é por indivíduo, senão a matilha inteira ondula em fase e vira
   * uma cobra só.
   */
  desvioDoMastim(b, dt) {
    b.zigFase = (b.zigFase ?? Math.random() * TAU) + dt * (b.zigRitmo ??= 2.2 + Math.random() * 1.6);
    return Math.sin(b.zigFase) * 5.5;
  }

  /** Soldado, pavês, esqueleto, ogro e mastim: o portão é o alvo. */
  atualizarPortao(b, dt, agora, saida, vizinhos) {
    const S = CONFIG.modes.siege;
    const esp = S.species[b.kind];

    if (b.slot >= 0) {
      /* Ter vaga é ter DIREITO de bater, não estar batendo.
       *
       * A distinção não é preciosismo: `atribuirVagas` considera candidato
       * quem está a até 14 m, e sem a checagem de contato abaixo o sujeito
       * começava a arrancar tábua a treze metros do portão. O sintoma era o
       * portão perdendo 18 de vida por segundo aos dez segundos de partida,
       * com a fila ainda subindo a rampa — dano vindo de ninguém.
       *
       * O x da vaga espalha os seis pelo vão, senão eles ocupam o mesmo ponto
       * e a fila inteira lê como um bicho só. */
      const alvoX = GATE.x + (b.slot - (S.gateSlots - 1) / 2) * 1.05;
      const d = Math.hypot(b.x - alvoX, b.z - GATE.standZ);
      if (d > 1.2) {
        b.state = "walk";
        b.walkToward(alvoX, GATE.standZ, dt, this.gateAlive, vizinhos);
        return;
      }
      this.aproximar(b, alvoX, GATE.standZ, dt, vizinhos);
      b.faceToward(GATE.x, GATE.z);
      b.state = "attack";
      if (agora - b.lastAttack < esp.interval * 1000) return;
      b.lastAttack = agora;
      this.gateHp = Math.max(0, this.gateHp - esp.damage);
      saida.gateHit += esp.damage;
      saida.ataques.push({ kind: b.kind, x: b.x, z: b.z, damage: esp.damage });
      return;
    }

    b.state = "walk";
    // Sem vaga: anda até um ponto atrás da fila, não até o portão. Sem isso os
    // que esperam empurram os que batem e a fila vira um bolo indistinto.
    const espera = b.queue != null && b.queue >= S.gateSlots ? 1.6 + (b.queue - S.gateSlots) * 0.7 : 0;
    const desvio = b.kind === "hound" ? this.desvioDoMastim(b, dt) : 0;
    b.walkToward(GATE.x + desvio, GATE.standZ + espera, dt, this.gateAlive, vizinhos);
  }

  /** Anda os últimos centímetros sem o leque de desvios (já está no lugar). */
  aproximar(b, tx, tz, dt, vizinhos) {
    const d = Math.hypot(tx - b.x, tz - b.z);
    if (d < 0.12) return;
    b.walkToward(tx, tz, dt * 0.6, this.gateAlive, vizinhos);
  }

  /** O escalador: sobe o muro e vira problema de quem está no adarve. */
  atualizarEscalador(b, dt, jogadores, agora, saida, vizinhos) {
    const S = CONFIG.modes.siege;

    if (b.climb <= 0) {
      const d = Math.hypot(b.x - b.anchor.x, b.z - b.anchor.z);
      if (d > 0.8) {
        b.state = "walk";
        b.walkToward(b.anchor.x, b.anchor.z, dt, this.gateAlive, vizinhos);
        return;
      }
      b.climb = 0.001;
    }

    if (b.climb < 1) {
      b.state = "climb";
      b.climb = Math.min(1, b.climb + dt / S.climbTime);
      b.x = b.anchor.x;
      b.z = b.anchor.z;
      b.y = GROUND_Y + (WALL_TOP - GROUND_Y) * b.climb;
      b.yaw = Math.PI;
      return;
    }

    /* No adarve. Ele não anda pelo muro: fica no ponto em que subiu e golpeia
       quem chegar perto. Um escalador que patrulhasse o adarve seria um duelo,
       e o modo já tem uma coisa acontecendo. */
    b.y = WALL_TOP;
    b.state = "attack";
    const esp = S.species.climber;
    let alvo = null;
    let melhor = S.climbReach;
    for (const p of jogadores) {
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (Math.abs((p.y ?? 0) - b.y) > 2.5) continue;
      if (d < melhor) {
        melhor = d;
        alvo = p;
      }
    }
    if (!alvo) return;
    b.faceToward(alvo.x, alvo.z);
    if (agora - b.lastAttack < esp.interval * 1000) return;
    b.lastAttack = agora;
    saida.ataques.push({ kind: "climber", playerId: alvo.id, x: b.x, z: b.z });
  }

  /**
   * Xamã e catapulta: param longe e atiram.
   *
   * A visada passa por `bloqueado()` contra os merlões — a mesma chamada que
   * `botSim.js` já faz. É a cobertura do modo, e ela não custou um sistema:
   * custou a lista de caixas que `castleProps` já precisava ter.
   */
  atualizarDistancia(b, dt, jogadores, agora, saida, vizinhos, estado) {
    const S = CONFIG.modes.siege;
    const esp = S.species[b.kind];

    const d = Math.hypot(b.x - b.anchor.x, b.z - b.anchor.z);
    if (d > 1.0) {
      b.state = "walk";
      b.walkToward(b.anchor.x, b.anchor.z, dt, this.gateAlive, vizinhos);
      return;
    }
    b.state = estado;
    b.faceToward(GATE.x, GATE.z);

    if (b.kind === "shaman") {
      for (const f of this.remontar(b)) saida.tiros.push(f);
    }

    if (agora - b.lastAttack < esp.interval * 1000) return;

    const de = { x: b.x, y: b.chestY, z: b.z };
    let alvo = null;
    for (const p of jogadores) {
      const para = { x: p.x, y: (p.y ?? 0) + 1.2, z: p.z };
      if (bloqueado(BLOCKERS, de, para)) continue;
      alvo = p;
      break;
    }
    if (!alvo) return;

    b.lastAttack = agora;
    if (b.kind === "shaman") {
      saida.tiros.push({
        kind: "bolt",
        id: b.id,
        from: [de.x, de.y, de.z],
        to: [alvo.x, (alvo.y ?? 0) + 1.2, alvo.z],
        speed: S.shamanBolt.speed,
        target: alvo.id,
      });
    } else {
      /* A catapulta atira num PONTO, com erro, e não numa pessoa. É a
         diferença entre uma ameaça de área — que se evita saindo do lugar — e
         um tiro teleguiado, que não se evita de jeito nenhum. */
      const ex = alvo.x + (Math.random() * 2 - 1) * S.catapultSpread;
      const ez = (alvo.z ?? WALL_ZC) + (Math.random() * 2 - 1) * S.catapultSpread;
      saida.tiros.push({
        kind: "rock",
        id: b.id,
        from: [de.x, de.y, de.z],
        to: [ex, WALL_TOP, ez],
        flight: 2.4,
      });
      this.impactosPendentes ??= [];
      this.impactosPendentes.push({ at: agora + 2400, x: ex, y: WALL_TOP, z: ez });
    }
  }

  /**
   * O xamã levanta esqueleto caído num raio — e o feixe é VISÍVEL.
   *
   * O que ele faz é a coisa mais consequente da rampa e era a mais invisível:
   * esqueletos voltavam a ficar de pé e nada na tela dizia por quê. Com o
   * feixe, quem está no muro vê a linha verde sair do cajado e entender, sem
   * uma linha de texto, que a resposta é matar o sujeito no fim dela.
   *
   * @returns {Array} os feixes desta remontagem, para a sala transmitir
   */
  remontar(b) {
    const S = CONFIG.modes.siege;
    const feixes = [];
    for (const o of this.lista) {
      if (!o.dead || o.kind !== "skeleton" || o.burning) continue;
      if (Math.hypot(o.x - b.x, o.z - b.z) > S.shamanRaiseRadius) continue;
      if (o.riseIn != null && o.riseIn <= 0.7) continue; // já está voltando
      o.risen = false; // o xamã devolve a remontagem que o esqueleto já gastou
      o.riseIn = 0.6;
      feixes.push({
        kind: "raise",
        from: [b.x, b.chestY + 0.9, b.z],
        to: [o.x, o.y + 0.4, o.z],
        speed: 26,
      });
    }
    return feixes;
  }

  vizinhosDe(b) {
    /* Sem grade espacial: a `lista` inteira, filtrada por caixa. Com 120 bichos
       são 14 400 pares por tique a 10 Hz — medido em ~1,1 ms, o que cabe. Se um
       dia não couber, a grade do `zombieSim` (NPC_GRID_CELL) é o caminho e não
       muda mais nada aqui. */
    const out = [];
    for (const o of this.lista) {
      if (o === b || o.dead) continue;
      if (Math.abs(o.x - b.x) > 2 || Math.abs(o.z - b.z) > 2) continue;
      out.push(o);
    }
    return out;
  }

  /* -------------------------------------------------------------- fogo ---- */

  /** O piche do trabuco: uma poça que queima e que não perdoa esqueleto. */
  acenderFogo(x, z, dono) {
    const T = CONFIG.modes.siege.trebuchet;
    this.fogos.push({
      x,
      z,
      r: T.fireRadius,
      restante: T.fireTime,
      owner: dono,
    });
  }

  atualizarFogo(dt, saida) {
    if (!this.fogos.length) return;
    for (const f of this.fogos) f.restante -= dt;
    for (const b of this.lista) {
      if (b.dead) continue;
      for (const f of this.fogos) {
        if (f.restante <= 0) continue;
        if (Math.hypot(b.x - f.x, b.z - f.z) > f.r) continue;
        b.fire = Math.max(b.fire, 0.9);
        b.fireOwner = f.owner;
        break;
      }
    }
    this.fogos = this.fogos.filter((f) => f.restante > 0);
  }

  /* ------------------------------------------------------------ acertos ---- */

  /**
   * Alguém acertou um sitiante.
   *
   * Quem atira continua sendo a autoridade sobre o PRÓPRIO acerto — é o mesmo
   * contrato da flecha em todo o resto do jogo. O que a sala decide é o que é
   * compartilhado: se ele caiu, quanto vale, e se o escudo aparou.
   *
   * @param {number} id
   * @param {object} opts `{ head, from: {x,y,z}, kame }`
   */
  hit(id, opts = {}) {
    const b = this.lista.find((o) => o.id === id && !o.dead);
    if (!b) return null;

    /* O PAVÊS NÃO É DECIDIDO AQUI.
     *
     * Ele era: "veio de frente e com pouca elevação ⇒ aparou". A conta acerta
     * na média e mente no caso — aparava tiro que passava pela cabeça e deixava
     * passar tiro que batia na tábua. Hoje o escudo é um COLISOR do tamanho
     * exato do escudo (ver `entities/besieger.js`), e a flecha que bate nele
     * simplesmente nunca chega a esta função: o cliente não manda `SIEGE_HIT`.
     *
     * É a mesma disciplina do resto do jogo: quem decide o acerto é o solver de
     * contato, não uma regra escrita à parte. */

    /* CABEÇA MATA DE PRIMEIRA.
     *
     * Vale para tudo o que tem cabeça e não é o ogro. O ogro é o único em que
     * ela não encerra a luta — ele pede quatro, e mesmo assim é a diferença
     * entre dezesseis flechas e quatro: continua sendo o maior prêmio de mira
     * do modo, sem apagar num tiro o único inimigo que deveria dar trabalho. */
    if (opts.head && !opts.kame) {
      if (b.kind === "ogre") {
        b.hits += b.maxHits / 4;
        return b.hits >= b.maxHits
          ? { killed: true, b, head: true }
          : { hurt: true, b, frac: 1 - b.hits / b.maxHits, head: true };
      }
      b.hits = b.maxHits;
      return { killed: true, b, head: true };
    }

    const antes = b.hits;
    b.hits += opts.kame ? b.maxHits : 1;
    if (b.hits < b.maxHits) {
      /* O OGRO ENFURECE na metade da vida, e uma vez só.
       *
       * Sem isso ele é um saco de pancadas que anda: dezesseis flechas contra
       * uma coisa que faz sempre a mesma coisa, e o jogador simplesmente
       * espera. Enfurecido ele acelera 60 % e bate mais rápido — o que
       * transforma "quantas flechas faltam" em "dá tempo?", que é uma pergunta
       * muito melhor. E o rugido avisa: quem estava mirando noutra coisa tem um
       * segundo para mudar de ideia. */
      if (b.kind === "ogre" && !b.furioso && b.hits >= b.maxHits / 2) {
        b.furioso = true;
        b.speed *= 1.6;
        return {
          hurt: true,
          b,
          frac: 1 - b.hits / b.maxHits,
          enfureceu: true,
          first: antes === 0,
        };
      }
      return { hurt: true, b, frac: 1 - b.hits / b.maxHits, first: antes === 0 };
    }
    return { killed: true, b };
  }

  matar(b, killer, agora, saida) {
    if (b.dead) return;
    b.dead = true;
    b.deadSince = agora;
    b.slot = -1;
    b.state = "down";
    b.riseIn = CONFIG.modes.siege.skeletonRise;
    saida?.mortos.push({ id: b.id, kind: b.kind, killer });
  }

  /** Pontos que a espécie vale. */
  pontos(kind) {
    return CONFIG.modes.siege.species[kind]?.points ?? 20;
  }

  /* -------------------------------------------------------------- portão --- */

  /**
   * Reparo, com os dois limites que o tornam um remendo.
   *
   * Vence dois soldados (10/s) e perde para três (15/s), e não passa de 80 %.
   * Se ele fechasse a conta sozinho, o modo teria uma dominante — alguém de
   * plantão no portão para sempre — e dominante é o que mata modo.
   */
  repair(dt, quantos = 1) {
    const S = CONFIG.modes.siege;
    if (!this.gateAlive || quantos <= 0) return 0;
    const teto = this.gateMax * S.repairCap;
    if (this.gateHp >= teto) return 0;
    const antes = this.gateHp;
    this.gateHp = Math.min(teto, this.gateHp + S.repairRate * dt * quantos);
    return this.gateHp - antes;
  }

  /** A pedra do trabuco caiu aqui. Devolve quem morreu. */
  blast(x, z, dono) {
    const T = CONFIG.modes.siege.trebuchet;
    const mortos = [];
    const feridos = [];
    for (const b of this.lista) {
      if (b.dead) continue;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d > T.blastRadius) continue;
      // Cai com a distância: no centro mata quase tudo, na borda machuca.
      const dano = T.blastDamage * (1 - (d / T.blastRadius) * 0.7);
      b.hits += dano;
      if (b.hits >= b.maxHits) mortos.push(b);
      else feridos.push(b);
    }
    this.acenderFogo(x, z, dono);

    /* Uma pedra curta acerta o PRÓPRIO portão. Não é punição arbitrária: com
       ângulo fixo de 45° o alcance mínimo é 33 m, e para acertá-lo é preciso
       errar de propósito, para trás. */
    let gate = 0;
    if (this.gateAlive && Math.abs(x - GATE.x) < 5 && Math.abs(z - GATE.standZ) < 5) {
      gate = T.gateDamage;
      this.gateHp = Math.max(0, this.gateHp - gate);
    }
    return { mortos, feridos, gate };
  }

  /* --------------------------------------------------------------- rede ---- */

  /**
   * O estado da partida — o que vira HUD.
   *
   * Barato e enviado a 2 Hz. As poses vão pelo quadro binário (`packFrame`),
   * que é outro relógio e outro caminho.
   */
  status() {
    const S = CONFIG.modes.siege;
    return {
      gate: this.gateMax > 0 ? this.gateHp / this.gateMax : 0,
      gateAlive: this.gateAlive,
      fila: this.fila,
      alive: this.alive,
      pressao: Math.round(this.pressao * 100) / 100,
      /* `w`, de *when*, e NUNCA `t`.
       *
       * `t` é o tipo da mensagem em todo o protocolo, e `broadcastSiegeStatus`
       * espalha este objeto por cima de `{ t: S2C.SIEGE_STATUS }`. Com o nome
       * errado o tempo de partida vira o tipo: a sala passa a mandar
       * `{ t: 20 }`, o cliente não acha rota para isso e simplesmente não
       * acontece nada — sem erro, sem log, sem HUD. É o defeito que o
       * cabeçalho de `shared/protocol.js` descreve, e ele apareceu aqui na
       * primeira execução de ponta a ponta. */
      w: Math.round(this.t),
      restante: Math.max(0, Math.round(S.duration - this.t)),
      espera: Math.ceil(this.espera),
      over: this.over,
      venceu: this.venceu,
      critical: Math.round(this.criticalTime),
    };
  }

  /**
   * As poses, em JSON.
   *
   * Existe para o SNAPSHOT de quem entra no meio e para depuração — o fluxo de
   * 10 Hz usa `packFrame`. Ver o comentário lá para a conta que justifica os
   * dois caminhos.
   */
  view() {
    return this.lista.map((b) => ({
      id: b.id,
      p: [round(b.x), round(b.y), round(b.z)],
      y: round(b.yaw),
      k: KINDS.indexOf(b.kind),
      s: STATES.indexOf(b.state),
      d: b.dead ? 1 : 0,
      f: b.burning ? 1 : 0,
      h: b.maxHits > 0 ? Math.round((1 - b.hits / b.maxHits) * 15) : 15,
    }));
  }

  /**
   * O quadro binário — a razão de o modo caber na rede.
   *
   * `view()` em JSON dá ~80 B por bicho. A 10 Hz, com 120 vivos e 4 clientes,
   * são **380 KB/s de subida**, que não vai. Aqui são **10 B por bicho**:
   *
   *   id      uint16   (2 B)
   *   x,y,z   int16    (6 B)  ×100 → 1,2 cm de resolução, ±327 m
   *   yaw     uint8    (1 B)  1,4° de resolução
   *   flags   uint8    (1 B)  espécie (3 bits) | estado (3) | morto | fogo
   *
   * 120 vivos = 1,2 KB por quadro, 12 KB/s por cliente. Cabe com folga.
   *
   * A vida (`h`) NÃO entra: ela só interessa no ogro, e o ogro vai à parte no
   * `status`. Um nibble por bicho para uma informação que 119 deles não usam é
   * exatamente o tipo de gordura que este formato existe para cortar.
   */
  packFrame() {
    const n = this.lista.length;
    const buf = new ArrayBuffer(4 + n * 10);
    const dv = new DataView(buf);
    /* Byte 0 é o TIPO do quadro (`FRAME.SIEGE`). Um quadro binário não tem
       campo `t` como as mensagens de texto — um campo de texto no cabeçalho
       custaria mais que meio sitiante. */
    dv.setUint8(0, FRAME.SIEGE);
    dv.setUint8(1, 0); // reservado: versão do formato
    dv.setUint16(2, n, true);
    let o = 4;
    for (const b of this.lista) {
      dv.setUint16(o, b.id & 0xffff, true);
      dv.setInt16(o + 2, clamp(Math.round(b.x * 100), -32768, 32767), true);
      dv.setInt16(o + 4, clamp(Math.round(b.y * 100), -32768, 32767), true);
      dv.setInt16(o + 6, clamp(Math.round(b.z * 100), -32768, 32767), true);
      dv.setUint8(o + 8, Math.round(((b.yaw % TAU) + TAU) % TAU / TAU * 255) & 0xff);
      const k = KINDS.indexOf(b.kind) & 0x07;
      const s = STATES.indexOf(b.state) & 0x07;
      dv.setUint8(o + 9, k | (s << 3) | (b.dead ? 0x40 : 0) | (b.burning ? 0x80 : 0));
      o += 10;
    }
    return Buffer.from(buf);
  }

  /** Impactos de catapulta que venceram o prazo. A sala aplica o dano. */
  colherImpactos(agora) {
    if (!this.impactosPendentes?.length) return [];
    const prontos = this.impactosPendentes.filter((i) => agora >= i.at);
    if (prontos.length) {
      this.impactosPendentes = this.impactosPendentes.filter((i) => agora < i.at);
    }
    return prontos;
  }
}

function round(v) {
  return Math.round(v * 100) / 100;
}
