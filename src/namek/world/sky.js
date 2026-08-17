/* ---------------------------------------------------------------------------
   O céu de Namekusei, a luz e a tempestade.

   O CÉU VERDE É A MARCA DO PLANETA. Antes de qualquer rocha, antes da vila,
   antes das ajisas, o que diz "isto é Namekusei" é o gradiente verde-claro com
   o sol dentro dele. Se este arquivo estivesse certo e todos os outros errados,
   o estágio ainda seria reconhecível; o contrário não é verdade.

   **O SOL É UM SÓ**, a pedido do usuário, e o arquivo tinha três. O argumento
   inteiro está no bloco `SOL`, mais abaixo — leia-o antes de "consertar" isto de
   volta para o cânone.

   ------------------------------------------------------------ o que custa o quê

   Três coisas moram aqui e todas as três são armadilhas de orçamento (§3):

   • **O sol não é um objeto.** É um punhado de contas dentro do fragmento do
     domo — zero malha, zero chamada de desenho, zero luz própria. Uma esfera
     emissiva seria uma draw call e, pior, uma coisa com posição de mundo que
     teria de acompanhar a câmera para não passar por trás das montanhas.

     O ORÇAMENTO DELE É EM FRAGMENTO, e é o único item deste arquivo que não
     aparece na tabela de triângulos do `scenery.js`. O domo desenha PRIMEIRO e
     sem escrever profundidade, então ele paga a tela inteira uma vez —
     ~2,1 M fragmentos a 1080p, e cada instrução aqui é multiplicada por isso.

     A conta, por pixel, em TODA a tela: um `acos`, três `pow` (as três camadas
     de dispersão) e um `pow` da barra de horizonte. Cinco, contra os nove de
     quando havia três sóis — o laço dos dois menores cobrava dois `acos`, dois
     `smoothstep` e dois `pow` de cada pixel do quadro, inclusive dos que estão
     a 180° deles.

     E o corpo do sol — limbo, granulação, cromosfera — custa MAIS que o disco
     antigo, mas só dentro de um `if (u < 1.6)`: são 2,7 % dos pixels a 1080p.
     Foi a troca que pagou o sol "bem trabalhado" sem gastar um quadro por ele.

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
/* Exportado porque os DOIS PLANETAS moram dentro dele: `world/planetas.js`
   confere que `NAMEK.planetas.distancia` cabe aqui, e cabendo eles são
   recortados pelo relevo como qualquer outra coisa em vez de serem pintados por
   cima dele. Um segundo literal "2600" lá seria a mesma armadilha que a nota de
   `NAMEK_SOL_DIR` descreve: o dia em que o domo encolhesse, os planetas ficariam
   do lado de fora e sumiriam sem que nada apontasse por quê. */
export const RAIO_DOMO = 2600;

/* m — altura das duas camadas de nuvem. ACIMA do teto de voo (520 m), e isso é
   requisito, não estética: um plano horizontal de nuvem visto de dentro vira
   uma linha atravessando a tela de ponta a ponta. Com o teto em 520 m, ninguém
   nunca chega a 620 — e a camada nunca é vista de perfil. */
const NUVEM_BAIXA = 620;
const NUVEM_ALTA = 980;

/* ============================================================================
   O SOL. **UM SÓ**, e isto é um pedido explícito do usuário.

     *"Quando fui jogar me pareceu que tinha vários sóis. Deve ter um único sol,
     o maior e mais bem trabalhado."*

   ------------------------------------------------ ISTO CONTRARIA O CÂNONE

   E contraria de propósito. Namekusei tem três sóis na referência, o
   `docs/plano-namekusei.md` dizia isso, e este arquivo tinha três — um grande e
   dois pequenos, espalhados em azimute para que qualquer direção de olhar
   mostrasse sol. **Não "conserte" isto de volta.** O plano foi atualizado junto
   (§1, "o céu") e traz o pedido escrito lá também.

   O motivo do usuário é o que importa e ele é bom: dois discos de 1,7° e 1,4°
   em cantos opostos do céu não leem como "os três sóis de Namekusei" — leem
   como manchas claras no domo, e a primeira coisa que se pergunta ao ver uma é
   se aquilo é um bug de renderização. Um sol só, grande, com limbo, cromosfera,
   granulação e três camadas de dispersão, é uma imagem que se explica sozinha.

   ------------------------------------------------------- o que a troca custou

   **Nada em iluminação, e vale medir porque parece o contrário.** Os dois
   menores nunca foram luz: eles eram dois produtos escalares dentro do fragmento
   do domo, sem malha, sem `Light` e sem contribuição nenhuma para o
   sombreamento da cena (é o que o §1 do cabeçalho deste arquivo já dizia). As
   luzes dinâmicas do modo eram DUAS antes (uma direcional e uma hemisférica) e
   continuam DUAS depois; a terceira vaga do orçamento do §3 continua sendo dos
   poderes. Montanha, mar, terreno e lutador recebem exatamente a mesma luz de
   antes — o que mudou foi só o que se vê no domo.

   Em custo de fragmento a troca até SOBRA. Saíram dois `acos`, dois `smoothstep`
   e dois `pow` (o laço dos menores, que rodava em cada pixel da tela); entrou
   granulação, que custa dois ruídos 2D — e que só é avaliada DENTRO do disco,
   atrás de um `if`. O disco tem 12° num campo de 68°: são 2,7 % dos pixels.

   ---------------------------------------------------------- a direção NÃO mudou

   `(0.705, 0.53, 0.471)` — azimute 33,7°, altura 32° — está intocada, e isso é
   requisito e não preguiça. Ela é exportada como `NAMEK_SOL_DIR` e alimenta o
   rastro do mar, a bruma dourada do terreno, a folha em contraluz do mato E as
   FASES DE KURAIA E RUBEL (ver `NAMEK.planetas.corpos`): as direções das duas
   luas foram escolhidas contra esta para uma sair 72 % iluminada e a outra 42 %.
   Girar o sol aqui deixaria as duas com a mesma cara e apagaria o trabalho lá,
   além de rodar o rastro do mar e todo o sombreamento assado no terreno.

   ------------------------------------------------------- por que ele é BAIXO

   Estava a 55° de altura e virou 32°, e a troca tem preço e razão.

   A RAZÃO: a 55° o sol é uma luminária de teto. Ele achata o relevo (a saia das
   montanhas recebe quase a mesma luz que a clareira), não cria silhueta nenhuma
   e não tem para onde derramar dispersão — um sol alto num céu de domo não toca
   o horizonte, então nada no quadro diz onde ele está a não ser o próprio disco.
   A 32° a encosta voltada para ele acende, a oposta escurece, o rastro no mar
   fica comprido e a barra do horizonte tem onde encostar. É a diferença entre
   meio-dia e fim de tarde, e Namekusei é fim de tarde.

   O PREÇO, medido em cosseno: chão plano recebe `sen 32° = 0,53` da direcional
   contra os `0,82` de antes — 35 % menos. Foi pago em dois lugares e em
   nenhum deles com um número redondo:
     • `solInt` de 3,0 para 3,5 (chão plano: 1,86 contra 2,46);
     • `hemiInt` de 0,62 para 0,74, que é luz de céu e só entra para CIMA.
   O chão plano fica 16 % mais escuro que antes e a parede voltada para o sol,
   73 % mais clara (2,97 contra 1,72). A perda é onde não se olha e o ganho é no
   lutador em pé — que é justamente o que o §3 pede que continue legível.

   O azimute NÃO mudou (33,7° a partir de +x): mexer nele giraria o rastro do
   mar e a orientação de todo o sombreamento assado no terreno de uma vez, e não
   há nada a ganhar com isso. */
const SOL = {
  dir: new THREE.Vector3(0.705, 0.53, 0.471),
  cor: new THREE.Color("#ffa53c"),
  /* O raio é ANGULAR, em radianos, e é o "maior" do pedido.
   *
   * A escada deste número conta a história inteira do arquivo:
   *   0,028 rad → 3,2° de diâmetro,  51 px a 1080p — um furo de alfinete;
   *   0,068 rad → 7,8°,             124 px — um corpo celeste, mas discreto;
   *   0,105 rad → 12,0°,            190 px — O sol daquele céu.
   *
   * A conta é `diâmetro angular / campo vertical × altura da tela`: 12° de 68°
   * são 17,6 % da altura do quadro. Para comparar com o que já existe no céu,
   * Kuraia tem 16,1° e Rubel 11,2° — ou seja, o sol passou a ser maior que uma
   * das duas luas e da ordem da outra, que é exatamente onde ele precisava
   * estar para ninguém confundir qual dos três corpos é a fonte de luz.
   *
   * O teto está em não virar obstáculo: acima de uns 15° o disco começa a cobrir
   * um adversário inteiro a distância de briga, e um golpe que sai de dentro do
   * sol é um golpe que não se vê chegar. */
  raio: 0.105,
};

/**
 * A direção do sol PRINCIPAL, normalizada. Exportada porque o mar precisa dela
 * para pôr o brilho especular no lugar certo, e o terreno e a vegetação, para
 * saberem para onde a bruma dourada e a folha contraluz acendem.
 *
 * Um segundo literal `(0.705, 0.53, 0.471)` dentro de `water.js` seria um número
 * mágico duplicado, e o sintoma de esquecer de atualizá-lo é traiçoeiro: o
 * cenário continua correto, mas o rastro de sol na água aponta para um sol que
 * não está mais ali — e ninguém liga uma coisa à outra.
 *
 * É a MESMA constante que alimenta o disco desenhado no domo e a posição da luz
 * direcional (ver `montarDomo` e `montarLuzes`). O erro clássico deste arquivo
 * seria pintar o sol num canto e deixar a sombra caindo do outro; aqui isso é
 * impossível por construção, porque não existe um segundo lugar onde escrever a
 * direção do sol.
 */
export const NAMEK_SOL_DIR = SOL.dir.clone().normalize();

/**
 * As duas cores da BRUMA ACESA — a perspectiva aérea vista CONTRA o sol.
 *
 * Exportadas pelo mesmo motivo de `NAMEK_SOL_DIR`: quem as consome é o terreno
 * (as montanhas a 700 m) e o mar (a faixa do horizonte), e as duas superfícies
 * se encontram numa linha. Se cada arquivo escolhesse a própria cor de bruma, a
 * emenda entre o mar e a montanha apareceria exatamente onde ela é mais visível
 * — olhando para o sol.
 */
export const NAMEK_BRUMA_SOL = new THREE.Color("#ffc077");
export const NAMEK_BRUMA_BRASA = new THREE.Color("#b83a18");

/* Paleta do dia e da tempestade, lado a lado. Estarem juntas é o que permite
   conferir de relance que a névoa combina com o horizonte nos DOIS climas — a
   discrepância entre eles é exatamente o que produz uma linha visível na junção
   entre o mar e o céu. */
/* A PALETA É ESCRITA MAIS SATURADA DO QUE SE QUER VER, e isso não é engano.
 *
 * O renderer usa `ACESFilmicToneMapping` com exposição 1,05, e o ACES desatura
 * de propósito tudo o que é claro — é o que ele faz de melhor em cena
 * fotográfica e é o que aqui comia o planeta. Medido na tela com a paleta
 * anterior: zênite `#a0d4a9` (S 38 %), horizonte `#d1ddce` (S 18 %, L 84 %) — um
 * menta pastel quase branco, exatamente o "céu que some" que o comentário do
 * degradê logo abaixo promete evitar. O céu do Namek na referência é lima
 * saturado, reconhecível num quadro só.
 *
 * Os valores abaixo saem escuros e saturados no papel para chegarem à tela na
 * faixa certa. Qualquer ajuste aqui precisa ser conferido NA IMAGEM, com o
 * pixel medido, e nunca no código-fonte. */
const DIA = {
  zenith: new THREE.Color("#1f9e46"),
  horizonte: new THREE.Color("#9fd862"),
  chao: new THREE.Color("#79b98d"),
  /* A NÉVOA NÃO É A COR DO HORIZONTE, e essa linha era o motivo de o planeta
   * não ter horizonte nenhum.
   *
   * Ela foi escolhida igual à do domo para não haver emenda visível — e
   * conseguiu: o mar, que é a única coisa enevoada ali, dissolvia na cor do céu
   * e a linha do mundo simplesmente não existia em nenhum quadro aéreo. Só que
   * a emenda que se temia não é entre névoa e céu: é entre MAR e céu, e ela é
   * justamente o que se quer ver. Uma névoa mais fria e mais funda que o
   * horizonte devolve a faixa turquesa contra o lima — o contraste que dá
   * sensação de planeta na referência. */
  nevoa: new THREE.Color("#6fae9a"),
  /* E menos densa: a 3 000 m a anterior comia 80 % do mar, então o horizonte
     estaria apagado mesmo com a cor certa. A 0,00030 sobram 55 %, que ainda é
     perspectiva aérea de sobra e deixa a faixa aparecer. */
  nevoaDens: 0.0003,
  solLuz: new THREE.Color("#ffe6b4"),
  /* Ver a nota de altura em `SOL`: 3,5 e 0,74 são o que devolve ao chão plano
     a luz que baixar o sol de 55° para 32° tirou dele. */
  solInt: 3.5,
  ceuLuz: new THREE.Color("#a8f0b6"),
  chaoLuz: new THREE.Color("#2f6b52"),
  hemiInt: 0.74,

  /* ------------------------------------------------------------- o sol -----
     Quatro cores para um corpo só, e nenhuma delas é decorativa:

     `solNucleo`  o miolo, quase branco. É a única parte que estoura no ACES, e
                  é ESSE estouro que faz o olho ler "fonte de luz" em vez de
                  "círculo pintado".
     `solCor`     a BORDA do disco (mora em `SOL`). Âmbar saturado, porque o
                  escurecimento de limbo tem de sobrar cor depois de multiplicado
                  por `solForca` — um limbo pálido some no núcleo e o sol vira um
                  botão liso.
     `solHalo`    a coroa média, dourada. É a atmosfera perto da fonte.
     `solDisp`    a dispersão LARGA, e ela é dourado-esverdeada de propósito:
                  cinza ou branco lavariam o lima do céu naquele lado inteiro, e
                  o que se quer é o céu daquele lado ficando mais claro SEM
                  deixar de ser o céu de Namekusei.
     `solHoriz`   a barra rente à linha do mundo, no azimute do sol.            */
  solNucleo: new THREE.Color("#fffaea"),
  /* O MESMO OBJETO de `SOL.cor`, e não uma cópia dele: a cor do sol de dia é
     parte da descrição do sol e mora lá em cima, junto com a direção e o raio.
     Repeti-la aqui daria duas verdades sobre a mesma coisa, e a que envelhece é
     sempre a que não está sendo lida no momento. Ninguém escreve nestas cores —
     `lerpColors` só as lê. */
  solLimbo: SOL.cor,
  /* A CROMOSFERA — o aro fino colado no limbo, por fora do disco.
     Ela é mais QUENTE que o corpo e não mais fria, e isso é o contrário do que
     a intuição pede: a camada acima da fotosfera é rarefeita e emite nas linhas
     de hidrogênio, então o que se vê é rosa-alaranjado brilhante, e não uma
     borda apagada. Puxada para o rosa de propósito — é a matiz que ela tem num
     eclipse, e é ela que impede o disco de terminar num corte de tesoura contra
     o lima do céu. */
  solCromo: new THREE.Color("#ff9a6e"),
  solHalo: new THREE.Color("#ffc06a"),
  solDisp: new THREE.Color("#d9f08a"),
  solHoriz: new THREE.Color("#ffd08a"),
  /* Multiplicador do corpo do disco.
   *
   * ERA 2,6, E ISSO VIROU UM DEFEITO NO DIA EM QUE O SOL CRESCEU. Aquele número
   * foi escolhido para um disco de 7,8°, em que saturar o corpo INTEIRO era
   * aceitável: um sol pequeno que estoura em branco continua lendo como sol. Com
   * 12° medidos na bancada, o resultado foi um círculo branco chapado de ponta a
   * ponta — limbo, granulação e âmbar existiam no shader e nenhum deles chegava
   * à tela, porque os três canais já batiam no teto antes do tonemap.
   *
   * A conta, no ACES com exposição 1,05: o miolo tem de passar de 1,0 (é o
   * estouro que faz o olho ler "fonte de luz" em vez de "círculo pintado") e a
   * BORDA tem de ficar abaixo. Com 1,55, o centro sai em 1,55 (estoura, como
   * deve) e o último quinto do raio — onde `limbo` vale 0,3 a 0,6 — sai entre
   * 0,46 e 0,93 no verde: âmbar de verdade, com detalhe.
   *
   * O jeito de conferir isto é MEDINDO O PIXEL, nunca lendo o código: um sol
   * chapado e um sol com limbo são a mesma linha de GLSL com dois números. */
  solForca: 1.55,
  /** Fração do raio em que a borda do disco se desfaz. De dia ela é nítida. */
  solBorda: 0.09,

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
  hemiInt: 0.38,

  /* --------------------------------------------- o sol na tempestade -------
     ELE NÃO É APAGADO. Um sol que some de uma vez lê como um corte de cena, e
     essa foi a primeira montagem: `solCor` multiplicado por um `smoothstep` e
     pronto — em três segundos não havia mais sol nenhum, e os oito segundos de
     `NAMEK.weather.fade` que o resto do céu leva para virar aconteciam sem ele.

     O que ele faz agora, ao longo dos mesmos oito segundos, é VIRAR BRASA:

       0,0 s   sol de fim de tarde, disco nítido, halo dourado até 55° de raio
       ~1,5 s  o halo já morreu (`solBrilho`): a atmosfera encheu de cinza e a
               dispersão limpa é a primeira coisa que a cinza mata
       ~3–6 s  o disco continua lá, agora vermelho-sangue, INCHADO (o raio cresce
               55 %) e de borda desfeita — é o sol visto através de fumaça, e é a
               imagem que a luta contra Freeza deixou
       ~7,6 s  `solDisco` fecha e o que sobra é a nuvem revolta

     E durante tudo isso ele é MOSCADO pela turbulência do próprio domo: o
     multiplicador da nuvem entra DEPOIS do sol no fragmento, então a massa passa
     na frente dele. Essa ordem não é acidental — invertê-la deixaria um disco
     limpo colado por cima da tempestade. */
  solNucleo: new THREE.Color("#ff8a4a"),
  solLimbo: new THREE.Color("#c2301a"),
  /* Na tempestade ela quase some: a cromosfera é a camada mais fina do corpo e
     é a primeira coisa que a fumaça engole. O que sobra é um contorno de brasa
     no lugar do aro rosa. */
  solCromo: new THREE.Color("#8e2a12"),
  solHalo: new THREE.Color("#a02a16"),
  solDisp: new THREE.Color("#6b1a10"),
  solHoriz: new THREE.Color("#8e2410"),
  /* Mesma correção do dia, pelo mesmo motivo: o disco INCHA 55 % na tempestade
     (a fumaça o incha, ver a nota longa acima), e a 1,35 o sol de brasa também
     saía chapado — só que em laranja. A 1,15 ele volta a ter miolo e borda. */
  solForca: 1.15,
  solBorda: 0.62,

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
  /* UM sol, e por isso três escalares e não três arrays. Ver o cabeçalho: a
     troca é pedido do usuário e o plano foi atualizado junto. */
  uniform vec3 solDir;
  uniform vec3 solCor;
  uniform float solRaio;
  /* O corpo do sol e as camadas de dispersão em volta dele.
     Uniforms e não constantes porque TODOS caminham durante a tempestade — ver
     aplicar e a nota do sol em TEMPESTADE. */
  uniform vec3 solNucleo;
  /** O aro quente colado no limbo — a cromosfera. Ver o bloco do sol. */
  uniform vec3 solCromo;
  uniform vec3 solHalo;
  uniform vec3 solDisp;
  uniform vec3 solHoriz;
  uniform float solForca;
  uniform float solBorda;
  /** 1 = o disco está lá, 0 = a fumaça o fechou. */
  uniform float solDisco;
  /** 1 = a atmosfera está limpa, 0 = não há mais dispersão possível. */
  uniform float solBrilho;
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

    /* ========================================================== O SOL =======
       **UM SÓ.** Ver o cabeçalho para o pedido que tirou os outros dois, e a
       nota de 'SOL.raio' para a escada de tamanho. Ele paga sozinho a conta de
       fragmento que antes era dividida em três, e o que ele comprou com isso
       está nos quatro blocos abaixo: limbo de verdade, granulação, cromosfera e
       as três dispersões. */
    vec3 sd = normalize(solDir);
    float c0 = max(dot(dir, sd), 0.0);
    float ang0 = acos(clamp(c0, -1.0, 1.0));
    float r0 = max(solRaio, 1e-4);
    /* Distância ao centro do disco em RAIOS. É a única divisão do bloco, e tudo
       o que é do corpo do sol sai dela. */
    float u = ang0 / r0;

    /* PERTO DO SOL, e só aqui: disco, limbo, granulação e cromosfera custam o
       que custam em 2,7 % da tela (12° de disco num campo de 68°, mais a
       margem do aro). Fora deste 'if' sobram as três dispersões, que são o que
       o resto do céu precisa. É esta guarda que faz um sol muito mais
       trabalhado custar MENOS que os três de antes. */
    /* O DISCO SUBSTITUI o céu, ele não é somado a ele. Somado, um disco sobre
       lima saturado sai ESVERDEADO no miolo — o sol ficava com a cor do
       planeta, que é o defeito mais engraçado e mais difícil de enxergar
       deste arquivo, porque o disco continua parecendo um disco.

       Ele é calculado FORA da guarda de perto porque as dispersões precisam
       dele: ver 'foraDoCorpo', logo abaixo. Longe do sol o ternário o zera sem
       custo nenhum. */
    float disco = u < 1.6
      ? 1.0 - smoothstep(1.0 - solBorda, 1.0 + solBorda * 0.5, u)
      : 0.0;

    if (u < 1.6) {
      if (disco > 0.0) {
        /* --------------------------------- ESCURECIMENTO DE LIMBO, de verdade
           A lei física, e ela é mais barata que o truque que estava aqui: o que
           se vê num ponto do disco é a fotosfera olhada de esguelha, e o ângulo
           dentro da estrela tem cosseno 'mu = sqrt(1 - u²)'. A intensidade cai
           como 'I(mu)/I(0) = 1 - k(1 - mu)'.

           Estava '1 - smoothstep(0, 1.02, u)' ao quadrado, e a diferença é
           visível: aquilo escurece DEVAGAR no miolo e desaba na borda, o que dá
           uma bola de gude iluminada de frente. A lei de limbo faz o contrário —
           o disco fica quase liso em quase toda a extensão e cai nos últimos
           quinze por cento. É por isso que uma foto do Sol tem miolo chapado e
           borda marcada, e é essa silhueta que o olho reconhece como estrela.

           'k = 0,72' é a ordem do coeficiente no visível, arredondado para cima
           porque o ACES devolve parte do contraste que a lei tira. */
        float mu = sqrt(max(0.0, 1.0 - u * u));
        float limbo = 1.0 - 0.72 * (1.0 - mu);

        /* ------------------------------------------------------ GRANULAÇÃO
           A fotosfera não é esmalte: são células de convecção, e o que se lê à
           distância é um mosqueado fino de poucos por cento de contraste. É o
           detalhe que separa "disco pintado" de "superfície".

           Ela é amostrada em coordenadas DO DISCO — dois eixos perpendiculares à
           direção do sol — e não sobre 'dir'. A diferença não é sutileza: sobre
           a direção de olhar, o padrão escorregaria pelo disco toda vez que a
           câmera girasse, e o sol pareceria ter a superfície derretendo. Sobre
           os eixos do disco, ele está preso nele.

           O terceiro eixo do ruído é o TEMPO, devagar: granulação de verdade
           ferve, e uma superfície absolutamente parada num céu onde a nuvem anda
           lê como adesivo.

           E ela ACOMPANHA O LIMBO ('· mu'): na borda a célula é vista de raspão
           e o contraste some, pela mesma razão física do escurecimento. */
        vec3 eixoA = normalize(cross(sd, vec3(0.0, 1.0, 0.0)));
        vec3 eixoB = cross(sd, eixoA);
        vec2 uvSol = vec2(dot(dir, eixoA), dot(dir, eixoB)) / r0;
        float gran =
          ruido3(vec3(uvSol * 9.0, tempo * 0.05)) * 0.64 +
          ruido3(vec3(uvSol * 23.0, tempo * 0.09)) * 0.36;
        /* Dezoito por cento de amplitude, ou ±9 % de contraste no miolo. Acima
           de uns 30 % a superfície vira couro e o corpo deixa de ler como fonte
           de luz — que é a única coisa que ele não pode deixar de ser. */
        float grao = 1.0 + (gran - 0.5) * 0.18 * mu;

        /* A COR vai do âmbar da borda ao quase-branco do miolo, e a rampa é
           'mu^0,55' para o núcleo claro ocupar a metade central em vez de um
           ponto. O escurecimento entra como MULTIPLICADOR ('limbo'), separado
           da cor: são duas coisas diferentes — quanto chega e de que
           temperatura. Misturá-las numa curva só foi o que produziu, na versão
           anterior, uma borda âmbar de um décimo de raio que não se via. */
        /* A RAMPA É ÍNGREME (expoente 2,6) e isso é o oposto do que parece
           certo. Com 0,55 o branco do núcleo ocupava quase o disco inteiro — em
           'mu = 0,6', que é dois terços do raio, a mistura já dava 0,76 de
           branco — e a cor do sol ficava espremida num aro fino que o limbo
           ainda escurecia. Com 2,6 o mesmo ponto dá 0,22: o núcleo claro fica
           dentro dos 45 % centrais e a metade de fora é âmbar, que é a
           proporção que uma foto do Sol mostra. */
        vec3 corpo = mix(solCor, solNucleo, pow(mu, 2.6));
        col = mix(col, corpo * solForca * limbo * grao, disco * solDisco);
      }

      /* -------------------------------------------------------- A CROMOSFERA
         O aro fino e quente colado no limbo, POR FORA do disco. Num eclipse é a
         linha rosa que aparece no instante em que a fotosfera some; num céu
         diurno é o que impede o disco de terminar num corte de tesoura contra o
         verde. Meia largura de ~7 % do raio — é uma linha, não um halo, e o
         halo já existe logo abaixo.

         'exp(-x²)' e não 'pow': um sino gaussiano custa um 'exp' e nenhuma
         potência, e ele é exatamente a forma que se quer. */
      float du = (u - 1.0) * 14.0;
      col += solCromo * exp(-du * du) * 0.55 * solBrilho * solDisco * (1.0 - disco);
    }

    /* AS TRÊS CAMADAS DE DISPERSÃO, da colada à larga. Os expoentes não são
       gosto: pow(cos θ, n) cai à metade em θ ≈ sqrt(2·ln2 / n), então 140, 15
       e 2 dão meias-larguras de 6,4°, 20° e 55°. A de 55° é a que faltava — é
       ela que clareia o céu INTEIRO daquele lado, e é isso, e não o disco, que o
       olho lê como "há uma fonte de luz enorme ali". Só o disco e a coroa dão um
       sol recortado colado num papel de parede.

       A PRIMEIRA cresceu junto com o corpo: 6,4° de meia-largura contra um disco
       que agora tem 6,0° de RAIO significa que ela mal saía de dentro dele, e o
       que era para ser a coroa colada virava um reforço do miolo. 45 dão 11,3°,
       ou seja, quase dois raios — a coroa volta a acontecer FORA do sol, que é
       onde uma coroa acontece. */
    /* ============================ A CORoA NÃO ENTRA NO DISCO ================
       E este era o defeito que a medição de pixel pegou. Sem o fator abaixo, a
       varredura pelo meio do sol dava, em raios do disco:

         u=0,75  rgb(245,227,186)     u=0,90  rgb(238,229,180)

       — o verde SUBINDO onde o escurecimento de limbo devia estar caindo. A
       razão é simples e é física: as três dispersões são a atmosfera brilhando
       em torno da fonte, e elas eram somadas em cima do corpo também. Perto do
       limbo elas estão no máximo, e o que elas somavam ali cancelava exatamente
       a queda que a lei de limbo produzia. O disco tinha o gradiente inteiro
       calculado e apagado por cima.

       Multiplicar por '1 - disco' é o que a natureza faz: a coroa só se vê num
       eclipse, quando o corpo sai da frente. Contra a fotosfera ela é invisível,
       porque a fotosfera é milhões de vezes mais brilhante. */
    float foraDoCorpo = 1.0 - disco * solDisco;
    col += solCor * pow(c0, 45.0) * 0.5 * solBrilho * foraDoCorpo;
    col += solHalo * pow(c0, 15.0) * 0.34 * solBrilho * foraDoCorpo;
    /* E a larga ganhou um terço a mais. Ela era a soma de três fontes espalhando
       no céu; agora é uma só, e sem esse acréscimo o lado do sol ficaria mais
       apagado do que estava — que é a única perda real de tirar os dois menores. */
    col += solDisp * pow(c0, 2.0) * 0.16 * solBrilho * foraDoCorpo;

    /* A BARRA DO HORIZONTE. Rente à linha do mundo e no AZIMUTE do sol.
       Separada da dispersão porque ela é uma função diferente: a dispersão é
       redonda em torno do sol, esta contorna o horizonte. É ela que põe o sol
       DENTRO do planeta — sem ela ele fica colado num domo, e a linha do mar
       passa por baixo dele sem tomar conhecimento.
       max no comprimento porque exatamente no zênite dir.xz é o vetor nulo,
       e um normalize dele devolveria NaN — que sobrevive a qualquer
       multiplicação por zero e mancharia o topo do céu. */
    vec2 dirXZ = dir.xz;
    float azim = max(dot(dirXZ / max(length(dirXZ), 1e-4), normalize(sd.xz)), 0.0);
    float rente = 1.0 - smoothstep(0.0, 0.34, abs(h));
    col += solHoriz * pow(azim, 3.5) * rente * 0.30 * solBrilho;

    /* (Aqui moravam os DOIS SÓIS MENORES — um laço com disco e coroa para cada
       um. Saíram a pedido do usuário; ver o bloco 'SOL', no topo, para o
       argumento inteiro. Não os traga de volta sem ler aquilo.) */

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

    /* O RUÍDO DE UM BIT, e ele é o retoque mais barato deste arquivo.
       O domo é um degradê de tela cheia entre dois verdes próximos, que é o pior
       caso possível para oito bits por canal: sem quebrar a quantização, o céu
       sai em FAIXAS concêntricas — e nenhuma escolha de paleta corrige isso,
       porque o defeito não é da cor, é do passo entre dois valores vizinhos.
       O material padrão do Three resolve isso com dithering: true (o terreno
       usa), mas este é um ShaderMaterial e aquele trecho não vem junto.
       Meio nível de quantização de amplitude, ANTES do tonemap, sorteado por
       coordenada de tela (portanto estático, que é o que um dithering quer). */
    col += (hash3(vec3(gl_FragCoord.xy, 1.0)) - 0.5) * (1.0 / 255.0);

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
        /* A MESMA direção que a luz direcional usa — ver `montarLuzes`. Os dois
           lados leem `SOL.dir`, e é por isso que é impossível o disco estar
           num canto do céu e o sombreamento da cena vir do outro. */
        solDir: { value: SOL.dir.clone().normalize() },
        /* CLONADAS, as duas. A cor caminha para a brasa e o raio INCHA 55 % na
           tempestade (a fumaça o incha); escrever direto em `SOL.cor` ou em
           `SOL.raio` estragaria a constante para a próxima partida. */
        solCor: { value: SOL.cor.clone() },
        solRaio: { value: SOL.raio },
        solNucleo: { value: DIA.solNucleo.clone() },
        solCromo: { value: DIA.solCromo.clone() },
        solHalo: { value: DIA.solHalo.clone() },
        solDisp: { value: DIA.solDisp.clone() },
        solHoriz: { value: DIA.solHoriz.clone() },
        solForca: { value: DIA.solForca },
        solBorda: { value: DIA.solBorda },
        solDisco: { value: 1 },
        solBrilho: { value: 1 },
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
    /* A direcional é DIREÇÃO, não lugar: o que importa é o vetor até o alvo.
       E ela sai de `SOL.dir`, a MESMA constante que o domo desenha — o erro
       clássico de cenário é pintar o sol num canto e deixar a luz vindo do
       outro, e ele nasce de haver dois lugares onde escrever a direção do sol.
       Aqui só há um. Quem mexer na altura do sol mexe nos dois de uma vez, e a
       única coisa a conferir é a conta de cosseno que está na nota de `SOL`. */
    this.sol.position.copy(SOL.dir).normalize().multiplyScalar(600);
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

    /* -------------------------------------------------- o sol na transição --
       Ver a nota longa em `TEMPESTADE`. Três curvas com tempos DIFERENTES, e é a
       diferença entre elas que faz o sol participar dos oito segundos em vez de
       piscar para fora deles:

         solBrilho  morre cedo (0,04 → 0,42 do dial). A dispersão limpa é a
                    primeira coisa que a cinza mata: um céu cheio de partícula
                    grossa não faz halo, faz mancha.
         solDisco   morre tarde (0,40 → 0,95). Entre uma curva e outra existe uma
                    janela de uns quatro segundos em que há disco e não há mais
                    halo — que é exatamente o sol de brasa que se quer ver.
         raio/borda crescem: o disco INCHA 55 % e a borda se desfaz. É o que a
                    fumaça faz com uma fonte pontual, e é o que separa "sol
                    vermelho" de "sol atrás de fumaça".                        */
    u.solBrilho.value = 1 - smoothstep(0.04, 0.42, s);
    u.solDisco.value = 1 - smoothstep(0.4, 0.95, s);
    u.solCor.value.lerpColors(DIA.solLimbo, TEMPESTADE.solLimbo, s);
    u.solNucleo.value.lerpColors(DIA.solNucleo, TEMPESTADE.solNucleo, s);
    u.solHalo.value.lerpColors(DIA.solHalo, TEMPESTADE.solHalo, s);
    u.solDisp.value.lerpColors(DIA.solDisp, TEMPESTADE.solDisp, s);
    u.solHoriz.value.lerpColors(DIA.solHoriz, TEMPESTADE.solHoriz, s);
    u.solForca.value = DIA.solForca + (TEMPESTADE.solForca - DIA.solForca) * s;
    u.solBorda.value = DIA.solBorda + (TEMPESTADE.solBorda - DIA.solBorda) * s;
    u.solRaio.value = SOL.raio * (1 + 0.55 * s);

    /* A CROMOSFERA caminha junto com o resto e some CEDO, junto com o halo: ela
       é a camada mais fina do corpo e a primeira que a fumaça engole. Ela não
       precisa de uma curva própria porque já é multiplicada por `solBrilho` no
       fragmento — o mesmo dial que mata a dispersão limpa.

       (Aqui morava o laço que apagava os dois sóis MENORES antes do principal.
       Saiu com eles; ver o bloco `SOL`, no topo, para o pedido do usuário que
       tirou os dois. O planeta morrendo continua tendo UM foco — só que agora
       ele tem um foco o tempo todo, e não só na tempestade.) */
    u.solCromo.value.lerpColors(DIA.solCromo, TEMPESTADE.solCromo, s);

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
