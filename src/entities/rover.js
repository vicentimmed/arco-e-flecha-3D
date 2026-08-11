/* ---------------------------------------------------------------------------
   O rover da base lunar — e o único veículo do jogo.

   ELE NÃO DECIDE MAIS PARA ONDE IR. A ronda, a esquiva e o atropelamento são
   da SALA (`server/spaceSim.js`), porque o rover carrega gente: se cada tela o
   pusesse num lugar, o passageiro flutuaria no ar para os outros. O que sobrou
   aqui é o corpo, o colisor em que se sobe e a perseguição da pose recebida.

   Se o jogador estiver EM CIMA quando ele anda, é carregado junto: a cada
   quadro, a posição dele é reprojetada do referencial do rover no instante
   anterior para o referencial do rover agora (translação + guinada). É o
   mesmo truque de sempre para plataforma móvel, e existe porque o character
   controller do Rapier não empresta velocidade de colisor cinemático a quem
   está em pé sobre ele — sem isto, o rover andaria por baixo dos pés de quem
   está parado nele.

   Trombar com um alien MATA o alien — e isso também é decidido no servidor,
   para valer nas duas telas ao mesmo tempo.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { entityRegistry } from "../core/entityRegistry.js";
import { Plataforma } from "./rideable.js";

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

    /* O eixo do cilindro é deitado NA GEOMETRIA, não na malha.
     *
     * Deitar pela malha (`rotation.z = π/2`) e girar por `rotation.y` faz a roda
     * rodar em torno da VERTICAL — a moeda girando na mesa. É consequência da
     * ordem de Euler padrão do Three (`XYZ` ⇒ `R = Rx·Ry·Rz`): o `Rz` entra
     * primeiro e o `Ry` depois, já no espaço do pai.
     *
     * Com o eixo deitado na geometria, o eixo da roda passa a ser o X local e
     * girar é `rotation.x`: o pneu roda para a frente, que é o que se espera de
     * um veículo andando. */
    this.roverWheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.32, 12).rotateZ(
      Math.PI / 2,
    );
    this.wheels = [];
    for (const sx of [-this.halfW - 0.05, this.halfW + 0.05]) {
      for (const sz of [-this.halfL + 0.5, this.halfL - 0.5]) {
        const roda = new THREE.Mesh(this.roverWheelGeo, escuro);
        roda.position.set(sx, 0.5, sz);
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
    this.y = terrain.heightAt(this.x, this.z);
    /** A conta de carregar passageiro — ver `entities/rideable.js`. */
    this.plat = new Plataforma();
    this.plat.marcarPose(this.x, this.z, this.yaw);

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

    /* ---------------------------------------------------------- pose --- */
    /* A pose vem da rede. `primeiraPose` faz o primeiro pacote ser COPIADO em
       vez de perseguido: sem isso o rover nasceria no waypoint zero e deslizaria
       até a posição real na frente de quem está olhando. */
    this.alvoX = null;
    this.alvoY = null;
    this.alvoZ = null;
    this.alvoYaw = 0;
    this.primeiraPose = true;

    /** m — contato com um alien dentro deste raio o mata (ver moonLevel.js). */
    this.contactRadius = Math.hypot(this.halfW, this.halfL) + 0.6;
    /** m — meio-extensão do convés útil para EMBARCAR (um pouco menor que o
     *  colisor: exige estar bem em cima, não só raspando a borda). */
    this.deckHalfW = this.halfW - 0.1;
    this.deckHalfL = this.halfL - 0.15;

    this._ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  }

  /** A pose que a sala mandou. Quem decide a rota é `server/spaceSim.js`. */
  setNetworkTarget(x, y, z, yaw) {
    this.alvoX = x;
    this.alvoY = y;
    this.alvoZ = z;
    this.alvoYaw = yaw;
    if (this.primeiraPose) {
      this.primeiraPose = false;
      this.x = x;
      this.y = y;
      this.z = z;
      this.yaw = yaw;
    }
  }

  /**
   * Desenha o rover na pose que a sala mandou.
   *
   * Ele NÃO decide mais para onde ir — a ronda, a esquiva e o atropelamento
   * são do servidor. Aqui só se persegue a pose recebida com amortecimento (a
   * amostra chega a 10 Hz; sem isso cada uma seria um salto visível) e se gira
   * a roda pela distância REALMENTE percorrida, que é o que impede o pneu de
   * patinar.
   *
   * A pose é perseguida e não copiada por um segundo motivo, mais importante:
   * o passageiro é carregado por ESTA posição. Se ela saltasse, ele saltaria
   * junto.
   */
  update(dt) {
    if (this.alvoX == null) return;
    // O "ontem" da reprojeção do passageiro, antes de qualquer movimento.
    this.plat.marcarPose(this.x, this.z, this.yaw);

    const k = 1 - Math.exp(-12 * dt);
    const antesX = this.x;
    const antesZ = this.z;
    this.x += (this.alvoX - this.x) * k;
    this.y += (this.alvoY - this.y) * k;
    this.z += (this.alvoZ - this.z) * k;
    let d = this.alvoYaw - this.yaw;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    this.yaw += d * k;

    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.yaw;

    // As rodas giram com a distância real — sem isto o rover desliza.
    const andou = Math.hypot(this.x - antesX, this.z - antesZ);
    for (const roda of this.wheels) roda.rotation.x += andou / 0.5;

    this.body.setNextKinematicTranslation({ x: this.x, y: this.y + this.centerY, z: this.z });
    this.body.setNextKinematicRotation({
      x: 0, y: Math.sin(this.yaw / 2), z: 0, w: Math.cos(this.yaw / 2),
    });
  }

  /** Altura do convés (mundo) — onde os pés de quem está em cima devem ficar. */
  get deckY() {
    return this.y + this.centerY + this.halfH;
  }

  /** O ponto `pos` (pés) está sobre o convés? O rover tem frente: convés caixa. */
  isOnDeck(pos) {
    return this.plat.pisandoEmCaixa(
      pos,
      this.x,
      this.z,
      this.yaw,
      this.deckY,
      this.deckHalfW,
      this.deckHalfL,
    );
  }

  /** Leva quem está em cima junto — inclusive nas curvas. Ver `rideable.js`. */
  carry(pos) {
    this.plat.carregar(pos, this.x, this.z, this.yaw, this.deckY);
  }
}
