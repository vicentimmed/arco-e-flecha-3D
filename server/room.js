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

import { CONFIG } from "../src/config.js";
import { TerrainField, pathCenterX } from "../src/shared/terrainField.js";

function isZombieMode(mode) {
  return mode === "zombie" || mode === "zombieBoss";
}
import {
  C2S,
  S2C,
  PROTOCOL_VERSION,
  RejectReason,
  displayName,
  playerEntity,
} from "../src/shared/protocol.js";
import { ColorPool } from "./colors.js";
import { pickSpawnPoint, duelPositions, elkHuntPositions } from "./spawnPoints.js";
import { BoarHunt, boarPoints } from "./boarSim.js";
import { ElkHunt } from "./elkSim.js";
import { ElkWolfPack } from "./elkWolves.js";
import { BirdFlock } from "./birdSim.js";
import { ZombieNight } from "./zombieSim.js";
import { TargetSeries } from "./targetSeries.js";

let nextPlayerId = 1;

export class Room {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.epoch = Date.now();
    this.terrain = new TerrainField();
    this.colors = new ColorPool();

    /** @type {Map<object, object>} conexão → jogador */
    this.players = new Map();
    this.mode = "free";

    /**
     * Flechas já cravadas no cenário e nos alvos.
     *
     * O servidor não simula flecha nenhuma — guarda só a pose final que o dono
     * reportou, para entregar a quem chegar depois. É o que faz quem entra
     * atrasado ver o campo de tiro como ele está, com as flechas nos alvos, em
     * vez de um cenário limpo que ninguém mais está vendo.
     */
    this.stuckArrows = [];

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
  requestMode(player, modo) {
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
      modo === "zombieBoss"
    ) {
      this.setMode(modo);
      return;
    }

    if (modo === "free") {
      // Sair do duelo: some da lista, e se sobrar menos de dois a partida acaba.
      this.duelInvites.delete(player.id);
      player.duelReady = false;
      this.setMode("free");
      return;
    }

    if (modo !== "duel") return;

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
   */
  setMode(modo) {
    const anterior = this.mode;
    this.mode = modo;

    this.resetWorld();

    /* Em todo modo, ao entrar: todo mundo renasce piscando, em pé, e cai no
       chão. Sem isso, quem estava morto ou deitado no ragdoll entraria no modo
       novo ainda caindo — e quem estava longe do ponto certo do modo (linha de
       tiro, quadrado de luz) começaria desnorteado. */
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
    } else if (modo === "duel") {
      this.startDuel();
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
    this.hunt.stop();
    this.hunt.boars = [];
    this.elks.stop();
    this.elks.elks = [];
    this.elkWolves.clear();
    this.birdHuntOver = false;
    this.pendingSpecialBirdWin = null;
    this.birds.reset();
    this.zombies.stop();
    // As tochas voltam acesas: a partida seguinte não herda o escuro que a
    // anterior produziu.
    this.torches = [true, true, true, true];
    this.series.stop();
    this.stuckArrows = [];
    for (const p of this.players.values()) p.score = emptyScore();

    this.broadcastAll({ t: S2C.BOARS, b: [], clear: true });
    this.broadcastAll({ t: S2C.ELKS, e: [], clear: true });
    this.broadcastAll({ t: S2C.ZOMBIES, z: [], clear: true });
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
        drop: CONFIG.spawn.dropHeight,
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
        drop: CONFIG.spawn.dropHeight,
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
  startDuel() {
    const participantes = [...this.players.values()].filter((p) =>
      this.duelInvites.has(p.id),
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
        drop: CONFIG.spawn.dropHeight,
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
  playerPositions() {
    return [...this.players.values()]
      .filter((p) => p.state)
      .map((p) => ({
        id: p.id,
        alive: p.alive,
        x: p.state.p[0],
        y: p.state.p[1],
        z: p.state.p[2],
      }));
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

    /* Os pássaros somem no modo zumbi. Não é economia — é o clima: um bando
       cantando e circulando sobre um cerco de mortos-vivos desmancha a noite
       que o modo inteiro constrói. */
    if (!isZombieMode(this.mode)) {
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

    const espera = (CONFIG.spawn.deathDuration + CONFIG.spawn.respawnDelay) * 1000;
    setTimeout(() => {
      if (this.players.has(vitima.conn)) this.spawn(vitima);
    }, espera).unref?.();
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

    const espera = (CONFIG.spawn.deathDuration + CONFIG.spawn.respawnDelay) * 1000;
    setTimeout(() => {
      if (this.players.has(vitima.conn)) this.spawn(vitima);
    }, espera).unref?.();
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
        drop: CONFIG.spawn.dropHeight,
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
      drop: 2,
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

    const espera = (CONFIG.spawn.deathDuration + CONFIG.spawn.respawnDelay) * 1000;
    setTimeout(() => {
      if (this.players.has(vitima.conn)) this.spawn(vitima);
    }, espera).unref?.();
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
    this.spawn(player);
    this.broadcastScores();

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
      players: [...this.players.values()]
        .filter((p) => p !== exceto)
        .map((p) => ({ ...publicView(p), state: p.state })),
      arrows: this.stuckArrows,
      boars: this.hunt.boars.length ? this.hunt.view() : [],
      elks: this.elks.elks.length ? this.elks.view() : [],
      birds: isZombieMode(this.mode) ? [] : this.birds.view(),
      zombies: this.zombies.zombies.length ? this.zombies.view() : [],
      torches: this.torches,
      zombieStatus: isZombieMode(this.mode) ? this.zombieStatus() : null,
      elkStatus: this.mode === "elkHunt" ? this.elkStatus() : null,
      series: this.series.view(),
      mode: this.modeView(),
      scores: this.scores(),
    };
  }

  handleClose(conn) {
    const player = this.players.get(conn);
    if (!player) return;
    this.players.delete(conn);
    this.colors.release(player.color);
    this.duelInvites.delete(player.id);
    // O duelo acaba se sobrar menos de dois: uma pessoa duelando sozinha é só
    // uma pessoa presa num modo.
    if (this.mode === "duel" && this.duelInvites.size < CONFIG.modes.duel.minPlayers) {
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

      case C2S.MODE:
        this.requestMode(player, msg.mode);
        break;

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

    // O corpo cai, e só então a pessoa volta.
    const espera = (CONFIG.spawn.deathDuration + CONFIG.spawn.respawnDelay) * 1000;
    setTimeout(() => {
      if (this.players.has(vitima.conn)) this.spawn(vitima);
    }, espera).unref?.();
  }

  playerById(id) {
    for (const p of this.players.values()) if (p.id === id) return p;
    return null;
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
  spawn(player) {
    const ocupados = [...this.players.values()]
      .filter((p) => p !== player && p.state)
      .map((p) => ({ x: p.state.p[0], z: p.state.p[2] }));

    const ponto = pickSpawnPoint(this.terrain, ocupados);
    const invulnUntil = this.now() + CONFIG.spawn.invulnerability * 1000;
    player.alive = true;
    player.invulnUntil = invulnUntil;
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
      drop: CONFIG.spawn.dropHeight,
      invulnUntil,
    });
  }

  /* --------------------------------------------------------------- placar -- */

  scores() {
    return [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      ping: p.ping,
      ...p.score,
    }));
  }

  broadcastScores() {
    this.broadcastAll({ t: S2C.SCORES, scores: this.scores() });
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
      // Quem quer duelar, com nome: é o que a sala vê como convite na tela.
      invites: [...this.players.values()]
        .filter((p) => p.duelReady)
        .map((p) => ({ id: p.id, name: p.name })),
      needed: CONFIG.modes.duel.minPlayers,
      windInfluence: this.windInfluence,
    };
  }

  /* --------------------------------------------------------------- envio --- */

  /** Poses de todos, numa mensagem só. Nada a fazer se ninguém tem com quem falar. */
  broadcastStates() {
    if (this.players.size < 2) return;
    const s = [];
    for (const p of this.players.values()) {
      // `w` = quando o dono capturou a pose. É esse instante que a interpolação
      // do outro lado usa, e não o da retransmissão.
      if (p.state) s.push({ id: p.id, w: p.stateTime, ...p.state });
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

  destroy() {
    clearInterval(this.stateTimer);
    clearInterval(this.sweepTimer);
    clearInterval(this.boarTimer);
    this.hunt.stop();
    this.elks.stop();
    this.players.clear();
  }
}

/* ------------------------------------------------------------- ciclo de vida */

/**
 * Cria a sala quando o primeiro jogador entra e a destrói quando o último sai.
 *
 * Enquanto ninguém joga, o processo não tem timer rodando, nem porco andando,
 * nem estado ocupando memória — o servidor fica em zero de verdade. A carência
 * existe para que uma queda de rede de cinco segundos não apague a sessão de
 * quem estava jogando sozinho.
 */
export class RoomHost {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.room = null;
    this.graceTimer = null;
  }

  /** A sala, criando-a se for preciso. */
  ensure() {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    if (!this.room) {
      this.room = new Room({ log: this.log });
      this.room.onEmpty = (room) => this.scheduleTeardown(room);
      this.log("sala criada");
    }
    return this.room;
  }

  /** A sala atual, ou null se ninguém está jogando. */
  get current() {
    return this.room;
  }

  scheduleTeardown(room) {
    if (room.size > 0 || this.graceTimer) return;
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      if (!this.room || this.room.size > 0) return;
      this.room.destroy();
      this.room = null;
      this.log("sala destruída — ninguém jogando");
    }, CONFIG.net.emptyRoomGrace * 1000);
  }

  /* --- ponte para o adaptador de transporte --------------------------------- */

  handleMessage(conn, data) {
    // Uma mensagem que não seja `hello` numa conexão sem sala é de alguém que
    // ficou para trás numa sala já destruída: `ensure()` recria e a vida segue.
    this.ensure().handleMessage(conn, data);
  }

  handleClose(conn) {
    this.room?.handleClose(conn);
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
  return { kills: 0, deaths: 0, boars: 0, elks: 0, elkHits: 0, birds: 0, targets: 0, points: 0 };
}

function publicView(p) {
  return { id: p.id, name: p.name, color: p.color };
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
