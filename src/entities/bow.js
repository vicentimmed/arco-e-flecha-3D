/* ---------------------------------------------------------------------------
   Arco recurvo. Puramente visual: nenhuma decisão de física acontece aqui — o
   arco só informa onde fica o repouso da flecha (ponto de disparo) e anima a
   corda, as lâminas e a flecha encaixada conforme o curso de tensionamento.

   Referencial local: +Y sobe pelas lâminas, -Z é a direção do tiro, o punho
   fica na origem. A corda vive no lado +Z (lado do arqueiro).
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { makeSegment, orientSegment } from "../utils/geometry.js";

const BRACE_HEIGHT = 0.09; // m — distância corda↔punho em repouso
const DRAW_LENGTH = 0.52; // m — curso da corda até a abertura total
const LIMB_PIVOT_Y = 0.15; // m — onde a lâmina sai do riser

/** Perfil de meia lâmina, do pivô até a ponta (plano YZ, x = 0).
 *  Ponta a ponta o arco fica com ~1,55 m, como um recurvo de 62". */
const LIMB_PROFILE = [
  [0.0, 0.0],
  [0.11, 0.018],
  [0.23, 0.064],
  [0.35, 0.118],
  [0.45, 0.152],
  [0.54, 0.142],
  [0.6, 0.096],
];

export class Bow {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = "bow";
    this.draw = 0;

    const black = new THREE.MeshStandardMaterial({
      color: "#17181c",
      roughness: 0.38,
      metalness: 0.22,
    });
    const grip = new THREE.MeshStandardMaterial({
      color: "#2a2117",
      roughness: 0.85,
      metalness: 0.0,
    });
    const stringMat = new THREE.MeshStandardMaterial({
      color: "#d8d2c0",
      roughness: 0.7,
      metalness: 0.0,
    });
    /* Exposto para o dono: cada arqueiro tem o SEU arco, e o piscar da
       invencibilidade precisa apagar o arco junto com o corpo — senão sobra um
       arco sólido flutuando sobre um corpo semitransparente. */
    this.materials = [black, grip, stringMat];

    /* riser --------------------------------------------------------------- */
    const riser = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.36, 0.072), black);
    riser.position.set(0, 0, -0.04);
    riser.castShadow = true;
    this.group.add(riser);

    // Barrigas do riser: dão a silhueta cheia do arco da referência.
    for (const y of [0.14, -0.14]) {
      const swell = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.08, 4, 10), black);
      swell.position.set(0, y, -0.045);
      swell.castShadow = true;
      this.group.add(swell);
    }

    // Janela de mira / repouso da flecha: um pequeno rebaixo acima do punho.
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.018, 0.05), black);
    shelf.position.set(0.022, 0.045, -0.032);
    shelf.castShadow = true;
    this.group.add(shelf);

    const handle = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.031, 0.12, 4, 12),
      grip,
    );
    handle.position.set(0, -0.05, -0.035);
    handle.castShadow = true;
    this.group.add(handle);

    /* lâminas ------------------------------------------------------------- */
    this.upperLimb = this.makeLimb(black, 1);
    this.upperLimb.position.set(0, LIMB_PIVOT_Y, -0.03);
    this.group.add(this.upperLimb);

    this.lowerLimb = this.makeLimb(black, -1);
    this.lowerLimb.position.set(0, -LIMB_PIVOT_Y, -0.03);
    this.group.add(this.lowerLimb);

    this.tipLocalUpper = new THREE.Vector3();
    this.tipLocalLower = new THREE.Vector3();

    /* corda --------------------------------------------------------------- */
    this.stringTop = makeSegment(0.0045, stringMat, false, 6);
    this.stringBottom = makeSegment(0.0045, stringMat, false, 6);
    this.stringTop.castShadow = false;
    this.stringBottom.castShadow = false;
    this.group.add(this.stringTop, this.stringBottom);

    /* flecha encaixada ---------------------------------------------------- */
    this.nockedArrow = buildNockedArrow();
    this.group.add(this.nockedArrow);

    this.nockPoint = new THREE.Vector3();
    this.restPoint = new THREE.Vector3();
    this.setDraw(0);
  }

  /** Distância do nock (em abertura total) até o punho — o "draw length". */
  get fullDrawReach() {
    return BRACE_HEIGHT + DRAW_LENGTH;
  }

  makeLimb(material, sign) {
    const points = LIMB_PROFILE.map(
      ([y, z]) => new THREE.Vector3(0, y * sign, z),
    );
    const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.4);
    const geo = new THREE.TubeGeometry(curve, 28, 0.019, 8, false);
    // Lâmina achatada: mais larga que grossa, como uma lâmina de verdade.
    geo.scale(1.35, 1, 1);
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.userData.tip = points[points.length - 1].clone();
    return mesh;
  }

  /**
   * @param {number} t fração 0..1 do curso do arco.
   */
  setDraw(t) {
    this.draw = t;

    // As lâminas dobram para trás conforme a corda é puxada.
    const bend = t * 0.19; // rad
    this.upperLimb.rotation.x = bend;
    this.lowerLimb.rotation.x = -bend;
    this.upperLimb.updateMatrix();
    this.lowerLimb.updateMatrix();

    // Pontas em coordenadas do arco (após a rotação das lâminas).
    this.tipLocalUpper
      .copy(this.upperLimb.userData.tip)
      .applyEuler(this.upperLimb.rotation)
      .add(this.upperLimb.position);
    this.tipLocalLower
      .copy(this.lowerLimb.userData.tip)
      .applyEuler(this.lowerLimb.rotation)
      .add(this.lowerLimb.position);

    // Nock: sai do brace height e recua até a abertura total.
    this.nockPoint.set(0.012, 0.02, BRACE_HEIGHT + DRAW_LENGTH * t);

    orientSegment(this.stringTop, this.tipLocalUpper, this.nockPoint);
    orientSegment(this.stringBottom, this.tipLocalLower, this.nockPoint);

    // A flecha encaixada vai do nock para a frente.
    this.nockedArrow.position.copy(this.nockPoint);
    // Repouso: onde a haste cruza a janela do riser — é DAQUI que a flecha
    // física nasce.
    this.restPoint.set(0.018, 0.052, -0.02);
  }

  setArrowVisible(visible) {
    this.nockedArrow.visible = visible;
  }

  /** Ponto de disparo em coordenadas de mundo. */
  getMuzzleWorld(out) {
    return out.copy(this.restPoint).applyMatrix4(this.group.matrixWorld);
  }

  /** Ponto do nock em coordenadas de mundo (para posicionar a mão da corda). */
  getNockWorld(out) {
    return out.copy(this.nockPoint).applyMatrix4(this.group.matrixWorld);
  }
}

/** Flecha decorativa que fica visível enquanto o arco está armado. */
function buildNockedArrow() {
  const group = new THREE.Group();
  const shaftMat = new THREE.MeshStandardMaterial({
    color: "#c8b48a",
    roughness: 0.6,
  });
  const tipMat = new THREE.MeshStandardMaterial({
    color: "#8f9296",
    roughness: 0.35,
    metalness: 0.7,
  });
  const fletchMat = new THREE.MeshStandardMaterial({
    color: "#d6483c",
    roughness: 0.85,
    side: THREE.DoubleSide,
  });

  const len = 0.75;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.004, len, 6),
    shaftMat,
  );
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -len / 2;
  shaft.castShadow = true;
  group.add(shaft);

  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0075, 0.05, 6), tipMat);
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -len - 0.02;
  group.add(tip);

  for (let i = 0; i < 3; i++) {
    // Pena no plano YZ, deslocada para fora da haste, e replicada a 120°.
    const fletch = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.022), fletchMat);
    fletch.rotation.y = Math.PI / 2;
    fletch.position.set(0, 0.013, -0.06);
    const holder = new THREE.Group();
    holder.rotation.z = (i * Math.PI * 2) / 3;
    holder.add(fletch);
    group.add(holder);
  }
  return group;
}
