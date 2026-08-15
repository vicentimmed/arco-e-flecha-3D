/* ---------------------------------------------------------------------------
   A sala. Uma só, e é o único árbitro do jogo.

   Este módulo NÃO conhece WebSocket, HTTP nem Node. Ele fala com "conexões" —
   qualquer objeto com `send(texto)` e `close()`. Quem traduz socket em conexão
   é o adaptador: `server/index.js` em produção, `server/vitePlugin.js` no
   desenvolvimento. É o que permite rodar exatamente a mesma lógica de jogo nos
   dois lugares, e é o que torna `npm run dev` um teste de verdade.

   O que a sala manda:
     • quem está dentro, com que nome e que cor;
     • onde cada um nasce;
     • o modo de jogo e o placar;
     • os porcos.

   O que ela NÃO manda, de propósito:
     • a trajetória das flechas — cada cliente recalcula a partir do evento de
       disparo, porque o voo é função de (origem, direção, velocidade, vento) e
       o vento é função do relógio compartilhado;
     • se você acertou — quem atirou decide, e o servidor só checa se o número
       é plausível. É essa escolha que faz o tiro parecer instantâneo em vez de
       cobrar meio ping de espera. Serve para jogar com amigos; não serve para
       público aberto, e isso está claro no plano.
   --------------------------------------------------------------------------- */

import { CONFIG, specialEnabled } from "../src/config.js";
import { pathCenterX } from "../src/shared/terrainField.js";
import { tempoDeVoo } from "../src/shared/soulFlight.js";
import { BotSquad, obstaculosDe } from "./botSim.js";
import { simularFlechaDoBot, orientacaoDe } from "./botArrow.js";
import { SpaceField } from "./spaceSim.js";
import { FlagField } from "./flagSim.js";
import {
  DEFAULT_LEVEL,
  LEVEL_IDS,
  createField,
  levelForMode,
  levelUsesDuelInvites,
  levelHasFauna,
  levelSpawnDrop,
  fallbackMode,
} from "../src/shared/levels.js";

function isZombieMode(mode) {
  return mode === "zombie" || mode === "zombieBoss";
}

/** A chuva de meteoros. Um modo só, mas testado em muitos lugares. */
function isMeteorMode(mode) {
  return mode === "meteorRain";
}

/** O cerco ao castelo. Ver `server/siegeSim.js` e `docs/plano-cerco.md`. */
function isSiegeMode(mode) {
  return mode === "siege";
}
import {
  C2S,
  S2C,
  PROTOCOL_VERSION,
  RejectReason,
  displayName,
  playerEntity,
  packState,
} from "../src/shared/protocol.js";
import { sanitizeSkin } from "../src/shared/skins.js";
import { ColorPool } from "./colors.js";
import { pickSpawnPoint, duelPositions, elkHuntPositions } from "./spawnPoints.js";
import { BoarHunt, boarPoints } from "./boarSim.js";
import { ElkHunt } from "./elkSim.js";
import { ElkWolfPack } from "./elkWolves.js";
import { BirdFlock } from "./birdSim.js";
import { ZombieNight } from "./zombieSim.js";
import { MeteorRain, meteorDifficultyOf } from "./meteorSim.js";
import { Siege, siegeDifficultyOf } from "./siegeSim.js";
import { BatSwarm } from "./batSim.js";
import { TargetSeries } from "./targetSeries.js";
import {
  CASTLE,
  gateInfo,
  walkwayPosts,
  trebuchetPosts,
} from "../src/shared/castleProps.js";

let nextPlayerId = 1;

export class Room {
  /**
   * @param {object} opcoes
   * @param {string} [opcoes.level] a fase em que a sala NASCE. Vem da tela de
   *   entrada: quem escolheu a Lua não passa pelo vale primeiro, e quem
   *   escolheu o vale nunca vai parar numa sala que já viajou.
   * @param {string} [opcoes.mode] o modo em que ela nasce — a noite dos zumbis
   *   é uma sala inteira, não um botão apertado depois de entrar.
   */
  constructor({ log = () => {}, level = DEFAULT_LEVEL, mode = "free" } = {}) {
    this.log = log;
    this.epoch = Date.now();

    /* Um campo de altura por FASE, todos construídos de uma vez.
     *
     * Construir sob demanda pareceria econômico e criaria um pico de trabalho
     * exatamente no instante da troca, com todos os clientes esperando. Aqui
     * eles custam milissegundos (o da Lua é uma lista de 252 crateras) e ficam
     * prontos para sempre — trocar de fase no servidor passa a ser trocar um
     * ponteiro. */
    this.fields = Object.fromEntries(LEVEL_IDS.map((id) => [id, createField(id)]));
    this.level = LEVEL_IDS.includes(level) ? level : DEFAULT_LEVEL;

    this.colors = new ColorPool();

    /** @type {Map<object, object>} conexão → jogador */
    this.players = new Map();
    this.mode = "free";
    /* O modo da ENTRADA — o que a tela inicial prometeu.
     *
     * Ele não é aplicado aqui, e sim quando o PRIMEIRO jogador entra: metade do
     * que `setMode` faz (sortear nascimentos, montar a horda, medir a horda pelo
     * número de pessoas) não tem resposta numa sala vazia. Nascer no modo livre
     * e virar zumbi no instante em que alguém chega passa pelo mesmo handshake
     * de preparo que a tecla 6 usa — um caminho, não dois. */
    this.entryMode = fallbackMode(this.level, mode);
    /** Troca de noite aguardando o aquecimento de todos os clientes. */
    this.pendingMode = null;
    this.nextModeToken = 1;

    /**
     * Flechas já cravadas no cenário e nos alvos.
     *
     * O servidor não simula flecha nenhuma — guarda só a pose final que o dono
     * reportou, para entregar a quem chegar depois. É o que faz quem entra
     * atrasado ver o campo de tiro como ele está, com as flechas nos alvos, em
     * vez de um cenário limpo que ninguém mais está vendo.
     */
    this.stuckArrows = [];

    /* Os adversários de CPU. Vivem AQUI, não no cliente — ver `botSim.js` para
       o porquê. Eles não têm `conn`, e é só isso que os distingue de um jogador
       humano em quase todo o resto desta classe. */
    this.bots = new BotSquad(this.terrain, this.level);

    /* A fase da Lua. Vazia fora dela — ver `spaceSim.js` para o que mora ali e
       o que ficou de propósito no cliente. */
    this.space = new SpaceField(this.terrain);

    this.hunt = new BoarHunt(this.terrain);
    this.elks = new ElkHunt(this.terrain);
    this.elkWolves = new ElkWolfPack(this.terrain);
    this.series = new TargetSeries(this.terrain);
    /* Os pássaros existem em quase todo modo como cenário vivo. No birdHunt o
       bando fica mais denso e nasce o pássaro raro — ver BirdFlock.reset. */
    this.birds = new BirdFlock(this.terrain);
    /** Partida de caça aos pássaros já tem vencedor (não reabre o placar). */
    this.birdHuntOver = false;
    /** Vitória pela rara adiada até o corpo tocar o chão. */
    this.pendingSpecialBirdWin = null;
    this.zombies = new ZombieNight(this.terrain);
    /* A chuva de meteoros. Vive na Lua, e o campo é da FASE: sai inteiro com
       ela e renasce do outro lado (ver `commitPreparedMode`). */
    this.meteors = new MeteorRain(this.terrain);
    /* O cerco. Vive no castelo, e o campo é da FASE — sai inteiro com ela e
       renasce do outro lado, como a chuva. Ver `commitPreparedMode`. */
    this.siege = new Siege(this.terrain);
    /* Os morcegos gigantes do cerco. Sistema à parte do `Siege` por uma razão
       de FORMATO: eles não cabem no quadro binário (as oito espécies já ocupam
       os 3 bits do campo) e não precisam dele — são dois bichos, e dois bichos
       em JSON custam menos que um byte a mais em cento e vinte sitiantes. Ver
       o cabeçalho de `server/batSim.js`.

       `morcegos` e não `bats`: `this.bots` já existe, e dois campos com nomes
       parecidos no mesmo objeto é o começo de um erro de digitação silencioso. */
    this.morcegos = new BatSwarm(this.terrain);
    /**
     * Os dois trabucos: `{ pronto: ms em que estará carregado, wind: Set }`.
     *
     * Moram na SALA e não no cliente pelo mesmo motivo que a bandeira mora em
     * `flagSim.js`: o engenho é UM, e duas telas discordando sobre se ele está
     * carregado é duas pessoas atirando a mesma pedra.
     */
    this.trebuchets = trebuchetPosts().map((p) => ({ i: p.id, pronto: 0, wind: new Set() }));
    /** Quem está com a mão no reparo do portão, por id. */
    this.repairing = new Set();
    /** Carga do especial de cada jogador, por id. Ver `CONFIG.special`. */
    this.kameCharge = new Map();
    /**
     * A geração das barras. Sobe a cada zeramento.
     *
     * Existe porque o ponto do especial é creditado com ATRASO — o tempo de voo
     * da alma (ver `addKameCharge`). Um abate feito nos últimos segundos de uma
     * partida tem um ponto em trânsito quando o modo troca, e sem um selo de
     * geração ele cairia na partida seguinte.
     */
    this.kameGen = 0;
    /**
     * As quatro tochas do modo zumbi: acesa (true) ou apagada (false).
     *
     * Mora na SALA e não no cliente porque apagar uma tocha muda o campo para
     * todo mundo — é a única peça de cenário do jogo que os jogadores podem
     * destruir, e duas telas com tochas diferentes seriam dois campos de jogo.
     */
    this.torches = [true, true, true, true];
    /**
     * Vento na flecha — um booleano da SALA, não de cada cliente.
     *
     * Se cada um ligasse o seu, a flecha do amigo cairia num lugar e a sua
     * noutro, e o placar mentiria. Aqui quem aperta V muda para todo mundo.
     */
    this.windInfluence = true;
    /* Placar do duelo de times.
     *
     * Não há nada a conferir aqui, e é essa a diferença que o Bloco B trouxe:
     * o servidor é dono dos DOIS lados, então ele sabe quem matou quem sem
     * perguntar a nenhum cliente. */
    this.teamScores = { humans: 0, bots: 0 };

    /* A bandeira. Vazia fora do modo dela — ver `flagSim.js`. */
    this.flag = new FlagField();
    /* De que lado cada corpo está NO ROUBA BANDEIRA. Vazio nos outros modos,
       onde o time continua saindo de `isBot`. Ver `timeDe` e `escalarNoTime`. */
    this.equipes = new Map();

    /**
     * O ÚLTIMO EM PÉ: quem ainda não morreu nesta rodada.
     *
     * Um `Set` de ids, e não um campo `standAlive` em cada jogador, porque a
     * pergunta que o modo faz o tempo todo é "quantos sobraram?" — e essa é uma
     * pergunta sobre a RODADA, não sobre uma pessoa. Quem entra na sala no meio
     * da rodada simplesmente não está no conjunto: assiste, e entra na próxima.
     */
    this.standAlive = new Set();
    this.standOver = false;

    /** Quem apertou "quero duelar" e ainda não desistiu. */
    this.duelInvites = new Set();
    this.inviteExpires = 0;

    const net = CONFIG.net;
    this.stateTimer = setInterval(
      () => this.broadcastStates(),
      1000 / net.stateHz,
    );
    this.sweepTimer = setInterval(
      () => this.dropSilentConnections(),
      net.heartbeat * 1000,
    );
    // Os bichos andam num passo próprio, mais lento que o dos jogadores: um
    // javali não precisa de 20 Hz para parecer que anda.
    this.boarStep = 1 / net.boarHz;
    this.boarTimer = setInterval(() => this.tickCreatures(), 1000 / net.boarHz);

    /* Os bots andam no passo dos JOGADORES, não no dos bichos.
       Eles são adversários de duelo: mirar, girar e soltar a corda a 10 Hz sai
       aos trancos, e o giro limitado por quadro (que é o que permite flanqueá-los)
       viraria um salto. `stateHz` é o mesmo relógio em que a pose deles é
       transmitida, então cada amostra enviada é uma amostra recém-calculada. */
    this.botStep = 1 / net.stateHz;
    this.botLast = Date.now();
    this.botTimer = setInterval(() => this.tickBots(), 1000 / net.stateHz);
  }

  /* ----------------------------------------------------------------- espaço -- */

  /**
   * Um passo da Lua, e o que ele produziu.
   *
   * Roda no relógio dos bichos (10 Hz): alien, nave e meteorito têm a mesma
   * cadência de um javali, e nenhum deles precisa de mais. Fora da Lua o campo
   * está desligado e isto custa um `if`.
   */
  tickSpace(dt) {
    if (this.level !== "moon") {
      if (this.space.ativo) this.space.clear();
      return;
    }
    if (!this.space.ativo) this.space.ligar();
    /* O céu é do MODO: na chuva, nave e meteorito em deriva saem de cena e o
       alien fica raro (ver `SpaceField.setPerfil`). */
    this.space.setPerfil(this.mode);
    this.space.setHorde(this.meteors.horde);

    const jogadores = this.playerPositions();
    const { mortes, eventos } = this.space.update(dt, jogadores);

    for (const ev of eventos) this.broadcastAll({ t: S2C.SPACE_EVENT, ...ev });
    for (const m of mortes) this.matarPeloEspaco(m.vitima, m.causa);

    /* Meteorito e rover em UMA amostra a cada duas (5 Hz). Ver `SpaceField.view`
       para por que eles não precisam de 10 Hz e por que alien e nave precisam. */
    this.spaceTick = (this.spaceTick ?? 0) + 1;
    const completo = this.spaceTick % 2 === 0;
    this.broadcastAll({ t: S2C.SPACE, time: this.now(), ...this.space.view(completo) });
  }

  /**
   * A Lua matou alguém: alien, explosão de nave ou estilhaço de meteorito.
   *
   * Passa pelo MESMO `S2C.KILL` de uma flechada. Antes isto era resolvido só na
   * tela da vítima (`killedByLocalNPC`), porque o servidor não conhecia nem o
   * alien nem a nave — e o resultado era um corpo caindo numa tela e um
   * arqueiro em pé nas outras.
   */
  matarPeloEspaco(vitimaId, causa) {
    const vitima = this.playerById(vitimaId);
    if (!vitima || !vitima.alive) return;
    if (this.now() < vitima.invulnUntil) return;

    vitima.alive = false;
    vitima.score.deaths++;

    this.broadcastAll({
      t: S2C.KILL,
      victim: vitima.id,
      victimName: vitima.name,
      killer: null,
      killerName: causa === "alien" ? "um alien" : "a Lua",
      killerColor: "#9aa0a6",
      victimColor: vitima.color,
      distance: null,
      c: null,
      v: null,
      cause: causa,
    });
    this.broadcastScores();

    this.aoMorrer(vitima);
  }

  /**
   * ALGUÉM MORREU. O que acontece a seguir.
   *
   * Este é o funil por onde passa toda morte de arqueiro, venha ela de flecha,
   * de faca, de chifrada, de porco ou da Lua — os seis caminhos chamam aqui
   * logo depois de anunciar o `KILL`. Ter um funil só é o que permitiu que dois
   * modos inteiros mudassem a regra da morte sem tocar em nenhum deles.
   *
   * São três desfechos possíveis, e o modo escolhe:
   *
   * • ROUBA BANDEIRA — se a vítima carregava a bandeira, ela CAI aqui, no
   *   lugar da morte, antes de qualquer outra coisa. Depois a pessoa renasce na
   *   base do próprio time.
   * • O ÚLTIMO EM PÉ — não renasce. Sai do conjunto dos vivos e passa a
   *   assistir; se sobrou um, a rodada acabou.
   * • QUALQUER OUTRO — o corpo cai e a pessoa volta, que é a regra de sempre.
   *
   * O teste de "ainda está na sala" é diferente para cada natureza: o humano
   * some quando o socket cai, o bot quando é removido do esquadrão. Testar só
   * `players.has(conn)` era o que deixava um CPU morto por um humano caído para
   * sempre, enquanto o mesmo CPU morto por outro CPU renascia.
   */
  aoMorrer(vitima) {
    /* A bandeira cai PRIMEIRO. Ela é estado compartilhado da partida, e um
       instante de "morto mas ainda carregando" é um instante em que o placar
       pode ser decidido por um cadáver. */
    if (this.mode === "captureFlag") this.derrubarBandeira(vitima);

    if (this.mode === "lastStand") {
      this.eliminar(vitima);
      return;
    }

    /* A bandeira tem espera PRÓPRIA, e mais longa. Morrer defendendo a base
       precisa custar: com os 1,8 s padrão, o defensor volta antes de o atacante
       cruzar o disco, e atacar deixa de ter chance nenhuma. */
    const atraso =
      this.mode === "captureFlag"
        ? CONFIG.modes.captureFlag.respawnDelay
        : CONFIG.spawn.respawnDelay;
    const espera = (CONFIG.spawn.deathDuration + atraso) * 1000;
    setTimeout(() => {
      const naSala = vitima.isBot
        ? !!this.bots.byId(vitima.id)
        : this.players.has(vitima.conn);
      if (!naSala) return;
      /* Na bandeira renasce-se EM CASA, não no meio do mapa. É o que faz a base
         valer alguma coisa: sem isso, defendê-la seria defender um ponto vazio
         que a equipe adversária alcança tão depressa quanto a dona. */
      if (this.mode === "captureFlag") this.spawnNaBase(vitima);
      else this.spawn(vitima);
    }, espera).unref?.();
  }

  /* ------------------------------------------------------- o último em pé -- */

  /**
   * Tira alguém da rodada — e vê se sobrou um.
   *
   * Não manda `SPAWN` nenhum, e é essa AUSÊNCIA que o cliente lê como "você
   * virou espectador" (`main.js`, `S2C.STAND_STATUS`). A eliminação é anunciada
   * por mensagem própria em vez de deduzida do `KILL`, porque nem toda morte
   * elimina: fora deste modo o mesmo `KILL` significa "volta em quatro
   * segundos", e deduzir daria ao cliente a chance de deduzir errado.
   */
  eliminar(vitima) {
    if (!this.standAlive.delete(vitima.id)) return;
    this.broadcastStandStatus();
    this.checarUltimoEmPe();
  }

  /** Sobrou um? Então a rodada acabou. */
  checarUltimoEmPe() {
    if (this.mode !== "lastStand" || this.standOver) return;
    if (this.standAlive.size > 1) return;

    this.standOver = true;
    const vencedorId = [...this.standAlive][0] ?? null;
    const vencedor = vencedorId != null ? this.playerById(vencedorId) : null;

    /* O ranking sai por ABATES, e o vencedor vem à parte. Não é a mesma coisa:
       ganha quem sobrou, não quem matou mais — e é perfeitamente possível
       vencer sem ter atirado uma flecha, escondido atrás de uma pedra enquanto
       os outros se acabavam. Isso é uma vitória legítima do modo, e a tela
       final precisa mostrar as duas informações para que ela seja LEGÍVEL. */
    const ranking = this.allCharacters()
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        kills: p.score.kills,
        survived: this.standAlive.has(p.id),
      }))
      .sort((a, b) => Number(b.survived) - Number(a.survived) || b.kills - a.kills);

    this.broadcastAll({
      t: S2C.STAND_OVER,
      winner: vencedorId,
      winnerName: vencedor?.name ?? null,
      winnerColor: vencedor?.color ?? null,
      ranking,
    });
    this.log(
      vencedor ? `último em pé: ${vencedor.name}` : "último em pé: ninguém sobrou",
    );
  }

  broadcastStandStatus() {
    if (this.mode !== "lastStand") return;
    const vivos = [];
    for (const p of this.allCharacters()) {
      if (this.standAlive.has(p.id)) {
        vivos.push({ id: p.id, name: p.name, color: p.color });
      }
    }
    this.broadcastAll({
      t: S2C.STAND_STATUS,
      alive: vivos,
      total: this.standTotal ?? vivos.length,
      over: this.standOver,
    });
  }

  /* -------------------------------------------------------- rouba bandeira -- */

  /**
   * A que time alguém pertence.
   *
   * FORA do rouba bandeira continua sendo humanos de um lado e CPU do outro —
   * é o que o duelo de times sempre foi, e é uma divisão que se explica sozinha.
   *
   * DENTRO dele, não: o modo pede que a entrada equilibre os lados, e com a
   * regra antiga "equilibrar" era impossível por construção — três humanos e um
   * bot davam 3 × 1 para sempre, e o time de um homem só perdia por aritmética.
   * Aqui cada corpo que entra é ATRIBUÍDO ao lado que tem menos gente (ver
   * `escalarNoTime`), humano ou não, e é essa atribuição que manda.
   */
  /**
   * Este modo tem lados?
   *
   * A pergunta existe porque `timeDe` responde sempre — no duelo livre ela diria
   * "humans" para toda pessoa e "bots" para toda CPU, o que é verdade e não
   * significa nada. Usar essa resposta como time faria dois bots numa sala vazia
   * pararem de duelar entre si, que é justamente a demonstração da IA.
   */
  temTimes() {
    return this.mode === "captureFlag" || this.mode === "teamDuel";
  }

  timeDe(id) {
    if (this.mode === "captureFlag") {
      const t = this.equipes.get(id);
      if (t) return t;
    }
    const p = this.playerById(id);
    return p?.isBot ? "bots" : "humans";
  }

  /**
   * Põe alguém no time com MENOS gente.
   *
   * Empate vai para `humans`, e a escolha do desempate não importa: o que
   * importa é ser determinística, senão dois jogadores entrando no mesmo
   * instante cairiam ambos no lado que o sorteio preferiu e o desequilíbrio
   * voltaria pela porta dos fundos.
   *
   * @returns {"humans"|"bots"}
   */
  escalarNoTime(id) {
    const atual = this.equipes.get(id);
    if (atual) return atual;
    let h = 0;
    let b = 0;
    for (const t of this.equipes.values()) {
      if (t === "humans") h++;
      else b++;
    }
    const time = h <= b ? "humans" : "bots";
    this.equipes.set(id, time);
    return time;
  }

  /**
   * Redistribui todo mundo do zero.
   *
   * Roda ao ENTRAR no modo, e só aí. No meio da partida ninguém troca de lado —
   * um jogador que muda de camisa porque outro desconectou é um jogador que
   * marca ponto para quem ele estava atacando trinta segundos antes.
   *
   * A ordem é a de `allCharacters`, que enfileira os humanos antes dos bots:
   * intercalando pela contagem, isso distribui as pessoas primeiro e usa os
   * bots para completar — que é exatamente o que se quer, porque é o time com
   * menos gente de verdade que precisa da ajuda da CPU.
   */
  refazerEquipes() {
    this.equipes.clear();
    for (const p of this.allCharacters()) this.escalarNoTime(p.id);
  }

  /** A vítima carregava a bandeira? Então ela cai aqui. */
  derrubarBandeira(vitima) {
    const onde = vitima.state
      ? { x: vitima.state.p[0], y: vitima.state.p[1], z: vitima.state.p[2] }
      : vitima.position;
    const ev = this.flag.soltar(vitima.id, onde);
    if (!ev) return;
    this.broadcastAll({ t: S2C.FLAG_EVENT, ...ev, byName: vitima.name });
    this.broadcastFlag();
  }

  /**
   * Renasce na base do próprio time, e não no sorteio do mapa.
   *
   * O ponto exato é sorteado num disco em volta da base: nascer sempre na mesma
   * coordenada faria da porta de casa um ponto de emboscada de tiro certo.
   */
  spawnNaBase(player) {
    const base = this.flag.bases?.[this.timeDe(player.id)];
    if (!base) return this.spawn(player);

    const raio = CONFIG.modes.captureFlag.baseRadius;
    let ponto = { x: base.x, z: base.z };
    for (let i = 0; i < 12; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * raio;
      const x = base.x + Math.cos(ang) * r;
      const z = base.z + Math.sin(ang) * r;
      if (this.terrain.isFlatGround?.(x, z) ?? true) {
        ponto = { x, z };
        break;
      }
    }
    this.spawn(player, ponto);
  }

  /**
   * Um passo da bandeira, no relógio dos bichos.
   *
   * Quem pega a bandeira é decidido AQUI e em nenhum cliente: encostar é pegar,
   * e a sala já sabe onde todo mundo está. Ver o cabeçalho de `flagSim.js`.
   */
  tickFlag(dt) {
    if (this.mode !== "captureFlag" || !this.flag.ativo) return;

    const eventos = this.flag.update(dt, this.playerPositions(), (id) => this.timeDe(id));
    for (const ev of eventos) {
      const quem = ev.by != null ? this.playerById(ev.by) : null;
      this.broadcastAll({
        t: S2C.FLAG_EVENT,
        ...ev,
        byName: quem?.name ?? null,
        byColor: quem?.color ?? null,
      });
      if (ev.kind === "capture") {
        // A entrega é do JOGADOR também, e não só do time: sem isso o placar
        // final ordenaria por abates, e num modo de bandeira quem corre com ela
        // é quem ganhou a partida.
        if (quem) quem.score.captures = (quem.score.captures ?? 0) + 1;
        this.teamScores = { ...this.flag.scores };
        this.broadcastTeamScores();
        this.broadcastScores();
        this.log(`bandeira: ${quem?.name ?? "?"} entregou (${ev.team})`);
      } else if (ev.kind === "rescue") {
        this.log(`bandeira: ${quem?.name ?? "?"} resgatou a do time ${ev.flag}`);
      }
    }

    if (this.flag.over && !this.flagOverAnunciado) {
      this.flagOverAnunciado = true;
      const ranking = this.allCharacters()
        .map((p) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          team: this.timeDe(p.id),
          captures: p.score.captures ?? 0,
          kills: p.score.kills,
        }))
        // Entregas primeiro, abates como desempate: é a ordem do que o modo pede.
        .sort((a, b) => b.captures - a.captures || b.kills - a.kills);
      this.broadcastAll({
        t: S2C.FLAG_OVER,
        winner: this.flag.winner,
        scores: { ...this.flag.scores },
        ranking,
      });
      this.log(`bandeira: vitória de ${this.flag.winner}`);
    }

    this.broadcastFlag();
  }

  /**
   * Para onde este bot deve ir no rouba bandeira.
   *
   * Três casos, nesta ordem:
   *
   * • ELE carrega a bandeira → corre para a base HUMANA, que é o gol dele.
   * • ALGUÉM DO OUTRO TIME carrega → persegue o portador. Não é "ir à
   *   bandeira": a bandeira está andando, e mandá-lo ao ponto onde ela estava
   *   há um décimo de segundo o faria correr sempre atrás do próprio rastro.
   * • ninguém carrega → vai buscá-la onde ela está.
   *
   * Um bot em cada três fica de GUARDA na própria base em vez de ir junto.
   * Sem isso os quatro correm em bloco para o mesmo ponto, deixam a base
   * aberta e o modo vira uma fila indiana atrás de um objeto — e ninguém
   * defende, que é metade do que o modo tem para oferecer. A escolha é fixa
   * por bot (o id decide), e não sorteada por quadro: um guarda que muda de
   * ideia dez vezes por segundo não guarda nada.
   */
  objetivoDoBot(bot) {
    if (!this.flag.ativo || this.flag.over || !this.flag.flags) return null;
    const bases = this.flag.bases;
    if (!bases) return null;

    const meu = this.timeDe(bot.id);
    const deles = meu === "humans" ? "bots" : "humans";
    const minha = this.flag.flags[meu]; // a que ele DEFENDE
    const alvo = this.flag.flags[deles]; // a que ele ROUBA

    /* 1. ELE CARREGA A DO OUTRO → corre para casa. É o gol, e nada mais
          importa enquanto a bandeira estiver na mão dele. */
    if (alvo.carrier === bot.id) return bases[meu];

    /* 2. A DELE ESTÁ FORA DE CASA → recuperar vem antes de atacar, e vem para
          TODOS os bots do time, não só para o guarda.
          É a regra que faz o time da CPU parecer um time: quando a bandeira
          deles é roubada, eles largam o ataque e vão atrás — que é o que um
          grupo de pessoas faz sem combinar nada. Se a bandeira está caída, o
          destino é ela (encostar resgata); se está com alguém, é o ladrão. */
    if (minha.state === "carried") {
      const ladrao = this.playerById(minha.carrier);
      const p = ladrao?.state
        ? { x: ladrao.state.p[0], z: ladrao.state.p[2] }
        : ladrao?.position;
      if (p) return { x: p.x, z: p.z };
    } else if (minha.state === "dropped") {
      return minha.position;
    }

    /* 3. UM FICA EM CASA. Sem guarda fixo, a base ficava vazia sempre que a
          bandeira própria estava a salvo — ou seja, exatamente no instante em
          que ela é roubável. Um em cada três, pelo id: é estável entre quadros
          (um sorteio faria o bot trocar de ideia dez vezes por segundo) e
          escala sozinho com o tamanho da esquadra. */
    if (bot.id % 3 === 0) return bases[meu];

    /* 4. Os outros atacam: vão até onde a bandeira adversária estiver — no
          mastro dela, no chão onde caiu, ou na mão de quem a leva. */
    return alvo.state === "home" ? bases[deles] : alvo.position;
  }

  broadcastFlag() {
    if (this.mode !== "captureFlag" || !this.flag.ativo) return;
    this.broadcastAll({ t: S2C.FLAG, time: this.now(), ...this.flag.view() });
  }

  /* ------------------------------------------------------------------ bots -- */

  /** Um passo da IA de todos os bots, e os tiros que ele produziu. */
  tickBots() {
    if (!this.bots.count) {
      this.botLast = Date.now();
      return;
    }
    const agora = Date.now();
    // `dt` medido, não nominal: um `setInterval` atrasado pelo laço de eventos
    // faria o bot andar menos do que o relógio diz, e a mira usa `dt` para
    // estimar a velocidade do alvo.
    const dt = Math.min(0.25, (agora - this.botLast) / 1000);
    this.botLast = agora;

    const personagens = this.characterViews();
    const bichos = this.botPrey();
    // Cada bot precisa saber de que lado ELE está para reconhecer o companheiro
    // do outro lado do campo. Ver `Bot.escolherAlvo`.
    for (const b of this.bots.list) b.time = this.temTimes() ? this.timeDe(b.id) : null;
    const tiros = this.bots.update(
      dt,
      personagens,
      bichos,
      /* No rouba bandeira os bots também são um time só: sem isto eles se
         acertam entre si e o lado da CPU se elimina sozinho antes de chegar
         perto da bandeira. É a mesma regra do duelo de times. */
      this.mode === "teamDuel" || this.mode === "captureFlag",
      isMeteorMode(this.mode)
        ? {
            soPresas: true,
            antiaereo: true,
            maxElevation: CONFIG.modes.meteorRain.botMaxElevation,
          }
        : isSiegeMode(this.mode)
          ? /* `soPresas` junto com `postado`, e é obrigatório.
             *
             * Sem ele o arqueiro de muralha escolhe o alvo MAIS PRÓXIMO — que
             * no adarve é o companheiro humano a nove metros, não o soldado a
             * sessenta. Medido: com o perfil só `postado`, o bot passava a
             * partida inteira mirando no defensor ao lado e não deu um tiro na
             * horda. Ele não é adversário aqui; é guarnição. */
            { postado: true, soPresas: true }
          : null,
      this.mode === "captureFlag" ? (b) => this.objetivoDoBot(b) : null,
    );

    /* O ESPECIAL DA CPU. Antes das poses, para a fração da pose que começa
       neste tique já entrar no `packState` de baixo. */
    for (const b of this.bots.list) this.talvezSoltarKame(b, personagens, bichos);

    // A pose de cada bot entra no mesmo formato dos humanos.
    for (const b of this.bots.list) {
      b.state = packState(b);
      b.stateTime = this.now();
    }

    /* A LISTA DE PRESAS É REAPROVEITADA, e no modo de chuva isso deixou de ser
       detalhe: `botPrey` monta um objeto por bicho, por zumbi, por rocha e por
       sitiante vivo, e `dispararDoBot` a remontava inteira PARA CADA TIRO. Com
       seis bots e trinta rochas no céu era a mesma lista construída sete vezes
       por tique, dez vezes por segundo — lixo puro, e justo no modo em que o
       orçamento importa. A fotografia do começo do tique é a mesma que o bot
       usou para escolher o alvo; usar outra seria até menos correto. */
    for (const { bot, tiro } of tiros) {
      if (tiro.kame) this.soltarKameDoBot(bot, tiro);
      else this.dispararDoBot(bot, tiro, bichos);
    }
  }

  /**
   * A CPU decidiu que é hora do especial.
   *
   * A regra é curta de propósito: barra cheia, vivo, e algo que valha o golpe
   * dentro do alcance. Não há economia de recurso nem leitura de momento — um
   * bot que guarda o especial para a hora certa é um bot melhor que o jogador
   * médio numa arma que o jogador médio ainda está aprendendo a usar, e o papel
   * dele nos modos cooperativos é ser guarnição, não professor.
   *
   * O ALVO é o que ele já está mirando, e isso não é preguiça: `_ultimoAlvo` é
   * o resultado de `escolherAlvoDeTiro`, que já sabe o que importa em cada modo
   * — a rocha mais baixa na chuva, o sitiante mais perto do portão no cerco, o
   * adversário no duelo. Escolher de novo aqui seria escrever uma segunda IA
   * que discorda da primeira.
   */
  talvezSoltarKame(bot, personagens, bichos) {
    if (!specialEnabled(this.mode)) return;
    if (!bot.alive || bot.kameT != null) return;
    if ((this.kameCharge.get(bot.id) ?? 0) < this.kameMax()) return;

    const mira = this.alvoDoKameDoBot(bot, personagens, bichos);
    if (!mira) return;
    if (!bot.iniciarKame(mira)) return;

    /* A barra zera AGORA, no começo da pose, e não no quadro do disparo. É o
       mesmo instante em que ela zera para o humano (`SpecialSystem.fire` chama
       `setCharge(0)` junto com a pose) e evita o caso feio: um segundo abate
       chegando durante a concentração e o bot saindo da pose já carregado. */
    this.kameCharge.set(bot.id, 0);
    this.broadcastAll({ t: S2C.KAME_CHARGE, id: bot.id, charge: 0, max: this.kameMax() });
  }

  /** O ponto para onde o feixe da CPU vai. Ver `talvezSoltarKame`. */
  alvoDoKameDoBot(bot, personagens, bichos) {
    const alvo = bot._ultimoAlvo;
    const temAlvo = alvo && (alvo.x !== 0 || alvo.y !== 0 || alvo.z !== 0);
    if (temAlvo) return alvo;

    /* Sem alvo recente, o bicho vivo mais próximo. É a rede para o caso em que
       a barra encheu no fim de uma leva e a mira ainda não achou a seguinte —
       sem ela o bot ficaria carregado para sempre esperando o quadro certo. */
    let melhor = null;
    let melhorD = Infinity;
    for (const c of bichos ?? []) {
      const d = Math.hypot(c.x - bot.position.x, c.z - bot.position.z);
      if (d < melhorD) {
        melhorD = d;
        melhor = c;
      }
    }
    return melhor;
  }

  /**
   * O feixe da CPU saiu.
   *
   * Sai pelo MESMO `S2C.KAME` de um humano, e por isso cada cliente reconstrói
   * frente, cauda, afinamento e explosão sem uma linha nova — é o contrato do
   * arquivo `protocol.js`, e é o que faz o especial do bot custar sessenta
   * bytes em vez de um sistema.
   *
   * O que a sala tem de fazer no lugar do cliente é o ESTRAGO: quem atira é
   * dono da ponta do feixe (`SpecialSystem.varrerOChao` manda `C2S.KAME_BLAST`
   * de onde ela parou), e um bot não tem cliente para mandar isso. Aqui a sala
   * marcha a direção contra o próprio campo de altura — a mesma conta de
   * `KamehamehaBeam.acharFim` — e chama o mesmo `registerKameBlast`.
   */
  soltarKameDoBot(bot, tiro) {
    const o = tiro.o;
    const d = tiro.d;
    this.broadcastAll({
      t: S2C.KAME,
      owner: bot.id,
      ownerName: bot.name,
      o: [round(o.x), round(o.y), round(o.z)],
      d: [round(d.x), round(d.y), round(d.z)],
      w: this.now(),
    });
    this.log(`${bot.name} soltou o especial`);

    /* O ESTRAGO SE REPETE enquanto o feixe vive, e não uma vez no contato.
       É o mesmo desenho de `SpecialSystem.varrerOChao`: ele sustenta por três
       segundos, e uma passada só faria a sustentação não valer nada — uma rocha
       que cai DENTRO do feixe durante a sustentação tem de morrer ali. */
    const S = CONFIG.special;
    const fim = this.pontaDoFeixe(o, d);
    const geracao = this.kameGen;
    const ondas = Math.max(1, Math.floor(S.sustain / S.groundBlast.interval));
    /* A frente leva `distância / velocidade` para chegar lá. São décimos a 300
       m/s, e mesmo assim eles importam: matar antes de a esfera abrir na tela
       de quem assiste é a horda caindo sem causa visível. */
    const alcance = fim ? Math.hypot(fim.x - o.x, fim.y - o.y, fim.z - o.z) : S.beam.range;
    const viagem = alcance / S.beam.speed;
    for (let i = 0; i < ondas; i++) {
      const atraso = viagem + i * S.groundBlast.interval;
      setTimeout(() => {
        if (geracao !== this.kameGen) return;
        if (!this.bots.byId(bot.id)) return;
        this.varrerFeixeDoBot(bot, o, d, alcance, fim);
      }, atraso * 1000).unref?.();
    }
  }

  /**
   * O que o feixe da CPU acerta — o lado que, num humano, o cliente resolve.
   *
   * Quem atira é a autoridade sobre o próprio acerto em todo o resto do jogo, e
   * o especial não é exceção: `SpecialSystem.testarAcertos` roda na tela de quem
   * atirou e manda `METEOR_HIT`/`KILL`/`KAME_BLAST`. O bot não tem tela, então
   * a sala faz o papel dela — pelos MESMOS métodos, para que um feixe de CPU e
   * um feixe de gente não possam divergir em regra nenhuma.
   */
  varrerFeixeDoBot(bot, o, d, alcance, fim) {
    const B = CONFIG.special.beam;

    // A esfera do fim, apoiada no chão: horda de zumbi e cerco morrem em área.
    if (fim) this.registerKameBlast(bot, { p: [fim.x, fim.y, fim.z] });

    // As rochas atravessadas pelo feixe. `registerMeteorHit` com `kame` é o
    // mesmo caminho do humano, e é lá que mora a exceção do colosso.
    if (isMeteorMode(this.mode) && !this.meteors.over) {
      for (const m of this.meteors.meteors ?? []) {
        if (m.dead) continue;
        if (this.distanciaAoFeixe(o, d, alcance, m) > B.killRadius + (m.raio ?? 1)) continue;
        this.registerMeteorHit(bot, { id: m.id, d: 0, kame: true });
      }
    }

    if (!CONFIG.special.friendlyFire) return;

    // E quem atravessa o feixe morre, exatamente como no de um humano.
    for (const alvo of this.allCharacters()) {
      if (alvo.id === bot.id || !alvo.alive) continue;
      if (this.now() < (alvo.invulnUntil ?? 0)) continue;
      if (this.temTimes() && this.timeDe(alvo.id) === this.timeDe(bot.id)) continue;
      const p = this.corpoDe(alvo);
      if (!p) continue;
      // Do pé ao peito: o corpo tem 1,72 m e o feixe pode passar na altura da
      // cabeça sem tocar o chão sob ela. Mesma conta de `testarAcertos`.
      const alvoY = p.y + Math.min(1.4, Math.max(0, o.y - p.y));
      if (this.distanciaAoFeixe(o, d, alcance, { x: p.x, y: alvoY, z: p.z }) > B.killRadius) {
        continue;
      }
      this.matarPeloFeixe(bot, alvo, { x: p.x, y: alvoY, z: p.z }, d);
    }
  }

  /** Distância de um ponto ao segmento do feixe. Ver `distanciaAoFeixe` no cliente. */
  distanciaAoFeixe(o, d, alcance, ponto) {
    const vx = ponto.x - o.x;
    const vy = (ponto.y ?? o.y) - o.y;
    const vz = ponto.z - o.z;
    let t = vx * d.x + vy * d.y + vz * d.z;
    t = t < 0 ? 0 : t > alcance ? alcance : t;
    return Math.hypot(vx - d.x * t, vy - d.y * t, vz - d.z * t);
  }

  /** O feixe da CPU derrubou alguém. Mesmo caminho de `matarPeloBot`. */
  matarPeloFeixe(bot, vitima, ponto, d) {
    vitima.alive = false;
    vitima.score.deaths++;
    bot.score.kills++;
    this.pontuarTime(vitima, bot);
    this.broadcastAll({
      t: S2C.KILL,
      victim: vitima.id,
      victimName: vitima.name,
      killer: bot.id,
      killerName: bot.name,
      killerColor: bot.color,
      victimColor: vitima.color,
      distance: null,
      c: [round(ponto.x), round(ponto.y), round(ponto.z)],
      v: [round(d.x * 40), round(d.y * 40 + 6), round(d.z * 40)],
      cause: "kame",
    });
    this.broadcastScores();
    this.aoMorrer(vitima);
  }

  /**
   * Onde o feixe encosta no chão, ou `null` se ele foi para o céu.
   *
   * É a mesma marcha de `KamehamehaBeam.acharFim`, com o mesmo passo grosso de
   * 4 m e o mesmo refinamento de meio metro — e tem de ser a mesma, porque o
   * cliente desenha a explosão onde ELE calculou e a sala mata onde ELA
   * calculou. Duas contas diferentes seriam a bola de fogo num lugar e os
   * mortos noutro.
   */
  pontaDoFeixe(origem, dir) {
    const B = CONFIG.special.beam;
    const alt = (x, z) => this.terrain?.heightAt?.(x, z) ?? 0;
    const ponto = (t) => ({
      x: origem.x + dir.x * t,
      y: origem.y + dir.y * t,
      z: origem.z + dir.z * t,
    });
    let ultimo = 0;
    for (let t = 4; t <= B.range; t += 4) {
      const p = ponto(t);
      if (p.y <= alt(p.x, p.z)) {
        for (let f = ultimo; f <= t; f += 0.5) {
          const q = ponto(f);
          if (q.y <= alt(q.x, q.z)) return q;
        }
        return p;
      }
      ultimo = t;
    }
    return null;
  }

  /**
   * Os personagens no formato que a IA e a flecha entendem.
   *
   * O humano guarda a pose como array (`state.p`), o bot como objeto — esta é a
   * única costura entre os dois, e ela mora aqui em vez de espalhada pelos dois
   * consumidores.
   */
  characterViews() {
    const lista = [];
    for (const p of this.players.values()) {
      if (!p.state) continue;
      lista.push({
        id: p.id,
        alive: p.alive,
        invulnUntil: p.invulnUntil,
        isBot: false,
        ref: p,
        /* DE QUE LADO ELE ESTÁ. Fora do rouba bandeira isto é sempre "humans"
           ou "bots" por `isBot`, e nada muda; lá dentro os times são mistos, e
           é este campo que impede o bot de atirar no companheiro humano —
           `isBot` deixou de responder a pergunta. Ver `Bot.escolherAlvo`. */
        time: this.temTimes() ? this.timeDe(p.id) : null,
        position: { x: p.state.p[0], y: p.state.p[1], z: p.state.p[2] },
      });
    }
    for (const b of this.bots.list) {
      lista.push({
        id: b.id,
        alive: b.alive,
        invulnUntil: b.invulnUntil,
        isBot: true,
        ref: b,
        time: this.temTimes() ? this.timeDe(b.id) : null,
        position: b.position,
      });
    }
    return lista;
  }

  /**
   * O bot soltou a corda.
   *
   * Dois anúncios, e é o mesmo par que um jogador humano produz: `S2C.SHOT` põe
   * a flecha voando em todas as telas (cada cliente a desenha como `visualOnly`,
   * sem resolver nada), e `S2C.IMPACT` diz onde ela parou. Como o atirador é a
   * sala, a simulação que decide o impacto roda aqui — ver `botArrow.js`.
   */
  dispararDoBot(bot, tiro, bichos = null) {
    const id = this.nextBotArrowId = (this.nextBotArrowId ?? 0) + 1;
    const o = [round(tiro.origem.x), round(tiro.origem.y), round(tiro.origem.z)];
    const d = [round(tiro.direcao.x), round(tiro.direcao.y), round(tiro.direcao.z)];

    this.broadcastAll({
      t: S2C.SHOT,
      owner: bot.id,
      ownerEntity: playerEntity(bot.id),
      id,
      o,
      d,
      v: round(tiro.velocidade),
      w: this.now(),
    });

    // O alce do modo pode ver a flecha a caminho e tentar desviar — vale para a
    // do bot igual à de qualquer um.
    if (this.mode === "elkHunt" && !this.elks.over) {
      this.elks.noticeShot({ o, d, v: tiro.velocidade }, this.now());
    }

    const r = simularFlechaDoBot(tiro, {
      terrain: this.terrain,
      levelId: this.level,
      /* A CAMADA QUE GARANTE.
       *
       * Na chuva a flecha do bot não é sequer TESTADA contra gente: ela
       * atravessa qualquer arqueiro. A camada de mira (`soPresas`) é intenção;
       * esta é impossibilidade — e ela é a que importa, porque um tiro mirado
       * numa rocha a 200 m de altura cruza muito espaço, e na Lua tem gente
       * voando de jetpack dentro desse espaço. Com a lista vazia, `r.kind`
       * nunca pode ser "character" e o ramo do `matarPeloBot` deixa de existir. */
      /* A CAMADA QUE GARANTE, e ela vale para os dois modos em que o bot é
         aliado: na chuva e no cerco a flecha dele não é sequer TESTADA contra
         gente. `soPresas` é intenção; isto é impossibilidade — e num modo em
         que três arqueiros dividem 34 m de muro atirando na mesma direção, a
         intenção sozinha não bastaria. */
      personagens:
        isMeteorMode(this.mode) || isSiegeMode(this.mode) ? [] : this.characterViews(),
      donoId: bot.id,
      bichos: bichos ?? this.botPrey(),
      agora: this.now(),
      // Tronco e rocha param a flecha do bot, como param a de qualquer um.
      blockers: obstaculosDe(this.terrain, this.level),
    });

    if (r.kind === "sumiu") return; // saiu do mundo: nada a encaixar

    /* ------------------------------------------------------------------------
     * TUDO O QUE ACONTECE NO FIM DO VOO ESPERA O FIM DO VOO.
     *
     * `simularFlechaDoBot` resolve a trajetória inteira no instante do disparo.
     * Isso é ótimo — a sala sabe o desfecho sem simular nada por quadro — e era
     * anunciado errado: o `S2C.IMPACT` saía no MESMO tique do `S2C.SHOT`.
     *
     * O que o cliente faz com esse par é o problema. Ele recebe o disparo, cria
     * a cópia visual da flecha na boca do arco, e um instante depois recebe o
     * impacto e a TELEPORTA para o ponto final (`RemoteArrows.onImpact` →
     * `snapTo`). O traçado, que é desenhado ligando as posições sucessivas da
     * flecha, ganha um único segmento de duzentos metros: era exatamente o
     * "aparece de uma vez com um grande comprimento" que se via na chuva. E
     * "às vezes funciona" tinha explicação — num tiro curto o teleporte é de
     * poucos metros e ninguém nota.
     *
     * Com o anúncio adiado por `r.tempo`, a cópia voa o caminho inteiro com a
     * mesma balística de todo mundo (é para isso que ela existe) e o encaixe no
     * fim volta a ser de centímetros, como o de um jogador humano — cujo
     * impacto sempre chegou depois do voo, porque quem o calcula é o cliente
     * dono, em tempo real.
     *
     * O abate vai junto, e não podia não ir: separar as duas coisas mataria o
     * alvo antes de a flecha chegar nele. Os dois `setTimeout` que já existiam
     * aqui (sitiante e rocha) eram meia correção do mesmo problema — agora há
     * um caminho só.
     * --------------------------------------------------------------------- */
    const modoNoDisparo = this.mode;
    const faseNoDisparo = this.level;

    /* A vida que esta flecha já vai consumir é RESERVADA AGORA, no disparo, e
       não na chegada: entre um e outro passam quase dois segundos, e nesses dois
       segundos os outros bots escolhem alvo várias vezes. Sem a reserva eles
       veem a pedra com a vida cheia e mandam flecha nela também. */
    if (r.kind === "meteor") this.reservarRocha(r.alvo.id, 1);

    const chegar = () => {
      if (r.kind === "meteor") this.reservarRocha(r.alvo.id, -1);
      /* A partida pode ter mudado de modo ou de fase durante o voo. Anunciar um
         impacto num mundo que já não existe põe uma flecha cravada no meio do
         cenário novo. */
      if (this.mode !== modoNoDisparo || this.level !== faseNoDisparo) return;

      this.broadcastAll({
        t: S2C.IMPACT,
        owner: bot.id,
        ownerEntity: playerEntity(bot.id),
        id,
        k: r.kind === "character" ? "character" : r.kind === "terrain" ? "terrain" : r.kind,
        ti: r.alvo ? (r.kind === "character" ? playerEntity(r.alvo.id) : r.alvo.id) : "chão",
        p: [round(r.ponto.x), round(r.ponto.y), round(r.ponto.z)],
        q: orientacaoDe(r.velocidade).map(round),
        c: [round(r.ponto.x), round(r.ponto.y), round(r.ponto.z)],
        v: [round(r.velocidade.x), round(r.velocidade.y), round(r.velocidade.z)],
      });

      if (r.kind === "character") this.matarPeloBot(bot, r);
      else if (r.kind === "boar") this.abaterBichoPeloBot(bot, "boar", r.alvo.id);
      else if (r.kind === "elk") this.abaterBichoPeloBot(bot, "elk", r.alvo.id);
      else if (r.kind === "zombie") this.abaterBichoPeloBot(bot, "zombie", r.alvo.id);
      else if (r.kind === "besieger") {
        if (this.siege.over) return;
        this.abaterBichoPeloBot(bot, "besieger", r.alvo.id);
      } else if (r.kind === "bat") {
        if (this.siege.over) return;
        this.abaterMorcegoPeloBot(bot, r.alvo.id);
      } else if (r.kind === "meteor") {
        // Reconfere na chegada: um humano pode ter estourado a rocha no meio do
        // caminho, e o bot pode ter sido dispensado.
        if (this.meteors.over || !this.bots.byId(bot.id)) return;
        this.abaterRochaPeloBot(bot, r.alvo.id);
      }
    };

    /* Abaixo de um quadro não vale a pena passar pelo relógio: o `setTimeout`
       tem resolução pior que isso e só acrescentaria jitter ao tiro à queima-
       roupa, que é o único caso em que ele cai aqui. */
    const espera = Math.max(0, r.tempo * 1000);
    if (espera < 16) chegar();
    else setTimeout(chegar, espera).unref?.();
  }

  /**
   * O bot derrubou um morcego.
   *
   * Sai pelo MESMO `S2C.BAT_DEATH` de um abate humano — é isso que faz o
   * estouro, o som, o aviso e a alma acontecerem sem uma linha nova de cliente.
   * Não pontua, pela mesma regra de `abaterBichoPeloBot`: o bot não disputa
   * placar.
   */
  abaterMorcegoPeloBot(bot, id) {
    const morcego = this.morcegos.hit(id);
    if (!morcego) return;
    this.addKameCharge(bot, "bat", 1, morcego);
    this.broadcastAll({
      t: S2C.BAT_DEATH,
      id: morcego.id,
      killer: bot.id,
      killerName: bot.name,
      killerColor: bot.color,
      points: 0,
      p: [round(morcego.x), round(morcego.y), round(morcego.z)],
    });
  }

  /**
   * Flechas de bot a caminho de uma rocha.
   *
   * O mapa é limpo pelo próprio decremento e pelo fim do modo — uma entrada
   * órfã só existiria se o `setTimeout` não disparasse, e ele dispara mesmo com
   * a partida encerrada (o `return` de dentro é depois do decremento, de
   * propósito).
   */
  reservarRocha(id, delta) {
    if (!this.rochasReservadas) this.rochasReservadas = new Map();
    const n = (this.rochasReservadas.get(id) ?? 0) + delta;
    if (n > 0) this.rochasReservadas.set(id, n);
    else this.rochasReservadas.delete(id);
  }

  /**
   * O bot acertou uma rocha.
   *
   * NÃO pontua, pela mesma regra de `abaterBichoPeloBot`: o bot não disputa
   * placar, e creditar a rocha a um humano ao acaso seria mentir no ranking. O
   * que importa é que ela morre para TODO MUNDO — e que a horda anda.
   */
  abaterRochaPeloBot(bot, id) {
    const r = this.meteors.hit(id);
    if (!r) return;
    /* A BARRA DO BOT ENCHE, mesmo que o placar dele não conte.
       As duas coisas parecem a mesma e não são: o placar é um ranking entre
       pessoas, e por isso o bot fica de fora dele; o especial é uma ARMA, e uma
       guarnição de CPU que abate a partida inteira sem nunca soltar o golpe é
       uma guarnição jogando um jogo diferente do seu. Ver `Bot.querSoltarKame`. */
    this.addKameCharge(bot, "meteor", r.gasto ?? 1, r.meteor);
    this.broadcastAll({
      t: S2C.METEOR_HIT,
      id,
      by: bot.id,
      left: r.left,
      p: [round(r.meteor.x), round(r.meteor.y), round(r.meteor.z)],
    });
    if (r.morreu) this.burstMeteor(r.meteor, bot);
    this.broadcastMeteorStatus();
  }

  /**
   * A flecha do bot acertou gente (ou outro bot).
   *
   * Sem `C2S.KILL` no meio: quem atirou É a sala, então ela declara direto. O
   * resto do caminho — placar, aviso, respawn — é o mesmo de `registerKill`.
   */
  matarPeloBot(bot, r) {
    const vitima = r.alvo.ref;
    if (!vitima || !vitima.alive) return;

    vitima.alive = false;
    vitima.score.deaths++;
    bot.score.kills++;
    this.pontuarTime(vitima, bot);
    this.addKameCharge(bot, "player", 1, this.corpoDe(vitima));

    this.broadcastAll({
      t: S2C.KILL,
      victim: vitima.id,
      victimName: vitima.name,
      killer: bot.id,
      killerName: bot.name,
      killerColor: bot.color,
      victimColor: vitima.color,
      distance: null,
      c: [round(r.ponto.x), round(r.ponto.y), round(r.ponto.z)],
      v: [round(r.velocidade.x), round(r.velocidade.y), round(r.velocidade.z)],
      cause: "arrow",
    });
    this.broadcastScores();

    this.aoMorrer(vitima);
  }

  /**
   * O bot abateu um bicho.
   *
   * NÃO pontua: o bot não disputa placar de caçada, e creditar os pontos a
   * alguém seria escolher um humano ao acaso. O que importa é que o bicho morre
   * para TODO MUNDO — o servidor é dono dele e do bot, então não há duas
   * versões do mundo para conciliar.
   */
  abaterBichoPeloBot(bot, tipo, id) {
    const agora = this.now();
    if (tipo === "boar") {
      const porco = this.hunt.kill(id, agora);
      if (!porco) return;
      this.addKameCharge(bot, "boar", 1, porco);
      this.broadcastAll({
        t: S2C.BOAR_DEATH,
        id,
        killer: bot.id,
        killerName: bot.name,
        killerColor: bot.color,
        points: 0,
        distance: null,
      });
    } else if (tipo === "elk") {
      this.elks.hit?.(id);
    } else if (tipo === "zombie") {
      const bicho = this.zombies.zombies.find((z) => z.id === id);
      if (bicho && !bicho.dead) {
        bicho.hit?.(false);
        if (bicho.dead) {
          this.addKameCharge(bot, "zombie", 1, bicho);
          this.broadcastAll({ t: S2C.ZOMBIE_DEATH, id, killer: bot.id, points: 0, head: false });
        }
      }
    } else if (tipo === "besieger") {
      const r = this.siege.hit(id, { head: false });
      if (!r?.killed) return;
      this.siege.matar(r.b, bot.id, agora);
      this.addKameCharge(bot, "besieger", 1, { x: r.b.x, y: r.b.chestY, z: r.b.z });
      this.broadcastAll({
        t: S2C.SIEGE_DEATH,
        id,
        kind: r.b.kind,
        killer: bot.id,
        killerName: bot.name,
        killerColor: bot.color,
        points: 0,
      });
    }
  }

  /**
   * A perícia padrão DO MODO que está entrando.
   *
   * Roda dentro de `setMode`, antes de qualquer bot ser criado — é isso que faz
   * a guarnição do cerco e a antiaérea da chuva nascerem já no nível certo, em
   * vez de herdarem o `easy` que o duelo deixou. Como `BotSquad.setDifficulty`
   * escreve em `CONFIG.bot.difficulty`, o bot criado dez segundos depois pela
   * tecla B também nasce nele.
   *
   * Nada acontece nos modos sem preferência: lá o que valer na sala continua
   * valendo, inclusive o que alguém escolheu com a tecla N.
   */
  aplicarDificuldadeDoModo(modo) {
    const nivel = CONFIG.bot?.modeDifficulty?.[modo];
    if (!nivel || CONFIG.bot.difficulty === nivel) return;
    const aplicado = this.bots.setDifficulty(nivel);
    this.broadcastAll({ t: S2C.BOT_DIFFICULTY, level: aplicado });
  }

  /** Põe um adversário de CPU em campo, visível para a sala inteira. */
  addBot() {
    const ocupados = this.allCharacters()
      .filter((c) => c.state)
      .map((c) => ({ x: c.state.p[0], z: c.state.p[2] }));
    const bot = this.bots.add(nextPlayerId++, ocupados);
    if (!bot) return null;

    bot.state = packState(bot);
    bot.stateTime = this.now();
    bot.invulnUntil = this.now() + CONFIG.spawn.invulnerability * 1000;

    /* Entra pelo MESMO canal de um humano. É isso que faz o cliente desenhá-lo
       sem uma linha de código nova: `S2C.JOIN` já cria um `RemotePlayer`, com
       cápsula de física e etiqueta de nome. */
    this.broadcastAll({
      t: S2C.JOIN,
      player: { id: bot.id, name: bot.name, color: bot.color, isBot: true },
    });

    /* NO CERCO ELE NASCE NO MURO, e não no anel de duelo.
     *
     * `BotSquad.add` põe todo bot novo no anel de duelo da fase, que no castelo
     * cai no pátio — e de lá o arqueiro de guarnição teria de subir a escada,
     * que é justamente a coisa que ele não sabe fazer (ele é `postado`, ver o
     * perfil em `tickBots`). O que se via era o bot da tecla B parado lá
     * embaixo pela partida inteira, sem linha de tiro para nada.
     *
     * DEPOIS do `JOIN`, e é obrigatório: `postoLivreNoAdarve` transmite um
     * `S2C.SPAWN`, e um spawn para um id que os clientes ainda não conhecem não
     * tem em quem ser aplicado. */
    if (isSiegeMode(this.mode) && !this.siege.over) this.postoLivreNoAdarve(bot);
    /* Bot também é gente para o equilíbrio dos times: ele entra no lado com
       menos participantes, exatamente como um humano. Ver `escalarNoTime`. */
    if (this.mode === "captureFlag" && this.flag.ativo) {
      this.escalarNoTime(bot.id);
      this.spawnNaBase(bot);
      this.broadcastTeamScores();
    }
    /* NA CHUVA ELE NASCE NO ANEL ANTIAÉREO, pelo mesmo motivo do cerco.
       `BotSquad.add` o põe no anel de duelo, que na Lua é o miolo da base — ou
       seja, embaixo da zona de queda, onde metade das rochas passa acima do
       teto de elevação dele e ele fica de arco na mão olhando o teto. */
    if (isMeteorMode(this.mode) && !this.meteors.over) this.postoAntiaereo(bot);

    this.broadcastScores();
    this.log(`bot entrou: ${bot.name} (#${bot.id})`);
    return bot;
  }

  removeBot() {
    const bot = this.bots.removeLast();
    if (!bot) return false;
    this.broadcastAll({ t: S2C.LEAVE, id: bot.id, name: bot.name });
    this.broadcastScores();
    this.saiuDaRodada(bot);
    return true;
  }

  clearBots() {
    for (const bot of this.bots.clear()) {
      this.broadcastAll({ t: S2C.LEAVE, id: bot.id, name: bot.name });
      this.saiuDaRodada(bot);
    }
  }

  /**
   * Alguém deixou a sala — de socket caído ou de esquadra desfeita.
   *
   * Sair do jogo não pode ser diferente de morrer, para os dois modos de arena:
   * quem carregava a bandeira e fecha a aba levaria a bandeira consigo, e quem
   * era um dos dois últimos em pé e desconecta deixaria a rodada esperando para
   * sempre por um arqueiro que não vai atirar mais.
   */
  saiuDaRodada(quem) {
    if (this.mode === "captureFlag") this.derrubarBandeira(quem);
    if (this.mode === "lastStand" && this.standAlive.delete(quem.id)) {
      this.broadcastStandStatus();
      this.checarUltimoEmPe();
    }
  }

  /**
   * O chão da fase em curso.
   *
   * Acessor, e não propriedade, pelo mesmo motivo do cliente: guardado numa
   * variável, ele ficaria apontando para o vale depois de a sala ir para a Lua,
   * e os jogadores nasceriam em alturas de um terreno que ninguém está vendo.
   *
   * As simulações de bicho (`BoarHunt`, `ElkHunt`, `BirdFlock`, `ZombieNight`,
   * `TargetSeries`) recebem o campo do VALE no construtor e continuam com ele —
   * o que é correto, porque nenhuma delas roda fora do vale (ver `modos` de
   * cada fase em `shared/levels.js`).
   */
  get terrain() {
    return this.fields[this.level] ?? this.fields[DEFAULT_LEVEL];
  }

  /* ---------------------------------------------------------------- modos -- */

  /**
   * Trata o pedido de modo de um jogador.
   *
   * A caçada é cooperativa: quem apertar liga para a sala inteira, porque não
   * existe motivo para alguém não querer porcos aparecendo.
   *
   * Toda tecla de modo é também uma tecla de REINÍCIO: apertá-la reinicia
   * aquele modo do zero, MESMO que ele já seja o modo em curso. Antes, apertar
   * de novo a tecla do modo ativo o desligava (voltava para "livre") — mas
   * quem está no meio de uma caçada e aperta `3` de novo quer é começar outra
   * caçada, não sair dela. Sair continua existindo: é a tecla `1`.
   *
   * O duelo é diferente — arrasta gente para uma briga. Então é CONVITE:
   * apertar marca você como pronto, a sala é avisada, e a partida só começa
   * quando dois ou mais aceitam. Quem não aceitou continua treinando em paz.
   * Já em duelo, apertar `2` de novo reinicia a partida do zero com quem já
   * está dentro — não é um convite novo.
   */
  /**
   * Pedido de FASE (tecla 9). Leva a sala inteira, sem convite.
   *
   * O modo vai junto na decisão: nem toda fase aceita o modo em curso. Quem
   * está numa caçada aos porcos e pede a Lua não pode continuar caçando porcos
   * lá — `fallbackMode` escolhe o primeiro modo que a fase aceita, que é o
   * livre. É o mesmo raciocínio de `requestMode`, na direção contrária.
   */
  requestLevel(player, fase) {
    if (!LEVEL_IDS.includes(fase) || fase === this.level) return;
    const modo = fallbackMode(fase, this.mode);
    this.prepareMode(modo, fase);
  }

  requestMode(player, modo) {
    /* O modo pode não existir na fase em curso — e aí a troca de modo arrasta
       junto a troca de FASE, em vez de a tecla parecer quebrada. É o que faz a
       caçada aos porcos funcionar mesmo estando na Lua: a sala volta ao vale e
       começa a caçada. */
    const fase = levelForMode(modo, this.level);

    /* A noite dos zumbis entra na mesma lista dos modos cooperativos: quem
       aperta liga para a sala inteira. Não é convite como o duelo porque
       ninguém é arrastado para brigar com ninguém — a horda é problema de
       todos, e defender o quadrado sozinho não é o que o modo propõe. */
    if (
      modo === "boarHunt" ||
      modo === "birdHunt" ||
      modo === "series" ||
      modo === "elkHunt" ||
      modo === "zombie" ||
      modo === "zombieBoss" ||
      // A chuva pelo mesmo raciocínio: as rochas caem na base de todo mundo, e
      // não existe "defender sozinho o céu enquanto os outros treinam tiro".
      modo === "meteorRain" ||
      // O duelo de times entra como os cooperativos: quem aperta liga para a
      // sala inteira. Não é convite porque não arrasta ninguém para brigar com
      // ninguém — o adversário é a máquina.
      modo === "teamDuel" ||
      /* Os dois modos de arena também ligam para a sala inteira, e por um
         motivo que o duelo não tem: eles são RODADAS. Um convite pendente
         enquanto metade da sala já está numa rodada de vida única não descreve
         nada — ou todo mundo entra na mesma partida, ou não é a mesma partida. */
      modo === "lastStand" ||
      modo === "captureFlag" ||
      /* O cerco pelo mesmo raciocínio dos cooperativos, com uma razão a mais:
         o portão é UM. Não existe "defender o portão sozinho enquanto os
         outros treinam tiro no pátio" — a fila que derruba a muralha derruba
         para todo mundo ao mesmo tempo. */
      modo === "siege"
    ) {
      if (this.needsPreparation(modo, fase)) {
        this.prepareMode(modo, fase);
      } else {
        this.cancelModePreparation();
        this.setMode(modo);
      }
      return;
    }

    if (modo === "free") {
      this.cancelModePreparation();
      // Sair do duelo: some da lista, e se sobrar menos de dois a partida acaba.
      this.duelInvites.delete(player.id);
      player.duelReady = false;
      this.setMode("free");
      return;
    }

    if (modo !== "duel") return;

    this.cancelModePreparation();

    /* Fase sem convite (a Lua): a tecla começa o duelo na hora, com todos.
       Precisa vir ANTES da checagem de "já estou duelando", senão apertar de
       novo lá reiniciaria em vez de simplesmente não fazer nada — que é o
       mesmo comportamento do vale e está certo nos dois. */
    if (!levelUsesDuelInvites(this.level)) {
      this.setMode("duel");
      return;
    }

    if (this.mode === "duel") {
      // Já duelando: reinicia a partida com quem já está dentro.
      this.setMode("duel");
      return;
    }

    if (this.duelInvites.has(player.id)) {
      // Convite pendente, ainda sem duelo: apertar de novo cancela o próprio.
      this.duelInvites.delete(player.id);
      player.duelReady = false;
      this.broadcastMode();
      return;
    }

    this.duelInvites.add(player.id);
    player.duelReady = true;
    this.inviteExpires = this.now() + CONFIG.modes.duel.inviteTimeout * 1000;

    if (this.duelInvites.size >= CONFIG.modes.duel.minPlayers) {
      this.setMode("duel");
    } else {
      this.broadcastMode();
    }
  }

  /**
   * Troca de modo — e o mundo RECOMEÇA.
   *
   * Antes cada modo só desligava o que era dele: sair da caçada parava as ondas
   * mas deixava os porcos soltos na mão andando pelo campo, e o placar seguia
   * acumulando pontos de três modos diferentes na mesma coluna. O resultado era
   * que ninguém sabia mais o que estava vendo — porcos de uma partida que
   * acabou passeando no meio dos alvos em série, e um placar que misturava
   * abates de meia hora atrás com o tiro de agora.
   *
   * Ligar um modo agora é começar do zero: campo limpo, placar zerado. É o que
   * transforma "trocar de modo" em "começar uma partida" — e roda mesmo que o
   * modo pedido já seja o atual: é assim que a tecla do modo também reinicia.
   *
   * A tela de carregamento entra quando `needsPreparation` diz que sim.
   */

  /**
   * Uma troca precisa de tela de carregamento?
   *
   * Duas coisas exigem: a noite dos zumbis, que compila shaders e limpa a fauna
   * antes de entrar, e a TROCA DE FASE, que destrói o mundo e constrói outro.
   * Nos dois casos o custo é de centenas de milissegundos no cliente, e sem a
   * espera coordenada uns entrariam segundos antes dos outros — em modos onde
   * isso decide a partida.
   */
  needsPreparation(modo, fase) {
    /* A chuva entra na lista pelo mesmo motivo da noite: ela compila malhas de
       rocha, materiais de fogo e o halo aditivo antes da primeira queda. Num
       modo com prazo, entrar dois segundos depois dos outros decide a partida. */
    /* O cerco entra na lista pelos dois motivos ao mesmo tempo: ele compila
       oito silhuetas de sitiante, o fogo do piche e a pedra em chamas antes do
       primeiro tiro — e a partida tem prazo, então entrar dois segundos depois
       dos outros custa caro. */
    return isZombieMode(modo) || isMeteorMode(modo) || isSiegeMode(modo) || fase !== this.level;
  }

  prepareMode(modo, fase = this.level) {
    if (!this.needsPreparation(modo, fase) || !this.players.size) return;

    this.cancelModePreparation();
    const token = this.nextModeToken++;
    this.pendingMode = {
      mode: modo,
      level: fase,
      token,
      ready: new Set(),
      timer: setTimeout(() => {
        if (this.pendingMode?.token !== token) return;
        // Um navegador lento não deve deixar a sala travada para sempre. Os
        // clientes que já terminaram entram sincronizados; os demais recebem
        // o commit e concluem a preparação localmente enquanto o overlay some.
        this.log(`preparo expirou (${modo} / ${fase})`);
        this.commitPreparedMode(token);
      }, (CONFIG.net.modePrepareTimeout ?? 12) * 1000),
    };

    this.broadcastAll({
      t: S2C.MODE_PREPARE,
      mode: modo,
      level: fase,
      token,
      ready: 0,
      total: this.players.size,
    });
    this.log(`preparando: ${modo} em ${fase}`);
  }

  commitPreparedMode(token) {
    const pending = this.pendingMode;
    if (!pending || pending.token !== token) return;
    clearTimeout(pending.timer);
    this.pendingMode = null;
    /* A FASE muda ANTES do modo. `setMode` sorteia nascimentos, e o sorteio
       pergunta a altura do chão — se o modo entrasse primeiro, todo mundo
       nasceria em cotas do cenário anterior e cairia dentro do novo. */
    const trocouFase = (pending.level ?? this.level) !== this.level;
    this.level = pending.level ?? this.level;
    if (trocouFase) {
      /* Os bots saem na troca de fase.
       *
       * Poderiam atravessar — `relevel` sabe religá-los — e ainda assim saem:
       * quem viaja para a Lua está mudando de assunto, e chegar lá com a mesma
       * escolta de CPU do vale não é o que ninguém pediu. Uma linha para mudar
       * de ideia, se um dia um modo quiser o contrário. */
      this.clearBots();
      this.bots.relevel(this.terrain, this.level);
      // O campo do espaço é da FASE: sai inteiro com ela e renasce do outro
      // lado (vazio, se o outro lado for o vale). A chuva idem.
      this.space.setTerrain(this.terrain);
      this.meteors.setTerrain(this.terrain);
    }
    this.setMode(pending.mode);

    /* Chegando numa fase SEM FAUNA, a lista vazia é ANUNCIADA.
     *
     * `setMode` acabou de esvaziar o bando (ver `resetWorld`), mas quem já está
     * na sala não tem como saber disso: na Lua o pacote de pássaros não é mais
     * emitido, e "não receber notícia" não apaga nada do outro lado. Uma
     * mensagem só, na troca, e o céu do vácuo fica vazio em todas as telas. */
    if (trocouFase && !levelHasFauna(this.level)) {
      this.broadcastAll({ t: S2C.BIRDS, time: this.now(), k: [] });
    }
  }

  cancelModePreparation() {
    const pending = this.pendingMode;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingMode = null;
    this.broadcastAll({ t: S2C.MODE_PREPARE_CANCEL });
  }

  setMode(modo) {
    const anterior = this.mode;
    this.mode = modo;

    this.resetWorld();
    this.aplicarDificuldadeDoModo(modo);

    /* DUELO DE TIMES: começa parelho, um bot por humano.
     *
     * Depois disso o número é livre — quem quiser aperta B e engrossa o time da
     * máquina no meio da partida. O equilíbrio inicial existe para a partida
     * COMEÇAR justa; mantê-lo à força tiraria a única alavanca de dificuldade
     * que o modo tem. Sair do modo desfaz a esquadra: um adversário sobrando
     * depois que a partida acabou é alguém que ninguém convidou. */
    if (modo === "teamDuel") {
      const humanos = Math.max(1, this.players.size);
      while (this.bots.count > humanos) this.removeBot();
      while (this.bots.count < humanos) {
        if (!this.addBot()) break;
      }
      this.broadcastTeamScores();
    } else if (anterior === "teamDuel" || anterior === "captureFlag") {
      /* Sair do modo desfaz a esquadra: um adversário sobrando depois que a
         partida acabou é alguém que ninguém convidou. Vale para os dois modos
         de time — a bandeira monta a mesma esquadra pela mesma razão. */
      this.clearBots();
    }

    /* Em todo modo, ao entrar: todo mundo renasce piscando e é reposicionado.
       O drop padrão faz uma queda legível; a noite passa `drop: 0` para que a
       horda comece no chão, sem o pico visual da queda durante a transição. */
    if (modo === "series") {
      this.series.start();
      this.lineUpForSeries();
      this.broadcastAll({ t: S2C.SERIES, target: this.series.view() });
    } else if (modo === "elkHunt") {
      // A ORDEM importa: os arqueiros primeiro, o alce depois. `pickElkSpawn`
      // escolhe o ponto mais longe de todo mundo, então ele só sabe onde é "o
      // lado oposto" depois que todos já foram postos na linha — e precisa
      // receber os pontos NOVOS, não os que os clientes reportaram até agora.
      for (const p of this.players.values()) p.elkDownUntil = 0;
      const postos = this.lineUpForElk();
      this.elks.start(postos);
      this.broadcastElkLineUp(postos);
      this.broadcastElkStatus();
    } else if (isZombieMode(modo)) {
      for (const p of this.players.values()) {
        p.zDownUntil = 0;
      }
      this.centerForZombie();
      const n = this.players.size;
      const horda =
        modo === "zombieBoss" ? this.zombies.startBossOnly(n) : this.zombies.start(n);
      this.broadcastAll({ t: S2C.TORCHES, t4: this.torches });
      if (horda) this.broadcastAll({ t: S2C.HORDE, ...horda });
      this.broadcastZombieStatus();
    } else if (isSiegeMode(modo)) {
      /* O CERCO ENTRA VAZIO — a guarnição é convite, não requisito.
       *
       * Ele nascia forçando dois bots, e a justificativa era medida: o banco de
       * provas dava 0 % de vitórias com um defensor e 80 % com três. O que
       * aquela medição descrevia, porém, não era o modo — era a CURVA, que
       * havia sido calibrada contra a sala de três que esta linha criava. Com
       * `gapBase` reancorada no defensor sozinho e a pressão passando a escalar
       * com quem está no muro (ver `playerGapExp`), o solitário mede ~82 % e os
       * bots deixam de ser a calibragem para voltar a ser o que a tecla B é em
       * todo outro modo: uma escolha de quem joga.
       *
       * Quem quiser a guarnição de antes aperta B duas vezes — e recebe
       * praticamente a partida de antes, porque é em N = 3 que a curva nova e a
       * velha se encontram (97 % contra os 100 % de então). E quem quiser o
       * aperto de volta agora tem onde pedir: o difícil (ver `difficulties`)
       * mede 25 % sozinho. */
      for (const p of this.players.values()) p.zDownUntil = 0;
      this.repairing.clear();
      for (const t of this.trebuchets) {
        t.pronto = 0;
        t.wind.clear();
      }
      this.lineUpForSiege();
      this.siege.setTerrain?.(this.terrain);
      this.siege.start(this.players.size + this.bots.count);
      this.morcegos.setTerrain(this.terrain);
      this.morcegos.start();
      this.broadcastSiegeStatus();
      this.broadcastTrebuchets();
    } else if (isMeteorMode(modo)) {
      this.lineUpForMeteorRain();
      this.meteors.setTerrain(this.terrain);
      this.meteors.start(this.players.size + this.bots.count);
      this.broadcastMeteorStatus();
    } else if (modo === "duel") {
      this.startDuel();
    } else if (modo === "lastStand") {
      /* Todo mundo que tem corpo em campo entra na rodada — humano e CPU. O
         conjunto é montado AQUI e não muda mais: quem chegar depois assiste, e
         é a coisa certa a fazer num modo de vida única. Entrar no meio seria
         chegar inteiro numa briga em que os outros já gastaram metade da vida.

         As posições são as do DUELO: bem separadas, num anel largo. Começar
         perto de alguém, quando a primeira flecha decide tudo, é sortear o
         vencedor antes do começo. */
      this.standAlive = new Set();
      this.standOver = false;
      /* SOZINHO NÃO EXISTE "o último em pé".
         Com um corpo só em campo a rodada nasce decidida e nunca acaba: não há
         ninguém para eliminar, então `checarUltimoEmPe` jamais é chamado e o
         jogador fica preso num modo que não termina. Um adversário de CPU é o
         mínimo para a regra fazer sentido — a mesma solução do duelo de times,
         pelo mesmo motivo. */
      if (this.players.size + this.bots.count < 2) this.addBot();
      this.lineUpForLastStand();
      for (const p of this.allCharacters()) this.standAlive.add(p.id);
      this.standTotal = this.standAlive.size;
      this.broadcastStandStatus();
    } else if (modo === "captureFlag") {
      /* Um bot por humano, como no duelo de times: sem adversário do outro
         lado, a bandeira é uma caminhada até a base vazia. */
      const humanos = Math.max(1, this.players.size);
      while (this.bots.count > humanos) this.removeBot();
      while (this.bots.count < humanos) {
        if (!this.addBot()) break;
      }
      this.flagOverAnunciado = false;
      /* AS EQUIPES SÃO FEITAS AQUI, e antes do `flag.start`: o nascimento na
         base já pergunta de que lado cada um é (`spawnNaBase` → `timeDe`), e
         sem a escalação todo mundo cairia no lado "humanos" pelo fallback. */
      this.refazerEquipes();
      this.flag.start(this.terrain);
      for (const p of this.allCharacters()) {
        p.score.captures = 0;
        this.spawnNaBase(p);
      }
      this.broadcastTeamScores();
      this.broadcastFlag();
    } else {
      // livre, caçada aos porcos e caça aos pássaros: renascimento no campo
      this.respawnEveryone();
      if (modo === "boarHunt") this.hunt.start(this.playerPositions());
      if (modo === "birdHunt") {
        this.birdHuntOver = false;
        this.pendingSpecialBirdWin = null;
        this.birds.reset({ hunt: true });
      }
      if (modo === "free") {
        this.duelInvites.clear();
        for (const p of this.players.values()) p.duelReady = false;
      }
    }

    /* Vento na flecha: no zumbi começa desligado; ao sair, volta ao padrão
       ligado. Entre outros modos, o que o jogador escolheu com V permanece. */
    if (isZombieMode(modo)) {
      this.setWindInfluence(false, { silent: true });
    } else if (isZombieMode(anterior)) {
      this.setWindInfluence(true, { silent: true });
    }

    this.broadcastMode();
    this.log(`modo: ${modo}`);
  }

  /**
   * Campo limpo e placar zerado.
   *
   * Varre TUDO, inclusive os bichos soltos na mão — que antes sobreviviam à
   * troca de modo de propósito. A regra mudou porque o pedido mudou: "ao
   * iniciar cada modo, tudo é resetado". Um alce avulso passeando no meio de
   * uma série de alvos é exatamente o tipo de sobra que a regra nova elimina.
   */
  resetWorld() {
    this.teamScores = { humans: 0, bots: 0 };
    this.hunt.stop();
    this.hunt.boars = [];
    this.elks.stop();
    this.elks.elks = [];
    this.elkWolves.clear();
    this.birdHuntOver = false;
    this.pendingSpecialBirdWin = null;
    /* Fase sem fauna nasce SEM BANDO. `tickCreatures` já não atualizava os
       pássaros na Lua, e isso não bastava: eles continuavam na lista e iam
       embora no `snapshot` de quem entrasse: sete aves batendo asa no vácuo,
       para sempre, porque nenhuma amostra nova vinha corrigi-las. */
    this.birds.reset({ vazio: !levelHasFauna(this.level) });
    this.zombies.stop();
    this.meteors.stop();
    // As flechas de bot a caminho de rochas que deixaram de existir.
    this.rochasReservadas?.clear();
    /* A BARRA ZERA EM TODA TROCA, e a tela é avisada.
       Era zerada só ao entrar na chuva, de quando a chuva era o único lugar em
       que o especial existia. Hoje ele existe em todos (ver `specialEnabled`), e
       herdar meia barra da partida anterior seria começar um cerco com um golpe
       comprado noutro modo. */
    this.kameCharge.clear();
    // Os pontos que ainda estavam voando morrem com a partida. Ver `kameGen`.
    this.kameGen++;
    for (const b of this.bots.list) b.cancelarKame?.();
    this.broadcastKameCharges();
    // As tochas voltam acesas: a partida seguinte não herda o escuro que a
    // anterior produziu.
    this.torches = [true, true, true, true];
    this.series.stop();
    /* Os dois modos de arena voltam à estaca zero. `setMode` os religa logo
       depois, quando é a vez deles — aqui só se garante que sair de um deles
       não deixa uma bandeira pendurada no mapa nem meia dúzia de eliminados
       que a próxima partida herdaria. */
    this.flag.stop();
    this.flagOverAnunciado = false;
    /* O cerco também. Sem isto, sair dele deixaria 120 sitiantes andando
       invisíveis no servidor e o portão do modo seguinte já rachado. */
    this.siege.stop();
    this.morcegos.stop();
    this.repairing.clear();
    for (const t of this.trebuchets) {
      t.pronto = 0;
      t.wind.clear();
    }
    this.standAlive = new Set();
    this.standOver = false;
    this.standTotal = 0;
    this.stuckArrows = [];
    for (const p of this.players.values()) p.score = emptyScore();

    this.broadcastAll({ t: S2C.BOARS, b: [], clear: true });
    this.broadcastAll({ t: S2C.ELKS, e: [], clear: true });
    this.broadcastAll({ t: S2C.BIRDS, k: [], clear: true });
    this.broadcastAll({ t: S2C.ZOMBIES, z: [], clear: true });
    this.broadcastAll({ t: S2C.METEORS, m: [], clear: true });
    this.broadcastAll({ t: S2C.TORCHES, t4: this.torches });
    this.broadcastAll({ t: S2C.SERIES, target: null });
    this.broadcastAll({ t: S2C.WORLD_RESET, mode: this.mode });
    this.broadcastScores();
  }

  /**
   * Põe todo mundo atrás da linha de tiro, no começo da estrada.
   *
   * Lado a lado e voltados para o vale: a série inteira é uma sequência de
   * distâncias medidas a partir DA LINHA no chão, então começar espalhados pelo
   * mapa tornaria "o alvo dos 80 m" um número diferente para cada um.
   */
  lineUpForSeries() {
    const S = CONFIG.modes.series;
    const jogadores = [...this.players.values()];
    const meio = (jogadores.length - 1) / 2;
    const z = S.startZ + (S.spawnBehind ?? 3);

    jogadores.forEach((p, i) => {
      const x = pathCenterX(z) + (i - meio) * S.lineSpread;
      p.alive = true;
      p.invulnUntil = this.now() + CONFIG.spawn.invulnerability * 1000;
      this.stampSpawnState(p, x, z);
      this.broadcastAll({
        t: S2C.SPAWN,
        id: p.id,
        x: round(x),
        z: round(z),
        y: round(this.terrain.heightAt(x, z)),
        drop: this.spawnDrop(),
        invulnUntil: p.invulnUntil,
      });
    });
  }

  /**
   * Põe os arqueiros lado a lado num extremo do vale, para a caçada ao alce.
   *
   * Todos juntos e num lado só: é isso que dá sentido à investida. Espalhados
   * pelo mapa, cada um encontraria o alce sozinho, em silêncio, e o modo viraria
   * uma sequência de duelos privados com um bicho. Na linha, quem não está sendo
   * perseguido vê o amigo correndo e atira em quem está atrás dele.
   */
  lineUpForElk() {
    const jogadores = [...this.players.values()];
    if (!jogadores.length) return [];
    const pontos = elkHuntPositions(this.terrain, jogadores.length);
    const postos = [];

    jogadores.forEach((p, i) => {
      const ponto = pontos[i] ?? pontos[0];
      p.alive = true;
      p.invulnUntil = this.now() + CONFIG.spawn.invulnerability * 1000;
      postos.push({ id: p.id, alive: true, x: ponto.x, y: ponto.y, z: ponto.z });
      this.stampSpawnState(p, ponto.x, ponto.z);
    });

    /* O pacote de nascimento NÃO sai daqui, e é essa a diferença: ele só pode
       sair depois que o alce existir, porque é o alce que decide para onde a
       arqueira olha. Ver `broadcastElkLineUp`.

       Devolve os pontos ATRIBUÍDOS, e é por isso que este método devolve algo.
       `playerPositions()` lê a última pose REPORTADA por cada cliente, e neste
       instante ela ainda é a de antes do teleporte — o pacote de spawn acabou
       de sair e a pose nova só volta no próximo envio, 50 ms depois. Escolher o
       ponto do alce por ela punha o bicho ao lado dos arqueiros em vez de no
       extremo oposto, que é exatamente o contrário do que o modo pede. */
    return postos;
  }

  /**
   * Manda a linha nascer OLHANDO PARA O ALCE.
   *
   * A caçada começa com o bicho a sessenta metros, no extremo oposto do vale.
   * Nascer com a câmera no rumo antigo punha metade da sala de costas para o
   * único ponto de interesse do modo — e o primeiro segundo, que devia ser
   * "lá está ele", virava um giro de mouse procurando o cenário.
   */
  broadcastElkLineUp(postos) {
    const alce = this.elks.bossElk();
    for (const posto of postos) {
      const p = this.playerById(posto.id);
      if (!p) continue;
      const yaw = alce ? faceYaw(posto, alce) : 0;
      if (p.state) p.state.y = round(yaw);
      this.broadcastAll({
        t: S2C.SPAWN,
        id: p.id,
        x: round(posto.x),
        z: round(posto.z),
        y: round(posto.y),
        yaw: round(yaw),
        drop: this.spawnDrop(),
        invulnUntil: p.invulnUntil,
      });
    }
  }

  /** Alguém acertou o alvo da vez. */
  registerSeriesHit(player, msg) {
    const vencido = this.series.hit(msg.seq);
    if (!vencido) return; // tiro atrasado: outro já derrubou este alvo

    player.score.points += vencido.points;
    player.score.targets = (player.score.targets ?? 0) + 1;
    // Meio ponto por alvo: ele não reage e não anda. Ver `chargeSources.target`.
    this.addKameCharge(player, "target", 1, vencido);

    this.broadcastAll({
      t: S2C.SERIES_HIT,
      seq: vencido.seq,
      x: vencido.x,
      y: vencido.y,
      z: vencido.z,
      killer: player.id,
      killerName: player.name,
      killerColor: player.color,
      points: vencido.points,
      distance: vencido.distance,
    });
    this.broadcastAll({ t: S2C.SERIES, target: this.series.view() });
    this.broadcastScores();

    // Último alvo: placar de vitória com alvos acertados e pontos de cada um.
    if (vencido.last) {
      const ranking = [...this.players.values()]
        .map((p) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          targets: p.score.targets ?? 0,
          points: p.score.points ?? 0,
        }))
        .sort((a, b) => b.points - a.points || b.targets - a.targets);
      this.broadcastAll({ t: S2C.SERIES_OVER, ranking });
      this.log("série: último alvo derrubado, vitória anunciada");
    }
  }

  /**
   * Põe os duelistas em pontos distintos e BEM separados do cenário.
   *
   * É jogo de arco: dois duelistas a 10 m um do outro transformam o arco num
   * revólver e apagam tudo que o jogo tem de interessante — a queda da flecha,
   * a deriva do vento, a antecipação. O anel de 46 m devolve isso.
   */
  /**
   * Espalha todo mundo pelo anel, para a rodada de vida única começar.
   *
   * Reaproveita `duelPositions` porque a pergunta é a mesma — "onde pôr N
   * pessoas o mais longe possível umas das outras?" — e a resposta não muda por
   * serem oito em vez de dois. O que muda é o raio, que vem de
   * `CONFIG.modes.lastStand.ringRadius`: com oito arqueiros, o anel do duelo
   * ficaria apertado.
   *
   * Os BOTS entram na conta. Eles não recebem `S2C.SPAWN` (não têm cliente que
   * obedeça), mas precisam ser reposicionados no corpo — é o mesmo par de
   * chamadas que `spawn` faz.
   */
  lineUpForLastStand() {
    const todos = this.allCharacters();
    if (!todos.length) return;

    const pontos = duelPositions(
      this.terrain,
      todos.length,
      Math.random,
      CONFIG.modes.lastStand.ringRadius,
    );

    const invulnUntil = this.now() + CONFIG.modes.lastStand.invulnerability * 1000;
    todos.forEach((p, i) => {
      const ponto = pontos[i] ?? pontos[0];
      p.alive = true;
      p.invulnUntil = invulnUntil;
      if (p.isBot) p.renascer(ponto.x, ponto.z);
      this.stampSpawnState(p, ponto.x, ponto.z);
      this.broadcastAll({
        t: S2C.SPAWN,
        id: p.id,
        x: round(ponto.x),
        z: round(ponto.z),
        y: round(ponto.y),
        drop: this.spawnDrop(),
        invulnUntil,
      });
    });
  }

  startDuel() {
    /* NA LUA O DUELO NÃO TEM CONVITE.
     *
     * No vale ele é convite porque arrasta gente para uma briga no meio do
     * cenário livre, onde cada um estava fazendo a sua coisa. Ir para a Lua já
     * é uma decisão coletiva — a sala inteira viajou junto —, e ninguém pousa
     * num campo de duelo de 330 m para ficar de fora. */
    const semConvite = !levelUsesDuelInvites(this.level);
    const participantes = [...this.players.values()].filter(
      (p) => semConvite || this.duelInvites.has(p.id),
    );
    if (!participantes.length) return;

    const pontos = duelPositions(this.terrain, participantes.length);
    participantes.forEach((p, i) => {
      const ponto = pontos[i] ?? pontos[0];
      p.alive = true;
      p.invulnUntil = this.now() + CONFIG.spawn.invulnerability * 1000;
      this.stampSpawnState(p, ponto.x, ponto.z);
      this.broadcastAll({
        t: S2C.SPAWN,
        id: p.id,
        x: round(ponto.x),
        z: round(ponto.z),
        y: round(ponto.y),
        drop: this.spawnDrop(),
        invulnUntil: p.invulnUntil,
      });
    });
  }

  broadcastMode() {
    this.broadcastAll({ t: S2C.MODE, ...this.modeView() });
  }

  /* ---------------------------------------------------------------- porcos - */

  /**
   * Onde está cada jogador. O `id` e o `alive` vão junto porque o alce PRECISA
   * escolher uma vítima — os porcos só precisam saber de quem fugir.
   */
  /**
   * Jogadores e bots, juntos.
   *
   * Quase todo o resto da sala quer "quem tem corpo em campo", e não "quem tem
   * socket": os porcos fogem dos dois, o alce escolhe vítima entre os dois, o
   * placar mostra os dois e uma flecha acerta os dois. O único lugar que precisa
   * da distinção é o ENVIO de pacote — e lá o critério é `conn`, que o bot não
   * tem.
   */
  allCharacters() {
    return [...this.players.values(), ...this.bots.list];
  }

  playerPositions() {
    const saida = [];
    for (const p of this.players.values()) {
      if (!p.state) continue;
      saida.push({
        id: p.id,
        alive: p.alive,
        x: p.state.p[0],
        y: p.state.p[1],
        z: p.state.p[2],
      });
    }
    // Os bots também são gente em campo: o porco foge deles, o alce os
    // persegue e o alien vai atrás. Sem isto, eles seriam fantasmas para a fauna.
    for (const b of this.bots.list) {
      saida.push({ id: b.id, alive: b.alive, x: b.position.x, y: b.position.y, z: b.position.z });
    }
    return saida;
  }

  /**
   * Os bichos que o bot pode caçar.
   *
   * PÁSSAROS FICAM DE FORA de propósito: alvo pequeno, alto e em movimento — o
   * bot passaria o duelo de cabeça erguida mirando o céu, e um adversário
   * distraído por pardais não é adversário.
   */
  botPrey() {
    const lista = [];
    for (const b of this.hunt.boars) {
      if (!b.dead) lista.push({ kind: "boar", id: b.id, x: b.x, y: b.y, z: b.z });
    }
    for (const e of this.elks.elks) {
      if (!e.dead) lista.push({ kind: "elk", id: e.id, x: e.x, y: e.y, z: e.z });
    }
    for (const z of this.zombies.zombies) {
      if (!z.dead) lista.push({ kind: "zombie", id: z.id, x: z.x, y: z.y, z: z.z });
    }
    /* As rochas entram como presa — com RAIO e com o ponto de mira no centro.
       Sem os dois, a flecha do bot seria testada contra uma esfera de 80 cm no
       lugar de uma de até 28 m, e ele erraria tudo o que a tela mostra acertar.

       E COM VELOCIDADE: `simularFlechaDoBot` integra a rocha junto com a
       flecha durante os quase dois segundos de voo. Sem isso a fotografia
       ficava dezoito metros acima do ponto por onde a flecha passa. Ver o
       bloco dos bichos em `botArrow.js`. */
    for (const m of this.meteors.meteors) {
      if (m.dead) continue;
      lista.push({
        kind: "meteor",
        id: m.id,
        x: m.x,
        y: m.y,
        z: m.z,
        vx: m.vx,
        vy: m.vy,
        vz: m.vz,
        r: m.raio,
        aimY: 0,
        /* SEGUNDOS ATÉ O CHÃO. É a única medida de urgência que existe neste
           modo, e é ela que o bot antiaéreo usa para escolher — a rocha mais
           PERTO dele pode ser a que tem meio minuto de sobra. */
        prazo: m.altitude / Math.max(0.1, -m.vy),
        /* FLECHAS QUE AINDA FALTAM, JÁ DESCONTADAS as que estão a caminho.
           `simularFlechaDoBot` resolve o voo no instante do disparo, então a
           sala sabe com exatidão quantas flechas de bot vão chegar nesta pedra.
           Sem descontá-las, três bots gastavam três flechas numa rocha de um
           acerto só — que é um terço da bateria antiaérea jogado fora a cada
           salva. Não vale para flecha humana, e não por preguiça: a sala não
           sabe para onde vai a flecha de um humano até o `C2S.IMPACT` chegar. */
        left: m.maxHits - m.hits - (this.rochasReservadas?.get(m.id) ?? 0),
      });
    }
    /* Os sitiantes entram como presa, e é isso que faz o arqueiro de muralha
       existir sem uma linha de IA nova: `botSim` já sabe escolher o alvo mais
       próximo, calcular a elevação e soltar a corda. O que ele não sabe é que
       aquilo é um cerco — e não precisa saber.

       `aimY` sobe com a espécie: mirar no chão de um ogro de 6 m é errar por
       baixo, e o `1,1 × escala` é o mesmo peito que a flecha do jogador acerta. */
    for (const b of this.siege.lista) {
      if (b.dead) continue;
      lista.push({
        kind: "besieger",
        id: b.id,
        x: b.x,
        y: b.y,
        z: b.z,
        /* QUEM ESTÁ SUBINDO O MURO FURA A FILA.
         *
         * O escalador é a única espécie cujo alvo é VOCÊ, e ele chega por onde
         * o arqueiro de muralha não olha — pelo lado, agarrado à pedra. Sem
         * prioridade ele perdia sempre: `penalidadeDeSetor` multiplica por até
         * quarenta o que não está na frente do posto (e o muro, para quem olha
         * a rampa, é o lado), então o bot preferia um soldado a sessenta metros
         * a um escalador a três. A guarnição morria de costas para a coisa que
         * subiu ao lado dela.
         *
         * `prioridade` é um multiplicador de distância — 0,25 faz um escalador
         * a 12 m parecer estar a 3 —, e quem a declara também escapa da
         * penalidade de setor, porque um defensor SE VIRA para o que já está em
         * cima do muro. Ver `Bot.escolherAlvoDeTiro`. */
        prioridade: b.state === "climb" ? 0.25 : 1,
        /* Ele ANDA durante o voo da flecha, e o bot mira onde ele vai estar.
           Sem estes três a conta do servidor testava a posição de agora contra
           uma flecha mirada em meio segundo à frente — 60 cm de erro contra um
           raio de 55 cm, ou seja, a guarnição inteira atirando sem matar
           ninguém. Ver o bloco dos bichos em `botArrow.js`. */
        vx: b.vx ?? 0,
        vz: b.vz ?? 0,
        /* O PEITO, medido na altura da espécie e não numa constante.
           `1,1 × escala` valia para o soldado e mentia nas pontas: no mastim,
           que tem 1,05 m de altura, o bot mirava CINCO CENTÍMETROS ACIMA DAS
           COSTAS do bicho. Seis décimos da altura é o peito de todas as fichas. */
        aimY: b.altura * 0.6,
        /* A ALTURA DO CORPO. É ela que faz `botArrow` testar o eixo do sitiante
           em vez de um ponto — e sem ela a guarnição do muro não matava
           ninguém: o teste caía no PÉ (`b.y`) enquanto a mira ia para o peito,
           meio metro acima, e a esfera de 0,55 m nunca era tocada. Ver o bloco
           dos bichos em `botArrow.js`. */
        h: b.altura,
        /* O raio do alvo, para a flecha do bot. Sem ele `botArrow` usa 0,8 m
           para tudo — o que é generoso para um soldado e absurdamente pequeno
           para um ogro de 6 m, que a tela mostra sendo acertado e a conta diz
           que passou de raspão. */
        r: 0.55 * b.scale,
      });
    }
    /* OS MORCEGOS TAMBÉM SÃO PRESA, e essa era uma ausência que se pagava caro.
     *
     * Eles são a única ameaça do cerco que chega por cima, e a guarnição de CPU
     * simplesmente não os enxergava: ela varria a rampa enquanto o bicho
     * mergulhava no companheiro humano ao lado. Um arqueiro postado que ignora
     * o que vem do céu não é guarnição, é enfeite com arco.
     *
     * Prioridade alta pelo mesmo motivo do escalador: o morcego mata gente, e
     * uma flecha nele vale mais do que uma no soldado que ainda tem noventa
     * metros de rampa pela frente. E ele NÃO entra na penalidade de setor — um
     * defensor levanta a cabeça, e o céu não tem frente nem lado. */
    for (const m of this.morcegos.bats) {
      if (m.dead) continue;
      lista.push({
        kind: "bat",
        id: m.id,
        x: m.x,
        y: m.y,
        z: m.z,
        // Ele voa a até 17 m/s: sem a velocidade, a flecha é testada contra uma
        // fotografia que já está dez metros atrás do bicho.
        vx: Math.sin(m.yaw) * this.velocidadeDoMorcego(m),
        vz: Math.cos(m.yaw) * this.velocidadeDoMorcego(m),
        aimY: 0, // a posição dele É o centro do corpo
        r: 1.3, // o mesmo colisor que a flecha do jogador acerta
        prioridade: 0.2,
      });
    }
    return lista;
  }

  /** Quanto o morcego anda por segundo no estado em que está. */
  velocidadeDoMorcego(m) {
    const B = CONFIG.modes.siege.bats;
    if (m.state === "rasante") return B.diveSpeed;
    if (m.state === "recuando") return B.circleSpeed;
    return B.cruiseSpeed;
  }

  /**
   * Um passo do mundo dos bichos: porcos, alces e pássaros.
   *
   * Os três andam no mesmo relógio de 10 Hz, mas só os pássaros andam SEMPRE —
   * porcos e alces só existem quando alguém os colocou em campo.
   */
  tickCreatures() {
    if (this.players.size === 0) return;
    const agora = this.now();
    const jogadores = this.playerPositions();

    // A Lua anda no mesmo relógio dos bichos: alien, nave e meteorito têm a
    // cadência de um javali, e nenhum deles precisa de mais.
    this.tickSpace(this.boarStep);
    /* A bandeira também: ela é UM objeto que anda no passo de quem a carrega, e
       10 Hz é a mesma cadência em que as poses dos jogadores chegam aqui — não
       há informação nova entre duas amostras para um passo mais fino ler. */
    this.tickFlag(this.boarStep);

    // Convite de duelo que ninguém aceitou expira sozinho: um aviso pendurado
    // para sempre na tela vira ruído.
    if (this.inviteExpires && agora > this.inviteExpires && this.mode !== "duel") {
      this.duelInvites.clear();
      this.inviteExpires = 0;
      for (const p of this.players.values()) p.duelReady = false;
      this.broadcastMode();
    }

    // Roda enquanto houver porco em campo, mesmo com a caçada desligada: os
    // avulsos precisam andar.
    if (this.hunt.active || this.hunt.boars.length) {
      const atacados = this.hunt.update(this.boarStep, jogadores, agora);
      for (const hit of atacados) this.registerBoarAttack(hit);
      // A onda nova é anunciada ANTES das poses: quem recebe já sabe por que
      // apareceram seis javalis de uma vez.
      const onda = this.hunt.takeWaveAnnouncement();
      if (onda) {
        this.broadcastAll({ t: S2C.WAVE, ...onda });
        this.log(`onda ${onda.n}: ${onda.size} porcos`);
      }
      // A quinta onda esgotou: a caçada acabou. O ranking vai por abates de
      // porco — é a coluna que o modo pontua, e o que a tela de vitória lê.
      if (this.hunt.takeVictoryAnnouncement()) {
        const ranking = [...this.players.values()]
          .map((p) => ({ id: p.id, name: p.name, color: p.color, boars: p.score.boars }))
          .sort((a, b) => b.boars - a.boars);
        this.broadcastAll({ t: S2C.HUNT_OVER, ranking });
        this.log("caçada: ondas esgotadas, vitória anunciada");
      }
      this.broadcastAll({ t: S2C.BOARS, time: agora, b: this.hunt.view() });
    }

    if (this.elks.active || this.elks.elks.length) {
      const chifrados = this.elks.update(this.boarStep, jogadores, agora);
      for (const id of chifrados) this.registerGore(id);

      if (this.mode === "elkHunt" && !this.elks.over) {
        const boss = this.elks.bossElk();
        this.elkWolves.tickSummon(boss, this.players.size, agora);
        const wr = this.elkWolves.update(this.boarStep, jogadores, agora);
        for (const atk of wr.ataques) this.registerWolfKill(atk.playerId);
        this.broadcastAll({ t: S2C.ZOMBIES, time: agora, z: this.elkWolves.view() });
      }

      this.broadcastAll({ t: S2C.ELKS, time: agora, e: this.elks.view() });
    }

    if (isZombieMode(this.mode)) this.tickZombies(agora, jogadores);
    if (isMeteorMode(this.mode)) this.tickMeteors(agora);
    if (isSiegeMode(this.mode)) this.tickSiege(agora, jogadores);

    /* Os pássaros somem no modo zumbi e em qualquer fase SEM FAUNA. Não é
       economia — é o clima: um bando cantando e circulando sobre um cerco de
       mortos-vivos desmancha a noite que o modo inteiro constrói, e no vácuo
       da Lua ele é simplesmente impossível. */
    if (!isZombieMode(this.mode) && levelHasFauna(this.level)) {
      this.birds.update(this.boarStep, agora);
      // A rara caiu no chão: agora sim a tela de vitória.
      if (
        this.mode === "birdHunt" &&
        this.pendingSpecialBirdWin &&
        this.birds.takeSpecialLanded()
      ) {
        const vencedor = this.pendingSpecialBirdWin;
        this.pendingSpecialBirdWin = null;
        this.endBirdHunt(vencedor, "special");
      }
      this.broadcastAll({ t: S2C.BIRDS, time: agora, k: this.birds.view() });
    }
  }

  /**
   * O alce chifrou alguém.
   *
   * A morte é do SERVIDOR, e é a única do jogo que é. As mortes por flecha são
   * declaradas por quem atirou, porque quem atirou é quem viu o acerto e o tiro
   * precisa parecer instantâneo. Aqui não existe "quem viu": o alce é do
   * servidor, a investida é do servidor, e a cabeçada também.
   *
   * Na caçada, o que vem depois da morte é assunto de `downOnElkHunt`.
   */
  registerGore(victimId) {
    const vitima = this.playerById(victimId);
    if (!vitima || !vitima.alive) return;
    if (this.now() < vitima.invulnUntil) return;

    vitima.alive = false;
    vitima.score.deaths++;

    // Direção do tranco: do alce para a vítima. É ela que joga o corpo mole
    // para o lado certo — o mesmo caminho de uma morte por flecha.
    const alce = this.elks.elks.find((e) => !e.dead && e.state !== "graze");
    let contato = null;
    let impulso = null;
    if (alce && vitima.state) {
      const dx = vitima.state.p[0] - alce.x;
      const dz = vitima.state.p[2] - alce.z;
      const len = Math.hypot(dx, dz) || 1;
      contato = [vitima.state.p[0], vitima.state.p[1] + 1.1, vitima.state.p[2]];
      // Uma cabeçada de alce vale bem mais que uma flechada: o corpo voa.
      impulso = [(dx / len) * 130, 55, (dz / len) * 130];
    }

    this.broadcastAll({
      t: S2C.KILL,
      victim: vitima.id,
      victimName: vitima.name,
      victimColor: vitima.color,
      // `killer: 0` não é jogador nenhum — é como o feed sabe que quem matou
      // foi o bicho. Nenhum id de sala vale zero (o contador começa em 1).
      killer: 0,
      killerName: "Alce",
      killerColor: "#c8b48a",
      distance: null,
      c: contato,
      v: impulso,
      // Como a pessoa morreu. O cliente usa isto para escolher o som: uma
      // cabeçada tem uma pancada seca que uma flechada não tem.
      cause: "gore",
    });
    this.broadcastScores();

    if (this.mode === "elkHunt" && !this.elks.over) {
      this.downOnElkHunt(vitima);
      return;
    }

    this.aoMorrer(vitima);
  }

  /**
   * Porco investiu e acertou um jogador — tranco leve e renascimento padrão.
   *
   * Na caçada aos porcos a morte não entra no placar de abates: azar de levar
   * uma investida não deveria custar o ranking de quem caçou mais.
   */
  registerBoarAttack({ id: victimId, bx, bz }) {
    const vitima = this.playerById(victimId);
    if (!vitima || !vitima.alive) return;
    if (this.now() < vitima.invulnUntil) return;

    vitima.alive = false;
    if (this.mode !== "boarHunt") vitima.score.deaths++;

    let contato = null;
    let impulso = null;
    if (vitima.state) {
      const dx = vitima.state.p[0] - bx;
      const dz = vitima.state.p[2] - bz;
      const len = Math.hypot(dx, dz) || 1;
      contato = [vitima.state.p[0], vitima.state.p[1] + 1.1, vitima.state.p[2]];
      impulso = [(dx / len) * 75, 40, (dz / len) * 75];
    }

    this.broadcastAll({
      t: S2C.KILL,
      victim: vitima.id,
      victimName: vitima.name,
      victimColor: vitima.color,
      killer: 0,
      killerName: "Porco",
      killerColor: "#8b6914",
      distance: null,
      c: contato,
      v: impulso,
      cause: "boar",
    });
    if (this.mode !== "boarHunt") this.broadcastScores();

    this.aoMorrer(vitima);
  }

  /**
   * O arqueiro caiu na caçada: countdown, espectador e volta.
   *
   * SOZINHO NA SALA a espera é curta e a partida não acaba nunca por morte.
   * A regra do wipe existe para o grupo — é ela que dá peso a "não deixe o
   * último cair". Com uma pessoa só, ela vira outra coisa: reiniciar o modo
   * inteiro toda vez que a cabeçada acerta, jogando fora quinze flechas de
   * progresso. Aqui a vida do alce é o placar, e ela não volta a cheia porque
   * o caçador escorregou — o bicho continua exatamente onde estava.
   */
  downOnElkHunt(vitima) {
    const M = CONFIG.modes.elkHunt;
    const sozinho = this.players.size <= 1;
    const espera = (sozinho ? M.soloRespawnDelay : M.playerRespawnDelay) * 1000;

    vitima.elkDownUntil = this.now() + espera;
    this.broadcastElkStatus();
    if (!sozinho) this.checkElkWipe();

    setTimeout(() => {
      if (!this.players.has(vitima.conn)) return;
      if (this.mode !== "elkHunt" || this.elks.over) return;
      vitima.elkDownUntil = 0;
      this.spawn(vitima);
      // Invulnerabilidade extra do modo, além do spawn padrão.
      vitima.invulnUntil = Math.max(
        vitima.invulnUntil,
        this.now() + M.invulnerability * 1000,
      );
      this.broadcastElkStatus();
    }, espera).unref?.();
  }

  /**
   * Todo mundo caído na caçada ao alce ao mesmo tempo: derrota.
   *
   * Enquanto houver alguém vivo (ou ainda no timer de respawn com outro vivo),
   * a caçada continua. Só acaba quando NÃO sobra ninguém em pé — o mesmo
   * critério do wipe do modo zumbi, sem sistema de vidas. Não vale para quem
   * joga sozinho: ver `downOnElkHunt`.
   */
  checkElkWipe() {
    if (this.mode !== "elkHunt" || this.elks.over || this.players.size <= 1) return;
    for (const p of this.players.values()) {
      if (p.alive) return;
    }

    this.elks.gameOver("wipe");
    this.elkWolves.clear();
    this.broadcastAll({ t: S2C.ZOMBIES, z: [], clear: true });
    this.broadcastAll({ t: S2C.ELK_OVER, reason: "wipe" });
    this.broadcastElkStatus();
    this.log("modo alce: derrota — todos caídos");
  }

  elkStatus() {
    return {
      over: this.elks.over,
      reason: this.elks.overReason,
      downs: [...this.players.values()].map((p) => ({
        id: p.id,
        until: p.elkDownUntil ?? 0,
      })),
    };
  }

  broadcastElkStatus() {
    this.broadcastAll({ t: S2C.ELK_STATUS, ...this.elkStatus() });
  }

  /* ---------------------------------------------------------------- zumbis - */

  /** Limpa timer de respawn do modo zumbi. */
  resetZombieDown(player) {
    player.zDownUntil = 0;
  }

  hasLivingPlayer() {
    for (const p of this.players.values()) {
      if (p.alive) return true;
    }
    return false;
  }

  /**
   * Põe todo mundo no centro, dentro do quadrado das tochas.
   *
   * Num anel pequeno e não no ponto exato: dois arqueiros nascendo na mesma
   * coordenada se empurram e um deles sai voando para fora da luz — que neste
   * modo é morte.
   */
  centerForZombie() {
    const Z = CONFIG.modes.zombie;
    const jogadores = [...this.players.values()];
    const n = jogadores.length;

    jogadores.forEach((p, i) => {
      const ang = (i / Math.max(1, n)) * Math.PI * 2;
      const raio = n > 1 ? 3.0 : 0;
      const x = Z.centerX + Math.sin(ang) * raio;
      const z = Z.centerZ + Math.cos(ang) * raio;
      p.alive = true;
      p.invulnUntil = this.now() + Z.invulnerability * 1000;
      this.stampSpawnState(p, x, z);
      this.broadcastAll({
        t: S2C.SPAWN,
        id: p.id,
        x: round(x),
        z: round(z),
        y: round(this.terrain.heightAt(x, z)),
        drop: 0,
        invulnUntil: p.invulnUntil,
      });
    });
  }

  /**
   * Um passo da noite: move a horda, aplica os ataques, vira a horda e checa
   * quem fugiu para o escuro.
   */
  tickZombies(agora, jogadores) {
    const Z = CONFIG.modes.zombie;
    if (this.zombies.over) return;

    const r = this.zombies.update(this.boarStep, jogadores, agora);

    for (const ataque of r.ataques) this.registerZombieAttack(ataque.playerId);
    if (r.horda) {
      this.broadcastAll({ t: S2C.HORDE, ...r.horda });
      this.broadcastZombieStatus();
      this.log(`horda ${r.horda.n}: ${r.horda.size} zumbis`);
    }
    if (r.venceu) {
      // Sobreviveram as hordas: mesma tela de vitória da caçada, só que o
      // ranking aqui é por zumbi abatido — e leva as mortes junto, porque numa
      // horda quem mais mata também costuma ser quem mais cai.
      const ranking = [...this.players.values()]
        .map((p) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          kills: p.score.kills,
          deaths: p.score.deaths,
        }))
        .sort((a, b) => b.kills - a.kills);
      this.broadcastAll({ t: S2C.ZOMBIE_OVER, reason: "win", horde: Z.hordes, ranking });
      this.log("modo zumbi: venceram as nove hordas");
    }

    this.checkZombieBounds(agora);
    this.checkZombieWipe(agora);
    this.broadcastAll({ t: S2C.ZOMBIES, time: agora, z: this.zombies.view() });
  }

  /**
   * Quem se afastou demais do centro morre.
   *
   * É a regra que sustenta o modo inteiro: sem ela, a resposta ótima a uma horda
   * de bichos lentos é caminhar para longe e atirar de fora do alcance, e o
   * cerco — que é a única ameaça que eles oferecem — deixa de existir.
   */
  checkZombieBounds(agora) {
    const Z = CONFIG.modes.zombie;
    for (const p of this.players.values()) {
      if (!p.alive || !p.state) continue;
      if (agora < p.invulnUntil) continue;
      /* A pose é a última REPORTADA, e ela chega a 20 Hz — logo depois de um
         `SPAWN` ela ainda é a de antes, lá do outro lado do vale. Sem esta
         checagem o jogador era morto pelo escuro no instante em que o modo
         começava, por estar num lugar onde já não estava. A invulnerabilidade
         cobre o caso normal; isto cobre o cliente que engasgou. */
      if (p.stateTime < p.invulnUntil - Z.invulnerability * 1000) continue;
      const d = Math.hypot(p.state.p[0] - Z.centerX, p.state.p[2] - Z.centerZ);
      if (d <= Z.safeRadius) continue;
      this.registerZombieAttack(p.id, "dark");
    }
  }

  /**
   * Morte no modo zumbi: 10 s de espectador e volta ao centro.
   *
   * Sozinho (testes): sempre renasce — sem game over. Com mais de um jogador,
   * só volta se alguém ainda estiver vivo quando o timer acabar.
   */
  registerZombieAttack(victimId, causa = "zombie") {
    const Z = CONFIG.modes.zombie;
    const vitima = this.playerById(victimId);
    if (!vitima || !vitima.alive) return;
    if (this.now() < vitima.invulnUntil) return;

    const sozinho = this.players.size <= 1;
    vitima.alive = false;
    vitima.score.deaths++;
    const espera = Z.respawnDelay * 1000;
    vitima.zDownUntil = this.now() + espera;

    this.broadcastAll({
      t: S2C.KILL,
      victim: vitima.id,
      victimName: vitima.name,
      victimColor: vitima.color,
      killer: 0,
      killerName: causa === "dark" ? "O escuro" : "Zumbi",
      killerColor: causa === "dark" ? "#4a4a6a" : "#7fa05a",
      distance: null,
      c: null,
      v: null,
      cause: causa,
    });
    this.broadcastScores();
    this.broadcastZombieStatus();
    if (!sozinho) this.checkZombieWipe(this.now());

    setTimeout(() => {
      if (!this.players.has(vitima.conn)) return;
      if (!isZombieMode(this.mode) || this.zombies.over) return;
      if (!sozinho && !this.hasLivingPlayer()) return;
      vitima.zDownUntil = 0;
      this.centerOne(vitima);
      this.broadcastZombieStatus();
    }, espera).unref?.();
  }

  /** Devolve UM jogador ao centro do quadrado. */
  centerOne(player) {
    const Z = CONFIG.modes.zombie;
    const ang = Math.random() * Math.PI * 2;
    const raio = Math.random() * 3.0;
    const x = Z.centerX + Math.sin(ang) * raio;
    const z = Z.centerZ + Math.cos(ang) * raio;
    player.alive = true;
    player.invulnUntil = this.now() + Z.invulnerability * 1000;
    this.broadcastAll({
      t: S2C.SPAWN,
      id: player.id,
      x: round(x),
      z: round(z),
      y: round(this.terrain.heightAt(x, z)),
      drop: 0,
      invulnUntil: player.invulnUntil,
    });
  }

  /**
   * Todo mundo morto ao mesmo tempo: game over.
   *
   * Não vale para quem joga sozinho — ver `registerZombieAttack`.
   */
  checkZombieWipe(_agora) {
    if (this.zombies.over || !this.players.size || this.players.size <= 1) return;
    for (const p of this.players.values()) {
      if (p.alive) return;
    }

    this.zombies.gameOver("wipe");
    this.broadcastAll({
      t: S2C.ZOMBIE_OVER,
      reason: "wipe",
      horde: this.zombies.horde,
    });
    this.broadcastAll({ t: S2C.ZOMBIES, z: [], clear: true });
    this.log(`modo zumbi: game over na horda ${this.zombies.horde}`);
  }

  /* ------------------------------------------------------ chuva de meteoros --
   *
   * O modo inteiro cabe em cinco métodos porque a regra é uma só: uma rocha no
   * chão acaba a partida. Não há vida, não há caído, não há renascimento a
   * negociar — o que existe é um relógio, e ele é o mesmo para todo mundo.
   */

  /**
   * Põe todo mundo num anel em volta da base.
   *
   * Perto o bastante para ver a zona de queda inteira sem girar, longe o
   * bastante para não nascerem em cima uns dos outros — o mesmo raciocínio de
   * `centerForZombie`. Os BOTS ficam num anel mais externo: a mira deles
   * degenera com a rocha a pino (ver `botSim.escolherAlvoDeTiro`), e afastá-los
   * é o que mantém a maioria das rochas dentro da janela de elevação em que
   * eles conseguem acertar.
   */
  lineUpForMeteorRain() {
    const M = CONFIG.modes.meteorRain;
    const base = CONFIG.levels.moon.base;
    const humanos = [...this.players.values()];

    humanos.forEach((p, i) => {
      const ang = (i / Math.max(1, humanos.length)) * Math.PI * 2;
      const raio = M.spawnRingMin + Math.random() * (M.spawnRingMax - M.spawnRingMin);
      const x = base.x + Math.sin(ang) * raio;
      const z = base.z + Math.cos(ang) * raio;
      p.alive = true;
      p.invulnUntil = this.now() + M.invulnerability * 1000;
      this.stampSpawnState(p, x, z);
      this.broadcastAll({
        t: S2C.SPAWN,
        id: p.id,
        x: round(x),
        z: round(z),
        y: round(this.terrain.heightAt(x, z)),
        drop: 0,
        invulnUntil: p.invulnUntil,
        // De frente para a base: é para lá que tudo vai cair. Por `faceYaw` —
        // a conta à mão que estava aqui tinha o mesmo sinal trocado do cerco, e
        // punha o jogador de costas para a única coisa que ele precisa vigiar.
        yaw: faceYaw({ x, z }, base),
      });
    });

    this.bots.list.forEach((b, i) => this.postoAntiaereo(b, i, this.bots.count));
  }

  /**
   * Põe um bot no anel externo, de frente para a base.
   *
   * Serve tanto a formação inicial quanto a tecla `B` no meio da partida — e
   * por isso o índice é opcional: sem ele o ângulo é sorteado, que é o certo
   * para quem chega sozinho e não tem uma fila em que se encaixar.
   */
  postoAntiaereo(bot, indice = null, total = 1) {
    const M = CONFIG.modes.meteorRain;
    const base = CONFIG.levels.moon.base;
    const ang =
      indice == null
        ? Math.random() * Math.PI * 2
        : (indice / Math.max(1, total)) * Math.PI * 2 + 0.4;
    const raio = M.botRingMin + Math.random() * (M.botRingMax - M.botRingMin);
    const x = base.x + Math.sin(ang) * raio;
    const z = base.z + Math.cos(ang) * raio;
    bot.position.x = x;
    bot.position.z = z;
    bot.position.y = this.terrain.heightAt(x, z);
    bot.floorY = null;
    bot.alive = true;
    bot.yaw = faceYaw({ x, z }, base);
    bot.state = packState(bot);
    bot.stateTime = this.now();
  }

  /**
   * Um passo da chuva.
   *
   * Roda no relógio dos bichos (10 Hz), que é o mesmo do resto. A rocha anda
   * 1,75 m entre amostras na horda 10 — o cliente amortece por cima disso e a
   * mira continua honesta.
   */
  tickMeteors(agora) {
    if (this.meteors.over) return;
    /* O TAMANHO É MEDIDO NO COMEÇO DE CADA HORDA, e não da partida — daí este
       número ser reescrito a cada passo em vez de congelado no `start`. Assim
       quem chegou na horda 5 engrossa a 6, e quem saiu na 7 alivia a 8, sem
       nunca mexer numa horda em curso (cujas rochas já foram agendadas com
       horário marcado). O zumbi congela no `start()`, e é a escolha certa lá:
       a partida dele dura nove minutos e ninguém entra no meio. Esta dura doze,
       e entrar no meio é o normal. */
    this.meteors.playerCount = Math.max(1, this.players.size + this.bots.count);
    const antes = this.meteors.horde;
    const r = this.meteors.update(this.boarStep);

    if (r.horda) {
      this.broadcastAll({ t: S2C.HORDE, kind: "meteor", ...r.horda });
      this.broadcastMeteorStatus();
      this.log(`chuva ${r.horda.n}: ${r.horda.size} rochas`);
    } else if (this.meteors.horde !== antes) {
      this.broadcastMeteorStatus();
    }

    if (r.impacto) {
      this.meteorImpact(r.impacto);
      return;
    }

    if (r.venceu) {
      const ranking = [...this.players.values()]
        .map((p) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          rocks: p.score.rocks ?? 0,
          shots: p.score.shots ?? 0,
        }))
        .sort((a, b) => b.rocks - a.rocks);
      this.broadcastAll({
        t: S2C.METEOR_OVER,
        reason: "win",
        horde: CONFIG.modes.meteorRain.hordes,
        ranking,
      });
      this.log("chuva de meteoros: dez hordas vencidas");
    }

    this.broadcastAll({ t: S2C.METEORS, time: agora, m: this.meteors.view() });
  }

  /**
   * Uma rocha encostou no chão. Todo mundo morre, e a partida acaba.
   *
   * Sem raio de dano e sem "morreu quem estava perto": a regra é a que foi
   * pedida, e ela é boa justamente por não ter exceção. É o que faz cada rocha
   * importar.
   */
  meteorImpact(p) {
    this.broadcastAll({
      t: S2C.METEOR_IMPACT,
      p: [round(p.x), round(p.y), round(p.z)],
      r: round(p.raio),
    });

    for (const jogador of this.players.values()) {
      if (!jogador.alive) continue;
      jogador.alive = false;
      jogador.score.deaths++;
      this.broadcastAll({
        t: S2C.KILL,
        victim: jogador.id,
        victimName: jogador.name,
        victimColor: jogador.color,
        killer: null,
        killerName: "um meteoro",
        killerColor: "#ff6a2a",
        distance: null,
        c: null,
        v: null,
        cause: "meteor",
      });
    }
    for (const bot of this.bots.list) bot.alive = false;

    this.meteors.gameOver("impact");
    this.broadcastScores();
    this.broadcastAll({ t: S2C.METEORS, m: [], clear: true });
    this.broadcastAll({
      t: S2C.METEOR_OVER,
      reason: "impact",
      horde: this.meteors.horde,
    });
    this.log(`chuva de meteoros: impacto na horda ${this.meteors.horde}`);
  }

  /** Uma flecha entrou numa rocha. */
  registerMeteorHit(player, msg) {
    if (!isMeteorMode(this.mode) || this.meteors.over) return;
    const id = Number(msg.id);
    if (!Number.isFinite(id)) return;

    /* O ESPECIAL VAPORIZA — MENOS O COLOSSO.
     *
     * A regra mora aqui e não no cliente porque é aqui que se sabe qual das
     * rochas é o colosso. O feixe apaga qualquer outra de primeira, seja qual
     * for a vida dela: um raio de energia que precisa de duas passadas numa
     * pedra de 6 m não é um raio de energia. No colosso ele vale três flechas
     * (`CONFIG.special.kameTankHits`) — um pedaço honesto da barra sem apagar
     * numa tecla os setenta segundos que o ato dele existe para cobrar. */
    const alvo = this.meteors.byId(id);
    const dano =
      msg.kame === true
        ? alvo?.kind === "tank"
          ? CONFIG.special.kameTankHits
          : (alvo?.maxHits ?? 1)
        : 1;

    const r = this.meteors.hit(id, dano);
    if (!r) return;

    const M = CONFIG.modes.meteorRain;
    const pontos = r.morreu ? (M.points[r.meteor.maxHits] ?? M.points[1]) : M.points.tank;
    player.score.points += pontos;
    player.score.shots = (player.score.shots ?? 0) + 1;

    /* O PISCAR nas outras telas. Em co-op esta é a mensagem mais importante do
       modo: ela é o que diz "aquela ali já tem dono", e é o que impede duas
       pessoas de gastarem duas flechas na mesma pedra. Quem atirou já viu
       localmente — mesmo padrão do clarão do chefão em `ZOMBIE_HIT`. */
    this.broadcast(
      {
        t: S2C.METEOR_HIT,
        id,
        by: player.id,
        left: r.left,
        p: [round(r.meteor.x), round(r.meteor.y), round(r.meteor.z)],
      },
      player.id,
    );

    if (r.morreu) {
      player.score.rocks = (player.score.rocks ?? 0) + 1;
      this.burstMeteor(r.meteor, player);
    }

    // A carga do especial: um ponto por flecha que conecta, inclusive as
    // parciais no colosso — acertar aquilo dezesseis vezes é trabalho. O feixe
    // conta pelo que GASTOU, e não por uma mensagem: ele apaga uma rocha de
    // três flechas com um pacote só, e cobrar por um seria pagar menos pelo
    // mesmo estrago.
    this.addKameCharge(player, "meteor", r.gasto ?? 1, r.meteor);
    this.broadcastScores();
    this.broadcastMeteorStatus();
  }

  /**
   * A rocha se parte.
   *
   * O servidor NÃO integra os estilhaços — manda a semente e o cliente desenha,
   * com a mesma conta de `shared/fragments.js`. Aqui eles não matam ninguém
   * (é um pedido, e é a coisa certa: a rocha estourada é uma VITÓRIA, e uma
   * vitória que às vezes mata quem venceu é punição por jogar bem), então não
   * há o que decidir do lado da sala. Custa menos que o meteorito da Lua livre.
   */
  burstMeteor(meteor, matador = null) {
    this.broadcastAll({
      t: S2C.METEOR_BURST,
      id: meteor.id,
      p: [round(meteor.x), round(meteor.y), round(meteor.z)],
      r: round(meteor.raio),
      seed: (Math.random() * 0xffffffff) >>> 0,
      killer: matador?.id ?? null,
      killerName: matador?.name ?? null,
      killerColor: matador?.color ?? null,
      tank: meteor.kind === "tank",
    });
  }

  meteorStatus() {
    const M = CONFIG.modes.meteorRain;
    return {
      horde: this.meteors.horde,
      hordes: M.hordes,
      rocks: this.meteors.vivos + this.meteors.pending.length,
      /* O NÍVEL VIAJA COM O ESTADO, e não numa mensagem própria.
       *
       * Ele muda uma vez por partida, junto com o começo da chuva — que é
       * exatamente quando este pacote já sai. Uma mensagem separada seria um
       * segundo caminho para a mesma notícia, com a chance de os dois chegarem
       * fora de ordem e a tela anunciar "difícil" sobre uma chuva fácil.
       *
       * E, de graça, resolve quem chega no meio: o `snapshot` já carrega este
       * bloco inteiro, então um retardatário lê o nível da sala sem uma linha
       * escrita para o caso dele. */
      difficulty: this.meteors.dificuldade,
      tank: this.meteors.tankAtivo,
      /* A VIDA DO COLOSSO, para a barra do HUD.
       *
       * As outras rochas não têm barra e não devem ter: elas pedem de uma a
       * três flechas e o escurecimento do material já conta essa história. O
       * colosso pede de sete a dezoito, dura mais de um minuto e é o ato do
       * modo — sem um número, atirar nele é atirar num muro sem saber se está
       * adiantando. É a mesma exceção que o chefão zumbi já abre, e reusa a
       * mesma barra (ver `Hud.setBossHp`). */
      tankHp: this.meteors.tank
        ? Math.max(0, 1 - this.meteors.tank.hits / this.meteors.tank.maxHits)
        : null,
      /* O INSTANTE ABSOLUTO, não "faltam 6 segundos".
       *
       * É o que faz a contagem ser a mesma em todas as telas e o retardatário
       * simplesmente não desenhar contagem nenhuma: ele recebe um horário no
       * passado e a subtração dá negativo, sem uma única linha escrita para o
       * caso dele. Mesmo padrão de `invulnUntil` e `inviteExpires`. */
      startsAt: this.meteors.countdown > 0 ? this.now() + this.meteors.countdown * 1000 : 0,
      over: this.meteors.over,
      reason: this.meteors.overReason,
    };
  }

  broadcastMeteorStatus() {
    this.broadcastAll({ t: S2C.METEOR_STATUS, ...this.meteorStatus() });
  }

  /* ------------------------------------------------------------------ cerco --

     A sala é dona de três coisas do cerco, e de nenhuma outra: a vida do
     portão, o estado dos três engenhos e quem morreu. Poses, ritmo e IA são de
     `siegeSim.js`; a trajetória da flecha e a da pedra são de quem atirou. */

  /**
   * Todo mundo para o ADARVE.
   *
   * O modo inteiro acontece 11 m acima do chão, e nascer no pátio significaria
   * subir a escada antes de a partida começar. Os postos vêm de
   * `castleProps.walkwayPosts()`, na ordem em que ela os lista: o primeiro é o
   * centro, sobre o portão. Quem entra sozinho fica onde a partida é decidida.
   */
  lineUpForSiege() {
    const S = CONFIG.modes.siege;
    const postos = walkwayPosts();
    const gate = gateInfo();
    let i = 0;

    for (const p of this.players.values()) {
      const posto = postos[i++ % postos.length];
      p.alive = true;
      p.invulnUntil = this.now() + S.invulnerability * 1000;
      this.stampSpawnState(p, posto.x, posto.z);
      this.broadcastAll({
        t: S2C.SPAWN,
        id: p.id,
        x: round(posto.x),
        z: round(posto.z),
        // A cota é a do MURO, não a do terreno: `heightAt` responderia 14 m
        // (o pátio) e o jogador nasceria dentro da alvenaria.
        y: round(posto.y),
        drop: 0,
        invulnUntil: p.invulnUntil,
        /* De frente para a rampa: é de lá que eles vêm.
         *
         * Por `faceYaw`, e não pela conta à mão que estava aqui. A convenção do
         * corpo é yaw 0 olhando para −Z, então encarar um ponto pede
         * `atan2(−dx, −dz)`: escrito com os sinais trocados, o jogador nascia
         * de costas para a rampa e de cara para a menagem. O primeiro segundo
         * de toda partida — e de todo renascimento — era um giro de mouse às
         * cegas para achar o lado de onde vem a horda. */
        yaw: faceYaw(posto, { x: gate.x, z: gate.standZ + 40 }),
      });
    }

    for (const b of this.bots.list) {
      const posto = postos[i++ % postos.length];
      /* `renascer` com o piso declarado, e não três atribuições soltas: a
         gravidade do bot precisa saber que o chão dele é o adarve, senão ela o
         puxa para o pátio no primeiro tique. Ver `Bot.gravidade`. */
      b.renascer(posto.x, posto.z, posto.y);
      b.yaw = Math.atan2(gate.x - posto.x, gate.standZ + 40 - posto.z);
    }
  }

  /**
   * Um passo do cerco. Roda no relógio dos bichos (10 Hz).
   *
   * A ordem importa: o passo da simulação primeiro, os eventos dele depois, e
   * as poses por último — quem recebe uma morte já viu o motivo dela.
   */
  tickSiege(agora, jogadores) {
    if (this.siege.over) return;
    const S = CONFIG.modes.siege;
    const dt = this.boarStep;

    /* A GUARNIÇÃO É CONTADA A CADA PASSO, e não congelada no `start`.
     *
     * É o que faz "chamar dois bots" e "chegar mais um jogador" serem a mesma
     * coisa para o portão — que é a verdade: o sitiante não sabe distinguir um
     * arco de CPU de um arco humano, e o que ele sente é quantas flechas descem
     * do adarve. Sem isto, entrar sozinho e apertar B três vezes daria quatro
     * arqueiros defendendo o cerco de um, que é a partida vazia; e alguém saindo
     * no meio deixaria o cerco de quatro nas mãos de quem sobrou.
     *
     * Mesma escolha da chuva de meteoros (ver `tickMeteors`), e pela mesma razão
     * de lá: a partida dura dez minutos e entrar no meio é o normal. O efeito
     * não é instantâneo, e isso também é de propósito — a fila de chegadas corre
     * uma travessia à frente, então o reforço aperta a rampa do horizonte em
     * diante, não em cima de quem já está subindo. Ver `Siege.setPlayers`. */
    this.siege.setPlayers(this.players.size + this.bots.count);

    /* Trabucos: içam sozinhos, ou mais rápido com alguém na manivela. Quem
       está na manivela não está atirando — é a troca central do modo.
     *
     * `pronto` é um PRAZO no relógio da sala, e por isso o tempo real já o
     * consome sozinho: `agora` anda cem milissegundos a cada tique e o prazo
     * fica onde está. O que este laço adianta é só o EXCEDENTE da manivela.
     *
     * Descontar o passo cheio — que era o que se fazia — descontava o tempo
     * DUAS VEZES: o prazo recuava cem milissegundos enquanto o relógio avançava
     * outros cem. Sem ninguém na manivela o engenho recarregava em 7 s no lugar
     * de 14, e com alguém nela em 3,4 s no lugar de 4,5. A troca central do
     * modo — deixar de atirar para içar o de outro — pagava metade do preço que
     * o plano calculou, e o `reload` de `CONFIG` não descrevia partida nenhuma. */
    let mudouTrabuco = false;
    const excedente = S.trebuchet.reload / S.trebuchet.windReload - 1;
    for (const t of this.trebuchets) {
      /* O corte é `pronto === 0`, e não `pronto <= agora`: zero significa
         "pronto E já anunciado". Com o corte pelo relógio, o tique em que o
         prazo é finalmente alcançado sai pelo `continue` antes de zerar e de
         marcar `mudouTrabuco` — e o `TREB_STATE` que diz "este carregou" nunca
         seria enviado a ninguém. */
      if (t.pronto === 0) continue;
      if (t.wind.size > 0) t.pronto -= dt * 1000 * excedente;
      if (t.pronto <= agora) {
        t.pronto = 0;
        mudouTrabuco = true;
      }
    }
    if (mudouTrabuco) this.broadcastTrebuchets();

    // Reparo: some no instante em que a mão sai dele, e por isso o conjunto é
    // limpo aqui e reconstruído pela mensagem do cliente.
    if (this.repairing.size) this.siege.repair(dt, this.repairing.size);

    const r = this.siege.update(dt, jogadores, agora);

    if (r.tier) {
      this.broadcastAll({ t: S2C.SIEGE_TIER, nome: r.tier.nome, kind: r.tier.kind });
      this.log(`cerco: escalão "${r.tier.nome}" aos ${Math.round(r.tier.at / 60)} min`);
    }
    for (const tiro of r.tiros) this.broadcastAll({ t: S2C.SIEGE_SHOT, ...tiro });
    for (const morto of r.mortos) {
      // Morte sem matador é morte por fogo do piche — ela ainda precisa sair,
      // senão o corpo fica de pé na tela de todo mundo.
      this.broadcastAll({ t: S2C.SIEGE_DEATH, id: morto.id, kind: morto.kind, killer: 0 });
    }
    for (const ataque of r.ataques) {
      if (ataque.playerId) this.registerSiegeAttack(ataque.playerId);
    }
    if (r.gateHit > 0) {
      this.broadcastAll({
        t: S2C.GATE_HIT,
        f: Math.round((this.siege.gateHp / this.siege.gateMax) * 100) / 100,
      });
    }

    /* A BOLA DO MAGO que venceu o prazo de voo.
     *
     * Mesma regra da pedra de catapulta, logo abaixo, e pelo mesmo motivo: o
     * dano é do PONTO onde ela cai, não da pessoa em quem foi mirada. São cinco
     * segundos de voo desde o mirante; quem viu a bola sair e saiu do lugar
     * escapa, e é isso que faz a torre cobrar atenção em vez de cobrar sorte.
     *
     * O raio é pequeno (2,2 m) porque a bola é evitável: um raio grande
     * transformaria "eu me mexi" em "eu me mexi e morri assim mesmo". */
    for (const raio of this.siege.colherRaios(agora)) {
      this.broadcastAll({
        t: S2C.SIEGE_SHOT,
        kind: "boltImpact",
        to: [round(raio.x), round(raio.y), round(raio.z)],
      });
      for (const p of this.allCharacters()) {
        if (!p.alive) continue;
        const pos = p.state ? { x: p.state.p[0], y: p.state.p[1], z: p.state.p[2] } : p.position;
        if (!pos) continue;
        if (Math.hypot(pos.x - raio.x, pos.z - raio.z) > S.mageBlast) continue;
        if (Math.abs(pos.y - raio.y) > 3) continue;
        this.registerSiegeAttack(p.id, "shaman");
      }
    }

    /* Pedra de catapulta que venceu o prazo de voo. O dano é aplicado AQUI e
       não no disparo: quem sai do lugar durante os 2,4 s de voo escapa, que é
       a diferença entre uma ameaça de área e um tiro teleguiado. */
    for (const imp of this.siege.colherImpactos(agora)) {
      this.broadcastAll({ t: S2C.SIEGE_SHOT, kind: "rockImpact", to: [imp.x, imp.y, imp.z] });
      for (const p of this.players.values()) {
        if (!p.alive || !p.state) continue;
        if (agora < p.invulnUntil) continue;
        const d = Math.hypot(p.state.p[0] - imp.x, p.state.p[2] - imp.z);
        if (d <= 3.2) this.registerSiegeAttack(p.id, "catapult");
      }
    }

    /* OS MORCEGOS.
     *
     * Andam no mesmo relógio de 10 Hz do resto do cerco, e DEPOIS dele: o
     * mergulho persegue a pose de quem está no muro, e usar a do quadro
     * anterior deixaria o bicho um passo atrás de quem está andando.
     *
     * `this.siege.t` e não o relógio da sala: o bando entra aos 150 s de
     * PARTIDA, junto com o resto da escalada de ameaças, e uma sala aberta há
     * duas horas não pode fazer o primeiro morcego chegar antes do primeiro
     * soldado. */
    const rb = this.morcegos.update(dt, jogadores, this.siege.t);
    for (const m of rb.mortes) this.registerSiegeAttack(m.playerId, "bat");
    this.broadcastAll({ t: S2C.BATS, time: agora, b: this.morcegos.view() });

    this.checarQuedaDoMuro();

    if (r.over) {
      this.endSiege(r.venceu ? "dusk" : "gate");
      return;
    }

    // O quadro binário das poses. Ver `Siege.packFrame` para a conta.
    this.broadcastFrame(this.siege.packFrame());

    // O estado vai a 2 Hz: ele é HUD, e HUD não precisa de 10 Hz.
    this._siegeStatusTick = (this._siegeStatusTick ?? 0) + 1;
    if (this._siegeStatusTick % 5 === 0) {
      this.broadcastSiegeStatus();
      /* OS ENGENHOS TAMBÉM, e não só quando mudam de estado.
       *
       * `broadcastTrebuchets` saía em três momentos por partida por engenho:
       * ao atirar, ao ficar pronto e ao entrar no modo. Bastava enquanto a
       * recarga era de catorze segundos e o HUD só dizia "carregado" ou
       * "içando" — dois estados, dois avisos.
       *
       * Com dois minutos de recarga e uma BARRA no próprio engenho (ver
       * `Trebuchet.atualizarBarra`), o que se transmite deixou de ser um estado
       * e passou a ser um progresso: sem amostras no meio, a barra ficaria
       * parada em zero por dois minutos e saltaria para cheia. A 2 Hz ela é
       * exata a meio segundo, e são dois engenhos — o pacote inteiro cabe numa
       * linha de texto. */
      this.broadcastTrebuchets();
    }
  }

  /**
   * Quem cai do muro morre.
   *
   * A queda é medida pelo DESNÍVEL, não pela cota final: são oito metros de
   * muro, e cair deles mata dos dois lados — para fora, na fila; para dentro,
   * no pátio. Uma regra de "morreu porque está lá embaixo" seria errada,
   * porque o pátio é lugar legítimo (é onde se repara o portão) e a escada
   * desce até ele o tempo todo.
   *
   * O pico é guardado por jogador e zerado quando ele volta a estar com os pés
   * no chão. É a mesma informação que a pose já carrega (`a`, de airborne), e
   * por isso não custa mensagem nova.
   */
  checarQuedaDoMuro() {
    const S = CONFIG.modes.siege;
    const agora = this.now();
    for (const p of this.players.values()) {
      if (!p.alive || !p.state) continue;
      const y = p.state.p[1];
      const noAr = p.state.a === 1;

      if (!noAr) {
        p.quedaPico = y;
        continue;
      }
      if (p.quedaPico == null || y > p.quedaPico) {
        p.quedaPico = y;
        continue;
      }
      if (p.quedaPico - y < S.fatalFall) continue;
      if (agora < p.invulnUntil) continue;
      p.quedaPico = y;
      this.registerSiegeAttack(p.id, "fall");
    }
  }

  /** Alguém no adarve levou um golpe de escalador, uma pedra ou um raio. */
  registerSiegeAttack(victimId, causa = "climber") {
    const S = CONFIG.modes.siege;
    const vitima = this.playerById(victimId);
    if (!vitima || !vitima.alive) return;
    if (this.now() < vitima.invulnUntil) return;

    vitima.alive = false;
    vitima.score.deaths++;
    vitima.zDownUntil = this.now() + S.respawnDelay * 1000;

    this.broadcastAll({
      t: S2C.KILL,
      victim: vitima.id,
      victimName: vitima.name,
      victimColor: vitima.color,
      killer: 0,
      killerName:
        causa === "fall"
          ? "A queda"
          : causa === "catapult"
            ? "Catapulta"
            : causa === "shaman"
              ? "Mago"
              : causa === "bat"
                ? "Morcego gigante"
                : "Escalador",
      killerColor:
        causa === "fall" ? "#6a6a72" : causa === "bat" ? "#4b3a63" : "#8a5a3a",
      distance: null,
      c: null,
      v: null,
      cause: causa,
    });
    this.broadcastScores();

    /* Renasce na MENAGEM, e sobe a escada a pé.
     *
     * Os 8 s aqui mais os ~3,5 s de escada são o preço inteiro de morrer neste
     * modo: onze segundos e meio sem um arco no muro. Não há eliminação — o
     * cerco se perde pelo portão, e transformar a derrota coletiva numa
     * eliminação individual seria reescrever o modo zumbi, que já existe. */
    setTimeout(() => {
      /* O BOT TAMBÉM VOLTA — e volta DIRETO PARA O MURO.
       *
       * Esta checagem era `this.players.has(vitima.conn)`, e o bot não tem
       * `conn`: `players.has(null)` é falso, então todo arqueiro de CPU morto
       * por escalador, xamã ou catapulta ficava morto para sempre. A guarnição
       * ia derretendo ao longo da partida sem nada explicando por quê, e por
       * fim o jogador defendia sozinho o modo que o banco de provas diz ser
       * invencível sozinho (`bench-cerco.js`: 0 % com um defensor).
       *
       * Ele não passa pela menagem porque não sabe subir escada: o arqueiro de
       * muralha é `postado` (ver o perfil em `tickBots`) e ficaria de pé no
       * pátio até o fim. Um posto livre do adarve, sorteado, é o renascimento
       * certo — e é o mesmo caminho de quem entra no meio do cerco. */
      const naSala = vitima.isBot
        ? !!this.bots.byId(vitima.id)
        : this.players.has(vitima.conn);
      if (!naSala) return;
      if (!isSiegeMode(this.mode) || this.siege.over) return;
      if (vitima.isBot) {
        vitima.zDownUntil = 0;
        this.postoLivreNoAdarve(vitima);
        return;
      }
      const K = CASTLE.respawn;
      vitima.zDownUntil = 0;
      vitima.alive = true;
      vitima.invulnUntil = this.now() + S.invulnerability * 1000;
      this.stampSpawnState(vitima, K.x, K.z);
      this.broadcastAll({
        t: S2C.SPAWN,
        id: vitima.id,
        x: round(K.x),
        z: round(K.z),
        y: round(this.terrain.heightAt(K.x, K.z)),
        drop: 0,
        invulnUntil: vitima.invulnUntil,
        /* DE FRENTE PARA A ESCADA que ele precisa subir.
         *
         * Nasce-se encostado na porta da menagem, e `yaw: 0` olha para −Z — ou
         * seja, para a parede da própria menagem, a dois metros do nariz. As
         * escadas ficam atrás, e a queixa que veio foi literalmente "não tem
         * escada para subir": elas existem, em x = ±14, e ninguém as via porque
         * o renascimento apontava para o lado oposto. Mirando o pé da escada
         * mais próxima, ela é a primeira coisa no quadro. */
        yaw: faceYaw(K, { x: Math.sign(K.x || 1) * CASTLE.stairX, z: CASTLE.stairZBottom }),
      });
    }, S.respawnDelay * 1000).unref?.();
  }

  /** "Acertei este sitiante." */
  registerSiegeHit(player, msg) {
    if (!isSiegeMode(this.mode) || this.siege.over) return;
    const id = Number(msg.id);
    if (!Number.isFinite(id)) return;

    const pose = player.state?.p;
    const r = this.siege.hit(id, {
      head: msg.head === true,
      from: pose ? { x: pose[0], y: pose[1], z: pose[2] } : null,
    });
    if (!r) return;

    /* Não há mais caminho de "aparou" AQUI: o pavês virou colisor no cliente
       (ver `entities/besieger.js`), e a flecha que bate nele nunca vira um
       `SIEGE_HIT`. Quem decide é o solver de contato, como no resto do jogo. */

    /* O OGRO ENFURECEU. Vai para TODA a sala: o aviso é para quem estava
       mirando noutra coisa, não para quem acabou de acertá-lo. */
    if (r.enfureceu) {
      this.broadcastAll({ t: S2C.SIEGE_SHOT, kind: "rage", to: [r.b.x, r.b.chestY, r.b.z] });
    }
    if (!r.killed) return;

    this.siege.matar(r.b, player.id, this.now());
    const pontos = this.siege.pontos(r.b.kind);
    player.score.points += pontos;
    player.score.kills++;
    /* A alma. Quem desenha a bolinha subindo é o cliente, a partir deste mesmo
       evento; aqui se conta o ponto — e ele só entra na barra quando a bolinha
       CHEGA. O corpo vai junto porque é dele que sai a distância que decide o
       atraso. Ver `addKameCharge` e `systems/souls.js`. */
    this.addKameCharge(player, "besieger", 1, { x: r.b.x, y: r.b.chestY, z: r.b.z });
    this.broadcastAll({
      t: S2C.SIEGE_DEATH,
      id,
      kind: r.b.kind,
      killer: player.id,
      killerName: player.name,
      killerColor: player.color,
      points: pontos,
      head: msg.head === true,
      distance: msg.d ?? 0,
    });
    this.broadcastScores();
  }

  /**
   * "Soltei o trabuco."
   *
   * A sala não simula a pedra — ela confere se o engenho estava carregado,
   * arma a recarga e repassa os parâmetros de disparo. É o mesmo contrato da
   * flecha: quem atira é dono da trajetória, porque a trajetória é função pura
   * de (origem, direção, velocidade) e todo mundo tem a mesma conta.
   */
  registerTrebShot(player, msg) {
    if (!isSiegeMode(this.mode) || this.siege.over) return;
    const t = this.trebuchets[Number(msg.i)];
    if (!t || t.pronto > this.now()) return;
    t.pronto = this.now() + CONFIG.modes.siege.trebuchet.reload * 1000;
    t.wind.clear();
    this.broadcast(
      { t: S2C.TREB_SHOT, owner: player.id, i: t.i, o: msg.o, d: msg.d, v: msg.v },
      player.id,
    );
    this.broadcastTrebuchets();
  }

  /** "A pedra caiu aqui." Quem atirou reporta; a sala decide quem morreu. */
  registerTrebImpact(player, msg) {
    if (!isSiegeMode(this.mode) || this.siege.over) return;
    const p = msg.p;
    if (!Array.isArray(p) || p.length < 3) return;
    const x = Number(p[0]);
    const z = Number(p[2]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;

    const r = this.siege.blast(x, z, player.id);
    const agora = this.now();
    for (const b of r.mortos) {
      this.siege.matar(b, player.id, agora);
      const pontos = this.siege.pontos(b.kind);
      player.score.points += pontos;
      player.score.kills++;
      this.broadcastAll({
        t: S2C.SIEGE_DEATH,
        id: b.id,
        kind: b.kind,
        killer: player.id,
        killerName: player.name,
        killerColor: player.color,
        points: pontos,
      });
    }
    // O estouro e o piche vão para TODAS as telas: a poça queima por 8 s e é
    // informação de jogo, não efeito de quem atirou.
    this.broadcastAll({ t: S2C.TREB_IMPACT, p: [round(x), round(p[1]), round(z)], by: player.id });
    if (r.gate > 0) {
      this.broadcastAll({
        t: S2C.GATE_HIT,
        f: Math.round((this.siege.gateHp / this.siege.gateMax) * 100) / 100,
        own: 1,
      });
    }
    if (r.mortos.length) this.broadcastScores();
  }

  endSiege(reason) {
    const ranking = [...this.players.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        kills: p.score.kills,
        points: p.score.points,
      }))
      .sort((a, b) => b.points - a.points);
    if (reason === "gate") {
      this.broadcastAll({ t: S2C.GATE_FALL });
    }
    this.broadcastSiegeStatus();
    this.broadcastAll({
      t: S2C.SIEGE_OVER,
      reason,
      critical: Math.round(this.siege.criticalTime),
      ranking,
    });
    this.log(`cerco: ${reason === "dusk" ? "o sol se pôs" : "o portão caiu"}`);
  }

  broadcastSiegeStatus() {
    this.broadcastAll({ t: S2C.SIEGE_STATUS, ...this.siege.status() });
  }

  broadcastTrebuchets() {
    const agora = this.now();
    this.broadcastAll({
      t: S2C.TREB_STATE,
      e: this.trebuchets.map((t) => ({
        i: t.i,
        ready: t.pronto <= agora,
        left: Math.max(0, Math.round((t.pronto - agora) / 100) / 10),
        wind: t.wind.size,
      })),
    });
  }

  /* ------------------------------------------------------------- especial -- */

  kameMax() {
    return CONFIG.special.hitsToCharge;
  }

  /**
   * Um acerto encheu um ponto da barra. A SALA é quem conta.
   *
   * @param {number} [vezes] quantos acertos este evento vale. Só o feixe passa
   *   mais de um: ele consome de uma vez a vida que seriam várias flechas, e
   *   cobrar por uma só encolheria a carga que o mesmo estrago dava antes.
   */
  /**
   * "O meu feixe está apoiado no chão aqui."
   *
   * Quem atira é dono da PONTA (ele tem o terreno; a sala não tem malha), e a
   * sala é dona de QUEM MORREU (ela tem a vida de cada bicho). É a mesma
   * divisão da flecha e da pedra de trabuco, e por isso o abate sai pelos mesmos
   * eventos de sempre — `ZOMBIE_DEATH` e `SIEGE_DEATH` — em vez de um canal
   * novo. De graça vêm três coisas: o placar, o `killFeed` e a ALMA, que o
   * cliente desenha a partir desses mesmos eventos.
   *
   * A alma de um abate por feixe NÃO recarrega a barra: `addKameCharge` fica de
   * fora aqui de propósito. Um especial que se paga sozinho é um especial que se
   * usa sempre, e a decisão de quando gastá-lo é o que ele tem de interessante.
   */
  registerKameBlast(player, msg) {
    const S = CONFIG.special;
    if (!specialEnabled(this.mode)) return;
    if (!player.alive) return;
    const p = msg?.p;
    if (!Array.isArray(p) || p.length < 3) return;
    const x = Number(p[0]);
    const z = Number(p[2]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;

    const raio = S.beam.blastRadius;
    const agora = this.now();

    if (isZombieMode(this.mode) && !this.zombies.over) {
      const r = this.zombies.kameBlast(x, z, raio);
      for (const z0 of r.mortos) {
        const boss = z0.kind === "boss";
        const wolf = z0.kind === "wolf";
        this.zombies.kill(z0.id, agora);
        const Z = CONFIG.modes.zombie;
        const pontos = boss ? (Z.boss?.points ?? 500) : wolf ? (Z.wolfPoints ?? 60) : Z.bodyPoints;
        player.score.points += pontos;
        player.score.kills++;
        this.broadcastAll({
          t: S2C.ZOMBIE_DEATH,
          id: z0.id,
          killer: player.id,
          killerName: player.name,
          killerColor: player.color,
          points: pontos,
          head: false,
          wolf,
          boss,
          distance: 0,
        });
      }
      if (r.mortos.length) {
        this.broadcastAll({ t: S2C.ZOMBIES, time: agora, z: this.zombies.view() });
        this.broadcastScores();
      }
      return;
    }

    if (isSiegeMode(this.mode) && !this.siege.over) {
      const r = this.siege.kameBlast(x, z, raio);
      for (const b of r.mortos) {
        this.siege.matar(b, player.id, agora);
        const pontos = this.siege.pontos(b.kind);
        player.score.points += pontos;
        player.score.kills++;
        this.broadcastAll({
          t: S2C.SIEGE_DEATH,
          id: b.id,
          kind: b.kind,
          killer: player.id,
          killerName: player.name,
          killerColor: player.color,
          points: pontos,
          head: false,
          distance: 0,
        });
      }
      if (r.mortos.length) this.broadcastScores();
    }
  }

  /**
   * Um abate encheu um pedaço da barra — DAQUI A ALGUNS SEGUNDOS.
   *
   * O ponto não é creditado na morte, é creditado quando a ALMA CHEGA em quem
   * matou. É a mesma bolinha que o cliente desenha saindo do corpo
   * (`systems/souls.js`), e o atraso é o tempo de voo dela, integrado da mesma
   * curva pelos dois lados da rede (`shared/soulFlight.js`).
   *
   * Por que mexer nisto: a alma existe para ser a confirmação de abate legível
   * de longe, e a barra subindo no instante da morte contava o fim da história
   * antes de a bolinha sair do corpo — a viagem virava enfeite atrasado. Agora
   * a bolinha é a CAUSA do ponto: ela sai, atravessa, encosta, e a barra sobe.
   * Num co-op é informação de verdade — dá para ver quanto especial está a
   * caminho de quem, e não só quanto já chegou.
   *
   * E vale para o BOT sem uma linha a mais: ele não desenha alma nenhuma, mas o
   * atraso é uma conta e não uma animação.
   *
   * @param {object} player quem matou (humano ou bot)
   * @param {string} fonte a chave em `CONFIG.special.chargeSources`
   * @param {number} [vezes] quantos pontos, para as fontes que valem mais de um
   * @param {{x:number,y:number,z:number}|null} [corpo] de onde a alma sai. Sem
   *   ele o ponto é creditado na hora — é o caso de quem não tem posição a
   *   informar, e é melhor um ponto adiantado que um ponto perdido.
   */
  addKameCharge(player, fonte, vezes = 1, corpo = null) {
    const S = CONFIG.special;
    if (!specialEnabled(this.mode)) return;
    const passo = (S.chargeSources[fonte] ?? 0) * Math.max(0, vezes);
    if (!passo) return;

    const voo = corpo ? tempoDeVoo(this.distanciaAte(player, corpo)) : 0;
    if (voo < 0.05) {
      this.creditarKame(player.id, passo);
      return;
    }

    /* A GERAÇÃO é o que impede uma alma de atravessar uma troca de modo. Ela
       está a caminho quando alguém aperta o 5, e quatro segundos depois cairia
       numa partida que não é a dela — enchendo a barra de uma chuva com um
       esqueleto do cerco anterior. `kameGen` muda em toda limpeza de barra
       (ver `resetWorld` e `setMode`), e o ponto atrasado confere antes de somar. */
    const geracao = this.kameGen;
    const id = player.id;
    setTimeout(() => {
      if (geracao !== this.kameGen) return;
      this.creditarKame(id, passo);
    }, voo * 1000).unref?.();
  }

  /** O ponto entrou na barra. Ver `addKameCharge` para por que ele demora. */
  creditarKame(id, passo) {
    if (!specialEnabled(this.mode)) return;
    /* Quem saiu da sala no meio do voo não tem mais barra para encher.
     *
     * POR `playerById` E NÃO POR `players.has`: o mapa `players` é chaveado pela
     * CONEXÃO (`players.set(conn, player)`), não pelo id. `players.has(id)` é
     * portanto SEMPRE falso, e como um humano também não está em `bots.byId`, a
     * guarda descartava em silêncio todo ponto de todo jogador de carne e osso —
     * em todo modo e vindo de qualquer fonte. O bot escapava por ser o único que
     * a segunda metade da condição encontrava, e era isso que fazia o defeito
     * parecer coisa do modo em vez de coisa da chave.
     *
     * É a mesma pegadinha do `players.has(vitima.conn)` anotada no cerco (ver o
     * comentário em `registerSiegeAttack`): o mapa aceita qualquer chave e
     * responde `false` sem reclamar, então errar a chave não dá erro — dá
     * silêncio. `playerById` responde pelos dois tipos de corpo e é a única
     * busca por id que esta sala tem. */
    if (!this.playerById(id)) return;
    const atual = this.kameCharge.get(id) ?? 0;
    if (atual >= this.kameMax()) return;
    const novo = Math.min(this.kameMax(), atual + passo);
    this.kameCharge.set(id, novo);
    this.broadcastAll({ t: S2C.KAME_CHARGE, id, charge: novo, max: this.kameMax() });
  }

  /**
   * Metros entre um jogador (ou bot) e um ponto.
   *
   * Os dois corpos são declarados de modos diferentes — o humano manda pose em
   * `state.p`, o bot tem `position` — e a alma não quer saber de qual dos dois
   * se trata.
   */
  distanciaAte(player, ponto) {
    const p = this.corpoDe(player);
    if (!p || !ponto) return 0;
    return Math.hypot(ponto.x - p.x, (ponto.y ?? p.y) - p.y, ponto.z - p.z);
  }

  /**
   * Onde está o corpo de um jogador ou bot, `null` se ele não declarou pose.
   *
   * Os dois são declarados de modos diferentes — o humano manda pose em
   * `state.p`, o bot tem `position` — e nem a alma nem a distância querem saber
   * de qual dos dois se trata.
   */
  corpoDe(quem) {
    if (quem?.state) {
      return { x: quem.state.p[0], y: quem.state.p[1], z: quem.state.p[2] };
    }
    return quem?.position ?? null;
  }

  broadcastKameCharges() {
    for (const p of this.players.values()) {
      this.broadcastAll({
        t: S2C.KAME_CHARGE,
        id: p.id,
        charge: this.kameCharge.get(p.id) ?? 0,
        max: this.kameMax(),
      });
    }
  }

  /**
   * Alguém soltou o especial.
   *
   * A sala valida (barra cheia, modo certo) e RETRANSMITE. A partir do evento,
   * cada cliente reconstrói a vida inteira do feixe — frente, cauda, afinamento
   * e explosão — porque ela é função pura de (origem, direção, tempo desde o
   * disparo). É o mesmo contrato da flecha, e custa ~60 bytes.
   *
   * Quem decide o que morreu continua sendo quem atirou, pelos canais que já
   * existem (`METEOR_HIT` com `kame`, `KILL` com `cause: "kame"`).
   */
  registerKame(player, msg) {
    const S = CONFIG.special;
    if (!specialEnabled(this.mode)) return;
    if ((this.kameCharge.get(player.id) ?? 0) < this.kameMax()) return;
    if (!Array.isArray(msg.o) || !Array.isArray(msg.d)) return;

    this.kameCharge.set(player.id, 0);
    this.broadcastAll({
      t: S2C.KAME_CHARGE,
      id: player.id,
      charge: 0,
      max: this.kameMax(),
    });
    this.broadcastAll({
      t: S2C.KAME,
      owner: player.id,
      ownerName: player.name,
      o: msg.o,
      d: msg.d,
      w: clampTime(msg.w, this.now()),
    });
    this.log(`${player.name} soltou o especial`);
  }

  /** Uma flecha entrou num zumbi, lobo ou chefão. */
  registerZombieHit(player, msg) {
    if (this.mode === "elkHunt" && !this.elks.over) {
      this.registerElkWolfHit(player, msg);
      return;
    }
    if (!isZombieMode(this.mode) || this.zombies.over) return;
    const id = Number(msg.id);
    if (!Number.isFinite(id)) return;
    const Z = CONFIG.modes.zombie;
    const r = this.zombies.hit(id, msg.head === true, msg.v ?? 0);
    if (!r) return;

    const isWolf = r.zombie.kind === "wolf";
    const isBoss = r.zombie.kind === "boss";

    /* Clarão de impacto do chefão: quem atirou já viu localmente; os outros
       recebem o evento da sala (mesmo padrão do berro do alce em ELK_HIT). */
    if (isBoss) {
      this.broadcast(
        {
          t: S2C.ZOMBIE_HIT,
          id,
          c: Array.isArray(msg.c) ? msg.c : null,
          head: r.head === true,
        },
        player.id,
      );
    }

    if (!r.morreu) {
      if (isBoss) {
        this.broadcastAll({ t: S2C.ZOMBIES, time: this.now(), z: this.zombies.view() });
      }
      return;
    }

    this.zombies.kill(id, this.now());
    let pontos;
    if (isBoss) {
      pontos = Z.boss?.points ?? 500;
      if (r.head) pontos += Z.boss?.headBonusPoints ?? 200;
    } else if (isWolf) {
      pontos = Z.wolfPoints ?? 60;
    } else {
      pontos = r.head ? Z.headPoints : Z.bodyPoints;
    }
    player.score.points += pontos;
    player.score.kills++;
    this.addKameCharge(player, "zombie", 1, r.zombie);

    this.broadcastAll({
      t: S2C.ZOMBIE_DEATH,
      id,
      killer: player.id,
      killerName: player.name,
      killerColor: player.color,
      points: pontos,
      head: isWolf ? false : r.head,
      wolf: isWolf,
      boss: isBoss,
      distance: msg.d ?? 0,
    });
    this.broadcastScores();
  }

  /** Golpe de faca: curto, frontal e instantâneo contra zumbis e lobos. */
  registerKnifeHit(player, msg) {
    if (!player.alive) return;
    if ((player.state?.d ?? 0) > 0.05) return; // ainda está atirando

    const id = Number(msg.id);
    if (!Number.isFinite(id)) return;

    let alvo = null;
    if (isZombieMode(this.mode) && !this.zombies.over) {
      alvo = this.zombies.byId(id);
    } else if (this.mode === "elkHunt" && !this.elks.over) {
      alvo = this.elkWolves.byId(id);
    }
    const pose = Array.isArray(msg.p) ? { p: msg.p, y: msg.y } : null;
    if (!alvo || alvo.dead || !this.knifeCanReach(player, alvo, pose)) return;

    const agora = this.now();
    // Um mesmo alvo não pode receber vários acertos do mesmo golpe. Alvos
    // diferentes ainda podem ser atingidos pela mesma varrida.
    if (player.lastKnifeTarget === id && agora - player.lastKnifeAt < 500) return;
    player.lastKnifeTarget = id;
    player.lastKnifeAt = agora;

    if (isZombieMode(this.mode)) {
      const Z = CONFIG.modes.zombie;
      const isWolf = alvo.kind === "wolf";
      const isBoss = alvo.kind === "boss";
      let morreu = true;
      let head = false;

      if (isBoss) {
        const r = alvo.hit(false);
        morreu = r.morreu;
        head = r.head;
        if (!morreu) {
          this.broadcastAll({ t: S2C.ZOMBIES, time: agora, z: this.zombies.view() });
          return;
        }
      }

      this.zombies.kill(id, agora);
      let pontos;
      if (isBoss) {
        pontos = Z.boss?.points ?? 500;
      } else if (isWolf) {
        pontos = Z.wolfPoints ?? 60;
      } else {
        pontos = Z.bodyPoints ?? 40;
      }
      player.score.points += pontos;
      player.score.kills++;
      this.broadcastAll({
        t: S2C.ZOMBIE_DEATH,
        id,
        killer: player.id,
        killerName: player.name,
        killerColor: player.color,
        points: pontos,
        head: false,
        wolf: isWolf,
        boss: isBoss,
        distance: Number(msg.d) || 0,
        knife: true,
      });
      this.broadcastScores();
      return;
    }

    this.elkWolves.kill(id, agora);
    const pontos = CONFIG.elk.wolfPoints ?? 60;
    player.score.points += pontos;
    player.score.kills++;
    this.broadcastAll({
      t: S2C.ZOMBIE_DEATH,
      id,
      killer: player.id,
      killerName: player.name,
      killerColor: player.color,
      points: pontos,
      head: false,
      wolf: true,
      distance: Number(msg.d) || 0,
      knife: true,
    });
    this.broadcastScores();
  }

  knifeCanReach(player, alvo, pose = null) {
    const state = pose ?? player.state;
    if (!state?.p || state.p.length < 3) return false;

    const dx = alvo.x - state.p[0];
    const dz = alvo.z - state.p[2];
    const distancia = Math.hypot(dx, dz);
    // A posição do bicho já avançou no servidor enquanto o cliente recebia a
    // pose anterior. A folga só vale quando a mensagem traz a pose capturada
    // no instante do golpe; sem ela, permanece a validação estrita.
    const alcance = CONFIG.knife.range + (pose ? 0.45 : 0);
    if (distancia > alcance) return false;
    if (distancia < 0.001) return true;

    const yaw = Number(state.y) || 0;
    const frenteX = -Math.sin(yaw);
    const frenteZ = -Math.cos(yaw);
    const alinhamento = (dx * frenteX + dz * frenteZ) / distancia;
    return alinhamento >= CONFIG.knife.coneCos;
  }

  /** Abate um arqueiro vizinho com a mesma janela curta do golpe animal. */
  registerKnifePlayerHit(player, msg) {
    if (!player.alive || !player.state) return;
    if ((player.state.d ?? 0) > 0.05) return;

    const vitima = this.playerById(Number(msg.victim));
    if (
      !vitima ||
      vitima === player ||
      !vitima.alive ||
      !vitima.state ||
      this.now() < vitima.invulnUntil
    ) {
      return;
    }

    const alvo = { x: vitima.state.p[0], z: vitima.state.p[2] };
    const pose = Array.isArray(msg.p) ? { p: msg.p, y: msg.y } : null;
    if (!this.knifeCanReach(player, alvo, pose)) return;

    const agora = this.now();
    if (
      player.lastKnifePlayerTarget === vitima.id &&
      agora - player.lastKnifePlayerAt < 500
    ) {
      return;
    }
    player.lastKnifePlayerTarget = vitima.id;
    player.lastKnifePlayerAt = agora;

    vitima.alive = false;
    vitima.score.deaths++;
    player.score.kills++;
    this.pontuarTime(vitima, player);

    this.broadcastAll({
      t: S2C.KILL,
      victim: vitima.id,
      victimName: vitima.name,
      victimColor: vitima.color,
      killer: player.id,
      killerName: player.name,
      killerColor: player.color,
      distance: Number(msg.d) || 0,
      c: null,
      v: null,
      cause: "knife",
    });
    this.broadcastScores();

    this.aoMorrer(vitima);
  }

  registerElkWolfHit(player, msg) {
    const id = Number(msg.id);
    if (!Number.isFinite(id)) return;
    const r = this.elkWolves.hit(id);
    if (!r || !r.morreu) return;
    this.elkWolves.kill(id, this.now());
    const pontos = CONFIG.elk.wolfPoints ?? 60;
    player.score.points += pontos;
    player.score.kills++;
    this.broadcastAll({
      t: S2C.ZOMBIE_DEATH,
      id,
      killer: player.id,
      killerName: player.name,
      killerColor: player.color,
      points: pontos,
      head: false,
      wolf: true,
      distance: msg.d ?? 0,
    });
    this.broadcastScores();
  }

  /** Lobo da caçada ao alce matou um jogador. */
  registerWolfKill(victimId) {
    const vitima = this.playerById(victimId);
    if (!vitima || !vitima.alive) return;
    if (this.now() < vitima.invulnUntil) return;

    vitima.alive = false;
    vitima.score.deaths++;

    this.broadcastAll({
      t: S2C.KILL,
      victim: vitima.id,
      victimName: vitima.name,
      victimColor: vitima.color,
      killer: 0,
      killerName: "Lobo",
      killerColor: "#6a5a4a",
      distance: null,
      c: null,
      v: null,
      cause: "wolf",
    });
    this.broadcastScores();

    if (this.mode === "elkHunt" && !this.elks.over) this.downOnElkHunt(vitima);
  }

  /** Uma flecha apagou uma tocha. */
  registerTorchHit(player, msg) {
    if (!isZombieMode(this.mode)) return;
    const i = msg.i | 0;
    if (i < 0 || i >= this.torches.length || !this.torches[i]) return;
    this.torches[i] = false;
    this.broadcastAll({ t: S2C.TORCHES, t4: this.torches, hit: i });
    this.log(`${player.name} apagou a tocha ${i}`);
  }

  zombieStatus() {
    return {
      horde: this.zombies.horde,
      size: this.zombies.horde ? this.zombies.hordeSize(this.zombies.horde) : 0,
      remaining: this.zombies.vivos,
      over: this.zombies.over,
      reason: this.zombies.overReason,
      downs: [...this.players.values()].map((p) => ({
        id: p.id,
        until: p.zDownUntil ?? 0,
      })),
    };
  }

  broadcastZombieStatus() {
    this.broadcastAll({ t: S2C.ZOMBIE_STATUS, ...this.zombieStatus() });
  }

  /** Uma flecha entrou no alce. A vida e a morte são contadas aqui. */
  registerElkHit(player, msg) {
    if (this.mode === "elkHunt" && this.elks.over) return;

    const pos = player.state
      ? { x: player.state.p[0], z: player.state.p[2] }
      : null;
    const r = this.elks.hit(msg.id, player.id, pos, this.playerPositions());
    if (!r) return; // alce já morto, ou id desconhecido

    const E = CONFIG.elk;
    if (!r.elk.fun) {
      player.score.elkHits = (player.score.elkHits ?? 0) + 1;
    }

    if (!r.morreu) {
      if (!r.elk.fun) player.score.points += E.hitPoints;
      this.broadcastAll({
        t: S2C.ELK_HIT,
        id: r.elk.id,
        health: r.elk.health / r.elk.maxHealth,
        killer: player.id,
        // A investida foi quebrada por esta flecha. Vira aviso na tela: sem
        // ele, o bicho girar e sair correndo parece bug de IA, e não a regra
        // funcionando.
        scared: r.assustou ? 1 : 0,
      });
      if (!r.elk.fun) this.broadcastScores();
      return;
    }

    const morto = this.elks.kill(msg.id, this.now());
    if (!morto) return;
    const pontos = morto.fun ? 0 : E.killPoints;
    if (!morto.fun) {
      player.score.elks = (player.score.elks ?? 0) + 1;
      player.score.points += pontos;
      // O alce vale dobrado: são seis flechas e ele revida. Ver `chargeSources`.
      this.addKameCharge(player, "elk", 1, morto);
    }

    this.broadcastAll({
      t: S2C.ELK_DEATH,
      id: morto.id,
      killer: player.id,
      killerName: player.name,
      killerColor: player.color,
      points: pontos,
      fun: morto.fun,
    });
    if (!morto.fun) this.broadcastScores();

    // Vitória da caçada: um alce do modo caiu — a partida acaba.
    if (!morto.fun && this.mode === "elkHunt" && !this.elks.over) {
      this.elks.gameOver("win");
      this.elkWolves.clear();
      this.broadcastAll({ t: S2C.ZOMBIES, z: [], clear: true });
      // Quem ainda esperava respawn volta agora: a caçada acabou, não faz
      // sentido deixar alguém no chão olhando o placar de longe.
      for (const p of this.players.values()) {
        if (!p.alive) {
          p.elkDownUntil = 0;
          this.spawn(p);
        }
      }
      const ranking = [...this.players.values()]
        .map((p) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          elkHits: p.score.elkHits ?? 0,
          finisher: p.id === player.id,
        }))
        .sort((a, b) => {
          // Quem deu o golpe final fica em destaque; depois, por flechas.
          if (a.finisher !== b.finisher) return a.finisher ? -1 : 1;
          return b.elkHits - a.elkHits;
        });
      this.broadcastAll({
        t: S2C.ELK_OVER,
        reason: "win",
        finisher: player.id,
        finisherName: player.name,
        ranking,
      });
      this.broadcastElkStatus();
      this.log(`modo alce: vitória — golpe final de ${player.name}`);
    }
  }

  /** Uma flecha acertou um pássaro. */
  registerBirdHit(player, msg) {
    const ave = this.birds.kill(msg.id, this.now());
    if (!ave) return; // dois acertaram quase junto: o primeiro levou

    const especial = !!ave.special;
    const pontos = especial
      ? CONFIG.modes.birdHunt.special.points
      : CONFIG.birds.points;
    player.score.birds = (player.score.birds ?? 0) + 1;
    player.score.points += pontos;
    this.addKameCharge(player, "bird", 1, ave);

    this.broadcastAll({
      t: S2C.BIRD_DEATH,
      id: ave.id,
      killer: player.id,
      killerName: player.name,
      killerColor: player.color,
      points: pontos,
      distance: msg.d ?? 0,
      special: especial ? 1 : 0,
    });
    this.broadcastScores();

    if (this.mode === "birdHunt" && !this.birdHuntOver && !this.pendingSpecialBirdWin) {
      const meta = CONFIG.modes.birdHunt.birdsToWin;
      if (especial) {
        // Vitória decidida, mas o placar só abre quando o corpo tocar o chão.
        this.pendingSpecialBirdWin = player;
      } else if (player.score.birds >= meta) {
        this.endBirdHunt(player, "count");
      }
    }
  }

  /**
   * Fecha a caça aos pássaros: placar para todos, vencedor em destaque.
   * @param {"count"|"special"} reason
   */
  endBirdHunt(winner, reason) {
    this.birdHuntOver = true;
    const ranking = [...this.players.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        birds: p.score.birds ?? 0,
      }))
      .sort((a, b) => {
        if (a.id === winner.id) return -1;
        if (b.id === winner.id) return 1;
        return b.birds - a.birds;
      });
    this.broadcastAll({
      t: S2C.BIRD_HUNT_OVER,
      reason,
      winner: winner.id,
      ranking,
    });
    this.log(
      reason === "special"
        ? `modo pássaros: vitória de ${winner.name} (ave rara)`
        : `modo pássaros: vitória de ${winner.name} (${winner.score.birds} aves)`,
    );
  }

  registerBoarKill(player, msg) {
    const agora = this.now();
    const porco = this.hunt.kill(msg.id, agora);
    if (!porco) return; // já estava morto: dois acertaram quase junto

    // Porco solto na mão não vale ponto: quem solta escolhe onde, e escolher a
    // distância do próprio alvo esvaziaria a pontuação por distância.
    const pontos = porco.fun ? 0 : boarPoints(msg.d ?? 0);
    if (!porco.fun) {
      player.score.boars++;
      player.score.points += pontos;
    }
    /* O porco solto na mão não vale ponto de placar E não vale barra, pela
       mesma razão: quem solta escolhe onde, e um alvo escolhido pelo próprio
       atirador não é abate, é treino. */
    if (!porco.fun) this.addKameCharge(player, "boar", 1, porco);

    this.broadcastAll({
      t: S2C.BOAR_DEATH,
      id: porco.id,
      killer: player.id,
      killerName: player.name,
      killerColor: player.color,
      points: pontos,
      fun: porco.fun,
      distance: msg.d ?? 0,
    });
    if (!porco.fun) this.broadcastScores();
  }

  /** Milissegundos desde que a sala nasceu. É o relógio de todo mundo. */
  now() {
    return Date.now() - this.epoch;
  }

  get size() {
    return this.players.size;
  }

  /* ------------------------------------------------------------ entrada ---- */

  /**
   * Trata uma mensagem crua de uma conexão.
   *
   * A conexão só vira jogador no `hello`. Antes disso ela existe, mas não ocupa
   * vaga: assim uma aba que abriu e ficou parada na tela de nome não segura
   * lugar de ninguém.
   */
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
      if (msg.t === C2S.HELLO) this.join(conn, msg);
      return;
    }

    player.lastSeen = Date.now();
    this.route(player, msg);
  }

  join(conn, msg) {
    if (msg.version !== PROTOCOL_VERSION) {
      send(conn, {
        t: S2C.REJECT,
        reason: RejectReason.VERSION,
        expected: PROTOCOL_VERSION,
      });
      conn.close();
      return;
    }

    if (this.players.size >= CONFIG.net.maxPlayers) {
      send(conn, {
        t: S2C.REJECT,
        reason: RejectReason.FULL,
        players: this.players.size,
        max: CONFIG.net.maxPlayers,
      });
      conn.close();
      return;
    }

    const player = {
      id: nextPlayerId++,
      conn,
      name: displayName(msg.name, CONFIG.net.nameMaxLength),
      color: this.colors.take(),
      /* O corpo escolhido na tela de entrada.
       *
       * Saneado AQUI e não no cliente, e a razão não é segurança: é que um id
       * desconhecido — de uma aba adiantada, de um cache velho, de alguém
       * brincando no console — faria o boneco daquela pessoa sumir da tela de
       * TODO MUNDO. `sanitizeSkin` troca o desconhecido pelo padrão, e a
       * partida continua com um arqueiro a mais em vez de um buraco. */
      skin: sanitizeSkin(msg.skin),
      score: emptyScore(),
      state: null,
      stateTime: 0,
      alive: true,
      invulnUntil: 0,
      duelReady: false,
      /* Timer de respawn no modo zumbi. */
      zDownUntil: 0,
      lastKnifeAt: -Infinity,
      lastKnifeTarget: null,
      lastKnifePlayerAt: -Infinity,
      lastKnifePlayerTarget: null,
      lastManualRespawn: -Infinity,
      ping: 0,
      lastSeen: Date.now(),
      joinedAt: this.now(),
    };
    this.players.set(conn, player);

    send(conn, {
      t: S2C.WELCOME,
      you: publicView(player),
      time: this.now(),
      max: CONFIG.net.maxPlayers,
      snapshot: this.snapshot(player),
    });
    this.broadcast({ t: S2C.JOIN, player: publicView(player) }, player.id);
    /* ENTRA NO TIME QUE TEM MENOS GENTE, e nasce na base dele.
     *
     * Antes desta linha o novo jogador caía num ponto qualquer do mapa e, no
     * modo antigo, num time decidido por ser humano — as duas coisas erradas ao
     * mesmo tempo: ele nascia longe do que devia defender e sempre do mesmo
     * lado. `escalarNoTime` responde a primeira pergunta e `spawnNaBase` usa a
     * resposta. */
    if (this.mode === "captureFlag" && this.flag.ativo) {
      this.escalarNoTime(player.id);
      this.spawnNaBase(player);
      this.broadcastTeamScores();
    } else {
      this.spawn(player);
    }

    /* CHEGOU NO MEIO DE UMA RODADA DE VIDA ÚNICA: assiste, não joga.
     *
     * `spawn` acabou de pôr um corpo vivo em campo, e num modo em que todo
     * mundo tem uma vida só isso seria um arqueiro inteiro entrando numa briga
     * em que os outros já gastaram a deles — e pior: um arqueiro que não pode
     * ser eliminado, porque não está no conjunto da rodada. Ele entra morto e
     * na PRÓXIMA rodada joga normalmente. O cliente descobre que está
     * assistindo pelo `standStatus` do snapshot, onde o nome dele não aparece. */
    if (this.mode === "lastStand" && this.standAlive.size > 0) {
      player.alive = false;
    }
    if (this.pendingMode) {
      send(conn, {
        t: S2C.MODE_PREPARE,
        mode: this.pendingMode.mode,
        token: this.pendingMode.token,
        ready: this.pendingMode.ready.size,
        total: this.players.size,
      });
    }
    this.broadcastScores();

    /* A PROMESSA DA TELA DE ENTRADA, cumprida agora.
     *
     * Quem clicou "modo zumbi" espera cair na noite, não no campo de tiro com
     * um aviso para apertar 6. A sala esperou até existir alguém porque a horda
     * é dimensionada pelo número de pessoas — montá-la para ninguém daria uma
     * horda de tamanho zero que a primeira chegada teria de refazer.
     *
     * Só na PRIMEIRA entrada: quem chega depois entra na partida como ela está,
     * e reiniciar o modo a cada pessoa que aparece seria reiniciar a noite. */
    if (this.players.size === 1 && this.entryMode !== this.mode) {
      this.requestMode(player, this.entryMode);
    }

    this.log(`entrou: ${player.name} (#${player.id}) — ${this.size} na sala`);
  }

  /**
   * O mundo como está agora, para quem acabou de chegar.
   *
   * É por causa disto que quem entra atrasado vê a partida em andamento em vez
   * de um campo vazio: os outros jogadores, as flechas já cravadas nos alvos, o
   * modo em curso e o placar.
   */
  snapshot(exceto) {
    return {
      // Bots entram na MESMA lista dos humanos: quem chega no meio da partida
      // precisa vê-los tanto quanto vê as pessoas, e o cliente já sabe montar
      // um `RemotePlayer` a partir desta entrada.
      players: this.allCharacters()
        .filter((p) => p !== exceto)
        .map((p) => ({ ...publicView(p), state: p.state })),
      arrows: this.stuckArrows,
      boars: this.hunt.boars.length ? this.hunt.view() : [],
      elks: this.elks.elks.length ? this.elks.view() : [],
      birds:
        isZombieMode(this.mode) || !levelHasFauna(this.level) ? [] : this.birds.view(),
      zombies: this.zombies.zombies.length ? this.zombies.view() : [],
      /* Quem chega no meio de uma chuva pega o bonde andando: a lista de rochas
         e o estado da horda vêm na PRIMEIRA mensagem, e a contagem de entrada
         não reinicia para ninguém (ver `meteorStatus`). */
      // `fullView`, e não `view`: quem chega agora não viu as três primeiras
      // amostras de nenhuma rocha, e é nelas que vão raio, vida e ponto de
      // queda. Ver `FallingMeteor.view`.
      meteors: isMeteorMode(this.mode) ? this.meteors.fullView() : [],
      meteorStatus: isMeteorMode(this.mode) ? this.meteorStatus() : null,
      /* A barra de quem está entrando, EM QUALQUER MODO. Era só na chuva, de
         quando a chuva era o único lugar onde o especial existia — hoje ele
         existe em todos (ver `specialEnabled`), e um retardatário que entrasse
         no cerco via a barra zerada mesmo tendo carga guardada da rodada. */
      kameCharge: specialEnabled(this.mode)
        ? { charge: this.kameCharge.get(exceto?.id) ?? 0, max: this.kameMax() }
        : null,
      torches: this.torches,
      zombieStatus: isZombieMode(this.mode) ? this.zombieStatus() : null,
      elkStatus: this.mode === "elkHunt" ? this.elkStatus() : null,
      /* Quem chega no meio de uma rodada de arena precisa das duas coisas na
         PRIMEIRA mensagem. Sem a bandeira, o objeto que decide a partida
         simplesmente não existiria na tela dele até alguém mexer nela; sem a
         lista de vivos, ele não saberia que está assistindo em vez de jogando —
         e o único jeito de descobrir seria esperar um `SPAWN` que não vem. */
      flag: this.mode === "captureFlag" && this.flag.ativo ? this.flag.view() : null,
      standStatus:
        this.mode === "lastStand"
          ? {
              alive: this.allCharacters()
                .filter((p) => this.standAlive.has(p.id))
                .map((p) => ({ id: p.id, name: p.name, color: p.color })),
              total: this.standTotal ?? 0,
              over: this.standOver,
            }
          : null,
      /* Quem chega no meio de um cerco recebe a horda em JSON, UMA vez.
         O fluxo dela é binário (`packFrame`), mas o instantâneo não pode ser:
         ele vai dentro do `welcome`, que é uma mensagem de texto, e abrir um
         segundo caminho binário para um evento que acontece uma vez por
         sessão seria pagar complexidade sem comprar nada. */
      siege: isSiegeMode(this.mode) ? this.siege.view() : [],
      siegeStatus: isSiegeMode(this.mode) ? this.siege.status() : null,
      // Quem entra no meio já vê os morcegos onde eles estão, e não só no
      // primeiro pacote de 10 Hz — que é o mesmo cuidado do resto do cerco.
      bats: isSiegeMode(this.mode) ? this.morcegos.view() : [],
      trebuchets: isSiegeMode(this.mode)
        ? this.trebuchets.map((t) => ({
            i: t.i,
            ready: t.pronto <= this.now(),
            wind: t.wind.size,
          }))
        : null,
      series: this.series.view(),
      mode: this.modeView(),
      scores: this.scores(),
      teamScores: this.teamScores,
      // A escalação, para quem chega no meio: sem ela o recém-chegado não sabe
      // qual das duas bandeiras é a dele. Ver `broadcastTeamScores`.
      teams: this.temTimes() ? [...this.equipes] : null,
    };
  }

  handleClose(conn) {
    const player = this.players.get(conn);
    if (!player) return;
    this.players.delete(conn);
    this.colors.release(player.color);
    this.duelInvites.delete(player.id);
    /* Manivela e reparo são ESTADOS mantidos pela sala (ver o roteamento de
       `TREB_WIND`), e quem cai da rede nunca manda o "soltei". Sem esta
       limpeza, um trabuco continuaria içando sozinho na velocidade de quem já
       não está lá, e o portão se repararia com a mão de um fantasma. */
    this.repairing.delete(player.id);
    for (const t of this.trebuchets) t.wind.delete(player.id);
    this.saiuDaRodada(player);
    if (this.pendingMode) {
      this.pendingMode.ready.delete(player.id);
      if (this.pendingMode.ready.size >= this.players.size) {
        this.commitPreparedMode(this.pendingMode.token);
      }
    }
    /* O duelo acaba se sobrar menos de dois: uma pessoa duelando sozinha é só
       uma pessoa presa num modo.
       Onde não há convite (a Lua), quem conta são os JOGADORES — `duelInvites`
       está sempre vazia lá, e usá-la encerraria o duelo no instante em que
       começasse. */
    const duelistas = levelUsesDuelInvites(this.level)
      ? this.duelInvites.size
      : this.players.size;
    if (this.mode === "duel" && duelistas < CONFIG.modes.duel.minPlayers) {
      this.setMode("free");
    }
    this.broadcast({ t: S2C.LEAVE, id: player.id, name: player.name });
    this.broadcastScores();
    this.log(`saiu: ${player.name} (#${player.id}) — ${this.size} na sala`);

    /* Sala vazia = mundo zerado, AGORA.
     *
     * A sala sobrevive 30 s ao último jogador (ver `RoomHost`), para que uma
     * queda de rede curta não apague a sessão de quem estava jogando sozinho.
     * O efeito colateral era que quem recarregava a página caía de volta num
     * modo que já tinha acabado — com o alce da partida anterior pastando lá,
     * sem ninguém ter apertado nada. Quem chega numa sala sem gente tem de
     * encontrar o vale como ele começa: modo livre, sem bicho grande, com os
     * pássaros (esses existem sempre). */
    if (this.players.size === 0) {
      // Sem condicionar ao modo: um alce solto com a tecla `L` sobrevive ao
      // modo livre, e ele é justamente o que não pode estar lá quando o
      // próximo jogador entrar.
      this.mode = "free";
      /* O modo da ENTRADA cai junto, e é isso que impede o pior tipo de
         surpresa: sem esta linha, uma sala de zumbi esvaziada continuaria
         "prometendo" a noite, e a próxima pessoa que caísse aqui pela porta do
         vale seria jogada numa horda que não pediu. Quem quiser zumbi de novo
         clica no botão, e a busca de `RoomHost` abre uma sala nova. */
      this.entryMode = "free";
      this.resetWorld();
      this.log("sala vazia: mundo zerado");
    }

    this.onEmpty?.(this);
  }

  /**
   * Derruba quem parou de dar sinal.
   *
   * Sem isto, um navegador fechado à força — sem `close` limpo — seguraria uma
   * vaga para sempre, e numa sala de 12 isso é caro. O cliente manda `ping` a
   * cada `heartbeat` segundos; quem some por `heartbeat × (1 + faltas)` é
   * considerado morto e libera o lugar.
   */
  dropSilentConnections() {
    const limite = CONFIG.net.heartbeat * (1 + CONFIG.net.deadAfterMissed) * 1000;
    const agora = Date.now();
    for (const [conn, player] of [...this.players]) {
      if (agora - player.lastSeen <= limite) continue;
      this.log(`sem sinal: ${player.name} (#${player.id})`);
      this.handleClose(conn);
      try {
        conn.close();
      } catch {
        /* já estava morta */
      }
    }
  }

  /* ------------------------------------------------------------ mensagens -- */

  route(player, msg) {
    switch (msg.t) {
      case C2S.PING:
        // Devolve o relógio do cliente junto: é com ele que o outro lado
        // calcula o RTT e, daí, o desvio entre os dois relógios.
        send(player.conn, { t: S2C.PONG, c: msg.c, s: this.now() });
        if (typeof msg.rtt === "number") player.ping = Math.round(msg.rtt);
        break;

      case C2S.STATE:
        player.state = msg.s;
        /* O carimbo é o do CLIENTE, não o da retransmissão.
         *
         * Carimbar no broadcast parece equivalente e não é: se o remetente
         * engasgar 300 ms e mandar a pose atrasada, ela sai daqui como se
         * fosse de agora, e quem recebe vê o boneco atravessar 1 m em 50 ms —
         * um teleporte. Com o instante da CAPTURA, a interpolação distribui o
         * mesmo movimento pelo tempo real que ele levou.
         *
         * A pinça existe porque o número vem de fora: um relógio adiantado
         * jogaria a pose no futuro e ela ficaria congelada até o tempo chegar. */
        player.stateTime = clampTime(msg.w, this.now());
        break;

      /* Disparo e impacto são REPASSADOS, não julgados.
       *
       * O servidor não tem Rapier, não tem terreno de colisão e não tem como
       * refazer o voo — e nem deveria: refazer significaria esperar a resposta
       * dele para cravar a flecha, que é exatamente o meio ping de atraso que
       * faz um jogo de tiro parecer "grudento". Quem atirou decide, e todo
       * mundo vê o mesmo desfecho. Vale para jogar entre amigos, e o plano diz
       * isso com todas as letras. */
      case C2S.SHOT:
        this.broadcast(
          {
            t: S2C.SHOT,
            owner: player.id,
            ownerEntity: playerEntity(player.id),
            id: msg.id,
            o: msg.o,
            d: msg.d,
            v: msg.v,
            w: clampTime(msg.w, this.now()),
          },
          player.id,
        );
        // O alce do modo pode ver a flecha a caminho e tentar desviar.
        if (this.mode === "elkHunt" && !this.elks.over) {
          this.elks.noticeShot({ o: msg.o, d: msg.d, v: msg.v }, this.now());
        }
        break;

      case C2S.IMPACT: {
        const evento = {
          t: S2C.IMPACT,
          owner: player.id,
          ownerEntity: playerEntity(player.id),
          id: msg.id,
          p: msg.p,
          q: msg.q,
          k: msg.k,
          ti: msg.ti,
          v: msg.v,
          d: msg.d,
        };
        this.broadcast(evento, player.id);
        // Só o que fica cravado no mundo entra no snapshot: bicho e gente se
        // mexem, e uma flecha presa neles não faz sentido para quem chega
        // depois.
        /* Uma flecha caindo perto espanta os porcos ao redor — e levanta os
           pássaros pousados, mesmo quando ela não acertou nada. É o que o
           pedido descreve e o que impede o tiro fácil: errar custa o alvo, e o
           segundo tiro é sempre mais difícil que o primeiro. */
        if (msg.p) {
          if (this.hunt.active) this.hunt.scareNear(msg.p[0], msg.p[2]);
          this.elks.scareNear(msg.p[0], msg.p[2]);
          this.birds.scareNear(msg.p[0], msg.p[2]);
        }

        if (msg.k === "target" || msg.k === "scenery" || msg.k === "terrain") {
          this.stuckArrows.push({
            owner: player.id,
            ownerEntity: playerEntity(player.id),
            id: msg.id,
            p: msg.p,
            q: msg.q,
          });
          const teto = CONFIG.net.snapshotStuckArrows;
          if (this.stuckArrows.length > teto) {
            this.stuckArrows.splice(0, this.stuckArrows.length - teto);
          }
        }
        break;
      }

      case C2S.KILL:
        this.registerKill(player, msg);
        break;

      case C2S.BOT:
        if (msg.remove) this.removeBot();
        else this.addBot();
        break;

      case C2S.SPACE_HIT: {
        /* Quem atira é a autoridade sobre o próprio acerto — o mesmo contrato
           do porco e do zumbi. Mas quem decide se a nave caiu é a sala. */
        const { mortes, eventos } = this.space.registrarAcerto(
          msg.kind,
          msg.id,
          this.playerPositions(),
        );
        for (const ev of eventos) this.broadcastAll({ t: S2C.SPACE_EVENT, ...ev });
        for (const m of mortes) this.matarPeloEspaco(m.vitima, m.causa);
        break;
      }

      case C2S.BOT_DIFFICULTY: {
        /* A perícia é UMA SÓ, da sala — os bots vivem todos aqui. Por isso
           trocá-la vale para todo mundo no mesmo instante, sem sincronizar
           nada: é o significado literal de "em tempo real para todos". */
        const nivel = msg.level
          ? this.bots.setDifficulty(msg.level)
          : this.bots.cycleDifficulty(msg.step === -1 ? -1 : 1);
        this.broadcastAll({ t: S2C.BOT_DIFFICULTY, level: nivel });
        break;
      }

      case C2S.METEOR_DIFFICULTY: {
        /* Grava PRIMEIRO, entra depois: `requestMode` termina em `setMode`, que
           chama `meteors.start()` — e o `start` lê a dificuldade de dentro do
           próprio simulador. Invertida, a ordem faria a primeira chuva sair no
           nível anterior e só a segunda obedecer ao botão. */
        this.meteors.dificuldade = meteorDifficultyOf(msg.level);
        this.log(`chuva de meteoros: ${this.meteors.dificuldade}`);
        /* Sempre pelo caminho normal de entrada no modo, mesmo já estando nele:
           é ele que faz o preparo coordenado, põe todo mundo na linha e começa
           a chuva da horda 1. Trocar de nível no meio de uma horda dimensionada
           pelo nível anterior não daria nenhum dos dois modos. */
        this.requestMode(player, "meteorRain");
        break;
      }

      case C2S.SIEGE_DIFFICULTY: {
        /* Grava PRIMEIRO, entra depois — a mesma ordem (e a mesma armadilha) do
           `METEOR_DIFFICULTY`: `requestMode` termina em `setMode`, que chama
           `siege.start()`, e é o `start` que lê o nível para dimensionar o
           portão e o passo da coluna de abertura. Invertida, a ordem daria o
           primeiro cerco no nível anterior. */
        this.siege.dificuldade = siegeDifficultyOf(msg.level);
        this.log(`cerco: ${this.siege.dificuldade}`);
        this.requestMode(player, "siege");
        break;
      }

      case C2S.MODE:
        this.requestMode(player, msg.mode);
        break;

      case C2S.LEVEL:
        this.requestLevel(player, msg.level);
        break;

      case C2S.MODE_READY: {
        const pending = this.pendingMode;
        if (
          !pending ||
          msg.token !== pending.token ||
          msg.mode !== pending.mode
        ) {
          break;
        }
        pending.ready.add(player.id);
        this.broadcastAll({
          t: S2C.MODE_PREPARE,
          mode: pending.mode,
          token: pending.token,
          ready: pending.ready.size,
          total: this.players.size,
        });
        if (pending.ready.size >= this.players.size) {
          this.commitPreparedMode(pending.token);
        }
        break;
      }

      case C2S.BOAR_HIT:
        this.registerBoarKill(player, msg);
        break;

      case C2S.ELK_HIT:
        this.registerElkHit(player, msg);
        break;

      case C2S.BIRD_HIT:
        this.registerBirdHit(player, msg);
        break;

      case C2S.ZOMBIE_HIT:
        this.registerZombieHit(player, msg);
        break;

      case C2S.METEOR_HIT:
        this.registerMeteorHit(player, msg);
        break;

      case C2S.KAME:
        this.registerKame(player, msg);
        break;

      case C2S.KAME_BLAST:
        this.registerKameBlast(player, msg);
        break;

      /* ATALHO DE TESTE: a barra de quem pediu, cheia. Passa pelo servidor
         porque a barra é dele — ver `C2S.KAME_FILL`. */
      case C2S.KAME_FILL:
        if (!specialEnabled(this.mode)) break;
        this.kameCharge.set(player.id, this.kameMax());
        this.broadcastAll({
          t: S2C.KAME_CHARGE,
          id: player.id,
          charge: this.kameMax(),
          max: this.kameMax(),
        });
        this.log(`${player.name} encheu o especial (atalho de teste)`);
        break;

      /* ---------------------------------------------------------- cerco -- */
      case C2S.BOLT_HIT: {
        /* A flecha estourou a bola de magia no ar.
         *
         * O `boltPop` sai para TODA a sala e não só para quem atirou: quem
         * estava na mira daquela bola precisa saber que ela não vem mais, e
         * essa é a informação mais útil do evento. */
        if (!isSiegeMode(this.mode) || this.siege.over) break;
        const raio = this.siege.cancelarRaio(Number(msg.bid));
        if (!raio) break; // já tinha caído, ou outro arqueiro chegou antes
        this.broadcastAll({
          t: S2C.SIEGE_SHOT,
          kind: "boltPop",
          bid: raio.bid,
          to: [round(raio.x), round(raio.y), round(raio.z)],
        });
        break;
      }

      case C2S.SIEGE_HIT:
        this.registerSiegeHit(player, msg);
        break;

      case C2S.TREB_SHOT:
        this.registerTrebShot(player, msg);
        break;

      case C2S.TREB_IMPACT:
        this.registerTrebImpact(player, msg);
        break;

      /* Manivela e reparo são ESTADOS, não eventos: o cliente manda quando a
         mão entra e quando sai, e a sala guarda o conjunto. Mandar um pulso
         por quadro seria 20 mensagens por segundo para dizer "ainda estou
         aqui" — e um pacote perdido deixaria alguém içando para sempre. */
      case C2S.TREB_WIND: {
        const t = this.trebuchets[Number(msg.i)];
        if (!t) break;
        if (msg.on) t.wind.add(player.id);
        else t.wind.delete(player.id);
        this.broadcastTrebuchets();
        break;
      }

      case C2S.GATE_REPAIR:
        if (msg.on) this.repairing.add(player.id);
        else this.repairing.delete(player.id);
        break;

      case C2S.BAT_HIT: {
        /* "Acertei o morcego." Quem atira é a autoridade sobre o próprio
           acerto — o mesmo contrato da flecha em todo o resto do jogo —, e a
           sala decide o que é compartilhado: se ele caiu e quanto vale. Uma
           flecha basta: é um alvo grande, mas está no ar, em movimento, e o
           tiro é feito com a fila crescendo no portão. */
        if (!isSiegeMode(this.mode) || this.siege.over) break;
        const morcego = this.morcegos.hit(Number(msg.id));
        if (!morcego) break;
        const pontos = CONFIG.modes.siege.bats.points;
        player.score.points += pontos;
        player.score.kills++;
        this.addKameCharge(player, "bat", 1, morcego);
        this.broadcastAll({
          t: S2C.BAT_DEATH,
          id: morcego.id,
          killer: player.id,
          killerName: player.name,
          killerColor: player.color,
          points: pontos,
          p: [round(morcego.x), round(morcego.y), round(morcego.z)],
        });
        this.broadcastScores();
        break;
      }

      case C2S.SIEGE_SKIP: {
        /* ATALHO DE TESTE: adianta o relógio do cerco até um escalão.
           Vale para a SALA — o cerco é um só — e por isso o aviso sai para
           todo mundo: um companheiro que visse a horda mudar de composição
           sozinha acharia que quebrou alguma coisa. */
        if (!isSiegeMode(this.mode) || this.siege.over) break;
        const antes = Math.round(this.siege.t);
        const depois = Math.round(this.siege.pularEscalao(msg.to ?? null));
        if (depois === antes) break;
        this.broadcastSiegeStatus();
        this.log(`cerco adiantado: ${antes}s → ${depois}s`);
        break;
      }

      case C2S.KNIFE_HIT:
        this.registerKnifeHit(player, msg);
        break;

      case C2S.KNIFE_PLAYER_HIT:
        this.registerKnifePlayerHit(player, msg);
        break;

      case C2S.TORCH_HIT:
        this.registerTorchHit(player, msg);
        break;

      case C2S.SPAWN_ELK: {
        const criado = this.elks.spawnOne(this.playerPositions(), true);
        if (criado) {
          this.broadcastAll({
            t: S2C.ELKS,
            time: this.now(),
            e: this.elks.view(),
          });
          this.log(`${player.name} soltou um alce`);
        }
        break;
      }

      case C2S.SPAWN_ELK_WOLVES: {
        if (this.mode !== "elkHunt" || this.elks.over) break;
        const boss = this.elks.bossElk();
        if (!boss) break;
        const n = this.elkWolves.spawnAround(boss, this.players.size);
        if (n) {
          this.broadcastAll({
            t: S2C.ZOMBIES,
            time: this.now(),
            z: this.elkWolves.view(),
          });
          this.log(`${player.name} soltou lobos do alce (${n})`);
        }
        break;
      }

      case C2S.SERIES_HIT:
        this.registerSeriesHit(player, msg);
        break;

      case C2S.WIND:
        // Qualquer um liga/desliga — e vale para a sala inteira.
        this.setWindInfluence(typeof msg.on === "boolean" ? msg.on : !this.windInfluence);
        break;

      case C2S.SPAWN_BOAR: {
        const criados = this.hunt.spawnMany(1, this.playerPositions(), true);
        if (criados.length) {
          this.broadcastAll({
            t: S2C.BOARS,
            time: this.now(),
            b: this.hunt.view(),
          });
          this.log(`${player.name} soltou um porco`);
        }
        break;
      }

      case C2S.RESET_SCORES:
        for (const p of this.players.values()) p.score = emptyScore();
        // Só quem apertou confirmou; os outros recebem o aviso para não acharem
        // que o placar zerou sozinho.
        this.broadcastAll({ t: S2C.SCORES_RESET, by: player.name });
        this.broadcastScores();
        this.log(`${player.name} zerou o placar`);
        break;

      case C2S.RESPAWN: {
        const S = CONFIG.spawn;
        const agora = this.now() / 1000;
        /* NO ÚLTIMO EM PÉ A TECLA K NÃO EXISTE. Ela é a saída de emergência de
           quem ficou preso num canto do mapa; num modo de vida única, seria a
           saída de emergência da própria morte. Quem já caiu continua caído; a
           tecla também não teleporta quem ainda está vivo, porque um botão de
           "sair daqui agora" é grátis demais quando a briga é de vida única. */
        if (this.mode === "lastStand") break;
        // Cooldown para o renascimento manual não virar fuga de duelo.
        if (agora - player.lastManualRespawn < S.manualCooldown) break;
        player.lastManualRespawn = agora;
        this.spawn(player);
        break;
      }

      default:
        break; // as demais chegam nas fases seguintes
    }
  }

  /* ---------------------------------------------------------------- morte -- */

  /**
   * "Matei fulano."
   *
   * Quem atirou é a autoridade — é o que faz o tiro parecer instantâneo em vez
   * de cobrar meio ping de espera. O servidor não recalcula o voo (não teria
   * como: não tem física nem colisor); ele confere o que dá para conferir sem
   * simular, que é o essencial para o jogo não se contradizer:
   *
   *   • a vítima existe, não é você mesmo e ainda está viva;
   *   • ela não está no piscar da invencibilidade;
   *   • o ponto de impacto declarado bate com onde ela estava de fato.
   *
   * A última é a que fecha a porta para "acertei alguém do outro lado do mapa".
   * Não é anti-cheat — é coerência: sem ela, um cliente com bug mataria quem
   * ninguém viu ser atingido.
   */
  registerKill(killer, msg) {
    const vitima = this.playerById(msg.victim);
    /* QUEM ATIRA TAMBÉM PRECISA ESTAR VIVO. Nunca foi um problema enquanto todo
       mundo renascia em quatro segundos, mas no último em pé existe um estado
       novo — morto e ainda conectado, assistindo — e sem esta linha um
       espectador podia declarar abates de dentro da câmera livre. */
    if (!killer?.alive) return;
    if (!vitima || vitima === killer || !vitima.alive) return;
    if (this.now() < vitima.invulnUntil) return;

    if (msg.p && vitima.state) {
      const dx = msg.p[0] - vitima.state.p[0];
      const dy = msg.p[1] - vitima.state.p[1];
      const dz = msg.p[2] - vitima.state.p[2];
      // Generoso de propósito: a vítima é desenhada 100 ms no passado no
      // cliente de quem atirou, e correndo isso já vale quase um metro. A
      // folga cobre o atraso e a altura do corpo; o que ela não cobre é
      // acertar alguém que está longe.
      if (Math.hypot(dx, dy, dz) > CONFIG.net.hitTolerance) return;
    }

    vitima.alive = false;
    vitima.score.deaths++;
    killer.score.kills++;
    this.pontuarTime(vitima, killer);
    /* A alma de quem cai vai para quem o derrubou, como a de qualquer bicho —
       ver `CONFIG.special.chargeSources.player` para por que ela vale mais. */
    this.addKameCharge(killer, "player", 1, this.corpoDe(vitima));

    this.broadcastAll({
      t: S2C.KILL,
      victim: vitima.id,
      victimName: vitima.name,
      killer: killer.id,
      killerName: killer.name,
      killerColor: killer.color,
      victimColor: vitima.color,
      distance: msg.d ?? null,
      // Repassados sem julgamento: são a entrada do corpo mole na tela de todo
      // mundo. Ver `game/ragdoll.js` para por que eles precisam trafegar.
      c: msg.c ?? null,
      v: msg.v ?? null,
      cause: "arrow",
    });
    this.broadcastScores();

    this.aoMorrer(vitima);
  }

  /**
   * Quem tem este id — humano OU bot.
   *
   * É por aqui que `registerKill` encontra a vítima, e é o que faz a flecha de
   * um humano matar um bot pelo caminho normal, sem nenhum caso especial.
   */
  playerById(id) {
    for (const p of this.players.values()) if (p.id === id) return p;
    return this.bots.byId(id);
  }

  /* --------------------------------------------------------------- nascer -- */

  /**
   * Manda alguém nascer.
   *
   * O mesmo caminho serve para entrar na sala e para renascer depois de morrer:
   * um ponto plano perto do centro, longe de quem já está lá, e a queda de 10 m
   * com invencibilidade piscando. Quem morreu e quem chegou entram igual — é o
   * que deixa explícito, para quem está vendo, que aquilo ali é um renascimento.
   */
  spawn(player, forcado = null) {
    /* QUEM CHEGA NO MEIO DE UM CERCO VAI PARA O ADARVE.
     *
     * `lineUpForSiege` só roda na TROCA de modo, e quem entra numa sala que já
     * está em cerco nunca passa por ela — ele caía no sorteio comum e nascia
     * no pátio, a onze metros abaixo do jogo, sem nada explicando por quê. O
     * caminho de renascer depois de morrer tem o próprio destino (a menagem,
     * em `registerSiegeAttack`); este aqui é o de ENTRAR. */
    if (isSiegeMode(this.mode) && !this.siege.over && !forcado) {
      this.postoLivreNoAdarve(player);
      return;
    }

    const ocupados = this.allCharacters()
      .filter((p) => p !== player && p.state)
      .map((p) => ({ x: p.state.p[0], z: p.state.p[2] }));

    /* Na chuva, volta-se para o ANEL DA BASE, não para um ponto sorteado na
       arena inteira. Renascer a 140 m da base seria renascer fora do jogo: o
       céu que importa é o de cima da base, e a caminhada de volta custaria mais
       tempo do que a própria morte. */
    const ponto = forcado
      ? { x: forcado.x, z: forcado.z, y: this.terrain.heightAt(forcado.x, forcado.z) }
      : isMeteorMode(this.mode)
        ? this.meteorSpawnPoint()
        : pickSpawnPoint(this.terrain, ocupados);
    /* No último em pé a proteção é CURTA. Quatro segundos piscando num modo de
       vida única dão para atravessar meia arena imune, e o modo é justamente
       sobre não poder atravessar nada impunemente. */
    const protecao =
      this.mode === "lastStand"
        ? CONFIG.modes.lastStand.invulnerability
        : CONFIG.spawn.invulnerability;
    const invulnUntil = this.now() + protecao * 1000;
    player.alive = true;
    player.invulnUntil = invulnUntil;
    /* O bot não recebe `S2C.SPAWN` — ele não tem cliente para obedecer a ela.
       Quem o move é a própria IA, então o nascimento é escrito direto no corpo.
       A mensagem sai mesmo assim, logo abaixo: é ela que faz as OUTRAS telas
       porem o boneco no lugar novo. */
    if (player.isBot) player.renascer(ponto.x, ponto.z);
    this.stampSpawnState(player, ponto.x, ponto.z);

    // Na caçada, voltar à vida também é voltar a encarar o bicho: o ponto de
    // renascimento é sorteado no vale inteiro, e sem isso a pessoa reaparece
    // olhando para qualquer lado enquanto o alce vem.
    const alce = this.mode === "elkHunt" ? this.elks.bossElk() : null;
    const yaw = alce ? faceYaw(ponto, alce) : null;
    if (yaw != null && player.state) player.state.y = round(yaw);

    this.broadcastAll({
      t: S2C.SPAWN,
      id: player.id,
      x: round(ponto.x),
      z: round(ponto.z),
      y: round(ponto.y),
      ...(yaw != null ? { yaw: round(yaw) } : {}),
      drop: this.spawnDrop(),
      invulnUntil,
    });
  }

  /**
   * O posto de adarve mais VAZIO, para quem entra no meio do cerco.
   *
   * "Mais vazio" e não "o primeiro": com sete postos e três defensores, pegar
   * sempre o primeiro empilharia todo mundo sobre o portão e deixaria os
   * bastiões — onde estão dois dos três trabucos — sem ninguém.
   */
  postoLivreNoAdarve(player) {
    const S = CONFIG.modes.siege;
    const outros = this.allCharacters()
      .filter((p) => p !== player && p.state)
      .map((p) => ({ x: p.state.p[0], z: p.state.p[2] }));

    /* SORTEADO ENTRE OS VAZIOS, não o mais vazio.
     *
     * O critério de folga sozinho é DETERMINÍSTICO: com um bot morrendo e
     * voltando, ele recai sempre no mesmo posto — e num muro de 34 m com oito
     * postos, "sempre o mesmo ponto" é o oposto do que uma guarnição parece.
     * Sorteando entre os que estão razoavelmente livres (75 % da melhor folga
     * ou mais), a distribuição continua evitando aglomeração e para de ser
     * previsível. */
    const postos = walkwayPosts().map((posto) => {
      let folga = Infinity;
      for (const o of outros) {
        folga = Math.min(folga, Math.hypot(o.x - posto.x, o.z - posto.z));
      }
      return { posto, folga };
    });
    const melhorFolga = Math.max(...postos.map((p) => p.folga));
    const bons = postos.filter((p) => p.folga >= melhorFolga * 0.75);
    const melhor = (bons.length ? bons : postos)[
      Math.floor(Math.random() * (bons.length || postos.length))
    ].posto;

    const gate = gateInfo();
    const invulnUntil = this.now() + S.invulnerability * 1000;
    player.alive = true;
    player.invulnUntil = invulnUntil;
    if (player.isBot) player.renascer(melhor.x, melhor.z, melhor.y);
    this.stampSpawnState(player, melhor.x, melhor.z);
    this.broadcastAll({
      t: S2C.SPAWN,
      id: player.id,
      x: round(melhor.x),
      z: round(melhor.z),
      // A cota é a do MURO. `heightAt` responderia 14 m — o pátio — e o
      // jogador nasceria dentro da alvenaria.
      y: round(melhor.y),
      drop: 0,
      invulnUntil,
      // Ver `lineUpForSiege`: `faceYaw` e não a conta à mão, que apontava ao
      // contrário. Quem renasce sob pressão é quem menos pode perder um segundo
      // procurando a rampa.
      yaw: faceYaw(melhor, { x: gate.x, z: gate.standZ + 40 }),
    });
  }

  /** Um ponto do anel de defesa, para quem volta no meio de uma chuva. */
  meteorSpawnPoint() {
    const M = CONFIG.modes.meteorRain;
    const base = CONFIG.levels.moon.base;
    const ang = Math.random() * Math.PI * 2;
    const raio = M.spawnRingMin + Math.random() * (M.spawnRingMax - M.spawnRingMin);
    const x = base.x + Math.sin(ang) * raio;
    const z = base.z + Math.cos(ang) * raio;
    return { x, z, y: this.terrain.heightAt(x, z) };
  }

  /**
   * De que altura se nasce, aqui e agora.
   *
   * Duas regras, e as duas existem pelo mesmo motivo — o tempo pendurado no ar
   * é tempo de ser alvo:
   *
   * • a NOITE DOS ZUMBIS entra no chão, sem queda: a horda já está lá;
   * • a LUA cai de um metro, porque em 1/6 de g os 10 m do vale viram 3,5 s de
   *   queda sem controle, à vista de todo mundo (ver `moon.spawnDrop`).
   *
   * Estava escrito em quatro lugares, e por isso a Lua herdava os 10 m do vale
   * nos quatro.
   */
  spawnDrop() {
    if (isZombieMode(this.mode)) return 0;
    return levelSpawnDrop(this.level);
  }

  /* --------------------------------------------------------------- placar -- */

  scores() {
    return this.allCharacters().map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      ping: p.ping ?? 0,
      // O placar marca quem é CPU: um "CPU 2" liderando é informação diferente
      // de um humano liderando, e a tela merece poder mostrar isso.
      isBot: p.isBot === true,
      ...p.score,
    }));
  }

  broadcastScores() {
    this.broadcastAll({ t: S2C.SCORES, scores: this.scores() });
  }

  broadcastTeamScores() {
    /* A ESCALAÇÃO VIAJA JUNTO, e por evento em vez de a 10 Hz.
     *
     * O cliente precisa dela para uma coisa só, e ela é a mais importante da
     * tela: saber se aquela bandeira azul é a SUA. Com humanos de um lado e CPU
     * do outro isso se deduzia de `isBot`; com times mistos, não se deduz de
     * nada — tem de ser dito.
     *
     * E é dito aqui porque a escalação só muda quando alguém entra, sai ou o
     * modo recomeça — os mesmos instantes em que este placar muda. Pendurá-la na
     * amostra da bandeira custaria a lista inteira dez vezes por segundo para
     * repetir o que ninguém mudou. */
    this.broadcastAll({
      t: S2C.TEAM_SCORES,
      ...this.teamScores,
      teams: this.temTimes() ? [...this.equipes] : null,
    });
  }

  /**
   * Um abate marcou ponto para um time.
   *
   * Um lugar só, chamado pelos três caminhos de morte (flecha de humano, flecha
   * de bot e faca). Repare que não há nada a CONFERIR: o servidor é dono das
   * duas pontas, então o placar é um fato, não uma declaração de cliente. Era
   * essa a diferença que faltava — com bots locais, este número teria de vir
   * por confiança.
   *
   * SÓ PONTUA QUEM MATA O TIME CONTRÁRIO. Sem esta checagem, dois bots se
   * acertando marcavam ponto para os humanos, e o placar abria 2 × 0 antes de
   * qualquer pessoa atirar — foi exatamente o que aconteceu no primeiro teste.
   * Fogo amigo não é ponto de ninguém, dos dois lados.
   *
   * A morte causada pela Lua (alien, explosão) também não conta: não é o outro
   * time que matou, é o cenário.
   */
  pontuarTime(vitima, matador) {
    if (this.mode !== "teamDuel") return;
    if (!matador) return;
    const mesmoTime = !!vitima.isBot === !!matador.isBot;
    if (mesmoTime) return;
    this.teamScores[vitima.isBot ? "humans" : "bots"]++;
    this.broadcastTeamScores();
  }

  /**
   * Renasce todo mundo nos pontos padrão do vale.
   *
   * Usado ao entrar no modo livre e na caçada aos porcos — modos que não têm
   * uma linha de tiro própria, mas ainda precisam do piscar + queda para quem
   * estava morto ou longe.
   */
  respawnEveryone() {
    for (const p of this.players.values()) this.spawn(p);
  }

  /**
   * Grava a pose de spawn no estado do jogador.
   *
   * Sem isso, `playerPositions()` ainda devolveria a pose ANTIGA nos 50 ms
   * seguintes ao teleporte — e a caçada / o alce nasceriam em cima de onde a
   * pessoa ESTAVA, não de onde ela está agora.
   */
  stampSpawnState(player, x, z) {
    const y = this.terrain.heightAt(x, z);
    player.state = {
      p: [round(x), round(y), round(z)],
      y: 0,
      i: 0,
      g: 0,
      b: 0,
      r: 0,
      d: 0,
      f: 0,
      s: 0,
      a: 1,
    };
    player.stateTime = this.now();
  }

  /**
   * Liga/desliga a influência do vento na flecha para a SALA INTEIRA.
   *
   * `silent` evita o toast quando a sala muda o padrão sozinha (entrar/sair
   * do modo zumbi). Quem aperta V sempre vê o aviso.
   */
  setWindInfluence(on, { silent = false } = {}) {
    const ligado = !!on;
    if (this.windInfluence === ligado && silent) return;
    this.windInfluence = ligado;
    this.broadcastAll({ t: S2C.WIND, on: ligado, silent: !!silent });
  }

  modeView() {
    return {
      mode: this.mode,
      level: this.level,
      /* QUEM ESTÁ EM CAMPO, por extenso.
       *
       * O cliente monta a lista de bonecos a partir de `JOIN`/`LEAVE`, que são
       * avulsos e dependem de chegar tudo, na ordem, e nada se perder. Na troca
       * de fase isso é justamente o que não se pode assumir: o mundo do cliente
       * é demolido e reconstruído no meio da conversa, e um `LEAVE` de bot que
       * caia nessa janela deixava um adversário de CPU **parado para sempre** na
       * fase nova — um boneco sem dono, que ninguém mais atualiza.
       *
       * Esta lista fecha a questão de uma vez: ela vem junto com a fase e com o
       * modo, e o cliente RECONCILIA (`applyMode`) em vez de acreditar num
       * histórico de mensagens. São poucas dezenas de bytes num evento raro. */
      roster: this.allCharacters().map(publicView),
      // Quem quer duelar, com nome: é o que a sala vê como convite na tela.
      invites: [...this.players.values()]
        .filter((p) => p.duelReady)
        .map((p) => ({ id: p.id, name: p.name })),
      needed: CONFIG.modes.duel.minPlayers,
      windInfluence: this.windInfluence,
      preparing: this.pendingMode
        ? {
            mode: this.pendingMode.mode,
            level: this.pendingMode.level,
            token: this.pendingMode.token,
            ready: this.pendingMode.ready.size,
            total: this.players.size,
          }
        : null,
    };
  }

  /* --------------------------------------------------------------- envio --- */

  /**
   * Poses de todos, numa mensagem só.
   *
   * O corte é "há mais de um CORPO em campo", e não mais de um socket: um
   * humano sozinho com três bots precisa das poses tanto quanto dois humanos
   * precisam. Com o teste antigo (`players.size < 2`) o bot existia, andava e
   * atirava — e ficava congelado no ponto de nascimento na tela de quem jogava
   * sozinho, que é o caso mais comum de todos.
   */
  broadcastStates() {
    if (!this.players.size) return;
    if (this.players.size + this.bots.count < 2) return;
    const s = [];
    for (const p of this.players.values()) {
      // `w` = quando o dono capturou a pose. É esse instante que a interpolação
      // do outro lado usa, e não o da retransmissão.
      if (p.state) s.push({ id: p.id, w: p.stateTime, ...p.state });
    }
    for (const b of this.bots.list) {
      if (b.state) s.push({ id: b.id, w: b.stateTime, ...b.state });
    }
    if (!s.length) return;
    this.broadcastAll({ t: S2C.STATES, time: this.now(), s });
  }

  /** Para todos menos `exceto` (por id). */
  broadcast(msg, exceto = null) {
    const data = JSON.stringify(msg);
    for (const player of this.players.values()) {
      if (player.id === exceto) continue;
      raw(player.conn, data);
    }
  }

  broadcastAll(msg) {
    this.broadcast(msg, null);
  }

  /**
   * Manda um quadro BINÁRIO para todo mundo.
   *
   * O único caminho do jogo que não passa por `JSON.stringify`, e ele existe
   * por uma conta: 120 sitiantes em JSON a 10 Hz para quatro clientes são
   * 380 KB/s de subida. Ver `Siege.packFrame`.
   *
   * A conexão é a mesma abstração de sempre (`send(dados)`) — o adaptador de
   * WebSocket já aceita `Buffer` sem saber que isto é diferente.
   */
  broadcastFrame(buffer) {
    for (const player of this.players.values()) player.conn.send(buffer);
  }

  destroy() {
    clearInterval(this.stateTimer);
    clearInterval(this.sweepTimer);
    clearInterval(this.boarTimer);
    clearInterval(this.botTimer);
    if (this.pendingMode) clearTimeout(this.pendingMode.timer);
    this.pendingMode = null;
    this.hunt.stop();
    this.elks.stop();
    this.players.clear();
  }
}

/* ------------------------------------------------------------- ciclo de vida */

/**
 * As salas: cria quando alguém entra, destrói quando o último sai.
 *
 * Enquanto ninguém joga, o processo não tem timer rodando, nem porco andando,
 * nem estado ocupando memória — o servidor fica em zero de verdade. A carência
 * existe para que uma queda de rede de cinco segundos não apague a sessão de
 * quem estava jogando sozinho.
 *
 * ------------------------------------------------------------- por que várias
 *
 * Havia UMA sala, e a fase era dela: quem apertasse 9 levava todo mundo junto.
 * Isso funciona enquanto a tela de entrada é uma só — e ela deixou de ser. Com
 * "Vale Verde", "Lua", "Zumbi" e "Zumbi com chefão" na porta, uma sala só faria
 * a última escolha ganhar de todas as outras: quem clicasse na Lua arrastaria
 * para lá quem estava caçando porco, e quem entrasse no zumbi transformaria a
 * tarde de tiro ao alvo dos outros em noite de horda.
 *
 * Cada botão vira, então, um LUGAR: quem escolhe a Lua encontra quem está na
 * Lua. As salas são procuradas pelo que elas são AGORA (`level` + `mode`), e
 * não pelo que foram ao nascer — assim a tecla 9 continua funcionando por
 * dentro, e a sala que viajou para a Lua passa a receber quem clica em "Lua".
 */
export class RoomHost {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    /** @type {Set<Room>} */
    this.rooms = new Set();
    /** @type {Map<object, Room>} conexão → a sala dela */
    this.byConn = new Map();
    /** @type {Map<Room, NodeJS.Timeout>} carências de sala vazia */
    this.grace = new Map();
  }

  /**
   * A sala para esta entrada, criando-a se ainda não existir.
   *
   * A busca casa fase E modo, e ignora sala cheia: entrar numa sala lotada é
   * recusado lá dentro (`join`), e o que se quer aqui é achar o LUGAR certo.
   */
  ensure({ level = DEFAULT_LEVEL, mode = "free" } = {}) {
    const fase = LEVEL_IDS.includes(level) ? level : DEFAULT_LEVEL;
    const modo = fallbackMode(fase, mode);

    for (const room of this.rooms) {
      if (room.level !== fase || room.mode !== modo) continue;
      if (room.players.size >= CONFIG.net.maxPlayers) continue;
      this.cancelTeardown(room);
      return room;
    }

    const room = new Room({ log: this.log, level: fase, mode: modo });
    room.onEmpty = (r) => this.scheduleTeardown(r);
    this.rooms.add(room);
    this.log(`sala criada — ${fase} / ${modo} (${this.rooms.size} no ar)`);
    return room;
  }

  /** Quantas salas existem agora. Útil no log e em teste. */
  get size() {
    return this.rooms.size;
  }

  /**
   * Quem está jogando o quê, agora — para a TELA DE ENTRADA.
   *
   * O lobby é uma lista de portas iguais entre si, e a pergunta que a pessoa faz
   * antes de clicar é sempre a mesma: "tem alguém lá?". Sem resposta, escolher
   * porta é sortear, e numa sala de amigos o normal é acabar todo mundo em
   * lugares diferentes achando que está sozinho.
   *
   * O que sai daqui é o MÍNIMO que responde isso: fase, modo e quantos. Nada de
   * nomes — a tela de entrada é pública (o site abre para qualquer um; a chave
   * guarda a SALA, não a página), e quem está jogando não pediu para ter o nome
   * listado para estranhos. Contagem não identifica ninguém.
   *
   * Os bots vão num campo separado em vez de somados: "3 jogando" quando são
   * dois bots e uma pessoa seria uma mentira, e é justamente a mentira que faz
   * alguém clicar.
   */
  publicStatus() {
    const salas = [];
    for (const room of this.rooms) {
      if (!room.players.size) continue; // sala em carência é sala vazia
      salas.push({
        level: room.level,
        mode: room.mode,
        players: room.players.size,
        bots: room.bots.count,
      });
    }
    return { rooms: salas };
  }

  cancelTeardown(room) {
    const timer = this.grace.get(room);
    if (!timer) return;
    clearTimeout(timer);
    this.grace.delete(room);
  }

  scheduleTeardown(room) {
    if (room.players.size > 0 || this.grace.has(room)) return;
    const timer = setTimeout(() => {
      this.grace.delete(room);
      if (room.players.size > 0) return;
      room.destroy();
      this.rooms.delete(room);
      this.log(`sala destruída (${room.level}) — ${this.rooms.size} restantes`);
    }, CONFIG.net.emptyRoomGrace * 1000);
    this.grace.set(room, timer);
  }

  /* --- ponte para o adaptador de transporte --------------------------------- */

  handleMessage(conn, data) {
    const sala = this.byConn.get(conn);
    /* Sala JÁ DESTRUÍDA com a conexão ainda de pé é o caso raro que não pode
       terminar mal: os timers dela foram parados, e falar com ela seria falar
       com um mundo que não anda mais. A conexão volta a ser nova e escolhe uma
       sala viva no `hello` seguinte. */
    if (sala && this.rooms.has(sala)) {
      sala.handleMessage(conn, data);
      return;
    }
    this.byConn.delete(conn);

    /* Conexão ainda sem sala. É o `hello` que decide em qual ela entra — e é
       só dele que se lê a entrada escolhida. Qualquer outra mensagem aqui é de
       alguém que ficou para trás numa sala destruída; ela cai na entrada padrão
       e a vida segue, que é o que acontecia quando a sala era uma só. */
    let msg = null;
    try {
      msg = JSON.parse(data);
    } catch {
      return; // lixo na linha: ignora em silêncio
    }

    const nova = this.ensure({ level: msg?.level, mode: msg?.mode });
    this.byConn.set(conn, nova);
    nova.handleMessage(conn, data);

    // Recusado (versão velha, sala cheia): a conexão não virou jogador, e
    // guardá-la vazaria uma entrada do mapa a cada tentativa.
    if (!nova.players.has(conn)) this.byConn.delete(conn);
  }

  handleClose(conn) {
    const sala = this.byConn.get(conn);
    this.byConn.delete(conn);
    sala?.handleClose(conn);
  }
}

/* ------------------------------------------------------------------ auxiliares */

/**
 * O placar zerado, num lugar só.
 *
 * Estava escrito duas vezes — na entrada e no zeramento — e as duas cópias já
 * tinham divergido: quem zerava o placar perdia a coluna de alvos, que sumia da
 * tabela até a pessoa reentrar na sala.
 */
function emptyScore() {
  return {
    kills: 0, deaths: 0, boars: 0, elks: 0, elkHits: 0, birds: 0, targets: 0, points: 0,
    // Chuva de meteoros: rochas destruídas e flechas que conectaram. As duas
    // juntas dão a precisão, que é o placar honesto de um modo cooperativo em
    // que a métrica é economia de flecha.
    rocks: 0, shots: 0,
    // Rouba bandeira: entregas. É por ela que o placar final ordena, e não por
    // abates — num modo de bandeira quem corre com ela é quem ganhou a partida.
    captures: 0,
  };
}

/**
 * O que a sala conta sobre alguém para os outros.
 *
 * Passa no `WELCOME`, no `JOIN`, no `snapshot` de quem chega atrasado e no
 * `roster` — os quatro caminhos por onde um corpo aparece na tela alheia. A
 * skin entra aqui, junto do nome e da cor, porque é exatamente da mesma
 * natureza: um dado por PESSOA, que não muda durante a partida e que todo mundo
 * precisa saber para desenhá-la.
 */
function publicView(p) {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    skin: sanitizeSkin(p.skin),
    isBot: p.isBot === true,
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

const round = (v) => Math.round(v * 1000) / 1000;

/**
 * Yaw da arqueira para encarar um ponto.
 *
 * A convenção do corpo é a do cliente: yaw 0 olha para −Z, e a frente é
 * (−sen yaw, −cos yaw). Daí o sinal invertido — não é engano de conta, é a
 * mesma fórmula que `Player.setAim` desfaz do outro lado.
 */
function faceYaw(de, para) {
  const dx = para.x - de.x;
  const dz = para.z - de.z;
  if (Math.hypot(dx, dz) < 1e-4) return 0;
  return Math.atan2(-dx, -dz);
}

/**
 * Prende um instante vindo do cliente a uma janela plausível em torno de agora.
 *
 * Um relógio adiantado jogaria a pose no futuro e ela ficaria congelada até o
 * tempo alcançá-la; um atrasado demais a colocaria antes do buffer de todo
 * mundo e ela seria descartada. A janela é generosa — meio segundo para trás
 * cobre qualquer engasgo honesto — e o teto é curto porque o futuro não tem
 * desculpa.
 */
function clampTime(t, agora) {
  if (typeof t !== "number" || !Number.isFinite(t)) return agora;
  return Math.min(agora + 100, Math.max(agora - 500, t));
}
