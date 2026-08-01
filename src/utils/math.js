/* ---------------------------------------------------------------------------
   Utilitários matemáticos. Sem dependência de Three.js nem de Rapier para que
   possam ser usados dos dois lados da fronteira (física e render).
   --------------------------------------------------------------------------- */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const lerp = (a, b, t) => a + (b - a) * t;

/** Interpolação estável em frame-rate variável (t = 1 - exp(-k·dt)). */
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

export const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const degToRad = (d) => (d * Math.PI) / 180;
export const radToDeg = (r) => (r * 180) / Math.PI;

/** PRNG determinístico (mulberry32) — cenário sempre igual entre sessões. */
export function makeRandom(seed = 1337) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ IK ----- */

/**
 * IK de dois ossos. Dado ombro, alvo da mão e os comprimentos dos segmentos,
 * devolve a posição do cotovelo. `pole` indica para que lado o cotovelo dobra.
 *
 * Todos os parâmetros são objetos {x,y,z} simples (compatíveis com THREE.Vector3).
 */
export function solveTwoBoneIK(root, target, upperLen, lowerLen, pole, out) {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const dz = target.z - root.z;
  let dist = Math.hypot(dx, dy, dz);
  const maxReach = (upperLen + lowerLen) * 0.999;
  const minReach = Math.abs(upperLen - lowerLen) * 1.001 + 1e-4;
  dist = clamp(dist, minReach, maxReach);

  // Projeção do cotovelo sobre a linha ombro→mão (lei dos cossenos).
  const a = (dist * dist + upperLen * upperLen - lowerLen * lowerLen) / (2 * dist);
  const h = Math.sqrt(Math.max(0, upperLen * upperLen - a * a));

  const ux = dx / (dist || 1);
  const uy = dy / (dist || 1);
  const uz = dz / (dist || 1);

  // Componente do pole ortogonal ao eixo ombro→mão.
  let px = pole.x;
  let py = pole.y;
  let pz = pole.z;
  const dot = px * ux + py * uy + pz * uz;
  px -= ux * dot;
  py -= uy * dot;
  pz -= uz * dot;
  let plen = Math.hypot(px, py, pz);
  if (plen < 1e-5) {
    // Pole degenerado: escolhe qualquer perpendicular estável.
    px = -uy;
    py = ux;
    pz = 0;
    plen = Math.hypot(px, py, pz) || 1;
  }
  px /= plen;
  py /= plen;
  pz /= plen;

  out.x = root.x + ux * a + px * h;
  out.y = root.y + uy * a + py * h;
  out.z = root.z + uz * a + pz * h;
  return out;
}

/* -------------------------------------------------------------- balística -- */

/**
 * Alcance analítico de um projétil sem arrasto lançado e recebido na mesma
 * altura. Usado pelo auto-teste do painel de depuração.
 */
export function analyticRange(speed, angleRad, gravity = 9.81) {
  return (speed * speed * Math.sin(2 * angleRad)) / gravity;
}
