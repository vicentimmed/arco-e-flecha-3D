/* ---------------------------------------------------------------------------
   A câmera de Namekusei — terceira pessoa com o caráter do BT3.

   O molde é a `CameraRig` do arqueiro (`systems/camera.js`) e a regra de ouro
   de lá vale aqui inteira: **quem manda na mira é o eixo óptico**. Aquele
   arquivo levou duas iterações para descobrir que apontar a câmera para o ponto
   devolvido por um raio faz a imagem tremer, porque a distância do ponto entra
   na conta do ângulo. Aqui o mesmo cuidado aparece de outro jeito: a câmera
   olha para um ponto de convergência FIXO à frente do lutador, e `aimDirection`
   é exatamente `olhar − posição`. Mira e imagem não podem divergir, porque são
   a mesma conta.

   O que é diferente do arqueiro, e é o modo inteiro:

   • **Ela ABRE na arrancada.** Recua cinco metros e alarga o campo de visão em
     treze graus. Não é enfeite: 64 m/s com o mesmo enquadramento de 26 m/s lê
     como o mundo passando rápido, não como VOCÊ indo rápido. A sensação de
     velocidade num jogo 3D é quase toda periferia e distância focal.
   • **Ela INCLINA na curva.** Um giro rápido roda a câmera um pouco no eixo da
     vista. Poucos graus — o suficiente para o horizonte reagir.
   • **No lock-on ela enquadra os DOIS.** Sai de trás do lutador na linha que o
     liga ao alvo e afasta conforme eles se separam, que é o único jeito de
     manter os dois no quadro sem trocar de lente.
   • **Ela não atravessa o chão.** O braço encurta quando o relevo sobe entre a
     câmera e o corpo, e a lente tem piso no terreno. Uma câmera dentro da
     montanha é meio segundo de tela preta em plena briga.

   ---------------------------------------------------- o retículo, e onde ele fica

   SEM trava: `aimPoint` está no eixo óptico, e o retículo é o centro da tela.
   COM trava: `aimPoint` é o ALVO — que é a razão de existir da trava —, e o
   enquadramento fica no meio do caminho entre os dois. Então o retículo **não**
   é o centro da tela: quem desenha o HUD tem de projetar `aimPoint`. É o mesmo
   contrato que qualquer jogo com trava tem, e está escrito aqui porque a
   alternativa (retículo no centro, tiro no alvo) é uma mira que mente.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../shared/namek/config.js";
import { clamp, damp, smoothstep } from "../utils/math.js";

const GRAU = Math.PI / 180;

/* ------------------------------------------------------------- o braço ----- */
/** m — distância atrás do peito em voo de cruzeiro. */
const DISTANCIA = 6.6;
/** m — quanto o braço cresce na arrancada. */
const DISTANCIA_BOOST = 5.2;
/** m — a lente acima do peito. */
const ALTURA = 1.35;
/** m — deslocamento lateral. Pequeno: aqui se briga em todas as direções, e um
 *  ombro tão marcado quanto o do arqueiro tira o alvo do centro na hora errada. */
const LADO = 0.55;
/** Fração do braço que o quadro fecha com os pés no chão. */
const FECHO_SOLO = 0.22;

/* --------------------------------------------------------- amortecimento --- */
/** 1/s — a lente perseguindo a pose desejada. Nem rígida (o corpo treme junto)
 *  nem lenta (a 64 m/s a câmera ficaria para trás e o lutador sairia do quadro). */
const SUAV_POSICAO = 9;
/** 1/s — o ponto para onde ela olha. Quase instantâneo de propósito: é ele que
 *  define a MIRA, e mira com atraso é mira errada. O pouco que sobra existe só
 *  para filtrar o tremor de um quadro. */
const SUAV_OLHAR = 24;
/** Fração do atraso de regime que a antecipação cancela. Ver `update`. */
const ANTECIPACAO = 0.8;

/** m — a que distância o eixo óptico converge com o olhar do lutador. Na faixa
 *  em que este modo briga (a rajada alcança ~80 m antes de a vida acabar). */
const CONVERGENCIA = 60;

/* ------------------------------------------------------------ o terreno ---- */
/**
 * m — folga mínima entre a lente e o chão.
 *
 * **PRECISA SER MENOR QUE `NAMEK.fighter.chest` (1,15 m).** Não é margem de
 * segurança: é uma condição de coerência, e violá-la quebrava a câmera inteira
 * no chão.
 *
 * O pivô do braço é o PEITO, a 1,15 m dos pés. Com a folga em 1,4 m, o próprio
 * pivô estava "dentro do chão" pelo critério do teste — e como o braço sobe só
 * `ALTURA` ao longo de todo o percurso, a PRIMEIRA amostra (a 1/6 do caminho,
 * a 1,375 m) já nascia reprovada em chão perfeitamente plano. `_encurtarBraco`
 * então recuava para a amostra anterior, que é o índice zero: **a lente colapsava
 * para dentro da cabeça do personagem, sempre, em 100 % do chão plano.** Medido:
 * 6,6 m viravam 1,40 m, e o quadro mostrava o interior do crânio.
 *
 * 0,75 m deixa a lente rente sem encostar, e mantém a primeira amostra folgada.
 */
const FOLGA_CHAO = 0.75;
/** Amostras ao longo do braço no teste contra o relevo. Seis bastam para um
 *  braço de doze metros: a feição mais estreita do relevo tem dezenas de metros. */
const AMOSTRAS = 6;
/**
 * Fração do braço abaixo da qual encurtar deixa de resolver nada.
 *
 * A segunda metade do mesmo defeito: mesmo com a folga corrigida, uma ladeira
 * subindo ATRÁS do lutador ainda reprova as primeiras amostras, e recuar até o
 * índice zero põe a lente no peito dele de novo — só que agora numa encosta, que
 * é onde o jogador menos pode se dar ao luxo de não se ver.
 *
 * Com piso, o braço para de encurtar em 40 % e quem resolve o resto é o
 * `_pisoDoTerreno`: a lente SOBE por cima do morro e olha o lutador de cima.
 * Enquadramento pior que o normal, e é para ser — mas com o personagem no quadro,
 * que é a única coisa inegociável.
 */
const BRACO_MINIMO = 0.4;

/* -------------------------------------------------------------- caráter ---- */
/** graus de campo de visão a mais na arrancada. */
const FOV_BOOST = 13;
/** rad ≈ 11° — teto da inclinação da câmera na curva. */
const ROLL_MAX = 0.19;
/** rad por (rad/s) de giro. */
const ROLL_GANHO = 0.055;
/** 1/s — suavização da inclinação. */
const ROLL_SUAV = 5;
/** m de deslocamento da lente para `shake(1, …)`. Ver `shake`: a força que
 *  chega é intensidade, não distância, e 0,35 m a sete metros do corpo são
 *  três graus de ângulo — soco, não enjoo. */
const TREMOR_AMPLITUDE = 0.35;

/* --------------------------------------------------------------- trava -----
 *
 * Os números moram em `NAMEK.lock.camera` agora, e não mais aqui, porque
 * deixaram de ser "constantes de tato da lente" e viraram a regra de
 * enquadramento do modo — a mesma que `lockon.js` e o HUD leem. Ver o bloco
 * `lock` do config, que tem o argumento de cada um.
 *
 * O QUE MUDOU, e é a mudança mais funda que este arquivo já teve:
 *
 * A câmera antiga ia para cima da LINHA que liga o lutador ao alvo e olhava
 * para um ponto a 42 % do caminho. O resultado é o que o pedido descreve como
 * o que não se quer: voar de lado mostrava o lutador de perfil cruzando a tela,
 * e dar a volta no inimigo girava a lente na mesma velocidade angular do
 * jogador. Era câmera presa ao inimigo.
 *
 * Agora são três peças, e nenhuma delas aponta para o alvo:
 *
 * 1. **O BRAÇO MISTURA** o olhar do próprio lutador com a linha até o alvo, e a
 *    mistura depende da distância (`alinhaPerto`/`alinhaLonge`). Colado, a lente
 *    fica atrás de QUEM O JOGADOR CONTROLA — ele manobra, ela vai junto; longe,
 *    ela se alinha com a linha, que é o único jeito de os dois caberem.
 * 2. **A ZONA MORTA.** O ponto de interesse só arrasta a lente quando sai de um
 *    cone de `zona` graus em torno de onde ela já olha — e aí só o bastante para
 *    voltar à borda do cone. É isto que faz o alvo poder derivar pela tela sem
 *    a imagem ir junto.
 * 3. **O TETO DE GIRO** (`giroMax`). A lente não acompanha um giro brusco: ela
 *    fica para trás de propósito e alcança depois.
 */

export class NamekCamera {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {import("../shared/namek/field.js").NamekField} field
   */
  constructor(camera, field) {
    this.camera = camera;
    this.field = field;

    /** Pose atual, já amortecida. */
    this.position = new THREE.Vector3();
    /** Ponto para onde a lente aponta. */
    this.lookAt = new THREE.Vector3();
    /**
     * ONDE O TIRO VAI. Sem trava é o ponto de convergência no eixo óptico; com
     * trava é o alvo. Quem desenha o retículo projeta ISTO. Ver o cabeçalho.
     */
    this.aimPoint = new THREE.Vector3();

    /** Ângulos que apontam o CORPO para o alvo travado. Quem quiser que o
     *  lutador vire junto escreve `fighter.yaw = camera.lockYaw` (ou amortece
     *  até lá) — a câmera não mexe no corpo de ninguém. */
    this.lockYaw = 0;
    this.lockPitch = 0;

    this.baseFov = camera.fov;
    this._fov = camera.fov;

    this._boost = 0;
    /** 0 voando … 1 com os pés no chão. Ver `FECHO_SOLO`. */
    this._solo = 1;
    /** graus de campo de visão que a velocidade crua acrescenta. */
    this._fovVel = 0;
    this._roll = 0;
    this._yawAnterior = null;

    /* Tremor: amplitude, relógio e o que resta de duração. `_tremorTotal` nasce
       ZERO, e isso importa — ele é o denominador da rampa de saída, e um valor
       inicial "seguro" de 1 fazia todo tremor mais curto que um segundo sair
       com um décimo da força pedida (0,35 s / 1 s, ao quadrado, é 0,12). */
    this._tremorAmp = 0;
    this._tremorT = 0;
    this._tremorTotal = 0;
    this._tremorRelogio = 0;

    this._iniciada = false;

    /* Rascunhos. Uma alocação na construção, zero por quadro — a mesma
       disciplina de `CameraRig` e do orçamento do §3 do plano. */
    this._desejada = new THREE.Vector3();
    this._olhar = new THREE.Vector3();
    this._pivo = new THREE.Vector3();
    /* Os rascunhos da TRAVA. `_olharTrava` é o único deles que tem MEMÓRIA: ele
       é o ponto que a zona morta segura entre um quadro e o outro, e é a razão
       de a lente ficar parada enquanto o alvo deriva. Os outros quatro são
       contas do quadro. */
    this._olharTrava = new THREE.Vector3();
    this._alvoOlhar = new THREE.Vector3();
    this._enquadre = new THREE.Vector3();
    this._linha = new THREE.Vector3();
    this._eixo = new THREE.Vector3();
    this._dirA = new THREE.Vector3();
    this._dirB = new THREE.Vector3();
    /** A trava está viva desde o quadro anterior? Ver `_enquadrarTrava`. */
    this._travaViva = false;
    /** rad — o quanto o alvo está fora da direção da lente. Alimenta o FOV. */
    this._desvioTrava = 0;
    /** graus de campo de visão que a trava acrescenta neste quadro. */
    this._fovTrava = 0;
    this._frente = new THREE.Vector3(0, 0, -1);
    this._direita = new THREE.Vector3(1, 0, 0);
    this._cima = new THREE.Vector3(0, 1, 0);
    this._mundoCima = new THREE.Vector3(0, 1, 0);
    this._aim = new THREE.Vector3(0, 0, -1);
  }

  /**
   * @param {object} alvo `{ position, yaw, pitch, velocity, flying, boosting }`
   *   — um `FighterController` serve como está: os campos têm os mesmos nomes.
   * @param {object|null} lockTarget `{x,y,z}` de quem está travado, ou null.
   */
  update(dt, alvo, lockTarget) {
    if (!alvo) return;
    const passo = clamp(dt, 0, 0.1);
    const F = NAMEK.fighter;

    /* O PIVÔ É O PEITO, não os pés. `position` é a base da cápsula (a mesma
       convenção do arqueiro e da rede); girar a câmera em torno dos pés faz o
       corpo balançar dentro do quadro a cada olhada para baixo. */
    const p = alvo.position;
    this._pivo.set(p.x, p.y + F.chest, p.z);

    const yaw = alvo.yaw ?? 0;
    const pitch = alvo.pitch ?? 0;
    const cp = Math.cos(pitch);
    this._frente.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    if (this._frente.lengthSq() < 1e-8) this._frente.set(0, 0, -1);
    else this._frente.normalize();

    this._direita.crossVectors(this._frente, this._mundoCima);
    if (this._direita.lengthSq() < 1e-8) this._direita.set(1, 0, 0);
    else this._direita.normalize();
    this._cima.crossVectors(this._direita, this._frente).normalize();

    /* A ABERTURA. `boosting` é um booleano e a câmera precisa de uma rampa: sem
       ela, a lente saltaria cinco metros no quadro em que o botão desce. Sobe
       mais rápido do que desce — o arranque é um susto, a volta é um alívio. */
    const querBoost = alvo.boosting === true;
    this._boost = damp(this._boost, querBoost ? 1 : 0, querBoost ? 6 : 2.6, passo);

    /* A velocidade CRUA também abre a lente, um pouco. É o que faz um mergulho
       sem boost — cair de 400 m apontado para baixo — respirar junto, em vez de
       parecer o mesmo voo de sempre com o chão chegando. */
    const v = alvo.velocity;
    /* Sem `Math.hypot`: variádico, ele aloca no V8 — ver a nota no topo de
       `movement.js`. Aqui é uma vez por quadro, mas a regra é a mesma. */
    const vel = v ? Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) : 0;
    this._fovVel = clamp(vel / F.boostSpeed, 0, 1) * 5;

    /* NO CHÃO O QUADRO FECHA. A briga de solo acontece a poucos metros e a
       arena vira um corredor de rochas; o mesmo braço do voo livre passaria
       metade do tempo encostando no relevo — e o `_encurtarBraco` resolvendo
       isso a cada passo é a câmera pulsando. Amortecido como todo o resto:
       decolar não pode empurrar a lente dois metros num quadro. */
    this._solo = damp(this._solo, alvo.flying ? 0 : 1, 4, passo);
    const distancia =
      (DISTANCIA + DISTANCIA_BOOST * this._boost) * (1 - this._solo * FECHO_SOLO);

    if (lockTarget) {
      this._enquadrarTrava(alvo, lockTarget, distancia, passo);
    } else {
      /* A trava caiu: o ponto que a zona morta guardava não vale mais nada, e
         guardá-lo faria a próxima trava começar mirando onde a anterior parou —
         um salto de lente no instante em que o jogador aperta a tecla. */
      this._travaViva = false;
      this._fovTrava = 0;
      this._desvioTrava = 0;
      this._enquadrarLivre(distancia);
    }

    /* ANTECIPAÇÃO — e sem ela o enquadramento inteiro é uma mentira.
     *
     * Uma lente amortecida que persegue um alvo em movimento fica atrasada em
     * `v / k` metros PARA SEMPRE: não é transitório, é o regime. A 64 m/s com
     * k = 9 isso são 10,7 m — medido — e o braço de 11,8 m que os números
     * acima descrevem virava 22 m na tela, com o lutador reduzido a um terço
     * do tamanho durante a arrancada inteira. As constantes deixavam de mandar
     * no quadro; quem mandava era o amortecimento.
     *
     * Somar `v / k` ao destino cancela o atraso exatamente. Cancela-se 80 %, e
     * os 20 % que sobram são de propósito: eles são o único atraso que se QUER
     * — a lente recuando no instante em que o boost acende e voltando quando
     * ele apaga. Velocidade constante já não afasta mais ninguém. */
    /* `v` é o mesmo `alvo.velocity` lido lá em cima, para o FOV. */
    if (v) {
      const k = ANTECIPACAO / SUAV_POSICAO;
      this._desejada.x += v.x * k;
      this._desejada.y += v.y * k;
      this._desejada.z += v.z * k;
    }

    /* Nada de lente dentro do morro. Duas defesas, e as duas são necessárias: o
       braço encurta quando o relevo sobe ENTRE a câmera e o corpo, e a lente
       tem piso onde ela for parar. Só a segunda deixaria a câmera subir a
       encosta e olhar o lutador por cima de uma crista; só a primeira deixaria
       a lente afundar num buraco na vertical. */
    this._encurtarBraco();
    this._pisoDoTerreno(this._desejada);

    if (!this._iniciada) {
      this.position.copy(this._desejada);
      this.lookAt.copy(this._olhar);
      this._iniciada = true;
    } else {
      const k = SUAV_POSICAO;
      this.position.x = damp(this.position.x, this._desejada.x, k, passo);
      this.position.y = damp(this.position.y, this._desejada.y, k, passo);
      this.position.z = damp(this.position.z, this._desejada.z, k, passo);
      this.lookAt.x = damp(this.lookAt.x, this._olhar.x, SUAV_OLHAR, passo);
      this.lookAt.y = damp(this.lookAt.y, this._olhar.y, SUAV_OLHAR, passo);
      this.lookAt.z = damp(this.lookAt.z, this._olhar.z, SUAV_OLHAR, passo);
    }
    /* A posição amortecida também pode ter afundado (o corpo desceu e a lente
       ainda está no meio do caminho). O piso vale para ela também. */
    this._pisoDoTerreno(this.position);

    /* O EIXO ÓPTICO, guardado ANTES do tremor. Tremor é imagem, não mira: um
       raio soltando poeira na tela não pode entortar o tiro de ninguém. */
    this._aim.copy(this.lookAt).sub(this.position);
    if (this._aim.lengthSq() < 1e-8) this._aim.copy(this._frente);
    else this._aim.normalize();

    this._inclinar(passo, yaw);
    this._aplicar(passo);
  }

  /**
   * Tremor: raio da tempestade, explosão perto, baque de pouso.
   *
   * @param {number} forca 0 … 1, onde **1 é um baque forte** — a Genki Dama no
   *   chão a vinte metros. Não é metro: metro é o que `TREMOR_AMPLITUDE`
   *   converte, e a conversão existe porque a lente fica a sete metros do
   *   corpo — meio metro de sacudida ali são quatro graus de ângulo, que é
   *   enjoo, não impacto. Quem chama pensa em INTENSIDADE, não em geometria.
   * @param {number} duracao s
   */
  shake(forca, duracao = 0.4) {
    if (!(forca > 0) || !(duracao > 0)) return;
    /* O maior manda, e o relógio não reinicia. Somar amplitudes faria dois
       raios simultâneos sacudirem a tela ao dobro; reiniciar o relógio faria um
       tremor fraco no fim de um forte segurar a tela balançando de novo. */
    this._tremorAmp = Math.max(this._tremorAmp, forca);
    this._tremorT = Math.max(this._tremorT, duracao);
    /* O total acompanha o que sobrou, nunca o maior já visto: ele é a régua da
       rampa de saída DESTE tremor, e uma régua velha encolhe o novo. */
    this._tremorTotal = this._tremorT;
  }

  /**
   * **ALGUÉM MEXEU NA LENTE POR FORA.** Invalida o cache do campo de visão.
   *
   * `_aplicar` só escreve `camera.fov` quando o valor que ELE calcula muda — a
   * matriz de projeção é refeita em CPU e este é um caminho de todo quadro. O
   * cache torna isso barato e cria uma armadilha: se outra coisa escreve
   * `camera.fov` (a lente cinemática do boss fecha para 46° durante as cenas de
   * chegada e de morte, ver `boss/cine.js`), esta câmera não percebe — o valor
   * dela continua igual ao que ela acha que já escreveu, e o jogo fica com a
   * teleobjetiva da cena para sempre.
   *
   * Uma linha, chamada quando a cena devolve o controle. `NaN` e não um número:
   * qualquer comparação com `NaN` é falsa, então o `if` de `_aplicar` passa no
   * quadro seguinte sem precisar saber o que a cena deixou lá.
   */
  invalidarLente() {
    this._fov = NaN;
  }

  /** A direção para onde a mira aponta, em espaço de mundo. */
  aimDirection(out = { x: 0, y: 0, z: 0 }) {
    out.x = this._aim.x;
    out.y = this._aim.y;
    out.z = this._aim.z;
    return out;
  }

  /**
   * "O lutador foi posto onde está" — nada a amortecer.
   *
   * Sem isto, o quadro seguinte a um renascimento arrasta a lente pela arena
   * inteira, a 900 m de distância, com o mundo passando de lado. É o mesmo
   * cuidado — e o mesmo nome — de `PlayerPhysics.markTeleport`.
   */
  markTeleport() {
    this._iniciada = false;
    this._boost = 0;
    this._roll = 0;
    this._yawAnterior = null;
    /* A zona morta da trava também é memória de onde a lente estava, e depois de
       um teleporte ela descreve um enquadramento que não existe mais. Reiniciada
       aqui, o primeiro quadro depois do renascimento monta o quadro novo de uma
       vez, como todo o resto. */
    this._travaViva = false;
    this._fovTrava = 0;
    this._desvioTrava = 0;
  }

  /* ------------------------------------------------------------- interno -- */

  /** Enquadramento sem trava: atrás, no eixo do olhar. */
  _enquadrarLivre(distancia) {
    /* O braço segue o olhar COM pitch — não só o yaw, como no arqueiro. Lá o
       pitch é excluído de propósito (ele fazia a câmera avançar e recuar ao
       mirar para os lados com inclinação); aqui mergulhar é metade do jogo, e
       uma câmera que fica na horizontal enquanto o corpo desce a prumo mostra
       a nuca do lutador em vez do chão que está chegando. */
    this._desejada
      .copy(this._pivo)
      .addScaledVector(this._frente, -distancia)
      .addScaledVector(this._cima, ALTURA)
      .addScaledVector(this._direita, LADO);

    /* Toe-in: a lente aponta para um ponto FIXO do eixo de mira. É o que faz o
       retículo cravar no centro da tela para qualquer braço — a lição inteira
       de `systems/camera.js` num parágrafo. */
    this._olhar.copy(this._pivo).addScaledVector(this._frente, CONVERGENCIA);
    this.aimPoint.copy(this._olhar);
  }

  /**
   * Enquadramento com trava: os dois no quadro, **sem apontar para o alvo**.
   *
   * Ver o bloco de comentário das constantes lá em cima — as três peças (braço
   * misturado, zona morta, teto de giro) estão aqui, nesta ordem.
   */
  _enquadrarTrava(alvo, lock, distancia, passo) {
    const C = NAMEK.lock.camera;

    /* A linha que liga os dois. */
    this._linha.set(lock.x - this._pivo.x, lock.y - this._pivo.y, lock.z - this._pivo.z);
    const separacao = this._linha.length();

    /* Ângulos que apontam o CORPO para o alvo, para quem quiser usá-los. A
       câmera não mexe no corpo de ninguém — isto é informação, não comando. */
    if (separacao > 1e-4) {
      const o = this._linha;
      const plano = Math.sqrt(o.x * o.x + o.z * o.z);
      this.lockYaw = Math.atan2(-o.x, -o.z);
      this.lockPitch = Math.atan2(o.y, plano);
    }

    if (separacao < 1e-3) {
      this._enquadrarLivre(distancia);
      return;
    }
    this._linha.multiplyScalar(1 / separacao);

    /* ---------------------------------------------------------- 1. o braço
     *
     * A DIREÇÃO do braço mistura o olhar do lutador com a linha até o alvo, e a
     * mistura é função da separação. É a peça que desfaz a "câmera presa":
     * colado, a lente fica atrás de quem o jogador controla; longe, ela se
     * alinha com a linha porque é o único jeito de os dois caberem no quadro.
     *
     * `smoothstep` entre `perto` e `longe` e não um degrau: uma troca seca de
     * regime no meio de uma aproximação é a lente girando sozinha justamente
     * quando o jogador está mirando. */
    const t = smoothstep(C.perto, C.longe, separacao);
    const k = C.alinhaPerto + (C.alinhaLonge - C.alinhaPerto) * t;
    this._eixo
      .copy(this._frente)
      .multiplyScalar(1 - k)
      .addScaledVector(this._linha, k);
    if (this._eixo.lengthSq() < 1e-8) this._eixo.copy(this._linha);
    else this._eixo.normalize();

    /* O braço CRESCE com a separação — é o "combate distante: a câmera deve
       abrir ainda mais" do §5. Com teto: a partir de certa distância o alvo é um
       ponto de qualquer jeito, e continuar recuando só afastaria o lutador. */
    const braco = Math.min(distancia + separacao * C.ganho, C.distMax);

    this._desejada
      .copy(this._pivo)
      .addScaledVector(this._eixo, -braco)
      .addScaledVector(this._mundoCima, ALTURA * 0.9)
      .addScaledVector(this._direita, LADO * 0.5);

    /* A MIRA é o ALVO — é para isso que a trava existe, e ela não passa por
       zona morta nenhuma: o tiro vai onde o alvo está, não onde a lente está
       olhando. O ENQUADRAMENTO é outra coisa, e é o que vem abaixo. */
    this.aimPoint.set(lock.x, lock.y, lock.z);

    /* ------------------------------------------------------ 2. a zona morta
     *
     * O PONTO DE INTERESSE MISTURA duas coisas, e a mistura é a mesma rampa do
     * braço (`k`, de perto para longe). Foi a correção mais importante deste
     * bloco, e ela veio de uma MEDIDA: com o ponto de interesse ancorado só na
     * linha até o alvo, girar a mira 60° para longe do inimigo movia o alvo
     * apenas 0,12 de NDC — ou seja, ele continuava praticamente no centro da
     * tela. A câmera estava presa ao inimigo, que é exatamente o que o pedido
     * proíbe.
     *
     * • PERTO, o interesse é o OLHAR DO PRÓPRIO LUTADOR — o mesmo ponto de
     *   convergência da câmera livre. Virar a mira vira a câmera, o alvo
     *   atravessa a tela e pode sair dela, e é assim que tem de ser: no combate
     *   colado o que precisa ser legível é o que o jogador está fazendo.
     * • LONGE, ele é o ponto entre os dois (`vies` 0,34, puxado para o lutador).
     *   A essa distância o alvo é pequeno, e sem esse puxão ele simplesmente
     *   sai do quadro e não volta.
     *
     * `k` é a MESMA constante que decide a direção do braço, e ser a mesma
     * importa: braço e olhar apontando para regimes diferentes produzem um
     * enquadramento em que o lutador está de costas para o lugar que a lente
     * está olhando.
     *
     * E este não é o ponto para onde a lente olha: é para onde ela olharia se
     * não houvesse zona. `_alvoOlhar` é o desejo; `_olharTrava` é o que ela de
     * fato persegue, e ele só se mexe quando o desejo sai de um cone de `zona`
     * graus em torno dele. */
    this._alvoOlhar
      .copy(this._pivo)
      .addScaledVector(this._frente, CONVERGENCIA)
      .lerp(this._enquadre.copy(this._pivo).lerp(this.aimPoint, C.vies), k);

    if (!this._travaViva) {
      /* Primeiro quadro da trava: nada a suavizar. Sem isto, travar em alguém do
         outro lado da arena arrastaria a lente pelo mapa inteiro — o mesmo
         defeito que `markTeleport` existe para evitar no nascimento. */
      this._olharTrava.copy(this._alvoOlhar);
      this._travaViva = true;
    } else {
      this._puxarZona(this._alvoOlhar, passo, C);
    }
    this._olhar.copy(this._olharTrava);

    /* ------------------------------------------------- 3. o campo de visão
     *
     * *"Se necessário, aumentar temporariamente o campo de visão."* O quanto o
     * alvo está longe da direção da lente decide o quanto ela abre: com os dois
     * alinhados não abre nada, e com o alvo raspando a borda do quadro abre
     * `fovExtra`. É o que evita a última alternativa (recuar mais ainda) quando
     * o jogador passa colado pelo inimigo. */
    this._fovTrava = C.fovExtra * clamp(this._desvioTrava / (C.zona * GRAU * 4), 0, 1);
  }

  /**
   * A ZONA MORTA angular, e é ela que separa uma lente que ACOMPANHA de uma que
   * persegue.
   *
   * A conta é toda em ângulo e não em posição, porque é ângulo o que se vê: dois
   * pontos a dez metros um do outro são metade da tela a vinte metros e um pixel
   * a quatrocentos. Medida em metros, a zona seria enorme de perto e inútil de
   * longe — exatamente ao contrário do que se quer.
   *
   * Enquanto o desejo estiver dentro de `zona` graus do ponto atual, **nada
   * acontece**: o alvo deriva pela tela e a imagem fica parada. Passou, a lente
   * gira só o excedente, e ainda por cima limitada a `giroMax` rad/s — então um
   * adversário cruzando rente não varre a tela, ele sai dela e volta.
   */
  _puxarZona(desejo, dt, C) {
    const a = this._olharTrava;
    const p = this._pivo;

    /* Os dois como DIREÇÕES a partir do pivô. O ponto de interesse anda junto
       com o lutador (ele é uma interpolação a partir do peito dele), e medir a
       zona sobre as posições faria o simples ato de voar contar como desvio. */
    this._dirA.set(a.x - p.x, a.y - p.y, a.z - p.z);
    this._dirB.set(desejo.x - p.x, desejo.y - p.y, desejo.z - p.z);
    const la = this._dirA.length();
    const lb = this._dirB.length();
    if (la < 1e-4 || lb < 1e-4) {
      a.copy(desejo);
      this._desvioTrava = 0;
      return;
    }
    this._dirA.multiplyScalar(1 / la);
    this._dirB.multiplyScalar(1 / lb);

    const cos = clamp(this._dirA.dot(this._dirB), -1, 1);
    const ang = Math.acos(cos);
    this._desvioTrava = ang;

    const zona = C.zona * GRAU;
    /* A DISTÂNCIA acompanha sempre, mesmo dentro da zona: o alvo se afastando
       não é um desvio angular, e deixar o ponto de interesse preso no raio
       antigo faria a lente olhar para um lugar entre os dois que já não existe.
       O que a zona segura é a DIREÇÃO, que é o que produz movimento na tela. */
    const raio = la + (lb - la) * Math.min(1, dt * 4);

    if (ang <= zona) {
      /* Dentro da zona: só o raio. A direção fica exatamente onde estava. */
      a.set(p.x + this._dirA.x * raio, p.y + this._dirA.y * raio, p.z + this._dirA.z * raio);
      return;
    }

    /* Fora: gira o EXCEDENTE (`ang − zona`), limitado pelo teto de velocidade
       angular. É a soma das duas travas do §6 — "limites de velocidade de
       rotação" e "não manter o inimigo rigidamente no centro". */
    const passo = Math.min(ang - zona, C.giroMax * dt);
    const f = passo / ang;
    this._dirA.x += (this._dirB.x - this._dirA.x) * f;
    this._dirA.y += (this._dirB.y - this._dirA.y) * f;
    this._dirA.z += (this._dirB.z - this._dirA.z) * f;
    this._dirA.normalize();
    a.set(p.x + this._dirA.x * raio, p.y + this._dirA.y * raio, p.z + this._dirA.z * raio);
  }

  /** Encurta o braço se o relevo subir entre o corpo e a lente. */
  _encurtarBraco() {
    const ax = this._pivo.x;
    const ay = this._pivo.y;
    const az = this._pivo.z;
    const dx = this._desejada.x - ax;
    const dy = this._desejada.y - ay;
    const dz = this._desejada.z - az;

    for (let i = 1; i <= AMOSTRAS; i++) {
      const t = i / AMOSTRAS;
      const x = ax + dx * t;
      const z = az + dz * t;
      const chao = this._chao(x, z) + FOLGA_CHAO;
      if (ay + dy * t >= chao) continue;
      /* Achou terreno no caminho: para a lente na amostra ANTERIOR, que é a
         última que estava livre. Passo grosso de propósito — meio metro de
         precisão aqui custaria dezenas de consultas de altura por quadro e
         ninguém percebe a diferença numa câmera amortecida. */
      /* Nunca abaixo do piso: encurtar até zero devolve a lente para dentro do
         corpo, que é o problema que o encurtamento existe para evitar. Ver
         `BRACO_MINIMO` — daqui para baixo quem resolve é o `_pisoDoTerreno`. */
      const k = Math.max(BRACO_MINIMO, (i - 1) / AMOSTRAS);
      this._desejada.set(ax + dx * k, ay + dy * k, az + dz * k);
      return;
    }
  }

  /** A lente nunca abaixo do chão (nem do mar). */
  _pisoDoTerreno(v) {
    const chao = this._chao(v.x, v.z) + FOLGA_CHAO;
    if (v.y < chao) v.y = chao;
  }

  _chao(x, z) {
    const h = this.field.heightAt(x, z);
    const mar = NAMEK.world.seaLevel;
    return h > mar ? h : mar;
  }

  /**
   * A inclinação na curva, tirada da TAXA DE GIRO.
   *
   * Do giro e não da velocidade lateral porque é o giro que o jogador está
   * fazendo com a mão: a resposta chega no mesmo quadro do gesto, e não dois
   * depois, quando a física já converteu o gesto em trajetória.
   *
   * Sinal: virar para a direita é `yaw` DIMINUINDO (o mouse para a direita
   * subtrai — ver `NamekInput`), e a câmera tem de rodar no sentido horário
   * para o horizonte subir do lado de dentro da curva. `rotateZ` gira em torno
   * do eixo que sai da tela, então horário é negativo — que é o sinal que a
   * taxa já tem. Por isso o ganho é positivo e não há um menos escondido aqui.
   */
  _inclinar(dt, yaw) {
    if (this._yawAnterior === null || dt <= 0) {
      this._yawAnterior = yaw;
      return;
    }
    let d = yaw - this._yawAnterior;
    /* O yaw não é normalizado em lugar nenhum, mas pode dar a volta se alguém
       o escrever à mão (um renascimento, a trava virando o corpo). Sem esta
       dobra, uma volta inteira num quadro rodaria a câmera de lado. */
    if (d > Math.PI) d -= Math.PI * 2;
    else if (d < -Math.PI) d += Math.PI * 2;
    this._yawAnterior = yaw;

    const alvo = clamp((d / dt) * ROLL_GANHO, -ROLL_MAX, ROLL_MAX);
    this._roll = damp(this._roll, alvo, ROLL_SUAV, dt);
  }

  /** Escreve a pose na câmera de verdade. */
  _aplicar(dt) {
    const cam = this.camera;
    cam.position.copy(this.position);

    /* O TREMOR entra aqui, DEPOIS da mira e nos eixos da tela — lateral e
       vertical, nunca no eixo da vista. Sacudir para frente e para trás é um
       zoom trepidando, que é a versão do tremor que embrulha o estômago. */
    if (this._tremorT > 0) {
      this._tremorRelogio += dt;
      const k = this._tremorTotal > 0 ? clamp(this._tremorT / this._tremorTotal, 0, 1) : 0;
      /* k² e não k: a cauda de um tremor linear fica visível tempo demais e o
         quadro parece "solto" muito depois do estrondo. */
      const amp = this._tremorAmp * TREMOR_AMPLITUDE * k * k;
      const t = this._tremorRelogio;
      /* Duas frequências que não fecham entre si — um seno só é um balanço, e
         balanço lê como câmera de mão, não como impacto. */
      const ex = Math.sin(t * 41.3) * 0.6 + Math.sin(t * 27.1) * 0.4;
      const ey = Math.sin(t * 34.7 + 1.7) * 0.6 + Math.sin(t * 19.9 + 0.4) * 0.4;
      cam.position.addScaledVector(this._direita, ex * amp);
      cam.position.addScaledVector(this._cima, ey * amp);

      this._tremorT -= dt;
      if (this._tremorT <= 0) {
        this._tremorT = 0;
        this._tremorAmp = 0;
        this._tremorTotal = 0;
      }
    }

    cam.up.copy(this._mundoCima);
    cam.lookAt(this.lookAt);
    /* Rolagem em torno do eixo da vista. Depois do `lookAt` porque ele
       reescreve a orientação inteira a partir do `up` do mundo. */
    if (this._roll !== 0) cam.rotateZ(this._roll);

    /* O CAMPO DE VISÃO. Abre com a arrancada e, um pouco, com a velocidade
       crua — assim um mergulho sem boost também respira. A matriz de projeção
       só é refeita quando o número muda de verdade: ela é recalculada em CPU e
       este é um caminho de todo quadro. */
    const fov = this.baseFov + FOV_BOOST * this._boost + this._fovVel + this._fovTrava;
    if (Math.abs(fov - this._fov) > 0.01) {
      this._fov = fov;
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
