/* ---------------------------------------------------------------------------
   Morrer.

   O tombo serve a um propósito: dar um instante entre "levou a flecha" e
   "sumiu daqui". Sem ele, quem morre desaparece e reaparece do outro lado do
   mapa no mesmo frame, e nem quem morreu nem quem matou entende o que houve —
   o acerto não tem consequência visível.

   O tombo é um CORPO MOLE (ver `game/ragdoll.js`), e é ele que carrega a
   informação: de onde a flecha veio e com quanta força. O `deathFall` de antes
   continua existindo, agora só como medida de progresso — quem usa é o
   descarte e o desbotamento, não a pose.

   O relógio é o da SALA, e não um cronômetro local, para que o corpo caia com o
   mesmo timing em todas as telas. O ragdoll é determinístico dadas as mesmas
   entradas, então o mesmo tombo acontece em todas elas.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../config.js";
import { Ragdoll } from "./ragdoll.js";

/** Progresso 0→1 do tombo, com desaceleração no fim. */
function queda(k) {
  const t = k < 0 ? 0 : k > 1 ? 1 : k;
  return 1 - (1 - t) * (1 - t); // ease-out: cai rápido e assenta
}

export class Death {
  constructor(player, terrain) {
    this.player = player;
    this.ragdoll = new Ragdoll(terrain);
    /** Instante do relógio da sala em que a queda começou. 0 = vivo. */
    this.since = 0;
    this.lastTime = 0;
  }

  get dying() {
    return this.since > 0;
  }

  /**
   * @param {number} serverTime relógio da sala
   * @param {object} [msg] a mensagem de morte, com o impacto: `{ c, v }`.
   *   Sem ela o corpo ainda cai — só cai sem saber de onde veio o tiro.
   */
  begin(serverTime, msg) {
    this.since = serverTime;
    this.lastTime = serverTime;
    this.player.ragdoll = this.ragdoll;
    this.ragdoll.begin(
      this.player.position,
      this.player.yaw,
      msg?.c ? { x: msg.c[0], y: msg.c[1], z: msg.c[2] } : null,
      msg?.v ?? null,
    );
  }

  revive() {
    this.since = 0;
    this.ragdoll.stop();
    this.player.ragdoll = null;
    this.player.deathFall = 0;
  }

  update(serverTime) {
    if (!this.since) return;
    const k = (serverTime - this.since) / (CONFIG.spawn.deathDuration * 1000);
    this.player.deathFall = queda(k);
    // Quem caiu não anda nem mira: sem isto o corpo tombado continua com as
    // pernas em ciclo de marcha, que fica grotesco.
    this.player.gaitBlend = 0;
    this.player.runBlend = 0;
    this.player.setDraw(0);
    this.lastTime = serverTime;
  }
}
