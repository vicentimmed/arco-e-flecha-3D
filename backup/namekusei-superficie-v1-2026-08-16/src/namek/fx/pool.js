/* ---------------------------------------------------------------------------
   O alicerce dos efeitos de destruição: três pools, quatro chamadas de desenho.

   Este arquivo é IRMÃO de `src/systems/particles.js`, não filho dele. O pool do
   arqueiro é ótimo no que faz — faísca de zumbi, terra de flechada, pena de
   pássaro — e é justamente por isso que ele não serve aqui: ele foi dimensionado
   para partículas de dez centímetros vivendo meio segundo, e o que Namekusei
   precisa é de nuvens de dez METROS vivendo dois segundos e meio, de pedras que
   quicam contra um campo de altura e de um anel de choque deitado no chão.
   Estender aquele arquivo para caber isto seria mexer num sistema de que o jogo
   do arqueiro depende — o que o §0 e o §11 do plano proíbem, e com razão.

   Então: mesmas TRÊS DECISÕES de lá, porque elas estão certas, e mais três
   próprias daqui.

   As de lá, herdadas de propósito:

   1. NADA É ALOCADO EM VOO. Os buffers nascem com a capacidade máxima e as
      partículas vivas ficam EMPACOTADAS no começo dos arrays: morrer é trocar de
      lugar com a última viva e diminuir o contador. Sem lista de livres, sem
      varredura, sem lixo. O §3 do plano cobra ZERO byte por quadro em regime, e
      isso só existe se o alicerce nunca chamar `new` depois do construtor.

   2. O QUAD É ORIENTADO NO VERTEX SHADER, em espaço de câmera. Somar o vértice
      ao XY do ponto já transformado é um billboard exato e de graça.

   3. UM MATERIAL POR REGRA DE MISTURA. Aditivo para o que EMITE (clarão,
      fagulha) e alfa comum para o que OCULTA (poeira). Não há como unir os dois
      num passe só, e qualquer divisão mais fina que esta é chamada de desenho
      sem imagem nova.

   As três próprias:

   4. A PARTÍCULA DE POEIRA GIRA E NÃO É REDONDA. Um disco perfeito, parado,
      repetido cinquenta vezes, lê como bolha de sabão — o olho reconhece o
      círculo e a nuvem inteira vira um aglomerado de bolinhas. O `vertex` gira
      cada quad no próprio eixo e o `fragment` deforma o raio com três lóbulos
      girados por uma semente da partícula. Custa um seno, um cosseno e seis
      multiplicações; devolve uma silhueta que ninguém consegue contar.

   5. A PEDRA TEM VOLUME, então ela não pode ser um quad. Um billboard escuro
      voando é uma mosca; o que faz a pedrinha do BT3 ler como pedra é ela
      TOMBAR mostrando faces diferentes. Isso é `InstancedMesh` com matriz por
      instância — e uma matriz por instância por quadro cabe folgado em 288
      pedras.

   6. NENHUMA TEXTURA, e nenhum canvas. O recorte macio sai de uma subtração no
      próprio fragmento, exatamente como o pool do arqueiro já faz. É a regra da
      casa (§3 do plano: texturas carregadas = 0) e aqui ela nem custa nada:
      uma textura de poeira daria menos variedade do que os lóbulos procedurais.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { makeRandom } from "../../utils/math.js";

/* ------------------------------------------------------------------- cores --

   O renderizador do jogo trabalha em espaço LINEAR e entrega em sRGB
   (`renderer.outputColorSpace = SRGBColorSpace`, ver `core/renderer.js`). Uma
   constante `0xbfe8ff` escrita à mão é sRGB, e enviá-la crua ao shader deixaria
   toda a destruição lavada — visivelmente mais clara que o resto da cena.

   `THREE.Color.set()` faria essa conversão, e o pool do arqueiro usa exatamente
   isso. Aqui não dá: `Color` é um objeto, e o caminho que chama esta função é o
   caminho do impacto — que num tiroteio de quinze lutadores acontece dezenas de
   vezes por segundo. A conta é de três linhas e é a MESMA de `THREE.SRGBToLinear`
   (comparada número a número no banco de provas), então ela vive aqui, sem
   objeto nenhum no meio. */

/** sRGB → linear. Cópia fiel de `SRGBToLinear` do Three.js. */
export function srgbParaLinear(c) {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

/**
 * Desempacota `0xrrggbb` em RGB linear dentro de um array do CHAMADOR.
 *
 * O destino é parâmetro, e não um `Float32Array` compartilhado deste módulo,
 * porque duas cores são desempacotadas no mesmo instante o tempo todo (a cor do
 * golpe e a cor da poeira, num impacto só) e um buffer único as embaralharia.
 * Cada módulo guarda o seu — três floats parados na memória valem mais que um
 * bug de cor que só aparece quando duas coisas acontecem juntas.
 */
export function decodeCor(hex, out) {
  out[0] = srgbParaLinear(((hex >> 16) & 255) / 255);
  out[1] = srgbParaLinear(((hex >> 8) & 255) / 255);
  out[2] = srgbParaLinear((hex & 255) / 255);
  return out;
}

/* ----------------------------------------------------------------- shaders -- */

const VERT = /* glsl */ `
  attribute vec3 iOffset;
  attribute vec3 iColor;
  /* x = lado do quad (m) · y = opacidade · z = giro (rad) · w = semente (rad) */
  attribute vec4 iParams;

  varying vec3 vColor;
  varying float vAlpha;
  varying vec2 vUv;
  varying vec2 vLobo;

  void main() {
    vColor = iColor;
    vAlpha = iParams.y;
    vUv = uv;
    /* A semente vira um par (cos, sin) aqui e não no fragmento: são quatro
       vértices por instância contra milhares de pixels. */
    vLobo = vec2(cos(iParams.w), sin(iParams.w));

    float c = cos(iParams.z);
    float s = sin(iParams.z);
    vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c);

    // Billboard: o ponto vai para o espaço da câmera e o quad é somado ali, no
    // plano da tela. Sem matriz de rotação, sem trabalho na CPU.
    vec4 mv = modelViewMatrix * vec4(iOffset, 1.0);
    mv.xy += q * iParams.x;
    gl_Position = projectionMatrix * mv;
  }
`;

/* A POEIRA. Borda larga e macia, e o raio deformado por três lóbulos.
 *
 * Os lóbulos saem por Chebyshev a partir de (cos θ, sin θ) — que é só o vetor
 * radial normalizado — e não de um `atan`. cos3θ = c(4c²−3), sin3θ = s(3−4s²).
 * Seis multiplicações contra uma função transcendental por pixel, numa
 * partícula que pode cobrir meia tela quando a Genki Dama cai. */
const FRAG_POEIRA = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying vec2 vUv;
  varying vec2 vLobo;

  void main() {
    vec2 d = vUv - 0.5;
    float r2 = dot(d, d);
    float r = sqrt(r2) * 2.0;

    // inversesqrt com piso: no pixel exatamente central o vetor é nulo e
    // normalize() devolveria NaN — que na GPU vira um pixel preto piscando.
    vec2 u = d * inversesqrt(max(r2, 1e-6));
    float c = u.x;
    float s = u.y;
    float cos3 = c * (4.0 * c * c - 3.0);
    float sin3 = s * (3.0 - 4.0 * s * s);
    r *= 1.0 - 0.17 * (cos3 * vLobo.x + sin3 * vLobo.y);

    float a = vAlpha * (1.0 - smoothstep(0.10, 1.0, r));
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* O BRILHO. Núcleo apertado e branco, halo curto. É o oposto da poeira: ela
 * esconde, ele informa. O `k^6` puxa o centro para o branco sem exigir uma
 * segunda partícula por cima — o degradê branco→cor num sprite só. */
const FRAG_BRILHO = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying vec2 vUv;
  varying vec2 vLobo;

  void main() {
    vec2 d = vUv - 0.5;
    float r = sqrt(dot(d, d)) * 2.0;
    float k = 1.0 - min(r, 1.0);
    float k2 = k * k;
    float a = vAlpha * k2 * (0.55 + 0.45 * k);
    if (a < 0.004) discard;
    vec3 col = vColor + vec3(0.85) * (k2 * k2 * k2);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* -------------------------------------------------------------- SpritePool -- */

/**
 * Um lote de billboards: uma geometria instanciada e o estado em CPU dela.
 *
 * Duas instâncias deste pool cobrem tudo o que é fumaça ou luz no modo — a
 * poeira (alfa comum) e o brilho (aditivo). A diferença entre elas é o material
 * e o ajuste dos parâmetros; o motor é este.
 */
export class SpritePool {
  /**
   * @param {THREE.Scene} scene
   * @param {number} capacity teto de partículas vivas
   * @param {string} tipo "poeira" (alfa, silhueta irregular) ou "brilho" (aditivo)
   * @param {number} renderOrder ordem de desenho
   * @param {number} entrada fração da vida em que a opacidade sobe do zero
   */
  constructor(scene, capacity, tipo, renderOrder, entrada = 0.06) {
    this.capacity = capacity;
    this.live = 0;
    this.entrada = entrada;

    /* O que vai para a GPU. */
    this.offset = new Float32Array(capacity * 3);
    this.color = new Float32Array(capacity * 3);
    this.params = new Float32Array(capacity * 4);

    /* O que só a CPU vê. */
    this.vel = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    /** 0 = some linear (segura no ar) · 1 = some com o cubo (estala e acaba). */
    this.curva = new Float32Array(capacity);
    this.giroVel = new Float32Array(capacity);
    /** Cota do chão sob a partícula. `-Infinity` desliga a barreira. */
    this.chao = new Float32Array(capacity);

    /* Um quad POR LOTE, e não um compartilhado entre os dois. Emprestar o mesmo
       `BufferAttribute` a duas geometrias funciona no desenho, mas o `dispose`
       de uma delas manda o Three.js apagar o buffer de GPU daquele atributo — e
       o outro lote, que ainda o usa, teria de reenviá-lo. Quatro vértices
       duplicados custam 48 bytes; o acoplamento custaria uma noite de
       depuração. É o mesmo caminho que `systems/particles.js` já toma. */
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
    this.aParams = new THREE.InstancedBufferAttribute(this.params, 4).setUsage(
      THREE.DynamicDrawUsage,
    );
    geo.setAttribute("iOffset", this.aOffset);
    geo.setAttribute("iColor", this.aColor);
    geo.setAttribute("iParams", this.aParams);
    geo.instanceCount = 0;

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: tipo === "brilho" ? FRAG_BRILHO : FRAG_POEIRA,
      transparent: true,
      depthWrite: false,
      blending: tipo === "brilho" ? THREE.AdditiveBlending : THREE.NormalBlending,
      /* A névoa fica de fora. A poeira já é clara e já desaparece sozinha; passar
         a posição de mundo interpolada só para escurecer o que some em dois
         segundos é um varying a mais por partícula em troca de nada. */
      fog: false,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    /* Caixa envolvente de um pool que se move o tempo todo não significa nada:
       ou é recalculada por quadro (caro) ou descarta partícula válida. O corte
       por distância que este pool faz sozinho já cobre o caso que importa. */
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.geo = geo;
    this.scene = scene;
  }

  /**
   * Uma partícula.
   *
   * Dezoito argumentos posicionais, e isso é deliberado: um objeto de receita
   * seria uma alocação por partícula, e a Genki Dama emite setenta de uma vez.
   * O pool do arqueiro já aceita quinze pelo mesmo motivo.
   *
   * Devolve `false` quando o pool está cheio — e o chamador NÃO deve tratar isso
   * como erro: estourar o teto significa que já há tanta coisa na tela que mais
   * uma não seria vista.
   *
   * @param {number} tam      lado do quad em metros
   * @param {number} cresce   quanto o lado cresce ao longo da vida (1 = dobra)
   * @param {number} vida     segundos
   * @param {number} grav     m/s² em Y (positivo = a poeira SOBE)
   * @param {number} arrasto  1/s — freio exponencial
   * @param {number} alfa     opacidade de pico
   * @param {number} curva    0 = segura no ar · 1 = estala e some
   * @param {number} rodopio  rad/s máximos de giro do quad
   * @param {number} chao     cota abaixo da qual ela não desce
   */
  spawn(x, y, z, vx, vy, vz, r, g, b, tam, cresce, vida, grav, arrasto, alfa, curva, rodopio, chao) {
    if (this.live >= this.capacity) return false;
    const i = this.live++;
    const i3 = i * 3;
    const i4 = i * 4;
    this.offset[i3] = x;
    this.offset[i3 + 1] = y;
    this.offset[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.color[i3] = r;
    this.color[i3 + 1] = g;
    this.color[i3 + 2] = b;
    this.params[i4] = tam;
    this.params[i4 + 1] = 0; // nasce invisível: quem a acende é `entrada`
    this.params[i4 + 2] = Math.random() * 6.2831853;
    this.params[i4 + 3] = Math.random() * 6.2831853;
    this.age[i] = 0;
    this.life[i] = vida;
    this.size0[i] = tam;
    this.grow[i] = cresce;
    this.gravity[i] = grav;
    this.drag[i] = arrasto;
    this.alpha0[i] = alfa;
    this.curva[i] = curva;
    this.giroVel[i] = (Math.random() * 2 - 1) * rodopio;
    this.chao[i] = chao;
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
    const i4 = i * 4;
    const l4 = last * 4;
    for (let k = 0; k < 4; k++) this.params[i4 + k] = this.params[l4 + k];
    this.age[i] = this.age[last];
    this.life[i] = this.life[last];
    this.size0[i] = this.size0[last];
    this.grow[i] = this.grow[last];
    this.gravity[i] = this.gravity[last];
    this.drag[i] = this.drag[last];
    this.alpha0[i] = this.alpha0[last];
    this.curva[i] = this.curva[last];
    this.giroVel[i] = this.giroVel[last];
    this.chao[i] = this.chao[last];
  }

  /**
   * @param {number} corte2 distância² da câmera acima da qual a partícula morre
   */
  update(dt, camX, camY, camZ, corte2) {
    for (let i = this.live - 1; i >= 0; i--) {
      this.age[i] += dt;
      const p = this.age[i] / this.life[i];
      if (p >= 1) {
        this.swapRemove(i);
        continue;
      }
      const i3 = i * 3;
      const i4 = i * 4;

      const k = 1 - this.drag[i] * dt;
      const kk = k > 0 ? k : 0;
      this.vel[i3] *= kk;
      this.vel[i3 + 1] = this.vel[i3 + 1] * kk + this.gravity[i] * dt;
      this.vel[i3 + 2] *= kk;
      this.offset[i3] += this.vel[i3] * dt;
      this.offset[i3 + 1] += this.vel[i3 + 1] * dt;
      this.offset[i3 + 2] += this.vel[i3 + 2] * dt;

      /* O CHÃO. Poeira que atravessa o terreno é a coisa que mais rápido
         denuncia que aquilo são quads soltos — metade do sopro some por baixo do
         mundo e a nuvem fica com uma mordida reta. Barrar em vez de refletir
         porque poeira não quica: ela ESCORREGA, e continuar com a velocidade
         horizontal é exatamente o que se quer. */
      if (this.offset[i3 + 1] < this.chao[i]) {
        this.offset[i3 + 1] = this.chao[i];
        if (this.vel[i3 + 1] < 0) this.vel[i3 + 1] = 0;
      }

      /* Corte por distância. Uma partícula a 400 m tem meio pixel e continua
         custando um quad, um `discard` e uma linha desta conta — ver §3. Ela é
         apagada aqui, e não só ignorada, porque enquanto ela existe ela ocupa
         uma vaga de que o impacto no colo da câmera precisa. */
      const dx = this.offset[i3] - camX;
      const dy = this.offset[i3 + 1] - camY;
      const dz = this.offset[i3 + 2] - camZ;
      if (dx * dx + dy * dy + dz * dz > corte2) {
        this.swapRemove(i);
        continue;
      }

      const q = 1 - p;

      /* O TAMANHO ABRE DE UMA VEZ E DEPOIS PARA. `1 − q²` é rápido no começo e
         quase horizontal no fim: a nuvem estoura para fora no primeiro terço e
         só flutua no resto. Crescimento linear daria uma nuvem inflando até o
         último quadro, que é a leitura de balão, não de poeira. */
      this.params[i4] = this.size0[i] * (1 + this.grow[i] * (1 - q * q));

      /* A OPACIDADE. Sobe em `entrada` (nada aparece com um estalo), e some por
         uma mistura entre reta e cubo escolhida por partícula: a poeira segura,
         a fagulha estala. Sem `Math.pow` — são novecentas partículas por quadro
         e a diferença entre uma interpolação e uma potência aparece no perfil. */
      const entrada = p < this.entrada ? p / this.entrada : 1;
      const c = this.curva[i];
      this.params[i4 + 1] = this.alpha0[i] * entrada * q * (c * q * q + (1 - c));

      this.params[i4 + 2] += this.giroVel[i] * dt;
    }

    const havia = this.geo.instanceCount;
    this.geo.instanceCount = this.live;
    this.mesh.visible = this.live > 0;
    if (this.live === 0 && havia === 0) return;
    this.aOffset.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aParams.needsUpdate = true;
  }

  clear() {
    this.live = 0;
    this.geo.instanceCount = 0;
    this.mesh.visible = false;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geo.dispose();
    this.mesh.material.dispose();
  }
}

/* ---------------------------------------------------------------- ChipPool -- */

/**
 * A LASCA. Uma só geometria para pedra, placa e farpa — e isso é o truque.
 *
 * Três `InstancedMesh` (um por material que quebra) seriam três chamadas de
 * desenho para mostrar a mesma quantidade de coisa. O que separa uma pedra de
 * uma telha de uma lasca de madeira, no tamanho em que elas aparecem — meio
 * metro voando a vinte metros de distância — não é a malha: é a SILHUETA e a
 * COR. Escala não uniforme por instância dá as duas de graça: (1,1,1) é seixo,
 * (1, 0,18, 0,9) é placa, (0,22, 0,22, 1,7) é farpa. Um buffer, um material,
 * uma chamada.
 *
 * O icosaedro é deformado por uma função contínua da DIREÇÃO do vértice, e não
 * por sorteio por vértice: a malha do Three.js não é indexada, cada canto
 * aparece cinco vezes, e um sorteio independente em cada cópia rasgaria o
 * sólido em vinte triângulos soltos.
 */
function chipGeometry() {
  const geo = new THREE.IcosahedronGeometry(0.5, 0);
  const pos = geo.attributes.position;
  const a = pos.array;
  for (let i = 0; i < a.length; i += 3) {
    const x = a[i];
    const y = a[i + 1];
    const z = a[i + 2];
    const inv = 1 / (Math.hypot(x, y, z) || 1);
    const nx = x * inv;
    const ny = y * inv;
    const nz = z * inv;
    const f = 1 + 0.26 * Math.sin(nx * 7.3 + ny * 11.7 + nz * 5.1) + 0.11 * Math.sin(nz * 17.3 - nx * 4.1);
    a[i] = x * f;
    a[i + 1] = y * f;
    a[i + 2] = z * f;
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export class ChipPool {
  /**
   * @param {THREE.Scene} scene
   * @param {number} capacity
   */
  constructor(scene, capacity) {
    this.capacity = capacity;
    this.live = 0;

    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.rot = new Float32Array(capacity * 3);
    this.rotVel = new Float32Array(capacity * 3);
    this.escala = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    /** 0 = ainda voando · 1 = já quicou uma vez · 2 = pousado, encolhendo. */
    this.estado = new Uint8Array(capacity);
    /** Elasticidade da lasca, sorteada no nascimento. */
    this.quique = new Float32Array(capacity);
    /* O CACHE DO CHÃO. `heightAt` é a função mais chamada do modo (ver o
       cabeçalho de `shared/namek/field.js`) e uma lasca a consultaria sessenta
       vezes por segundo pelos três segundos de voo — 288 lascas × 60 Hz = 17 mil
       consultas por segundo, cada uma com duas FBM de três oitavas. O terreno é
       liso na escala de um metro, então a cota só é reamostrada quando a lasca
       anda mais de `PASSO_CHAO` na horizontal. Corta as consultas por seis. */
    this.chao = new Float32Array(capacity);
    this.chaoX = new Float32Array(capacity);
    this.chaoZ = new Float32Array(capacity);

    const geo = chipGeometry();
    /* Emissivo baixo, não zero. Uma lasca escura contra o chão escuro de um
       impacto, sem luz dinâmica nenhuma (o orçamento de 3 já está tomado — §3 do
       plano), some. Um décimo de emissão a devolve à silhueta sem transformá-la
       numa brasa. */
    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      emissive: 0x11170f,
      flatShading: true,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    /* `instanceColor` é criado AQUI, e não pelo primeiro `setColorAt`: aquele
       caminho aloca o `InstancedBufferAttribute` na primeira pedra que voa, ou
       seja, no meio do primeiro impacto — que é exatamente o quadro em que o
       jogo não pode parar para pedir memória. */
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity * 3),
      3,
    ).setUsage(THREE.DynamicDrawUsage);
    this.cor = this.mesh.instanceColor.array;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
    this.scene = scene;
    this.geo = geo;
  }

  /**
   * Uma lasca.
   * @param {number} ex,ey,ez escala em cada eixo — é ela que dá a silhueta
   * @param {number} giro     rad/s máximos de tombo
   * @param {number} chaoY    cota do chão medida no nascimento
   */
  spawn(x, y, z, vx, vy, vz, r, g, b, ex, ey, ez, vida, giro, quique, chaoY) {
    if (this.live >= this.capacity) return false;
    const i = this.live++;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.rot[i3] = Math.random() * 6.2831853;
    this.rot[i3 + 1] = Math.random() * 6.2831853;
    this.rot[i3 + 2] = Math.random() * 6.2831853;
    this.rotVel[i3] = (Math.random() * 2 - 1) * giro;
    this.rotVel[i3 + 1] = (Math.random() * 2 - 1) * giro;
    this.rotVel[i3 + 2] = (Math.random() * 2 - 1) * giro;
    this.escala[i3] = ex;
    this.escala[i3 + 1] = ey;
    this.escala[i3 + 2] = ez;
    this.cor[i3] = r;
    this.cor[i3 + 1] = g;
    this.cor[i3 + 2] = b;
    this.age[i] = 0;
    this.life[i] = vida;
    this.estado[i] = 0;
    this.quique[i] = quique;
    this.chao[i] = chaoY;
    this.chaoX[i] = x;
    this.chaoZ[i] = z;
    return true;
  }

  swapRemove(i) {
    const last = --this.live;
    if (i === last) return;
    const i3 = i * 3;
    const l3 = last * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[i3 + k] = this.pos[l3 + k];
      this.vel[i3 + k] = this.vel[l3 + k];
      this.rot[i3 + k] = this.rot[l3 + k];
      this.rotVel[i3 + k] = this.rotVel[l3 + k];
      this.escala[i3 + k] = this.escala[l3 + k];
      this.cor[i3 + k] = this.cor[l3 + k];
    }
    this.age[i] = this.age[last];
    this.life[i] = this.life[last];
    this.estado[i] = this.estado[last];
    this.quique[i] = this.quique[last];
    this.chao[i] = this.chao[last];
    this.chaoX[i] = this.chaoX[last];
    this.chaoZ[i] = this.chaoZ[last];
  }

  clear() {
    this.live = 0;
    this.mesh.count = 0;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geo.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}

/* ---------------------------------------------------------------- RingPool -- */

/**
 * A onda de choque deitada no chão — a assinatura visual do BT3.
 *
 * Ela NÃO é um anel plano, e essa é a única decisão difícil do arquivo. Um disco
 * horizontal de trinta metros aberto sobre relevo ondulado atravessa o terreno
 * em metade da circunferência: fica meio anel na tela, e o defeito aparece
 * justamente nos impactos grandes, que são os que ninguém deixa de olhar.
 *
 * A saia resolve os dois casos de uma vez. A borda externa sobe, então o anel
 * passa por cima das ondulações em vez de mergulhar nelas — e uma onda de poeira
 * de verdade também sobe na borda, porque é ali que o ar está sendo empurrado.
 * O resto é vida curta: quatro décimos de segundo não dão tempo de ela chegar a
 * um relevo que a saia não vença.
 */
function ringGeometry(segmentos = 44) {
  const interno = 0.72;
  const externo = 1.0;
  const alturaInterna = 0.04;
  const alturaExterna = 0.19;
  const pos = new Float32Array(segmentos * 2 * 3);
  const idx = new Uint16Array(segmentos * 6);
  for (let i = 0; i < segmentos; i++) {
    const a = (i / segmentos) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const b = i * 6;
    pos[b] = c * interno;
    pos[b + 1] = alturaInterna;
    pos[b + 2] = s * interno;
    pos[b + 3] = c * externo;
    pos[b + 4] = alturaExterna;
    pos[b + 5] = s * externo;

    const i0 = i * 2;
    const i1 = i * 2 + 1;
    const j0 = ((i + 1) % segmentos) * 2;
    const j1 = j0 + 1;
    const t = i * 6;
    idx[t] = i0;
    idx[t + 1] = i1;
    idx[t + 2] = j1;
    idx[t + 3] = i0;
    idx[t + 4] = j1;
    idx[t + 5] = j0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return geo;
}

const _up = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

export class RingPool {
  constructor(scene, capacity) {
    this.capacity = capacity;
    this.live = 0;

    this.pos = new Float32Array(capacity * 3);
    /** Normal do terreno no ponto: a onda DEITA na encosta, não flutua sobre ela. */
    this.normal = new Float32Array(capacity * 3);
    this.corBase = new Float32Array(capacity * 3);
    this.raio = new Float32Array(capacity);
    this.raioVel = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.brilho = new Float32Array(capacity);

    const geo = ringGeometry();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    /* Aditivo: escurecer É desaparecer. Por isso a onda some pela `instanceColor`
       e não por uma opacidade por instância, que o Three.js não tem — e não
       precisa ter, porque somar zero é o mesmo que não desenhar. */
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity * 3),
      3,
    ).setUsage(THREE.DynamicDrawUsage);
    this.cor = this.mesh.instanceColor.array;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    /* DEPOIS da poeira (6 e 7), de propósito. A poeira não escreve profundidade,
       então o anel desenhado por último SOMA por cima dela em vez de ser
       engolido pela própria nuvem que o impacto levantou. Fisicamente o pó
       estaria na frente; na tela, o anel é a única peça que informa até onde a
       coisa chegou, e informação não pode ficar atrás de cortina — é a lição do
       `pulsarImpacto` do Kamehameha aplicada à ordem de desenho. */
    this.mesh.renderOrder = 8;
    scene.add(this.mesh);
    this.scene = scene;
    this.geo = geo;
  }

  spawn(x, y, z, nx, ny, nz, r, g, b, raio0, raioVel, vida, brilho) {
    if (this.live >= this.capacity) return false;
    const i = this.live++;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.normal[i3] = nx;
    this.normal[i3 + 1] = ny;
    this.normal[i3 + 2] = nz;
    this.corBase[i3] = r;
    this.corBase[i3 + 1] = g;
    this.corBase[i3 + 2] = b;
    this.raio[i] = raio0;
    this.raioVel[i] = raioVel;
    this.age[i] = 0;
    this.life[i] = vida;
    this.brilho[i] = brilho;
    return true;
  }

  swapRemove(i) {
    const last = --this.live;
    if (i === last) return;
    const i3 = i * 3;
    const l3 = last * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[i3 + k] = this.pos[l3 + k];
      this.normal[i3 + k] = this.normal[l3 + k];
      this.corBase[i3 + k] = this.corBase[l3 + k];
    }
    this.raio[i] = this.raio[last];
    this.raioVel[i] = this.raioVel[last];
    this.age[i] = this.age[last];
    this.life[i] = this.life[last];
    this.brilho[i] = this.brilho[last];
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
      /* A onda DESACELERA. Ela sai violenta e morre encostando — velocidade
         constante daria um círculo se expandindo em ritmo de animação de menu. */
      this.raioVel[i] *= Math.max(0, 1 - 2.6 * dt);
      this.raio[i] += this.raioVel[i] * dt;

      const q = 1 - p;
      const f = this.brilho[i] * q * q;
      this.cor[i3] = this.corBase[i3] * f;
      this.cor[i3 + 1] = this.corBase[i3 + 1] * f;
      this.cor[i3 + 2] = this.corBase[i3 + 2] * f;

      _p.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]);
      _n.set(this.normal[i3], this.normal[i3 + 1], this.normal[i3 + 2]);
      _q.setFromUnitVectors(_up, _n);
      const r = this.raio[i];
      /* A ALTURA DA SAIA NÃO ACOMPANHA O RAIO. Escalar em Y junto com XZ faria a
         onda de trinta metros levantar seis metros de borda — um funil, não uma
         onda. Ela cresce com a raiz: sobe o suficiente para vencer o relevo e
         continua rasante. */
      _s.set(r, Math.sqrt(r) * 1.6, r);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    const havia = this.mesh.count;
    this.mesh.count = this.live;
    if (this.live === 0 && havia === 0) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.live = 0;
    this.mesh.count = 0;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geo.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
