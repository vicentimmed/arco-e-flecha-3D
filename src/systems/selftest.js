/* ---------------------------------------------------------------------------
   Auto-teste balístico.

   Roda os critérios de aceite num mundo Rapier temporário — mesma gravidade,
   mesmo passo fixo, mesma massa e mesma conta de arrasto do jogo — sem
   perturbar a partida em andamento. É o que transforma "a física parece certa"
   em "a física bate com a fórmula".
   --------------------------------------------------------------------------- */

import RAPIER from "@dimforge/rapier3d-compat";
import { CONFIG } from "../config.js";
import { analyticRange, degToRad } from "../utils/math.js";

function makeWorld() {
  const world = new RAPIER.World({ x: 0, y: CONFIG.physics.gravity, z: 0 });
  world.timestep = CONFIG.physics.fixedStep;
  return world;
}

function makeArrowBody(world, position, velocity) {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinvel(velocity.x, velocity.y, velocity.z)
      .setLinearDamping(0)
      .setAngularDamping(CONFIG.arrow.angularDamping)
      .setCcdEnabled(true),
  );
  const half = CONFIG.arrow.length / 2 - CONFIG.arrow.shaftRadius * 1.5;
  world.createCollider(
    RAPIER.ColliderDesc.capsule(half, CONFIG.arrow.shaftRadius * 1.5).setMass(
      CONFIG.arrow.mass,
    ),
    body,
  );
  return body;
}

/** Mesma fórmula de arrasto do jogo, aplicada no centro de massa. */
function applyDrag(body) {
  const v = body.linvel();
  const speed = Math.hypot(v.x, v.y, v.z);
  if (speed < 1e-3) return 0;
  const k =
    0.5 *
    CONFIG.physics.airDensity *
    CONFIG.arrow.dragCoefficient *
    CONFIG.arrow.frontalArea *
    speed;
  body.resetForces(false);
  body.addForce({ x: -v.x * k, y: -v.y * k, z: -v.z * k }, true);
  return k * speed;
}

/**
 * Lança e integra até voltar à altura inicial. Devolve alcance horizontal
 * (interpolado no cruzamento) e o histórico de velocidade.
 */
function launch({ speed, angleDeg, drag }) {
  const world = makeWorld();
  const angle = degToRad(angleDeg);
  const y0 = 100; // longe do chão: nada colide, é balística pura
  const body = makeArrowBody(
    world,
    { x: 0, y: y0, z: 0 },
    { x: 0, y: Math.sin(angle) * speed, z: -Math.cos(angle) * speed },
  );

  const speeds = [];
  let prev = { y: y0, z: 0 };
  let range = 0;
  let time = 0;
  const h = world.timestep;

  for (let i = 0; i < 20000; i++) {
    if (drag) applyDrag(body);
    world.step();
    time += h;
    const t = body.translation();
    const v = body.linvel();
    speeds.push(Math.hypot(v.x, v.y, v.z));
    if (v.y < 0 && t.y <= y0) {
      // Interpola o instante exato do cruzamento com a altura inicial.
      const frac = (prev.y - y0) / (prev.y - t.y || 1);
      range = Math.abs(prev.z + (t.z - prev.z) * frac);
      break;
    }
    prev = { y: t.y, z: t.z };
  }
  world.free();
  return { range, time, speeds };
}

/** Critério 3: uma flecha a 120 m/s não pode atravessar uma placa de 5 cm. */
function ccdTest(shots = 50) {
  let pierced = 0;
  for (let i = 0; i < shots; i++) {
    const world = makeWorld();

    const plate = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, -20),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(1.2, 1.4, 0.025), plate);

    // Varia o deslocamento inicial para cair em fases diferentes do passo fixo.
    const jitter = (i / shots) * CONFIG.arrow.length;
    const body = makeArrowBody(
      world,
      { x: 0, y: 0.35, z: jitter },
      { x: 0, y: 0, z: -CONFIG.bow.maxSpeed },
    );

    for (let s = 0; s < 90; s++) {
      world.step();
      const t = body.translation();
      if (t.z < -20.4) {
        pierced++;
        break;
      }
      if (t.z > -19.9 && s > 0 && Math.abs(body.linvel().z) < 1) break; // parou na placa
    }
    world.free();
  }
  return { shots, pierced };
}

export function runSelfTest() {
  const { speed, angleDeg, tolerance } = CONFIG.debug.selfTest;
  const results = [];

  /* 1 — balística pura bate com a fórmula ------------------------------- */
  const ideal = launch({ speed, angleDeg, drag: false });
  const expected = analyticRange(speed, degToRad(angleDeg), -CONFIG.physics.gravity);
  const error = Math.abs(ideal.range - expected) / expected;
  results.push({
    name: `Alcance sem arrasto (${speed} m/s @ ${angleDeg}°)`,
    detail: `${ideal.range.toFixed(1)} m vs ${expected.toFixed(1)} m analítico · erro ${(error * 100).toFixed(2)} %`,
    pass: error <= tolerance,
  });

  /* 2 — com arrasto o alcance cai e a velocidade decresce ---------------- */
  const dragged = launch({ speed, angleDeg, drag: true });
  let monotonic = true;
  for (let i = 1; i < dragged.speeds.length; i++) {
    // Só vale enquanto sobe: descendo, a gravidade volta a acelerar.
    if (i > dragged.speeds.length * 0.45) break;
    if (dragged.speeds[i] > dragged.speeds[i - 1] + 1e-4) monotonic = false;
  }
  results.push({
    name: "Arrasto reduz o alcance",
    detail: `${dragged.range.toFixed(1)} m (−${(100 * (1 - dragged.range / ideal.range)).toFixed(0)} %) · velocidade decrescente: ${monotonic ? "sim" : "não"}`,
    pass: dragged.range < ideal.range && monotonic,
  });

  /* 3 — CCD impede tunelamento ------------------------------------------ */
  const ccd = ccdTest(50);
  results.push({
    name: `CCD a ${CONFIG.bow.maxSpeed} m/s contra placa de 5 cm`,
    detail: `${ccd.shots - ccd.pierced}/${ccd.shots} detectadas · ${ccd.pierced} atravessaram`,
    pass: ccd.pierced === 0,
  });

  return results;
}
