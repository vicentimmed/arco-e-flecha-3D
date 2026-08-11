/* ---------------------------------------------------------------------------
   O RASTRO DE FUMAÇA DO JETPACK.

   Por que ele existe: um arqueiro voando é a coisa mais difícil de enxergar no
   jogo. O boneco é pequeno, o céu da Lua é preto liso e a chama dos bocais só
   se lê a uns vinte metros. O resultado era que ninguém sabia quem estava no ar
   — nem para atirar, nem para fugir. O caminho de fumaça resolve isso de um
   jeito que uma seta na tela nunca resolveria: ele é DO MUNDO, aparece na
   posição certa, e **fica**. Você não vê só quem está voando agora; você vê por
   onde alguém passou nos últimos dois segundos, e de que lado ele veio.

   ------------------------------------------------------------------ o truque

   Não há sistema de partículas novo aqui. Um sopro é emitido no pool comum
   (`systems/particles.js`) com `drag` alto e velocidade baixa: ele freia quase
   imediatamente e **fica parado no ar**. Quem se move é o jogador, não a
   fumaça — e por isso a fileira de sopros que ele deixa para trás desenha o
   caminho, cada um mais apagado que o seguinte porque nasceu antes. O rastro
   não é um objeto: é a consequência de emitir no lugar certo e não empurrar.

   ------------------------------------------------------------------ o custo

   Este é o único efeito do jogo que é CONTÍNUO e MULTIPLICADO POR JOGADOR — e
   é por isso que ele tem um arquivo só para si em vez de três linhas soltas no
   `main.js`. O pool de partículas opacas tem teto (ver `ParticleSystem`), e um
   rastro que o encha sozinho apaga a poeira dos pés, a terra da flechada e o
   estilhaço do meteorito. Três cortes o mantêm no orçamento:

     • RITMO FIXO por tempo, não por quadro. A 144 fps o rastro tem exatamente a
       mesma densidade que a 40 — e o mesmo custo.
     • METADE DO RITMO ALÉM DE 45 m. A essa distância um sopro de 26 cm ocupa
       poucos pixels, e ninguém consegue contar os buracos do rastro.
     • NADA ALÉM DE 130 m. Passou disso, o rastro inteiro é uma mancha cinza de
       três pixels; o `hide` da rede corta o boneco em 160 m de qualquer forma.

   Com isso, um jogador voando custa ~29 partículas vivas de perto e ~12 de
   longe. Seis pessoas voando ao mesmo tempo, todas por perto — que é o pior
   caso real de uma sala cheia na Lua — cabem no pool com folga para o resto.
   --------------------------------------------------------------------------- */

import { gameEvents, EventType } from "../core/events.js";
import { CONFIG } from "../config.js";

/* Deslocamento do sopro em relação aos PÉS do boneco (a origem do `root`).
   A mochila fica nas costas, na altura do tronco: 0,95 m acima do chão e 0,22 m
   atrás. Emitir no centro do corpo daria fumaça saindo da barriga. */
const ALTURA_BOCAL = 0.95; // m
const RECUO_BOCAL = 0.22; // m

export class JetSmokeTrail {
  constructor() {
    this.t = 0;
  }

  /**
   * Um passo do rastro de UM arqueiro.
   *
   * @param {number} dt
   * @param {boolean} aceso o jato está queimando neste instante
   * @param {{x:number,y:number,z:number}} pos posição dos pés do boneco
   * @param {number} yaw para onde ele olha — o bocal fica atrás dele
   * @param {number} distancia da câmera, em metros (0 no jogador local)
   * @param {boolean} [pouco] tanque no fim: a fumaça fica mais suja
   */
  step(dt, aceso, pos, yaw, distancia, pouco = false) {
    const cfg = CONFIG.levels?.moon?.jetpack?.smoke;
    if (!cfg) return;

    if (!aceso) {
      /* Apagou: o relógio é ZERADO, não pausado. Assim o primeiro sopro do
         próximo pulso sai no instante em que o jato acende, e não depois de uma
         sobra de tempo do voo anterior — voar em pulsos curtos (que é como o
         jetpack é usado de verdade) marcaria o começo de cada pulso com um
         atraso aleatório. */
      this.t = 0;
      return;
    }

    if (distancia > cfg.maxDistance) return;

    const intervalo = distancia > cfg.nearDistance ? cfg.intervalFar : cfg.interval;
    this.t += dt;
    if (this.t < intervalo) return;
    this.t = 0;

    const sx = Math.sin(yaw);
    const sz = Math.cos(yaw);
    gameEvents.emit(EventType.PARTICLES, {
      position: {
        x: pos.x + sx * RECUO_BOCAL,
        y: pos.y + ALTURA_BOCAL,
        z: pos.z + sz * RECUO_BOCAL,
      },
      count: 1,
      color: pouco ? cfg.colorLow : cfg.color,
      colorJitter: 0.18,
      speed: cfg.speed,
      // Sai para BAIXO, contra o empuxo — é o gás que empurra o corpo. O
      // `spread` alto espalha o sopro em vez de fazer um jato reto: fumaça,
      // não chama (a chama já existe, nos bocais do boneco).
      spread: 0.65,
      direction: { x: 0, y: -1, z: 0 },
      size: cfg.size,
      grow: cfg.grow,
      life: cfg.life,
      gravity: cfg.gravity,
      drag: cfg.drag,
      alpha: cfg.alpha,
    });
  }
}
