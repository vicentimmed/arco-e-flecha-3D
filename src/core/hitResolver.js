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
  if (other.kind === "elk") {
    return resolveElkHit(ctx);
  }
  if (other.kind === "bird") {
    return resolveBirdHit(ctx);
  }
  if (other.kind === "seriesTarget") {
    return resolveSeriesHit(ctx);
  }
  if (other.kind === "zombie") {
    return resolveZombieHit(ctx);
  }
  if (other.kind === "wolf") {
    return resolveWolfHit(ctx);
  }
  if (other.kind === "torch") {
    return resolveTorchHit(ctx);
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
    hit: true,
  });

  deps.spawnPuff?.(impact, null);
  arrow.stick(body, isDynamic, character);
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
  arrow.stick(body, isDynamic, target);
  deps.retireArrow?.(arrow);
  return { kind: "target", result };
}

function resolveBoarHit({ arrow, other, impact, deps }) {
  const boar = other.boar;
  if (!boar || boar.dead) return null;

  boar.registerHit(impact, arrow);
  emitImpact(arrow, "boar", boar.entityId, impact, null, { label: "porco", hit: true });
  deps.spawnPuff?.(impact, null);

  const body = boar.body;
  arrow.stick(body, true, boar);
  deps.retireArrow?.(arrow);
  return { kind: "boar", entityId: boar.entityId };
}

/**
 * Alce: a flecha CRAVA e o bicho continua vivo.
 *
 * É a diferença essencial para o porco, que morre no primeiro acerto. Aqui a
 * flecha fica espetada no corpo cinemático e sai correndo junto — depois de
 * cinco ou seis, o alce é uma almofada de agulhas vindo na sua direção, e essa
 * imagem é o placar da briga. Quem conta a vida é o servidor; este lado só
 * avisa que acertou.
 */
function resolveElkHit({ arrow, other, impact, deps }) {
  const elk = other.elk;
  if (!elk || elk.dead) return null;

  elk.registerHit(impact, arrow);
  emitImpact(arrow, "elk", elk.entityId, impact, null, { label: "alce", hit: true });
  deps.spawnPuff?.(impact, null);

  arrow.stick(elk.body, true, elk);
  deps.retireArrow?.(arrow);
  return { kind: "elk", entityId: elk.entityId };
}

/**
 * Pássaro: alvo pequeno, e a flecha SEGUE em frente.
 *
 * Não crava por uma razão física simples — uma flecha de caça atravessa um
 * bicho de duzentos gramas —, e por uma razão de jogo: a flecha parada no ar a
 * trinta metros de altura, onde o pássaro estava, ficaria pendurada ali para
 * sempre. O corpo cai, a flecha some.
 */
function resolveBirdHit({ arrow, other, impact, deps }) {
  const bird = other.bird;
  if (!bird || bird.dead) return null;

  bird.registerHit(impact, arrow);
  emitImpact(arrow, "bird", bird.entityId, impact, null, { label: "pássaro", hit: true });
  deps.spawnPuff?.(impact, null);
  deps.removeArrow?.(arrow);
  return { kind: "bird", entityId: bird.entityId };
}

/**
 * Alvo da série: ele não crava a flecha, ele EXPLODE.
 *
 * E a flecha SOME junto. Ela era congelada no ponto do acerto, o que dava o
 * resultado esquisito de uma flecha (às vezes três, quando o alvo aguenta dois
 * tiros quase simultâneos) pendurada no ar, a duzentos metros, no lugar onde
 * havia um alvo que já explodiu. Como o alvo desaparece, não sobrou nada em que
 * ela pudesse estar cravada — o certo é ela ir embora na explosão.
 *
 * A explosão e o próximo alvo vêm do servidor, que é quem decide se este acerto
 * valeu (dois jogadores podem acertar quase juntos).
 */
function resolveSeriesHit({ arrow, other, impact, deps }) {
  emitImpact(arrow, "seriesTarget", other.seq, impact, null, {
    label: "alvo",
    seriesTarget: other.series,
    hit: true,
  });
  deps.spawnPuff?.(impact, null);
  deps.removeArrow?.(arrow);
  return { kind: "seriesTarget", seq: other.seq };
}

/**
 * Zumbi: duas no corpo, uma na cabeça.
 *
 * A CABEÇA É DECIDIDA AQUI, pela altura do ponto de contato em relação à base do
 * corpo — e não por um colisor separado para o crânio. Um segundo colisor por
 * zumbi custaria o dobro de corpos na física com vinte e um deles em campo, e
 * não compraria precisão nenhuma que importe: a cabeça de um zumbi de 1,8 m é
 * tudo acima de 1,45 m, e é exatamente isso que a comparação diz.
 *
 * A flecha CRAVA no corpo, como no alce. Um zumbi andando com duas flechas
 * espetadas é o placar visível de quanto falta para ele cair.
 */
function resolveZombieHit({ arrow, other, impact, deps }) {
  const zombie = other.zombie;
  if (!zombie || zombie.dead) return null;

  const head = impact.y - zombie.position.y >= CONFIG.modes.zombie.headMinY;
  zombie.registerHit(impact, arrow, head);
  emitImpact(arrow, "zombie", zombie.entityId, impact, null, {
    label: head ? "zumbi (cabeça)" : "zumbi",
    head,
    hit: true,
  });
  deps.spawnPuff?.(impact, null);

  arrow.stick(zombie.body, true, zombie);
  deps.retireArrow?.(arrow);
  return {
    kind: "zombie",
    entityId: zombie.entityId,
    head,
    speed: arrow.launchSpeed ?? 0,
  };
}

/** Lobo: uma flecha em qualquer lugar. */
function resolveWolfHit({ arrow, other, impact, deps }) {
  const wolf = other.wolf;
  if (!wolf || wolf.dead) return null;

  wolf.registerHit(impact, arrow);
  emitImpact(arrow, "zombie", wolf.entityId, impact, null, {
    label: "lobo",
    head: false,
    hit: true,
  });
  deps.spawnPuff?.(impact, null);

  arrow.stick(wolf.body, true, wolf);
  deps.retireArrow?.(arrow);
  return { kind: "wolf", entityId: wolf.entityId };
}

/**
 * Tocha: a flecha apaga a chama.
 *
 * É o único cenário destrutível do jogo, e é destrutível de propósito — errar o
 * zumbi e acertar a tocha escurece o próprio canto de quem errou. O risco é o
 * que dá peso a cada tiro no meio da horda.
 */
function resolveTorchHit({ arrow, other, impact, normal, deps }) {
  emitImpact(arrow, "torch", other.index, impact, normal, { label: "tocha" });
  deps.spawnPuff?.(impact, normal);
  arrow.stick(null, false);
  deps.retireArrow?.(arrow);
  return { kind: "torch", index: other.index };
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
