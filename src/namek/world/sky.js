/* ---------------------------------------------------------------------------
   O céu de Namekusei, a luz e a tempestade.

   O CÉU VERDE É A MARCA DO PLANETA. Antes de qualquer rocha, antes da vila,
   antes das ajisas, o que diz "isto é Namekusei" é o gradiente verde-claro com
   três sóis nele. Se este arquivo estivesse certo e todos os outros errados, o
   estágio ainda seria reconhecível; o contrário não é verdade.

   ------------------------------------------------------------ o que custa o quê

   Três coisas moram aqui e todas as três são armadilhas de orçamento (§3):

   • **Os três sóis não são objetos.** São três produtos escalares dentro do
     fragmento do domo — zero malha, zero chamada de desenho, zero luz. Uma
     esfera emissiva por sol seriam três draw calls e, pior, três coisas com
     posição de mundo que teriam de acompanhar a câmera para não passarem por
     trás das montanhas.

   • **Duas luzes, e só duas.** Uma direcional (o sol principal) e uma
     hemisférica (o rebote do céu no chão). O §3 permite três; a terceira é dos
     PODERES — um Kamehameha sem luz própria não acende o cenário, e esse
     acendimento é metade do impacto do golpe. Nem o relâmpago toma a vaga: ele
     pisca modulando a intensidade das duas que já existem, o que sai de graça e
     é indistinguível de uma terceira luz durante os 0,18 s em que dura.

   • **Nenhum shadow map.** Não é economia preguiçosa: a arena tem 1.800 m de
     lado, e um mapa de 2048² esticado sobre isso dá 0,9 m por texel — a sombra
     de uma casa teria oito texels e a de uma ajisa, dois. Pagaria-se o passe
     inteiro (o mais caro do quadro, com quinze lutadores em campo) para desenhar
     borrões. O contato com o chão é resolvido onde ele é barato e correto: o
     escurecimento assado na base de cada peça de cenário e a oclusão por normal
     no terreno.

   ------------------------------------------------------------------ a tempestade

   Não é um interruptor. `NAMEK.weather.fade` são oito segundos em que céu,
   nuvem, névoa, cor e intensidade das duas luzes cruzam JUNTOS, guiados por um
   escalar só (`setStorm`). Ter um ponto único é o que garante que voltar ao dia
   desfaça exatamente o que a tempestade fez — um estado espalhado por seis
   lugares sempre deixa resíduo em algum deles. É a mesma disciplina do
   `setNight` do renderizador do arqueiro, e pela mesma razão.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { clamp, smoothstep, makeRandom } from "../../utils/math.js";
import { NAMEK } from "../../shared/namek/config.js";

/**
 * m — o `far` que a câmera deste modo precisa ter.
 *
 * Exportado como NÚMERO e não escrito num comentário porque quem monta a câmera
 * é outro arquivo: o domo está a 2.600 m do observador e o mar vai a 3.200 m.
 * Um `far` menor corta o horizonte na diagonal e o sintoma é uma cunha de nada
 * aparecendo no canto da tela quando se olha para cima em diagonal — o tipo de
 * bug que ninguém liga a um número de projeção.
 */
export const NAMEK_CAMERA_FAR = 3600;

/** m — raio do domo. Ele acompanha a câmera, então isto é distância AO OLHO. */
const RAIO_DOMO = 2600;

/* m — altura das duas camadas de nuvem. ACIMA do teto de voo (520 m), e isso é
   requisito, não estética: um plano horizontal de nuvem visto de dentro vira
   uma linha atravessando a tela de ponta a ponta. Com o teto em 520 m, ninguém
   nunca chega a 620 — e a camada nunca é vista de perfil. */
const NUVEM_BAIXA = 620;
const NUVEM_ALTA = 980;

/* Os TRÊS SÓIS. Espalhados em azimute de propósito: com dois no mesmo quadrante
   metade das direções de olhar não mostraria sol nenhum, e o traço mais citado
   do planeta ficaria escondido na maior parte do tempo. O principal é o mais
   alto e o mais quente — é ele que a direcional segue. */
const SOIS = [
  { dir: new THREE.Vector3(0.42, 0.72, 0.28), cor: new THREE.Color("#fff4d2"), raio: 0.028 },
  { dir: new THREE.Vector3(-0.62, 0.38, 0.54), cor: new THREE.Color("#fffbe8"), raio: 0.017 },
  { dir: new THREE.Vector3(0.18, 0.30, -0.86), cor: new THREE.Color("#eaffe9"), raio: 0.014 },
];

/**
 * A direção do sol PRINCIPAL, normalizada. Exportada porque o mar precisa dela
 * para pôr o brilho especular no lugar certo.
 *
 * Um segundo literal `(0.42, 0.72, 0.28)` dentro de `water.js` seria um número
 * mágico duplicado, e o sintoma de esquecer de atualizá-lo é traiçoeiro: o
 * cenário continua correto, mas o rastro de sol na água aponta para um sol que
 * não está mais ali — e ninguém liga uma coisa à outra.
 */
export const NAMEK_SOL_DIR = SOIS[0].dir.clone().normalize();

/* Paleta do dia e da tempestade, lado a lado. Estarem juntas é o que permite
   conferir de relance que a névoa combina com o horizonte nos DOIS climas — a
   discrepância entre eles é exatamente o que produz uma linha visível na junção
   entre o mar e o céu. */
const DIA = {
  zenith: new THREE.Color("#6fd08a"),
  horizonte: new THREE.Color("#d8f5c9"),
  chao: new THREE.Color("#a9d9b6"),
  nevoa: new THREE.Color("#d3f0c6"),
  nevoaDens: 0.00042,
  solLuz: new THREE.Color("#fff0cc"),
  solInt: 3.0,
  ceuLuz: new THREE.Color("#a8f0b6"),
  chaoLuz: new THREE.Color("#2f6b52"),
  hemiInt: 0.62,
  nuvemTopo: new THREE.Color("#ffffff"),
  nuvemBase: new THREE.Color("#cfe9d6"),
  nuvemCobertura: 0.26,
  nuvemOpac: 0.55,
};

const TEMPESTADE = {
  zenith: new THREE.Color("#2b0709"),
  horizonte: new THREE.Color("#8e1c11"),
  chao: new THREE.Color("#3d0d0a"),
  nevoa: new THREE.Color("#5e1410"),
  nevoaDens: 0.00105,
  solLuz: new THREE.Color("#ff8a55"),
  solInt: 1.15,
  ceuLuz: new THREE.Color("#ff6a44"),
  chaoLuz: new THREE.Color("#3a0f0c"),
  hemiInt: 0.34,
  nuvemTopo: new THREE.Color("#a8382a"),
  nuvemBase: new THREE.Color("#180708"),
  nuvemCobertura: 0.82,
  nuvemOpac: 0.94,
};

/* ------------------------------------------------------------------ shaders */

const DOMO_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DOMO_FRAG = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 horizonte;
  uniform vec3 chao;
  uniform vec3 solDir[3];
  uniform vec3 solCor[3];
  uniform float solRaio[3];
  /* 0 = dia, 1 = planeta indo embora. Um valor CONTÍNUO porque a virada é uma
     transição de oito segundos (NAMEK.weather.fade). */
  uniform float storm;
  /* O clarão do relâmpago, 0 a 1. Ele lava o céu inteiro, e não só o pedaço
     perto do raio: é assim que se lê uma descarga acima da camada de nuvem. */
  uniform float flash;
  uniform float tempo;

  varying vec3 vDir;

  float hash3(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }

  float ruido3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash3(i + vec3(0,0,0)), hash3(i + vec3(1,0,0)), f.x),
          mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
          mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    /* Expoente abaixo de 1: o verde satura DEPRESSA acima da linha do horizonte.
       Com um degradê linear o céu fica pastel e some — e é o verde saturado no
       alto que faz alguém dizer "Namekusei" antes de ver qualquer outra coisa. */
    float subida = pow(clamp(h, 0.0, 1.0), 0.55);

    vec3 col = mix(horizonte, zenith, subida);
    // Abaixo da linha do horizonte o céu vira a cor do chão distante: sem isto
    // aparece uma borda dura exatamente onde o mar encontra o domo.
    col = mix(chao, col, smoothstep(-0.14, 0.03, h));

    /* OS TRÊS SÓIS. Disco nítido + dois halos de larguras diferentes. O halo
       largo e fraco é o que os faz parecer fonte de luz atrás de atmosfera; só
       o disco daria três adesivos brancos colados no céu. */
    for (int i = 0; i < 3; i++) {
      float c = max(dot(dir, normalize(solDir[i])), 0.0);
      float ang = acos(clamp(c, -1.0, 1.0));
      float disco = 1.0 - smoothstep(solRaio[i] * 0.72, solRaio[i], ang);
      col += solCor[i] * disco * 2.4;
      col += solCor[i] * pow(c, 220.0) * 0.55;
      col += solCor[i] * pow(c, 6.0) * 0.10;
    }

    if (storm > 0.004) {
      /* A NUVEM REVOLTA, no próprio domo. Duas oitavas e só quando há
         tempestade: o desvio é sobre um uniform, então ele é coerente em todo o
         quadro e custa zero enquanto está de dia. Quatro oitavas em tela cheia
         seriam milissegundos numa placa integrada, e este modo já paga quinze
         lutadores. */
      vec3 p = dir * 3.4;
      p.y += tempo * 0.035;
      float n = ruido3(p) * 0.65 + ruido3(p * 2.11 + 4.0) * 0.35;
      /* A turbulência ESCURECE mais do que clareia. Uma nuvem de tempestade é
         massa bloqueando luz; clarear pelo ruído daria um céu de mármore. */
      col *= mix(1.0, 0.35 + 0.95 * n, storm);
      // Um resto de brasa por trás dela, mais forte junto ao horizonte.
      col += vec3(0.42, 0.06, 0.02) * storm * pow(n, 3.0) * (1.0 - subida * 0.6);
    }

    // O clarão. Puxa para o azul-violeta porque é o que a descarga tem de
    // diferente do incêndio vermelho em volta — sem esse desvio de matiz o
    // relâmpago some dentro do próprio céu.
    col += vec3(0.55, 0.62, 0.9) * flash;

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const NUVEM_VERT = /* glsl */ `
  uniform vec3 cameraXZ;
  varying vec2 vMundo;
  varying float vDist;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vMundo = wp.xz;
    vDist = length(wp.xz - cameraXZ.xz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const NUVEM_FRAG = /* glsl */ `
  uniform vec2 deriva;
  uniform float escala;
  uniform float cobertura;
  uniform float maciez;
  uniform float opacidade;
  uniform float alcance;
  uniform vec3 corTopo;
  uniform vec3 corBase;
  varying vec2 vMundo;
  varying float vDist;

  float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float ruido2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
               mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  float fbm(vec2 p) {
    float s = 0.0, a = 0.5, n = 0.0;
    for (int i = 0; i < 4; i++) {
      s += ruido2(p) * a;
      n += a;
      p *= 2.07;
      a *= 0.5;
    }
    return s / n;
  }

  void main() {
    float n = fbm(vMundo * escala + deriva);
    float alfa = smoothstep(1.0 - cobertura, 1.0 - cobertura + maciez, n);
    if (alfa <= 0.003) discard;

    /* Sombra PRÓPRIA da nuvem: o vale entre os cúmulos escurece. É a única
       pista de volume que uma camada plana pode ter, e sem ela a nuvem lê como
       uma mancha de tinta recortada. */
    float topo = smoothstep(1.0 - cobertura - 0.14, 1.0 - cobertura + 0.34, n);
    vec3 col = mix(corBase, corTopo, topo);

    // O plano é quadrado; a borda dele nunca pode aparecer. Some bem antes.
    float borda = 1.0 - smoothstep(alcance * 0.52, alcance, vDist);

    gl_FragColor = vec4(col, alfa * opacidade * borda);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------- raios */

/** Segmentos do tronco do relâmpago e de cada ramo. Ver `traçarRaio`. */
const RAIO_SEGS = 16;
const RAIO_RAMOS = 3;
const RAIO_RAMO_SEGS = 5;
const RAIO_SEG_TOTAL = RAIO_SEGS + RAIO_RAMOS * RAIO_RAMO_SEGS;
/** Dois planos cruzados por segmento, 6 vértices cada: visível de qualquer lado
 *  sem precisar orientar nada para a câmera a cada quadro. */
const RAIO_VERTS = RAIO_SEG_TOTAL * 12;
/** Quantos relâmpagos podem estar acesos ao mesmo tempo. */
const RAIO_POOL = 3;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();

export class NamekSky {
  /**
   * @param {THREE.Scene} scene a névoa é da CENA, não do grupo — ver `build`
   * @param {import("../../shared/namek/field.js").NamekField} field
   */
  constructor(scene, field) {
    this.scene = scene;
    this.field = field;
    this.storm = 0;
    this.flash = 0;
    this.relogio = 0;
    this.rnd = makeRandom(NAMEK.world.seed ^ 0x1337beef);
    this.raios = [];
    this.proximoRaio = 0;
    // O caminho do próximo relâmpago. Pré-alocado: ver `montarRaios`.
    this._px = new Float32Array(RAIO_SEGS + 1);
    this._py = new Float32Array(RAIO_SEGS + 1);
    this._pz = new Float32Array(RAIO_SEGS + 1);
  }

  build(parent) {
    this.root = new THREE.Group();
    this.root.name = "namek-ceu";
    parent.add(this.root);

    this.montarDomo();
    this.montarNuvens();
    this.montarLuzes();
    this.montarRaios();

    /* A NÉVOA É DA CENA, e por isso é a única coisa daqui que precisa ser
       devolvida no `dispose`. O jogo do arqueiro põe a dele em `scene.fog` no
       construtor do renderizador; se este modo dividir a cena com ele algum dia,
       guardar a anterior e recolocá-la é a diferença entre sair limpo e deixar o
       vale com névoa vermelha de Namekusei. */
    this.nevoaAnterior = this.scene.fog;
    this.nevoa = new THREE.FogExp2(DIA.nevoa.getHex(), DIA.nevoaDens);
    this.scene.fog = this.nevoa;

    this.aplicar(0);
    return this;
  }

  /* ----------------------------------------------------------------- domo -- */

  montarDomo() {
    /* 40×24 são 1.840 triângulos para o céu inteiro. Mais que isso não compra
       nada: o que se vê no domo é um degradê e três discos, e os dois são
       resolvidos no fragmento — a malha só precisa não mostrar facetas no
       gradiente, e nessa contagem já não mostra. */
    const geo = new THREE.SphereGeometry(RAIO_DOMO, 40, 24);
    this.domoMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenith: { value: DIA.zenith.clone() },
        horizonte: { value: DIA.horizonte.clone() },
        chao: { value: DIA.chao.clone() },
        solDir: { value: SOIS.map((s) => s.dir.clone().normalize()) },
        solCor: { value: SOIS.map((s) => s.cor.clone()) },
        solRaio: { value: SOIS.map((s) => s.raio) },
        storm: { value: 0 },
        flash: { value: 0 },
        tempo: { value: 0 },
      },
      vertexShader: DOMO_VERT,
      fragmentShader: DOMO_FRAG,
    });
    this.domo = new THREE.Mesh(geo, this.domoMat);
    this.domo.name = "namek-domo";
    /* Nunca é abatido pelo frustum (ele CERCA a câmera, e a caixa envolvente
       dele não ajuda em nada) e é sempre o primeiro a desenhar, sem escrever
       profundidade: assim tudo o mais passa por cima independentemente de
       distância, inclusive o mar, que está além do raio do domo. */
    this.domo.frustumCulled = false;
    this.domo.renderOrder = -1000;
    this.root.add(this.domo);
  }

  /* --------------------------------------------------------------- nuvens -- */

  montarNuvens() {
    this.nuvens = [];
    const specs = [
      { y: NUVEM_BAIXA, raio: 2600, escala: 0.00062, maciez: 0.24, velocidade: 1.0, escura: 0.0 },
      { y: NUVEM_ALTA, raio: 3000, escala: 0.00031, maciez: 0.16, velocidade: 0.62, escura: 0.25 },
    ];
    for (const s of specs) {
      const geo = new THREE.PlaneGeometry(s.raio * 2, s.raio * 2, 1, 1);
      geo.rotateX(-Math.PI / 2); // horizontal, vista por baixo
      const mat = new THREE.ShaderMaterial({
        vertexShader: NUVEM_VERT,
        fragmentShader: NUVEM_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
        uniforms: {
          cameraXZ: { value: new THREE.Vector3() },
          deriva: { value: new THREE.Vector2() },
          escala: { value: s.escala },
          cobertura: { value: DIA.nuvemCobertura },
          maciez: { value: s.maciez },
          opacidade: { value: DIA.nuvemOpac },
          alcance: { value: s.raio * 0.92 },
          corTopo: { value: DIA.nuvemTopo.clone() },
          corBase: { value: DIA.nuvemBase.clone() },
        },
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `namek-nuvem-${s.y}`;
      mesh.position.y = s.y;
      mesh.frustumCulled = false;
      mesh.renderOrder = -900;
      this.root.add(mesh);
      this.nuvens.push({ mesh, mat, velocidade: s.velocidade, escura: s.escura });
    }
  }

  /* ---------------------------------------------------------------- luzes -- */

  montarLuzes() {
    this.sol = new THREE.DirectionalLight(DIA.solLuz.getHex(), DIA.solInt);
    // A direcional é DIREÇÃO, não lugar: o que importa é o vetor até o alvo.
    this.sol.position.copy(SOIS[0].dir).normalize().multiplyScalar(600);
    this.sol.castShadow = false;
    this.root.add(this.sol);
    this.root.add(this.sol.target);

    /* A hemisférica é quem faz o planeta parecer o planeta: o céu verde bate no
       chão e volta esverdeado, e é esse rebote que tinge tudo — rocha, casa,
       lutador — sem precisar tocar em nenhum material. */
    this.hemi = new THREE.HemisphereLight(
      DIA.ceuLuz.getHex(),
      DIA.chaoLuz.getHex(),
      DIA.hemiInt,
    );
    this.root.add(this.hemi);
  }

  /* ---------------------------------------------------------------- raios -- */

  montarRaios() {
    /* POOL PRÉ-ALOCADO, três malhas com buffer de tamanho fixo. Nada nasce nem
       morre durante a tempestade — a descarga só reescreve floats que já
       existem (§3: zero alocação em regime).
       Um material por raio, e não um compartilhado: a opacidade é animada por
       raio (cada um está num ponto diferente do próprio repique), e opacidade é
       propriedade de MATERIAL. A alternativa seria um atributo de vértice de
       alfa por raio, que custa mais memória para resolver menos. Três chamadas
       de desenho no pior caso, e só enquanto há raio aceso: invisível não
       desenha. */
    for (let i = 0; i < RAIO_POOL; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(RAIO_VERTS * 3), 3));
      const mat = new THREE.MeshBasicMaterial({
        color: 0xe6ecff,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `namek-raio-${i}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = 900;
      mesh.visible = false;
      this.root.add(mesh);
      this.raios.push({ mesh, mat, geo, t: 0, vida: 0 });
    }
  }

  /**
   * Um relâmpago caindo em (x, z). Quem decide é a SALA (`NS2C.BOLT`) — este
   * lado só pinta.
   *
   * A geometria é reescrita dentro dos `Float32Array` que já existem: zero
   * alocação por descarga, que é o que o §3 pede de qualquer coisa que aconteça
   * várias vezes por minuto.
   */
  strikeBolt(x, z) {
    const r = this.raios[this.proximoRaio];
    this.proximoRaio = (this.proximoRaio + 1) % RAIO_POOL;

    this.tracarRaio(r.geo, x, z);
    r.t = 0;
    /* O relâmpago dura mais que o clarão. O clarão é a luz da descarga chegando
       (instantânea); o traço fica na retina — e nos jogos, na tela — um instante
       depois. Um relâmpago que apaga junto com o clarão parece um erro de
       sincronismo. */
    r.vida = NAMEK.weather.tempestade.raioFlash * 2.6;
    r.mesh.visible = true;
    r.mat.opacity = 1;

    this.flash = 1;
  }

  /**
   * Desenha o traço: tronco em ziguezague do teto de nuvem até o chão, mais
   * alguns ramos.
   *
   * O ziguezague ESTREITA em direção ao solo. Um relâmpago com desvio uniforme
   * erra o ponto de queda em dezenas de metros, e como quem escolheu o ponto foi
   * a sala (para todos verem a mesma descarga no mesmo lugar), errá-lo é
   * desmentir o único dado que veio pela rede.
   */
  tracarRaio(geo, x, z) {
    const pos = geo.attributes.position.array;
    const rnd = this.rnd;
    const alto = NUVEM_BAIXA + 60;
    const chao = this.field.heightAt(x, z);

    let escrita = 0;
    const largo = 5.5;

    const emitir = (ax, ay, az, bx, by, bz, w) => {
      _a.set(ax, ay, az);
      _b.set(bx, by, bz);
      _d.subVectors(_b, _a);
      if (_d.lengthSq() < 1e-6) _d.set(0, 1, 0);
      _d.normalize();
      /* Dois planos CRUZADOS em vez de um plano orientado para a câmera: um
         relâmpago dura 0,18 s e pode aparecer em qualquer direção; girar a fita
         por quadro custaria uma reconstrução de malha por raio por quadro, e um
         plano fixo desapareceria de perfil bem no instante em que a atenção do
         jogador foi para lá. */
      _u.set(-_d.z, 0, _d.x);
      if (_u.lengthSq() < 1e-6) _u.set(1, 0, 0);
      _u.normalize();
      _v.crossVectors(_d, _u).normalize();

      for (let e = 0; e < 2; e++) {
        const eixo = e === 0 ? _u : _v;
        const ox = eixo.x * w;
        const oy = eixo.y * w;
        const oz = eixo.z * w;
        /* Dois triângulos escritos à mão, sem índice e sem array temporário:
           (a−, a+, b+) e (a−, b+, b−). Um `[...]` aqui seriam 62 arrays por
           descarga, e o `side: DoubleSide` do material dispensa qualquer
           cuidado com a ordem — a fita é vista dos dois lados por construção. */
        pos[escrita++] = ax - ox; pos[escrita++] = ay - oy; pos[escrita++] = az - oz;
        pos[escrita++] = ax + ox; pos[escrita++] = ay + oy; pos[escrita++] = az + oz;
        pos[escrita++] = bx + ox; pos[escrita++] = by + oy; pos[escrita++] = bz + oz;
        pos[escrita++] = ax - ox; pos[escrita++] = ay - oy; pos[escrita++] = az - oz;
        pos[escrita++] = bx + ox; pos[escrita++] = by + oy; pos[escrita++] = bz + oz;
        pos[escrita++] = bx - ox; pos[escrita++] = by - oy; pos[escrita++] = bz - oz;
      }
    };

    // ---- tronco. Os três vetores do caminho são de INSTÂNCIA e reaproveitados
    // a cada descarga; ver a nota sobre alocação em `montarRaios`.
    const px = this._px;
    const py = this._py;
    const pz = this._pz;
    for (let i = 0; i <= RAIO_SEGS; i++) {
      const t = i / RAIO_SEGS;
      const desvio = (1 - t) * (1 - t) * 90;
      px[i] = x + (rnd() - 0.5) * desvio;
      pz[i] = z + (rnd() - 0.5) * desvio;
      py[i] = alto + (chao - alto) * t;
    }
    px[RAIO_SEGS] = x;
    pz[RAIO_SEGS] = z;
    py[RAIO_SEGS] = chao;

    for (let i = 0; i < RAIO_SEGS; i++) {
      const t = i / RAIO_SEGS;
      emitir(px[i], py[i], pz[i], px[i + 1], py[i + 1], pz[i + 1], largo * (1 - t * 0.62));
    }

    // ---- ramos, saindo do terço superior e morrendo no ar
    for (let b = 0; b < RAIO_RAMOS; b++) {
      const de = 1 + Math.floor(rnd() * (RAIO_SEGS * 0.5));
      let cx = px[de];
      let cy = py[de];
      let cz = pz[de];
      const dirX = (rnd() - 0.5) * 2;
      const dirZ = (rnd() - 0.5) * 2;
      for (let s = 0; s < RAIO_RAMO_SEGS; s++) {
        const nx = cx + dirX * 26 + (rnd() - 0.5) * 34;
        const ny = cy - 40 - rnd() * 50;
        const nz = cz + dirZ * 26 + (rnd() - 0.5) * 34;
        emitir(cx, cy, cz, nx, ny, nz, largo * 0.4 * (1 - s / RAIO_RAMO_SEGS));
        cx = nx;
        cy = ny;
        cz = nz;
      }
    }

    // Sobra do buffer (se algum ramo terminou antes): colapsa em degenerados,
    // que a GPU descarta sem custo de fragmento.
    while (escrita < pos.length) pos[escrita++] = 0;
    geo.attributes.position.needsUpdate = true;
    /* Sem `computeBoundingSphere`: a malha tem `frustumCulled = false`, e o
       teste de frustum é o único consumidor dessa esfera. Recalculá-la seria
       varrer 372 vértices por descarga para alimentar ninguém. */
  }

  /* ---------------------------------------------------------------- clima -- */

  /**
   * O dial único: 0 é o dia de Namekusei, 1 é o planeta indo embora.
   *
   * Tudo o que a tempestade muda passa por aqui. É deliberado que a função seja
   * longa e chata — a alternativa é a mesma interpolação repetida em quatro
   * arquivos, e o resultado seria a névoa terminando de virar dois segundos
   * depois do céu.
   */
  aplicar(t) {
    const s = clamp(t, 0, 1);
    this.storm = s;

    const u = this.domoMat.uniforms;
    u.zenith.value.lerpColors(DIA.zenith, TEMPESTADE.zenith, s);
    u.horizonte.value.lerpColors(DIA.horizonte, TEMPESTADE.horizonte, s);
    u.chao.value.lerpColors(DIA.chao, TEMPESTADE.chao, s);
    u.storm.value = s;

    /* Os sóis SOMEM atrás da nuvem — não escurecem. Um sol pálido num céu
       vermelho lê como fim de tarde; o que se quer é a nuvem tendo engolido os
       três, que é o que acontece na luta contra Freeza. */
    const visivel = 1 - smoothstep(0.15, 0.75, s);
    for (let i = 0; i < 3; i++) {
      u.solCor.value[i].copy(SOIS[i].cor).multiplyScalar(visivel);
    }

    this.nevoa.color.lerpColors(DIA.nevoa, TEMPESTADE.nevoa, s);
    this.nevoa.density = DIA.nevoaDens + (TEMPESTADE.nevoaDens - DIA.nevoaDens) * s;

    this.sol.color.lerpColors(DIA.solLuz, TEMPESTADE.solLuz, s);
    this.solIntensidade = DIA.solInt + (TEMPESTADE.solInt - DIA.solInt) * s;
    this.hemi.color.lerpColors(DIA.ceuLuz, TEMPESTADE.ceuLuz, s);
    this.hemi.groundColor.lerpColors(DIA.chaoLuz, TEMPESTADE.chaoLuz, s);
    this.hemiIntensidade = DIA.hemiInt + (TEMPESTADE.hemiInt - DIA.hemiInt) * s;

    for (const n of this.nuvens) {
      const nu = n.mat.uniforms;
      nu.cobertura.value =
        DIA.nuvemCobertura + (TEMPESTADE.nuvemCobertura - DIA.nuvemCobertura) * s;
      nu.opacidade.value = DIA.nuvemOpac + (TEMPESTADE.nuvemOpac - DIA.nuvemOpac) * s;
      // A camada alta é mais escura que a baixa nos dois climas: é o que dá
      // profundidade entre elas quando as duas aparecem no mesmo quadro.
      nu.corTopo.value.lerpColors(DIA.nuvemTopo, TEMPESTADE.nuvemTopo, s);
      nu.corBase.value.lerpColors(DIA.nuvemBase, TEMPESTADE.nuvemBase, s);
      nu.corTopo.value.multiplyScalar(1 - n.escura);
      nu.corBase.value.multiplyScalar(1 - n.escura * 0.6);
    }
  }

  /* ---------------------------------------------------------------- quadro -- */

  /**
   * @param {number} dt
   * @param {THREE.Vector3} cameraPos o domo e as nuvens acompanham a câmera
   * @param {number} tempoSala relógio da SALA em ms; sincroniza a deriva
   */
  update(dt, cameraPos, tempoSala = 0) {
    /* O relógio da nuvem vem da sala quando existe — duas abas veem o mesmo céu
       de graça, sem trafegar um byte, do mesmo jeito que a estrela cadente da
       Lua. O módulo de uma hora é o que impede o uniform de crescer até a faixa
       em que o `float` do shader começa a serrilhar a deriva. */
    this.relogio = tempoSala > 0 ? (tempoSala / 1000) % 3600 : this.relogio + dt;
    this.domoMat.uniforms.tempo.value = this.relogio;

    if (cameraPos) {
      this.domo.position.copy(cameraPos);
      for (const n of this.nuvens) {
        n.mesh.position.x = cameraPos.x;
        n.mesh.position.z = cameraPos.z;
        n.mat.uniforms.cameraXZ.value.copy(cameraPos);
      }
    }

    // Na tempestade o vento empurra: nuvem pesada corre.
    const empurra = 1 + this.storm * 2.2;
    for (const n of this.nuvens) {
      const d = this.relogio * n.velocidade * empurra;
      n.mat.uniforms.deriva.value.set(d * 0.0165, d * 0.0074);
    }

    /* O CLARÃO, e a razão de ele não ser uma luz. Um `PointLight` a mil metros
       de altura precisaria de alcance infinito para iluminar a arena, e alcance
       infinito num ponto é justamente o que o §3 conta como a terceira luz. O
       que se faz aqui é o efeito da descarga: as duas luzes que já existem
       pulam de intensidade e o céu inteiro lava. É indistinguível em 0,18 s. */
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt / NAMEK.weather.tempestade.raioFlash);
    }
    const f = this.flash * this.flash; // decai rápido: descarga não tem cauda longa
    this.domoMat.uniforms.flash.value = f * 0.85;
    this.sol.intensity = this.solIntensidade + f * 2.6;
    this.hemi.intensity = this.hemiIntensidade + f * 1.4;

    for (const r of this.raios) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      if (r.t >= r.vida) {
        r.mesh.visible = false;
        continue;
      }
      /* O tremeluzir. Um relâmpago não some por um fade linear: ele pisca duas
         ou três vezes enquanto a descarga se repete pelo mesmo canal ionizado, e
         é esse repique que separa "relâmpago" de "linha branca aparecendo". */
      const k = r.t / r.vida;
      const repique = 0.55 + 0.45 * Math.sin(r.t * 62);
      r.mat.opacity = (1 - k) * (1 - k) * repique;
    }
  }

  dispose() {
    this.scene.fog = this.nevoaAnterior ?? null;
    this.nevoaAnterior = null;
    this.nevoa = null;
    /* Malhas, geometrias e materiais saem com a raiz do mundo em
       `disposeSubtree` — este arquivo não os destrói à mão para não haver duas
       autoridades sobre o mesmo recurso. Ver `levels/resources.js`. */
    this.domo = null;
    this.domoMat = null;
    this.nuvens = [];
    this.raios = [];
    this.sol = null;
    this.hemi = null;
    this.root = null;
  }
}
