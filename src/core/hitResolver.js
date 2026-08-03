/* ---------------------------------------------------------------------------
   Resolve impactos flecha × mundo. Centraliza lógica local e futura rede.
   --------------------------------------------------------------------------- */

import { RAPIER } from "./physics.js";
import { CONFIG } from "../config.js";
import { gameEvents, EventType, vec3Payload } from "./events.js";

const _impulse = { x: 0, y: 0, z: 0 };

/**
 * @param {object} ctx
 * @param {import("../entities/arrow.js").Arrow} ctx.arrow
 * @param {object|null} ctx.other — owner do colisor atingido
 * @param {THREE.Vector3} ctx.impact
 * @param {{x:number,y:number,z:number}|null} ctx.normal
 * @param {object} ctx.deps — callbacks e managers
 */
export function resolveArrowHit(ctx) {
  const { arrow, other, impact, normal, deps } = ctx;
  if (!other) {
    return resolveSceneryHit(ctx);
  }

  if (other.kind === "character") {
    return resolveCharacterHit(ctx);
  }
  if (other.kind === "target") {
    return resolveTargetHit(ctx);
  }
  if (other.kind === "boar") {
    return resolveBoarHit(ctx);
  }
  return resolveSceneryHit(ctx);
}

function resolveCharacterHit({ arrow, other, impact, normal, deps }) {
  const character = other.character;
  if (!character) return null;

  if (
    CONFIG.arrow.ignoreOwner &&
    arrow.ownerEntityId != null &&
    character.entityId === arrow.ownerEntityId
  ) {
    return null;
  }

  character.onArrowHit?.(impact, arrow);

  const body = character.getHitBody?.();
  const isKinematic =
    body?.bodyType?.() === RAPIER.RigidBodyType.KinematicPositionBased;
  const isDynamic =
    body?.bodyType?.() === RAPIER.RigidBodyType.Dynamic || isKinematic;

  gameEvents.emit(EventType.CHARACTER_HIT, {
    characterId: character.entityId,
    arrowId: arrow.id,
    ownerId: arrow.ownerEntityId,
    impact: vec3Payload(impact),
  });
  emitImpact(arrow, "character", character.entityId, impact, normal);

  deps.spawnPuff?.(impact, null);
  arrow.stick(body, isDynamic);
  deps.retireArrow?.(arrow);
  return { kind: "character", entityId: character.entityId };
}

function resolveTargetHit({ arrow, other, impact, deps }) {
  const target = other.target;
  if (!target) return resolveSceneryHit({ arrow, other, impact, deps });

  const body = target.body;
  const isDynamic = body.bodyType() === RAPIER.RigidBodyType.Dynamic;
  const v = arrow.lastVelocity;
  _impulse.x = v.x * CONFIG.arrow.mass;
  _impulse.y = v.y * CONFIG.arrow.mass;
  _impulse.z = v.z * CONFIG.arrow.mass;
  if (isDynamic) {
    body.applyImpulseAtPoint(_impulse, impact, true);
  }

  const result = target.registerHit(impact);
  emitImpact(arrow, "target", target.index, impact, null);
  deps.onScore?.(target, result, arrow);
  arrow.stick(body, isDynamic);
  deps.retireArrow?.(arrow);
  return { kind: "target", result };
}

function resolveBoarHit({ arrow, other, impact, deps }) {
  const boar = other.boar;
  if (!boar || boar.dead) return null;

  boar.registerHit(impact, arrow);
  emitImpact(arrow, "boar", boar.entityId, impact, null);
  deps.spawnPuff?.(impact, null);

  const body = boar.body;
  arrow.stick(body, true);
  deps.retireArrow?.(arrow);
  return { kind: "boar", entityId: boar.entityId };
}

function resolveSceneryHit({ arrow, other, impact, normal, deps }) {
  emitImpact(
    arrow,
    other?.kind ?? "scenery",
    other?.name ?? "chão",
    impact,
    normal,
  );
  deps.spawnPuff?.(impact, normal);
  deps.onMiss?.(arrow, other?.name ?? "chão");
  arrow.stick(null, false);
  deps.retireArrow?.(arrow);
  return { kind: "scenery" };
}

function emitImpact(arrow, targetKind, targetId, impact, normal) {
  gameEvents.emit(EventType.ARROW_IMPACT, {
    arrowId: arrow.id,
    ownerId: arrow.ownerEntityId,
    targetKind,
    targetId,
    impact: vec3Payload(impact),
    normal: normal ? vec3Payload(normal) : null,
  });
}
