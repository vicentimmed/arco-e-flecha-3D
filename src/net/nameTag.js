/* ---------------------------------------------------------------------------
   A etiqueta com o nome, flutuando acima da cabeça.

   Um `Sprite`, não um plano: sprite já encara a câmera sozinho, em qualquer
   ângulo, sem uma linha de código por frame para orientá-lo.

   A escala CRESCE com a distância de propósito. O comportamento natural de um
   sprite é encolher com a perspectiva, e a 80 m o nome viraria dois pixels —
   inútil justamente quando você mais precisa dele, que é para decidir se aquele
   vulto lá longe é amigo ou alvo. Compensar a perspectiva mantém o nome legível
   de qualquer distância, que é o que jogo de tiro faz.

   O texto entra por `fillText` num canvas, então nome nenhum vira marcação:
   é impossível injetar HTML numa textura.
   --------------------------------------------------------------------------- */

import * as THREE from "three";

const LARGURA = 320;
const ALTURA = 96;
/** Altura do sprite no mundo, por unidade de escala. */
const ALTURA_BASE = 0.42;
/**
 * Escala por metro de distância.
 *
 * Como a escala cresce LINEARMENTE com a distância, o tamanho na tela fica
 * constante — ~30 px de sprite, uns 15 px de letra — em qualquer distância. Foi
 * escolhido medindo: abaixo disso o nome vira borrão a 40 m.
 */
const ESCALA_POR_METRO = 0.1;
/** Abaixo de ~11 m o nome para de crescer na tela e passa a crescer de fato. */
const ESCALA_MIN = 1.1;
/** Cobre até além do limite de visibilidade (`CONFIG.net.cull.hide`). */
const ESCALA_MAX = 17;

export class NameTag {
  /**
   * @param {string} nome
   * @param {number} color cor do jogador (a mesma da roupa)
   */
  constructor(nome, color) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = LARGURA;
    this.canvas.height = ALTURA;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    this.material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      // Sem teste de profundidade: o nome atravessa arbusto, tronco e o próprio
      // corpo. Numa arena com mata é a diferença entre saber quem está ali e
      // perder o rastro de todo mundo atrás da primeira árvore.
      depthTest: false,
    });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.renderOrder = 10;
    this.sprite.center.set(0.5, 0);

    this.draw(nome, color);
  }

  draw(nome, color) {
    const ctx = this.canvas.getContext("2d");
    ctx.clearRect(0, 0, LARGURA, ALTURA);

    const hex = `#${color.toString(16).padStart(6, "0")}`;
    ctx.font = "700 46px Nunito, 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Contorno escuro grosso em vez de caixa de fundo: a caixa some no céu
    // claro ou na rocha clara; o contorno funciona sobre qualquer cor.
    ctx.lineJoin = "round";
    ctx.lineWidth = 10;
    ctx.strokeStyle = "rgba(8, 10, 14, 0.92)";
    ctx.strokeText(nome, LARGURA / 2, ALTURA / 2 - 6);

    ctx.fillStyle = "#f4f1ea";
    ctx.fillText(nome, LARGURA / 2, ALTURA / 2 - 6);

    // Traço na cor do jogador: liga o nome ao boneco quando há muita gente.
    const larguraTexto = Math.min(LARGURA - 24, ctx.measureText(nome).width + 20);
    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.roundRect((LARGURA - larguraTexto) / 2, ALTURA - 26, larguraTexto, 7, 4);
    ctx.fill();

    this.texture.needsUpdate = true;
  }

  /**
   * Mantém o nome legível de qualquer distância.
   * @param {number} distancia m até a câmera
   */
  updateScale(distancia) {
    // Cresce com a distância para anular a perspectiva, com piso e teto para
    // não virar um cartaz na cara nem sumir no horizonte.
    const escala = THREE.MathUtils.clamp(
      distancia * ESCALA_POR_METRO,
      ESCALA_MIN,
      ESCALA_MAX,
    );
    this.sprite.scale.set(
      escala * (LARGURA / ALTURA) * ALTURA_BASE,
      escala * ALTURA_BASE,
      1,
    );
  }

  setOpacity(alpha) {
    this.material.opacity = alpha;
  }

  dispose() {
    this.sprite.removeFromParent();
    this.texture.dispose();
    this.material.dispose();
  }
}
