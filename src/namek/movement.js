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
   3. **O atrito do ar é BAIXO** (`airDrag` 1,35). Soltar tudo a 96 m/s não
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
   coordenadas vivem em ±900 m e as velocidades em ±96 m/s. */
const modulo = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const modulo2 = (x, z) => Math.sqrt(x * x + z * z);

/* ------------------------------------------------------------- subpassos ---
   Um quadro pode ser longo (aba voltando do segundo plano, GC, tela de carga) e
   a 96 m/s um quadro de 100 ms são DEZ METROS num passo só — o bastante para
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
  lockPressed: false,
  menuPressed: false,
};

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
    /** A arrancada está acesa NESTE quadro (com ki pago). Alimenta a câmera. */
    this.boosting = false;

    /* Canais de animação — os mesmos nomes que `packFighter` lê. */
    this.gaitPhase = 0;
    this.runBlend = 0;
    this.flyBlend = 0;
    this.boostBlend = 0;
    this.chargeBlend = 0;

    /* ------------------------------------------------------------ interno -- */
    /** s restantes de atordoamento. */
    this._stun = 0;
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

  /** A cota do chão: relevo, com o mar como piso.
   *
   *  O mar é PISO e não buraco por um motivo de jogo: a arena termina em oceano
   *  aberto (§2 do plano) e a barreira macia acontece sobre ele. Sem piso, quem
   *  fosse empurrado para fora afundaria para sempre — e "cair pelo mundo" é o
   *  tipo de bug que ninguém perdoa num modo de voo. Aqui ele bate na superfície
   *  e pode subir de novo. */
  _chao(x, z) {
    const h = this.field.heightAt(x, z);
    const mar = NAMEK.world.seaLevel;
    return h > mar ? h : mar;
  }

  /** As bordas de um toque. Uma vez por QUADRO — nunca por subpasso, senão um
   *  toque de espaço viraria seis pulos. */
  _bordas(dt, a) {
    const F = NAMEK.fighter;

    if (a.jumpHeld) this._espaco += dt;
    else this._espaco = 0;

    if (this.stunned) return;

    /* `F` alterna o voo. Desligar no ar é deixar-se cair — é a manobra de
       descer rápido do BT3, e é de graça: a gravidade já está escrita. */
    if (a.flyPressed) {
      this.flying = !this.flying;
      if (this.flying && this.grounded) {
        this.grounded = false;
        this.velocity.y = Math.max(this.velocity.y, IMPULSO_DECOLAGEM);
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
    const p = this.position;
    const v = this.velocity;

    if (this._stun > 0) {
      this._stun -= h;
      if (this._stun <= 0) this._stun = 0;
    }
    this.stunned = this._stun > 0;

    /* CARREGAR KI TRAVA O CORPO (§5 do plano) — e só vale com os pés no chão ou
       voando de verdade. Carregar no meio de uma queda não pode virar um freio
       aéreo de graça: quem está caindo, cai. */
    const carregando =
      !this.stunned &&
      (ki?.carregando ?? a.charge) === true &&
      (this.grounded || this.flying);
    const controla = !this.stunned && !carregando;
    this._carregando = carregando;

    /* ------------------------------------------------------ a arrancada ---- */
    let querImpulso = false;
    if (controla) {
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
    /* A gravidade corre SEMPRE, menos quando ele está voando e no controle. */
    let gravidade = !this.flying || this.stunned;

    if (carregando) {
      /* A pose de carga: parado no lugar, aura acesa, vulnerável. No ar ela
         segura o corpo (é a pose do anime); no chão o atrito do chão já faz
         isso. Este é o único lugar em que o lutador flutua sem voar. */
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
         26 m/s no meio de um voo de 96 m/s lê como corda bamba. */
      if (vertical !== 0) {
        alvoY += vertical * F.climbSpeed * (velMax / F.flySpeed);
        temAlvo = true;
      }

      /* TETO. A subida vai morrendo nos últimos metros em vez de bater. */
      if (alvoY > 0) {
        const folga = (W.ceiling - p.y) / FAIXA_TETO;
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
    const r = modulo2(p.x, p.z);
    if (r > W.softEdge.start) {
      const inv = 1 / r;
      const nx = p.x * inv;
      const nz = p.z * inv;
      const excesso = r - W.softEdge.start;

      const t = clamp(excesso / (W.radius - W.softEdge.start), 0, 1);
      const paraFora = alvoX * nx + alvoZ * nz;
      if (paraFora > 0) {
        alvoX -= nx * paraFora * t;
        alvoZ -= nz * paraFora * t;
      }

      /* Fora do RAIO o puxão dobra. `isInsideWorld` é quem responde por isso, e
         é a garantia de que ninguém fica pendurado no vazio: mesmo um teleporte
         a mil metros da borda volta. */
      const forca =
        W.softEdge.pull * excesso * (this.field.isInsideWorld(p.x, p.z) ? 1 : 2);
      v.x -= nx * forca * h;
      v.z -= nz * forca * h;
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
       aqui é o que segura um empurrão vertical que veio de fora. */
    if (p.y > W.ceiling) {
      p.y = W.ceiling;
      if (v.y > 0) v.y = 0;
    }

    /* ------------------------------------------------------- o contato ----- */
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
       mergulho de 96 m/s a 40° e uma queda a prumo de 60 m/s batem diferente, e
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
