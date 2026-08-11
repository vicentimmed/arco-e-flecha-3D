/* ---------------------------------------------------------------------------
   Partículas — UM pool, DOIS draw calls, para o jogo inteiro.

   Faísca de zumbi queimando, terra levantada pela flecha, lasca de madeira,
   pena de pássaro, poeira do passo, bafo do alce na investida: tudo sai daqui.
   A alternativa — cada sistema com o seu emissor — dava a mesma imagem por
   quinze vezes o custo, e a horda 10 (vinte e um zumbis, alguns pegando fogo ao
   mesmo tempo) é exatamente o momento em que não há esse orçamento.

   TRÊS DECISÕES:

   1. NADA É ALOCADO EM VOO. Os buffers nascem com a capacidade máxima e as
      partículas vivas ficam EMPACOTADAS no começo do array: morrer é trocar de
      lugar com a última viva e diminuir o contador. Sem lista de livres, sem
      varredura, sem lixo — o custo de emitir e de matar é constante.

   2. O QUAD É ORIENTADO NO VERTEX SHADER, em espaço de câmera. Somar o vértice
      ao XY do ponto já transformado é um billboard exato e de graça; fazer isso
      na CPU custaria um quaternion por partícula por quadro.

   3. DOIS MATERIAIS, e só dois. Aditivo para o que EMITE (fogo, faísca, brasa)
      e alfa comum para o que OCULTA (terra, poeira, pena, vapor). São regras de
      mistura diferentes e não há como unir os dois num passe só; qualquer
      divisão mais fina que esta, por outro lado, seria draw call sem imagem.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { gameEvents, EventType } from "../core/events.js";

const VERT = /* glsl */ `
  attribute vec3 iOffset;
  attribute vec3 iColor;
  attribute vec2 iScaleAlpha; // x = tamanho (m), y = opacidade

  varying vec3 vColor;
  varying float vAlpha;
  varying vec2 vUv;

  void main() {
    vColor = iColor;
    vAlpha = iScaleAlpha.y;
    vUv = uv;
    // Billboard: o ponto vai para o espaço da câmera e o quad é somado ali, no
    // plano da tela. Sem matriz de rotação, sem trabalho na CPU.
    vec4 mv = modelViewMatrix * vec4(iOffset, 1.0);
    mv.xy += position.xy * iScaleAlpha.x;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying vec2 vUv;

  void main() {
    /* Recorte radial macio no próprio fragmento: uma partícula é um disco com
       borda suave, e gerar isso aqui evita carregar (e amostrar) uma textura
       para desenhar aquilo que uma subtração resolve. */
    vec2 d = vUv - 0.5;
    float r = dot(d, d) * 4.0;
    float a = vAlpha * (1.0 - smoothstep(0.35, 1.0, r));
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Um lote: uma geometria instanciada e o estado em CPU das suas partículas. */
class Batch {
  constructor(scene, capacity, blending, renderOrder) {
    this.capacity = capacity;
    this.live = 0;

    this.offset = new Float32Array(capacity * 3);
    this.color = new Float32Array(capacity * 3);
    this.scaleAlpha = new Float32Array(capacity * 2);

    // Estado que só a CPU vê — não vai para a GPU.
    this.vel = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);

    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute("position", quad.attributes.position);
    geo.setAttribute("uv", quad.attributes.uv);
    this.aOffset = new THREE.InstancedBufferAttribute(this.offset, 3).setUsage(
      THREE.DynamicDrawUsage,
    );
    this.aColor = new THREE.InstancedBufferAttribute(this.color, 3).setUsage(
      THREE.DynamicDrawUsage,
    );
    this.aScaleAlpha = new THREE.InstancedBufferAttribute(this.scaleAlpha, 2).setUsage(
      THREE.DynamicDrawUsage,
    );
    geo.setAttribute("iOffset", this.aOffset);
    geo.setAttribute("iColor", this.aColor);
    geo.setAttribute("iScaleAlpha", this.aScaleAlpha);
    geo.instanceCount = 0;

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending,
      // A névoa não entra: as partículas são efeito de perto (o mais distante é
      // um zumbi queimando a 40 m), e o passe de névoa exigiria a posição de
      // mundo interpolada só para escurecer o que já vai sumir em meio segundo.
      fog: false,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    // A caixa envolvente de um pool que se move o tempo todo não significa nada:
    // ou é recalculada por quadro (caro) ou descarta partículas válidas.
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.geo = geo;
    this.scene = scene;
  }

  /**
   * Uma partícula. Devolve false quando o pool está cheio — e o chamador NÃO
   * deve tratar isso como erro: estourar o teto significa que já há tanta coisa
   * na tela que mais uma não seria vista.
   */
  spawn(x, y, z, vx, vy, vz, r, g, b, size, grow, life, gravity, drag, alpha) {
    if (this.live >= this.capacity) return false;
    const i = this.live++;
    const i3 = i * 3;
    this.offset[i3] = x;
    this.offset[i3 + 1] = y;
    this.offset[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.color[i3] = r;
    this.color[i3 + 1] = g;
    this.color[i3 + 2] = b;
    this.scaleAlpha[i * 2] = size;
    this.scaleAlpha[i * 2 + 1] = alpha;
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = size;
    this.grow[i] = grow;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
    this.alpha0[i] = alpha;
    return true;
  }

  /** Troca a morta pela última viva: manter o array empacotado é o pool inteiro. */
  swapRemove(i) {
    const last = --this.live;
    if (i === last) return;
    const i3 = i * 3;
    const l3 = last * 3;
    for (let k = 0; k < 3; k++) {
      this.offset[i3 + k] = this.offset[l3 + k];
      this.color[i3 + k] = this.color[l3 + k];
      this.vel[i3 + k] = this.vel[l3 + k];
    }
    this.scaleAlpha[i * 2] = this.scaleAlpha[last * 2];
    this.scaleAlpha[i * 2 + 1] = this.scaleAlpha[last * 2 + 1];
    this.age[i] = this.age[last];
    this.life[i] = this.life[last];
    this.size0[i] = this.size0[last];
    this.grow[i] = this.grow[last];
    this.gravity[i] = this.gravity[last];
    this.drag[i] = this.drag[last];
    this.alpha0[i] = this.alpha0[last];
  }

  update(dt) {
    for (let i = this.live - 1; i >= 0; i--) {
      this.age[i] += dt;
      const p = this.age[i] / this.life[i];
      if (p >= 1) {
        this.swapRemove(i);
        continue;
      }
      const i3 = i * 3;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= k;
      this.vel[i3 + 1] = this.vel[i3 + 1] * k + this.gravity[i] * dt;
      this.vel[i3 + 2] *= k;
      this.offset[i3] += this.vel[i3] * dt;
      this.offset[i3 + 1] += this.vel[i3 + 1] * dt;
      this.offset[i3 + 2] += this.vel[i3 + 2] * dt;
      this.scaleAlpha[i * 2] = this.size0[i] * (1 + this.grow[i] * p);
      // Some pelo fim, não linearmente: partícula que apaga em rampa reta
      // parece um interruptor, e o olho vê a hora exata em que ela sumiu.
      this.scaleAlpha[i * 2 + 1] = this.alpha0[i] * (1 - p) * (1 - p);
    }

    const havia = this.geo.instanceCount;
    this.geo.instanceCount = this.live;
    this.mesh.visible = this.live > 0;
    if (this.live === 0 && havia === 0) return;
    this.aOffset.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aScaleAlpha.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geo.dispose();
    this.mesh.material.dispose();
  }
}

const _c = new THREE.Color();

/**
 * A fachada. Todo mundo no jogo emite por aqui.
 *
 * `emit` recebe uma RECEITA e não partículas prontas: cor, quantidade, a que
 * velocidade saem, quanto pesam e quanto duram. Sortear os detalhes aqui dentro
 * é o que impede quinze chamadores de inventarem quinze dispersões diferentes —
 * e é onde se garante que nada disso aloque nada.
 */
export class ParticleSystem {
  /**
   * O teto do lote opaco subiu de 256 para 384 por causa do RASTRO DE FUMAÇA do
   * jetpack (`systems/jetSmoke.js`): ele é o único efeito contínuo E multiplicado
   * por jogador do jogo — ~29 partículas vivas por pessoa voando. Com 256, meia
   * dúzia de gente no ar na Lua consumia o lote inteiro e a poeira dos pés, a
   * terra da flechada e o estilhaço do meteorito paravam de aparecer.
   *
   * As 128 a mais custam 9 KB de `Float32Array` e 128 iterações de aritmética
   * simples por quadro no pior caso — não há chamada de desenho nova, porque o
   * lote inteiro continua sendo UMA geometria instanciada.
   */
  constructor(scene, { additive = 192, alpha = 384 } = {}) {
    this.fire = new Batch(scene, additive, THREE.AdditiveBlending, 7);
    this.dust = new Batch(scene, alpha, THREE.NormalBlending, 6);
    // Como o áudio: quem emite manda um evento e não conhece este objeto.
    gameEvents.on(EventType.PARTICLES, (e) => this.emit(e));
  }

  /** Quantas partículas existem agora — o painel de depuração mostra isto. */
  get count() {
    return this.fire.live + this.dust.live;
  }

  /**
   * @param {object} o
   * @param {{x,y,z}} o.position de onde saem
   * @param {number} [o.count] quantas
   * @param {number|THREE.Color} [o.color] cor base
   * @param {number} [o.colorJitter] variação de brilho entre elas (0..1)
   * @param {number} [o.speed] velocidade inicial (m/s)
   * @param {number} [o.spread] fração da velocidade sorteada em direção aleatória
   * @param {{x,y,z}} [o.direction] direção preferencial (normalizada ou não)
   * @param {number} [o.size] lado do quad (m)
   * @param {number} [o.grow] quanto o tamanho cresce ao longo da vida
   * @param {number} [o.life] duração (s), com ±25 % de sorteio
   * @param {number} [o.gravity] aceleração em Y (m/s²)
   * @param {number} [o.drag] freio exponencial (1/s)
   * @param {number} [o.alpha] opacidade inicial
   * @param {boolean} [o.additive] true = emite luz; false = oculta o fundo
   */
  emit({
    position,
    count = 8,
    color = 0xffffff,
    colorJitter = 0.25,
    speed = 2,
    spread = 1,
    direction = null,
    size = 0.12,
    grow = 0.6,
    life = 0.6,
    gravity = -3,
    drag = 1.2,
    alpha = 1,
    additive = false,
  }) {
    if (!position) return;
    const batch = additive ? this.fire : this.dust;
    _c.set(color);
    const dx = direction?.x ?? 0;
    const dy = direction?.y ?? 0;
    const dz = direction?.z ?? 0;
    const dlen = Math.hypot(dx, dy, dz) || 1;

    for (let i = 0; i < count; i++) {
      // Direção sorteada numa esfera, misturada com a preferencial pelo
      // `spread`: 0 = jato reto, 1 = explosão isotrópica.
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - u * u));
      const sx = Math.cos(a) * r;
      const sy = u;
      const sz = Math.sin(a) * r;
      const v = speed * (0.55 + Math.random() * 0.75);
      const vx = (sx * spread + (dx / dlen) * (1 - spread)) * v;
      const vy = (sy * spread + (dy / dlen) * (1 - spread)) * v;
      const vz = (sz * spread + (dz / dlen) * (1 - spread)) * v;

      const j = 1 - colorJitter * Math.random();
      if (
        !batch.spawn(
          position.x,
          position.y,
          position.z,
          vx,
          vy,
          vz,
          _c.r * j,
          _c.g * j,
          _c.b * j,
          size * (0.7 + Math.random() * 0.6),
          grow,
          life * (0.75 + Math.random() * 0.5),
          gravity,
          drag,
          alpha,
        )
      ) {
        return; // pool cheio: o resto do lote não caberia mesmo
      }
    }
  }

  update(dt) {
    this.fire.update(dt);
    this.dust.update(dt);
  }

  dispose() {
    this.fire.dispose();
    this.dust.dispose();
  }
}
