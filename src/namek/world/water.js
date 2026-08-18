/* ---------------------------------------------------------------------------
   O mar de Namekusei.

   Turquesa no dia, escuro e revolto quando o planeta está indo embora. É a
   segunda coisa que identifica o estágio (a primeira é o céu verde), e é
   também a mais fácil de fazer custar caro sem necessidade.

   --------------------------------------------------- por que quase não custa

   A regra é uma só: **a onda mora no FRAGMENTO, não no vértice.**

   O mar tem 3.200 m de raio. Uma malha capaz de mostrar marulho de dois metros
   por deslocamento de vértice precisaria de célula de ~4 m — 640 mil quadrados,
   sozinha mais cara que o cenário inteiro do §3. O que se vê como "onda" a
   partir de vinte metros de altura não é a geometria subindo, é a NORMAL
   mudando: o brilho do sol correndo pela superfície e a crista clareando. Isso
   são quatro senoides por pixel e uma malha praticamente plana.

   Sobra um marulho GRANDE no vértice — comprimento de onda de ~300 m, amplitude
   de meio metro no dia e de dois na tempestade. Ele não é detalhe, é escala: é
   o que impede o oceano de parecer uma chapa de vidro colorido quando visto do
   teto de voo, e a 300 m de comprimento de onda a malha grossa dá conta.

   A densidade da malha é radial e concentrada entre 700 e 1.100 m, que é a
   faixa onde a costa encontra a água. Longe dali, a névoa já resolveu.

   ------------------------------------------------------------------ o fundo

   A água é levemente TRANSLÚCIDA junto à praia e opaca no alto-mar. A conta é
   a distância ao centro, não a profundidade real do terreno: amostrar o fundo
   por pixel exigiria o campo de altura no shader (impossível sem textura, e
   textura é zero neste projeto). O resultado é o mesmo, porque em Namekusei a
   profundidade É função do raio — o campo mergulha para o mar entre 700 e
   880 m e depois vira chapa.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { clamp, smoothstep } from "../../utils/math.js";
import { NAMEK } from "../../shared/namek/config.js";
import { NAMEK_SOL_DIR, NAMEK_BRUMA_SOL, NAMEK_BRUMA_BRASA } from "./sky.js";

/** m — até onde o oceano vai. Ver `NAMEK_CAMERA_FAR` em `sky.js`. */
const RAIO_MAR = 3200;

/* m — ONDE O OCEANO COMEÇA, e este é o número que conserta o "algo mais duro no
   fundo do buraco".
 *
 * O mar era um DISCO cheio: uma chapa a −8 m cobrindo a arena inteira, do centro
 * da clareira ao horizonte. Enquanto o relevo do continente ficou acima da linha
 * d'água, isso não custou nada — o teste de profundidade escondia a chapa
 * debaixo do terreno e ninguém nunca a viu.
 *
 * As crateras mudaram isso. Cavar abaixo de −8 m no meio da clareira passou a
 * expor a água POR CIMA: o fundo do buraco virava uma superfície turquesa, lisa,
 * que não deformava com tiro nenhum — que é exatamente o relato (*"ao fundo tem
 * algo mais duro em que não é possível furar mais… veja o print: apareceu algo
 * que ele não deforma"*). Não era rocha, não era limite de grade: era o oceano
 * visto de dentro do continente.
 *
 * 520 m é onde a serra começa a ceder para a orla (ver `NamekField.baseHeight`,
 * o `smoothstep(500, 580)`), e a linha d'água de verdade só cai por volta de
 * 612 m. Ou seja: o anel começa quase cem metros antes de haver água, coberto
 * pela areia, e não há um pixel de mar faltando na costa. Para dentro dele o
 * oceano simplesmente não existe — e o fundo de uma cratera passou a ser rocha,
 * que é o que ele sempre deveria ter sido. */
const RAIO_INTERNO = 520;
/** Setores do disco. Fixo: o detalhe é do fragmento, e o que a malha precisa
 *  entregar é só o marulho de 300 m e uma silhueta redonda no horizonte. */
const SETORES = 96;

/* Pares (raio, passo radial). O adensamento fica na FAIXA DA COSTA, entre 700 e
   1.100 m — é lá que a água encontra a areia, é lá que se voa baixo, e é a
   única parte do mar que alguém vê de perto. */
const PASSO = [
  [0, 150],
  [600, 70],
  [780, 26],
  [1100, 70],
  [1800, 220],
  [RAIO_MAR, 460],
];

const DIA = {
  raso: new THREE.Color("#4ad9c6"),
  fundo: new THREE.Color("#0d6a80"),
  crista: new THREE.Color("#eafffa"),
  /** Tinta do céu refletida no fresnel. Combina com o horizonte de `sky.js` —
   *  se as duas divergirem, aparece uma linha na junção do mar com o céu. */
  ceu: new THREE.Color("#d8f5c9"),
  /* A tinta do SOL na água, e ela é mais quente que a do disco no céu de
     propósito: o que se reflete numa superfície horizontal é a luz que chega
     rasante, e rasante ela já atravessou o dobro de atmosfera. Um rastro branco
     num mar turquesa lê como reflexo de holofote. */
  sol: new THREE.Color("#ffdba4"),
  /** Força da bruma acesa. Ver o trecho no fim de `MAR_FRAG`. */
  bruma: 0.55,
  agitacao: 1,
};

const TEMPESTADE = {
  raso: new THREE.Color("#6f2a22"),
  fundo: new THREE.Color("#170807"),
  crista: new THREE.Color("#ffb489"),
  ceu: new THREE.Color("#8e1c11"),
  sol: new THREE.Color("#ff7a48"),
  /* Cai para um terço, e não a zero: na tempestade ainda há uma fonte de luz
     atrás da fumaça, e é justamente o resto de brasa no horizonte que impede o
     mar escuro de virar um vazio preto sem profundidade nenhuma. */
  bruma: 0.18,
  agitacao: 3.1,
};

const MAR_VERT = /* glsl */ `
  uniform float tempo;
  uniform float agitacao;
  varying vec3 vMundo;
  #include <fog_pars_vertex>

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);

    /* O MARULHO GRANDE. Duas ondas cruzadas de ~300 m e ~370 m; períodos
       primos entre si de propósito, senão elas batem em fase e o oceano inteiro
       sobe e desce junto, como um lençol sacudido. */
    float amp = 0.42 * agitacao;
    wp.y += sin(wp.x * 0.021 + tempo * 1.15) * amp;
    wp.y += sin(wp.z * 0.017 - tempo * 0.93) * amp * 0.78;

    vMundo = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const MAR_FRAG = /* glsl */ `
  uniform vec3 corRaso;
  uniform vec3 corFundo;
  uniform vec3 corCrista;
  uniform vec3 corCeu;
  uniform vec3 corSol;
  uniform vec3 corBruma;
  uniform float brumaForca;
  uniform vec3 solDir;
  uniform vec3 olho;
  uniform float tempo;
  uniform float agitacao;
  varying vec3 vMundo;
  #include <fog_pars_fragment>

  /* Quatro ondas direcionais, com o gradiente ANALÍTICO em vez de diferença
     finita: uma senoide sabe a própria derivada, e cada amostra extra aqui é
     uma amostra por pixel de tela. */
  vec3 normalDaAgua(vec2 p, float t, float ag) {
    float dx = 0.0;
    float dz = 0.0;
    // direção, frequência (1/m), amplitude (m), velocidade
    const vec2 d0 = vec2( 0.86,  0.51);
    const vec2 d1 = vec2(-0.42,  0.91);
    const vec2 d2 = vec2( 0.31, -0.95);
    const vec2 d3 = vec2(-0.97, -0.24);

    float k0 = 0.115, k1 = 0.196, k2 = 0.412, k3 = 0.870;
    float a0 = 0.240, a1 = 0.150, a2 = 0.075, a3 = 0.034;

    float f0 = cos(dot(d0, p) * k0 + t * 1.30) * a0 * k0;
    float f1 = cos(dot(d1, p) * k1 - t * 1.72) * a1 * k1;
    float f2 = cos(dot(d2, p) * k2 + t * 2.45) * a2 * k2;
    float f3 = cos(dot(d3, p) * k3 - t * 3.10) * a3 * k3;

    dx = (f0 * d0.x + f1 * d1.x + f2 * d2.x + f3 * d3.x) * ag;
    dz = (f0 * d0.y + f1 * d1.y + f2 * d2.y + f3 * d3.y) * ag;
    return normalize(vec3(-dx, 1.0, -dz));
  }

  float alturaDaAgua(vec2 p, float t, float ag) {
    float h = sin(dot(vec2( 0.86,  0.51), p) * 0.115 + t * 1.30) * 0.240;
    h += sin(dot(vec2(-0.42,  0.91), p) * 0.196 - t * 1.72) * 0.150;
    h += sin(dot(vec2( 0.31, -0.95), p) * 0.412 + t * 2.45) * 0.075;
    return h * ag;
  }

  void main() {
    vec2 p = vMundo.xz;
    float ag = agitacao;
    vec3 N = normalDaAgua(p, tempo, ag);
    vec3 V = normalize(olho - vMundo);
    vec3 L = normalize(solDir);

    /* PROFUNDIDADE POR RAIO. Ver o cabeçalho: em Namekusei o fundo é função da
       distância ao centro, então isto não é uma aproximação preguiçosa — é a
       mesma informação, sem custar uma amostra de campo por pixel. */
    float raio = length(p);
    float raso = 1.0 - smoothstep(700.0, 1080.0, raio);
    vec3 agua = mix(corFundo, corRaso, raso);

    /* Fresnel. Sem ele a água é uma superfície pintada; com ele, o rasante vira
       espelho e o mergulho revela a cor da própria água, que é o que separa
       "mar" de "piso azul". */
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.6);
    vec3 col = mix(agua, corCeu, fres * 0.82);

    /* O BRILHO DO SOL, em DOIS lobos, e o segundo é o retoque.
       O apertado (expoente 120) é a cintilação: pontos de luz correndo pela
       crista, e é ele que faz a onda "correr" no olho.
       O largo (expoente 14) é o RASTRO — a estrada de sol que vai do observador
       até o horizonte. Ele não existia, e a falta dele era o motivo de o mar
       ficar bonito e mudo: com o sol a 32° de altura o rastro é comprido, e um
       oceano com sol baixo e SEM rastro é a coisa que denuncia água pintada.
       Um lobo largo custa um pow por pixel de mar e resolve por construção —
       ele nasce apontando para o sol porque sai do mesmo meio-vetor. */
    vec3 H = normalize(L + V);
    float nh = clamp(dot(N, H), 0.0, 1.0);
    col += corSol * pow(nh, 120.0) * 1.9;
    /* 'nh' à décima quarta por três elevações ao quadrado e duas
       multiplicações, em vez de um segundo 'pow'. O valor é o mesmo
       (14 = 8+4+2) e a base é garantidamente >= 0 pelo 'clamp' acima. O lobo
       apertado continua com 'pow' porque 120 não cabe em quadrados sem virar
       uma corrente mais longa que a própria função. */
    float nh2 = nh * nh;
    float nh4 = nh2 * nh2;
    float nh8 = nh4 * nh4;
    col += corSol * (nh8 * nh4 * nh2) * 0.30;

    /* ESPUMA. Só no topo da crista, e mais na tempestade: no dia calmo ela é um
       fiapo, e um mar de espuma constante lê como corredeira, não como oceano. */
    float crista = smoothstep(0.32 * ag, 0.55 * ag, alturaDaAgua(p, tempo, ag));
    col = mix(col, corCrista, crista * (0.10 + 0.42 * smoothstep(1.2, 3.0, ag)));

    // Junto à praia a água é translúcida: é o que faz a areia aparecer por
    // baixo e a costa deixar de ser um recorte de papel.
    float alfa = mix(1.0, 0.72, raso);

    gl_FragColor = vec4(col, alfa);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>

    /* A BRUMA ACESA, e ela vem DEPOIS da névoa de propósito.
     *
     * A FogExp2 da cena é uma cor só, igual em todas as direções — é o que a
     * perspectiva aérea tem de mais simples e é o que apagava o horizonte deste
     * modo: com o sol a 32° de altura, a faixa de mar que fica ENTRE o
     * observador e o sol devia estar dourada, e ela saía do mesmo turquesa
     * enevoado do lado oposto. Uma névoa que não sabe onde o sol está é uma
     * névoa que mata o horizonte em vez de construí-lo.
     *
     * O conserto é aditivo e cabe em três linhas: quanto mais longe (o próprio
     * fogFactor, que a inclusão acima já calculou e deixou em escopo) e quanto
     * mais a linha de visada aponta para o sol, mais luz espalhada volta ao
     * olho. pow(_, 3.0) é o que mantém isso um FEIXE em torno do sol em vez de
     * um verniz dourado na tela inteira.
     *
     * A cor é a MESMA do terreno (NAMEK_BRUMA_SOL, dona em sky.js), e tem de
     * ser: mar e montanha se encontram numa linha, e duas brumas diferentes
     * apareceriam exatamente ali. */
    #ifdef USE_FOG
      float aoSol = max(dot(normalize(vMundo - olho), normalize(solDir)), 0.0);
      /* Ao cubo por multiplicação, exatamente como em 'terrain.js' — ver a nota
         de lá. Os dois trechos têm de continuar iguais número a número: mar e
         montanha se encontram numa linha, e é justamente ali que uma diferença
         de arredondamento apareceria como uma costura. */
      float aoSol3 = aoSol * aoSol * aoSol;
      gl_FragColor.rgb += corBruma * (aoSol3 * fogFactor * brumaForca);
    #endif
  }
`;

export class NamekWater {
  constructor(field) {
    this.field = field;
    this.relogio = 0;
    this.mesh = null;
  }

  build(parent) {
    const geo = this.montarDisco();

    this.material = new THREE.ShaderMaterial({
      vertexShader: MAR_VERT,
      fragmentShader: MAR_FRAG,
      transparent: true,
      /* Não escreve profundidade: a única coisa atrás do mar é o terreno
         submerso (opaco, já testado) e o domo do céu. Escrever aqui só criaria
         ordem de desenho para as partículas dos poderes brigarem com. */
      depthWrite: false,
      side: THREE.DoubleSide, // visto de baixo por quem cai n'água
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          corRaso: { value: DIA.raso.clone() },
          corFundo: { value: DIA.fundo.clone() },
          corCrista: { value: DIA.crista.clone() },
          corCeu: { value: DIA.ceu.clone() },
          corSol: { value: DIA.sol.clone() },
          corBruma: { value: NAMEK_BRUMA_SOL.clone() },
          brumaForca: { value: DIA.bruma },
          // O sol principal vem de `sky.js`, que é quem o possui.
          solDir: { value: NAMEK_SOL_DIR.clone() },
          olho: { value: new THREE.Vector3() },
          tempo: { value: 0 },
          agitacao: { value: DIA.agitacao },
        },
      ]),
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = "namek-mar";
    this.mesh.position.y = NAMEK.world.seaLevel;
    /* O disco tem 6,4 km de diâmetro e acompanha nada: ele é fixo no mundo, e o
       teste de frustum contra a caixa dele nunca dá negativo de dentro da
       arena. Desligá-lo poupa o teste e evita o caso em que a esfera envolvente
       calculada com o marulho no vértice zero recorta o mar no horizonte. */
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    parent.add(this.mesh);
    this.geometry = geo;
    this.triangulos = geo.index.count / 3;
    return this;
  }

  /**
   * Disco polar com passo radial variável — denso na costa, grosso no
   * alto-mar. Mesma ideia do terreno, sem a costura: aqui a contagem de setores
   * é constante, porque a malha não precisa acompanhar detalhe nenhum.
   */
  montarDisco() {
    const raios = [];
    let r = RAIO_INTERNO;
    raios.push(r);
    while (r < RAIO_MAR) {
      r += this.passoEm(r);
      raios.push(Math.min(r, RAIO_MAR));
    }

    const aneis = raios.length;
    const nVerts = aneis * SETORES;
    const pos = new Float32Array(nVerts * 3);
    const idx = new Uint32Array((aneis - 1) * SETORES * 2 * 3);

    for (let k = 0; k < aneis; k++) {
      const off = k * SETORES;
      for (let s = 0; s < SETORES; s++) {
        const ang = (s / SETORES) * Math.PI * 2;
        pos[(off + s) * 3] = Math.cos(ang) * raios[k];
        pos[(off + s) * 3 + 2] = Math.sin(ang) * raios[k];
      }
    }

    /* A MESMA ordem de índices do terreno, e pelo mesmo motivo: com θ crescendo
       de x para z, a sequência ingênua deixa a face virada para baixo e o mar
       some por backface culling. Aqui o material é `DoubleSide` e o defeito não
       apareceria — mas a normal do triângulo continuaria invertida, e é dela que
       sai o lado em que a névoa e o tonemap são aplicados.

       O LEQUE DO CENTRO SAIU junto com o vértice 0 — ver `RAIO_INTERNO`. O que
       era um disco virou um ANEL, e um anel não tem miolo para tampar. */
    let w = 0;
    const vert = (k, s) => k * SETORES + (((s % SETORES) + SETORES) % SETORES);
    for (let k = 0; k < aneis - 1; k++) {
      for (let s = 0; s < SETORES; s++) {
        const a0 = vert(k, s);
        const a1 = vert(k, s + 1);
        const b0 = vert(k + 1, s);
        const b1 = vert(k + 1, s + 1);
        idx[w++] = a0; idx[w++] = a1; idx[w++] = b0;
        idx[w++] = a1; idx[w++] = b1; idx[w++] = b0;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    /* Normal constante para cima. A normal REAL é calculada por pixel no
       fragmento; guardá-la por vértice seria um buffer de 100 KB descrevendo um
       plano. */
    const nrm = new Float32Array(nVerts * 3);
    for (let i = 0; i < nVerts; i++) nrm[i * 3 + 1] = 1;
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.computeBoundingSphere();
    return geo;
  }

  passoEm(r) {
    if (r <= PASSO[0][0]) return PASSO[0][1];
    for (let i = 1; i < PASSO.length; i++) {
      const [r0, p0] = PASSO[i - 1];
      const [r1, p1] = PASSO[i];
      if (r <= r1) return p0 + (p1 - p0) * smoothstep(r0, r1, r);
    }
    return PASSO[PASSO.length - 1][1];
  }

  /** 0 = mar turquesa e calmo, 1 = mar escuro e revolto. */
  setStorm(t) {
    const s = clamp(t, 0, 1);
    const u = this.material.uniforms;
    u.corRaso.value.lerpColors(DIA.raso, TEMPESTADE.raso, s);
    u.corFundo.value.lerpColors(DIA.fundo, TEMPESTADE.fundo, s);
    u.corCrista.value.lerpColors(DIA.crista, TEMPESTADE.crista, s);
    u.corCeu.value.lerpColors(DIA.ceu, TEMPESTADE.ceu, s);
    u.corSol.value.lerpColors(DIA.sol, TEMPESTADE.sol, s);
    /* A bruma acompanha o mesmo dial de todo o resto — é isso que garante que o
       horizonte dourado vire horizonte de brasa no MESMO instante em que o céu
       vira, e não meio segundo depois. Ver o cabeçalho de `world/index.js`. */
    u.corBruma.value.lerpColors(NAMEK_BRUMA_SOL, NAMEK_BRUMA_BRASA, s);
    u.brumaForca.value = DIA.bruma + (TEMPESTADE.bruma - DIA.bruma) * s;
    u.agitacao.value = DIA.agitacao + (TEMPESTADE.agitacao - DIA.agitacao) * s;
  }

  update(dt, cameraPos, tempoSala = 0) {
    /* Mesma decisão das nuvens em `sky.js`: o relógio da sala quando existe (as
       duas abas veem a mesma onda de graça) e o local quando não, com módulo de
       uma hora para o `float` do shader não perder resolução na fase. */
    this.relogio = tempoSala > 0 ? (tempoSala / 1000) % 3600 : this.relogio + dt;
    this.material.uniforms.tempo.value = this.relogio;
    if (cameraPos) this.material.uniforms.olho.value.copy(cameraPos);
  }

  dispose() {
    // Geometria e material saem com a raiz do mundo — ver a nota em `sky.js`.
    this.mesh = null;
    this.geometry = null;
    this.material = null;
  }
}
