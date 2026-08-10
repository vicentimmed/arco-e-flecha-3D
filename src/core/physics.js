/* ---------------------------------------------------------------------------
   Mundo de física (Rapier). Este módulo NÃO importa Three.js: ele só conhece
   corpos, colisores e vetores simples. A ponte física → visual mora em
   core/sync.js, e é a única camada autorizada a falar com os dois lados.
   --------------------------------------------------------------------------- */

import RAPIER from "@dimforge/rapier3d-compat";
import { CONFIG } from "../config.js";

export { RAPIER };

let initialized = false;

/** Carrega o WASM do Rapier. Precisa ser aguardado antes de qualquer uso. */
export async function initPhysics() {
  if (!initialized) {
    await RAPIER.init();
    initialized = true;
  }
  return RAPIER;
}

export class PhysicsWorld {
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: CONFIG.physics.gravity, z: 0 });
    this.world.timestep = CONFIG.physics.fixedStep;
    this.eventQueue = new RAPIER.EventQueue(true);

    /** Callbacks chamados ANTES de cada passo fixo: forças contínuas (arrasto,
     *  vento) precisam ser reaplicadas a cada passo, nunca a cada frame. */
    this.beforeStep = new Set();
    /** Callbacks de colisão: fn({ a, b, colliderA, colliderB, point, normal }) */
    this.onContact = new Set();

    /** handle do colisor → objeto de jogo dono dele. */
    this.colliderOwners = new Map();
    /** Buffer de contatos do passo atual (ver drainContacts). */
    this.pendingContacts = [];

    this.stepCount = 0;
    this.simulatedTime = 0;
  }

  get gravity() {
    return this.world.gravity.y;
  }

  set gravity(y) {
    this.world.gravity = { x: 0, y, z: 0 };
  }

  /**
   * Joga fora o mundo inteiro e começa outro. É a troca de fase.
   *
   * A alternativa seria varrer uma lista de corpos e removê-los um a um. Ela
   * funciona até alguém esquecer um — e o esquecido não dá erro: ele vira um
   * colisor invisível no meio da fase seguinte, que segura o jogador no ar ou
   * crava uma flecha no nada. Trocar o mundo torna esse bug **impossível de
   * escrever**, e não apenas improvável.
   *
   * O que NÃO muda é este objeto. Meia dúzia de sistemas guardam
   * `this.physics` no construtor (o arco, a mira, as flechas, os bichos), e se
   * a troca de fase criasse um `PhysicsWorld` novo todos eles ficariam
   * apontando para um mundo morto. Aqui o invólucro é o mesmo — só o
   * `RAPIER.World` de dentro é outro —, então nenhuma dessas referências
   * precisa saber que a fase mudou.
   *
   * Pela mesma razão, `beforeStep` e `onContact` são PRESERVADOS: quem se
   * inscreveu uma vez continua inscrito. O que se perde, e tem de ser
   * refeito por quem é dono, são os corpos: a cápsula do jogador local, as
   * cápsulas dos remotos e o controlador de personagem — todos com `rebuild()`.
   *
   * @param {number} [gravity] gravidade em Y da nova fase (m/s²).
   */
  recreate(gravity = this.world.gravity.y) {
    this.world.free?.();
    this.eventQueue.free?.();

    this.world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
    this.world.timestep = CONFIG.physics.fixedStep;
    this.eventQueue = new RAPIER.EventQueue(true);

    // O mapa de donos era do mundo antigo: os handles do mundo novo começam a
    // contar do zero e reaproveitariam números já usados. Não limpar aqui é a
    // receita para um colisor da fase nova ser atendido pelo dono de um da
    // fase velha — e para uma flecha acertar uma árvore que não existe mais.
    this.colliderOwners.clear();
    this.pendingContacts.length = 0;

    this.stepCount = 0;
    this.simulatedTime = 0;
    return this;
  }

  /** Quantos corpos existem agora. Usado pelo critério de aceite da troca. */
  get bodyCount() {
    return this.world.bodies.len();
  }

  /** Registra a quem pertence um colisor, para resolver eventos de contato. */
  register(collider, owner) {
    this.colliderOwners.set(collider.handle, owner);
  }

  unregister(collider) {
    this.colliderOwners.delete(collider.handle);
  }

  ownerOf(colliderHandle) {
    return this.colliderOwners.get(colliderHandle) ?? null;
  }

  createBody(desc) {
    return this.world.createRigidBody(desc);
  }

  createCollider(desc, body) {
    return this.world.createCollider(desc, body);
  }

  removeBody(body) {
    for (let i = 0; i < body.numColliders(); i++) {
      this.unregister(body.collider(i));
    }
    this.world.removeRigidBody(body);
  }

  /** Um passo de tamanho fixo. Nunca chame com dt variável. */
  step() {
    const h = this.world.timestep;
    for (const fn of this.beforeStep) fn(h);
    this.world.step(this.eventQueue);
    this.stepCount++;
    this.simulatedTime += h;
    this.drainContacts();
  }

  /**
   * Coleta os contatos do passo e só então avisa os interessados.
   *
   * O despacho acontece DEPOIS de a fila estar totalmente drenada, e não dentro
   * do callback: quem trata um impacto cria vínculos e remove corpos (a flecha
   * que crava, a mais antiga que é aposentada), e mexer no mundo no meio da
   * drenagem invalida os handles dos eventos seguintes — o que fazia o Rapier
   * entrar em pânico ("unreachable") no passo seguinte.
   */
  drainContacts() {
    const pending = this.pendingContacts;
    pending.length = 0;

    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started || this.onContact.size === 0) return;
      const ownerA = this.colliderOwners.get(h1);
      const ownerB = this.colliderOwners.get(h2);
      if (!ownerA && !ownerB) return;

      const c1 = this.world.getCollider(h1);
      const c2 = this.world.getCollider(h2);
      const contact = this.resolveContact(c1, c2);

      pending.push({
        a: ownerA,
        b: ownerB,
        colliderA: c1,
        colliderB: c2,
        point: contact.point,
        normal: contact.normal,
        hasManifold: contact.found,
      });
    });

    for (const payload of pending) {
      for (const fn of this.onContact) fn(payload);
    }
    pending.length = 0;
  }

  /**
   * Ponto e normal do contato em coordenadas de mundo, lidos do manifold do
   * narrow-phase. É de propósito que NÃO estimamos o ponto pelo centro de
   * massa: numa flecha de 75 cm o erro seria de dezenas de centímetros.
   */
  resolveContact(c1, c2) {
    const result = { point: null, normal: null, found: false };
    if (!c1 || !c2) return result;
    try {
      this.world.contactPair(c1, c2, (manifold, flipped) => {
        if (result.found) return;
        const n = manifold.numSolverContacts();
        if (n > 0) {
          const p = manifold.solverContactPoint(0);
          result.point = { x: p.x, y: p.y, z: p.z };
        } else if (manifold.numContacts() > 0) {
          // Fallback: ponto local do primeiro contato, convertido para mundo.
          const local = flipped
            ? manifold.localContactPoint2(0)
            : manifold.localContactPoint1(0);
          const owner = flipped ? c2 : c1;
          if (local && owner) {
            result.point = localToWorld(owner, local);
          }
        }
        const nrm = manifold.normal();
        result.normal = flipped
          ? { x: -nrm.x, y: -nrm.y, z: -nrm.z }
          : { x: nrm.x, y: nrm.y, z: nrm.z };
        result.found = result.point !== null;
      });
    } catch {
      /* manifold já liberado — cai no fallback do chamador */
    }
    return result;
  }
}

/** Converte um ponto local de um colisor para coordenadas de mundo. */
function localToWorld(collider, local) {
  const t = collider.translation();
  const r = collider.rotation();
  // p' = t + q · p · q*
  const { x, y, z } = local;
  const ix = r.w * x + r.y * z - r.z * y;
  const iy = r.w * y + r.z * x - r.x * z;
  const iz = r.w * z + r.x * y - r.y * x;
  const iw = -r.x * x - r.y * y - r.z * z;
  return {
    x: t.x + ix * r.w + iw * -r.x + iy * -r.z - iz * -r.y,
    y: t.y + iy * r.w + iw * -r.y + iz * -r.x - ix * -r.z,
    z: t.z + iz * r.w + iw * -r.z + ix * -r.y - iy * -r.x,
  };
}
