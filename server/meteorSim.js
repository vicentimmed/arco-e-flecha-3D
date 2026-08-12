/* ---------------------------------------------------------------------------
   A chuva de meteoros, no servidor.

   Rochas em chamas caem sobre a base lunar. Uma que encoste no chão mata todo
   mundo e encerra a partida — e é essa regra, e não a quantidade, que organiza
   o resto do arquivo.

   Ela tem duas consequências que vale enunciar antes do código:

   • **A falha é coletiva e definitiva.** No modo zumbi você morre e volta em
     10 s. Aqui um erro de contagem termina a partida de quatro pessoas. Por
     isso a taxa de flechas exigida fica confortavelmente ABAIXO da capacidade
     do jogador, nunca colada nela (ver `hordeMix` e `hordeGaps` no config).

   • **A dificuldade é CONCORRÊNCIA.** O que aperta não é o tamanho da horda, é
     quantas rochas estão no ar ao mesmo tempo — que é `prazo de queda ÷
     intervalo de entrada`. É a mesma lição que `ZombieNight` aprendeu com o
     `hordeArrivalGaps`, e aqui ela já nasce embutida: o intervalo é o número
     que se ajusta, e o prazo sai da velocidade de queda.

   O padrão é o de `zombieSim.js`: aqui se simula, a sala transmite a 10 Hz, e o
   cliente reconcilia por id. Este módulo é PURO — só `CONFIG` e o campo de
   altura —, o que permite rodá-lo num script de bancada sem cliente nenhum.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../src/config.js";

let proximoId = 1;

const TAU = Math.PI * 2;
const faixa = (min, max) => min + Math.random() * (max - min);
const r = (v) => Math.round(v * 100) / 100;

/**
 * Uma rocha caindo.
 *
 * A velocidade é CONSTANTE, e não queda livre. Com g = 1,62 os primeiros dez
 * segundos seriam quase parados e ela chegaria acelerando bem na hora em que
 * mirar fica difícil: a parte visível seria justamente a parte em que nada
 * acontece. Constante, a antecipação vira algo que se APRENDE — que é o que
 * separa um modo de perícia de um modo de sorte.
 *
 * (Fisicamente também não é violência: um meteoroide chega à Lua com a própria
 * velocidade orbital, não com a que a gravidade lunar lhe deu.)
 */
export class FallingMeteor {
  /**
   * @param {object} terrain campo de altura da fase
   * @param {{x:number,z:number}} alvo onde ela vai bater
   * @param {number} raio m
   * @param {number} hits flechas para estourar
   * @param {number} velocidade m/s
   */
  constructor(terrain, alvo, raio, hits, velocidade) {
    const M = CONFIG.modes.meteorRain;
    this.id = proximoId++;
    this.terrain = terrain;
    this.kind = "meteor";
    this.raio = raio;
    this.maxHits = hits;
    this.hits = 0;
    this.dead = false;
    this.landed = false;
    this.formato = Math.floor(Math.random() * 3);

    this.alvoX = alvo.x;
    this.alvoZ = alvo.z;
    this.chaoY = terrain.heightAt(alvo.x, alvo.z);

    /* A entrada é INCLINADA. A queda a prumo lê como elevador; inclinada, a
       rocha risca o campo de estrelas — e ganha uma componente horizontal de
       antecipação sem complicar a mira de ninguém. */
    const altura = M.spawnAltitude + faixa(-M.altitudeJitter, M.altitudeJitter);
    const tilt = faixa(M.entryTiltMin, M.entryTiltMax);
    const azimute = Math.random() * TAU;
    const recuo = Math.tan(tilt) * altura;

    this.x = alvo.x + Math.cos(azimute) * recuo;
    this.z = alvo.z + Math.sin(azimute) * recuo;
    this.y = this.chaoY + altura;

    /* A velocidade pedida é a de DESCIDA; a inclinação acrescenta caminho, não
       tempo. Assim o prazo de queda é `altura ÷ velocidade` qualquer que seja o
       ângulo sorteado — e o prazo é o número que a dificuldade usa. */
    this.vy = -velocidade;
    this.vx = (alvo.x - this.x) / (altura / velocidade);
    this.vz = (alvo.z - this.z) / (altura / velocidade);
  }

  /** Metros até o chão sob ela. É o que o alerta da tela lê. */
  get altitude() {
    return this.y - this.chaoY;
  }

  /** @returns {"landed"|null} */
  update(dt) {
    if (this.dead) return null;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
    /* O contato é medido pela BARRIGA da rocha, não pelo centro: uma pedra de
       14 m de raio cujo centro chega ao chão já enterrou metade dela antes de
       "encostar", e a explosão sairia tarde. */
    if (this.y - this.raio * 0.6 <= this.chaoY) {
      this.y = this.chaoY + this.raio * 0.6;
      this.landed = true;
      return "landed";
    }
    return null;
  }

  /**
   * Uma flecha entrou.
   *
   * Qualquer flecha, em qualquer tensão, em qualquer parte da rocha tira
   * exatamente um. Sem cabeça, sem crítico, sem bônus de tensão — o oposto do
   * zumbi, e de propósito: aqui a decisão do jogador já é "qual das quatro" e
   * "quando", e somar "onde" e "com quanta força" seria um cálculo que não cabe
   * nos doze segundos de prazo.
   *
   * @param {number} [dano] em flechas. Só o especial passa outra coisa que
   *   não 1 — ver `Room.registerMeteorHit`.
   * @returns {{morreu:boolean, left:number}}
   */
  atingir(dano = 1) {
    if (this.dead) return { morreu: false, left: 0 };
    // Preso no total: um golpe que vale mais do que a rocha tinha não pode
    // deixar `hits` acima de `maxHits` — é dele que sai o `hp` da barra e o
    // `gasto` que a sala converte em carga do especial.
    this.hits = Math.min(this.maxHits, this.hits + dano);
    const left = Math.max(0, this.maxHits - this.hits);
    if (left <= 0) {
      this.dead = true;
      return { morreu: true, left: 0 };
    }
    return { morreu: false, left };
  }

  /** O especial atravessa: destrói qualquer rocha, seja qual for a vida. */
  vaporizar() {
    if (this.dead) return false;
    this.hits = this.maxHits;
    this.dead = true;
    return true;
  }

  view() {
    return {
      i: this.id,
      p: [r(this.x), r(this.y), r(this.z)],
      r: r(this.raio),
      k: this.maxHits,
      hp: this.maxHits > 0 ? Math.round((1 - this.hits / this.maxHits) * 100) / 100 : 0,
      f: this.formato,
      // Onde ela vai bater: é a mancha no chão do cliente, e é ela que faz o
      // impacto ser justo — ninguém morre sem ter tido onde ler o aviso.
      a: [r(this.alvoX), r(this.chaoY), r(this.alvoZ)],
    };
  }
}

/** O colosso: Ø 28 m, dezenas de flechas, e desce sozinho. */
export class TankMeteor extends FallingMeteor {
  constructor(terrain, alvo, hits, velocidade) {
    super(terrain, alvo, CONFIG.modes.meteorRain.tankRaio, hits, velocidade);
    this.kind = "tank";
  }
}

/* ------------------------------------------------------------------ a chuva */

export class MeteorRain {
  constructor(terrain) {
    this.setTerrain(terrain);
  }

  setTerrain(terrain) {
    this.terrain = terrain;
    /** @type {FallingMeteor[]} */
    this.meteors = [];
    this.active = false;
    this.horde = 0;
    this.over = false;
    this.overReason = null;
    this.playerCount = 1;
    /** @type {{timer:number, classe:number, tank?:boolean}[]} */
    this.pending = [];
    this.hordeTimer = 0;
    /** Segundos até a horda 1. Ver `startsAt` e o comentário em `start`. */
    this.countdown = 0;
    /** Fase do ato do tanque: 0 = chuva, 1 = espera, 2 = colosso em campo. */
    this.tankPhase = 0;
    this.tankTimer = 0;
    this.drizzleTimer = 0;
    this.impact = null;
  }

  get vivos() {
    return this.meteors.reduce((n, m) => n + (m.dead ? 0 : 1), 0);
  }

  get tankAtivo() {
    return this.meteors.some((m) => m.kind === "tank" && !m.dead);
  }

  /** O colosso em campo, se houver. É dele que sai a barra de vida do HUD. */
  get tank() {
    return this.meteors.find((m) => m.kind === "tank" && !m.dead) ?? null;
  }

  /**
   * Quantos jogadores contam para a escala.
   *
   * Acima de seis o gap fica abaixo de um segundo e o céu vira uma parede:
   * deixa de ser um modo de perícia e vira um modo de sorte.
   */
  escala() {
    const M = CONFIG.modes.meteorRain;
    const n = Math.min(this.playerCount, M.playerScaleMax);
    return 1 + M.playerScale * Math.max(0, n - 1);
  }

  fallSpeed(n) {
    const lista = CONFIG.modes.meteorRain.fallSpeeds;
    return lista[Math.max(0, Math.min(lista.length, n) - 1)] ?? lista[lista.length - 1];
  }

  gap(n) {
    const lista = CONFIG.modes.meteorRain.hordeGaps;
    const base = lista[Math.max(0, Math.min(lista.length, n) - 1)] ?? lista[lista.length - 1];
    return base / this.escala();
  }

  /** A composição da horda, já multiplicada pelos jogadores. */
  mixDe(n) {
    const M = CONFIG.modes.meteorRain;
    const base = M.hordeMix[Math.max(0, Math.min(M.hordeMix.length, n) - 1)] ?? { p: 0, m: 0, g: 0 };
    const k = this.escala();
    return {
      p: Math.ceil(base.p * k),
      m: Math.ceil(base.m * k),
      g: Math.ceil(base.g * k),
    };
  }

  temTanque(n) {
    return CONFIG.modes.meteorRain.tankHordes.includes(n);
  }

  /**
   * Vida do colosso.
   *
   * Escala LINEARMENTE com os jogadores, ao contrário da chuva (0,70). Não é
   * inconsistência: nele nenhuma flecha é desperdiçada — são todas necessárias,
   * venham de quem vierem —, então não há perda de coordenação a compensar. É a
   * mesma lógica do `arrowsToKillPerPlayer` do chefão zumbi.
   */
  tankHits(n) {
    const M = CONFIG.modes.meteorRain;
    const base = M.tankHits[n] ?? 10;
    return Math.round(base * (1 + M.tankPlayerScale * Math.max(0, this.playerCount - 1)));
  }

  /**
   * Começa a partida — mas não a horda.
   *
   * Os dez segundos de contagem existem porque quem acabou de sair de uma tela
   * de carregamento não sabe para onde está olhando, onde é a base nem onde
   * estão os outros. É o tempo de girar a câmera uma vez e levantar a cabeça.
   * Sem isso a horda 1 pega o jogador de costas — e "de costas" neste modo é a
   * coisa que o alerta da tela inteiro existe para evitar.
   */
  start(nPlayers = 1) {
    const M = CONFIG.modes.meteorRain;
    this.playerCount = Math.max(1, nPlayers | 0);
    this.active = true;
    this.over = false;
    this.overReason = null;
    this.meteors = [];
    this.pending = [];
    this.horde = 0;
    this.hordeTimer = 0;
    this.tankPhase = 0;
    this.tankTimer = 0;
    this.drizzleTimer = 0;
    this.impact = null;
    this.countdown = M.startDelay;
  }

  stop() {
    this.active = false;
    this.meteors = [];
    this.pending = [];
    this.horde = 0;
    this.countdown = 0;
    this.tankPhase = 0;
    this.over = false;
    this.overReason = null;
    this.impact = null;
  }

  /**
   * Sorteia onde uma rocha vai bater.
   *
   * Perto da base, sempre — é o pedido, e é o que mantém a chuva inteira no
   * campo de visão de quem defende. E longe das outras: com rochas de até 12 m
   * de diâmetro, dois pontos vizinhos produzem duas silhuetas sobrepostas que o
   * jogador lê como UMA, e aí ele atira uma flecha achando que resolveu duas.
   */
  sortearAlvo(raio) {
    const M = CONFIG.modes.meteorRain;
    const base = CONFIG.levels.moon.base;

    for (let tentativa = 0; tentativa < M.separationTries; tentativa++) {
      const dentro = Math.random() < M.dropInnerChance;
      const rMax = dentro ? M.dropInnerRadius : M.dropOuterRadius;
      const rMin = dentro ? 0 : M.dropInnerRadius;
      // Raiz no raio: sem ela o sorteio se acumula no centro, porque a área de
      // um anel cresce com o raio.
      const d = Math.sqrt(rMin * rMin + Math.random() * (rMax * rMax - rMin * rMin));
      const ang = Math.random() * TAU;
      const x = base.x + Math.cos(ang) * d;
      const z = base.z + Math.sin(ang) * d;

      if (this.longeDasOutras(x, z, raio)) return { x, z };
      // Última tentativa: aceita assim mesmo. Uma sobreposição é ruim; uma
      // rocha que não nasce porque o sorteio desistiu é pior.
      if (tentativa === M.separationTries - 1) return { x, z };
    }
    return { x: base.x, z: base.z };
  }

  longeDasOutras(x, z, raio) {
    const folga = CONFIG.modes.meteorRain.minSeparation;
    for (const m of this.meteors) {
      if (m.dead) continue;
      const d = Math.hypot(m.alvoX - x, m.alvoZ - z);
      if (d < m.raio + raio + folga) return false;
    }
    return true;
  }

  /** Enfileira a horda `n`. @returns {{n,size,tank}} para a faixa na tela */
  nextHorde() {
    const M = CONFIG.modes.meteorRain;
    if (this.horde >= M.hordes) return null;
    this.horde++;

    const mix = this.mixDe(this.horde);
    const gap = this.gap(this.horde);
    const classes = [];
    for (let i = 0; i < mix.p; i++) classes.push(0);
    for (let i = 0; i < mix.m; i++) classes.push(1);
    for (let i = 0; i < mix.g; i++) classes.push(2);

    /* Embaralha para as grandes não caírem todas no fim: com a ordem crua, a
       horda inteira seria pequena até o último terço e aí viraria outra coisa.
       Fisher–Yates, que é o único jeito de embaralhar sem viés. */
    for (let i = classes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [classes[i], classes[j]] = [classes[j], classes[i]];
    }

    this.pending = classes.map((classe, i) => ({
      timer: i * gap + (Math.random() - 0.5) * gap * 0.2,
      classe,
    }));
    this.tankPhase = 0;
    this.tankTimer = 0;
    this.drizzleTimer = 0;

    return { n: this.horde, size: classes.length, tank: this.temTanque(this.horde) };
  }

  /** Faz nascer uma rocha da classe pedida. */
  spawn(classe) {
    const M = CONFIG.modes.meteorRain;
    const c = M.classes[classe] ?? M.classes[0];
    const alvo = this.sortearAlvo(c.raio);
    const m = new FallingMeteor(
      this.terrain,
      alvo,
      c.raio,
      c.hits,
      this.fallSpeed(this.horde),
    );
    this.meteors.push(m);
    return m;
  }

  spawnTank() {
    const M = CONFIG.modes.meteorRain;
    const base = CONFIG.levels.moon.base;
    // O colosso cai no CENTRO EXATO da base: ele é o espetáculo, e espetáculo
    // tem endereço.
    const m = new TankMeteor(
      this.terrain,
      { x: base.x, z: base.z },
      this.tankHits(this.horde),
      M.tankSpeeds[this.horde] ?? 4.0,
    );
    this.meteors.push(m);
    return m;
  }

  tickPending(dt) {
    const M = CONFIG.modes.meteorRain;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const ps = this.pending[i];
      ps.timer -= dt;
      if (ps.timer > 0) continue;
      /* Teto batido: o relógio FICA PRESO EM ZERO em vez de acumular dívida
         negativa. Acumulando, a fila represada nasceria inteira no quadro em
         que a primeira vaga abrisse — e é o teto que manda numa sala cheia,
         justamente onde o céu já está mais pesado. É o mesmo cuidado de
         `ZombieNight.tickPendingSpawns`. */
      if (this.meteors.length >= M.maxEntities || this.vivos >= M.maxAlive) {
        ps.timer = 0;
        continue;
      }
      this.spawn(ps.classe);
      this.pending.splice(i, 1);
    }
  }

  /**
   * Um passo da chuva.
   *
   * @returns {{horda, venceu, impacto, estourou:Array, nasceu:boolean}}
   */
  update(dt) {
    const M = CONFIG.modes.meteorRain;
    const saida = { horda: null, venceu: false, impacto: null, estourou: [] };
    if (!this.active || this.over) return saida;

    /* ------------------------------------------------- contagem de entrada */
    if (this.countdown > 0) {
      this.countdown -= dt;
      if (this.countdown > 0) return saida;
      this.countdown = 0;
      saida.horda = this.nextHorde();
      return saida;
    }

    this.tickPending(dt);

    /* ------------------------------------------------------------- queda -- */
    for (const m of this.meteors) {
      if (m.dead) continue;
      if (m.update(dt) === "landed") {
        // Uma só basta. A partida acabou para todo mundo, e não há o que somar.
        this.impact = { x: m.alvoX, y: m.chaoY, z: m.alvoZ, raio: m.raio };
        this.over = true;
        this.overReason = "impact";
        saida.impacto = this.impact;
        return saida;
      }
    }

    // Cadáver de rocha não existe: ela estoura e some. O `estourou` já saiu no
    // acerto que a matou (ver `Room.registerMeteorHit`).
    this.meteors = this.meteors.filter((m) => !m.dead);

    /* -------------------------------------------------- o ato do colosso -- */
    if (this.temTanque(this.horde)) {
      if (this.tankPhase === 0 && this.pending.length === 0 && this.vivos === 0) {
        this.tankPhase = 1;
        this.tankTimer = M.tankDelay;
      } else if (this.tankPhase === 1) {
        this.tankTimer -= dt;
        if (this.tankTimer <= 0) {
          this.tankPhase = 2;
          this.spawnTank();
          this.drizzleTimer = M.tankDrizzleEvery;
        }
      } else if (this.tankPhase === 2 && this.tankAtivo) {
        /* Só na horda 10 a chuva não para durante o colosso. É o clímax: setenta
           segundos de fogo contínuo em algo que não morre, com a chuva pingando
           por cima. */
        if (this.horde >= M.tankDrizzleFrom) {
          this.drizzleTimer -= dt;
          if (this.drizzleTimer <= 0) {
            this.drizzleTimer = M.tankDrizzleEvery;
            if (this.vivos < M.maxAlive) this.spawn(0);
          }
        }
      }
    }

    /* --------------------------------------------------- fim da horda ---- */
    const acabouAChuva = this.pending.length === 0 && this.vivos === 0;
    const acabouOTanque = !this.temTanque(this.horde) || this.tankPhase === 2;
    if (acabouAChuva && acabouOTanque) {
      this.hordeTimer += dt;
      if (this.hordeTimer >= M.hordeDelay) {
        this.hordeTimer = 0;
        saida.horda = this.nextHorde();
        if (!saida.horda) {
          saida.venceu = true;
          this.over = true;
          this.overReason = "win";
        }
      }
    } else {
      this.hordeTimer = 0;
    }

    return saida;
  }

  byId(id) {
    return this.meteors.find((m) => m.id === id) ?? null;
  }

  /**
   * Alguém acertou uma flecha.
   *
   * @param {number} [dano] em flechas — o especial vale mais de uma
   * @returns {{meteor, morreu, left, gasto}|null} `gasto` é o quanto de vida
   *   este acerto realmente consumiu, que não é o dano quando ele sobra
   */
  hit(id, dano = 1) {
    const m = this.byId(id);
    if (!m || m.dead) return null;
    const antes = m.hits;
    const r = m.atingir(dano);
    return { meteor: m, morreu: r.morreu, left: r.left, gasto: m.hits - antes };
  }

  /** O feixe do especial passou por aqui. @returns {FallingMeteor[]} */
  vaporizarNoRaio(origem, direcao, ate, raio) {
    const mortos = [];
    for (const m of this.meteors) {
      if (m.dead) continue;
      const d = distanciaAoRaio(origem, direcao, ate, m);
      if (d <= raio + m.raio) {
        if (m.vaporizar()) mortos.push(m);
      }
    }
    return mortos;
  }

  gameOver(reason = "impact") {
    this.over = true;
    this.overReason = reason;
    this.meteors = [];
    this.pending = [];
  }

  view() {
    return this.meteors.filter((m) => !m.dead).map((m) => m.view());
  }
}

/** Distância de um centro ao segmento [origem, origem + direção·ate]. */
function distanciaAoRaio(o, d, ate, m) {
  const px = m.x - o.x;
  const py = m.y - o.y;
  const pz = m.z - o.z;
  let t = px * d.x + py * d.y + pz * d.z;
  t = Math.max(0, Math.min(ate, t));
  return Math.hypot(px - d.x * t, py - d.y * t, pz - d.z * t);
}
