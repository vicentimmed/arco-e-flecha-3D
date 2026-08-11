/* ---------------------------------------------------------------------------
   Renderização: contexto WebGL, câmera, iluminação PBR, céu e nuvens.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { CONFIG } from "../config.js";
import { installDirectionalFog } from "./directionalFog.js";
import { GradeShader } from "./gradePass.js";
import { SUN_DIR } from "./sun.js";

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 ground;
  uniform vec3 sunDir;
  uniform vec3 sunColor;

  // Noite: 0 = dia pleno, 1 = noite fechada. É um valor contínuo porque a
  // virada do modo zumbi é uma TRANSIÇÃO — o céu apaga em pouco mais de um
  // segundo em vez de trocar num quadro só, que leria como bug de render.
  uniform float night;
  uniform vec3 nightZenith;
  uniform vec3 nightHorizon;
  uniform vec3 moonDir;

  // Vácuo: 0 = há atmosfera, 1 = Lua. Ver o bloco do vácuo, no fim.
  uniform float space;
  uniform vec3 earthDir;

  varying vec3 vDir;

  /* Ruído de valor 3D — só a Terra usa, e só nos poucos pixels do disco.
     Escrito aqui em vez de amostrar uma textura porque o projeto inteiro é
     gerado por código, sem assets externos. */
  float hash3(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }

  float noise3(vec3 p) {
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

  float fbm3(vec3 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      s += a * noise3(p);
      p *= 2.03;
      a *= 0.5;
    }
    return s;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    float ceu = pow(clamp(h, 0.0, 1.0), 0.62);

    // Gradiente vertical: chão nebuloso → horizonte claro → zênite saturado.
    vec3 dia = mix(horizon, zenith, ceu);
    dia = mix(ground, dia, smoothstep(-0.16, 0.02, h));

    // Halo e disco do sol.
    float sun = max(dot(dir, normalize(sunDir)), 0.0);
    dia += sunColor * pow(sun, 7.0) * 0.55;
    dia += sunColor * pow(sun, 2.0) * 0.07;
    dia += sunColor * smoothstep(0.9993, 0.9997, sun) * 2.2;

    // --------------------------------------------------------------- noite --
    vec3 noite = mix(nightHorizon, nightZenith, ceu);
    noite = mix(nightHorizon * 0.55, noite, smoothstep(-0.16, 0.02, h));

    /* A lua: disco nítido com um halo largo em volta. O halo é o que a faz
       parecer uma fonte de luz e não um adesivo branco — e é dele que sai a
       leitura de "está claro o suficiente para enxergar o horizonte, mas não o
       chão", que é exatamente o clima do modo. */
    float m = max(dot(dir, normalize(moonDir)), 0.0);
    noite += vec3(0.62, 0.68, 0.84) * pow(m, 220.0) * 0.9;
    noite += vec3(0.34, 0.40, 0.58) * pow(m, 12.0) * 0.16;
    noite += vec3(0.20, 0.26, 0.42) * pow(m, 3.0) * 0.05;

    vec3 col = mix(dia, noite, night);

    /* --------------------------------------------------------------- vácuo --
       O céu da Lua não é "um céu escuro": é a AUSÊNCIA de céu.

       Sem atmosfera não há espalhamento, e sem espalhamento não há gradiente,
       não há halo em volta do Sol e não há azul em lugar nenhum. O preto vai
       até a linha do chão. É essa dureza que o olho lê como "não tem ar",
       antes de qualquer outra pista. */
    if (space > 0.001) {
      /* PRETO ATÉ O CHÃO. Um degradê junto ao horizonte, por mais discreto que
         seja, é espalhamento — e espalhamento é ar. O que sobra aqui é quase
         nada, só para a compressão de vídeo não formar banda no preto puro. */
      vec3 vazio = mix(vec3(0.004, 0.004, 0.006), vec3(0.0), ceu);

      /* O Sol: disco DURO, sem halo. O halo do vale é espalhamento
         atmosférico; aqui o Sol é um recorte branco violento, e quem dá o
         brilho em volta é o bloom do pós-processamento — que é como funciona
         numa lente de verdade, e não no ar. */
      vazio += vec3(1.0, 0.97, 0.92) * smoothstep(0.99975, 0.99988, sun) * 6.0;

      /* ------------------------------------------------------------ a Terra --
         Disco de ~2° com continentes, nuvens, FASE e um fio de atmosfera.

         Fica parada no céu, e isso não é economia: da superfície lunar a Terra
         realmente não nasce nem se põe. A rotação é síncrona, então ela
         permanece no mesmo ponto para sempre — só muda de fase. */
      vec3 eDir = normalize(earthDir);
      float ce = dot(dir, eDir);
      float raio = 0.9993;              // ~2,2° de diâmetro aparente
      if (ce > raio - 0.0012) {
        // Coordenada dentro do disco: 0 no centro, 1 na borda.
        float r = sqrt(max(0.0, (1.0 - ce) / (1.0 - raio)));

        // Base do "globo": a normal aproximada da esfera vista de frente.
        vec3 up = normalize(cross(eDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-5));
        vec3 rt = normalize(cross(up, eDir));
        vec2 uv = vec2(dot(dir - eDir * ce, rt), dot(dir - eDir * ce, up));
        uv /= max(1e-5, (1.0 - raio));
        float z = sqrt(max(0.0, 1.0 - dot(uv, uv)));
        vec3 nrm = normalize(rt * uv.x + up * uv.y + eDir * z);

        // Continentes e nuvens por ruído sobre a esfera. Não é um mapa da
        // Terra — é uma Terra plausível a 384 mil km, que é o que se enxerga.
        float land = fbm3(nrm * 2.6);
        float cloud = fbm3(nrm * 4.1 + vec3(11.3));
        vec3 oceano = vec3(0.055, 0.22, 0.48);
        vec3 terra = mix(vec3(0.20, 0.34, 0.15), vec3(0.42, 0.36, 0.22),
                         smoothstep(0.52, 0.72, land));
        vec3 globo = mix(oceano, terra, smoothstep(0.50, 0.56, land));
        globo = mix(globo, vec3(0.92, 0.94, 0.97),
                    smoothstep(0.55, 0.75, cloud) * 0.75);

        // A FASE: o mesmo Sol que ilumina o chão ilumina a Terra, então o
        // terminador acompanha sozinho a direção da luz da cena.
        float luz = clamp(dot(nrm, normalize(sunDir)), 0.0, 1.0);
        globo *= 0.04 + 1.55 * pow(luz, 0.85);

        float borda = smoothstep(1.0, 0.965, r);
        vazio = mix(vazio, globo, borda);
        // Fio de atmosfera: azul finíssimo só no limbo iluminado.
        vazio += vec3(0.28, 0.52, 0.95) *
                 smoothstep(0.90, 1.0, r) * smoothstep(1.02, 0.98, r) * luz * 0.7;
      }

      col = mix(col, vazio, space);
    }

    gl_FragColor = vec4(col, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* Tintas de luz e névoa nas duas pontas do dia. Ficam aqui, como constantes de
   módulo, porque `setNight` roda a cada frame durante a transição e alocar seis
   `THREE.Color` por quadro para interpolar entre valores fixos é desperdício. */
const SKY_TINT_DAY = new THREE.Color(0xa8d3ff);
const SKY_TINT_NIGHT = new THREE.Color(0x3a4a72);
const GROUND_TINT_DAY = new THREE.Color(0x5d6142);
const GROUND_TINT_NIGHT = new THREE.Color(0x0d1018);
/* A névoa do dia saiu de #c4d8e8 para #b2cee4: uns 20 % mais saturada e um tom
   mais funda. O cinza-azulado antigo era quase neutro, e névoa neutra some —
   ela pintava a serra de cinza sem parecer AR, o que deixava a montanha com
   cara de adesivo apagado em vez de longe. Ver também `core/directionalFog.js`,
   que faz esta cor variar com o ângulo do olhar. */
const FOG_DAY = new THREE.Color(0xb2cee4);
const FOG_NIGHT = new THREE.Color(0x070a14);

/* ------------------------------------------------------- balanço de luz -----

   A imagem estava LAVADA por excesso de luz ambiente: hemisférica a 0,82 e
   preenchimento a 0,35, somados ao sol a 3,1, chapavam as sombras e apagavam o
   volume de tudo. Com a hemisférica em 0,5 e o preenchimento em 0,2 as sombras
   voltam a existir — e como o sol não mudou, a cena não fica escura, fica com
   CONTRASTE. O resto do que se perdeu de brilho volta pela curva de cor do
   passe de acabamento, que é onde ele deve ser decidido. */
const HEMI_DAY = 0.5;
const HEMI_NIGHT = 0.055;
const FILL_DAY = 0.2;
const SUN_DAY = 3.1;

/** Tamanho da janela, nunca zero (abas em segundo plano reportam 0×0, e
 *  aspect = 0/0 = NaN envenenaria a matriz de projeção). */
function viewportSize() {
  return {
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
  };
}

export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    const { width, height } = viewportSize();
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, CONFIG.render.maxPixelRatio),
    );
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = CONFIG.render.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    /* A contagem de desenho passa a ser MANUAL.
     *
     * Por padrão o Three zera `info.render` no começo de cada `render()`. Com o
     * pós-processamento, um quadro são várias chamadas de `render()` — a cena,
     * os quatro níveis do bloom, a saída, o acabamento —, e o que sobrava para
     * ler no fim era o último passe: um quad, uma chamada. O painel mostrava
     * "1 draw call" enquanto a cena desenhava quinhentas.
     *
     * Zerando à mão no início de `render()` do JOGO, o contador acumula o
     * quadro inteiro e vira o guarda-corpo que a Fase 0 pede. */
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    // Perspectiva aérea: é o que dá escala à serra durante o dia. A cor tem de
    // bater com a do horizonte do céu, senão aparece uma linha. A densidade da
    // noite é zerada pela configuração: no escuro o círculo das tochas faz o
    // recorte visual sem pagar um passe de fragmento ainda mais caro.
    this.scene.fog = new THREE.FogExp2(FOG_DAY, CONFIG.world.fogDensity);

    this.camera = new THREE.PerspectiveCamera(
      CONFIG.camera.fov,
      width / height,
      CONFIG.camera.near,
      CONFIG.camera.far,
    );
    this.camera.position.set(0, 2, 6);

    /* A direção do sol é FIXA e mora em `core/sun.js` — o terreno assa a sombra
       da vegetação com ela e a névoa a compila dentro dos trechos globais de
       fog. A instalação da névoa acontece aqui, antes de tudo, porque trechos
       trocados depois do primeiro material não alcançam programas já
       compilados. */
    this.sunDirection = SUN_DIR.clone();
    installDirectionalFog(this.sunDirection);
    /* A lua fica do lado OPOSTO ao sol e mais alta. Oposto porque é o que dá
       contraste de silhueta na serra durante a noite do modo zumbi; mais alta
       porque uma lua baixa ficaria atrás dos cumes e nunca apareceria no
       enquadramento de quem está no centro do vale. */
    this.moonDirection = new THREE.Vector3(0.5, 0.72, -0.48).normalize();
    /* A Terra vista da Lua: alta o bastante para caber no enquadramento de quem
       olha o horizonte, e do lado OPOSTO ao Sol, para aparecer quase cheia. Uma
       Terra do mesmo lado do Sol seria um risco fino contra a luz. */
    this.earthDirection = new THREE.Vector3(-0.42, 0.62, -0.66).normalize();
    /** 0 = dia, 1 = noite fechada. Ver `setNight`. */
    this._night = 0;
    /** 0 = há atmosfera, 1 = vácuo lunar. Ver `setSpace`. */
    this._space = 0;
    /** 0 = céu limpo, 1 = tempestade do chefão. Ver `setStorm`. */
    this._storm = 0;

    this.buildSky();
    this.buildLights();
    this.buildComposer();

    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
  }

  /* ------------------------------------------------------ pós-processo ----
   *
   * A cadeia é curta de propósito: cena → bloom → saída → acabamento.
   *
   * O item CRÍTICO é o MSAA. O `antialias: true` do construtor só vale para o
   * framebuffer padrão, e a partir do momento em que a cena é desenhada num
   * render target ele deixa de existir — sem `samples` no alvo, ligar o
   * pós-processamento PIORA a imagem: cada aresta do cenário vira escada.
   *
   * O alvo é `HalfFloatType` porque o bloom precisa de valores acima de 1 para
   * saber o que é brilho. Num alvo de 8 bits tudo já chegaria cortado em branco
   * e o limiar não teria o que separar.
   */
  buildComposer() {
    const R = CONFIG.render;
    this.postEnabled = R.bloom !== false || R.msaaSamples > 0;
    if (!this.postEnabled) {
      this.composer = null;
      return;
    }

    const pr = this.renderer.getPixelRatio();
    const alvo = new THREE.WebGLRenderTarget(
      Math.floor(this.width * pr),
      Math.floor(this.height * pr),
      {
        type: THREE.HalfFloatType,
        samples: R.msaaSamples,
      },
    );
    this.composer = new EffectComposer(this.renderer, alvo);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(this.width, this.height);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    if (R.bloom !== false) {
      /* O `radius` de 0,4 é o espalhamento entre os quatro níveis de mipmap.
         O `strength` sai do preset porque é ele que decide o quanto o modo
         zumbi custa: à noite, quatro tochas e vinte e um pares de olhos são
         justamente o que o bloom vai buscar. */
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(this.width, this.height),
        R.bloomStrength,
        0.4,
        R.bloomThreshold,
      );
      this.composer.addPass(this.bloom);
    }

    // Tonemap + sRGB. Sem ele a imagem sai em linear (lavada e clara demais):
    // o Three só aplica a curva de exibição quando desenha DIRETO na tela.
    this.composer.addPass(new OutputPass());

    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.vignette.value = R.vignette;
    this.grade.uniforms.grain.value = R.grain;
    this.composer.addPass(this.grade);
  }

  /**
   * Liga e desliga a cadeia inteira (tecla do painel de depuração).
   *
   * Desligada, o jogo volta a desenhar direto no framebuffer padrão — que tem
   * o `antialias` do construtor e o tonemap do renderer. É um caminho completo
   * e correto, não um modo degradado: é ele que roda no preset `low`.
   */
  setPostEnabled(on) {
    this.postEnabled = on && this.composer !== null;
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(600, 32, 20);
    this.skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenith: { value: new THREE.Color("#2c78cc") },
        horizon: { value: new THREE.Color("#d0e2ee") },
        ground: { value: new THREE.Color("#b3c3c6") },
        sunDir: { value: this.sunDirection.clone() },
        sunColor: { value: new THREE.Color("#ffe6b0") },
        night: { value: 0 },
        nightZenith: { value: new THREE.Color("#05070f") },
        nightHorizon: { value: new THREE.Color("#131b2e") },
        moonDir: { value: this.moonDirection.clone() },
        space: { value: 0 },
        earthDir: { value: this.earthDirection.clone() },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    });
    this.sky = new THREE.Mesh(geo, this.skyMaterial);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.scene.add(this.sky);

    this.clouds = buildClouds();
    this.scene.add(this.clouds.group);

    // A contagem vem do preset: 900 pontos no `high`, 432 no `low`. É um draw
    // call em qualquer caso — o que muda é o custo de vértice, que numa placa
    // fraca deixa de ser desprezível.
    this.stars = buildStars(CONFIG.render.starsCount);
    this.stars.visible = false;
    this.scene.add(this.stars);
  }

  /**
   * Passa o mundo do dia para a noite (0 → 1) e de volta.
   *
   * Tudo o que a noite muda passa por aqui, num valor contínuo só: céu, sol,
   * hemisférica, preenchimento, névoa, nuvens e estrelas. Ter um ponto único é o
   * que permite a virada ser uma TRANSIÇÃO suave e, principalmente, o que
   * garante que voltar ao dia desfaça exatamente o que a noite fez — um estado
   * espalhado por seis arquivos deixaria resíduo em algum deles.
   */
  setNight(t) {
    const n = Math.max(0, Math.min(1, t));
    if (n === this._night) return;
    this._night = n;

    this.skyMaterial.uniforms.night.value = n;

    /* O sol não é só escurecido — ele é DESLIGADO no fim da transição. Uma
       direcional com intensidade quase zero continua custando o passe inteiro de
       shadow map, que é o item mais caro do frame e não desenharia nada. */
    this.sun.intensity = SUN_DAY * (1 - n);
    /* À noite plena a sombra direcional não ilumina quase nada — mas o passe
       do shadow map continua custando com dezenas de zumbis projetando. */
    this.sun.castShadow = n < 0.3;
    this.sun.visible = n < 0.98;

    // Um resto de luz do céu, frio e muito fraco: sem ele o terreno fora das
    // tochas fica preto absoluto e some até a silhueta da serra contra o céu.
    this.hemi.intensity = HEMI_DAY * (1 - n) + HEMI_NIGHT * n;
    this.hemi.color.lerpColors(SKY_TINT_DAY, SKY_TINT_NIGHT, n);
    this.hemi.groundColor.lerpColors(GROUND_TINT_DAY, GROUND_TINT_NIGHT, n);

    this.fill.intensity = FILL_DAY * (1 - n);
    this.fill.visible = n < 0.98;

    /* O bloom à noite. As tochas e os olhos dos zumbis são os únicos pontos
       acima do limiar num quadro quase preto — e um halo forte demais neles
       vira borrão laranja que apaga a silhueta que vem chegando, que é a única
       informação do modo. Baixar o limiar e a força é o que mantém o halo como
       "há fogo ali" em vez de "há uma mancha ali". */
    if (this.bloom) {
      const R = CONFIG.render;
      this.bloom.threshold = R.bloomThreshold * (1 - n) + 0.72 * n;
      this.bloom.strength = R.bloomStrength * (1 - n * 0.55);
    }

    // A névoa fecha e escurece: é ela que impede de ver a serra iluminada ao
    // longe e reforça que só existe o círculo das tochas.
    this.scene.fog.color.lerpColors(FOG_DAY, FOG_NIGHT, n);
    this.scene.fog.density =
      CONFIG.world.fogDensity * (1 - n) + CONFIG.world.fogDensityNight * n;

    /* Tempestade do chefão: nuvens ficam LIGADAS à noite (no dia normal
       somem quando n ≥ 0,5). Sem isto o céu da luta seria só breu + estrelas. */
    this.clouds.visible = n < 0.5 || this._storm > 0.05;
    this.stars.visible = n > 0.15;
    const starBase = Math.max(0, (n - 0.15) / 0.85);
    this.stars.material.opacity = starBase * (1 - this._storm * 0.9);
  }

  /**
   * Entra e sai do vácuo (0 → 1). A virada da Lua, num ponto só.
   *
   * Segue a mesma disciplina de `setNight`: tudo o que o vácuo muda passa por
   * aqui, e é isso que garante que voltar ao vale desfaça exatamente o que a
   * ida à Lua fez. Espalhado por seis chamadas, alguma sobra ficaria — uma
   * névoa que não voltou, uma estrela acesa de dia — e só apareceria duas fases
   * depois.
   *
   * Diferente da noite, esta troca NÃO é gradual: ela acontece atrás da tela de
   * carregamento, entre uma fase e outra. Um vale que desbota até virar Lua
   * seria bonito e mentiroso.
   */
  setSpace(t) {
    const s = Math.max(0, Math.min(1, t));
    this._space = s;
    this.skyMaterial.uniforms.space.value = s;

    /* NÉVOA DESLIGADA. É o item que mais denuncia o vácuo: sem ar não há
       perspectiva aérea, e o que está a 300 m tem exatamente o mesmo contraste
       que a pedra ao lado do pé. O horizonte fica recortado como lâmina. */
    this.scene.fog.density = CONFIG.world.fogDensity * (1 - s);

    /* Sol RASANTE e implacável. O ângulo baixo é a decisão de maior retorno
       visual do cenário inteiro: ele estica as sombras e transforma cada
       cratera de dois metros num acidente legível. Sem ele, o mesmo terreno
       lê como um estacionamento cinza. */
    if (s > 0.5) {
      this.sunDirection.set(0.82, 0.26, 0.51).normalize();
      /* Luz do Sol BRANCA. O amarelo do sol do vale não é do Sol: é do ar, que
         espalha o azul e deixa passar o resto. Sem atmosfera, a luz chega como
         saiu — e é ela que dá ao regolito o cinza levemente pardo das fotos da
         Apollo, em vez do bege de deserto. */
      this.sun.color.setHex(0xfff6ee);
    } else {
      this.sunDirection.copy(SUN_DIR);
      this.sun.color.setHex(0xfff0d2);
    }
    this.skyMaterial.uniforms.sunDir.value.copy(this.sunDirection);
    /* A posição da luz não é escrita aqui: `updateShadowFocus` já a recalcula
       todo quadro a partir de `sunDirection`, seguindo o jogador. Mudar o vetor
       é tudo o que é preciso — o frustum de sombra acompanha sozinho. */

    /* Luz de ambiente quase zero. No vácuo não há céu para reirradiar: a
       sombra é preta de verdade, e é daí que vem o contraste das fotos da
       Apollo. O pouco que sobra é rebote do próprio regolito — sem ele, o lado
       escuro de um duelista viraria uma silhueta ilegível. */
    this.hemi.intensity = HEMI_DAY * (1 - s) + 0.06 * s;
    this.hemi.groundColor.lerp(new THREE.Color("#6b6459"), s);
    this.fill.intensity = FILL_DAY * (1 - s) + 0.04 * s;

    // Estrelas SEM CINTILAR: a cintilação é turbulência de ar. Aqui elas são
    // pontos fixos e frios, e ficam visíveis em pleno "dia".
    this.stars.visible = s > 0.5 || this._night > 0.15;
    if (s > 0.5) this.stars.material.opacity = 0.85;

    // Nuvem no vácuo seria absurdo.
    this.clouds.visible = s < 0.5 && (this._night < 0.5 || this._storm > 0.05);
  }

  /**
   * Fecha o céu na tempestade do chefão (0 → 1).
   *
   * Independente da noite: a virada noturna continua em `setNight`, e isto só
   * puxa as nuvens de volta, as escurece e engrossa a cobertura. Duas draw
   * calls das camadas — o custo não muda.
   */
  setStorm(t) {
    const a = Math.max(0, Math.min(1, t));
    if (a === this._storm) return;
    this._storm = a;
    this.clouds.setStorm(a);
    this.clouds.visible = this._night < 0.5 || a > 0.05;
    if (this.stars?.material) {
      const starBase = Math.max(0, (this._night - 0.15) / 0.85);
      this.stars.material.opacity = starBase * (1 - a * 0.9);
    }
  }

  /**
   * Compila uma vez os programas que mudam quando a noite entra: iluminação
   * pontual, materiais dos NPCs e variantes do fog. O servidor chama isto
   * durante a tela de preparação, quando o jogador ainda não está vendo a cena.
   *
   * `compileAsync` evita bloquear a aba por um único pico quando o navegador
   * oferece a extensão de compilação paralela. O fallback síncrono mantém a
   * compatibilidade com navegadores que não a suportam.
   */
  async prewarmNight() {
    if (typeof this.renderer.compileAsync === "function") {
      await this.renderer.compileAsync(this.scene, this.camera);
      return;
    }
    this.renderer.compile(this.scene, this.camera);
  }

  buildLights() {
    // Sol quente + céu frio: é o contraste que dá o visual "pintado".
    this.sun = new THREE.DirectionalLight(0xfff0d2, SUN_DAY);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(
      CONFIG.render.shadowMapSize,
      CONFIG.render.shadowMapSize,
    );
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.05;
    const r = CONFIG.render.shadowRange;
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 1;
    cam.far = 190;
    cam.updateProjectionMatrix();
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // O rebote do chão puxa para verde-oliva (grama), não para areia: é o que
    // assenta a rocha cinzenta da serra na paleta do vale.
    this.hemi = new THREE.HemisphereLight(0xa8d3ff, 0x5d6142, HEMI_DAY);
    this.scene.add(this.hemi);

    // Preenchimento fraco vindo do lado oposto ao sol, para as sombras não
    // ficarem chapadas de preto.
    this.fill = new THREE.DirectionalLight(0xbcd8ff, FILL_DAY);
    this.fill.position.set(6, 4, -8);
    this.scene.add(this.fill);
  }

  /** Mantém o frustum de sombra centrado na área de jogo relevante. */
  updateShadowFocus(target) {
    const d = 70;
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDirection, d);
    this.sun.target.updateMatrixWorld();
  }

  resize() {
    const { width, height } = viewportSize();
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, CONFIG.render.maxPixelRatio),
    );
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(width, height);
    }
    this.bloom?.setSize(width, height);
  }

  render(dt = 0, wind = null) {
    // Ver `autoReset = false` no construtor: o contador é do QUADRO, não do
    // último passe da cadeia.
    this.renderer.info.reset();
    this.sky.position.copy(this.camera.position);
    // As estrelas acompanham a câmera pelo mesmo motivo que o céu: elas são
    // "infinitamente longe", e sem isto andar cem metros pelo vale deslocaria a
    // constelação inteira.
    this.stars.position.copy(this.camera.position);
    this.clouds.update(dt, this.camera, wind);

    if (this.postEnabled && this.composer) {
      // O grão precisa se mexer, senão o padrão congela na tela e vira textura.
      if (this.grade) this.grade.uniforms.time.value += dt;
      this.composer.render(dt);
      return;
    }
    this.renderer.render(this.scene, this.camera);
  }
}

/* -------------------------------------------------------------- estrelas --- */

/**
 * O céu estrelado: um `THREE.Points` só, ~900 pontos, UM draw call.
 *
 * Os pontos ficam numa esfera de raio 560 — dentro da esfera do céu (600), para
 * ficarem na frente dela, e longe o bastante para o `far` da câmera (900) não
 * cortá-los. `sizeAttenuation: false` deixa cada estrela com o mesmo tamanho em
 * pixels independentemente da distância, que é como estrela se comporta.
 *
 * A distribuição usa z uniforme em [-1,1] (e não latitude uniforme), senão as
 * estrelas se acumulariam nos polos e o zênite viraria uma mancha branca.
 */
function buildStars(count = 900) {
  const posicoes = new Float32Array(count * 3);
  const cores = new Float32Array(count * 3);
  const R = 560;
  // Semente fixa: o céu é o mesmo em todas as telas e em todas as partidas.
  let seed = 20260804;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let i = 0; i < count; i++) {
    const z = rnd() * 2 - 1;
    const ang = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    // Só o hemisfério de cima: estrela abaixo do horizonte é estrela dentro da
    // montanha, e o céu é desenhado sem teste de profundidade.
    const y = Math.abs(z) * 0.92 + 0.04;
    posicoes[i * 3] = Math.cos(ang) * r * R;
    posicoes[i * 3 + 1] = y * R;
    posicoes[i * 3 + 2] = Math.sin(ang) * r * R;

    // Um punhado de estrelas puxa para o azul e para o âmbar; o resto é branco
    // sujo. Um céu de pontos brancos idênticos lê como ruído de sensor.
    const t = rnd();
    const brilho = 0.55 + rnd() * 0.45;
    cores[i * 3] = brilho * (t > 0.86 ? 1.0 : 0.9);
    cores[i * 3 + 1] = brilho * 0.94;
    cores[i * 3 + 2] = brilho * (t < 0.2 ? 1.0 : 0.88);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(posicoes, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(cores, 3));

  const mat = new THREE.PointsMaterial({
    size: 1.7,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });

  const pontos = new THREE.Points(geo, mat);
  pontos.frustumCulled = false;
  pontos.renderOrder = -999; // logo depois do céu, antes de tudo o mais
  return pontos;
}

/* ---------------------------------------------------------------- nuvens ---

   Eram dez sprites planos com uma textura de bolhas. Funcionavam de longe e se
   entregavam de perto: como todo sprite encara a câmera, girar a cabeça girava
   as dez nuvens junto, e cada uma tinha um recorte retangular visível contra o
   azul.

   Agora são DUAS CAMADAS de céu, cada uma um plano horizontal enorme com uma
   função de ruído no fragmento. Ganhos:

   • Duas chamadas de desenho, e não dez.
   • Não há recorte: a nuvem termina onde o ruído termina.
   • DERIVAM COM O VENTO, cada camada num ritmo. É a paralaxe entre as duas que
     dá altura ao céu — a alta anda devagar e é quase branca, a baixa anda
     rápido e tem sombra por baixo. Com uma camada só, o céu é um adesivo que
     escorrega; com duas, ele tem espessura.

   As duas ficam acima dos cumes (~105 m no ponto mais alto da serra), senão
   atravessariam a montanha e o corte entregaria que são planos. */

const CLOUD_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

const CLOUD_FRAG = /* glsl */ `
  uniform vec3 cameraXZ;
  uniform vec2 drift;      // deslocamento acumulado pelo vento (m)
  uniform float scale;     // repetições por metro
  uniform float cover;     // 0 = céu limpo, 1 = fechado
  uniform float softness;  // largura da borda da nuvem
  uniform vec3 topColor;
  uniform vec3 baseColor;
  uniform float opacity;
  uniform float fade;      // distância em que a camada some no horizonte (m)
  uniform vec3 sunDir;

  varying vec3 vWorld;

  float hash( vec2 p ) {
    return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
  }

  float noise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), u.x ),
      mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), u.x ),
      u.y
    );
  }

  /* Três oitavas bastam. A quarta acrescenta detalhe menor que um pixel a
     cento e cinquenta metros de altura — custo puro. */
  float fbm( vec2 p ) {
    float v = 0.0;
    float a = 0.5;
    for ( int i = 0; i < 3; i++ ) {
      v += a * noise( p );
      p = p * 2.03 + 17.3;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 p = ( vWorld.xz + drift ) * scale;
    float n = fbm( p );
    // Segunda amostragem, mais grossa e deslocada: é ela que quebra a
    // regularidade da grade do ruído e evita o padrão de tabuleiro.
    n = mix( n, fbm( p * 0.41 - 4.7 ), 0.45 );

    float a = smoothstep( 1.0 - cover, 1.0 - cover + softness, n );
    if ( a < 0.004 ) discard;

    /* Sombreamento barato: a densidade do ruído vira "quanto desta nuvem está
       na sombra da própria nuvem". O topo pega sol, a base fica azulada — sem
       isso a camada é uma mancha branca chapada. */
    float dens = smoothstep( 1.0 - cover, 1.35 - cover, n );
    vec3 col = mix( baseColor, topColor, dens );

    // Um clarão no lado do sol: a borda voltada para ele fica quase branca.
    vec3 dir = normalize( vWorld - vec3( cameraXZ.x, cameraXZ.y, cameraXZ.z ) );
    col += vec3( 0.10, 0.09, 0.07 ) * pow( max( dot( dir, normalize( sunDir ) ), 0.0 ), 6.0 );

    // O horizonte engole a camada. Sem isto, o plano rasante vira uma faixa
    // dura e cintilante na linha do céu — e nuvem nenhuma tem borda.
    float d = length( vWorld.xz - cameraXZ.xz );
    a *= 1.0 - smoothstep( fade * 0.55, fade, d );

    gl_FragColor = vec4( col, a * opacity );

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

class CloudLayers {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = "clouds";
    this.drift = new THREE.Vector2();
    this.layers = [];
    this._storm = 0;

    /* Alta: fina, muito branca, quase parada — cirros. Baixa: mais fechada,
       mais escura por baixo e três vezes mais rápida. A razão de velocidade
       entre as duas É a paralaxe, e é ela que se lê como distância. */
    const specs = [
      {
        y: 205,
        radius: 880,
        scale: 0.0016,
        cover: 0.42,
        softness: 0.22,
        speed: 0.35,
        opacity: 0.55,
        top: new THREE.Color(0xfdfeff),
        base: new THREE.Color(0xdfeaf6),
        stormCover: 0.78,
        stormOpacity: 0.72,
        stormTop: new THREE.Color(0x6a7388),
        stormBase: new THREE.Color(0x2a303c),
      },
      {
        y: 138,
        radius: 700,
        scale: 0.0034,
        cover: 0.3,
        softness: 0.13,
        speed: 1.1,
        opacity: 0.82,
        top: new THREE.Color(0xfbfcfe),
        base: new THREE.Color(0xb9c8dc),
        stormCover: 0.88,
        stormOpacity: 0.92,
        stormTop: new THREE.Color(0x4a5264),
        stormBase: new THREE.Color(0x151820),
      },
    ];

    for (const s of specs) {
      const geo = new THREE.PlaneGeometry(s.radius * 2, s.radius * 2, 1, 1);
      geo.rotateX(-Math.PI / 2); // horizontal, com a face para baixo
      const mat = new THREE.ShaderMaterial({
        vertexShader: CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
        uniforms: {
          cameraXZ: { value: new THREE.Vector3() },
          drift: { value: new THREE.Vector2() },
          scale: { value: s.scale },
          cover: { value: s.cover },
          softness: { value: s.softness },
          topColor: { value: s.top.clone() },
          baseColor: { value: s.base.clone() },
          opacity: { value: s.opacity },
          fade: { value: s.radius * 0.95 },
          sunDir: { value: SUN_DIR.clone() },
        },
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = s.y;
      mesh.frustumCulled = false;
      mesh.renderOrder = -900;
      this.group.add(mesh);
      this.layers.push({
        mesh,
        mat,
        speed: s.speed,
        dayCover: s.cover,
        dayOpacity: s.opacity,
        dayTop: s.top,
        dayBase: s.base,
        stormCover: s.stormCover,
        stormOpacity: s.stormOpacity,
        stormTop: s.stormTop,
        stormBase: s.stormBase,
      });
    }
  }

  get visible() {
    return this.group.visible;
  }

  set visible(v) {
    this.group.visible = v;
  }

  /**
   * Interpola cobertura e cor entre o céu diurno e o nublado de tempestade.
   * Roda só quando o valor muda — não aloca por quadro.
   */
  setStorm(amount) {
    const a = Math.max(0, Math.min(1, amount));
    if (a === this._storm) return;
    this._storm = a;
    for (const l of this.layers) {
      l.mat.uniforms.cover.value = l.dayCover + (l.stormCover - l.dayCover) * a;
      l.mat.uniforms.opacity.value =
        l.dayOpacity + (l.stormOpacity - l.dayOpacity) * a;
      l.mat.uniforms.topColor.value.lerpColors(l.dayTop, l.stormTop, a);
      l.mat.uniforms.baseColor.value.lerpColors(l.dayBase, l.stormBase, a);
    }
  }

  /**
   * As camadas acompanham a câmera em X e Z (são "infinitamente longe", como o
   * céu) e escorregam pelo vento. O deslocamento é acumulado no UNIFORME, não
   * na posição da malha: mover a malha faria a nuvem andar junto com o jogador.
   */
  update(dt, camera, wind) {
    if (!this.group.visible) return;
    /* Na tempestade o vento empurra mais: nuvem pesada que corre. */
    const boost = 1 + this._storm * 1.4;
    if (wind) {
      this.drift.x -= wind.x * dt * boost;
      this.drift.y -= wind.z * dt * boost;
    } else {
      this.drift.x -= dt * 2.4 * boost;
    }
    for (const l of this.layers) {
      l.mesh.position.x = camera.position.x;
      l.mesh.position.z = camera.position.z;
      l.mat.uniforms.drift.value.set(this.drift.x * l.speed, this.drift.y * l.speed);
      l.mat.uniforms.cameraXZ.value.copy(camera.position);
    }
  }
}

function buildClouds() {
  return new CloudLayers();
}
