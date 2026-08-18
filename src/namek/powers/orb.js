/* ---------------------------------------------------------------------------
   As ESFERAS — a Genki Dama e o Galick Gun.

   Um especial que não é tubo nem lâmina: uma bola de energia que se forma na
   pose, é lançada, viaja pelo ar arrastando o que sobra dela, e DETONA no
   primeiro corpo, no chão, ou no fim da linha.

   Este arquivo nasceu como `genki.js`, atendendo a um golpe só. Ele serve dois
   desde que o Galick Gun deixou de ser um segundo Kamehameha pintado de roxo
   (ver o comentário de `NAMEK.specials.galick`), e a generalização coube em uma
   tabela de estilo porque a MECÂNICA das duas é a mesma — carga, voo, impacto,
   estouro. O que muda é o peso: uma é uma lua que atravessa o céu devagar, a
   outra é um tiro de canhão.

   ------------------------------------------------------------- o que é PESO

   Peso, num jogo, não é massa — é tempo. A Genki Dama é lenta em três escalas
   diferentes e é a soma delas que faz a esfera parecer ter tonelada:

   • **Carga longa (3,6 s).** Um terço do tempo em que a arena inteira sabe onde
     você está e o que você vai fazer. É o preço, e é também o espetáculo: a
     bola crescendo sobre a cabeça é a imagem mais reconhecível da referência.
   • **Voo lento (46 m/s).** Menos da metade de uma bola de ki. Dá para desviar
     — e é para dar: um golpe de 96 de dano que não se pode desviar não é um
     golpe, é um sorteio.
   • **Crescimento que não para.** A esfera respira e gira devagar a viagem
     inteira. Coisa leve vibra rápido; coisa pesada oscila devagar.

   O Galick Gun é o oposto em todas as três, e é isso que o separa: 0,9 s de
   pose, 95 m/s, giro rápido e um rastro denso atrás. Ele não é uma lua — é uma
   pedrada de energia, e a leitura dele é a VELOCIDADE.

   ============================================================================
   DUAS SILHUETAS, E POR QUE NÃO BASTAVA UMA TABELA DE NÚMEROS
   ============================================================================

   O ritmo acima é verdadeiro e não era suficiente. A reclamação foi literal —
   *"a bola do Galick Gun está muito parecida com a Genki Dama"* — e ela estava
   certa por um motivo que a tabela de estilo não conseguia resolver sozinha:
   **os dois golpes eram a MESMA FORMA.** Núcleo esférico aditivo dentro de uma
   casca de arame esférica, girando. Mudar o tamanho, o giro e a respiração de
   uma esfera dá outra esfera; a duzentos metros, que é onde este modo se joga,
   uma esfera roxa e uma esfera ciano são a mesma coisa em duas cores — e cor,
   sozinha, é a informação mais frágil que existe numa tela aditiva (ver
   "o miolo", abaixo).

   Forma é o que o olho lê primeiro, então a separação passou a ser de forma:

   • **A Genki Dama é uma LUA.** Núcleo esférico, e por cima dele a casca de
     arame — o icosaedro subdividido, em `wireframe`, tombando devagar em DOIS
     eixos. Ela não aponta para lugar nenhum: uma lua não tem frente. É a mesma
     esfera de energia reunida da referência, e continua sendo exclusiva dela.

   • **O Galick Gun é uma BALA.** Ele perdeu a casca de arame — que era a
     assinatura da outra — e ganhou três coisas que a Genki Dama nunca vai ter:

       1. um núcleo ALONGADO no eixo do voo (um elipsoide de 1,35 raios de
          comprimento por 0,78 de bojo, não uma bola perfeita);
       2. uma COROA DE CHOQUE — um cone aberto e facetado, ponta à frente e boca
          escancarada para trás, girando depressa em torno do próprio eixo de
          voo, como o estriamento de um projétil;
       3. um TRAÇO que fica no ar por onde ele passou — e é o traço que fecha o
          argumento. Ver a seção seguinte.

     Nada disso é possível numa lua, porque as três dependem de haver uma
     FRENTE: o grupo inteiro do Galick Gun é orientado pelo versor do voo a cada
     quadro (`alinhar`), e o da Genki Dama nunca é.

   ---------------------------------------------------- o traço que CURVA

   O Galick Gun persegue FORTE (110°/s por 1,6 s, ver
   `NAMEK.specials.galick.homing`) e a Genki Dama persegue de leve (40°/s, com
   teto de 75° na correção total). Essa assimetria é mecânica, já estava paga, e
   não aparecia em lugar nenhum na tela.

   Agora aparece: o Galick Gun arrasta atrás de si uma FITA construída sobre as
   posições que ele REALMENTE ocupou — dezoito amostras a cada 42 ms, três
   quartos de segundo de história, uns 66 m a 95 m/s. Quando ele contorna um
   alvo, a fita contorna junto e fica no ar desenhando a curva: **82,5° de
   arco** (a perseguição dobrou; eram 38,5°), que se afastam 12,3 m da linha
   reta contra os 5,5 m de antes. Ver `TRACO_PASSO` para por que é essa a medida
   que importa, e não o comprimento — e note que a fita ficou MUITO mais
   expressiva sem uma linha de desenho ter mudado: ela mostra o que o golpe faz,
   e o golpe passou a virar duas vezes mais rápido.

   É a única coisa deste arquivo que **não pode ser lida numa captura parada** e
   é justamente por isso que ela é a peça mais importante: em movimento, um
   gancho roxo de sessenta metros riscando o céu não se confunde com nada.

   A Genki Dama continua SEM traço mesmo tendo passado a curvar, e agora por um
   motivo de escala e não de trajetória: ela tem 22 m de diâmetro e voa a menos
   da metade da velocidade do Galick Gun, de modo que a fita nasceria mais
   estreita que a própria bola e ficaria escondida atrás dela. O caminho dela
   quem desenha é o rastro de fagulhas, que já existe. (`traco: 0` custa a malha
   inteira em `visible = false`.)

   A fita é uma CRUZ em corte — dois planos perpendiculares, não um só —, e isso
   não é enfeite: uma fita de plano único desaparece quando a câmera a olha de
   perfil, e "de perfil" é exatamente a posição em que fica quem está sendo
   perseguido. Com dois planos, sempre há um de frente para a lente.

   ----------------------------------------------------------------- o miolo

   As duas puxavam o núcleo para o BRANCO (`lerp(cor, 0,42)`, ou seja 58 % de
   branco), e branco aditivo não tem matiz: dois núcleos brancos com um halo de
   cor em volta leem como o mesmo objeto. Na Genki Dama isso é certo e continua
   igual — ela é energia EMPRESTADA de todo mundo, branco-azulada, e a
   referência não a mostra de outro jeito.

   No Galick Gun é o contrário: o roxo vai até o miolo (`miolo: 0,94`, quase
   sem branco) e ainda é ESCURECIDO em luminosidade antes de entrar
   (`claro: −0,14`). Escurecer parece contraintuitivo num material aditivo e é o
   passo que faz a coisa funcionar — o que apaga a matiz não é a falta de brilho,
   é o canal fraco saturando: 0xc07bff tem verde em 0,48, e duas camadas
   aditivas sobrepostas levam esse 0,48 a 0,96, que é branco. Baixando a
   luminosidade, o verde cai para ~0,20 e a mesma sobreposição chega a 0,40 — o
   miolo satura em MAGENTA, não em branco. O roxo sobrevive ao próprio brilho.

   ------------------------------------------------------- e o rastro que SEGUE

   O pedido para o Galick Gun foi literal: "uma grande bola com partículas que a
   seguem". A palavra que importa é *seguem*, e ela é a diferença entre duas
   coisas que parecem a mesma:

   • partículas que SAEM da bola (velocidade para trás) formam um rabo parado no
     ar, e o que se lê é fumaça — uma coisa que já passou;
   • partículas que a SEGUEM nascem atrás e viajam NA DIREÇÃO DO VOO, um pouco
     mais devagar que ela. Elas correm atrás da bola e vão ficando para trás
     sozinhas, e o que se lê é energia sendo arrastada por algo rápido demais.

   **ATENÇÃO AO QUE A PONTE DE PARTÍCULAS DESTE MODO REALMENTE ENTREGA.** O
   barramento `EventType.PARTICLES` tem o contrato cheio (`direction`, `spread`,
   `grow`, `drag`, `gravity`, `additive`) e `systems/particles.js` o honra
   inteiro — mas quem escuta em Namekusei é o `bindParticles` de
   `namek/game.js`, e ele traduz o pedido para `NamekFx.fagulhas`, que aceita
   **só posição, tamanho, cor, contagem e velocidade**. Direção e espalhamento
   são descartados no caminho: toda emissão vira um sopro radial no ponto pedido.

   Isso não é um defeito a consertar aqui (o arquivo é de outra pessoa), é uma
   restrição a respeitar — e ela decide o desenho do rastro do Galick Gun: se a
   única coisa que sobrevive à ponte é ONDE a fagulha nasce, então a forma tem de
   estar nas POSIÇÕES. Daí a espiral: dois braços opostos girando 1,15 rad por
   sopro em torno do eixo do voo, um pouco atrás da bala. A bala avança entre um
   sopro e o outro, e o que fica no ar é uma HÉLICE DUPLA — que nenhuma emissão
   radial produz por acidente e que a Genki Dama, cujo sopro nasce num ponto só
   atrás dela, não tem como imitar.

   Os campos do contrato cheio continuam sendo mandados, e devem continuar: o
   dia em que a ponte deste modo passar a honrá-los, o rastro melhora sozinho em
   vez de precisar ser reescrito.

   ---------------------------------------------------------------- o orçamento

   **Três malhas por esfera no Galick Gun** (núcleo, coroa e fita) contra duas na
   Genki Dama (núcleo e casca) — a fita dela fica em `visible = false`, e o
   renderer descarta o que está invisível antes de montar a lista de desenho.

   Pior caso aritmético do pool: 5 × 3 = **15 chamadas de desenho**, contra 10
   antes. Ele exige as cinco vagas ocupadas por Galick Guns simultâneos. O §4 do
   cabeçalho de `powers/index.js` tem a tabela da cena inteira, cujo teto é 90.

   A fita custa, por esfera: 216 floats de posição reescritos e reenviados por
   quadro (864 bytes), 72 vértices, 68 triângulos. Os índices e a rampa de cor
   são estáticos, escritos uma vez no construtor. Zero alocação em voo — o
   `Float32Array` dos nós é do objeto e o deslocamento é uma cópia no lugar.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";
import { gameEvents, EventType } from "../../core/events.js";
import {
  atingivel,
  distancia2AoAlvo,
  pegarVaga,
  alvoPorId,
  passoDeGiro,
  perseguirPonto,
  PEITO,
  TETO_DO_RELEVO,
} from "./blast.js";

/* Cinco vagas para os dois golpes somados.
 *
 * Eram três, quando só a Genki Dama morava aqui: ela custa a barra cheia E
 * 3,6 s parado, e três ao mesmo tempo numa sala de quinze é um acontecimento
 * que ninguém viu. O Galick Gun mudou a conta — 0,9 s de pose é barato o
 * bastante para três pessoas soltarem o dele na mesma troca de tiros —, e cinco
 * é o número que cobre isso sem virar orçamento de feixe. Ver o §4 do cabeçalho
 * de `powers/index.js`, que tem a tabela de chamadas de desenho. */
const MAX_ESFERAS = 5;

/** s — quanto dura o clarão da detonação depois do impacto. */
const ESTOURO = 0.62;
/** Quantas vezes a casca abre no estouro. */
const ESTOURO_ESCALA = 2.6;

/* ------------------------------------------------------------------ a fita --

   Os dois números do traço, e o critério que os escolheu.

   **A duração da história é escolhida pela FLECHA DA CURVA, não pelo
   comprimento.** É a medida que decide se a fita mostra ou não aquilo para o
   que ela existe, e o critério é implacável: a flecha — o quanto o traço se
   afasta da corda entre as duas pontas — precisa ser maior que a MEIA-LARGURA
   da própria fita. Abaixo disso a curva cabe dentro da espessura e o olho lê
   uma reta grossa, não um arco.

   O Galick Gun fecha uma curva de raio `v / ω` = 95 / 0,96 rad/s ≈ **99 m**
   (a mesma conta do Kienzan, em `NAMEK.specials.disk`). Medido sobre uma
   perseguição simulada de 3 s, com a meia-largura de 2,94 m que `traco: 0,55`
   dá aos 6,5 m de raio:

       passo   história   comprimento   arco     flecha
       32 ms    0,576 s      52 m       30,2°     3,43 m   ← 1,2× a largura: NÃO
       42 ms    0,756 s      66 m       38,5°     5,52 m   ← 1,9×: sim
       48 ms    0,864 s      76 m       44,0°     7,19 m   ← 2,4×, e 76 m é teia

   Daí os 42 ms. Os 32 ms que pareciam a escolha óbvia — meio segundo de
   história, um número redondo — produziam uma curva de 3,4 m dentro de uma
   fita de 5,9 m de espessura: o esforço inteiro do traço, invisível por dois
   milímetros e meio de margem.

   Dezoito nós é a resolução, e ela sobra: 38,5° repartidos em dezessete
   segmentos são 2,3° por segmento, cujo erro de corda contra o arco real é de
   3 cm em 99 m de raio — abaixo de um pixel a qualquer distância de jogo. */
const TRACO_NOS = 18;
/** s entre duas amostras da posição. 18 × 42 ms = 0,756 s ≈ 66 m a 95 m/s. */
const TRACO_PASSO = 0.042;

/* O PERFIL DE LARGURA da fita, em frações da largura pedida pelo estilo.
 *
 * Não é um afinamento simples da cabeça para a cauda, e a diferença está no
 * primeiro nó: a fita nasce ESTREITA (30 %), abre no terceiro nó e só então
 * afina até zero. O motivo é a bala — com a fita larga já no nó zero, ela sai
 * de dentro do elipsoide e os dois viram uma mancha só; com o pescoço, a bala
 * fica destacada e a fita claramente SAI dela.
 *
 * Zero no último nó, e isso não é decoração: é o que faz a cauda terminar em
 * ponta em vez de ser cortada em bisel, que é a leitura de fita rasgada.
 *
 * Calculado uma vez, na carga do módulo — é o mesmo perfil para toda esfera. */
const TRACO_PERFIL = new Float32Array(TRACO_NOS);
/* A rampa de COR, no mesmo laço. Ela some mais depressa que a largura (potência
   1,5) porque as duas se multiplicam na tela: uma fita que fica estreita E
   escura ao mesmo tempo dissolve, uma que só estreita termina como um fio
   aceso. Com mistura aditiva, multiplicar a cor por zero É a transparência —
   não há alfa por vértice envolvido, e não precisa haver. */
const TRACO_RAMPA = new Float32Array(TRACO_NOS);
for (let i = 0; i < TRACO_NOS; i++) {
  const t = i / (TRACO_NOS - 1);
  const abre = 0.3 + t * 5;
  TRACO_PERFIL[i] = (1 - t) * (abre < 1 ? abre : 1);
  TRACO_RAMPA[i] = Math.pow(1 - t, 1.5);
}

/**
 * O que separa uma esfera da outra. **Só visual e ritmo** — dano, raio,
 * velocidade, alcance e potência continuam todos em `NAMEK.specials`, que é
 * onde a sala também os lê. O que está aqui é direção de arte, e por isso mora
 * no cliente: o servidor não precisa saber com que frequência sai uma fagulha.
 */
const ESTILO = {
  genki: {
    /** Fração do raio que ela nasce ACIMA da mão. Ver `acender`. */
    subir: 0.55,
    /* UMA LUA NÃO TEM FRENTE. Sem alinhamento, o grupo fica com a rotação
       identidade e a esfera é a mesma vista de qualquer lado — que é
       exatamente o que se quer de uma coisa que não aponta para lugar nenhum. */
    alinhar: false,
    /** rad/s — a rotação da malha, em DOIS eixos. Devagar: é o que dá o peso. */
    giroX: 0.32,
    giroY: 0.51,
    /** A casca dela é de ARAME — o icosaedro em `wireframe`. É a assinatura. */
    arame: true,
    cascaAlfa: 0.34,
    /* Bojo e comprimento do núcleo, em raios. Iguais: ela é redonda. */
    nucleoR: 0.88,
    nucleoL: 0.88,
    nucleoAlfa: 0.8,
    /* O MIOLO. `miolo` é quanto da cor entra no branco; `claro` desloca a
       luminosidade antes disso. 0,42 e 0 são os números com que ela sempre foi
       desenhada — branco-azulada, energia emprestada. Ver "o miolo" no
       cabeçalho para o que os dois fazem e por que o outro golpe usa o oposto. */
    miolo: 0.42,
    claro: 0,
    /** Hz da respiração, e amplitude dela. */
    respiro: 3.1,
    amplitude: 0.03,
    /** s entre sopros do rastro, e quantas partículas por sopro. */
    rastro: 0.26,
    rastroN: 4,
    /** Fração do raio a que o rastro nasce ATRÁS do centro. */
    atraso: 0.8,
    /** Fração da velocidade da bola com que o rastro a persegue. */
    perseguicao: 0.35,
    /* SEM ESPIRAL e SEM TRAÇO, e as duas ausências são a mesma decisão: o
       TAMANHO dela. Uma hélice de fagulhas em torno de uma bola de 22 m de
       diâmetro cabe dentro da bola, e uma fita mais estreita que ela some atrás
       dela. As duas peças existem para mostrar CURVA — e ela hoje curva, de
       leve (ver `perseguir`) —, mas numa lua elas mostrariam isso para
       ninguém, custando uma malha e o triplo de emissões. */
    espiral: 0,
    giroEspiral: 0,
    traco: 0,
    /* O ESTOURO DELA É O MAIOR DO JOGO, e é para ser — o pedido é literal: "a
     * Genki Dama deve ser a maior explosão de todas quando acertar um player ou
     * o cenário, e o maior impacto visual de todos".
     *
     * Três multiplicadores sobre o estouro comum, e três é o número certo
     * porque "maior" tem três significados diferentes na tela e o olho lê os
     * três: mais MATÉRIA voando (`fagulhas`), matéria mais GRANDE (`floco`) e a
     * coisa durando mais (`duracao`). Só um deles resolvido dá um estouro que
     * parece o mesmo com o volume no talo.
     *
     * E a casca abre quase o dobro (`abertura`): a esfera de 11 m vira uma
     * cúpula de 60 m de diâmetro antes de apagar, que é a única coisa capaz de
     * dizer "isto é a Genki Dama" para quem está a trezentos metros e não viu a
     * carga. */
    fagulhas: 3.4,
    floco: 1.7,
    duracao: 2.3,
    abertura: 5.4,
    /* A cúpula abre REDONDA. Ver `passoDoEstouro`. */
    estouroR: 1,
    estouroL: 1,
    /** Quanto a câmera de quem soltou treme, e por quanto tempo. */
    tremor: 1,
    tremorT: 1.1,
  },
  galick: {
    /* Ela nasce quase no punho: com 6,5 m de raio contra os 11 da Genki Dama, o
       corpo do lutador não some atrás dela, e o gesto de lançar com as duas mãos
       à frente do peito — que é a pose do golpe — continua visível. */
    subir: 0.12,
    /* ELE APONTA. O grupo inteiro é girado para o versor do voo a cada quadro,
       e é isso que dá sentido às três peças de baixo: o alongamento do núcleo,
       o eixo da coroa e o eixo da espiral são todos O MESMO eixo, o do voo.
       Sem alinhamento nada disso existe — sobra uma bola. */
    alinhar: true,
    /* UM EIXO SÓ, e depressa. A Genki Dama tomba em dois eixos a 0,3–0,5 rad/s
       (coisa pesada oscilando); a coroa daqui roda a 7 rad/s em torno da própria
       direção de voo, que é mais de uma volta por segundo. Ela tem SEIS faces
       (ver `coroaDeChoque`), então a volta é visível como um estriamento
       piscando — o giro de um projétil, não o tombo de uma lua. `giroX: 0` é
       deliberado: tombar a coroa a desalinharia do voo, que é a única coisa que
       ela tem para dizer. */
    giroX: 0,
    giroY: 7,
    /* SEM ARAME. A casca de arame é a assinatura da Genki Dama e ela ficou lá
       inteira; aqui a mesma malha é a COROA DE CHOQUE, sólida e translúcida. */
    arame: false,
    /* Baixa de propósito: 0,22 mantém o cone roxo. Acima de ~0,3 as faces
       sobrepostas do cone somam entre si e a coroa embranquece — o defeito que
       a seção "o miolo" do cabeçalho descreve, na peça que menos pode pagá-lo,
       porque é ela que desenha a silhueta. */
    cascaAlfa: 0.22,
    /* A BALA. 0,78 de bojo por 1,35 de comprimento — um elipsoide de quase o
       dobro de comprido que de largo, no eixo do voo.
       Os dois números cercam o raio de morte (6,5 m) por baixo e por cima em vez
       de o ignorarem: 5,1 m de largura contra 17,6 m de ponta a ponta dão uma
       média honesta, e a mentira que sobra é a que todo projétil alongado conta.
       Mais fino que isto vira agulha e some de lado; mais gordo volta a ser bola. */
    nucleoR: 0.78,
    nucleoL: 1.35,
    /* Mais opaco que a lua (0,9 contra 0,8) porque a cor é MAIS ESCURA: o roxo
       fundo de `claro: −0,14` perde brilho, e o que se quer é trocar branco por
       matiz, não por escuridão. */
    nucleoAlfa: 0.9,
    /* O ROXO VAI ATÉ O MIOLO. Ver "o miolo", no cabeçalho — 0,94 é quase nada de
       branco, e a queda de luminosidade é o que impede o aditivo de o devolver. */
    miolo: 0.94,
    claro: -0.14,
    respiro: 7.4,
    amplitude: 0.045,
    /* O RASTRO ESPIRAL. Ver a última seção do cabeçalho para por que a forma
       está nas POSIÇÕES e não nas velocidades.
       A cadência AFROUXOU — 0,06 s contra os 0,042 de antes, e três partículas
       por braço contra oito num ponto só: são 100 partículas/s contra 190. O
       traço passou a carregar a leitura de velocidade que antes só a densidade
       do rastro dava, e densidade que não é mais necessária é pool de brilho
       (teto 300, em `fx/index.js`) que fica livre para o impacto. Dois braços a
       três partículas dão seis por sopro, ~42 vivas por esfera; três Galick Guns
       no ar cabem em 126 e continua sobrando a folga que o §RESERVA do `fx`
       protege. */
    rastro: 0.06,
    rastroN: 3,
    atraso: 1.15,
    /* BAIXA, e é a inversão que a espiral exige. A fagulha nasce no ponto certo
       da hélice e precisa FICAR perto dele: a 0,62 da velocidade da bala eram
       59 m/s de arremesso radial (a ponte descarta a direção — cabeçalho), e em
       quatro décimos de segundo a hélice virava uma nuvem redonda. A 0,12 são
       11 m/s, uns poucos metros de deriva, e o desenho sobrevive. */
    perseguicao: 0.12,
    /** Raio da hélice, em raios de bala, e quanto ela gira A CADA sopro. */
    espiral: 0.62,
    /* 1,15 rad ≈ 66°. Escolhido para NÃO dividir π: com dois braços opostos, um
       passo que dividisse π faria o braço A cair exatamente onde o braço B
       esteve e a hélice viraria um anel repetido. π/1,15 ≈ 2,73 — não fecha, e
       o padrão avança em vez de bater no mesmo lugar. */
    giroEspiral: 1.15,
    /** Largura da fita, em raios. Ver `TRACO_PERFIL` e "o traço que CURVA". */
    traco: 0.55,
    /* O estouro dele é o comum — grande, mas sem os multiplicadores da Genki
       Dama. Se os dois estourassem igual, a aposta de 3,6 s parado não teria
       recompensa nenhuma na tela, e é a tela que o jogador olha. */
    fagulhas: 1,
    floco: 1,
    duracao: 1,
    abertura: ESTOURO_ESCALA,
    /* A COROA ACHATA NO IMPACTO. Enquanto a cúpula da Genki Dama abre redonda,
       o cone daqui é esmagado no eixo do voo (0,35) e alargado no plano
       perpendicular (1,15): vira um disco de choque batendo de frente, que é o
       que uma bala faz ao parar. Deixá-lo abrir redondo daria uma espeto roxo de
       trinta metros à frente do impacto — a leitura de feixe, justamente a que
       este golpe passou a existir para não ter. */
    estouroR: 1.15,
    estouroL: 0.35,
    tremor: 0.55,
    tremorT: 0.4,
  },
};

/** O estilo de um `kind`, com a Genki Dama como padrão para um golpe novo. */
const estiloDe = (kind) => ESTILO[kind] ?? ESTILO.genki;

/* ------------------------------------------------------------- rascunhos --- */
const _cor = new THREE.Color();
const _miolo = new THREE.Color();
const _dirv = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
/** O ponto de nascimento de cada fagulha da coroa dourada. Um literal por
 *  partícula seriam cem objetos por segundo por Genki Dama — ver `orbitar`. */
const _orbe = { x: 0, y: 0, z: 0 };
const MAX_VITIMAS = NAMEK.net.maxPlayers + 1;

/* ============================================================================
   Uma esfera
   ========================================================================== */

class Esfera {
  constructor(scene, geos) {
    this.scene = scene;
    /* As geometrias do POOL, guardadas porque a casca troca de malha a cada
       disparo (arame na Genki Dama, cone no Galick Gun — ver `acender`). Elas
       são compartilhadas pelas cinco vagas e soltas pelo pool, nunca por aqui. */
    this.geos = geos;
    /* `viva`, `t` e `local` existem ANTES do primeiro disparo porque
       `pegarVaga` os lê para escolher quem reciclar. Um slot nunca usado sai
       pelo `!viva`, mas depender dessa ordem seria depender de uma ordem. */
    this.viva = false;
    this.t = 0;
    this.local = false;
    this.group = new THREE.Group();
    this.group.visible = false;

    this.nucleo = new THREE.Mesh(
      geos.bola,
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.8,
        fog: false,
      }),
    );
    this.nucleo.renderOrder = 5;
    this.nucleo.frustumCulled = false;

    /* A CASCA É A PEÇA QUE TROCA DE GEOMETRIA.
     *
     * Arame de icosaedro na Genki Dama, cone de choque no Galick Gun — e a
     * troca acontece em `acender`, atribuindo `geos.malha` ou `geos.coroa` ao
     * mesmo `Mesh`. Duas malhas separadas (uma escondida de cada vez) dariam o
     * mesmo resultado na tela e um objeto a mais por vaga, sem comprar nada:
     * trocar a geometria de um `Mesh` não recompila material nenhum, porque o
     * programa é decidido pelo MATERIAL, e o material continua o mesmo — só o
     * `wireframe` e a cor mudam, e nenhum dos dois é parâmetro de compilação.
     *
     * `side: DoubleSide` existe pelo cone: ele é aberto nas duas pontas e a
     * lente entra e sai dele o tempo todo. Sem isso, o Galick Gun passando pela
     * câmera perderia metade da coroa no quadro mais chamativo do voo. Na malha
     * de arame o lado não faz diferença nenhuma. */
    this.casca = new THREE.Mesh(
      geos.malha,
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.34,
        wireframe: true,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    this.casca.renderOrder = 6;
    this.casca.frustumCulled = false;

    this.group.add(this.nucleo);
    this.group.add(this.casca);
    scene.add(this.group);

    /* ------------------------------------------------------------- a fita --
     *
     * Ela NÃO entra no grupo, e essa é a única sutileza do traço: os vértices
     * dela são posições de MUNDO — o caminho por onde a esfera passou —, e um
     * pai que se move levaria a história junto, arrastando o rastro colado na
     * bola em vez de o deixar para trás. Malha solta na cena, transformação
     * identidade, e o buffer diz tudo.
     *
     * `vertexColors` MULTIPLICA a cor do material pela do vértice, então a rampa
     * gravada aqui é cinza (ver `TRACO_RAMPA`) e a cor do golpe entra em
     * `acender` por `material.color`. Uma rampa por golpe seria a mesma rampa
     * escrita duas vezes.
     *
     * `frustumCulled = false` porque a caixa envolvente seria a de um objeto
     * parado na origem — o renderer descartaria a fita inteira sempre que a
     * origem do mundo estivesse fora da tela, que é quase o tempo todo. */
    this.nos = new Float32Array(TRACO_NOS * 3);
    this._tTraco = 0;
    this.traco = new THREE.Mesh(
      fitaDoTraco(),
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.85,
        vertexColors: true,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    this.traco.renderOrder = 4;
    this.traco.frustumCulled = false;
    this.traco.visible = false;
    scene.add(this.traco);

    this.vitima = new Array(MAX_VITIMAS).fill(null);
    this.estilo = ESTILO.genki;
    /* A direção é um OBJETO porque ela muda: o Galick Gun persegue, e
       `perseguirPonto` gira um `{x,y,z}` no lugar. Um por esfera, criado uma
       vez — em voo o pool não aloca nada. */
    this.dir = { x: 0, y: 0, z: 1 };
    /* A base perpendicular ao voo, reusada pela espiral e pela fita. Dois
       objetos por esfera, criados uma vez, escritos no lugar. */
    this.b1 = { x: 1, y: 0, z: 0 };
    this.b2 = { x: 0, y: 1, z: 0 };
    this._fase = 0;
  }

  /* ---------------------------------------------------------------- disparo */

  acender(field, { owner, kind, origem, dir, local, target = null, info = null, ssj = false }) {
    /* `info` é a definição do golpe COMO ELE É VISTA — dourada em Super
       Saiyajin. Ver `PowerSystem.spawnSpecial`, que a escolhe, e o cabeçalho de
       `character/ssj.js`, que explica por que a cor virou uma troca de objeto em
       vez de doze `if`. */
    const S = info ?? NAMEK.specials[kind];
    const E = estiloDe(kind);
    this.field = field;
    this.owner = owner;
    this.kind = kind;
    this.info = S;
    this.estilo = E;
    this.local = !!local;
    this.viva = true;
    this.t = 0;
    this.tEstouro = 0;
    this.estourando = false;
    this.raio = 0.001;
    this._fag = 0;
    this._fase = 0;
    /* Travado no disparo e recebido pela rede — a mesma regra da bola de ki
       (§6.1). Vale para as duas: desde que "todos os poderes devem perseguir",
       a Genki Dama também tem `homing` — a mais mansa do jogo. Ver `perseguir`. */
    this.alvo = target;
    /* ---------------------------------------- A COROA DA GENKI DAMA DOURADA
     *
     * *"Com o player Super Saiyajin, a Genki Dama… tem partículas em volta dela
     * que ficam rodeando ela, que dão a impressão de que ela é ainda mais
     * poderosa."*
     *
     * Só a Genki Dama, e só transformado. A tabela de estilo dela zera `espiral`
     * de propósito — *"uma hélice de fagulhas em torno de uma bola de 32 m de
     * diâmetro cabe DENTRO da bola"* —, e esta coroa é a resposta a esse mesmo
     * problema pelo lado de fora: ela nasce a 1,22 raios do centro, ou seja
     * FORA da esfera, e é por isso que ela se lê como uma coroa em vez de sumir
     * dentro do brilho. Ver `NAMEK.ssj.genkiOrbe`.
     *
     * O Galick Gun não recebe nada: ele já tem a hélice dupla dele, e somar uma
     * segunda órbita a um golpe que já gira faria ruído em vez de leitura. */
    this.coroa = ssj === true && kind === "genki";
    this._tCoroa = 0;
    this._faseCoroa = 0;
    /* Radianos já gastos do teto total (`arcMax`). Zera aqui, e não no
       construtor, porque o mesmo slot do pool é reciclado a cada disparo. */
    this.arco = 0;

    const inv = 1 / (Math.hypot(dir.x, dir.y, dir.z) || 1);
    this.dir.x = dir.x * inv;
    this.dir.y = dir.y * inv;
    this.dir.z = dir.z * inv;

    /* ELA NASCE ACIMA DA MÃO. Uma esfera de 11 m centrada no punho engole o
       lutador inteiro e a pose de erguer os braços — que é a pose do golpe —
       deixa de ser vista. `subir` é a fração do raio que resolve isso, e ela é
       maior na Genki Dama porque a bola dela é maior: o que se quer é o mesmo
       resultado nos dois casos, o corpo aparecendo por baixo da esfera. */
    this.x = origem.x;
    this.y = origem.y + S.hitRadius * this.estilo.subir;
    this.z = origem.z;

    this.vida = Math.min(S.sustain, S.range / S.speed);

    /* A COR, e as duas leituras dela. `_miolo` é a cor do golpe já deslocada em
       luminosidade — é ela que entra no núcleo, na coroa e na fita, para que as
       três peças do Galick Gun sejam o MESMO roxo. A casca da Genki Dama recebe
       `_cor` cru porque `claro: 0` faz de `_miolo` uma cópia dela. */
    _cor.set(S.cor);
    _miolo.copy(_cor).offsetHSL(0, 0, E.claro);
    this.nucleo.material.color.set(0xffffff).lerp(_miolo, E.miolo);
    this.nucleo.material.opacity = E.nucleoAlfa;

    /* A troca de casca. Ver o comentário do construtor: geometria, arame e cor
       de uma vez, no disparo, e nunca por quadro. */
    this.casca.geometry = E.arame ? this.geos.malha : this.geos.coroa;
    this.casca.material.wireframe = E.arame;
    this.casca.material.color.copy(_miolo);
    this.casca.material.opacity = E.cascaAlfa;
    this.casca.rotation.set(0, 0, 0);

    /* A FITA COMEÇA COLAPSADA no ponto de partida — os dezoito nós no mesmo
       lugar. Sem isso ela nasceria esticada entre a mão e onde quer que a vaga
       reciclada tivesse estado antes, riscando a arena de ponta a ponta no
       primeiro quadro. Colapsada, todos os triângulos são degenerados e ela é
       invisível até haver movimento de verdade para descrever. */
    this.traco.material.color.copy(_miolo);
    this.traco.visible = false;
    this._tTraco = 0;
    for (let i = 0; i < TRACO_NOS; i++) {
      const i3 = i * 3;
      this.nos[i3] = this.x;
      this.nos[i3 + 1] = this.y;
      this.nos[i3 + 2] = this.z;
    }

    this.group.visible = true;
    /* Uma lua não aponta; uma bala sim. Ver `alinhar` na tabela de estilo. */
    if (!E.alinhar) this.group.quaternion.identity();
    return this;
  }

  /* ------------------------------------------------------------------ passo */

  update(dt, alvos, localId, relato) {
    if (!this.viva) return true;
    const S = this.info;
    this.t += dt;

    if (this.estourando) return this.passoDoEstouro(dt, relato);

    /* A CARGA. A esfera cresce no lugar durante o `windup`.
     *
     * `u^0.72` e não `u`: ela salta de tamanho no primeiro terço e depois vai
     * enchendo devagar, que é como uma coisa grande se forma. Crescimento
     * linear daria uma bola inflando em velocidade constante — leia-se balão. */
    if (this.t < S.windup) {
      const u = this.t / S.windup;
      this.raio = S.hitRadius * Math.pow(u, 0.72);
      this.recolher(dt, u);
      this.orbitar(dt);
      this.desenhar(dt);
      if (this.local) relato.luz(this.x, this.y, this.z, S.cor, 0.45 + 0.4 * u);
      return false;
    }

    this.raio = S.hitRadius;
    const tv = this.t - S.windup;

    this.perseguir(dt, alvos, tv);

    /* O VOO. Passo único, sem subdivisão — e aqui isso é seguro por construção
       nos dois golpes: o mais rápido deles anda 3,2 m num quadro de 30 Hz
       contra um raio de morte de 6,5 m. Nem a 5 fps ela atravessaria alguém. */
    this.x += this.dir.x * S.speed * dt;
    this.y += this.dir.y * S.speed * dt;
    this.z += this.dir.z * S.speed * dt;

    const chao =
      this.y < TETO_DO_RELEVO + S.hitRadius
        ? this.field.heightAt(this.x, this.z)
        : -1e9;
    const noChao = this.y - S.hitRadius <= chao;
    /* A altura do relevo LOGO ABAIXO, guardada mesmo quando ela não para a bola.
       É o que permite a detonação no ar ainda arrancar chão — ver `detonar`. */
    this.chaoAbaixo = chao;

    let encostou = noChao;
    if (!encostou) {
      const raio2 = S.hitRadius * S.hitRadius;
      for (let k = 0; k < alvos.length; k++) {
        const a = alvos[k];
        if (!atingivel(a, this.owner)) continue;
        if (distancia2AoAlvo(a, this.x, this.y, this.z) <= raio2) {
          encostou = true;
          break;
        }
      }
    }
    /* Fim da linha sem encostar em nada: ela detona no ar mesmo. Uma esfera que
       simplesmente some depois de toda a pose de carga é a maior anticlímax que
       o modo poderia ter. */
    if (!encostou && tv >= this.vida) encostou = true;

    if (encostou) {
      /* Um último passo da fita ANTES de detonar: sem ele a cabeça do traço
         ficaria congelada no penúltimo quadro, uns três metros atrás da
         explosão, e o rastro apareceria desconectado do próprio impacto. */
      this.atualizarTraco(dt);
      this.detonar(alvos, localId, relato, noChao ? chao : null);
      return false;
    }

    this.rastro(dt);
    this.orbitar(dt);
    this.desenhar(dt);
    this.atualizarTraco(dt);
    if (this.local) relato.luz(this.x, this.y, this.z, S.cor, 1);
    return false;
  }

  /**
   * A COROA DE FAGULHAS da Genki Dama dourada. Ver `coroa`, em `acender`.
   *
   * Um anel de partículas girando em torno da esfera, e ele é desenhado do jeito
   * mais barato que este modo tem: o barramento de partículas que o rastro já
   * usa (`EventType.PARTICLES`), sem uma malha nova, sem uma chamada de desenho
   * nova e sem alocar nada por quadro além do literal que a ponte exige.
   *
   * ------------------------------------------------------------------ a forma
   *
   * As fagulhas nascem espalhadas num anel de `orbe.raio` raios, **no plano
   * horizontal**, e não em torno do eixo do voo. A escolha é a mesma que faz a
   * Genki Dama não ter alinhamento (`ESTILO.genki.alinhar: false`): uma lua não
   * aponta para lugar nenhum, e um anel amarrado ao rumo do tiro giraria junto
   * com a trajetória — o que leria como um projétil, que é exatamente o que ela
   * não é.
   *
   * Elas nascem quase PARADAS (`speed` baixo) e com arrasto alto: o que se quer
   * é que fiquem onde nasceram enquanto a bola avança, deixando o anel para
   * trás por um instante e desenhando o caminho dela. Uma velocidade tangencial
   * de verdade exigiria uma direção por partícula, e a ponte deste modo só honra
   * POSIÇÃO — o mesmo limite que o comentário do `rastro` já documenta.
   *
   * A FASE avança a cada sopro, então dois sopros seguidos não caem no mesmo
   * lugar: 0,9 rad é primo o bastante de 2π/n para o anel parecer contínuo em
   * vez de piscar nas mesmas seis marcas.
   */
  orbitar(dt) {
    if (!this.coroa) return;
    const O = NAMEK.ssj.genkiOrbe;
    this._tCoroa -= dt;
    if (this._tCoroa > 0) return;
    this._tCoroa = O.intervalo;
    this._faseCoroa += O.giro;

    const raio = this.raio * O.raio;
    const n = Math.max(1, O.n | 0);
    for (let i = 0; i < n; i++) {
      /* O anel é INCLINADO, e a inclinação vem do índice: metade das fagulhas
         num plano e metade noutro, cruzados. Um anel plano só se lê de lado; dois
         cruzados dão a impressão de uma casca girando, que é o "rodeando ela" do
         pedido. */
      const a = this._faseCoroa + (i / n) * Math.PI * 2;
      const inclina = (i & 1) === 0 ? 0.22 : -0.22;
      _orbe.x = this.x + Math.cos(a) * raio;
      _orbe.y = this.y + Math.sin(a) * raio * inclina;
      _orbe.z = this.z + Math.sin(a) * raio;
      gameEvents.emit(EventType.PARTICLES, {
        position: _orbe,
        count: 1,
        color: NAMEK.ssj.cor,
        speed: 2.5,
        spread: 1,
        size: this.raio * O.tamanho,
        grow: -0.4,
        life: O.vida,
        gravity: 0,
        drag: 2.2,
        alpha: 1,
        additive: true,
      });
    }
  }

  /**
   * A esfera SEGUE o alvo — e dá para escapar dela.
   *
   * AS DUAS PERSEGUEM, e é uma mudança recente: "todos os poderes devem
   * perseguir o player, alguns perseguem mais, outros menos". A Genki Dama era
   * a exceção declarada deste arquivo, e a justificativa de então continua
   * valendo como MEDIDA — ela é uma parede de 16 m viajando devagar, e uma
   * perseguição de verdade nela seria um golpe de 100 de dano do qual não se
   * escapa. Por isso ela persegue como a mais mansa de todas: 40°/s contra os
   * 110 do Galick Gun.
   *
   * A conta que faz "dá para escapar" ser verdade é a mesma do Kienzan, e ela
   * não é o raio da curva — é a comparação de velocidades ANGULARES: a `d`
   * metros, quem foge de lado a `v` gira `v/d` rad/s em torno do projétil, e
   * escapa se isso passar de `ω`. Com o arranque a 64 m/s o corte fica em
   * **33 m** para o Galick Gun e em **92 m** para a Genki Dama — a maior
   * distância de fuga do jogo, que é o que separa "ele te alcança" de "ela só
   * te acompanha". Recuar em linha reta nunca funciona nos dois casos: recuar
   * mantém você no eixo.
   *
   * (Os dois cortes eram 66 m e 183 m; a perseguição do repertório inteiro
   * dobrou. O que não mudou foi a ORDEM entre eles, e ela é a informação: a
   * Genki Dama continua sendo quase três vezes mais fácil de largar.)
   *
   * O TETO TOTAL (`arcMax`) é a trava que a Genki Dama trouxe junto. Sem ele,
   * 40°/s por 4 s dariam 160° de correção — a bola daria meia volta — e o
   * prazo, que é a única trava que o Galick Gun tem, não sabe dizer isso. Lá o
   * prazo teve de ENCOLHER para fazer o papel do teto (ver
   * `NAMEK.specials.galick.homing`); aqui, quem declara
   * `arcMax` acumula o giro aqui e para quando o gasta. Ver
   * `NAMEK.specials.kamehameha.homing`, que tem o argumento inteiro.
   *
   * E é ESTA função que a fita desenha. O traço do §"o traço que CURVA" não é
   * um enfeite pendurado no golpe: ele é o registro gráfico de cada correção
   * feita aqui, e é por isso que a diferença entre os dois golpes só termina de
   * aparecer quando há alguém fugindo.
   */
  perseguir(dt, alvos, tv) {
    const H = this.info.homing;
    if (!H || this.alvo === null || tv > H.duration) return;
    const a = alvoPorId(alvos, this.alvo);
    if (!a || a.vivo === false) {
      this.alvo = null;
      return;
    }
    this.arco += perseguirPonto(
      this.dir,
      a.x,
      a.y + a.altura * PEITO,
      a.z,
      this.x,
      this.y,
      this.z,
      Math.cos((H.cone * Math.PI) / 180),
      passoDeGiro(H, dt, this.arco),
    );
  }

  /* --------------------------------------------------------------- detonação */

  /**
   * O impacto.
   *
   * Tudo o que estiver a menos de `hitRadius` do centro leva `damage` de uma
   * vez — pelo canal do especial, com `dt: 0`: as duas esferas têm `damage` e
   * não `dps` em `NAMEK.specials`, e é a sala que sabe a diferença (ver o
   * cabeçalho de `powers/index.js`).
   *
   * A cratera só é reportada se ela encostou no CHÃO. Uma detonação a duzentos
   * metros de altura que abrisse um buraco no terreno debaixo dela seria um
   * buraco que ninguém viu abrir — e, pior, gastaria uma das 96 vagas que
   * `NAMEK.destruction.craterLimit` guarda para a partida inteira.
   */
  detonar(alvos, localId, relato, alturaDoChao) {
    const S = this.info;
    this.estourando = true;
    this.tEstouro = 0;

    if (this.owner === localId) {
      const raio2 = S.hitRadius * S.hitRadius;
      for (let k = 0; k < alvos.length; k++) {
        const a = alvos[k];
        if (!atingivel(a, this.owner)) continue;
        if (distancia2AoAlvo(a, this.x, this.y, this.z) > raio2) continue;
        const e = relato.queima();
        e.owner = this.owner;
        e.victim = a.id;
        e.kind = this.kind;
        e.dt = 0;
      }
      /* A CRATERA, e ela NÃO exige mais que a bola tenha encostado no chão.
       *
       * O critério era `alturaDoChao !== null`, ou seja: só crateriza quem para
       * NO relevo. Na prática essas esferas quase nunca param no relevo — elas
       * perseguem um lutador e detonam em cima dele, no ar. O resultado é o que
       * foi relatado: *"eu testei aqui o Galek-Gun e a Jinkidama e o Kinzan. Me
       * pareceu que não foram criadas crateras para esses poderes."* Não era
       * bug de cratera: era a explosão nunca tocando o chão.
       *
       * O critério novo é FÍSICO em vez de binário: uma esfera de 11 m de raio
       * detonando a 15 m do solo arranca chão, e uma detonando a 200 m não. A
       * margem é `hitRadius · 2` — o bastante para a explosão de uma Genki Dama
       * (11 m) morder o terreno de até 22 m abaixo dela, e curto o bastante para
       * uma briga em altitude não ir cavando a ilha por baixo sem que ninguém
       * veja.
       *
       * A potência cai com a distância ao chão: em cima dele é o buraco inteiro,
       * na borda da margem é um arranhão. Sem isso, o mesmo golpe abriria a
       * mesma cratera encostado no solo e a vinte metros dele, e o jogador
       * perderia a informação que mais importa — que mirar baixo destrói mais. */
      const solo = alturaDoChao !== null ? alturaDoChao : (this.chaoAbaixo ?? -1e9);
      const acima = this.y - solo;
      const margem = S.hitRadius * 2;
      if (acima <= margem) {
        const perto = Math.max(0, Math.min(1, 1 - Math.max(0, acima) / margem));
        const e = relato.chao();
        e.owner = this.owner;
        e.p.x = this.x;
        e.p.y = solo;
        e.p.z = this.z;
        /* Nunca abaixo de um terço: uma Genki Dama que detonou a vinte metros
           do chão continua sendo uma Genki Dama, e um arranhão ali leria como
           a explosão não ter acontecido. */
        e.power = S.power * (0.34 + 0.66 * perto);
        /* Bacia larga e rasa, que é o que uma esfera faz. Quem pede buraco
           estreito e fundo é o feixe (`craterDeep`). O campo tem de ser escrito
           mesmo valendo 1: o registro da fila é REAPROVEITADO, e um `fundo` de
           3,5 deixado por um Kamehameha do quadro anterior viraria um poço aqui. */
        e.fundo = 1;
        e.kind = this.kind;
      }
    }

    /* O CLARÃO. Aditivo, largo e curto — a poeira quem levanta é a cratera.
       Os três multiplicadores de estilo entram aqui: são eles que fazem a Genki
       Dama ser "a maior explosão de todas" em vez de a mesma explosão com outra
       cor. Ver o comentário deles em `ESTILO.genki`. */
    const E = this.estilo;
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.x, y: this.y, z: this.z },
      count: Math.round(46 * E.fagulhas),
      color: S.cor,
      speed: 48 * (1 + (E.fagulhas - 1) * 0.35),
      spread: 1,
      size: S.hitRadius * 0.22 * E.floco,
      grow: 2.6,
      life: 0.75 * E.duracao,
      gravity: 0,
      drag: 1.1,
      alpha: 1,
      additive: true,
    });
    /* O TREMOR é de quem SOLTOU o golpe, como a luz — é o mesmo canal e a mesma
       razão (§4 do cabeçalho de `powers/index.js`): a tela é dele. A Genki Dama
       sacode por mais de um segundo; o Galick Gun dá um tranco e passa. */
    if (this.local && E.tremor > 0) relato.abalo(E.tremor, E.tremorT);

    if (alturaDoChao === null) {
      /* DETONOU NO AR. Sem cratera não há `relato.chao`, e sem ele o estouro
         acontecia em silêncio absoluto: uma Genki Dama explodindo a duzentos
         metros de altura, que é a maior coisa que este modo desenha, sem um
         ruído. É por isso que esta fila existe — ver `filaNoAr` em
         `powers/index.js`. */
      if (this.owner === localId) {
        const e = relato.noAr();
        e.owner = this.owner;
        e.kind = this.kind;
        e.p.x = this.x;
        e.p.y = this.y;
        e.p.z = this.z;
        e.power = S.power;
      }
      return;
    }
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.x, y: alturaDoChao, z: this.z },
      count: Math.round(34 * E.fagulhas),
      color: 0x7c8a5e,
      speed: 26 * (1 + (E.fagulhas - 1) * 0.3),
      spread: 0.5,
      direction: { x: 0, y: 1, z: 0 },
      size: 1.6 * E.floco,
      grow: 3.4,
      life: 1.7 * E.duracao,
      gravity: NAMEK.fighter.gravity * 0.35,
      drag: 0.9,
      alpha: 0.8,
    });
  }

  /** A casca abre e apaga. Meio segundo, e a esfera acabou. */
  passoDoEstouro(dt, relato) {
    const E = this.estilo;
    this.tEstouro += dt;
    const u = this.tEstouro / (ESTOURO * E.duracao);
    if (u >= 1) return true;

    const k = this.info.hitRadius * (1 + (E.abertura - 1) * u);
    const some = (1 - u) * (1 - u);
    this.group.position.set(this.x, this.y, this.z);
    /* O NÚCLEO ARREDONDA. Escala uniforme aqui, com ou sem `nucleoL`: a bala do
       Galick Gun deixa de ser bala no instante em que para — o que se expande a
       partir de um impacto é uma bola de fogo, e um elipsoide crescendo no eixo
       do voo leria como a bala continuando a viagem depois de já ter batido. */
    this.nucleo.scale.setScalar(k * 0.9);
    this.nucleo.material.opacity = E.nucleoAlfa * some;
    /* A CASCA NÃO. Ver `estouroR`/`estouroL` na tabela: a cúpula da Genki Dama
       abre redonda e o cone do Galick Gun é achatado contra o que ele acertou. */
    this.casca.scale.set(k * E.estouroR, k * E.estouroL, k * E.estouroR);
    this.casca.material.opacity = E.cascaAlfa * some;
    /* A FITA DRENA PARA DENTRO DA EXPLOSÃO. A cabeça fica cravada no ponto do
       impacto (a esfera não anda mais) enquanto as amostras continuam
       deslizando para trás na fila, então a cauda inteira é engolida para a
       frente. É o oposto de um rastro que simplesmente apaga no lugar, e custa
       exatamente a mesma linha.

       O dreno completo levaria 0,76 s e o estouro do Galick Gun dura 0,62 —
       ou seja, ele é cortado com uns 82 % do caminho andado. Não é problema e
       não vale um número casado a martelo: quem termina o trabalho é o
       `some = (1 − u)²` da linha abaixo, que já zerou a opacidade bem antes
       disso. O que o olho vê é a fita sendo sugada e apagando junto. */
    this.atualizarTraco(dt);
    if (this.traco.visible) this.traco.material.opacity = 0.85 * some;
    /* A luz do estouro escala com a abertura: a cúpula da Genki Dama tem
       sessenta metros e precisa acender o vale inteiro por baixo dela. */
    if (this.local) {
      relato.luz(this.x, this.y, this.z, this.info.cor, (1.4 + E.abertura * 0.1) * (1 - u));
    }
    return false;
  }

  /* ------------------------------------------------------------------ visual */

  desenhar(dt) {
    const E = this.estilo;
    this.group.position.set(this.x, this.y, this.z);
    /* A BALA APONTA PARA ONDE VAI. Um quaternion por quadro, e só no golpe que
       tem frente — a Genki Dama sai por `alinhar: false` sem tocar em nada.
       `setFromUnitVectors` já resolve o caso antiparalelo (tiro para baixo com
       `_UP` para cima), que é o único degenerado possível aqui. */
    if (E.alinhar) {
      _dirv.set(this.dir.x, this.dir.y, this.dir.z);
      this.group.quaternion.setFromUnitVectors(_UP, _dirv);
    }
    /* A respiração. Devagar e discreta na lua, rápida e mais forte no tiro —
       devagar o bastante para ninguém contar as batidas, forte o bastante para
       a esfera não parecer um adesivo colado na tela. */
    const resp = 1 + Math.sin(this.t * E.respiro) * E.amplitude;
    const r = Math.max(0.001, this.raio * resp);
    /* Bojo e comprimento separados: iguais na lua (que é redonda), 0,78 por
       1,35 na bala. O eixo Y do grupo É o eixo do voo quando há alinhamento. */
    this.nucleo.scale.set(r * E.nucleoR, r * E.nucleoL, r * E.nucleoR);
    this.casca.scale.setScalar(r);
    this.casca.rotation.x += E.giroX * dt;
    this.casca.rotation.y += E.giroY * dt;
  }

  /**
   * A energia sendo recolhida durante a carga.
   *
   * `grow` negativo e arrasto alto: as fagulhas ENCOLHEM em direção à esfera em
   * vez de saírem dela. É a diferença entre "juntando" e "explodindo", e sem
   * ela a pose de carga lê como um estouro que não acaba.
   */
  recolher(dt, u) {
    this._fag -= dt;
    if (this._fag > 0) return;
    this._fag = 0.16;
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.x, y: this.y, z: this.z },
      count: 7,
      color: this.info.cor,
      speed: 16 + 22 * u,
      spread: 1,
      size: 0.5,
      grow: -0.75,
      life: 0.6,
      gravity: 0,
      drag: 3.4,
      alpha: 0.9,
      additive: true,
    });
  }

  /**
   * A base perpendicular ao voo, em `b1` e `b2`.
   *
   * A mesma receita de `disk.js`: o vertical do mundo cruzado com o eixo, com a
   * recusa para o tiro na vertical — onde "para cima" e o eixo são o mesmo vetor
   * e o produto vetorial devolve zero. Escrita em campos do objeto porque a
   * espiral e a fita a pedem no mesmo quadro e ela não muda entre as duas.
   */
  baseDoVoo() {
    const d = this.dir;
    let ux = d.z;
    let uz = -d.x;
    let uy = 0;
    let L = Math.sqrt(ux * ux + uz * uz);
    if (L < 1e-4) {
      // Tiro na vertical: troca o eixo de referência, como o disco faz.
      ux = 0;
      uy = -d.z;
      uz = d.y;
      L = Math.sqrt(uy * uy + uz * uz) || 1;
    }
    this.b1.x = ux / L;
    this.b1.y = uy / L;
    this.b1.z = uz / L;
    this.b2.x = d.y * this.b1.z - d.z * this.b1.y;
    this.b2.y = d.z * this.b1.x - d.x * this.b1.z;
    this.b2.z = d.x * this.b1.y - d.y * this.b1.x;
  }

  /**
   * O RASTRO QUE SEGUE. Ver o fim do cabeçalho — a palavra é *segue*, e a
   * ressalva sobre o que a ponte de partículas deste modo realmente entrega
   * está lá também, porque é ela que decide a forma de baixo.
   *
   * Na Genki Dama: um sopro só, `atraso` raios atrás dela, saindo na DIREÇÃO DO
   * VOO a uma fração da velocidade — as fagulhas correm atrás da bola e vão
   * ficando para trás sozinhas, que é a leitura de energia arrastada por uma
   * coisa rápida demais, e o oposto exato de partículas jogadas para trás, que
   * ficam paradas no ar e leem como fumaça de escapamento.
   *
   * No Galick Gun: DOIS braços opostos, num anel de `espiral` raios em torno do
   * eixo do voo, girando `giroEspiral` a cada sopro. A bala avança entre um
   * sopro e o outro e o que fica no ar é uma hélice dupla. Dois `emit` por sopro
   * em vez de um — é o preço de a ponte só honrar POSIÇÃO —, com a contagem por
   * sopro cortada de oito para seis, de modo que o custo em partículas caiu em
   * vez de subir. Ver `rastro` e `rastroN` na tabela de estilo.
   */
  rastro(dt) {
    const E = this.estilo;
    this._fag -= dt;
    if (this._fag > 0) return;
    this._fag = E.rastro;
    const S = this.info;
    const r = S.hitRadius * E.atraso;
    const bx = this.x - this.dir.x * r;
    const by = this.y - this.dir.y * r;
    const bz = this.z - this.dir.z * r;
    const tam = S.hitRadius * 0.13;
    const vel = S.speed * E.perseguicao;

    if (E.espiral <= 0) {
      this.soprar(bx, by, bz, E.rastroN, tam, vel);
      return;
    }

    this.baseDoVoo();
    this._fase += E.giroEspiral;
    const raioE = S.hitRadius * E.espiral;
    /* Dois braços a meia volta um do outro. Um braço só daria uma linha
       ondulada — que a esta velocidade lê como um rastro torto, não como giro;
       são os DOIS, trocando de lado em torno do eixo, que fazem o olho ver
       rotação. Mais de dois fecham num tubo e a rotação some de novo. */
    for (let b = 0; b < 2; b++) {
      const a = this._fase + b * Math.PI;
      const c = Math.cos(a);
      const s = Math.sin(a);
      this.soprar(
        bx + (this.b1.x * c + this.b2.x * s) * raioE,
        by + (this.b1.y * c + this.b2.y * s) * raioE,
        bz + (this.b1.z * c + this.b2.z * s) * raioE,
        E.rastroN,
        tam,
        vel,
      );
    }
  }

  /**
   * Um sopro de fagulhas do rastro.
   *
   * Os campos que a ponte deste modo descarta (`direction`, `spread`, `grow`,
   * `drag`) continuam aqui de propósito — ver o cabeçalho. `spread` baixo e
   * `direction` no eixo do voo são o contrato certo do barramento, e o dia em
   * que Namekusei passar a honrá-lo o rastro melhora sem que ninguém volte
   * neste arquivo.
   */
  soprar(x, y, z, n, tam, vel) {
    gameEvents.emit(EventType.PARTICLES, {
      position: { x, y, z },
      count: n,
      color: this.info.cor,
      speed: vel,
      spread: 0.22,
      direction: { x: this.dir.x, y: this.dir.y, z: this.dir.z },
      size: tam,
      grow: 1.1,
      life: 0.7,
      gravity: 0,
      drag: 1.4,
      alpha: 0.7,
      additive: true,
    });
  }

  /**
   * A FITA. Um quadro do traço que curva — ver a seção do cabeçalho.
   *
   * Duas coisas acontecem aqui, e a ordem entre elas é o truque inteiro:
   *
   * 1. **A amostragem**, a cada `TRACO_PASSO`. A fila de nós desliza uma casa
   *    para trás (cópia no lugar, 51 floats, ~31 vezes por segundo) e o nó zero
   *    fica livre. Sem cadência fixa, o traço teria o dobro do comprimento a
   *    144 Hz do que a 72 — o mesmo defeito que `groundTrail`, em `fx/index.js`,
   *    resolve pelo mesmo motivo.
   * 2. **A cabeça é reescrita TODO quadro**, amostragem ou não. É o que mantém a
   *    ponta da fita grudada na bala em vez de a deixar tremendo 32 ms atrás
   *    dela, que a 95 m/s são três metros de folga bem visível.
   *
   * A tangente de cada nó sai por diferença central entre os vizinhos, e não do
   * versor de voo atual: é isso que faz a fita descrever a curva por onde a bala
   * PASSOU em vez de a torcer inteira toda vez que a perseguição corrige o rumo.
   * Nas duas pontas, onde não há vizinho dos dois lados, a diferença degenera
   * numa diferença simples — que é o certo, e não uma exceção a tratar.
   */
  atualizarTraco(dt) {
    const E = this.estilo;
    if (E.traco <= 0) return;
    const n = this.nos;

    this._tTraco += dt;
    if (this._tTraco >= TRACO_PASSO) {
      /* Subtrai em vez de zerar, e a 60 Hz isso não é preciosismo: 42 ms não é
         múltiplo de 16,7, então a amostra cai ora em dois quadros ora em três.
         Zerando o resto, toda amostra viraria de três quadros (50 ms) e a fita
         ficaria 19 % mais comprida do que a conta de `TRACO_PASSO` promete — e
         mais comprida numa taxa de quadros do que em outra, que é o defeito que
         a cadência fixa existe para não ter.

         O teto existe para o outro extremo, o quadro gigante da aba que voltou
         do fundo: sem ele o resto acumularia e a fita deslizaria várias casas de
         uma vez nos quadros seguintes, engolindo a própria história. */
      this._tTraco -= TRACO_PASSO;
      if (this._tTraco > TRACO_PASSO) this._tTraco = 0;
      for (let i = (TRACO_NOS - 1) * 3; i >= 3; i -= 3) {
        n[i] = n[i - 3];
        n[i + 1] = n[i - 2];
        n[i + 2] = n[i - 1];
      }
    }
    n[0] = this.x;
    n[1] = this.y;
    n[2] = this.z;

    const pos = this.traco.geometry.getAttribute("position");
    const p = pos.array;
    const larg = this.info.hitRadius * E.traco;

    for (let i = 0; i < TRACO_NOS; i++) {
      const i3 = i * 3;
      const x = n[i3];
      const y = n[i3 + 1];
      const z = n[i3 + 2];

      const a3 = (i > 0 ? i - 1 : 0) * 3;
      const b3 = (i < TRACO_NOS - 1 ? i + 1 : TRACO_NOS - 1) * 3;
      let tx = n[a3] - n[b3];
      let ty = n[a3 + 1] - n[b3 + 1];
      let tz = n[a3 + 2] - n[b3 + 2];
      const L = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (L < 1e-5) {
        /* Trecho ainda colapsado (a fita acabou de nascer, ou já drenou toda
           para dentro da explosão): sem tangente própria, usa a do voo. A
           largura destes nós é irrelevante porque os vizinhos estão no mesmo
           ponto e os triângulos são degenerados de qualquer jeito. */
        tx = this.dir.x;
        ty = this.dir.y;
        tz = this.dir.z;
      } else {
        tx /= L;
        ty /= L;
        tz /= L;
      }

      /* As duas perpendiculares do nó — a mesma recusa de `baseDoVoo`, aqui em
         linha porque a tangente é a do NÓ e não a do voo. */
      let ux = tz;
      let uy = 0;
      let uz = -tx;
      let ul = Math.sqrt(ux * ux + uz * uz);
      if (ul < 1e-4) {
        ux = 0;
        uy = -tz;
        uz = ty;
        ul = Math.sqrt(uy * uy + uz * uz) || 1;
      }
      ux /= ul;
      uy /= ul;
      uz /= ul;
      const vx = ty * uz - tz * uy;
      const vy = tz * ux - tx * uz;
      const vz = tx * uy - ty * ux;

      /* Quatro vértices por nó: os dois planos da cruz. Ver "o traço que CURVA"
         no cabeçalho para por que não é um plano só. */
      const w = larg * TRACO_PERFIL[i];
      const o = i * 12;
      p[o] = x + ux * w;
      p[o + 1] = y + uy * w;
      p[o + 2] = z + uz * w;
      p[o + 3] = x - ux * w;
      p[o + 4] = y - uy * w;
      p[o + 5] = z - uz * w;
      p[o + 6] = x + vx * w;
      p[o + 7] = y + vy * w;
      p[o + 8] = z + vz * w;
      p[o + 9] = x - vx * w;
      p[o + 10] = y - vy * w;
      p[o + 11] = z - vz * w;
    }
    pos.needsUpdate = true;
    if (!this.traco.visible) {
      this.traco.visible = true;
      this.traco.material.opacity = 0.85;
    }
  }

  /**
   * A esfera foi INTERCEPTADA por outro poder — o gancho do embate.
   *
   * Ver `powers/colisao.js`, que é onde a regra mora. O que ela faz aqui é
   * abrir a casca sem passar por `detonar`, e a diferença entre as duas é
   * exatamente o que o embate NÃO é:
   *
   * • sem DANO. Um golpe interceptado no meio do céu não chegou a ninguém, e
   *   dar a ele a explosão de área no ponto da interceptação faria abater uma
   *   Genki Dama com um Kienzan ser pior do que deixá-la passar.
   * • sem CRATERA e sem SOM daqui. Os dois saem do árbitro, para os dois lados
   *   do embate ao mesmo tempo e por um caminho só — se cada poder relatasse o
   *   seu, o mesmo choque abriria dois buracos no mesmo ponto.
   *
   * O que sobra é a casca abrindo, que é a leitura da esfera arrebentando, e é
   * o desenho que `passoDoEstouro` já faz.
   */
  abortarPorEmbate() {
    if (!this.viva || this.estourando) return false;
    this.estourando = true;
    this.tEstouro = 0;
    return true;
  }

  apagar() {
    this.viva = false;
    this.estourando = false;
    this.group.visible = false;
    this.traco.visible = false;
  }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.traco);
    this.nucleo.material.dispose();
    this.casca.material.dispose();
    /* A fita é a única geometria POR ESFERA — as outras duas são do pool e ele
       as solta sozinho. Aqui a malha é o caminho de cada uma, então cada uma tem
       a sua e cada uma tem de a soltar. */
    this.traco.geometry.dispose();
    this.traco.material.dispose();
  }
}

/* ============================================================================
   As geometrias
   ========================================================================== */

/**
 * A COROA DE CHOQUE do Galick Gun — a casca que substituiu a malha de arame.
 *
 * Um cone ABERTO nas duas pontas, ponta à frente e boca escancarada para trás,
 * com o elipsoide do núcleo sentado dentro dela. É a envoltória de choque de
 * uma coisa que está rasgando o ar depressa demais, e a silhueta que sai disso
 * é uma PONTA DE LANÇA — o contrário exato de uma bola.
 *
 * Os três números:
 *
 * • **Seis lados**, e não vinte. Um cone de revolução liso girando em torno do
 *   próprio eixo é indistinguível de um cone parado — é a mesma armadilha que a
 *   casca de arame da Genki Dama evita por outro caminho (ver o cabeçalho). Com
 *   seis faces, as sete voltas por segundo de `giroY` viram um estriamento
 *   piscando, e é o piscar que diz "isto está girando", que por sua vez é o que
 *   diz "isto é um projétil".
 * • **2,3 de altura por 1,25 de raio de boca**, com o corpo deslocado 0,6 para a
 *   frente: a ponta fica a 1,75 raios à frente do centro — adiante do bico do
 *   elipsoide, que para em 1,35 — e a boca a 0,55 atrás, aberta a 1,25 raios,
 *   folgada em torno do bojo de 0,78. Ou seja: a coroa ENVOLVE a bala e sobra
 *   dela para os dois lados, em vez de a cortar ao meio.
 *
 * A `ConeGeometry` já nasce com o ápice em +altura/2 e a base em −altura/2, no
 * eixo Y — que é o eixo do voo depois do alinhamento do grupo. Só o
 * deslocamento precisa ser escrito.
 */
function coroaDeChoque() {
  const geo = new THREE.ConeGeometry(1.25, 2.3, 6, 1, true);
  geo.translate(0, 0.6, 0);
  return geo;
}

/**
 * A fita do traço, VAZIA — posições zeradas, cor e índices prontos.
 *
 * Uma por esfera (ver `dispose`). O que é escrito aqui nunca mais muda:
 *
 * • a RAMPA de cor, que some para a cauda e que o material multiplica pela cor
 *   do golpe (`vertexColors`), o que permite a mesma rampa servir qualquer cor;
 * • os ÍNDICES dos dois planos da cruz. Dezessete segmentos × dois planos × dois
 *   triângulos = 68 triângulos, 204 índices, em `Uint16Array` porque são 72
 *   vértices e um `Uint32` seria o dobro de banda para contar até setenta e dois.
 *
 * As posições ficam em zero e são preenchidas por `atualizarTraco` — nunca
 * desenhadas antes disso, porque `acender` colapsa os nós e só liga a malha
 * depois da primeira escrita de verdade.
 */
function fitaDoTraco() {
  const geo = new THREE.BufferGeometry();
  const nv = TRACO_NOS * 4;

  const pos = new THREE.BufferAttribute(new Float32Array(nv * 3), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", pos);

  const cor = new Float32Array(nv * 3);
  for (let i = 0; i < TRACO_NOS; i++) {
    const f = TRACO_RAMPA[i];
    const b = i * 12;
    for (let v = 0; v < 4; v++) {
      cor[b + v * 3] = f;
      cor[b + v * 3 + 1] = f;
      cor[b + v * 3 + 2] = f;
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cor, 3));

  const idx = new Uint16Array((TRACO_NOS - 1) * 12);
  let k = 0;
  for (let i = 0; i < TRACO_NOS - 1; i++) {
    const a = i * 4;
    const b = (i + 1) * 4;
    for (let plano = 0; plano < 2; plano++) {
      const a0 = a + plano * 2;
      const a1 = a0 + 1;
      const b0 = b + plano * 2;
      const b1 = b0 + 1;
      idx[k++] = a0;
      idx[k++] = a1;
      idx[k++] = b1;
      idx[k++] = a0;
      idx[k++] = b1;
      idx[k++] = b0;
    }
  }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

/* ============================================================================
   O pool
   ========================================================================== */

export class OrbPool {
  constructor(scene, field, max = MAX_ESFERAS) {
    this.scene = scene;
    this.field = field;
    this.geos = {
      bola: new THREE.SphereGeometry(1, 24, 18),
      // Subdivisão 2: 320 faces de arame. Mais que isso vira uma bola de lã;
      // menos, e o icosaedro aparece como um dado de vinte lados.
      malha: new THREE.IcosahedronGeometry(1, 2),
      // A coroa do Galick Gun. Ver `coroaDeChoque`.
      coroa: coroaDeChoque(),
    };
    this.esferas = new Array(max);
    for (let i = 0; i < max; i++) this.esferas[i] = new Esfera(scene, this.geos);
  }

  disparar(disparo) {
    if (!NAMEK.specials[disparo.kind]) return null;
    return pegarVaga(this.esferas).acender(this.field, disparo);
  }

  update(dt, alvos, localId, relato) {
    for (let i = 0; i < this.esferas.length; i++) {
      const g = this.esferas[i];
      if (!g.viva) continue;
      if (g.update(dt, alvos, localId, relato)) g.apagar();
    }
  }

  get count() {
    let n = 0;
    for (let i = 0; i < this.esferas.length; i++) if (this.esferas[i].viva) n++;
    return n;
  }

  clear() {
    for (let i = 0; i < this.esferas.length; i++) this.esferas[i].apagar();
  }

  dispose() {
    for (let i = 0; i < this.esferas.length; i++) this.esferas[i].dispose();
    this.geos.bola.dispose();
    this.geos.malha.dispose();
    this.geos.coroa.dispose();
  }
}
