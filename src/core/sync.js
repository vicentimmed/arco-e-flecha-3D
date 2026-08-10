/* ---------------------------------------------------------------------------
   Única ponte física → visual.

   O passo da física é fixo (1/120 s) e o render é livre. Sem interpolação o
   resultado treme visivelmente; por isso guardamos a transformação anterior e
   a atual de cada corpo e interpolamos por `alpha` na hora de desenhar.
   --------------------------------------------------------------------------- */

export class BodySync {
  constructor() {
    this.entries = [];
    this.byBody = new Map();
  }

  add(body, object3D) {
    const t = body.translation();
    const r = body.rotation();
    const entry = {
      body,
      object3D,
      prev: { px: t.x, py: t.y, pz: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w },
      curr: { px: t.x, py: t.y, pz: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w },
      active: true,
    };
    this.entries.push(entry);
    this.byBody.set(body.handle, entry);
    return entry;
  }

  remove(body) {
    const entry = this.byBody.get(body.handle);
    if (!entry) return;
    this.byBody.delete(body.handle);
    const i = this.entries.indexOf(entry);
    if (i >= 0) this.entries.splice(i, 1);
  }

  /**
   * Esquece TODOS os corpos. É a troca de fase.
   *
   * A chave do mapa é `body.handle`, e os handles do mundo novo recomeçam do
   * zero — então uma entrada sobrevivente não fica só obsoleta, ela fica
   * ATIVAMENTE errada: o corpo 3 da fase nova herdaria a malha do corpo 3 da
   * anterior. Além disso `saveState()` chamaria `translation()` num ponteiro
   * morto no primeiro passo depois da troca.
   *
   * Nada é destruído aqui: as malhas pertencem à fase e morrem com ela.
   */
  clear() {
    this.entries.length = 0;
    this.byBody.clear();
  }

  /** Congela um corpo (flecha cravada): para de gastar interpolação com ele. */
  setActive(body, active) {
    const entry = this.byBody.get(body.handle);
    if (entry) entry.active = active;
  }

  /** Chamado logo antes de cada passo fixo. */
  saveState() {
    for (const e of this.entries) {
      if (!e.active) continue;
      e.prev.px = e.curr.px;
      e.prev.py = e.curr.py;
      e.prev.pz = e.curr.pz;
      e.prev.qx = e.curr.qx;
      e.prev.qy = e.curr.qy;
      e.prev.qz = e.curr.qz;
      e.prev.qw = e.curr.qw;
    }
  }

  /** Chamado logo depois de cada passo fixo. */
  captureState() {
    for (const e of this.entries) {
      if (!e.active) continue;
      const t = e.body.translation();
      const r = e.body.rotation();
      e.curr.px = t.x;
      e.curr.py = t.y;
      e.curr.pz = t.z;
      e.curr.qx = r.x;
      e.curr.qy = r.y;
      e.curr.qz = r.z;
      e.curr.qw = r.w;
    }
  }

  /** Chamado uma vez por frame, com alpha = acumulador / passo fixo. */
  apply(alpha) {
    const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    for (const e of this.entries) {
      if (!e.active) continue;
      const p = e.prev;
      const c = e.curr;
      e.object3D.position.set(
        p.px + (c.px - p.px) * a,
        p.py + (c.py - p.py) * a,
        p.pz + (c.pz - p.pz) * a,
      );
      // slerp curto (nlerp com correção de sinal): suficiente para 1/120 s.
      let dot = p.qx * c.qx + p.qy * c.qy + p.qz * c.qz + p.qw * c.qw;
      let s = 1;
      if (dot < 0) {
        s = -1;
        dot = -dot;
      }
      const qx = p.qx + (c.qx * s - p.qx) * a;
      const qy = p.qy + (c.qy * s - p.qy) * a;
      const qz = p.qz + (c.qz * s - p.qz) * a;
      const qw = p.qw + (c.qw * s - p.qw) * a;
      const inv = 1 / (Math.hypot(qx, qy, qz, qw) || 1);
      e.object3D.quaternion.set(qx * inv, qy * inv, qz * inv, qw * inv);
    }
  }

  /** Força o visual a bater exatamente com a física (usado ao cravar). */
  snap(body) {
    const e = this.byBody.get(body.handle);
    if (!e) return;
    const t = body.translation();
    const r = body.rotation();
    e.prev.px = e.curr.px = t.x;
    e.prev.py = e.curr.py = t.y;
    e.prev.pz = e.curr.pz = t.z;
    e.prev.qx = e.curr.qx = r.x;
    e.prev.qy = e.curr.qy = r.y;
    e.prev.qz = e.curr.qz = r.z;
    e.prev.qw = e.curr.qw = r.w;
    e.object3D.position.set(t.x, t.y, t.z);
    e.object3D.quaternion.set(r.x, r.y, r.z, r.w);
  }
}
