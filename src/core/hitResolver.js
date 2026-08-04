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
  if (other.kind === "seriesTarget") {
    return resolveSeriesHit(ctx);
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

  /* Quem acabou de nascer está piscando e é intocável. A flecha ATRAVESSA em
     vez de cravar — cravar numa pessoa imune daria o retorno visual de acerto
     sem o acerto, que é pior que errar limpo. */
  if (character.invulnerable) return null;

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
  emitImpact(arrow, "character", character.entityId, impact, normal, {
    label: character.displayName ?? "personagem",
  });

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
  emitImpact(arrow, "target", target.index, impact, null, {
    score: result.score,
    label: result.score > 0 ? null : "armação do alvo",
  });
  deps.onScore?.(target, result, arrow);
  arrow.stick(body, isDynamic);
  deps.retireArrow?.(arrow);
  return { kind: "target", result };
}

function resolveBoarHit({ arrow, other, impact, deps }) {
  const boar = other.boar;
  if (!boar || boar.dead) return null;

  boar.registerHit(impact, arrow);
  emitImpact(arrow, "boar", boar.entityId, impact, null, { label: "porco" });
  deps.spawnPuff?.(impact, null);

  const body = boar.body;
  arrow.stick(body, true);
  deps.retireArrow?.(arrow);
  return { kind: "boar", entityId: boar.entityId };
}

/**
 * Alvo da série: ele não crava a flecha, ele EXPLODE.
 *
 * A flecha é retirada em vez de ficar espetada porque o alvo some no mesmo
 * instante — uma flecha pendurada no ar onde havia um alvo seria pior que
 * nenhuma. A explosão e o próximo alvo vêm do servidor, que é quem decide se
 * este acerto valeu (dois jogadores podem acertar quase juntos).
 */
function resolveSeriesHit({ arrow, other, impact, deps }) {
  emitImpact(arrow, "seriesTarget", other.seq, impact, null, {
    label: "alvo",
    seriesTarget: other.series,
  });
  deps.spawnPuff?.(impact, null);
  arrow.stick(null, false);
  deps.retireArrow?.(arrow);
  return { kind: "seriesTarget", seq: other.seq };
}

function resolveSceneryHit({ arrow, other, impact, normal, deps }) {
  emitImpact(
    arrow,
    other?.kind ?? "scenery",
    other?.name ?? "chão",
    impact,
    normal,
    { label: other?.name ?? "chão" },
  );
  deps.spawnPuff?.(impact, normal);
  deps.onMiss?.(arrow, other?.name ?? "chão");
  arrow.stick(null, false);
  deps.retireArrow?.(arrow);
  return { kind: "scenery" };
}

/**
 * Anuncia um impacto. É o ÚNICO ponto por onde todo acerto passa — cenário,
 * alvo, porco ou personagem — e por isso é aqui que a distância do tiro é
 * medida: um lugar só, e vale igual em primeira e em terceira pessoa.
 *
 * @param {object} [detail] campos específicos do tipo de alvo (pontos, rótulo)
 */
function emitImpact(arrow, targetKind, targetId, impact, normal, detail = {}) {
  // A POSE do corpo, não só o ponto de contato. É ela que os outros clientes
  // usam para encaixar a cópia da flecha, e ela precisa ser lida agora: daqui a
  // uma linha `stick()` congela o corpo e, se o alvo tombar, tudo se move.
  const t = arrow.body.translation();
  const r = arrow.body.rotation();
  const v = arrow.lastVelocity;

  gameEvents.emit(EventType.ARROW_IMPACT, {
    arrowId: arrow.id,
    ownerId: arrow.ownerEntityId,
    targetKind,
    targetId,
    pose: { p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w] },
    // Velocidade no instante do impacto: é com ela que o alvo tomba igual em
    // todas as telas, em vez de cada máquina inventar o próprio tombo.
    velocity: [v.x, v.y, v.z],
    // Distância em LINHA RETA do disparo ao impacto — a medida que um arqueiro
    // usa ao dizer "acertei a 60 m". O caminho percorrido é um pouco maior (a
    // flecha cai e deriva), mas não é ele que se anuncia num campo de tiro.
    distance: arrow.launchPosition.distanceTo(impact),
    impact: vec3Payload(impact),
    normal: normal ? vec3Payload(normal) : null,
    ...detail,
  });
}
