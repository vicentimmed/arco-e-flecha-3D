/* ---------------------------------------------------------------------------
   IDs estáveis para entidades — base para sync multiplayer futuro.
   --------------------------------------------------------------------------- */

let nextEntityId = 1;

export class EntityRegistry {
  constructor() {
    this.byId = new Map();
  }

  /** @returns {number} */
  createId() {
    return nextEntityId++;
  }

  register(entityId, entity) {
    this.byId.set(entityId, entity);
  }

  unregister(entityId) {
    this.byId.delete(entityId);
  }

  get(entityId) {
    return this.byId.get(entityId) ?? null;
  }
}

export const entityRegistry = new EntityRegistry();
