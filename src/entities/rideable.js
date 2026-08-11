/* ---------------------------------------------------------------------------
   Andar em cima de coisa que se move.

   O character controller do Rapier não empresta velocidade de colisor
   cinemático a quem está em pé sobre ele: o rover desliza por baixo dos pés de
   quem está parado nele. A solução é a de sempre para plataforma móvel — a cada
   quadro, reprojetar a posição do passageiro do referencial que a plataforma
   tinha ONTEM para o que ela tem AGORA. Translação e guinada.

   Como três coisas diferentes precisam disso (o rover, a nave de transporte e o
   meteorito), a conta mora aqui e cada uma só declara a própria geometria de
   convés — retangular para quem tem frente e traseira, redonda para quem não
   tem.
   --------------------------------------------------------------------------- */

/** Gira (x, z) por `ang` radianos em torno da origem. */
export function girar(x, z, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return [x * c - z * s, x * s + z * c];
}

/**
 * A pose do quadro anterior, e a conta de carregar um ponto.
 *
 * Quem usa precisa manter `x`, `z` e `yaw` próprios e chamar `marcarPose()` no
 * COMEÇO do próprio `update`, antes de se mover — é o "ontem" da reprojeção.
 */
export class Plataforma {
  constructor() {
    this.prevX = 0;
    this.prevZ = 0;
    this.prevYaw = 0;
  }

  marcarPose(x, z, yaw) {
    this.prevX = x;
    this.prevZ = z;
    this.prevYaw = yaw;
  }

  /**
   * Convés RETANGULAR — para quem tem frente e traseira (o rover).
   *
   * @param {{x:number,y:number,z:number}} pos pés do passageiro
   * @param {number} deckY altura do piso, em mundo
   * @param {number} halfW meia-largura do convés (eixo X local)
   * @param {number} halfL meio-comprimento (eixo Z local)
   * @param {number} tolY folga vertical aceita
   */
  pisandoEmCaixa(pos, x, z, yaw, deckY, halfW, halfL, tolY = 0.4) {
    const [lx, lz] = girar(pos.x - x, pos.z - z, -yaw);
    if (Math.abs(lx) > halfW || Math.abs(lz) > halfL) return false;
    return Math.abs(pos.y - deckY) < tolY;
  }

  /** Convés REDONDO — disco voador, meteorito. O giro não importa. */
  pisandoEmDisco(pos, x, z, deckY, raio, tolY = 0.5) {
    if (Math.hypot(pos.x - x, pos.z - z) > raio) return false;
    return Math.abs(pos.y - deckY) < tolY;
  }

  /**
   * Move `pos` (mutado in-place) pelo tanto que a plataforma andou e girou
   * desde `marcarPose`. É isto que mantém o passageiro colado ao convés,
   * inclusive nas curvas.
   */
  carregar(pos, x, z, yaw, deckY) {
    const [lx, lz] = girar(pos.x - this.prevX, pos.z - this.prevZ, -this.prevYaw);
    const [wx, wz] = girar(lx, lz, yaw);
    pos.x = x + wx;
    pos.z = z + wz;
    pos.y = deckY;
  }
}
