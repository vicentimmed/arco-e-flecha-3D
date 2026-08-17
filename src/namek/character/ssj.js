/* ---------------------------------------------------------------------------
   O SUPER SAIYAJIN — a metade CLIENTE.

   Este arquivo é três coisas, e elas moram juntas porque são a mesma ideia
   vista de três ângulos:

   1. **A máquina de estados do lutador local** (`SuperSaiyajin`): pediu, está
      se transformando, está transformado. Ela roda no relógio do quadro, prevê
      a transformação para o gesto responder na hora, e se desfaz sozinha se a
      sala não confirmar.
   2. **As perguntas de economia** (`limiarDeEspecial`, `custoDeEspecial`,
      `vidaMaxima`): as mesmas que a sala faz do lado dela, lendo as MESMAS
      constantes de `NAMEK.ssj`.
   3. **A cor** (`infoDoGolpe`, `corDoGolpe`, `TINTA_SSJ`): o pedido de que
      "todos os poderes que ele solta ficam amarelos", resolvido num lugar só.

   ============================================================================
   POR QUE A COR PASSA POR UMA FUNÇÃO
   ============================================================================

   A cor de cada especial vem de `NAMEK.specials.*.cor`, e ela era lida DIRETO
   em uma dúzia de lugares: o feixe, a esfera, o disco, as partículas de cada
   um, a luz que cada um pede, a aura de quem está carregando e o tijolo do HUD.
   Doze leituras da mesma constante são doze lugares que teriam de aprender,
   um a um, que existe um estado em que ela é outra — e o décimo terceiro, o que
   alguém escrever amanhã, nasceria azul.

   A saída é não trocar a leitura, e sim o OBJETO LIDO. `infoDoGolpe` devolve,
   em Super Saiyajin, uma cópia do especial com a cor de ouro no lugar da
   original — e como todo mundo lá dentro lê `this.info.cor` / `S.cor` a partir
   desse objeto, a troca alcança as doze leituras sem tocar em nenhuma.

   As cópias são construídas UMA VEZ, na carga do módulo, e congeladas: são
   quatro objetos na vida do processo, não um por disparo. Um `{...S, cor}` na
   hora do tiro seria alocação no ritmo do combate, que é exatamente o que o §3
   do plano proíbe.

   ============================================================================
   O QUE ESTE ARQUIVO NÃO DECIDE
   ============================================================================

   **Nada.** A sala é a autoridade sobre vida, ki e sobre o próprio estado de
   transformação (§8 do plano) — este arquivo PREVÊ, e a previsão é revogável.

   O jogador aperta a tecla, a animação começa no mesmo quadro (três segundos de
   pose que começassem 100 ms depois do gesto pareceriam um jogo lento), e o
   `NS2C.SSJ_ON` chega logo atrás confirmando. Se ele NÃO chegar até o fim da
   animação — a sala recusou, porque o Freeza não está em campo, porque a vida
   subiu no meio do caminho, porque o pacote se perdeu —, a previsão se desfaz
   sozinha e o lutador volta ao normal. É o mesmo contrato do especial, que
   também é recusado em silêncio (ver `registrarEspecial`, na sala).

   A metade servidor é `server/namek/ssj.js`, e as fórmulas de economia estão
   escritas nos dois lugares porque um dos dois roda em Node e o outro no
   navegador. Elas são multiplicações de uma linha sobre constantes COMPARTILHADAS
   (`NAMEK.ssj`), e cada uma aponta para a gêmea pelo nome: o que não pode
   divergir são os números, e os números estão no config.
   --------------------------------------------------------------------------- */

import { NAMEK } from "../../shared/namek/config.js";

/* ============================================================== a economia == */

/**
 * O teto de vida de quem está (ou não está) transformado.
 *
 * `maxHealth` + `vidaBonus`, e o bônus entra também na vida ATUAL no instante
 * da virada — ver o §"a vida no INSTANTE da virada" em `NAMEK.ssj`, que explica
 * por que as outras duas opções mentem na barra.
 *
 * GÊMEA de `vidaMaxima` em `server/namek/ssj.js`.
 */
export function vidaMaxima(ssj) {
  return NAMEK.fighter.maxHealth + (ssj ? NAMEK.ssj.vidaBonus : 0);
}

/**
 * A fração da barra que um ESPECIAL exige.
 *
 * Normal: a barra cheia (`ki.specialThreshold`). Em Super Saiyajin: um terço
 * (`ssj.limiar`), que é o "três poderes com uma barra" do pedido.
 *
 * GÊMEA de `limiarEspecial` em `server/namek/ssj.js`.
 */
export function limiarDeEspecial(ssj) {
  return ssj ? NAMEK.ssj.limiar : NAMEK.ki.specialThreshold;
}

/** Quantos pontos de ki um especial custa. GÊMEA de `custoEspecial` na sala. */
export function custoDeEspecial(ssj) {
  return NAMEK.ki.max * (ssj ? NAMEK.ssj.especialCusto : 1);
}

/**
 * O multiplicador de todo gasto de ki que NÃO é o especial — arranque, rajada,
 * onda e guarda. É o "seu ki demora mais para gastar" virado em número.
 *
 * O especial fica de fora de propósito: o desconto dele é `especialCusto`, e
 * aplicar os dois cobraria 13 % da barra por um Kamehameha. Ver `NAMEK.ssj`.
 *
 * GÊMEO de `fatorDeGasto` em `server/namek/ssj.js`.
 */
export function fatorDeGasto(ssj) {
  return ssj ? NAMEK.ssj.kiDreno : 1;
}

/* =================================================================== a cor == */

/**
 * A tinta da BOLA DE KI em Super Saiyajin, no formato do pool de rajadas
 * (`powers/blast.js` guarda cor por instância, em três floats de 0 a 1).
 *
 * Ela é derivada de `NAMEK.ssj.cor` aqui e não escrita à mão lá porque o
 * amarelo é UM só no jogo inteiro: mudar a cor da transformação tem de mudar a
 * bolinha junto, senão a rajada seria a única coisa que continuaria azul.
 */
export const TINTA_SSJ = [
  ((NAMEK.ssj.cor >> 16) & 255) / 255,
  ((NAMEK.ssj.cor >> 8) & 255) / 255,
  (NAMEK.ssj.cor & 255) / 255,
];

/* As cópias douradas de cada especial, construídas UMA VEZ. Ver o cabeçalho:
   é a troca do OBJETO que faz a cor chegar às doze leituras de `.cor` sem
   tocar em nenhuma delas. `freeze` porque um pool que escrevesse aqui estaria
   escrevendo na definição do golpe de todo mundo. */
const DOURADOS = Object.create(null);
for (const kind of Object.keys(NAMEK.specials)) {
  DOURADOS[kind] = Object.freeze({ ...NAMEK.specials[kind], cor: NAMEK.ssj.cor });
}

/**
 * A definição de um especial COMO ELE É VISTO — dourada em Super Saiyajin.
 *
 * Tudo o mais (dano, alcance, perseguição, potência de cratera) é o mesmo
 * objeto de sempre: a transformação muda a cor do golpe e a economia de quem o
 * solta, e não o golpe. O único número que a transformação mexe no dano é o
 * multiplicador contra o Freeza, e ele é cobrado pela sala.
 *
 * @param {string} kind chave de `NAMEK.specials`
 * @param {boolean} ssj o DONO do golpe está transformado?
 */
export function infoDoGolpe(kind, ssj) {
  return (ssj ? DOURADOS[kind] : NAMEK.specials[kind]) ?? null;
}

/** Só a cor, para quem não precisa do resto (a aura de carga, o HUD). */
export function corDoGolpe(kind, ssj) {
  if (ssj) return NAMEK.ssj.cor;
  return NAMEK.specials[kind]?.cor ?? null;
}

/* ============================================================== o gatilho == */

/**
 * O jogador PODE se transformar agora?
 *
 * A mesma pergunta que a sala faz em `server/namek/ssj.js: podeAcender`, e ela
 * é feita aqui por dois motivos diferentes: para o ALERTA aparecer na tela (é o
 * "aparece um alerta que ele pode se transformar" do pedido) e para a previsão
 * não começar uma animação que a sala vai recusar.
 *
 * O `freeza` é lido com `?.` por quem chama, e vale `false` quando o chefe não
 * existe: enquanto `NAMEK.ssj.exigeFreeza` estiver ligado, sem Freeza em campo
 * não há transformação — que é o contexto que o pedido descreve.
 *
 * @param {object} ctx `{ vida, freeza, vivo, caido, ssj }`
 */
export function podeAcender(ctx) {
  if (!ctx || ctx.ssj) return false;
  if (!ctx.vivo || ctx.caido) return false;
  if (NAMEK.ssj.exigeFreeza && !ctx.freeza) return false;
  /* Contra o teto BASE, e não contra `vidaMaxima(ctx.ssj)`: quem ainda não se
     transformou tem teto 100 por definição, e escrever a conta com o teto
     variável só esconderia isso. */
  return ctx.vida <= NAMEK.fighter.maxHealth * NAMEK.ssj.gatilho;
}

/* ========================================================== a máquina ===== */

/**
 * O estado do lutador LOCAL. Um por partida — o laço principal tem um.
 *
 * As três fases e o que cada uma significa:
 *
 * • **apagado** — nada. `aceso` é falso, o bit 16 não sobe.
 * • **transformando** — os três segundos. `aceso` JÁ É verdade (o bit sobe no
 *   primeiro quadro: quem olha de longe tem de ver o ouro subindo junto com o
 *   grito, não depois dele), `invencivel` é verdade, e `fracao` anda de 0 a 1
 *   alimentando a pose, a aura e o HUD.
 * • **aceso** — transformado. Fica assim até morrer ou até o Freeza cair; não
 *   há relógio (ver o §"quando ela ACABA" em `NAMEK.ssj`).
 */
export class SuperSaiyajin {
  constructor() {
    /** Está em Super Saiyajin? Vale já DURANTE a transformação — ver acima. */
    this.aceso = false;
    /** Os três segundos estão correndo? */
    this.transformando = false;
    /** s desde o começo da animação. */
    this.t = 0;
    /** A sala confirmou (`NS2C.SSJ_ON` chegou)? Ver o cabeçalho: sem isto até o
     *  fim da animação, a previsão se desfaz. */
    this.confirmado = false;
  }

  /** 0…1 da animação. Fora dela, 0. */
  get fracao() {
    if (!this.transformando) return 0;
    const d = NAMEK.ssj.duracao;
    const u = d > 0 ? this.t / d : 1;
    return u < 0 ? 0 : u > 1 ? 1 : u;
  }

  /** "Fica invencível enquanto está se transformando" — os três segundos
   *  inteiros. Quem NÃO cobra dano de verdade é a sala; isto é o espelho local,
   *  para o HUD e para o corpo não reagirem a um golpe que não vai doer. */
  get invencivel() {
    return this.transformando;
  }

  /**
   * O jogador apertou a tecla. Começa a animação AGORA, na previsão.
   *
   * @returns {boolean} se o pedido foi aceito localmente (e portanto se vale a
   *   pena mandar o `NC2S.SSJ`). Um segundo aperto durante a animação não
   *   reinicia nada.
   */
  pedir() {
    if (this.aceso || this.transformando) return false;
    this.transformando = true;
    this.aceso = true;
    this.confirmado = false;
    this.t = 0;
    return true;
  }

  /**
   * A sala confirmou: `NS2C.SSJ_ON`.
   *
   * O relógio da animação é REALINHADO pelo instante da sala. Para quem pediu,
   * a correção é de um punhado de milissegundos (a viagem de ida e volta) e
   * praticamente não se vê; o que ela garante é que os três segundos de todo
   * mundo terminem no mesmo instante, que é o que faz a explosão do fim
   * acontecer junto em todas as telas.
   *
   * Ela também é o caminho de quem NÃO pediu — o `SSJ_ON` que chega sem
   * previsão nenhuma (uma reconexão, um pacote perdido no `NC2S.SSJ`): a
   * animação começa aqui, com o atraso já descontado.
   *
   * @param {number} w instante do começo, no relógio da sala
   * @param {number} agora o relógio da sala, agora
   */
  confirmar(w, agora) {
    this.confirmado = true;
    this.aceso = true;
    const decorrido = Number.isFinite(w) && Number.isFinite(agora)
      ? Math.max(0, (agora - w) / 1000)
      : this.t;
    /* Chegou depois de a animação ter acabado (um `SSJ_ON` muito atrasado, ou o
       de alguém que entrou na sala com a transformação já feita): nada de tocar
       três segundos de grito em quem já está transformado. */
    if (decorrido >= NAMEK.ssj.duracao) {
      this.transformando = false;
      this.t = NAMEK.ssj.duracao;
      return false;
    }
    this.transformando = true;
    this.t = decorrido;
    return true;
  }

  /** Fim: morreu, ou o Freeza caiu. Também é por aqui que a previsão se desfaz. */
  desligar() {
    this.aceso = false;
    this.transformando = false;
    this.confirmado = false;
    this.t = 0;
  }

  /**
   * Um quadro.
   *
   * @returns {"explodiu"|"cancelou"|null} o ACONTECIMENTO do quadro, para o
   *   laço soltar o estouro (clarão, cratera, tremor, som) ou avisar que a
   *   sala recusou. Devolver o evento em vez de disparar daqui é o que mantém
   *   esta classe sem conhecer efeito, som nem rede.
   */
  update(dt) {
    if (!this.transformando) return null;
    this.t += dt;
    if (this.t < NAMEK.ssj.duracao) return null;
    this.transformando = false;
    this.t = NAMEK.ssj.duracao;
    /* A ANIMAÇÃO ACABOU E A SALA NÃO FALOU. A previsão se desfaz — ver o
       cabeçalho. Três segundos são uma eternidade para uma viagem de rede: se o
       `SSJ_ON` não chegou nesse tempo, ele não vai chegar. */
    if (!this.confirmado) {
      this.desligar();
      return "cancelou";
    }
    return "explodiu";
  }
}
