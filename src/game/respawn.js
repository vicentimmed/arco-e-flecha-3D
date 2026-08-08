/* ---------------------------------------------------------------------------
   Nascer.

   O caminho padrão para entrar na sala e renascer é aparecer a 10 m do chão e
   CAIR. A sala pode informar `drop: 0` em modos que precisam começar
   imediatamente no piso.

   A queda não tem física própria: é o mesmo controlador cinemático de sempre,
   só que começando lá em cima. Por isso ela acerta o relevo, escorrega em
   encosta e para no chão sem uma linha de código nova.

   O piscar da invencibilidade sai do relógio da SALA, não de um cronômetro
   local: assim o corpo pisca em fase para todo mundo, e o instante em que a
   proteção acaba é o mesmo em todas as telas.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../config.js";

/**
 * Opacidade do piscar de invencibilidade num instante do relógio da SALA.
 *
 * Uma função do tempo compartilhado, e não um cronômetro local, para que o
 * corpo pisque em fase em todas as telas. Não apaga de todo: a 0,22 ainda dá
 * para mirar em quem está piscando, e a proteção continua sendo a regra, não a
 * invisibilidade.
 */
export function blinkOpacity(serverTime) {
  const fase = Math.sin((serverTime / 1000) * CONFIG.spawn.blinkHz * Math.PI * 2);
  return fase > 0 ? 1 : 0.22;
}

export class Respawn {
  /**
   * @param {import("../entities/player.js").Player} player
   * @param {import("../systems/playerPhysics.js").PlayerPhysics} [physics]
   */
  constructor(player, physics = null) {
    this.player = player;
    this.physics = physics;
    /** Instante do relógio da sala (ms) em que a proteção acaba. */
    this.invulnUntil = 0;
    this.blinking = false;
  }

  /**
   * Coloca o jogador sobre (x, z), respeitando o drop do pacote, e liga a
   * invencibilidade.
   * @param {{x:number, z:number, y:number, drop:number, invulnUntil:number}} spawn
   */
  begin(spawn) {
    const y = spawn.y + (spawn.drop ?? CONFIG.spawn.dropHeight);
    this.invulnUntil = spawn.invulnUntil ?? 0;

    if (this.physics) {
      this.physics.teleport(spawn.x, y, spawn.z);
    } else {
      this.player.position.set(spawn.x, y, spawn.z);
      this.player.airborne = true;
    }

    // Zera o que sobrou da vida anterior: velocidade da marcha, tensão do arco
    // e a fase do passo. Sem isso o jogador nasce "correndo" no ar.
    const p = this.player;
    p.speed = 0;
    p.moveF = 0;
    p.moveS = 0;
    p.gaitBlend = 0;
    p.runBlend = 0;
    p.setDraw(0);
    p.setReload(0);
  }

  /** @param {number} serverTime ms no relógio da sala */
  isInvulnerable(serverTime) {
    return serverTime < this.invulnUntil;
  }

  update(serverTime) {
    const piscando = this.isInvulnerable(serverTime);
    // O `hitResolver` roda dentro do passo da física e não tem relógio da sala:
    // ele lê este booleano.
    this.player.invulnerable = piscando;

    if (piscando) {
      this.player.setOpacity(blinkOpacity(serverTime));
      this.blinking = true;
      return;
    }

    if (this.blinking) {
      this.player.setOpacity(1);
      this.blinking = false;
    }
  }
}
