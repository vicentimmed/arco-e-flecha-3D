/* ---------------------------------------------------------------------------
   O castelo — as MEDIDAS, e só elas.

   Mesmo papel de `shared/valleyProps.js` e `shared/moonProps.js`, e pelo mesmo
   motivo declarado no cabeçalho daquele: o cliente tem um colisor de Rapier
   para cada peça, e o servidor não tem malha nenhuma. Aqui o defeito de não ter
   é maior do que em qualquer fase anterior, porque o castelo não é cobertura
   acessória — ele É o campo de jogo:

   • Sem `footprint()`, a horda inteira ATRAVESSA o muro andando. O sintoma é um
     monstro passeando no pátio, sem nenhum erro no log, e a partida deixa de
     ter regra.
   • Sem `castleBlockers()`, o xamã e a catapulta acertam quem está atrás de um
     merlão. A cobertura do modo é exatamente esta lista — ver §6.4 do plano.

   ------------------------------------------------------------- a orientação

   O castelo fica na ORIGEM e o portão olha para +Z. A horda sobe a rampa
   vindo de +Z, da linha de árvores em z ≈ +100. Tudo neste arquivo está em
   coordenadas de MUNDO: não há transformação de castelo para mundo, e é de
   propósito — uma matriz no meio seria mais uma coisa sobre a qual os dois
   lados podem discordar.

   -------------------------------------------------------------- as alturas

   `GROUND_Y` é o topo do esporão de rocha, e o piso do pátio. `castleField.js`
   levanta o platô até exatamente essa cota — a constante mora AQUI porque é
   dela que sai tanto o terreno quanto a base de cada parede, e duas cópias
   sairiam de sincronia no primeiro ajuste.
   --------------------------------------------------------------------------- */

/** Topo do esporão: piso do pátio e base de toda a alvenaria. */
export const GROUND_Y = 14;

/**
 * Piso do adarve — 8 m de muro acima do pátio, e NÃO os 11 m do plano.
 *
 * A correção não é de gosto, é de geometria, e ela decide se o modo existe.
 *
 * Um arqueiro no adarve solta a corda a 1,42 m do piso. Para acertar quem está
 * batendo no portão, a flecha precisa SAIR do que estiver À FRENTE dele antes
 * de descer abaixo do topo do muro — senão a linha de tiro atravessa alvenaria e
 * `bloqueado()` a recusa, corretamente. Isso impõe uma inclinação máxima:
 *
 *     Δz por Δy  ≥  (muro à frente do arqueiro) / 1,42
 *
 * Com 11 m de muro, o ponto mais próximo que ainda dá tiro fica a **5,6 m** da
 * face — muito além de onde alguém encosta num portão. Medido: o arqueiro de
 * CPU passou uma partida inteira tensionando o arco e não soltou uma flecha,
 * porque TODO alvo na base do muro estava atrás de pedra.
 *
 * Isto é fisicamente verdadeiro (é por isso que castelos de verdade têm
 * matacães — buracos no piso para despejar coisas, não para atirar) e é
 * inaceitável aqui: o plano diz, com todas as letras, que **o arco é a arma do
 * portão**. Um muro sem esse tiro não é um cerco, é uma varanda.
 *
 * Com 8 m — e com a hourd tirando a espessura do muro do caminho, ver
 * `CASTLE.hoardOut` — a mesma conta dá **4,0 m** da face: a distância de um
 * aglomerado apertado na boca do portão, que é onde `standZ` põe a fila. O muro
 * continua alto o bastante para a queda ser mortal e para a vantagem de altura
 * ser real; só deixou de ser alto a ponto de anular a própria arma.
 */
export const WALL_TOP = GROUND_Y + 8;

/**
 * Topo do PARAPEITO — e o número mais delicado do castelo inteiro.
 *
 * (O nome ficou `MERLON_TOP` porque é importado em quatro arquivos e a coisa
 * que ele mede não mudou: a altura em que a pedra do bordo termina.)
 *
 * Ele tem de ficar entre duas coisas ao mesmo tempo:
 *
 *   • ABAIXO da flecha de quem está no adarve (a corda sai a 1,42 m do piso),
 *     senão o defensor atira na própria pedra;
 *   • ACIMA do peito de quem está agachado atrás dele, senão o xamã lá embaixo
 *     acerta quem está protegido.
 *
 * 1,6 m — o valor do plano — falha no primeiro: medido, o arqueiro de muralha
 * tinha `temVisada` FALSO para todo alvo na rampa, porque a linha do tiro
 * cruzava a pedra do bordo antes de sair do muro. O bot passava a partida
 * tensionando o arco e nunca soltava.
 *
 * O valor final é **0,95 m**, e o parapeito NÃO BARRA FLECHA — ele é peitoril e
 * silhueta, com colisor só no cliente (ver `castleParapets`).
 *
 * A tentativa de fazê-lo ser cobertura foi medida contra `bloqueado()` com a
 * lista real, e falhou dos dois lados ao mesmo tempo:
 *
 *   • **Para fora**, ele engolia uma faixa inteira do campo de tiro. O tiro no
 *     portão passa POR BAIXO da altura dele (é quase a prumo) e o tiro longo
 *     passa POR CIMA (é quase rasante) — mas tudo entre 12 e 29 m raspava a
 *     face externa e era recusado. Justamente a faixa em que a fila se forma.
 *   • **Para dentro**, ele não cobria nada: medido, o raio do xamã a 68 m
 *     atinge tanto o peito quanto a cabeça de quem está de pé na hourd. Cobrir
 *     exigiria agachar, e o jogo não tem agachar.
 *
 * As duas exigências — atirar por cima e se abrigar atrás — são a MESMA altura.
 * Nenhuma pedra resolve as duas, e insistir só produzia o pior dos dois mundos:
 * a mira atrapalhada e nenhuma proteção. O §6.4 do plano está corrigido: a
 * resposta ao xamã não é se esconder, é matá-lo.
 */
export const MERLON_TOP = WALL_TOP + 0.95;

export const CASTLE = {
  /* ------------------------------------------------------- muro frontal -- */
  /** Meia-largura: 34 m de vão, o campo de tiro inteiro do modo. */
  wallHalfX: 17,
  /** Face EXTERNA. É a linha de onde se mede tudo o que está lá fora. */
  wallZOut: 8,
  /** Espessura — e, portanto, a largura do adarve.
      Subiu de 3,2 para 5,4 m: com o parapeito ocupando 0,5 m do bordo, sobram
      4,9 m de piso livre. Com 3,2 sobravam 2,6 e o muro era um corredor —
      andar de costas enquanto se mira virava uma queda. */
  wallThick: 5.4,

  /* ------------------------------------------------------------ portão -- */
  /** Meio-vão: 6 m de portão. Cabem 6 atacantes de frente — ver §6.3. */
  gateHalfX: 3,
  /** Cota do topo do vão (5,5 m). Acima disso o muro é cheio até o adarve. */
  gateTopY: GROUND_Y + 5.5,

  /* ------------------------------------------------------------ torres --
     Bastiões abertos, ao nível do adarve: dá para andar do muro para eles.

     `towerHalfZ` é MAIOR que `towerHalf` (que é o de x), e não por estética.
     Com os dois iguais, o bastião ia de z = 3,4 a 10,6 e o muro de flanco
     começava em x = 19,2 — sobrava um buraco de 2 m no canto, em z < 3,4, por
     onde o jogador andava para fora do castelo e caía oito metros. Era o
     "atravessando a parede nas extremidades laterais". O bastião agora vai até
     z = −2,5 e encosta no flanco. */
  towerHalf: 3.6,
  towerHalfZ: 6.5,
  towerX: 18,
  towerZ: 4.0,

  /* ---------------------------------------------------- muros laterais -- */
  /** Centro dos muros de flanco. O pátio vive entre eles. */
  sideX: 20.4,
  sideThick: 2.4,
  sideZBack: -27.2,
  sideHeight: 8,

  /* -------------------------------------------------------------- pátio -- */
  /** Face interna do muro frontal. DERIVADO de `wallZOut − wallThick`; escrito
      à mão é a primeira coisa que sai de sincronia quando a espessura muda. */
  get courtZFront() {
    return this.wallZOut - this.wallThick;
  },
  courtZBack: -26,

  /* -------------------------------------------------- torre de menagem -- */
  keep: { x: 0, z: -20, half: 5, height: 22 },
  /** Onde se renasce: a porta da menagem, virada para o portão. */
  respawn: { x: 0, z: -14 },

  /* ------------------------------------------------------------ escadas --
     Rampas de alvenaria encostadas nos muros de flanco, subindo em +Z. 14 m
     de corrida para 11 m de subida — 38°, que o controlador de personagem sobe
     sem reclamar (`setMaxSlopeClimbAngle` é 89°). */
  stairX: 14,
  stairHalfW: 1.3,
  stairZBottom: -11,
  stairZTop: 3,

  /* ------------------------------------------------------------ hourd --
     A galeria de madeira que se projeta para FORA da face do muro.

     Ela não é enfeite medieval: é a peça que devolve o tiro no pé do muro.

     A conta está no comentário de `WALL_TOP`: a flecha precisa vencer a pedra
     que está À FRENTE do arqueiro antes de descer abaixo do topo do muro. Com
     o adarve alargado para 5,4 m — que é o que torna o muro jogável — o
     arqueiro fica 1,2 m para dentro da face, e o primeiro ponto com linha limpa
     salta para 13,8 m. Ou seja: alargar o adarve e alcançar o portão eram
     pedidos que se anulavam.

     A hourd desempata os dois. Com o piso avançando 1,2 m além da face, o
     arqueiro fica FORA da espessura do muro: o único obstáculo à frente dele
     passa a ser o próprio parapeito (0,65 m), e o alcance mínimo cai para
     11,9 m — a boca do portão.

     Foi exatamente para isto que hourds existiram: madeira montada às pressas
     na véspera do cerco, justamente porque a pedra sozinha não alcança quem
     está encostado nela. */
  hoardOut: 1.2,
  hoardThick: 0.4,

  /* ---------------------------------------------------------- parapeito --
     CONTÍNUO, sem ameias.

     Os merlões alternados eram historicamente certos e injogáveis: eles ficam
     na altura do olho de quem mira e cortam o campo de tiro em fatias de 90 cm.
     O jogador passava a partida procurando o vão em vez de procurar o alvo, e
     a metade da rampa que estava atrás de uma pedra simplesmente não existia.

     O parapeito corrido resolve a mira sem perder a cobertura, porque a
     cobertura nunca veio do RECORTE — veio da ALTURA. Ele continua entre 1,15 m
     (o peito de quem está atrás) e 1,42 m (a corda de quem atira): quem está no
     adarve passa a flecha por cima, e o tiro rasante do xamã lá de baixo bate
     na pedra. Ver `MERLON_TOP` e §6.4 do plano. */
  parapetThick: 0.5,

  /* -------------------------------------------------- casa do portão --
     DUAS TORRES, e a descoberta que as tornou possíveis.

     O muro não tinha uma linha vertical sequer: visto de fora era uma laje de
     34 m com o topo perfeitamente reto, que é a única coisa que um castelo
     nunca é. Toda tentativa anterior de erguer alguma coisa ali esbarrava na
     mesma regra — não se põe pedra na frente de quem atira.

     Só que a HOURD já tinha resolvido isso. O arqueiro fica em z = 8,3 e a
     face externa do muro está em z = 8,0: ele está À FRENTE da alvenaria
     inteira. Tudo o que se construir sobre o adarve, em z < 8, nasce ATRÁS
     dele — e não pode entrar na linha de tiro nem em princípio. É o mesmo
     raciocínio que o comentário de `CASTLE.hoardOut` faz para a flecha,
     usado agora para a silhueta.

     As torres ocupam a metade de DENTRO do adarve e deixam livres os três
     metros do bordo mais a hourd, que é por onde se anda e de onde se atira.
     Ficam a 5,6 m do eixo, encostadas no vão — como numa casa de portão de
     verdade. */
  gateTowerX: 5.6,
  gateTowerHalfX: 1.55,
  /** Meia-espessura em z, medida a partir da face INTERNA do muro. */
  gateTowerHalfZ: 1.3,
  gateTowerRise: 4.4, // m acima do piso do adarve
};

/** Centro do muro frontal em z — derivado, para ninguém recalcular errado. */
export const WALL_ZC = CASTLE.wallZOut - CASTLE.wallThick / 2;

/**
 * O portão, como retângulo no plano do muro.
 *
 * O servidor usa para saber quem está encostado nele (a fila do §6.3) e o
 * cliente para desenhar a folha de madeira e os estados de destruição.
 */
export function gateInfo() {
  return {
    x: 0,
    z: WALL_ZC,
    halfX: CASTLE.gateHalfX,
    baseY: GROUND_Y,
    topY: CASTLE.gateTopY,
    thick: CASTLE.wallThick,
    /**
     * Onde um atacante para para bater.
     *
     * 6,5 m à frente da face, e não encostado nela. É o limite do ângulo morto
     * de quem está no adarve (ver o comentário de `WALL_TOP`): mais perto que
     * isso e a fila fica intocável pelo arco, que é a arma que o plano
     * reservou justamente para ela.
     *
     * O número saiu da conta, não do gosto: da hourd, o arqueiro tem 0,65 m de
     * parapeito à frente e nada mais — a espessura do muro fica atrás dele. Com
     * 8 m de altura e a corda a 1,42 do piso, o primeiro ponto com linha limpa
     * fica a 11,9 m do plano do muro. 12,0 dá a folga.
     *
     * Sem a hourd (o arqueiro 1,2 m para dentro da face) o mesmo número seria
     * 13,8 m — que ninguém leria como "no portão". Ver `CASTLE.hoardOut`.
     *
     * O valor final é maior que o mínimo por um segundo motivo, este de
     * ERGONOMIA e não de geometria: encostada na face, a fila fica a 71° abaixo
     * da horizontal de quem está no adarve. Olhar para ela é olhar para os
     * próprios pés, e em terceira pessoa o corpo do arqueiro tapa o que sobra.
     * A 6,5 m o ângulo cai para 54°, que é uma inclinação em que se joga.
     *
     * É o mesmo tipo de troca que o §3.1 do plano faz com a rampa: a distância
     * não existe para ser realista, existe para caber no campo de visão.
     *
     * Lido de fora, é um aglomerado apertado na boca do portão — que é o que
     * ele é, e é o alvo que o §6.3 pede.
     */
    standZ: CASTLE.wallZOut + 6.5,
  };
}

/**
 * Os postos do adarve — onde se nasce e onde os bots de muralha ficam.
 *
 * Espalhados pelo vão do muro e pelos dois bastiões, na ordem em que a sala
 * distribui: primeiro o centro (sobre o portão, o posto que importa), depois
 * as pontas. Quem entra sozinho fica onde a partida é decidida.
 */
export function walkwayPosts() {
  /* Junto às ameias (z alto), e não no meio do adarve.
   *
   * O trabuco do portão ocupa a faixa de dentro (ver `trebuchetPosts`), e a
   * primeira versão punha os dois no mesmo metro quadrado: quem entrava sozinho
   * nascia DENTRO da funda do engenho, com a pedra em chamas encostada na
   * câmera. O adarve tem 3,2 m; separar as duas faixas resolve sem inventar
   * regra nenhuma. */
  /* NA HOURD, encostado no parapeito. É a posição que dá o tiro no pé do muro
     (ver `CASTLE.hoardOut`), e é onde um arqueiro de cerco de verdade ficava. */
  const zc = CASTLE.wallZOut + CASTLE.hoardOut - CASTLE.parapetThick - 0.4;

  /* NENHUM POSTO NO EIXO DE UM TRABUCO — e a razão é a CÂMERA, não o corpo.
   *
   * A terceira pessoa fica cerca de quatro metros atrás do arqueiro, e o
   * engenho tem quatro metros e meio de comprimento: um posto alinhado com ele
   * põe a câmera DENTRO da armação, e a partida inteira é jogada através de um
   * cavalete. Era o que acontecia nos três — o posto central e os dois
   * bastiões nasciam no mesmo x do seu engenho.
   *
   * Deslocar de lado resolve sem mover as máquinas, que estão onde estão por
   * geometria (`trebuchetPosts`): a três metros e meio do eixo, o engenho vai
   * para a borda do quadro e vira o que deve ser — a coisa grande ao lado, que
   * se vê pelo canto do olho e à qual se vai quando o arco não basta.
   *
   * A ORDEM continua sendo a da distribuição: os dois primeiros ladeiam o
   * portão, que é onde a partida é decidida. */
  const tx = CASTLE.towerX;
  return [
    { x: -3.5, y: WALL_TOP, z: zc },
    { x: 3.5, y: WALL_TOP, z: zc },
    { x: -10.5, y: WALL_TOP, z: zc },
    { x: 10.5, y: WALL_TOP, z: zc },
    /* Nos bastiões, ATRÁS e ao lado do engenho: ele fica adiante e à direita
       (ou à esquerda), enquadrando a rampa em vez de tapá-la. */
    { x: -(tx - 2.4), y: WALL_TOP, z: CASTLE.towerZ - 1.2 },
    { x: tx - 2.4, y: WALL_TOP, z: CASTLE.towerZ - 1.2 },
    { x: -15.2, y: WALL_TOP, z: zc },
    { x: 15.2, y: WALL_TOP, z: zc },
  ];
}

/**
 * Os três trabucos: um em cada bastião e um sobre o portão.
 *
 * Três engenhos para até quatro jogadores — nunca há trabuco para todo mundo,
 * e é isso que faz "quem vai para o trabuco" ser decisão em vez de estado.
 * Ver §5.1 do plano.
 */
export function trebuchetPosts() {
  /* O ENGENHO OCUPA z ∈ [−2,2, +2,2] em torno do posto (ver `G` em
     `entities/trebuchet.js`), e ele tem de caber no piso em que está.
     O adarve vai de z = 2,6 (face interna) a 8,0 (face externa): com o posto
     em `WALL_ZC − 1,4` = 3,9 a armação passava 0,9 m para dentro do pátio e o
     sarilho ficava pendurado sobre o vazio.
     Encostado na face INTERNA, ele fecha em [2,8, 7,2] e deixa livres os dois
     metros do bordo e a hourd — que é justamente a faixa de onde se atira. */
  const zAdarve = CASTLE.wallZOut - CASTLE.wallThick + 2.4;
  return [
    { id: 0, x: -CASTLE.towerX, y: WALL_TOP, z: CASTLE.towerZ + 4, yaw: 0 },
    { id: 1, x: 0, y: WALL_TOP, z: zAdarve, yaw: 0 },
    { id: 2, x: CASTLE.towerX, y: WALL_TOP, z: CASTLE.towerZ + 4, yaw: 0 },
  ];
}

/**
 * O BOSQUE, e por que ele é regra e não paisagem.
 *
 * A planície em volta da rampa era lisa e vazia, e o efeito disso na tela foi
 * relatado com todas as letras: *"os personagens surgem da água"*. Não é
 * exagero — uma superfície plana, de cor uniforme, vista de cima e lavada pela
 * névoa lê como lâmina d'água, e quem aparece nela parece emergir dela.
 *
 * O bosque conserta as duas coisas de uma vez:
 *
 * • dá TEXTURA e ESCALA ao chão distante — deixa de ser lâmina;
 * • dá PROCEDÊNCIA à horda. Eles não aparecem: eles SAEM DE ALGUM LUGAR, e
 *   esse lugar é a linha de árvores que o §3.1 do plano descreve desde sempre
 *   e que nunca tinha sido construída.
 *
 * Os troncos entram em `castleBlockers()` (uma flecha para num tronco, como no
 * vale) mas NÃO em `insideFootprint()`: a horda anda por entre eles. São coisas
 * diferentes e é por isso que são duas listas.
 *
 * Nada nasce dentro do corredor da rampa. O funil é o campo de tiro do modo, e
 * uma árvore no meio dele seria a mesma pedra na frente da mira que o parapeito
 * acabou de deixar de ser.
 */
export function castleWoods() {
  const out = [];
  /* Gerador congruente linear com semente fixa — o mesmo padrão de
     `valleyProps`: cliente e servidor precisam do MESMO bosque, e é a semente
     que garante isso sem trafegar nada. */
  let seed = 20260812;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const cabe = (x, z) => {
    /* Fora do corredor da rampa (que afina de 26 m no portão a 36 m no pé) e
       fora do esporão. A folga de 6 m impede a árvore de nascer na beirada e
       cair pela metade dentro do funil. */
    const meiaRampa = 19 + Math.max(0, Math.min(1, (z - 9) / 90)) * 5;
    if (z < 105 && Math.abs(x) < meiaRampa + 6) return false;
    if (z < 14 && Math.abs(x) < 46) return false; // o esporão e o entorno dele
    return true;
  };

  /* A LINHA DE ÁRVORES: densa logo atrás de onde eles nascem (z ≈ 106), para
     que a horda saia de dentro dela em vez de aparecer na frente dela. */
  for (let i = 0; i < 150 && out.length < 150; i++) {
    const x = (rnd() * 2 - 1) * 120;
    const z = 100 + rnd() * 78;
    if (!cabe(x, z)) continue;
    out.push({
      x,
      z,
      r: 0.34 + rnd() * 0.3,
      h: 7 + rnd() * 9,
      conifera: rnd() < 0.72,
      giro: rnd() * Math.PI * 2,
    });
  }

  /* Os FLANCOS: mais esparsos, e presentes só para o olho não achar que o
     mundo acaba onde a rampa acaba. */
  for (let i = 0; i < 220 && out.length < 300; i++) {
    const x = (rnd() * 2 - 1) * 135;
    const z = -60 + rnd() * 165;
    if (!cabe(x, z)) continue;
    if (Math.abs(x) < 34) continue;
    out.push({
      x,
      z,
      r: 0.3 + rnd() * 0.26,
      h: 6 + rnd() * 8,
      conifera: rnd() < 0.6,
      giro: rnd() * Math.PI * 2,
    });
  }

  return out;
}

/**
 * As pedras soltas: ombros da rampa, pé do esporão e planície.
 *
 * Não bloqueiam nada — são baixas demais para parar uma flecha que vem do
 * adarve, e pô-las na lista de sólidos só produziria tiros recusados por uma
 * pedra de meio metro que ninguém vê a sessenta metros.
 */
export function castleRocks() {
  const out = [];
  let seed = 777202608;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < 120; i++) {
    const x = (rnd() * 2 - 1) * 100;
    const z = -50 + rnd() * 200;
    // Nem no funil, nem em cima do castelo.
    if (z < 105 && Math.abs(x) < 24) continue;
    if (z < 14 && Math.abs(x) < 44) continue;
    out.push({
      x,
      z,
      r: 0.5 + rnd() * 1.7,
      giro: rnd() * Math.PI * 2,
      achatamento: 0.4 + rnd() * 0.5,
    });
  }
  return out;
}

/**
 * OS DESTROÇOS DA RAMPA — e por que noventa metros de terra precisavam deles.
 *
 * O corredor é o centro da tela do primeiro ao último minuto, e ele era uma
 * faixa de terra lisa de 26 m de largura por 90 de comprimento. Vazio assim ele
 * cobra dois preços, e o segundo é de jogo e não de gosto:
 *
 * • **não dá distância.** O olho mede noventa metros por OBJETOS, não por cor.
 *   Sem nada no meio do caminho, um soldado a 40 m e um a 70 m são o mesmo
 *   boneco pequeno — e escolher em quem atirar primeiro é a decisão que o modo
 *   pede o tempo todo;
 * • **não conta nada.** Uma fortaleza sitiada há semanas com o caminho de
 *   acesso impecável é a única coisa que a fase afirma e não mostra.
 *
 * Eles ficam nos OMBROS do corredor, nunca dentro. A faixa por onde a horda
 * anda e por onde a pedra do trabuco cai continua limpa — uma estaca no meio
 * dela seria a pedra na frente da mira que o parapeito deixou de ser.
 *
 * Não bloqueiam flecha e não entram em `castleBlockers()`: são estacas de 12 cm
 * e escudos caídos, e recusar um tiro por causa deles a sessenta metros seria
 * pior do que não os ter.
 */
export function rampDebris() {
  const out = [];
  let seed = 31415926;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  /* A FAIXA LIVRE, e ela existe por construção.
   *
   * O corredor da rampa tem meia-largura 19 m no alto e 24 m no pé (a MESMA
   * conta de `castleWoods` — duas fórmulas divergentes marcariam duas bordas
   * diferentes). A horda nasce dentro de `spawnHalfX`, que são 15 m. Sobram
   * portanto de 4 a 9 metros de cada lado por onde ninguém anda e para onde
   * ninguém atira: é aí que os destroços moram.
   *
   * A primeira tentativa os pôs no ombro EXTERNO, em `meia(z)`, e eles
   * simplesmente não apareciam — a 60 m, vinte e quatro metros fora do eixo
   * caem na borda do quadro, atrás do próprio corpo do arqueiro. Encostados na
   * faixa da horda eles ficam onde o olho já está olhando, que é o único lugar
   * onde uma referência de distância serve para alguma coisa. */
  const dentro = (z) => 15.5 + Math.max(0, Math.min(1, (z - 9) / 90)) * 2.5;
  const meia = (z) => 19 + Math.max(0, Math.min(1, (z - 9) / 90)) * 5;

  /* AS ESTACAS: duas fileiras irregulares nos ombros, com falhas. As falhas
     importam mais que as estacas — uma paliçada contínua leria como cerca de
     jardim, e o que se quer dizer é "isto foi arrancado aos pedaços". */
  for (let z = 18; z < 96; z += 2.8 + rnd() * 2.4) {
    for (const s of [-1, 1]) {
      if (rnd() < 0.24) continue;
      const borda = dentro(z) + rnd() * 2.4;
      out.push({
        tipo: "estaca",
        x: s * borda,
        z: z + (rnd() - 0.5) * 1.6,
        h: 1.2 + rnd() * 1.3,
        r: 0.1 + rnd() * 0.06,
        // Tombadas para fora, como quem foi empurrado por quem subia.
        inclina: (0.1 + rnd() * 0.5) * s,
        giro: rnd() * Math.PI,
      });
    }
  }

  /* OS ESCUDOS E AS LANÇAS caídos, mais adentro do ombro. São as peças planas:
     elas pegam a luz rasante do poente e piscam quando a câmera se move, que é
     o que faz o olho registrar a distância delas. */
  for (let i = 0; i < 30; i++) {
    const z = 20 + rnd() * 72;
    const s = rnd() < 0.5 ? -1 : 1;
    out.push({
      tipo: rnd() < 0.55 ? "escudo" : "lanca",
      x: s * (dentro(z) - 1.2 - rnd() * 2.6),
      z,
      giro: rnd() * Math.PI * 2,
      inclina: rnd() * 0.35,
      escala: 0.9 + rnd() * 0.5,
    });
  }

  /* QUATRO CARROÇAS QUEBRADAS, espalhadas pelo comprimento. São as peças
     GRANDES, e por isso as que mais dão escala — uma a cada vinte metros dá ao
     olho quatro marcos no percurso, que é o que uma faixa lisa não tinha. */
  for (const [z, s] of [[26, -1], [45, 1], [64, -1], [84, 1]]) {
    out.push({
      tipo: "carroca",
      x: s * (dentro(z) + 1.4),
      z,
      giro: (rnd() - 0.5) * 1.2 + (s > 0 ? 0.4 : -0.4),
      tomba: 0.3 + rnd() * 0.5,
    });
  }

  /* E o que o corredor larga fora dele: pedras da catapulta que erraram, no
     ombro externo. Elas ficam em `meia(z)` de propósito — são o que passou
     voando por cima da fila, não o que a fila derrubou. */
  for (let i = 0; i < 14; i++) {
    const z = 24 + rnd() * 66;
    const s = rnd() < 0.5 ? -1 : 1;
    out.push({
      tipo: "escudo",
      x: s * (meia(z) + rnd() * 3),
      z,
      giro: rnd() * Math.PI * 2,
      inclina: rnd() * 0.5,
      escala: 0.7 + rnd() * 0.4,
    });
  }

  return out;
}

/**
 * Os parapeitos — peitoril e silhueta, NÃO obstáculo de flecha.
 *
 * Lista separada de `castleBlockers()` de propósito, e é a segunda divergência
 * declarada entre cliente e servidor (a primeira são as escadas). O cliente
 * monta malha e colisor: eles impedem o jogador de andar para fora do muro e
 * dão a linha do adarve contra o céu. O servidor não os conhece, e por isso
 * nenhuma flecha é recusada por causa deles.
 *
 * O porquê inteiro está no comentário de `MERLON_TOP`.
 */
export function castleParapets() {
  /* VAZIA, e de propósito.

     O adarve é CHÃO LIMPO. Foram três tentativas de pôr borda nele, e cada uma
     falhou por um motivo diferente:

       1. **merlões alternados** — historicamente certos, e cortavam o campo de
          tiro em fatias de 90 cm bem na altura do olho;
       2. **parapeito corrido, como obstáculo de flecha** — engolia toda a faixa
          de 12 a 29 m do próprio campo de tiro, que é onde a fila se forma;
       3. **parapeito corrido, só visual** — deixou de recusar flecha e continuou
          atrapalhando a VISTA: uma faixa de pedra atravessada no terço inferior
          da tela, exatamente onde a rampa aparece.

     A conclusão é a mesma nas três: um parapeito existe para proteger de quem
     está lá embaixo, e este muro existe para ATIRAR em quem está lá embaixo.
     São propósitos opostos, e o jogo escolheu o segundo.

     O que substitui a proteção é a regra: cair mata (`CONFIG.modes.siege
     .fatalFall`). Sem borda em que se apoiar, a beira do adarve vira uma
     decisão a cada passo — o que é mais interessante do que uma pedra que
     decide por você E ainda tapa o alvo.

     A função continua existindo, e vazia, porque `entities/castle.js` a
     percorre: uma fase com muro cheio um dia é só preencher esta lista. */
  return [];
}


/**
 * O piso da hourd — a galeria de madeira projetada para fora.
 *
 * Também client-only, e pelo mesmo motivo das escadas: um deque de 40 cm não é
 * cobertura, e tratá-lo como obstáculo de flecha produziria a única coisa
 * absurda possível — o arqueiro incapaz de atirar por cima dos próprios pés.
 */
export function castleHoard() {
  const C = CASTLE;
  return {
    y: WALL_TOP - C.hoardThick / 2,
    z: C.wallZOut + C.hoardOut / 2,
    hx: C.wallHalfX,
    hy: C.hoardThick / 2,
    hz: C.hoardOut / 2,
  };
}

/**
 * Este ponto do plano está dentro de alvenaria?
 *
 * É o teste que entra no `step()` da horda, e é a diferença entre um cerco e
 * uma horda que atravessa parede. Retângulos alinhados aos eixos, porque é
 * disso que o castelo é feito — nenhuma peça é girada no plano.
 *
 * O PÁTIO NÃO ESTÁ AQUI de propósito: quando o portão cai, é para dentro dele
 * que a horda entra.
 *
 * @param {number} margin folga em metros, para o corpo do bicho não afundar na
 *   pedra. O raio de um sitiante é ~0,35 m.
 */
export function insideFootprint(x, z, margin = 0.35) {
  const C = CASTLE;
  const m = margin;

  // Muro frontal, exceto o vão do portão (que é passagem quando ele cai).
  if (
    z > WALL_ZC - C.wallThick / 2 - m &&
    z < WALL_ZC + C.wallThick / 2 + m &&
    Math.abs(x) < C.wallHalfX + m
  ) {
    if (Math.abs(x) > C.gateHalfX - m) return true;
  }

  // Bastiões.
  for (const sx of [-C.towerX, C.towerX]) {
    if (
      Math.abs(x - sx) < C.towerHalf + m &&
      Math.abs(z - C.towerZ) < C.towerHalfZ + m
    ) {
      return true;
    }
  }

  // Muros de flanco.
  for (const sx of [-C.sideX, C.sideX]) {
    if (
      Math.abs(x - sx) < C.sideThick / 2 + m &&
      z > C.sideZBack - m &&
      z < C.wallZOut + m
    ) {
      return true;
    }
  }

  // Muro de fundo.
  if (
    Math.abs(z - C.sideZBack) < C.sideThick / 2 + m &&
    Math.abs(x) < C.sideX + C.sideThick / 2 + m
  ) {
    return true;
  }

  // Menagem.
  const K = C.keep;
  if (Math.abs(x - K.x) < K.half + m && Math.abs(z - K.z) < K.half + m) return true;

  return false;
}

/**
 * O portão ainda está de pé aqui?
 *
 * Separado de `insideFootprint` porque a resposta MUDA no meio da partida, e
 * quem sabe disso é a sala. Enquanto o portão aguenta, o vão é parede; depois
 * que cai, é a entrada.
 */
export function gateBlocks(x, z, margin = 0.35) {
  const C = CASTLE;
  return (
    z > WALL_ZC - C.wallThick / 2 - margin &&
    z < WALL_ZC + C.wallThick / 2 + margin &&
    Math.abs(x) < C.gateHalfX + margin
  );
}

/**
 * Tudo o que para uma flecha no castelo.
 *
 * Formato de `shared/blockers.js` — caixas alinhadas (`ry` = 0 em todas, o
 * castelo não tem peça girada no plano). O cliente monta os colisores de Rapier
 * a partir DESTA MESMA lista, em `entities/castle.js`: é a única defesa contra
 * o muro que na tela está 40 cm à frente de onde o servidor acha que está.
 *
 * @returns {Array<object>} sólidos no formato de `shared/blockers.js`
 */
export function castleBlockers() {
  const C = CASTLE;
  const out = [];
  const box = (x, y, z, hx, hy, hz, name) =>
    out.push({ box: true, x, y, z, hx, hy, hz, name });

  const hz = C.wallThick / 2;
  const wallH = (WALL_TOP - GROUND_Y) / 2;
  const wallCy = GROUND_Y + wallH;

  /* ----------------------------------------------------- muro frontal -- */
  /* Em três pedaços: os dois panos laterais e o lintel sobre o portão. O vão
     fica vazio, e é isso que permite atirar por ele quando o portão racha. */
  for (const s of [-1, 1]) {
    const x0 = s * C.gateHalfX;
    const x1 = s * C.wallHalfX;
    box((x0 + x1) / 2, wallCy, WALL_ZC, Math.abs(x1 - x0) / 2, wallH, hz, "muro");
  }
  {
    const h = (WALL_TOP - C.gateTopY) / 2;
    box(0, C.gateTopY + h, WALL_ZC, C.gateHalfX, h, hz, "lintel");
  }

  /* --------------------------------------------------------- torres -- */
  for (const sx of [-C.towerX, C.towerX]) {
    box(sx, wallCy, C.towerZ, C.towerHalf, wallH, C.towerHalfZ, "torre");
  }

  /* ------------------------------------------------ casa do portão --
     As DUAS únicas peças novas que os dois lados precisam conhecer.

     Elas entram aqui — e não na decoração de `entities/castle.js` — porque são
     alvenaria de dois metros e meio de largura sobre o adarve: uma flecha que
     as atravessasse no servidor e parasse nelas no cliente seria a divergência
     clássica que este arquivo inteiro existe para evitar.

     Que elas NÃO atrapalham ninguém está demonstrado na geometria, não suposto:
     ficam em z ≤ 5,2 e o arqueiro em z = 8,3. Ver `CASTLE.gateTowerX`. */
  {
    const hz = C.gateTowerHalfZ;
    const zc = C.wallZOut - C.wallThick + hz;
    const alt = C.gateTowerRise / 2;
    for (const sx of [-C.gateTowerX, C.gateTowerX]) {
      box(sx, WALL_TOP + alt, zc, C.gateTowerHalfX, alt, hz, "casa-do-portão");
    }
  }

  /* -------------------------------------------------- muros de flanco -- */
  const sh = C.sideHeight / 2;
  for (const sx of [-C.sideX, C.sideX]) {
    const z0 = C.sideZBack;
    const z1 = C.wallZOut;
    box(sx, GROUND_Y + sh, (z0 + z1) / 2, C.sideThick / 2, sh, (z1 - z0) / 2, "flanco");
  }
  box(
    0,
    GROUND_Y + sh,
    C.sideZBack,
    C.sideX + C.sideThick / 2,
    sh,
    C.sideThick / 2,
    "fundo",
  );

  /* -------------------------------------------------------- menagem -- */
  {
    const K = C.keep;
    box(K.x, GROUND_Y + K.height / 2, K.z, K.half, K.height / 2, K.half, "menagem");
  }

  /* ------------------------------------------------------- bosque --
     Os troncos param flecha, como no vale. A copa não: ela é folha, e um
     cilindro do tamanho dela recusaria metade dos tiros longos. */
  for (const t of castleWoods()) {
    out.push({ x: t.x, z: t.z, r: t.r, h: t.h * 0.55, base: 0, name: "tronco" });
  }

  /* -------------------------------------------------------- escadas --
     APROXIMADAS por um bloco sólido, e de propósito. A caixa de
     `shared/blockers.js` não gira em torno de X, e a escada é uma rampa que
     gira exatamente aí. O erro é conservador (dentro do pátio, uma escada de
     alvenaria É maciça) e não custa nada: ninguém atira através do pátio para
     decidir coisa alguma. O colisor do cliente, esse, é a rampa de verdade. */
  for (const sx of [-C.stairX, C.stairX]) {
    const z0 = C.stairZBottom;
    const z1 = C.stairZTop;
    box(
      sx,
      GROUND_Y + (WALL_TOP - GROUND_Y) / 2,
      (z0 + z1) / 2,
      C.stairHalfW,
      (WALL_TOP - GROUND_Y) / 2,
      (z1 - z0) / 2,
      "escada",
    );
  }

  return out;
}
