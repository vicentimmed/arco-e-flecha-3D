/* ---------------------------------------------------------------------------
   A aura de ki: CASULO, COROA e CAUDA.

   Acende ao carregar, no voo inteiro e durante os especiais. É o efeito que mais
   aparece no modo — quinze lutadores podem acendê-la ao mesmo tempo —, e é por
   isso que ele tem uma regra acima de todas as outras:

   **NENHUMA LUZ DINÂMICA.** O §3 do plano dá três luzes ao jogo INTEIRO. Uma
   `PointLight` por aura seria quinze, e o custo de luz dinâmica no Three não é
   linear: cada uma entra no laço de todo fragmento de todo material iluminado
   da cena. O brilho aqui é feito com geometria ADITIVA, que custa preenchimento
   de tela e mais nada — o mesmo caminho que o jato do jetpack e o feixe do
   Kamehameha do arqueiro já tomaram, pela mesma razão.

   ------------------------------------------------- o que havia aqui, e por quê
                                                      não servia

   A versão anterior tinha UMA chama, presa ao corpo, e o voo era ela girada
   180° em `envelope.rotation.x` e esticada 3,4× em Y. Duas coisas quebravam:

   • **virava foguete.** Esticar 3,4× em Y e encolher 0,65× em XZ é a definição
     de um cone fino saindo das costas. O lutador ficava sem nada em volta e com
     um jato atrás — o oposto da referência, em que o ki ENVOLVE o corpo.
   • **apontava para o lugar errado.** A rotação era em espaço do CORPO, e a
     pose de voo inclina o tronco até 1,3 × 90° (`poseArrancada`) e ainda rola
     na curva. Girar 180° no eixo do corpo só coincide com "para trás" quando o
     corpo está em pé; mergulhando, subindo ou rolando, o jato apontava para
     qualquer lado — inclusive para a frente.

   ------------------------------------------------------------------- as peças

   A referência (o pelotão voando em formação) mostra três coisas ao mesmo tempo,
   e cada uma virou uma peça:

   • **casulo** — o torneado liso, colado ao corpo, no espaço do CORPO. Ele
     nunca estica e nunca gira: é o que garante o pedido "o poder sempre tem que
     ficar em volta do player, independente da posição que ele gire e vá".
   • **coroa** — dois anéis de penas de fogo em torno de um EIXO, com a franja
     irregular que separa "chama" de "campo de força". O eixo é o do sopro: para
     cima quando parado, para trás quando voando — e "para trás" é o oposto da
     VELOCIDADE, calculado em espaço de mundo e só depois trazido para o corpo.
     Como o anel é radial, ele emoldura a silhueta de qualquer ângulo em vez de
     virar um cone de foguete.
   • **cauda** — a fita longa que fica no rastro, com quatro fios que se abrem e
     ondulam, começando grossa e afinando até sumir. É ela que entrega a posição
     de um lutador a duzentos metros, e é o efeito que a referência tem e que o
     jogo não tinha.

   Casulo, coroa e faíscas são TRÊS malhas fundidas, não vinte e sete (um
   torneado, vinte e quatro penas, catorze cacos) — o mesmo truque de `fundir`
   em `rig.js`. Somando a cauda são quatro chamadas de desenho por aura acesa, e
   as três primeiras somem junto com a aura: apagada, o grupo tem
   `visible = false` e o Three descarta objeto invisível antes de tudo.

   E as geometrias do casulo e da coroa são COMPARTILHADAS entre os lutadores —
   ver `pegarPecas`. Só a cor muda de um para outro, e cor é material.

   ---------------------------------------------------------------- a cauda

   Ela é a única coisa aqui que guarda estado de trajetória: `AMOSTRAS` amostras
   da posição do peito, uma a cada `PASSO_CAUDA`, num anel de `Float32Array`.
   Três decisões que valem a leitura:

   1. **Passo de TEMPO, não de distância.** A cauda cobre sempre os mesmos
      `VIDA_CAUDA` segundos de voo, então ela cresce sozinha com a velocidade:
      ~33 m no voo de cruzeiro e ~82 m no arranque. Uma amostragem por distância
      daria uma cauda de comprimento constante, que é o contrário do que o olho
      espera. Os números do tamanho estão em `NAMEK.aura.rastro`, e o comentário
      de lá é quem explica por que a cauda é 50 % mais comprida do que já foi.
   2. **Ela vive em espaço de MUNDO.** O grupo `trilha` carrega o quaternion
      INVERSO do corpo, o que anula a rotação do lutador e deixa os vértices
      serem escritos em coordenadas de mundo (menos a origem do corpo). Sem isso,
      a cauda giraria junto com quem a solta — que é exatamente o defeito de que
      esta reescrita nasceu.
   3. **Ela é fita virada para a câmera.** A largura de cada ponto sai de
      `cross(tangente, olhar)`, calculada na CPU com a posição da câmera que o
      `Fighter` já tinha em mãos para o LOD. Uma fita plana sem isso desaparece
      quando vista de perfil, e uma cauda que pisca conforme se voa é pior que
      cauda nenhuma.

   O brilho de cada ponto também MORRE PERTO DA CÂMERA (`PERTO_*`). A lente de
   perseguição fica 6,6 m atrás do peito, ou seja, quase sempre em cima da
   própria cauda: sem esse desconto, voar em terceira pessoa seria olhar para
   uma tela branca.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";
import { clamp, damp, smoothstep } from "../../utils/math.js";
import { PIVO } from "./poses.js";

const TAU = Math.PI * 2;
const BRANCO = new THREE.Color(1, 1, 1);
const CIMA = new THREE.Vector3(0, 1, 0);

/* Rascunhos de MÓDULO, como em `fighter.js`: `update` é síncrona do começo ao
   fim e nada aqui atravessa quadros, então quinze auras dividem os mesmos
   objetos sem se pisarem. */
const _cor = new THREE.Color();
const _q = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _euler = new THREE.Euler();
const _escala = new THREE.Vector3(1, 1, 1);
const _ancora = new THREE.Vector3();
const _alvoDir = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _tanAnt = new THREE.Vector3();
const _vista = new THREE.Vector3();
const _lado = new THREE.Vector3();
const _ladoAnt = new THREE.Vector3();

/* ------------------------------------------------------------------ casulo ---

   Perfil do núcleo, em metros e RELATIVO AO PEITO (y = 0 é o centro de massa).
   Ele mora no centro do corpo, e não nos pés, porque é em torno do peito que o
   corpo inclina — ver `PIVO` em `poses.js`. Uma aura ancorada nos pés ficaria
   para trás toda vez que o lutador mergulhasse. */
const PERFIL_NUCLEO = [
  [-1.3, 0.03],
  [-1.14, 0.3],
  [-0.72, 0.47],
  [-0.15, 0.55],
  [0.36, 0.49],
  [0.8, 0.35],
  [1.1, 0.21],
  [1.68, 0.02],
];

/* ------------------------------------------------------------------- coroa ---

   Dois anéis de penas em torno do eixo do sopro. Dois e não um porque uma franja
   de tamanho único lê como coroa de plástico: o anel de dentro é curto e denso
   (o corpo da chama), o de fora é longo e esparso (as pontas que se soltam). Os
   dois cabem na MESMA malha fundida, então o segundo é de graça em desenho.

   `recuo` é negativo: a base das penas nasce ADIANTE do peito, e elas varrem o
   corpo para trás. Voando, é isso que faz o ki envolver o lutador em vez de
   sair das costas dele. */
const ANEIS = [
  { n: 18, raio: 0.58, recuo: -0.42, abertura: 0.38, alto: 0.6, extra: 0.3, grossura: 0.075 },
  { n: 14, raio: 0.78, recuo: -0.6, abertura: 0.68, alto: 0.95, extra: 0.44, grossura: 0.07 },
];

/** Quantos cacos na coluna de faíscas. */
const FAISCAS = 14;
/** m — distância em que a coluna de faíscas se repete. */
const PASSO_FAISCA = 2.6;

/* ------------------------------------------------------------------- cauda ---
 *
 * O TAMANHO da cauda mora no config (`NAMEK.aura.rastro`) e não aqui: ele é
 * `velocidade × vida`, e a velocidade é uma constante de jogo. O comentário de
 * lá explica por que os três números crescem juntos — e por que eles são hoje
 * 50 % maiores do que já foram. */
/** Quantas amostras de trajetória a cauda guarda. */
const AMOSTRAS = NAMEK.aura.rastro.amostras;
/** Pontos do espinhaço: as amostras mais o peito de AGORA, que fecha o vão
 *  entre o corpo e a primeira amostra. */
const PONTOS = AMOSTRAS + 1;
/** s — quanto tempo de voo cabe na cauda. Com 45 amostras, uma a cada 28 ms. */
const VIDA_CAUDA = NAMEK.aura.rastro.vida;
const PASSO_CAUDA = VIDA_CAUDA / AMOSTRAS;
/** m — teto de comprimento. Passa disto e a cauda deixa de ler como rastro e
 *  vira uma faixa atravessando a arena. */
const COMP_MAX = NAMEK.aura.rastro.compMax;
/** m — vão entre duas amostras que só pode ser renascimento ou teletransporte.
 *  A 96 m/s com o dt já limitado a 0,1 s, o maior salto legítimo é ~9,6 m. */
const SALTO_MAX = 22;
/** m — abaixo desta soma não há rastro nenhum, só um borrão parado. */
const COMP_MIN = 0.6;
/** m/s — onde a cauda começa a existir e onde ela chega ao talo. */
const VEL_CAUDA_MIN = 7;
const VEL_CAUDA_MAX = NAMEK.fighter.flySpeed * 0.75;
/* m — a cauda morre ao chegar perto da lente. Ver o cabeçalho.
 *
 * A faixa foi medida CONTRA A CÂMERA DO JOGO, não escolhida no papel: a lente
 * de perseguição fica entre 5,2 m (arranque) e 6,6 m (cruzeiro) atrás do peito,
 * e num voo em linha reta ela está EM CIMA da própria cauda — o trecho entre a
 * lente e o lutador é quase tudo o que se vê dela. Com o corte antigo em 4,6 m
 * esse trecho saía em brilho cheio e virava uma faixa branca ocupando a metade
 * de baixo da tela o voo inteiro. Terminando em 6,5 m, a cauda BROTA do corpo e
 * acende conforme se afasta, que é o que se quer ver de trás — e nada muda para
 * quem olha outro lutador voando, que é onde o efeito importa. */
const PERTO_0 = 1.6;
const PERTO_1 = 6.5;
/** m — largura de referência da fita, no ponto mais grosso. Ela nasce da largura
 *  da COROA: a cauda tem de sair de dentro da aura, e uma fita mais fina que o
 *  casulo lê como cabo saindo das costas em vez de esteira do próprio ki. */
const LARG_CAUDA = 2.4;
/* 1/m — quanto a largura e a abertura dos fios crescem por metro de rastro.
 *
 * "Uma cauda de setenta metros com a largura de uma de vinte é um fio": a
 * espessura acompanha o comprimento, como acompanha em qualquer cometa, e
 * espalhar um metro de mecha numa cauda de setenta não se vê.
 *
 * Os dois eram 0,013 e 0,055, dimensionados para a cauda antiga. **Foram
 * divididos por 1,5 — exatamente o fator que alongou o rastro** (ver
 * `NAMEK.aura.rastro`), e é isso que segura a outra metade do pedido: o que se
 * quer é uma cauda mais COMPRIDA, não mais grossa. Como `comp` cresce 1,5× e o
 * coeficiente encolhe 1,5×, o produto não muda — a mesma velocidade de voo
 * produz uma fita com a mesma espessura de sempre, só que mais longa. Sem esta
 * divisão, o arranque passaria a bater no teto de largura (1,65) e a cauda
 * engrossaria 16 % de brinde. */
const LARG_POR_METRO = 0.013 / 1.5;
const ESPALHA_POR_METRO = 0.055 / 1.5;
/** Vértices por ponto de cada fio: borda, miolo, borda. Ver `criarFita`. */
const LADOS = 3;
/** Peso da cor em cada um deles — a rampa que apaga a aresta. */
const PESO_LADO = [0, 1, 0];
/** Onde cada um cai na largura, de −½ a +½. */
const CORTE_LADO = [-0.5, 0, 0.5];
/* Teto de brilho de UM fio. Os quatro se somam (é mistura aditiva) e o céu de
   Namekusei já é claro: a 1,0 os fios saturavam em branco puro antes de se
   cruzarem, e a cauda virava uma cunha de papel — exatamente o oposto de energia.
   A 0,3 eles se somam onde se cruzam e continuam translúcidos onde não se
   cruzam, que é o que dá a franja da referência. */
const BRILHO_CAUDA = 0.3;

/* Os fios. O primeiro é o corpo da cauda e vai até o fim; os outros são as
   mechas que se abrem, ondulam e morrem antes — é a diferença entre uma faixa
   de fita crepe e o rastro esgarçado da referência. */
const FIOS = [
  { larg: 1.0, amp: 0.0, fim: 1.0, onda: 3.1, vel: 2.2, fase: 0.0 },
  { larg: 0.5, amp: 0.62, fim: 0.84, onda: 4.7, vel: 2.9, fase: 1.7 },
  { larg: 0.44, amp: -0.78, fim: 0.92, onda: 3.9, vel: 2.4, fase: 3.3 },
  { larg: 0.3, amp: 1.25, fim: 0.66, onda: 6.2, vel: 3.6, fase: 5.1 },
];

/* --------------------------------------------------------------- materiais -- */

function materialAditivo(cor, opacidade, comCorDeVertice = false) {
  return new THREE.MeshBasicMaterial({
    color: cor,
    transparent: true,
    opacity: opacidade,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexColors: comCorDeVertice,
    /* `fog: false` como o resto do que EMITE neste projeto (a chama do jetpack,
       o feixe do especial). Aditivo com névoa somaria a cor da névoa em cada
       pixel do efeito e a aura viraria um retângulo claro no céu. O sumiço com a
       distância é feito na opacidade, por LOD. */
    fog: false,
  });
}

/* --------------------------------------------------------------- geometria -- */

/** Concatena geometrias já posicionadas numa só. Sem normal e sem cor de
 *  vértice: material básico aditivo não lê nenhuma das duas, e elas seriam
 *  memória à toa. */
function fundirSimples(partes) {
  let total = 0;
  const prontas = [];
  for (const { geo, matriz } of partes) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (matriz) g.applyMatrix4(matriz);
    prontas.push(g);
    total += g.attributes.position.count;
  }
  const pos = new Float32Array(total * 3);
  let off = 0;
  for (const g of prontas) {
    pos.set(g.attributes.position.array, off * 3);
    off += g.attributes.position.count;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return geo;
}

function geometriaNucleo() {
  const pontos = PERFIL_NUCLEO.map(([y, r]) => new THREE.Vector2(Math.max(1e-3, r), y));
  return new THREE.LatheGeometry(pontos, 14);
}

/**
 * Os dois anéis de penas, fundidos.
 *
 * CHAMA, NÃO CACO DE VIDRO: sete lados por pena, e não quatro. De perfil, um
 * cone de quatro lados é um triângulo de aresta viva, e um punhado deles em
 * aditivo branco vira estilhaço chapado por cima do corpo — na pose do
 * Kamehameha, que é a mais icônica do jogo, o tronco sumia atrás deles. Sete
 * lados leem como volume ao custo de três triângulos a mais por pena.
 */
function geometriaCoroa() {
  const partes = [];
  for (const anel of ANEIS) {
    for (let i = 0; i < anel.n; i++) {
      const a = (i / anel.n) * TAU;
      /* Alturas irregulares. Penas iguais dariam uma coroa de plástico; a
         diferença de tamanho é o que faz o olho ler fogo. */
      const alto = anel.alto + ((i * 7) % 5) * (anel.extra / 4);
      const geo = new THREE.ConeGeometry(anel.grossura, alto, 7, 1, true);
      geo.translate(0, alto * 0.5, 0);
      // Sobem ao longo do eixo ABRINDO para fora: a coma de um cometa, não um
      // tubo. É a abertura que garante que o corpo fica emoldurado e não coberto.
      const sen = Math.sin(anel.abertura);
      const dir = _v.set(Math.cos(a) * sen, Math.cos(anel.abertura), Math.sin(a) * sen).normalize();
      const base = new THREE.Vector3(Math.cos(a) * anel.raio, anel.recuo, Math.sin(a) * anel.raio);
      partes.push({
        geo,
        matriz: new THREE.Matrix4().compose(base, _q.setFromUnitVectors(CIMA, dir), _escala.set(1, 1, 1)),
      });
    }
  }
  return fundirSimples(partes);
}

/** Coluna de cacos em espiral. Sobem e reaparecem atrás — ver `update`. */
function geometriaFaiscas() {
  const partes = [];
  for (let i = 0; i < FAISCAS; i++) {
    const t = i / FAISCAS;
    const a = t * TAU * 2.6;
    const raio = 0.26 + (i % 3) * 0.12;
    const tam = 0.035 + ((i * 5) % 4) * 0.012;
    const geo = new THREE.TetrahedronGeometry(tam);
    _euler.set(a, a * 1.7, 0);
    partes.push({
      geo,
      matriz: new THREE.Matrix4().compose(
        _v.set(Math.cos(a) * raio, -1.2 + t * PASSO_FAISCA, Math.sin(a) * raio),
        _q.setFromEuler(_euler),
        _escala.set(1, 1.8, 1),
      ),
    });
  }
  return fundirSimples(partes);
}

/* As três malhas do casulo são IGUAIS em todo lutador — só a cor muda, e cor é
   material. Construí-las uma vez e emprestá-las às quinze auras poupa catorze
   cópias de cada buffer e, o que pesa mais, catorze construções de vinte e
   quatro cones no instante em que a sala enche. Elas voltam para o nada quando
   a última aura vai embora: ver `largarPecas`. */
let _pecas = null;
let _donos = 0;

function pegarPecas() {
  if (!_pecas) {
    _pecas = {
      nucleo: geometriaNucleo(),
      coroa: geometriaCoroa(),
      faiscas: geometriaFaiscas(),
    };
  }
  _donos++;
  return _pecas;
}

function largarPecas() {
  if (_donos > 0) _donos--;
  if (_donos > 0 || !_pecas) return;
  for (const g of Object.values(_pecas)) g.dispose();
  _pecas = null;
}

/* ------------------------------------------------------------------ classe -- */

export class Aura {
  /**
   * @param {THREE.Object3D} pai o `root` do lutador — a aura acompanha o corpo,
   *   inclusive quando ele tomba
   * @param {number} cor cor do jogador; o ki puxa para ela sem deixar de ser ki
   */
  constructor(pai, cor = 0xff7a1a) {
    /** O corpo. A aura lê dele a posição e o quaternion DESTE quadro — o
     *  `Fighter` monta os dois em `aplicar()`, logo antes de chamar aqui. */
    this.raiz = pai;

    this.grupo = new THREE.Group();
    this.grupo.visible = true;
    /* Depois do corpo: aditivo sem `depthWrite` precisa ser desenhado por
       último, ou a chama some atrás do próprio lutador. `renderOrder` de grupo
       só vale para os filhos DIRETOS — um grupo aninhado zera a ordem de novo —,
       então ele é repetido em cada grupo e em cada malha daqui para baixo. */
    this.grupo.renderOrder = 4;
    pai.add(this.grupo);

    const pecas = pegarPecas();
    this.matNucleo = materialAditivo(0xffffff, 0.16);
    this.matChama = materialAditivo(cor, 0.34);
    this.matFaisca = materialAditivo(0xffffff, 0.6);
    this.matCauda = materialAditivo(0xffffff, 1, true);

    /* O CASULO: colado ao corpo, na cota do peito, e é só ele que fica em volta
       do lutador quando ele gira. Nunca estica. */
    this.casulo = new THREE.Group();
    this.casulo.position.y = PIVO;
    this.casulo.renderOrder = 4;
    this.grupo.add(this.casulo);

    this.nucleo = new THREE.Mesh(pecas.nucleo, this.matNucleo);
    this.casulo.add(this.nucleo);

    /* O EIXO: o que aponta para onde a chama é soprada. Ver `update`. */
    this.eixo = new THREE.Group();
    this.eixo.position.y = PIVO;
    this.eixo.renderOrder = 4;
    this.grupo.add(this.eixo);

    /* O giro fica num grupo próprio, dentro do eixo: a coroa roda em torno do
       sopro, e não em torno do Y do corpo. */
    this.giro = new THREE.Group();
    this.giro.renderOrder = 4;
    this.eixo.add(this.giro);

    this.coroa = new THREE.Mesh(pecas.coroa, this.matChama);
    this.giro.add(this.coroa);

    this.faiscas = new THREE.Mesh(pecas.faiscas, this.matFaisca);
    this.eixo.add(this.faiscas);

    /* A TRILHA: o grupo que desfaz a rotação do corpo. Com o quaternion inverso
       aqui, um vértice escrito como (mundo − origem do corpo) cai exatamente em
       `mundo`, e a cauda deixa de girar junto com quem a solta. */
    this.trilha = new THREE.Group();
    this.trilha.renderOrder = 4;
    this.grupo.add(this.trilha);

    this.fita = new THREE.Mesh(this.criarFita(), this.matCauda);
    this.fita.visible = false;
    this.trilha.add(this.fita);

    /* Uma caixa envolvente para efeito que muda de forma todo quadro não ajuda
       em nada, e o `frustumCulled` padrão faria a aura sumir de lado — e a
       cauda sumir inteira, já que a caixa dela nasceria do primeiro quadro. */
    for (const m of [this.nucleo, this.coroa, this.faiscas, this.fita]) {
      m.frustumCulled = false;
      m.renderOrder = 4;
    }

    this.intensidade = 0;
    this._t = Math.random() * 10; // fases diferentes: quinze auras não pulsam juntas
    this._cor = new THREE.Color(cor);
    this._alvoCor = new THREE.Color(cor);
    this._opacidade = 1;
    /** 0 chama para cima … 1 chama deitada no vento. */
    this._deita = 0;
    /**
     * **SUPER SAIYAJIN** — 0 a 1, escrito pelo `Fighter` a cada quadro.
     *
     * "A aura dele fica amarela e mais intensa." A COR já chega pelo caminho de
     * sempre (`setColor`); este canal é a segunda metade — o que faz a chama
     * ficar mais GROSSA, e não só mais forte.
     *
     * São duas coisas diferentes e a distinção é o que salva o efeito: subir só
     * a intensidade (`ctx.intensidade`) satura a mistura aditiva e o casulo vira
     * um borrão branco — a cor que se acabou de trocar deixa de aparecer, que é
     * o oposto do pedido. Aumentando a opacidade E o tamanho juntos, a aura
     * cresce em volta do corpo e continua amarela.
     *
     * `NAMEK.ssj.auraGanho` (+85 %) é o teto dos dois. Ver o comentário lá para
     * por que não é o dobro.
     */
    this.ssj = 0;
    /** Direção do sopro, em espaço de MUNDO — amortecida aqui e convertida para
     *  o corpo só na hora de desenhar. Amortecer no espaço do corpo faria uma
     *  rolagem rápida arrastar a chama junto, que é meio caminho do defeito
     *  antigo. */
    this._sopro = new THREE.Vector3(0, 1, 0);
    /** Deslocamento acumulado das faíscas ao longo do eixo. */
    this._faisca = 0;

    /* -------------------------------------------------------- estado da cauda */
    this._amostras = new Float32Array(AMOSTRAS * 3);
    this._forcas = new Float32Array(AMOSTRAS);
    this._espinha = new Float32Array(PONTOS * 3);
    this._espForca = new Float32Array(PONTOS);
    this._n = 0;
    this._cabeca = 0;
    this._passo = 0;
    /** Quanto ki ainda há no rastro. Decai sozinho em `VIDA_CAUDA`, que é
     *  exatamente quando a última amostra forte sai do anel — é ele que evita
     *  remontar a fita de quinze lutadores parados no chão. */
    this._energia = 0;
  }

  /**
   * A fita: quatro tiras de `PONTOS` TRIOS de vértices, num buffer só.
   *
   * Trios, e não pares, por causa da BORDA. Uma tira de dois vértices tem cor
   * constante na largura e portanto aresta viva dos dois lados — de longe, uma
   * faixa de papel branco com contorno recortado, que foi exatamente o que a
   * primeira versão desta cauda parecia. Com o vértice do meio a cor faz rampa
   * (0 na borda, cheia no miolo) e a fita ganha a borda macia que o ki tem,
   * sem textura, sem shader e sem nenhum teste de transparência a mais.
   */
  criarFita() {
    const verts = FIOS.length * PONTOS * LADOS;
    const geo = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    const cor = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    cor.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", pos);
    geo.setAttribute("color", cor);

    const idx = new Uint16Array(FIOS.length * (PONTOS - 1) * (LADOS - 1) * 6);
    let o = 0;
    for (let k = 0; k < FIOS.length; k++) {
      for (let i = 0; i < PONTOS - 1; i++) {
        const a = (k * PONTOS + i) * LADOS;
        const b = (k * PONTOS + i + 1) * LADOS;
        for (let r = 0; r < LADOS - 1; r++) {
          idx[o++] = a + r;
          idx[o++] = a + r + 1;
          idx[o++] = b + r;
          idx[o++] = a + r + 1;
          idx[o++] = b + r + 1;
          idx[o++] = b + r;
        }
      }
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return geo;
  }

  /** A cor do ki. Puxa para a cor do jogador, mas nunca deixa de ser luz. */
  setColor(cor) {
    this._alvoCor.set(cor);
  }

  /** Esquece o rastro. Renascer do outro lado do mapa com a cauda esticada
   *  ligando os dois pontos seria um cabo de aço atravessando a arena. */
  reset() {
    this._n = 0;
    this._cabeca = 0;
    this._passo = 0;
    this._energia = 0;
    if (this.fita.visible) this.fita.visible = false;
  }

  /**
   * @param {number} dt
   * @param {object} ctx argumentos do quadro — um objeto REAPROVEITADO pelo
   *   dono (ver `_auraCtx` em `fighter.js`), nunca um literal por quadro:
   *   `{ intensidade, voo, rapidez, velocidade, camera, opacidade }`.
   */
  update(dt, ctx) {
    /* A intensidade é AMORTECIDA aqui dentro, e não pelo dono. Quem manda nela
       são eventos secos — soltou a tecla de carga, o especial acabou — e uma
       aura que apaga no mesmo quadro em que a tecla sobe é um interruptor de
       luz. O ki some como fogo some. */
    this.intensidade = damp(this.intensidade, clamp(ctx.intensidade ?? 0, 0, 1), 9, dt);
    this._opacidade = ctx.opacidade ?? 1;
    this._t += dt;

    const voo = clamp(ctx.voo ?? 0, 0, 1);
    const vel = ctx.velocidade;
    const rapidez = ctx.rapidez ?? 0;

    /* ------------------------------------------------------- o sopro ------ *
     *
     * Para onde a chama é empurrada, em espaço de MUNDO. Parada, para cima —
     * todo fogo sobe. Voando, para trás, e "para trás" é o oposto da VELOCIDADE:
     * não é o −Z do corpo, não é o eixo do olhar, não é uma rotação fixa. É a
     * única definição que continua certa quando o lutador mergulha de costas,
     * rola na curva ou voa de lado. */
    let deita = 0;
    _alvoDir.copy(CIMA);
    if (vel && rapidez > 1.5) {
      deita = clamp((rapidez - 1.5) / (NAMEK.fighter.flySpeed * 0.5), 0, 1) * voo;
      _alvoDir.set(
        (-vel.x / rapidez) * deita,
        1 - deita + (-vel.y / rapidez) * deita,
        (-vel.z / rapidez) * deita,
      );
      if (_alvoDir.lengthSq() < 1e-8) _alvoDir.copy(CIMA);
      _alvoDir.normalize();
    }
    this._deita = damp(this._deita, deita, 6, dt);
    this._sopro.lerp(_alvoDir, 1 - Math.exp(-9 * dt));
    if (this._sopro.lengthSq() < 1e-8) this._sopro.copy(CIMA);
    this._sopro.normalize();

    /* A cauda tem vida própria: ela continua se dissipando depois de o casulo
       apagar, então ela é atualizada ANTES do desvio de visibilidade. */
    this.atualizarCauda(dt, ctx, rapidez);

    const i = this.intensidade;
    const ligada = i > 0.02;
    if (this.casulo.visible !== ligada) {
      this.casulo.visible = ligada;
      this.eixo.visible = ligada;
    }
    if (!ligada) return;

    const t = this._t;

    // Cor: transição, nunca troca seca — o azul do Kamehameha CHEGA na aura.
    this._cor.lerp(this._alvoCor, 1 - Math.exp(-5 * dt));
    /* A chama é ki TINGIDO, não a cor do jogador em estado puro. Com a cor
       cheia, o laranja do gi virava uma coroa de palha sobre o céu verde e a
       leitura deixava de ser "energia". Um terço de branco devolve o calor sem
       apagar de quem é a aura.

       **E O SUPER SAIYAJIN ENCOLHE ESSE BRANCO.** É aqui que morava a queixa
       "o ki em volta do jogador não fica dourado": o núcleo puxava 72 % para o
       branco, então o ouro (255, 200, 30) chegava à tela como (255, 240, 192)
       — creme, não ouro. `NAMEK.ssj.auraTinta` é a fração do branqueamento que
       sobra (0,42), e o comentário lá explica por que ela não é zero: o miolo do
       casulo é a parte mais quente do ki, e fogo quente clareia no centro. */
    const tinta = 1 - clamp(this.ssj, 0, 1) * (1 - NAMEK.ssj.auraTinta);
    this.matChama.color.copy(_cor.copy(this._cor).lerp(BRANCO, 0.32 * tinta));
    this.matNucleo.color.copy(_cor.copy(this._cor).lerp(BRANCO, 0.72 * tinta));
    this.matFaisca.color.copy(_cor.copy(this._cor).lerp(BRANCO, 0.45 * tinta));

    /* Duas frequências incomensuráveis (11,3 e 17,9): o pulso da aura não pode
       ter período audível, ou vira lâmpada de discoteca. */
    const pulso = 1 + Math.sin(t * 11.3) * 0.07 + Math.sin(t * 17.9) * 0.04;
    /* O GANHO DO SUPER SAIYAJIN, em DOIS fatores e não em um — e a separação é
       o segundo pedaço do conserto de "o ki não fica dourado".
     *
     * `ouro` é o TAMANHO e `brilho` é a OPACIDADE, e eles divergem porque a
     * mistura é aditiva: opacidade alta empurra qualquer matiz para o branco no
     * compositor, então o mesmo número que fazia a aura parecer "mais intensa"
     * estava apagando a cor que ela tinha acabado de receber. Medido a 1,85× de
     * opacidade, o casulo dourado chega à tela branco.
     *
     * Os dois valem 1 fora da transformação, e aí todas as contas abaixo são
     * exatamente as de sempre. */
    const s = clamp(this.ssj, 0, 1);
    const ouro = 1 + s * NAMEK.ssj.auraGanho;
    const brilho = 1 + s * NAMEK.ssj.auraBrilho;
    const largo = (0.6 + 0.5 * i) * ouro;

    /* O CASULO não estica nunca. Ele é o "em volta do player" do pedido, e
       qualquer alongamento aqui é o começo do foguete de novo. */
    this.nucleo.scale.set(largo, 0.92 + 0.22 * i, largo);
    /* 0,20 → 0,13. O torneado é uma SUPERFÍCIE de opacidade constante, então
       quanto mais forte ele fica mais aparece o contorno dele — e um contorno
       nítido em volta do corpo lê como casulo de gelatina, não como brilho. Com
       a coroa agora densa, o núcleo só precisa preencher o vão entre as penas. */
    this.matNucleo.opacity = 0.13 * i * this._opacidade * brilho;

    /* O eixo do sopro, trazido do mundo para o corpo. É esta linha que conserta
       o rastro que apontava para o lado errado: o alvo é sempre a direção real
       do voo, e o corpo pode estar em qualquer atitude. */
    _qInv.copy(this.raiz.quaternion).invert();
    _v.copy(this._sopro).applyQuaternion(_qInv);
    this.eixo.quaternion.setFromUnitVectors(CIMA, _v);

    // A coroa GIRA em torno do sopro. É o movimento que separa "aura" de "casulo".
    this.giro.rotation.y = t * 2.2;
    /* Deitada no vento ela se estende um pouco — mas ANEL, não jato: 1,55× no
       eixo e 0,88× no raio, contra os 3,4× × 0,65× que faziam o foguete. O que
       dá comprimento ao efeito é a cauda, não a coroa; esticar mais devolve as
       agulhas de estrela que a primeira tentativa tinha. */
    const estica = (0.72 + 0.72 * i) * (1 + 0.55 * this._deita) * pulso * ouro;
    const aberto = largo * (1 - 0.12 * this._deita) * pulso;
    this.giro.scale.set(aberto, estica, aberto);
    /* 0,42 → 0,26. Aditivo sobre um céu já claro satura em branco muito antes
       de a cor do lutador aparecer, e era isso que fazia a aura ler como vidro
       em vez de fogo: a matiz existia no material e nunca chegava à tela. Mais
       fraca, ela SOMA em vez de substituir — e a cor volta. */
    this.matChama.opacity = 0.26 * i * this._opacidade * brilho;

    /* As faíscas correm ao longo do eixo e voltam pelo começo. O módulo é o
       truque inteiro: uma coluna que se repete a cada `PASSO_FAISCA` metros
       parece infinita e não custa uma única escrita em atributo de geometria.
       Como elas vivem dentro do eixo, no voo elas escorrem para trás sozinhas. */
    this._faisca = (this._faisca + dt * (1.6 + 2.2 * i + 6 * this._deita)) % PASSO_FAISCA;
    this.faiscas.position.y = this._faisca;
    this.faiscas.rotation.y = -t * 1.3;
    this.faiscas.scale.setScalar((0.7 + 0.6 * i) * ouro);
    // Pelo mesmo motivo da chama: faísca branca cheia em aditivo é um recorte de
    // papel, não uma fagulha.
    this.matFaisca.opacity = 0.34 * i * this._opacidade * brilho;
  }

  /* ---------------------------------------------------------------- cauda -- */

  /** Uma amostra do peito no anel. Salto grande = renasceu: esquece o resto. */
  empurrarAmostra(x, y, z, forca) {
    if (this._n > 0) {
      const u = ((this._cabeca - 1 + AMOSTRAS) % AMOSTRAS) * 3;
      const dx = x - this._amostras[u];
      const dy = y - this._amostras[u + 1];
      const dz = z - this._amostras[u + 2];
      if (dx * dx + dy * dy + dz * dz > SALTO_MAX * SALTO_MAX) this.reset();
    }
    const k = this._cabeca * 3;
    this._amostras[k] = x;
    this._amostras[k + 1] = y;
    this._amostras[k + 2] = z;
    this._forcas[this._cabeca] = forca;
    this._cabeca = (this._cabeca + 1) % AMOSTRAS;
    if (this._n < AMOSTRAS) this._n++;
  }

  atualizarCauda(dt, ctx, rapidez) {
    const voo = clamp(ctx.voo ?? 0, 0, 1);
    /* A cauda é do VOO E DA VELOCIDADE. Parado no ar não há rastro — rastro é o
       que ficou para trás, e quem não anda não deixa nada. Isso também mata de
       graça o caso degenerado em que todas as amostras caem no mesmo ponto. */
    const forca = voo * smoothstep(VEL_CAUDA_MIN, VEL_CAUDA_MAX, rapidez);

    /* O peito, em espaço de mundo. Sai do quaternion do corpo e não de
       `chestPoint`, que lê uma matriz de mundo que só será recalculada no fim
       do quadro — a 96 m/s, um quadro de atraso é um metro e meio de vão entre
       o corpo e o começo da cauda. */
    _ancora.set(0, PIVO, 0).applyQuaternion(this.raiz.quaternion).add(this.raiz.position);

    /* Amostragem em passo de TEMPO fixo, e ela roda mesmo com força zero: são as
       amostras apagadas que empurram as acesas para fora do anel, e é assim que
       o rastro se dissipa em vez de ficar pendurado no céu. */
    this._passo += dt;
    if (this._passo >= PASSO_CAUDA) {
      this._passo = this._passo > PASSO_CAUDA * 2 ? 0 : this._passo - PASSO_CAUDA;
      this.empurrarAmostra(_ancora.x, _ancora.y, _ancora.z, forca);
    }

    this._energia = Math.max(forca, this._energia - dt / VIDA_CAUDA);
    if (this._energia <= 0.015 || this._n < 2) {
      if (this.fita.visible) this.fita.visible = false;
      return;
    }

    /* ------------------------------------------------------- o espinhaço -- */
    const esp = this._espinha;
    const fz = this._espForca;
    esp[0] = _ancora.x;
    esp[1] = _ancora.y;
    esp[2] = _ancora.z;
    fz[0] = forca;
    let m = 1;
    let comp = 0;
    let px = _ancora.x;
    let py = _ancora.y;
    let pz = _ancora.z;
    for (let j = 0; j < this._n; j++) {
      const k = (this._cabeca - 1 - j + AMOSTRAS * 2) % AMOSTRAS;
      const x = this._amostras[k * 3];
      const y = this._amostras[k * 3 + 1];
      const z = this._amostras[k * 3 + 2];
      const dx = x - px;
      const dy = y - py;
      const dz = z - pz;
      comp += Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (comp > COMP_MAX) break;
      esp[m * 3] = x;
      esp[m * 3 + 1] = y;
      esp[m * 3 + 2] = z;
      fz[m] = this._forcas[k];
      m++;
      px = x;
      py = y;
      pz = z;
    }
    if (m < 2 || comp < COMP_MIN) {
      if (this.fita.visible) this.fita.visible = false;
      return;
    }
    if (!this.fita.visible) this.fita.visible = true;

    /* A trilha desfaz a rotação do corpo: daqui para baixo os vértices são
       coordenadas de MUNDO menos a origem do lutador. */
    this.trilha.quaternion.copy(this.raiz.quaternion).invert();
    const ox = this.raiz.position.x;
    const oy = this.raiz.position.y;
    const oz = this.raiz.position.z;

    /* ------------------------------------------------------- os vértices -- */
    const cam = ctx.camera;
    const geo = this.fita.geometry;
    const pos = geo.attributes.position.array;
    const cores = geo.attributes.color.array;
    const t = this._t;
    /* A espessura acompanha o comprimento, e a abertura dos fios também — ver
       `LARG_POR_METRO`, que é onde está escrito por que os dois coeficientes
       encolheram na mesma proporção em que a cauda esticou. */
    const escalaLarg = clamp(0.72 + comp * LARG_POR_METRO, 0.72, 1.65);
    const espalha = clamp(comp * ESPALHA_POR_METRO, 0.5, 3.6);
    const cr = this._cor.r;
    const cg = this._cor.g;
    const cb = this._cor.b;
    /* O PISO DE COR do Super Saiyajin — quanto da cor do ki a fita já tem no
       ponto colado no corpo. Resolvido AQUI, uma vez por quadro, e não dentro do
       laço: são `PONTOS` × 4 fios de iterações, e uma multiplicação a mais lá
       dentro é trabalho por vértice para um número que não muda. Ver o
       comentário da cor, no laço. */
    const ssjCauda = clamp(this.ssj, 0, 1);
    const uc0 = ssjCauda * NAMEK.ssj.auraCauda;

    _tanAnt.set(0, 0, 1);
    _ladoAnt.set(1, 0, 0);

    for (let i = 0; i < PONTOS; i++) {
      const s = i < m ? i : m - 1;
      const c = s * 3;
      /* Tangente por diferença central: a fita acompanha a curva do voo em vez
         de mostrar o canto de cada amostra. */
      const a = Math.max(0, s - 1) * 3;
      const b = Math.min(m - 1, s + 1) * 3;
      _tan.set(esp[b] - esp[a], esp[b + 1] - esp[a + 1], esp[b + 2] - esp[a + 2]);
      if (_tan.lengthSq() > 1e-8) _tan.normalize();
      else _tan.copy(_tanAnt);
      _tanAnt.copy(_tan);

      const x = esp[c];
      const y = esp[c + 1];
      const z = esp[c + 2];

      // A largura é PERPENDICULAR ao olhar: fita plana vista de perfil é uma
      // linha, e uma cauda que pisca conforme se voa é pior que cauda nenhuma.
      let perto = 1;
      if (cam) {
        _vista.set(x - cam.x, y - cam.y, z - cam.z);
        const d = _vista.length() || 1;
        _vista.divideScalar(d);
        perto = smoothstep(PERTO_0, PERTO_1, d);
      } else {
        _vista.set(0, 0, 1);
      }
      _lado.crossVectors(_tan, _vista);
      const lm = _lado.length();
      if (lm > 1e-5) _lado.divideScalar(lm);
      else _lado.copy(_ladoAnt);
      _ladoAnt.copy(_lado);

      const u = m > 1 ? i / (m - 1) : 1;
      const q = Math.max(0, 1 - u);
      /* GOTA, não cunha. O ponto mais grosso fica um palmo ATRÁS do corpo e daí
         em diante é só afinar — e a ponta da frente é quase um bico. Larga desde
         o primeiro ponto, a fita terminava numa parede vertical na altura do
         peito: de lado, uma guilhotina branca cortando o rastro no meio do
         lutador. O bico faz a cauda BROTAR de dentro da aura. */
      const perfil = q * Math.sqrt(q) * (0.14 + 0.86 * smoothstep(0, 0.16, u));
      const largura = LARG_CAUDA * escalaLarg * perfil * (0.4 + 0.6 * fz[s]);
      /* O brilho cai mais rápido que a largura: a cauda AFINA e APAGA ao mesmo
         tempo, que é o "vai sumindo aos poucos" do pedido.

         E ela NASCE fraca. Em cheio desde o primeiro ponto, a cabeça da cauda
         cai por cima do lutador — ela sai do peito dele — e come as pernas e o
         gi num borrão branco. Subindo ao longo do primeiro sexto, o ponto mais
         claro fica LOGO ATRÁS do corpo, que é onde ele está na referência e
         onde ele não atrapalha a leitura da silhueta. */
      const nascer = 0.32 + 0.68 * smoothstep(0, 0.18, u);
      /* `_energia` NÃO entra aqui, e a tentação de pôr é forte: ela é o
         envelope de saída, e o envelope de saída já está em `fz` — cada amostra
         guarda a força com que NASCEU, e as apagadas empurram as acesas para
         fora do anel sozinhas. Multiplicar pelas duas elevaria o brilho ao
         quadrado e deixaria a cauda do voo lento (7 a 25 m/s) quase invisível
         justamente na faixa em que ela está aparecendo. */
      const brilho = BRILHO_CAUDA * fz[s] * nascer * q * q * Math.sqrt(q) * perto;
      /* Branca no nascimento, cor do lutador ao longe: o ki esfria com a idade.
       *
       * **E O SUPER SAIYAJIN ANTECIPA A COR.** A regra acima é boa e continua
       * valendo, mas o trecho da cauda que se vê de um lutador voando é
       * justamente o colado no corpo — e ali `u` é quase zero, ou seja, ela
       * entregava uma fita BRANCA saindo de um corpo dourado. Era metade da
       * queixa "o ki em volta do jogador não fica dourado": a outra metade era o
       * branqueamento do casulo, lá em cima.
       *
       * `auraCauda` (0,72) é o piso do quanto de cor já existe no nascimento, e
       * o `u` continua mandando no resto: a fita sai de ouro do peito e só o
       * último quarto lava para o branco. A leitura de dissipação fica; a
       * mentira sobre a cor de quem voa, não. */
      const uc = ssjCauda > 0 ? uc0 + (1 - uc0) * u : u;
      const mr = (1 - uc) + cr * uc;
      const mg = (1 - uc) + cg * uc;
      const mb = (1 - uc) + cb * uc;

      for (let k = 0; k < FIOS.length; k++) {
        const fio = FIOS[k];
        const uf = u / fio.fim;
        const vivo = uf < 1 ? 1 - uf * uf : 0;
        const w = largura * fio.larg * vivo;
        // A mecha se afasta do eixo conforme recua, e ondula: é o que esgarça o
        // rastro em vez de deixá-lo uma faixa de fita.
        const d = fio.amp * espalha * (0.16 + 0.84 * u) * Math.sin(u * fio.onda - t * fio.vel + fio.fase);
        const cx = x + _lado.x * d;
        const cy = y + _lado.y * d;
        const cz = z + _lado.z * d;
        const bf = brilho * vivo;
        let o = (k * PONTOS + i) * LADOS * 3;
        for (let r = 0; r < LADOS; r++, o += 3) {
          const s2 = w * CORTE_LADO[r];
          pos[o] = cx + _lado.x * s2 - ox;
          pos[o + 1] = cy + _lado.y * s2 - oy;
          pos[o + 2] = cz + _lado.z * s2 - oz;
          const p2 = bf * PESO_LADO[r];
          cores[o] = mr * p2;
          cores[o + 1] = mg * p2;
          cores[o + 2] = mb * p2;
        }
      }
    }

    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    this.matCauda.opacity = this._opacidade;
  }

  /** Detalhe fino da aura: as faíscas somem de longe. A cauda NÃO — de longe
   *  ela é a única coisa que se vê, e é para isso que ela existe. */
  setDetalhe(nivel) {
    this.faiscas.visible = nivel < 2;
  }

  dispose() {
    if (this._solto) return;
    this._solto = true;
    this.fita.geometry.dispose();
    for (const m of [this.matNucleo, this.matChama, this.matFaisca, this.matCauda]) m.dispose();
    /* O grupo sai do corpo ANTES de o dono varrer o `root` disparando
       `geometry.dispose()` — as três geometrias do casulo são emprestadas, e
       liberá-las aqui apagaria a aura dos outros catorze lutadores. */
    this.grupo.parent?.remove(this.grupo);
    largarPecas();
  }
}
