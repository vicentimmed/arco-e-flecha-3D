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
 * O nome de um nível de dificuldade, peneirado.
 *
 * Todo caminho que chega aqui vem da REDE (`C2S.METEOR_DIFFICULTY`), e uma
 * chuva dimensionada por um campo que o cliente escolheu seria uma sala inteira
 * refém de quem digitou qualquer coisa no console. O que não estiver na tabela
 * vira o padrão, calado — não há nada de útil a dizer a quem mandou lixo.
 *
 * @param {unknown} nivel
 * @returns {"easy"|"normal"|"hard"}
 */
export function meteorDifficultyOf(nivel) {
  const M = CONFIG.modes.meteorRain;
  return typeof nivel === "string" && M.difficulties[nivel] ? nivel : M.defaultDifficulty;
}

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
  /**
   * @param {{altitude?:number, tiltMin?:number, tiltMax?:number}} [entrada] a
   *   geometria de entrada, quando ela não é a padrão. Só o colosso passa isto:
   *   ele nasce 75 m mais alto e com a entrada mais em pé, para que os metros
   *   extras apareçam como ALTURA e não como afastamento — ver `tankAltitude`.
   */
  constructor(terrain, alvo, raio, hits, velocidade, entrada = null) {
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
    /** Quantas amostras já saíram com os campos imutáveis. Ver `view`. */
    this.amostras = 0;

    this.alvoX = alvo.x;
    this.alvoZ = alvo.z;
    this.chaoY = terrain.heightAt(alvo.x, alvo.z);

    /* A entrada é INCLINADA. A queda a prumo lê como elevador; inclinada, a
       rocha risca o campo de estrelas — e ganha uma componente horizontal de
       antecipação sem complicar a mira de ninguém. */
    const altura =
      (entrada?.altitude ?? M.spawnAltitude) + faixa(-M.altitudeJitter, M.altitudeJitter);
    const tilt = faixa(
      entrada?.tiltMin ?? M.entryTiltMin,
      entrada?.tiltMax ?? M.entryTiltMax,
    );
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

  /**
   * A amostra que vai para a rede, dez vezes por segundo.
   *
   * SÓ A POSE E A VIDA VIAJAM SEMPRE. Raio, número de flechas, silhueta e ponto
   * de queda são imutáveis — a rocha não muda de tamanho no meio da descida —,
   * e mandá-los dez vezes por segundo era mais da metade do pacote gasto
   * repetindo o que o outro lado já sabe. Numa sala de seis com trinta rochas
   * no céu isso são dezenas de kB/s por cliente de puro eco.
   *
   * Eles vão nas TRÊS PRIMEIRAS amostras da rocha, e isso basta porque o canal
   * é WebSocket: entregue e em ordem. Quem estava na sala recebe as três; quem
   * entrar depois recebe a rocha inteira no `snapshot`, que continua completo
   * (ver `Room.snapshot`). Não existe terceiro caso.
   */
  view() {
    const amostra = {
      i: this.id,
      p: [r(this.x), r(this.y), r(this.z)],
      hp: this.maxHits > 0 ? Math.round((1 - this.hits / this.maxHits) * 100) / 100 : 0,
    };
    if (this.amostras < 3) {
      this.amostras++;
      amostra.r = r(this.raio);
      amostra.k = this.maxHits;
      amostra.f = this.formato;
      // Onde ela vai bater: é a mancha no chão do cliente, e é ela que faz o
      // impacto ser justo — ninguém morre sem ter tido onde ler o aviso.
      amostra.a = [r(this.alvoX), r(this.chaoY), r(this.alvoZ)];
    }
    return amostra;
  }

  /** A rocha inteira, para quem acaba de chegar e não viu as três primeiras. */
  fullView() {
    return {
      i: this.id,
      p: [r(this.x), r(this.y), r(this.z)],
      r: r(this.raio),
      k: this.maxHits,
      hp: this.maxHits > 0 ? Math.round((1 - this.hits / this.maxHits) * 100) / 100 : 0,
      f: this.formato,
      a: [r(this.alvoX), r(this.chaoY), r(this.alvoZ)],
    };
  }
}

/**
 * O colosso: dezenas de flechas, e desce sozinho.
 *
 * O raio é POR HORDA e cresce a cada aparição — de 32 m de diâmetro na horda 3
 * a 52 m na 10. Um tamanho só para os quatro fazia da última aparição uma
 * repetição da primeira com mais vida; crescendo, o jogador lê a escada sem
 * HUD nenhum. E não custa um triângulo: o icosaedro tem as mesmas faces em
 * qualquer raio.
 */
export class TankMeteor extends FallingMeteor {
  constructor(terrain, alvo, hits, velocidade, raio, entrada) {
    super(terrain, alvo, raio, hits, velocidade, entrada);
    this.kind = "tank";
  }
}

/* ------------------------------------------------------------------ a chuva */

export class MeteorRain {
  constructor(terrain) {
    /* FORA do `setTerrain`, e é de propósito: a dificuldade é uma escolha da
       SALA, e trocar de fase (ou voltar do vale para a Lua) não desfaz uma
       escolha que alguém fez no menu. Tudo o mais aqui é estado de partida e
       morre com o terreno; isto não é estado de partida. */
    this.dificuldade = CONFIG.modes.meteorRain.defaultDifficulty;
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
    /** Fotografia do `playerCount` no começo da horda — ver `hordePlayerCount`. */
    this._hordePlayers = null;
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
    const n = Math.min(this.hordePlayerCount, M.playerScaleMax);
    return 1 + M.playerScale * Math.max(0, n - 1);
  }

  /**
   * Quantos arqueiros esta HORDA vale.
   *
   * `playerCount` é o número ao vivo e muda a cada tique; este é a fotografia
   * tirada no começo da horda, e é ela que todo o dimensionamento usa. A
   * diferença aparecia no colosso: ele nasce no meio da horda, então quem
   * entrasse na sala trinta segundos depois da faixa engordava um segundo ato
   * já anunciado — o grupo era punido por receber ajuda no pior instante
   * possível. Com a fotografia, quem chega no meio da 5 engrossa a 6, e nada
   * do que já foi anunciado muda de tamanho.
   */
  get hordePlayerCount() {
    return this._hordePlayers ?? this.playerCount;
  }

  /**
   * Os multiplicadores do nível em curso. Ver `difficulties` no config.
   *
   * O `fallSpeed` NÃO consulta isto, e é o que mantém os três níveis sendo o
   * mesmo jogo: o prazo de queda de cada rocha é igual em todos, então mirar se
   * aprende uma vez só. O que muda é quantas rochas e de quanto em quanto tempo.
   */
  get perfil() {
    const M = CONFIG.modes.meteorRain;
    return M.difficulties[this.dificuldade] ?? M.difficulties[M.defaultDifficulty];
  }

  fallSpeed(n) {
    const lista = CONFIG.modes.meteorRain.fallSpeeds;
    return lista[Math.max(0, Math.min(lista.length, n) - 1)] ?? lista[lista.length - 1];
  }

  gap(n) {
    const lista = CONFIG.modes.meteorRain.hordeGaps;
    const base = lista[Math.max(0, Math.min(lista.length, n) - 1)] ?? lista[lista.length - 1];
    return (base * this.perfil.gap) / this.escala();
  }

  /** A composição da horda, já multiplicada pelos jogadores e pelo nível. */
  mixDe(n) {
    const M = CONFIG.modes.meteorRain;
    const base = M.hordeMix[Math.max(0, Math.min(M.hordeMix.length, n) - 1)] ?? { p: 0, m: 0, g: 0 };
    /* O nível entra junto com os jogadores no MESMO arredondamento, e não num
       segundo `ceil` por cima do primeiro. Arredondar duas vezes só sabe subir:
       seis rochas com dois arqueiros no fácil dão ceil(6 × 1,88 × 0,6) = 7 de
       uma vez, e ceil(ceil(6 × 1,88) × 0,6) = 8 em duas — o fácil recebendo uma
       rocha que o cálculo não pediu, e sempre para o mesmo lado. */
    const k = this.escala() * this.perfil.mix;
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
    /* A VELOCIDADE DELE NÃO MUDA COM O NÍVEL, só a vida. É o que faz a mudança
       ser legível: a janela de tiro é a mesma nos três, e o que se sente é o
       colosso morrendo mais cedo ou mais tarde DENTRO dela. Mexer na velocidade
       mexeria no prazo, e o prazo é justamente o que os três níveis dividem.
       Piso de 1: um multiplicador não pode produzir um colosso que já nasce
       morto. */
    return Math.max(
      1,
      Math.round(
        base *
          this.perfil.tank *
          (1 + M.tankPlayerScale * Math.max(0, this.hordePlayerCount - 1)),
      ),
    );
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
  /**
   * @param {number} [nPlayers]
   * @param {string} [dificuldade] o nível pedido. Omitido, o que já valia
   *   continua valendo — recomeçar a chuva não é trocar de nível.
   */
  start(nPlayers = 1, dificuldade = undefined) {
    const M = CONFIG.modes.meteorRain;
    if (dificuldade !== undefined) this.dificuldade = meteorDifficultyOf(dificuldade);
    this.playerCount = Math.max(1, nPlayers | 0);
    this._hordePlayers = null;
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
    /* A FOTOGRAFIA DO NÚMERO DE ARQUEIROS, tirada aqui e só aqui.
       Tudo o que esta horda vai custar — quantas rochas, de quanto em quanto
       tempo, e a vida do colosso do segundo ato — sai deste número. Quem entrar
       na sala daqui em diante engrossa a PRÓXIMA. */
    this._hordePlayers = this.playerCount;

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

  /** O raio do colosso desta horda. Cresce a cada aparição. */
  tankRaio(n) {
    const M = CONFIG.modes.meteorRain;
    return M.tankRaios?.[n] ?? M.tankRaio;
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
      this.tankRaio(this.horde),
      // Mais alto e mais em pé que a chuva — ver `tankAltitude` no config.
      { altitude: M.tankAltitude, tiltMin: M.tankTiltMin, tiltMax: M.tankTiltMax },
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
    const lista = [];
    for (const m of this.meteors) if (!m.dead) lista.push(m.view());
    return lista;
  }

  /** O céu inteiro e completo — é o que o `snapshot` de quem chega carrega. */
  fullView() {
    const lista = [];
    for (const m of this.meteors) if (!m.dead) lista.push(m.fullView());
    return lista;
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
