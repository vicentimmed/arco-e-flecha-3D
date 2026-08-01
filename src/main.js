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
import { Renderer } from "./core/renderer.js";
import { createEnvironment } from "./entities/environment.js";
import { Player } from "./entities/player.js";
import { ArrowManager } from "./entities/arrow.js";
import { createTargets } from "./entities/target.js";
import { Wind } from "./systems/wind.js";
import { CameraRig, CameraMode } from "./systems/camera.js";
import { AimSolver } from "./systems/aim.js";
import { Input } from "./systems/input.js";
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
    this.player = new Player(this.terrain);
    this.scene.add(this.player.root);

    this.arrows = new ArrowManager(this.scene, physics, this.sync, this.wind);
    this.aim = new AimSolver();
    this.rig = new CameraRig(this.renderer.camera);

    this.hud = new HUD(document.getElementById("ui"));
    this.input = new Input(
      document.getElementById("scene"),
      this.hud.el.lockHint,
    );
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

    this._muzzle = new THREE.Vector3();
    this._spawn = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._shadowFocus = new THREE.Vector3();

    this.arrows.onScore = (target, result) => {
      if (result.score > 0) {
        this.hud.addScore(result.score, target.distance);
      } else {
        this.hud.miss("armação do alvo");
      }
    };
    this.arrows.onMiss = (_arrow, what) => this.hud.miss(what);

    this.hud.setPin(this.aim.pinDistance);
  }

  buildTargetMarker() {
    const R = CONFIG.target.faceRadius;
    this.marker = new THREE.Mesh(
      new THREE.TorusGeometry(R * 1.14, 0.022, 8, 44),
      new THREE.MeshBasicMaterial({ color: 0xf5c451, transparent: true, opacity: 0.9 }),
    );
    this.marker.renderOrder = 5;
  }

  selectTarget(index, adjustPin = true) {
    const target = this.targets[index];
    if (!target) return;
    this.selectedTarget = index;
    if (this.marker.parent) this.marker.parent.remove(this.marker);
    target.group.add(this.marker);
    this.marker.position.copy(target.faceCenterLocal);
    this.marker.position.z += CONFIG.target.faceThickness / 2 + 0.01;
    if (adjustPin) {
      // Calibrar o pino no alvo escolhido é regular a mira, não mirar por você:
      // corrige só o paralaxe da câmera, nunca a queda da flecha.
      this.aim.setPin(target.distanceTo(this.player.position));
      this.hud.setPin(this.aim.pinDistance);
    }
  }

  /* ------------------------------------------------------------- laço ----- */

  frame(now) {
    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = Math.min(rawDt, 0.1);
    this.elapsed += dt;
    this.fps = this.fps * 0.92 + (1 / Math.max(rawDt, 1e-4)) * 0.08;

    const actions = this.input.consume();
    this.handleActions(actions);
    this.updateAimAndPose(dt);
    if (actions.release) this.shoot();

    this.wind.update(dt);
    this.stepPhysics(dt);
    this.arrows.update(dt);
    this.environment.update(dt, this.wind.vector);

    this.updateHud();
    this.updateCamera(dt);
    this.debug.update({
      fps: this.fps,
      steps: this.stepsLastFrame,
      live: this.arrows.live.length,
      stuck: this.arrows.stuck.length,
    });

    // A sombra segue a área jogável à frente da arqueira.
    this._shadowFocus
      .copy(this.player.position)
      .addScaledVector(this._forward, 28);
    this._shadowFocus.y += 2;
    this.renderer.updateShadowFocus(this._shadowFocus);

    this.renderer.render();
    requestAnimationFrame(this.frame.bind(this));
  }

  handleActions(a) {
    if (a.pinDelta) {
      this.aim.nudgePin(a.pinDelta);
      this.hud.setPin(this.aim.pinDistance);
    }
    if (a.cycleTarget) {
      this.selectTarget((this.selectedTarget + 1) % this.targets.length);
    }
    if (a.toggleArrowCam) this.rig.toggleFollow(this.arrows.lastArrow);
    if (a.toggleAutoFollow) {
      this.rig.setAutoFollow(!this.rig.autoFollow);
      this.hud.toast(
        this.rig.autoFollow ? "câmera segue a flecha" : "câmera fixa na arqueira",
        "miss",
      );
    }
    if (a.clearArrows) this.arrows.clearAll();
    if (a.toggleTrace) {
      this.arrows.setTraceVisible(!this.arrows.showTrace);
      this.hud.toast(
        this.arrows.showTrace ? "traçado ligado" : "traçado desligado",
        "miss",
      );
    }
    if (a.toggleDebug) this.debug.toggle();
    if (a.toggleHelp) this.hud.toggleHelp();
  }

  updateAimAndPose(dt) {
    // Tensão do arco.
    if (this.input.drawing) this.drawTime += dt;

    // Segurar demais cansa: o tremor cresce e some ao soltar.
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

    const moving = this.player.move(dt, this.input.forward, this.input.strafe);
    this.player.setAim(yaw, pitch);
    this.player.setDraw(drawFraction(this.drawTime));
    this.player.update(dt, moving);
    this.player.getMuzzle(this._muzzle);

    // Direção de lançamento: vem só dos ângulos de mira.
    this.aim.solve(yaw, this.player.pitch);
    this._forward.copy(this.aim.direction);
  }

  shoot() {
    if (this.drawTime < 0.04) {
      this.drawTime = 0;
      return;
    }
    const speed = drawSpeed(this.drawTime);
    const direction = this.aim.direction;

    // A flecha nasce logo à frente do repouso, sobre a mesma linha de tiro.
    this._spawn.copy(this._muzzle).addScaledVector(direction, 0.3);

    const arrow = this.arrows.spawn(this._spawn, direction, speed);
    this.rig.onShoot(arrow);
    this.hud.addShot();
    this.drawTime = 0;
    this.player.setDraw(0);
  }

  stepPhysics(dt) {
    const h = CONFIG.physics.fixedStep;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= h && steps < CONFIG.physics.maxSubSteps) {
      this.sync.saveState();
      this.physics.step();
      this.sync.captureState();
      this.accumulator -= h;
      steps++;
    }
    // Se estourou o orçamento, descarta o resto: melhor perder tempo simulado
    // do que entrar na espiral da morte.
    if (steps === CONFIG.physics.maxSubSteps) this.accumulator = 0;
    this.stepsLastFrame = steps;
    this.sync.apply(this.accumulator / h);
  }

  updateCamera(dt) {
    this.rig.update(dt, this._muzzle, this._forward);

    // O pino de mira é projetado depois da câmera: é a posição real da linha
    // de tiro na tela, não um retículo decorativo no centro.
    // `project()` usa matrixWorldInverse, que só o renderer recalcula — sem
    // atualizar aqui, o retículo ficaria um frame atrás da câmera.
    const camera = this.renderer.camera;
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    this.aim.updateSightPoint(this._muzzle);
    const onArrowCam = this.rig.mode === CameraMode.ARROW;
    this.hud.setReticle(
      onArrowCam
        ? null
        : this.aim.projectSight(camera, this.renderer.width, this.renderer.height),
    );
  }

  updateHud() {
    const fraction = drawFraction(this.drawTime);
    this.hud.setDraw(fraction, fraction > 0 ? drawSpeed(this.drawTime) : 0);
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

  // Útil no console do navegador para inspecionar a simulação.
  window.game = game;
}

main().catch((err) => {
  console.error(err);
  setStep(`falhou: ${err.message}`);
});
