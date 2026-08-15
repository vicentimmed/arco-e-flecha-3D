/* ---------------------------------------------------------------------------
   A barra de ki.

   É pequena, e é o coração da economia do modo. Três regras, e todas as três
   vieram do pedido:

   1. **Existe um botão de CARREGAR.** Segurar enche a barra depressa, e enquanto
      se carrega não se faz mais nada — é a pose do anime e é a troca do jogo:
      poder em troca de estar parado à vista de todo mundo.

   2. **O ESPECIAL só sai com a barra CHEIA.** Não "com ki suficiente": cheia.
      Ver `podeEspecial`.

   2b. **Barra cheia VOA DE GRAÇA.** O arranque com Shift só cobra enquanto a
      barra não está no topo; cheia, ela não desce voando — desce atirando. Ver
      `voaDeGraca` e o comentário de `freeFlightAt`, que explica por que a barra
      é munição e não combustível.

   3. **A rajada básica NÃO exige barra cheia**, custa uma lasca (`blastCost`) e
      é o ataque do dia a dia. O §5 do plano explica por que essa divisão é
      obrigatória: se o tiro comum também pedisse barra cheia, o jogador ficaria
      sem ataque nenhum durante quase toda a partida e o modo não teria
      jogabilidade — que é exatamente a divisão que o Budokai Tenkaichi 3 usa.

   ------------------------------------------------------------------ a regen

   Existe uma regeneração passiva pequena, e ela não contradiz o botão: ela é a
   rede de segurança contra o estado morto. Sem ela, um jogador que zerou a barra
   fugindo fica sem tiro E sem arranque para escapar — ou seja, sem nada para
   fazer além de esperar apanhar, o que não é uma punição, é uma pausa. Ela é
   lenta de propósito (`idleRegen` são doze vezes menos que o botão) e só volta
   `idleDelay` depois do último gasto: quem quer ki de verdade para de correr e
   carrega.
   --------------------------------------------------------------------------- */

import { NAMEK } from "../shared/namek/config.js";

export class KiMeter {
  constructor(inicial = NAMEK.ki.max) {
    this.max = NAMEK.ki.max;
    this.valor = inicial;
    /** Está segurando o botão de carregar? Quem escreve é o laço principal. */
    this.carregando = false;
    /** s desde o último gasto — segura a regeneração passiva. */
    this.desdeGasto = 999;
    /** 0…1, para a pose e a aura. Sobe e desce amortecido, não em degrau. */
    this.blend = 0;
    /** Encheu NESTE quadro? O HUD usa para o aviso, e ele é o que faz o
     *  jogador saber que o especial destravou (§5 do plano). */
    this.encheuAgora = false;
  }

  get fracao() {
    return this.valor / this.max;
  }

  /** Cheia? A pergunta que o especial faz. */
  get cheia() {
    /* A margem de um milésimo existe porque `valor` chega ao máximo por soma de
       ponto flutuante (`+= chargeRate * dt`) e o `clamp` o deixa em 99,99999999.
       Sem ela, a barra fica visualmente cheia e o especial recusa — o pior tipo
       de bug de jogo, porque o jogador vê a tela dizendo que pode e o botão não
       responde. */
    return this.valor >= this.max - 1e-3;
  }

  /**
   * Dá para soltar um especial? A pergunta é sobre a barra CHEIA, não sobre ter
   * o custo — e é a regra número 2 do cabeçalho.
   */
  podeEspecial() {
    return this.fracao >= NAMEK.ki.specialThreshold - 1e-6;
  }

  /**
   * O arranque sai de graça? **Sai, com a barra cheia** — ver `freeFlightAt`.
   *
   * A pergunta é feita por subpasso pelo `FighterController`, e a resposta é a
   * mesma que a sala dá em `economiaDeKi`: um lado que cobrasse e o outro não
   * faria a barra do HUD brigar com a barra que vale.
   */
  voaDeGraca() {
    return this.fracao >= NAMEK.ki.freeFlightAt - 1e-6;
  }

  /**
   * Enche a barra na hora. É o prêmio por DERRUBAR alguém (§ do laço principal).
   *
   * Sem amortecimento e sem esperar o `VITALS`: o pedido é "assim que ele
   * começar a cair a barra já deve encher instantaneamente", e meio segundo de
   * barra subindo é meio segundo em que o especial ainda recusa — que é o
   * "às vezes não acontece" do relato. A sala faz a mesma coisa no mesmo
   * instante (ver `matar`), então os dois valores já nascem iguais e o
   * `sincronizar` seguinte não tem nada para corrigir.
   */
  encher() {
    this.valor = this.max;
    this.desdeGasto = 0;
  }

  /**
   * Gasta, se houver. Devolve se o gasto aconteceu.
   *
   * TUDO OU NADA de propósito: um disparo pela metade não existe, e deixar
   * gastar o que sobra produziria o meio-tiro que sai sem dano e sem visual.
   */
  gastar(quanto) {
    if (quanto <= 0) return true;
    if (this.valor < quanto) return false;
    this.valor -= quanto;
    this.desdeGasto = 0;
    return true;
  }

  /** Gasta a barra inteira. É o preço de todo especial. */
  gastarTudo() {
    if (!this.podeEspecial()) return false;
    this.valor = 0;
    this.desdeGasto = 0;
    return true;
  }

  /** O dreno contínuo do arranque com ki. Devolve se ainda dá para continuar. */
  drenar(porSegundo, dt) {
    const quanto = porSegundo * dt;
    if (this.valor <= 0) return false;
    this.valor = Math.max(0, this.valor - quanto);
    this.desdeGasto = 0;
    return this.valor > 0;
  }

  /** A sala mandou o valor dela — ela é a autoridade sobre a barra (§8). */
  sincronizar(valor) {
    if (!Number.isFinite(valor)) return;
    /* PERSEGUE em vez de assumir. A sala manda a 10 Hz e o cliente gasta a 60:
       escrever o valor recebido direto faria a barra pular para trás toda vez
       que uma amostra velha chegasse depois de um tiro — o pulo apareceria como
       a barra "engasgando" a cada dez quadros. A diferença é absorvida em um
       décimo de segundo, e uma divergência de verdade (a sala recusou um gasto)
       ainda converge. */
    this.valor += (valor - this.valor) * 0.35;
  }

  update(dt) {
    const K = NAMEK.ki;
    const antesCheia = this.cheia;

    if (this.carregando) {
      this.valor = Math.min(this.max, this.valor + K.chargeRate * dt);
      this.desdeGasto = 0;
    } else {
      this.desdeGasto += dt;
      if (this.desdeGasto >= K.idleDelay) {
        this.valor = Math.min(this.max, this.valor + K.idleRegen * dt);
      }
    }

    /* O blend da POSE. Sobe rápido (a pose de carregar é uma explosão de
       postura, não um agachamento lento) e desce mais devagar, para o corpo não
       voltar ao normal num estalo quando o botão solta. */
    const alvo = this.carregando ? 1 : 0;
    const k = this.carregando ? 11 : 6;
    this.blend += (alvo - this.blend) * Math.min(1, k * dt);

    this.encheuAgora = !antesCheia && this.cheia;
  }
}
