/* ---------------------------------------------------------------------------
   O feixe sustentado — o Kamehameha.

   Custa a barra CHEIA (§5 do plano) e é o golpe que enche a tela.

   -------------------------------------------------------------- as quatro fases

       carga        windup segundos na pose, a esfera crescendo na mão
       sustentação  a cabeça avança a `speed` até o alcance (ou até o chão)
       dissipação   a cauda solta da mão e persegue a cabeça
       morto        devolvido ao pool

   A DISSIPAÇÃO é o que dá o caráter. Um feixe que some de uma vez é um cilindro
   que desliga; o que se quer é a energia ACABANDO — a cauda solta, corre atrás
   da ponta e o traço vai afinando enquanto se estica. São duas distâncias sobre
   o mesmo caminho, e é a mesma ideia do Kamehameha do arqueiro
   (`entities/kamehameha.js`), que resolveu isto primeiro.

   ------------------------------------------------------------ ELE FAZ CURVA

   E é por causa disto que este arquivo mudou de forma. O pedido: "hoje é só
   algo muito reto, mas ele deve, sim, ter uma curvatura para perseguir o
   player… porém a curva nunca deve ser muito brusca".

   O feixe ERA função pura de (origem, direção, tempo) — três cilindros
   esticados sobre um eixo fixo. Não havia onde pendurar uma curva: não havia
   trajetória, havia uma reta e um relógio.

   Agora ele é uma COBRA, e as três peças são:

       a CABEÇA   um ponto que voa a `speed` e gira em direção ao alvo
       o CAMINHO  a polilinha por onde a cabeça passou (um nó a cada 14 m)
       a CAUDA    uma distância ao longo desse caminho, que a persegue no fim

   O corpo é o caminho entre cauda e cabeça, varrido como tubo. É o mesmo
   mecanismo da fita do Galick Gun (`atualizarTraco`, em `orb.js`): a malha é
   reescrita a cada quadro sobre as posições que o golpe REALMENTE ocupou, e não
   torcida a partir da direção atual — é essa diferença que faz o rastro
   descrever a curva por onde ele passou em vez de o feixe inteiro dobrar toda
   vez que a mira corrige.

   Os limites da curva (170°/s, teto total de 70°, cone de 35°, e só com a
   trava) estão em `NAMEK.specials.kamehameha.homing`, com a conta de cada um.

   E quando ele PASSA do alvo, acabou: `alvo` é zerado para sempre e o resto da
   vida dele é reta. Um feixe que reengata porque a vítima voltou a ficar na
   frente não lê como perseguição, lê como teleguiado.

   ------------------------------------------------------------------ o dano

   Por SEGUNDO, não por acerto: `dps` em `NAMEK.specials`. Cobrar por acerto
   faria um feixe de 2,4 s valer o mesmo que um encostão de meio segundo, e a
   decisão de SEGURAR a mira em cima de alguém — que é a jogada do golpe —
   deixaria de valer alguma coisa.

   Mas cobrar por segundo não é mandar uma mensagem por quadro: a exposição de
   cada vítima é ACUMULADA aqui e despejada a 10 Hz, que é a mesma frequência
   do `VITALS`. É exatamente o que o comentário do `NC2S.SPECIAL_HIT` no
   protocolo descreve — `dt` são os segundos desde o último aviso.

   O teste de acerto é contra o CAMINHO, segmento por segmento, e não contra um
   eixo. Ele tinha de mudar junto com o desenho: um feixe que contorna e cobra
   dano pela reta original é um feixe que erra o que acertou na tela.

   ----------------------------------------------------------------- e o chão

   O feixe atravessa gente e cenário. Só o CHÃO o para — um raio de energia que
   uma pedra interrompe não é um raio de energia. E o chão vira UMA cratera, no
   ponto em que a cabeça encostou, e só uma: um pulso de cratera por quadro
   durante 2,4 s encheria o registro de crateras sozinho — e, agora que elas se
   somam em vez de se aposentarem, abriria um poço no lugar de um buraco.

   O chão também deixou de ser resolvido de uma vez no disparo (`acharChao`
   marchava a reta inteira). Com curva não dá: o caminho não existe antes de ser
   percorrido. Agora o relevo é testado enquanto a cabeça anda, duas amostras
   por passo — o mesmo que as bolas dos bots já fazem, e pelo mesmo motivo.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";
import { gameEvents, EventType } from "../../core/events.js";
import {
  alvoPorId,
  atingivel,
  distanciaAoFeixe,
  passoDeGiro,
  pegarVaga,
  perseguirPonto,
  PEITO,
  TETO_DO_RELEVO,
} from "./blast.js";

/* Quantos feixes cabem em cena ao mesmo tempo.
 *
 * Não é um limite de jogo, é um teto de custo: cada feixe são quatro chamadas
 * de desenho, e seis é mais que o número de pessoas que conseguem ter a barra
 * cheia no mesmo instante numa sala de quinze (a barra leva 2,6 s para encher
 * e o especial ainda tem `windup`). O sétimo recicla — e QUEM ele recicla está
 * em `pegarVaga`, que nunca rouba o feixe do jogador local para dar a um
 * remoto. */
const MAX_FEIXES = 6;

/** Raio na base, como fração do raio cheio. Ver o comentário em `PERFIL`. */
const BASE_TAPER = 0.14;
/** m — quanto o VISUAL nasce à frente das mãos (o acerto continua nelas). */
const RECUO_VISUAL = 1.2;
/** m — em quantos metros a ponta apaga quando não há nada em que bater. */
const SUMICO_PONTA = 70;

/* Fração da sustentação que a cauda leva para alcançar a frente. É FORMA, não
   balanço: o dano por segundo e a duração do golpe estão em `NAMEK.specials`, e
   isto só diz quanto tempo o rabo do feixe leva para sumir depois que a energia
   acabou. Um pouco mais da metade da sustentação é o que a referência mostra —
   o traço estica, afina e some. */
const FRACAO_DISSIPACAO = 0.55;

/** Raios das três camadas, em múltiplos do `hitRadius` do especial. */
const RAIO_NUCLEO = 0.5;
const RAIO_CASCA = 1.0;
const RAIO_HALO = 1.75;
/* A casca vale EXATAMENTE o raio de morte, e isso é uma promessa ao jogador:
   tudo o que parece sólido mata, e o que sobra para fora é o brilho. Morrer do
   lado de fora do que se vê é a reclamação que nenhum ajuste de número
   conserta. */

/* ------------------------------------------------------------- o caminho --- */

/* m — de quantos em quantos metros a cabeça deixa um nó no caminho.
 *
 * A régua não é "quanto de história eu quero" (a do traço do Galick Gun), é
 * "quanto erro de corda eu aceito": um arco de raio R amostrado a cada L metros
 * se afasta da corda em `L²/8R`, e com os 229 m de raio da curva mais fechada
 * que este golpe faz, 14 m dão **11 cm**. Ou seja, o caminho gravado é fiel à
 * curva de verdade num décimo do raio do próprio feixe. */
const PASSO_NO = 14;

/* Quantos nós o caminho guarda. `range / PASSO_NO` são 44 para o alcance de
   620 m; 48 cobre isso com folga para o nó da origem e para o nó vivo. Cheio,
   ele para de gravar e o último trecho vira uma reta longa — o que é inofensivo
   porque a perseguição (1,4 s, ou 476 m) já acabou muito antes daí. */
const MAX_PONTOS = 48;

/* ------------------------------------------------------------- o desenho --- */

/* Anéis do tubo. São gastos no trecho VISÍVEL (entre cauda e cabeça), não no
   caminho inteiro — ver `desenhar`. É por isso que 26 bastam para um feixe de
   620 m e continuam bastando para os últimos 20 m dele na dissipação, que é
   justamente quando o feixe está perto da câmera e a facetagem apareceria. */
const NOS = 26;
/** Lados de cada anel. Doze é liso a qualquer distância que este golpe alcance. */
const LADOS = 12;

/* Fração do comprimento em que a cauda FECHA em ponta.
 *
 * É o "não sai do player um bloco redondo, e sim uma cauda fina ao final do
 * poder", do pedido — e era uma queixa correta. O cilindro de antes terminava
 * num disco de meio metro de raio, e ele era ABERTO (`openEnded`): quando a
 * cauda desgrudava da mão dava para ver por DENTRO do tubo. Aqui os últimos 6 %
 * do traço convergem para raio zero, então a cauda acaba em bico e fecha
 * sozinha, sem tampa e sem um triângulo a mais.
 *
 * Seis por cento é relativo de propósito: são 37 m de bico num feixe de 620 m e
 * dois metros num toco de trinta. A ponta é sempre proporcional ao que sobrou —
 * é a mesma coisa que a energia acabando faria. */
const FECHO_CAUDA = 0.06;

/* O perfil de raio ao longo do traço, da cauda (0) à cabeça (1).
 *
 * AFUNILADO NA MÃO, e isto não é estética — é o que torna o golpe jogável.
 *
 * Um tubo de 7 m de raio que começa cheio no punho é visto POR DENTRO pela
 * câmera de terceira pessoa, que está a quatro metros dali: a tela inteira vira
 * uma parede branca e o jogador deixa de ver o próprio personagem, o céu e quem
 * está atirando de volta. Isso foi medido no jogo do arqueiro, está escrito lá
 * em `entities/kamehameha.js`, e não há motivo para descobrir de novo com um
 * feixe duas vezes mais grosso.
 *
 * Estreito na base e cheio à frente também é o que a referência mostra, e é o
 * que o pedido descreve: "o início do Kamehameha tem uma parte maior no início,
 * depois tem a cauda que vai se afinando". A rampa longa é o cone que o
 * cilindro de antes já tinha (`BASE_TAPER` na base, cheio na ponta); o `FECHO`
 * é o bico novo. O raio de morte não muda com nada disto — ele é do EIXO. */
const PERFIL = new Float32Array(NOS);
for (let i = 0; i < NOS; i++) {
  const u = i / (NOS - 1);
  const cone = BASE_TAPER + (1 - BASE_TAPER) * u;
  PERFIL[i] = cone * Math.min(1, u / FECHO_CAUDA);
}

/** Seno e cosseno de cada lado do anel. Calculados uma vez para o processo. */
const COS_LADO = new Float32Array(LADOS);
const SEN_LADO = new Float32Array(LADOS);
for (let j = 0; j < LADOS; j++) {
  const a = (j / LADOS) * Math.PI * 2;
  COS_LADO[j] = Math.cos(a);
  SEN_LADO[j] = Math.sin(a);
}

/** s — de quanto em quanto tempo a exposição acumulada é despejada. */
const AVISO = 1 / NAMEK.net.statusRate;
/** Quantas vítimas simultâneas a tabela de exposição guarda entre dois avisos. */
const MAX_VITIMAS = NAMEK.net.maxPlayers + 1;

/* ------------------------------------------------------------- rascunhos ---
   Os anéis do quadro atual. São de MÓDULO e não do feixe porque só um feixe é
   desenhado de cada vez: seis cópias disto seriam seis vezes a mesma memória
   parada. */
const _centro = new Float32Array(NOS * 3);
const _eixoU = new Float32Array(NOS * 3);
const _eixoV = new Float32Array(NOS * 3);
const _cor = new THREE.Color();

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ============================================================================
   Um feixe
   ========================================================================== */

class Feixe {
  /** @param {THREE.Scene} scene @param {object} geos geometrias do pool */
  constructor(scene, geos) {
    this.scene = scene;
    /* `viva`, `t` e `local` existem ANTES do primeiro disparo porque
       `pegarVaga` os lê para escolher quem reciclar. Um slot nunca usado sai
       pelo `!viva`, mas depender dessa ordem seria depender de uma ordem. */
    this.viva = false;
    this.t = 0;
    this.local = false;
    this.group = new THREE.Group();
    this.group.visible = false;

    /* O CAMINHO. Posições da cabeça e o comprimento de arco de cada uma — e o
       arco vem junto, gravado, em vez de ser recalculado: ele é a régua com que
       cauda e cabeça são cortadas, e refazer 48 raízes quadradas por quadro
       para reobter um número que já se sabia seria trabalho por nada. */
    this.caminho = new Float32Array(MAX_PONTOS * 3);
    this.arcos = new Float32Array(MAX_PONTOS);
    this.nPontos = 0;
    /* A direção VIVA da cabeça — a que a perseguição gira. Mora aqui, e não em
       `acender`, porque `perseguirPonto` a muta no lugar e um objeto novo por
       disparo seria lixo a cada Kamehameha. */
    this.hdir = { x: 0, y: 0, z: 0 };

    /* AS TRÊS CAMADAS SOMAM — e era isso que apagava a cor do golpe.
     *
     * Mistura aditiva não escolhe entre as camadas: ela empilha. Núcleo a 0,90
     * mais casca a 0,34 mais halo a 0,11 são 1,35 de branco somado sobre um céu
     * que já é claro, e o canal satura muito antes de a matiz chegar à tela. O
     * Kamehameha (`#6fd8ff`) saía como **um tubo branco liso, uniforme de ponta
     * a ponta** — medido na imagem —, e o mesmo valia para todos os outros: a
     * cor existia no material e nunca aparecia.
     *
     * A soma agora fecha em 0,74, e a divisão entre elas mudou de figura: o
     * núcleo é ESTREITO e quente (é ele que pode estourar em branco, e deve — é
     * o miolo), enquanto casca e halo, que são a área grande, ficam translúcidos
     * e portanto COLORIDOS. É assim que um feixe azul lê como azul com o miolo
     * branco, que é o que a referência mostra. */
    this.nucleo = this.montar(geos.indices, 3, 0.5);
    this.casca = this.montar(geos.indices, 2, 0.17);
    this.halo = this.montar(geos.indices, 1, 0.07);

    /* A PONTA faz DOIS papéis, e é por isso que ela existe como um objeto só:
       durante a carga é a esfera entre as mãos (a pose), e depois é o nariz do
       feixe e a explosão onde ele encosta. Dois meshes para duas fases que
       nunca coexistem seriam uma chamada de desenho a mais por feixe. */
    this.ponta = new THREE.Mesh(
      geos.bola,
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.9,
        fog: false,
      }),
    );
    this.ponta.renderOrder = 4;
    this.ponta.frustumCulled = false;
    this.group.add(this.ponta);

    scene.add(this.group);

    /* A tabela de exposição. Pré-alocada: ela é reconstruída a cada despejo e
       nunca cresce, então um `Map` aqui seria uma alocação a cada vítima nova
       para guardar no máximo dezesseis floats. */
    this.vitimaId = new Array(MAX_VITIMAS).fill(null);
    this.vitimaSeg = new Float32Array(MAX_VITIMAS);
    this.nVitimas = 0;
    this.tAviso = 0;
  }

  /**
   * Uma das três camadas do tubo.
   *
   * A GEOMETRIA É PRÓPRIA DE CADA CAMADA DE CADA FEIXE, e é a única coisa deste
   * arquivo que deixou de ser compartilhada quando o feixe passou a curvar: os
   * vértices são posições de MUNDO sobre o caminho daquele golpe, então não há
   * o que dividir entre dois feixes. São 26 × 12 vértices, 3,7 KB por camada.
   *
   * O ÍNDICE, esse, é o mesmo para todas — a topologia do tubo não depende de
   * nada — e vem do pool. Ele é anexado sem `dispose` daqui: liberar de dentro
   * de uma camada um buffer que as outras dezessete usam apagaria o tubo delas
   * na GPU. Quem o solta é `BeamPool.dispose`, uma vez, no fim.
   */
  montar(indices, ordem, opacidade) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(NOS * LADOS * 3), 3),
    );
    geo.setIndex(indices);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: opacidade,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    mesh.renderOrder = ordem;
    // Um tubo de 620 m que nasce na mão e ainda entorta: a caixa envolvente não
    // ajuda em nada e o custo já é conhecido.
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  /* ---------------------------------------------------------------- disparo */

  acender(field, { owner, kind, origem, dir, target, local, info = null }) {
    /* `info` vem de `PowerSystem.spawnSpecial` e é a definição do golpe COMO
       ELE É VISTO: a de sempre, ou a cópia dourada do Super Saiyajin. Todas as
       leituras de `S.cor` / `this.info.cor` deste arquivo saem dela sem saber
       disso — ver o comentário lá e o cabeçalho de `character/ssj.js`. O `??` é
       para quem chamar `acender` direto, sem passar pelo sistema. */
    const S = info ?? NAMEK.specials[kind];
    this.field = field;
    this.owner = owner;
    this.kind = kind;
    this.info = S;
    this.local = !!local;
    this.viva = true;
    this.t = 0;
    this.frente = 0;
    this.cauda = 0;
    this.reportouChao = false;
    this.nVitimas = 0;
    this.tAviso = 0;
    this._imp = 0;
    this.alcance = S.range;
    this.bateu = false;
    this.saiu = false;
    /** Interceptado por outro poder — ver `abortarPorEmbate`. Zerado aqui, e
     *  não só em `apagar`, porque o slot do pool é reciclado a cada disparo. */
    this.abatido = false;

    /* ------------------------------------------------------- a perfuração --
       Ver `NAMEK.specials.kamehameha.atravessar`, que tem o argumento inteiro
       (inclusive o motivo de o resultado ser uma VALA aberta e não um túnel com
       teto: o terreno é um campo de altura, e campo de altura não tem teto).

       `furando` é o estado "a cabeça está DENTRO do relevo": ela continua
       andando, e a cada `passo` metros de rocha deixa uma cratera. Ele liga na
       primeira encostada e desliga quando a cabeça sai do outro lado — e pode
       religar, que é o que acontece quando o feixe corta dois picos em fila. */
    this.atravessa = S.atravessar ?? null;
    this.furando = false;
    /** m de arco em que a cabeça entrou na rocha desta vez. */
    this.entrada = 0;
    /** m de arco do próximo buraco do corredor. */
    this.proxFuro = 0;
    /** m de rocha já perfurados neste disparo, SOMANDO todas as entradas
     *  ANTERIORES — a corrente é somada em `perfurar` e só é fechada aqui
     *  quando a cabeça sai da rocha. */
    this.perfurado = 0;
    /** Há um buraco de corredor a enfileirar neste quadro. Ver `perfurar`. */
    this.furo = false;
    /** A BOCA: onde ele entrou no relevo. As fagulhas do impacto saem daqui
     *  enquanto ele fura — no fundo do corredor elas ficariam enterradas, e o
     *  jogador precisa ver de onde a poeira está saindo. */
    this.bocaX = 0;
    this.bocaY = 0;
    this.bocaZ = 0;

    this.ox = origem.x;
    this.oy = origem.y;
    this.oz = origem.z;
    const inv = 1 / (Math.hypot(dir.x, dir.y, dir.z) || 1);
    this.dx = dir.x * inv;
    this.dy = dir.y * inv;
    this.dz = dir.z * inv;

    /* A CABEÇA nasce na mão, apontada para onde se mirou. `dx/dy/dz` continuam
       sendo a direção do DISPARO — é ela que o clarão da boca usa, é ela que
       viajou na rede e é contra ela que a sala confere o acerto. A direção que
       muda é esta. */
    this.hx = this.ox;
    this.hy = this.oy;
    this.hz = this.oz;
    this.hdir.x = this.dx;
    this.hdir.y = this.dy;
    this.hdir.z = this.dz;

    /* O alvo travado NO DISPARO e recebido pela rede — a mesma regra da bola de
       ki (§6.1). Para este golpe ele só existe se quem atirou estava com a
       TRAVA em alguém: ver `homing.soTrava` na configuração e `soltarEspecial`.
       Sem alvo, o feixe é a reta que ele sempre foi. */
    this.alvo = target ?? null;
    /** Radianos já gastos do teto total de correção (`arcMax`). */
    this.arco = 0;

    /* O caminho começa com DOIS pontos no mesmo lugar: o nó da origem, que
       nunca mais se mexe, e o nó VIVO, que é reescrito a cada quadro. Manter o
       vivo sempre presente é o que garante que o caminho nunca tem menos de um
       segmento — e um caminho de um ponto só não tem tangente, não tem arco e
       não tem tubo. */
    this.nPontos = 2;
    this.caminho[0] = this.ox;
    this.caminho[1] = this.oy;
    this.caminho[2] = this.oz;
    this.caminho[3] = this.ox;
    this.caminho[4] = this.oy;
    this.caminho[5] = this.oz;
    this.arcos[0] = 0;
    this.arcos[1] = 0;
    this.arcoNo = 0;

    this.group.visible = true;

    const cor = S.cor;
    /* O núcleo puxa para o branco e as camadas de fora ficam com a cor do
       golpe. É como a referência trata todo feixe: o miolo está quente demais
       para ter cor, e é a coroa que diz se aquilo é um Kamehameha ou um Galick
       Gun. */
    _cor.set(cor);
    this.nucleo.material.color.set(0xffffff).lerp(_cor, 0.35);
    this.casca.material.color.copy(_cor);
    this.halo.material.color.copy(_cor);
    this.ponta.material.color.set(0xffffff).lerp(_cor, 0.25);
    this.ponta.material.opacity = 0.9;

    this.nucleo.visible = false;
    this.casca.visible = false;
    this.halo.visible = false;
    this.ponta.position.set(this.ox, this.oy, this.oz);

    this.faiscarCarga();
    return this;
  }

  /** O sopro de energia sendo puxada para as mãos, no começo da pose. */
  faiscarCarga() {
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.ox, y: this.oy, z: this.oz },
      count: 26,
      color: this.info.cor,
      speed: 9,
      spread: 1,
      size: 0.4,
      grow: -0.6,
      life: this.info.windup * 0.8,
      gravity: 0,
      // Arrasto alto e crescimento negativo: as fagulhas VÃO para a mão e
      // encolhem, em vez de sair dela. É a leitura de "juntando", não de
      // "explodindo", e é a única diferença entre a pose de carga e um estouro.
      drag: 2.6,
      alpha: 1,
      additive: true,
    });
  }

  /* ------------------------------------------------------------------ passo */

  /** @returns {boolean} true quando acabou e pode voltar ao pool */
  update(dt, alvos, localId, relato) {
    if (!this.viva) return true;
    const S = this.info;
    this.t += dt;

    /* A CARGA. O feixe ainda não existe: o que existe é a esfera entre as mãos,
       crescendo. É a pose que a referência mostra antes de todo Kamehameha, e é
       também o aviso que dá a quem está do outro lado a chance de sair da
       frente — sem ela, o especial seria um botão que apaga alguém. */
    if (this.t < S.windup) {
      const u = this.t / S.windup;
      /* A ESFERA DE CARGA É UMA BOLA NA MÃO, NÃO UMA PAREDE.
       *
       * Ela era `hitRadius · 0,62` — 2,2 m de raio para o Kamehameha — a sete
       * metros da lente. São 34° de um campo de visão de 68°: **metade da tela**,
       * em branco chapado de borda dura, com o lutador inteiro atrás. Durante
       * todo o windup o jogador não via o próprio personagem, nem a pose, nem
       * para onde estava mirando; e a pose de carga existe justamente para ser
       * vista (é o aviso que dá ao outro a chance de sair da frente).
       *
       * A 0,22 ela fica com 0,79 m — do tamanho das duas mãos em concha, que é
       * o que a referência mostra. E a opacidade cai junto: aditivo a 0,95 é
       * branco puro, e branco puro não tem cor nenhuma para o golpe carregar. */
      const r = S.hitRadius * 0.22 * u * u * (1 + Math.sin(this.t * 30) * 0.06);
      this.ponta.scale.setScalar(Math.max(0.001, r));
      this.ponta.material.opacity = 0.3 + u * 0.25;
      if (this.local) relato.luz(this.ox, this.oy, this.oz, S.cor, 0.35 * u);
      return false;
    }

    /* O DISPARO. */
    if (!this.saiu) {
      this.saiu = true;
      this.nucleo.visible = true;
      this.casca.visible = true;
      this.halo.visible = true;
      this.estourarBoca();
    }

    const tf = this.t - S.windup;
    /* A CABEÇA ANDA, e é ela que decide o comprimento — não mais `tf · speed`
       contra um alcance resolvido no disparo. O caminho pode ser mais longo que
       a reta, e o chão aparece quando a cabeça chega nele. */
    this.avancar(dt, tf, alvos);

    /* A CAUDA fica na mão durante a sustentação; depois persegue a cabeça com
       ease-in — devagar no começo (o feixe "estica") e rápido no fim (ele
       "some"). Uma corrida linear daria um traço encolhendo em velocidade
       constante, que lê como uma barra de progresso. */
    const dissipando = tf > S.sustain;
    if (dissipando) {
      const u = Math.min(1, (tf - S.sustain) / this.dissipacao);
      this.cauda = this.frente * u * u;
      if (u >= 1) {
        this.despejar(relato, true);
        return true;
      }
    }

    /* COMPRIMENTO ZERO SÓ MATA NA DISSIPAÇÃO.
     *
     * Isto já foi um bug, e vale escrever qual: no quadro em que a carga termina
     * `tf` pode ser exatamente zero — acontece sempre que `windup` é múltiplo do
     * passo, e 1,05 s é 63 quadros redondos a 60 Hz. O feixe nascia com zero de
     * comprimento, caía na guarda de "não sobrou nada" e MORRIA no quadro em que
     * deveria sair. Na tela: a pose de carga inteira, o clarão da boca, e nenhum
     * feixe.
     *
     * Enquanto ele sustenta, comprimento zero é o começo. Só quando a cauda
     * está perseguindo a cabeça é que zero significa acabou. */
    const comprimento = this.frente - this.cauda;
    if (dissipando && comprimento <= 0.01) {
      this.despejar(relato, true);
      return true;
    }
    if (comprimento > 0.01) {
      this.desenhar(tf, comprimento, dissipando);
      this.queimar(dt, alvos, localId, relato);
      this.bater(relato, localId, dt);
    }
    if (this.local) {
      const vivo = dissipando ? comprimento / Math.max(1e-3, this.frente) : 1;
      relato.luz(this.hx, this.hy, this.hz, S.cor, 0.85 * vivo);
    }
    return false;
  }

  /* ----------------------------------------------------------- a cabeça --- */

  /**
   * A cabeça gira, anda, e grava por onde passou.
   *
   * A ordem importa: gira ANTES de andar. Corrigir o rumo depois do passo
   * gravaria um nó na direção velha e faria a curva ficar um quadro atrás da
   * decisão — a 340 m/s, cinco metros e meio de atraso a cada correção.
   */
  avancar(dt, tf, alvos) {
    if (this.frente >= this.alcance) return;

    this.perseguir(dt, tf, alvos);

    const passo = Math.min(this.info.speed * dt, this.alcance - this.frente);
    if (passo <= 0) return;

    /* JÁ ESTÁ DENTRO DA ROCHA: o passo é simples (não há o que testar contra a
       superfície, ele está abaixo dela) e o trabalho é decidir quando sai e
       onde deixar o próximo buraco do corredor. */
    if (this.furando) {
      this.hx += this.hdir.x * passo;
      this.hy += this.hdir.y * passo;
      this.hz += this.hdir.z * passo;
      this.frente += passo;
      this.perfurar();
      this.gravar();
      return;
    }

    const nx = this.hx + this.hdir.x * passo;
    const ny = this.hy + this.hdir.y * passo;
    const nz = this.hz + this.hdir.z * passo;

    /* O CHÃO, em duas amostras. A 340 m/s a cabeça anda 5,7 m em 16 ms, e uma
       crista estreita cabe inteira entre dois quadros — é a mesma precaução que
       `passoDasBolas` toma no servidor, com o mesmo desenho. */
    const fatia = this.tocouChao(this.hx, this.hy, this.hz, nx, ny, nz, passo);
    if (fatia >= 0) {
      this.hx += this.hdir.x * fatia;
      this.hy += this.hdir.y * fatia;
      this.hz += this.hdir.z * fatia;
      this.frente += fatia;
      /* A BOCA. Guardada antes de qualquer decisão porque ela é o ponto do
         impacto — a cratera de entrada sai daqui, e as fagulhas continuam
         saindo daqui enquanto ele estiver enterrado. */
      this.bocaX = this.hx;
      this.bocaY = this.hy;
      this.bocaZ = this.hz;

      if (this.atravessa && this.perfurado < this.atravessa.alcance) {
        /* ELE NÃO PARA: entra. Ver `atravessar` no config. */
        this.furando = true;
        this.entrada = this.frente;
        this.proxFuro = this.frente + this.atravessa.passo;
      } else {
        this.alcance = this.frente;
        this.bateu = true;
      }
    } else {
      this.hx = nx;
      this.hy = ny;
      this.hz = nz;
      this.frente += passo;
    }
    this.gravar();
  }

  /**
   * Um passo DENTRO da rocha: mede o quanto já foi furado, enfileira o buraco
   * do corredor e decide se ele sai do outro lado ou se a montanha o segurou.
   *
   * A fila de crateras é a mesma que a boca usa (`relato.chao`), e é ela que
   * transforma "o feixe passou por aqui" em terreno de verdade nas duas pontas
   * da rede — cada buraco vira um `NC2S.GROUND_HIT`, a sala carimba, e todo
   * mundo vê o mesmo corredor. É por isso que a perfuração não precisa de uma
   * mensagem própria nem de um segundo caminho de sincronização.
   *
   * Três saídas, e as três importam:
   *
   * • **saiu** — a cabeça voltou a ficar acima do relevo. `furando` desliga e o
   *   feixe segue livre; se houver outro pico à frente, ele fura de novo. É
   *   assim que um tiro rasante atravessa dois morros em fila.
   * • **cansou** — gastou o orçamento de rocha (`atravessar.alcance`). A
   *   montanha ganhou: o feixe para ali dentro e explode enterrado, o que deixa
   *   um poço em vez de um corredor. É a leitura certa de "não foi fundo o
   *   bastante".
   * • **nem uma nem outra** — continua furando no quadro seguinte.
   */
  perfurar() {
    const T = this.atravessa;
    /* O orçamento é do DISPARO, e não de cada pico: `perfurado` é o que já foi
       gasto em entradas anteriores, e a entrada corrente soma por cima. Sem essa
       soma, um feixe rasante que raspa dez cristas gastaria o limite dez vezes e
       abriria meio quilômetro de vala. */
    const total = this.perfurado + (this.frente - this.entrada);

    if (this.frente >= this.proxFuro) {
      this.proxFuro += T.passo;
      this.furo = true; // consumido por `bater`, que é quem fala com o relato
    }

    if (this.hy > this.field.heightAt(this.hx, this.hz)) {
      // Saiu do outro lado. Fecha a conta desta entrada e segue livre.
      this.perfurado = total;
      this.furando = false;
      return;
    }
    if (total >= T.alcance) {
      this.perfurado = total;
      this.furando = false;
      this.alcance = this.frente;
      this.bateu = true;
    }
  }

  /**
   * A que distância deste passo a cabeça encosta no relevo, ou −1.
   *
   * SÓ O CHÃO PARA UM FEIXE. A tentação é recusar também o ponto em que o mundo
   * "acaba" (fora do círculo da arena, dentro do mar), e no jogo do arqueiro
   * isso custou um bug com nome e sobrenome — um feixe disparado a 45° parava no
   * vácuo, contra nada, com a bola de explosão inchando a duzentos metros de
   * altura. `heightAt` é definida em qualquer x e z, e o teste de altura sozinho
   * já cobre o rasante.
   */
  tocouChao(ax, ay, az, bx, by, bz, passo) {
    // Acima do relevo mais alto que existe não há o que perguntar ao campo, e
    // perguntar custa uma amostra de ruído por quadro por feixe.
    if (ay > TETO_DO_RELEVO && by > TETO_DO_RELEVO) return -1;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const mz = (az + bz) / 2;
    if (my <= this.field.heightAt(mx, mz)) {
      // Refina em meio metro: um erro de metros no ponto da explosão apareceria
      // como a bola de fogo enterrada no morro ou flutuando acima dele.
      for (let f = 0; f <= passo * 0.5; f += 0.5) {
        const y = ay + this.hdir.y * f;
        if (y <= this.field.heightAt(ax + this.hdir.x * f, az + this.hdir.z * f)) return f;
      }
      return passo * 0.5;
    }
    if (by <= this.field.heightAt(bx, bz)) {
      for (let f = passo * 0.5; f <= passo; f += 0.5) {
        const y = ay + this.hdir.y * f;
        if (y <= this.field.heightAt(ax + this.hdir.x * f, az + this.hdir.z * f)) return f;
      }
      return passo;
    }
    return -1;
  }

  /**
   * A CURVA. Ver o cabeçalho, e `NAMEK.specials.kamehameha.homing` para cada
   * número.
   *
   * As saídas são todas DEFINITIVAS — `alvo = null` e nunca mais. É a diferença
   * entre perseguir e teleguiar: um feixe que reengata porque a vítima voltou a
   * ficar na frente dele nunca deixa de ser uma ameaça, e o pedido é o oposto
   * disso ("se o Kamehameha passar o player… segue o trajeto reto, sem tentar
   * ficar fazendo curva mais").
   */
  perseguir(dt, tf, alvos) {
    const H = this.info.homing;
    if (!H || this.alvo === null) return;
    if (tf > H.duration) {
      this.alvo = null;
      return;
    }
    const a = alvoPorId(alvos, this.alvo);
    if (!a || a.vivo === false) {
      this.alvo = null;
      return;
    }

    const tx = a.x;
    const ty = a.y + a.altura * PEITO;
    const tz = a.z;

    /* PASSOU. O alvo ficou para trás do plano da cabeça — não é o cone
       expirando, que voltaria a valer se a vítima cruzasse na frente de novo. É
       o fim da perseguição, e o resto do feixe é reta. */
    const px = tx - this.hx;
    const py = ty - this.hy;
    const pz = tz - this.hz;
    if (px * this.hdir.x + py * this.hdir.y + pz * this.hdir.z <= 0) {
      this.alvo = null;
      return;
    }

    this.arco += perseguirPonto(
      this.hdir,
      tx,
      ty,
      tz,
      this.hx,
      this.hy,
      this.hz,
      Math.cos((H.cone * Math.PI) / 180),
      passoDeGiro(H, dt, this.arco),
    );
  }

  /**
   * Grava a posição da cabeça no caminho.
   *
   * O último nó é sempre o VIVO e é reescrito todo quadro — é o que mantém a
   * ponta do tubo grudada na cabeça em vez de a deixar tremendo um passo atrás
   * dela, que a 340 m/s são quase seis metros de folga bem visível. De
   * `PASSO_NO` em `PASSO_NO` metros ele é promovido a nó fixo e um novo nó vivo
   * nasce por cima dele.
   */
  gravar() {
    let i = (this.nPontos - 1) * 3;
    this.caminho[i] = this.hx;
    this.caminho[i + 1] = this.hy;
    this.caminho[i + 2] = this.hz;
    this.arcos[this.nPontos - 1] = this.frente;

    if (this.frente - this.arcoNo < PASSO_NO || this.nPontos >= MAX_PONTOS) return;
    this.arcoNo = this.frente;
    this.nPontos++;
    i += 3;
    this.caminho[i] = this.hx;
    this.caminho[i + 1] = this.hy;
    this.caminho[i + 2] = this.hz;
    this.arcos[this.nPontos - 1] = this.frente;
  }

  /**
   * O ponto do caminho que está a `s` metros de arco, interpolado.
   *
   * `k` entra e sai por referência (é devolvido) porque quem chama isto varre
   * arcos CRESCENTES: reaproveitando o segmento onde parou, a reamostragem
   * inteira é uma passada só pelos dois arrays em vez de 26 buscas binárias.
   */
  amostrar(s, k, saida, o) {
    while (k < this.nPontos - 2 && this.arcos[k + 1] < s) k++;
    const a0 = this.arcos[k];
    const a1 = this.arcos[k + 1];
    const u = a1 > a0 ? clamp01((s - a0) / (a1 - a0)) : 0;
    const i = k * 3;
    const j = i + 3;
    saida[o] = this.caminho[i] + (this.caminho[j] - this.caminho[i]) * u;
    saida[o + 1] = this.caminho[i + 1] + (this.caminho[j + 1] - this.caminho[i + 1]) * u;
    saida[o + 2] = this.caminho[i + 2] + (this.caminho[j + 2] - this.caminho[i + 2]) * u;
    return k;
  }

  /* ---------------------------------------------------------------- desenho */

  desenhar(tf, comprimento, dissipando) {
    const S = this.info;

    /* O AFINAMENTO. Na dissipação o raio cai junto com o que resta — e cai mais
       depressa que o comprimento, senão o feixe viraria um charuto grosso e
       curto em vez de um traço se apagando. */
    const restante = this.frente > 0 ? comprimento / this.frente : 1;
    const magro = dissipando ? Math.pow(restante, 0.65) : 1;
    // Pulso rápido na espessura: energia não é um tubo de PVC.
    const pulso = 1 + Math.sin(tf * 34) * 0.045;
    const k = magro * pulso * S.hitRadius;

    /* O VISUAL NASCE À FRENTE DAS MÃOS e o acerto continua nelas — daí o corte
       da cauda ser o maior entre ela e o recuo. Sem isto, o bico do traço sairia
       de dentro do punho e a câmera de terceira pessoa o veria por dentro.
       O `· 0,9` é o que impede o recuo de comer o feixe inteiro no primeiro
       quadro: um trecho de comprimento zero colapsaria os 26 anéis num ponto e
       piscaria como um disco na mão de quem atirou. */
    const de = Math.max(this.cauda, Math.min(RECUO_VISUAL, this.frente * 0.9));
    this.tecer(de, this.frente, k);

    this.ponta.position.set(this.hx, this.hy, this.hz);
    const p = magro * S.hitRadius * 1.25 * (1 + Math.sin(tf * 22) * 0.08);
    // Chegou ao fim com anteparo: a ponta VIRA a explosão, então ela cresce.
    this.ponta.scale.setScalar(
      this.frente >= this.alcance && this.bateu ? p * 1.9 : p,
    );

    /* SEM ANTEPARO, A PONTA SOME. O TUBO FICA.
     *
     * `frente` é limitada pelo alcance, então um tiro para o céu terminaria com
     * a esfera PARADA na cota máxima pelo resto da sustentação: um ponto de luz
     * estacionário no vácuo, que lê como "bati em alguma coisa invisível". Some
     * só ela, nos últimos metros. O tubo continua lá, atravessado no céu e
     * apontando para longe — que é o que se pede de uma coisa disparada contra
     * o espaço: ela vai embora, não termina em lugar nenhum. */
    if (!this.bateu) {
      const u = clamp01((this.frente - (this.alcance - SUMICO_PONTA)) / SUMICO_PONTA);
      this.ponta.material.opacity = 0.9 * (1 - u * u);
    }
  }

  /**
   * O TUBO VARRIDO. Reamostra o trecho visível em `NOS` anéis e reescreve as
   * três camadas.
   *
   * Os anéis são gastos entre CAUDA e CABEÇA, não pelo caminho inteiro, e é
   * essa escolha que faz 26 bastarem: no fim da dissipação sobram vinte metros
   * de feixe a poucos passos da câmera, e é justamente aí que uma amostragem
   * fixa no caminho todo teria dois anéis e um traço facetado.
   *
   * O REFERENCIAL DE CADA ANEL É TRANSPORTADO do anel anterior — projeta o `u`
   * de trás fora da nova tangente e renormaliza — em vez de ser reconstruído do
   * zero em cada nó (que é o que a fita do Galick Gun faz, e pode, porque ela é
   * plana). Reconstruir aqui deixaria o anel girar em torno do próprio eixo
   * entre um nó e o vizinho, e como os triângulos ligam o vértice `j` de um ao
   * vértice `j` do outro, o tubo sairia torcido em ampulheta nos trechos em que
   * a tangente passa perto da vertical. Transportado, não há torção nenhuma.
   */
  tecer(de, ate, k) {
    const span = ate - de;
    const passo = span / (NOS - 1);
    let seg = 0;
    for (let i = 0; i < NOS; i++) {
      seg = this.amostrar(de + passo * i, seg, _centro, i * 3);
    }

    let ux = 0;
    let uy = 0;
    let uz = 0;
    for (let i = 0; i < NOS; i++) {
      const i3 = i * 3;
      /* A tangente sai por diferença central entre os vizinhos. Nas duas pontas
         ela degenera numa diferença simples — que é o certo, e não uma exceção
         a tratar. */
      const a3 = (i > 0 ? i - 1 : 0) * 3;
      const b3 = (i < NOS - 1 ? i + 1 : NOS - 1) * 3;
      let tx = _centro[b3] - _centro[a3];
      let ty = _centro[b3 + 1] - _centro[a3 + 1];
      let tz = _centro[b3 + 2] - _centro[a3 + 2];
      const L = Math.hypot(tx, ty, tz);
      if (L < 1e-5) {
        tx = this.hdir.x;
        ty = this.hdir.y;
        tz = this.hdir.z;
      } else {
        tx /= L;
        ty /= L;
        tz /= L;
      }

      // Transporte: o `u` do anel anterior, reortogonalizado. No primeiro anel
      // (e se o transporte degenerar) qualquer perpendicular serve.
      let d = ux * tx + uy * ty + uz * tz;
      let px = ux - tx * d;
      let py = uy - ty * d;
      let pz = uz - tz * d;
      let pl = Math.hypot(px, py, pz);
      if (pl < 1e-4) {
        px = tz;
        py = 0;
        pz = -tx;
        pl = Math.hypot(px, py, pz);
        if (pl < 1e-4) {
          px = 0;
          py = -tz;
          pz = ty;
          pl = Math.hypot(px, py, pz) || 1;
        }
      }
      ux = px / pl;
      uy = py / pl;
      uz = pz / pl;
      const vx = ty * uz - tz * uy;
      const vy = tz * ux - tx * uz;
      const vz = tx * uy - ty * ux;

      _eixoU[i3] = ux;
      _eixoU[i3 + 1] = uy;
      _eixoU[i3 + 2] = uz;
      _eixoV[i3] = vx;
      _eixoV[i3 + 1] = vy;
      _eixoV[i3 + 2] = vz;
    }

    this.camada(this.nucleo, k * RAIO_NUCLEO);
    this.camada(this.casca, k * RAIO_CASCA);
    this.camada(this.halo, k * RAIO_HALO);
  }

  /** Escreve os anéis desta camada, com o raio dela. */
  camada(mesh, raio) {
    const attr = mesh.geometry.getAttribute("position");
    const p = attr.array;
    let o = 0;
    for (let i = 0; i < NOS; i++) {
      const i3 = i * 3;
      const cx = _centro[i3];
      const cy = _centro[i3 + 1];
      const cz = _centro[i3 + 2];
      const ux = _eixoU[i3];
      const uy = _eixoU[i3 + 1];
      const uz = _eixoU[i3 + 2];
      const vx = _eixoV[i3];
      const vy = _eixoV[i3 + 1];
      const vz = _eixoV[i3 + 2];
      const r = raio * PERFIL[i];
      for (let j = 0; j < LADOS; j++) {
        const c = COS_LADO[j] * r;
        const s = SEN_LADO[j] * r;
        p[o++] = cx + ux * c + vx * s;
        p[o++] = cy + uy * c + vy * s;
        p[o++] = cz + uz * c + vz * s;
      }
    }
    attr.needsUpdate = true;
  }

  /* ------------------------------------------------------------------- dano */

  /**
   * Quem está dentro do trecho VIVO do feixe, e por quanto tempo.
   *
   * Contra o CAMINHO, segmento por segmento, e não contra um eixo — foi a outra
   * metade que teve de mudar quando o feixe passou a curvar. Um feixe que
   * contorna e cobra pela reta original erra na conta exatamente aquilo que
   * acertou na tela, e erra nos dois sentidos: passa por cima de quem ele
   * pegou e queima quem ele não encostou.
   *
   * O teste é do PEITO contra a linha, e não da cápsula inteira: com um raio de
   * morte de 3,6 m contra um corpo de 1,78 m, a diferença entre as duas contas
   * é menor que a espessura do halo. É a mesma aproximação que o
   * `systems/special.js` do arqueiro faz, e pelo mesmo motivo.
   *
   * O custo é 48 segmentos por alvo, e ele só é pago UMA vez por quadro na
   * máquina inteira: só quem atirou julga o próprio acerto (§8 do plano), e os
   * feixes dos outros são desenhados, não arbitrados.
   */
  queimar(dt, alvos, localId, relato) {
    if (this.owner !== localId) return;
    const raio = this.info.hitRadius;
    for (let k = 0; k < alvos.length; k++) {
      const a = alvos[k];
      if (!atingivel(a, this.owner)) continue;
      if (this.distanciaAoCaminho(a.x, a.y + a.altura * PEITO, a.z, raio) > raio) continue;
      this.acumular(a.id, dt);
    }

    this.tAviso += dt;
    if (this.tAviso >= AVISO) this.despejar(relato, false);
  }

  /**
   * Distância de um ponto ao trecho vivo do caminho.
   *
   * `corte` é uma saída antecipada, não uma aproximação: quem chama já vai
   * comparar com o raio de morte, então o primeiro segmento que entra nele
   * decide a questão e os outros 47 não precisam ser medidos.
   */
  distanciaAoCaminho(x, y, z, corte) {
    let melhor = Infinity;
    for (let i = 0; i < this.nPontos - 1; i++) {
      const a1 = this.arcos[i + 1];
      if (a1 <= this.cauda) continue; // já dissipado: este trecho não mata mais
      const a0 = this.arcos[i];
      if (a0 >= this.frente) break; // à frente da cabeça: ainda não existe

      const i3 = i * 3;
      const ax = this.caminho[i3];
      const ay = this.caminho[i3 + 1];
      const az = this.caminho[i3 + 2];
      let sx = this.caminho[i3 + 3] - ax;
      let sy = this.caminho[i3 + 4] - ay;
      let sz = this.caminho[i3 + 5] - az;
      const L = Math.hypot(sx, sy, sz);
      if (L < 1e-4) continue;
      sx /= L;
      sy /= L;
      sz /= L;

      /* As pontas do segmento aparadas pela cauda e pela cabeça — é o que faz o
         trecho já dissipado deixar de matar, e o que impede a cabeça de queimar
         alguém que ela ainda não alcançou. Em arco, não em metros de reta: os
         dois coincidem dentro de um segmento. */
      const de = this.cauda > a0 ? this.cauda - a0 : 0;
      const ate = this.frente < a1 ? this.frente - a0 : L;
      const d = distanciaAoFeixe(ax, ay, az, sx, sy, sz, de, ate, x, y, z);
      if (d < melhor) {
        melhor = d;
        if (melhor <= corte) return melhor;
      }
    }
    return melhor;
  }

  acumular(id, dt) {
    for (let i = 0; i < this.nVitimas; i++) {
      if (this.vitimaId[i] === id) {
        this.vitimaSeg[i] += dt;
        return;
      }
    }
    if (this.nVitimas >= MAX_VITIMAS) return;
    this.vitimaId[this.nVitimas] = id;
    this.vitimaSeg[this.nVitimas] = dt;
    this.nVitimas++;
  }

  /** Despeja a exposição acumulada e zera a tabela. */
  despejar(relato, fim) {
    this.tAviso = 0;
    for (let i = 0; i < this.nVitimas; i++) {
      if (this.vitimaSeg[i] <= 0) continue;
      const e = relato.queima();
      e.owner = this.owner;
      e.victim = this.vitimaId[i];
      e.kind = this.kind;
      e.dt = this.vitimaSeg[i];
    }
    this.nVitimas = 0;
    if (fim) this.viva = false;
  }

  /* ------------------------------------------------------------------ o chão */

  /**
   * A cabeça encostou no chão.
   *
   * UMA cratera por feixe, no quadro em que ela chega — e as fagulhas continuam
   * saindo enquanto o feixe estiver apoiado. Pulsar a cratera junto com as
   * fagulhas seria vinte buracos no mesmo ponto e o teto de 96 gasto num golpe
   * (`NAMEK.destruction.craterLimit`); e como as crateras se somam no
   * `heightAt`, o resultado nem sequer seria um buraco maior — seria o mesmo
   * buraco, cobrado vinte vezes.
   */
  bater(relato, localId, dt) {
    const encostado = this.bateu || this.furando;
    if (!encostado) return;
    const meu = this.owner === localId;

    /* A CRATERA DE ENTRADA — a boca. Uma só, no quadro em que a cabeça toca o
       relevo pela primeira vez, e com o multiplicador de fundura do golpe
       (`craterDeep`): é ela que faz o Kamehameha abrir um poço em vez de amassar
       o chão. Ver `NAMEK.specials.kamehameha.craterDeep`. */
    if (!this.reportouChao) {
      this.reportouChao = true;
      if (meu) {
        const e = relato.chao();
        e.owner = this.owner;
        e.p.x = this.bocaX || this.hx;
        e.p.y = this.bocaY || this.hy;
        e.p.z = this.bocaZ || this.hz;
        e.power = this.info.power;
        e.fundo = this.info.craterDeep ?? 1;
        e.kind = this.kind;
      }
    }

    /* O CORREDOR. Um buraco a cada `atravessar.passo` metros de rocha, na
       posição da cabeça — e é a soma deles, sobrepostos, que vira a vala por
       onde se voa. A potência é menor que a da boca de propósito: a entrada é a
       cratera cheia, o corredor é o rastro dela. */
    if (this.furo) {
      this.furo = false;
      if (meu && this.atravessa) {
        const e = relato.chao();
        e.owner = this.owner;
        e.p.x = this.hx;
        e.p.y = this.hy;
        e.p.z = this.hz;
        e.power = this.info.power * this.atravessa.potencia;
        e.fundo = this.info.craterDeep ?? 1;
        e.kind = this.kind;
      }
    }

    /* FAGULHA, NÃO NUVEM. O impacto SUSTENTA: a cada 0,12 s sai um sopro novo, e
       em 2,4 s de feixe isso são vinte sopros no mesmo ponto. Poeira grande ali
       vira uma cortina opaca e quem atirou perde de vista a única coisa que a
       ponta precisa comunicar: ONDE ela acertou. Fagulha pequena, meio segundo
       de vida, quase sem crescer — o ponto continua aceso e legível. */
    this._imp -= dt;
    if (this._imp > 0) return;
    this._imp = 0.12;
    /* ENQUANTO ELE FURA, AS FAGULHAS SAEM DA BOCA e não da cabeça: a cabeça está
       dentro da montanha, e um sopro de partículas lá dentro é um sopro que
       ninguém vê. Da boca, ele lê como o que de fato está acontecendo — o feixe
       entrou ali e está cuspindo rocha de volta. */
    const fx = this.furando ? this.bocaX : this.hx;
    const fy = this.furando ? this.bocaY : this.hy;
    const fz = this.furando ? this.bocaZ : this.hz;
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: fx, y: fy, z: fz },
      count: 10,
      color: this.info.cor,
      speed: 26,
      spread: 1,
      size: this.info.hitRadius * 0.06,
      grow: 1.4,
      life: 0.5,
      gravity: NAMEK.fighter.gravity * 0.2,
      drag: 0.6,
      alpha: 1,
      additive: true,
    });
  }

  /** O clarão no instante em que o feixe sai da mão. */
  estourarBoca() {
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.ox, y: this.oy, z: this.oz },
      count: 30,
      color: this.info.cor,
      speed: 24,
      spread: 0.55,
      direction: { x: this.dx, y: this.dy, z: this.dz },
      size: this.info.hitRadius * 0.2,
      grow: 2.2,
      life: 0.5,
      gravity: 0,
      drag: 2.2,
      alpha: 1,
      additive: true,
    });
  }

  /* ----------------------------------------------------------- o embate ---
     Os três ganchos da colisão poder-contra-poder. A regra mora em
     `powers/colisao.js`; o que está aqui é o mínimo que só este arquivo sabe
     fazer — onde o feixe ESTÁ e como ele morre. */

  /** Ainda é a esfera entre as mãos? Ver a regra 4 em `NAMEK.embate`. */
  get carregando() {
    return this.viva && this.t < this.info.windup;
  }

  /**
   * A distância de um ponto ao feixe — **ao caminho, não à cabeça.**
   *
   * O feixe é a única coisa deste modo que não é uma esfera: ele é uma cobra de
   * até 620 m, e um Galick Gun que atravessa o meio do tubo tem de encontrar
   * feixe ali. É a mesma conta do dano (`distanciaAoCaminho`), com duas coisas
   * a mais:
   *
   * • durante a carga não HÁ caminho — o caminho tem dois nós no mesmo ponto e
   *   comprimento zero, e `distanciaAoCaminho` devolveria `Infinity` para uma
   *   esfera que está bem ali, na mão. Nessa fase a resposta é a distância à
   *   bola de carga;
   * • um pré-filtro de esfera envolvente. O caminho inteiro cabe na esfera
   *   centrada na boca do golpe com raio `frente`, então a distância ao caminho
   *   nunca é menor que `d(boca) − frente`. Quando esse piso já passa do corte,
   *   os 48 segmentos são dispensados por uma raiz quadrada — e isso acontece
   *   para quase todas as bolas de ki em voo, que é onde este teste é chamado
   *   centenas de vezes por quadro.
   *
   * @param {number} corte a distância acima da qual quem chama já perdeu o
   *   interesse. É repassada ao corte antecipado do teste de caminho.
   */
  distanciaDoEmbate(x, y, z, corte) {
    const dx = x - this.ox;
    const dy = y - this.oy;
    const dz = z - this.oz;
    const dBoca = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (this.t < this.info.windup) return dBoca;
    const piso = dBoca - this.frente;
    if (piso > corte) return piso;
    return this.distanciaAoCaminho(x, y, z, corte);
  }

  /**
   * O feixe foi INTERCEPTADO por outro poder.
   *
   * Dois desfechos, e a diferença é a fase:
   *
   * • **na carga**, ele simplesmente deixa de existir — não há feixe para
   *   dissipar, há uma bola nas mãos que foi anulada. Quem paga é quem
   *   carregava: a barra já foi gasta em `soltarEspecial` e não volta, que é
   *   exatamente o "quem carregava perde a barra" do pedido;
   * • **em voo**, ele entra em DISSIPAÇÃO em vez de sumir. A energia parou de
   *   sair da mão e o que sobrou no ar corre para a frente e apaga — que é o
   *   que o próprio arquivo já sabe desenhar (ver `FRACAO_DISSIPACAO`). Um tubo
   *   de meio quilômetro que pisca para fora de existência num quadro é a
   *   leitura de bug, não de golpe abatido.
   *
   * A exposição acumulada é DESPEJADA antes de qualquer coisa: o que este feixe
   * já queimou até aqui é dano legítimo e a sala precisa ouvir a respeito, ou
   * até meio segundo de fritura desapareceria por causa da interceptação.
   */
  abortarPorEmbate(relato) {
    if (!this.viva || this.abatido) return false;
    const S = this.info;
    if (this.t < S.windup) {
      this.apagar();
      return true;
    }
    this.abatido = true;
    this.despejar(relato, false);
    /* A cabeça para onde foi interceptada e a cauda começa a correr: `t` é
       empurrado para o fim da sustentação, que é o gatilho que `update` já usa
       para começar a dissipar. Nada mais precisa saber que houve um embate. */
    this.t = S.windup + S.sustain;
    this.alcance = this.frente;
    /* `bateu` liga a bola de impacto na ponta — a cabeça encontrou ALGO, e é o
       que se quer ver no ponto da interceptação. Mas ele também é meia chave do
       `bater`, que abriria uma cratera ali; e "ali" é o ar, a duzentos metros do
       chão. `reportouChao` é a outra meia chave, e marcá-la aqui é o que fecha
       a porta: quem decide se aquele ponto merece cratera é o árbitro do embate
       (`ColisorDePoderes.detonar`), que tem a altura do relevo na mão e a régua
       de `NAMEK.embate.craterAr` para consultar. */
    this.bateu = true;
    this.reportouChao = true;
    this.furando = false;
    return true;
  }

  apagar() {
    this.viva = false;
    this.abatido = false;
    this.group.visible = false;
    this.nVitimas = 0;
  }

  dispose() {
    this.scene.remove(this.group);
    /* A BOLA e o ÍNDICE são do pool e servem os seis feixes — quem os descarta é
       ele. Aqui morre o que é próprio deste feixe: os quatro materiais e as três
       geometrias de tubo, que existem uma por camada porque os vértices delas
       são o caminho deste golpe. */
    this.nucleo.geometry.dispose();
    this.casca.geometry.dispose();
    this.halo.geometry.dispose();
    this.nucleo.material.dispose();
    this.casca.material.dispose();
    this.halo.material.dispose();
    this.ponta.material.dispose();
  }

  /** s — quanto a cauda leva para alcançar a cabeça. Ver `FRACAO_DISSIPACAO`. */
  get dissipacao() {
    return this.info.sustain * FRACAO_DISSIPACAO;
  }
}

/* ============================================================================
   O pool
   ========================================================================== */

export class BeamPool {
  constructor(scene, field, max = MAX_FEIXES) {
    this.scene = scene;
    this.field = field;

    /* UM índice e UMA bola para todos os feixes que a partida vier a ter. A
       topologia do tubo não depende do caminho, então as 1 800 entradas do
       índice são as mesmas para as dezoito camadas em cena — e gerá-las no
       disparo custaria um envio para a GPU no exato quadro em que a tela tem
       mais coisa acontecendo, que é o pior momento possível para alocar. */
    const idx = new Uint16Array((NOS - 1) * LADOS * 6);
    let o = 0;
    for (let i = 0; i < NOS - 1; i++) {
      for (let j = 0; j < LADOS; j++) {
        const j2 = (j + 1) % LADOS;
        const a = i * LADOS + j;
        const b = i * LADOS + j2;
        const c = (i + 1) * LADOS + j;
        const d = (i + 1) * LADOS + j2;
        idx[o++] = a;
        idx[o++] = c;
        idx[o++] = b;
        idx[o++] = b;
        idx[o++] = c;
        idx[o++] = d;
      }
    }
    this.geos = {
      indices: new THREE.BufferAttribute(idx, 1),
      bola: new THREE.SphereGeometry(1, 16, 12),
    };

    this.feixes = new Array(max);
    for (let i = 0; i < max; i++) this.feixes[i] = new Feixe(scene, this.geos);
  }

  /** @returns {Feixe|null} */
  disparar(disparo) {
    const S = NAMEK.specials[disparo.kind];
    // Só quem tem dano por segundo é feixe. O roteamento de verdade está em
    // `PowerSystem.spawnSpecial`; isto é a rede de segurança.
    if (!S || S.dps === undefined) return null;
    return pegarVaga(this.feixes).acender(this.field, disparo);
  }

  update(dt, alvos, localId, relato) {
    for (let i = 0; i < this.feixes.length; i++) {
      const f = this.feixes[i];
      if (!f.viva) continue;
      if (f.update(dt, alvos, localId, relato)) f.apagar();
    }
  }

  get count() {
    let n = 0;
    for (let i = 0; i < this.feixes.length; i++) if (this.feixes[i].viva) n++;
    return n;
  }

  clear() {
    for (let i = 0; i < this.feixes.length; i++) this.feixes[i].apagar();
  }

  dispose() {
    for (let i = 0; i < this.feixes.length; i++) this.feixes[i].dispose();
    this.geos.bola.dispose();
  }
}
