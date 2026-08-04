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
import {
  C2S,
  S2C,
  PROTOCOL_VERSION,
  RejectReason,
  displayName,
  playerEntity,
} from "../src/shared/protocol.js";
import { ColorPool } from "./colors.js";
import { pickSpawnPoint, duelPositions } from "./spawnPoints.js";
import { BoarHunt, boarPoints } from "./boarSim.js";
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
    this.series = new TargetSeries(this.terrain);
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
    // Os porcos andam num passo próprio, mais lento que o dos jogadores: um
    // javali não precisa de 20 Hz para parecer que anda.
    this.boarStep = 1 / net.boarHz;
    this.boarTimer = setInterval(() => this.tickBoars(), 1000 / net.boarHz);
  }

  /* ---------------------------------------------------------------- modos -- */

  /**
   * Trata o pedido de modo de um jogador.
   *
   * A caçada é cooperativa: quem apertar liga para a sala inteira, porque não
   * existe motivo para alguém não querer porcos aparecendo.
   *
   * O duelo é diferente — arrasta gente para uma briga. Então é CONVITE:
   * apertar marca você como pronto, a sala é avisada, e a partida só começa
   * quando dois ou mais aceitam. Quem não aceitou continua treinando em paz.
   */
  requestMode(player, modo) {
    if (modo === "boarHunt" || modo === "series") {
      this.setMode(this.mode === modo ? "free" : modo);
      return;
    }

    if (modo === "free") {
      // Sair do duelo: some da lista, e se sobrar menos de dois a partida acaba.
      this.duelInvites.delete(player.id);
      player.duelReady = false;
      if (this.mode === "duel" && this.duelInvites.size < CONFIG.modes.duel.minPlayers) {
        this.setMode("free");
      } else {
        this.broadcastMode();
      }
      return;
    }

    if (modo !== "duel") return;

    if (this.duelInvites.has(player.id)) {
      // Apertar de novo cancela o próprio convite.
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

  setMode(modo) {
    if (this.mode === modo) return;
    this.mode = modo;

    if (modo === "boarHunt") {
      this.hunt.start(this.playerPositions());
    } else {
      this.hunt.stop();
      this.broadcastAll({ t: S2C.BOARS, b: [], clear: true });
    }

    if (modo === "series") {
      this.series.start();
      this.lineUpForSeries();
      this.broadcastAll({ t: S2C.SERIES, target: this.series.view() });
    } else if (this.series.active) {
      this.series.stop();
      this.broadcastAll({ t: S2C.SERIES, target: null });
    }

    if (modo === "duel") this.startDuel();
    if (modo === "free") {
      this.duelInvites.clear();
      for (const p of this.players.values()) p.duelReady = false;
    }

    this.broadcastMode();
    this.log(`modo: ${modo}`);
  }

  /**
   * Põe todo mundo na linha de tiro, no começo da estrada.
   *
   * Lado a lado e voltados para o vale: a série inteira é uma sequência de
   * distâncias medidas a partir DAQUI, então começar espalhados pelo mapa
   * tornaria "o alvo dos 80 m" um número diferente para cada um.
   */
  lineUpForSeries() {
    const S = CONFIG.modes.series;
    const jogadores = [...this.players.values()];
    const meio = (jogadores.length - 1) / 2;

    jogadores.forEach((p, i) => {
      const x = pathCenterX(S.startZ) + (i - meio) * S.lineSpread;
      const z = S.startZ;
      p.alive = true;
      p.invulnUntil = this.now() + CONFIG.spawn.invulnerability * 1000;
      this.broadcastAll({
        t: S2C.SPAWN,
        id: p.id,
        x: round(x),
        z: round(z),
        y: round(this.terrain.heightAt(x, z)),
        // Queda curta: aqui o ponto é começar a atirar, não anunciar
        // renascimento — dez metros de queda só atrasariam o primeiro tiro.
        drop: 2,
        invulnUntil: p.invulnUntil,
      });
    });
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

  playerPositions() {
    return [...this.players.values()]
      .filter((p) => p.state)
      .map((p) => ({ x: p.state.p[0], z: p.state.p[2] }));
  }

  tickBoars() {
    // Roda enquanto houver porco em campo, mesmo com a caçada desligada: os
    // avulsos precisam andar.
    if (this.players.size === 0) return;
    if (!this.hunt.active && this.hunt.boars.length === 0) return;
    const agora = this.now();

    // Convite de duelo que ninguém aceitou expira sozinho: um aviso pendurado
    // para sempre na tela vira ruído.
    if (this.inviteExpires && agora > this.inviteExpires && this.mode !== "duel") {
      this.duelInvites.clear();
      this.inviteExpires = 0;
      for (const p of this.players.values()) p.duelReady = false;
      this.broadcastMode();
    }

    this.hunt.update(this.boarStep, this.playerPositions(), agora);
    this.broadcastAll({ t: S2C.BOARS, time: agora, b: this.hunt.view() });
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
        // Uma flecha caindo perto espanta os porcos ao redor.
        if (this.hunt.active && msg.p) this.hunt.scareNear(msg.p[0], msg.p[2]);

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

      case C2S.SERIES_HIT:
        this.registerSeriesHit(player, msg);
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

    this.broadcastAll({
      t: S2C.SPAWN,
      id: player.id,
      x: round(ponto.x),
      z: round(ponto.z),
      y: round(ponto.y),
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

  modeView() {
    return {
      mode: this.mode,
      // Quem quer duelar, com nome: é o que a sala vê como convite na tela.
      invites: [...this.players.values()]
        .filter((p) => p.duelReady)
        .map((p) => ({ id: p.id, name: p.name })),
      needed: CONFIG.modes.duel.minPlayers,
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
  return { kills: 0, deaths: 0, boars: 0, targets: 0, points: 0 };
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
