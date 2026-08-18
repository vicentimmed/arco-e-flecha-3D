/* ---------------------------------------------------------------------------
   A CÂMERA CINEMÁTICA DO BOSS — as duas cenas em que a lente deixa de ser do
   jogador.

   Elas são duas e são simétricas, e é essa simetria que justifica um arquivo:

   • **A CHEGADA.** *"Ele deve chegar voando lá do início do céu até a terra.
     Quando ele aparece, a câmera deve dar um close nele, acompanhando ele com a
     câmera, fazendo um 360 por uns 5 segundos, para o player ver que realmente
     ele chegou. Então, todos os players veem a câmera com foco no Freeza e a
     câmera sai de foco dos players, como se fosse uma apresentação de um jogo.
     Nesse momento ele dá risada duas vezes e é apresentado o nome Freeza. Após
     essa cena cinemática, a câmera volta ao normal do player."*

   • **A MORTE.** *"Quando o Freeza é derrotado, a câmera vai para ele antes de
     ele sair de cena… ele começa a sair raios dele e luzes, e ele explode. A
     câmera, depois dessa explosão, passa alguns segundos para a explosão se
     dissipar e a câmera volta ao normal para os players."*

   ============================================================================
   1. POR QUE ELA NÃO É UM MODO DA `NamekCamera`
   ============================================================================

   Porque a `NamekCamera` inteira é sobre uma coisa que aqui não existe: **manter
   um corpo enquadrado enquanto ELE decide para onde vai.** Braço amortecido,
   antecipação de velocidade, zona morta, teto de giro, piso de terreno, abertura
   de FOV pelo arranque, rolagem pela curva — são setecentas linhas que resolvem
   o problema de perseguir alguém que está manobrando.

   Uma cena de apresentação é o problema oposto: a lente não persegue nada, ela
   PERCORRE um caminho conhecido. Não há amortecimento (o caminho já é liso), não
   há zona morta (o alvo tem de ficar no meio do quadro de propósito), não há
   piso de terreno (a lente orbita a dezessete metros de uma criatura que está no
   céu). Enfiar isso lá dentro seria acrescentar um `if` gigante em cada uma
   daquelas etapas, e o resultado seria que nenhuma das duas coisas ficaria
   legível.

   O que este arquivo faz, portanto, é escrever `camera.position` e o `lookAt`
   direto, e devolver o controle quando acabar. `NamekGame.step` decide qual dos
   dois manda no quadro — uma linha lá, e a `NamekCamera` continua não sabendo
   que isto existe.

   ============================================================================
   2. POR QUE A CENA ACONTECE JUNTO EM TODAS AS TELAS SEM UMA MENSAGEM NOVA
   ============================================================================

   Porque ela é FUNÇÃO do que já viaja. A chegada é resolvida a partir do
   `FREEZA_IN` (que traz quanto falta da cena, no campo `cena`, e quanto falta da
   descida, em `desce`) e a morte a partir do `FREEZA_DOWN`. As duas mensagens já
   existiam, saem em broadcast e carregam carimbo do servidor; o que se
   acrescentou foram dois inteiros na primeira.

   E o CORPO que a lente enquadra é o mesmo que todo mundo vê: a posição vem do
   `FREEZA_STATE` a 20 Hz, interpolada por `BossSystem`. Ou seja, quinze telas
   orbitam o mesmo boss no mesmo lugar sem nenhuma delas ter de concordar com as
   outras sobre nada.

   ============================================================================
   3. O QUE ELA NÃO FAZ: PRENDER O JOGADOR
   ============================================================================

   O corpo dele continua respondendo ao teclado durante a cena, e isso é decisão
   e não esquecimento. Congelar quinze pessoas por seis segundos e meio deixaria
   algumas delas caindo, outras dentro de uma parede, e todas sem entender por
   quê — e a alternativa (guardar e restaurar o estado de cada uma) é uma máquina
   inteira para resolver um problema que não existe.

   O que garante que ninguém apanhe de graça durante a apresentação é o BOSS
   estar mudo: a sala mantém a invulnerabilidade dele pela cena inteira e
   `decidirGolpe` sai na primeira linha enquanto ela dura (ver
   `NamekFreeza.entrar`). Voar às cegas por seis segundos é um preço aceitável;
   levar um Death Beam sem poder ver de onde ele veio não seria.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** As duas cenas. Uma string e não um booleano porque elas enquadram
 *  diferente — e porque um terceiro tipo de cena, se aparecer, entra aqui. */
const CENA = { CHEGADA: "chegada", MORTE: "morte" };

/* s — a rampa de ENTRADA e a de SAÍDA da lente.
 *
 * Elas existem para a cena não começar nem terminar num CORTE. Um corte de
 * câmera é uma linguagem legítima e é a errada aqui: o jogador está voando, e
 * teleportar o ponto de vista dele para dezessete metros de uma criatura no céu
 * — e de volta — é a receita clássica de enjoo em jogo de voo.
 *
 * A entrada é mais rápida que a saída (0,45 contra 0,8) porque a pressa é
 * diferente nas duas pontas: entrando, o que importa é chegar antes de o
 * acontecimento acabar; saindo, o que importa é o jogador reencontrar o próprio
 * corpo, e isso pede tempo para o olho reancorar. */
const ENTRA = 0.45;
const SAI = 0.8;

/** graus — a abertura da lente durante a cena. Mais fechada que a do jogo
 *  (`NAMEK.world.fov`, 68°): teleobjetiva comprime, e comprimir é o que faz um
 *  corpo parecer maior do que ele é. É o truque de enquadramento mais velho que
 *  existe e ele é de graça aqui. */
const FOV_CENA = 46;

/**
 * A lente das duas cenas.
 *
 * Ela não guarda referência para o boss: quem chama passa o ponto a enquadrar a
 * cada quadro (`update`), porque quem sabe onde o corpo está — interpolado,
 * extrapolado e amortecido — é o `BossSystem`, e ter uma segunda leitura daquilo
 * aqui seria uma segunda posição para o mesmo corpo.
 */
export class BossCine {
  /**
   * @param {THREE.PerspectiveCamera} camera a mesma do jogo. Ela é ESCRITA
   *   diretamente — ver o §1: a cena não passa pelo amortecimento da lente
   *   normal, e não deve mesmo.
   */
  constructor(camera) {
    this.camera = camera;
    /** @type {string|null} `CENA.*` enquanto a cena corre. */
    this.cena = null;
    /** s desde o começo dela. */
    this.t = 0;
    /** s — quanto ela dura ao todo. */
    this.dur = 0;
    /** s — quanto falta da descida (só na chegada). */
    this.descida = 0;
    /** m — o raio da órbita, em metros já resolvidos da altura do boss. */
    this.raio = 0;
    /** 0…1 — o quanto a lente já é da cena. Sobe na entrada, desce na saída, e
     *  é ela que faz a mistura com a pose que a câmera do jogo tinha. */
    this.mistura = 0;

    /** A pose que a lente do JOGO tinha no último quadro antes da cena. É dela
     *  que a mistura parte, e é para ela que a saída volta — sem guardá-la, a
     *  rampa de saída interpolaria de um lugar para o outro passando por um
     *  terceiro que ninguém escolheu. */
    this._dePos = new THREE.Vector3();
    this._deOlhar = new THREE.Vector3();
    this._deFov = camera.fov;

    /* Rascunhos. Zero alocação por quadro, como todo o resto do modo. */
    this._pos = new THREE.Vector3();
    this._olhar = new THREE.Vector3();
    this._alvo = new THREE.Vector3();

    /** Marcos já disparados desta cena (as duas risadas, o nome). Um índice e
     *  não uma lista de booleanos: os marcos são consumidos em ordem. */
    this._marco = 0;
  }

  /** A cena está mandando na lente? */
  get ativa() {
    return this.cena !== null || this.mistura > 0.001;
  }

  /**
   * **A CHEGADA COMEÇOU.**
   *
   * @param {number} cenaMs quanto FALTA da cena, em ms — vem do `FREEZA_IN`.
   *   Zero (ou negativo) não abre cena nenhuma, e é assim que a reapresentação
   *   do boss para quem chega no meio da luta não prende a câmera de ninguém.
   * @param {number} descidaMs quanto falta da descida, em ms
   * @param {{position: THREE.Vector3, lookAt: THREE.Vector3}} lente a pose da
   *   câmera do jogo AGORA, para a mistura partir dela
   */
  chegada(cenaMs, descidaMs, lente) {
    const s = (Number(cenaMs) || 0) / 1000;
    if (s <= 0.2) return false;
    this._abrir(CENA.CHEGADA, s, lente);
    this.descida = Math.max(0, (Number(descidaMs) || 0) / 1000);
    this.raio = NAMEK.freeza.altura * NAMEK.freeza.chegada.lente;
    return true;
  }

  /**
   * **A MORTE COMEÇOU.** A duração sai do config e não da rede: ao contrário da
   * chegada, esta cena é inteiramente do cliente (ver o §2, e o comentário de
   * `NAMEK.freeza.fim`), então não há um relógio do servidor a respeitar — só o
   * carimbo do `FREEZA_DOWN`, que já garante que as quinze telas comecem juntas.
   */
  morte(lente) {
    const F = NAMEK.freeza.fim;
    this._abrir(CENA.MORTE, F.abertura + F.dissipar, lente);
    this.raio = NAMEK.freeza.altura * F.lente;
    return true;
  }

  _abrir(cena, dur, lente) {
    this.cena = cena;
    this.t = 0;
    this.dur = dur;
    this._marco = 0;
    if (lente?.position) this._dePos.copy(lente.position);
    if (lente?.lookAt) this._deOlhar.copy(lente.lookAt);
    this._deFov = this.camera.fov;
    /* A mistura NÃO é zerada: uma morte que comece durante a saída da chegada
       (ou uma cena cortada e reaberta) tem de continuar de onde a lente está, e
       não dar um salto de volta para o jogador para em seguida voltar. */
  }

  /** Corta a cena — o boss saiu de campo, a partida acabou, o jogador morreu.
   *  A lente volta pela rampa de saída em vez de num corte. */
  cortar() {
    this.cena = null;
  }

  /**
   * Um quadro da cena.
   *
   * @param {number} dt
   * @param {{x,y,z}} alvo onde o corpo do boss está AGORA (o `mostrado` do
   *   `BossSystem` — a posição interpolada, que é a que todo mundo vê)
   * @param {{position: THREE.Vector3, lookAt: THREE.Vector3}} lente a pose que a
   *   câmera do jogo montou neste quadro. Ela é o outro lado da mistura, e é ela
   *   que a lente reencontra no fim — viva e já acompanhando o jogador, e não
   *   congelada em onde ela estava quando a cena começou.
   * @returns {string|null} um MARCO deste quadro (`"risada"`, `"nome"`), para
   *   quem chama tocar o som e escrever na tela. Devolver o evento em vez de
   *   disparar daqui é o que mantém esta classe sem conhecer áudio nem HUD — a
   *   mesma disciplina de `SuperSaiyajin.update`.
   */
  update(dt, alvo, lente) {
    /* A pose do jogo é copiada TODO quadro enquanto a cena corre, e não só na
       abertura: é ela o destino da rampa de saída, e um destino congelado faria
       a lente voltar para onde o jogador estava seis segundos atrás — que é o
       outro lado do mapa, a 64 m/s. */
    if (lente?.position) this._dePos.copy(lente.position);
    if (lente?.lookAt) this._deOlhar.copy(lente.lookAt);

    if (!this.cena) {
      /* A SAÍDA. A cena acabou e a lente volta ao jogador ao longo de `SAI`. */
      if (this.mistura <= 0) return null;
      this.mistura = Math.max(0, this.mistura - dt / SAI);
      this._escrever();
      return null;
    }

    this.t += dt;
    this.mistura = Math.min(1, this.mistura + dt / ENTRA);
    if (this.t >= this.dur) this.cena = null;

    if (alvo) this._alvo.set(alvo.x, alvo.y, alvo.z);
    /* O ponto enquadrado é o PEITO e não os pés — a mesma convenção da câmera do
       jogo, e pela mesma razão: girar em torno dos pés faria a criatura balançar
       dentro do quadro a cada volta. */
    this._olhar.copy(this._alvo);
    this._olhar.y += NAMEK.freeza.peito;

    /* ------------------------------------------------------------- a órbita
     *
     * Uma volta inteira em `dur` segundos, e é o "fazendo um 360" literal. O
     * ângulo é função do TEMPO DA CENA e não acumulado por quadro, o que faz
     * duas telas com taxas de quadro diferentes verem a lente no mesmo lugar —
     * e faz a cena terminar exatamente onde ela começou, fechando a volta.
     *
     * A ALTURA da lente sobe ao longo da volta (de um pouco abaixo do peito para
     * um pouco acima): uma órbita puramente horizontal lê como um carrossel, e o
     * que se quer é a espiral que toda apresentação de jogo faz — ela mostra a
     * silhueta de baixo, que é de onde uma criatura desse tamanho impõe. */
    const u = clamp(this.t / Math.max(0.05, this.dur), 0, 1);
    const ang = u * Math.PI * 2;
    /* Na CHEGADA a lente abre com a descida: ela começa mais longe (o corpo
       ainda é um ponto vindo do céu) e fecha conforme ele desce. Na MORTE ela
       AFASTA depois do estouro, porque o que se enquadra ali deixa de ser um
       corpo e passa a ser uma explosão. */
    let raio = this.raio;
    if (this.cena === CENA.CHEGADA && this.descida > 0) {
      const d = clamp(this.t / this.descida, 0, 1);
      raio *= 1 + (1 - d) * 1.6;
    } else if (this.cena === CENA.MORTE) {
      const F = NAMEK.freeza.fim;
      const d = clamp((this.t - F.abertura) / Math.max(0.05, F.dissipar), 0, 1);
      raio *= 1 + d * 1.1;
    }

    this._pos.set(
      this._olhar.x + Math.sin(ang) * raio,
      this._olhar.y + (-0.35 + u * 1.1) * NAMEK.freeza.altura * 0.5,
      this._olhar.z + Math.cos(ang) * raio,
    );

    this._escrever();
    return this._marcoDoQuadro();
  }

  /**
   * Os MARCOS da chegada: as duas risadas e o nome.
   *
   * *"Ele dá risada duas vezes e é apresentado o nome Freeza."*
   *
   * Eles são consumidos em ordem por um índice só (`_marco`) porque os instantes
   * estão em ordem no config e porque um quadro de 16 ms pode pular por cima de
   * qualquer um deles — o teste é "já passou", nunca "está passando", que é a
   * mesma precaução dos dois respingos do peixe.
   */
  _marcoDoQuadro() {
    if (this.cena !== CENA.CHEGADA) return null;
    const C = NAMEK.freeza.chegada;
    const risadas = C.risadas ?? [];
    if (this._marco < risadas.length) {
      if (this.t >= risadas[this._marco]) {
        this._marco++;
        return "risada";
      }
      return null;
    }
    if (this._marco === risadas.length && this.t >= C.nome) {
      this._marco++;
      return "nome";
    }
    return null;
  }

  /**
   * A escrita na câmera, com a mistura.
   *
   * `k` é a rampa suavizada nas duas pontas (`smoothstep`), e ela é o que faz a
   * entrada e a saída não terem tranco: uma mistura linear muda de velocidade de
   * uma vez nas duas pontas, e o olho lê isso como um solavanco mesmo quando a
   * posição é contínua.
   */
  _escrever() {
    const m = clamp(this.mistura, 0, 1);
    const k = m * m * (3 - 2 * m);
    const cam = this.camera;

    cam.position.lerpVectors(this._dePos, this._pos, k);
    _alvoOlhar.lerpVectors(this._deOlhar, this._olhar, k);
    cam.lookAt(_alvoOlhar);

    const fov = this._deFov + (FOV_CENA - this._deFov) * k;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }
}

/** Um destino de olhar, para sempre. A mistura roda uma vez por quadro. */
const _alvoOlhar = new THREE.Vector3();

export { CENA as CENA_DO_BOSS };
