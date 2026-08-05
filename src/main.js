/* ---------------------------------------------------------------------------
   Ponto de entrada e laço principal.

   O passo da física é FIXO (1/120 s) e vive num acumulador, separado do
   requestAnimationFrame. O render interpola entre o estado anterior e o atual,
   então a imagem fica suave mesmo com o monitor em 60, 120 ou 144 Hz — e a
   simulação dá exatamente o mesmo resultado em qualquer um deles.
   --------------------------------------------------------------------------- */

import "./style.css";
import * as THREE from "three";

import { CONFIG, drawSpeed, drawFraction, applyQuality, savedQuality } from "./config.js";
import { clamp } from "./utils/math.js";
import { initPhysics, PhysicsWorld } from "./core/physics.js";
import { BodySync } from "./core/sync.js";
import { entityRegistry } from "./core/entityRegistry.js";
import { gameEvents, EventType, vec3Payload } from "./core/events.js";
import { Renderer } from "./core/renderer.js";
import { createEnvironment } from "./entities/environment.js";
import { Player } from "./entities/player.js";
import { ArrowManager } from "./entities/arrow.js";
import { createTargets } from "./entities/target.js";
import { Wind } from "./systems/wind.js";
import { CameraRig } from "./systems/camera.js";
import { AimSolver } from "./systems/aim.js";
import { TrailManager } from "./systems/trails.js";
import { Input } from "./systems/input.js";
import { PlayerPhysics } from "./systems/playerPhysics.js";
import { AudioSystem } from "./systems/audio.js";
import { ParticleSystem } from "./systems/particles.js";
import { installImpactEffects } from "./systems/impactFx.js";
import { BoarManager } from "./systems/boarManager.js";
import { ElkManager } from "./systems/elkManager.js";
import { BirdManager } from "./systems/birdManager.js";
import { ZombieManager } from "./systems/zombieManager.js";
import { TorchRing } from "./systems/torches.js";
import { HUD } from "./ui/hud.js";
import { DebugPanel } from "./ui/debug.js";
import { Lobby } from "./ui/lobby.js";
import { NetClient } from "./net/client.js";
import { RemotePlayers } from "./net/remotePlayers.js";
import { RemoteArrows } from "./net/remoteArrows.js";
import { Respawn } from "./game/respawn.js";
import { Death } from "./game/death.js";
import { TargetSeriesView } from "./game/targetSeries.js";
import { ConfirmDialog } from "./ui/confirm.js";
import { Scoreboard, KillFeed } from "./ui/scoreboard.js";
import {
  C2S,
  S2C,
  packState,
  playerEntity,
  playerIdFrom,
  boarIdFrom,
  elkIdFrom,
  birdIdFrom,
  zombieIdFrom,
  round3,
} from "./shared/protocol.js";

/** Milímetro de precisão: de sobra para a rede e metade dos bytes. */
const mm = (v) => Math.round(v * 1000) / 1000;

class Game {
  constructor(physics, setStep = () => {}) {
    this.physics = physics;
    this.sync = new BodySync();

    setStep("montando a cena…");
    this.renderer = new Renderer(document.getElementById("scene"));
    this.scene = this.renderer.scene;

    setStep("esculpindo o vale…");
    this.environment = createEnvironment(this.scene, physics);
    this.terrain = this.environment.terrain;

    setStep("posicionando alvos…");
    this.targets = createTargets(this.scene, physics, this.sync, this.terrain);

    this.wind = new Wind();

    const playerEntityId = entityRegistry.createId();
    this.player = new Player(this.terrain, playerEntityId);
    this.playerPhysics = new PlayerPhysics(physics, this.player, playerEntityId);
    this.player.physicsBody = this.playerPhysics;
    entityRegistry.register(playerEntityId, this.player);

    this.scene.add(this.player.root);

    this.trails = new TrailManager(this.scene);
    this.arrows = new ArrowManager(
      this.scene,
      physics,
      this.sync,
      this.wind,
      this.trails,
    );
    this.boars = new BoarManager(this.scene, physics, this.terrain);
    this.elks = new ElkManager(this.scene, physics, this.terrain);
    // O bando precisa saber onde ficam as copas, e só o ambiente sabe: o
    // servidor manda "pouse por aqui" com um (x, z) e a árvore é achada aqui.
    this.birds = new BirdManager(this.scene, physics, this.terrain, (x, z) =>
      this.environment.nearestPerch(x, z),
    );
    this.zombies = new ZombieManager(this.scene, physics, this.terrain, this.arrows);
    this.torches = new TorchRing(this.scene, physics, this.terrain);
    /** 0 = dia, 1 = noite. Persegue `nightTarget` — ver `updateNight`. */
    this.night = 0;
    this.nightTarget = 0;
    /** Último estado do modo zumbi vindo da sala (vidas, horda, caídos). */
    this.zombieState = null;
    /** Estado da caçada ao alce (caídos / fim de partida). */
    this.elkState = null;
    this._elkHudCountdown = false;
    /** A tela de vitória da caçada está na tela, esperando o Enter que a fecha. */
    this.huntVictoryOpen = false;

    this.aim = new AimSolver(physics);
    this.aim.setExcludedCollider(this.playerPhysics.collider);
    this.rig = new CameraRig(this.renderer.camera);
    this.audio = new AudioSystem(this.renderer.camera, this.scene);
    /* Um pool para TODAS as partículas do jogo — terra, lasca, pena, brasa,
       poeira, bafo. Ele se inscreve sozinho em `EventType.PARTICLES`, então
       ninguém precisa de uma referência a ele: quem quer soltar partícula manda
       um evento, exatamente como quem quer tocar um som. */
    this.particles = new ParticleSystem(this.scene);
    // Traduz impacto e abate em receitas de partícula. Ver `systems/impactFx.js`.
    installImpactEffects();

    this.hud = new HUD(document.getElementById("ui"));
    this.input = new Input(
      document.getElementById("scene"),
      this.hud.el.lockHint,
    );
    this.input.onEngage = () => this.audio.unlock();

    this.debug = new DebugPanel(document.getElementById("ui"), {
      physics,
      arrows: this.arrows,
      wind: this.wind,
      rig: this.rig,
      scene: this.scene,
      // Para o contador de draw calls e a chave do pós-processamento.
      renderer: this.renderer,
      particles: this.particles,
      net: null, // preenchido abaixo, depois do NetClient
    });

    this.selectedTarget = 0;
    this.buildTargetMarker();
    this.selectTarget(0, false);

    /* --------------------------------------------------------------- rede -- */
    this.net = new NetClient();
    this.debug.ctx.net = this.net;
    this.remotes = new RemotePlayers(this.scene, physics, this.terrain);
    this.remoteArrows = new RemoteArrows(this.arrows, () => this.targets);
    this.series = new TargetSeriesView(this.scene, physics, this.terrain, this.arrows);
    this.respawn = new Respawn(this.player, this.playerPhysics);
    this.death = new Death(this.player, this.terrain);
    this.lastStateSent = -Infinity;

    const ui = document.getElementById("ui");
    this.confirm = new ConfirmDialog(ui);
    this.scoreboard = new Scoreboard(ui);
    this.killFeed = new KillFeed(ui);
    this.bindNetwork();

    this.drawTime = 0;
    /** Segundos restantes da animação de buscar flecha na aljava (0 = pronta). */
    this.reloadTimer = 0;
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.fps = 60;
    this.stepsLastFrame = 0;
    this.elapsed = 0;
    this.simTick = 0;

    this._muzzle = new THREE.Vector3();
    this._spawn = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._shadowFocus = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._cameraPivot = new THREE.Vector3();
    this._reAxis = new THREE.Vector3();
    this._reWanted = new THREE.Vector3();

    // Contabilidade do placar. O aviso na tela NÃO sai daqui: sai do evento de
    // impacto, logo abaixo, para ser um por flecha em vez de um por callback.
    this.arrows.onScore = (_target, result) => {
      if (result.score > 0) this.hud.addScore(result.score);
      else this.hud.miss();
    };
    this.arrows.onMiss = () => this.hud.miss();

    /* Um único aviso por flecha, com quantos metros ela percorreu. Nasce do
       evento de impacto — o mesmo ponto por onde passam cenário, alvo, porco e
       personagem —, então aparece igual em primeira e em terceira pessoa e não
       depende de quem tratou o acerto. */
    gameEvents.on(EventType.ARROW_IMPACT, (e) => {
      if (e.ownerId !== this.player.entityId) return;
      this.hud.impact(e);
      this.reportImpact(e);

      /* Acertou uma pessoa: você é a autoridade e declara a morte.
         É esta escolha que faz o tiro parecer instantâneo — esperar o servidor
         confirmar custaria meio ping entre ver o acerto e ele valer. */
      if (e.targetKind === "character") {
        const vitima = playerIdFrom(e.targetId);
        if (vitima != null) {
          this.net.send(C2S.KILL, {
            victim: vitima,
            p: e.pose.p.map(mm),
            /* O ponto de contato e a velocidade da flecha viajam junto porque é
               deles que sai o TOMBO: o ragdoll da vítima usa os dois para
               decidir para onde o corpo é jogado e com que giro. Sem eles cada
               cliente inventaria uma queda, e o corpo cairia de um jeito na
               tela de quem atirou e de outro na de quem levou. */
            c: [mm(e.impact.x), mm(e.impact.y), mm(e.impact.z)],
            v: e.velocity.map(mm),
            d: Math.round(e.distance * 100) / 100,
          });
        }
      }
    });

    // Alvo da série: quem acertar primeiro leva. O servidor arbitra, porque
    // dois tiros quase juntos precisam de um desempate único para todos.
    gameEvents.on(EventType.ARROW_IMPACT, (e) => {
      if (e.ownerId !== this.player.entityId) return;
      if (e.targetKind !== "seriesTarget") return;
      this.net.send(C2S.SERIES_HIT, { seq: e.targetId });
    });

    // Porco abatido: o servidor confirma, calcula os pontos pela distância e
    // avisa a sala. Quem atirou já viu o bicho cair — o retorno é imediato.
    gameEvents.on(EventType.BOAR_DEATH, (e) => {
      if (e.ownerId !== this.player.entityId) return;
      const id = boarIdFrom(e.boarId);
      if (id == null) return;
      this.net.send(C2S.BOAR_HIT, { id, d: Math.round(e.distance * 100) / 100 });
    });

    /* Alce e pássaro: só o AVISO de acerto sai daqui. Quem conta a vida do alce
       e quem decide se o pássaro morreu é o servidor — diferente do porco, que
       cai no primeiro acerto e por isso pode ser resolvido aqui. */
    gameEvents.on(EventType.ELK_HIT, (e) => {
      if (e.ownerId !== this.player.entityId) return;
      const id = elkIdFrom(e.elkId);
      if (id != null) this.net.send(C2S.ELK_HIT, { id });
    });

    /* Zumbi: o corpo cai NA HORA, como o pássaro. Meio ping entre acertar a
       cabeça e ver o bicho pegar fogo é o bastante para a pessoa achar que
       errou — e num cerco ela atira de novo, gastando a flecha e o tempo que
       não tem. O servidor confirma e distribui os pontos. */
    gameEvents.on(EventType.ZOMBIE_HIT, (e) => {
      if (e.ownerId !== this.player.entityId) return;
      const id = zombieIdFrom(e.zombieId);
      if (id == null) return;
      const limiar = CONFIG.modes.zombie.fullDrawKillSpeed ?? CONFIG.bow.maxSpeed * 0.98;
      const fullDraw = (e.speed ?? 0) >= limiar;
      // Lobo, headshot ou tensão máxima: caem na hora.
      if (e.wolf || e.head || fullDraw) this.zombies.kill(id, e.head === true);
      this.net.send(C2S.ZOMBIE_HIT, {
        id,
        head: e.head === true,
        d: Math.round(e.distance * 100) / 100,
        v: Math.round((e.speed ?? 0) * 10) / 10,
      });
    });

    /* Tocha acertada. Sai do impacto e não de um evento próprio porque não há
       entidade nenhuma para avisar — a tocha é cenário, e o que interessa é só
       o índice dela. Quem apaga de verdade é a sala: a tocha tem de estar
       apagada em todas as telas. */
    gameEvents.on(EventType.ARROW_IMPACT, (e) => {
      if (e.ownerId !== this.player.entityId) return;
      if (e.targetKind !== "torch") return;
      this.net.send(C2S.TORCH_HIT, { i: e.targetId });
    });

    gameEvents.on(EventType.BIRD_HIT, (e) => {
      if (e.ownerId !== this.player.entityId) return;
      const id = birdIdFrom(e.birdId);
      if (id == null) return;
      // O pássaro cai NA HORA, sem esperar a confirmação: o alvo é pequeno e
      // distante, e meio ping de silêncio entre acertar e ver o bicho cair é o
      // suficiente para a pessoa achar que errou.
      this.birds.kill(id);
      this.net.send(C2S.BIRD_HIT, { id, d: Math.round(e.distance * 100) / 100 });
    });

    window.addEventListener("resize", () =>
      this.trails.setResolution(this.renderer.width, this.renderer.height),
    );
  }

  buildTargetMarker() {
    const R = CONFIG.target.faceRadius;
    this.marker = new THREE.Mesh(
      new THREE.TorusGeometry(R * 1.14, 0.022, 8, 44),
      new THREE.MeshBasicMaterial({ color: 0xf5c451, transparent: true, opacity: 0.9 }),
    );
    this.marker.renderOrder = 5;
  }

  selectTarget(index) {
    const target = this.targets[index];
    if (!target) return;
    this.selectedTarget = index;
    if (this.marker.parent) this.marker.parent.remove(this.marker);
    target.group.add(this.marker);
    this.marker.position.copy(target.faceCenterLocal);
    this.marker.position.z += CONFIG.target.faceThickness / 2 + 0.01;
  }

  /* ------------------------------------------------------------- rede ----- */

  bindNetwork() {
    const net = this.net;

    net.on("welcome", (msg) => {
      // Quem eu sou nesta sala. A cor vem do servidor porque é ele que garante
      // que ninguém repita a de outro (ver server/colors.js).
      this.player.displayName = msg.you.name;
      this.player.setColor(msg.you.color);

      /* O id passa a ser o da SALA. É ele que a flecha carrega como dono e o
         que `hitResolver` compara para não deixar ninguém se acertar — e ele
         precisa significar a mesma pessoa em todos os clientes, o que um
         contador local jamais garantiria. */
      entityRegistry.unregister(this.player.entityId);
      this.player.entityId = playerEntity(msg.you.id);
      entityRegistry.register(this.player.entityId, this.player);

      // Reconexão: o mundo pode ter mudado inteiro enquanto a rede estava fora.
      this.remotes.clear();
      this.remoteArrows.clear();
      this.arrows.clearAll();
      for (const outro of msg.snapshot.players) {
        const remoto = this.remotes.add(outro);
        if (outro.state) remoto.pushSample(msg.time, outro.state);
      }
      // As flechas que já estavam nos alvos antes de você chegar.
      this.remoteArrows.restore(msg.snapshot.arrows ?? [], (id) =>
        this.remotes.get(id)?.color,
      );
      this.boars.clear();
      if (msg.snapshot.boars?.length) this.boars.applyNetwork(msg.snapshot.boars);
      this.elks.clear();
      if (msg.snapshot.elks?.length) this.elks.applyNetwork(msg.snapshot.elks);
      this.birds.clear();
      if (msg.snapshot.birds?.length) this.birds.applyNetwork(msg.snapshot.birds);
      /* Quem entra no meio de uma noite já em andamento recebe a horda como ela
         está — inclusive quais tochas já foram apagadas. Sem isto, o campo de
         quem chegou depois estaria todo aceso e ele acharia que enxerga um
         canto que, para os outros, está no escuro. */
      this.zombies.clear();
      this.applyZombieMode(msg.snapshot.mode?.mode === "zombie");
      if (msg.snapshot.zombies?.length) this.zombies.applyNetwork(msg.snapshot.zombies);
      this.torches.setStates(msg.snapshot.torches);
      this.zombieState = msg.snapshot.zombieStatus ?? null;
      this.elkState = msg.snapshot.elkStatus ?? null;
      this.series.setTarget(msg.snapshot.series ?? null);
      this.applyMode(msg.snapshot.mode);
      this.scoreboard.setScores(msg.snapshot.scores);
      this.hud.setConnection(true);
    });

    net.on(S2C.JOIN, (msg) => {
      this.remotes.add(msg.player);
      this.hud.toast(`${msg.player.name} entrou`, "miss");
    });

    net.on(S2C.LEAVE, (msg) => {
      // A flecha de quem saiu no meio do voo nunca receberá o impacto dela.
      this.remoteArrows.forget(msg.id);
      this.remotes.remove(msg.id);
      this.hud.toast(`${msg.name} saiu`, "miss");
    });

    net.on(S2C.STATES, (msg) => this.remotes.applyStates(msg, net.me?.id));

    net.on(S2C.SHOT, (msg) => {
      this.remoteArrows.onShot(msg, this.remotes.get(msg.owner)?.color);
    });
    net.on(S2C.IMPACT, (msg) => this.remoteArrows.onImpact(msg));

    net.on(S2C.SPAWN, (msg) => {
      if (msg.id === net.me?.id) {
        this.death.revive();
        this.respawn.begin(msg);
        /* O rumo da câmera pode vir do servidor. Na caçada ao alce ele vem
           sempre, apontado para o bicho: nascer de costas para o único alvo do
           modo transformava o primeiro segundo num giro de mouse às cegas. */
        if (msg.yaw != null) {
          this.input.yaw = msg.yaw;
          this.input.pitch = 0;
        }
        this.reloadTimer = 0;
        this.drawTime = 0;
        this.input.drawing = false;
      } else {
        this.remotes.get(msg.id)?.applySpawn(msg);
      }
    });

    net.on(S2C.KILL, (msg) => {
      if (msg.victim === net.me?.id) this.death.begin(net.serverTime, msg);
      else this.remotes.kill(msg.victim, net.serverTime, msg);

      /* O som da morte, no lugar onde ela aconteceu.
         Vale para TODAS as mortes, de flecha ou de cabeçada: quem está de
         costas só tem o som para saber que alguém caiu ali. E a cabeçada leva
         a pancada junto, porque um baque seco e um grito contam uma história
         diferente de um grito sozinho. */
      const onde = this.deathPosition(msg.victim);
      if (onde) {
        if (msg.cause === "gore") {
          gameEvents.emit(EventType.AUDIO_PLAY, {
            sound: "elkGore",
            position: onde,
            volume: 1.3,
          });
        }
        gameEvents.emit(EventType.AUDIO_PLAY, {
          sound: "playerDeath",
          position: onde,
          volume: 1.1,
        });
      }

      this.killFeed.push([
        { text: msg.killerName, color: msg.killerColor, forte: true },
        { text: "  🏹  " },
        { text: msg.victimName, color: msg.victimColor, forte: true },
        ...(msg.distance ? [{ text: `   ${msg.distance.toFixed(0)} m` }] : []),
      ]);
    });

    net.on(S2C.BOARS, (msg) => {
      if (msg.clear) this.boars.clear();
      else this.boars.applyNetwork(msg.b);
    });

    /* Onda nova. O aviso é ALTO de propósito — faixa no meio da tela e toque de
       trompa. Sem ele, seis javalis simplesmente aparecem no campo e a pessoa
       fica procurando de onde vieram; com ele, a leva é um acontecimento, que é
       o que ela é. O som sai na posição do jogador (não no mundo): é um aviso
       para ele, não algo que acontece num lugar. */
    net.on(S2C.WAVE, (msg) => {
      this.hud.announceWave(msg.n, msg.size);
      gameEvents.emit(EventType.AUDIO_PLAY, {
        sound: "waveHorn",
        position: vec3Payload(this.player.position),
        volume: 0.9,
      });
    });

    /* Fim da caçada: a quinta onda esgotou. A tela de vitória entra para todo
       mundo, com o mesmo ranking — e o toque lembra as cornetas reais de uma
       vitória de verdade, não a trompa curta de aviso de onda. Ela fica na
       tela até o jogador apertar Enter (ver `confirmOverlay` em input.js);
       os porcos que sobraram continuam valendo ponto normalmente. */
    net.on(S2C.HUNT_OVER, (msg) => {
      this.huntVictoryOpen = true;
      this.hud.showHuntVictory(msg.ranking ?? [], this.net.me?.id);
      gameEvents.emit(EventType.AUDIO_PLAY, {
        sound: "victoryFanfare",
        position: vec3Payload(this.player.position),
        volume: 1.0,
      });
    });

    net.on(S2C.BOAR_DEATH, (msg) => {
      this.boars.kill(msg.id);
      // Porco avulso não entra no feed de pontuação: ele é brincadeira.
      if (msg.fun) return;
      this.killFeed.push([
        { text: msg.killerName, color: msg.killerColor, forte: true },
        { text: "  🐗  " },
        { text: `+${msg.points}`, forte: true },
        { text: `   ${msg.distance.toFixed(0)} m` },
      ]);
    });

    net.on(S2C.ELKS, (msg) => {
      if (msg.clear) this.elks.clear();
      else this.elks.applyNetwork(msg.e);
    });

    /* O berro de dor sai do EVENTO DA SALA, não do impacto local. Só quem
       atirou vê o impacto; o alce berrando é para todo mundo ouvir, inclusive
       quem está do outro lado do vale tentando entender por que o bicho mudou
       de direção. */
    net.on(S2C.ELK_HIT, (msg) => {
      const alce = this.elks.byNetId.get(msg.id);
      if (!alce) return;
      alce.health = msg.health;
      // Só o berro gravado (MP3 fatiado) — sem tom sintético de impacto/dor.
      gameEvents.emit(EventType.AUDIO_PLAY, {
        sound: "elkVoice",
        variant: "hit",
        position: vec3Payload(alce.position),
        volume: 1.35,
      });
      // A segunda flecha no meio da investida quebrou a coragem do bicho.
      if (msg.scared) this.hud.toast("o alce desistiu da investida");
    });

    net.on(S2C.ELK_DEATH, (msg) => {
      this.elks.kill(msg.id);
      if (msg.fun) return;
      this.killFeed.push([
        { text: msg.killerName, color: msg.killerColor, forte: true },
        { text: "  \u{1F98C}  " },
        { text: `+${msg.points}`, forte: true },
      ]);
    });

    net.on(S2C.ELK_STATUS, (msg) => {
      this.elkState = msg;
    });

    net.on(S2C.ELK_OVER, (msg) => {
      this.elkState = { ...(this.elkState ?? {}), over: true, reason: msg.reason };
      if (msg.reason === "win") {
        this.huntVictoryOpen = true;
        this.hud.showElkVictory(msg.ranking ?? [], this.net.me?.id, msg.finisher ?? null);
        gameEvents.emit(EventType.AUDIO_PLAY, {
          sound: "victoryFanfare",
          position: vec3Payload(this.player.position),
          volume: 1.0,
        });
      } else {
        this.hud.showZombieCenter("GAME OVER", "o alce derrubou a caçada", "gameover");
      }
    });

    net.on(S2C.BIRDS, (msg) => this.birds.applyNetwork(msg.k));

    net.on(S2C.BIRD_DEATH, (msg) => {
      this.birds.kill(msg.id);
      this.killFeed.push([
        { text: msg.killerName, color: msg.killerColor, forte: true },
        { text: "  \u{1F426}  " },
        { text: `+${msg.points}`, forte: true },
        { text: `   ${(msg.distance ?? 0).toFixed(0)} m` },
      ]);
    });

    /* O mundo recomeçou (alguém trocou de modo). A limpeza do CENÁRIO vem em
       mensagens próprias; o que sobra para cá é o que só existe nesta máquina:
       as flechas cravadas e o contador local de acertos. */
    net.on(S2C.WORLD_RESET, () => {
      this.arrows.clearAll();
      this.remoteArrows.clear();
      this.zombies.clear();
      this.series.clear();
      this.hud.resetStats();
      this.hud.hideZombieCenter();
      this.huntVictoryOpen = false;
      this.hud.hideHuntVictory();
      this.zombieState = null;
      this.elkState = null;
      this._elkHudCountdown = false;
      this.rig.returnToArcher();
    });

    net.on(S2C.SERIES, (msg) => this.series.setTarget(msg.target));

    net.on(S2C.SERIES_HIT, (msg) => {
      // A explosão marca o acerto a qualquer distância: com o alvo a 250 m,
      // sem estouro visível ninguém sabe se acertou ou se passou de raspão.
      this.series.explode(msg.x, msg.y + 0.9, msg.z, msg.killerColor);
      this.killFeed.push([
        { text: msg.killerName, color: msg.killerColor, forte: true },
        { text: "  \u2299  " },
        { text: `+${msg.points}`, forte: true },
        { text: `   ${msg.distance.toFixed(0)} m` },
      ]);
      // Mensagem central para TODOS: quem acertou e a quantos metros da linha.
      this.hud.toast(
        [
          { text: msg.killerName, color: msg.killerColor, className: "score" },
          { text: " acertou o alvo a " },
          { text: `${Math.round(msg.distance)} m`, className: "score" },
        ],
        "series-hit",
      );
    });

    net.on(S2C.SERIES_OVER, (msg) => {
      this.huntVictoryOpen = true;
      this.hud.showSeriesVictory(msg.ranking ?? [], this.net.me?.id);
      gameEvents.emit(EventType.AUDIO_PLAY, {
        sound: "victoryFanfare",
        position: vec3Payload(this.player.position),
        volume: 1.0,
      });
    });

    net.on(S2C.WIND, (msg) => {
      this.applyWindInfluence(!!msg.on, { toast: !msg.silent });
    });

    /* ------------------------------------------------------------ zumbis -- */

    net.on(S2C.ZOMBIES, (msg) => {
      if (msg.clear) this.zombies.clear();
      else this.zombies.applyNetwork(msg.z);
    });

    net.on(S2C.ZOMBIE_DEATH, (msg) => {
      this.zombies.kill(msg.id, msg.head);
      this.killFeed.push([
        { text: msg.killerName, color: msg.killerColor, forte: true },
        {
          text: msg.wolf
            ? "  \u{1F43A}  "
            : msg.head
              ? "  \u{1F525}  "
              : "  \u{1F3F9}  ",
        },
        { text: `+${msg.points}`, forte: true },
        ...(msg.distance ? [{ text: `   ${msg.distance.toFixed(0)} m` }] : []),
      ]);
    });

    net.on(S2C.HORDE, (msg) => {
      this.hud.announceHorde(msg.n, msg.size);
      gameEvents.emit(EventType.AUDIO_PLAY, {
        sound: "waveHorn",
        position: vec3Payload(this.player.position),
        volume: 0.8,
      });
    });

    net.on(S2C.TORCHES, (msg) => {
      this.torches.setStates(msg.t4);
      if (msg.hit != null) this.hud.toast("uma tocha se apagou", "miss");
    });

    net.on(S2C.ZOMBIE_STATUS, (msg) => {
      this.zombieState = msg;
    });

    /* A vitória do modo zumbi usa a MESMA tela da caçada (ver S2C.HUNT_OVER):
       quem joga já sabe ler aquele card, e ele já mostra quem se destacou.
       Só a derrota (todo mundo caído) fica com o aviso simples no centro —
       ali não há o que ranquear, a noite só acabou mal. */
    net.on(S2C.ZOMBIE_OVER, (msg) => {
      this.zombieState = { ...(this.zombieState ?? {}), over: true, reason: msg.reason };
      if (msg.reason === "win") {
        this.huntVictoryOpen = true;
        this.hud.showZombieVictory(msg.ranking ?? [], this.net.me?.id);
        gameEvents.emit(EventType.AUDIO_PLAY, {
          sound: "victoryFanfare",
          position: vec3Payload(this.player.position),
          volume: 1.0,
        });
      } else {
        this.hud.showZombieCenter("GAME OVER", `caíram na horda ${msg.horde}`, "gameover");
      }
    });

    net.on(S2C.MODE, (msg) => this.applyMode(msg));

    net.on(S2C.SCORES, (msg) => this.scoreboard.setScores(msg.scores));
    net.on(S2C.SCORES_RESET, (msg) => {
      this.hud.toast(`${msg.by} zerou o placar`, "miss");
    });

    net.on("disconnected", () => this.hud.setConnection(false));
    net.on("reconnecting", () => this.hud.setConnection(false));
  }

  /**
   * Onde uma vítima está, para tocar o som da morte ali.
   *
   * Devolve `null` quando quem morreu não está em cena (longe demais e
   * descartado, ou saiu da sala entre a morte e a mensagem chegar) — e aí não
   * há som, que é melhor do que um grito vindo do nada.
   */
  deathPosition(victimId) {
    if (victimId === this.net.me?.id) return vec3Payload(this.player.position);
    const remoto = this.remotes.get(victimId);
    return remoto ? vec3Payload(remoto.player.position) : null;
  }

  async connect(name) {
    await this.net.connect(name);
  }

  /**
   * A própria pose, `stateHz` vezes por segundo — de RELÓGIO, não de frames.
   *
   * Ritmar pelo `dt` do jogo parece equivalente e não é: `dt` é limitado a
   * 100 ms e, num frame que atrasa, ele conta menos tempo do que passou de
   * verdade. O envio então escorrega para menos de 20 Hz reais, e do outro lado
   * a interpolação fica sem amostra nova — o boneco congela e depois salta.
   * A taxa de envio não pode depender de quantos quadros esta máquina desenha.
   *
   * `w` é o instante em que a pose valeu. Não se chama `t` porque `t` é o tipo
   * da mensagem.
   */
  pushState() {
    if (!this.net.connected) return;
    const agora = this.net.serverTime;
    if (agora - this.lastStateSent < 1000 / CONFIG.net.stateHz) return;
    this.lastStateSent = agora;
    this.net.send(C2S.STATE, { s: packState(this.player), w: agora });
  }

  /* ------------------------------------------------------------- laço ----- */

  frame(now) {
    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = Math.min(rawDt, 0.1);
    this.elapsed += dt;
    this.fps = this.fps * 0.92 + (1 / Math.max(rawDt, 1e-4)) * 0.08;
    gameEvents.setTick(this.simTick);

    const actions = this.input.consume();
    this.handleActions(actions);

    // A ORDEM importa: a câmera define a mira (systems/aim.js), então ela é
    // posicionada ANTES do raycast, e o raycast antes do disparo.
    this.syncCameraMode();
    this.updateAimAndPose(dt, actions);
    // Não recebe `dt`: os dois gatilhos são de ESTADO (tocou o chão, cruzou meio
    // ciclo de passada), não de tempo decorrido. Ver `updateFootDust`.
    this.updateFootDust();
    this.updateCamera(dt);
    this.solveAim();
    if (actions.release && !this.death.dying && !this.player.isReloading) {
      this.shoot();
    }

    /* O vento é função do relógio da SALA, não do local. É essa amarração que
       permite mandar um evento de disparo em vez da trajetória inteira: com o
       mesmo vento no mesmo instante, cada cliente recalcula a mesma curva e o
       mesmo traçado. Sozinho, o relógio local serve igual. */
    if (this.net.connected) this.wind.setTime(this.net.serverTime / 1000);
    else this.wind.update(dt);

    this.stepPhysics(dt);
    this.arrows.update(dt);
    /* A câmera vai a TODOS os bichos. Ela sempre foi necessária para o alce (é
       ela que orienta a barra de vida); agora também decide o nível de detalhe
       de cada corpo — ver `utils/lod.js`. */
    this.boars.update(dt, this.renderer.camera);
    this.elks.update(dt, this.renderer.camera);
    this.birds.update(dt, this.renderer.camera);
    this.zombies.update(dt, this.renderer.camera);
    this.torches.update(dt);
    this.updateNight(dt);
    if (this._zombieOn) this.audio.tickAmbient(dt, this.renderer.camera.position);
    this.trails.update(dt);
    this.particles.update(dt);
    this.environment.update(dt, this.wind.vector);
    this.death.update(this.net.serverTime);
    this.respawn.update(this.net.serverTime);
    // Depois da câmera do frame: a distância dela decide o descarte e a escala
    // da etiqueta de nome.
    this.series.update(dt, this.renderer.camera);
    this.remotes.update(dt, this.net.serverTime, this.renderer.camera);
    this.pushState();

    this.updateHud();
    this.debug.update({
      fps: this.fps,
      steps: this.stepsLastFrame,
      live: this.arrows.live.length,
      stuck: this.arrows.stuck.length,
    });

    // O frustum de sombras deve seguir o jogador, não a direção da mira.
    // Deslocá-lo a cada mousemove fazia o shadow map "nadar" sobre o chão,
    // efeito muito mais perceptível na câmera de terceira pessoa.
    this._shadowFocus.copy(this.player.position);
    this._shadowFocus.y += 2;
    this.renderer.updateShadowFocus(this._shadowFocus);

    // O vento vai junto: é ele que arrasta as duas camadas de nuvem, cada uma
    // no seu ritmo (ver `CloudLayers` em `core/renderer.js`).
    this.renderer.render(dt, this.wind.vector);
    requestAnimationFrame(this.frame.bind(this));
  }

  handleActions(a) {
    if (a.dismissArrowCam) this.rig.returnToArcher();
    // Limpa só as SUAS flechas: em rede, varrer as dos outros da tela seria
    // apagar o tiro que o amigo acabou de dar.
    if (a.clearArrows) this.arrows.clearAll(this.player.entityId);
    if (a.toggleTrace) {
      this.arrows.setTraceVisible(!this.arrows.showTrace);
      this.hud.toast(
        this.arrows.showTrace ? "traçado ligado" : "traçado desligado",
        "miss",
      );
    }
    if (a.toggleWindInfluence) {
      // O vento é da SALA: quem aperta V pede a troca, o servidor manda para
      // todo mundo (ver S2C.WIND). Sem isso, cada um teria uma física diferente.
      this.net.send(C2S.WIND, { on: !this.arrows.options.windInfluence });
    }
    if (a.toggleArrowCam) {
      const on = !this.rig.followArrowEnabled;
      this.rig.setFollowArrow(on);
      this.hud.toast(
        on ? "câmera da flecha ligada" : "câmera da flecha desligada",
        "miss",
      );
    }
    if (a.confirmOverlay && this.huntVictoryOpen) {
      this.huntVictoryOpen = false;
      this.hud.hideHuntVictory();
    }
    // Qualquer um pode soltar um porco e todos veem. Não vale ponto: quem
    // solta escolheria a distância, e a caçada pontua justamente por distância.
    if (a.spawnBoar) this.net.send(C2S.SPAWN_BOAR);
    // Um alce avulso, em qualquer modo. Como o porco do P, não vale ponto.
    if (a.spawnElk) this.net.send(C2S.SPAWN_ELK);
    if (a.spawnElkWolves && this.mode === "elkHunt") {
      this.net.send(C2S.SPAWN_ELK_WOLVES);
    }

    if (a.setMode) this.net.send(C2S.MODE, { mode: a.setMode });
    if (a.toggleMusic) {
      const on = this.audio.toggleMusic();
      this.hud.toast(on ? "música ligada" : "música desligada", "miss");
    }
    if (a.toggleDebug) this.debug.toggle();
    if (a.toggleHelp) this.hud.toggleHelp();

    if (a.askRespawn) this.askRespawn();
    if (a.askResetScores) this.askResetScores();

    // Placar: aparece enquanto o Tab estiver segurado.
    if (this.input.scoreboard !== this.scoreboard.open) {
      if (this.input.scoreboard) this.scoreboard.show(this.net.me?.id);
      else this.scoreboard.hide();
    }
  }

  /* ---------------------------------------------------------------- modos -- */

  /**
   * O modo mudou (ou um convite de duelo apareceu).
   *
   * O duelo é convite e não decreto: apertar `2` marca você como pronto e
   * avisa a sala; a partida só começa quando dois ou mais aceitam. Quem estava
   * treinando não é arrastado para uma briga por causa da tecla de outro.
   */
  applyMode(msg) {
    if (!msg) return;
    const mudouModo = this.mode !== msg.mode;
    this.mode = msg.mode;
    this.scoreboard.setMode(msg.mode);

    /* No modo série, os sete alvos fixos SOMEM — o campo fica limpo e existe um
       alvo só, o da vez. Deixá-los na cena tiraria o sentido do modo: com alvos
       espalhados por toda parte, "o próximo está mais longe" não significa nada,
       e ainda por cima uma flecha perdida cravaria num alvo velho. */
    /* Os alvos fixos somem na série (um alvo por vez é o modo) e na noite dos
       zumbis — lá o pedido é campo limpo: nem mira, nem madeira, nem bicho. */
    const escondeFixos = msg.mode === "series" || msg.mode === "zombie";
    for (const alvo of this.targets) alvo.setActive(!escondeFixos);
    this.marker.visible = !escondeFixos;
    this.hud.setMode(msg.mode, msg.invites ?? [], msg.needed ?? 2, this.net.me?.id);

    if (msg.mode === "series") {
      this.series.showFence();
      this.player.minZ = CONFIG.modes.series.startZ;
    } else {
      this.series.hideFence();
      this.player.minZ = null;
    }

    if (typeof msg.windInfluence === "boolean") {
      this.applyWindInfluence(msg.windInfluence, { toast: false });
    }

    this.applyZombieMode(msg.mode === "zombie");
    if (mudouModo) this.applyArrowCameraMode(msg.mode);
    if (msg.mode !== "elkHunt") {
      this.elkState = null;
      this._elkHudCountdown = false;
    }
  }

  /**
   * A câmera que acompanha a flecha começa desligada nos modos de cerco:
   * durante a caçada ao alce e a horda zumbi, o jogador precisa continuar
   * vendo o campo. O atalho continua podendo ligá-la manualmente.
   */
  applyArrowCameraMode(mode) {
    const bloqueadaAoEntrar = mode === "zombie" || mode === "elkHunt";
    this.rig.setFollowArrow(!bloqueadaAoEntrar);
    if (bloqueadaAoEntrar) this.rig.returnToArcher();
  }

  /** Aplica o vento na flecha localmente (já decidido pela sala). */
  applyWindInfluence(ligado, { toast = true } = {}) {
    if (this.arrows.options.windInfluence === ligado) {
      this.debug.syncWindInfluenceToggle(ligado);
      return;
    }
    this.arrows.options.windInfluence = ligado;
    this.debug.syncWindInfluenceToggle(ligado);
    if (toast) {
      this.hud.toast(
        ligado ? "vento na flecha ligado" : "vento na flecha desligado",
        "miss",
      );
    }
  }

  /**
   * Liga e desliga a noite.
   *
   * Um ponto só para a virada inteira: céu, tochas, flechas de fogo, bandeiras
   * e o que sobrou de bicho em campo. Ter tudo aqui é o que garante que sair do
   * modo desfaça exatamente o que entrar nele fez — espalhado por seis
   * chamadas, alguma sobra ficaria (uma tocha acesa de dia, o vento invisível)
   * e só apareceria três modos depois.
   */
  applyZombieMode(ligado) {
    if (this._zombieOn === ligado) return;
    this._zombieOn = ligado;

    this.nightTarget = ligado ? 1 : 0;
    this.arrows.fireArrows = ligado;
    this.audio.setAmbientNight(ligado);

    /* A câmera da flecha atrapalha o cerco: ela tira o olho do resto da horda
       bem no momento em que ela se aproxima por todos os lados. Por isso o
       modo entra com o acompanhamento desligado — e sai restaurando o padrão
       dos outros modos. Quem quiser de volta liga com a tecla de sempre
       (`toggleArrowCam`, ver bindActions). */
    this.rig.setFollowArrow(!ligado);

    if (ligado) {
      this.torches.build();
    } else {
      this.torches.clear();
      this.zombies.clear();
      this.zombieState = null;
      this.hud.setZombie(null);
      this.hud.hideZombieCenter();
    }

    // As bandeirolas de vento somem: são madeira e pano espalhados pelo vale, e
    // o pedido do modo é campo limpo.
    for (const f of this.environment.flags) f.group.visible = !ligado;
  }

  /* --------------------------------------------------------- confirmações -- */

  /** Abre um diálogo e entrega Enter/Esc a ele enquanto estiver aberto. */
  ask(pergunta, aoConfirmar) {
    if (this.confirm.open) return;
    this.input.dialogOpen = true;
    this.input.onDialogKey = (sim) => (sim ? this.confirm.confirm() : this.confirm.cancel());
    this.confirm.ask(pergunta, (sim) => {
      this.input.dialogOpen = false;
      this.input.onDialogKey = null;
      if (sim) aoConfirmar();
    });
  }

  /**
   * Renascer de propósito (K).
   *
   * É a saída para o caso que você levantou: nascer num lugar ruim ou ficar
   * preso em algum canto do cenário. Tem carência para não virar fuga de
   * duelo — o servidor recusa em silêncio se vier cedo demais.
   */
  askRespawn() {
    if (!this.net.connected) return;
    this.ask("Renascer em outro lugar?", () => this.net.send(C2S.RESPAWN));
  }

  /** Zerar o placar de todos (Y). Só quem apertou confirma. */
  askResetScores() {
    if (!this.net.connected) return;
    this.ask("Zerar o placar de TODOS os jogadores?", () =>
      this.net.send(C2S.RESET_SCORES),
    );
  }

  updateAimAndPose(dt, actions) {
    // Morto, o corpo cai e nada mais responde: não anda, não pula, não tensiona.
    // Sem isso o cadáver continuaria correndo pelo campo enquanto tomba.
    const morto = this.death.dying;

    /* Timer do reload: avança mesmo andando/correndo. Se a chave do painel ~
       for desligada no meio, cancela na hora — senão a pessoa ficaria presa
       sem poder atirar com a animação "desligada". */
    if (!CONFIG.bow.reloadAnimation && this.reloadTimer > 0) {
      this.reloadTimer = 0;
    }
    if (morto) {
      this.reloadTimer = 0;
    } else if (this.reloadTimer > 0) {
      this.reloadTimer = Math.max(0, this.reloadTimer - dt);
    }
    const recarregando = this.reloadTimer > 0;
    const dur = CONFIG.bow.reloadTime;
    this.player.setReload(recarregando && dur > 0 ? 1 - this.reloadTimer / dur : 0);

    this.input.blockDraw = this.rig.isArrowCam || morto || recarregando;
    this.input.blockDrawReason = morto
      ? "dead"
      : this.rig.isArrowCam
        ? "arrowCam"
        : recarregando
          ? "reload"
          : null;
    if (recarregando) {
      this.drawTime = 0;
      if (!this.input.primaryDown) this.input.drawing = false;
    } else if (
      this.input.primaryDown &&
      !morto &&
      !this.rig.isArrowCam &&
      !this.input.drawing
    ) {
      // Clique segurado durante o reload (ou câmera da flecha): assim que o
      // bloqueio some, começa a tensionar sem exigir um segundo clique.
      this.input.drawing = true;
    }

    if (this.input.drawing && !morto && !recarregando) this.drawTime += dt;
    else if (morto) this.drawTime = 0;

    if (actions.jump && !morto) this.player.jump();

    let yaw = this.input.yaw;
    let pitch = this.input.pitch;
    const overhold = Math.max(0, this.drawTime - CONFIG.bow.holdBeforeShake);
    if (overhold > 0) {
      const amp = Math.min(CONFIG.bow.shakeAmplitude * overhold, 0.02);
      const t = this.elapsed;
      yaw += Math.sin(t * 11.3) * amp + Math.sin(t * 6.7) * amp * 0.55;
      pitch += Math.sin(t * 9.1 + 1.7) * amp * 0.8 + Math.sin(t * 4.3) * amp * 0.4;
    }
    this.aimYaw = yaw;
    this.aimPitch = pitch;

    const moving = this.player.move(
      dt,
      morto ? 0 : this.input.forward,
      morto ? 0 : this.input.strafe,
      this.input.run,
    );
    this.player.setAim(yaw, pitch);
    this.player.setDraw(drawFraction(this.drawTime));
    this.player.update(dt, moving);
    this.player.getMuzzle(this._muzzle);

    this._forward.copy(this.aim.solveAxis(yaw, this.player.pitch));
    this.player.getEye(this._eye, this._forward);
    this.player.getCameraPivot(this._cameraPivot);
  }

  /**
   * Poeira nos pés (Fase 4.3 do plano).
   *
   * Dois gatilhos, e os dois saem de estado que já existia:
   *
   * • CORRENDO — um sopro por passada. A fase da marcha (`gaitPhase`) avança com
   *   a distância percorrida e um ciclo são dois passos, então cruzar π ou 2π é
   *   exatamente o instante em que um pé toca o chão. Emitir por tempo daria
   *   poeira fora do compasso com a perna, que é pior do que não ter poeira.
   *
   * • ATERRISSANDO — um estouro maior na transição de no-ar para no-chão.
   *   É a única confirmação de peso que o pulo tem.
   *
   * Só correndo, nunca andando: uma caminhada não levanta terra, e poeira em
   * todo passo transforma o campo num deserto.
   */
  updateFootDust() {
    const p = this.player;
    const noChao = !p.airborne;

    if (this._eraAereo && noChao) {
      gameEvents.emit(EventType.PARTICLES, {
        position: vec3Payload(p.position),
        count: 14,
        color: 0xa8926a,
        speed: 2.4,
        spread: 0.95,
        direction: { x: 0, y: 0.35, z: 0 },
        size: 0.12,
        grow: 1.8,
        life: 0.7,
        gravity: -1.6,
        drag: 3.2,
        alpha: 0.42,
      });
    }
    this._eraAereo = !noChao;

    if (!noChao || p.runBlend < 0.55 || p.speed < 4) {
      this._gaitMark = p.gaitPhase;
      return;
    }

    // Meio ciclo = um passo. Detecta a passagem por múltiplos de π mesmo quando
    // a fase dá a volta em 2π (o `move()` a normaliza).
    const antes = this._gaitMark ?? p.gaitPhase;
    const agora = p.gaitPhase;
    const cruzou =
      Math.floor(antes / Math.PI) !== Math.floor(agora / Math.PI) || agora < antes;
    this._gaitMark = agora;
    if (!cruzou) return;

    gameEvents.emit(EventType.PARTICLES, {
      position: vec3Payload(p.position),
      count: 5,
      color: 0xa8926a,
      speed: 1.3,
      spread: 0.85,
      direction: { x: 0, y: 0.5, z: 0 },
      size: 0.09,
      grow: 1.9,
      life: 0.55,
      gravity: -1.2,
      drag: 3.6,
      alpha: 0.3,
    });
  }

  /**
   * Troca de modo SEM mover o ponto mirado.
   *
   * O centro óptico muda de lugar ao alternar terceira ↔ primeira pessoa (são
   * ~1,3 m de diferença), e o retículo é o eixo óptico. Manter os mesmos ângulos
   * jogaria a mira para outro ponto do mundo — que era a queixa de "a mira não
   * está no mesmo lugar". Então giramos os ângulos o tanto que for preciso para
   * que o novo eixo óptico passe pelo MESMO ponto de antes.
   *
   * É um ponto fixo: mudar o yaw também move a câmera em terceira pessoa. A
   * iteração converge rápido porque cada volta reduz o erro na proporção
   * (raio da órbita / distância do alvo).
   *
   * Roda ANTES da pose do frame, então usa o olho e o ombro do frame anterior —
   * 16 ms de defasagem que valem milímetros no ponto mirado.
   */
  syncCameraMode() {
    const before = this.rig.wantFirstPerson;
    /* Morto, sempre em terceira pessoa. O olho da primeira pessoa é um ponto
       ancorado no rosto, e com o corpo mole rolando no chão a câmera rolaria
       junto — enjoativo e, pior, sem mostrar o que a pessoa quer ver, que é o
       próprio corpo caindo. */
    this.rig.setFirstPerson(this.input.firstPerson && !this.death.dying);
    if (this.rig.wantFirstPerson === before || !this.aim.hasFocus) return;

    const p = CONFIG.player;
    let yaw = this.input.yaw;
    let pitch = this.input.pitch;

    for (let i = 0; i < 5; i++) {
      this.aim.axisFrom(yaw, pitch, this._reAxis);
      this.rig.updateAimViewpoint(this._reAxis, this._eye, this._cameraPivot);
      this._reWanted.copy(this.aim.focus).sub(this.rig.aimOrigin).normalize();

      const f = this.rig.aimForward;
      let dYaw =
        Math.atan2(-this._reWanted.x, -this._reWanted.z) - Math.atan2(-f.x, -f.z);
      if (dYaw > Math.PI) dYaw -= Math.PI * 2;
      if (dYaw < -Math.PI) dYaw += Math.PI * 2;
      const dPitch = Math.asin(clamp(this._reWanted.y, -1, 1)) - Math.asin(clamp(f.y, -1, 1));

      if (Math.abs(dYaw) < 1e-5 && Math.abs(dPitch) < 1e-5) break;
      yaw += dYaw;
      pitch = clamp(pitch + dPitch, p.pitchMin, p.pitchMax);
    }

    this.input.yaw = yaw;
    this.input.pitch = pitch;
  }

  solveAim() {
    this.aim.solve(
      this.rig.aimOrigin,
      this.rig.aimForward,
      this.rig.aimSkip,
      this._muzzle,
    );
  }

  shoot() {
    if (this.player.isReloading) return;
    if (this.drawTime < 0.04) {
      this.drawTime = 0;
      return;
    }
    const speed = drawSpeed(this.drawTime);
    const direction = this.aim.direction;

    this._spawn.copy(this._muzzle).addScaledVector(direction, 0.3);

    const arrow = this.arrows.spawn(this._spawn, direction, speed, {
      ownerEntityId: this.player.entityId,
      trailColor: this.player.color ?? CONFIG.trail.color,
    });
    this.rig.onShoot(arrow);
    this.hud.addShot();
    this.drawTime = 0;
    this.player.setDraw(0);
    this.input.drawing = false;

    if (CONFIG.bow.reloadAnimation) {
      this.reloadTimer = CONFIG.bow.reloadTime;
      this.player.setReload(0.001);
    }

    gameEvents.emit(EventType.ARROW_SHOT, {
      arrowId: arrow.id,
      ownerId: this.player.entityId,
      origin: vec3Payload(this._spawn),
      direction: vec3Payload(direction),
      speed,
    });

    /* Um evento e acabou: os outros recalculam o voo inteiro a partir daqui.
       Nenhuma posição de flecha trafega — é o que faz o traçado do amigo
       aparecer em tempo real sem lag e sem banda. */
    this.net.send(C2S.SHOT, {
      id: arrow.id,
      o: round3(this._spawn),
      d: round3(direction),
      v: Math.round(speed * 100) / 100,
      w: this.net.serverTime,
    });
  }

  /**
   * Avisa a sala onde a SUA flecha cravou.
   *
   * Você é a autoridade do próprio acerto: os outros já estão desenhando esta
   * flecha voando e vão encaixá-la exatamente nesta pose. Vai junto a
   * velocidade no impacto para o alvo tombar igual em todas as telas, em vez
   * de cada máquina inventar o próprio tombo.
   */
  reportImpact(e) {
    if (!this.net.connected) return;
    this.net.send(C2S.IMPACT, {
      id: e.arrowId,
      p: e.pose.p.map(mm),
      q: e.pose.q.map(mm),
      // Onde o contato aconteceu — é aqui que o impulso é aplicado no alvo.
      c: [mm(e.impact.x), mm(e.impact.y), mm(e.impact.z)],
      k: e.targetKind,
      ti: e.targetId,
      v: e.velocity.map(mm),
      d: Math.round(e.distance * 100) / 100,
    });
  }

  stepPhysics(dt) {
    this.playerPhysics.step(dt);

    const h = CONFIG.physics.fixedStep;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= h && steps < CONFIG.physics.maxSubSteps) {
      this.sync.saveState();
      this.physics.step();
      this.sync.captureState();
      this.accumulator -= h;
      steps++;
      this.simTick++;
    }
    if (steps === CONFIG.physics.maxSubSteps) this.accumulator = 0;
    this.stepsLastFrame = steps;
    this.sync.apply(this.accumulator / h);
  }

  updateCamera(dt) {
    // O modo já foi resolvido em `syncCameraMode`, antes da pose.
    this.rig.update(dt, this._forward, this._eye, this._cameraPivot);

    this.player.setHeadVisible(!this.rig.isFirstPerson);

    const camera = this.renderer.camera;
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

    this.hud.setReticleVisible(!this.rig.isArrowCam);
  }

  /**
   * A virada dia ↔ noite, em ~1,2 s.
   *
   * É transição e não corte porque o corte lê como falha de render: a tela
   * inteira mudando de cor num quadro só parece que o jogo quebrou. Um segundo
   * de escurecimento, ao contrário, é o próprio anúncio do modo — dá tempo de
   * ver as tochas acendendo antes de a primeira horda aparecer.
   */
  updateNight(dt) {
    if (this.night === this.nightTarget) return;
    const passo = dt / 1.2;
    if (this.night < this.nightTarget) {
      this.night = Math.min(this.nightTarget, this.night + passo);
    } else {
      this.night = Math.max(this.nightTarget, this.night - passo);
    }
    this.renderer.setNight(this.night);
  }

  /** Painel do modo zumbi: horda, restantes, vidas e o contador de renascimento. */
  updateZombieHud() {
    const st = this.zombieState;
    if (!st || this.mode !== "zombie") {
      if (this._zombieHudOn) {
        this.hud.setZombie(null);
        this._zombieHudOn = false;
      }
      return;
    }
    this._zombieHudOn = true;

    const eu = st.lives?.find((l) => l.id === this.net.me?.id);
    this.hud.setZombie({
      horde: st.horde,
      hordes: CONFIG.modes.zombie.hordes,
      // O número de zumbis é contado DAQUI, da lista que chega a 10 Hz, e não do
      // status: assim ele cai no instante em que o corpo cai na tela, em vez de
      // esperar a próxima mensagem de estado.
      remaining: this.zombies.counts.alive,
      lives: eu?.lives ?? CONFIG.modes.zombie.lives,
      maxLives: CONFIG.modes.zombie.lives,
    });

    if (st.over) return; // a faixa de fim já está na tela

    // Contador de renascimento, só para quem está esperando.
    const falta = (eu?.until ?? 0) - this.net.serverTime;
    if (falta <= 0) {
      this.hud.hideZombieCenter();
      return;
    }
    {
      const seg = Math.ceil(falta / 1000);
      const semVidas = (eu?.lives ?? 0) === 0;
      this.hud.showZombieCenter(
        String(seg),
        semVidas ? "sem vidas — voltando com três" : "voltando ao centro",
      );
    }
  }

  /**
   * Countdown de respawn no modo alce — mesma faixa central do zumbi.
   * Enquanto o número está na tela, o jogador está morto (espectador: só
   * olha ao redor; movimento e tiro já estão bloqueados por `death.dying`).
   */
  updateElkHud() {
    if (this.mode !== "elkHunt") {
      if (this._elkHudCountdown) {
        this.hud.hideZombieCenter();
        this._elkHudCountdown = false;
      }
      return;
    }
    const st = this.elkState;
    if (!st || st.over) return;

    const eu = st.downs?.find((d) => d.id === this.net.me?.id);
    const falta = (eu?.until ?? 0) - this.net.serverTime;
    if (falta <= 0) {
      if (this._elkHudCountdown) {
        this.hud.hideZombieCenter();
        this._elkHudCountdown = false;
      }
      return;
    }
    this._elkHudCountdown = true;
    this.hud.showZombieCenter(String(Math.ceil(falta / 1000)), "renascendo…");
  }

  updateHud() {
    const fraction = drawFraction(this.drawTime);
    this.hud.setDraw(fraction, fraction > 0 ? drawSpeed(this.drawTime) : 0);
    this.hud.setFocus(this.aim.focusDistance, this.aim.hasFocus);
    this.hud.setWind(
      this.wind.speed,
      this.wind.relativeAngle(this.aimYaw ?? 0),
    );
    /* Quantos bichos existem em campo AGORA, em qualquer modo. É informação de
       situação, não de modo: saber que há doze porcos vivos muda o que se faz
       em seguida, e não saber é ficar girando a câmera procurando. */
    const bc = this.boars.counts;
    this.hud.setCreatureCounts(bc.alive, bc.dead, this.elks.counts.alive, this.birds.counts.alive);

    // A barra de vida do alce mais próximo, fixa na tela: a do bicho fica sobre
    // a cabeça dele e some quando ele está atrás de você — que é justamente
    // quando você mais precisa saber se ele está quase caindo.
    const alce = this.elks.nearestAlive(this.player.position);
    this.hud.setElk(alce ? alce.health : null, alce?.state ?? null);

    this.updateZombieHud();
    this.updateElkHud();
  }

  start() {
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame.bind(this));
  }
}

/* ------------------------------------------------------------- bootstrap --

   O mundo é montado EM PARALELO com a pessoa digitando o nome.

   Carregar o WASM da física, esculpir o terreno e espalhar a vegetação leva
   alguns segundos — e esse tempo cabe inteiro dentro do tempo de escrever um
   apelido. Quem chega vê um campo para preencher, não uma barra de progresso, e
   quando aperta o botão o jogo já está pronto: entra na hora.
   -------------------------------------------------------------------------- */

async function main() {
  /* A qualidade é resolvida ANTES de qualquer coisa ser construída.
     Shadow map, densidade da grama, contagem de estrelas e o assado de AO do
     terreno são decididos no build da cena — depois disso, mudar de preset
     exigiria reconstruir o mundo. Daí ser a primeira linha. */
  applyQuality(savedQuality());

  const lobby = new Lobby(document.getElementById("lobby"));

  let game;
  try {
    lobby.setStep("carregando física (WASM)…");
    await initPhysics();
    game = new Game(new PhysicsWorld(), (passo) => lobby.setStep(passo));
  } catch (err) {
    console.error(err);
    lobby.setError(`falhou: ${err.message}`);
    return;
  }

  window.game = game;
  lobby.setReady();

  lobby.onEnter = async (nome) => {
    // Um erro aqui (sala cheia, servidor fora) volta para o lobby com a
    // mensagem: quem tentou entrar precisa saber por que não entrou.
    await game.connect(nome);
    lobby.hide();
    game.start();
  };
}

main();
