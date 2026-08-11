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
  ELK_HIT: "ELK_HIT",
  ELK_DEATH: "ELK_DEATH",
  BIRD_HIT: "BIRD_HIT",
  ZOMBIE_HIT: "ZOMBIE_HIT",
  TORCH_HIT: "TORCH_HIT",
  /* Uma flecha acertou algo da Lua (alien, nave, meteorito). O impacto é
     anunciado aqui e vira um pedido `C2S.SPACE_HIT` — quem decide se o alvo
     caiu é a sala, que é uma só para todo mundo. */
  SPACE_HIT: "SPACE_HIT",
  AUDIO_PLAY: "AUDIO_PLAY",
  /* Um lote de partículas. Segue o mesmo desenho de `AUDIO_PLAY`: quem emite
     descreve o EFEITO (cor, quantidade, quanto dura) e não conhece o pool nem a
     cena — um zumbi não precisa de uma referência ao sistema de partículas para
     pegar fogo, do mesmo jeito que não precisa do mixer para gemer. */
  PARTICLES: "PARTICLES",
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
