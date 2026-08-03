/* ---------------------------------------------------------------------------
   Bus de eventos do jogo — payloads serializáveis para replay/rede futura.
   --------------------------------------------------------------------------- */

export const EventType = {
  ARROW_SHOT: "ARROW_SHOT",
  ARROW_IMPACT: "ARROW_IMPACT",
  CHARACTER_HIT: "CHARACTER_HIT",
  BOAR_SPAWN: "BOAR_SPAWN",
  BOAR_DEATH: "BOAR_DEATH",
  BOAR_SCARED: "BOAR_SCARED",
  AUDIO_PLAY: "AUDIO_PLAY",
};

class GameEventsBus {
  constructor() {
    this.listeners = new Map();
    this.tick = 0;
  }

  setTick(t) {
    this.tick = t;
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type)?.delete(fn);
  }

  emit(type, payload = {}) {
    const event = { type, tick: this.tick, ...payload };
    const set = this.listeners.get(type);
    if (set) {
      for (const fn of set) fn(event);
    }
    return event;
  }
}

export const gameEvents = new GameEventsBus();

/** Converte Vector3-like em objeto plano para JSON. */
export function vec3Payload(v) {
  return { x: v.x, y: v.y, z: v.z };
}
