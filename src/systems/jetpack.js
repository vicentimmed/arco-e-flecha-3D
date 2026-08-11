/* ---------------------------------------------------------------------------
   O jetpack da Lua: combustível, empuxo e a máquina de estados da ignição.

   A REGRA QUE DEFINE A HABILIDADE é o combustível acabar. Sem ela o cenário
   inteiro desmonta: quem pode voar sempre nunca precisa do chão, o foguete
   deixa de ser um lugar difícil de alcançar e o duelo vira uma perseguição
   aérea sem fim. Por isso o tanque só enche COM OS PÉS NO CHÃO — pousar é uma
   decisão tática, não uma pausa.

   ------------------------------------------------------------------- ignição

     no chão ──(Espaço)──▶ SALTO ──(Espaço de novo + tanque)──▶ JATO
                                          │
        ┌───── (solta Espaço) ────────────┤
        ▼                                 ▼
      PLANANDO ──(Espaço)──▶ JATO    (tanque vazio) ──▶ QUEDA
        │                                 │
        └────────── tocou o chão ─────────┘  → reabastece

   Dois detalhes que fazem a diferença no controle:

   • **Ignição por BORDA, não por estar segurando.** Pular e continuar com o
     dedo no espaço não acende o jato — tem de ser um segundo toque. Sem isso,
     todo salto viraria um voo, e o salto lunar (2,6 m, 3,6 s) é bom demais para
     ser atropelado.

   • **Soltar apaga e GUARDA o combustível.** Dá para voar em pulsos, e é isso
     que transforma o tanque de seis segundos numa habilidade em vez de um botão
     que se segura até acabar.
   --------------------------------------------------------------------------- */

import * as THREE from "three";

export class Jetpack {
  /**
   * @param {object} cfg bloco `jetpack` da fase (ver `CONFIG.levels.moon`)
   */
  constructor(cfg) {
    this.cfg = cfg;
    /** Segundos de queima que restam. */
    this.fuel = cfg.fuel;
    /** O jato está queimando AGORA. */
    this.active = false;
    /** Espaço está pressionado neste instante (estado, não borda). */
    this.held = false;
    /** Contagem regressiva até o tanque voltar a encher depois de pousar. */
    this.refuelWait = 0;
    /** Empuxo aplicado ao eixo vertical pelo `PlayerPhysics`. */
    this.thrust = 0;
    /** Direção de movimento pedida pelo WASD, em espaço de mundo. */
    this.moveDir = new THREE.Vector3();
  }

  get fuelFraction() {
    return Math.max(0, Math.min(1, this.fuel / this.cfg.fuel));
  }

  get isLow() {
    return this.fuelFraction < this.cfg.lowFuel;
  }

  /** Tanque cheio e pronto — o estado em que o medidor pode sumir da tela. */
  get isFull() {
    return this.fuel >= this.cfg.fuel - 1e-3;
  }

  /**
   * A BORDA do espaço: chamada uma vez por toque, não por quadro.
   *
   * Devolve `true` se o toque foi consumido pela ignição, e nesse caso quem
   * chama NÃO deve tratá-lo como pulo — senão o segundo toque no ar tentaria
   * pular e acender ao mesmo tempo.
   */
  onJumpPressed(grounded) {
    this.held = true;
    if (grounded) return false; // é um salto comum; o jato não se mete
    if (this.fuel <= 0) return false;
    this.active = true;
    return true;
  }

  onJumpReleased() {
    this.held = false;
    // Apaga, mas NÃO gasta o que sobrou: o tanque é do jogador, não do impulso.
    this.active = false;
  }

  /**
   * Um passo fixo de combustível e empuxo.
   *
   * Devolve `true` quando o jato está de fato queimando neste passo — é esse
   * booleano que faz `PlayerPhysics` trocar o movimento horizontal de
   * "velocidade desejada" para "aceleração".
   */
  step(h, fisica) {
    const cfg = this.cfg;
    const noChao = fisica.grounded;

    if (noChao) {
      this.active = false;
      this.thrust = 0;
      /* Reabastece só com os pés no chão, e nem imediatamente: a espera curta
         impede que raspar o solo por um quadro devolva o tanque cheio. */
      this.refuelWait = this.refuelWait > 0 ? this.refuelWait - h : 0;
      if (this.refuelWait <= 0) {
        this.fuel = Math.min(cfg.fuel, this.fuel + cfg.refuelRate * h);
      }
      fisica.jetVelocity.set(0, 0, 0);
      return false;
    }

    // Saiu do chão: da próxima vez que pousar, espera antes de encher.
    this.refuelWait = cfg.refuelDelay;

    if (!this.active || !this.held || this.fuel <= 0) {
      this.active = false;
      this.thrust = 0;
      return false;
    }

    this.fuel -= h;
    if (this.fuel <= 0) {
      // Acabou no meio do voo: o empuxo some e a pessoa cai. É o momento em que
      // a habilidade cobra a conta, e ele precisa acontecer sem aviso extra —
      // o aviso foi o medidor pulsando vermelho desde os 25 %.
      this.fuel = 0;
      this.active = false;
      this.thrust = 0;
      return false;
    }

    this.thrust = cfg.thrust;

    /* Teto de subida. Sem ele o empuxo líquido de +4,4 m/s² acumularia sem
       limite nos seis segundos e a pessoa sairia da arena por cima. */
    if (fisica.verticalVelocity > cfg.maxRiseSpeed) {
      this.thrust = 0;
      fisica.verticalVelocity = cfg.maxRiseSpeed;
    }

    /* Horizontal por ACELERAÇÃO. O amortecimento é o que dá controle: sem ele o
       corpo nunca para de derivar e mirar no ar fica impossível; com ele demais,
       vira andar no ar. 0,7 1/s é a faixa em que a inércia se sente sem
       atrapalhar. */
    const v = fisica.jetVelocity;
    v.x += this.moveDir.x * cfg.airThrust * h;
    v.z += this.moveDir.z * cfg.airThrust * h;

    const amort = Math.max(0, 1 - cfg.airDrag * h);
    v.x *= amort;
    v.z *= amort;

    const vel = Math.hypot(v.x, v.z);
    if (vel > cfg.maxAirSpeed) {
      const k = cfg.maxAirSpeed / vel;
      v.x *= k;
      v.z *= k;
    }
    return true;
  }

  /**
   * Zera tudo. Chamado ao morrer, ao nascer e ao trocar de fase — nenhum dos
   * três deve herdar um tanque pela metade nem um jato aceso.
   */
  reset() {
    this.fuel = this.cfg.fuel;
    this.active = false;
    this.held = false;
    this.refuelWait = 0;
    this.thrust = 0;
    this.moveDir.set(0, 0, 0);
  }
}
