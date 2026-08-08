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
      entityId,
      character: player,
      isLocal: true,
    });

    this.verticalVelocity = 0;
    this.grounded = true;
    this.jumpQueued = false;
    this.desiredHorizontal = new THREE.Vector3();
    this._corrected = new THREE.Vector3();
  }

  queueJump() {
    if (this.grounded) this.jumpQueued = true;
  }

  /** Velocidade horizontal desejada (m/s), consumida em cada passo fixo. */
  setHorizontalMove(vx, vz) {
    this.desiredHorizontal.set(vx, 0, vz);
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

    if (!this.grounded) {
      this.verticalVelocity += CONFIG.physics.gravity * h;
    }

    const t = this.body.translation();
    const desired = {
      x: this.desiredHorizontal.x * h,
      y: this.grounded ? 0 : this.verticalVelocity * h,
      z: this.desiredHorizontal.z * h,
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

    if (!terrain.isWalkable(nx, nz)) {
      nx = t.x;
      nz = t.z;
      ny = t.y;
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
