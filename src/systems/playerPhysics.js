/* ---------------------------------------------------------------------------
   Física do jogador: character controller Rapier + pulo vertical.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";

export class PlayerPhysics {
  constructor(physics, player, entityId) {
    this.physics = physics;
    this.player = player;
    this.entityId = entityId;

    this.desiredHorizontal = new THREE.Vector3();
    this._corrected = new THREE.Vector3();
    /** Velocidade horizontal REAL durante o voo de jetpack. Ver `step`. */
    this.jetVelocity = new THREE.Vector3();
    /** @type {import("./jetpack.js").Jetpack|null} só nas fases que têm um. */
    this.jetpack = null;

    this.build();
  }

  /**
   * Liga ou desliga o jetpack desta fase.
   *
   * O jogador é o mesmo entre as fases; o equipamento não. Passar `null`
   * devolve o comportamento de sempre — e é o que o vale recebe, sem nenhum
   * `if (lua)` no caminho do movimento.
   */
  setJetpack(jetpack) {
    this.jetpack = jetpack;
    this.jetVelocity.set(0, 0, 0);
  }

  /**
   * O toque no espaço. Uma tecla, dois significados, decididos aqui.
   *
   * No chão é salto. No ar, com jetpack e combustível, é ignição — e o toque é
   * CONSUMIDO pela ignição, senão o mesmo evento tentaria pular e acender.
   */
  onJumpPressed() {
    if (this.jetpack?.onJumpPressed(this.grounded)) return;
    this.queueJump();
  }

  onJumpReleased() {
    this.jetpack?.onJumpReleased();
  }

  /**
   * Cria o controlador, o corpo e a cápsula no mundo de física ATUAL.
   *
   * Separado do construtor porque a troca de fase joga fora o `RAPIER.World`
   * inteiro (ver `PhysicsWorld.recreate`), e com ele vão o controlador de
   * personagem e a cápsula do jogador. O que sobrevive é este objeto e as
   * referências a ele espalhadas pelo jogo — daí a reconstrução ser um método
   * e não um `new`.
   *
   * Lê `player.terrain`, então quem troca a fase precisa apontar o jogador
   * para o terreno novo ANTES de chamar isto: a altura dos pés sai daí.
   */
  build() {
    const { physics, player } = this;
    const radius = CONFIG.player.colliderRadius;
    const halfHeight = Math.max(0.1, (CONFIG.player.height - 2 * radius) / 2);

    this.controller = physics.world.createCharacterController(0.05);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.controller.enableSnapToGround(0.35);
    // O cenário é explorável por inteiro; inclinação não deve virar uma
    // parede invisível antes das árvores. Os obstáculos reais continuam sendo
    // resolvidos pelos colisores de troncos, rochas e cercas.
    this.controller.setMaxSlopeClimbAngle(Math.PI * 0.495);

    const feetY = player.terrain.heightAt(player.position.x, player.position.z);
    player.position.y = feetY;
    const centerY = feetY + CONFIG.player.height / 2;

    this.body = physics.createBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        player.position.x,
        centerY,
        player.position.z,
      ),
    );

    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius)
        .setFriction(0.8)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );

    physics.register(this.collider, {
      kind: "character",
      entityId: this.entityId,
      character: player,
      isLocal: true,
    });

    this.verticalVelocity = 0;
    this.grounded = true;
    this.jumpQueued = false;
    this.desiredHorizontal.set(0, 0, 0);
    return this;
  }

  /**
   * Refaz a cápsula depois de uma troca de fase.
   *
   * Não há nada a destruir: o mundo antigo inteiro já foi liberado, e tentar
   * remover o corpo velho seria mexer num ponteiro morto.
   */
  rebuild() {
    return this.build();
  }

  queueJump() {
    if (this.grounded) this.jumpQueued = true;
  }

  /** Velocidade horizontal desejada (m/s), consumida em cada passo fixo. */
  setHorizontalMove(vx, vz) {
    this.desiredHorizontal.set(vx, 0, vz);
    /* O jetpack não quer a velocidade, quer a DIREÇÃO: no ar o WASD empurra,
       não desloca. Normalizar aqui é o que faz o empuxo lateral ser o mesmo
       andando ou correndo — no ar não existe "correr". */
    const j = this.jetpack;
    if (j) {
      const m = Math.hypot(vx, vz);
      if (m > 1e-4) j.moveDir.set(vx / m, 0, vz / m);
      else j.moveDir.set(0, 0, 0);
    }
  }

  /** Integra movimento no passo fixo — chamar antes de world.step(). */
  step(h) {
    const p = this.player;
    const terrain = p.terrain;

    if (this.jumpQueued && this.grounded) {
      this.verticalVelocity = CONFIG.player.jumpSpeed;
      this.grounded = false;
      this.jumpQueued = false;
      p.airborne = true;
    }

    const jato = this.jetpack?.step(h, this) ?? false;

    if (!this.grounded) {
      this.verticalVelocity += CONFIG.physics.gravity * h;
      if (jato) this.verticalVelocity += this.jetpack.thrust * h;
    }

    const t = this.body.translation();

    /* Duas formas de andar, e a segunda só existe com jetpack aceso.
     *
     * No chão (e no ar sem jato) o movimento horizontal é uma VELOCIDADE
     * DESEJADA: solta o W e para. É o certo para andar — pernas não têm
     * inércia perceptível.
     *
     * Com o jato aceso, WASD vira ACELERAÇÃO sobre a velocidade que já existe.
     * A diferença não é sutil: com velocidade desejada, um jetpack para no ar
     * assim que a tecla é solta, e voar fica com a inércia de um cursor de
     * mouse. Com aceleração, o corpo continua na direção em que estava indo e a
     * correção custa tempo — que é o que torna pousar no topo de um foguete uma
     * manobra em vez de um clique. */
    const horizontal = jato ? this.jetVelocity : this.desiredHorizontal;

    const desired = {
      x: horizontal.x * h,
      y: this.grounded ? 0 : this.verticalVelocity * h,
      z: horizontal.z * h,
    };

    this.controller.computeColliderMovement(this.collider, desired);
    const m = this.controller.computedMovement();
    this._corrected.set(m.x, m.y, m.z);

    let nx = t.x + this._corrected.x;
    let nz = t.z + this._corrected.z;
    let ny = t.y + this._corrected.y;

    const feetGround =
      terrain.heightAt(nx, nz) + CONFIG.player.height / 2;

    /* Existem DUAS formas de estar no chão, e antes só uma contava.
     *
     * A primeira é o terreno, que é uma função analítica de altura. A segunda é
     * qualquer COLISOR sob os pés — pedra, tronco caído, cerca —, e quem
     * responde por ela é o próprio controlador de personagem, que acabou de
     * resolver o movimento contra a cena inteira.
     *
     * Sem a segunda, quem pulava em cima de uma pedra ficava para sempre na
     * pose de salto: o corpo parava sobre a rocha, mas continuava "no ar" para
     * o resto do jogo, com as pernas encolhidas.
     *
     * Só aterrissa descendo: o primeiro avanço do pulo (~7 cm) cai dentro da
     * tolerância e seria cancelado na hora.
     */
    const descendo = this.verticalVelocity <= 0;
    const sobreTerreno = descendo && ny <= feetGround + 0.08;
    const sobreColisor = descendo && this.controller.computedGrounded();

    if (sobreTerreno) {
      ny = feetGround;
      this.verticalVelocity = 0;
      this.grounded = true;
      p.airborne = false;
    } else if (sobreColisor) {
      // Em cima de um obstáculo: o controlador já parou a queda na altura
      // certa; aqui só registramos que há chão embaixo.
      this.verticalVelocity = 0;
      this.grounded = true;
      p.airborne = false;
    } else {
      this.grounded = false;
      p.airborne = true;
    }

    /* A BARREIRA. Aqui ela é só isto: um ponto onde `isWalkable` diz não.
     *
     * Só o horizontal é revertido. Congelar `y` junto — que era o que acontecia
     * — prendia no ar quem chegasse à barreira voando de jetpack: a pessoa
     * ficava suspensa contra uma parede invisível em vez de escorregar por ela
     * e continuar caindo. */
    if (!terrain.isWalkable(nx, nz)) {
      nx = t.x;
      nz = t.z;
      this.jetVelocity.set(0, 0, 0);
      if (this.grounded) {
        ny = terrain.heightAt(nx, nz) + CONFIG.player.height / 2;
      }
    }

    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });

    p.position.x = nx;
    p.position.z = nz;
    // `position` é a posição dos PÉS. Durante o pulo ela precisa acompanhar
    // o centro do colisor; colá-la sempre no heightAt escondia todo o salto.
    p.position.y = ny - CONFIG.player.height / 2;

  }

  getHitBody() {
    return this.body;
  }

  syncFromPlayer() {
    const p = this.player;
    const y = p.position.y + CONFIG.player.height / 2;
    this.body.setTranslation({ x: p.position.x, y, z: p.position.z }, true);
  }

  /**
   * Teleporta e deixa no ar — o caminho de nascer.
   *
   * A queda de 10 m não ganha física própria: é este mesmo controlador, só com
   * a altura inicial trocada. Por isso ela já acerta o relevo, escorrega em
   * encosta e para no chão sem uma linha nova.
   */
  teleport(x, y, z) {
    this.player.position.set(x, y, z);
    this.body.setTranslation(
      { x, y: y + CONFIG.player.height / 2, z },
      true,
    );
    this.verticalVelocity = 0;
    this.grounded = false;
    this.player.airborne = true;
    this.desiredHorizontal.set(0, 0, 0);
  }
}
