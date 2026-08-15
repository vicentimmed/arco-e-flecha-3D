/* ---------------------------------------------------------------------------
   A sala de Namekusei. Irmã da do arqueiro, e nunca parente.

   Ela expõe **exatamente** a mesma interface externa que a `Room` de
   `server/room.js` — `level`, `mode`, `players`, `bots.count`, `onEmpty`,
   `handleMessage`, `handleClose`, `destroy` — e é só por isso que o `RoomHost`
   a guarda no mesmo `Set`, a lista no mesmo `publicStatus()` e a destrói pela
   mesma carência, sem uma única linha especial. O `if` de roteamento em
   `RoomHost.ensure` é a ÚNICA linha de `server/room.js` que este modo tocou —
   ver §0 e §11 de `docs/plano-namekusei.md`, que é o requisito principal do
   modo e não um pedido de organização.

   Por dentro, nada é parecido. Não há Rapier (§4), não há campo de altura do
   vale, não há flecha, vento, javali nem troca de fase. O que há é uma arena
   esférica de 900 m com quinze lutadores voando, e a sala é a autoridade sobre
   a única coisa que não pode divergir entre duas telas.

   ------------------------------------------------------- o modelo de confiança

   O MESMO do jogo do arqueiro (§8 do plano), e isso é deliberado: um segundo
   modelo de confiança no mesmo servidor seria a inconsistência que ninguém
   lembra de manter.

     | Cliente  | a própria pose, o próprio disparo, o próprio acerto |
     | SERVIDOR | vida, dano, morte, renascimento, placar, cratera,   |
     |          | clima, ki e bots                                    |

   Quem atira declara o acerto (`BLAST_HIT`, `SPECIAL_HIT`), exatamente como o
   `C2S.IMPACT` do vale; a sala confere se o número é PLAUSÍVEL e cobra a vida.
   A checagem existe para o jogo não se contradizer, não para impedir trapaça —
   serve para jogar com amigos, e isso está claro no plano desde a primeira
   linha do outro `room.js`.

   ------------------------------------------------------------------- a barra

   O ki é a exceção que vale sublinhar: **a sala é dona da barra**, e não o
   cliente. Ela cobra 2 por bola, 25 por onda e a barra INTEIRA por especial —
   e recusa o especial que não vier com o estoque cheio (§5). O gasto contínuo
   (arranque) e o ganho contínuo (carga) saem da PRÓPRIA POSE que o cliente já
   manda 20 vezes por segundo: `bo` é o arranque aceso e `ch` é a pose de
   carregar. Nenhuma mensagem nova, nenhum botão a mais, e a autoridade continua
   deste lado — o cliente declara o que está FAZENDO, a sala decide o que isso
   CUSTA.
   --------------------------------------------------------------------------- */

import { NAMEK, specialInfo } from "../../src/shared/namek/config.js";
import {
  NC2S,
  NS2C,
  NAMEK_LEVEL,
  NAMEK_MODE,
  NAMEK_PROTOCOL_VERSION,
  NamekReject,
  displayName,
  packFighter,
} from "../../src/shared/namek/protocol.js";
import { NamekField } from "../../src/shared/namek/field.js";
import { NamekBotSquad, melhorNascimento, PALETA } from "./bots.js";

export { NAMEK_LEVEL };

/* O contador de ids é PRÓPRIO desta sala, e não o de `server/room.js`.
   Os dois jogos não trocam mensagem nem corpo — um id repetido entre eles não
   tem onde colidir —, e importar o contador de lá seria a primeira linha de
   acoplamento entre duas coisas que o §0 do plano quer separadas para sempre. */
let proximoId = 1;

/** Contador de crateras. Ver `NS2C.CRATER`: é ele que torna `addCrater` idempotente. */
let proximaCratera = 1;

/* Os três vêm de `NAMEK.net`, e não de cópias locais.
 *
 * Havia cópias aqui, com um comentário afirmando que `shared/namek/config.js`
 * era "arquivo existente" que o §11 do plano proibia mexer. Não é: aquele
 * arquivo NASCEU com este modo, e o §11 fala dos arquivos do arqueiro. O preço
 * do engano já tinha aparecido — a tolerância local valia 14 e a do config, 12,
 * duas fontes de verdade para o mesmo número, com a sala usando a sua e o resto
 * do mundo lendo a outra. */
const NOME_MAX = NAMEK.net.nameMaxLength;
const SILENCIO = NAMEK.net.silenceTimeout;
const TOLERANCIA = NAMEK.net.hitTolerance;

/** s — o mínimo de tempo caído antes de o `RESPAWN` antecipado valer. */
const RESPAWN_MINIMO = 1.6;

/**
 * Teto de crateras pequenas por jogador, por segundo.
 *
 * A rajada sai a 6/s por pessoa. Com quinze em campo mirando o chão seriam 90
 * crateras por segundo, retransmitidas para quinze telas — e o teto de 96 do
 * `NamekField` inteiro gasto e regastado a cada segundo, com o terreno piscando
 * para todo mundo. Golpe GRANDE (potência ≥ 1, que é a faixa dos especiais)
 * passa sempre: ele acontece uma vez por barra cheia e a cratera dele é o
 * assunto do golpe.
 */
const CRATERAS_POR_SEGUNDO = 5;

/**
 * m — o maior alcance que qualquer golpe deste jogo tem.
 *
 * Derivado da tabela em vez de escrito: é o teto de "até onde um lutador pode
 * ter causado alguma coisa", e ele precisa crescer sozinho no dia em que um
 * especial de alcance maior entrar em `NAMEK.specials`. Um número à mão aqui
 * envelheceria calado, e o sintoma seria o golpe novo sendo recusado pela sala
 * sem nada dizer por quê.
 */
const ALCANCE_MAXIMO = Math.max(
  ...Object.values(NAMEK.specials).map((s) => s.range),
  NAMEK.blast.speed * NAMEK.blast.life,
);

/** Distância ao quadrado entre um vetor da rede `[x,y,z]` e um ponto. */
function dist2(a, p) {
  const dx = a[0] - p.x;
  const dy = a[1] - p.y;
  const dz = a[2] - p.z;
  return dx * dx + dy * dy + dz * dz;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round = (v) => Math.round(v * 1000) / 1000;

export class NamekRoom {
  /**
   * @param {object} [opcoes]
   * @param {(msg:string)=>void} [opcoes.log]
   * @param {boolean} [opcoes.relogio] `false` entrega o TEMPO a quem chama: sem
   *   `setInterval`, e com `now()` andando pelo `dt` de cada `passo()` em vez do
   *   relógio de parede. É o que o banco de provas usa
   *   (`scripts/bench-namek.js`): sessenta segundos de jogo têm de caber em
   *   menos de um segundo de relógio real, e as duas metades precisam concordar
   *   — com o timer desligado mas `now()` ainda lendo `Date.now()`, ninguém
   *   sairia da invulnerabilidade de nascimento e o banco mediria quinze bots
   *   intocáveis se ignorando. Fora do banco, ninguém passa este parâmetro.
   */
  constructor({ log = () => {}, relogio = true } = {}) {
    this.log = log;
    this.epoch = Date.now();

    /* `level` e `mode` existem para o `RoomHost`: é por eles que ele encontra a
       sala e é por eles que a tela de entrada a lista. "namek" NÃO está em
       `LEVEL_IDS` de propósito — ver o comentário do `if` em `ensure`. */
    this.level = NAMEK_LEVEL;
    this.mode = NAMEK_MODE;

    /* O planeta. Puro, roda em Node, e é o MESMO objeto que o cliente constrói
       do lado dele — mesma semente, mesmo relevo, mesmas crateras. */
    this.field = new NamekField();

    /** @type {Map<object, object>} conexão → lutador */
    this.players = new Map();
    this.bots = new NamekBotSquad();

    /* As cores livres. Mesma ideia do `ColorPool` do arqueiro, em oito linhas
       em vez de importada — importar `server/colors.js` seria acoplar os dois
       jogos por causa de uma lista de tons (§0), e a paleta daqui é outra: ela
       tem de combinar com aura de ki, não com túnica de arqueiro. É uma PILHA
       e não um índice porque quem sai devolve a cor, e sem devolução uma sala
       de sessão longa acabaria com quinze lutadores da mesma cor. */
    this.cores = [...PALETA];

    /* O clima é da SALA. Ver `pedirClima`: ele muda por pedido de quem está
       jogando, e o raio é sorteado aqui para todo mundo ver o mesmo relâmpago
       no mesmo lugar. */
    this.weather = NAMEK.weather.padrao;
    this.weatherAt = 0;
    /** Instante a partir do qual outra troca de clima é aceita. Ver `pedirClima`. */
    this.climaLivreEm = 0;
    this.proximoRaio = 0;

    /** Peças de cenário já derrubadas, para não anunciar duas vezes. */
    this.propsCaidos = new Set();
    /** Quantas crateras a sala já carimbou. O campo só guarda as 96 últimas. */
    this.crateras = 0;

    /** Corpos uniformes do quadro em curso. Ver `montarCorpos`. */
    this.corpos = [];
    this.corpoPorId = new Map();

    this.quadro = 0;
    this.ultimoPasso = Date.now();
    /** ms — o relógio simulado, ou `null` quando o relógio é o do mundo. */
    this.simulado = relogio ? null : 0;

    /* UM TIMER SÓ para o jogo inteiro.
     *
     * A sala do arqueiro tem quatro (poses, bichos, bots, varredura) porque lá
     * as coisas andam em relógios diferentes — um javali não precisa de 20 Hz.
     * Aqui tudo anda junto: os bots pensam no mesmo passo em que as bolas voam
     * e em que as poses saem, porque um bot que decide a 10 Hz e é transmitido
     * a 20 Hz manda metade das amostras repetidas. A vida sai de dois em dois
     * quadros (`statusRate`, 10 Hz), que é o único ritmo diferente do modo. */
    this.stepTimer = relogio
      ? setInterval(() => this.passo(), 1000 / NAMEK.net.stateRate)
      : null;
    this.sweepTimer = relogio
      ? setInterval(() => this.derrubarMudos(), 5000)
      : null;
  }

  now() {
    return this.simulado === null ? Date.now() - this.epoch : this.simulado;
  }

  get size() {
    return this.players.size;
  }

  /** Humanos + CPU. É este número que `NAMEK.net.maxPlayers` limita. */
  get lotacao() {
    return this.players.size + this.bots.count;
  }

  /* ============================================================== o passo == */

  /**
   * Um quadro da sala inteira.
   *
   * @param {number} [forcado] segundos, para quem dirige o relógio à mão
   */
  passo(forcado = null) {
    const agora = Date.now();
    /* O passo real, e não o nominal: um `setInterval` que atrasa 30 ms sob
       carga faria o mundo andar em câmera lenta se o dt fosse fixo. O teto de
       0,25 s existe para o contrário — depois de um engasgo do processo, um dt
       de dois segundos teleportaria todo mundo. */
    const dt = forcado ?? clamp((agora - this.ultimoPasso) / 1000, 0, 0.25);
    this.ultimoPasso = agora;
    if (dt <= 0) return;
    /* O relógio simulado anda ANTES da saída antecipada: uma sala parada tem de
       continuar envelhecendo, ou a carência de 30 s nunca venceria nela. */
    if (this.simulado !== null) this.simulado += dt * 1000;

    /* Sala em carência (sem gente e sem bot) não gasta nada. */
    if (!this.players.size && !this.bots.count) return;

    const t = this.now();
    this.economiaDeKi(dt, t);
    this.queimarNaLava(dt, t);
    this.montarCorpos(t);
    this.bots.tick(dt, {
      field: this.field,
      corpos: this.corpos,
      agora: t,
      gastar: (f, custo) => this.gastar(f, custo),
      emitir: (ev) => this.doBot(ev, t),
    });
    this.renascimentos(t);
    this.tempo(dt, t);

    this.broadcastStates(t);
    this.quadro++;
    /* 20 Hz de pose, 10 Hz de vida. As duas frequências do §8, num contador. */
    if (this.quadro % Math.max(1, Math.round(NAMEK.net.stateRate / NAMEK.net.statusRate)) === 0) {
      this.broadcastVitals();
    }
  }

  /**
   * A lista uniforme de quem está em campo.
   *
   * Humano e bot declaram a posição de jeitos diferentes — um manda `state.p`
   * pela rede, o outro tem `position` na memória —, e absolutamente nada do
   * resto do modo quer saber de qual dos dois se trata. É a mesma decisão do
   * `allCharacters()`/`corpoDe()` da sala do arqueiro, levada um passo adiante:
   * aqui a lista é montada UMA vez por quadro, porque ela é varrida por bola em
   * voo (até duzentas) e por bot (quinze), e desempacotar `state.p` dentro
   * desses laços seria pagar o mesmo trabalho três mil vezes.
   */
  montarCorpos(agora) {
    this.corpos.length = 0;
    this.corpoPorId.clear();
    for (const p of this.players.values()) {
      const s = p.state;
      if (!s) continue;
      this.corpos.push({
        id: p.id,
        ref: p,
        isBot: false,
        x: s.p[0], y: s.p[1], z: s.p[2],
        vx: s.v?.[0] ?? 0, vy: s.v?.[1] ?? 0, vz: s.v?.[2] ?? 0,
        alive: p.alive,
        invuln: agora < p.invulnUntil,
        health: p.health,
      });
    }
    for (const b of this.bots.list) {
      this.corpos.push({
        id: b.id,
        ref: b,
        isBot: true,
        x: b.position.x, y: b.position.y, z: b.position.z,
        vx: b.velocity.x, vy: b.velocity.y, vz: b.velocity.z,
        alive: b.alive,
        invuln: agora < b.invulnUntil,
        health: b.health,
      });
    }
    for (const c of this.corpos) this.corpoPorId.set(c.id, c);
    return this.corpos;
  }

  /* ================================================================== ki == */

  /**
   * A barra de todo mundo, por segundo.
   *
   * O gasto e o ganho CONTÍNUOS saem da pose: `bo` (arranque aceso) drena
   * `boostDrain`, `ch` (pose de carregar) enche a `chargeRate`. Ler isso da
   * pose em vez de criar um par de mensagens "comecei/parei" é o que mantém a
   * conta certa quando um pacote se perde — a pose é reenviada 20 vezes por
   * segundo, e um "parei" perdido deixaria o jogador drenando para sempre.
   *
   * A regeneração passiva existe para ninguém ficar preso em zero, e o atraso
   * (`idleDelay`) é o que impede que ela pague pela rajada em curso: quem está
   * atirando não regenera, quem parou volta a encher devagar.
   */
  /**
   * Quem está com os pés na lava perde vida enquanto ficar lá.
   *
   * A SALA é quem cobra, como cobra todo o resto do dano: o cliente desenha a
   * poça e sente o calor, mas quem tira vida é um só, senão duas telas
   * discordariam sobre quem morreu.
   *
   * Nem a poça nem o gatilho viajam pela rede. Elas são DERIVADAS do relevo
   * (`NamekField.avaliarLava`), e o relevo já é o mesmo dos dois lados porque
   * as crateras são sincronizadas — o mesmo motivo pelo qual ninguém precisa
   * transmitir onde fica cada buraco.
   *
   * Morrer na lava não dá abate a ninguém, pelo mesmo critério da queda: não
   * há culpado, e inventar um seria premiar quem por acaso cavou ali antes.
   */
  queimarNaLava(dt, agora) {
    if (!this.field.lavaPools.length) return;
    const L = NAMEK.destruction.lava;
    for (const f of this.todos()) {
      if (!f.alive) continue;
      const p = this.pontoDe(f);
      if (!this.field.naLava(p.x, p.y, p.z)) continue;
      this.aplicarDano(f, L.dano * dt, {
        kind: "lava",
        p,
        d: [0, 1, 0],
        /* Contínuo: é o mesmo caminho do feixe, que também cobra por quadro.
           Sem isto, cada tique viraria um anúncio de acerto separado. */
        continuo: true,
      });
    }
  }

  economiaDeKi(dt, agora) {
    const K = NAMEK.ki;
    for (const f of this.todos()) {
      if (!f.alive) continue;

      const bo = f.isBot ? f.boostBlend : (f.state?.bo ?? 0);
      const ch = f.isBot ? f.chargeBlend : (f.state?.ch ?? 0);

      if (bo > 0.05) {
        const custo = K.boostDrain * bo * dt;
        if (custo > 0) {
          f.ki = Math.max(0, f.ki - custo);
          f.ultimoGasto = agora;
        }
      }
      if (ch > 0.05) {
        f.ki = Math.min(K.max, f.ki + K.chargeRate * ch * dt);
      } else if (agora - f.ultimoGasto > K.idleDelay * 1000) {
        f.ki = Math.min(K.max, f.ki + K.idleRegen * dt);
      }
    }
  }

  /**
   * Cobra da barra, se houver. **É por aqui que todo gasto passa** — humano ou
   * bot, rajada ou especial.
   *
   * @returns {boolean} false quando não deu, e aí o disparo simplesmente não
   *   acontece: nem dano, nem retransmissão. O cliente que se adiantou vê a
   *   própria bola sumir sem efeito, e a barra correta chega no `VITALS`
   *   seguinte, no máximo 100 ms depois.
   */
  gastar(f, custo) {
    if (!f.alive || f.ki < custo) return false;
    f.ki -= custo;
    f.ultimoGasto = this.now();
    if (f.ki < 0) f.ki = 0;
    /* O total gasto na vida do lutador. Uma soma por disparo, e é ela que
       permite ao banco de provas responder "eles gerenciam ki?" sem pendurar
       gancho nenhum na economia — este método é o funil por onde TODO gasto do
       modo passa, então o número aqui é o número certo por construção. */
    f.gastoKi += custo;
    return true;
  }

  /* ============================================================== o clima == */

  /**
   * O relógio do planeta: a tempestade e os raios dela.
   *
   * O raio é sorteado AQUI e mandado pronto (`NS2C.BOLT`), e o comentário do
   * protocolo explica por quê melhor do que este: meio céu piscando em horas
   * diferentes em cada tela é o oposto de um planeta explodindo JUNTO.
   */
  tempo(dt, agora) {
    if (this.weather !== "tempestade") return;
    this.proximoRaio -= dt;
    if (this.proximoRaio > 0) return;

    const T = NAMEK.weather.tempestade;
    /* Intervalo sorteado em torno do médio, e não fixo: um relâmpago a cada
       exatos 3,4 s vira metrônomo, e metrônomo não assusta ninguém. */
    this.proximoRaio = T.raioIntervalo * (0.5 + Math.random());

    /* Sessenta por cento dos raios caem perto de alguém. Um relâmpago que
       ninguém vê é um relâmpago que não aconteceu — e a tempestade é o único
       momento do modo em que o cenário fala. */
    let x;
    let z;
    const perto = this.corpos.length && Math.random() < 0.6
      ? this.corpos[(Math.random() * this.corpos.length) | 0]
      : null;
    if (perto) {
      const a = Math.random() * Math.PI * 2;
      const r = 40 + Math.random() * 260;
      x = perto.x + Math.cos(a) * r;
      z = perto.z + Math.sin(a) * r;
    } else {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * NAMEK.world.radius * 0.9;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
    }
    const lim = NAMEK.world.radius * 0.96;
    const d = Math.hypot(x, z);
    if (d > lim) {
      x = (x / d) * lim;
      z = (z / d) * lim;
    }
    this.broadcastAll({ t: NS2C.BOLT, p: [round(x), round(z)], w: agora });
  }

  /**
   * Alguém pediu outro clima. Vale para a sala inteira.
   *
   * Não há ciclo automático, e é escolha: a tempestade é uma DECISÃO — o
   * equivalente do V do arqueiro —, e um céu que vira sozinho no meio de uma
   * perseguição é o cenário tomando do jogador uma coisa que era dele.
   */
  pedirClima(id, agora) {
    if (!NAMEK.weather.ids.includes(id) || id === this.weather) return;

    /* UMA TROCA POR VEZ, e o tempo mínimo é o da própria transição.
     *
     * O clima é da SALA e qualquer um o vira. Sem trava, um cliente alternando
     * dia e tempestade num laço produziu 39 trocas em 0,4 s — todas
     * retransmitidas para todo mundo, com o céu de catorze pessoas piscando
     * entre verde e vermelho. Não é trapaça, é um botão que qualquer um pode
     * segurar sem querer.
     *
     * A carência é o `fade`: enquanto o céu ainda está VIRANDO, um pedido novo
     * não descreve nada que dê para ver. Terminada a transição, quem quiser
     * trocar de novo troca. */
    if (agora < this.climaLivreEm) return;
    this.climaLivreEm = agora + NAMEK.weather.fade * 1000;

    this.weather = id;
    this.weatherAt = agora;
    /* O primeiro raio não sai junto com a transição: o céu leva
       `NAMEK.weather.fade` segundos para virar, e um relâmpago num céu ainda
       verde-claro lê como erro de sincronismo. */
    this.proximoRaio = NAMEK.weather.fade * 0.7;
    this.broadcastAll({ t: NS2C.WEATHER, id, w: agora });
    this.log(`namek — clima: ${id}`);
  }

  /* ================================================================ dano == */

  /**
   * Tira vida de alguém, e resolve a morte se ela vier. **O caminho único.**
   *
   * Rajada, feixe, onda e queda passam todos por aqui — é o que garante que a
   * invulnerabilidade, o placar, o `HURT` e o `DEATH` tenham UMA implementação
   * só. A sala do arqueiro aprendeu isso da forma cara (ver `emptyScore`, que
   * existe porque a mesma coisa estava escrita em dois lugares e as duas cópias
   * divergiram).
   *
   * @param {object} vitima
   * @param {number} dano
   * @param {object} ctx `{ por, kind, p, d, continuo }` — `continuo` é o feixe,
   *   que cobra por quadro e por isso não pode acender um `HURT` por quadro.
   */
  aplicarDano(vitima, dano, { por = null, kind = "blast", p = null, d = null, continuo = false } = {}) {
    if (!vitima?.alive) return 0;
    const agora = this.now();
    if (agora < vitima.invulnUntil) return 0;
    if (!(dano > 0)) return 0;

    vitima.health -= dano;
    if (vitima.isBot) vitima.machucar();

    if (vitima.health <= 0) {
      vitima.health = 0;
      this.matar(vitima, por, kind, p, d, agora);
      return dano;
    }

    /* O `HURT` é o clarão vermelho e o número subindo — é FEEL, não estado (o
       estado vai no `VITALS` a 10 Hz de qualquer jeito). Por isso o golpe
       discreto acende na hora, e o feixe — que cobraria vinte vezes por segundo
       — acumula e acende a 6 Hz. Sem essa distinção, três segundos de
       Kamehameha em dois alvos são 120 mensagens que dizem a mesma coisa. */
    if (continuo) {
      vitima.dorAcum += dano;
      vitima.dorPor = por?.id ?? null;
      vitima.dorKind = kind;
      if (agora < vitima.dorAte) return dano;
      vitima.dorAte = agora + 160;
      this.broadcastAll({
        t: NS2C.HURT,
        id: vitima.id,
        health: Math.round(vitima.health),
        by: vitima.dorPor,
        amount: Math.round(vitima.dorAcum),
        kind: vitima.dorKind,
      });
      vitima.dorAcum = 0;
      return dano;
    }

    this.broadcastAll({
      t: NS2C.HURT,
      id: vitima.id,
      health: Math.round(vitima.health),
      by: por?.id ?? null,
      amount: Math.round(dano),
      kind,
    });
    return dano;
  }

  /** A morte: placar, aviso e o relógio do renascimento. */
  matar(vitima, por, kind, p, d, agora) {
    vitima.alive = false;
    vitima.health = 0;
    vitima.score.deaths++;
    vitima.respawnAt = agora + NAMEK.respawn.delay * 1000;
    vitima.dorAcum = 0;
    if (vitima.isBot) vitima.cair();
    const corpo = this.corpoPorId.get(vitima.id);
    /* O corpo do QUADRO EM CURSO morre junto. Sem isto, uma segunda bola que
       chegasse no mesmo passo ainda encontraria a vítima "viva" na lista
       uniforme e cobraria o abate de novo — dois `DEATH` para uma morte. */
    if (corpo) corpo.alive = false;

    if (por && por !== vitima) {
      por.score.kills++;
      if (por.isBot) por.tDecisao = 0; // procura o próximo na hora
    }

    const ponto = p ?? this.pontoDe(vitima);
    this.broadcastAll({
      t: NS2C.DEATH,
      victim: vitima.id,
      killer: por && por !== vitima ? por.id : null,
      kind,
      p: [round(ponto.x), round(ponto.y), round(ponto.z)],
      /* A direção do golpe. O protocolo é explícito: "é ela que joga o corpo
         para o lado certo" — sem ela todo mundo cai em pé, para baixo. */
      d: d ? [round(d[0]), round(d[1]), round(d[2])] : [0, 1, 0],
    });
    this.broadcastScores();
  }

  /**
   * Uma cor livre da paleta. Nunca falha: com a paleta vazia, sorteia.
   *
   * `shift` e não `pop`: a `PALETA` está escrita na ordem em que as cores devem
   * ser entregues (o laranja do personagem primeiro — ver o comentário lá), e
   * tirar do fim entregava a lista ao contrário. O sintoma era o primeiro
   * lutador da sala nascendo verde-limão em vez de com o gi do personagem.
   */
  tomarCor() {
    return this.cores.shift() ?? PALETA[(Math.random() * PALETA.length) | 0];
  }

  /** Devolve a cor de quem saiu, para quem chegar depois. */
  devolverCor(cor) {
    if (cor && !this.cores.includes(cor) && PALETA.includes(cor)) this.cores.push(cor);
  }

  /** Quem tem este id — humano OU bot. */
  lutadorPor(id) {
    for (const p of this.players.values()) if (p.id === id) return p;
    return this.bots.byId(id);
  }

  /** Todo mundo em campo, humano e bot, num laço só. */
  *todos() {
    for (const p of this.players.values()) yield p;
    for (const b of this.bots.list) yield b;
  }

  /** A posição de qualquer corpo, venha ela da rede ou da memória. */
  pontoDe(f) {
    if (f.isBot) return { x: f.position.x, y: f.position.y, z: f.position.z };
    const s = f.state;
    return s ? { x: s.p[0], y: s.p[1], z: s.p[2] } : { x: 0, y: 0, z: 0 };
  }

  /* ========================================================= renascimento == */

  renascimentos(agora) {
    for (const f of this.todos()) {
      if (f.alive || !f.respawnAt || agora < f.respawnAt) continue;
      this.nascer(f, agora);
    }
  }

  /**
   * Põe alguém em campo — na entrada e depois de cada morte, pelo mesmo caminho.
   *
   * Nasce-se **voando**, a `dropHeight` do chão: o modo é aéreo e um lutador
   * que aparece de pé na grama passa os primeiros segundos subindo em vez de
   * jogando. E longe de todo mundo, que é o que impede o renascimento de virar
   * a continuação da morte anterior.
   */
  nascer(f, agora = this.now()) {
    const ocupados = [];
    for (const c of this.todos()) {
      if (c === f) continue;
      const p = this.pontoDe(c);
      if (c.alive) ocupados.push(p);
    }
    const p = melhorNascimento(this.field, ocupados);
    const invulnUntil = agora + NAMEK.respawn.invuln * 1000;

    f.alive = true;
    f.health = NAMEK.fighter.maxHealth;
    f.ki = NAMEK.ki.max;
    f.invulnUntil = invulnUntil;
    f.respawnAt = 0;
    f.ultimoGasto = -Infinity;
    f.dorAcum = 0;
    f.especial = null;
    if (f.isBot) f.renascer(p.x, p.y, p.z, invulnUntil);

    /* Encara o meio da arena. Mesma razão do bot: nascer de costas para a
       briga é nascer gastando meio segundo girando. */
    const yaw = Math.atan2(p.x, p.z);
    this.broadcastAll({
      t: NS2C.SPAWN,
      id: f.id,
      p: [round(p.x), round(p.y), round(p.z)],
      yaw: round(yaw),
      invulnUntil,
    });
  }

  /* ============================================================ crateras == */

  /**
   * Carimba uma cratera e a manda para TODOS.
   *
   * O id incremental é o contrato do §7: os dois lados chegam ao mesmo buraco a
   * partir de (id, x, z, potência), e `NamekField.addCrater` é idempotente por
   * id justamente porque quem atirou já a aplicou localmente para não esperar o
   * retorno da rede. Mandar de volta para o autor não é desperdício — é o que
   * dá a ele o id oficial.
   */
  cratera(x, z, power, dono = null) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(power)) return null;
    if (x * x + z * z > NAMEK.world.radius ** 2) return null;
    const p = clamp(power, 0, 64);
    if (p <= 0) return null;

    /* GOLPE FRACO NÃO GASTA VAGA. O corte é o mesmo dos dois lados — o cliente
       nem chega a pedir (ver `craterMinPower` e o `reportar` do laço), e aqui
       ele vale também para o BOT, que fala com a sala por dentro e não passa por
       aquele caminho. Sem esta linha, quinze bots atirando a 6/s continuariam
       girando a fila de 96 crateras sozinhos, e a destruição dos especiais
       apagaria na frente de todo mundo do mesmo jeito. */
    if (p < NAMEK.destruction.craterMinPower) return null;

    /* A COTA VALE PARA TODA CRATERA, não só para as pequenas.
     *
     * A condição era `p < 1`, o que deixava a porta escancarada justamente para
     * as grandes: 60 pedidos de potência 16 em 1,2 s viravam 54 crateras — o
     * teto de 96 da sala gasto em dois segundos, e a malha do terreno de TODOS
     * os clientes re-esculpida 54 vezes seguidas. A rajada legítima continua
     * passando inteira pela folga de meio segundo do balde, e um especial de
     * verdade sai muitas vezes abaixo do limite. */
    if (dono && !this.podeCravar(dono)) return null;

    /* A cota é medida ANTES de o buraco existir. Depois de `addCrater` o
       `heightAt` deste ponto já é o fundo da cratera, e mandar isso faria a
       poeira e as pedrinhas nascerem alguns metros abaixo do chão que estourou
       — dentro da própria cratera, invisíveis. */
    const y = this.field.heightAt(x, z);

    const id = proximaCratera++;
    const c = this.field.addCrater(id, x, z, p);
    if (!c) return null;
    this.crateras++;

    this.broadcastAll({
      t: NS2C.CRATER,
      i: id,
      p: [round(x), round(y), round(z)],
      power: round(p),
      /* QUEM abriu. O cliente já desenhou a poeira e já tocou o estouro do
         PRÓPRIO golpe no instante do impacto — ele não espera a rede para isso.
         Sem este campo ele não tem como saber que a cratera que volta é a dele,
         e o estouro sairia duas vezes: uma na hora e outra meio segundo depois.
         Um número por cratera, e crateras são raras. */
      by: dono?.id ?? null,
    });
    return c;
  }

  /** O balde de crateras pequenas de um lutador. Ver `CRATERAS_POR_SEGUNDO`. */
  podeCravar(f) {
    const agora = this.now();
    const passo = 1000 / CRATERAS_POR_SEGUNDO;
    /* Balde com folga de meio segundo: rajadas curtas passam inteiras, spray
       contínuo é aparado. */
    const base = Math.max(f.crateraAte ?? 0, agora - 500);
    if (base > agora) return false;
    f.crateraAte = base + passo;
    return true;
  }

  /* ============================================================== os bots == */

  /**
   * O que um bot fez, virando efeito de sala.
   *
   * Este método é a fronteira entre `bots.js` e o protocolo: o bot emite coisas
   * SEMÂNTICAS ("atirei", "acertei", "bati no chão") e é aqui que elas viram
   * mensagem e viram vida perdida. `bots.js` não conhece uma única constante de
   * `NS2C` — é o que permite mexer na IA sem nunca pensar em rede, e mexer na
   * rede sem nunca abrir a IA.
   */
  doBot(ev, agora) {
    const dono = this.bots.byId(ev.dono);
    if (!dono) return;

    switch (ev.tipo) {
      case "rajada":
        this.broadcastAll({
          t: NS2C.BLAST,
          owner: dono.id,
          id: ev.id,
          o: vec(ev.o),
          d: vec(ev.d),
          hand: ev.hand,
          target: ev.alvo,
          w: agora,
        });
        break;

      case "especial":
        this.broadcastAll({
          t: NS2C.SPECIAL,
          owner: dono.id,
          kind: ev.kind,
          o: vec(ev.o),
          d: vec(ev.d),
          w: agora,
        });
        break;

      case "acerto": {
        const vitima = this.lutadorPor(ev.vitima);
        if (!vitima) break;
        this.aplicarDano(vitima, ev.dano, {
          por: dono,
          kind: ev.kind,
          p: { x: ev.p[0], y: ev.p[1], z: ev.p[2] },
          d: ev.d,
          /* O feixe cobra por quadro; a bola cobra de uma vez. É o mesmo
             critério do `SPECIAL_HIT` que chega dos humanos. */
          continuo: ev.kind !== "blast",
        });
        break;
      }

      case "chao":
        this.cratera(ev.p[0], ev.p[2], ev.poder, dono);
        break;

      case "onda":
        this.onda(dono, { x: ev.p[0], y: ev.p[1], z: ev.p[2] });
        break;

      default:
        break;
    }
  }

  /**
   * A explosão de ki: empurra quem está perto e machuca pouco.
   *
   * Vale para humano e bot pelo mesmo caminho. O empurrão só é APLICADO de
   * verdade nos bots — o humano é dono da própria pose (§8), então para ele a
   * onda viaja como evento e quem move o corpo é o cliente dele. É a mesma
   * divisão do knockback do arqueiro, e tentar corrigir a posição do humano
   * daqui seria o servidor brigando com a predição do cliente pelo controle do
   * boneco, que é a receita clássica da borracha.
   */
  onda(dono, p) {
    const K = NAMEK.ki;
    this.broadcastAll({
      t: NS2C.BURST,
      owner: dono.id,
      p: [round(p.x), round(p.y), round(p.z)],
      w: this.now(),
    });

    for (const c of this.corpos) {
      if (c.id === dono.id || !c.alive) continue;
      const dx = c.x - p.x;
      const dy = c.y + NAMEK.fighter.chest - p.y;
      const dz = c.z - p.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > K.burstRadius) continue;
      /* Queda linear do centro à borda: quem está no olho da onda leva tudo,
         quem está raspando leva um empurrãozinho. */
      const f = 1 - d / K.burstRadius;
      const inv = d > 1e-3 ? 1 / d : 0;
      if (c.ref.isBot) {
        const v = K.burstPush * f;
        c.ref.velocity.x += dx * inv * v;
        c.ref.velocity.y += dy * inv * v + v * 0.35;
        c.ref.velocity.z += dz * inv * v;
      }
      this.aplicarDano(c.ref, K.burstDamage * f, {
        por: dono,
        kind: "burst",
        p: { x: c.x, y: c.y, z: c.z },
        d: [dx * inv, dy * inv, dz * inv],
      });
    }
  }

  /** Põe um lutador de CPU em campo, visível para a sala inteira. */
  addBot() {
    if (this.lotacao >= NAMEK.net.maxPlayers) return null;
    const ocupados = [];
    for (const c of this.todos()) ocupados.push(this.pontoDe(c));
    const bot = this.bots.add(proximoId++, this.field, ocupados);
    if (!bot) return null;

    bot.color = this.tomarCor();
    bot.state = packFighter(bot);
    bot.stateTime = this.now();
    bot.invulnUntil = this.now() + NAMEK.respawn.invuln * 1000;
    bot.dorAcum = 0;
    bot.dorAte = 0;
    bot.crateraAte = 0;

    /* Entra pelo MESMO `JOIN` de um humano — é isso que faz o cliente desenhá-lo
       sem uma linha de código nova. */
    this.broadcastAll({ t: NS2C.JOIN, fighter: view(bot) });
    this.broadcastAll({
      t: NS2C.SPAWN,
      id: bot.id,
      p: [round(bot.position.x), round(bot.position.y), round(bot.position.z)],
      yaw: round(bot.yaw),
      invulnUntil: bot.invulnUntil,
    });
    this.broadcastScores();
    return bot;
  }

  removeBot() {
    const bot = this.bots.removeLast();
    if (!bot) return false;
    this.devolverCor(bot.color);
    this.broadcastAll({ t: NS2C.LEAVE, id: bot.id, name: bot.name });
    this.broadcastScores();
    return true;
  }

  clearBots() {
    for (const bot of this.bots.clear()) {
      this.devolverCor(bot.color);
      this.broadcastAll({ t: NS2C.LEAVE, id: bot.id, name: bot.name });
    }
  }

  /* ============================================================== entrada == */

  handleMessage(conn, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // lixo na linha: ignora em silêncio
    }
    if (!msg || typeof msg.t !== "string") return;

    const player = this.players.get(conn);
    if (!player) {
      if (msg.t === NC2S.HELLO) this.join(conn, msg);
      return;
    }
    player.lastSeen = Date.now();
    this.route(player, msg);
  }

  join(conn, msg) {
    if (msg.version !== NAMEK_PROTOCOL_VERSION) {
      send(conn, {
        t: NS2C.REJECT,
        reason: NamekReject.VERSION,
        expected: NAMEK_PROTOCOL_VERSION,
      });
      conn.close();
      return;
    }

    /* A LOTAÇÃO CONTA OS BOTS, e o §8 do plano é explícito: 15 somados. Mas
       gente ganha de CPU — se a sala está cheia só porque alguém encheu de
       adversários de treino, sai um bot e entra a pessoa. Recusar um humano
       para preservar um bot seria a sala defendendo a própria decoração. */
    while (this.lotacao >= NAMEK.net.maxPlayers && this.bots.count > 0) {
      this.removeBot();
    }
    if (this.lotacao >= NAMEK.net.maxPlayers) {
      send(conn, {
        t: NS2C.REJECT,
        reason: NamekReject.FULL,
        players: this.lotacao,
        max: NAMEK.net.maxPlayers,
      });
      conn.close();
      return;
    }

    const agora = this.now();
    const player = {
      id: proximoId++,
      conn,
      isBot: false,
      name: displayName(msg.name, NOME_MAX, "Guerreiro"),
      color: this.tomarCor(),
      /* O personagem escolhido na tela de entrada. Saneado e NÃO validado
         contra uma lista: o cliente de Namekusei ainda não existe, e uma lista
         inventada aqui seria a primeira coisa que ele teria de contrariar. O
         que a sala garante é o que ela precisa garantir — que a string é curta,
         limpa e nunca vazia. Ver `sanitizeSkin` do arqueiro para a mesma ideia
         com a lista já existindo. */
      char: displayName(msg.char, 24, "guerreiro"),
      score: { kills: 0, deaths: 0 },
      state: null,
      stateTime: 0,

      health: NAMEK.fighter.maxHealth,
      ki: NAMEK.ki.max,
      alive: true,
      invulnUntil: 0,
      respawnAt: 0,
      ultimoGasto: -Infinity,
      /* O especial em curso, para `SPECIAL_HIT` poder conferir que o feixe que
         está cobrando dano existe de verdade. Ver `registrarEspecial`. */
      especial: null,
      dorAcum: 0,
      dorAte: 0,
      dorPor: null,
      dorKind: "blast",
      crateraAte: 0,
      /** Ki gasto na vida toda. Ver `gastar`. */
      gastoKi: 0,

      ping: 0,
      lastSeen: Date.now(),
      joinedAt: agora,
    };
    this.players.set(conn, player);

    send(conn, {
      t: NS2C.WELCOME,
      you: view(player),
      time: agora,
      max: NAMEK.net.maxPlayers,
      weather: { id: this.weather, w: this.weatherAt },
      fighters: this.roster(player),
      /* A LISTA INTEIRA DE CRATERAS. É esta linha que cumpre o critério 6 do
         §12: quem entra no meio vê o chão já deformado, e não um planeta liso
         que ninguém mais está vendo. */
      craters: this.field.craterList(),
      /* AS PEÇAS JÁ DERRUBADAS. Mesmo motivo da lista de crateras logo acima, e
         a ausência disto era um furo real: quem entrava no meio via de pé as
         rochas, ajisas e casas que todo mundo já tinha destruído, e continuava
         batendo nelas com o projétil enquanto os outros atiravam através do
         lugar vazio. `propsCaidos` já guarda tudo, só não viajava. */
      props: [...this.propsCaidos],
      scores: this.scores(),
    });

    /* O `JOIN` vai para os OUTROS: quem entrou já se conhece pelo `you` do
       `welcome`, e receber o próprio anúncio faria o cliente criar um boneco
       remoto de si mesmo. */
    this.broadcast({ t: NS2C.JOIN, fighter: view(player) }, player.id);
    this.nascer(player, agora);
    this.broadcastScores();
    this.log(`namek — entrou: ${player.name} (#${player.id}) — ${this.lotacao} em campo`);
  }

  /** Quem já está em campo, com a última pose de cada um. */
  roster(exceto) {
    const lista = [];
    for (const f of this.todos()) {
      if (f === exceto) continue;
      lista.push({ ...view(f), state: f.state, health: Math.round(f.health), ki: Math.round(f.ki) });
    }
    return lista;
  }

  handleClose(conn) {
    const player = this.players.get(conn);
    if (!player) return;
    this.players.delete(conn);
    this.devolverCor(player.color);
    this.broadcastAll({ t: NS2C.LEAVE, id: player.id, name: player.name });
    this.broadcastScores();
    this.log(`namek — saiu: ${player.name} (#${player.id}) — ${this.lotacao} em campo`);

    /* Sala vazia = planeta zerado, AGORA.
     *
     * Mesma decisão da sala do arqueiro, e pelo mesmo motivo: a sala sobrevive
     * 30 s ao último jogador para que uma queda de rede curta não apague a
     * sessão, e sem esta limpeza quem recarregasse a página cairia num planeta
     * cheio de crateras de uma partida que acabou, com quinze bots brigando
     * sozinhos e consumindo CPU para ninguém. */
    if (this.players.size === 0) {
      this.clearBots();
      this.field = new NamekField();
      this.weather = NAMEK.weather.padrao;
      this.weatherAt = 0;
      this.corpos.length = 0;
      this.corpoPorId.clear();
      this.propsCaidos.clear();
      this.log("namek — sala vazia: planeta zerado");
    }

    this.onEmpty?.(this);
  }

  /** Derruba quem parou de dar sinal. Sem isto, uma aba fechada à força segura vaga. */
  derrubarMudos() {
    const limite = SILENCIO * 1000;
    const agora = Date.now();
    for (const [conn, player] of [...this.players]) {
      if (agora - player.lastSeen <= limite) continue;
      this.log(`namek — sem sinal: ${player.name} (#${player.id})`);
      this.handleClose(conn);
      try {
        conn.close();
      } catch {
        /* já estava morta */
      }
    }
  }

  /* ============================================================ mensagens == */

  route(player, msg) {
    switch (msg.t) {
      case NC2S.PING:
        send(player.conn, { t: NS2C.PONG, c: msg.c, s: this.now() });
        if (typeof msg.rtt === "number") player.ping = Math.round(msg.rtt);
        break;

      case NC2S.STATE:
        this.registrarPose(player, msg);
        break;

      case NC2S.BLAST:
        this.registrarRajada(player, msg);
        break;

      case NC2S.BLAST_HIT:
        this.registrarAcerto(player, msg);
        break;

      case NC2S.SPECIAL:
        this.registrarEspecial(player, msg);
        break;

      case NC2S.SPECIAL_HIT:
        this.registrarQueimadura(player, msg);
        break;

      case NC2S.BURST:
        this.registrarOnda(player, msg);
        break;

      case NC2S.GROUND_HIT:
        this.registrarChao(player, msg);
        break;

      case NC2S.PROP_HIT:
        this.registrarProp(player, msg);
        break;

      case NC2S.SLAM:
        this.registrarQueda(player, msg);
        break;

      case NC2S.RESPAWN:
        this.registrarRespawn(player);
        break;

      case NC2S.BOT:
        if (msg.remove) this.removeBot();
        else this.addBot();
        break;

      case NC2S.WEATHER:
        this.pedirClima(msg.id, this.now());
        break;

      default:
        break;
    }
  }

  /**
   * A pose própria, 20 Hz.
   *
   * A sala NÃO corrige a pose — o §8 é claro sobre de quem ela é. O que ela faz
   * é recusar a pose IMPOSSÍVEL: um `NaN` ou um número fora do planeta não é
   * trapaça, é bug ou lixo de rede, e retransmiti-lo poria o boneco daquela
   * pessoa num lugar em que nenhuma tela consegue desenhá-lo. Recusar é melhor
   * que reescrever: com a pose recusada, a última boa continua valendo e o
   * cliente se conserta no quadro seguinte; reescrevendo, ele e a sala
   * discordariam para sempre sobre onde ele está.
   */
  registrarPose(player, msg) {
    const s = msg.s;
    /* Exatamente três componentes: é o que `r3v`/`r2v` produzem, e um vetor
       mais comprido não seria "um cliente diferente" — seria carga extra que a
       sala retransmitiria para todo mundo. */
    if (!s || !Array.isArray(s.p) || s.p.length !== 3) return;
    if (!Array.isArray(s.v) || s.v.length !== 3) return;
    const [x, y, z] = s.p;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    if (!Number.isFinite(s.v[0]) || !Number.isFinite(s.v[1]) || !Number.isFinite(s.v[2])) return;
    const W = NAMEK.world;
    if (x * x + z * z > (W.radius + 200) ** 2) return;
    if (y > W.ceiling + 200 || y < W.seaLevel - 200) return;
    /* E TODO CANAL TEM DE SER NÚMERO. A pose é a única coisa que a sala
       retransmite sem reescrever, então ela é também a única porta por onde um
       cliente poderia mandar `"y": "olá"` e travar o desenho de todos os
       outros. A autoridade sobre a própria pose (§8) é sobre PARA ONDE ela
       aponta — não sobre de que tipo ela é. */
    for (const k in PADROES) {
      const v = s[k];
      if (v !== undefined && !Number.isFinite(v)) return;
    }
    if (!Number.isFinite(s.y) || !Number.isFinite(s.i)) return;
    if (s.b !== undefined && !Number.isFinite(s.b)) return;

    player.state = s;
    /* O carimbo é o do CLIENTE, não o da retransmissão — mesma razão anotada em
       `Room.route`: carimbar no broadcast transforma um engasgo de 300 ms num
       teleporte na tela de quem recebe. */
    player.stateTime = clampTempo(msg.w, this.now());
  }

  /**
   * "Atirei uma bola." A sala cobra o ki e retransmite.
   *
   * O `target` viaja intacto porque ele é a razão de existir do campo: o alvo é
   * escolhido NO DISPARO por quem atirou, e é mandá-lo junto que faz a bola
   * perseguir a mesma pessoa em todas as telas.
   */
  registrarRajada(player, msg) {
    if (!player.alive) return;
    if (!vetorOk(msg.o) || !vetorOk(msg.d)) return;
    if (!this.gastar(player, NAMEK.ki.blastCost)) return;

    const alvo = Number.isFinite(msg.target) ? msg.target : null;
    this.broadcastAll({
      t: NS2C.BLAST,
      owner: player.id,
      /* NÚMERO, e nunca o que veio da rede.
       *
       * O `id` casa o acerto com o disparo e para isso ele só precisa ser um
       * inteiro. Repassá-lo intacto fazia da sala um AMPLIFICADOR: um cliente
       * mandou um `id` de 200 000 caracteres e ela o retransmitiu para cada uma
       * das outras catorze conexões — três megabytes de subida do servidor a
       * partir de um pacote. É o mesmo cuidado que `vec()` já toma com as
       * coordenadas, aplicado ao campo que tinha escapado. */
      id: Number.isFinite(msg.id) ? msg.id : 0,
      o: vec(msg.o),
      d: vec(msg.d),
      hand: msg.hand === 1 ? 1 : 0,
      target: alvo,
      w: clampTempo(msg.w, this.now()),
    });
    /* Os bots precisam VER a bola para desviar dela. Ver o cabeçalho de
       `bots.js`: ela entra na simulação como fantasma — não machuca (quem
       atirou é dono do próprio acerto) e não abre cratera, mas está lá. */
    this.bots.avisarRajada({ owner: player.id, o: msg.o, d: msg.d, target: alvo });
  }

  /**
   * "A minha bola acertou fulano."
   *
   * Mesmo contrato do `C2S.IMPACT` do arqueiro. As quatro conferências são as
   * que custam quase nada e pegam quase tudo que é INCOERÊNCIA: a vítima
   * existe, está viva, não está piscando, e o ponto declarado é perto dela.
   */
  registrarAcerto(player, msg) {
    if (!player.alive) return;
    const vitima = this.lutadorPor(msg.victim);
    if (!vitima || vitima === player || !vitima.alive) return;
    if (this.now() < vitima.invulnUntil) return;
    if (!vetorOk(msg.p)) return;

    const p = this.pontoDe(vitima);
    const alvo = { x: p.x, y: p.y + NAMEK.fighter.chest, z: p.z };
    const d = Math.hypot(msg.p[0] - alvo.x, msg.p[1] - alvo.y, msg.p[2] - alvo.z);
    if (d > NAMEK.blast.hitRadius + NAMEK.fighter.radius + TOLERANCIA) return;

    /* E o tiro tem de ter sido possível: a bola vive `life` segundos a `speed`,
       então ninguém acerta alguém a mais de 200 m de onde está. */
    const eu = this.pontoDe(player);
    const alcance = NAMEK.blast.speed * NAMEK.blast.life + TOLERANCIA;
    if (Math.hypot(alvo.x - eu.x, alvo.y - eu.y, alvo.z - eu.z) > alcance) return;

    const dir = versorEntre(eu, alvo);
    this.aplicarDano(vitima, NAMEK.blast.damage, {
      por: player,
      kind: "blast",
      p: { x: msg.p[0], y: msg.p[1], z: msg.p[2] },
      d: [dir.x, dir.y, dir.z],
    });
  }

  /**
   * O especial. **Só sai com a barra CHEIA** — §5 do plano, e é a regra que dá
   * ao modo a economia inteira dele.
   *
   * Recusar em silêncio é de propósito: o cliente já começou a animação (ele
   * prevê, como prevê tudo), e o `VITALS` de no máximo 100 ms depois desmente a
   * barra. Uma mensagem de recusa só existiria para dizer o que a barra já diz.
   */
  registrarEspecial(player, msg) {
    if (!player.alive) return;
    const info = specialInfo(msg.kind);
    if (!info) return;
    if (!vetorOk(msg.o) || !vetorOk(msg.d)) return;
    if (player.ki < NAMEK.ki.max * NAMEK.ki.specialThreshold) return;
    if (!this.gastar(player, NAMEK.ki.max)) return;

    const agora = this.now();
    /* A JANELA DO GOLPE, e ela é o que dá dentes ao `SPECIAL_HIT`: sem este
       registro, um cliente poderia cobrar dano de feixe por tempo indefinido
       sem nunca ter soltado feixe nenhum. Com ele, o dano só é aceito enquanto
       o golpe declarado existe, e no máximo pelo tempo que ele dura. */
    player.especial = {
      kind: msg.kind,
      info,
      ate: agora + (info.windup + info.sustain + 0.35) * 1000,
      /* Segundos de exposição já cobrados, POR VÍTIMA — e é por vítima, e não
         no total, porque o feixe ATRAVESSA. Um Kamehameha alinhado com três
         pessoas queima as três pelos mesmos 2,4 s; com um contador só, a
         primeira consumiria o orçamento e as outras duas sairiam ilesas de
         dentro do feixe. O teto continua existindo, um por pessoa, e é ele que
         impede um `dt` inflado de virar dano infinito.
         O mapa é limitado pelo elenco: `lutadorPor` já descartou id que não
         existe antes de qualquer coisa ser escrita aqui. */
      exposicao: new Map(),
      o: vec(msg.o),
      d: vec(msg.d),
    };

    this.broadcastAll({
      t: NS2C.SPECIAL,
      owner: player.id,
      kind: msg.kind,
      o: vec(msg.o),
      d: vec(msg.d),
      w: clampTempo(msg.w, agora),
    });
    this.bots.avisarEspecial({ owner: player.id, kind: msg.kind, o: msg.o, d: msg.d });
  }

  /**
   * "O meu especial está queimando fulano há `dt` segundos."
   *
   * O `dt` é a peça mais delicada do protocolo inteiro e o comentário dele
   * explica por quê: é assim que um feixe SUSTENTADO cobra por segundo sem
   * mandar uma mensagem por quadro. E é exatamente por isso que ele é o número
   * mais fácil de inflar — daí as três travas: o golpe tem de existir, o `dt`
   * de um aviso não passa de meio segundo, e a soma de todos não passa do
   * `sustain` do golpe.
   */
  registrarQueimadura(player, msg) {
    if (!player.alive) return;
    const e = player.especial;
    if (!e || e.kind !== msg.kind) return;
    const agora = this.now();
    if (agora > e.ate) {
      player.especial = null;
      return;
    }
    const vitima = this.lutadorPor(msg.victim);
    if (!vitima || vitima === player || !vitima.alive) return;
    if (agora < vitima.invulnUntil) return;

    /* O FEIXE É UM SEGMENTO, NÃO UMA ESFERA — e essa era a metade que faltava.
     *
     * Só a distância era conferida, e com isso quem declarasse a vítima podia
     * escolher qualquer um dentro do alcance, inclusive às próprias costas.
     * Medido: um Kamehameha apontado para +z queimava alguém 400 m em −z, e uma
     * Genki Dama sozinha atingiu as quatro vítimas espalhadas em direções
     * opostas — 96 de dano cada, de 100 de vida.
     *
     * A conta é a distância da vítima ao EIXO do golpe, medida da ORIGEM e na
     * DIREÇÃO que ficaram travadas no disparo (`e.o`, `e.d`) — e não da posição
     * atual de quem atirou, que já andou desde então.
     *
     * Distância ao eixo, e não um cone: um cone de ângulo fixo é largo demais
     * longe e apertado demais perto, enquanto o raio de morte do golpe é o mesmo
     * em qualquer distância — que é exatamente como o feixe se comporta na tela
     * de quem atira. A folga é a mesma `TOLERANCIA` do resto.
     *
     * `t` é quanto se anda pelo eixo até o pé da perpendicular: negativo é a
     * vítima atrás da boca do golpe, e além do alcance é longe demais. */
    const p = this.pontoDe(vitima);
    const vx = p.x - e.o[0];
    const vy = p.y - e.o[1];
    const vz = p.z - e.o[2];

    const dn = Math.hypot(e.d[0], e.d[1], e.d[2]);
    /* Direção degenerada não pode virar divisão por zero. `vetorOk` garante que
       os três números são finitos, não que eles formam um versor: um cliente
       pode mandar [0,0,0], e sem esta saída o `t` viraria NaN e toda comparação
       com NaN é falsa — ou seja, o golpe passaria a acertar todo mundo. */
    if (dn < 1e-6) return;
    const dx = e.d[0] / dn;
    const dy = e.d[1] / dn;
    const dz = e.d[2] / dn;

    const t = vx * dx + vy * dy + vz * dz;
    if (t < 0 || t > e.info.range + TOLERANCIA) return;

    const raio = (e.info.hitRadius ?? 4) + TOLERANCIA;
    const fora = Math.hypot(vx - dx * t, vy - dy * t, vz - dz * t);
    if (fora > raio) return;

    /* Feixe cobra por SEGUNDO (`dps`); disco e Genki Dama cortam DE UMA VEZ
       (`damage`). São dois golpes de natureza diferente e a mesma mensagem
       serve aos dois — a diferença é só quantas vezes cada um pode cobrar da
       mesma pessoa. */
    const ja = e.exposicao.get(vitima.id) ?? 0;
    let dano;
    if (e.info.dps !== undefined) {
      const dt = clamp(Number(msg.dt) || 0, 0, 0.5);
      const cobrado = Math.min(dt, Math.max(0, e.info.sustain - ja));
      if (cobrado <= 0) return;
      e.exposicao.set(vitima.id, ja + cobrado);
      dano = e.info.dps * cobrado;
    } else {
      /* Um corte por pessoa. O disco atravessa uma fileira inteira — e deve —,
         mas não serra a mesma pessoa duas vezes na mesma passagem. */
      if (ja > 0) return;
      e.exposicao.set(vitima.id, e.info.sustain);
      dano = e.info.damage;
    }

    this.aplicarDano(vitima, dano, {
      por: player,
      kind: e.kind,
      p: { x: p.x, y: p.y + NAMEK.fighter.chest, z: p.z },
      d: e.d,
      continuo: e.info.dps !== undefined,
    });
  }

  registrarOnda(player, msg) {
    if (!player.alive) return;
    if (!vetorOk(msg.p)) return;
    /* A onda sai de QUEM a soltou, então o ponto declarado tem de ser o corpo
       dele. Oito metros de folga cobrem o atraso da pose; o que a checagem
       impede é a onda teleportada para o meio de um grupo do outro lado do
       mapa. */
    const eu = this.pontoDe(player);
    if (Math.hypot(msg.p[0] - eu.x, msg.p[1] - eu.y, msg.p[2] - eu.z) > 8 + TOLERANCIA) return;
    if (!this.gastar(player, NAMEK.ki.burstCost)) return;
    this.onda(player, { x: msg.p[0], y: msg.p[1], z: msg.p[2] });
  }

  registrarChao(player, msg) {
    if (!vetorOk(msg.p)) return;
    const power = Number(msg.power);
    if (!Number.isFinite(power) || power <= 0) return;

    /* MORTO NÃO CAVA. A cratera é a marca de um golpe, e quem está caído não
       está dando golpe nenhum — sem esta linha, um cliente parado na tela de
       morte continuava esculpindo o terreno de todo mundo. */
    if (!player.alive) return;

    /* E NÃO CAVA DO OUTRO LADO DO MAPA. O ponto tem de estar ao alcance de
       alguma coisa que este lutador poderia ter disparado; o maior alcance do
       jogo é o da Genki Dama. Sem o teste, uma cratera declarada a 928 m — o
       caso medido — era carimbada e retransmitida sem discussão. */
    const eu = this.pontoDe(player);
    const alcance = ALCANCE_MAXIMO + TOLERANCIA;
    if (dist2(msg.p, eu) > alcance * alcance) return;

    /* A cota por lutador é cobrada dentro de `cratera()`, para valer também
       para o bot e para o baque de queda. Ver o comentário lá.

       O teto é a potência do golpe mais forte do jogo (a Genki Dama, 12), com
       uma folga para a queda. `craterFor` já apara em 64 e `craterMax` apara o
       raio em 34 m; isto apara mais cedo, porque uma potência absurda vinda da
       rede também vira uma cratera absurda no índice espacial. */
    this.cratera(msg.p[0], msg.p[2], Math.min(power, 16), player);
  }

  registrarProp(player, msg) {
    if (typeof msg.kind !== "string" || !Number.isFinite(msg.i)) return;
    /* Teto de memória. O cenário tem algumas centenas de peças, então este
       número nunca é alcançado jogando; ele existe porque a chave vem da rede,
       e um cliente que mandasse índices crescentes para sempre faria a sala
       guardar um `Set` que só cresce. */
    if (this.propsCaidos.size > 4000) return;
    const chave = `${msg.kind}:${msg.i}`;
    /* Uma peça só cai uma vez. Sem esta memória, duas pessoas acertando a mesma
       rocha no mesmo instante mandariam dois `PROP_DOWN`, e o cliente estilharia
       o mesmo objeto duas vezes — dois montes de detrito no mesmo lugar. */
    if (this.propsCaidos.has(chave)) return;
    this.propsCaidos.add(chave);
    this.broadcastAll({ t: NS2C.PROP_DOWN, kind: msg.kind, i: msg.i, by: player.id });
  }

  /**
   * "Caí de muito alto."
   *
   * Cratera, e vida. A queda é a única fonte de dano do modo que não tem
   * culpado — morrer assim conta a morte no placar e não dá abate a ninguém, o
   * que é a leitura honesta do que aconteceu.
   */
  registrarQueda(player, msg) {
    if (!player.alive || !vetorOk(msg.p)) return;
    const speed = Math.abs(Number(msg.speed) || 0);
    const F = NAMEK.fighter;
    const D = NAMEK.destruction;

    if (speed > D.slamSpeed) {
      this.cratera(msg.p[0], msg.p[2], Math.min((speed - D.slamSpeed) * D.slamPower, 16), player);
    }
    if (speed <= F.fallSafe) return;
    this.aplicarDano(player, (speed - F.fallSafe) * F.fallDamage, {
      kind: "queda",
      p: { x: msg.p[0], y: msg.p[1], z: msg.p[2] },
      d: [0, 1, 0],
    });
  }

  /** Renascer antes da hora. Depois do mínimo, quem quer voltar volta. */
  registrarRespawn(player) {
    if (player.alive || !player.respawnAt) return;
    const agora = this.now();
    const desde = player.respawnAt - NAMEK.respawn.delay * 1000;
    if (agora - desde < RESPAWN_MINIMO * 1000) return;
    this.nascer(player, agora);
  }

  /* ================================================================ envio == */

  /**
   * As poses de todo mundo, 20 Hz. **A mensagem mais cara do modo.**
   *
   * Cada lutador é empacotado UMA vez e serializado UMA vez, num fragmento de
   * texto; a mensagem de cada cliente é a junção dos fragmentos dos OUTROS. É a
   * diferença entre quinze `JSON.stringify` de catorze objetos por quadro
   * (trezentos por segundo, com quinze em campo) e quinze concatenações de
   * texto já pronto.
   *
   * E o motivo de excluir o próprio dono não é economia de bytes: é que a pose
   * dele é DELE (§8). Devolvê-la seria o servidor mandando de volta uma
   * informação que o cliente já tem melhor, e todo cliente teria de escrever a
   * linha que a ignora.
   */
  broadcastStates(agora) {
    for (const b of this.bots.list) {
      b.state = packFighter(b);
      b.stateTime = agora;
    }
    if (!this.players.size) return;

    const ids = [];
    const frags = [];
    for (const f of this.todos()) {
      if (!f.state) continue;
      ids.push(f.id);
      frags.push(JSON.stringify({ id: f.id, w: f.stateTime, ...podar(f.state) }));
    }
    if (!frags.length) return;

    const cabeca = `{"t":"${NS2C.STATES}","time":${agora},"s":[`;
    for (const p of this.players.values()) {
      let corpo = "";
      for (let i = 0; i < frags.length; i++) {
        if (ids[i] === p.id) continue;
        if (corpo) corpo += ",";
        corpo += frags[i];
      }
      if (!corpo) continue;
      raw(p.conn, cabeca + corpo + "]}");
    }
  }

  /**
   * Vida e ki de todos, 10 Hz.
   *
   * Array de arrays e não de objetos — o protocolo explica: quinze lutadores a
   * 10 Hz são a segunda mensagem mais cara do modo, e as chaves seriam metade
   * dos bytes. Os números vão inteiros porque a barra tem cem pixels: o
   * terceiro decimal de uma vida é ruído que custa quatro bytes.
   */
  broadcastVitals() {
    if (!this.players.size) return;
    const h = [];
    for (const f of this.todos()) h.push([f.id, Math.round(f.health), Math.round(f.ki)]);
    if (!h.length) return;
    this.broadcastAll({ t: NS2C.VITALS, h });
  }

  scores() {
    const s = [];
    for (const f of this.todos()) {
      s.push({
        id: f.id,
        name: f.name,
        color: f.color ?? null,
        isBot: f.isBot === true,
        ping: f.ping ?? 0,
        kills: f.score.kills,
        deaths: f.score.deaths,
      });
    }
    return s;
  }

  broadcastScores() {
    this.broadcastAll({ t: NS2C.SCORES, s: this.scores() });
  }

  /** Para todos menos `exceto` (por id). */
  broadcast(msg, exceto = null) {
    /* Sem ninguém para ouvir, nem o `JSON.stringify` acontece. Numa sala só de
       bots — que é o caso do banco de provas e o dos 30 s de carência — a briga
       inteira roda sem gastar um byte de serialização. */
    if (!this.players.size) return;
    const data = JSON.stringify(msg);
    for (const player of this.players.values()) {
      if (player.id === exceto) continue;
      raw(player.conn, data);
    }
  }

  /** Para todos, sem exceção. Mesmo par de nomes da sala do arqueiro. */
  broadcastAll(msg) {
    this.broadcast(msg, null);
  }

  destroy() {
    if (this.stepTimer) clearInterval(this.stepTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.stepTimer = null;
    this.sweepTimer = null;
    this.bots.clear();
    this.players.clear();
    this.corpos.length = 0;
    this.corpoPorId.clear();
  }
}

/* ------------------------------------------------------------- ciclo de vida */

/**
 * A sala de Namekusei para esta entrada, criando-a se não existir.
 *
 * Mora AQUI e não em `RoomHost` de propósito: o §11 do plano permite acrescentar
 * um `if` em `ensure`, e um `if` é o que ele acrescentou. Toda a lógica de
 * procurar, criar e registrar cabe nesta função, e `server/room.js` continua
 * sendo o arquivo do jogo do arqueiro — com uma linha a mais.
 *
 * A busca casa só a FASE, porque o modo é um só (`deathmatch`): não há tecla 9
 * neste jogo, nem troca de modo, nem sala que viaja. Sala de Namekusei é sala
 * de Namekusei para sempre.
 */
export function ensureNamekRoom(host) {
  for (const room of host.rooms) {
    if (room.level !== NAMEK_LEVEL) continue;
    /* Sala cheia de GENTE é pulada; sala cheia de BOT não — ver `join`, que
       abre vaga tirando um adversário de CPU. Mandar a pessoa para uma sala
       nova só porque a outra estava cheia de treino seria separá-la justamente
       de quem ela veio encontrar. */
    if (room.players.size >= NAMEK.net.maxPlayers) continue;
    host.cancelTeardown(room);
    return room;
  }

  const room = new NamekRoom({ log: host.log });
  room.onEmpty = (r) => host.scheduleTeardown(r);
  host.rooms.add(room);
  host.log(`sala criada — ${NAMEK_LEVEL} / ${NAMEK_MODE} (${host.rooms.size} no ar)`);
  return room;
}

/* ---------------------------------------------------------------- auxiliares */

/**
 * O que a sala conta sobre alguém para os outros.
 *
 * Passa no `WELCOME`, no `JOIN` e no `roster` — os três caminhos por onde um
 * corpo aparece na tela alheia. Mesma função do `publicView` do arqueiro, com o
 * `char` no lugar da `skin`: é o mesmo tipo de dado (um por PESSOA, que não muda
 * durante a partida e que todo mundo precisa para desenhá-la).
 */
function view(f) {
  return {
    id: f.id,
    name: f.name,
    color: f.color ?? null,
    char: f.char,
    isBot: f.isBot === true,
  };
}

function send(conn, msg) {
  raw(conn, JSON.stringify(msg));
}

function raw(conn, data) {
  try {
    conn.send(data);
  } catch {
    /* socket fechando no meio do envio: o `close` cuida do resto */
  }
}

/**
 * Os canais de pose que têm PADRÃO, e qual é.
 *
 * A lista sai de `unpackFighter`: todo campo que ele lê com `?? 0` (ou `?? -1`,
 * no caso do especial) é um campo que o protocolo já declarou opcional. Ver
 * `podar` para o que se faz com isso.
 */
const PADROES = { r: 0, g: 0, n: 0, fl: 0, bo: 0, ch: 0, sp: 0, sk: -1, hu: 0, ha: 0, hp: 0 };

/**
 * Tira da pose o que é igual ao padrão. **É a maior economia do modo.**
 *
 * `packFighter` sempre escreve os dezessete canais, porque ele não sabe para
 * onde a pose vai. Mas `unpackFighter` lê onze deles com `?? 0` — ou seja, o
 * protocolo já diz, por escrito e dos dois lados, que a ausência de um canal
 * significa zero. Não mandar o que é zero não é apertar o contrato: é usá-lo.
 *
 * E a diferença é grande porque a maioria dos canais é zero quase sempre. Um
 * lutador voando não tem marcha (`g`, `n`), não está carregando (`ch`), não
 * está soltando especial (`sp`, `sk`) e não está doendo (`hu`) — sete dos onze,
 * na maior parte dos quadros. Com quinze em campo, a mensagem de 20 Hz é a
 * conta de rede inteira deste modo, e um terço dela era a palavra "zero"
 * repetida.
 *
 * O que NÃO se poda: posição, velocidade, yaw, pitch e os bits. `unpackFighter`
 * os lê sem padrão, e é assim que tem de ser — uma posição ausente não é uma
 * posição na origem.
 */
function podar(s) {
  const out = { p: s.p, v: s.v, y: s.y, i: s.i, b: s.b };
  for (const k in PADROES) {
    const v = s[k];
    if (v !== undefined && v !== PADROES[k]) out[k] = v;
  }
  return out;
}

/** Um `[x,y,z]` que veio da rede é utilizável? */
function vetorOk(v) {
  return Array.isArray(v) && v.length >= 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

/** Arredonda um vetor para o milímetro, como `r3v` faz do lado de lá. */
function vec(v) {
  return [round(v[0]), round(v[1]), round(v[2])];
}

function versorEntre(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return { x: 0, y: 1, z: 0 };
  return { x: dx / d, y: dy / d, z: dz / d };
}

/**
 * Prende um instante vindo do cliente a uma janela plausível em torno de agora.
 *
 * Cópia consciente do `clampTime` de `server/room.js` — quinze linhas que não
 * podem ser importadas de lá sem criar a dependência que o §0 existe para
 * evitar, e cuja razão de ser é idêntica: um relógio adiantado jogaria a pose
 * no futuro e ela ficaria congelada até o tempo alcançá-la.
 */
function clampTempo(t, agora) {
  if (typeof t !== "number" || !Number.isFinite(t)) return agora;
  return Math.min(agora + 100, Math.max(agora - 500, t));
}
