/* ---------------------------------------------------------------------------
   Ajudantes de geometria usados pelo arqueiro e pelo arco: "segmentos" que se
   esticam entre dois pontos (ossos, corda) sem precisar de esqueleto animado.
   --------------------------------------------------------------------------- */

import * as THREE from "three";

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();

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

/** Esfera simples para articulações (ombro, cotovelo, joelho). */
export function makeJoint(radius, material, detail = 12) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, detail, Math.max(6, detail / 2)),
    material,
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export { _mid as scratchVector };
