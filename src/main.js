/* ---------------------------------------------------------------------------
   Ponto de entrada e laço principal.

   O passo da física é FIXO (1/120 s) e vive num acumulador, separado do
   requestAnimationFrame. O render interpola entre o estado anterior e o atual,
   então a imagem fica suave mesmo com o monitor em 60, 120 ou 144 Hz — e a
   simulação dá exatamente o mesmo resultado em qualquer um deles.
   --------------------------------------------------------------------------- */

import "./style.css";
import * as THREE from "three";

import {
  CONFIG,
  drawSpeed,
  drawFraction,
  applyQuality,
  savedQuality,
} from "./config.js";
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
import { JetSmokeTrail } from "./systems/jetSmoke.js";
import { AudioSystem } from "./systems/audio.js";
import { ParticleSystem } from "./systems/particles.js";
import { installImpactEffects, RECEITAS } from "./systems/impactFx.js";
import { BoarManager } from "./systems/boarManager.js";
import { ElkManager } from "./systems/elkManager.js";
import { BirdManager } from "./systems/birdManager.js";
import { ZombieManager } from "./systems/zombieManager.js";
import { MeteorRainManager } from "./systems/meteorRain.js";
import { SoulSystem } from "./systems/souls.js";
import { BatSwarmManager } from "./systems/batSwarm.js";
import { SiegeSystem } from "./systems/siege.js";
import { SpecialSystem } from "./systems/special.js";
import { TorchRing } from "./systems/torches.js";
import { StormSystem } from "./systems/storm.js";
import { HUD } from "./ui/hud.js";
import { DebugPanel } from "./ui/debug.js";
import { Lobby } from "./ui/lobby.js";
import { NetClient } from "./net/client.js";
import { RemotePlayers } from "./net/remotePlayers.js";
import { RemoteArrows } from "./net/remoteArrows.js";
import { Spectator } from "./systems/spectator.js";
import { FlagEntity } from "./entities/flag.js";
import { Respawn } from "./game/respawn.js";
import { Death } from "./game/death.js";
import { TargetSeriesView } from "./game/targetSeries.js";
import { ConfirmDialog } from "./ui/confirm.js";
import { Scoreboard, KillFeed } from "./ui/scoreboard.js";
import {
  C2S,
  S2C,
  FRAME,
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
/* Rascunhos da câmera de mira: `updateCamera` roda todo quadro. */
const _miraPos = new THREE.Vector3();
const _miraAlvo = new THREE.Vector3();

const MODE_LABELS = {
  free: "modo livre",
  teamDuel: "duelo de times",
  boarHunt: "caçada aos porcos",
  birdHunt: "caça aos pássaros",
  series: "alvos em série",
  elkHunt: "caçada ao alce",
  zombie: "noite dos zumbis",
  zombieBoss: "chefão zumbi",
  meteorRain: "chuva de meteoros",
  siege: "cerco ao castelo",
  lastStand: "último em pé",
  captureFlag: "rouba bandeira",
};

/** Milímetro de precisão: de sobra para a rede e metade dos bytes. */
const mm = (v) => Math.round(v * 1000) / 1000;

/** Suavização em 0..1, com as pontas planas. */
function smoothstep01(t) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

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
      // A poeira em suspensão da Lua acompanha a câmera — ver `spaceLife.js`.
      camera: this.renderer.camera,
      nextFrame,
      beforeDispose: () => this.beforeLevelDispose(),
      onLevelReady: (fase) => this.onLevelReady(fase),
    });

    setStep("esculpindo o vale…");
    this.levels.build(DEFAULT_LEVEL, (_f, texto) => setStep(texto));

    this.wind = new Wind();

    const playerEntityId = entityRegistry.createId();
    /* Sem terceiro argumento: o corpo nasce na skin padrão do jogo (o arqueiro
       medieval — ver `shared/skins.js`). Não há mais escolha na tela de
       entrada, então não há preferência nenhuma para ler aqui. */
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
    /* A chuva de meteoros. Vazia fora do modo, e o custo disso é um `if`. */
    this.meteors = new MeteorRainManager(this.scene, physics, this.terrain, this.arrows);
    /* Os morcegos do cerco. Vazio fora do modo, e o custo disso é um `if` —
       mesma economia da chuva, logo acima. */
    this.morcegos = new BatSwarmManager(this.scene, physics, this.arrows);
    /* AS ALMAS. Um monstro morre e a bolinha vai para quem matou — é o único
       retorno de abate que se lê a duzentos metros, e é ela que enche a barra
       do especial. Ver o cabeçalho de `systems/souls.js`.

       O destino é resolvido por FUNÇÃO e não por lista: a alma persegue o
       arqueiro, que continua andando enquanto ela viaja. */
    this.souls = new SoulSystem(this.scene, (id) => this.ondeEsta(id));
    /** Estado do modo vindo da sala: horda, rochas, e o instante da largada. */
    this.meteorState = null;
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
    /** A tela de vitória de algum modo (caçada, série, zumbi, alce, último em
     *  pé, bandeira...) está na tela, esperando o Enter que a fecha E
     *  recomeça a partida do mesmo modo — ver `confirmOverlay` abaixo. */
    this.huntVictoryOpen = false;
    /** GAME OVER em texto simples (sem ranking) na tela — chuva, alce ou
     *  zumbis quando o resultado é derrota — esperando o Enter que recomeça. */
    this.gameOverRestartOpen = false;
    /** Fim do cerco na tela, esperando o Enter que recomeça a partida. */
    this.siegeRestartOpen = false;
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

    /* O MENU DE COMANDOS, ligado ao input por dois fios e nenhum mais.
     *
     * O botão escreve a MESMA intenção que a tecla escreveria, e o laço de
     * `bindActions` consome no quadro seguinte sem saber de onde veio. Não há
     * um segundo caminho para "trocar de modo" ou "pôr um bot": há um só, e o
     * menu é outra forma de chegar nele. É o que garante que a confirmação, o
     * aviso na tela e a mensagem de rede saiam idênticos nos dois casos.
     *
     * O segundo fio é o PONTEIRO: o jogo roda com o cursor capturado, e um
     * menu de botões sem cursor não se usa. Ver `Input.setMenuOpen`. */
    this.hud.onCommand = ([campo, valor]) => {
      this.input.actions[campo] = valor;
      /* A MARCA DE ORIGEM. Ela diz a `handleActions` que a intenção veio de um
         clique, e o único efeito é pular a pergunta de confirmação — um botão
         que a pessoa foi procurar num menu já é a confirmação. Ver
         `Game.askModeChange`. */
      this.input.actions.doMenu = true;
      /* O menu FECHA ANTES de a ação ser aplicada: o quadro seguinte é que a
         consome, e nele o ponteiro já voltou para o jogo. Fechar depois deixava
         a troca de fase acontecer com o menu ainda por cima. */
      if (this.hud.comandosQueFecham.has(campo)) this.hud.closeCommandMenu();
    };
    this.hud.onCommandMenuToggle = (aberto) => this.input.setMenuOpen(aberto);
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
    /* O cerco. Nasce AQUI, e não junto dos outros gerentes lá em cima, porque
       ele é o único que precisa da rede no construtor: a pedra do trabuco é um
       evento de quem atira, e é ele quem reporta o impacto. Vazio fora do modo;
       o que fica ligado desde o arranque é o gancho de arrasto no passo fixo. */
    this.siege = new SiegeSystem(this.scene, physics, this.net, this.arrows);
    this.remotes = new RemotePlayers(this.scene, physics, this.terrain);
    this.remoteArrows = new RemoteArrows(this.arrows, () => this.targets);
    this.series = new TargetSeriesView(this.scene, physics, this.terrain, this.arrows);
    /* Os adversários de CPU NÃO moram mais aqui.
     *
     * Eles viraram jogadores da sala (`server/botSim.js`), e é o servidor que
     * os simula. Deste lado eles chegam como qualquer outro arqueiro: um
     * `RemotePlayer` montado pelo `S2C.JOIN`, animado pelo `S2C.STATES`, com
     * flecha vinda do `S2C.SHOT`. Não há nada a instanciar. */

    this.respawn = new Respawn(this.player, this.playerPhysics);
    this.death = new Death(this.player, this.terrain);
    this.lastStateSent = -Infinity;

    /* ------------------------------------------------ os modos de arena --- */
    /** A câmera de quem já morreu no último em pé. Ver `systems/spectator.js`. */
    this.spectator = new Spectator(this.renderer.camera);
    /** Estado da rodada de vida única, como a sala o descreve. */
    this.standState = null;
    /** Instante (relógio da sala) em que a câmera solta e o voo começa. */
    this.spectateAt = 0;
    /* A bandeira. UM objeto que sobrevive à troca de modo — ele nasce
       escondido e é a primeira amostra da sala que o acende. Ver
       `entities/flag.js`, que é onde mora a resposta para "quem está com ela?". */
    /* AS DUAS BANDEIRAS. Uma por time, cada uma na base do dono — ver o
       cabeçalho de `server/flagSim.js` para por que passaram a ser duas. */
    this.flags = {
      humans: new FlagEntity(this.scene, "humans"),
      bots: new FlagEntity(this.scene, "bots"),
    };
    this.flagState = null;
    /** De que lado cada corpo está, no rouba bandeira. Ver `aplicarEquipes`. */
    this.equipes = new Map();
    /** O meu lado. `null` fora dos modos com times. */
    this.meuTime = null;

    /* O ESPECIAL. Ele não conhece modo nenhum — quem diz onde ele existe é
       `CONFIG.special.modes`, e quem diz o que enche a barra é a sala. Ver
       `docs/plano-kamehameha.md`. */
    this.special = new SpecialSystem({
      scene: this.scene,
      player: this.player,
      remotes: this.remotes,
      meteors: this.meteors,
      getTerrain: () => this.terrain,
      // A direção da mira NO INSTANTE do disparo. Depois disso ela não é mais
      // consultada: o feixe está travado.
      getAim: () => this._forward,
      net: this.net,
      hud: this.hud,
      audio: this.audio,
      // Só para a câmera ir para a frente do feixe no disparo e voltar no
      // impacto. Ver `CameraRig.onKame`.
      rig: this.rig,
      /* O céu. A Terra é um disco desenhado dentro do shader dele, sem corpo e
         sem colisor — então quem sabe dizer "o feixe está apontado para o
         planeta" e quem sabe explodi-lo é o renderer. Ver `aimingAtEarth`. */
      renderer: this.renderer,
    });

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
    /** Em que plataforma o jogador está de pé agora, ou null. Ver `updateRideables`. */
    this.rideando = null;
    /** Placar do duelo de times, vindo da sala. */
    this.teamScores = { humans: 0, bots: 0 };
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

    /* O que a entrada apura e a pose consome um passo de física depois. Ver
       `updateAimAndPose` e `applyPlayerPose`. */
    this._moving = false;
    this._knifeFraction = 0;

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

    /* Acertei o chão do Sandbox: abre cratera ali, na hora.
     *
     * Só existe nesta fase — nas outras o terreno não tem `addCrater`, e é
     * por isso que o primeiro `if` sai antes de chamar qualquer coisa. Fica
     * só no seu lado: cada cliente esculpe a própria cópia do terreno a
     * partir do próprio impacto, sem passar pela rede (ver o cabeçalho de
     * `shared/sandboxField.js`) — o Sandbox é cenário de teste solo, não uma
     * fase pensada para valer igual em todas as telas.
     */
    gameEvents.on(EventType.ARROW_IMPACT, (e) => {
      if (e.ownerId !== this.player.entityId) return;
      if (this.levels.id !== "sandbox") return;
      const terrain = this.levels.current?.terrain;
      if (!terrain?.addCrater) return;

      const noChao = e.targetKind === "terrain" && e.targetId === "sandbox";
      const naPedra = e.targetKind === "scenery" && e.targetId === "rocha";
      if (!noChao && !naPedra) return;

      const power = Math.hypot(e.velocity[0], e.velocity[1], e.velocity[2]);

      /* Acertou a pedra em cheio: ela estoura ANTES de o buraco existir. Fazer
         na outra ordem deixaria a cratera nascer por baixo dela no mesmo
         quadro em que ela ainda está inteira. */
      if (naPedra) terrain.shatterRockAt(e.impact, this.physics);

      const crater = terrain.addCrater(e.impact.x, e.impact.z, power);
      terrain.rebuildCollider(this.physics);
      // Nem grama nem pedra ficam penduradas sobre o buraco: as duas vão junto.
      terrain.cullVegetation?.(crater);
      terrain.shatterRocksIn?.(crater, this.physics);
    });

    /* A morte causada por bot NÃO é tratada aqui.
     *
     * Ela era, enquanto o bot vivia nesta tela: o servidor recusa um
     * `C2S.KILL` autoinfligido, então a queda tinha de ser resolvida
     * localmente. Com o bot na sala (`server/botSim.js`), quem simula a flecha
     * dele é o servidor — e a morte chega pelo `S2C.KILL` de sempre, igual à de
     * um humano, com o corpo caindo no mesmo lugar em todas as telas. */

    /* O golpe do alien e a explosão de nave TAMBÉM não são tratados aqui.
     *
     * Eles eram, enquanto a Lua era cenário local. Agora alien, nave, meteorito
     * e estilhaço vivem na sala (`server/spaceSim.js`), que é quem sabe quem
     * estava no raio — e a morte chega pelo `S2C.KILL` de sempre, valendo em
     * todas as telas ao mesmo tempo em vez de só na da vítima. */

    /* Acertei algo da Lua. Quem atira é a autoridade sobre o PRÓPRIO acerto —
       o mesmo contrato do porco e do zumbi —, mas quem decide se a nave caiu é
       a sala: ela é uma só, e duas telas não podem discordar sobre uma nave que
       explodiu. */
    gameEvents.on(EventType.ARROW_IMPACT, (e) => {
      if (e.ownerId !== this.player.entityId) return;
      if (!e.spaceKind || e.spaceId == null) return;
      this.net.send(C2S.SPACE_HIT, { kind: e.spaceKind, id: e.spaceId });
    });

    /* Acertei uma rocha da chuva. A rocha já PISCOU localmente, no quadro do
       impacto (ver `hitResolver.resolveFallingMeteorHit`) — isto aqui é só o
       aviso para a sala, que é quem tira a vida e quem faz as outras telas
       piscarem junto. */
    gameEvents.on(EventType.ARROW_IMPACT, (e) => {
      if (e.ownerId !== this.player.entityId) return;
      if (e.targetKind !== "fallingMeteor" || e.meteorId == null) return;
      /* E as LASCAS saem AQUI, no mesmo quadro do piscar.
         Elas nasciam só dentro do `S2C.METEOR_HIT` — que quem atirou descarta,
         para não piscar duas vezes. O resultado era o avesso do que o modo
         quer: o único jogador que NUNCA via a coroa de brasas em volta da
         pedra era quem estava acertando nela. Ver `MeteorRainManager.lascasEm`. */
      this.meteors.lascasEm(e.meteorId);
      this.net.send(C2S.METEOR_HIT, {
        id: e.meteorId,
        d: Math.round((e.distance ?? 0) * 100) / 100,
      });
    });

    /* Acertei um morcego. Mesmo contrato da rocha: quem atira é a autoridade
       sobre o próprio acerto e a sala decide se ele caiu — aqui só se anuncia. */
    gameEvents.on(EventType.ARROW_IMPACT, (e) => {
      if (e.ownerId !== this.player.entityId) return;
      if (e.targetKind !== "bat" || e.batId == null) return;
      this.net.send(C2S.BAT_HIT, { id: e.batId });
    });

    /* Estourei a bola de magia no ar. Mesmo contrato: quem atira anuncia, e a
       sala cancela a morte que aquela bola tinha agendada. */
    gameEvents.on(EventType.ARROW_IMPACT, (e) => {
      if (e.ownerId !== this.player.entityId) return;
      if (e.targetKind !== "siegeBolt" || e.boltId == null) return;
      this.net.send(C2S.BOLT_HIT, { bid: e.boltId });
    });

    // Alvo da série: quem acertar primeiro leva. O servidor arbitra, porque
    // dois tiros quase juntos precisam de um desempate único para todos.
    gameEvents.on(EventType.ARROW_IMPACT, (e) => {
      if (e.ownerId !== this.player.entityId) return;
      if (e.targetKind !== "seriesTarget") return;
      this.net.send(C2S.SERIES_HIT, { seq: e.targetId });
    });

    /* O PAVÊS aparou. Nasce do impacto local, não de uma resposta da sala: a
       flecha já cravou na tábua neste quadro, e esperar meio ping para ouvir a
       pancada desmentiria o que os olhos viram. */
    gameEvents.on(EventType.ARROW_IMPACT, (e) => {
      if (e.ownerId !== this.player.entityId || e.targetKind !== "pavise") return;
      this.hud.toast("o pavês aparou — por cima, ou pelo lado", "miss");
      gameEvents.emit(EventType.AUDIO_PLAY, {
        sound: "arrowHitWood",
        position: vec3Payload(this.player.position),
        volume: 1.0,
        pitch: 1.35,
      });
    });

    /* Acertei um sitiante. Mesmo contrato do zumbi: a flecha já cravou aqui, e
       isto é o aviso para a sala — que é quem tira a vida e quem conta o
       ponto. */
    gameEvents.on(EventType.ARROW_IMPACT, (e) => {
      if (e.ownerId !== this.player.entityId) return;
      if (e.targetKind !== "besieger" || e.besiegerId == null) return;
      this.net.send(C2S.SIEGE_HIT, {
        id: e.besiegerId,
        head: e.head === true,
        d: Math.round((e.distance ?? 0) * 100) / 100,
      });
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
      /* Quem chega no meio de uma chuva pega o bonde andando: as rochas que já
         estão no ar e o estado da horda vêm na PRIMEIRA mensagem, e a contagem
         de entrada não reinicia para ninguém (o `startsAt` dele já é passado). */
      this.applyMeteorMode(msg.snapshot.mode?.mode === "meteorRain");
      if (msg.snapshot.meteors?.length) this.meteors.applyNetwork(msg.snapshot.meteors);
      this.meteorState = msg.snapshot.meteorStatus ?? null;
      /* Quem chega no meio de um cerco recebe a horda inteira de uma vez, em
         JSON — o único pacote de sitiantes que não é binário. Sem ele o
         retardatário veria a rampa VAZIA até o próximo quadro de 10 Hz, e a
         barra do portão já pela metade sem nada explicando por quê. */
      this.applySiegeMode(msg.snapshot.mode?.mode === "siege");
      if (msg.snapshot.siege?.length) this.siege.applySnapshot(msg.snapshot.siege);
      if (msg.snapshot.bats?.length) this.morcegos.applyNetwork(msg.snapshot.bats);
      if (msg.snapshot.siegeStatus) {
        this.siegeState = msg.snapshot.siegeStatus;
        this.siege.setStatus(msg.snapshot.siegeStatus);
        this.hud.setSiege(msg.snapshot.siegeStatus);
      }
      if (msg.snapshot.trebuchets) {
        this.siege.onTrebState({ e: msg.snapshot.trebuchets });
        this.hud.setTrebuchets(msg.snapshot.trebuchets);
      }
      if (msg.snapshot.kameCharge) {
        this.special?.setCharge(
          msg.snapshot.kameCharge.charge,
          msg.snapshot.kameCharge.max,
        );
      }
      this.torches.setStates(msg.snapshot.torches);
      this.zombieState = msg.snapshot.zombieStatus ?? null;
      this.elkState = msg.snapshot.elkStatus ?? null;
      /* Quem chega no meio de uma rodada de arena recebe as duas coisas aqui —
         é a única mensagem que ele tem antes de a partida continuar sem se
         explicar. Sem a bandeira, o objeto que decide o modo não existiria na
         tela dele; sem a lista de vivos, ele não saberia que está assistindo. */
      /* A ESCALAÇÃO VEM ANTES DA BANDEIRA, sempre: `aplicarBandeiras` pergunta
         qual é o meu time para decidir o que a faixa diz, e sem ela leria
         `null` e anunciaria a bandeira do adversário como se fosse a sua. */
      this.aplicarEquipes(msg.snapshot.teams);
      if (msg.snapshot.flag) {
        this.aplicarBandeiras(msg.snapshot.flag);
      } else {
        this.esconderBandeiras();
      }
      if (msg.snapshot.standStatus) this.applyStandStatus(msg.snapshot.standStatus);
      this.series.setTarget(msg.snapshot.series ?? null);
      this.applyMode(msg.snapshot.mode);
      if (msg.snapshot.mode?.preparing) {
        this.beginModePreparation(msg.snapshot.mode.preparing);
      }
      this.teamScores = msg.snapshot.teamScores ?? { humans: 0, bots: 0 };
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
      /* A ALMA DE QUEM CAI, e ela sai ANTES do corpo tombar — a posição de
         quem morreu ainda é a do abate. Vale para gente pelo mesmo motivo que
         vale para monstro: `killer` pode ser `null` (a Lua, um meteoro, a
         queda) e aí não há para quem ela ir, e é `soltarAlma` que recusa. */
      /* ONDE ELE CAIU, lido ANTES de o corpo tombar — serve às duas coisas
         abaixo, e a alma precisa da posição do abate, não da do ragdoll. */
      const onde = this.deathPosition(msg.victim);
      this.soltarAlma(onde, msg.killer, 1.6);
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
          /* Um pouco abaixo do resto de propósito (era 1,1).
             O grito é o som mais longo do jogo e toca no instante em que o
             jogador já tem uma tela de morte, um marcador e o placar para ler —
             acima de tudo isso ele deixa de ser informação e vira susto. */
          volume: 0.75,
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
      // Antes de `kill`, como no zumbi e no sitiante: o corpo ainda está de pé.
      if (!msg.fun) this.soltarAlma(this.boars.byNetId.get(msg.id)?.position, msg.killer);
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
      // O alce solta uma alma GRANDE: são seis flechas e ele revida.
      if (!msg.fun) this.soltarAlma(this.elks.byNetId.get(msg.id)?.position, msg.killer, 1.8);
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
        this.hud.showZombieCenter(
          "GAME OVER",
          "o alce derrubou a caçada",
          "gameover",
          "para jogar de novo",
        );
        this.gameOverRestartOpen = true;
      }
    });

    net.on(S2C.BIRDS, (msg) => {
      if (msg.clear) this.birds.clear();
      else this.birds.applyNetwork(msg.k);
    });

    net.on(S2C.BIRD_DEATH, (msg) => {
      /* A ave rara solta uma alma maior, como o ogro e o colosso. Ela vale 500
         pontos e fecha a partida: a tela tem de dizer isso de longe. */
      this.soltarAlma(this.birds.byNetId.get(msg.id)?.position, msg.killer, msg.special ? 2.2 : 1);
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
      /* As TRÊS bandeiras de "Enter recomeça", zeradas juntas — não importa
         qual modo as ergueu, um mundo novo já invalida qualquer uma delas. Sem
         isto um Enter perdido depois de trocar de modo por outro caminho (o
         menu, por exemplo) reenviaria um pedido de recomeço para um modo que
         a pessoa já deixou para trás. */
      this.huntVictoryOpen = false;
      this.gameOverRestartOpen = false;
      this.siegeRestartOpen = false;
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
      /* E a alma sai da tábua. Aqui ela é a única confirmação que vem DE VOLTA:
         a duzentos e cinquenta metros o estouro é do tamanho de um pixel e o
         alvo seguinte já nasceu adiante — a bolinha atravessando a estrada é o
         que diz "aquele era o seu" sem tirar o olho da linha de tiro. */
      this.soltarAlma({ x: msg.x, y: msg.y + 0.9, z: msg.z }, msg.killer, 1.2);
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
      /* A ALMA SAI ANTES DO CORPO TOMBAR — ou seja, antes de `kill`, que é
         quando o boneco ainda está de pé e a posição dele é a do abate. */
      const corpo = this.zombies.byNetId.get(msg.id)?.group?.position;
      this.soltarAlma(corpo, msg.killer, msg.boss ? 2.4 : 1);
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
      this.hud.announceHorde(msg.n, msg.size, msg.boss === true, msg.kind ?? "zombie");
      gameEvents.emit(EventType.AUDIO_PLAY, {
        sound: "waveHorn",
        position: vec3Payload(this.player.position),
        volume: 0.8,
      });
    });

    /* ------------------------------------------------------------- cerco --- */

    /* As poses da horda chegam em BINÁRIO — o único canal do jogo que não é
       JSON. O evento se chama `frame:1` e o cliente de rede o emite como
       qualquer outro, então daqui isto é indistinguível do resto. Ver
       `Siege.packFrame` para a conta que obrigou a mudar de transporte. */
    net.on(`frame:${FRAME.SIEGE}`, (buffer) => this.siege.applyFrame(buffer));

    net.on(S2C.BATS, (msg) => this.morcegos.applyNetwork(msg.b));

    net.on(S2C.BAT_DEATH, (msg) => {
      /* A posição vem NA MENSAGEM (`p`), e não do corpo em cena: o morcego morre
         a trinta metros de altura e some no mesmo quadro — quem o desenha já o
         descartou quando esta linha roda. */
      if (msg.p) {
        this.soltarAlma({ x: msg.p[0], y: msg.p[1], z: msg.p[2] }, msg.killer, 1.4);
      }
      this.morcegos.morrer(msg);
      if (msg.killerName) {
        this.hud.toast(`${msg.killerName} derrubou um morcego`, "hit");
      }
    });

    net.on(S2C.SIEGE_STATUS, (msg) => {
      this.siegeState = msg;
      this.siege.setStatus(msg);
      this.hud.setSiege(msg);
      /* Partida em andamento: a tela de fim sai e o Enter de recomeçar não
         vale mais. Aqui, e não no handler do modo, porque é este estado — e
         não a mensagem de troca — que diz que o cerco voltou a rodar: quando
         OUTRA pessoa aperta o Enter, o modo não muda e nada mais avisaria esta
         tela. Mesmo desenho do `gameOverRestartOpen`. */
      if (!msg.over && this.siegeRestartOpen) {
        this.siegeRestartOpen = false;
        this.hud.hideSiegeOver();
      }
    });

    net.on(S2C.SIEGE_TIER, (msg) => {
      /* A trompa e a faixa: o único resquício da mecânica de onda. Ela existe
         porque a primeira aparição de uma espécie precisa ser VISTA antes de
         ser um problema — é o momento em que o modo pausa a leitura do jogador,
         e o único. */
      this.hud.announceTier(msg.nome);
      gameEvents.emit(EventType.AUDIO_PLAY, {
        sound: "waveHorn",
        position: vec3Payload(this.player.position),
        volume: 0.9,
      });
    });

    net.on(S2C.SIEGE_DEATH, (msg) => {
      // Antes de `onDeath`, pelo mesmo motivo do zumbi: o corpo ainda está de pé.
      const corpo = this.siege.byId.get(msg.id)?.group?.position;
      this.soltarAlma(corpo, msg.killer, msg.kind === "ogre" ? 2.2 : 1);
      this.siege.onDeath(msg);
      if (!msg.killerName) return;
      this.killFeed.push([
        { text: msg.killerName, color: msg.killerColor, forte: true },
        { text: msg.head ? "  🏹  " : "  ⚔️  " },
        { text: msg.kind === "ogre" ? "OGRO" : msg.kind, forte: msg.kind === "ogre" },
        ...(msg.points ? [{ text: `  +${msg.points}` }] : []),
      ]);
    });

    net.on(S2C.SIEGE_SHOT, (msg) => this.siege.onShot(msg));
    net.on(S2C.TREB_STATE, (msg) => {
      this.siege.onTrebState(msg);
      this.hud.setTrebuchets(msg.e);
    });
    net.on(S2C.TREB_SHOT, (msg) => {
      if (msg.owner === this.net.me?.id) return;
      this.siege.onRemoteShot(msg);
    });
    net.on(S2C.TREB_IMPACT, (msg) => this.siege.onTrebImpact(msg));

    /* O BAQUE. A frequência dele é a leitura da fila, e é o único canal que
       informa sem exigir que se tire os olhos da mira — ver §7.1 do plano. */
    net.on(S2C.GATE_HIT, (msg) => {
      const g = this.levels.current?.gate;
      g?.setHealth(msg.f);
      gameEvents.emit(EventType.AUDIO_PLAY, {
        sound: "arrowHitWood",
        position: vec3Payload(g?.group?.position ?? this.player.position),
        volume: msg.own ? 1.4 : 1.15,
        pitch: 0.42,
      });
      if (msg.own) this.hud.toast("a sua pedra acertou o próprio portão");
    });

    net.on(S2C.GATE_FALL, () => {
      this.levels.current?.gate?.fall();
      this.hud.flashDanger(1.0);
      gameEvents.emit(EventType.AUDIO_PLAY, {
        sound: "explosion",
        position: vec3Payload(this.player.position),
        /* 0,55 e não 1,5. O estouro tocava NA POSIÇÃO DO JOGADOR — é o fim da
           partida, e o baque é para todos, esteja quem estiver onde estiver —
           e a 1,5 isso vira um som sem atenuação nenhuma tocado dentro do
           ouvido. Continua sendo o som mais alto do modo; deixou de ser o mais
           alto do jogo. */
        volume: 0.55,
      });
    });

    net.on(S2C.SIEGE_OVER, (msg) => {
      this.hud.showSiegeOver(msg);
      /* E o Enter recomeça, como no fim da chuva. Sem esta linha o cerco
         terminava numa tela de resultado sem saída: o jogo continuava
         respondendo e a única forma de jogar de novo era lembrar do atalho do
         modo. Ver o `confirmOverlay` em `bindActions`. */
      this.siegeRestartOpen = true;
    });

    /* ----------------------------------------------------- chuva de meteoros */

    net.on(S2C.METEORS, (msg) => {
      if (msg.clear) this.meteors.clear();
      else this.meteors.applyNetwork(msg.m);
    });

    /* O PISCAR nas telas de quem NÃO atirou. Quem atirou já viu no quadro do
       impacto — este pacote é para o resto da sala, e é o que impede duas
       pessoas de gastarem duas flechas na mesma pedra. */
    net.on(S2C.METEOR_HIT, (msg) => {
      if (msg.by === this.net.me?.id) return;
      this.meteors.hit(msg.id);
    });

    net.on(S2C.METEOR_BURST, (msg) => {
      /* A ALMA DA ROCHA.
       *
       * Ela existia só nos modos de monstro, e por uma leitura estreita demais
       * de "monstro": na chuva o que morre é uma pedra, mas o papel é
       * exatamente o mesmo — é o abate que enche a barra do especial
       * (`chargeSources.meteor`), e é a duzentos metros que ele acontece, ou
       * seja, é justamente aqui que uma confirmação visível de longe vale mais.
       * O colosso solta uma alma grande, como o ogro e o chefão. */
      if (msg.killer != null && msg.p) {
        this.soltarAlma(
          { x: msg.p[0], y: msg.p[1], z: msg.p[2] },
          msg.killer,
          msg.tank ? 2.6 : 1,
        );
      }
      this.meteors.burst(msg);
      if (msg.killerName) {
        this.killFeed.push([
          { text: msg.killerName, color: msg.killerColor, forte: true },
          { text: msg.tank ? "  \u{1F30B}  " : "  ☄️  " },
          { text: msg.tank ? "COLOSSO" : "rocha", forte: msg.tank === true },
        ]);
      }
    });

    /* Uma rocha encostou no chão. O game over vem colado, pelo `METEOR_OVER`;
       aqui é só o estrondo — e ele precisa ser grande, porque é a última coisa
       que a partida mostra. */
    net.on(S2C.METEOR_IMPACT, (msg) => {
      const p = { x: msg.p[0], y: msg.p[1], z: msg.p[2] };
      const raio = msg.r ?? 4;
      gameEvents.emit(EventType.PARTICLES, {
        position: p, count: 200, color: 0xffd070, speed: 34, spread: 1,
        size: raio * 0.6, grow: 3.4, life: 2.6, gravity: -1.62, drag: 0.35, alpha: 1,
      });
      gameEvents.emit(EventType.PARTICLES, {
        position: p, count: 140, color: 0x6a5a4a, speed: 16, spread: 1,
        size: raio, grow: 4.0, life: 4.5, gravity: -0.3, drag: 0.7, alpha: 0.7,
      });
      gameEvents.emit(EventType.AUDIO_PLAY, {
        sound: "explosion", position: p, volume: 1.4,
      });
      this.hud.flashDanger(1.0);
    });

    net.on(S2C.METEOR_STATUS, (msg) => {
      this.meteorState = msg;
    });

    net.on(S2C.METEOR_OVER, (msg) => {
      this.meteorState = { ...(this.meteorState ?? {}), over: true, reason: msg.reason };
      if (msg.reason === "win") {
        this.huntVictoryOpen = true;
        this.hud.showMeteorVictory(msg.ranking ?? [], this.net.me?.id);
        gameEvents.emit(EventType.AUDIO_PLAY, {
          sound: "victoryFanfare",
          position: vec3Payload(this.player.position),
          volume: 1.0,
        });
      } else {
        /* A tela de fim diz COMO RECOMEÇAR. Sem essa linha a partida termina
           num texto vermelho e nada mais acontece — o jogo continua respondendo
           e a pessoa não tem como saber. O `Enter` reentra no modo, que no
           servidor é um `setMode` para o mesmo modo, ou seja: chuva nova, horda
           1, barra do especial zerada. */
        this.hud.showZombieCenter(
          "GAME OVER",
          `uma rocha encostou na horda ${msg.horde}`,
          "gameover",
          "para jogar de novo",
        );
        this.gameOverRestartOpen = true;
      }
    });

    net.on(S2C.KAME_CHARGE, (msg) => {
      if (msg.id !== this.net.me?.id) return;
      this.special?.setCharge(msg.charge, msg.max);
    });

    net.on(S2C.KAME, (msg) => {
      this.special?.onRemoteFire(msg);
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
        this.hud.showZombieCenter(
          "GAME OVER",
          `caíram na horda ${msg.horde}`,
          "gameover",
          "para jogar de novo",
        );
        this.gameOverRestartOpen = true;
      }
    });

    net.on(S2C.MODE_PREPARE, (msg) => this.beginModePreparation(msg));
    net.on(S2C.MODE_PREPARE_CANCEL, () => this.cancelModePreparation());
    net.on(S2C.MODE, (msg) => this.applyMode(msg));

    /* -------------------------------------------------- o último em pé --- */
    net.on(S2C.STAND_STATUS, (msg) => this.applyStandStatus(msg));
    net.on(S2C.STAND_OVER, (msg) => {
      this.standState = { ...(this.standState ?? {}), over: true };
      this.huntVictoryOpen = true;
      this.hud.showStandVictory(msg, this.net.me?.id);
    });

    /* --------------------------------------------------- rouba bandeira -- */
    net.on(S2C.FLAG, (msg) => this.aplicarBandeiras(msg));
    net.on(S2C.FLAG_EVENT, (msg) => this.onFlagEvent(msg));
    net.on(S2C.FLAG_OVER, (msg) => {
      this.huntVictoryOpen = true;
      this.hud.showFlagVictory(msg, this.net.me?.id);
    });

    /* A dificuldade dos bots é da SALA, e o aviso vem dela: os bots vivem todos
       no servidor, então quem apertou a tecla e quem só estava jogando veem a
       mesma mudança no mesmo instante. */
    net.on(S2C.BOT_DIFFICULTY, (msg) => {
      const rotulo =
        { easy: "fácil", medium: "médio", hard: "difícil" }[msg.level] ?? msg.level;
      this.hud.toast(`bots: dificuldade ${rotulo}`, "hit");
    });

    /* A Lua, a 10 Hz. O cliente não simula nada dela: cria, atualiza e descarta
       o que a sala mandou — o mesmo padrão dos porcos. */
    net.on(S2C.SPACE, (msg) => {
      const space = this.environment?.space;
      if (!space) return;
      space.applyNetwork(msg);
      // O rover mora na base, não no campo do espaço; a pose vem no mesmo pacote.
      const rover = this.environment?.base?.rover;
      if (rover && msg.r) rover.setNetworkTarget(msg.r.x, msg.r.y, msg.r.z, msg.r.w);
    });

    /* Explosão e estilhaço: aqui é SÓ o efeito. Quem morreu já foi decidido
       pela sala e chega (ou chegou) por `S2C.KILL`. */
    net.on(S2C.SPACE_EVENT, (msg) => this.environment?.space?.onEvent(msg));

    net.on(S2C.TEAM_SCORES, (msg) => {
      this.teamScores = { humans: msg.humans ?? 0, bots: msg.bots ?? 0 };
      this.aplicarEquipes(msg.teams);
      this.hud.setTeamScores(this.mode === "teamDuel" ? this.teamScores : null);
    });

    net.on(S2C.SCORES, (msg) => this.scoreboard.setScores(msg.scores));
    net.on(S2C.SCORES_RESET, (msg) => {
      this.hud.toast(`${msg.by} zerou o placar`, "miss");
    });

    net.on("disconnected", () => this.hud.setConnection(false));
    net.on("reconnecting", () => this.hud.setConnection(false));
  }

  /* ------------------------------------------------------ o último em pé -- */

  /**
   * A sala disse quem ainda está de pé.
   *
   * E é DAQUI que sai a decisão de virar espectador — não do `KILL`. A
   * diferença importa: `KILL` significa "você caiu", e em nove modos dos onze
   * isso quer dizer "volta em quatro segundos". Sumir da lista de vivos é a
   * única coisa que significa "acabou para você", e é por isso que ela tem
   * mensagem própria (ver `S2C.STAND_STATUS`).
   *
   * A câmera não solta na hora: `spectateAt` dá ao corpo o tempo de tombar. O
   * tombo é a única coisa que a morte tem a comunicar, e cortá-lo no meio para
   * subir aos céus tiraria dela justamente isso.
   */
  applyStandStatus(msg) {
    this.standState = msg;
    this.hud.setStand(msg, this.net.me?.id);

    const euSobrevivi = msg.alive?.some((p) => p.id === this.net.me?.id);
    if (euSobrevivi) {
      this.sairDoEspectador();
      return;
    }
    if (this.mode !== "lastStand") return;
    if (this.spectator.ativo || this.spectateAt) return;
    this.spectateAt =
      this.net.serverTime + CONFIG.modes.lastStand.spectateDelay * 1000;
  }

  /**
   * O corpo assentou: a câmera larga o cadáver e sai voando.
   *
   * O cadáver FICA. Não é economia de código — é informação: o corpo caído no
   * chão diz aos que continuam vivos onde alguém foi pego, e um mapa com quatro
   * corpos espalhados conta a história da rodada melhor que qualquer placar.
   */
  entrarNoEspectador() {
    this.spectateAt = 0;
    if (this.spectator.ativo) return;
    this.spectator.entrar(this.renderer.camera.position);
    /* A câmera da flecha é liberada à força: ela é a única outra coisa que
       disputa o controle da câmera, e uma flecha em voo no instante da morte
       deixaria as duas brigando.

       A PREFERÊNCIA DO JOGADOR é guardada e devolvida na saída. Desligar e
       religar no fim apagava a escolha de quem tinha desligado o
       acompanhamento na tecla F: a pessoa morria uma vez e a câmera da flecha
       voltava a ligar sozinha para o resto da sessão. */
    this._seguiaFlecha = this.rig.followArrowEnabled;
    this.rig.returnToArcher();
    this.rig.setFollowArrow(false);
    this.hud.setSpectating(true);
    this.hud.toast("você caiu — câmera livre (WASD, espaço/C, shift)", "miss");
  }

  sairDoEspectador() {
    this.spectateAt = 0;
    if (!this.spectator.ativo) return;
    this.spectator.sair();
    this.rig.setFollowArrow(this._seguiaFlecha ?? true);
    this.hud.setSpectating(false);
  }

  /** Estou assistindo em vez de jogando? */
  get espectando() {
    return this.spectator.ativo;
  }

  /* ------------------------------------------------------- rouba bandeira -- */

  /** O nome de quem tem este id — meu, de um remoto ou de ninguém. */
  nomeDe(id) {
    if (id == null) return null;
    if (id === this.net.me?.id) return this.net.me?.name ?? "você";
    return this.remotes.get(id)?.name ?? null;
  }

  /**
   * Onde o portador está NESTA tela.
   *
   * Do boneco interpolado, e não da amostra de 10 Hz que veio junto com a
   * bandeira: a 8 m/s, 100 ms são 80 cm, e uma bandeira flutuando 80 cm atrás
   * de quem corre é exatamente o defeito que todo mundo vê, porque é durante a
   * corrida que todo mundo está olhando para ela.
   */
  posicaoDoPortador(id) {
    if (id == null) return null;
    if (id === this.net.me?.id) return this.player.position;
    return this.remotes.get(id)?.player.position ?? null;
  }

  /** Pegou, caiu, entregou, voltou — o que vira faixa na tela e som. */
  onFlagEvent(msg) {
    const eu = msg.by != null && msg.by === this.net.me?.id;
    const nome = eu ? "Você" : (msg.byName ?? "alguém");
    /* DO MEU LADO OU DO OUTRO — e agora isto é uma pergunta de verdade.
       Enquanto os times eram humanos × CPU, `team === "humans"` respondia por
       todo mundo que estava lendo a tela. Com times mistos, o mesmo evento é
       boa notícia para metade da sala e má para a outra metade. */
    const meuTime = this.meuTime != null && msg.team === this.meuTime;
    // A bandeira DE QUEM. É o que separa "roubaram a minha" de "peguei a dele".
    const minhaBandeira = this.meuTime != null && msg.flag === this.meuTime;

    if (msg.kind === "pickup") {
      this.hud.toast(
        minhaBandeira
          ? `${nome} PEGOU A SUA BANDEIRA`
          : `${nome} pegou a bandeira inimiga`,
        meuTime ? "hit" : "miss",
      );
    } else if (msg.kind === "drop") {
      this.hud.toast(`${nome} derrubou a bandeira`, minhaBandeira ? "hit" : "miss");
    } else if (msg.kind === "rescue") {
      this.hud.toast(
        minhaBandeira ? `${nome} RESGATOU a sua bandeira` : `${nome} resgatou a bandeira`,
        meuTime ? "hit" : "miss",
      );
    } else if (msg.kind === "capture") {
      const p = msg.scores ?? {};
      const meu = this.meuTime === "bots" ? p.bots : p.humans;
      const dele = this.meuTime === "bots" ? p.humans : p.bots;
      this.hud.toast(
        `${nome} ENTREGOU!  ${meu ?? 0} × ${dele ?? 0}`,
        meuTime ? "hit" : "miss",
      );
    } else if (msg.kind === "return") {
      this.hud.toast(
        minhaBandeira ? "a sua bandeira voltou para casa" : "a bandeira voltou para a base",
        minhaBandeira ? "hit" : "miss",
      );
    }

    if (msg.p) {
      gameEvents.emit(EventType.AUDIO_PLAY, {
        sound: msg.kind === "capture" ? "victoryFanfare" : "uiBeep",
        position: { x: msg.p[0], y: msg.p[1], z: msg.p[2] },
        volume: msg.kind === "capture" ? 0.8 : 0.6,
      });
    }
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

  /**
   * Onde um arqueiro (ou bot) está AGORA. Nulo se ele não está em cena.
   *
   * É `deathPosition` sem o nome de morte, porque a alma precisa da mesma
   * resposta por um motivo oposto: ela persegue quem MATOU, e o alvo continua
   * andando enquanto ela viaja. Ver `SoulSystem`.
   */
  /**
   * A amostra das duas bandeiras.
   *
   * O `S2C.FLAG` traz uma LISTA (`flags`), e as bases vão só para a primeira
   * entidade — os dois feixes de base são os mesmos dois pontos, e montá-los
   * duas vezes seria desenhar cada um em cima de si mesmo.
   */
  aplicarBandeiras(msg) {
    this.flagState = msg;
    const lista = msg?.flags ?? [];
    for (let i = 0; i < lista.length; i++) {
      const f = lista[i];
      const alvo = this.flags[f.team];
      if (!alvo) continue;
      alvo.applyNetwork(f, this.terrain, i === 0 ? msg.bases : null);
    }
    /* QUEM está com CADA uma: a faixa da HUD precisa do nome, e o nome mora no
       elenco. Ver `hud.setFlag`. */
    this.hud.setFlag(
      msg,
      lista.map((f) => this.nomeDe(f.carrier)),
      this.net.me?.id,
      this.meuTime,
    );
  }

  esconderBandeiras() {
    for (const t of ["humans", "bots"]) this.flags[t].esconder();
    this.flagState = null;
  }

  /**
   * A escalação, vinda da sala.
   *
   * Ela responde à única pergunta que a tela não consegue deduzir sozinha desde
   * que os times passaram a ser mistos: *qual das duas bandeiras é a minha?*.
   * Antes bastava olhar para `isBot`; agora um bot pode ser companheiro e um
   * humano pode ser adversário. Ver `Room.broadcastTeamScores`.
   */
  aplicarEquipes(pares) {
    this.equipes = new Map(pares ?? []);
    this.meuTime = this.equipes.get(this.net.me?.id) ?? null;
  }

  /** O time de alguém, ou null fora dos modos com lados. */
  timeDe(id) {
    return this.equipes?.get(id) ?? null;
  }

  ondeEsta(id) {
    if (id == null) return null;
    if (id === this.net.me?.id) return this.player.position;
    const remoto = this.remotes.get(id);
    return remoto ? remoto.player.position : null;
  }

  /**
   * Um monstro morreu: solta a alma.
   *
   * O corpo já está na tela e quem matou também — então isto não custa uma
   * mensagem nova de rede. `S2C.ZOMBIE_DEATH` e `S2C.SIEGE_DEATH` já carregam
   * o id de quem matou, e a posição do corpo é a do boneco que este cliente
   * está desenhando. A alma é puramente visual: quem conta a barra do especial
   * é a sala (`Room.addKameCharge`), pelo mesmo abate.
   */
  soltarAlma(corpo, matadorId, escala = 1) {
    if (!corpo || matadorId == null) return;
    this.souls.spawn(corpo, matadorId, escala);
  }

  /**
   * Carona: rover, e depois tudo o mais em que se possa ficar em cima.
   *
   * Roda DEPOIS de `environment.update` — as plataformas já se moveram neste
   * quadro —, então `carry` reprojeta a posição do referencial de ONTEM (que a
   * plataforma guardou) para o de agora. O corpo cinemático do jogador é
   * realinhado na mão (`syncFromPlayer`) porque `player.position` acabou de ser
   * escrito direto, por fora do character controller.
   */
  updateRideables() {
    if (this.death.dying) return;
    /* Acabou de pular (ou ligar o jato): deixa sair. Sem isto, `carry` grudava
       o pé de volta na altura do convés no mesmo quadro do impulso, e o pulo
       nunca decolava — a única forma de descer era andar para fora da borda. */
    if (this.playerPhysics.verticalVelocity > 0.5) {
      this.rideando = null;
      return;
    }

    const base = this.environment?.base;
    const espaco = this.environment?.space;
    const candidatos = [base?.rover, ...(espaco?.meteors ?? [])];

    for (const plataforma of candidatos) {
      if (!plataforma?.isOnDeck?.(this.player.position)) continue;
      plataforma.carry(this.player.position);
      /* Enquanto é carregado, ele não está caindo. Sem zerar a velocidade
         vertical, uma plataforma que SOBE (a nave decolando) briga com a queda
         acumulada e o passageiro treme. */
      this.playerPhysics.verticalVelocity = 0;
      this.playerPhysics.grounded = true;
      this.player.airborne = false;
      this.playerPhysics.syncFromPlayer();
      this.rideando = plataforma;
      return;
    }
    this.rideando = null;
  }

  /**
   * Entra na sala da PORTA escolhida na tela inicial.
   *
   * A fase é montada ANTES de conectar quando a porta pede outra que não a do
   * arranque. Poderia ser depois — a rede de segurança de `applyMode` troca a
   * fase sozinha ao ver que a sala está noutra —, e seria pior: a pessoa entra
   * no vale, aparece para os outros lá, e é arrastada para a Lua um segundo
   * depois, com direito a uma tela de carregamento que ela não pediu. Trocar
   * antes é o que faz "Jogar na Lua" significar chegar na Lua.
   *
   * @param {{level?: string, mode?: string}} [entrada]
   */
  async connect(name, entrada = null) {
    if (entrada?.level && entrada.level !== this.levels.id) {
      await this.changeLevel(entrada.level, {
        titulo: `preparando ${levelInfo(entrada.level).nome.toLowerCase()}…`,
      });
    }
    await this.net.connect(name, entrada);
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

  /**
   * UM QUADRO — e a rede de segurança que impede o jogo de morrer num deles.
   *
   * O laço se sustenta pedindo o próximo `requestAnimationFrame` NO FIM do
   * quadro. Isso tem uma consequência que só aparece no pior dia: uma exceção
   * em qualquer lugar do caminho — um sistema novo, uma mensagem malformada,
   * um `null` que ninguém previu — pula o pedido e a CORRENTE ARREBENTA. O
   * navegador não avisa, a tela congela na última imagem desenhada, o contador
   * de FPS fica parado no último valor e o jogo simplesmente não responde mais.
   * De dentro do jogo é indistinguível de um travamento de máquina, e foi
   * exatamente assim que apareceu num relato: "o jogo travou".
   *
   * Este invólucro separa as duas coisas. O quadro pode falhar; o laço, não.
   * A exceção é registrada uma vez (com o quadro em que aconteceu, para ela ser
   * encontrável) e o próximo quadro é pedido de qualquer forma — um engasgo
   * visível de um quadro em vez de um jogo morto. Nada é engolido em silêncio:
   * o `console.error` continua lá, e o aviso na tela diz que algo falhou.
   */
  frame(now) {
    try {
      this.frameInterno(now);
    } catch (err) {
      this._framesRuins = (this._framesRuins ?? 0) + 1;
      /* Um aviso por sessão, e não um por quadro: um erro que se repete a 60 Hz
         encheria o console com sessenta cópias por segundo e esconderia a
         primeira — que é a única que interessa. */
      if (this._framesRuins === 1) {
        console.error("erro no quadro (o laço continua):", err);
        this.hud?.toast?.("algo falhou neste quadro — veja o console", "miss");
      }
      requestAnimationFrame(this.frame.bind(this));
    }
  }

  frameInterno(now) {
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

    /* O ESTADO DO MENU É DERIVADO, e não confiado.
     *
     * `input.menuOpen` congela o jogo de propósito: sem ele o corpo anda e o
     * arco atira por baixo do menu. O risco é o espelho ficar preso — o painel
     * some da tela e a bandeira continua de pé, e aí o jogo fica sem responder
     * a nada, com o cursor solto e nenhuma explicação. É exatamente a cara de
     * um travamento, e nenhum caminho de erro avisaria.
     *
     * Conferir contra a verdade (o painel está visível?) uma vez por quadro
     * custa uma leitura de propriedade e torna esse estado impossível de
     * emperrar, venha o descompasso de onde vier. */
    if (this.input.menuOpen !== this.hud.commandMenuOpen) {
      this.input.setMenuOpen(this.hud.commandMenuOpen);
    }

    const actions = this.input.consume();
    this.handleActions(actions);

    /* O corpo já tombou: a câmera solta e o voo de espectador começa. Testado
       aqui, no laço, e não num `setTimeout` da mensagem — o relógio que vale é
       o da SALA, e um temporizador local acordaria fora de fase com o tombo que
       todo mundo está vendo. */
    if (this.spectateAt && this.net.serverTime >= this.spectateAt) {
      this.entrarNoEspectador();
    }

    /* A ORDEM importa, e são DUAS regras encadeadas:
     *
     * 1. O passo da física vem entre a ENTRADA e a POSE. `updateAimAndPose` lê
     *    o teclado e entrega ao controlador a velocidade desejada; `stepPhysics`
     *    integra e escreve a posição de render deste quadro; só então o corpo é
     *    montado em cima dela. Montar a pose antes — que era o que acontecia —
     *    desenhava o arqueiro na posição do quadro ANTERIOR, e como a câmera é
     *    rígida nele, a distância percorrida na tela passava a valer o `dt` do
     *    quadro passado enquanto o tempo que ela ocupava era o deste. Medido com
     *    ±3 ms de tremor no relógio de quadros: a velocidade aparente variava
     *    entre 2,3 e 4,4 m/s numa caminhada de 3,2 m/s. Nesta ordem ela dá
     *    exatamente 3,2 m/s, sem desvio.
     *
     * 2. A câmera define a mira (systems/aim.js), então ela é posicionada ANTES
     *    do raycast, e o raycast antes do disparo. */
    this.syncCameraMode();
    this.updateAimAndPose(dt, actions);

    /* O vento é função do relógio da SALA, não do local. É essa amarração que
       permite mandar um evento de disparo em vez da trajetória inteira: com o
       mesmo vento no mesmo instante, cada cliente recalcula a mesma curva e o
       mesmo traçado. Sozinho, o relógio local serve igual. Fica antes do passo
       porque é ele que empurra as flechas em voo. */
    if (this.net.connected) this.wind.setTime(this.net.serverTime / 1000);
    else this.wind.update(dt);

    this.stepPhysics(dt);
    this.applyPlayerPose(dt);
    // Não recebe `dt`: os dois gatilhos são de ESTADO (tocou o chão, cruzou meio
    // ciclo de passada), não de tempo decorrido. Ver `updateFootDust`.
    this.updateFootDust();
    this.updateJetFlame(dt);
    this.updateCamera(dt);
    /* Espectador não tem mira: `solveAim` lança um raio por quadro a partir de
       um ponto de vista que a câmera livre já abandonou, e o resultado não é
       lido por ninguém — o retículo está escondido e o arco, bloqueado. */
    if (!this.spectator.ativo) this.solveAim();
    if (
      actions.release &&
      !this.modePreparing &&
      !this.death.dying &&
      // Espectador não atira. Ele é uma câmera, não um arqueiro.
      !this.spectator.ativo &&
      !this.player.isReloading &&
      !this.player.isKnifeAttacking
    ) {
      this.shoot();
    }

    this.arrows.update(dt);
    /* A câmera vai a TODOS os bichos. Ela sempre foi necessária para o alce (é
       ela que orienta a barra de vida); agora também decide o nível de detalhe
       de cada corpo — ver `utils/lod.js`. */
    this.boars.update(dt, this.renderer.camera);
    this.elks.update(dt, this.renderer.camera);
    this.birds.update(dt, this.renderer.camera);
    this.zombies.update(dt, this.renderer.camera);
    this.meteors.update(dt, this.renderer.camera);
    this.morcegos.update(dt);
    this.souls.update(dt, this.renderer.camera);
    this.updateSiege(dt);
    this.special?.update(dt);
    this.updateMeteorHud(dt);
    this.torches.update(dt);
    this.updateNight(dt);
    /* DEPOIS da noite, sempre. `setNight` também escreve hemisférica, névoa e
       intensidade do Sol; se o entardecer viesse antes, a volta da noite ao dia
       (sair do modo zumbi) apagaria o pôr do sol do castelo no mesmo quadro. */
    this.updateDusk();
    this.updateBossStorm(dt);
    if (this._zombieOn) this.audio.tickAmbient(dt, this.renderer.camera.position);
    this.trails.update(dt);
    this.particles.update(dt);
    this.updateBossFlashes(dt);
    /* O relógio da SALA vai junto: é ele que sincroniza a estrela cadente e a
       baliza do foguete entre as telas, sem trafegar nada — o mesmo contrato
       que o vento já usa duas dezenas de linhas acima. */
    this.environment.update(
      dt,
      this.wind.vector,
      this.livePlayers(),
      this.net.serverTime,
      // O castelo usa: é por ele que os braseiros sabem quanta luz ainda há.
      this.dusk ?? 0,
    );
    this.updateRideables();
    this.death.update(this.net.serverTime);
    this.respawn.update(this.net.serverTime);
    // Depois da câmera do frame: a distância dela decide o descarte e a escala
    // da etiqueta de nome.
    this.series.update(dt, this.renderer.camera);
    this.remotes.update(dt, this.net.serverTime, this.renderer.camera);
    /* A bandeira DEPOIS dos remotos: ela gruda no boneco interpolado de quem a
       carrega, e o boneco acabou de ser movido neste quadro. Um quadro atrás
       seria um quadro de bandeira flutuando fora da mão. */
    for (const time of ["humans", "bots"]) {
      const f = this.flags[time];
      this.flags[time].update(
        dt,
        this.posicaoDoPortador(f.carrier),
        f.carrier != null && f.carrier === this.net.me?.id,
        this.renderer.camera,
      );
    }
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
    /* A CÂMERA DA FLECHA VALE EM TODOS OS MODOS, e a tecla é o C.
     *
     * A guarda de cerco que morava aqui existia porque a tecla era o F, e no
     * cerco o F é a MÃO — trabuco, manivela e reparo (ver `systems/siege.js`).
     * Com a câmera da flecha no C (ver `input.js`) os dois deixaram de disputar
     * a mesma tecla, e a exceção some junto: acompanhar a própria flecha caindo
     * dentro da fila do portão é justamente o tipo de coisa que este modo
     * ganha em mostrar. */
    if (a.toggleArrowCam) {
      const on = !this.rig.followArrowEnabled;
      this.rig.setFollowArrow(on);
      this.hud.toast(
        on ? "câmera da flecha ligada" : "câmera da flecha desligada",
        "miss",
      );
    }
    if (a.confirmOverlay && this.huntVictoryOpen) {
      /* Fecha E recomeça — como o cerco e a chuva sempre fizeram. Pedir de
         novo o MESMO modo que acabou de terminar é o caminho mais curto: o
         servidor já sabe recriar bicho, horda e posições do zero (é o que
         `setMode` faz para QUALQUER entrada no modo, nova ou repetida). Sem
         isto a tela de vitória era um beco sem saída — fechava, e a única
         forma de jogar de novo era lembrar o atalho do modo escondido no
         menu. */
      this.huntVictoryOpen = false;
      this.hud.hideHuntVictory();
      this.net.send(C2S.MODE, { mode: this.mode });
    } else if (a.confirmOverlay && this.gameOverRestartOpen) {
      /* `else if`, e não um segundo `if`: se as duas telas estivessem abertas,
         um Enter fecharia a de vitória E recomeçaria a partida no mesmo toque.
         Aqui a de cima sempre ganha, e o segundo Enter faz a outra coisa. */
      this.gameOverRestartOpen = false;
      this.hud.hideZombieCenter();
      this.net.send(C2S.MODE, { mode: this.mode });
    } else if (a.confirmOverlay && this.siegeRestartOpen) {
      /* O MESMO Enter do fim da chuva, no fim do cerco.
       *
       * O modo termina de duas maneiras (o portão caiu, ou o Sol se pôs) e as
       * duas deixavam a pessoa olhando uma tela de resultado sem saída: a
       * única forma de jogar de novo era lembrar do atalho do modo. Recomeçar
       * é pedir o modo de novo à sala — `setMode` já refaz portão, horda,
       * engenhos e posições. */
      this.siegeRestartOpen = false;
      this.hud.hideSiegeOver();
      this.net.send(C2S.MODE, { mode: "siege" });
    }
    // Qualquer um pode soltar um porco e todos veem. Não vale ponto: quem
    // solta escolheria a distância, e a caçada pontua justamente por distância.
    if (a.spawnBoar) this.net.send(C2S.SPAWN_BOAR);
    // Um alce avulso, em qualquer modo. Como o porco do P, não vale ponto.
    if (a.spawnElk) this.net.send(C2S.SPAWN_ELK);
    if (a.spawnElkWolves && this.mode === "elkHunt") {
      this.net.send(C2S.SPAWN_ELK_WOLVES);
    }

    /* `doMenu` diz que a intenção nasceu de um CLIQUE, e não de uma tecla —
       ver `Hud.onCommand`. É só isso que decide se há pergunta de confirmação. */
    if (a.setMode) this.askModeChange(a.setMode, a.doMenu === true);
    if (a.setLevel) this.askLevelChange(a.setLevel, a.doMenu === true);
    if (a.setMeteorRain) this.askMeteorRain(a.setMeteorRain);
    if (a.setSiege) this.askSiege(a.setSiege);
    /* Pôr e tirar bot é PEDIDO À SALA. O aviso na tela não sai daqui: ele vem
       do `S2C.JOIN`/`S2C.LEAVE` que o servidor manda para todo mundo, porque um
       adversário novo em campo é notícia para a sala inteira, não só para quem
       apertou a tecla. */
    if (a.toggleBot) {
      this.net.send(C2S.BOT, { remove: a.toggleBot === "remove" });
    }
    if (a.cycleBotDifficulty) {
      this.net.send(C2S.BOT_DIFFICULTY, { step: a.cycleBotDifficulty });
    }
    /* O atalho de teste do cerco. Só no cerco: o relógio que ele adianta é o
       da partida do modo, e fora dele não existe. */
    if (a.siegeSkip && this._siegeOn) {
      this.net.send(C2S.SIEGE_SKIP, {
        to: a.siegeSkip === "climber" ? "climber" : null,
      });
    }
    if (a.toggleMusic) {
      const on = this.audio.toggleMusic();
      this.hud.toast(on ? "música ligada" : "música desligada", "miss");
    }
    /* ATALHO DE TESTE: a barra cheia num toque. Quem enche é a SALA, e não esta
       linha — o cliente não é dono da barra em lugar nenhum, e um atalho que
       escrevesse `special.charge` direto testaria um caminho que o jogo não
       tem. Ver `C2S.KAME_FILL`. */
    if (a.fillSpecial) {
      if (this.special.habilitado) this.net.send(C2S.KAME_FILL, {});
      else this.hud.toast("o especial não existe neste modo", "miss");
    }
    if (a.special) {
      if (this.special.pronto) {
        /* Sai do tensionamento antes: não dá para segurar a corda e juntar as
           mãos ao mesmo tempo, e a flecha encaixada some junto (`setKame`). */
        this.input.drawing = false;
        this.drawTime = 0;
        this.cancelKnifeAttack();
        this.special.fire();
      } else if (this.special.habilitado && !this.special.ativo) {
        const falta = this.special.max - this.special.charge;
        this.hud.toast(`especial: faltam ${falta} acertos`, "miss");
      }
    }
    if (a.toggleDebug) this.debug.toggle();
    if (a.toggleCommandMenu) this.hud.toggleCommandMenu();
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
    /* Três coisas passam por aqui: a noite dos zumbis, que compila shaders, a
       CHUVA, que compila malhas de rocha e materiais de fogo, e a TROCA DE
       FASE, que destrói um mundo e constrói outro. As três custam centenas de
       milissegundos, e as três precisam que a sala espere todo mundo — num modo
       com prazo, entrar dois segundos depois dos outros decide a partida. */
    const chuva = msg.mode === "meteorRain";
    /* E o CERCO, pelo mesmo motivo dos outros dois: ele compila oito silhuetas
       de sitiante, o disco de piche aditivo e a pedra em chamas. Sem entrar
       nesta lista o cliente simplesmente NÃO RESPONDE ao preparo — e o sintoma
       é o pior possível: a sala espera, o prazo estoura, a troca é cancelada e
       o jogador fica no modo livre dentro de um castelo, sem nenhum erro em
       lugar nenhum. Foi exatamente o que aconteceu na primeira execução. */
    const cerco = msg.mode === "siege";
    if (!isZombieMode(msg.mode) && !chuva && !cerco && !trocaDeFase) return;

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
      : cerco
        ? "eles estão subindo a rampa…"
        : chuva
          ? "o céu vai desabar…"
          : msg.mode === "zombieBoss"
          ? "preparando o chefão…"
          : "preparando a noite…";
    this.hud.showModeLoading(titulo);
    this.hud.updateModeLoading(msg.ready ?? 0, msg.total ?? 1, "preparando…");
    this.playerPhysics.setHorizontalMove(0, 0);

    if (!trocaDeFase) {
      // Aquecimento. Numa troca de fase isto não faz sentido: o mundo que seria
      // aquecido está prestes a deixar de existir.
      this.birds.clear();
      if (cerco) {
        this.siege.prepare();
      } else if (chuva) {
        this.meteors.prepare();
      } else {
        this.torches.build({ dormant: true });
        this.zombies.prepare();
      }
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

    const chuva = this.modePrepareTarget === "meteorRain";
    const cerco = this.modePrepareTarget === "siege";
    if (cerco) {
      this.siege.setWarmupVisible(true);
    } else if (chuva) {
      this.meteors.setWarmupVisible(true);
    } else {
      this.zombies.setWarmupVisible(true);
      this.torches.setWarmupVisible(true);
    }
    this.hud.updateModeLoading(
      0,
      1,
      cerco
        ? "afiando as flechas…"
        : chuva
          ? "acendendo as rochas…"
          : "aquecendo iluminação e shaders…",
    );

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
    this.meteors.setWarmupVisible(false);
    this.siege.setWarmupVisible(false);
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
    this.siege.setWarmupVisible(false);
    this.zombies.setWarmupVisible(false);
    this.torches.setWarmupVisible(false);
    this.meteors.setWarmupVisible(false);
    this.hud.hideModeLoading();
  }

  /**
   * A lista de quem está em campo, vinda da SALA — e a nossa, ajustada a ela.
   *
   * Os bonecos alheios são montados por `S2C.JOIN` e desmontados por
   * `S2C.LEAVE`, mensagens avulsas que dependem de chegar todas, na ordem, e
   * nada se perder. Isso vale na vida normal da sala e NÃO vale na troca de
   * fase: o mundo local é demolido e reconstruído no meio da conversa, e a
   * sala, na mesma hora, dispensa os adversários de CPU (eles não atravessam —
   * ver `Room.commitPreparedMode`). Um `LEAVE` de bot que caísse nessa janela
   * deixava um arqueiro de CPU **parado para sempre** na fase nova: um boneco
   * sem dono, que nenhuma pose vinha mais atualizar, ocupando memória e
   * colisor. É o "bot paralisado na Lua".
   *
   * Reconciliar contra a lista completa fecha a categoria inteira de problema,
   * em vez de tapar este caso: quem não está nela sai (com colisor, sprite de
   * nome e ragdoll juntos, por `remove`), quem falta entra.
   */
  reconcileRoster(roster) {
    const vivos = new Set(roster.map((p) => p.id));
    const eu = this.net.me?.id;

    for (const id of [...this.remotes.byId.keys()]) {
      if (vivos.has(id)) continue;
      this.remoteArrows.forget(id);
      this.remotes.remove(id);
    }
    for (const p of roster) {
      if (p.id === eu) continue;
      this.remotes.add(p);
    }
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

    if (msg.roster) this.reconcileRoster(msg.roster);

    const mudouModo = this.mode !== msg.mode;
    if (mudouModo) this.cancelKnifeAttack();
    this.mode = msg.mode;
    this.scoreboard.setMode(msg.mode);
    // O placar de times só existe no modo dele.
    this.hud.setTeamScores(msg.mode === "teamDuel" ? this.teamScores : null);

    /* No modo série, os sete alvos fixos SOMEM — o campo fica limpo e existe um
       alvo só, o da vez. Deixá-los na cena tiraria o sentido do modo: com alvos
       espalhados por toda parte, "o próximo está mais longe" não significa nada,
       e ainda por cima uma flecha perdida cravaria num alvo velho. */
    /* Os alvos fixos somem na série (um alvo por vez é o modo) e na noite dos
       zumbis — lá o pedido é campo limpo: nem mira, nem madeira, nem bicho. */
    const escondeFixos =
      msg.mode === "series" || isZombieMode(msg.mode) || msg.mode === "meteorRain";
    for (const alvo of this.targets) alvo.setActive(!escondeFixos);
    this.marker.visible = !escondeFixos;
    this.hud.setMode(
      msg.mode,
      msg.invites ?? [],
      msg.needed ?? 2,
      this.net.me?.id,
      msg.level ?? this.levels.id,
      /* O nível da chuva vem do ESTADO, não desta mensagem, e chega a tempo:
         a sala manda o `METEOR_STATUS` antes do `MODE` (ver `Room.setMode`, em
         que o `broadcastMode` é a última linha) e o WebSocket entrega em ordem.
         Quem entra na sala já vem com ele no `snapshot`.

         SÓ A CHUVA: o cerco tem nível também, mas não tem faixa — ela é
         suprimida para ele em `Hud.setMode`, e o nível dele sai no rótulo do
         portão. Passá-lo aqui seria alimentar um parâmetro que ninguém lê. */
      this.meteorState?.difficulty ?? null,
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
    this.applyMeteorMode(msg.mode === "meteorRain");
    this.applySiegeMode(msg.mode === "siege");
    this.applyArenaModes(msg.mode);
    this.special?.setMode(msg.mode);
    if (mudouModo) this.applyArrowCameraMode(msg.mode);
    if (msg.mode !== "elkHunt") {
      this.elkState = null;
      this._elkHudCountdown = false;
    }
  }

  /**
   * O passo do cerco, e a tecla dele.
   *
   * `F` é lida como ESTADO (segurando ou não), não como evento, porque as três
   * ações que ela dispara são as três de segurar: tensionar o contrapeso, içar
   * a manivela e reforçar o portão. Soltar É atirar — a mesma regra do arco, e
   * o jogador não precisa aprender uma segunda.
   */
  updateSiege(dt) {
    if (!this._siegeOn) return;
    const pos = this.player.position;
    const segurando = this.input.keys.has("KeyF");

    /* NA MIRA, `F` e o mouse mudam de significado.
     *
     * O mouse deixa de girar o arqueiro e passa a arrastar a marca no chão; o
     * clique deixa de tensionar o arco e passa a soltar a pedra; `F` e `Esc`
     * desistem. O corpo do jogador fica parado onde estava — ele está operando
     * uma máquina, não andando. */
    if (this.siege.mira) {
      const dx = this.input.yaw - (this._miraYaw ?? this.input.yaw);
      const dy = this.input.pitch - (this._miraPitch ?? this.input.pitch);
      this.siege.moverMira(dx, dy);
      /* O rumo do JOGADOR é devolvido no mesmo quadro: sem isto ele sai da
         mira olhando para onde a marca foi parar, tonto. */
      this.input.yaw = this._miraYaw;
      this.input.pitch = this._miraPitch;
      this.playerPhysics.setHorizontalMove(0, 0);

      if (this.input.primaryDown && !this._miraClique) this.siege.dispararMira();
      this._miraClique = this.input.primaryDown;
      if (segurando && !this._siegeF) this.siege.sairDaMira();
      this._siegeF = segurando;
      /* SAIU DA MIRA COM O BOTÃO AINDA APERTADO — pela pedra ou por `F`.
         O bloqueio do arco cai no mesmo quadro, e um `primaryDown` sobrevivente
         viraria um draw que ninguém pediu. Zerá-lo custa um clique a mais para
         voltar a atirar de arco, que é exatamente o que se quer. */
      if (!this.siege.mira) {
        this.input.primaryDown = false;
        this._miraClique = false;
      }
      this.hud.setSiegeHint("mirando");
      this.siege.update(dt, this.renderer.camera, null, pos);
      return;
    }
    this._miraYaw = this.input.yaw;
    this._miraPitch = this.input.pitch;
    this._miraClique = this.input.primaryDown;

    if (segurando && !this._siegeF) this.siege.usar(pos);
    else if (!segurando && this._siegeF) this.siege.soltar();
    this._siegeF = segurando;

    this.siege.update(dt, this.renderer.camera, this.player.yaw, pos);

    /* A dica só aparece quando há o que fazer, e diz O QUÊ. Uma tecla com três
       significados sem dizer qual está valendo é pior que três teclas. */
    this.hud.setSiegeHint(segurando ? null : this.siege.acaoDisponivel(pos)?.tipo ?? null);
  }

  /**
   * Liga e desliga o cerco.
   *
   * A NOITE vem da FASE, não do modo — o castelo é noturno em partida livre
   * também, e é `onLevelReady` quem cuida disso. O que entra e sai aqui é só o
   * que pertence ao cerco: a horda, os engenhos, o painel e o portão com vida.
   *
   * Sair é a parte que precisa ser exaustiva, como nos modos de arena: uma
   * horda que ficou, um engenho pendurado no muro ou um painel de portão numa
   * partida livre são todos o mesmo defeito — um pedaço de um modo que acabou.
   */
  applySiegeMode(ligado) {
    if (this._siegeOn === ligado) return;
    this._siegeOn = ligado;

    // A flecha incendiária faz sentido de novo: é noite, e o alvo é madeira e
    // osso. Mesmo interruptor do modo zumbi.
    this.arrows.fireArrows = ligado;

    /* A BEIRA DO ADARVE. Este é o único modo com dano de queda, e é por isso
       que é o único com a trava — ver `PlayerPhysics.ledgeGuard`. A faixa de
       tiro tem 90 cm e termina em oito metros; a geometria não deixa pôr
       parapeito ali (o tiro no portão passa a 5 cm do deque), então quem
       segura o passo é o corpo. Pular para fora continua sendo escolha. */
    this.playerPhysics.ledgeGuard = ligado;

    if (ligado) {
      this.siege.terrain = this.terrain;
      this.siege.start(this.levels.current?.gate ?? null, this.wind);
      /* A câmera da flecha sai, como no zumbi e pelo mesmo motivo: ela tira o
         olho do resto da rampa exatamente quando a fila está crescendo. */
      this.rig.setFollowArrow(false);
      this.rig.returnToArcher();
    } else {
      this.siege.stop();
      this.morcegos.clear();
      // Alma a caminho de um arqueiro que acabou de trocar de fase é uma
      // bolinha atravessando o mapa novo em direção a nada.
      this.souls.clear();
      this.siegeState = null;
      this.hud.setSiege(null);
      this.hud.setSiegeHint(null);
      // Saiu do modo: um Enter perdido não pode arrastar a sala de volta para o
      // cerco depois de alguém já ter escolhido outra coisa.
      this.siegeRestartOpen = false;
    }
  }

  /**
   * Liga e desliga os dois modos de arena.
   *
   * Um lugar só para as duas saídas, porque sair deles é o que precisa ser
   * exaustivo: a bandeira tem de desaparecer do mapa e o espectador tem de
   * voltar a ter corpo. Deixar qualquer um dos dois para trás dá o mesmo tipo
   * de defeito — um objeto de um modo que acabou, no meio de outro que começou.
   */
  applyArenaModes(mode) {
    if (mode !== "captureFlag") {
      this.esconderBandeiras();
      this.hud.setFlag(null);
    }
    if (mode !== "lastStand") {
      this.sairDoEspectador();
      this.standState = null;
      this.hud.setStand(null);
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

  /**
   * Quanto do enquadramento lateral do especial vale agora (0 a 1).
   *
   * Sobe na carga e desce no retorno, com a mesma curva da pose — e continua
   * valendo enquanto o feixe do PRÓPRIO jogador estiver vivo, mesmo depois de
   * a pose acabar: a dissipação dura mais que ela, e a câmera voltando para
   * trás do ombro no meio do feixe o enfiaria na tela outra vez.
   */
  enquadramentoEspecial() {
    const s = this.special;
    if (!s) return 0;
    if (s.meuFeixe && !s.meuFeixe.morto) return 1;
    if (!s.ativo) return 0;
    const S = CONFIG.special;
    const t = s.t;
    if (t < S.charge) return smoothstep01(t / Math.max(0.001, S.charge * 0.6));
    const inicioRetorno = s.total - S.recover;
    if (t > inicioRetorno) {
      return 1 - smoothstep01((t - inicioRetorno) / Math.max(0.001, S.recover));
    }
    return 1;
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
   * Todo mundo vivo em campo — o seu boneco e os remotos.
   *
   * É o que os aliens perseguem. Reaproveita um array só entre os quadros:
   * alocar uma lista de doze objetos sessenta vezes por segundo é lixo que o
   * coletor vem cobrar no meio de um tiro.
   */
  livePlayers() {
    const lista = (this._livePlayers ??= []);
    lista.length = 0;
    if (!this.death.dying) lista.push(this.player.position);
    /* Os bots entram aqui SOZINHOS, sem uma linha para eles: agora são
       jogadores da sala e chegam como `RemotePlayer`, junto dos humanos. */
    for (const r of this.remotes.byId.values()) {
      if (!r.dyingSince) lista.push(r.player.position);
    }
    return lista;
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
  askLevelChange(id, semPergunta = false) {
    if (this.swappingLevel) return;

    /* A MESMA TECLA leva e traz. Sem isso, quem foi para a Lua não teria como
       voltar: as teclas 1–8 são de MODO, e modo não é fase. Uma tecla que só
       funciona de ida é uma tecla quebrada na metade das vezes que se aperta. */
    const alvo = this.levels.id === id ? DEFAULT_LEVEL : id;
    const nome = levelInfo(alvo).nome;
    const artigo = alvo === "moon" ? "a Lua" : `o ${nome}`;

    /* Ver `askModeChange`: um botão de menu não precisa ser confirmado, e a
       confirmação por cima do menu recém-fechado deixava a pergunta na tela
       sem cursor para respondê-la. */
    const viajar = () => {
      /* A FASE É DA SALA. Quem confirma pede ao servidor, que prepara todo
         mundo junto e só então confirma a troca — trocar localmente deixaria
         cada um numa fase, com as poses dos outros chegando em coordenadas de
         um terreno que não é o seu. Sem servidor (queda de rede), a troca local
         ainda funciona e é melhor que uma tecla que não faz nada. */
      if (this.net.connected) this.net.send(C2S.LEVEL, { level: alvo });
      else this.changeLevel(alvo, { titulo: `viajando para ${nome.toLowerCase()}…` });
    };
    if (semPergunta) viajar();
    else this.ask(`Ir para ${artigo}?`, viajar);
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
    this.meteors.dispose();
    this.morcegos.dispose();
    /* `clear` e NÃO `dispose`, e a diferença aqui é um defeito real que custou
       uma sessão: os outros gerenciadores refazem os próprios lotes na primeira
       vez que precisam deles, e as almas não — os 64 sprites nascem no
       construtor e vivem a sessão inteira. Chamar `dispose` na troca de fase
       esvaziava o lote e deixava a lista de vagas cheia: a primeira morte no
       cenário novo pedia um sprite que já não existia e o handler de rede
       quebrava no meio (`SoulSystem.spawn`).

       Nada se perde ao apenas limpar: as almas não pertencem a fase nenhuma —
       morre monstro no vale, no castelo e na Lua — e os sprites estão na cena,
       que sobrevive à troca. */
    this.souls.clear();
    this.special?.cancel();
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
    /* A TERRA VOLTA INTEIRA na troca de fase.
       Ela some quando alguém acerta o feixe nela (ver `Renderer.blastEarth`), e
       isso é para durar a sessão de quem estava lá — não a vida do processo.
       Chegar à Lua e encontrar o céu sem planeta, sem ter visto o golpe, seria
       um cenário quebrado sem explicação nenhuma. */
    this.renderer.resetEarth();

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

    /* A NOITE DO CASTELO É DA FASE, não do modo.
     *
     * No vale a noite é o modo zumbi ligando um interruptor; aqui ela é a hora
     * do lugar, e vale em partida livre e em duelo também. Pôr isso em
     * `applySiegeMode` faria o castelo amanhecer ao apertar 1 — com braseiros
     * acesos, céu preto no material do céu e sol a pino ao mesmo tempo. */
    this.refreshNightTarget();

    if (this.player) this.player.terrain = terrain;
    if (this.death) {
      this.death.terrain = terrain;
      this.death.ragdoll.terrain = terrain;
    }
    for (const sistema of [this.boars, this.elks, this.birds, this.zombies, this.meteors, this.torches, this.series, this.siege]) {
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
    /* Os bots vêm no mesmo balaio dos remotos: quem religa o terreno deles é
       `setTerrain`, e quem os reposiciona é o servidor. Nada a fazer aqui. */
    if (this.remotes) this.remotes.setTerrain(terrain);

    /* O PORTÃO é da fase, e a fase acabou de nascer.
     *
     * Quem entra numa sala que já está em cerco liga o modo no `welcome` — e
     * naquele instante o castelo ainda não existe deste lado (o cliente
     * arranca no vale e troca depois). O cerco começava, portanto, apontando
     * para um portão nulo, e a barra do HUD nunca casava com a folha de
     * madeira na tela. Aqui é onde os dois se encontram. */
    if (this._siegeOn && fase.gate) {
      this.siege.gate = fase.gate;
      if (this.siegeState) fase.gate.setHealth(this.siegeState.gate ?? 1);
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

    this.refreshNightTarget();
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

  /**
   * Entrar e sair da chuva de meteoros.
   *
   * O modo não escurece nada (a Lua já é preta) e não muda a física; o que ele
   * troca é a TRILHA e o que se espera do céu. A música é a mesma do chefão
   * zumbi — `lua_de_ossos`, a única faixa pesada que o jogo tem —, e ela entra
   * por um método próprio (`setMusicTrack`) em vez de `setAmbientNight`, porque
   * aqui não há grilo nenhum para tocar junto: é vácuo, e o vácuo é mudo.
   */
  applyMeteorMode(ligado) {
    if (this._meteorOn === ligado) return;
    this._meteorOn = ligado;

    this.audio.setMusicTrack(ligado ? "zombie" : "day");
    // Flecha em chamas: a mesma da noite. Contra o preto do céu, o traço quente
    // é o que diz para onde o tiro foi.
    this.arrows.fireArrows = ligado || this._zombieOn === true;
    this.rig.setFollowArrow(!ligado);

    if (!ligado) {
      this.meteors.clear();
      this.meteorState = null;
      this.special?.cancel();
      this.hud.setMeteor(null);
      this.hud.setSpecial(null);
      this.hud.setBossHp(null);
      this.hud.hideZombieCenter();
      this.hud.clearDanger();
      this.hud.clearMeteorMarks();
      // Saiu do modo: um Enter perdido não pode arrastar a sala de volta para a
      // chuva depois de alguém já ter escolhido outra coisa.
      this.gameOverRestartOpen = false;
    }
  }

  /**
   * O alerta da tela — o que impede a morte "não vi".
   *
   * Sem isto o modo é injusto, porque a rocha que mata é sempre a que estava
   * fora do campo de visão. Uma seta só (a mais urgente; três seriam ruído) e
   * um pulso vermelho na borda que fica contínuo quando o perigo é real.
   */
  updateMeteorHud(dt) {
    if (!this._meteorOn) return;
    const M = CONFIG.modes.meteorRain;
    const st = this.meteorState;

    /* A BARRA DO COLOSSO. Só ele tem uma, e só enquanto está em campo.
     *
     * As outras rochas pedem de uma a três flechas, e o escurecimento do
     * material já conta essa história inteira. O colosso pede até dezoito e
     * fica mais de um minuto na tela: sem um número, atirar nele é atirar num
     * muro sem saber se está adiantando. Reusa a barra do chefão zumbi — é a
     * mesma informação, no mesmo lugar, com outro substantivo.
     *
     * ANTES dos dois `return` abaixo (a contagem de entrada e o fim de
     * partida), senão ela ficaria pendurada na tela durante os dez segundos de
     * contagem da horda seguinte. */
    this.hud.setBossHp(st?.tankHp ?? null, "COLOSSO");

    /* A contagem de entrada. O que chegou pela rede foi o INSTANTE, não os
       segundos — então o retardatário recebe um horário no passado, a
       subtração dá negativo e ele simplesmente não vê contagem nenhuma.

       O `_contando` existe porque esconder a faixa não pode depender de a
       contagem ter sido MOSTRADA: o `startsAt` some do estado assim que a
       horda 1 começa, e sem esta memória o caminho de esconder nunca rodava —
       o número ficava pendurado na tela pela partida inteira. */
    const falta = st?.startsAt ? (st.startsAt - this.net.serverTime) / 1000 : 0;
    if (falta > 0) {
      this._contando = true;
      const n = Math.ceil(falta);
      this.hud.showZombieCenter(`${n}`, "a primeira chuva está vindo", "countdown");
      if (n <= 3 && n !== this._lastCountBeep) {
        this._lastCountBeep = n;
        gameEvents.emit(EventType.AUDIO_PLAY, {
          sound: "uiBeep",
          position: vec3Payload(this.player.position),
          volume: 0.55,
        });
      }
      this.hud.setMeteor(st);
      return;
    }
    if (this._contando) {
      this._contando = false;
      this._lastCountBeep = null;
      this.hud.hideZombieCenter();
    }

    this.hud.setMeteor(st);
    if (st?.over) {
      this.hud.clearDanger();
      this.hud.clearMeteorMarks();
      return;
    }
    // Partida em andamento: o Enter de recomeçar não vale mais. Aqui e não no
    // handler do modo porque é este estado — e não a mensagem — que diz que a
    // chuva voltou a rodar.
    this.gameOverRestartOpen = false;

    /* UM MARCADOR POR ROCHA, sem limiar de altitude nenhum.
     *
     * Antes era uma seta só, a da rocha mais baixa, e ela só aparecia depois de
     * a rocha cruzar `warnAltitude`. As duas economias custavam a mesma coisa:
     * quem estava girando a câmera não tinha como saber QUANTAS rochas havia.
     * Marcando todas desde o nascimento, contar é olhar — e a decisão do modo
     * ("qual das quatro eu atiro agora") passa a ter os dados na tela.
     *
     * O custo é irrelevante: o teto de rochas vivas é 16 (`maxAlive`), e cada
     * marcador é uma `transform` num nó reaproveitado. */
    const marcas = (this._meteorMarks ??= []);
    marcas.length = 0;
    let maisBaixa = Infinity;
    for (const m of this.meteors.byNetId.values()) {
      const alt = m.altitude;
      if (alt < maisBaixa) maisBaixa = alt;
      marcas.push({
        angulo: this.screenDirection(m.group.position),
        x: this._ndc.x,
        y: this._ndc.y,
        alt: Math.round(alt),
        perigo: alt <= M.dangerAltitude,
        aviso: alt <= M.warnAltitude,
      });
    }
    /* Mais baixa primeiro. O pool do HUD é reaproveitado por ÍNDICE, e ordenar
       por altitude mantém as rochas críticas nos mesmos nós de um quadro para o
       outro — que é o que impede a animação de pulso de reiniciar cada vez que
       uma rocha morre e as outras deslizam de posição na lista. */
    marcas.sort((a, b) => a.alt - b.alt);
    this.hud.setMeteorMarks(marcas);

    /* A MOLDURA continua sendo da mais baixa, e continua com limiar. Ela é o
       alarme, não o inventário: acesa por qualquer rocha alta, seria uma tela
       vermelha permanente e deixaria de significar "agora". */
    if (!marcas.length || maisBaixa > M.warnAltitude) {
      this.hud.clearDanger();
      return;
    }

    const alt = maisBaixa;
    // Quanto mais baixa, mais forte — e abaixo do limiar de perigo, contínuo.
    const t = 1 - Math.max(0, alt - M.dangerAltitude) / (M.warnAltitude - M.dangerAltitude);
    const perigo = alt <= M.dangerAltitude;
    this.hud.setDanger(perigo ? 1 : Math.min(1, t), perigo);

    this._beepTimer = (this._beepTimer ?? 0) - dt;
    if (perigo && this._beepTimer <= 0) {
      this._beepTimer = 0.45;
      gameEvents.emit(EventType.AUDIO_PLAY, {
        sound: "uiBeep",
        position: vec3Payload(this.player.position),
        volume: 0.5,
      });
    }
  }

  /**
   * Onde este ponto está em relação à tela: `null` se visível, ou o ângulo da
   * borda para onde a seta aponta.
   *
   * Deixa a projeção em `this._ndc` de brinde — quem precisa da posição NA tela
   * (o marcador da rocha visível) já a tem, sem projetar duas vezes.
   */
  screenDirection(pos) {
    const camera = this.renderer.camera;
    const v = (this._ndc ??= new THREE.Vector3());
    v.copy(pos).project(camera);
    const atras = v.z > 1;
    if (!atras && Math.abs(v.x) <= 0.95 && Math.abs(v.y) <= 0.95) return null;
    let x = v.x;
    let y = v.y;
    if (atras) {
      x = -x;
      y = -y;
    }
    return Math.atan2(y, x);
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
  askModeChange(mode, semPergunta = false) {
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

    /* SEM PERGUNTA quando o pedido veio do MENU.
     *
     * A confirmação existe porque os modos moram em teclas de um toque: com
     * `6` a um dedo de `5`, entrar na noite dos zumbis por engano no meio de
     * uma caçada é fácil demais. Um botão dentro de um menu que a pessoa abriu
     * de propósito não tem esse risco — o clique JÁ É a confirmação, e
     * perguntar de novo transforma dois gestos em três.
     *
     * E, o que importa mais: o diálogo abria por cima de um menu que acabara
     * de devolver o ponteiro ao jogo, e a pessoa ficava com uma pergunta na
     * tela e sem cursor para respondê-la. */
    if (semPergunta) {
      this.net.send(C2S.MODE, { mode });
      return;
    }
    const nome = MODE_LABELS[mode] ?? mode;
    this.ask(`Entrar no ${nome}?`, () => this.net.send(C2S.MODE, { mode }));
  }

  /**
   * A chuva de meteoros num nível: fácil, normal ou difícil.
   *
   * SEM PERGUNTA e SEM O GUARDA DE FASE, e as duas coisas pelo mesmo motivo: só
   * o menu escreve nesta ação, e um clique num botão que diz "chuva de
   * meteoros: difícil" já é a intenção inteira, sem ambiguidade nenhuma.
   *
   * O guarda de `askModeChange` recusaria isto no vale — a chuva só existe na
   * Lua —, e recusar seria uma resposta pior do que a verdadeira: a sala sabe
   * levar a fase junto (`levelForMode` e `prepareMode`, no servidor), então
   * clicar daqui viaja para a Lua e começa a chuva, que é exatamente o que o
   * botão promete. O aviso "não existe aqui" só faz sentido para uma TECLA
   * apertada por engano.
   *
   * Trocar de nível recomeça a chuva da horda 1, sempre — ver
   * `C2S.METEOR_DIFFICULTY`.
   */
  askMeteorRain(level) {
    if (!this.net.connected) return;
    this.net.send(C2S.METEOR_DIFFICULTY, { level });
  }

  /**
   * O cerco ao castelo num nível: fácil, normal ou difícil.
   *
   * Gêmeo do `askMeteorRain`, e pelas mesmas razões — sem pergunta e sem o
   * guarda de fase. O guarda recusaria isto na Lua (o cerco só existe no
   * castelo), e recusar seria pior que a verdade: a sala sabe levar a fase
   * junto, então clicar daqui viaja para o castelo e começa o cerco, que é o
   * que o botão promete.
   *
   * Trocar de nível recomeça o cerco, sempre — ver `C2S.SIEGE_DIFFICULTY`.
   */
  askSiege(level) {
    if (!this.net.connected) return;
    this.net.send(C2S.SIEGE_DIFFICULTY, { level });
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

    /* O ESPECIAL PRENDE O CORPO.
     *
     * Sete segundos plantado, sem andar e sem tensionar. Não é limitação
     * técnica: é o preço do golpe — durante eles você não atira flecha, não
     * desvia de alien e não cobre o resto do céu. Numa horda em que uma rocha
     * no chão encerra a partida, escolher a hora de gastar isso é a decisão
     * mais interessante que o modo oferece. */
    const especial = this.special?.travado === true;

    const atacando = this.knifeTimer > 0 || especial;
    const knifeDuration = CONFIG.knife.duration;
    const knifeFraction = atacando && this.knifeTimer > 0
      ? 1 - this.knifeTimer / Math.max(0.001, knifeDuration)
      : 0;
    this.player.setKnife(knifeFraction);

    const recarregando = this.reloadTimer > 0;
    const dur = CONFIG.bow.reloadTime;
    this.player.setReload(recarregando && dur > 0 ? 1 - this.reloadTimer / dur : 0);

    /* NA MIRA DO TRABUCO o arco não tensiona. O clique ali solta a pedra, e
       sem este bloqueio ele soltaria a pedra E começaria a puxar a corda — o
       jogador sairia da mira com uma flecha armada que não pediu.

       O bloqueio tem NOME PRÓPRIO (`"trebuchet"`), e não é detalhe: o `input`
       decide pelo motivo o que fazer com o clique, e todo motivo sem nome cai
       no ramo da câmera da flecha — que APAGA `primaryDown`. Era por isso que
       o botão do mouse não soltava a pedra: a borda de subida que
       `updateSiege` procura nunca chegava a existir. */
    const mirandoTrabuco = !!this.siege?.mira;
    this.input.blockDraw =
      this.rig.isArrowCam || morto || recarregando || atacando || mirandoTrabuco;
    this.input.blockDrawReason = preparando
      ? "modePrepare"
      : this.death.dying
        ? "dead"
        : atacando
        ? "knife"
        : this.rig.isArrowCam
          ? "arrowCam"
          : mirandoTrabuco
            ? "trebuchet"
            : recarregando
              ? "reload"
              : null;
    if (atacando) {
      this.drawTime = 0;
      this.input.drawing = false;
    } else if (mirandoTrabuco) {
      /* O clique é do engenho, não da corda. Sem este ramo o `primaryDown` que
         acabamos de deixar passar entraria no `else if` abaixo e começaria um
         draw por baixo da câmera de mira. */
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

    /* Aqui a entrada acaba e o quadro passa para a física.
     *
     * `move` não desloca ninguém: ele entrega ao controlador a velocidade
     * desejada e avança a fase do passo. Quem move o corpo é o `stepPhysics`, e
     * a pose vem depois dele, em `applyPlayerPose` — ver a nota de ordem no
     * `frameInterno`. O que atravessa são `_moving` e `_knifeFraction`, que a
     * pose precisa e que só a entrada sabe. */
    this._moving = this.player.move(
      dt,
      morto || atacando ? 0 : this.input.forward,
      morto || atacando ? 0 : this.input.strafe,
      morto || atacando ? false : this.input.run,
    );
    this.player.setAim(yaw, pitch);
    this.player.setDraw(atacando ? 0 : drawFraction(this.drawTime));
    this._knifeFraction = knifeFraction;
  }

  /**
   * O corpo montado sobre a posição DESTE quadro.
   *
   * Chamada logo depois de `stepPhysics`, e é essa vizinhança que importa: a
   * posição que ela lê já é a interpolada do quadro corrente
   * (`PlayerPhysics.applyInterpolation`), não a do quadro anterior. Daqui saem,
   * na ordem, a pose, a boca do arco, o olho e o pivô da câmera — tudo o que o
   * resto do quadro (câmera, mira, disparo) consome.
   */
  applyPlayerPose(dt) {
    const knifeFraction = this._knifeFraction ?? 0;
    this.player.update(dt, this._moving);
    if (this.knifeTimer > 0 && knifeFraction >= CONFIG.knife.hitStart && knifeFraction <= CONFIG.knife.hitEnd) {
      this.resolveKnifeHits();
    }
    this.player.getMuzzle(this._muzzle);

    this._forward.copy(this.aim.solveAxis(this.aimYaw, this.player.pitch));
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

    /* O RASTRO. Ele é o mesmo dos outros jogadores, pelo mesmo código: o que
       você deixa no céu é exatamente o que eles veem de você. Distância 0 —
       o rastro do próprio jogador nunca é ralinho pela distância.
       Ver `systems/jetSmoke.js`. */
    if (this.jetpack) {
      this._jetSmoke ??= new JetSmokeTrail();
      this._jetSmoke.step(
        dt, !!j?.active, this.player.position, this.player.yaw, 0, !!j?.isLow,
      );
    }

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
    /* O especial é em TERCEIRA PESSOA, à força. O golpe é o corpo inteiro — a
       postura, as mãos, o afundo — e em primeira pessoa nada disso existe:
       o jogador veria duas mãos e um clarão, que é a versão sem graça da
       mesma coisa. */
    this.rig.setFirstPerson(
      this.input.firstPerson &&
        !this.death.dying &&
        !this.player.isKnifeAttacking &&
        !this.special?.travado,
    );
    /* A câmera acompanha a POSE, não um cronômetro próprio: a mesma fração que
       move os braços move o enquadramento, então a viagem para o lado começa e
       termina junto com o golpe. */
    this.rig.setSpecialFrame(this.enquadramentoEspecial());
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
    /* O MESMO alpha para o mundo e para o jogador — eles precisam sair do mesmo
       instante, senão a interpolação conserta o tremor de um e cria o do outro.
       Ver `PlayerPhysics.applyInterpolation`: o jogador era o único corpo que
       ia para a tela na cota crua do passo fixo, e era isso que fazia a
       caminhada engasgar em qualquer taxa de quadros que não fosse 60 ou 120. */
    const alpha = this.accumulator / h;
    this.sync.apply(alpha);
    this.playerPhysics.applyInterpolation(alpha);
  }

  updateCamera(dt) {
    const camera = this.renderer.camera;

    /* MIRA DO TRABUCO: a câmera sobe e olha o castelo de cima.
     *
     * Sai do `rig` pelo mesmo motivo do espectador — o rig é "a pose da câmera
     * em função da mira e da posição da arqueira", e aqui a câmera não tem nada
     * a ver com nenhuma das duas: ela pertence ao ENGENHO. Ver
     * `SiegeSystem.entrarNaMira` para por que o trabuco precisou de uma vista
     * própria. */
    if (this.siege?.mira) {
      this.siege.camaraDaMira(_miraPos, _miraAlvo);
      camera.position.lerp(_miraPos, Math.min(1, dt * 7));
      camera.lookAt(_miraAlvo);
      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      this.hud.setReticleVisible(false);
      this.player.setVisible?.(true);
      return;
    }

    /* ESPECTADOR: a câmera deixa de pertencer ao arqueiro.
     *
     * Ela sai INTEIRA do `rig` em vez de virar um quarto modo dele. O rig é,
     * por definição, "a pose da câmera em função da mira e da posição da
     * arqueira" — é a regra de ouro escrita no cabeçalho dele —, e um
     * espectador não tem arqueira nem mira. Enfiá-lo ali dentro obrigaria a
     * pôr um `if` em cada uma daquelas contas. */
    if (this.spectator.ativo) {
      this.spectator.update(
        dt,
        this.input,
        this.input.keys.has("Space"),
        this.input.keys.has("KeyC") || this.input.keys.has("ControlLeft"),
      );
      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      this.hud.setReticleVisible(false);
      // O próprio corpo volta a ser visível: você está olhando de fora agora, e
      // o seu cadáver é parte do que há para ver.
      this.player.setHeadVisible(true);
      return;
    }

    // O modo já foi resolvido em `syncCameraMode`, antes da pose.
    this.rig.update(dt, this._forward, this._eye, this._cameraPivot);

    this.player.setHeadVisible(!this.rig.isFirstPerson);

    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

    // Retículo só quando a câmera É o ponto de vista da mira: na câmera da
    // flecha e na do feixe ele apontaria para onde ninguém pode acertar.
    this.hud.setReticleVisible(!this.rig.isCinematic);
  }

  /**
   * A virada dia ↔ noite, em ~1,2 s.
   *
   * É transição e não corte porque o corte lê como falha de render: a tela
   * inteira mudando de cor num quadro só parece que o jogo quebrou. Um segundo
   * de escurecimento, ao contrário, é o próprio anúncio do modo — dá tempo de
   * ver as tochas acendendo antes de a primeira horda aparecer.
   */
  /**
   * De quem é a hora: da FASE, do MODO, ou dos dois.
   *
   * Um lugar só decide, e é o que conserta o defeito que apareceu na primeira
   * execução: `applyZombieMode(false)` escrevia o alvo da luz ao entrar em
   * QUALQUER modo que não fosse zumbi, e rodava depois de `onLevelReady` — a
   * fase mandava, e meio segundo depois o modo desmandava, sem nada no código
   * dizendo isso.
   *
   * São DOIS relógios, e eles não são o mesmo:
   *
   * • `nightTarget` é a NOITE (`setNight`) — o dial do modo zumbi, que apaga o
   *   Sol e acende estrelas. Só o vale usa.
   * • `duskTarget` é o ENTARDECER (`setDusk`) — o Sol descendo, sem nunca se
   *   apagar. Só o castelo usa, e quem o move é o relógio da partida
   *   (`updateDusk`).
   *
   * Misturar os dois foi a primeira tentativa: o castelo entrava por
   * `nightTarget = 1` e escurecia até o breu. Uma tarde não é meia-noite pela
   * metade — ver o bloco de constantes de `setDusk` em `core/renderer.js`.
   */
  refreshNightTarget() {
    this.nightTarget = this._zombieOn === true ? 1 : 0;
    if (this.levels?.id !== "castle") this.duskTarget = 0;
  }

  /**
   * O Sol do castelo, descendo.
   *
   * NO CERCO ele acompanha o relógio da partida: o modo dura dez minutos e
   * termina exatamente quando o Sol toca o horizonte. Não é decoração
   * sincronizada por acaso — é o cronômetro do modo, dito pela única coisa que
   * o jogador não precisa procurar na tela. Quem está sob pressão não lê o
   * relógio do HUD; olha para fora e vê que a luz está acabando.
   *
   * FORA DO CERCO (livre, duelo) não há relógio, então o castelo fica numa
   * tarde fixa — inclinada o bastante para a muralha ter sombra e o cenário ter
   * a cor que a fase pede.
   */
  updateDusk() {
    if (this.levels?.id === "castle") {
      const s = this.siegeState;
      this.duskTarget = s
        ? clamp((s.w ?? 0) / CONFIG.modes.siege.duration, 0, 1)
        : CONFIG.levels.castle.idleDusk;
    }
    /* Sem amortecimento: o alvo já se move a 1/1200 por segundo, que é lento
       demais para o olho perceber degrau. O único salto possível é a TROCA DE
       FASE, e ela acontece atrás da tela de carregamento. */
    this.dusk = this.duskTarget ?? 0;
    this.renderer.setDusk(this.dusk);
  }

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

  /* NAMEKUSEI é outro jogo, e o desvio acontece AQUI — antes de existir física,
     vale ou renderer. Não é economia: é que o jogo do arqueiro prende um
     contexto WebGL ao canvas no construtor, e um segundo contexto sobre o mesmo
     elemento não nasce. Ver `src/namek/boot.js`, que explica o caminho inteiro.

     `import()` dinâmico, e não estático, para que o Vite parta o pacote: quem
     vem jogar arco e flecha não baixa uma linha de Namekusei. */
  if (new URLSearchParams(location.search).get("jogo") === "namek") {
    const { bootNamek } = await import("./namek/boot.js");
    let namek;
    try {
      namek = await bootNamek((passo) => lobby.setStep(passo));
    } catch (err) {
      console.error(err);
      lobby.setError(`falhou: ${err.message}`);
      return;
    }
    window.game = namek;
    lobby.setReady();
    lobby.onEnter = async (nome) => {
      await namek.connect(nome);
      lobby.hide();
      namek.start();
    };
    return;
  }

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

  lobby.onEnter = async (nome, entrada) => {
    // Um erro aqui (sala cheia, servidor fora) volta para o lobby com a
    // mensagem: quem tentou entrar precisa saber por que não entrou.
    await game.connect(nome, entrada);
    lobby.hide();
    game.start();
  };
}

main();
