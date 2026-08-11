/* ---------------------------------------------------------------------------
   O rover da base lunar — e o único veículo do jogo.

   Ele PATRULHA um circuito de pontos em volta da base (não uma reta para
   longe: os pontos ficam sempre a uma distância curta do centro, então o
   passeio sempre volta a passar perto do foguete), desviando sozinho do que
   encontra pela frente com três sondas de raio — a mesma ideia do "bigode" que
   os lobos já usam em `entities/wolf.js`, só que mais simples porque aqui
   ninguém está caçando ninguém.

   Se o jogador estiver EM CIMA quando ele anda, é carregado junto: a cada
   quadro, a posição dele é reprojetada do referencial do rover no instante
   anterior para o referencial do rover agora (translação + guinada). É o
   mesmo truque de sempre para plataforma móvel, e existe porque o character
   controller do Rapier não empresta velocidade de colisor cinemático a quem
   está em pé sobre ele — sem isto, o rover andaria por baixo dos pés de quem
   está parado nele.

   Trombar com um alien MATA o alien — ver `killAliensNear` em `spaceLife.js`,
   chamado por `levels/moonLevel.js` depois de mover os dois.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { entityRegistry } from "../core/entityRegistry.js";

const TAU = Math.PI * 2;

/** Pontos do circuito, relativos ao centro da base — não um círculo perfeito:
 *  passa perto dos hábitats, da antena, do módulo lunar e da fazenda solar,
 *  então o passeio lê como "rondando a base" e não como "orbitando um poste". */
const WAYPOINTS = [
  { dx: -10, dz: -22 },
  { dx: -44, dz: 4 },
  { dx: -58, dz: 42 },
  { dx: -30, dz: 46 },
  { dx: -10, dz: 26 },
  { dx: 20, dz: 48 },
  { dx: 46, dz: 34 },
  { dx: 44, dz: -2 },
  { dx: 32, dz: -34 },
  { dx: 0, dz: -44 },
];

/** m — alcance das sondas de esquiva. */
const SONDA_ALCANCE = 8;
/** rad — abertura das sondas laterais em relação à frente. */
const SONDA_ANGULO = 0.7;

/** Gira (x,z) por `ang` radianos em torno da origem. */
function girar(x, z, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return [x * c - z * s, x * s + z * c];
}

export class Rover {
  /**
   * @param {THREE.Object3D} parent onde o visual pendura — some com a fase
   * @param {import("../core/physics.js").PhysicsWorld} physics
   * @param {import("../shared/moonField.js").MoonField} terrain
   * @param {number} baseX centro da base (o circuito é relativo a ele)
   * @param {number} baseZ
   */
  constructor(parent, physics, terrain, baseX, baseZ) {
    this.physics = physics;
    this.terrain = terrain;

    /* -------------------------------------------------------- visual --- */
    /* Fora do lote fundido da base: ele PRECISA se mover, e uma geometria
       fundida com o resto do cenário não move uma peça só. O custo é umas
       poucas chamadas de desenho a mais — um veículo só, então é barato. */
    this.group = new THREE.Group();
    this.group.name = "rover";

    const casco = new THREE.MeshStandardMaterial({ color: "#d9d9d3", roughness: 0.62, metalness: 0.12 });
    const escuro = new THREE.MeshStandardMaterial({ color: "#22262b", roughness: 0.6, metalness: 0.5 });
    const painel = new THREE.MeshStandardMaterial({ color: "#1b2a4d", roughness: 0.25, metalness: 0.55 });

    /* Chassi comprido no eixo LOCAL +Z — é essa escolha que faz o resto da
       classe funcionar sem nenhuma conversão: sob `rotation.y = yaw`, o eixo
       local +Z aponta para (sin(yaw), cos(yaw)) no mundo, que é EXATAMENTE a
       direção de deslocamento usada em `update()`. Virar o chassi e mexer no
       movimento são a mesma variável. */
    this.centerY = 1.0; // m — altura do centro do chassi sobre o chão
    this.halfH = 0.35;
    this.halfW = 0.95; // m — meia-largura (eixo X)
    this.halfL = 1.7; // m — meio-comprimento (eixo Z, frente-trás)

    const corpo = new THREE.Mesh(
      new THREE.BoxGeometry(this.halfW * 2, this.halfH * 2, this.halfL * 2),
      casco,
    );
    corpo.position.y = this.centerY;
    this.group.add(corpo);

    const cabine = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 1.4), escuro);
    cabine.position.set(0, this.centerY + 0.7, -1.0); // rumo à traseira
    this.group.add(cabine);

    const paraBrisa = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 1.1), painel);
    paraBrisa.position.set(0, this.centerY + 0.45, 0.75);
    paraBrisa.rotation.x = -0.28;
    this.group.add(paraBrisa);

    const antena = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 5), escuro);
    antena.position.set(0.5, this.centerY + 1.0, -1.3);
    this.group.add(antena);

    this.wheels = [];
    for (const sx of [-this.halfW - 0.05, this.halfW + 0.05]) {
      for (const sz of [-this.halfL + 0.5, this.halfL - 0.5]) {
        const roda = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.32, 12), escuro);
        roda.position.set(sx, 0.5, sz);
        roda.rotation.z = Math.PI / 2;
        this.group.add(roda);
        this.wheels.push(roda);
      }
    }

    for (const o of this.group.children) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
    parent.add(this.group);

    /* --------------------------------------------------------- física --- */
    this.x = baseX + WAYPOINTS[0].dx;
    this.z = baseZ + WAYPOINTS[0].dz;
    this.yaw = 0;
    this.prevX = this.x;
    this.prevZ = this.z;
    this.prevYaw = this.yaw;
    this.y = terrain.heightAt(this.x, this.z);

    this.entityId = `rover${entityRegistry.createId()}`;
    this.body = physics.createBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        this.x,
        this.y + this.centerY,
        this.z,
      ),
    );
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.cuboid(this.halfW, this.halfH, this.halfL)
        .setFriction(0.9)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    physics.register(this.collider, { kind: "scenery", name: "rover" });

    /* -------------------------------------------------------- patrulha --- */
    this.waypoints = WAYPOINTS.map((w) => ({ x: baseX + w.dx, z: baseZ + w.dz }));
    this.wpIndex = 0;
    this.speed = 3.6; // m/s — entre o passo e a corrida na Lua
    this.turnRate = 1.0; // rad/s

    /** m — contato com um alien dentro deste raio o mata (ver moonLevel.js). */
    this.contactRadius = Math.hypot(this.halfW, this.halfL) + 0.6;
    /** m — meio-extensão do convés útil para EMBARCAR (um pouco menor que o
     *  colisor: exige estar bem em cima, não só raspando a borda). */
    this.deckHalfW = this.halfW - 0.1;
    this.deckHalfL = this.halfL - 0.15;

    this._ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  }

  /** toi da primeira colisão à frente, no ângulo `desvio` (rad) a partir do rumo atual. */
  sondar(desvio) {
    const ang = this.yaw + desvio;
    this._ray.origin.x = this.x;
    this._ray.origin.y = this.y + this.centerY;
    this._ray.origin.z = this.z;
    this._ray.dir.x = Math.sin(ang);
    this._ray.dir.y = 0;
    this._ray.dir.z = Math.cos(ang);
    const hit = this.physics.world.castRay(
      this._ray,
      SONDA_ALCANCE,
      true,
      undefined,
      undefined,
      this.collider,
    );
    return hit ? hit.timeOfImpact : Infinity;
  }

  update(dt) {
    this.prevX = this.x;
    this.prevZ = this.z;
    this.prevYaw = this.yaw;

    const alvo = this.waypoints[this.wpIndex];
    const dx = alvo.x - this.x;
    const dz = alvo.z - this.z;
    if (Math.hypot(dx, dz) < 4.5) {
      this.wpIndex = (this.wpIndex + 1) % this.waypoints.length;
    }

    let rumo = Math.atan2(dx, dz);

    /* A ESQUIVA. Três sondas — frente, um pouco à esquerda, um pouco à
       direita — bastam para um veículo que já anda por um circuito largo: ele
       não precisa NAVEGAR, só desviar do que a rota manda encontrar de
       surpresa (uma caixa de carga sorteada, um contêiner). Bloqueado na
       frente, ele vira para o lado mais livre em vez de insistir. */
    if (this.sondar(0) < SONDA_ALCANCE) {
      const esq = this.sondar(-SONDA_ANGULO);
      const dir = this.sondar(SONDA_ANGULO);
      rumo = this.yaw + (esq > dir ? -SONDA_ANGULO * 1.3 : SONDA_ANGULO * 1.3);
    }

    let dYaw = rumo - this.yaw;
    while (dYaw > Math.PI) dYaw -= TAU;
    while (dYaw < -Math.PI) dYaw += TAU;
    const giroMax = this.turnRate * dt;
    this.yaw += Math.max(-giroMax, Math.min(giroMax, dYaw));

    const passo = this.speed * dt;
    const nx = this.x + Math.sin(this.yaw) * passo;
    const nz = this.z + Math.cos(this.yaw) * passo;
    if (this.terrain.isWalkable(nx, nz)) {
      this.x = nx;
      this.z = nz;
    }
    this.y = this.terrain.heightAt(this.x, this.z);

    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.yaw;

    // As rodas giram com a velocidade real — sem isto o rover desliza.
    const giroRoda = passo / 0.5;
    for (const roda of this.wheels) roda.rotation.y += giroRoda;

    this.body.setNextKinematicTranslation({ x: this.x, y: this.y + this.centerY, z: this.z });
    this.body.setNextKinematicRotation({ x: 0, y: Math.sin(this.yaw / 2), z: 0, w: Math.cos(this.yaw / 2) });
  }

  /** Altura do convés (mundo) — onde os pés de quem está em cima devem ficar. */
  get deckY() {
    return this.y + this.centerY + this.halfH;
  }

  /** O ponto `pos` (pés) está sobre o convés, parado ou prestes a ser carregado? */
  isOnDeck(pos) {
    const [lx, lz] = girar(pos.x - this.x, pos.z - this.z, -this.yaw);
    if (Math.abs(lx) > this.deckHalfW || Math.abs(lz) > this.deckHalfL) return false;
    return Math.abs(pos.y - this.deckY) < 0.4;
  }

  /**
   * Carrega `pos` (mutado in-place) pelo tanto que o rover andou e girou
   * desde o quadro anterior — reprojeta do referencial de ONTEM para o de
   * AGORA. É isto que faz quem está em pé nele se mover junto, inclusive nas
   * curvas.
   */
  carry(pos) {
    const [lx, lz] = girar(pos.x - this.prevX, pos.z - this.prevZ, -this.prevYaw);
    const [wx, wz] = girar(lx, lz, this.yaw);
    pos.x = this.x + wx;
    pos.z = this.z + wz;
    pos.y = this.deckY;
  }
}
