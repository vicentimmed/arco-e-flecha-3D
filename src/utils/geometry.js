/* ---------------------------------------------------------------------------
   Ajudantes de geometria usados pelo arqueiro e pelo arco: "segmentos" que se
   esticam entre dois pontos (ossos, corda) sem precisar de esqueleto animado.
   --------------------------------------------------------------------------- */

import * as THREE from "three";

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();

/**
 * Gradiente ao longo do eixo do segmento, em cor de vértice.
 *
 * Fases 5A.1 e 5A.2 do plano, e o mesmo truque nas duas: escurecer o vértice
 * onde a luz não chega, de graça e para sempre.
 *
 * • O GRADIENTE (5A.1): a base do segmento (a junta) fica clara e a ponta
 *   escurece. Um braço com uma cor só é um tubo; com o degradê ele tem forma,
 *   porque o olho lê a variação de tom como volume.
 * • O AO DE JUNTA (5A.2): as duas EXTREMIDADES escurecem um pouco mais, o que
 *   simula a sombra que a dobra do cotovelo e do joelho projeta sobre si mesma.
 *   É o que faz a articulação parecer funda em vez de duas peças encostadas.
 *
 * A cor é cinza (multiplicador): a tinta continua sendo a do material, e é isso
 * que permite tingir o arqueiro inteiro pela cor do jogador sem perder o
 * modelado.
 */
export function shadeSegment(geo, claro = 1.06, escuro = 0.72, aoJunta = 0.18) {
  const pos = geo.attributes.position;
  const cores = new Float32Array(pos.count * 3);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const inv = 1 / Math.max(1e-4, maxY - minY);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) * inv;
    let f = claro + (escuro - claro) * t;
    // As duas pontas: a sombra da junta. `t·(1−t)` é zero nas extremidades, e é
    // por isso que o termo é invertido — queremos o oposto de uma parábola.
    f *= 1 - aoJunta * (1 - 4 * t * (1 - t));
    cores[i * 3] = f;
    cores[i * 3 + 1] = f;
    cores[i * 3 + 2] = f;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cores, 3));
  return geo;
}

/**
 * Cria uma cápsula de altura unitária com a base na origem e o eixo em +Y.
 * Escalando `scale.y` a peça se estica entre dois pontos.
 */
export function makeSegment(radius, material, capped = true, radialSegments = 8) {
  const geo = capped
    ? new THREE.CapsuleGeometry(radius, 1, 4, radialSegments)
    : new THREE.CylinderGeometry(radius, radius, 1, radialSegments);
  // Origem no início do segmento em vez do centro.
  geo.translate(0, 0.5, 0);
  shadeSegment(geo);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.baseRadius = radius;
  return mesh;
}

/** Posiciona e orienta um segmento entre dois pontos (no espaço do pai). */
export function orientSegment(mesh, a, b, thickness = 1) {
  _dir.subVectors(b, a);
  const len = _dir.length();
  mesh.position.copy(a);
  if (len > 1e-6) {
    _dir.divideScalar(len);
    mesh.quaternion.setFromUnitVectors(UP, _dir);
  }
  // A cápsula tem altura 1 + as calotas; escalar só Y estica o corpo e achata
  // pouco as pontas, o que é imperceptível nesta escala.
  mesh.scale.set(thickness, len, thickness);
  return mesh;
}

/**
 * Esfera simples para articulações (ombro, cotovelo, joelho).
 *
 * Ganha o mesmo AO das pontas dos segmentos, mas SEM gradiente: uma junta é
 * redonda, e escurecer um lado dela daria a impressão de luz vindo de baixo. O
 * que ela recebe é um escurecimento igual em cima e embaixo, onde ela encontra
 * os dois ossos que liga.
 */
export function makeJoint(radius, material, detail = 12) {
  const geo = new THREE.SphereGeometry(radius, detail, Math.max(6, detail / 2));
  shadeSegment(geo, 0.9, 0.9, 0.16);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export { _mid as scratchVector };
