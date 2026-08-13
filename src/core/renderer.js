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
import { smoothstep } from "../utils/math.js";
import { shared } from "../levels/resources.js";
import earthUrl from "../assets/images/terra.png";

/* ⚠️ NADA DE CRASE nos dois blocos de shader abaixo.
   Eles são template literals, então uma crase num comentário GLSL encerra a
   string no meio e o erro que aparece é um "falta ponto e vírgula" apontando
   para uma linha de comentário — que não diz nada a quem procura. Já custou
   três builds quebrados. Para citar um identificador, escreva sem marcação. */
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
  uniform sampler2D earthMap;
  uniform float earthSize; // meia-largura angular do disco
  uniform float earthCos;  // cosseno do raio angular — teste barato de recorte
  // A FOTO é 1200×675 (16:9), não quadrada, com o círculo do planeta centrado
  // e inscrito nela. earthAspect = largura/altura da imagem — sem esta
  // correção, o UV abaixo (isotrópico, mesma escala nos dois eixos) amostra o
  // retângulo inteiro como se o círculo tocasse as quatro bordas, e o disco
  // sai OVAL: mais alto que largo, na mesma proporção da foto.
  uniform float earthAspect;
  /* O FIM DA TERRA, em dois números. (Sem crases aqui: isto está dentro de um
     template literal, e uma crase fecharia a string.)
     earthGlow é o clarão aditivo que a engole; earthFade é o que sobra dela.
     Os dois são animados juntos por Renderer.blastEarth, e enquanto ninguém
     acerta o planeta eles valem 0 e 1 — ou seja, o disco continua exatamente
     o que era. */
  uniform float earthGlow;
  uniform float earthFade;

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
         Agora é uma FOTO, não mais ruído.

         O disco procedural resolvia a silhueta e falhava no que importa: a
         Terra é o objeto mais reconhecível que existe, e qualquer continente
         inventado lê como "planeta genérico". Com a foto, o olho identifica na
         hora — e é ela que dá a escala emocional de estar na Lua.

         A imagem já vem recortada com alfa, então o disco não precisa de
         máscara: o próprio alfa diz onde o planeta acaba.

         Fica parada no céu, e isso não é economia: da superfície lunar a Terra
         realmente não nasce nem se põe. A rotação é síncrona. */
      vec3 eDir = normalize(earthDir);
      float ce = dot(dir, eDir);
      if (ce > earthCos) {
        // Base ortonormal do disco, para projetar a direção do olhar em UV.
        vec3 up = normalize(cross(eDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-5));
        vec3 rt = normalize(cross(up, eDir));
        vec2 uv = vec2(dot(dir - eDir * ce, rt), dot(dir - eDir * ce, up));
        uv /= max(1e-5, earthSize);
        // Corrige o aspecto ANTES de mapear para a textura: o círculo (isotrópico
        // no espaço angular) precisa cair no retângulo que a foto realmente tem.
        vec2 st = vec2(uv.x / earthAspect, uv.y) * 0.5 + 0.5;

        if (st.x > 0.0 && st.x < 1.0 && st.y > 0.0 && st.y < 1.0) {
          vec4 tex = texture2D(earthMap, st);

          /* A FASE. O mesmo Sol que ilumina o chão ilumina a Terra, então o
             terminador acompanha sozinho a direção da luz da cena — mover o
             Sol move a sombra no planeta, sem nenhum parâmetro extra.

             A esfera é reconstruída a partir do UV: z é a profundidade do
             ponto na bola, e é ela que faz o terminador ser um arco curvo em
             vez de uma linha reta cortando a foto. */
          float d2 = dot(uv, uv);
          float z = sqrt(max(0.0, 1.0 - d2));
          /* O -eDir é o detalhe que decide se o planeta acende ou não.
             eDir aponta DO OBSERVADOR PARA a Terra; a normal da superfície que
             se vê aponta ao contrário, da Terra de volta para quem olha. Com o
             sinal trocado, o hemisfério visível era tratado como o hemisfério
             oposto e a Terra aparecia sempre em fase nova — um disco escuro
             que ninguém identifica. */
          vec3 nrm = normalize(rt * uv.x + up * uv.y - eDir * z);
          float luz = clamp(dot(nrm, normalize(sunDir)), 0.0, 1.0);
          // Nunca vai a zero: o lado escuro da Terra tem cidades e luar.
          float ilum = 0.10 + 1.35 * pow(luz, 0.8);

          /* O planeta some por ALFA e é engolido por um clarão branco-quente.
             Fazer a bola inteira brilhar (e não só somar luz por cima) é o que
             a lê como "aquilo ali detonou" em vez de "passou uma luz na
             frente": o lado escuro acende junto, e um planeta cujo lado
             noturno acende só pode estar em chamas. */
          float a = tex.a * earthFade;
          vec3 cor = tex.rgb * ilum + vec3(1.0, 0.86, 0.62) * earthGlow;
          vazio = mix(vazio, cor, a);
          vazio += vec3(1.0, 0.78, 0.46) * a * earthGlow * 1.6;

          // Fio de atmosfera no limbo iluminado — o azul que envolve a borda.
          float r = sqrt(d2);
          vazio += vec3(0.30, 0.55, 0.98) * a *
                   smoothstep(0.86, 0.99, r) * luz * 0.55;
        }
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
/**
 * Meia-largura angular do disco da Terra.
 *
 * Constante de módulo porque agora DOIS lugares precisam dela: os uniformes do
 * céu e o teste de "o feixe está apontando para o planeta?" (`aimingAtEarth`).
 * O número não mudou — ver o comentário no bloco de uniformes.
 */
const EARTH_SIZE = 0.11;

/** Segundos do fim da Terra: clarão, engolir, apagar. */
const EARTH_BLAST_TIME = 3.2;

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

/* ------------------------------------------------------------ entardecer ----

   O FIM DA TARDE NÃO É "meia noite".

   `setNight` é um dial dia↔noite: ele apaga o sol, desliga a sombra projetada,
   acende estrelas e fecha a névoa em preto. Interpolá-lo pela metade não dá
   entardecer — dá um dia escuro, sem sombra e com estrelas no céu às cinco da
   tarde. São dois fenômenos diferentes, e por isso são dois dials.

   O que MUDA no fim de tarde, e é só isto:

   • o Sol DESCE (41° → 2,5°), e é daí que vem a sombra comprida, que é o efeito
     inteiro — a muralha passa a projetar trinta metros de sombra sobre a rampa;
   • ele AVERMELHA, porque a luz atravessa mais ar;
   • o céu inverte o gradiente: zênite fundo, horizonte em brasa;
   • a névoa esquenta junto (ela É o ar que avermelhou o Sol);
   • a hemisférica cai um terço.

   O que NÃO muda: a intensidade do Sol cai só 42 %, a sombra continua LIGADA e
   não existe estrela nenhuma. É o que garante o pedido — entardece, não
   escurece. */
/* O FIM DA DESCIDA ficava a 7,5° de elevação, e sete graus e meio não são o
   horizonte: o disco terminava a partida claramente pendurado no céu, e o que
   o modo promete — e o que o HUD e este comentário dizem — é que os dez minutos
   acabam quando o Sol TOCA a linha. Era a única parte do relógio do cerco que
   não se cumpria na tela.
   A 2,5° o disco encosta no horizonte no último minuto. Tudo o mais sai de
   graça e já estava escrito: a sombra da muralha estica mais, a luz esquenta
   mais, e o instante em que a partida acaba passa a ser um instante que se vê
   pela janela em vez de um número. */
const DUSK_DIR = new THREE.Vector3(-0.88, 0.044, 0.47).normalize();
/* O Sol de cima vai para o LADO, e não para trás da rampa.
   Pôr o poente em +Z (à frente da muralha) daria a imagem bonita da horda
   saindo do sol — e contra a luz o defensor não distingue um esqueleto de um
   ogro a sessenta metros. De lado, a mesma sombra comprida atravessa a rampa e
   torna cada silhueta MAIS legível, não menos. */
const SUN_COLOR_DAY = new THREE.Color(0xfff0d2);
const SUN_COLOR_DUSK = new THREE.Color(0xff9c4a);
const SKY_TINT_DUSK = new THREE.Color(0x8fa8d8);
const GROUND_TINT_DUSK = new THREE.Color(0x5c4a34);
/* A névoa esquenta MENOS que o Sol, e é de propósito.
   Levada até o mesmo laranja da luz, ela lavava a serra e a rampa no mesmo tom
   do céu: a 90 m tudo virava uma mancha âmbar só, e a leitura da fila — que é o
   modo inteiro — ia junto. Um tom mais fechado e menos saturado mantém a hora
   do dia e devolve a distância. */
const FOG_DUSK = new THREE.Color(0xb98e6d);
const FILL_COLOR_DAY = new THREE.Color(0xbcd8ff);
const FILL_COLOR_DUSK = new THREE.Color(0x9fb0e0);
const ZENITH_DAY = new THREE.Color("#2c78cc");
const ZENITH_DUSK = new THREE.Color("#1d3f80");
const HORIZON_DAY = new THREE.Color("#d0e2ee");
const HORIZON_DUSK = new THREE.Color("#ffb268");
const SKYGROUND_DAY = new THREE.Color("#b3c3c6");
const SKYGROUND_DUSK = new THREE.Color("#7a6247");
const SUNDISC_DAY = new THREE.Color("#ffe6b0");
const SUNDISC_DUSK = new THREE.Color("#ff8f3c");

/**
 * A textura da Terra, carregada uma vez.
 *
 * É recurso de MÓDULO: uma só existe e ela precisa sobreviver a qualquer troca
 * de fase — destruí-la junto com a Lua deixaria o céu com um retângulo preto na
 * segunda visita. Ver `levels/resources.js`.
 *
 * O carregamento é assíncrono e o céu não espera por ele: até a imagem chegar,
 * o alfa é zero e o disco simplesmente não aparece. Um planeta que surge meio
 * segundo depois do carregamento é melhor que um quadro travado.
 */
let _earthTex = null;
function earthTexture() {
  if (_earthTex) return _earthTex;
  _earthTex = shared(new THREE.TextureLoader().load(earthUrl));
  _earthTex.colorSpace = THREE.SRGBColorSpace;
  // Sem repetição: fora do disco não há imagem, e `RepeatWrapping` faria a
  // borda da foto reaparecer do outro lado do céu.
  _earthTex.wrapS = THREE.ClampToEdgeWrapping;
  _earthTex.wrapT = THREE.ClampToEdgeWrapping;
  _earthTex.anisotropy = 4;
  return _earthTex;
}

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
    /** 0 = Sol alto, 1 = Sol na linha do horizonte. Ver `setDusk`. */
    this._dusk = 0;
    /** 0 = há atmosfera, 1 = vácuo lunar. Ver `setSpace`. */
    this._space = 0;
    /** 0 = céu limpo, 1 = tempestade do chefão. Ver `setStorm`. */
    this._storm = 0;
    /* Rascunhos do flare. São de instância porque `_updateFlare` roda TODO
       QUADRO: dois vetores alocados ali dentro seriam 120 objetos por segundo
       para o coletor de lixo recolher, e pausa de coletor num jogo aparece como
       engasgo. */
    this._flareNdc = new THREE.Vector3();
    this._flareFwd = new THREE.Vector3();

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
    this.grade.uniforms.aspect.value = this.width / this.height;
    this.composer.addPass(this.grade);

    /* Quanto de flare esta máquina paga. Lido UMA vez, aqui, porque o preset já
       está achatado em `CONFIG.render` desde o arranque (ver `applyQuality`) e
       trocar de qualidade recarrega a página.
       No preset `low` isto nem chega a ser consultado: sem bloom e sem MSAA não
       existe cadeia de pós, e sem cadeia não existe este passe. A máquina fraca
       não paga nem o desvio. */
    this._flareStrength = R.flare ?? 0;
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
        earthMap: { value: earthTexture() },
        /* Tamanho aparente. A Terra vista da Lua tem ~2° de diâmetro — quase
           quatro vezes a Lua vista daqui. Uso 0,11 de meia-largura (≈12,5°)
           porque o correto é DECEPCIONANTE: a 2° ela vira um ponto azul e o
           jogador não a reconhece. É a mesma licença que toda foto de pôster
           lunar toma, e pela mesma razão — subiu de 0,085 porque mesmo esse
           exagero ainda lia como pequeno demais no céu cheio. */
        earthSize: { value: EARTH_SIZE },
        earthCos: { value: Math.cos(Math.atan(EARTH_SIZE) * 1.5) },
        // 1200×675: ver o comentário do uniform no shader.
        earthAspect: { value: 1200 / 675 },
        // Intactos até alguém acertar o planeta. Ver `blastEarth`.
        earthGlow: { value: 0 },
        earthFade: { value: 1 },
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
   * Desce o Sol para o fim da tarde (0 → 1). Ver o bloco de constantes acima.
   *
   * Mesma disciplina de `setNight`: tudo o que o entardecer muda passa por
   * aqui, e é isso que garante que voltar ao vale desfaça exatamente o que a
   * ida ao castelo fez.
   *
   * Convive com `setNight` sem brigar por uma razão simples: onde este dial
   * vale, a noite fica em zero, e `setNight` sai na primeira linha quando o
   * valor não muda. As duas fases nunca pedem os dois ao mesmo tempo — o vale
   * anoitece, o castelo entardece.
   */
  setDusk(t) {
    const d = Math.max(0, Math.min(1, t));
    if (d === this._dusk) return;
    this._dusk = d;

    /* O SOL DESCE. É a única linha com consequência de verdade: a direção da
       luz alimenta a câmera de sombra (ver `updateShadowFocus`), o halo do céu
       e a névoa direcional. Uma sombra de muralha com trinta metros sai daqui,
       de graça, sem nenhum código de sombra novo. */
    this.sunDirection.copy(SUN_DIR).lerp(DUSK_DIR, d).normalize();
    this.skyMaterial.uniforms.sunDir.value.copy(this.sunDirection);

    this.sun.color.lerpColors(SUN_COLOR_DAY, SUN_COLOR_DUSK, d);
    // Cai 42 % e para aí: abaixo disso a rampa deixaria de ser legível a 90 m,
    // que é a distância em que o modo inteiro acontece.
    this.sun.intensity = SUN_DAY * (1 - 0.42 * d);
    // A sombra continua LIGADA — ela é o efeito, não uma vítima dele.
    this.sun.castShadow = true;
    this.sun.visible = true;

    this.hemi.intensity = HEMI_DAY * (1 - 0.34 * d);
    this.hemi.color.lerpColors(SKY_TINT_DAY, SKY_TINT_DUSK, d);
    this.hemi.groundColor.lerpColors(GROUND_TINT_DAY, GROUND_TINT_DUSK, d);

    this.fill.intensity = FILL_DAY * (1 - 0.25 * d);
    this.fill.color.lerpColors(FILL_COLOR_DAY, FILL_COLOR_DUSK, d);

    const u = this.skyMaterial.uniforms;
    u.zenith.value.lerpColors(ZENITH_DAY, ZENITH_DUSK, d);
    /* O CÉU pode ser dramático — ele não tem nada em cima para esconder. É a
       névoa que precisa de contenção, porque é ela que cobre o campo de tiro. */
    u.horizon.value.lerpColors(HORIZON_DAY, HORIZON_DUSK, d);
    u.ground.value.lerpColors(SKYGROUND_DAY, SKYGROUND_DUSK, d);
    u.sunColor.value.lerpColors(SUNDISC_DAY, SUNDISC_DUSK, d);

    /* A névoa esquenta junto, e não é enfeite: ela É o ar que avermelhou o Sol.
       Uma névoa azul-clara sob um sol laranja seria a única coisa da cena
       dizendo que ainda é meio-dia. */
    this.scene.fog.color.lerpColors(FOG_DAY, FOG_DUSK, d * 0.78);

    // Nuvem de fim de tarde é metade do céu. Fica.
    this.clouds.visible = true;
    this.stars.visible = false;
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
  /* ------------------------------------------------------------ a Terra ---- */

  /**
   * O feixe está apontado para o planeta?
   *
   * A Terra não é um objeto da cena — é um disco desenhado no shader do céu, a
   * partir de uma DIREÇÃO. Não há colisor para acertar e nunca haverá: ela está
   * infinitamente longe, e uma esfera de verdade lá seria uma esfera de raio
   * absurdo só para receber um teste por partida.
   *
   * Então o acerto é angular, que é a mesma conta que o shader faz para saber
   * se um pixel cai dentro do disco. A folga de 0,75 exige o miolo do planeta e
   * não a borda: raspar a atmosfera não destrói ninguém.
   *
   * @param {{x:number,y:number,z:number}} dir unitária
   */
  aimingAtEarth(dir) {
    if (this._earthGone) return false;
    const e = this.earthDirection;
    const c = dir.x * e.x + dir.y * e.y + dir.z * e.z;
    return c >= Math.cos(Math.atan(EARTH_SIZE) * 0.75);
  }

  /** O feixe chegou. Começa o clarão; `render` conduz o resto. */
  blastEarth() {
    if (this._earthGone) return false;
    this._earthGone = true;
    this._earthT = 0;
    return true;
  }

  /** A Terra volta inteira. Chamado ao (re)entrar na fase, não durante ela. */
  resetEarth() {
    this._earthGone = false;
    this._earthT = 0;
    const u = this.skyMaterial.uniforms;
    u.earthGlow.value = 0;
    u.earthFade.value = 1;
    u.earthSize.value = EARTH_SIZE;
    u.earthCos.value = Math.cos(Math.atan(EARTH_SIZE) * 1.5);
  }

  /**
   * Um passo do fim do mundo.
   *
   * Três coisas ao mesmo tempo, e é a soma delas que lê como explosão: o disco
   * INCHA (o clarão é maior que o planeta), acende até o branco e depois apaga
   * por alfa. `earthCos` acompanha o inchaço — ele é o recorte barato do
   * shader, e sem atualizá-lo o clarão seria cortado num círculo do tamanho
   * antigo, como se a explosão estivesse dentro de uma janela.
   */
  _updateEarthBlast(dt) {
    if (!this._earthGone || this._earthT >= EARTH_BLAST_TIME) return;
    this._earthT += dt;
    const u = this.skyMaterial.uniforms;
    const t = Math.min(1, this._earthT / EARTH_BLAST_TIME);

    // O clarão sobe depressa e cai devagar: é o perfil de uma detonação.
    const glow = t < 0.12 ? t / 0.12 : Math.pow(1 - (t - 0.12) / 0.88, 1.6);
    const escala = 1 + 1.9 * Math.pow(t, 0.55);
    u.earthGlow.value = glow * 5.5;
    u.earthFade.value = Math.pow(1 - t, 1.4);
    u.earthSize.value = EARTH_SIZE * escala;
    u.earthCos.value = Math.cos(Math.atan(EARTH_SIZE * escala) * 1.5);
  }

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

    /* SOMBRA CLARA, e não é falta de rigor.

       A física diz "sem atmosfera não há céu para reirradiar, logo a sombra é
       preta". Levado ao pé da letra, isso produzia um jogo onde metade das
       superfícies é um buraco sem informação — não dá para ler o relevo, não dá
       para ver o adversário no lado escuro, e cada cratera vira uma mancha.

       O que salva a fidelidade é que a sombra lunar real também NÃO é preta: o
       regolito é um refletor difuso muito eficiente, e a luz que ele devolve
       ilumina tudo o que está na sombra. Nas fotos da Apollo dá para ler os
       detalhes do módulo no lado escuro justamente por isso. Então o número
       sobe de 0,06 para 0,42 — e a cor do rebote é a do próprio chão. */
    this.hemi.intensity = HEMI_DAY * (1 - s) + 0.42 * s;
    this.hemi.groundColor.lerp(new THREE.Color("#c2beb6"), s);
    this.fill.intensity = FILL_DAY * (1 - s) + 0.30 * s;

    /* Borda MOLE. O sol é um disco de meio grau, não um ponto: a sombra dele
       tem penumbra, e uma borda recortada em serrilha é o que mais denuncia
       "isto é um shadow map". `radius` espalha a amostragem do PCF. */
    this.sun.shadow.radius = s > 0.5 ? 5 : 1;
    this.sun.shadow.blurSamples = s > 0.5 ? 16 : 8;
    // Sol mais fraco na Lua: com o ambiente alto, manter 3,4 estouraria o
    // regolito claro em branco puro e apagaria as crateras de novo.
    this.sun.intensity = SUN_DAY * (1 - s) + 2.5 * s;

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

  /* --------------------------------------------------------------- flare ----
   *
   * Onde o Sol está na tela, e o quanto de flare isso vale.
   *
   * Esta é a metade de CPU do efeito — o desenho dele está no fragmento de
   * `core/gradePass.js`. Aqui se decide apenas ONDE e QUANTO, e é esta função
   * que garante o "não pesa": um produto escalar, uma projeção de vetor e duas
   * rampas por quadro, sem alocar nada. A GPU recebe três números.
   *
   * SÓ NA LUA. No vale o Sol já tem halo no céu — ele é espalhamento
   * atmosférico de verdade, feito no shader do céu ali em cima (SKY_FRAG), e
   * somar um reflexo de lente por cima seria contar a mesma coisa duas vezes.
   * Na Lua não há ar, o disco é um recorte duro, e o clarão da lente é o único
   * que pode existir.
   */
  _updateFlare() {
    const u = this.grade.uniforms;
    if (this._space < 0.5 || !this._flareStrength) {
      u.flare.value = 0;
      return;
    }

    const cam = this.camera;
    /* As matrizes são atualizadas À MÃO, e é o mesmo par de linhas que o
       `WebGLRenderer.render` faz sozinho — só que ele as faz DEPOIS daqui.
       Sem isto, a conta usaria a câmera do quadro anterior e o flare andaria um
       quadro atrás da imagem: girando o rato, ele escorregaria visivelmente
       atrás do disco do Sol, que é exatamente onde ele não pode estar. */
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();

    /* Sol ATRÁS da câmera não tem posição de tela: a projeção de um ponto com
       w negativo devolve coordenadas que caem no quadro de novo, espelhadas, e
       o flare apareceria ao olhar para o lado oposto ao Sol. Este produto
       escalar é o guarda-corpo, e é ele que descarta o caso antes da conta. */
    this._flareFwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    if (this._flareFwd.dot(this.sunDirection) <= 0) {
      u.flare.value = 0;
      return;
    }

    /* 400 m à frente, na direção do Sol. Qualquer distância serve — o Sol está
       no infinito e a direção é o que importa —, mas ela fica DENTRO do `far`
       da câmera (900 m) para a projeção não depender de um z fora do volume. */
    const p = this._flareNdc
      .copy(cam.position)
      .addScaledVector(this.sunDirection, 400)
      .project(cam);
    u.flarePos.value[0] = p.x * 0.5 + 0.5;
    u.flarePos.value[1] = p.y * 0.5 + 0.5;

    /* Duas rampas sobre a distância do Sol ao centro do quadro (1 = borda):
       uma APAGA o efeito quando ele sai de cena, e a outra o faz CRESCER
       conforme se encara o Sol. A segunda é o pedido em si — "ao olhar para o
       sol" —, e a primeira é o que impede o flare de ficar ancorado na beirada
       da tela quando o Sol já saiu por ela. */
    const r = Math.hypot(p.x, p.y);
    const dentro = 1 - smoothstep(0.95, 1.7, r);
    const encarando = 0.45 + 0.55 * (1 - smoothstep(0.1, 1.05, r));
    u.flare.value = this._flareStrength * dentro * encarando;
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
    // A proporção entra no flare para o fantasma ser redondo; ela só muda aqui.
    if (this.grade) this.grade.uniforms.aspect.value = width / height;
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
    this._updateEarthBlast(dt);

    if (this.postEnabled && this.composer) {
      // O grão precisa se mexer, senão o padrão congela na tela e vira textura.
      if (this.grade) {
        this.grade.uniforms.time.value += dt;
        this._updateFlare();
      }
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
