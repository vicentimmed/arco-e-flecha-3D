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

   ------------------------------------------------------- e o que ENCHE de vez

   Um caminho só, e ele é o prêmio por DERRUBAR alguém (ver `encher`). O ABATE
   pagava o mesmo prêmio e deixou de pagar — ver `NamekRoom.matar`.
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
    /**
     * **SUPER SAIYAJIN.** Quem escreve é o laço principal; a barra só lê.
     *
     * Ela é a peça certa para carregar esta chave porque o Super Saiyajin não
     * muda o que a barra FAZ — ele muda o PREÇO de tudo o que se faz com ela, e
     * preço é assunto daqui. As quatro consequências, todas com o número em
     * `NAMEK.ssj`:
     *
     * • todo gasto contínuo ou de repetição sai por `kiDreno` do preço
     *   (`fatorDeGasto`) — é o "seu ki demora mais para gastar";
     * • o especial custa `especialCusto` da barra em vez dela inteira, e o
     *   limiar cai junto: **três golpes com uma carga**;
     * • o voo de graça acompanha o limiar novo, senão ele morreria no primeiro
     *   especial (ver `NAMEK.ssj.voaDeGracaEm`).
     *
     * Pôr a chave aqui é também o que faz o `FighterController` continuar
     * ignorante do assunto: ele já pergunta `ki.voaDeGraca()` e já chama
     * `ki.drenar(boostDrain, h)`, e as duas respostas mudam sozinhas.
     */
    this.ssj = false;
  }

  /**
   * O multiplicador de todo gasto que NÃO é o especial. GÊMEO de `fatorDeGasto`
   * em `character/ssj.js` e em `server/namek/ssj.js` — o número é um só, e ele
   * mora no config.
   *
   * O especial fica de fora de propósito: o desconto dele é `especialCusto`, e
   * cobrar os dois daria sete Kamehamehas por carga. Ver `NAMEK.ssj.kiDreno`.
   */
  get fatorDeGasto() {
    return this.ssj ? NAMEK.ssj.kiDreno : 1;
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
    return this.fracao >= this.limiarEspecial - 1e-6;
  }

  /** A fração que o especial exige: a barra cheia, ou um terço dela em Super
   *  Saiyajin. GÊMEA de `limiarEspecial` em `server/namek/ssj.js`, que é quem
   *  recusa de verdade. */
  get limiarEspecial() {
    return this.ssj ? NAMEK.ssj.limiar : NAMEK.ki.specialThreshold;
  }

  /**
   * O arranque sai de graça? **Sai, com a barra cheia** — ver `freeFlightAt`.
   *
   * A pergunta é feita por subpasso pelo `FighterController`, e a resposta é a
   * mesma que a sala dá em `economiaDeKi`: um lado que cobrasse e o outro não
   * faria a barra do HUD brigar com a barra que vale.
   */
  voaDeGraca() {
    /* Em Super Saiyajin o limiar cai junto com o do especial: sem isso, o
       primeiro golpe tiraria a barra de 100 para 67 e o arranque voltaria a
       cobrar pelo resto da transformação inteira, matando a regra justamente em
       quem mais depende dela. Ver `NAMEK.ssj.voaDeGracaEm`. */
    const em = this.ssj ? NAMEK.ssj.voaDeGracaEm : NAMEK.ki.freeFlightAt;
    return this.fracao >= em - 1e-6;
  }

  /**
   * Enche a barra na hora. É o prêmio por DERRUBAR alguém (§ do laço principal).
   *
   * Sem amortecimento e sem esperar o `VITALS`: o pedido é "assim que ele
   * começar a cair a barra já deve encher instantaneamente", e meio segundo de
   * barra subindo é meio segundo em que o especial ainda recusa — que é o
   * "às vezes não acontece" do relato. A sala faz a mesma coisa no mesmo
   * instante (ver `NamekRoom.derrubar`), então os dois valores já nascem iguais
   * e o `sincronizar` seguinte não tem nada para corrigir.
   *
   * **Só a queda paga isto.** O ABATE pagava também, e deixou de pagar — ver o
   * comentário em `NamekRoom.matar`.
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
    /* O DESCONTO DO SUPER SAIYAJIN mora aqui e não em quem chama, e é isso que
       faz "o ki demora mais para gastar" valer para a rajada, para a onda e
       para qualquer gasto que alguém acrescente amanhã sem lembrar da
       transformação. Ver `fatorDeGasto`. */
    const custo = quanto * this.fatorDeGasto;
    if (this.valor < custo) return false;
    this.valor -= custo;
    this.desdeGasto = 0;
    return true;
  }

  /**
   * Gasta o preço de um ESPECIAL. Era `gastarTudo`, e o nome deixou de servir:
   * em Super Saiyajin o golpe custa um terço da barra e não ela inteira (é o
   * "três poderes com uma carga" do pedido), então o que este método faz passou
   * a depender do estado.
   *
   * O `fatorDeGasto` NÃO entra aqui — ver `NAMEK.ssj.kiDreno`: o desconto do
   * especial já é o `especialCusto`, e somar os dois cobraria 13 % da barra por
   * um Kamehameha.
   */
  gastarEspecial() {
    if (!this.podeEspecial()) return false;
    this.valor = Math.max(0, this.valor - this.max * (this.ssj ? NAMEK.ssj.especialCusto : 1));
    this.desdeGasto = 0;
    return true;
  }

  /** O dreno contínuo do arranque com ki. Devolve se ainda dá para continuar. */
  drenar(porSegundo, dt) {
    // Mesmo desconto de `gastar`, pelo mesmo motivo — e é por aqui que passam o
    // arranque (`FighterController`) e a guarda (`NamekGame.step`).
    const quanto = porSegundo * this.fatorDeGasto * dt;
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
