/* ---------------------------------------------------------------------------
   A arqueira.

   O corpo é montado com primitivas e posicionado por IK de dois ossos: eu digo
   onde a mão precisa estar (o punho do arco, o nock da corda) e o cotovelo é
   resolvido geometricamente. Isso mantém a postura correta em qualquer ângulo
   de mira, sem esqueleto animado nem arquivos externos.

   Referencial: `root` fica nos pés, com -Z na direção da mira e +X à direita.
   O tronco é girado ~66° porque arqueiro atira de lado — é dessa rotação que
   nasce o enquadramento da referência (corpo à esquerda, arco no centro).
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { Bow } from "./bow.js";
import { makeSegment, orientSegment, makeJoint } from "../utils/geometry.js";
import { solveTwoBoneIK, clamp, damp, smoothstep } from "../utils/math.js";
import { CONFIG } from "../config.js";

/* Antropometria (m) — mulher de ~1,72 m. Não são constantes de simulação,
   por isso vivem aqui e não em config.js. */
const BODY = {
  hipY: 0.9,
  waistY: 1.06,
  chestY: 1.27,
  shoulderY: 1.42,
  shoulderX: 0.175,
  neckY: 1.5,
  headY: 1.625,
  headR: 0.107,
  upperArm: 0.28,
  foreArm: 0.26,
  thigh: 0.44,
  shin: 0.42,
  ankleY: 0.085,
  hipX: 0.105,
  stanceWidth: 0.23,
  stanceYaw: 1.16, // rad — quanto o tronco fica de lado
  armReach: 0.505, // extensão do braço do arco
  // Ancoragem da corda: canto da boca, do lado da mão que puxa (a esquerda).
  // É este ponto que define a linha da flecha, e não o ombro. Medido a partir
  // da CABEÇA e no espaço do root — deslocar no espaço do tronco não serve,
  // porque o giro da postura converte "esquerda" em "para trás" e a âncora
  // acabaria no meio do corpo.
  anchorSide: 0.062, // m à esquerda da linha de tiro
  anchorDrop: 0.09, // m abaixo do centro da cabeça (canto da boca)
  anchorForward: 0.03, // m à frente, ao longo da mira
};

/**
 * Materiais NOVOS a cada arqueiro.
 *
 * Eram um objeto de módulo, compartilhado por todos. Com um jogador só isso é
 * economia; com vários é impossível: tingir um de azul tingiria todo mundo, e
 * piscar quem acabou de renascer faria a sala inteira piscar junto. O custo de
 * um punhado de materiais por jogador é irrelevante perto disso.
 */
/* ESPECULAR SELETIVA E RIM LIGHT (Fases 1.5 e 5A.3 do plano).
 *
 * Cada material do corpo tem o SEU brilho, porque é a diferença entre eles que
 * conta de que coisa cada peça é feita: pele tem um brilho largo e oleoso, pano
 * quase nenhum, couro é fosco com um lustro nas dobras, metal é um ponto. Com
 * todos no mesmo `roughness` médio, a arqueira lê como um boneco de resina
 * pintado — que era exatamente o problema.
 *
 * O RIM LIGHT entra em todos eles, pelo mesmo enxerto. Ele acende só as bordas
 * do corpo, onde a normal é perpendicular ao olhar, e serve a um propósito de
 * jogo antes de ser bonito: na noite do modo zumbi e contra a serra escura, é a
 * única coisa que separa a silhueta do arqueiro do fundo. */
function withRimLight(material, forca = 0.22, tecido = 0) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rimStrength = { value: forca };
    shader.uniforms.fabric = { value: tecido };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vLocalPos;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vLocalPos = position;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float rimStrength;
         uniform float fabric;
         varying vec3 vLocalPos;`,
      )
      /* ESTRUTURA DE TECIDO (Fase 5A.4 do plano).
       *
       * O plano pedia normal maps em braços e pernas. Um normal map de verdade
       * exigiria UVs — e as peças do arqueiro são cápsulas e caixas geradas em
       * código, sem UV que faça sentido. A alternativa que dá o mesmo resultado
       * pelo mesmo custo é gerar a trama NO FRAGMENTO, a partir da posição
       * local do vértice: duas ondas cruzadas em alta frequência, moduladas
       * muito de leve sobre o albedo.
       *
       * A amplitude é minúscula (±3 %) de propósito. Tecido não tem desenho —
       * tem GRÃO —, e o que se quer é só que a superfície pare de ser
       * perfeitamente lisa. Acima disso vira estampa xadrez.
       *
       * A coordenada é a LOCAL, não a de mundo: assim a trama acompanha a peça
       * quando o braço gira, em vez de o corpo deslizar por dentro de um padrão
       * fixo no espaço.
       */
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         if ( fabric > 0.0 ) {
           vec3 p = vLocalPos * 220.0;
           float trama = sin( p.x ) * sin( p.y ) + 0.6 * sin( p.z * 1.3 + p.y * 0.7 );
           diffuseColor.rgb *= 1.0 + trama * 0.03 * fabric;
         }`,
      )
      /* Entra no fim, DEPOIS da iluminação e antes da névoa: o rim é luz
         somada, não uma propriedade da superfície. Somá-lo antes faria a névoa
         não o cobrir, e o arqueiro a cem metros teria contorno neon. */
      .replace(
        "#include <opaque_fragment>",
        `{
           vec3 rimV = normalize( vViewPosition );
           float rim = pow( 1.0 - abs( dot( normalize( normal ), rimV ) ), 3.0 );
           // A cor do rim é a da luz do céu: ele representa o céu inteiro
           // batendo de raspão na borda do corpo, e céu é azul.
           outgoingLight += vec3( 0.62, 0.74, 1.0 ) * rim * rimStrength;
         }
         #include <opaque_fragment>`,
      );
  };
  // Sem chave própria o Three reaproveitaria o programa de qualquer
  // MeshStandardMaterial com as mesmas flags e o enxerto seria ignorado.
  material.customProgramCacheKey = () => `archer-rim-${forca}-${tecido}`;
  return material;
}

/** Preenche `color` = branco em toda geometria da subárvore que não tiver. */
function fillNeutralVertexColors(root) {
  root.traverse((o) => {
    const geo = o.geometry;
    if (!geo || geo.attributes.color) return;
    const n = geo.attributes.position.count;
    const brancos = new Float32Array(n * 3).fill(1);
    geo.setAttribute("color", new THREE.BufferAttribute(brancos, 3));
  });
}

function createMaterials() {
  /* `vertexColors: true` liga o gradiente e o AO de junta que `makeSegment` e
     `makeJoint` assaram na geometria (ver `utils/geometry.js`). As peças que
     NÃO são segmento nem junta simplesmente não têm o atributo `color`, e o
     Three trata a ausência dele como branco — então ligar a chave em todos os
     materiais é seguro e evita ter duas famílias de material para manter. */
  const pele = (cor, rough) =>
    withRimLight(
      new THREE.MeshStandardMaterial({
        color: cor,
        roughness: rough,
        metalness: 0,
        vertexColors: true,
      }),
      0.26,
    );
  // `tecido` = 1 liga a trama do fragmento; a pele e o metal ficam lisos.
  const pano = (cor, rough, tecido = 1) =>
    withRimLight(
      new THREE.MeshStandardMaterial({
        color: cor,
        roughness: rough,
        metalness: 0,
        vertexColors: true,
      }),
      0.2,
      tecido,
    );

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
    metal: withRimLight(
      new THREE.MeshStandardMaterial({
        color: "#b9bcc2",
        roughness: 0.28,
        metalness: 0.85,
      }),
      0.18,
    ),
  };
}

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const TAU = Math.PI * 2;
const _color = new THREE.Color();
/** Branco de referência para clarear a cor do jogador (ver `setColor`). */
const WHITE = new THREE.Color(1, 1, 1);
/** Quanto o pé pode descer abaixo da base do corpo ao acompanhar o relevo (m). */
const MAX_STEP_DOWN = 0.45;

export class Player {
  constructor(terrain, entityId = 1) {
    this.terrain = terrain;
    this.entityId = entityId;
    this.isLocal = true;
    /** Nome mostrado na etiqueta e nos avisos. Vem da rede; null = jogo local. */
    this.displayName = null;
    this.physicsBody = null;
    this.airborne = false;
    this.root = new THREE.Group();
    this.root.name = "archer";

    /** Materiais próprios deste arqueiro — ver `createMaterials()`. */
    this.mat = createMaterials();
    /** Cor do jogador (roupa, etiqueta, traçado). null = uniforme padrão. */
    this.color = null;
    this._opacity = 1;
    /**
     * Imune a flecha — nasceu agora e ainda está piscando.
     *
     * É um booleano simples, atualizado a cada frame por quem cuida do
     * renascimento, em vez de um instante a comparar com o relógio. `hitResolver`
     * roda dentro do passo da física e não tem — nem deveria ter — acesso ao
     * relógio da sala.
     */
    this.invulnerable = false;
    /**
     * Limite de Z mínimo (modo série). Atrás da linha no chão os arqueiros
     * podem andar; além dela, não. null = sem limite.
     */
    this.minZ = null;
    /** 0 = de pé, 1 = caído. Sobrevive como medida de progresso do tombo. */
    this.deathFall = 0;
    /**
     * O corpo mole, quando morto. `null` = vivo.
     *
     * Quem cria e alimenta é o `Death` (ou o `RemotePlayer`); aqui só se lê.
     * O arqueiro não sabe simular um tombo — ele sabe VESTIR um.
     */
    this.ragdoll = null;

    this.position = new THREE.Vector3(
      CONFIG.player.start.x,
      0,
      CONFIG.player.start.z,
    );
    this.yaw = 0; // 0 = olhando para -Z, na direção dos alvos
    this.pitch = 0;
    this.drawFraction = 0;
    /* 0 = pronta para tensionar; (0,1] = mão da corda buscando flecha na
       aljava. Ver `setReload` / `updateReloadArm`. */
    this.reloadFraction = 0;
    /** 0 = sem golpe; 0..1 = animação da faca em andamento. */
    this.knifeFraction = 0;
    this.bobPhase = 0;
    this.ponytailLag = new THREE.Vector2();
    this.prevYaw = 0;

    /* Estado da marcha. Ver `move()` para a ideia central: a fase do ciclo é
       medida em METROS PERCORRIDOS, não em segundos. */
    this.gaitPhase = 0; // rad — 2π = um ciclo completo (dois passos)
    this.gaitBlend = 0; // 0 parado … 1 em passo pleno
    this.runBlend = 0; // 0 andando … 1 correndo
    this.moveF = 0; // componente frontal do movimento local, suavizada
    this.moveS = 0; // componente lateral do movimento local, suavizada
    this.speed = 0; // m/s reais, suavizados
    this.footYaw = BODY.stanceYaw; // rad — para onde a ponta do pé aponta
    this.rootLift = 0; // m — deslocamento vertical do corpo (quique + agacho)

    // Vetores reaproveitados por frame (zero alocação no loop).
    this._aim = new THREE.Vector3();
    this._shoulderR = new THREE.Vector3();
    this._shoulderL = new THREE.Vector3();
    this._hipR = new THREE.Vector3();
    this._hipL = new THREE.Vector3();
    this._elbow = new THREE.Vector3();
    this._knee = new THREE.Vector3();
    this._handTarget = new THREE.Vector3();
    this._pole = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
    this._idleHand = new THREE.Vector3();
    this._nock = new THREE.Vector3();
    this._quiverGrab = new THREE.Vector3();
    this._reloadHand = new THREE.Vector3();
    this._knifeHand = new THREE.Vector3();
    this._knifeStart = new THREE.Vector3();
    this._knifePeak = new THREE.Vector3();
    this._anchor = new THREE.Vector3();
    this._lateral = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._tailA = new THREE.Vector3();
    this._tailB = new THREE.Vector3();
    this._tailC = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._qb = new THREE.Quaternion();
    this._euler = new THREE.Euler(0, 0, 0, "YXZ");

    this.build();
    this.setAim(0, 0);
  }

  /* ----------------------------------------------------------- montagem --- */

  build() {
    // Pivô do tronco: gira em Y (postura de lado) e em X (inclinação da mira).
    this.spine = new THREE.Group();
    this.spine.position.set(0, BODY.hipY, 0);
    this.root.add(this.spine);

    /* quadril e tronco --------------------------------------------------- */
    const pelvis = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.135, 0.1, 4, 14),
      this.mat.shorts,
    );
    pelvis.rotation.z = Math.PI / 2;
    pelvis.scale.set(1, 1, 0.72);
    pelvis.position.y = 0.02;
    pelvis.castShadow = true;
    this.spine.add(pelvis);

    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.152, 0.128, BODY.shoulderY - BODY.hipY - 0.02, 16),
      this.mat.top,
    );
    torso.scale.set(1, 1, 0.66);
    torso.position.y = (BODY.shoulderY - BODY.hipY) / 2 + 0.02;
    torso.castShadow = true;
    torso.receiveShadow = true;
    this.spine.add(torso);

    const waistBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.134, 0.134, 0.03, 16),
      this.mat.trim,
    );
    waistBand.scale.set(1, 1, 0.68);
    waistBand.position.y = BODY.waistY - BODY.hipY - 0.09;
    this.spine.add(waistBand);

    /* Cinto de couro com fivela. Junto com a bandoleira e a aljava, é o que
       transforma a silhueta de "boneco de primitivas" em "alguém equipada para
       atirar": o olho lê equipamento como intenção. */
    const cinto = new THREE.Mesh(
      new THREE.CylinderGeometry(0.142, 0.142, 0.055, 16),
      this.mat.leather,
    );
    cinto.scale.set(1, 1, 0.7);
    cinto.position.y = 0.055;
    this.spine.add(cinto);

    const fivela = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.048, 0.02),
      this.mat.metal,
    );
    fivela.position.set(0, 0.055, -0.1);
    this.spine.add(fivela);

    // Bandoleira cruzando o peito — a alça da aljava.
    const bandoleira = new THREE.Mesh(
      new THREE.BoxGeometry(0.052, 0.42, 0.016),
      this.mat.leatherDark,
    );
    bandoleira.position.set(0.02, (BODY.shoulderY - BODY.hipY) * 0.55, -0.1);
    bandoleira.rotation.z = 0.42;
    this.spine.add(bandoleira);

    /* Aljava nas costas, com as empenas aparecendo. */
    const aljava = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.044, 0.34, 10),
      this.mat.leather,
    );
    aljava.position.set(-0.11, (BODY.shoulderY - BODY.hipY) * 0.62, 0.13);
    aljava.rotation.set(0.34, 0, -0.3);
    aljava.castShadow = true;
    this.spine.add(aljava);

    for (let i = 0; i < 4; i++) {
      const haste = new THREE.Mesh(
        new THREE.CylinderGeometry(0.005, 0.005, 0.26, 5),
        this.mat.arrowShaft,
      );
      const dx = (i % 2 ? 1 : -1) * 0.018;
      const dz = i < 2 ? 0.016 : -0.016;
      haste.position.set(-0.11 + dx, (BODY.shoulderY - BODY.hipY) * 0.62 + 0.2, 0.13 + dz);
      haste.rotation.set(0.34, 0, -0.3);
      this.spine.add(haste);

      const empena = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.07), this.mat.fletch);
      empena.position.copy(haste.position);
      empena.position.y += 0.1;
      empena.rotation.set(0.34, i * 0.8, -0.3);
      this.spine.add(empena);
    }

    // Ombros arredondados.
    for (const s of [-1, 1]) {
      const sh = makeJoint(0.062, this.mat.top);
      sh.position.set(s * BODY.shoulderX, BODY.shoulderY - BODY.hipY, 0);
      this.spine.add(sh);
    }

    /* pescoço e cabeça ---------------------------------------------------- */
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.043, 0.05, 0.1, 10),
      this.mat.skin,
    );
    neck.position.y = BODY.neckY - BODY.hipY - 0.03;
    neck.castShadow = true;
    this.spine.add(neck);

    this.head = new THREE.Group();
    this.head.position.y = BODY.headY - BODY.hipY;
    this.spine.add(this.head);

    const skull = makeJoint(BODY.headR, this.mat.skin, 18);
    skull.scale.set(0.94, 1.06, 1.0);
    this.head.add(skull);

    /* Rosto.
       Sem olhos, a cabeça é uma bola e o personagem não tem para onde olhar —
       e é justamente a direção do olhar que dá leitura de "ela está mirando
       ali". A face olha para -Z no espaço da cabeça, que já é girada pela pose.

       As nove peças do rosto entram em `faceDetail` e SOMEM acima de ~12 m
       (ver `setFaceDetail`). A essa distância a íris tem meio pixel; o que se
       vê é a cabeça, e ela continua ali. Com doze arqueiros numa sala são
       ~100 chamadas de desenho a menos, sem que ninguém perceba a diferença. */
    const R = BODY.headR;
    this.faceDetail = [];
    for (const lado of [-1, 1]) {
      const olho = new THREE.Mesh(
        new THREE.SphereGeometry(R * 0.155, 10, 8),
        this.mat.eyeWhite,
      );
      olho.position.set(lado * R * 0.38, R * 0.1, -R * 0.86);
      olho.scale.set(1, 1.15, 0.62);
      this.head.add(olho);
      this.faceDetail.push(olho);

      const iris = new THREE.Mesh(
        new THREE.SphereGeometry(R * 0.085, 8, 6),
        this.mat.eyeDark,
      );
      iris.position.set(lado * R * 0.38, R * 0.1, -R * 0.95);
      iris.scale.set(1, 1, 0.55);
      this.head.add(iris);
      this.faceDetail.push(iris);

      // Sobrancelha: dá expressão e ancora o olho na testa.
      const sobrancelha = new THREE.Mesh(
        new THREE.BoxGeometry(R * 0.3, R * 0.07, R * 0.09),
        this.mat.hair,
      );
      sobrancelha.position.set(lado * R * 0.38, R * 0.34, -R * 0.87);
      sobrancelha.rotation.z = lado * 0.14;
      this.head.add(sobrancelha);
      this.faceDetail.push(sobrancelha);
    }

    const nariz = new THREE.Mesh(
      new THREE.ConeGeometry(R * 0.11, R * 0.26, 6),
      this.mat.skin,
    );
    nariz.rotation.x = -Math.PI / 2;
    nariz.position.set(0, -R * 0.08, -R * 0.95);
    this.head.add(nariz);
    this.faceDetail.push(nariz);

    const boca = new THREE.Mesh(
      new THREE.BoxGeometry(R * 0.3, R * 0.055, R * 0.06),
      this.mat.mouth,
    );
    boca.position.set(0, -R * 0.42, -R * 0.86);
    this.head.add(boca);
    this.faceDetail.push(boca);

    // Orelhas: fecham a silhueta da cabeça de perfil.
    for (const lado of [-1, 1]) {
      const orelha = new THREE.Mesh(
        new THREE.SphereGeometry(R * 0.2, 8, 6),
        this.mat.skin,
      );
      orelha.position.set(lado * R * 0.92, -R * 0.02, 0);
      orelha.scale.set(0.42, 1, 0.72);
      this.head.add(orelha);
      this.faceDetail.push(orelha);
    }

    // Cabelo: calota + franja, com a testa livre.
    const hairCap = new THREE.Mesh(
      new THREE.SphereGeometry(BODY.headR * 1.05, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
      this.mat.hair,
    );
    hairCap.scale.set(0.98, 1.12, 1.02);
    hairCap.position.y = 0.004;
    hairCap.castShadow = true;
    this.head.add(hairCap);

    const hairBack = new THREE.Mesh(
      new THREE.SphereGeometry(BODY.headR * 1.02, 16, 12, 0, Math.PI, 0, Math.PI),
      this.mat.hair,
    );
    hairBack.rotation.y = -Math.PI / 2;
    hairBack.scale.set(1.0, 1.05, 0.86);
    hairBack.position.z = 0.02;
    this.head.add(hairBack);

    // Rabo de cavalo: duas seções que balançam com atraso.
    this.ponytailRoot = new THREE.Group();
    this.ponytailRoot.position.set(0, 0.055, BODY.headR * 0.95);
    this.head.add(this.ponytailRoot);

    // A fita do rabo de cavalo: é ela que leva a cor do jogador na cabeça.
    const tie = makeJoint(0.036, this.mat.tie, 10);
    this.ponytailRoot.add(tie);

    this.ponytailA = makeSegment(0.056, this.mat.hair, true, 10);
    this.ponytailRoot.add(this.ponytailA);

    this.ponytailB = new THREE.Group();
    this.ponytailRoot.add(this.ponytailB);
    this.ponytailTip = makeSegment(0.04, this.mat.hair, true, 10);
    this.ponytailB.add(this.ponytailTip);

    /* braços -------------------------------------------------------------- */
    this.armR = this.buildArm(); // braço do arco
    this.armL = this.buildArm(); // braço da corda
    this.root.add(this.armR.group, this.armL.group);

    /* Flecha que a mão carrega da aljava até o nock durante o reload.
       Fica escondida fora dessa janela — a flecha encaixada no arco é outra. */
    this.heldArrow = this.buildHeldArrow();
    this.armL.hand.add(this.heldArrow);
    this.heldArrow.visible = false;

    /* A faca fica presa à mão livre e só aparece enquanto o golpe acontece. */
    this.knife = this.buildKnife();
    this.armL.hand.add(this.knife);
    this.knife.visible = false;

    /* pernas -------------------------------------------------------------- */
    this.legR = this.buildLeg();
    this.legL = this.buildLeg();
    this.root.add(this.legR.group, this.legL.group);

    /* Todo o resto do corpo ganha cor de vértice NEUTRA.
     *
     * Isto não é enfeite, é obrigatório: os materiais do arqueiro têm
     * `vertexColors: true` por causa do gradiente e do AO de junta, e o Three
     * define `USE_COLOR` a partir do MATERIAL, sem olhar se a geometria tem o
     * atributo. Numa geometria sem ele o WebGL entrega (0,0,0) para o atributo
     * desligado — e a peça sai PRETA. Só os segmentos e as juntas nascem com
     * cor (ver `utils/geometry.js`); pescoço, nariz, cinto, aljava e o resto
     * são primitivas cruas, e é aqui que elas recebem o branco.
     *
     * Roda ANTES do arco entrar no root: os materiais do arco são dele e não
     * têm `vertexColors`, então gastar memória com um atributo que ninguém lê
     * seria desperdício.
     */
    fillNeutralVertexColors(this.root);

    /* arco ---------------------------------------------------------------- */
    this.bow = new Bow();
    this.root.add(this.bow.group);
  }

  buildArm() {
    const group = new THREE.Group();
    const upper = makeSegment(0.057, this.mat.skin, true, 12);
    const fore = makeSegment(0.047, this.mat.skin, true, 12);
    const elbow = makeJoint(0.052, this.mat.skin, 12);

    /* A mão ganha dedos.
       Uma esfera na ponta do braço some assim que a câmera chega perto — e em
       primeira pessoa a mão do arco fica a meio metro do olho. Não é anatomia:
       são quatro dedos e um polegar em caixas, o suficiente para o cérebro
       parar de ver uma bola. */
    const hand = new THREE.Group();
    const palma = new THREE.Mesh(
      new THREE.BoxGeometry(0.062, 0.088, 0.038),
      this.mat.skinDark,
    );
    palma.castShadow = true;
    hand.add(palma);

    for (let i = 0; i < 4; i++) {
      const dedo = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.0105, 0.05 - Math.abs(i - 1.5) * 0.008, 3, 6),
        this.mat.skinDark,
      );
      // +Y é a direção cotovelo→mão: os dedos seguem ADIANTE do punho.
      dedo.position.set(-0.021 + i * 0.014, 0.062, 0.002);
      dedo.rotation.x = -0.25;
      hand.add(dedo);
    }
    const polegar = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.012, 0.036, 3, 6),
      this.mat.skinDark,
    );
    polegar.position.set(0.034, 0.022, -0.016);
    polegar.rotation.set(-0.2, 0, 0.9);
    hand.add(polegar);

    // Bracelete de couro no antebraço (a proteção contra a corda).
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.058, 0.055, 0.085, 12),
      this.mat.leather,
    );
    band.castShadow = true;
    const fita = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.057, 0.014, 12),
      this.mat.leatherDark,
    );
    band.add(fita);

    group.add(upper, fore, elbow, hand, band);
    return { group, upper, fore, elbow, hand, band };
  }

  buildLeg() {
    const group = new THREE.Group();
    const thigh = makeSegment(0.092, this.mat.skin, true, 12);
    const shin = makeSegment(0.068, this.mat.skin, true, 12);
    const knee = makeJoint(0.072, this.mat.skin, 12);
    // Bermuda cobrindo a parte de cima da coxa.
    const short = makeSegment(0.105, this.mat.shorts, true, 12);
    short.userData.isShort = true;

    // Tênis montado com a ponta em -Z; o grupo é girado para a direção do pé.
    const shoe = new THREE.Group();
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.104, 0.05, 0.26), this.mat.shoe);
    sole.position.set(0, 0.025, -0.03);
    sole.castShadow = true;
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.075, 0.15), this.mat.shoeRed);
    upper.position.set(0, 0.075, 0.025);
    upper.castShadow = true;
    const toe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.045, 0.08), this.mat.shoe);
    toe.position.set(0, 0.06, -0.115);
    shoe.add(sole, upper, toe);

    group.add(thigh, shin, knee, shoe, short);
    return { group, thigh, shin, knee, shoe, short };
  }

  /* -------------------------------------------------------------- estado --- */

  setAim(yaw, pitch) {
    this.yaw = yaw;
    this.pitch = clamp(pitch, CONFIG.player.pitchMin, CONFIG.player.pitchMax);
  }

  setDraw(fraction) {
    this.drawFraction = clamp(fraction, 0, 1);
  }

  /**
   * Progresso da animação de recarregar (0 = ociosa, 1 = acabou de encaixar).
   * Quem dispara o timer é o `main`; aqui só vestimos a pose.
   */
  setReload(fraction) {
    this.reloadFraction = clamp(fraction, 0, 1);
    if (this.reloadFraction <= 0 && this.heldArrow) {
      this.heldArrow.visible = false;
    }
  }

  /** Progresso do golpe de faca; a animação é vestida por `updateKnifeArm`. */
  setKnife(fraction) {
    this.knifeFraction = clamp(fraction, 0, 1);
    if (this.knife) this.knife.visible = this.knifeFraction > 0;
    if (this.knifeFraction > 0 && this.heldArrow) {
      this.heldArrow.visible = false;
    }
  }

  get isKnifeAttacking() {
    return this.knifeFraction > 0;
  }

  get isReloading() {
    return this.reloadFraction > 0;
  }

  /** Haste simples na mão da corda — só aparece no meio do reload. */
  buildHeldArrow() {
    const group = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.004, 0.55, 5),
      this.mat.arrowShaft,
    );
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = -0.22;
    shaft.castShadow = true;
    group.add(shaft);

    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.007, 0.04, 5),
      this.mat.metal,
    );
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -0.52;
    group.add(tip);

    const fletch = new THREE.Mesh(
      new THREE.PlaneGeometry(0.06, 0.018),
      this.mat.fletch,
    );
    fletch.rotation.y = Math.PI / 2;
    fletch.position.set(0, 0.01, 0.02);
    group.add(fletch);

    // Orientação na palma: haste saindo para trás da mão.
    group.position.set(0.01, 0.02, -0.02);
    group.rotation.set(0.15, 0.4, 0.35);
    return group;
  }

  /** Faca curta, presa à mão livre, invisível fora do golpe. */
  buildKnife() {
    const group = new THREE.Group();

    const cabo = new THREE.Mesh(
      new THREE.BoxGeometry(0.032, 0.12, 0.026),
      this.mat.leatherDark,
    );
    cabo.position.y = 0.075;
    cabo.castShadow = true;

    const guarda = new THREE.Mesh(
      new THREE.BoxGeometry(0.075, 0.018, 0.035),
      this.mat.metal,
    );
    guarda.position.y = 0.145;
    guarda.castShadow = true;

    const lamina = new THREE.Mesh(
      new THREE.BoxGeometry(0.038, 0.28, 0.012),
      this.mat.metal,
    );
    lamina.position.y = 0.29;
    lamina.castShadow = true;

    group.add(cabo, guarda, lamina);
    return group;
  }

  /** Todos os materiais deste arqueiro, o arco incluído. */
  get materials() {
    return [...Object.values(this.mat), ...(this.bow?.materials ?? [])];
  }

  /**
   * Cor do jogador.
   *
   * Tinge só a ROUPA. Pele e cabelo ficam como estão de propósito: colorir o
   * corpo inteiro apaga o volume do personagem e ele vira uma silhueta chapada,
   * justamente quando você mais precisa reconhecer quem é à distância.
   */
  setColor(hex) {
    if (hex == null || hex === this.color) return;
    this.color = hex;
    const c = _color.set(hex);
    this.mat.top.color.copy(c);
    this.mat.shoeRed.color.copy(c);
    // Bermuda um tom mais funda que a camiseta.
    this.mat.shorts.color.copy(c).multiplyScalar(0.8);
    /* Fita e empena também (Fase 5A.6). Elas ficam mais CLARAS que a camiseta,
       não iguais: são peças de poucos pixels contra o cabelo escuro e contra a
       aljava de couro, e no mesmo tom da roupa elas desapareceriam justamente
       nos dois fundos onde estão. */
    this.mat.tie.color.copy(c).lerp(WHITE, 0.25);
    this.mat.fletch.color.copy(c).lerp(WHITE, 0.18);
  }

  /**
   * Transparência do corpo inteiro — é isto que faz o piscar da invencibilidade.
   *
   * A flag `transparent` só é tocada na VIRADA (duas vezes por renascimento),
   * porque mudá-la obriga o Three a recompilar o material. A opacidade em si é
   * de graça, então piscar a 6 Hz não custa nada.
   */
  setOpacity(alpha) {
    if (alpha === this._opacity) return;
    const wasTransparent = this._opacity < 0.999;
    const isTransparent = alpha < 0.999;
    this._opacity = alpha;
    for (const m of this.materials) {
      m.opacity = alpha;
      if (isTransparent === wasTransparent) continue;
      m.transparent = isTransparent;
      m.depthWrite = !isTransparent;
      m.needsUpdate = true;
    }
  }

  /** Libera GPU ao tirar um jogador remoto da cena. */
  dispose() {
    for (const m of this.materials) m.dispose();
    this.root.traverse((o) => o.geometry?.dispose());
  }

  /** Move no plano; a altura vem do terreno. */
  move(dt, forward, strafe, wantRun = false) {
    const p = CONFIG.player;
    const g = CONFIG.gait;
    const moving = forward !== 0 || strafe !== 0;
    const target = moving ? (wantRun ? p.runSpeed : p.walkSpeed) : 0;

    // A velocidade persegue o alvo em vez de saltar: sair andando e frear têm
    // peso, e Shift acelera de forma contínua.
    this.speed = damp(this.speed, target, p.speedSmoothing, dt);
    this.runBlend = damp(this.runBlend, moving && wantRun ? 1 : 0, p.runSmoothing, dt);

    let fx = 0;
    let sx = 0;
    const step = this.speed * dt;
    if (moving) {
      const len = Math.hypot(forward, strafe) || 1;
      fx = forward / len;
      sx = strafe / len;
      if (step > 1e-6) {
        const sin = Math.sin(this.yaw);
        const cos = Math.cos(this.yaw);
        const wdx = (-sin * fx + cos * sx) * step;
        const wdz = (-cos * fx - sin * sx) * step;
        if (this.physicsBody) {
          const cur = this.physicsBody.desiredHorizontal;
          this.physicsBody.setHorizontalMove(cur.x + wdx, cur.z + wdz);
        } else {
          this.stepTo(wdx, wdz);
        }
      }
    }

    /* Composição do passo. `moveF`/`moveS` guardam o vetor de movimento em
       coordenadas do corpo (frente e lado) já amortecido — é essa proporção que
       mistura o balanço sagital com o passo lateral, e é o SINAL de `moveF` que
       inverte o ciclo ao andar para trás. `gaitBlend` liga e desliga a animação
       inteira, garantindo o retorno suave à pose neutra ao parar. */
    this.moveF = damp(this.moveF, fx, g.blendSmoothing, dt);
    this.moveS = damp(this.moveS, sx, g.blendSmoothing, dt);
    this.gaitBlend = damp(this.gaitBlend, moving ? 1 : 0, g.blendSmoothing, dt);

    /* A FASE ANDA COM A DISTÂNCIA, não com o relógio: um ciclo completo a cada
       `strideLength` metros. Assim a cadência acompanha sozinha a velocidade
       real — o pé nunca patina no chão nem "corre no lugar" — e a corrida sai
       mais rápida de graça, ainda por cima com a passada mais longa. */
    const stride = g.strideLength * (1 + g.runStrideGain * this.runBlend);
    this.gaitPhase += (step / stride) * TAU;
    if (this.gaitPhase > TAU) this.gaitPhase -= TAU;

    this.bobPhase += dt * 1.3; // respiração — independe da marcha

    if (!this.physicsBody) {
      this.position.y = this.terrain.heightAt(this.position.x, this.position.z);
    }
    return moving;
  }

  jump() {
    this.physicsBody?.queueJump();
  }

  getHitBody() {
    return this.physicsBody?.getHitBody() ?? null;
  }

  onArrowHit(_impact, _arrow) {
    /* Futuro: dano, animação de impacto */
  }

  getPosition() {
    return this.position;
  }

  /** Stub para sync multiplayer futuro. */
  applyNetworkState(_state) {}

  /**
   * Avança o passo respeitando os limites da arena — e DESLIZANDO neles.
   *
   * O limite não é uma caixa invisível: é o próprio terreno. `isWalkable`
   * recusa o que é íngreme demais para se subir e o que passou da borda da
   * bacia. Quando o passo inteiro é recusado, cada eixo é tentado sozinho:
   * assim, encostar na serra em diagonal faz a arqueira correr rente à
   * encosta em vez de travar de repente.
   *
   * O terreno se estende centenas de metros além disso, então mesmo que este
   * teste falhasse não haveria buraco para cair — só encosta.
   */
  stepTo(dx, dz) {
    const p = this.position;
    if (this.tryStep(p.x + dx, p.z + dz)) return;
    if (this.tryStep(p.x + dx, p.z)) return;
    this.tryStep(p.x, p.z + dz);
  }

  tryStep(x, z) {
    // Modo série: a linha no chão. Quem passa dela anula o tiro à distância.
    if (this.minZ != null && z < this.minZ) z = this.minZ;
    if (!this.terrain.isWalkable(x, z)) return false;
    this.position.x = x;
    this.position.z = z;
    return true;
  }

  /** Fator de amplitude do passo: 1 andando, cresce até a corrida plena. */
  get strideScale() {
    return 1 + CONFIG.gait.runAmplitudeGain * this.runBlend;
  }

  /* --------------------------------------------------------------- pose ---- */

  update(dt, moving) {
    // Morto, o corpo não anda: quem manda na pose é o ragdoll, e ele já traz
    // posição, orientação e a ponta de cada membro prontas.
    if (this.ragdoll?.active) {
      this.poseRagdoll(dt);
      return;
    }

    // O quique vertical sai da MESMA fase do passo (dois toques de pé por
    // ciclo), com `gaitBlend` desligando na parada e a respiração assumindo.
    // Sem isso teríamos duas fontes de verdade para a cadência e o corpo
    // subiria fora de sincronia com os pés.
    const g = CONFIG.gait;
    const w = this.gaitBlend;
    const amp = this.strideScale;

    const stepBob = Math.sin(this.gaitPhase * 2) * g.bobAmplitude * amp * w;
    const breath = Math.sin(this.bobPhase) * 0.006 * (1 - w);
    const jumpLift = this.airborne
      ? Math.sin(Math.min(1, (this.physicsBody?.verticalVelocity ?? 0) / CONFIG.player.jumpSpeed + 0.5) * Math.PI) * 0.06
      : 0;
    this.rootLift = stepBob + breath - g.crouch * w * (1 - this.airborne * 0.8) + jumpLift;

    this.root.position.set(
      this.position.x,
      this.position.y + this.rootLift,
      this.position.z,
    );
    /* A rotação é escrita INTEIRA, e não só em Y e Z.
     *
     * O ragdoll põe uma orientação arbitrária no `root` (por quaternion, ver
     * `poseRagdoll`), e o Three sincroniza os ângulos de Euler a partir dela —
     * inclusive o X. Ao renascer, escrever só Y e Z deixava aquele X para trás,
     * e a arqueira voltava à vida permanentemente tombada para a frente. */
    this.root.rotation.set(0, this.yaw, this.deathFall * Math.PI * 0.5);
    if (this.deathFall > 0) this.root.position.y -= this.deathFall * 0.22;

    // Direção da mira no espaço do root (o yaw já está no root).
    this._aim.set(0, Math.sin(this.pitch), -Math.cos(this.pitch));
    // Lateral do corpo (direita), usada para manter os cotovelos para fora.
    this._lateral.set(1, 0, 0);

    /* Para onde a ponta do pé aponta. Parada, ela mantém a base de arqueiro;
       andando, vira parcialmente para a direção da marcha — pelo caminho
       angular curto, para não dar meia-volta ao inverter o sentido. */
    const mag = Math.hypot(this.moveF, this.moveS);
    let turn = 0;
    if (mag > 1e-3) {
      let d = Math.atan2(-this.moveS, this.moveF) - BODY.stanceYaw;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      turn = d * g.footTurn * w * Math.min(1, mag);
    }
    this.footYaw = BODY.stanceYaw + turn;

    /* Tronco: postura de lado + inclinação acompanhando a mira + a torção do
       passo. A torção é cancelada conforme o arco tensiona: mirando, o tronco
       trava, e a caminhada não mexe na linha da flecha nem no punho do arco. */
    const twist =
      Math.sin(this.gaitPhase) * g.torsoTwist * amp * w * (1 - this.drawFraction);
    this._q.setFromAxisAngle(AXIS_X, -this.pitch * 0.42);
    this._qb.setFromAxisAngle(AXIS_Y, BODY.stanceYaw + twist);
    this.spine.quaternion.copy(this._q).multiply(this._qb);
    this.spine.updateMatrix();

    // A cabeça compensa a rotação do tronco para olhar o alvo.
    this.head.rotation.y = -BODY.stanceYaw * 0.86;
    this.head.rotation.x = -this.pitch * 0.35;

    this.localToRoot(BODY.shoulderX, BODY.shoulderY - BODY.hipY, 0, this._shoulderR);
    this.localToRoot(-BODY.shoulderX, BODY.shoulderY - BODY.hipY, 0, this._shoulderL);
    this.localToRoot(BODY.hipX, -0.02, 0, this._hipR);
    this.localToRoot(-BODY.hipX, -0.02, 0, this._hipL);

    this.updateBow();
    this.updateArms(dt);
    this.updateLegs();
    this.updatePonytail(dt);

    this.prevYaw = this.yaw;
    this.root.updateMatrixWorld(true);
  }

  localToRoot(x, y, z, out) {
    return out.set(x, y, z).applyMatrix4(this.spine.matrix);
  }

  /* -------------------------------------------------------------- ragdoll --
   *
   * A pose de um corpo sem tônus. Ela substitui `update()` inteiro na morte, e
   * não o corrige: marcha, mira e tensionamento não existem mais aqui.
   *
   * A divisão de trabalho é a mesma do resto do arquivo: quem calcula É OUTRO
   * (`game/ragdoll.js`, que simula o tombo e as pontas dos membros), e este
   * método só VESTE o resultado no esqueleto — a mesma IK de dois ossos que
   * anima a caminhada, alimentada com alvos que agora vêm da física em vez do
   * ciclo de passo. É por isso que o corpo mole não precisou de nenhum osso
   * novo nem de um segundo boneco.
   */
  poseRagdoll(dt) {
    const rd = this.ragdoll;
    rd.update(dt);

    rd.rootPosition(this.root.position);
    this.root.quaternion.copy(rd.orient);
    this.root.updateMatrix();

    /* Tronco: encurvado pelas molas da coluna, e com a postura de arqueiro
       (o tronco de lado) desaparecendo — ela é tensão muscular, e o que
       define este estado é justamente não haver nenhuma. */
    this._q.setFromAxisAngle(AXIS_X, rd.spine.pitch);
    this._qb.setFromAxisAngle(AXIS_Z, rd.spine.roll);
    this.spine.quaternion.copy(this._q).multiply(this._qb);
    this._qb.setFromAxisAngle(AXIS_Y, BODY.stanceYaw * 0.25);
    this.spine.quaternion.multiply(this._qb);
    this.spine.updateMatrix();

    this.head.rotation.set(rd.neck.pitch * 0.6, 0, rd.neck.roll);

    this.localToRoot(BODY.shoulderX, BODY.shoulderY - BODY.hipY, 0, this._shoulderR);
    this.localToRoot(-BODY.shoulderX, BODY.shoulderY - BODY.hipY, 0, this._shoulderL);
    this.localToRoot(BODY.hipX, -0.02, 0, this._hipR);
    this.localToRoot(-BODY.hipX, -0.02, 0, this._hipL);

    // Mãos e pés não atravessam o chão. A simulação dos membros roda no espaço
    // do root, que está girando; o chão é do mundo — então a checagem tem de
    // ir e voltar. É uma vez por membro por frame, não por subpasso.
    this.clampLimbToGround(rd.handR.p, 0.05);
    this.clampLimbToGround(rd.handL.p, 0.05);
    this.clampLimbToGround(rd.footR.p, 0.08);
    this.clampLimbToGround(rd.footL.p, 0.08);

    // Cotovelos para fora, joelhos para a frente: sem um pólo definido a IK
    // escolhe um plano arbitrário e as juntas dobram para dentro do corpo.
    this._pole.set(1, 0.25, -0.3).normalize();
    this.poseArm(this.armR, this._shoulderR, rd.handR.p, this._pole, 0.02);
    this._pole.set(-1, 0.25, -0.3).normalize();
    this.poseArm(this.armL, this._shoulderL, rd.handL.p, this._pole, 0.02);

    this._pole.set(0, 0.15, -1).normalize();
    this.poseLegTo(this.legR, this._hipR, rd.footR.p, this._pole);
    this.poseLegTo(this.legL, this._hipL, rd.footL.p, this._pole);

    // O arco cai junto com a mão que o segurava — largá-lo no chão exigiria um
    // objeto solto com vida própria, e ninguém repara nele durante o tombo.
    this.bow.group.position.copy(rd.handR.p);
    this.bow.group.quaternion.copy(this.armR.fore.quaternion);

    this.updatePonytail(dt);
    this.prevYaw = this.yaw;
    this.root.updateMatrixWorld(true);
  }

  /** Impede que uma ponta de membro entre no terreno. `p` é do espaço do root. */
  clampLimbToGround(p, folga) {
    this._tmp.copy(p).applyQuaternion(this.root.quaternion).add(this.root.position);
    const chao = this.terrain.heightAt(this._tmp.x, this._tmp.z) + folga;
    if (this._tmp.y >= chao) return;
    this._tmp.y = chao;
    this._tmp.sub(this.root.position);
    p.copy(this._tmp).applyQuaternion(this._q.copy(this.root.quaternion).invert());
  }

  updateBow() {
    /* A geometria do tiro nasce da ANCORAGEM, não do ombro.
     *
     * Num arqueiro de verdade a corda é puxada até um ponto fixo do rosto (o
     * canto da boca, do lado da mão que puxa) e o arco fica onde a linha da
     * flecha manda. Derivar o punho a partir do ombro, como eu fazia antes,
     * jogava o nock para o lado ERRADO do rosto: o braço da corda tinha que
     * atravessar o tronco para alcançá-lo.
     *
     * Aqui ela puxa com a mão esquerda, então a âncora fica à esquerda do
     * queixo e o braço da corda trabalha do seu próprio lado do corpo. */
    this.localToRoot(0, BODY.headY - BODY.hipY, 0, this._anchor);
    this._anchor.x -= BODY.anchorSide; // lado da mão que puxa
    this._anchor.y -= BODY.anchorDrop; // canto da boca
    this._anchor.addScaledVector(this._aim, BODY.anchorForward);

    // Punho do arco: sobre a linha da flecha, à frente da âncora.
    const grip = this._tmp
      .copy(this._anchor)
      .addScaledVector(this._aim, this.bow.fullDrawReach);

    this.bow.group.position.copy(grip);
    // -Z do arco na direção da mira, com inclinação lateral (cant) de ~12°,
    // como na referência.
    this._euler.set(this.pitch, 0, -0.21);
    this.bow.group.quaternion.setFromEuler(this._euler);
    this.bow.setDraw(this.drawFraction);
    /* Sem flecha no arco enquanto a mão busca outra na aljava. Volta a
       aparecer quando a mão chega perto do nock (ver `updateReloadArm`). */
    const t = this.reloadFraction;
    const flechaNoArco = t <= 0 || t >= 0.7;
    this.bow.setArrowVisible(flechaNoArco);
  }

  updateArms(dt) {
    /* braço do arco: quase reto, cotovelo girado para baixo e para fora ----- */
    const gripLocal = this.bow.group.position;
    this._pole.set(0.55, -1, 0.15).normalize();
    this.poseArm(this.armR, this._shoulderR, gripLocal, this._pole, 0.06);

    if (this.knifeFraction > 0) {
      this.updateKnifeArm();
      return;
    }

    if (this.reloadFraction > 0) {
      this.updateReloadArm();
      return;
    }

    /* braço da corda: puxa o nock, cotovelo alto e para trás ---------------- */
    // Nock em coordenadas do root, direto da transformação local do arco (sem
    // depender de matrizes de mundo, que ainda não foram atualizadas).
    this._nock
      .copy(this.bow.nockPoint)
      .applyQuaternion(this.bow.group.quaternion)
      .add(this.bow.group.position);
    /* Antes de tensionar, a mão descansa junto ao quadril — e é só aí que ela
       balança com o passo, em fase com a perna DIREITA (braço e perna opostos,
       como na marcha humana). Assim que a corda começa a ser puxada o balanço
       desaparece: o braço do arco nunca é tocado, então a mira não sente nada. */
    const armSwing =
      Math.cos(this.gaitPhase) *
      CONFIG.gait.armSwing *
      this.strideScale *
      this.gaitBlend *
      (1 - this.drawFraction);
    this._idleHand
      .copy(this._hipL)
      .add(this._tmp.set(-0.06, -0.16, 0.06 - armSwing));
    const grab = clamp(this.drawFraction * 5, 0, 1);
    this._handTarget.copy(this._idleHand).lerp(this._nock, grab);

    // Cotovelo alto e para trás, alinhado com a flecha — e sempre para FORA do
    // corpo (lado da mão que puxa), nunca cruzando o peito.
    this._pole
      .copy(this._aim)
      .multiplyScalar(-1)
      .addScaledVector(AXIS_Y, 0.45)
      .addScaledVector(this._lateral, -0.55)
      .normalize();
    this.poseArm(this.armL, this._shoulderL, this._handTarget, this._pole, 0.0);
  }

  /** Estocada curta com a mão que não segura o arco. */
  updateKnifeArm() {
    const t = this.knifeFraction;

    this._idleHand
      .copy(this._hipL)
      .add(this._tmp.set(-0.06, -0.16, 0.06));
    this._knifeStart
      .copy(this._idleHand)
      .addScaledVector(this._aim, 0.08)
      .addScaledVector(AXIS_Y, 0.05);
    this._knifePeak
      .copy(this._shoulderL)
      .addScaledVector(this._aim, 0.42)
      .addScaledVector(this._lateral, -0.14)
      .addScaledVector(AXIS_Y, -0.1);

    if (t < 0.2) {
      const k = smoothstep(0, 0.2, t);
      this._knifeHand.copy(this._knifeStart).lerp(this._knifePeak, k);
    } else if (t < 0.45) {
      this._knifeHand.copy(this._knifePeak);
    } else {
      const k = smoothstep(0.45, 1, t);
      this._knifeHand.copy(this._knifePeak).lerp(this._knifeStart, k);
    }

    this._pole
      .copy(this._aim)
      .multiplyScalar(-0.45)
      .addScaledVector(AXIS_Y, 0.6)
      .addScaledVector(this._lateral, -0.8)
      .normalize();
    this.poseArm(this.armL, this._shoulderL, this._knifeHand, this._pole, 0.0);

    if (this.heldArrow) this.heldArrow.visible = false;
  }

  /**
   * Mão da corda: nock → aljava → nock → repouso.
   *
   * É a mão LIVRE depois do tiro (a outra segura o arco). Sai da face, sobe
   * pelas costas até a aljava, traz a flecha de volta ao arco e só então
   * descansa no quadril. Funciona andando, correndo ou parado.
   */
  updateReloadArm() {
    const t = this.reloadFraction;

    this._nock
      .copy(this.bow.nockPoint)
      .applyQuaternion(this.bow.group.quaternion)
      .add(this.bow.group.position);

    // Boca da aljava, um pouco acima do cilindro — onde a mão "pega" a haste.
    this.localToRoot(
      -0.1,
      (BODY.shoulderY - BODY.hipY) * 0.88,
      0.2,
      this._quiverGrab,
    );

    this._idleHand.copy(this._hipL).add(this._tmp.set(-0.06, -0.16, 0.06));

    let hand;
    if (t < 0.32) {
      // Da face (onde soltou a corda) para as costas / aljava.
      const k = smoothstep(0, 0.32, t);
      hand = this._reloadHand.copy(this._nock).lerp(this._quiverGrab, k);
    } else if (t < 0.42) {
      // Segura um instante — o "pegou".
      hand = this._reloadHand.copy(this._quiverGrab);
    } else if (t < 0.78) {
      // Traz a flecha até o nock e encaixa.
      const k = smoothstep(0.42, 0.78, t);
      hand = this._reloadHand.copy(this._quiverGrab).lerp(this._nock, k);
    } else {
      // Solta o nock e volta ao quadril.
      const k = smoothstep(0.78, 1, t);
      hand = this._reloadHand.copy(this._nock).lerp(this._idleHand, k);
    }

    // Cotovelo alto e para trás enquanto alcança a aljava; depois abre de
    // lado no caminho de volta ao arco.
    const reachBack = t < 0.5 ? 1 : 1 - smoothstep(0.5, 0.85, t);
    this._pole
      .copy(this._aim)
      .multiplyScalar(-0.35 - 0.65 * reachBack)
      .addScaledVector(AXIS_Y, 0.55 + 0.35 * reachBack)
      .addScaledVector(this._lateral, -0.35 - 0.4 * reachBack)
      .normalize();
    this.poseArm(this.armL, this._shoulderL, hand, this._pole, 0.0);

    // Flecha na mão só no trecho aljava → nock.
    if (this.heldArrow) {
      this.heldArrow.visible = t >= 0.32 && t < 0.7;
    }
  }

  poseArm(arm, shoulder, hand, pole, straighten) {
    solveTwoBoneIK(
      shoulder,
      hand,
      BODY.upperArm + straighten,
      BODY.foreArm + straighten,
      pole,
      this._elbow,
    );
    orientSegment(arm.upper, shoulder, this._elbow);
    orientSegment(arm.fore, this._elbow, hand);
    arm.elbow.position.copy(this._elbow);
    arm.hand.position.copy(hand);
    // A mão deixou de ser uma esfera: sem orientar, os dedos apontariam para
    // uma direção fixa do mundo enquanto o braço gira.
    arm.hand.quaternion.copy(arm.fore.quaternion);
    // Punheira logo antes da mão.
    arm.band.position.copy(hand).lerp(this._elbow, 0.22);
    arm.band.quaternion.copy(arm.fore.quaternion);
  }

  /* ---------------------------------------------------------------- passo --
   *
   * O ciclo de marcha é descrito pelo PÉ, não por ângulos de junta: cada perna
   * recebe um alvo de pé deslocado em torno do quadril e a mesma IK de dois
   * ossos do resto do corpo resolve coxa e canela. Deslocar o pé para a frente
   * É girar a coxa em X; deslocá-lo para o lado É girá-la em Z — com três
   * vantagens sobre escrever os ângulos na mão:
   *
   *   • o joelho dobra sozinho na fase de balanço, porque levantar o pé encurta
   *     a distância quadril→pé e a IK responde com flexão;
   *   • o pé continua acompanhando o relevo (a altura vem do terreno sob ELE);
   *   • a pose parada continua saindo da mesma função, sem caso especial.
   *
   * As duas pernas andam em CONTRAFASE (π de diferença), e as componentes
   * sagital e frontal entram na proporção do vetor de movimento local — o que
   * dá a diagonal de graça. Andar para trás inverte `moveF` e, com ele, o
   * sentido do ciclo.
   */

  updateLegs() {
    this.poseLeg(this.legR, this._hipR, BODY.stanceWidth, 0);
    this.poseLeg(this.legL, this._hipL, -BODY.stanceWidth, Math.PI);
  }

  /**
   * Alvo do pé no espaço do root.
   * @param {number} side  afastamento ao longo do eixo lateral do tronco (m)
   * @param {number} theta fase desta perna no ciclo (rad)
   */
  footTarget(side, theta, out) {
    const g = CONFIG.gait;
    const w = this.gaitBlend;
    const amp = this.strideScale * w;

    if (this.airborne) {
      const stance = side * (1 - g.stanceNarrow * 0.4);
      let x = Math.cos(BODY.stanceYaw) * stance;
      let z = -Math.sin(BODY.stanceYaw) * stance;
      const tuck = 0.28 + Math.sin(this.gaitPhase * 2) * 0.04;
      return out.set(x, BODY.ankleY + tuck, z);
    }

    // Andando, a base de arqueiro se fecha: pés tão abertos só fazem sentido
    // plantada, e fechá-los ainda dá alcance de sobra para a passada.
    const stance = side * (1 - g.stanceNarrow * w);

    // Eixo lateral do tronco projetado no chão (X local do tronco girado).
    let x = Math.cos(BODY.stanceYaw) * stance;
    let z = -Math.sin(BODY.stanceYaw) * stance;

    /* Deslocamento do passo. O cosseno dá a posição ao longo do ciclo; a
       amplitude de cada plano é ponderada pela componente correspondente do
       movimento (frente/lado), então diagonal vira mistura das duas. */
    const swing = Math.cos(theta) * amp;
    x += swing * g.lateralAmplitude * this.moveS; // plano frontal (A/D)
    z -= swing * g.swingAmplitude * this.moveF; // plano sagital (W/S), -Z à frente

    // Mesmo ponto em mundo, para amostrar a altura do terreno sob o pé.
    // Rotação em torno de Y (convenção do Three): x' = x·cos + z·sen.
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const wx = this.root.position.x + c * x + s * z;
    const wz = this.root.position.z - s * x + c * z;
    /* `rootLift` sai da conta para que o pé fique colado no chão enquanto o
       corpo quica e agacha por cima dele.

       O piso é LIMITADO a um passo abaixo do corpo. De pé sobre uma pedra, o
       terreno sob o pé está metros abaixo, e sem a trava a perna esticaria
       para baixo procurando esse chão — atravessando a própria pedra em que a
       pessoa está. Um passo de 45 cm cobre qualquer declive caminhável e para
       exatamente antes desse absurdo. */
    const groundY = Math.max(
      -this.rootLift - MAX_STEP_DOWN,
      this.terrain.heightAt(wx, wz) - this.position.y - this.rootLift,
    );

    /* Fase de balanço = pé indo NA DIREÇÃO da marcha, ou seja, derivada
       positiva do deslocamento acima. Como a projeção do deslocamento sobre a
       direção do movimento vale cos(θ)·(algo ≥ 0) qualquer que seja o sentido,
       o critério é sempre −sen(θ) > 0 — e o pé levanta na hora certa mesmo
       andando para trás ou de lado. Levantar o pé é o que dobra o joelho. */
    const lift = Math.max(0, -Math.sin(theta)) * g.footLift * amp;

    return out.set(x, groundY + BODY.ankleY + lift, z);
  }

  poseLeg(leg, hip, side, phaseOffset) {
    const foot = this.footTarget(side, this.gaitPhase + phaseOffset, this._tmp);

    // Joelho aponta para onde o corpo está virado, virando um pouco para a
    // direção da marcha enquanto anda.
    this._pole
      .set(-Math.sin(BODY.stanceYaw), 0.1, -Math.cos(BODY.stanceYaw))
      .addScaledVector(
        this._tmpB.set(this.moveS, 0, -this.moveF),
        CONFIG.gait.kneeTurn * this.gaitBlend,
      )
      .normalize();
    this.poseLegTo(leg, hip, foot, this._pole);
  }

  /**
   * Resolve uma perna para um alvo de pé JÁ decidido.
   *
   * Separado de `poseLeg` porque o ragdoll também precisa dele: lá o pé não sai
   * do ciclo de marcha, sai da simulação do corpo mole. A IK e a orientação dos
   * segmentos são as mesmas nos dois casos — só a origem do alvo muda.
   */
  poseLegTo(leg, hip, foot, pole) {
    solveTwoBoneIK(hip, foot, BODY.thigh, BODY.shin, pole, this._knee);
    orientSegment(leg.thigh, hip, this._knee);
    orientSegment(leg.shin, this._knee, foot);
    // Bermuda: metade de cima da coxa.
    this._tmpB.copy(hip).lerp(this._knee, 0.52);
    orientSegment(leg.short, hip, this._tmpB);
    leg.knee.position.copy(this._knee);
    leg.shoe.position.copy(foot);
    leg.shoe.position.y -= BODY.ankleY;
    // A ponta do pé (-Z do grupo) aponta para onde o corpo está virado —
    // parcialmente girada para a direção da marcha enquanto anda.
    leg.shoe.rotation.set(0, this.footYaw, 0);
  }

  updatePonytail(dt) {
    // Atraso proporcional à velocidade angular: o rabo de cavalo "sobra" na
    // virada e volta amortecido.
    let dYaw = this.yaw - this.prevYaw;
    if (dYaw > Math.PI) dYaw -= Math.PI * 2;
    if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const yawRate = dt > 0 ? dYaw / dt : 0;

    this.ponytailLag.x = damp(this.ponytailLag.x, clamp(yawRate * 0.09, -0.5, 0.5), 9, dt);
    this.ponytailLag.y = damp(
      this.ponytailLag.y,
      clamp(-this.pitch * 0.25 + Math.sin(this.bobPhase * 2) * 0.05, -0.4, 0.4),
      7,
      dt,
    );

    const a = this._tailA.set(0, 0, 0);
    const b = this._tailB.set(
      this.ponytailLag.x * 0.12,
      -0.09 + this.ponytailLag.y * 0.1,
      0.17,
    );
    const c = this._tailC.set(
      b.x + this.ponytailLag.x * 0.16,
      b.y - 0.22 + this.ponytailLag.y * 0.12,
      b.z + 0.05,
    );
    orientSegment(this.ponytailA, a, b);
    this.ponytailB.position.copy(b);
    orientSegment(this.ponytailTip, a, c.sub(b));
  }

  /* --------------------------------------------------------------- tiro ---- */

  /** Ponto de disparo (repouso da flecha) em coordenadas de mundo. */
  getMuzzle(out) {
    return this.bow.getMuzzleWorld(out);
  }

  /**
   * Pivô da câmera em terceira pessoa: altura do ombro sobre os pés.
   *
   * A inclinação da mira não entra aqui — senão girar o mouse lateralmente
   * empurra a câmera para frente e para trás. `rootLift` também não: o quique
   * do passo, o agacho e a respiração são animação do CORPO, e passá-los para a
   * câmera é o que fazia a imagem balançar ao andar mirando. O pulo continua
   * sendo acompanhado, porque ele está em `position.y`.
   */
  getCameraPivot(out) {
    return out.set(
      this.position.x,
      this.position.y + BODY.shoulderY,
      this.position.z,
    );
  }

  /**
   * Olho da arqueira, em coordenadas de mundo: logo acima da ancoragem da
   * corda. É de lá que ela mira, então é de lá que a primeira pessoa enxerga —
   * a flecha passa rente à câmera e o arco aparece à frente.
   */
  getEye(out, aimWorld) {
    this._eye.copy(this._anchor);
    this._eye.y += CONFIG.firstPerson.eyeAboveAnchor;
    this._eye.x -= CONFIG.firstPerson.eyeSide;
    out.copy(this._eye).applyMatrix4(this.root.matrixWorld);
    if (aimWorld) out.addScaledVector(aimWorld, CONFIG.firstPerson.eyeForward);
    return out;
  }

  /** Esconde a cabeça na primeira pessoa (senão a câmera fica dentro dela). */
  setHeadVisible(visible) {
    this.head.visible = visible;
  }

  /**
   * LOD do rosto: acima de ~12 m somem íris, olho, sobrancelha, nariz, boca e
   * orelha. São nove malhas por arqueiro que, a essa distância, ocupam menos de
   * um pixel cada — e numa sala cheia é o item mais caro do corpo.
   *
   * O corte é feito por quem CONHECE a distância (o jogador remoto, em
   * `net/remotePlayers.js`); aqui só se veste o resultado, e só na virada,
   * porque escrever `visible` em nove objetos por quadro por jogador seria
   * trocar chamadas de desenho por trabalho de CPU.
   */
  setFaceDetail(on) {
    if (this._faceDetailOn === on) return;
    this._faceDetailOn = on;
    for (const o of this.faceDetail) o.visible = on;
  }
}

/** Distância (m) acima da qual o rosto do arqueiro deixa de ser desenhado. */
export const FACE_DETAIL_DISTANCE = 12;
