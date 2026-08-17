/* ---------------------------------------------------------------------------
   O lutador de Namekusei: uma cápsula cinemática integrada à mão.

   §4 do plano explica por que não há Rapier aqui, e vale repetir a parte que
   manda neste arquivo: um lutador **não tumbla, não é empurrado por solver, não
   tem junta e não precisa de CCD**. O que ele faz é andar, correr, voar,
   arrancar com ki, levar knockback e cair — e tudo isso é integração explícita
   contra um campo de altura.

   Daí duas propriedades que a página inteira depende:

   • **Nada de Three.js.** Posição e velocidade são `{x,y,z}` simples, como o
     `packFighter` já espera. O arquivo roda em Node sem um `import three`, o
     que o deixa testável fora do navegador e reaproveitável pela sala para
     mover bot com a MESMA física do jogador — que é o que impede o bot de
     parecer que joga outro jogo.
   • **Zero alocação em regime.** O único objeto que sai daqui é o evento de
     pouso forte, e ele é reaproveitado. Ver `_evento`.

   ---------------------------------------------------------------- a sensação

   O pedido do usuário é uma frase só e ela decide todos os números abaixo: *"a
   jogabilidade deve ser rápida, não deve ser um jogo travado e lento. Agilidade
   no voo."* Traduzindo para o que este arquivo faz:

   1. **O motor é um servo, não um empurrão.** A velocidade PERSEGUE a desejada
      (`damp`) em vez de somar força. Com `airAccel` de 9,5 e `boostAccel` de 14,
      do parado ao máximo são dois décimos de segundo. É a diferença entre o BT3
      e um simulador de voo.
   2. **Voa-se para onde se OLHA.** O W em voo segue o eixo de mira com pitch
      incluso — apontar para baixo e acelerar é mergulhar. Sem isso, subir e
      descer viram teclas e o voo vira elevador.
   3. **O atrito do ar é BAIXO** (`airDrag` 1,35). Soltar tudo a 64 m/s não
      para: derrapa. É o que dá peso sem dar lentidão.
   4. **O corpo INCLINA na curva** (`roll`, derivado da aceleração lateral).
      Sem rolagem, voo é trilho de trem.

   ------------------------------------------------------------------ a saída

   Os campos públicos são exatamente os que `packFighter` (shared/namek/
   protocol.js) consome, com os mesmos nomes. Não é coincidência: o que este
   controlador produz É o estado que viaja na rede, e uma tradução no meio seria
   um lugar a mais para os dois lados discordarem.
   --------------------------------------------------------------------------- */

import { NAMEK } from "../shared/namek/config.js";
import { clamp, damp } from "../utils/math.js";

const TAU = Math.PI * 2;

/* **`Math.hypot` não aparece neste arquivo**, e não é preciosismo de estilo.
   Ele é variádico, e no V8 a chamada variádica ALOCA: medido aqui, três milhões
   de chamadas provocam 175 coletas contra 11 da conta à mão — num caminho que
   roda até seis vezes por quadro, por lutador. Ainda por cima ele paga um
   escalonamento contra overflow que nenhuma distância deste jogo precisa: as
   coordenadas vivem em ±900 m e as velocidades em ±64 m/s. */
const modulo = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const modulo2 = (x, z) => Math.sqrt(x * x + z * z);

/* ------------------------------------------------------------- subpassos ---
   Um quadro pode ser longo (aba voltando do segundo plano, GC, tela de carga) e
   a 64 m/s um quadro de 100 ms são mais de SEIS METROS num passo só — o bastante para
   atravessar uma crista sem que o teste de altura veja nada. O quadro é picado
   em subpassos limitados por tempo E por distância. */
/** s — teto de dt aceito. Acima disto o quadro é um soluço, não um quadro. */
const DT_MAX = 0.1;
/** s — duração máxima de um subpasso. */
const PASSO_MAX = 0.018;
/** m — avanço máximo de um subpasso. Menor que qualquer feição do relevo. */
const AVANCO_MAX = 1.6;
/** Teto de subpassos: o custo por quadro tem de ser limitado. */
const SUBPASSOS_MAX = 6;

/* ----------------------------------------------------------------- toque --- */
/** s — espaço segurado até o voo engatar. Curto: é um gesto, não uma espera. */
const TEMPO_DECOLAGEM = 0.16;
/** m/s — empurrão para cima no instante em que o voo engata. */
const IMPULSO_DECOLAGEM = 3.2;
/** m/s — o TRANCO para baixo do `F` no ar. Ver `_bordas`: é o que transforma
 *  "desligar o voo" num mergulho em vez de uma flutuação. 30 m/s são metade da
 *  arrancada, o que dá a leitura de peso sem virar um teleporte para o chão. */
const MERGULHO_F = 30;
/** m/s — o salto do `F` com os pés no chão. ~11 m de altura antes de o voo
 *  assumir: o "impulso para cima, como se voasse com um shift por alguns
 *  metros" do pedido. */
const SALTO_F = 16;
/** m — o quanto o corpo "cola" no relevo ao descer uma ladeira. Sem isso, cada
 *  lombada é uma rampa de salto e a corrida vira uma sequência de pulinhos. */
const COLA_CHAO = 0.55;

/* ----------------------------------------------------------------- chão ---- */
/** cos do ângulo com a vertical. É o mesmo limiar de `NamekField.isWalkable`, e
 *  ser o mesmo importa: o chão em que dá para ficar de pé e o chão que a sala
 *  aceita para nascer alguém têm de ser o mesmo chão. */
const ESCORREGA = 0.72;
/** m — passada de um ciclo completo (dois passos). Igual à do arqueiro
 *  (`CONFIG.gait.strideLength`), porque a perna é do mesmo tamanho. */
const PASSADA = 1.75;
/** Passada 50 % mais longa correndo — também igual à do arqueiro. */
const PASSADA_CORRIDA = 0.5;

/* -------------------------------------------------------------- rolagem ---- */
/** rad ≈ 36°. Mais que isso e o lutador vira um avião de caça. */
const ROLL_MAX = 0.62;
/** rad por (m/s²) de aceleração lateral. */
const ROLL_ACEL = 0.03;
/** rad — inclinação imediata só por segurar A/D. A aceleração lateral sozinha
 *  atrasa a leitura em um ou dois quadros; este termo faz o corpo responder no
 *  MESMO quadro da tecla, e o outro sustenta a curva depois. */
const ROLL_ENTRADA = 0.3;
/** 1/s — suavização da rolagem. */
const ROLL_SUAV = 7;

/* ------------------------------------------------------------- mistura ----- */
/** 1/s — entrada e saída da pose de voo. */
const MIST_VOO = 6;
/** 1/s — entrada e saída da pose de carga de ki. */
const MIST_CARGA = 7;
/** 1/s — 0 andando … 1 correndo. */
const MIST_CORRIDA = 8;
/** 1/s — a aura da arrancada ACENDE quase junto com o botão. O apagar é o
 *  `boostTail` do config, e é ele que dá o retorno. */
const MIST_BOOST = 14;

/* ------------------------------------------------------------------ teto --- */
/** m — faixa abaixo do teto em que a subida vai morrendo. `NAMEK.world.ceiling`
 *  diz "a subida é cortada, sem parede visível" — cortar de uma vez seria uma
 *  parede, então ela é cortada ao longo destes metros. */
const FAIXA_TETO = 45;

/** Ações neutras: deixa `update(dt)` sem argumentos ser um quadro parado.
 *  Sem `yaw` e sem `pitch` de propósito — um quadro sem entrada não move o
 *  olhar, e um zero ali giraria o corpo para o norte. */
const SEM_ACAO = {
  forward: 0,
  strafe: 0,
  up: 0,
  run: false,
  boost: false,
  fire: false,
  charge: false,
  jumpHeld: false,
  jumpPressed: false,
  flyPressed: false,
  burstPressed: false,
  /* Sem `lockPressed`: a trava de alvo perdeu a tecla (ver o cabeçalho de
     `input.js`), e um campo neutro para uma ação que não existe mais seria a
     única linha deste objeto que não descreve o teclado. */
  menuPressed: false,
};

/* s — teto de tempo caindo, para quem foi derrubado no ar.
 *
 * A queda do teto de voo (520 m) leva ~8 s com o tranco inicial; nove dão
 * folga. Ele existe para o caso em que o chão nunca chega — derrubado sobre o
 * oceano da borda, por exemplo —, e é o que impede "ficar sem controle" de
 * virar "ficar sem controle para sempre". Ver `FighterController.derrubar`. */
const QUEDA_MAX = 9;

export class FighterController {
  /** @param {import("../shared/namek/field.js").NamekField} field */
  constructor(field) {
    this.field = field;

    /** m — PÉS do lutador, não o centro da cápsula. É a mesma convenção do
     *  arqueiro (`Player.position`) e a que `packFighter` manda. */
    this.position = { x: 0, y: 0, z: 0 };
    this.velocity = { x: 0, y: 0, z: 0 };

    /** rad. Convenção do repositório: frente = (−sin yaw, 0, −cos yaw). */
    this.yaw = 0;
    /** rad, > 0 olhando para cima. */
    this.pitch = 0;
    /** rad, **> 0 inclina para a DIREITA** (ombro direito para baixo). */
    this.roll = 0;

    this.grounded = true;
    this.flying = false;
    this.stunned = false;
    /** Derrubado por golpes seguidos: sem controle E sem voo. Ver `derrubar`. */
    this.caido = false;
    /** Guarda de pé neste quadro. Quem escreve é o laço principal, pela ação
     *  `guard`; quem lê são a pose (bit 8 da rede) e a barra de ki. */
    this.defendendo = false;
    /** Preso na pose de um especial. Quem escreve é o laço principal, enquanto
     *  houver golpe em curso — ver o comentário de `preso` em `_integrar`. */
    this.travado = false;
    /** A arrancada está acesa NESTE quadro (com ki pago). Alimenta a câmera. */
    this.boosting = false;

    /* ====================================================== O REGIME DE VOO ==
     *
     * **Onde o mundo termina, e ele deixou de ser uma constante.**
     *
     * O pedido do fim de Namekusei é literal: *"no momento que os players estão
     * fugindo do planeta o limite de altura de voo do céu deve ser maior para
     * eles conseguirem chegar no espaço sem morrer."* E `NAMEK.world.ceiling`
     * são 520 m — o teto certo para uma partida comum, e uma parede exatamente
     * onde a fuga precisa passar.
     *
     * A constante NÃO mudou, e não podia: subi-la para dois quilômetros no
     * config esvaziaria a arena para cima em toda partida normal, e o modo
     * inteiro é uma briga que acontece perto do chão. O que mudou é que este
     * controlador parou de LER a constante e passou a ler este objeto — que
     * nasce valendo exatamente ela, e que a fase do fim reescreve enquanto
     * durar. Quem escreve é `NamekGame.step`, a partir do `EstadoDoFim`
     * (`src/namek/world/fuga.js`); quem nunca escreve nada (o banco de provas,
     * a bancada de desenvolvimento) continua voando no planeta de sempre.
     *
     * É um objeto de campos e não quatro propriedades soltas porque ele é
     * REESCRITO por quadro e nunca recriado: quatro `this.x = y` do lado de fora
     * seriam quatro linhas para alguém esquecer uma; um objeto é uma coisa só,
     * com um nome, e a lista do que o fim do planeta muda cabe na leitura dele.
     */
    this.regime = {
      /** m — o teto de voo em vigor. */
      teto: NAMEK.world.ceiling,
      /* m — a faixa em que a BARREIRA MACIA horizontal vai afrouxando com a
       * altitude, e ela existe por causa de uma briga real entre dois sistemas.
       *
       * `world.softEdge` puxa de volta quem se afasta do centro. Ela protege o
       * mapa pelos lados — e a 1 500 m de altura não protege nada: só empurra
       * para dentro quem está subindo em espiral, que durante a contagem é
       * exatamente quem está correndo contra o relógio para chegar ao alto.
       * `Infinity`
       * (o padrão) quer dizer "o freio vale inteiro em qualquer altura", que é
       * o comportamento de sempre. */
      freioSolta: Infinity,
      freioMorre: Infinity,
      /**
       * A BOLHA DO ESPAÇO, ou `null` enquanto houver planeta.
       *
       * `{ x, y, z, raio }`. Quando ela existe, a lista do que este arquivo
       * desliga é curta e literal, e está toda em `_integrar`: **campo de
       * altura, gravidade, pouso, decolagem e o freio cilíndrico do planeta.**
       * No lugar do último entra um freio ESFÉRICO em torno do centro dela —
       * esférico porque no espaço não há "para baixo", e um limite cilíndrico
       * deixaria a fuga vertical aberta para sempre.
       */
      espaco: null,
    };

    /* Canais de animação — os mesmos nomes que `packFighter` lê. */
    this.gaitPhase = 0;
    this.runBlend = 0;
    this.flyBlend = 0;
    this.boostBlend = 0;
    this.chargeBlend = 0;

    /* ------------------------------------------------------------ interno -- */
    /** s restantes de atordoamento. */
    this._stun = 0;
    /** s restantes de queda NO CHÃO. Ver `derrubar` — é mais que um
     *  atordoamento, e ele só começa a correr quando os pés encostam. */
    this._caido = 0;
    /** s restantes do teto de segurança da queda, enquanto ele está no ar. */
    this._caidoAr = 0;
    /** s de espaço segurado — é o relógio da decolagem. */
    this._espaco = 0;
    /** Velocidade do quadro anterior, para a aceleração lateral da rolagem. */
    this._vAntX = 0;
    this._vAntZ = 0;
    /** A carga de ki está valendo? Decidida no subpasso (ela depende do `ki`,
     *  não só da tecla) e lida pela mistura das poses. */
    this._carregando = false;
    /** Entrada lateral já filtrada pelo controle — alimenta a rolagem. */
    this._ladoEfetivo = 0;

    /** Destino reaproveitado da normal do terreno.
     *
     *  Chamamos `field.normalAt(x, z, eps, ESTE)` em vez de `field.slopeAt`, que
     *  é a mesma conta: `slopeAt` deixa o destino no valor padrão, e o valor
     *  padrão é um objeto literal — uma alocação por consulta, no caminho mais
     *  quente do modo (até seis subpassos por quadro, quinze lutadores). Aqui
     *  ele é um campo, e o inclinômetro é `_normal.y`. */
    this._normal = { x: 0, y: 1, z: 0 };

    /** O EVENTO DE POUSO FORTE, reaproveitado.
     *
     *  **Consuma no mesmo quadro.** Ele volta no máximo uma vez por quadro e é
     *  sempre o mesmo objeto: guardá-lo para depois é guardar uma referência que
     *  o próximo baque reescreve. Quem precisa dele precisa AGORA — abrir
     *  cratera, levantar poeira, avisar a sala. */
    this._evento = { tipo: "pouso", speed: 0, p: { x: 0, y: 0, z: 0 } };
  }

  /** m/s — módulo da velocidade. HUD, câmera e trilha leem daqui. */
  get speed() {
    const v = this.velocity;
    return modulo(v.x, v.y, v.z);
  }

  /**
   * Um quadro do lutador.
   *
   * @param {number} dt segundos
   * @param {object} acoes o que `NamekInput.actions()` devolve
   * @param {object} ki `{ valor, max, gastar(n)->bool, carregando }`
   * @returns {object|null} `{ tipo, speed, p }` quando o pouso foi forte o
   *   bastante para virar cratera (`NAMEK.destruction.slamSpeed`). `tipo` é
   *   `"pouso"` quando ele veio VOANDO (mergulho de propósito) e `"queda"`
   *   quando ele veio caindo — sem voo, atordoado, arremessado. Os dois abrem
   *   cratera; o segundo é o que também machuca (`NAMEK.fighter.fallSafe`), e
   *   quem cobra o dano é quem chamou, com o `speed` que volta aqui.
   */
  update(dt, acoes, ki) {
    const a = acoes ?? SEM_ACAO;
    const passo = clamp(dt, 0, DT_MAX);
    if (passo <= 0) return null;

    /* A MIRA VALE SEMPRE, inclusive atordoado. É tentador congelar o olhar
       junto com o controle — "sem controle" é o que diz o §, afinal —, mas a
       câmera segue o `yaw` do corpo: congelá-lo por meio segundo e devolvê-lo
       de uma vez faria a tela girar sozinha no fim do atordoamento, com todo o
       movimento de mouse acumulado chegando de uma vez. Olhar é de graça; o que
       o atordoamento tira é a capacidade de se mexer. */
    if (Number.isFinite(a.yaw)) this.yaw = a.yaw;
    if (Number.isFinite(a.pitch)) this.pitch = a.pitch;

    this._bordas(passo, a);

    /* Subpassos: por tempo e por DISTÂNCIA (ver `AVANCO_MAX`). */
    const avanco = this.speed * passo;
    const n = clamp(
      Math.ceil(Math.max(passo / PASSO_MAX, avanco / AVANCO_MAX)),
      1,
      SUBPASSOS_MAX,
    );
    const h = passo / n;

    let evento = null;
    for (let i = 0; i < n; i++) {
      const e = this._integrar(h, a, ki);
      /* O PRIMEIRO baque manda. Um segundo pouso forte no mesmo quadro é
         fisicamente impossível (o corpo já está no chão), mas se um empurrão o
         devolvesse ao ar e ao chão de novo, o buraco que interessa é o do
         impacto que veio de mais alto — o primeiro. */
      if (e && !evento) evento = e;
    }

    this._animar(passo);
    return evento;
  }

  /**
   * Empurrão externo: onda de ki, knockback de dano, explosão perto.
   *
   * O atordoamento NÃO desliga o voo, e essa é a decisão que faz a briga aérea
   * funcionar: desligado, quem levasse um golpe a 300 m de altura despencaria
   * até o chão e a luta acabaria no primeiro acerto. Ligado, a gravidade age
   * durante o atordoamento (ver `_integrar`) — o corpo é arremessado e afunda,
   * que é a leitura do golpe —, e quando o relógio zera o voo volta sozinho.
   * É a recuperação do BT3.
   */
  push(vx, vy, vz, stun = 0) {
    const v = this.velocity;
    v.x += vx;
    v.y += vy;
    v.z += vz;

    /* Empurrão para cima TIRA os pés do chão. Sem isto, o `grounded` continuaria
       verdadeiro por um subpasso e o teste de contato zeraria o empurrão inteiro
       contra a normal do terreno: a onda de ki não levantaria ninguém. */
    if (vy > 0.5 && this.grounded) {
      this.grounded = false;
      this.position.y += 0.05;
    }
    if (stun > 0) {
      this._stun = Math.max(this._stun, stun);
      this.stunned = true;
    }
  }

  /**
   * Cinco golpes seguidos: o lutador PERDE O AR e cai.
   *
   * A diferença para o `push` com atordoamento é a que dá nome à coisa: aqui o
   * VOO DESLIGA. O comentário de `push` explica por que um atordoamento comum
   * não pode desligá-lo (quem levasse um golpe a 300 m despencaria e a luta
   * acabaria no primeiro acerto); esta queda é a exceção deliberada a essa
   * regra, e ela é o preço de ter apanhado cinco vezes seguidas sem reagir.
   *
   * O empurrão para baixo (`stagger.drop`) existe porque uma queda que começa
   * na velocidade zero demora a virar queda: nos primeiros meio segundo o corpo
   * pareceria apenas ter parado no ar. Com o tranco ele AFUNDA no quadro do
   * golpe, que é a leitura de "levou uma pancada forte".
   *
   * Quem manda derrubar é a sala (`NS2C.STAGGER`), nunca este arquivo: contar
   * golpes é decisão de partida, e duas contagens — uma aqui, outra lá — seriam
   * dois jogos diferentes na mesma tela.
   *
   * @param {number} segundos quanto tempo no chão
   */
  derrubar(segundos) {
    const S = NAMEK.fighter.stagger;
    /* O RELÓGIO SÓ COMEÇA A CORRER NO CHÃO, e essa é a peça que faz a janela
     * valer alguma coisa numa luta AÉREA.
     *
     * Medido, quando o relógio era único: derrubado a 120 m, o lutador chegava
     * ao chão em 2,85 s — e os 2,4 s de queda tinham acabado 0,45 s ANTES,
     * ainda no ar. Ele recuperava o controle no meio do tombo, voltava a voar e
     * nunca encostava no chão. Ou seja: a 120 m ou mais, o atordoamento não
     * existia, e é justamente de 120 m para cima que a briga acontece. Pior
     * ainda, o pedido explícito — "ele deve cair no chão e criar uma grande
     * cratera… ali ele deve ficar um pouco tonto" — descreve o chão como o
     * lugar onde a punição ACONTECE, não como um detalhe do caminho.
     *
     * São dois relógios, portanto: `_caido` é o tempo NO CHÃO e só anda com os
     * pés nele; `_caidoAr` é um teto de segurança para a queda, para ninguém
     * ficar sem controle para sempre por ter sido derrubado sobre o oceano ou
     * rente ao teto de voo. Nove segundos são a queda dos 520 m do teto com
     * folga — ver `NAMEK.world.ceiling`. */
    this._caido = Math.max(this._caido, segundos);
    this._caidoAr = QUEDA_MAX;
    this.caido = true;
    this.stunned = true;
    this.flying = false;
    this.boosting = false;
    this.defendendo = false;
    this.velocity.y = Math.min(this.velocity.y, -S.drop);
  }

  /**
   * Põe o lutador em algum lugar. Nascer, renascer, entrar na partida.
   *
   * Nascer ALTO já entra voando — é o `respawn.dropHeight` de 120 m do plano, e
   * quem renasce a 120 m sem voo simplesmente cai. O limiar de 3 m separa isso
   * de um teleporte rente ao chão, que é um pouso.
   */
  teleport(x, y, z, yaw = this.yaw) {
    this.position.x = x;
    this.position.y = y;
    this.position.z = z;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;
    this.yaw = yaw;
    this.roll = 0;
    this._stun = 0;
    this.stunned = false;
    this._caido = 0;
    this._caidoAr = 0;
    this.caido = false;
    this.defendendo = false;
    this.travado = false;
    this._espaco = 0;
    this._vAntX = 0;
    this._vAntZ = 0;
    this.boostBlend = 0;
    this.boosting = false;
    this.runBlend = 0;

    const chao = this._chao(x, z);
    this.grounded = y <= chao + 0.05;
    if (this.grounded) this.position.y = chao;
    this.flying = !this.grounded && y - chao > 3;
  }

  /* ------------------------------------------------------------- interno -- */

  /**
   * A cota do chão. **É o relevo, e só o relevo.**
   *
   * Havia aqui um piso no nível do mar (`return h > mar ? h : mar`), e ele era
   * a resposta certa para uma pergunta que mudou. O argumento de então: a arena
   * termina em oceano aberto, e sem piso quem fosse empurrado para fora
   * afundaria para sempre.
   *
   * Só que esse piso valia em TODA a arena, inclusive no meio da clareira — e a
   * partir do momento em que cavar até a lava virou requisito, ele passou a ser
   * a coisa que impedia o requisito. O relato foi exatamente isto: *"ao ficar
   * atirando no chão, muitas vezes no local ele vai furando, porém parece ter um
   * limite. Ao fundo tem algo mais duro em que não é possível furar mais. Eu
   * queria fazer aquele teste de furar até chegar na lava e não funcionou."*
   *
   * O "algo mais duro" era esta linha: o buraco continuava afundando no campo de
   * altura (a grade aceita até −80 m) e os PÉS paravam a −8, sobre um chão
   * invisível. A lava assenta a −14 e só acende a partir de −18: ela estava seis
   * metros abaixo de um piso que ninguém conseguia atravessar. O mesmo piso, do
   * lado do desenho, deixava o disco do oceano aparecer dentro das crateras
   * fundas — a chapa d'água no fundo do buraco do relato (ver `world/water.js`,
   * que agora começa depois da costa).
   *
   * O medo original continua legítimo e a resposta a ele deixou de ser um piso:
   * quem cai no mar **morre** (`NAMEK.world.afogar`, cobrado pela sala em
   * `afogarNoMar`). Não há mais o que proteger com um chão falso — afundar no
   * oceano passou a ser uma consequência, e não um bug.
   */
  _chao(x, z) {
    return this.field.heightAt(x, z);
  }

  /** As bordas de um toque. Uma vez por QUADRO — nunca por subpasso, senão um
   *  toque de espaço viraria seis pulos. */
  _bordas(dt, a) {
    const F = NAMEK.fighter;

    if (a.jumpHeld) this._espaco += dt;
    else this._espaco = 0;

    if (this.stunned) return;

    /* `F` continua sendo UMA tecla com dois sentidos, e os dois ficaram mais
     * fortes — foi o pedido: *"ao apertar a F, o player deve descer bem mais
     * rápido do que ele desce hoje. E se ele estiver no chão e apertar F, ele
     * deve dar um bom impulso para cima, como se voasse com um shift por alguns
     * metros."*
     *
     * O que havia era um interruptor: `F` alternava o voo, e o comentário dizia
     * que desligá-lo no ar "é deixar-se cair — de graça, a gravidade já está
     * escrita". De graça era, e lenta também: soltar o voo a 200 m começava a
     * queda do ZERO, e com −11,4 m/s² o corpo levava quase um segundo para
     * atingir os 11 m/s que a caminhada faz no plano. Na tela isso lia como o
     * lutador flutuando para baixo, não como um mergulho.
     *
     * Agora cada sentido paga um TRANCO, e é o tranco que dá a leitura:
     *
     * • NO AR — o voo desliga e o corpo é atirado para baixo a `MERGULHO_F`.
     *   Não é "cair mais rápido que a gravidade": é a gravidade partindo de uma
     *   velocidade que já é de queda. Daí em diante ela acelera normalmente, e
     *   apertar `F` de novo religa o voo e freia — que é a manobra inteira.
     * • NO CHÃO — o voo liga com um empurrão vertical grande em vez do
     *   `IMPULSO_DECOLAGEM` de 3,2 m/s, que era um cambota. `SALTO_F` são
     *   16 m/s, ou uns 11 m de altura antes de o corpo começar a voar de
     *   verdade: o "shift por alguns metros" do pedido, tirado do chão de uma
     *   vez em vez de subido a 20 m/s de `climbSpeed`.
     *
     * O `Math.min`/`Math.max` em vez de atribuição direta é o de sempre: quem já
     * está caindo mais rápido que o mergulho não é freado por ele, e quem já foi
     * arremessado para cima mais forte que o salto não é aparado por ele. */
    if (a.flyPressed) {
      this.flying = !this.flying;
      if (this.flying) {
        if (this.grounded) {
          this.grounded = false;
          this.velocity.y = Math.max(this.velocity.y, SALTO_F);
        } else {
          /* Religou no ar: o voo já segura o corpo sozinho (a gravidade só corre
             para quem não está voando), e um empurrão aqui viraria um pulo duplo
             de graça. Nada a fazer. */
        }
      } else if (!this.grounded) {
        this.velocity.y = Math.min(this.velocity.y, -MERGULHO_F);
      }
    }

    /* O ESPAÇO TEM DOIS SENTIDOS, e o toque decide qual. Toque curto no chão é
       pulo; segurar é decolagem. Um só gesto, e ele é o mesmo do BT3 — por isso
       o pulo sai na BORDA e a decolagem no RELÓGIO: quem só quis pular já está
       no ar quando o relógio chega em `TEMPO_DECOLAGEM`, e não engata o voo
       porque soltou a tecla antes. */
    if (a.jumpPressed && this.grounded && !this.flying) {
      this.velocity.y = F.jumpSpeed;
      this.grounded = false;
    }
    if (!this.flying && !this.grounded && this._espaco >= TEMPO_DECOLAGEM) {
      this.flying = true;
      this.velocity.y = Math.max(this.velocity.y, IMPULSO_DECOLAGEM);
    }
  }

  /** Um subpasso de física. Devolve o evento de baque, ou null. */
  _integrar(h, a, ki) {
    const F = NAMEK.fighter;
    const W = NAMEK.world;
    const R = this.regime;
    /* A BOLHA, se houver. Ver `regime.espaco`: um `if` limpo em cinco lugares —
       gravidade, teto, freio de borda, contato com o chão e decolagem — em vez
       de números mágicos espalhados. */
    const bolha = R.espaco;
    const p = this.position;
    const v = this.velocity;

    /* NO ESPAÇO SE VOA SEMPRE. Não é um atalho: é o que "não há chão" quer dizer
       neste controlador. Sem os pés em lugar nenhum, `grounded` é falso por
       definição, e um lutador que não está voando é um lutador em queda livre —
       para dentro de um relevo que ficou dois quilômetros abaixo e que já nem é
       desenhado. Deixar o `F` desligar o voo aqui seria deixar o jogador se
       apagar da partida com uma tecla. */
    if (bolha) {
      this.flying = true;
      this.grounded = false;
    }

    if (this._stun > 0) {
      this._stun -= h;
      if (this._stun <= 0) this._stun = 0;
    }
    this.stunned = this._stun > 0;

    /* A QUEDA, em dois tempos — ver `derrubar`, que explica por que.
     *
     * No AR, o corpo despenca e só o teto de segurança corre. NO CHÃO, o
     * relógio do atordoamento anda. Quando ele zera, o voo NÃO volta sozinho: o
     * lutador está caído na grama, e voltar ao ar é uma decisão dele, com a
     * tecla. É o que dá ao outro lado a janela para carregar o golpe. */
    if (this.caido) {
      if (this.grounded) {
        this._caido -= h;
        if (this._caido <= 0) this._caido = 0;
      } else {
        this._caidoAr -= h;
        if (this._caidoAr <= 0) this._caidoAr = 0;
      }
      if (this._caido <= 0 || this._caidoAr <= 0) {
        this.caido = false;
        this._caido = 0;
        this._caidoAr = 0;
      }
    }
    /* Caído implica atordoado, sempre — e é ESTA linha que segura o controle
       durante a queda inteira, sem depender de o `_stun` ter sido armado com a
       duração certa (ele não teria como: ninguém sabe de antemão quanto tempo
       uma queda leva). */
    if (this.caido) this.stunned = true;

    /* CARREGAR KI TRAVA O CORPO (§5 do plano) — e só vale com os pés no chão ou
       voando de verdade. Carregar no meio de uma queda não pode virar um freio
       aéreo de graça: quem está caindo, cai. */
    /* O ESPECIAL PRENDE O CORPO, e esta linha é a que faz a promessa do
     * `beam.js` ser verdade.
     *
     * Lá está escrito, desde sempre: *"a origem não acompanha o dono, e é de
     * propósito. Quem solta um especial fica preso na pose — ele não vai a lugar
     * nenhum durante o golpe."* A primeira metade era código; a segunda era uma
     * suposição que ninguém impunha. Para o BOT ela valia (`passoDoEspecial`
     * amortece a velocidade dele a zero); para o humano, não valia nada — dava
     * para soltar o Kamehameha e sair voando, e o tubo de meio quilômetro ficava
     * pendurado no ar saindo de um ponto onde não havia mais ninguém.
     *
     * `travado` é escrito pelo laço principal enquanto houver especial em curso.
     * Ele se comporta como a carga de ki: o corpo se segura no lugar, a
     * gravidade não puxa quem está voando, e não há entrada de movimento. E ele
     * dura o que a POSE dura, não o que o projétil dura — ver `duracaoDaPose`:
     * quem lança um disco fica preso 0,45 s depois do arremesso, quem SEGURA um
     * feixe fica preso enquanto ele estiver aceso. */
    const preso =
      !this.stunned && this.travado === true && (this.grounded || this.flying);

    const carregando =
      !this.stunned &&
      (ki?.carregando ?? a.charge) === true &&
      (this.grounded || this.flying);

    /* PARADO NO LUGAR: pela carga de ki OU pela pose do especial. As duas travam
       o corpo do mesmo jeito e por razões diferentes, e são mantidas separadas
       porque `_carregando` alimenta a POSE de carregar ki — dobrar as duas numa
       variável só faria o lutador aparecer de mãos em concha no meio do
       Kamehameha. */
    const imovel = carregando || preso;

    /* A GUARDA. Ela não trava o corpo como a carga trava — quem se defende
     * ainda anda, devagar, e é isso que a torna uma decisão e não uma pausa: dá
     * para recuar defendendo, que é a manobra inteira do golpe.
     *
     * Ela some sozinha quando a barra acaba. Quem decide o gasto é o laço
     * principal (a barra é dele), e ele escreve `this.defendendo` antes de
     * chamar este passo; o que se lê aqui é o resultado. Carregar e defender
     * são mutuamente exclusivos — as duas mãos estão ocupadas de jeitos opostos
     * —, e a carga ganha porque ela é a que exige o compromisso maior. */
    const defendendo = !this.stunned && !carregando && this.defendendo === true;

    const controla = !this.stunned && !imovel;
    this._carregando = carregando;

    /* ------------------------------------------------------ a arrancada ---- */
    let querImpulso = false;
    /* DEFENDENDO NÃO SE ARRANCA. O arranque é a manobra de fugir e a guarda é a
       de aguentar: deixar as duas juntas daria um lutador correndo a 64 m/s com
       78 % de redução de dano, que é a definição de não haver escolha. */
    if (controla && !defendendo) {
      /* "Shift no ar, ou botão direito". A metade "no ar" é resolvida AQUI e não
         no teclado porque só este objeto sabe onde estão os pés — no chão, o
         mesmo Shift é a corrida. */
      const noAr = this.flying || !this.grounded;
      querImpulso = a.boost === true || (a.run === true && noAr);
    }
    let impulso = false;
    if (querImpulso) {
      /* DE GRAÇA COM A BARRA CHEIA. É o pedido literal ("pode usar o modo Voo
         com shift o quanto quiser que não vai gastar o ki") e a razão de ele
         existir está em `freeFlightAt`: a barra é munição, e gastá-la para
         chegar perto de alguém é gastá-la para não poder usar. Perguntar ao
         `ki` em vez de comparar `valor` com `max` aqui mantém o limiar num
         lugar só — e é o MESMO que a sala usa. */
      if (ki?.voaDeGraca?.()) {
        impulso = true;
      } else {
        /* O DRENO. `drenar` (quando existe) é o dreno CONTÍNUO: tira o que
           houver e responde se ainda dá para continuar. `gastar` é tudo-ou-nada
           — certo para uma bola de ki, errado para um subpasso de 0,23 de
           barra, porque ele recusaria o último décimo e deixaria um resto que
           nunca queima. O contrato só promete `gastar`, então o caminho de trás
           existe. */
        const porSegundo = NAMEK.ki.boostDrain;
        if (ki?.drenar) impulso = !!ki.drenar(porSegundo, h);
        else if (ki?.gastar) impulso = !!ki.gastar(porSegundo * h);
        else impulso = true;
      }
    }
    this.boosting = impulso;

    /* Arrancar com os pés no chão DECOLA. É o X do BT3: o dash não é uma
       corrida rápida, é o momento em que o lutador sai do chão. */
    if (impulso && !this.flying) {
      this.flying = true;
      if (this.grounded) {
        this.grounded = false;
        v.y = Math.max(v.y, IMPULSO_DECOLAGEM * 0.6);
      }
    }

    this.boostBlend = damp(
      this.boostBlend,
      impulso ? 1 : 0,
      impulso ? MIST_BOOST : 1 / F.boostTail,
      h,
    );

    /* --------------------------------------------------------- as bases ---- */
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    /* Frente colada no chão, lado, e o eixo do OLHAR (com pitch). */
    const fx = -sy;
    const fz = -cy;
    const rx = cy;
    const rz = -sy;
    const lx = -sy * cp;
    const ly = sp;
    const lz = -cy * cp;

    const frente = controla ? a.forward || 0 : 0;
    const lado = controla ? a.strafe || 0 : 0;
    const vertical = controla ? a.up || 0 : 0;
    this._ladoEfetivo = lado;

    let alvoX = 0;
    let alvoY = 0;
    let alvoZ = 0;
    let temAlvo = false;
    let ganho = F.airAccel;
    let arrasto = F.airDrag;
    /* A gravidade corre SEMPRE, menos quando ele está voando e no controle.
       E NUNCA no espaço: um corpo atordoado ali não tem para onde cair, e
       deixar `−11,4 m/s²` correndo sobre alguém que levou um golpe o mandaria
       para fora da bolha por baixo, a caminho de um planeta que já explodiu. */
    let gravidade = bolha ? false : !this.flying || this.stunned;

    if (imovel) {
      /* Parado no lugar, aura acesa, vulnerável. No ar isto segura o corpo (é a
         pose do anime); no chão o atrito do chão já faz o mesmo. É o único
         lugar em que o lutador flutua sem voar. */
      ganho = 12;
      temAlvo = true;
      if (this.flying) gravidade = false;
    } else if (this.flying) {
      const velMax = F.flySpeed + (F.boostSpeed - F.flySpeed) * this.boostBlend;

      /* Segurar a arrancada SEM direção é um dash para frente. É o X do BT3
         sozinho, e é o que a mão espera: ninguém aperta o botão de arranque
         para ficar parado. */
      const f = frente === 0 && lado === 0 && vertical === 0 && impulso ? 1 : frente;

      /* **VOA-SE PARA ONDE SE OLHA.** O componente de frente segue o eixo de
         mira com pitch; o lateral fica na horizontal, senão uma curva com o
         nariz baixo jogaria o corpo para dentro do chão. */
      let dx = lx * f + rx * lado;
      let dy = ly * f;
      let dz = lz * f + rz * lado;
      const m = modulo(dx, dy, dz);
      if (m > 1e-6) {
        const k = velMax / m;
        alvoX = dx * k;
        alvoY = dy * k;
        alvoZ = dz * k;
        temAlvo = true;
      }

      /* Subir e descer têm velocidade própria (`climbSpeed`), mas ela ESCALA
         com a arrancada: quem segura o boost e o espaço espera subir rápido, e
         20 m/s no meio de um voo de 64 m/s lê como corda bamba. */
      if (vertical !== 0) {
        alvoY += vertical * F.climbSpeed * (velMax / F.flySpeed);
        temAlvo = true;
      }

      /* TETO. A subida vai morrendo nos últimos metros em vez de bater.
         O número vem do REGIME e não da constante — ver `this.regime`: em
         partida comum ele É `NAMEK.world.ceiling`, e durante a fuga do planeta
         ele são os 2 000 m de `NAMEK.fim.fuga.teto`. Dentro da bolha do espaço
         não há teto nenhum: quem cuida do limite lá é o freio esférico. */
      if (alvoY > 0 && !bolha) {
        const folga = (R.teto - p.y) / FAIXA_TETO;
        if (folga < 1) alvoY *= clamp(folga, 0, 1);
      }

      const teto = Math.max(velMax, F.climbSpeed * (velMax / F.flySpeed));
      const mag = modulo(alvoX, alvoY, alvoZ);
      if (mag > teto) {
        const k = teto / mag;
        alvoX *= k;
        alvoY *= k;
        alvoZ *= k;
      }

      ganho = impulso ? F.boostAccel : F.airAccel;
    } else if (this.grounded) {
      const vel = a.run === true ? F.runSpeed : F.walkSpeed;
      let dx = fx * frente + rx * lado;
      let dz = fz * frente + rz * lado;
      const m = modulo2(dx, dz);
      if (m > 1e-6) {
        const k = vel / m;
        alvoX = dx * k;
        alvoZ = dz * k;
        temAlvo = true;
      }
      ganho = F.groundAccel;
      arrasto = F.groundDrag;
    } else {
      /* No ar SEM voar: pulo, queda, arremesso. Existe controle, mas pouco —
         é o que deixa corrigir a queda sem transformar todo salto em voo. */
      let dx = fx * frente + rx * lado;
      let dz = fz * frente + rz * lado;
      const m = modulo2(dx, dz);
      if (m > 1e-6) {
        const k = F.runSpeed / m;
        alvoX = dx * k;
        alvoZ = dz * k;
        temAlvo = true;
      }
      ganho = F.airAccel * 0.35;
    }

    /* A guarda APARA A VELOCIDADE, e não a aceleração: mexer no ganho faria o
       lutador demorar a chegar à mesma velocidade de sempre, o que lê como
       lentidão de rede. Cortando o alvo, ele se move devagar e responde na
       hora — que é a diferença entre um corpo pesado e um controle atrasado. */
    if (defendendo && temAlvo) {
      const k = NAMEK.guard.speed;
      alvoX *= k;
      alvoY *= k;
      alvoZ *= k;
    }

    /* ------------------------------------------------- a barreira macia ----
       §2 do plano e o comentário de `world.softEdge`: um freio que CRESCE.

       São dois termos, e os dois precisam existir. O puxão de volta
       (`pull · excesso`) é o que está escrito no config, e sozinho ele NÃO
       resolve: o motor daqui é um servo, e um servo tem autoridade infinita —
       ele defenderia a velocidade desejada contra qualquer aceleração externa e
       o lutador sairia do planeta em linha reta, devagar mas para sempre.

       O segundo termo tira do motor, e só dele, a autoridade PARA FORA: no
       início da faixa ela é inteira, na borda da arena é zero. O efeito é uma
       velocidade de fuga que vai caindo com a profundidade — vento contra, não
       parede — e o puxão do config cuida de trazer de volta quem está lá fora
       sem motor nenhum (arremessado, atordoado). */
    /* O freio é medido contra `flyRadius`, e não contra `radius`. Ver o
       comentário dos dois no config: `radius` é o raio de JOGO (nascimento,
       cratera, grade de deslocamento) e `flyRadius` é o de PASSEIO. Enquanto
       eram o mesmo número, o jogador era virado de volta a 420 m — antes de a
       serra terminar —, e a praia e o mar eram cenário inalcançável. */
    if (bolha) {
      /* ------------------------------------------- a barreira macia ESFÉRICA
       *
       * A mesma mecânica dos dois termos, em três dimensões: no espaço não há
       * "para baixo", então um freio cilíndrico como o do planeta deixaria a
       * saída pelo topo e pelo fundo abertas — e sair da bolha por baixo é cair
       * de volta para um planeta que já não existe.
       *
       * O centro é o da bolha e não a origem do mundo: ela fica a 2 250 m de
       * altura (`NAMEK.fim.espaco.altura`), e medir a distância a partir do
       * chão de antes puxaria todo mundo para o lugar de onde o planeta saiu. */
      const dx = p.x - bolha.x;
      const dy = p.y - bolha.y;
      const dz = p.z - bolha.z;
      const d = modulo(dx, dy, dz);
      const inicio = bolha.raio * NAMEK.fim.espaco.freioInicio;
      if (d > inicio) {
        const inv = 1 / d;
        const nx = dx * inv;
        const ny = dy * inv;
        const nz = dz * inv;
        const excesso = d - inicio;

        const t = clamp(excesso / Math.max(1, bolha.raio - inicio), 0, 1);
        const paraFora = alvoX * nx + alvoY * ny + alvoZ * nz;
        if (paraFora > 0) {
          alvoX -= nx * paraFora * t;
          alvoY -= ny * paraFora * t;
          alvoZ -= nz * paraFora * t;
        }

        const forca = W.softEdge.pull * excesso * (d > bolha.raio ? 2 : 1);
        v.x -= nx * forca * h;
        v.y -= ny * forca * h;
        v.z -= nz * forca * h;
      }
    } else {
      const limite = W.flyRadius ?? W.radius;
      const r = modulo2(p.x, p.z);
      if (r > W.softEdge.start) {
        const inv = 1 / r;
        const nx = p.x * inv;
        const nz = p.z * inv;
        const excesso = r - W.softEdge.start;

        /* -------------------------------------- e ele AFROUXA COM A ALTITUDE
         *
         * Durante a fuga do planeta, `regime.freioSolta`/`freioMorre` deixam de
         * ser `Infinity` e este fator cai de 1 a 0 entre as duas cotas. É a
         * correção que a fuga exigia: o freio existe para o mapa não vazar
         * pelos LADOS, e a mil metros de altura ele não protege nada — só
         * empurra para dentro quem está subindo em espiral, que durante a
         * contagem é exatamente quem está correndo contra o relógio do planeta
         * para chegar ao alto.
         *
         * O afrouxamento vale só para o termo que tira autoridade do motor. O
         * PUXÃO de quem está fora do limite continua inteiro em qualquer
         * altura (ver o `forca` lá embaixo): ele não é a borda do passeio, é a
         * garantia de que ninguém fica pendurado no vazio, e isso não tem nada
         * a ver com estar fugindo. */
        let solto = 1;
        if (p.y > R.freioSolta) {
          const faixa = Math.max(1, R.freioMorre - R.freioSolta);
          solto = 1 - clamp((p.y - R.freioSolta) / faixa, 0, 1);
        }

        const t = clamp(excesso / (limite - W.softEdge.start), 0, 1) * solto;
        const paraFora = alvoX * nx + alvoZ * nz;
        if (paraFora > 0) {
          alvoX -= nx * paraFora * t;
          alvoZ -= nz * paraFora * t;
        }

        /* Fora do LIMITE de voo o puxão dobra. É a garantia de que ninguém fica
           pendurado no vazio: mesmo um teleporte a mil metros da borda volta.
           Contra `flyRadius`, pelo mesmo motivo de cima — `isInsideWorld`
           responde pelo raio de jogo (460 m), que hoje é bem menor que o de
           passeio, e usá-lo aqui dobraria o freio já em cima da montanha. */
        const forca = W.softEdge.pull * excesso * (r > limite ? 2 : 1);
        v.x -= nx * forca * h;
        v.z -= nz * forca * h;
      }
    }

    /* ------------------------------------------------------ o servo -------- */
    if (temAlvo) {
      v.x = damp(v.x, alvoX, ganho, h);
      v.z = damp(v.z, alvoZ, ganho, h);
      if (this.flying || carregando) v.y = damp(v.y, alvoY, ganho, h);
    } else {
      /* Sem entrada, o atrito. No ar ele é BAIXO de propósito — o lutador
         derrapa, e é daí que vem o peso sem lentidão. */
      v.x = damp(v.x, 0, arrasto, h);
      v.z = damp(v.z, 0, arrasto, h);
      if (this.flying) v.y = damp(v.y, 0, arrasto, h);
    }

    if (gravidade) v.y += F.gravity * h;

    /* --------------------------------------------------- a ladeira ---------
       A normal do terreno custa QUATRO consultas de altura — é a coisa mais cara
       de um subpasso — e o caminho de andar precisaria dela duas vezes: aqui, e
       de novo no contato. Ela é calculada uma vez e o contato reaproveita
       (`temNormal`) quando os pés já estavam no chão: entre um subpasso e o
       seguinte o corpo andou 24 cm no pior caso, e a inclinação não vira nesse
       espaço. Quem chega VOANDO calcula a sua, e essa é a que importa — é a que
       decide a força da cratera. */
    let temNormal = false;
    if (this.grounded) {
      const n = this.field.normalAt(p.x, p.z, 0.8, this._normal);
      temNormal = true;
      if (n.y < ESCORREGA) {
        /* Ladeira íngreme demais para se firmar: o corpo escorrega, e escorrega
           NA DIREÇÃO DA NORMAL projetada — que é ladeira abaixo por construção
           (`normalAt` devolve nx = hEsquerda − hDireita). A força cresce com a
           inclinação, e no limite é a gravidade inteira. */
        const forca = (ESCORREGA - n.y) / ESCORREGA;
        const g = -F.gravity;
        v.x += n.x * g * forca * h;
        v.z += n.z * g * forca * h;
      }
    }

    /* ------------------------------------------------------ integração ----- */
    p.x += v.x * h;
    p.y += v.y * h;
    p.z += v.z * h;

    /* Teto, como travessa final. A faixa acima já tirou a vontade de subir; isto
       aqui é o que segura um empurrão vertical que veio de fora.
       `regime.teto`, e não a constante: ver o comentário de `this.regime`. Sem
       esta linha ler o regime, um lutador em fuga levaria um empurrão para cima
       e seria cortado a 520 m — no meio da subida que o modo inteiro pede. */
    if (!bolha && p.y > R.teto) {
      p.y = R.teto;
      if (v.y > 0) v.y = 0;
    }

    /* ------------------------------------------------------- o contato -----
       NO ESPAÇO NÃO HÁ CONTATO. É a maior das cinco coisas que a bolha desliga,
       e ela sai daqui inteira: sem esta saída, `heightAt` continuaria devolvendo
       o relevo do planeta (a função é pura em (x, z) e não sabe que o planeta
       explodiu), e todo mundo estaria voando a 2 250 m sobre um chão fantasma
       que só se manifestaria ao alguém descer até ele. */
    if (bolha) return null;

    const chao = this._chao(p.x, p.z);

    if (p.y > chao) {
      /* Acima do relevo. Descendo uma ladeira, o corpo COLA nela em vez de
         decolar em cada lombada — o mesmo `enableSnapToGround` que o arqueiro
         pede ao Rapier, escrito à mão. */
      if (this.grounded && !this.flying && v.y <= 0 && p.y - chao <= COLA_CHAO) {
        p.y = chao;
        v.y = 0;
      } else {
        this.grounded = false;
      }
      return null;
    }

    /* Tocou o chão. */
    const n = temNormal
      ? this._normal
      : this.field.normalAt(p.x, p.z, 0.8, this._normal);
    /* A velocidade de IMPACTO é a que fecha contra a NORMAL, não a vertical: um
       mergulho de 64 m/s a 40° e uma queda a prumo de 50 m/s batem diferente, e
       bater de raspão numa encosta não pode abrir a mesma cratera que bater de
       frente nela. */
    const vn = v.x * n.x + v.y * n.y + v.z * n.z;
    const impacto = vn < 0 ? -vn : 0;
    const caindo = !this.grounded;
    const veioVoando = this.flying;

    p.y = chao;
    if (vn < 0) {
      v.x -= n.x * vn;
      v.y -= n.y * vn;
      v.z -= n.z * vn;
    }

    /* Voando com o espaço apertado, o lutador RASPA o chão em vez de pousar —
       é o voo rasante do BT3. Sem isso, encostar num morro no meio de uma
       perseguição derrubaria o voo e a perseguição junto. */
    if (this.flying && vertical > 0) {
      this.grounded = false;
      return null;
    }
    this.flying = false;
    this.grounded = true;

    /* O baque planta o corpo: quanto mais forte, menos sobra de velocidade
       horizontal. Sem isto, um mergulho a 90 m/s vira um patinho deslizando
       trezentos metros de clareira. */
    if (impacto > 1) {
      const freio = clamp(impacto / F.fallSafe, 0, 1) * 0.8;
      v.x -= v.x * freio;
      v.z -= v.z * freio;
    }

    if (!caindo || impacto < NAMEK.destruction.slamSpeed) return null;

    const e = this._evento;
    e.tipo = veioVoando && !this.stunned ? "pouso" : "queda";
    e.speed = impacto;
    e.p.x = p.x;
    e.p.y = p.y;
    e.p.z = p.z;
    return e;
  }

  /**
   * Os canais de animação. Uma vez por quadro, com o dt cheio.
   *
   * `boostBlend` não está aqui, e é de propósito: ele não é só pose, é FÍSICA —
   * é ele que interpola a velocidade máxima entre cruzeiro e arrancada, e por
   * isso vive dentro do subpasso.
   */
  _animar(dt) {
    const F = NAMEK.fighter;
    const v = this.velocity;

    this.flyBlend = damp(this.flyBlend, this.flying ? 1 : 0, MIST_VOO, dt);
    this.chargeBlend = damp(
      this.chargeBlend,
      this._carregando ? 1 : 0,
      MIST_CARGA,
      dt,
    );

    const plano = modulo2(v.x, v.z);

    /* 0 andando … 1 correndo, e tirado da velocidade REAL e não da tecla: assim
       a passada acompanha a ladeira, o escorregão e o empurrão, sem nenhum caso
       especial escrito em lugar nenhum. */
    const corrida = this.grounded
      ? clamp((plano - F.walkSpeed) / (F.runSpeed - F.walkSpeed), 0, 1)
      : 0;
    this.runBlend = damp(this.runBlend, corrida, MIST_CORRIDA, dt);

    /* A FASE ANDA COM A DISTÂNCIA, não com o relógio — a cadência acompanha
       sozinha a velocidade e o pé nunca patina. É a mesma conta do arqueiro
       (`Player.update`), e ela congela no ar pelo mesmo motivo de lá: a fase
       correndo em pleno voo faz o boneco pedalar. */
    if (this.grounded) {
      const passada = PASSADA * (1 + PASSADA_CORRIDA * this.runBlend);
      this.gaitPhase += ((plano * dt) / passada) * TAU;
      if (this.gaitPhase > TAU) this.gaitPhase -= TAU;
    }

    /* ------------------------------------------------------- a rolagem ----- */
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    /* Aceleração lateral do quadro, projetada no eixo direito do corpo. É ela
       que faz a curva inclinar o corpo — o mesmo que um piloto sente na
       poltrona, e o motivo de o voo não parecer um trilho. */
    const ax = (v.x - this._vAntX) / dt;
    const az = (v.z - this._vAntZ) / dt;
    const lateral = ax * cy + az * -sy;

    let alvo = clamp(
      lateral * ROLL_ACEL + this._ladoEfetivo * ROLL_ENTRADA,
      -ROLL_MAX,
      ROLL_MAX,
    );
    /* No chão o corpo quase não tomba: quem corre não faz curva de asa. */
    if (!this.flying) alvo *= 0.18;
    if (this.stunned) alvo = 0;
    this.roll = damp(this.roll, alvo, ROLL_SUAV, dt);

    this._vAntX = v.x;
    this._vAntZ = v.z;
  }
}
