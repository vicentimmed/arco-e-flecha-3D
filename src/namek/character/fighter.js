/* ---------------------------------------------------------------------------
   O lutador: corpo + poses + aura, com o estado que a rede transporta.

   ------------------------------------------------------------------ o contrato

   Os campos públicos desta classe são, NOME POR NOME, os que `packFighter` lê em
   `shared/namek/protocol.js`. Isso não é coincidência nem gosto: é o que
   permite escrever

       socket.send({ t: NC2S.STATE, s: packFighter(lutador) })

   sem uma única linha de tradução, e receber com `unpackFighter(s, lutador)` do
   outro lado. Um objeto intermediário entre a rede e o boneco seria mais um
   lugar para dois campos saírem de sincronia — e o sintoma disso é sempre o
   mesmo: o companheiro voando na pose de andar.

   Quem escreve os campos é o DONO, todo quadro. O `Fighter` só lê.

   -------------------------------------------------------- por que há espelhos

   Cada canal (`runBlend`, `flyBlend`, `chargeBlend`…) tem aqui dentro um
   espelho amortecido (`_run`, `_fly`, `_charge`…). Parece redundante e não é:

   • nos lutadores REMOTOS os canais chegam a 20 Hz, ou seja, em degraus de
     50 ms. Sem o amortecimento a pose pula cinco vezes por segundo;
   • no lutador LOCAL o dono pode escrever um valor seco (`chargeBlend = 1` no
     quadro em que a tecla desce). Sem o amortecimento, a pose de carregar ki
     apareceria pronta, do nada, o que é exatamente o corte que o §10 do plano
     proíbe.

   Amortecer aqui — e não em cada dono — é o que garante que a regra vale para
   quem joga, para o bot e para o companheiro do outro lado do mundo.

   -------------------------------------------------------------- as camadas

   A pose final é montada em camadas, da mais permanente para a mais urgente:

       parado → locomoção → voo → arranque → carga → especial → queda
              → (rajada por cima) → dor → arremesso → morte

   A ordem importa: dor entra DEPOIS de especial porque levar um tiro no meio do
   Kamehameha tem de aparecer; morte entra por último porque nada acontece
   depois dela.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";
import { clamp, damp, smoothstep, solveTwoBoneIK } from "../../utils/math.js";
import { orientSegment } from "../../utils/geometry.js";
import { OSSO, criarMateriais, montarCorpo, tingir, nivelDeDetalhe } from "./rig.js";
import { Aura } from "./aura.js";
import {
  PIVO,
  criarPose,
  misturarPose,
  poseParado,
  poseLocomocao,
  poseVoo,
  poseArrancada,
  poseCarga,
  poseEspecial,
  poseDano,
  poseArremessado,
  poseDefesa,
  poseQueda,
  poseMorte,
  aplicarRajada,
  pontoDeSoltura,
} from "./poses.js";

const TAU = Math.PI * 2;
const MEIO_PI = Math.PI / 2;
/** m — quanto o corpo desce ao assentar morto no chão. */
const DESCIDA_MORTE = PIVO - 0.16;
/** m — a que distância da palma nasce a bola de ki. */
const SAIDA_DA_MAO = 0.11;

/* Rascunhos de MÓDULO, não de instância.
 *
 * `update` é síncrona do começo ao fim e nenhum destes valores atravessa
 * quadros, então quinze lutadores dividem os mesmos rascunhos sem se pisarem —
 * e o modo economiza quinze cópias de cada um. A regra para mexer aqui é só
 * uma: nada de `await`, nada de callback, nada que devolva o controle no meio. */
const _pose = criarPose();
const _tmpPose = criarPose();
const _v = new THREE.Vector3();
const _ombroR = new THREE.Vector3();
const _ombroL = new THREE.Vector3();
const _quadrilR = new THREE.Vector3();
const _quadrilL = new THREE.Vector3();
const _junta = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const _qTombo = new THREE.Quaternion();
const _cor = new THREE.Color();

/** O contexto que as funções de pose leem. Um por lutador — ele guarda a fase. */
function criarContexto() {
  return {
    t: 0,
    fase: 0,
    gait: 0,
    run: 0,
    moveF: 0,
    moveS: 0,
    pitch: 0,
    carga: 0,
    hitX: 0,
    hitZ: 1,
    mao: 0,
    esp: 0,
    espU: 0,
    espSolta: 0.4,
  };
}

export class Fighter {
  /**
   * @param {THREE.Scene|THREE.Group} parent onde o corpo entra na cena
   * @param {number} cor cor do jogador — vai para o gi (ver `tingir`)
   * @param {boolean} local se é o lutador de quem está jogando; ele nunca perde
   *   detalhe, porque está sempre a quatro metros da câmera
   */
  constructor(parent, cor = 0xff7a1a, local = false) {
    this.local = local;
    this.mat = criarMateriais();
    this.corpo = montarCorpo(this.mat);
    /** O grupo do corpo. Exposto porque a etiqueta de nome é filha dele. */
    this.root = this.corpo.root;
    /* O nome que flutua sobre o peito. Vive aqui e não em quem cuida da rede
       porque a etiqueta é pendurada no `root` e some junto com ele — inclusive
       durante o piscar da invulnerabilidade, que é o comportamento certo. Quem
       preenche é o dono; `null` = sem etiqueta. */
    this.displayName = null;
    parent.add(this.root);
    this.aura = new Aura(this.root, cor);
    this.color = null;
    this.setColor(cor);

    /* ---------------------------------------- estado que o dono escreve ---- */
    this.position = { x: 0, y: 0, z: 0 };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.gaitPhase = 0;
    this.runBlend = 0;
    this.flyBlend = 0;
    this.boostBlend = 0;
    this.chargeBlend = 0;
    this.specialFraction = 0;
    this.specialIndex = -1;
    this.hurtBlend = 0;
    this.lastHand = 0;
    this.handPose = 0;
    this.down = false;
    this.invuln = false;
    /** Derrubado por golpes seguidos (bit 4 da rede). Vivo, mas no chão. */
    this.tonto = false;
    /** Guarda de pé (bit 8 da rede): os dois braços cruzados à frente. */
    this.defendendo = false;

    /* --------------------------------------------- espelhos amortecidos ---- */
    this._run = 0;
    this._fly = 0;
    this._boost = 0;
    this._charge = 0;
    this._esp = 0;
    this._hurt = 0;
    this._hand = 0;
    this._guarda = 0;
    this._andar = 0;
    this._queda = 0;
    this._pitch = 0;
    this._moveF = 0;
    this._moveS = 0;

    /* ------------------------------------------------ tombo, morte, dor ---- */
    this._morrendo = false;
    this._morteT = 0;
    /** s desde que o corpo foi derrubado. Gêmeo de `_morteT` — ver `derrubar`. */
    this._tontoT = 0;
    this._tombo = 0;
    this._morte = 0;
    /** Assentar no chão é mais lento que tombar — ver `poseMorte`. */
    this._assento = 0;
    this._arremesso = 0;
    this._giroTombo = 0;
    this._velGiro = 0;
    /** Eixo do tombo, POR LUTADOR: dois corpos arremessados no mesmo instante
     *  girando no mesmo eixo denunciam a animação na hora. */
    this._eixoTombo = new THREE.Vector3(1, 0.2, 0.1).normalize();
    this._hitX = 0;
    this._hitZ = 1;

    /* Índice e fração do especial GUARDADOS: quando o golpe acaba o dono zera
       `specialIndex`, e sem a cópia a pose voltaria à posição de carga por uma
       fração de segundo antes de sumir — um espasmo no fim de todo especial. */
    this._espIdx = 0;
    this._espU = 0;
    this._espSolta = 0.4;

    this._t = 0;
    /* Cada corpo respira, treme e pulsa fora de fase dos outros. Sem isto,
       quinze lutadores parados no mesmo lugar respiram em uníssono e a cena
       inteira parece um único objeto batendo. */
    this._fase = Math.random() * TAU;
    this._nivel = -1;
    this._ctx = criarContexto();
    this._ctx.fase = this._fase;

    /* Nasce POSADO. Sem isto, o primeiro quadro de um lutador que entra na sala
       desenha o corpo com todos os membros na origem — um segundo de boneco
       amassado, e sempre bem no instante em que se olha para ele. */
    poseParado(_pose, this._ctx);
    this.aplicar(_pose, true);
  }

  /* ------------------------------------------------------------- estado --- */

  /** A cor do jogador. Vai para o gi e para o ki; pele e cabelo ficam. */
  setColor(cor) {
    if (cor == null || cor === this.color) return;
    this.color = cor;
    tingir(this.mat, _cor.set(cor));
    this.aura.setColor(cor);
  }

  /**
   * Levou um golpe. `direcao` é o EMPURRÃO, em espaço de mundo.
   *
   * A direção é convertida para o espaço do corpo aqui e guardada: é ela que
   * faz um tiro pelas costas jogar o peito para a frente e um golpe lateral
   * dobrar o tronco para o lado. Sem isso toda dor é a mesma, e o jogador perde
   * a única pista visual de onde está apanhando.
   *
   * @param {{x,y,z}} direcao
   * @param {boolean} forte golpe que ARREMESSA — o corpo perde o controle
   */
  hit(direcao, forte = false) {
    this.hurtBlend = 1;
    if (direcao) {
      const c = Math.cos(this.yaw);
      const s = Math.sin(this.yaw);
      const lx = c * direcao.x - s * direcao.z;
      const lz = s * direcao.x + c * direcao.z;
      const n = Math.hypot(lx, lz) || 1;
      this._hitX = lx / n;
      this._hitZ = lz / n;
    }
    if (!forte || this._morrendo) return;
    this._arremesso = 1;
    this._velGiro = 5.5 + Math.random() * 3;
    this._eixoTombo.set(0.85 + Math.random() * 0.3, this._hitX * 0.5, this._hitZ * 0.3).normalize();
  }

  /**
   * Foi DERRUBADO — cinco golpes seguidos, e o corpo vai ao chão.
   *
   * É a morte sem a morte: o mesmo tombo girando seguido do mesmo assentar, com
   * os mesmos dois canais (`_tombo` e `_morte`), porque a leitura pedida é
   * exatamente a mesma — um corpo que perde o controle no ar e encontra o chão.
   * A única diferença é que esta é REVERSÍVEL: quando `tonto` apaga, os alvos
   * dos canais voltam a zero e o mesmo amortecimento que deitou o corpo o
   * levanta, sem uma linha de animação a mais.
   *
   * Reaproveitar `poseMorte` para alguém que está vivo é deliberado e é o
   * contrário de preguiça: um segundo conjunto de poses "caído mas vivo" seria
   * uma cópia que envelheceria em metades, e a diferença entre as duas coisas na
   * tela não é a pose — é que uma delas se levanta.
   *
   * @param {{x,y,z}|null} direcao de onde veio a pancada que derrubou
   */
  derrubar(direcao) {
    if (this._morrendo) return;
    this.hit(direcao, true);
    this.tonto = true;
    this._tontoT = 0;
    this._velGiro = 5 + Math.random() * 3;
    this._eixoTombo.set(1, this._hitX * 0.6, this._hitZ * 0.35).normalize();
  }

  /**
   * Morreu. O corpo é ARREMESSADO nesta direção e só depois assenta.
   *
   * Duas coisas em sequência, e é a sequência que vende o golpe: primeiro o
   * tombo sem controle (0,4 s girando), depois o corpo achando o chão. Cair
   * direto na pose deitada seria um boneco desligado.
   */
  die(direcao) {
    if (this._morrendo) return;
    this.hit(direcao, false);
    this._morrendo = true;
    this.down = true;
    this._morteT = 0;
    this._velGiro = 6.5 + Math.random() * 4;
    this._eixoTombo.set(1, this._hitX * 0.6, this._hitZ * 0.35).normalize();
  }

  /** Volta do zero para a pose viva. O piscar quem liga é o campo `invuln`. */
  revive() {
    this._morrendo = false;
    this.down = false;
    this.tonto = false;
    this.defendendo = false;
    this._guarda = 0;
    this._tontoT = 0;
    this._morteT = 0;
    this._tombo = 0;
    this._morte = 0;
    this._assento = 0;
    this._arremesso = 0;
    this._giroTombo = 0;
    this._velGiro = 0;
    this.hurtBlend = 0;
    this._hurt = 0;
    this.handPose = 0;
    this._hand = 0;
    this.specialIndex = -1;
    this.specialFraction = 0;
    this._esp = 0;
  }

  /* --------------------------------------------------------------- quadro -- */

  /**
   * Monta o corpo a partir do estado. Uma vez por quadro.
   * @param {number} dt segundos
   * @param {{x,y,z}} [cameraPos] para o nível de detalhe
   */
  update(dt, cameraPos) {
    /* Um quadro perdido (aba em segundo plano, GC longo) chega aqui como um dt
       de dois segundos. Sem o teto, `damp` completa a transição inteira num
       passo e a pose TELETRANSPORTA — que é o mesmo corte que o modo inteiro
       existe para evitar. */
    dt = clamp(dt, 0, 0.1);
    this._t += dt;

    this.atualizarCanais(dt);
    const p = this.montarPose();
    this.aplicar(p, false);
    this.atualizarAura(dt);
    this.atualizarDetalhe(cameraPos);
    this.atualizarPiscar();

    /* Uma vez, no fim: `handPoint` e `chestPoint` são lidos no MESMO quadro por
       quem dispara e por quem desenha o número de dano, e leriam a matriz do
       quadro anterior se esperássemos o renderizador atualizá-la. */
    this.root.updateMatrixWorld(true);
  }

  /** Os canais da rede viram números suaves, e os que decaem sozinhos decaem. */
  atualizarCanais(dt) {
    /* A DOR e a MÃO decaem AQUI, e isso tem consequência de projeto: quem só
       chama `hit()` (ou só manda a bola sair) ganha o retorno da pose de graça,
       e quem escreve o canal todo quadro — o dono de um lutador remoto, com o
       valor que veio da rede — simplesmente sobrescreve antes de `update`. Os
       dois caminhos funcionam, e é `packFighter` lendo estes mesmos campos que
       leva o decaimento para a rede sem uma mensagem a mais. */
    this.hurtBlend = damp(this.hurtBlend, 0, 3.4, dt);
    this.handPose = damp(this.handPose, 0, 8.5, dt);

    this._run = damp(this._run, clamp(this.runBlend, 0, 1), 7, dt);
    this._fly = damp(this._fly, clamp(this.flyBlend, 0, 1), 6, dt);
    this._boost = damp(this._boost, clamp(this.boostBlend, 0, 1), 5.5, dt);
    this._charge = damp(this._charge, clamp(this.chargeBlend, 0, 1), 7, dt);
    this._hurt = damp(this._hurt, clamp(this.hurtBlend, 0, 1), 16, dt);
    /* A GUARDA SOBE DEPRESSA E DESCE DEVAGAR, e a assimetria é a regra do golpe:
       ela precisa estar de pé no quadro em que o botão desceu (defender tarde é
       não ter defendido), e o corpo demora a se abrir de novo depois — abrir a
       guarda num estalo lê como o boneco tendo sido desligado. */
    this._guarda = damp(this._guarda, this.defendendo ? 1 : 0, this.defendendo ? 15 : 7, dt);
    this._hand = damp(this._hand, clamp(this.handPose, 0, 1), 18, dt);
    this._pitch = damp(this._pitch, this.pitch, 20, dt);

    /* Marcha: quanto se anda sai da VELOCIDADE, não de um canal.
     *
     * O dono já manda `velocity` (o interpolador precisa dela), e derivar daqui
     * significa que o ciclo de passo nunca discorda do deslocamento — o pé não
     * patina nem corre no lugar. `runBlend` continua sendo dele, porque correr é
     * uma decisão, não uma medida. */
    const vx = this.velocity.x;
    const vz = this.velocity.z;
    // `sqrt` e não `hypot`: `Math.hypot` é variádica e o caminho lento dela
    // aloca. Num laço de quadro isso é lixo de graça — a proteção contra
    // estouro que ela oferece não serve para nada numa velocidade em m/s.
    const vel = Math.sqrt(vx * vx + vz * vz);
    if (vel > 0.05) {
      const c = Math.cos(this.yaw);
      const s = Math.sin(this.yaw);
      // Mundo → corpo: o inverso da rotação em Y do root.
      const lx = (c * vx - s * vz) / vel;
      const lz = (s * vx + c * vz) / vel;
      this._moveF = damp(this._moveF, -lz, 8, dt);
      this._moveS = damp(this._moveS, lx, 8, dt);
    }
    const andando = clamp(vel / NAMEK.fighter.walkSpeed, 0, 1) * (1 - this._fly);
    this._andar = damp(this._andar, andando, 9, dt);

    /* Queda: descendo rápido, sem voar e sem carregar. `fallSafe` é o mesmo
       limite que o config usa para machucar no pouso — a pose de queda começa
       bem antes dele, que é o ponto: ela AVISA. */
    const caindo =
      clamp((-this.velocity.y - 6) / (NAMEK.fighter.fallSafe * 0.6), 0, 1) *
      (1 - this._fly) *
      (1 - this._charge);
    this._queda = damp(this._queda, caindo, 5, dt);

    // Especial: peso amortecido, índice e fração guardados enquanto ele existe.
    if (this.specialIndex >= 0) {
      this._espIdx = this.specialIndex;
      this._espU = clamp(this.specialFraction, 0, 1);
      this._espSolta = pontoDeSoltura(this._espIdx);
    }
    this._esp = damp(this._esp, this.specialIndex >= 0 ? 1 : 0, 7, dt);

    /* Tombo e morte. O corpo GIRA primeiro e assenta depois, com três
       amortecimentos de constantes diferentes — é a diferença de tempo entre
       eles que faz a queda ter peso em vez de ser uma troca de pose. */
    const morrendo = this._morrendo || this.down;
    if (morrendo && !this._morrendo) this.die(null);
    if (morrendo) this._morteT += dt;

    /* O CAÍDO usa os mesmos dois canais do morto — ver `derrubar`. Ele perde
       para a morte quando os dois acontecem (morrer no meio de um atordoamento
       é comum, porque quem está no chão é justamente quem está apanhando), e o
       relógio dele zera quando o corpo se levanta, para uma segunda queda
       recomeçar do começo em vez de continuar de onde parou. */
    const caido = !morrendo && this.tonto === true;
    if (caido) this._tontoT += dt;
    else this._tontoT = 0;

    this._arremesso = damp(this._arremesso, 0, 2.6, dt);
    let alvoTombo = this._arremesso;
    let alvoMorte = 0;
    if (morrendo) {
      alvoTombo = 1 - smoothstep(0.3, 0.95, this._morteT);
      alvoMorte = smoothstep(0.35, 1.1, this._morteT);
    } else if (caido) {
      /* Mais rápido que a morte: 0,25 s de tombo e o corpo já está assentando.
         A queda dura 2,4 s no total (`stagger.time`), e gastar um terço dela
         girando no ar deixaria pouco tempo de "caído" para o golpe do outro
         lado caber. Morrer pode ser demorado; apanhar tem de ser seco. */
      alvoTombo = Math.max(this._arremesso, 1 - smoothstep(0.2, 0.75, this._tontoT));
      alvoMorte = smoothstep(0.25, 0.8, this._tontoT);
    }
    this._tombo = damp(this._tombo, clamp(alvoTombo, 0, 1), 10, dt);
    this._morte = damp(this._morte, alvoMorte, 6, dt);
    this._assento = damp(this._assento, alvoMorte, 3.2, dt);

    // O giro perde força sozinho; o que sobra é desfeito pelo peso do tombo.
    this._velGiro = damp(this._velGiro, 0, 2.2, dt);
    this._giroTombo += this._velGiro * dt;

    const ctx = this._ctx;
    ctx.t = this._t;
    ctx.gait = this.gaitPhase;
    ctx.run = this._run;
    ctx.moveF = this._moveF;
    ctx.moveS = this._moveS;
    ctx.pitch = this._pitch;
    ctx.carga = this._charge;
    ctx.hitX = this._hitX;
    ctx.hitZ = this._hitZ;
    ctx.mao = this.lastHand;
    ctx.esp = this._espIdx;
    ctx.espU = this._espU;
    ctx.espSolta = this._espSolta;
  }

  /** As camadas, na ordem em que uma tem o direito de cobrir a outra. */
  montarPose() {
    const ctx = this._ctx;
    poseParado(_pose, ctx);

    if (this._andar > 0.002) {
      poseLocomocao(_tmpPose, ctx);
      misturarPose(_pose, _tmpPose, this._andar);
    }
    if (this._fly > 0.002) {
      poseVoo(_tmpPose, ctx);
      misturarPose(_pose, _tmpPose, this._fly);
    }
    if (this._boost > 0.002) {
      poseArrancada(_tmpPose, ctx);
      misturarPose(_pose, _tmpPose, this._boost);
    }
    if (this._charge > 0.002) {
      poseCarga(_tmpPose, ctx);
      misturarPose(_pose, _tmpPose, this._charge);
    }
    /* A GUARDA entra depois da carga e antes do especial, e as duas vizinhanças
       têm razão de ser: ela nunca coexiste com a carga (o laço principal e o bot
       garantem isso nos dois lados), e o especial ganha dela porque quem começou
       um Kamehameha não está mais se protegendo — está comprometido. */
    if (this._guarda > 0.002) {
      poseDefesa(_tmpPose, ctx);
      misturarPose(_pose, _tmpPose, this._guarda);
    }
    if (this._esp > 0.002) {
      poseEspecial(_tmpPose, ctx);
      misturarPose(_pose, _tmpPose, this._esp);
    }
    if (this._queda > 0.002) {
      poseQueda(_tmpPose, ctx);
      misturarPose(_pose, _tmpPose, this._queda * (1 - this._esp));
    }

    /* A rajada é CAMADA e entra depois de tudo o que é postura: atirar não muda
       o que o corpo está fazendo, muda só o braço que atira. Ela é abafada pelo
       especial e pela carga porque nesses dois as mãos já estão ocupadas. */
    /* O braço da rajada é abafado também pela GUARDA, pelo mesmo motivo das
       outras duas: com os antebraços cruzados na frente do rosto, a mão não está
       livre para atirar — e quem está defendendo não atira mesmo (o laço
       principal cala o botão, e a sala recusa o disparo). */
    aplicarRajada(
      _pose,
      ctx,
      this._hand * (1 - this._esp) * (1 - this._charge) * (1 - this._guarda),
    );

    /* A DOR NÃO CANCELA O COMPROMISSO — ela só o incomoda.
     *
     * O pedido do usuário é preciso: "quando o player está carregando o poder ou
     * atirando o poder, se ele for acertado por outros poderes, ele não perde a
     * animação, porém o life dele é tirado. A menos que seja acertado por um
     * Kamehameha ou um grande poder."
     *
     * As duas metades moram em lugares diferentes, e é assim que tem de ser:
     *
     * • a metade "não perde a animação" é ESTA linha. Durante um especial ou
     *   uma carga, a camada de dor entra com um quinto do peso — some o
     *   estremecimento, fica a postura. Antes ela entrava inteira, e uma rajada
     *   de seis pontos dobrava o tronco de quem estava no meio de um Kamehameha
     *   de 3,5 s: a pose mais cara do jogo desmanchada por um arranhão.
     * • a metade "a menos que seja um poder grande" NÃO é uma pose: é a queda.
     *   Trinta de dano na janela (`NAMEK.fighter.stagger`) derrubam o corpo, e
     *   aí quem cancela o golpe é a sala, que apaga o especial em curso e manda
     *   o `STAGGER`. Um Kienzan, um Galick Gun, uma Genki Dama ou meio segundo
     *   de Kamehameha passam desse limiar sozinhos; cinco bolinhas também.
     *
     * Ou seja: o corpo aguenta o que é pequeno e vai ao chão com o que é grande,
     * e nenhuma das duas coisas precisou de um estado novo para existir. */
    if (this._hurt > 0.002) {
      const compromisso = Math.max(this._esp, this._charge);
      poseDano(_tmpPose, ctx);
      misturarPose(_pose, _tmpPose, this._hurt * 0.85 * (1 - this._morte) * (1 - compromisso * 0.8));
    }
    if (this._tombo > 0.002) {
      poseArremessado(_tmpPose, ctx);
      misturarPose(_pose, _tmpPose, this._tombo);
    }
    if (this._morte > 0.002) {
      poseMorte(_tmpPose);
      misturarPose(_pose, _tmpPose, this._morte);
    }
    return _pose;
  }

  /* ---------------------------------------------------------------- rig ---- */

  /** Veste a pose no esqueleto. */
  aplicar(p, primeiro) {
    const R = this.corpo;

    /* ORIENTAÇÃO. `inclinacao` vira `rotation.x` com o sinal invertido — a
       convenção de `poses.js` é "positivo é para a frente", e inclinar o eixo
       de cima do corpo para −Z é uma rotação NEGATIVA em X. Ordem YXZ para o
       yaw ser o de fora: com a ordem padrão, girar o corpo em torno de si mesmo
       torceria também a direção para onde ele olha. */
    _euler.set(-p.inclinacao * MEIO_PI, this.yaw, this.roll + p.rolagem);
    this.root.quaternion.setFromEuler(_euler);

    if (this._tombo > 0.002) {
      /* O giro do tombo é multiplicado pelo PESO do tombo. Assim, quando o
         corpo assenta, o ângulo acumulado se desfaz sozinho até zero em vez de
         a pose de morte brigar com uma rotação arbitrária pendurada. */
      _qTombo.setFromAxisAngle(this._eixoTombo, this._giroTombo * this._tombo);
      this.root.quaternion.multiply(_qTombo);
    }

    /* POSIÇÃO. O corpo gira em torno do PEITO e não dos pés: `position` continua
       sendo os pés (é o que a rede manda e o que o chão testa), mas o ponto que
       fica parado durante a inclinação é o centro de massa. Sem isto, mergulhar
       enfia a cabeça no chão e subir levanta o lutador pelos calcanhares. */
    _v.set(p.rootSide, -PIVO, p.rootPush).applyQuaternion(this.root.quaternion);
    this.root.position.set(
      this.position.x + _v.x,
      this.position.y + PIVO + _v.y + p.rootLift - this._assento * DESCIDA_MORTE,
      this.position.z + _v.z,
    );

    // Tronco. `updateMatrix` explícito: os ombros e os quadris saem desta
    // matriz logo abaixo, e ela ainda não foi recalculada neste quadro.
    R.spine.rotation.set(-p.spinePitch, p.spineYaw, p.spineRoll);
    R.spine.updateMatrix();

    /* A cabeça DESCONTA a torção do tronco. O tronco gira para armar o golpe, e
       quem está mirando continua olhando o alvo — sem este desconto o lutador
       vira o rosto junto com o ombro e parece distraído no meio da luta. */
    R.head.rotation.set(-p.headPitch, p.headYaw - p.spineYaw * 0.85, 0);

    /* O cabelo. Positivo = jogado para trás (vento, queda); negativo = levantado
       (ki). Duas linhas num grupo, e é a leitura de "ele está carregando" que se
       enxerga de cinquenta metros. */
    const cab = p.cabelo;
    R.cabeloRaiz.rotation.x = cab * 0.5;
    R.cabeloRaiz.scale.set(1, 1 + Math.max(0, -cab) * 0.22, 1 + Math.max(0, cab) * 0.4);

    /* O PÉ FICA COLADO NO CHÃO enquanto o corpo quica e agacha por cima dele.
     *
     * `rootLift` desce o corpo inteiro — e os alvos dos pés vão junto, porque
     * são do espaço do root. Sem descontá-lo do alvo, o agachamento da pose de
     * carregar ki enterra as duas botas quinze centímetros na grama e o quique
     * da corrida faz o mesmo, mais de leve, sessenta vezes por segundo. Medido:
     * −0,135 m na carga e −0,017 m parado, antes desta linha.
     *
     * Vale só com os pés no chão. Voando, tombando ou morto não há chão a que
     * colar, e descontar ali arrancaria as pernas do corpo. */
    const colado = (1 - this._fly) * (1 - this._tombo) * (1 - this._morte);
    const compensa = p.rootLift * colado;
    p.footR.y -= compensa;
    p.footL.y -= compensa;

    const alto = OSSO.shoulderY - OSSO.hipY;
    this.doTronco(OSSO.shoulderX, alto, 0, _ombroR);
    this.doTronco(-OSSO.shoulderX, alto, 0, _ombroL);
    this.doTronco(OSSO.hipX, -0.02, 0, _quadrilR);
    this.doTronco(-OSSO.hipX, -0.02, 0, _quadrilL);

    this.poseBraco(R.bracoR, _ombroR, p.handR, p.poleR, p.esticaR, p.punhoR, p.giroR);
    this.poseBraco(R.bracoL, _ombroL, p.handL, p.poleL, p.esticaL, p.punhoL, p.giroL);
    this.posePerna(R.pernaR, _quadrilR, p.footR, p.kneeR, p.pontaR, -p.peGiro);
    this.posePerna(R.pernaL, _quadrilL, p.footL, p.kneeL, p.pontaL, p.peGiro);

    if (primeiro) this.root.updateMatrixWorld(true);
  }

  /** Um ponto do espaço do tronco levado ao espaço do root. */
  doTronco(x, y, z, out) {
    return out.set(x, y, z).applyMatrix4(this.corpo.spine.matrix);
  }

  /**
   * Braço por IK de dois ossos.
   *
   * `estica` soma alcance aos DOIS ossos, e existe porque um braço "estendido"
   * resolvido com o comprimento exato trava no cotovelo — a IK põe o cotovelo
   * na linha reta e a junta some. Meio centímetro a mais em cada osso deixa uma
   * curvatura mínima, e é ela que separa um braço de um cabo de vassoura.
   */
  poseBraco(braco, ombro, mao, polo, estica, punho, giro) {
    solveTwoBoneIK(
      ombro,
      mao,
      OSSO.upperArm + estica,
      OSSO.foreArm + estica,
      polo,
      _junta,
    );
    orientSegment(braco.upper, ombro, _junta);
    orientSegment(braco.fore, _junta, mao);
    // A manga é do mesmo osso do braço: ela nasce no ombro e o perfil dela
    // termina em 0,55, então esticá-la junto cobre a metade de cima e mais nada.
    orientSegment(braco.manga, ombro, _junta);
    braco.elbow.position.copy(_junta);
    braco.hand.position.copy(mao);
    braco.hand.quaternion.copy(braco.fore.quaternion);
    // A torção do punho decide para onde a palma olha — é ela que faz a mão
    // aberta da rajada apontar para o alvo em vez de para o próprio quadril.
    if (giro) braco.hand.rotateY(giro);
    braco.band.position.copy(mao).lerp(_junta, 0.2);
    braco.band.quaternion.copy(braco.fore.quaternion);
    /* O punho fecha girando os dedos em bloco em torno da linha dos nós. Cinco
       falanges articuladas custariam cinco malhas e cinco IKs por mão; isto
       custa uma rotação, e a 12 m a diferença não existe. */
    braco.dedos.rotation.x = -0.2 - punho * 1.35;
  }

  /** Perna por IK, com a bota e a banda acompanhando a canela. */
  posePerna(perna, quadril, pe, polo, ponta, giro) {
    solveTwoBoneIK(quadril, pe, OSSO.thigh, OSSO.shin, polo, _junta);
    orientSegment(perna.thigh, quadril, _junta);
    orientSegment(perna.shin, _junta, pe);
    orientSegment(perna.cano, _junta, pe);
    perna.knee.position.copy(_junta);
    perna.banda.position.copy(_junta).lerp(pe, 0.44);
    perna.banda.quaternion.copy(perna.shin.quaternion);
    perna.shoe.position.copy(pe);
    perna.shoe.position.y -= OSSO.ankleY;
    // Ordem YXZ no grupo do pé (ver `montarPerna`): primeiro para onde a ponta
    // aponta, depois quanto o peito do pé estica.
    perna.shoe.rotation.set(-ponta * 0.9, giro, 0);
  }

  /* --------------------------------------------------------------- aura ---- */

  atualizarAura(dt) {
    /* Três fontes acendem a mesma aura, e a maior manda. Somá-las estouraria a
       tela quando alguém carrega ki no meio de um arranque, que é uma coisa que
       acontece o tempo todo. */
    /* A guarda também ACENDE, e mais fraca que a carga de propósito: ela custa
       ki (é o que a torna uma escolha) e a aura é a única coisa que diz isso de
       longe. Forte demais e ela viraria a leitura de "carregando", que é o
       oposto do que está acontecendo. */
    let i = Math.max(this._charge, this._boost * 0.9, this._guarda * 0.42);
    if (this._esp > 0.01) {
      // No especial a aura sobe com a carga e recua quando o golpe já saiu: a
      // energia foi embora com o feixe.
      const carga = smoothstep(0, this._espSolta, this._espU);
      i = Math.max(i, this._esp * (0.5 + 0.5 * carga));
    }
    // Morto não brilha, e quem está sendo arremessado perde a concentração.
    i *= (1 - this._morte) * (1 - this._tombo * 0.7);

    /* A cor do ki vira a cor do GOLPE durante um especial. É de graça (o config
       já declara a cor de cada um) e é informação de jogo: o roxo do Galick Gun
       aparece na aura de quem está carregando, um segundo antes de o feixe
       sair. */
    if (this._esp > 0.01) {
      const nome = NAMEK.specialOrder[this._espIdx];
      const cor = nome ? NAMEK.specials[nome]?.cor : null;
      if (cor != null) this.aura.setColor(cor);
    } else if (this.color != null) {
      this.aura.setColor(this.color);
    }

    this.aura.update(dt, clamp(i, 0, 1), this._boost, this._nivel >= 2 ? 0.75 : 1);
  }

  /* ---------------------------------------------------------- lod e piscar */

  atualizarDetalhe(cameraPos) {
    if (!cameraPos) return;
    /* O lutador local nunca perde detalhe: ele está a quatro metros da câmera o
       tempo todo, e em primeira pessoa a mão dele passa a meio metro do olho. */
    let nivel = 0;
    if (!this.local) {
      const dx = this.position.x - cameraPos.x;
      const dy = this.position.y - cameraPos.y;
      const dz = this.position.z - cameraPos.z;
      nivel = nivelDeDetalhe(Math.sqrt(dx * dx + dy * dy + dz * dz), Math.max(0, this._nivel));
    }
    if (nivel === this._nivel) return;
    this._nivel = nivel;
    /* Escrito só na VIRADA. `visible` é uma propriedade simples, mas são dezenas
       de objetos por corpo vezes quinze corpos, e fazer isso todo quadro troca
       desenho por trabalho de CPU — que é o pior negócio possível. */
    for (const o of this.corpo.detalhe.perto) o.visible = nivel <= 0;
    for (const o of this.corpo.detalhe.medio) o.visible = nivel <= 1;
    this.aura.setDetalhe(nivel);
  }

  /**
   * O piscar da invulnerabilidade — `NAMEK.respawn.blink` Hz.
   *
   * Mora AQUI e não no dono porque é regra do modo, não da tela de quem joga: o
   * bot que renasce pisca igual, e quem chega no meio da partida vê o mesmo
   * lutador piscando que todo mundo.
   *
   * Esconde o grupo em vez de mexer em opacidade. Alternar `transparent` e
   * `depthWrite` a cada meio ciclo invalida programas do Three e pode
   * recompilar os dez materiais do corpo no meio do renascimento — o arqueiro
   * já pagou por essa lição (ver `Player.setOpacity`).
   */
  atualizarPiscar() {
    if (!this.invuln) {
      if (!this.root.visible) this.root.visible = true;
      return;
    }
    // Ciclo assimétrico: mais tempo visível que apagado. Meio a meio pisca como
    // um defeito; assim pisca como invulnerabilidade.
    const f = Math.sin(this._t * NAMEK.respawn.blink * TAU);
    const ver = f > -0.35;
    if (this.root.visible !== ver) this.root.visible = ver;
  }

  /* -------------------------------------------------------------- pontos --- */

  /**
   * De onde sai uma bola de ki, em espaço de MUNDO.
   *
   * Sai da malha da mão, e não de um deslocamento fixo a partir do centro do
   * corpo: a pose de rajada estica o braço na direção da mira, e é justamente
   * essa ponta que o jogador está vendo quando aperta o botão. Um `handOffset`
   * constante faria a bola nascer no ombro enquanto a mão está meio metro à
   * frente.
   *
   * @param {number} mao 0 esquerda, 1 direita
   */
  handPoint(mao, out = { x: 0, y: 0, z: 0 }) {
    const braco = mao === 1 ? this.corpo.bracoR : this.corpo.bracoL;
    const m = braco.hand.matrixWorld.elements;
    // Coluna 1 da matriz = o eixo +Y local da mão, que aponta do punho para os
    // dedos. A bola nasce um palmo além deles.
    out.x = m[12] + m[4] * SAIDA_DA_MAO;
    out.y = m[13] + m[5] * SAIDA_DA_MAO;
    out.z = m[14] + m[6] * SAIDA_DA_MAO;
    return out;
  }

  /** O peito, em espaço de mundo: onde o dano é marcado e o nome flutua. */
  chestPoint(out = { x: 0, y: 0, z: 0 }) {
    const m = this.corpo.ancoraPeito.matrixWorld.elements;
    out.x = m[12];
    out.y = m[13];
    out.z = m[14];
    return out;
  }

  /* ------------------------------------------------------------- limpeza --- */

  dispose() {
    this.aura.dispose();
    this.root.traverse((o) => o.geometry?.dispose());
    for (const m of Object.values(this.mat)) m.dispose();
    this.root.parent?.remove(this.root);
  }
}
