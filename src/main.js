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
import { LevelManager, DEFAULT_LEVEL } from "./levels/index.js";
import {
  levelPhysics,
  levelInfo,
  levelAllowsMode,
  levelHasFauna,
} from "./shared/levels.js";
import { Player } from "./entities/player.js";
import { ArrowManager } from "./entities/arrow.js";
import { Wind } from "./systems/wind.js";
import { CameraRig } from "./systems/camera.js";
import { AimSolver } from "./systems/aim.js";
import { TrailManager } from "./systems/trails.js";
import { Input } from "./systems/input.js";
import { PlayerPhysics } from "./systems/playerPhysics.js";
import { Jetpack } from "./systems/jetpack.js";
import { AudioSystem } from "./systems/audio.js";
import { ParticleSystem } from "./systems/particles.js";
import { installImpactEffects, RECEITAS } from "./systems/impactFx.js";
import { BoarManager } from "./systems/boarManager.js";
import { ElkManager } from "./systems/elkManager.js";
import { BirdManager } from "./systems/birdManager.js";
import { ZombieManager } from "./systems/zombieManager.js";
import { TorchRing } from "./systems/torches.js";
import { StormSystem } from "./systems/storm.js";
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

function isZombieMode(mode) {
  return mode === "zombie" || mode === "zombieBoss";
}

/** Nomes legíveis para o diálogo de confirmação ao trocar de modo. */
const MODE_LABELS = {
  free: "modo livre",
  boarHunt: "caçada aos porcos",
  birdHunt: "caça aos pássaros",
  series: "alvos em série",
  elkHunt: "caçada ao alce",
  zombie: "noite dos zumbis",
  zombieBoss: "chefão zumbi",
};

/** Milímetro de precisão: de sobra para a rede e metade dos bytes. */
const mm = (v) => Math.round(v * 1000) / 1000;

/**
 * Espera o próximo quadro — ou 100 ms, o que vier primeiro.
 *
 * O `requestAnimationFrame` sozinho parece a escolha óbvia e tem uma armadilha:
 * **navegador não entrega rAF para aba em segundo plano**. Quem troca de aba no
 * meio de um carregamento (e trocar de aba durante um carregamento é
 * exatamente o que as pessoas fazem) volta para um jogo travado para sempre no
 * meio da troca, sem erro no console e sem nada na tela explicando.
 *
 * Com a corrida, o carregamento continua na aba oculta — mais devagar, porque
 * 100 ms é bem mais que um quadro, mas continua. E quando a aba está visível o
 * rAF ganha sempre, então o caminho normal não paga nada por isto.
 */
const nextFrame = () =>
  new Promise((resolve) => {
    let pronto = false;
    const fim = () => {
      if (pronto) return;
      pronto = true;
      resolve();
    };
    requestAnimationFrame(fim);
    setTimeout(fim, 100);
  });

class Game {
  /* ------------------------------------------------------- a fase em cena --

     Terreno, cenário e alvos pertencem à FASE, não ao jogo. Estes acessores
     existem para que o resto do arquivo continue escrevendo `this.terrain` sem
     saber disso — e, mais importante, para que ninguém guarde a referência.

     Guardar era o problema antigo: dez lugares copiavam `this.terrain` no
     construtor, e depois de uma troca de fase todos apontariam para o vale que
     já foi demolido. Lido de dentro, o terreno certo é sempre o da fase que
     está em cena. */

  get terrain() {
    return this.levels.terrain;
  }

  /** A fase em si. Quem chamava `environment.update`/`.flags` continua valendo. */
  get environment() {
    return this.levels.current;
  }

  /** Os alvos fixos do campo de tiro. Fases sem eles devolvem lista vazia. */
  get targets() {
    return this.levels.current?.targets ?? [];
  }

  constructor(physics, setStep = () => {}) {
    this.physics = physics;
    this.sync = new BodySync();

    setStep("montando a cena…");
    this.renderer = new Renderer(document.getElementById("scene"));
    this.scene = this.renderer.scene;

    /* ---------------------------------------------------------------- fase --
       O cenário não é mais construído aqui: ele é uma FASE, com dono e ciclo de
       vida, e o gerente é quem sabe montá-la e desmontá-la. Ver `levels/`.

       O contexto abaixo é tudo o que uma fase precisa para nascer, mais os dois
       ganchos que religam o jogo depois de uma troca. */
    this.levels = new LevelManager({
      scene: this.scene,
      physics,
      sync: this.sync,
      nextFrame,
      beforeDispose: () => this.beforeLevelDispose(),
      onLevelReady: (fase) => this.onLevelReady(fase),
    });

    setStep("esculpindo o vale…");
    this.levels.build(DEFAULT_LEVEL, (_f, texto) => setStep(texto));

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
    /* O bando precisa saber onde ficam as copas, e só a fase sabe: o servidor
       manda "pouse por aqui" com um (x, z) e a árvore é achada aqui. O `?.` não
       é zelo excessivo — há fase sem árvore nenhuma, e lá a resposta certa é
       null, que deixa a ave no ar em vez de pousá-la no vazio. */
    this.birds = new BirdManager(this.scene, physics, this.terrain, (x, z) =>
      this.environment?.nearestPerch?.(x, z) ?? null,
    );
    this.zombies = new ZombieManager(this.scene, physics, this.terrain, this.arrows);
    this.torches = new TorchRing(this.scene, physics, this.terrain);
    /** Tempestade cosmética do chefão — ver `systems/storm.js`. */
    this.storm = new StormSystem(this.scene, this.renderer, {
      getListenerPos: () => this.renderer.camera.position,
      getBoss: () => {
        for (const bicho of this.zombies.byNetId.values()) {
          if (bicho.kind === "boss" && !bicho.dead) return bicho;
        }
        return null;
      },
      heightAt: (x, z) => this.terrain.heightAt(x, z),
    });
    /** 0 = dia, 1 = noite. Persegue `nightTarget` — ver `updateNight`. */
    this.night = 0;
    this.nightTarget = 0;
    /** Luzes curtas a cada flecha no chefão (sem sombra). */
    this._bossFlashes = [];
    /** Último estado do modo zumbi vindo da sala (horda, caídos). */
    this.zombieState = null;
    this.elkState = null;
    this._elkHudCountdown = false;
    /** A tela de vitória da caçada está na tela, esperando o Enter que a fecha. */
    this.huntVictoryOpen = false;
    /** Troca de fase em curso: o mundo não existe e o laço fica congelado. */
    this.swappingLevel = false;
    /** Preparação coordenada da noite — bloqueia a entrada até o aquecimento. */
    this.modePreparing = false;
    this.modePrepareToken = null;
    this.modePrepareTarget = null;
    this.modePrepareLevel = null;
    this.modePreparePromise = null;

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
      // Para as linhas de fase e o critério de aceite da troca.
      levels: this.levels,
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
    /** Segundos restantes do golpe de faca (0 = sem golpe). */
    this.knifeTimer = 0;
    this.knifeHitIds = new Set();
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
      if (e.boss && e.impact) this.spawnBossFlash(e.impact, id);
      const limiar = CONFIG.modes.zombie.fullDrawKillSpeed ?? CONFIG.bow.maxSpeed * 0.98;
      const fullDraw = (e.speed ?? 0) >= limiar;
      // Lobo, headshot ou tensão máxima: caem na hora — chefão só cai no servidor.
      if (e.wolf || (!e.boss && (e.head || fullDraw))) this.zombies.kill(id, e.head === true);
      const payload = {
        id,
        head: e.head === true,
        d: Math.round(e.distance * 100) / 100,
        v: Math.round((e.speed ?? 0) * 10) / 10,
      };
      /* Ponto de contato: as outras telas usam para o clarão vermelho do chefão. */
      if (e.boss && e.impact) {
        payload.c = [mm(e.impact.x), mm(e.impact.y), mm(e.impact.z)];
      }
      this.net.send(C2S.ZOMBIE_HIT, payload);
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
      this.applyZombieMode(isZombieMode(msg.snapshot.mode?.mode));
      if (msg.snapshot.zombies?.length) this.zombies.applyNetwork(msg.snapshot.zombies);
      this.torches.setStates(msg.snapshot.torches);
      this.zombieState = msg.snapshot.zombieStatus ?? null;
      this.elkState = msg.snapshot.elkStatus ?? null;
      this.series.setTarget(msg.snapshot.series ?? null);
      this.applyMode(msg.snapshot.mode);
      if (msg.snapshot.mode?.preparing) {
        this.beginModePreparation(msg.snapshot.mode.preparing);
      }
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
        this.arrows.removeAttachedTo(this.player);
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
        this.cancelKnifeAttack();
        this.drawTime = 0;
        this.input.drawing = false;
      } else {
        const remoto = this.remotes.get(msg.id);
        if (remoto) {
          this.arrows.removeAttachedTo(remoto.player);
          remoto.applySpawn(msg);
        }
      }
    });

    net.on(S2C.KILL, (msg) => {
      if (msg.victim === net.me?.id) {
        this.cancelKnifeAttack();
        this.death.begin(net.serverTime, msg);
      }
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
        } else if (msg.cause === "boar") {
          gameEvents.emit(EventType.AUDIO_PLAY, {
            sound: "boarIdle",
            position: onde,
            volume: 1.4,
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
        {
          text:
            msg.cause === "knife" ? "  🔪  " : msg.cause === "boar" ? "  🐗  " : "  🏹  ",
        },
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

    net.on(S2C.BIRDS, (msg) => {
      if (msg.clear) this.birds.clear();
      else this.birds.applyNetwork(msg.k);
    });

    net.on(S2C.BIRD_DEATH, (msg) => {
      this.birds.kill(msg.id);
      this.killFeed.push([
        { text: msg.killerName, color: msg.killerColor, forte: true },
        { text: msg.special ? "  \u{1F426}\u2726  " : "  \u{1F426}  " },
        { text: `+${msg.points}`, forte: true },
        { text: `   ${(msg.distance ?? 0).toFixed(0)} m` },
      ]);
    });

    net.on(S2C.BIRD_HUNT_OVER, (msg) => {
      this.huntVictoryOpen = true;
      this.hud.showBirdVictory(msg.ranking ?? [], this.net.me?.id, msg.reason);
      gameEvents.emit(EventType.AUDIO_PLAY, {
        sound: "victoryFanfare",
        position: vec3Payload(this.player.position),
        volume: 1.0,
      });
    });

    /* O mundo recomeçou (alguém trocou de modo). A limpeza do CENÁRIO vem em
       mensagens próprias; o que sobra para cá é o que só existe nesta máquina:
       as flechas cravadas e o contador local de acertos. */
    net.on(S2C.WORLD_RESET, () => {
      this.arrows.clearAll();
      this.remoteArrows.clear();
      this.birds.clear();
      this.zombies.clear();
      this.cancelKnifeAttack();
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

    /* Clarão vermelho do chefão nas telas de quem NÃO atirou. Quem atirou
       já viu no evento local — este pacote é só para o resto da sala. */
    net.on(S2C.ZOMBIE_HIT, (msg) => {
      const boss = this.zombies.byNetId.get(msg.id);
      if (!boss || boss.kind !== "boss") return;
      const impact = Array.isArray(msg.c)
        ? { x: msg.c[0], y: msg.c[1], z: msg.c[2] }
        : {
            x: boss.position.x,
            y: boss.position.y + (boss.bodyHeight ?? 15) * 0.55,
            z: boss.position.z,
          };
      this.spawnBossFlash(impact, msg.id);
    });

    net.on(S2C.ZOMBIE_DEATH, (msg) => {
      this.zombies.kill(msg.id, msg.head);
      if (msg.boss) this.hud.setBossHp(null);
      this.killFeed.push([
        { text: msg.killerName, color: msg.killerColor, forte: true },
        {
          text: msg.knife
            ? "  \u{1F52A}  "
            : msg.boss
              ? "  \u{1F480}  "
              : msg.wolf
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
      this.hud.announceHorde(msg.n, msg.size, msg.boss === true);
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

    net.on(S2C.MODE_PREPARE, (msg) => this.beginModePreparation(msg));
    net.on(S2C.MODE_PREPARE_CANCEL, () => this.cancelModePreparation());
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

    /* DURANTE A TROCA DE FASE não existe mundo: o cenário antigo foi demolido,
       o mundo de física foi liberado e o novo ainda está sendo construído. Nada
       aqui embaixo tem o que simular — `terrain` é null, a cápsula do jogador
       não existe e o passo da física operaria sobre corpos que já não estão lá.

       Congelar o quadro inteiro é mais seguro do que espalhar trinta guardas
       pelo laço, e é mais honesto: o jogo não está rodando devagar, ele está
       parado, que é exatamente o que a barra de carregamento está dizendo.

       O `render` continua para a barra pintar, e o `rAF` continua para o laço
       não morrer — sem ele, a troca terminaria e ninguém retomaria o jogo. */
    if (this.swappingLevel) {
      this.input.consume(); // descarta a entrada acumulada no carregamento
      this.renderer.render(0, this.wind.vector);
      requestAnimationFrame(this.frame.bind(this));
      return;
    }

    const actions = this.input.consume();
    this.handleActions(actions);

    // A ORDEM importa: a câmera define a mira (systems/aim.js), então ela é
    // posicionada ANTES do raycast, e o raycast antes do disparo.
    this.syncCameraMode();
    this.updateAimAndPose(dt, actions);
    // Não recebe `dt`: os dois gatilhos são de ESTADO (tocou o chão, cruzou meio
    // ciclo de passada), não de tempo decorrido. Ver `updateFootDust`.
    this.updateFootDust();
    this.updateJetFlame(dt);
    this.updateCamera(dt);
    this.solveAim();
    if (
      actions.release &&
      !this.modePreparing &&
      !this.death.dying &&
      !this.player.isReloading &&
      !this.player.isKnifeAttacking
    ) {
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
    this.updateBossStorm(dt);
    if (this._zombieOn) this.audio.tickAmbient(dt, this.renderer.camera.position);
    this.trails.update(dt);
    this.particles.update(dt);
    this.updateBossFlashes(dt);
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
    if (this.modePreparing) return;
    if (a.knifeAttack) this.beginKnifeAttack();
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

    if (a.setMode) this.askModeChange(a.setMode);
    if (a.setLevel) this.askLevelChange(a.setLevel);
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
   * Prepara a noite enquanto a sala ainda está no modo anterior. A tela cobre
   * os poucos frames em que o renderer compila as variantes de luz pontual e os
   * meshes da horda; só depois o cliente se declara pronto para a sala.
   */
  beginModePreparation(msg) {
    if (msg?.token == null) return;
    /* Duas coisas passam por aqui agora: a noite dos zumbis, que compila
       shaders, e a TROCA DE FASE, que destrói um mundo e constrói outro. As
       duas custam centenas de milissegundos e as duas precisam que a sala
       espere todo mundo — o que muda é só o que se faz durante a espera. */
    const trocaDeFase = msg.level != null && msg.level !== this.levels.id;
    if (!isZombieMode(msg.mode) && !trocaDeFase) return;

    if (this.modePreparing && this.modePrepareToken === msg.token) {
      this.hud.updateModeLoading(msg.ready ?? 0, msg.total ?? 1, "aguardando os outros jogadores…");
      return;
    }

    this.cancelModePreparation();
    this.modePreparing = true;
    this.modePrepareToken = msg.token;
    this.modePrepareTarget = msg.mode;
    this.modePrepareLevel = trocaDeFase ? msg.level : null;

    const titulo = trocaDeFase
      ? `viajando para ${levelInfo(msg.level).nome.toLowerCase()}…`
      : msg.mode === "zombieBoss"
        ? "preparando o chefão…"
        : "preparando a noite…";
    this.hud.showModeLoading(titulo);
    this.hud.updateModeLoading(msg.ready ?? 0, msg.total ?? 1, "preparando…");
    this.playerPhysics.setHorizontalMove(0, 0);

    if (!trocaDeFase) {
      // Aquecimento da noite. Numa troca de fase isto não faz sentido: o mundo
      // que seria aquecido está prestes a deixar de existir.
      this.birds.clear();
      this.torches.build({ dormant: true });
      this.zombies.prepare();
    }

    const token = msg.token;
    this.modePreparePromise = this.finishModePreparation(token).finally(() => {
      if (this.modePrepareToken === token) this.modePreparePromise = null;
    });
  }

  async finishModePreparation(token) {
    /* Caminho da TROCA DE FASE: demole, reconstrói e só então se declara
       pronto. A tela de carregamento já está na frente — `changeLevel` a
       reaproveita e vai preenchendo o progresso. */
    if (this.modePrepareLevel) {
      await this.changeLevel(this.modePrepareLevel, {
        titulo: `viajando para ${levelInfo(this.modePrepareLevel).nome.toLowerCase()}…`,
        keepOverlay: true,
      });
      if (this.modePrepareToken !== token || !this.modePreparing) return;
      this.hud.updateModeLoading(1, 1, "sincronizando a entrada…");
      this.net.send(C2S.MODE_READY, { mode: this.modePrepareTarget, token });
      return;
    }

    this.zombies.setWarmupVisible(true);
    this.torches.setWarmupVisible(true);
    this.hud.updateModeLoading(0, 1, "aquecendo iluminação e shaders…");

    // Dá ao navegador um frame para pintar o overlay antes de compilar.
    await nextFrame();
    if (this.modePrepareToken !== token) return;

    try {
      await this.renderer.prewarmNight();
    } catch (err) {
      // A compilação paralela é uma otimização. Um navegador sem suporte não
      // pode impedir a partida; o primeiro frame apenas compila de forma normal.
      console.warn("pré-aquecimento da noite indisponível:", err);
    }

    if (this.modePrepareToken !== token || !this.modePreparing) return;
    this.zombies.setWarmupVisible(false);
    this.torches.setWarmupVisible(false);
    this.hud.updateModeLoading(1, 1, "sincronizando a entrada…");
    this.net.send(C2S.MODE_READY, { mode: this.modePrepareTarget, token });
  }

  cancelModePreparation() {
    if (!this.modePreparing && this.modePrepareToken == null) return;
    this.modePreparing = false;
    this.modePrepareToken = null;
    this.modePrepareTarget = null;
    this.modePrepareLevel = null;
    this.modePreparePromise = null;
    this.zombies.setWarmupVisible(false);
    this.torches.setWarmupVisible(false);
    this.hud.hideModeLoading();
  }

  /**
   * O modo mudou (ou um convite de duelo apareceu).
   *
   * O duelo é convite e não decreto: apertar `2` marca você como pronto e
   * avisa a sala; a partida só começa quando dois ou mais aceitam. Quem estava
   * treinando não é arrastado para uma briga por causa da tecla de outro.
   */
  applyMode(msg) {
    if (!msg) return;
    if (this.modePreparing) this.cancelModePreparation();

    /* REDE DE SEGURANÇA DA FASE.
     *
     * O caminho normal é o handshake: a sala prepara, todos carregam, ela
     * confirma. Mas há dois caminhos que pulam a preparação — quem ENTRA na
     * sala já com uma partida em curso, e quem perdeu a mensagem de preparo
     * por uma queda de rede. Nos dois, esta é a única chance de descobrir que
     * o mundo é outro, e sem ela a pessoa jogaria no vale com todo mundo na
     * Lua, vendo os amigos flutuarem dentro de uma montanha. */
    if (msg.level && msg.level !== this.levels.id && !this.swappingLevel) {
      this.changeLevel(msg.level, {
        titulo: `viajando para ${levelInfo(msg.level).nome.toLowerCase()}…`,
      });
    }

    const mudouModo = this.mode !== msg.mode;
    if (mudouModo) this.cancelKnifeAttack();
    this.mode = msg.mode;
    this.scoreboard.setMode(msg.mode);

    /* No modo série, os sete alvos fixos SOMEM — o campo fica limpo e existe um
       alvo só, o da vez. Deixá-los na cena tiraria o sentido do modo: com alvos
       espalhados por toda parte, "o próximo está mais longe" não significa nada,
       e ainda por cima uma flecha perdida cravaria num alvo velho. */
    /* Os alvos fixos somem na série (um alvo por vez é o modo) e na noite dos
       zumbis — lá o pedido é campo limpo: nem mira, nem madeira, nem bicho. */
    const escondeFixos = msg.mode === "series" || isZombieMode(msg.mode);
    for (const alvo of this.targets) alvo.setActive(!escondeFixos);
    this.marker.visible = !escondeFixos;
    this.hud.setMode(
      msg.mode,
      msg.invites ?? [],
      msg.needed ?? 2,
      this.net.me?.id,
      msg.level ?? this.levels.id,
    );

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

    this.applyZombieMode(isZombieMode(msg.mode));
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
    const bloqueadaAoEntrar = isZombieMode(mode) || mode === "elkHunt";
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

  /* ------------------------------------------------------ troca de fase --- */

  /**
   * Pedido de troca de fase pelo teclado.
   *
   * Confirma antes porque a fase é da SALA inteira: apertar `9` sem querer
   * arrancaria doze pessoas do meio de uma partida. Não é convite — quem
   * confirma leva todo mundo junto, como as teclas de modo cooperativo já
   * fazem hoje.
   *
   * A troca em si ainda é LOCAL: a sincronia pela sala é a etapa seguinte
   * (`docs/plano-fases.md`, F0.4). Jogando sozinho, funciona por inteiro.
   */
  askLevelChange(id) {
    if (this.swappingLevel) return;

    /* A MESMA TECLA leva e traz. Sem isso, quem foi para a Lua não teria como
       voltar: as teclas 1–8 são de MODO, e modo não é fase. Uma tecla que só
       funciona de ida é uma tecla quebrada na metade das vezes que se aperta. */
    const alvo = this.levels.id === id ? DEFAULT_LEVEL : id;
    const nome = levelInfo(alvo).nome;
    const artigo = alvo === "moon" ? "a Lua" : `o ${nome}`;

    this.ask(`Ir para ${artigo}?`, () => {
      /* A FASE É DA SALA. Quem confirma pede ao servidor, que prepara todo
         mundo junto e só então confirma a troca — trocar localmente deixaria
         cada um numa fase, com as poses dos outros chegando em coordenadas de
         um terreno que não é o seu. Sem servidor (queda de rede), a troca local
         ainda funciona e é melhor que uma tecla que não faz nada. */
      if (this.net.connected) this.net.send(C2S.LEVEL, { level: alvo });
      else this.changeLevel(alvo, { titulo: `viajando para ${nome.toLowerCase()}…` });
    });
  }

  /**
   * Troca a fase em cena, com carregamento.
   *
   * O `swappingLevel` congela o laço principal enquanto o mundo não existe
   * (ver `frame`), e o `finally` o desliga mesmo se a construção estourar —
   * sem isso, um erro no meio da troca deixaria o jogo parado para sempre,
   * sem nada na tela explicando o quê.
   *
   * @returns {Promise<object|null>} diagnóstico da troca (`ms`, `freed`)
   */
  async changeLevel(id, { titulo = "carregando fase…", force = false, keepOverlay = false } = {}) {
    if (this.swappingLevel) return null;
    // `force` existe para o critério de aceite: reconstruir a MESMA fase é o
    // teste que prova a mecânica sem nenhuma variável nova — se `vale → vale`
    // não muda nada na tela e não vaza memória, a troca está certa.
    if (this.levels.id === id && !force) return null;

    this.swappingLevel = true;
    this.hud.showModeLoading(titulo);
    try {
      const info = await this.levels.swap(id, (f, texto) => {
        this.hud.updateModeLoading(f, 1, texto);
      });
      return info;
    } catch (err) {
      console.error("troca de fase falhou:", err);
      this.hud.toast("falha ao trocar de fase", "miss");
      return null;
    } finally {
      this.swappingLevel = false;
      /* Numa troca em rede a tela FICA: o mundo local já está pronto, mas a
         sala ainda espera os outros clientes. Escondê-la aqui devolveria o
         controle a quem terminou primeiro, e ele passaria segundos jogando
         sozinho numa fase que os amigos ainda estão carregando. */
      if (!keepOverlay) this.hud.hideModeLoading();
      this.lastTime = performance.now(); // não cobra o carregamento como dt
    }
  }

  /**
   * Última chamada antes de a fase ser demolida.
   *
   * Aqui morre tudo o que tem CORPO no mundo de física atual e não pertence à
   * fase: bichos, flechas voando, flechas cravadas, tochas, o alvo da série.
   *
   * A ordem importa e é o motivo de este gancho existir separado. Cada um
   * desses `clear()` remove os próprios corpos do mundo — e se rodassem depois
   * do `physics.recreate()`, estariam removendo corpos de um mundo já
   * liberado. O Rapier não avisa quando isso acontece: ele quebra, e quebra
   * um passo depois, longe da causa.
   */
  beforeLevelDispose() {
    this.boars.clear();
    this.elks.clear();
    this.birds.clear();
    this.zombies.clear();
    this.torches.clear();
    this.series.clear();
    this.arrows.clearAll();
    this.trails.clear();
    this.storm.setActive(false);
    this.death.ragdoll.stop();
  }

  /**
   * A fase nova está de pé: religar quem atravessou a troca.
   *
   * São duas famílias de conserto. A primeira é o TERRENO: meia dúzia de
   * sistemas precisam saber onde é o chão, e o chão é outro. A segunda é a
   * FÍSICA: o mundo é novo, então a cápsula do jogador, as cápsulas dos
   * remotos e o colisor que a mira ignora deixaram de existir.
   *
   * Roda também na primeira montagem, quando quase nada disto existe ainda —
   * daí as guardas. É de propósito: um caminho só para montar e para trocar
   * significa que a troca exercita o mesmo código todo dia, em vez de um
   * caminho especial que só roda quando alguém aperta a tecla.
   */
  /**
   * Escreve a física da fase onde o jogo já a lê.
   *
   * Não há indireção nova: gravidade, densidade do ar, força do salto e os
   * limites da flecha continuam saindo de `CONFIG`, exatamente como sempre —
   * só que agora `CONFIG` é reescrito na troca de fase. É o mesmo caminho que
   * `applyQuality()` usa para os presets gráficos, e é o que evita ter de
   * caçar e trocar uma dúzia de leitores espalhados.
   *
   * Os valores de referência não se perdem nisso: eles estão congelados em
   * `shared/levels.js`, capturados antes de qualquer escrita.
   */
  applyLevelPhysics(id) {
    const f = levelPhysics(id);

    CONFIG.physics.gravity = f.gravity;
    /* Zerar a densidade DESLIGA O ARRASTO PELA CONTA: a força é proporcional a
       ρ (ver `entities/arrow.js`). Não existe um `if (lua)` na aerodinâmica. */
    CONFIG.physics.airDensity = f.airDensity;
    CONFIG.player.jumpSpeed = f.jumpSpeed;
    CONFIG.player.runSpeed = f.runSpeed;
    CONFIG.arrow.maxLifetime = f.arrow.maxLifetime;
    CONFIG.arrow.maxAltitude = f.arrow.maxAltitude;

    this.physics.gravity = f.gravity;

    /* Sem ar não há vento — e sem vento a bandeira do HUD não tem o que dizer.
       O influxo do vento na flecha é decisão da SALA nos outros modos, mas aqui
       ele é impossível, não desligado: não há o que soprar. */
    // Guardas porque isto também roda na PRIMEIRA montagem, quando metade do
    // jogo ainda não existe. Um caminho só para montar e para trocar significa
    // que a troca exercita o mesmo código todo dia.
    this.wind?.setEnabled(f.wind);
    if (!f.wind && this.arrows) this.arrows.options.windInfluence = false;

    /* Sem ar e sem vento é a mesma coisa que vácuo, e vácuo é o que o céu
       precisa saber: preto até o chão, Sol sem halo, sem névoa, estrelas de
       dia. Uma condição só decide as duas metades do cenário — não há como o
       céu dizer "Lua" enquanto a física diz "vale". */
    this.renderer.setSpace(f.airDensity <= 0 ? 1 : 0);

    /* O jetpack é EQUIPAMENTO DA FASE, não do jogador: quem vai à Lua ganha um,
       quem volta ao vale devolve. Passar `null` restaura o movimento de sempre,
       sem nenhum `if (lua)` dentro do caminho do salto. */
    /* Fase sem fauna: nada de canto de passarinho e nada de contador de porco
       na tela. Uma decisão, duas consequências.
     *
     * O que NÃO se faz aqui é limpar os bichos. Esta função roda DEPOIS do
     * `physics.recreate()`, e `birds.clear()` remove os corpos de cada ave do
     * mundo — do mundo que acabou de ser liberado. O Rapier responde a isso com
     * um "null pointer passed to rust" que derruba a troca inteira no meio, e o
     * sintoma visível é outro: a fase troca, mas a gravidade e o HUD ficam com
     * os valores antigos, porque a exceção abortou o resto desta função.
     *
     * A varredura de bichos é do `beforeLevelDispose`, que roda ANTES da troca
     * de mundo e já limpa todos eles. */
    const temFauna = levelHasFauna(id);
    this.audio?.setAmbientSpace(!temFauna);
    this.hud?.setFauna(temFauna);

    this.jetpack = f.jetpack ? new Jetpack(f.jetpack) : null;
    this.playerPhysics?.setJetpack(this.jetpack);
    this.player?.setJetpackVisible(!!this.jetpack);
    // Os remotos usam a mesma fase, então ganham e perdem a mochila junto —
    // inclusive quem entrar DEPOIS da troca (ver `RemotePlayers.add`).
    this.remotes?.setJetpackVisible(!!this.jetpack);

    this.levelPhysicsInfo = f;
  }

  onLevelReady(fase) {
    const terrain = fase.terrain;
    this.applyLevelPhysics(this.levels.id);

    if (this.player) this.player.terrain = terrain;
    if (this.death) {
      this.death.terrain = terrain;
      this.death.ragdoll.terrain = terrain;
    }
    for (const sistema of [this.boars, this.elks, this.birds, this.zombies, this.torches, this.series]) {
      if (sistema) sistema.terrain = terrain;
    }

    /* O poleiro das aves NÃO precisa ser religado: o callback que o
       `BirdManager` recebeu lê `this.environment`, que é um acessor para a fase
       em cena. Ele acompanha a troca sozinho — que é o ponto inteiro de ter
       trocado as capturas por acessores. */

    if (this.playerPhysics) {
      /* A posição do vale pode não existir na fase nova — fora da barreira da
         Lua, por exemplo. Sem esta checagem a pessoa nasceria num ponto de onde
         `isWalkable` é falso e ficaria colada no lugar, sem entender por quê. */
      if (!terrain.isWalkable(this.player.position.x, this.player.position.z)) {
        const c = terrain.spawnCenter ?? { x: CONFIG.spawn.centerX, z: CONFIG.spawn.centerZ };
        this.player.position.set(c.x, 0, c.z);
      }
      this.playerPhysics.rebuild();
      this.aim.setExcludedCollider(this.playerPhysics.collider);
    }
    if (this.remotes) this.remotes.setTerrain(terrain);
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
      // O servidor deixa de emitir aves imediatamente ao preparar a noite. A
      // limpeza local cobre o pacote que já estava na fila e evita voadores
      // congelados no céu durante a transição.
      this.birds.clear();
      this.torches.build();
      this.torches.setNight(this.night);
      this.syncCreatureShadows();
    } else {
      this.torches.clear();
      this.zombies.clear();
      this.zombieState = null;
      this.storm.setActive(false);
      this.hud.setZombie(null);
      this.hud.setBossHp(null);
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

  /**
   * Troca de modo (1–8). O duelo (2) é instantâneo — já funciona como convite
   * e pode ser cancelado com a mesma tecla. Os demais pedem confirmação para
   * evitar acionamento acidental no meio de uma partida.
   */
  askModeChange(mode) {
    if (!this.net.connected) return;

    /* Nem todo modo existe em toda fase. Os porcos, o alce, as aves, a horda e
       a série de alvos dependem de bacia plana, copas de árvore e trilha de
       terra — a Lua não tem nada disso, e a sala nem sequer sabe que existe uma
       Lua ainda (a sincronia de fase pela rede é a etapa seguinte).
       Deixar passar não daria um modo estranho: daria porcos pastando no vácuo
       sobre um terreno que só existe no cliente. */
    if (!levelAllowsMode(this.levels.id, mode)) {
      this.hud.toast(`${MODE_LABELS[mode] ?? mode} não existe ${this.levels.id === "moon" ? "na Lua" : "aqui"}`, "miss");
      return;
    }

    if (mode === "duel") {
      this.net.send(C2S.MODE, { mode });
      return;
    }
    if (this.mode === mode) return;
    const nome = MODE_LABELS[mode] ?? mode;
    this.ask(`Entrar no ${nome}?`, () => this.net.send(C2S.MODE, { mode }));
  }

  /** Começa a estocada, preservando o ponto atual da recarga. */
  beginKnifeAttack() {
    if (
      this.knifeTimer > 0 ||
      this.death.dying ||
      this.rig.isArrowCam ||
      this.input.drawing ||
      this.drawTime > 0.04
    ) {
      return;
    }

    this.knifeTimer = CONFIG.knife.duration;
    this.knifeHitIds.clear();
    this.input.drawing = false;
    this.drawTime = 0;
    this.player.setDraw(0);
    this.player.setKnife(0.001);
    gameEvents.emit(EventType.AUDIO_PLAY, {
      sound: "knifeSwing",
      position: vec3Payload(this.player.position),
      volume: 0.72,
    });
  }

  /** Resolve a varrida da lâmina contra os bichos próximos e em frente. */
  resolveKnifeHits() {
    const p = this.player.position;
    const frenteX = -Math.sin(this.player.yaw);
    const frenteZ = -Math.cos(this.player.yaw);
    const range = CONFIG.knife.range;

    for (const [id, alvo] of this.zombies.byNetId) {
      const hitKey = `z:${id}`;
      if (alvo.dead || this.knifeHitIds.has(hitKey)) continue;

      const dx = alvo.position.x - p.x;
      const dz = alvo.position.z - p.z;
      const distancia = Math.hypot(dx, dz);
      if (distancia > range) continue;
      const alinhamento =
        distancia > 0.001 ? (dx * frenteX + dz * frenteZ) / distancia : 1;
      if (alinhamento < CONFIG.knife.coneCos) continue;

      this.knifeHitIds.add(hitKey);
      this.net.send(C2S.KNIFE_HIT, {
        id,
        p: [mm(p.x), mm(p.y), mm(p.z)],
        y: this.player.yaw,
        d: Math.round(distancia * 100) / 100,
      });
    }

    for (const [id, remoto] of this.remotes.byId) {
      const alvo = remoto.player;
      const hitKey = `p:${id}`;
      if (remoto.dyingSince || alvo.invulnerable || this.knifeHitIds.has(hitKey)) continue;

      const dx = alvo.position.x - p.x;
      const dz = alvo.position.z - p.z;
      const distancia = Math.hypot(dx, dz);
      if (distancia > range) continue;
      const alinhamento =
        distancia > 0.001 ? (dx * frenteX + dz * frenteZ) / distancia : 1;
      if (alinhamento < CONFIG.knife.coneCos) continue;

      this.knifeHitIds.add(hitKey);
      this.net.send(C2S.KNIFE_PLAYER_HIT, {
        victim: id,
        p: [mm(p.x), mm(p.y), mm(p.z)],
        y: this.player.yaw,
        d: Math.round(distancia * 100) / 100,
      });
    }
  }

  cancelKnifeAttack() {
    this.knifeTimer = 0;
    this.knifeHitIds.clear();
    this.player.setKnife(0);
  }

  updateAimAndPose(dt, actions) {
    // Morto, o corpo cai e nada mais responde: não anda, não pula, não tensiona.
    // Sem isso o cadáver continuaria correndo pelo campo enquanto tomba.
    const preparando = this.modePreparing;
    const morto = this.death.dying || preparando;

    /* Timer do reload: avança mesmo andando/correndo, mas fica congelado durante
       a faca. Assim o golpe pode interromper a busca e ela continua depois. */
    const estavaAtacando = this.knifeTimer > 0;

    /* Se a chave do painel ~
       for desligada no meio, cancela na hora — senão a pessoa ficaria presa
       sem poder atirar com a animação "desligada". */
    if (!CONFIG.bow.reloadAnimation && this.reloadTimer > 0) {
      this.reloadTimer = 0;
    }
    if (morto) {
      this.reloadTimer = 0;
      this.knifeTimer = 0;
    } else if (this.reloadTimer > 0 && !estavaAtacando) {
      this.reloadTimer = Math.max(0, this.reloadTimer - dt);
    }
    if (!morto && estavaAtacando) {
      this.knifeTimer = Math.max(0, this.knifeTimer - dt);
    }

    const atacando = this.knifeTimer > 0;
    const knifeDuration = CONFIG.knife.duration;
    const knifeFraction = atacando
      ? 1 - this.knifeTimer / Math.max(0.001, knifeDuration)
      : 0;
    this.player.setKnife(knifeFraction);

    const recarregando = this.reloadTimer > 0;
    const dur = CONFIG.bow.reloadTime;
    this.player.setReload(recarregando && dur > 0 ? 1 - this.reloadTimer / dur : 0);

    this.input.blockDraw = this.rig.isArrowCam || morto || recarregando || atacando;
    this.input.blockDrawReason = preparando
      ? "modePrepare"
      : this.death.dying
        ? "dead"
        : atacando
        ? "knife"
        : this.rig.isArrowCam
          ? "arrowCam"
          : recarregando
            ? "reload"
            : null;
    if (atacando) {
      this.drawTime = 0;
      this.input.drawing = false;
    } else if (recarregando) {
      this.drawTime = 0;
      if (!this.input.primaryDown) this.input.drawing = false;
    } else if (
      this.input.primaryDown &&
      !morto &&
      !this.rig.isArrowCam &&
      !atacando &&
      !this.input.drawing
    ) {
      // Clique segurado durante o reload (ou câmera da flecha): assim que o
      // bloqueio some, começa a tensionar sem exigir um segundo clique.
      this.input.drawing = true;
    }

    if (this.input.drawing && !morto && !recarregando && !atacando) this.drawTime += dt;
    else if (morto) this.drawTime = 0;

    if (actions.jump && !morto && !atacando) this.player.jump();
    // O soltar vale SEMPRE, mesmo morto ou atacando: um jato que continua
    // queimando porque a tecla escapou é pior que qualquer regra de estado.
    if (actions.jumpReleased) this.player.jumpReleased();

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
      morto || atacando ? 0 : this.input.forward,
      morto || atacando ? 0 : this.input.strafe,
      morto || atacando ? false : this.input.run,
    );
    this.player.setAim(yaw, pitch);
    this.player.setDraw(atacando ? 0 : drawFraction(this.drawTime));
    this.player.update(dt, moving);
    if (atacando && knifeFraction >= CONFIG.knife.hitStart && knifeFraction <= CONFIG.knife.hitEnd) {
      this.resolveKnifeHits();
    }
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
  /**
   * O fogo do jetpack.
   *
   * Sai do pool de partículas que já existe, então NÃO custa uma chamada de
   * desenho nova — e não é uma `PointLight`: uma luz por jogador vezes doze é
   * exatamente o que derruba o modo zumbi, e um jato aceso é justamente o
   * momento em que ninguém pode perder quadros.
   *
   * O sopro sai PARA BAIXO e um pouco contra o movimento, porque é o gás que
   * empurra o corpo — e é essa direção que faz a chama ler como propulsão em
   * vez de fumaça. No vácuo ele não se dispersa em nuvem: as partículas seguem
   * em linha reta e somem, que é o que gás faz sem ar em volta.
   */
  updateJetFlame(dt) {
    const j = this.jetpack;
    // O fogo nos bocais do PRÓPRIO boneco. Vai antes do `return` porque apagar
    // também é trabalho: sem isto a chama fica acesa depois de soltar a tecla.
    this.player.setJetFlame(j?.active ? 1 : 0);
    // O rugido acompanha, e enfraquece junto com o tanque: o motor morrendo
    // é o aviso que se ouve sem tirar o olho da mira.
    this.audio.setJet(!!j?.active, j ? 0.55 + 0.45 * j.fuelFraction : 0);
    if (!j?.active) return;

    this._jetPuff = (this._jetPuff ?? 0) + dt;
    if (this._jetPuff < 0.02) return;
    this._jetPuff = 0;

    const p = this.player;
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: p.position.x, y: p.position.y + 0.75, z: p.position.z },
      count: 3,
      color: j.isLow ? 0xff5a2a : 0xffb347,
      speed: 7.5,
      spread: 0.22,
      direction: { x: 0, y: -1, z: 0 },
      size: 0.16,
      grow: 2.2,
      life: 0.34,
      // Sem ar: a brasa não flutua nem é freada, ela só cai devagar.
      gravity: -1.62,
      drag: 0.2,
      alpha: 0.8,
    });
  }

  updateFootDust() {
    const p = this.player;
    const noChao = !p.airborne;

    /* A poeira do POUSO, proporcional à altura da queda.
     *
     * Antes era uma nuvem de tamanho fixo: descer do topo do foguete levantava
     * a mesma pitada que um pulinho no lugar. Medindo o ponto mais alto do voo
     * e comparando com onde os pés tocaram, a nuvem passa a CONTAR a queda —
     * quem viu o baque de longe sabe que veio de cima. */
    if (!noChao) {
      this._apiceQueda = Math.max(this._apiceQueda ?? p.position.y, p.position.y);
    }

    if (this._eraAereo && noChao) {
      const altura = Math.max(0, (this._apiceQueda ?? p.position.y) - p.position.y);
      /* Satura em 30 m: acima disso a nuvem já ocupa a tela inteira, e crescer
         mais só atrapalharia a mira de quem acabou de pousar. */
      const f = Math.min(1, altura / 30);
      const cor = this.levelPhysicsInfo?.airDensity <= 0 ? 0xcfcac2 : 0xa8926a;

      gameEvents.emit(EventType.PARTICLES, {
        position: vec3Payload(p.position),
        count: Math.round(14 + 70 * f),
        color: cor,
        speed: 2.4 + 5.5 * f,
        // A nuvem abre PARA OS LADOS quanto mais forte o impacto: é o ar (ou,
        // na Lua, o próprio material) escapando por baixo do pé.
        spread: 0.95 + 0.5 * f,
        direction: { x: 0, y: 0.35 - 0.2 * f, z: 0 },
        size: 0.12 + 0.16 * f,
        grow: 1.8 + 1.4 * f,
        life: 0.7 + 1.6 * f,
        gravity: CONFIG.physics.gravity * 0.16,
        drag: 3.2 - 2.4 * f,
        alpha: 0.42 + 0.3 * f,
      });
      this._apiceQueda = null;
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
    this.rig.setFirstPerson(
      this.input.firstPerson && !this.death.dying && !this.player.isKnifeAttacking,
    );
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
    const h = CONFIG.physics.fixedStep;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= h && steps < CONFIG.physics.maxSubSteps) {
      this.sync.saveState();
      this.playerPhysics.step(h);
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
    if (this.night !== this.nightTarget) {
      const passo = dt / 1.2;
      if (this.night < this.nightTarget) {
        this.night = Math.min(this.nightTarget, this.night + passo);
      } else {
        this.night = Math.max(this.nightTarget, this.night - passo);
      }
      this.renderer.setNight(this.night);
      this.syncCreatureShadows();
    }
    this.torches.setNight(this.night);
  }

  /** Zumbis/lobos não projetam sombra no modo zumbi — o passe não compensa o ganho. */
  syncCreatureShadows() {
    if (this._zombieOn) {
      this.zombies.setCastShadow(false);
      return;
    }
    this.zombies.setCastShadow(this.night < 0.5);
  }

  /**
   * Tempestade só na luta do chefão (horda 9 / modo zombieBoss).
   * Cosmético: nuvens escuras, raios com luz local e trovão.
   */
  updateBossStorm(dt) {
    this.storm.setActive(this.isBossStormActive());
    this.storm.update(dt);
  }

  isBossStormActive() {
    if (!isZombieMode(this.mode) || !this._zombieOn) return false;
    // A tempestade adiciona nuvens, partículas e flashes. Deixe a virada
    // terminar primeiro para que esses efeitos não concorram com a compilação
    // da noite e com o teleporte inicial dos jogadores.
    if (this.night < 0.98) return false;
    const st = this.zombieState;
    if (st?.over) return false;

    if (this.mode === "zombieBoss") return true;

    const hordes = CONFIG.modes.zombie.hordes ?? 9;
    if (st?.horde >= hordes) return true;

    for (const bicho of this.zombies.byNetId.values()) {
      if (bicho.kind === "boss" && !bicho.dead) return true;
    }
    return false;
  }

  /** Flash vermelho no impacto de flecha no chefão — luz + mesh + partículas. */
  spawnBossFlash(impact, zombieId = null) {
    const F = CONFIG.modes.zombie.boss?.hitFlash ?? {};
    const peak = F.intensity ?? 520;
    const range = F.range ?? 150;
    const decay = F.decay ?? 0.85;
    const life = F.life ?? 0.48;
    const color = F.color ?? 0xff1a14;

    this._pushBossFlashLight(impact.x, impact.y + 0.4, impact.z, peak, range, decay, life, color);

    /* Segunda luz no tronco: o impacto acende um ponto; esta revela o corpo
       inteiro quando o tiro vem de longe. */
    const boss = zombieId != null ? this.zombies.byNetId.get(zombieId) : null;
    if (boss) {
      const fill = peak * (F.fillIntensity ?? 0.72);
      const torsoY = boss.position.y + (boss.bodyHeight ?? 15) * 0.52;
      this._pushBossFlashLight(
        boss.position.x,
        torsoY,
        boss.position.z,
        fill,
        range * 1.12,
        decay,
        life,
        color,
      );
      boss.flashHit?.();
    }

    /* Fagulhas vermelhas no ponto do acerto — leem de longe como “hit”. */
    gameEvents.emit(EventType.PARTICLES, {
      ...RECEITAS.boss,
      position: vec3Payload(impact),
      direction: { x: 0, y: 1, z: 0 },
    });
  }

  _pushBossFlashLight(x, y, z, _peak, _range, _decay, life, color) {
    const geo = new THREE.SphereGeometry(2.8, 8, 6);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.frustumCulled = false;
    mesh.renderOrder = 58;
    this.scene.add(mesh);
    this._bossFlashes.push({ mesh, mat, t: 0, life });
  }

  updateBossFlashes(dt) {
    for (let i = this._bossFlashes.length - 1; i >= 0; i--) {
      const f = this._bossFlashes[i];
      f.t += dt;
      const p = f.t / f.life;
      const env = (1 - p) * (1 - p);
      f.mat.opacity = 0.9 * env;
      f.mesh.scale.setScalar(1 + p * 2.2);
      if (f.t >= f.life) {
        this.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        f.mat.dispose();
        this._bossFlashes.splice(i, 1);
      }
    }
  }

  /** Painel do modo zumbi: horda, restantes e contador de renascimento. */
  updateZombieHud() {
    const st = this.zombieState;
    if (!st || !isZombieMode(this.mode)) {
      if (this._zombieHudOn) {
        this.hud.setZombie(null);
        this.hud.setBossHp(null);
        this._zombieHudOn = false;
      }
      return;
    }
    this._zombieHudOn = true;

    this.hud.setZombie({
      horde: st.horde,
      hordes: CONFIG.modes.zombie.hordes,
      remaining: this.zombies.counts.alive,
    });

    let bossHp = null;
    for (const bicho of this.zombies.byNetId.values()) {
      if (bicho.kind === "boss" && !bicho.dead) {
        bossHp = bicho.health;
        break;
      }
    }
    this.hud.setBossHp(bossHp);

    if (st.over) return;

    const eu = st.downs?.find((d) => d.id === this.net.me?.id);
    const falta = (eu?.until ?? 0) - this.net.serverTime;
    if (falta <= 0) {
      this.hud.hideZombieCenter();
      return;
    }
    this.hud.showZombieCenter(
      String(Math.ceil(falta / 1000)),
      "voltando ao centro…",
    );
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
    this.hud.setFuel(this.jetpack);
    this.hud.setFps(this.fps);
    this.hud.setWind(
      this.wind.speed,
      this.wind.relativeAngle(this.aimYaw ?? 0),
      !this.wind.enabled,
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
