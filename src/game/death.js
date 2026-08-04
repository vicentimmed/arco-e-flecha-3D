/* ---------------------------------------------------------------------------
   Morrer.

   O tombo é curto e serve a um propósito só: dar um instante entre "levou a
   flecha" e "sumiu daqui". Sem ele, quem morre desaparece e reaparece do outro
   lado do mapa no mesmo frame, e nem quem morreu nem quem matou entende o que
   houve — o acerto não tem consequência visível.

   A animação sai do relógio da SALA, e não de um cronômetro local, para que o
   corpo caia com o mesmo timing em todas as telas.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../config.js";

/** Progresso 0→1 do tombo, com desaceleração no fim. */
function queda(k) {
  const t = k < 0 ? 0 : k > 1 ? 1 : k;
  return 1 - (1 - t) * (1 - t); // ease-out: cai rápido e assenta
}

export class Death {
  constructor(player) {
    this.player = player;
    /** Instante do relógio da sala em que a queda começou. 0 = vivo. */
    this.since = 0;
  }

  get dying() {
    return this.since > 0;
  }

  begin(serverTime) {
    this.since = serverTime;
  }

  revive() {
    this.since = 0;
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
  }
}
