/* ---------------------------------------------------------------------------
   Ponto de entrada e laço principal.

   O passo da física é FIXO (1/120 s) e vive num acumulador, separado do
   requestAnimationFrame. O render interpola entre o estado anterior e o atual,
   então a imagem fica suave mesmo com o monitor em 60, 120 ou 144 Hz — e a
   simulação dá exatamente o mesmo resultado em qualquer um deles.
   --------------------------------------------------------------------------- */

import "./style.css";
import * as THREE from "three";

import { CONFIG, drawSpeed, drawFraction } from "./config.js";
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
import { BoarManager } from "./systems/boarManager.js";
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
    this.aim = new AimSolver(physics);
    this.aim.setExcludedCollider(this.playerPhysics.collider);
    this.rig = new CameraRig(this.renderer.camera);
    this.audio = new AudioSystem(this.renderer.camera, this.scene);

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
    });

    this.selectedTarget = 0;
    this.buildTargetMarker();
    this.selectTarget(0, false);

    /* --------------------------------------------------------------- rede -- */
    this.net = new NetClient();
    this.remotes = new RemotePlayers(this.scene, physics, this.terrain);
    this.remoteArrows = new RemoteArrows(this.arrows, () => this.targets);
    this.series = new TargetSeriesView(this.scene, physics, this.terrain);
    this.respawn = new Respawn(this.player, this.playerPhysics);
    this.death = new Death(this.player);
    this.lastStateSent = -Infinity;

    const ui = document.getElementById("ui");
    this.confirm = new ConfirmDialog(ui);
    this.scoreboard = new Scoreboard(ui);
    this.killFeed = new KillFeed(ui);
    this.bindNetwork();

    this.drawTime = 0;
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
      } else {
        this.remotes.get(msg.id)?.applySpawn(msg);
      }
    });

    net.on(S2C.KILL, (msg) => {
      if (msg.victim === net.me?.id) this.death.begin(net.serverTime);
      else this.remotes.kill(msg.victim, net.serverTime);

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
    });

    net.on(S2C.MODE, (msg) => this.applyMode(msg));

    net.on(S2C.SCORES, (msg) => this.scoreboard.setScores(msg.scores));
    net.on(S2C.SCORES_RESET, (msg) => {
      this.hud.toast(`${msg.by} zerou o placar`, "miss");
    });

    net.on("disconnected", () => this.hud.setConnection(false));
    net.on("reconnecting", () => this.hud.setConnection(false));
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
    this.updateCamera(dt);
    this.solveAim();
    if (actions.release && !this.death.dying) this.shoot();

    /* O vento é função do relógio da SALA, não do local. É essa amarração que
       permite mandar um evento de disparo em vez da trajetória inteira: com o
       mesmo vento no mesmo instante, cada cliente recalcula a mesma curva e o
       mesmo traçado. Sozinho, o relógio local serve igual. */
    if (this.net.connected) this.wind.setTime(this.net.serverTime / 1000);
    else this.wind.update(dt);

    this.stepPhysics(dt);
    this.arrows.update(dt);
    this.boars.update(dt);
    this.trails.update(dt);
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

    this.renderer.render();
    requestAnimationFrame(this.frame.bind(this));
  }

  handleActions(a) {
    if (a.cycleTarget) {
      this.selectTarget((this.selectedTarget + 1) % this.targets.length);
    }
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
      this.arrows.options.windInfluence = !this.arrows.options.windInfluence;
      this.debug.syncWindInfluenceToggle(this.arrows.options.windInfluence);
      this.hud.toast(
        this.arrows.options.windInfluence
          ? "vento na flecha ligado"
          : "vento na flecha desligado",
        "miss",
      );
    }
    // Qualquer um pode soltar um porco e todos veem. Não vale ponto: quem
    // solta escolheria a distância, e a caçada pontua justamente por distância.
    if (a.spawnBoar) this.net.send(C2S.SPAWN_BOAR);

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
    this.mode = msg.mode;
    this.scoreboard.setMode(msg.mode);

    /* No modo série, os sete alvos fixos SOMEM — o campo fica limpo e existe um
       alvo só, o da vez. Deixá-los na cena tiraria o sentido do modo: com alvos
       espalhados por toda parte, "o próximo está mais longe" não significa nada,
       e ainda por cima uma flecha perdida cravaria num alvo velho. */
    const escondeFixos = msg.mode === "series";
    for (const alvo of this.targets) alvo.setActive(!escondeFixos);
    this.marker.visible = !escondeFixos;
    this.hud.setMode(msg.mode, msg.invites ?? [], msg.needed ?? 2, this.net.me?.id);
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
    this.input.blockDraw = this.rig.isArrowCam || morto;

    if (this.input.drawing && !morto) this.drawTime += dt;
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
    this.rig.setFirstPerson(this.input.firstPerson);
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

  updateHud() {
    const fraction = drawFraction(this.drawTime);
    this.hud.setDraw(fraction, fraction > 0 ? drawSpeed(this.drawTime) : 0);
    this.hud.setFocus(this.aim.focusDistance, this.aim.hasFocus);
    this.hud.setWind(
      this.wind.speed,
      this.wind.relativeAngle(this.aimYaw ?? 0),
    );
    const target = this.targets[this.selectedTarget];
    if (target) {
      this.hud.setTarget(
        this.selectedTarget,
        target.distanceTo(this.player.position),
      );
    }
    const bc = this.boars.counts;
    this.hud.setBoarCounts(bc.alive, bc.dead);
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
