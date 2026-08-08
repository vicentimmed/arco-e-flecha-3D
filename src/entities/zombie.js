/* ---------------------------------------------------------------------------
   Zumbi — corpo, marcha, olhos e fogo.

   Como o porco e o alce, A INTELIGÊNCIA NÃO MORA AQUI: para onde ele anda, quem
   ele ataca e quando a horda vira são decididos em `server/zombieSim.js`. Aqui
   chegam posição, ângulo e estado a 10 Hz, e é montado o resto.

   DUAS DECISÕES DE CONSTRUÇÃO, as duas por causa do número deles:

   1. O corpo nasce MESCLADO POR MATERIAL — poucos meshes, não dezenas. Na
      horda grande são dezenas de zumbis vivos ao mesmo tempo; meshes demais
      virariam centenas de draw calls só de bicho, mais o passe de sombra.

   2. Os OLHOS usam `MeshBasicMaterial`, que ignora a iluminação da cena.
      Não é economia — é o modo inteiro. À noite, fora do alcance das tochas, o
      corpo desaparece no breu e sobram dois pontos vermelhos vindo na sua
      direção. É assim que o jogador conta quantos vêm e de onde, muito antes de
      conseguir mirar em alguma coisa. Um material iluminado apagaria junto com o
      resto e a horda chegaria invisível.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { gameEvents, EventType, vec3Payload } from "../core/events.js";
import { entityRegistry } from "../core/entityRegistry.js";
import { NPC_COLLISION_GROUPS } from "../core/collisionGroups.js";
import { damp } from "../utils/math.js";

const H = 1.8; // m — altura do zumbi de pé

/* Vetores de módulo para o descarte dos olhos: `cullEyes` roda 21 vezes por
   quadro e não pode alocar. Ver o comentário do método. */
const _dir = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _antesPos = new THREE.Vector3();
/** cos(99°) — além deste ângulo em relação ao eixo da câmera, os olhos saem. */
const COS_EYE_CULL = Math.cos(Math.PI * 0.55);

/* Materiais de módulo: ao contrário do arqueiro, nenhum zumbi é tingido
   individualmente, então compartilhar é economia pura. */
const MAT = {
  // Carne podre esverdeada — tom frio, quase sem saturação, para ler como
  // cadáver e não como personagem de plástico.
  flesh: new THREE.MeshStandardMaterial({
    color: "#5a6348",
    roughness: 0.98,
    metalness: 0.02,
  }),
  // Feridas e vísceras escuras: contraste na silhueta sem material extra caro.
  wound: new THREE.MeshStandardMaterial({
    color: "#2a1814",
    roughness: 0.85,
    metalness: 0.05,
  }),
  // Farrapos encharcados, quase pretos.
  cloth: new THREE.MeshStandardMaterial({ color: "#1e221c", roughness: 1.0 }),
  // Osso exposto (costelas, articulação).
  bone: new THREE.MeshStandardMaterial({
    color: "#c4b89a",
    roughness: 0.7,
    metalness: 0.08,
  }),
  /* Os olhos. `MeshBasicMaterial` não recebe luz: eles brilham igual no escuro
     total e é isso que anuncia a horda. `fog: false` para a névoa da noite não
     apagá-los à distância — é justamente de longe que eles precisam ser vistos. */
  eye: new THREE.MeshBasicMaterial({
    color: CONFIG.modes.zombie.eyeColor,
    fog: false,
  }),
  fire: new THREE.MeshBasicMaterial({
    color: 0xff8a2a,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    fog: false,
  }),
};

/**
 * Rim light no mesh do chefão — o mesmo truque do arqueiro (`player.js`):
 * só as bordas onde a normal é perpendicular ao olhar. Sem aura, sem luz
 * extra: o corpo continua escuro, mas a silhueta se lê no breu.
 */
function withBossRimLight(material, forca) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rimStrength = { value: forca };
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `{
         vec3 rimV = normalize( vViewPosition );
         float rim = pow( 1.0 - abs( dot( normalize( normal ), rimV ) ), 3.0 );
         outgoingLight += vec3( 0.62, 0.74, 1.0 ) * rim * rimStrength;
       }
       #include <opaque_fragment>`,
    );
  };
  material.customProgramCacheKey = () => `boss-rim-${forca}`;
  return material;
}

/** Materiais do chefão — escuros, olhos âmbar, rim light de silhueta. */
const BOSS_RIM = CONFIG.modes.zombie.boss?.rimStrength ?? 0.34;
const BOSS_MAT = {
  flesh: withBossRimLight(
    new THREE.MeshStandardMaterial({
      color: "#1e2418",
      roughness: 0.99,
      metalness: 0.04,
    }),
    BOSS_RIM,
  ),
  wound: withBossRimLight(
    new THREE.MeshStandardMaterial({
      color: "#0a0606",
      roughness: 0.88,
      metalness: 0.06,
    }),
    BOSS_RIM * 0.85,
  ),
  cloth: withBossRimLight(
    new THREE.MeshStandardMaterial({ color: "#080a06", roughness: 1.0 }),
    BOSS_RIM * 0.9,
  ),
  bone: withBossRimLight(
    new THREE.MeshStandardMaterial({
      color: "#6a5a42",
      roughness: 0.72,
      metalness: 0.1,
    }),
    BOSS_RIM * 0.75,
  ),
  eye: new THREE.MeshBasicMaterial({
    color: CONFIG.modes.zombie.boss?.eyeColor ?? 0xffaa22,
    fog: false,
  }),
  fire: MAT.fire,
};

/* As geometrias são construídas UMA VEZ e reaproveitadas por todos os zumbis.
   Com 21 em campo, reconstruir seis geometrias por bicho a cada horda seria
   trabalho jogado fora — e um pico de GC bem no instante em que a horda entra. */
let SHARED = null;

function buildShared() {
  if (SHARED) return SHARED;

  // --- tronco assimétrico + ombros + quadril (não um tubo) ---------------
  // Peito largo e achatado, costas caído — silhueta de cadáver curvado.
  const peito = new THREE.BoxGeometry(0.42, 0.38, 0.26);
  peito.translate(0.02, 1.22, -0.02);

  const abdomen = new THREE.BoxGeometry(0.34, 0.28, 0.22);
  abdomen.translate(-0.01, 0.98, 0.01);

  const ombroL = new THREE.SphereGeometry(0.09, 7, 5);
  ombroL.scale(1.15, 0.85, 1.0);
  ombroL.translate(-0.24, 1.38, 0);

  const ombroR = new THREE.SphereGeometry(0.1, 7, 5);
  ombroR.scale(1.2, 0.9, 1.05);
  ombroR.translate(0.26, 1.36, -0.02);

  const quadril = new THREE.BoxGeometry(0.3, 0.16, 0.2);
  quadril.translate(0, 0.82, 0);

  // Corcova / coluna saliente: quebra a leitura de "cápsula".
  const coluna = new THREE.BoxGeometry(0.08, 0.42, 0.1);
  coluna.translate(0, 1.15, 0.11);

  const corpo = mergeGeometries([peito, abdomen, ombroL, ombroR, quadril, coluna]);

  // --- feridas: costelas expostas + rasgo no peito -----------------------
  const costelas = [];
  for (let i = 0; i < 4; i++) {
    const c = new THREE.BoxGeometry(0.02, 0.018, 0.14);
    c.translate(-0.06 + i * 0.04, 1.18 - i * 0.04, -0.12);
    costelas.push(c);
  }
  const rasgo = new THREE.BoxGeometry(0.14, 0.22, 0.04);
  rasgo.translate(0.06, 1.12, -0.13);
  const feridas = mergeGeometries([...costelas, rasgo]);

  // --- crânio descarnado + mandíbula caída ------------------------------
  const cranio = new THREE.SphereGeometry(0.125, 9, 7);
  cranio.scale(0.88, 1.12, 0.95);
  cranio.translate(0, 1.64, -0.02);

  const maxila = new THREE.BoxGeometry(0.1, 0.05, 0.08);
  maxila.translate(0, 1.54, -0.1);

  const mandibula = new THREE.BoxGeometry(0.1, 0.045, 0.09);
  mandibula.translate(0, 1.48, -0.12);

  const pescoco = new THREE.CylinderGeometry(0.045, 0.06, 0.12, 6);
  pescoco.translate(0, 1.48, 0.02);

  const cabeca = mergeGeometries([cranio, maxila, mandibula, pescoco]);

  // Dentes / osso da mandíbula — detalhe barato que lê de perto.
  const denteL = new THREE.BoxGeometry(0.018, 0.035, 0.018);
  denteL.translate(-0.03, 1.505, -0.15);
  const denteR = new THREE.BoxGeometry(0.018, 0.04, 0.018);
  denteR.translate(0.028, 1.5, -0.15);
  const osso = mergeGeometries([denteL, denteR]);

  // --- os dois olhos, numa peça só --------------------------------------
  const olhos = mergeGeometries(
    [-1, 1].map((lado) => {
      const g = new THREE.SphereGeometry(0.03, 6, 5);
      g.translate(lado * 0.048, 1.67, -0.1);
      return g;
    }),
  );

  // --- braço: ombro → cotovelo → antebraço → mão com garras -------------
  const bracoSup = new THREE.CapsuleGeometry(0.055, 0.22, 3, 6);
  bracoSup.rotateX(Math.PI / 2);
  bracoSup.translate(0, 0, -0.16);
  const cotovelo = new THREE.SphereGeometry(0.05, 6, 4);
  cotovelo.translate(0, -0.02, -0.34);
  const bracoInf = new THREE.CapsuleGeometry(0.045, 0.2, 3, 6);
  bracoInf.rotateX(Math.PI / 2 + 0.15);
  bracoInf.translate(0, -0.04, -0.5);
  const mao = new THREE.BoxGeometry(0.08, 0.045, 0.1);
  mao.translate(0, -0.05, -0.66);
  // Três garras — o detalhe que tira a leitura de "tubo com luva".
  const garras = [0, 1, 2].map((i) => {
    const g = new THREE.ConeGeometry(0.012, 0.07, 4);
    g.rotateX(Math.PI / 2);
    g.translate((i - 1) * 0.025, -0.06, -0.74);
    return g;
  });
  const braco = mergeGeometries([bracoSup, cotovelo, bracoInf, mao, ...garras]);

  // --- perna: coxa irregular + joelho + canela magra + pé ---------------
  const coxa = new THREE.CapsuleGeometry(0.07, 0.26, 3, 6);
  coxa.translate(0, -0.2, 0);
  const joelho = new THREE.SphereGeometry(0.055, 6, 4);
  joelho.translate(0, -0.4, 0.02);
  const canela = new THREE.CapsuleGeometry(0.048, 0.26, 3, 6);
  canela.translate(0, -0.58, 0);
  const pe = new THREE.BoxGeometry(0.09, 0.055, 0.2);
  pe.translate(0, -0.82, -0.05);
  const perna = mergeGeometries([coxa, joelho, canela, pe]);

  // --- a labareda -------------------------------------------------------
  const chama = new THREE.ConeGeometry(0.42, 1.5, 7, 1, true);
  chama.translate(0, 1.0, 0);

  SHARED = { corpo, feridas, cabeca, osso, olhos, braco, perna, chama };
  return SHARED;
}

/** Geometria do chefão — ombros largos, corcova, crânio assimétrico, braços longos. */
let BOSS_SHARED = null;

function buildBossShared() {
  if (BOSS_SHARED) return BOSS_SHARED;

  const peito = new THREE.BoxGeometry(0.56, 0.42, 0.3);
  peito.translate(0.03, 1.24, -0.04);

  const abdomen = new THREE.BoxGeometry(0.38, 0.3, 0.24);
  abdomen.translate(-0.02, 0.96, 0.02);

  const ombroL = new THREE.SphereGeometry(0.12, 7, 5);
  ombroL.scale(1.35, 0.95, 1.1);
  ombroL.translate(-0.34, 1.4, 0.02);

  const ombroR = new THREE.SphereGeometry(0.13, 7, 5);
  ombroR.scale(1.4, 1.0, 1.12);
  ombroR.translate(0.36, 1.38, -0.03);

  const quadril = new THREE.BoxGeometry(0.34, 0.18, 0.22);
  quadril.translate(0, 0.8, 0);

  const coluna = new THREE.BoxGeometry(0.12, 0.52, 0.14);
  coluna.translate(0.02, 1.12, 0.14);

  const corpo = mergeGeometries([peito, abdomen, ombroL, ombroR, quadril, coluna]);

  const costelas = [];
  for (let i = 0; i < 6; i++) {
    const c = new THREE.BoxGeometry(0.024, 0.022, 0.16);
    c.translate(-0.08 + i * 0.032, 1.16 - i * 0.035, -0.14);
    costelas.push(c);
  }
  const rasgo = new THREE.BoxGeometry(0.18, 0.28, 0.05);
  rasgo.translate(0.08, 1.1, -0.15);
  const feridas = mergeGeometries([...costelas, rasgo]);

  const cranio = new THREE.SphereGeometry(0.155, 9, 7);
  cranio.scale(1.08, 1.22, 0.92);
  cranio.translate(0.04, 1.72, -0.03);

  const maxila = new THREE.BoxGeometry(0.12, 0.06, 0.1);
  maxila.translate(0.02, 1.58, -0.12);

  const mandibula = new THREE.BoxGeometry(0.11, 0.05, 0.1);
  mandibula.translate(-0.02, 1.5, -0.14);

  const pescoco = new THREE.CylinderGeometry(0.055, 0.075, 0.14, 6);
  pescoco.translate(0, 1.5, 0.03);

  const cabeca = mergeGeometries([cranio, maxila, mandibula, pescoco]);

  const denteL = new THREE.BoxGeometry(0.022, 0.042, 0.02);
  denteL.translate(-0.035, 1.52, -0.17);
  const denteR = new THREE.BoxGeometry(0.022, 0.048, 0.02);
  denteR.translate(0.03, 1.515, -0.17);
  const osso = mergeGeometries([denteL, denteR]);

  // Olhos maiores na geometria (não via mesh.scale — scale na origem
  // empurraria os vértices para cima da cabeça).
  const olhos = mergeGeometries(
    [-1, 1].map((lado) => {
      const g = new THREE.SphereGeometry(0.068, 6, 5);
      g.translate(lado * 0.065, 1.76, -0.12);
      return g;
    }),
  );

  const bracoSup = new THREE.CapsuleGeometry(0.065, 0.28, 3, 6);
  bracoSup.rotateX(Math.PI / 2);
  bracoSup.translate(0, 0, -0.18);
  const cotovelo = new THREE.SphereGeometry(0.058, 6, 4);
  cotovelo.translate(0, -0.02, -0.42);
  const bracoInf = new THREE.CapsuleGeometry(0.052, 0.26, 3, 6);
  bracoInf.rotateX(Math.PI / 2 + 0.12);
  bracoInf.translate(0, -0.05, -0.62);
  const mao = new THREE.BoxGeometry(0.1, 0.05, 0.12);
  mao.translate(0, -0.06, -0.82);
  const garras = [0, 1, 2].map((i) => {
    const g = new THREE.ConeGeometry(0.015, 0.09, 4);
    g.rotateX(Math.PI / 2);
    g.translate((i - 1) * 0.03, -0.07, -0.92);
    return g;
  });
  const braco = mergeGeometries([bracoSup, cotovelo, bracoInf, mao, ...garras]);

  const coxa = new THREE.CapsuleGeometry(0.08, 0.28, 3, 6);
  coxa.translate(0, -0.2, 0);
  const joelho = new THREE.SphereGeometry(0.062, 6, 4);
  joelho.translate(0, -0.42, 0.02);
  const canela = new THREE.CapsuleGeometry(0.054, 0.28, 3, 6);
  canela.translate(0, -0.6, 0);
  const pe = new THREE.BoxGeometry(0.1, 0.06, 0.22);
  pe.translate(0, -0.84, -0.05);
  const perna = mergeGeometries([coxa, joelho, canela, pe]);

  const chama = new THREE.ConeGeometry(0.95, 3.2, 7, 1, true);
  chama.translate(0, 1.05, 0);

  BOSS_SHARED = { corpo, feridas, cabeca, osso, olhos, braco, perna, chama };
  return BOSS_SHARED;
}

export class Zombie {
  constructor(scene, physics, terrain, entityId, x, z, opts = {}) {
    this.scene = scene;
    this.physics = physics;
    this.terrain = terrain;
    this.entityId = entityId;
    this.isBoss = opts.isBoss === true;
    this.kind = this.isBoss ? "boss" : "zombie";
    this.bodyHeight = this.isBoss ? H * (CONFIG.modes.zombie.boss?.scale ?? 8.5) : H;
    /* Chefão: LOD bem mais largo — a silhueta precisa sobreviver a 100+ m. */
    this.lodScale = this.isBoss ? (CONFIG.modes.zombie.boss?.lodScale ?? 5) : 1;
    this.health = 1;
    this.netTarget = null;
    this.dead = false;
    this.state = "walk";
    /** Pegou fogo (morte por tiro na cabeça). */
    this.burning = false;
    this.burnTime = 0;
    /** Conta-gotas das brasas enquanto queima — ver `updateDeath`. */
    this.emberTimer = 0;
    this.deathRoll = 0;
    this.animPhase = Math.random() * Math.PI * 2;
    this.moanTimer = this._nextMoanDelay();
    this.laughTimer = this.isBoss ? this._nextLaughDelay() : Infinity;
    /** Brilho vermelho de impacto no mesh do chefão (s). */
    this._hitGlow = 0;

    const y = terrain.heightAt(x, z);
    this.position = new THREE.Vector3(x, y, z);
    this.yaw = 0;
    this.speed = 0;

    this.group = new THREE.Group();
    this.group.name = `zombie-${entityId}`;
    this.buildMesh();
    this.group.position.copy(this.position);
    scene.add(this.group);

    const Z = CONFIG.modes.zombie;
    const scBody = this.isBoss ? Z.boss?.scale ?? 8.5 : 1;
    const capH = this.bodyHeight / 2 - 0.28 * scBody;
    const capR = 0.28 * scBody;
    this.body = physics.createBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        x,
        y + this.bodyHeight / 2,
        z,
      ),
    );
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.capsule(capH, capR)
        .setCollisionGroups(NPC_COLLISION_GROUPS)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    physics.register(this.collider, { kind: "zombie", entityId, zombie: this });
    entityRegistry.register(entityId, this);
  }

  buildMesh() {
    const S = this.isBoss ? buildBossShared() : buildShared();
    const root = new THREE.Group();
    const mats = this.isBoss ? BOSS_MAT : MAT;
    const sc = this.isBoss ? (CONFIG.modes.zombie.boss?.scale ?? 8.5) : 1;

    this.lodDetail = null;
    this.lodBulk = [];

    this.corpo = new THREE.Mesh(S.corpo, mats.flesh);
    this.corpo.castShadow = true;
    root.add(this.corpo);
    this.lodBulk.push(this.corpo);

    this.feridas = new THREE.Mesh(S.feridas, mats.wound);
    this.feridas.castShadow = true;
    root.add(this.feridas);
    this.lodBulk.push(this.feridas);

    this.cabeca = new THREE.Mesh(S.cabeca, mats.flesh);
    this.cabeca.castShadow = true;
    root.add(this.cabeca);
    this.lodBulk.push(this.cabeca);

    this.osso = new THREE.Mesh(S.osso, mats.bone);
    root.add(this.osso);
    this.lodBulk.push(this.osso);

    this.olhos = new THREE.Mesh(S.olhos, mats.eye);
    // Nunca descartado pelo frustum: os olhos são pontos de 3 cm a 40 m de
    // distância, e o teste por caixa envolvente os elimina em ângulos rasantes
    // justamente quando eles são a única coisa visível do bicho.
    this.olhos.frustumCulled = false;
    this.olhos.renderOrder = 4;
    root.add(this.olhos);

    this.bracos = [];
    // Posições em espaço local do root — o `root.scale` já aplica o tamanho do
    // chefão. Multiplicar de novo por `sc` empurrava os braços para cima da
    // cabeça (pareciam chifres flutuando).
    const ombroX = this.isBoss ? 0.34 : 0.24;
    const ombroY = this.isBoss ? 1.38 : 1.36;
    for (const lado of [-1, 1]) {
      const b = new THREE.Group();
      b.position.set(lado * ombroX, ombroY, 0);
      const m = new THREE.Mesh(S.braco, mats.cloth);
      m.castShadow = true;
      b.add(m);
      // Braços esticados para a frente, um pouco abertos: a pose que se lê como
      // zumbi mesmo em silhueta contra o escuro.
      b.rotation.x = -1.35;
      b.rotation.z = lado * 0.18;
      root.add(b);
      this.bracos.push(b);
      this.lodBulk.push(b);
    }

    this.pernas = [];
    for (const lado of [-1, 1]) {
      const p = new THREE.Group();
      p.position.set(lado * 0.1, 0.88, 0);
      const m = new THREE.Mesh(S.perna, mats.cloth);
      m.castShadow = true;
      p.add(m);
      root.add(p);
      this.pernas.push(p);
      this.lodBulk.push(p);
    }

    this.chama = new THREE.Mesh(S.chama, mats.fire);
    this.chama.visible = false;
    this.chama.frustumCulled = false;
    this.chama.renderOrder = 6;
    root.add(this.chama);

    this.group.add(root);
    this.visualRoot = root;
    if (this.isBoss) {
      root.scale.set(sc, sc, sc);
      root.rotation.x = 0.28;
    }
  }

  _nextMoanDelay() {
    const Z = CONFIG.modes.zombie;
    if (this.isBoss) {
      const B = Z.boss ?? {};
      return (
        (B.moanMinInterval ?? 1.8) +
        Math.random() * ((B.moanMaxInterval ?? 3.5) - (B.moanMinInterval ?? 1.8))
      );
    }
    return Z.moanMinInterval + Math.random() * (Z.moanMaxInterval - Z.moanMinInterval);
  }

  _nextLaughDelay() {
    const B = CONFIG.modes.zombie.boss ?? {};
    return (
      (B.laughMinInterval ?? 18) +
      Math.random() * ((B.laughMaxInterval ?? 35) - (B.laughMinInterval ?? 18))
    );
  }

  setHealth(frac) {
    if (typeof frac === "number") this.health = Math.max(0, Math.min(1, frac));
  }

  /* -------------------------------------------------------------- impacto -- */

  /**
   * Uma flecha entrou. Só o AVISO sai daqui — quem conta os acertos e decide a
   * morte é o servidor, como no alce.
   */
  registerHit(impact, arrow, head) {
    if (this.dead) return;
    gameEvents.emit(EventType.ZOMBIE_HIT, {
      zombieId: this.entityId,
      head,
      boss: this.isBoss,
      impact: vec3Payload(impact),
      arrowId: arrow?.id,
      ownerId: arrow?.ownerEntityId ?? null,
      distance: arrow ? arrow.launchPosition.distanceTo(impact) : 0,
      speed: arrow?.launchSpeed ?? 0,
    });
  }

  /**
   * Brilho vermelho no corpo do chefão — dura o suficiente para ler o hit
   * de longe, mesmo quando o clarão emissivo do impacto já sumiu.
   */
  flashHit() {
    if (!this.isBoss) return;
    const F = CONFIG.modes.zombie.boss?.hitFlash ?? {};
    this._hitGlow = F.meshLife ?? 0.42;
    const color = F.meshEmissive ?? 0xff1808;
    const peak = F.meshIntensity ?? 3.2;
    for (const key of ["flesh", "wound", "cloth", "bone"]) {
      const mat = BOSS_MAT[key];
      if (!mat?.emissive) continue;
      mat.emissive.setHex(color);
      mat.emissiveIntensity = peak;
    }
  }

  /** Aplica / esvai o emissive compartilhado do chefão. */
  updateHitGlow(dt) {
    if (!this.isBoss || this._hitGlow <= 0) return;
    const F = CONFIG.modes.zombie.boss?.hitFlash ?? {};
    const life = F.meshLife ?? 0.42;
    this._hitGlow = Math.max(0, this._hitGlow - dt);
    const p = this._hitGlow / life;
    const peak = F.meshIntensity ?? 3.2;
    const color = F.meshEmissive ?? 0xff1808;
    const inten = peak * p * p;
    for (const key of ["flesh", "wound", "cloth", "bone"]) {
      const mat = BOSS_MAT[key];
      if (!mat?.emissive) continue;
      mat.emissive.setHex(color);
      mat.emissiveIntensity = inten;
    }
    if (this._hitGlow <= 0) this._clearHitGlow();
  }

  _clearHitGlow() {
    this._hitGlow = 0;
    for (const key of ["flesh", "wound", "cloth", "bone"]) {
      const mat = BOSS_MAT[key];
      if (!mat?.emissive) continue;
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0;
    }
  }

  /* -------------------------------------------------------------- em rede -- */

  setNetworkTarget(p, yaw, state, burning) {
    this.netTarget = { x: p[0], y: p[1], z: p[2], yaw, state, burning };
  }

  /**
   * Caiu.
   *
   * `head` decide COMO ele cai: no corpo, tomba e acabou; na cabeça, pega fogo
   * primeiro e só então desaba. A diferença é o retorno do tiro difícil — quem
   * acerta a cabeça vê algo que quem acerta o peito não vê.
   */
  killLocal(head = false) {
    if (this.dead) return;
    this.dead = true;
    this.state = "dead";
    this.speed = 0;
    this.collider?.setEnabled(false);
    if (head) {
      this.burning = true;
      this.burnTime = 0;
      this.emberTimer = 0;
      this.chama.visible = true;
      /* O estouro inicial das brasas. Sai do pool compartilhado
         (`systems/particles.js`), então vinte e uma mortes simultâneas na horda
         10 continuam custando os mesmos dois draw calls que uma só. */
      gameEvents.emit(EventType.PARTICLES, {
        position: { x: this.position.x, y: this.position.y + 1.4, z: this.position.z },
        count: 14,
        color: 0xff9a34,
        speed: 2.6,
        spread: 0.85,
        direction: { x: 0, y: 1, z: 0 },
        size: 0.1,
        grow: -0.5,
        life: 0.85,
        gravity: 1.4, // brasa SOBE: é o ar quente que a carrega
        drag: 1.6,
        additive: true,
      });
    }
    gameEvents.emit(EventType.AUDIO_PLAY, {
      sound: this.isBoss ? "bossDeath" : "zombieDeath",
      position: vec3Payload(this.position),
      volume: this.isBoss ? 1.35 : 1.0,
    });
  }

  /**
   * Desfaz kill otimista quando o servidor ainda manda o bicho vivo.
   * Sem isso o mesh fica morto no cliente enquanto a IA real continua andando.
   */
  reviveLocal() {
    if (!this.dead) return;
    this.dead = false;
    this.state = "walk";
    this.speed = 0;
    this.burning = false;
    this.burnTime = 0;
    this.deathRoll = 0;
    if (this.visualRoot) {
      this.visualRoot.rotation.x = this.isBoss ? 0.28 : 0.18;
      this.visualRoot.rotation.z = 0;
      this.visualRoot.position.y = 0;
    }
    if (this.chama) {
      this.chama.visible = false;
      this.chama.material.opacity = 0.92;
    }
    this.collider?.setEnabled(true);
    this.group.visible = true;
    this._lod = undefined;
  }

  dispose() {
    if (this.isBoss) this._clearHitGlow();
    this.physics.unregister(this.collider);
    this.physics.removeBody(this.body);
    entityRegistry.unregister(this.entityId);
    this.scene.remove(this.group);
    // As geometrias são COMPARTILHADAS entre todos os zumbis: descartá-las aqui
    // apagaria os outros da tela. Só o que é desta instância morre com ela.
    this.group.traverse((o) => {
      if (o.isMesh) o.geometry = null;
    });
  }

  /**
   * Descarte manual dos olhos (o frustum automático está desligado neles).
   *
   * `frustumCulled = false` resolve o problema de os olhos sumirem em ângulos
   * rasantes — a caixa envolvente de duas esferas de 3 cm é pequena demais para
   * o teste por caixa acertar — mas o preço é que eles são desenhados SEMPRE,
   * inclusive quando estão atrás da câmera. Com 21 zumbis em volta, metade da
   * horda está atrás de você a qualquer momento.
   *
   * O teste aqui é por ÂNGULO, não por caixa: se o bicho está a mais de ~99° do
   * eixo da câmera, ele está fora de qualquer campo de visão possível e os olhos
   * saem. A folga sobre o meio-FOV (58° ⇒ ~35° na vertical, mais a diagonal) é
   * larga de propósito — errar para o lado de desenhar demais custa uma chamada;
   * errar para o outro apaga o único traço visível da horda.
   */
  cullEyes(camera) {
    if (!camera) return;
    _dir.copy(this.position).sub(camera.position);
    const d = _dir.length();
    if (d < 1e-3) return;
    _dir.divideScalar(d);
    camera.getWorldDirection(_fwd);
    this.olhos.visible = _dir.dot(_fwd) > COS_EYE_CULL;
  }

  /** Liga/desliga sombra projetada — à noite o passe pesa com dezenas de corpos. */
  setCastShadow(on) {
    if (this._castShadow === on) return;
    this._castShadow = on;
    this.group.traverse((o) => {
      if (o.isMesh && o !== this.olhos && o !== this.chama) o.castShadow = on;
    });
  }

  update(dt, camera) {
    if (this.isBoss) this.updateHitGlow(dt);
    if (this.dead) {
      this.updateDeath(dt);
      this.cullEyes(camera);
      return;
    }

    const alvo = this.netTarget;
    if (alvo) {
      const k = 11;
      _antesPos.copy(this.position);
      this.position.x = damp(this.position.x, alvo.x, k, dt);
      this.position.y = damp(this.position.y, alvo.y, k, dt);
      this.position.z = damp(this.position.z, alvo.z, k, dt);
      let d = alvo.yaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * (1 - Math.exp(-k * dt));
      this.speed = _antesPos.distanceTo(this.position) / Math.max(dt, 1e-4);
      this.state = alvo.state;
    }

    this.animate(dt);
    this.updateMoan(dt);
    if (this.isBoss) this.updateLaugh(dt);
    this.cullEyes(camera);
    this.syncPhysics();
  }

  /** Fogo primeiro, tombo depois — e o fogo some junto com o corpo. */
  updateDeath(dt) {
    const Z = CONFIG.modes.zombie;
    if (this.burning) {
      this.burnTime += dt;
      const p = Math.min(1, this.burnTime / Z.burnTime);
      // A labareda sobe rápido, treme e apaga.
      const tremor = 0.85 + 0.3 * Math.sin(this.burnTime * 27);
      this.chama.scale.set(tremor, (0.6 + p * 0.9) * tremor, tremor);
      this.chama.material.opacity = 0.92 * (1 - p * p);
      this.chama.visible = p < 1;

      /* Brasas soltando enquanto queima, num gotejamento fixo de ~12 por
         segundo. Contar o tempo (e não emitir por quadro) é o que faz o efeito
         ficar igual a 60 e a 144 Hz — por quadro, quem tem monitor rápido veria
         o dobro de fogo. */
      this.emberTimer -= dt;
      if (this.emberTimer <= 0 && p < 0.9) {
        this.emberTimer = 1 / 12;
        gameEvents.emit(EventType.PARTICLES, {
          position: {
            x: this.position.x,
            y: this.position.y + 0.9 + Math.random() * 0.8,
            z: this.position.z,
          },
          count: 2,
          color: 0xffb347,
          speed: 1.1,
          spread: 0.6,
          direction: { x: 0, y: 1, z: 0 },
          size: 0.07,
          grow: -0.4,
          life: 0.7,
          gravity: 1.1,
          drag: 1.1,
          additive: true,
        });
      }
      // Enquanto queima ele ainda está de pé; o tombo começa na metade.
      if (p < 0.45) {
        this.group.position.copy(this.position);
        return;
      }
    }

    this.deathRoll = Math.min(Math.PI / 2, this.deathRoll + dt * 3.2);
    this.visualRoot.rotation.x = this.deathRoll;
    this.visualRoot.position.y = -0.22 * (this.deathRoll / (Math.PI / 2));
    this.group.position.copy(this.position);
  }

  /**
   * A marcha arrastada.
   *
   * Como no arqueiro e no porco, a fase avança com a DISTÂNCIA percorrida e não
   * com o relógio — mas aqui o efeito é o oposto do que costuma ser: como o
   * zumbi anda a 1,15 m/s, a cadência sai naturalmente lenta, sem nenhum
   * multiplicador. É a mesma regra produzindo o passo pesado.
   */
  animate(dt) {
    this.group.position.copy(this.position);
    // A malha (olhos, mandíbula, braços) foi construída de frente para -Z, e
    // não para +Z como o porco e o alce — sem o giro de 180°, o zumbi mostrava
    // a nuca para o rumo em que estava andando, e os olhos só apareciam para
    // quem desse a volta nele.
    this.group.rotation.y = this.yaw + Math.PI;

    const passada = 1.15; // m por ciclo completo
    this.animPhase += (Math.PI * 2 * this.speed * dt) / passada + dt * 0.55;

    const andando = this.speed > 0.15;
    const abertura = andando ? 0.42 : 0.06;
    const swing = Math.sin(this.animPhase) * abertura;
    this.pernas[0].rotation.x = swing;
    this.pernas[1].rotation.x = -swing;

    // O tronco pende e balança: o zumbi não tem tônus, ele se joga para a frente
    // e o corpo acompanha meio passo atrasado.
    const lean = this.isBoss ? 0.28 : 0.18;
    this.visualRoot.rotation.x = lean + Math.sin(this.animPhase * 2) * 0.04;
    this.visualRoot.rotation.z = Math.sin(this.animPhase) * 0.08;

    // Os braços oscilam pouco e fora de fase com as pernas.
    const bracoSwing = Math.sin(this.animPhase + 0.9) * (andando ? 0.16 : 0.04);
    this.bracos[0].rotation.x = -1.35 + bracoSwing;
    this.bracos[1].rotation.x = -1.35 - bracoSwing;

    // Atacando, os braços sobem e fecham.
    if (this.state === "attack") {
      this.bracos[0].rotation.x = -1.9 + Math.sin(this.animPhase * 6) * 0.25;
      this.bracos[1].rotation.x = -1.9 - Math.sin(this.animPhase * 6) * 0.25;
    }
  }

  /** Gemido (ou risada rara no chefão). */
  updateMoan(dt) {
    this.moanTimer -= dt;
    if (this.moanTimer > 0) return;
    this.moanTimer = this._nextMoanDelay();
    const B = CONFIG.modes.zombie.boss ?? {};
    gameEvents.emit(EventType.AUDIO_PLAY, {
      sound: this.isBoss ? "bossMoan" : "zombieMoan",
      position: vec3Payload(this.position),
      volume: this.isBoss ? (B.moanVolume ?? 1.45) : CONFIG.modes.zombie.moanVolume,
    });
  }

  updateLaugh(dt) {
    this.laughTimer -= dt;
    if (this.laughTimer > 0) return;
    this.laughTimer = this._nextLaughDelay();
    const B = CONFIG.modes.zombie.boss ?? {};
    gameEvents.emit(EventType.AUDIO_PLAY, {
      sound: "bossLaugh",
      position: vec3Payload(this.position),
      volume: B.laughVolume ?? 1.25,
    });
  }

  syncPhysics() {
    this.body.setTranslation(
      {
        x: this.position.x,
        y: this.position.y + this.bodyHeight / 2,
        z: this.position.z,
      },
      true,
    );
  }
}
