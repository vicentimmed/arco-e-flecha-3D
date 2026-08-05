/* ---------------------------------------------------------------------------
   Traçados de trajetória.

   Cada flecha desenha o caminho que ela REALMENTE percorreu — os pontos são
   amostrados da posição do corpo rígido durante o voo, não de uma curva
   prevista. Por isso o traçado mostra o efeito do arrasto e do vento em vez de
   uma parábola ideal.

   O traçado do tiro anterior desaparece gradualmente assim que o mesmo dono
   dispara outra flecha. O traçado da flecha atual permanece visível; os
   anteriores ficam apenas durante a animação de saída.

   A regra é POR DONO. Um pool único faria o jogador que atira apagar o traçado
   atual dos amigos, em vez de cada jogador manter visível apenas seu último
   disparo no multiplayer.

   O buffer é PRÉ-ALOCADO uma vez e escrito no lugar.

   Antes, cada atualização criava uma `BufferGeometry` nova com um
   `Float32Array` novo. Funcionava enquanto o voo era curto — mas um tiro alto
   voa 15 s, enche os 700 pontos e, a partir daí, fica sujo a CADA passo de
   física: 120 alocações de 2 100 floats por segundo, cada uma com reenvio para
   a GPU. Era isso que fazia o jogo engasgar quando a flecha ia longe demais.

   Cheio, o traçado é DECIMADO em vez de truncado: fica um ponto a cada dois e
   a amostragem passa a ser mais espaçada. O caminho continua inteiro, do
   disparo ao impacto — só com menos resolução — em vez de perder o começo.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG } from "../config.js";

/* ------------------------------------------------------------------ fita ---

   O traçado deixou de ser `THREE.Line` e virou uma FITA.

   O problema da linha: `THREE.Line` desenha com `gl_LineWidth`, que a maioria
   das implementações de WebGL trava em 1 px. Numa tela retina isso é meio pixel
   físico — a linha cintila quando a câmera se move, some em ângulos rasantes e,
   pior, tem a MESMA espessura a três metros e a trezentos. Ela não tem
   perspectiva, e por isso não conta distância nenhuma.

   A fita resolve os três: cada ponto do traçado vira DOIS vértices, e o vertex
   shader os afasta perpendicularmente à direção do voo, no plano da tela. A
   largura passa a ser escolhida em pixels e a fita afina para a cauda, o que dá
   a leitura de "por aqui ela veio".

   O que NÃO muda: continua uma chamada de desenho por traçado, e os buffers
   continuam pré-alocados e escritos no lugar (ver o cabeçalho do arquivo). O
   dobro de vértices de uma linha de 700 pontos são 1 400 vértices — nada. */

const RIBBON_VERT = /* glsl */ `
  attribute float side;    // -1 ou +1: de que lado do eixo este vértice fica
  attribute vec3 dir;      // tangente do voo neste ponto
  attribute float slot;    // posição do ponto no buffer (para o afinamento)

  uniform float count;     // quantos pontos valem agora
  uniform float widthPx;   // espessura desejada, em pixels de tela
  uniform float pixelScale; // metros por pixel a um metro de distância

  varying float vFade;

  void main() {
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );

    /* Largura CONSTANTE EM TELA: a espessura em metros cresce com a distância
       na mesma proporção em que a perspectiva a encolheria. É o que impede a
       fita de virar um fio invisível a duzentos metros — que é justamente onde
       o traçado mais importa, porque é onde o jogador não vê a flecha. */
    float dist = max( -mv.z, 0.05 );
    float w = widthPx * pixelScale * dist * 0.5;

    /* Afinamento: 55 % da largura na cauda, 100 % na cabeça. É esse gradiente
       que dá SENTIDO à fita — sem ele, os dois extremos são iguais e não se
       sabe para que lado a flecha foi. */
    float t = clamp( slot / max( count - 1.0, 1.0 ), 0.0, 1.0 );
    w *= mix( 0.55, 1.0, t );
    vFade = t;

    /* A perpendicular sai do produto vetorial entre a tangente do voo e a
       direção do olho — as duas em espaço de câmera. O resultado é sempre
       paralelo à tela, então a fita nunca aparece de perfil (que é como uma
       fita mal orientada some). */
    vec3 tang = normalize( mat3( modelViewMatrix ) * dir );
    vec3 toEye = normalize( -mv.xyz );
    vec3 perp = cross( tang, toEye );
    float len = length( perp );
    // Tangente paralela ao olhar (a flecha vindo na sua direção): sem
    // perpendicular definida. Qualquer eixo da tela serve.
    perp = len > 1e-4 ? perp / len : vec3( 1.0, 0.0, 0.0 );

    mv.xyz += perp * ( w * side );
    gl_Position = projectionMatrix * mv;
  }
`;

const RIBBON_FRAG = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  varying float vFade;

  void main() {
    /* A cauda também apaga, não só afina. Duas pistas para a mesma informação
       (de onde veio, para onde foi) é o que faz a leitura ser instantânea. */
    gl_FragColor = vec4( color, opacity * mix( 0.25, 1.0, vFade ) );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

class Trail {
  constructor(ownerId = null, color = CONFIG.trail.color) {
    this.ownerId = ownerId;
    this.color = color;
    const max = CONFIG.trail.maxPoints;
    /* Buffers fixos, escritos no lugar. Nunca realocados.
       DOIS vértices por ponto: a fita é uma tira de quads. */
    this.positions = new Float32Array(max * 2 * 3);
    this.dirs = new Float32Array(max * 2 * 3);
    this.count = 0; // pontos escritos (não vértices)
    this.minSegment = CONFIG.trail.minSegment;
    this.finished = false;
    this.age = 0; // s desde que ficou pronto
    this.line = null;
    this.dirty = false;
  }

  /** Registra um ponto, respeitando a distância mínima entre amostras. */
  push(x, y, z) {
    if (this.finished) return;
    const p = this.positions;
    const n = this.count;
    if (n > 0) {
      const i = (n - 1) * 6; // dois vértices por ponto ⇒ passo de 6 floats
      const dx = x - p[i];
      const dy = y - p[i + 1];
      const dz = z - p[i + 2];
      const min = this.minSegment;
      if (dx * dx + dy * dy + dz * dz < min * min) return;
    }
    if (n >= CONFIG.trail.maxPoints) this.decimate();
    this.writePoint(this.count, x, y, z);
    this.count++;
    this.dirty = true;
  }

  /**
   * Escreve os dois vértices de um ponto e resolve a tangente.
   *
   * A tangente do ponto novo vem do segmento que chega nele; a do ponto
   * ANTERIOR é corrigida junto, para que o primeiro segmento não fique com
   * tangente zero — uma tangente nula dá perpendicular nula, e o quad
   * colapsaria numa linha de largura zero bem no começo do traçado.
   */
  writePoint(i, x, y, z) {
    const p = this.positions;
    const d = this.dirs;
    const w = i * 6;
    p[w] = x;
    p[w + 1] = y;
    p[w + 2] = z;
    p[w + 3] = x;
    p[w + 4] = y;
    p[w + 5] = z;

    if (i === 0) {
      // Sem ponto anterior ainda: um eixo qualquer, corrigido no próximo push.
      d[w] = 0;
      d[w + 1] = 0;
      d[w + 2] = 1;
      d[w + 3] = 0;
      d[w + 4] = 0;
      d[w + 5] = 1;
      return;
    }

    const q = (i - 1) * 6;
    let tx = x - p[q];
    let ty = y - p[q + 1];
    let tz = z - p[q + 2];
    const len = Math.hypot(tx, ty, tz) || 1;
    tx /= len;
    ty /= len;
    tz /= len;
    for (const base of [w, q]) {
      d[base] = tx;
      d[base + 1] = ty;
      d[base + 2] = tz;
      d[base + 3] = tx;
      d[base + 4] = ty;
      d[base + 5] = tz;
    }
  }

  /**
   * Encheu: fica um ponto a cada dois e a amostragem dobra de passo.
   *
   * Descartar os mais antigos apagaria o começo do voo — justamente a parte
   * mais informativa do traçado, que é de onde a flecha saiu. Decimar preserva
   * o caminho inteiro com metade da resolução, e o custo é pago uma única vez
   * a cada duplicação do alcance.
   */
  decimate() {
    const p = this.positions;
    const d = this.dirs;
    let w = 0;
    for (let r = 0; r < this.count; r += 2, w++) {
      const from = r * 6;
      const to = w * 6;
      for (let k = 0; k < 6; k++) {
        p[to + k] = p[from + k];
        d[to + k] = d[from + k];
      }
    }
    this.count = w;
    this.minSegment *= 2;
  }

  /** Fecha o traçado no ponto de impacto e começa a contar o tempo de vida. */
  finish(x, y, z) {
    if (this.finished) return;
    if (x !== undefined && this.count < CONFIG.trail.maxPoints) {
      this.writePoint(this.count, x, y, z);
      this.count++;
      this.dirty = true;
    }
    this.finished = true;
    this.age = 0;
  }

  /** Começa imediatamente o fade de um traçado substituído por outro tiro. */
  fadeOut() {
    this.finished = true;
    this.age = Math.max(this.age, CONFIG.trail.holdTime);
  }

  get opacity() {
    if (!this.finished) return 1;
    const { holdTime, fadeTime } = CONFIG.trail;
    if (this.age <= holdTime) return 1;
    return Math.max(0, 1 - (this.age - holdTime) / fadeTime);
  }

  get expired() {
    return this.finished && this.age > CONFIG.trail.holdTime + CONFIG.trail.fadeTime;
  }

  dispose(scene) {
    if (!this.line) return;
    scene.remove(this.line);
    this.line.geometry.dispose();
    this.line.material.dispose();
    this.line = null;
  }
}

/* --------------------------------------------- topologia compartilhada ---

   `side`, `slot` e o índice descrevem a FORMA da tira, não o voo: são iguais
   para todo traçado que já existiu e para todo traçado que ainda vai existir.
   Criados sob demanda e reaproveitados, eles saem da conta por flecha — com
   90 traçados vivos, seriam 270 buffers de setecentos pontos guardando sempre
   os mesmos números. */

let SIDE = null;
let SLOT = null;
let INDEX = null;

function sharedSide() {
  if (SIDE) return SIDE;
  const n = CONFIG.trail.maxPoints;
  const a = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    a[i * 2] = -1;
    a[i * 2 + 1] = 1;
  }
  SIDE = new THREE.BufferAttribute(a, 1);
  return SIDE;
}

function sharedSlot() {
  if (SLOT) return SLOT;
  const n = CONFIG.trail.maxPoints;
  const a = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    a[i * 2] = i;
    a[i * 2 + 1] = i;
  }
  SLOT = new THREE.BufferAttribute(a, 1);
  return SLOT;
}

function sharedIndex() {
  if (INDEX) return INDEX;
  const n = CONFIG.trail.maxPoints;
  // Dois triângulos por segmento, ligando o par de vértices i ao par i+1.
  const a = new Uint16Array((n - 1) * 6);
  for (let i = 0; i < n - 1; i++) {
    const v = i * 2;
    const k = i * 6;
    a[k] = v;
    a[k + 1] = v + 1;
    a[k + 2] = v + 2;
    a[k + 3] = v + 1;
    a[k + 4] = v + 3;
    a[k + 5] = v + 2;
  }
  INDEX = new THREE.BufferAttribute(a, 1);
  return INDEX;
}

export class TrailManager {
  constructor(scene) {
    this.scene = scene;
    this.trails = [];
    this.enabled = CONFIG.trail.enabled;
    /* Metros por pixel a UM metro de distância — o fator que converte a
       espessura pedida em pixels para a espessura em metros que o shader
       aplica. Sai do FOV vertical e da altura da janela, e é reescrito no
       `setResolution` (que o `main.js` já chamava no `resize`). */
    this.pixelScale = 1 / 540;
    this.setResolution(window.innerWidth, window.innerHeight);
  }

  /**
   * A janela mudou de tamanho.
   *
   * A conta é a altura do frustum a um metro (2·tan(fov/2)) dividida pela
   * altura da janela em pixels. Com ela, "4 px" continua sendo 4 px depois de
   * redimensionar a janela ou de mudar o FOV.
   */
  setResolution(width, height) {
    const fov = (CONFIG.camera.fov * Math.PI) / 180;
    this.pixelScale = (2 * Math.tan(fov / 2)) / Math.max(1, height);
  }

  setEnabled(on) {
    this.enabled = on;
    for (const t of this.trails) {
      if (t.line) t.line.visible = on;
    }
  }

  /**
   * Cria o traçado do novo disparo e inicia o fade do anterior do mesmo dono.
   *
   * @param {number|string|null} ownerId quem atirou
   * @param {number} color cor da linha (a do dono, no multiplayer)
   */
  create(ownerId = null, color = CONFIG.trail.color) {
    for (const previous of this.trails) {
      if (previous.ownerId === ownerId) previous.fadeOut();
    }
    const trail = new Trail(ownerId, color);
    this.trails.push(trail);
    this.evict(ownerId);
    return trail;
  }

  /**
   * Aposenta os mais antigos DO MESMO DONO ao estourar a cota, e só então
   * recorre ao teto global — que existe apenas para a memória não crescer sem
   * limite, e não deveria ser o que decide o que some.
   */
  evict(ownerId) {
    const { maxTrailsPerPlayer, maxTrailsTotal } = CONFIG.trail;

    let mine = 0;
    for (const t of this.trails) if (t.ownerId === ownerId) mine++;
    for (let i = 0; i < this.trails.length && mine > maxTrailsPerPlayer; i++) {
      if (this.trails[i].ownerId !== ownerId) continue;
      this.trails.splice(i, 1)[0].dispose(this.scene);
      i--;
      mine--;
    }

    while (this.trails.length > maxTrailsTotal) {
      this.trails.shift().dispose(this.scene);
    }
  }

  update(dt) {
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const trail = this.trails[i];
      if (trail.finished) trail.age += dt;

      if (trail.expired) {
        trail.dispose(this.scene);
        this.trails.splice(i, 1);
        continue;
      }
      this.refresh(trail);
    }
  }

  refresh(trail) {
    if (trail.count < 2) return; // menos de dois pontos: nada a traçar

    if (!trail.line) {
      const material = new THREE.ShaderMaterial({
        vertexShader: RIBBON_VERT,
        fragmentShader: RIBBON_FRAG,
        transparent: true,
        depthWrite: false,
        // A fita é uma tira de quads sem espessura: vista pelas costas ela
        // continua sendo a mesma fita, e cortar a face de trás abriria buracos
        // nas curvas fechadas do voo.
        side: THREE.DoubleSide,
        uniforms: {
          color: { value: new THREE.Color(trail.color) },
          opacity: { value: 1 },
          count: { value: 2 },
          widthPx: { value: CONFIG.trail.width },
          pixelScale: { value: this.pixelScale },
        },
      });

      const geometry = new THREE.BufferGeometry();
      const attr = new THREE.BufferAttribute(trail.positions, 3);
      // O buffer é escrito muitas vezes e nunca lido de volta pela CPU.
      attr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("position", attr);
      const dirAttr = new THREE.BufferAttribute(trail.dirs, 3);
      dirAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("dir", dirAttr);
      /* `side` e `slot` são ESTÁTICOS e compartilhados por todos os traçados:
         eles descrevem a topologia da fita (que vértice é de que lado, e qual é
         a posição dele na tira), e isso não depende do voo. O mesmo vale para o
         índice. Três buffers de 700 pontos criados uma vez para o jogo inteiro,
         em vez de três por flecha disparada. */
      geometry.setAttribute("side", sharedSide());
      geometry.setAttribute("slot", sharedSlot());
      geometry.setIndex(sharedIndex());

      trail.line = new THREE.Mesh(geometry, material);
      trail.line.frustumCulled = false;
      trail.line.renderOrder = 3;
      trail.line.visible = this.enabled;
      this.scene.add(trail.line);
    }

    if (trail.dirty) {
      /* Nada é realocado: só marcamos os buffers como sujos e dizemos quantos
         índices valem. `setDrawRange` é o que permite um buffer de tamanho fixo
         desenhar uma fita que ainda está crescendo — e como cada segmento são
         dois triângulos, o alcance é (pontos − 1) × 6. */
      const geo = trail.line.geometry;
      const pos = geo.getAttribute("position");
      const dir = geo.getAttribute("dir");
      const floats = trail.count * 6;
      pos.needsUpdate = true;
      pos.updateRanges = [{ start: 0, count: floats }];
      dir.needsUpdate = true;
      dir.updateRanges = [{ start: 0, count: floats }];
      geo.setDrawRange(0, (trail.count - 1) * 6);
      trail.line.material.uniforms.count.value = trail.count;
      trail.dirty = false;
    }

    const opacity = trail.opacity;
    trail.line.material.uniforms.opacity.value = opacity;
    trail.line.material.uniforms.pixelScale.value = this.pixelScale;
    trail.line.visible = this.enabled && opacity > 0.001;
  }

  /**
   * Apaga traçados. Sem argumento apaga tudo; com um dono, só os dele — que é
   * o que a tecla de limpar precisa fazer no multiplayer, para não varrer da
   * tela o tiro que o amigo acabou de dar.
   */
  clear(ownerId = undefined) {
    if (ownerId === undefined) {
      for (const t of this.trails) t.dispose(this.scene);
      this.trails.length = 0;
      return;
    }
    for (let i = this.trails.length - 1; i >= 0; i--) {
      if (this.trails[i].ownerId !== ownerId) continue;
      this.trails.splice(i, 1)[0].dispose(this.scene);
    }
  }
}
