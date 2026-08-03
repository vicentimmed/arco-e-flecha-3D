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

const loadingStep = document.getElementById("loading-step");
const setStep = (text) => {
  if (loadingStep) loadingStep.textContent = text;
};

class Game {
  constructor(physics) {
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

    this.arrows.onScore = (target, result) => {
      if (result.score > 0) {
        this.hud.addScore(result.score, target.distance);
      } else {
        this.hud.miss("armação do alvo");
      }
    };
    this.arrows.onMiss = (_arrow, what) => this.hud.miss(what);
    this.arrows.onCharacterHit = () => {
      this.hud.toast("flecha cravada no personagem", "miss");
    };

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

    this.updateAimAndPose(dt, actions);
    this.solveAim();
    this.updateCamera(dt);
    if (actions.release) this.shoot();

    this.wind.update(dt);
    this.stepPhysics(dt);
    this.arrows.update(dt);
    this.boars.update(dt, this.player.position);
    this.trails.update(dt);
    this.environment.update(dt, this.wind.vector);

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
    if (a.clearArrows) this.arrows.clearAll();
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
    if (a.spawnBoar) {
      const boar = this.boars.spawnNear(this.player.position);
      this.hud.toast(
        boar ? "porco adicionado" : "sem espaço para spawn",
        boar ? "" : "miss",
      );
    }
    if (a.toggleMusic) {
      const on = this.audio.toggleMusic();
      this.hud.toast(on ? "música ligada" : "música desligada", "miss");
    }
    if (a.toggleDebug) this.debug.toggle();
    if (a.toggleHelp) this.hud.toggleHelp();
  }

  updateAimAndPose(dt, actions) {
    this.input.blockDraw = this.rig.isArrowCam;

    if (this.input.drawing) this.drawTime += dt;

    if (actions.jump) this.player.jump();

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
      this.input.forward,
      this.input.strafe,
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

  solveAim() {
    this.aim.solve(this._eye, this._muzzle);
  }

  shoot() {
    if (this.drawTime < 0.04) {
      this.drawTime = 0;
      return;
    }
    const speed = drawSpeed(this.drawTime);
    const direction = this.aim.direction;

    this._spawn.copy(this._muzzle).addScaledVector(direction, 0.3);

    const arrow = this.arrows.spawn(
      this._spawn,
      direction,
      speed,
      this.player.entityId,
    );
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
    this.rig.setFirstPerson(this.input.firstPerson);
    this.rig.update(
      dt,
      this._forward,
      this._eye,
      this.aim.focus,
      this._cameraPivot,
    );

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

/* ------------------------------------------------------------- bootstrap -- */

async function main() {
  setStep("carregando física (WASM)…");
  await initPhysics();

  const physics = new PhysicsWorld();
  const game = new Game(physics);

  setStep("pronto");
  const loading = document.getElementById("loading");
  loading.classList.add("done");
  setTimeout(() => loading.remove(), 600);

  game.start();

  window.game = game;
}

main().catch((err) => {
  console.error(err);
  setStep(`falhou: ${err.message}`);
});
