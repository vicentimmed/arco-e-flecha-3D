/* ---------------------------------------------------------------------------
   A arqueira — a fantasia original, e o padrão.

   Este arquivo é uma MUDANÇA que não muda nada: cada peça, cada número e cada
   material vieram de `entities/player.js` sem um ajuste sequer. O que mudou foi
   o endereço. O corpo que estava lá dentro passou a ser a primeira
   implementação de um contrato (ver `skins/base.js` e `Player.build`), e é isso
   que permitiu o segundo — o arqueiro medieval — sem tocar em pose, IK, câmera,
   física ou rede.

   Referencial: as peças de tronco entram no `spine` (origem no quadril, -Z na
   direção da mira); braços e pernas são grupos soltos, posicionados a cada
   quadro pela IK do rig.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { makeSegment, makeJoint } from "../../utils/geometry.js";
import { BODY, pele, pano, metal, SWAY_PADRAO } from "./base.js";

/** Branco de referência para clarear a cor do jogador (ver `tint`). */
const WHITE = new THREE.Color(1, 1, 1);

export const atleta = {
  id: "atleta",
  label: "Atleta",
  detalhe: "moderna, leve, de tênis",
  swatch: ["#cc2f2b", "#f3ede1"],
  /** null = o arco padrão, preto e de metal. */
  bowPalette: null,

  createMaterials() {
    return {
      // Pele: 0.6 é o brilho de uma pele ao ar livre — largo e fraco. Acima de
      // 0.8 ela vira giz; abaixo de 0.5, plástico.
      skin: pele("#e6ab7d", 0.6),
      skinDark: pele("#d9995f", 0.64),
      top: pano("#cc2f2b", 0.88),
      trim: pano("#f3ede1", 0.9),
      shorts: pano("#bb2724", 0.9),
      // Cabelo: o único do corpo com brilho definido — é ele que dá o realce em
      // faixa no alto da cabeça, e sem isso o cabelo é uma calota de feltro.
      hair: pele("#392015", 0.48),
      shoe: pano("#efe9df", 0.78),
      shoeRed: pano("#cc2f2b", 0.78),
      // Rosto e equipamento.
      eyeWhite: pele("#f7f4ee", 0.28),
      eyeDark: pele("#2a1a12", 0.18),
      mouth: pele("#a8564d", 0.66),
      // Couro: fosco, com um lustro de uso. Nada de metalness.
      leather: pano("#6b4526", 0.86),
      leatherDark: pano("#4a2f19", 0.9),
      /* Fita do cabelo e empena da flecha: os dois HERDAM A COR DO JOGADOR
         (Fase 5A.6). Eram castanho e vermelho fixos, e num duelo entre dois
         arqueiros de cores diferentes as duas flechas na aljava eram idênticas.
         São peças pequenas, e é justamente por isso que funcionam: um toque da
         sua cor no alto da cabeça é reconhecível de longe sem chapar o corpo. */
      tie: pano("#8a5a3c", 0.8),
      fletch: (() => {
        const m = pano("#d6483c", 0.85);
        m.side = THREE.DoubleSide;
        return m;
      })(),
      arrowShaft: pano("#c9b58c", 0.6),
      metal: metal(),
    };
  },

  /**
   * Tinge só a ROUPA.
   *
   * Pele e cabelo ficam como estão de propósito: colorir o corpo inteiro apaga
   * o volume do personagem e ele vira uma silhueta chapada, justamente quando
   * você mais precisa reconhecer quem é à distância.
   */
  tint(mat, c) {
    mat.top.color.copy(c);
    mat.shoeRed.color.copy(c);
    // Bermuda um tom mais funda que a camiseta.
    mat.shorts.color.copy(c).multiplyScalar(0.8);
    /* Fita e empena também (Fase 5A.6). Elas ficam mais CLARAS que a camiseta,
       não iguais: são peças de poucos pixels contra o cabelo escuro e contra a
       aljava de couro, e no mesmo tom da roupa elas desapareceriam justamente
       nos dois fundos onde estão. */
    mat.tie.color.copy(c).lerp(WHITE, 0.25);
    mat.fletch.color.copy(c).lerp(WHITE, 0.18);
  },

  build(rig) {
    const mat = rig.mat;
    const spine = rig.spine;

    /* Os dois níveis de detalhe (ver `Player.setDetailLevel`).
       `perto` são as peças do rosto, que somem acima de 12 m — onde a íris tem
       meio pixel. `medio` são as que somem além de 40 m, e NENHUMA delas é
       estrutural: a fivela some sobre o cinto, o dedo sobre a mão, a empena
       sobre a haste. A silhueta é a mesma nos três níveis. */
    const perto = [];
    const medio = [];

    /* quadril e tronco --------------------------------------------------- */
    const pelvis = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.135, 0.1, 4, 14),
      mat.shorts,
    );
    pelvis.rotation.z = Math.PI / 2;
    pelvis.scale.set(1, 1, 0.72);
    pelvis.position.y = 0.02;
    pelvis.castShadow = true;
    spine.add(pelvis);

    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.152, 0.128, BODY.shoulderY - BODY.hipY - 0.02, 16),
      mat.top,
    );
    torso.scale.set(1, 1, 0.66);
    torso.position.y = (BODY.shoulderY - BODY.hipY) / 2 + 0.02;
    torso.castShadow = true;
    torso.receiveShadow = true;
    spine.add(torso);

    const waistBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.134, 0.134, 0.03, 16),
      mat.trim,
    );
    waistBand.scale.set(1, 1, 0.68);
    waistBand.position.y = BODY.waistY - BODY.hipY - 0.09;
    spine.add(waistBand);
    medio.push(waistBand);

    /* Cinto de couro com fivela. Junto com a bandoleira e a aljava, é o que
       transforma a silhueta de "boneco de primitivas" em "alguém equipada para
       atirar": o olho lê equipamento como intenção. */
    const cinto = new THREE.Mesh(
      new THREE.CylinderGeometry(0.142, 0.142, 0.055, 16),
      mat.leather,
    );
    cinto.scale.set(1, 1, 0.7);
    cinto.position.y = 0.055;
    spine.add(cinto);

    const fivela = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.048, 0.02),
      mat.metal,
    );
    fivela.position.set(0, 0.055, -0.1);
    spine.add(fivela);
    medio.push(fivela);

    // Bandoleira cruzando o peito — a alça da aljava.
    const bandoleira = new THREE.Mesh(
      new THREE.BoxGeometry(0.052, 0.42, 0.016),
      mat.leatherDark,
    );
    bandoleira.position.set(0.02, (BODY.shoulderY - BODY.hipY) * 0.55, -0.1);
    bandoleira.rotation.z = 0.42;
    spine.add(bandoleira);

    /* Aljava nas costas, com as empenas aparecendo. */
    const aljava = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.044, 0.34, 10),
      mat.leather,
    );
    aljava.position.set(-0.11, (BODY.shoulderY - BODY.hipY) * 0.62, 0.13);
    aljava.rotation.set(0.34, 0, -0.3);
    aljava.castShadow = true;
    spine.add(aljava);

    for (let i = 0; i < 4; i++) {
      const haste = new THREE.Mesh(
        new THREE.CylinderGeometry(0.005, 0.005, 0.26, 5),
        mat.arrowShaft,
      );
      const dx = (i % 2 ? 1 : -1) * 0.018;
      const dz = i < 2 ? 0.016 : -0.016;
      haste.position.set(-0.11 + dx, (BODY.shoulderY - BODY.hipY) * 0.62 + 0.2, 0.13 + dz);
      haste.rotation.set(0.34, 0, -0.3);
      spine.add(haste);

      const empena = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.07), mat.fletch);
      empena.position.copy(haste.position);
      empena.position.y += 0.1;
      empena.rotation.set(0.34, i * 0.8, -0.3);
      spine.add(empena);
      medio.push(empena);
    }

    // Ombros arredondados.
    for (const s of [-1, 1]) {
      const sh = makeJoint(0.062, mat.top);
      sh.position.set(s * BODY.shoulderX, BODY.shoulderY - BODY.hipY, 0);
      spine.add(sh);
    }

    /* pescoço e cabeça ---------------------------------------------------- */
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.043, 0.05, 0.1, 10),
      mat.skin,
    );
    neck.position.y = BODY.neckY - BODY.hipY - 0.03;
    neck.castShadow = true;
    spine.add(neck);

    const head = new THREE.Group();
    head.position.y = BODY.headY - BODY.hipY;
    spine.add(head);

    const skull = makeJoint(BODY.headR, mat.skin, 18);
    skull.scale.set(0.94, 1.06, 1.0);
    head.add(skull);

    /* Rosto.
       Sem olhos, a cabeça é uma bola e o personagem não tem para onde olhar —
       e é justamente a direção do olhar que dá leitura de "ela está mirando
       ali". A face olha para -Z no espaço da cabeça, que já é girada pela pose.

       As nove peças do rosto entram em `faceDetail` e SOMEM acima de ~12 m
       (ver `Player.setFaceDetail`). A essa distância a íris tem meio pixel; o
       que se vê é a cabeça, e ela continua ali. Com doze arqueiros numa sala são
       ~100 chamadas de desenho a menos, sem que ninguém perceba a diferença. */
    const R = BODY.headR;
    for (const lado of [-1, 1]) {
      const olho = new THREE.Mesh(
        new THREE.SphereGeometry(R * 0.155, 10, 8),
        mat.eyeWhite,
      );
      olho.position.set(lado * R * 0.38, R * 0.1, -R * 0.86);
      olho.scale.set(1, 1.15, 0.62);
      head.add(olho);
      perto.push(olho);

      const iris = new THREE.Mesh(
        new THREE.SphereGeometry(R * 0.085, 8, 6),
        mat.eyeDark,
      );
      iris.position.set(lado * R * 0.38, R * 0.1, -R * 0.95);
      iris.scale.set(1, 1, 0.55);
      head.add(iris);
      perto.push(iris);

      // Sobrancelha: dá expressão e ancora o olho na testa.
      const sobrancelha = new THREE.Mesh(
        new THREE.BoxGeometry(R * 0.3, R * 0.07, R * 0.09),
        mat.hair,
      );
      sobrancelha.position.set(lado * R * 0.38, R * 0.34, -R * 0.87);
      sobrancelha.rotation.z = lado * 0.14;
      head.add(sobrancelha);
      perto.push(sobrancelha);
    }

    const nariz = new THREE.Mesh(
      new THREE.ConeGeometry(R * 0.11, R * 0.26, 6),
      mat.skin,
    );
    nariz.rotation.x = -Math.PI / 2;
    nariz.position.set(0, -R * 0.08, -R * 0.95);
    head.add(nariz);
    perto.push(nariz);

    const boca = new THREE.Mesh(
      new THREE.BoxGeometry(R * 0.3, R * 0.055, R * 0.06),
      mat.mouth,
    );
    boca.position.set(0, -R * 0.42, -R * 0.86);
    head.add(boca);
    perto.push(boca);

    // Orelhas: fecham a silhueta da cabeça de perfil.
    for (const lado of [-1, 1]) {
      const orelha = new THREE.Mesh(
        new THREE.SphereGeometry(R * 0.2, 8, 6),
        mat.skin,
      );
      orelha.position.set(lado * R * 0.92, -R * 0.02, 0);
      orelha.scale.set(0.42, 1, 0.72);
      head.add(orelha);
      perto.push(orelha);
    }

    // Cabelo: calota + franja, com a testa livre.
    const hairCap = new THREE.Mesh(
      new THREE.SphereGeometry(BODY.headR * 1.05, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
      mat.hair,
    );
    hairCap.scale.set(0.98, 1.12, 1.02);
    hairCap.position.y = 0.004;
    hairCap.castShadow = true;
    head.add(hairCap);

    const hairBack = new THREE.Mesh(
      new THREE.SphereGeometry(BODY.headR * 1.02, 16, 12, 0, Math.PI, 0, Math.PI),
      mat.hair,
    );
    hairBack.rotation.y = -Math.PI / 2;
    hairBack.scale.set(1.0, 1.05, 0.86);
    hairBack.position.z = 0.02;
    head.add(hairBack);

    // Rabo de cavalo: duas seções que balançam com atraso (ver `updateSway`).
    const swayRoot = new THREE.Group();
    swayRoot.position.set(0, 0.055, BODY.headR * 0.95);
    head.add(swayRoot);

    // A fita do rabo de cavalo: é ela que leva a cor do jogador na cabeça.
    const tie = makeJoint(0.036, mat.tie, 10);
    swayRoot.add(tie);

    const swayA = makeSegment(0.056, mat.hair, true, 10);
    swayRoot.add(swayA);

    const swayB = new THREE.Group();
    swayRoot.add(swayB);
    const swayTip = makeSegment(0.04, mat.hair, true, 10);
    swayB.add(swayTip);

    const armR = buildArm(mat); // braço do arco
    const armL = buildArm(mat); // braço da corda
    const legR = buildLeg(mat);
    const legL = buildLeg(mat);
    for (const membro of [armR, armL, legR, legL]) medio.push(...membro.medio);

    return {
      head,
      detail: { perto, medio },
      sway: { root: swayRoot, a: swayA, b: swayB, tip: swayTip, tuning: SWAY_PADRAO },
      armR,
      armL,
      legR,
      legL,
    };
  },
};

function buildArm(mat) {
  const group = new THREE.Group();
  /** Peças que somem acima de 40 m. Ver `Player.setDetailLevel`. */
  const medio = [];
  const upper = makeSegment(0.057, mat.skin, true, 12);
  const fore = makeSegment(0.047, mat.skin, true, 12);
  const elbow = makeJoint(0.052, mat.skin, 12);

  /* A mão ganha dedos.
     Uma esfera na ponta do braço some assim que a câmera chega perto — e em
     primeira pessoa a mão do arco fica a meio metro do olho. Não é anatomia:
     são quatro dedos e um polegar em caixas, o suficiente para o cérebro
     parar de ver uma bola. */
  const hand = new THREE.Group();
  const palma = new THREE.Mesh(
    new THREE.BoxGeometry(0.062, 0.088, 0.038),
    mat.skinDark,
  );
  palma.castShadow = true;
  hand.add(palma);

  for (let i = 0; i < 4; i++) {
    const dedo = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.0105, 0.05 - Math.abs(i - 1.5) * 0.008, 3, 6),
      mat.skinDark,
    );
    // +Y é a direção cotovelo→mão: os dedos seguem ADIANTE do punho.
    dedo.position.set(-0.021 + i * 0.014, 0.062, 0.002);
    dedo.rotation.x = -0.25;
    hand.add(dedo);
    medio.push(dedo);
  }
  const polegar = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.012, 0.036, 3, 6),
    mat.skinDark,
  );
  polegar.position.set(0.034, 0.022, -0.016);
  polegar.rotation.set(-0.2, 0, 0.9);
  hand.add(polegar);
  medio.push(polegar);

  // Bracelete de couro no antebraço (a proteção contra a corda).
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.058, 0.055, 0.085, 12),
    mat.leather,
  );
  band.castShadow = true;
  const fita = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.057, 0.014, 12),
    mat.leatherDark,
  );
  band.add(fita);
  medio.push(fita);

  group.add(upper, fore, elbow, hand, band);
  return { group, upper, fore, elbow, hand, band, medio };
}

function buildLeg(mat) {
  const group = new THREE.Group();
  const thigh = makeSegment(0.092, mat.skin, true, 12);
  const shin = makeSegment(0.068, mat.skin, true, 12);
  const knee = makeJoint(0.072, mat.skin, 12);
  // Bermuda cobrindo a parte de cima da coxa.
  const short = makeSegment(0.105, mat.shorts, true, 12);
  short.userData.isShort = true;

  // Tênis montado com a ponta em -Z; o grupo é girado para a direção do pé.
  const shoe = new THREE.Group();
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.104, 0.05, 0.26), mat.shoe);
  sole.position.set(0, 0.025, -0.03);
  sole.castShadow = true;
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.075, 0.15), mat.shoeRed);
  upper.position.set(0, 0.075, 0.025);
  upper.castShadow = true;
  const toe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.045, 0.08), mat.shoe);
  toe.position.set(0, 0.06, -0.115);
  shoe.add(sole, upper, toe);

  group.add(thigh, shin, knee, shoe, short);
  return { group, thigh, shin, knee, shoe, short, medio: [toe] };
}
