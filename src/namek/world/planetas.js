/* ---------------------------------------------------------------------------
   Os DOIS PLANETAS de Namekusei — e a morte deles.

   O pedido, inteiro: *"Adicione 2 planetas distintos grandes no cenário. Eles
   devem ficar distantes. Devem ser planetas parecidos com luas. Kamehameha
   nesses planetas os destrói (assim como o planeta Terra da fase do espaço)."*

   ============================================================================
   1. POR QUE ELES SÃO ESFERAS DE VERDADE
   ============================================================================

   A Terra do arqueiro (`core/renderer.js`) é um DISCO desenhado dentro do
   fragmento do céu, a partir de uma direção, e o comentário de lá defende a
   escolha com dois argumentos que aqui não valem:

     • *"ela está infinitamente longe"* — e uma esfera de raio absurdo só para
       receber um teste por partida seria desperdício. Verdade lá; aqui os
       planetas são a metade curta de um efeito que continua no chão, e o teste
       do feixe acontece com o atirador a até 700 m do centro do mundo. Uma
       comparação de cosseno feita a partir da ORIGEM erra por vários graus para
       quem está no outro canto da arena — e vários graus, num disco de 16°, são
       a diferença entre acertar o miolo e passar por fora.
     • *"não há colisor para acertar e nunca haverá"* — lá o feixe é resolvido
       por um caso especial (`aimingAtEarth`). Aqui a conta é a mesma que o resto
       do modo já faz o tempo todo: interseção de um raio com uma esfera (§4 do
       plano — a física deste modo é analítica).

   E há um terceiro motivo, que é o visual: **o relevo os RECORTA.** Eles
   escrevem profundidade a 2.400 m, então a serra na frente os corta como corta
   qualquer outra coisa, e voar por trás de um pico esconde meio planeta. Um
   disco pintado no domo apareceria POR CIMA da montanha, porque o domo desenha
   primeiro e sem escrever profundidade (ver `montarDomo`).

   O que eles herdam do domo é o TRUQUE DA DISTÂNCIA: eles acompanham o olho.
   Sem isso, voar 700 m na direção de um deles mudaria o tamanho aparente em
   30 %, e um corpo celeste que cresce quando você voa para ele é uma bola
   pendurada, não um planeta. Ver `update`.

   ============================================================================
   2. NENHUMA TEXTURA — a lua inteira é uma função
   ============================================================================

   O §3 do plano cobra zero textura, e o relevo lunar sai de RUÍDO CELULAR
   (Worley) avaliado sobre a posição LOCAL do vértice, que é o que faz o padrão
   girar junto com o corpo em vez de deslizar sobre ele.

   Uma célula, uma cratera. E o campo celular devolve de graça as três coisas
   que este arquivo precisa:

     F1          a distância ao centro da cratera → o perfil (bacia + borda)
     o vetor     a direção do centro → a NORMAL do relevo, analítica (§3)
     F2 − F1     a parede entre duas células → a RACHADURA da destruição (§4)

   Duas oitavas: crateras grandes e, por cima, as pequenas com um terço do peso.
   São 27 células por oitava, 54 iterações por pixel — e o disco maior tem
   ~50 000 pixels a 1080p, ou seja ~14 M operações por quadro no pior caso. É
   menos do que o domo gasta com o sol, e ele paga a TELA INTEIRA.

   ============================================================================
   3. A NORMAL É ANALÍTICA, e é ela que faz a cratera existir
   ============================================================================

   Sem perturbar a normal, uma cratera é uma mancha clara e escura pintada numa
   bola lisa — e o olho lê exatamente isso: uma bola pintada. O que a transforma
   em buraco é a luz batendo na parede DE DENTRO de um lado e na sombra do
   outro, e isso exige normal.

   Nada de `dFdx`: o perfil é uma parábola mais um sino, e a derivada de cada um
   sai numa linha. A direção em que ela aponta é a tangente que foge do centro
   da cratera, que é o próprio vetor do campo celular projetado na esfera. Não
   há amostra extra, não há derivada de tela e não há dependência de extensão de
   GLSL.

   ============================================================================
   4. A MORTE, EM TRÊS ATOS
   ============================================================================

   *"Assim como o planeta Terra da fase do espaço"* — e a Terra de lá some em um
   ato só (incha, acende, apaga por alfa). Aqui são três, porque o planeta é
   grande na tela e some devagar o bastante para o olho acompanhar:

       rachar   `NAMEK.planetas.rachar` s — a malha de fendas acende por dentro,
                laranja, seguindo as paredes entre as células. O corpo continua
                inteiro: o que mudou é que ele está brilhando pelas juntas.
       clarão   `clarao` s — o branco engole o disco e um halo aditivo abre.
                É debaixo dele que a esfera some e os cacos aparecem: a troca é
                invisível porque o clarão a cobre.
       cacos    `cacos` s — vinte e seis pedaços saindo em todas as direções,
                girando, esfriando de branco-quente para rocha morta, encolhendo
                no fim. Depois disso o céu tem um planeta a menos, para sempre.

   O relógio dos três é o da SALA (`NS2C.PLANET_DOWN.w`), não o local: quinze
   telas veem o mesmo planeta rachar no mesmo segundo sem trafegar um byte por
   quadro. É o mesmo princípio do `packFighter` — manda-se o relógio, não o
   quadro.

   ============================================================================
   5. O ORÇAMENTO
   ============================================================================

       2  esferas (uma por planeta, 2 240 triângulos cada)
       1  InstancedMesh de cacos (52 vagas × 20 faces) — invisível em repouso
       2  halos do clarão (um quad cada) — invisíveis em repouso
       ------------------------------------------------------------------
       5  chamadas de desenho no pior caso, 2 em regime

   Zero alocação por quadro: os cacos moram em `Float32Array` pré-alocados e as
   matrizes de instância são escritas em rascunhos de módulo.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";
import { NAMEK_SOL_DIR, RAIO_DOMO } from "./sky.js";

/* Cacos por planeta.
 *
 * Vinte e seis é o menor número em que o olho para de contar pedaços. Com doze
 * dá para acompanhar cada um individualmente e a explosão lê como um brinquedo
 * desmontando; com cinquenta, os pedaços ficam pequenos demais para terem
 * silhueta a 2.400 m e a coisa vira poeira. O pool tem vaga para os DOIS
 * planetas ao mesmo tempo porque duas pessoas podem soltar dois Kamehamehas no
 * mesmo segundo, e nesse caso o segundo planeta não pode roubar os cacos do
 * primeiro. */
const CACOS = 26;

/* Segmentos da esfera. O relevo inteiro é do fragmento, então a malha só
   precisa de duas coisas: silhueta redonda a 16° de diâmetro e nenhuma faceta
   no terminador. 40×28 entrega as duas com 2.240 triângulos. */
const SEG_U = 40;
const SEG_V = 28;

/* Ordem de desenho.
 *
 * O domo está em −1000 e as nuvens em −900. Os planetas ficam ENTRE os dois, e
 * a posição não é estética: desenhados depois das nuvens, eles apareceriam por
 * cima da camada de tempestade — um corpo celeste na frente da nuvem que
 * deveria estar cobrindo ele. Antes, a nuvem (transparente, desenhada depois)
 * borra por cima dele, que é o que uma nuvem faz.
 *
 * ------------------------------------------- e por que o CORPO saiu de −950
 *
 * O raciocínio acima continua inteiro para o HALO, que é transparente. Para o
 * corpo — que é OPACO e escreve profundidade — ele custava caro e não comprava
 * nada, porque o three.js mantém DUAS filas: tudo o que é opaco desenha antes
 * de qualquer coisa transparente, e `renderOrder` só ordena DENTRO da fila. A
 * nuvem (`transparent: true`) passaria por cima do planeta mesmo que ele fosse
 * o último opaco do quadro.
 *
 * O que −950 fazia, então, era só uma coisa: mandar sombrear os dois discos
 * ANTES do relevo. Cada um deles ocupa 16° de céu (~200 k fragmentos a 1080p
 * com `devicePixelRatio` 2) e o fragmento deles é o mais caro do modo depois do
 * sol — 27 células de ruído celular por oitava, duas oitavas, mais três oitavas
 * de ruído de valor: ~54 hashes por pixel. Com o buraco de profundidade vazio,
 * TODOS esses pixels eram sombreados, e o anel de montanhas (que fica na frente
 * deles em boa parte do campo de visão) os apagava logo em seguida.
 *
 * Desenhados DEPOIS do mundo opaco, o teste de profundidade descarta esses
 * mesmos pixels antes de o fragmento rodar. A imagem é idêntica em todo pixel
 * — quem estava na frente continua na frente, é o mesmo teste de profundidade
 * decidindo —, e o que se deixa de pagar é o sombreamento do que já ia ser
 * coberto. Contra o céu aberto (voando alto) nada muda, nem para melhor nem
 * para pior: lá não há o que os cubra e eles custam o mesmo de sempre.
 *
 * `+950` e não `0` para eles ficarem depois do relevo, do cenário e do mato,
 * que são os grandes ocultadores; o número exato é indiferente desde que seja
 * maior que o 0 do resto do mundo. */
const ORDEM_CORPO = 950;
/* O HALO fica onde sempre esteve, e é a metade do comentário acima que continua
   valendo palavra por palavra: ele é transparente, e na fila dos transparentes
   a nuvem de tempestade (−900) tem de vir DEPOIS dele. Um halo em +952 seria um
   clarão de detonação por cima da nuvem que devia estar encobrindo o planeta. */
const ORDEM_HALO = -948;

/* ------------------------------------------------------------------- shaders */

/* O ruído celular e o hash são compartilhados pelos dois materiais (planeta e
   caco), e por isso moram numa string só. Repeti-los seria a mesma armadilha de
   sempre: no dia em que o hash mudasse, os cacos deixariam de ter a cara do
   planeta de onde saíram. */
const RUIDO_GLSL = /* glsl */ `
  /* Hash 3D sem seno. O 'fract(sin(dot(...)))' de sempre custa um seno por
     chamada, e aqui há vinte e sete chamadas por oitava por pixel — cinquenta e
     quatro senos em tela cheia é o tipo de conta que só aparece na placa
     integrada de outra pessoa. Este é o hash de Dave Hoskins: dez operações
     inteiras de ponto flutuante, sem transcendental nenhum. */
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }

  float hash13(vec3 p) {
    vec3 h = hash33(p);
    return h.x;
  }

  /* Ruído de valor, para o mosqueado do regolito e para os mares. */
  float ruido3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
          mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
          mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }

  float fbm3(vec3 p) {
    float s = 0.0, a = 0.5, n = 0.0;
    for (int i = 0; i < 3; i++) {
      s += ruido3(p) * a;
      n += a;
      p *= 2.13;
      a *= 0.5;
    }
    return s / n;
  }
`;

const PLANETA_VERT = /* glsl */ `
  /* A posição LOCAL, que é o domínio das crateras. Local e não de mundo porque
     o planeta gira: no domínio de mundo o padrão ficaria parado enquanto o
     corpo passa por baixo dele, que é o efeito de uma bola de vidro girando
     dentro de um desenho. */
  varying vec3 vLocal;
  varying vec3 vMundo;
  void main() {
    vLocal = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vMundo = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const PLANETA_FRAG = /* glsl */ `
  uniform vec3 corRocha;
  uniform vec3 corAlta;
  uniform vec3 corBacia;
  uniform vec3 corSombra;
  /** Direção do sol, em MUNDO. A MESMA de 'NAMEK_SOL_DIR' — ver a nota lá. */
  uniform vec3 solDir;
  /* A ROTAÇÃO do corpo, de local para mundo.
   *
   * Ela existe porque o three.js NÃO declara 'modelMatrix' no fragmento — o
   * prefixo de fragmento só traz 'viewMatrix', 'cameraPosition' e
   * 'isOrthographic'. Escrever 'mat3(modelMatrix)' aqui compila no vértice e
   * quebra o programa inteiro no fragmento, e o sintoma é um material preto sem
   * nenhum erro no console de JavaScript.
   *
   * Vem pronta da CPU uma vez por quadro (ver 'update'), com a escala do corpo
   * dentro dela — o que é inofensivo porque tudo o que sai daqui é normalizado. */
  uniform mat3 rot;
  /** Células de cratera por raio. Alta = corpo picotado. */
  uniform float densidade;
  /** 0 a 1 — quanto da superfície é bacia escura ("mar"). */
  uniform float mares;
  /** 0 a 1 — as rachaduras acendendo. É o primeiro ato da destruição. */
  uniform float quebra;
  /** 0 a 1 — o branco engolindo tudo. O segundo ato. */
  uniform float clarao;
  /** 1 de dia, ~0,2 na tempestade: a atmosfera carregada engole o céu inteiro. */
  uniform float ceu;

  varying vec3 vLocal;
  varying vec3 vMundo;

  ${RUIDO_GLSL}

  /* O campo celular, com as três saídas que este arquivo usa (ver §2 do
     cabeçalho). 'xyz' é o vetor até o centro da célula vencedora — é dele que
     sai a normal —, 'w' é F2−F1, a distância à parede entre células. */
  vec4 celular(vec3 p, out float f1) {
    vec3 i = floor(p);
    vec3 f = p - i;
    float d1 = 9.0;
    float d2 = 9.0;
    vec3 melhor = vec3(0.0, 0.0, 1.0);
    for (int x = -1; x <= 1; x++) {
      for (int y = -1; y <= 1; y++) {
        for (int z = -1; z <= 1; z++) {
          vec3 o = vec3(float(x), float(y), float(z));
          vec3 c = o + hash33(i + o) - f;
          float d = dot(c, c);
          if (d < d1) { d2 = d1; d1 = d; melhor = c; }
          else if (d < d2) { d2 = d; }
        }
      }
    }
    f1 = sqrt(d1);
    return vec4(melhor, sqrt(d2) - f1);
  }

  /* O PERFIL de uma cratera e a DERIVADA dele, os dois de uma vez.
   *
   * 'd' é a distância ao centro em raios de cratera. A bacia é uma parábola
   * (fundo redondo, parede que abre) e a borda é um sino em d = 1 — as duas
   * formas que uma cratera de impacto tem, e as duas com derivada de uma linha.
   * Devolve (altura, derivada). */
  vec2 cratera(float d, float fundura) {
    float dentro = step(d, 1.0);
    float bacia = dentro * (d * d - 1.0) * fundura;
    float dBacia = dentro * 2.0 * d * fundura;
    float e = exp(-9.0 * (d - 1.0) * (d - 1.0));
    float borda = e * fundura * 0.45;
    float dBorda = -18.0 * (d - 1.0) * borda;
    return vec2(bacia + borda, dBacia + dBorda);
  }

  void main() {
    vec3 n = normalize(vLocal);
    vec3 dom = n * densidade;

    /* ------------------------------------------------------ duas oitavas ---
       A grande dá a silhueta do relevo; a pequena pica o que sobrou. Um terço
       do peso e três vezes a densidade — mais que isso e a segunda vira granulado
       de alta frequência, que a 2.400 m só produz cintilação entre quadros. */
    float f1;
    vec4 c1 = celular(dom, f1);
    float raioC = 0.30 + hash13(floor(dom) * 1.7) * 0.24;
    vec2 p1 = cratera(f1 / raioC, 1.0);

    float f1b;
    vec4 c2 = celular(dom * 3.1 + 11.7, f1b);
    vec2 p2 = cratera(f1b / 0.42, 0.34);

    float alt = p1.x + p2.x;

    /* ------------------------------------------------------- a normal -----
       A tangente que FOGE do centro da cratera: o vetor até o centro, projetado
       fora da esfera e invertido. A derivada do perfil diz o quanto inclinar. */
    vec3 tan1 = -(c1.xyz - n * dot(c1.xyz, n));
    float l1 = length(tan1);
    tan1 = l1 > 1e-4 ? tan1 / l1 : vec3(0.0);
    vec3 tan2 = -(c2.xyz - n * dot(c2.xyz, n));
    float l2 = length(tan2);
    tan2 = l2 > 1e-4 ? tan2 / l2 : vec3(0.0);

    /* O RELEVO É EXAGERADO, e é de propósito: 0,40 sobre as duas oitavas
       somadas inclina a normal em até 60° na parede de uma cratera, e é isso
       que o olho lê a 2.400 m. A escala geológica real (paredes de 2°) some no
       terminador e devolve a bola pintada que o §3 existe para evitar. */
    vec3 nLocal = normalize(n - (tan1 * p1.y + tan2 * p2.y) * 0.40);
    vec3 N = normalize(rot * nLocal);
    vec3 nEsfera = normalize(rot * n);

    /* --------------------------------------------------------- a cor ------ */
    float mosqueado = fbm3(n * 7.3);
    /* O piso de rocha, a bacia (fundo de cratera, onde a poeira é mais funda e
       portanto mais escura) e o material claro que o impacto expôs na borda. */
    vec3 albedo = mix(corBacia, corRocha, smoothstep(-0.85, 0.05, alt));
    albedo = mix(albedo, corAlta, smoothstep(0.06, 0.34, alt + mosqueado * 0.12));
    albedo *= 0.86 + mosqueado * 0.28;

    /* OS MARES. Manchas escuras GRANDES — lava antiga que encheu bacias — e é
       o traço que distingue os dois corpos à primeira vista: Kuraia tem zero,
       Rubel tem um terço da superfície. Frequência baixa de propósito: um mar é
       do tamanho de um continente, não de uma cratera. */
    float mar = smoothstep(0.5, 0.68, fbm3(n * 1.45 + 3.1));
    albedo = mix(albedo, corBacia * 0.72, mar * mares);

    /* ---------------------------------------------------------- a luz ----- */
    float lam = dot(N, solDir);
    /* O TERMINADOR. Estreito (um corpo sem ar tem sombra dura) mas não um
       degrau: o relevo já o deixa serrilhado sozinho, e um corte perfeito
       denunciaria que aquilo é uma esfera matemática. */
    float dia = smoothstep(-0.04, 0.16, lam);
    vec3 luz = albedo * (0.10 + 1.15 * max(lam, 0.0));

    /* O LADO ESCURO NÃO É PRETO. Ele recebe o céu — e um planeta com lado
       escuro preto lê como recorte de papel colado no fundo. A tinta de sombra
       ainda carrega o albedo, senão o relevo desapareceria do lado noturno e o
       corpo pareceria cortado ao meio. */
    vec3 escuro = corSombra * (0.55 + 0.9 * dot(albedo, vec3(0.33)));
    vec3 cor = mix(escuro, luz, dia);

    /* ESCURECIMENTO DE LIMBO. Rasante, na borda do disco: é o que arredonda o
       corpo. Sem ele a esfera fica com aparência de adesivo mesmo com a luz
       certa. */
    vec3 olho = normalize(cameraPosition - vMundo);
    float borda = max(dot(nEsfera, olho), 0.0);
    cor *= mix(0.74, 1.0, pow(borda, 0.45));

    /* ------------------------------------------------- a morte, ato 1 ------
       As RACHADURAS. Elas nascem nas paredes entre células — as mesmas paredes
       que separam duas crateras —, e isso não é economia: é a leitura certa. Um
       corpo se parte pelas juntas que ele já tinha, e as juntas dele são as que
       o relevo desenha. A fenda ALARGA com 'quebra', e o miolo dela vai do
       laranja ao branco. */
    float fenda = 1.0 - smoothstep(0.0, 0.045 + quebra * 0.16, c1.w);
    float brasa = fenda * quebra;
    cor = mix(cor, vec3(1.0, 0.38, 0.08), brasa * 0.85);
    cor += vec3(1.0, 0.62, 0.24) * brasa * quebra * 2.4;

    // Ato 2: o branco. Some por cima de tudo, inclusive das fendas.
    cor = mix(cor, vec3(1.9, 1.8, 1.65), clarao);

    /* A TEMPESTADE os engole. Não é um capricho: 'NAMEK.weather' fecha o céu
       com nuvem revolta e névoa densa, e um corpo celeste continuando nítido
       atrás disso seria a única coisa do quadro que não soube que o planeta
       está acabando. */
    cor *= ceu;

    gl_FragColor = vec4(cor, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------- cacos -- */

const CACO_VERT = /* glsl */ `
  /* 'instanceMatrix' e 'instanceColor' são DECLARADOS pelo three.js no prefixo
     de todo 'ShaderMaterial' desenhado por um 'InstancedMesh' — declará-los de
     novo aqui é erro de compilação, não redundância. 'instanceColor' carrega o
     CALOR do caco no canal vermelho: um número por instância, sem um atributo
     próprio e sem um segundo buffer. */
  varying vec3 vNormal;
  varying float vCalor;
  void main() {
    vCalor = instanceColor.r;
    vec4 lp = instanceMatrix * vec4(position, 1.0);
    /* A normal só precisa da ROTAÇÃO da instância, e a matriz de instância aqui
       tem escala uniforme (ver 'explodir'), então a submatriz 3×3 normalizada
       basta — sem inversa-transposta e sem uniform novo. */
    vNormal = normalize(mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * lp;
  }
`;

const CACO_FRAG = /* glsl */ `
  uniform vec3 corRocha;
  uniform vec3 solDir;
  uniform float ceu;
  varying vec3 vNormal;
  varying float vCalor;
  void main() {
    float lam = max(dot(normalize(vNormal), solDir), 0.0);
    vec3 fria = corRocha * (0.16 + 0.95 * lam);
    /* A BRASA. O caco sai branco-quente e esfria para a cor do corpo de onde
       veio. Duas cores e não uma rampa contínua: o miolo do calor estoura no
       ACES (é isso que faz o olho ler "quente"), e a coroa laranja é o que
       sobra quando ele cai. */
    vec3 quente = mix(vec3(1.6, 0.55, 0.14), vec3(2.4, 2.2, 1.9), vCalor * vCalor);
    gl_FragColor = vec4(mix(fria, quente, vCalor) * ceu, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------- halo --- */

const HALO_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HALO_FRAG = /* glsl */ `
  uniform vec3 cor;
  uniform float forca;
  varying vec2 vUv;
  void main() {
    /* Um disco macio por conta, sem textura. Duas quedas somadas: a de dentro
       (expoente alto) é o núcleo estourado, a de fora (expoente baixo) é a
       dispersão. Uma só daria ou um ponto duro ou uma mancha sem centro. */
    float d = length(vUv - 0.5) * 2.0;
    float nucleo = pow(max(1.0 - d, 0.0), 3.2);
    float coroa = pow(max(1.0 - d, 0.0), 0.9);
    /* A FORMA vai no alfa e a INTENSIDADE vai na cor, e a divisão não é livre:
       'AdditiveBlending' sem alfa pré-multiplicado soma 'rgb · a', então pôr a
       força no alfa a elevaria ao quadrado — o halo abriria devagar demais e
       estouraria de uma vez no fim. */
    float a = clamp(nucleo + coroa * 0.34, 0.0, 1.0);
    if (a <= 0.002) discard;
    gl_FragColor = vec4(cor * forca, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* --------------------------------------------------------------- rascunhos -- */

const _v = new THREE.Vector3();
const _eixo = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _escala = new THREE.Vector3();

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Sorteio determinístico e barato para a forma dos cacos. Não precisa de
 *  qualidade estatística nenhuma: precisa ser o mesmo em toda máquina. */
function semente(s) {
  let a = s >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

export class NamekPlanetas {
  constructor() {
    /** Um registro por corpo de `NAMEK.planetas.corpos`. */
    this.corpos = [];
    this.root = null;
    /* Escrito por `setStorm` e lido pelos três materiais. Guardado aqui porque
       o clima pode chegar ANTES do `build` (o `welcome` aplica o clima
       instantâneo de quem entra no meio de uma tempestade). */
    this.ceu = 1;
  }

  build(parent) {
    const P = NAMEK.planetas;
    this.root = new THREE.Group();
    this.root.name = "namek-planetas";
    parent.add(this.root);

    /* O domo é o teto de todos eles. Sem esta conferência, encolher o céu um dia
       jogaria os dois para fora dele e eles sumiriam sem nada dizer por quê —
       ver a nota em `RAIO_DOMO`. */
    const dist = Math.min(P.distancia, RAIO_DOMO * 0.95);

    const geo = new THREE.SphereGeometry(1, SEG_U, SEG_V);
    const geoCaco = this.montarCaco();
    const geoHalo = new THREE.PlaneGeometry(1, 1);

    /* UM InstancedMesh para os cacos dos DOIS planetas: cada um é dono de uma
       fatia fixa de `CACOS` vagas. Duas malhas seriam duas chamadas de desenho
       para um acontecimento que dura seis segundos por partida. */
    this.cacoMat = new THREE.ShaderMaterial({
      vertexShader: CACO_VERT,
      fragmentShader: CACO_FRAG,
      fog: false,
      uniforms: {
        corRocha: { value: new THREE.Color(P.corpos[0].paleta.rocha) },
        solDir: { value: NAMEK_SOL_DIR.clone() },
        ceu: { value: this.ceu },
      },
    });
    this.cacos = new THREE.InstancedMesh(geoCaco, this.cacoMat, CACOS * P.corpos.length);
    this.cacos.name = "namek-planeta-cacos";
    this.cacos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cacos.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(CACOS * P.corpos.length * 3),
      3,
    );
    this.cacos.instanceColor.setUsage(THREE.DynamicDrawUsage);
    /* Os cacos viajam para longe do centro da malha e a esfera envolvente dela
       não acompanha; e o objeto só existe seis segundos por partida. Testar
       frustum aqui só produziria pedaços sumindo na borda da tela. */
    this.cacos.frustumCulled = false;
    this.cacos.visible = false;
    /* Os cacos são opacos como o corpo de que saíram, e acompanham a mudança
       pelo mesmo motivo: eles nascem no lugar exato onde o planeta estava, ou
       seja, atrás do mesmo anel de montanhas. */
    this.cacos.renderOrder = ORDEM_CORPO + 1;
    this.root.add(this.cacos);

    /* TODA vaga nasce com escala zero, inclusive as do planeta que ainda está
       inteiro. Sem isto, destruir o SEGUNDO corpo acenderia a malha com as 26
       vagas do primeiro ainda na matriz identidade — vinte e seis pedras de um
       metro plantadas na origem do mundo, no meio da ilha. Mexer no `count`
       para evitá-las funcionaria só enquanto os dois planetas fossem
       destruídos na ordem em que estão escritos. */
    _escala.set(0, 0, 0);
    _v.set(0, 0, 0);
    _q.identity();
    _m.compose(_v, _q, _escala);
    for (let i = 0; i < this.cacos.count; i++) this.cacos.setMatrixAt(i, _m);
    this.cacos.instanceMatrix.needsUpdate = true;

    /* Todos os cacos, dos dois planetas, num punhado de arrays paralelos.
       Pré-alocados: a explosão não aloca um byte (§3). */
    const n = CACOS * P.corpos.length;
    this.cx = new Float32Array(n);
    this.cy = new Float32Array(n);
    this.cz = new Float32Array(n);
    this.cvx = new Float32Array(n);
    this.cvy = new Float32Array(n);
    this.cvz = new Float32Array(n);
    /** Eixo de rotação de cada caco, e a velocidade angular. */
    this.cax = new Float32Array(n);
    this.cay = new Float32Array(n);
    this.caz = new Float32Array(n);
    this.cw = new Float32Array(n);
    this.cang = new Float32Array(n);
    this.craio = new Float32Array(n);

    for (let i = 0; i < P.corpos.length; i++) {
      const def = P.corpos[i];
      const dir = new THREE.Vector3(def.dir[0], def.dir[1], def.dir[2]).normalize();

      const mat = new THREE.ShaderMaterial({
        vertexShader: PLANETA_VERT,
        fragmentShader: PLANETA_FRAG,
        fog: false,
        uniforms: {
          corRocha: { value: new THREE.Color(def.paleta.rocha) },
          corAlta: { value: new THREE.Color(def.paleta.alta) },
          corBacia: { value: new THREE.Color(def.paleta.bacia) },
          corSombra: { value: new THREE.Color(def.paleta.sombra) },
          solDir: { value: NAMEK_SOL_DIR.clone() },
          rot: { value: new THREE.Matrix3() },
          densidade: { value: def.crateras },
          mares: { value: def.mares },
          quebra: { value: 0 },
          clarao: { value: 0 },
          ceu: { value: this.ceu },
        },
      });

      /* O EIXO INCLINADO mora num grupo, e o corpo gira dentro dele. Girar a
         malha em torno de um eixo tombado direto exigiria compor quatérnios por
         quadro; com o grupo, o giro é `rotation.y += w·dt` e a inclinação é uma
         constante escrita uma vez. */
      const pivo = new THREE.Group();
      pivo.rotation.z = (i === 0 ? 0.26 : -0.42);
      pivo.rotation.x = (i === 0 ? 0.12 : 0.3);

      const malha = new THREE.Mesh(geo, mat);
      malha.name = `namek-planeta-${def.id}`;
      malha.scale.setScalar(def.raio);
      malha.renderOrder = ORDEM_CORPO;
      pivo.add(malha);
      this.root.add(pivo);

      /* O HALO do clarão. Um quad que encara a câmera — ele é a luz da
         detonação, e luz não tem lado. */
      const halo = new THREE.Mesh(
        geoHalo,
        new THREE.ShaderMaterial({
          vertexShader: HALO_VERT,
          fragmentShader: HALO_FRAG,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          fog: false,
          uniforms: {
            cor: { value: new THREE.Color(0xfff0d2) },
            forca: { value: 0 },
          },
        }),
      );
      halo.name = `namek-planeta-halo-${def.id}`;
      halo.visible = false;
      halo.renderOrder = ORDEM_HALO;
      this.root.add(halo);

      this.corpos.push({
        def,
        dir,
        dist,
        pivo,
        malha,
        mat,
        halo,
        /* Centro em MUNDO, reescrito por `update`. É contra ele que o feixe é
           testado — ver `naMira`.
           Ele nasce POSICIONADO (como se o olho estivesse na origem) e não em
           zero, e isso fecha um caso de canto real: `naMira` roda no bloco de
           disparo, que vem ANTES do `world.update` dentro do quadro. Com o
           centro na origem, um lutador a 90 m do meio do mapa estaria DENTRO da
           esfera de teste de 245 m, e todo Kamehameha do primeiro quadro
           contaria como acerto nos dois corpos. A sala recusaria (a direção não
           bateria), mas um teste que só não estraga nada porque outro o conserta
           é um teste errado.
           O quadro de atraso que sobra é inofensivo pelo motivo de sempre: a
           lente anda um metro por quadro contra 2.400 m de distância, ou 0,024°. */
        centro: new THREE.Vector3().copy(dir).multiplyScalar(dist),
        /** rad/s. `giro` vem em voltas por minuto. */
        w: (def.giro * Math.PI * 2) / 60,
        /** "inteiro" | "morrendo" | "ido". */
        estado: "inteiro",
        /** ms no relógio da SALA em que a sequência começou. */
        inicio: 0,
        /** Primeira vaga de caco deste planeta. */
        base: i * CACOS,
        /** Os cacos já nasceram? O ato 2 os acende uma vez só. */
        estourou: false,
      });
    }

    this.geoBase = geo;
    this.geoCaco = geoCaco;
    this.geoHalo = geoHalo;
    return this;
  }

  /**
   * A forma de um caco: um icosaedro amassado, raio 1.
   *
   * UMA geometria para os cinquenta e dois pedaços, e a variedade vem da ESCALA
   * NÃO UNIFORME de cada instância (ver `explodir`). Cinquenta e duas malhas
   * distintas dariam cinquenta e duas silhuetas — e a 2.400 m um caco tem seis
   * pixels, onde nenhuma delas se distingue da outra.
   *
   * `flatShading` não entra: o shader dos cacos usa a normal do vértice e a
   * geometria já é facetada por construção (icosaedro de detalhe zero), então
   * cada face recebe a luz do jeito duro que se quer de pedra quebrada.
   */
  montarCaco() {
    const g = new THREE.IcosahedronGeometry(1, 0);
    const pos = g.attributes.position;
    const rnd = semente(0x9e3779b9);
    for (let i = 0; i < pos.count; i++) {
      const k = 0.55 + rnd() * 0.75;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.82, pos.getZ(i) * k);
    }
    g.computeVertexNormals();
    return g;
  }

  /* ============================================================== o acerto == */

  /**
   * O feixe está apontado para algum planeta? Devolve o id, ou `null`.
   *
   * **Interseção raio-esfera de verdade**, e não uma comparação de cossenos.
   * A diferença aparece justamente onde ela importa: a esfera está a 2.400 m do
   * OLHO, e quem atira pode estar a 700 m do olho — o ângulo medido a partir da
   * origem do mundo e o medido a partir da mão do lutador divergem em vários
   * graus, num disco que tem dezesseis.
   *
   * O raio é encolhido por `NAMEK.planetas.miolo`: **raspar o limbo não destrói
   * planeta nenhum.** É a mesma regra do `aimFrac` da Terra do arqueiro, e ela
   * existe porque a leitura honesta de um tiro que passa a meio grau da borda é
   * "passou raspando" — sem o corte, o jogador seria premiado por errar.
   *
   * @param {{x,y,z}} origem a mão de quem atirou
   * @param {{x,y,z}} dir direção do disparo (não precisa vir normalizada)
   * @returns {string|null}
   */
  naMira(origem, dir) {
    if (!origem || !dir) return null;
    const inv = 1 / (Math.hypot(dir.x, dir.y, dir.z) || 1);
    const dx = dir.x * inv;
    const dy = dir.y * inv;
    const dz = dir.z * inv;

    let escolhido = null;
    let maisPerto = Infinity;
    for (const p of this.corpos) {
      if (p.estado !== "inteiro") continue;
      const ox = origem.x - p.centro.x;
      const oy = origem.y - p.centro.y;
      const oz = origem.z - p.centro.z;
      const b = ox * dx + oy * dy + oz * dz;
      // Centro atrás do atirador: nem vale medir.
      if (b > 0) continue;
      const r = p.def.raio * NAMEK.planetas.miolo;
      const c = ox * ox + oy * oy + oz * oz - r * r;
      if (b * b - c < 0) continue;
      /* Os dois na mira ao mesmo tempo é geometricamente impossível (eles estão
         a 82° um do outro), mas o desempate é escrito assim mesmo: uma regra que
         depende de duas constantes não colidirem é uma regra que quebra no dia
         em que alguém mexer nas constantes. */
      const t = -b;
      if (t < maisPerto) {
        maisPerto = t;
        escolhido = p.def.id;
      }
    }
    return escolhido;
  }

  /* ============================================================== a morte == */

  /**
   * A sala decretou: este planeta acabou. `w` é o instante DELA.
   *
   * Idempotente por planeta — a mensagem pode chegar duas vezes (reconexão,
   * retransmissão) e a segunda não pode reiniciar a sequência no meio dela.
   */
  derrubar(id, w) {
    const p = this.corpos.find((c) => c.def.id === id);
    if (!p || p.estado !== "inteiro") return false;
    p.estado = "morrendo";
    p.inicio = w;
    p.estourou = false;
    return true;
  }

  /**
   * Os que já tinham caído antes de eu entrar. Somem SEM sequência.
   *
   * Quem chega no meio da partida não pode ver o planeta se partindo de novo —
   * é o mesmo cuidado que a lista de crateras e a de peças derrubadas tomam no
   * `welcome`, e pelo mesmo motivo: o retardatário precisa do ESTADO, não do
   * acontecimento.
   */
  jaCaidos(lista) {
    for (const id of lista ?? []) {
      const p = this.corpos.find((c) => c.def.id === id);
      if (!p) continue;
      p.estado = "ido";
      p.malha.visible = false;
      p.halo.visible = false;
    }
  }

  /** Um planeta virou cacos: acende as vagas dele. */
  explodir(p) {
    p.estourou = true;
    p.malha.visible = false;

    const R = p.def.raio;
    const rnd = semente(p.def.id.charCodeAt(0) * 7919 + 13);
    for (let k = 0; k < CACOS; k++) {
      const i = p.base + k;
      /* Direções bem espalhadas: um ângulo azimutal livre e um cosseno uniforme
         em [−1, 1]. Sortear a LATITUDE em vez do cosseno amontoaria os cacos nos
         polos, e a explosão sairia com dois tufos e um vazio no meio. */
      const cosT = rnd() * 2 - 1;
      const senT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
      const fi = rnd() * Math.PI * 2;
      const ux = senT * Math.cos(fi);
      const uy = cosT;
      const uz = senT * Math.sin(fi);

      /* Eles nascem DENTRO do corpo, a meio raio: nascendo na superfície, o
         miolo ficaria vazio no primeiro quadro e o planeta pareceria uma casca
         de ovo se abrindo. */
      const d0 = R * (0.18 + rnd() * 0.42);
      this.cx[i] = ux * d0;
      this.cy[i] = uy * d0;
      this.cz[i] = uz * d0;

      /* A velocidade é uma fração do RAIO por segundo, não um número em metros:
         é o que faz os dois planetas — de tamanhos diferentes — se abrirem no
         mesmo tempo na tela. Em `cacos` segundos eles chegam a ~1,6 raios. */
      const v = R * (0.14 + rnd() * 0.16);
      this.cvx[i] = ux * v;
      this.cvy[i] = uy * v;
      this.cvz[i] = uz * v;

      _eixo.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
      if (_eixo.lengthSq() < 1e-4) _eixo.set(0, 1, 0);
      _eixo.normalize();
      this.cax[i] = _eixo.x;
      this.cay[i] = _eixo.y;
      this.caz[i] = _eixo.z;
      this.cw[i] = (rnd() * 2 - 1) * 1.6;
      this.cang[i] = rnd() * Math.PI * 2;
      this.craio[i] = R * (0.10 + rnd() * 0.15);
    }

    this.cacos.visible = true;
    /* A cor dos cacos é do último corpo a explodir. Com os dois se partindo no
       mesmo instante — dois Kamehamehas no mesmo segundo, que é raro e não é
       impossível — os pedaços de Kuraia herdariam o ferrugem de Rubel por
       alguns segundos. Um material por planeta custaria uma chamada de desenho
       permanente para consertar um caso que dura seis segundos e que ninguém
       consegue olhar duas vezes: os dois estão a 82° um do outro. */
    this.cacoMat.uniforms.corRocha.value.set(p.def.paleta.rocha);
  }

  /* =============================================================== quadro == */

  /**
   * @param {number} dt
   * @param {THREE.Vector3} cameraPos os corpos acompanham o olho — ver §1
   * @param {number} tempoSala relógio da SALA em ms; é ele que conduz a morte
   */
  update(dt, cameraPos, tempoSala = 0) {
    const P = NAMEK.planetas;
    const fim = P.rachar + P.clarao + P.cacos;

    for (const p of this.corpos) {
      if (p.estado === "ido") continue;

      /* ACOMPANHAR O OLHO. O pivô inteiro se move; a malha continua na origem
         dele, girando. É o mesmo que o domo faz, e pela mesma razão. */
      if (cameraPos) {
        p.centro.copy(cameraPos).addScaledVector(p.dir, p.dist);
        p.pivo.position.copy(p.centro);
        p.halo.position.copy(p.centro);
        /* O halo encara a lente. `lookAt` num objeto por quadro é barato e é o
           único jeito honesto de um quad de luz não sumir de perfil. */
        p.halo.lookAt(cameraPos);
      }
      p.malha.rotation.y += p.w * dt;

      /* A ROTAÇÃO PARA O FRAGMENTO. Ela é forçada aqui, com `updateMatrixWorld`,
         e não lida da matriz que o renderizador vai calcular daqui a pouco: o
         `matrixWorld` de um objeto só é atualizado dentro do `render`, então
         lê-lo agora daria a rotação do quadro ANTERIOR. Num corpo que gira meio
         grau por segundo isso seria invisível — e é justamente por ser
         invisível que valeria a pena estar errado por anos. Duas multiplicações
         de matriz por planeta por quadro é o preço de não ter esse débito. */
      p.pivo.updateMatrixWorld(true);
      p.mat.uniforms.rot.value.setFromMatrix4(p.malha.matrixWorld);

      if (p.estado !== "morrendo") continue;

      const t = (tempoSala - p.inicio) / 1000;
      if (t < 0) continue;

      /* --------------------------------------------------- ato 1: rachar --
         Ao quadrado, e não linear: a fenda tem de abrir DEVAGAR no começo (o
         corpo ainda parece inteiro, só com um fiapo de luz nas juntas) e correr
         no fim. Uma rampa linear anuncia o desfecho cedo demais e o clarão
         chega como confirmação em vez de susto. */
      const quebra = clamp01(t / Math.max(0.001, P.rachar));
      p.mat.uniforms.quebra.value = quebra * quebra;

      /* --------------------------------------------------- ato 2: clarão --
         A ORDEM AQUI JÁ FOI UM BUG: os cacos nasciam no primeiro quadro do
         clarão, com o halo ainda em zero — o planeta simplesmente sumia e
         reaparecia em pedaços, sem nada entre uma coisa e outra. O corpo
         continua inteiro e vai ficando BRANCO durante `clarao` inteiro, e só
         quando o halo está no auge é que ele é trocado pelos cacos. A troca
         acontece dentro da luz, que é o único lugar onde ela não se vê. */
      const tc = t - P.rachar;
      if (tc >= 0) {
        const u = clamp01(tc / Math.max(0.001, P.clarao));
        p.mat.uniforms.clarao.value = u * u;

        const total = P.clarao + P.cacos;
        /* Sobe depressa e cai devagar — o perfil de uma detonação, o mesmo de
           `_updateEarthBlast` do lado do arqueiro. */
        const forca =
          tc < P.clarao
            ? Math.pow(u, 1.4)
            : Math.pow(clamp01(1 - (tc - P.clarao) / P.cacos), 1.8);
        p.halo.visible = forca > 0.004;
        p.halo.material.uniforms.forca.value = forca * 1.7;
        /* O halo INCHA, e é o TAMANHO — não o brilho — que faz uma explosão ler
           como grande. Ele passa de uma vez e meia o corpo a quase cinco vezes. */
        const s = p.def.raio * (1.5 + 3.3 * Math.pow(clamp01(tc / total), 0.55));
        p.halo.scale.set(s, s, 1);
      }

      /* ---------------------------------------------------- ato 3: cacos -- */
      const tk = t - P.rachar - P.clarao;
      if (tk >= 0) {
        if (!p.estourou) this.explodir(p);
        this.moverCacos(p, dt, tk);
      }

      if (t >= fim) {
        p.estado = "ido";
        p.malha.visible = false;
        p.halo.visible = false;
        this.apagarCacos(p);
      }
    }
  }

  /** Os pedaços abrindo, girando e esfriando. `tk` são os segundos desde o
   *  instante em que eles nasceram (o fim do clarão). */
  moverCacos(p, dt, tk) {
    const P = NAMEK.planetas;
    const u = clamp01(tk / Math.max(0.001, P.cacos));
    /* O CALOR cai depressa: os dois primeiros quintos são o branco, e depois é
       rocha morta indo embora. Um esfriamento linear deixaria os pedaços
       laranja até o último quadro e a explosão nunca terminaria de acabar. */
    const calor = Math.pow(1 - u, 2.4);
    /* E eles ENCOLHEM no fim, em vez de sumirem por alfa: aditivo eles somem
       clareando (errado, é o oposto de esfriar) e opacos eles piscam para fora.
       Encolher é o que a distância faria — e a 2.400 m é indistinguível dela. */
    const mingua = u > 0.62 ? clamp01(1 - (u - 0.62) / 0.38) : 1;

    const cor = this.cacos.instanceColor;
    for (let k = 0; k < CACOS; k++) {
      const i = p.base + k;
      this.cx[i] += this.cvx[i] * dt;
      this.cy[i] += this.cvy[i] * dt;
      this.cz[i] += this.cvz[i] * dt;
      this.cang[i] += this.cw[i] * dt;

      _eixo.set(this.cax[i], this.cay[i], this.caz[i]);
      _q.setFromAxisAngle(_eixo, this.cang[i]);
      _v.set(p.centro.x + this.cx[i], p.centro.y + this.cy[i], p.centro.z + this.cz[i]);
      const r = this.craio[i] * mingua;
      /* Escala NÃO uniforme: é ela que dá silhueta diferente a cada pedaço a
         partir de uma geometria só. Ver `montarCaco`. */
      _escala.set(r, r * (0.7 + (k % 5) * 0.14), r * (0.8 + (k % 3) * 0.2));
      _m.compose(_v, _q, _escala);
      this.cacos.setMatrixAt(i, _m);
      cor.setXYZ(i, calor, calor, calor);
    }
    this.cacos.instanceMatrix.needsUpdate = true;
    cor.needsUpdate = true;
  }

  /** Zera as vagas de um planeta que terminou de sumir. */
  apagarCacos(p) {
    _escala.set(0, 0, 0);
    _v.set(0, 0, 0);
    _q.identity();
    _m.compose(_v, _q, _escala);
    for (let k = 0; k < CACOS; k++) this.cacos.setMatrixAt(p.base + k, _m);
    this.cacos.instanceMatrix.needsUpdate = true;
    if (this.corpos.every((c) => c.estado !== "morrendo")) this.cacos.visible = false;
  }

  /* ================================================================ clima == */

  /** O dial de sempre: 0 é o dia, 1 é o planeta indo embora. */
  setStorm(s) {
    /* Não vai a zero. Um céu de tempestade continua tendo corpos celestes atrás
       dele, e apagá-los por completo faria os dois SUMIREM na virada do clima —
       o que é um acontecimento que ninguém pediu e que o jogador leria como o
       Kamehameha de outra pessoa tendo acertado. */
    this.ceu = 1 - 0.78 * clamp01(s);
    for (const p of this.corpos) p.mat.uniforms.ceu.value = this.ceu;
    if (this.cacoMat) this.cacoMat.uniforms.ceu.value = this.ceu;
  }

  /** Volta tudo ao começo. A sala zera o planeta quando esvazia. */
  reiniciar() {
    for (const p of this.corpos) {
      p.estado = "inteiro";
      p.inicio = 0;
      p.estourou = false;
      p.malha.visible = true;
      p.halo.visible = false;
      p.mat.uniforms.quebra.value = 0;
      p.mat.uniforms.clarao.value = 0;
      p.halo.material.uniforms.forca.value = 0;
      this.apagarCacos(p);
    }
    if (this.cacos) this.cacos.visible = false;
  }

  dispose() {
    /* Malhas, geometrias e materiais saem com a raiz do mundo em
       `NamekWorld.dispose`, que varre a subárvore inteira — a mesma divisão que
       `NamekSky.dispose` documenta. Aqui só se soltam as referências. */
    this.corpos.length = 0;
    this.cacos = null;
    this.cacoMat = null;
    this.root = null;
  }
}
