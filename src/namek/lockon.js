/* ---------------------------------------------------------------------------
   QUEM É O ALVO — a mira assistida, e o painel de vida que ela acende.

   Este arquivo já foi "a trava de alvo", com a tecla `R` no comando. A tecla
   saiu a pedido — *"pode remover o atalho que dá lock-in no teclado (R); esse
   atalho não é mais necessário"* —, e com ela saiu tudo o que só ela podia
   acender. O que sobrou não é um resto: é a metade que fazia o trabalho.

   ------------------------------------------------------------ o que ficou

   **A MIRA ASSISTIDA.** Um alvo escolhido a cada quadro por quem está mais perto
   do CURSOR na tela (`NAMEK.lock.mira`). Ela responde duas perguntas e mais
   nenhuma:

       quem está sob o cursor?   → `sob`, `naTelaTodos`
       em quem o tiro mira?      → `alvoDeAtaque`

   Ela não move o lutador, não mexe na câmera, não decide dano e não dura: morre
   e renasce a cada quadro. É de propósito, e é o pedido inteiro — *"o player
   consegue atirar em vários players movendo o mouse rapidamente, sem ter que
   ficar preso a algum player"*.

   **O PAINEL DO ALVO.** A placa do canto direito (retrato, nome, barra de vida)
   tem duas razões de aparecer, e as duas são pedidos literais: você ACERTOU
   alguém, ou o cursor está EM CIMA de alguém. Quem resolve a precedência entre
   as duas e o prazo de cada uma é `_painel`, aqui embaixo; quem desenha é
   `NamekHud.setTarget`. O argumento de cada número está em `NAMEK.lock.painel`.

   O painel mora NESTE arquivo, e não no HUD, porque ele é a resposta à mesma
   pergunta que o resto da classe responde — *quem é o adversário do momento?* —
   e porque uma das duas razões já é estado daqui (`sob`). No HUD ele precisaria
   de um caminho de volta para saber a vida de alguém que o HUD não conhece.

   ------------------------------------------------------------- o que saiu

   Sem `R` não existe gesto capaz de PRENDER um adversário, então o seguinte
   deixou de ser "pouco usado" e passou a ser inalcançável — e foi removido em
   vez de ficar esperando um dono que não existe:

   • `alternar`/`_melhor`/`_ciclo` — adquirir, trocar e soltar o alvo travado;
   • o relógio da perda (`foraDe`, `foraDoQuadro`, `distante`) — que existia para
     a trava sobreviver ao alvo sair da tela. A mira assistida não sobrevive a
     nada por definição;
   • a ESCADA DE ASSISTÊNCIA (`assistencia`, `corrigir`, `atacou`) — a correção
     de rumo que a trava dava ao corpo. Ela **não** foi transferida para a mira
     assistida, e a decisão é do desenho: aquela correção pagava um COMPROMISSO
     (você declarou um alvo e o jogo te ajudava a mantê-lo na frente), enquanto o
     gesto desta é varrer o mouse por três adversários seguidos. Uma assistência
     que puxasse o olhar para quem está sob o cursor brigaria com o dedo do
     jogador exatamente enquanto ele faz o gesto que ela deveria servir;
   • `ponto`/`naTela` — o alvo em coordenadas de mundo e de tela, que a câmera e
     o anel vermelho liam. Sem trava a câmera fica sempre no enquadramento livre
     (ver a nota DORMENTE em `NAMEK.lock.camera`) e o anel vermelho saiu do HUD.

   ------------------------------------------------------------ zero alocação

   Mesma disciplina do resto do modo (§3 do plano): a varredura de candidatos não
   cria lista intermediária, os registros de tela são um pool, e `update` não
   aloca nada em regime.
   --------------------------------------------------------------------------- */

import { NAMEK } from "../shared/namek/config.js";

const GRAU = Math.PI / 180;

export class LockOn {
  constructor() {
    /* ============================================== a MIRA ASSISTIDA (soft) */

    /** Id de quem está sob o cursor, ou null. Morre e renasce a cada quadro. */
    this.sob = null;

    /**
     * ONDE CADA LUTADOR CAI NA TELA, resolvido uma vez por quadro.
     *
     * A varredura da mira assistida já projeta todo mundo; o HUD precisa das
     * mesmas posições para desenhar o círculo em volta de cada um. Publicar o
     * resultado aqui é o que evita a segunda passada — e, mais importante, o que
     * garante que o anel que o jogador vê aceso é O MESMO que os projéteis vão
     * perseguir. Duas projeções independentes se separariam por um quadro, e um
     * quadro de discordância aqui é o tiro saindo para quem não estava marcado.
     *
     * Reaproveitado entre quadros, como tudo neste arquivo.
     * @type {Array<{id:number, x:number, y:number, dist:number, visivel:boolean, sob:boolean, cor:*}>}
     */
    this.naTelaTodos = [];
    this._bancoTela = [];

    /** Rascunho da projeção. */
    this._ndc = { x: 0, y: 0, atras: false };

    /* ===================================================== o PAINEL DO ALVO */

    /**
     * De QUEM o painel deve mostrar a vida neste quadro, ou null.
     *
     * É a única saída deste bloco, e é derivada — ver `_painel`, que é onde a
     * precedência entre as duas razões está escrita. Quem lê é `NamekGame`, que
     * traduz o id em nome, cor e vida e entrega ao HUD.
     */
    this.noPainel = null;

    /** Soma do dano que EU tirei da vítima corrente. Zera com a janela. */
    this.dano = 0;

    /** Id da última vítima minha, enquanto a janela do acerto durar. */
    this._acerto = null;
    /** s restantes da janela do acerto (`painel.acerto`). */
    this._acertoT = 0;
    /** s restantes do número do dano na tela (`painel.dano`). */
    this._danoT = 0;

    /** Id de quem o cursor apontou por último, com a cauda de `painel.mira`. */
    this._mira = null;
    /** s restantes da cauda da mira. */
    this._miraT = 0;
  }

  /* ============================================================== o quadro == */

  /**
   * Uma vez por quadro: quem está sob o cursor, e o que o painel mostra.
   *
   * @param {number} dt
   * @param {object} ctx
   *   `origem`     {x,y,z} peito de quem mira
   *   `candidatos` quem pode ser mirado. É `NamekGame.mirados()`: os lutadores
   *                remotos MAIS o chefe, que entra na lista como uma ficha de
   *                lutador (`BossSystem.candidato()`, marcada com `boss: true`).
   *                Os caídos são descartados aqui.
   *   `camera`     a `THREE.PerspectiveCamera`, já com a matriz deste quadro
   *   `aspecto`    largura/altura da tela, para a zona da mira ser um CÍRCULO
   */
  update(dt, { origem, candidatos, camera, aspecto = 1 }) {
    this._sobAMira(candidatos, origem, camera, aspecto);
    this._painel(dt);
  }

  /**
   * Limpa tudo — o alvo, os círculos e o painel.
   *
   * Chamado enquanto o jogador está caído: morto não aponta para ninguém, e
   * deixar a lista de tela congelada no último quadro vivo desenharia anéis
   * parados em cima de gente que já se moveu. Idempotente.
   */
  soltar() {
    this.sob = null;
    this.naTelaTodos.length = 0;
    this.noPainel = null;
    this.dano = 0;
    this._acerto = null;
    this._acertoT = 0;
    this._danoT = 0;
    this._mira = null;
    this._miraT = 0;
  }

  /**
   * O id que um ATAQUE deve perseguir, ou null.
   *
   * É `sob` e mais nada — mas continua sendo um método, e não o campo cru, por
   * duas razões que valem a indireção: ele é o contrato que `NAMEK.specials`
   * chama de "alvo designado" (o `soTrava` do Kamehameha é escrito contra ELE),
   * e é aqui que se lê, em uma frase, o pedido que o governa: *"os poderes
   * sempre devem ir no player cujo cursor está mais próximo; se o cursor estiver
   * muito longe, aí os poderes saem retos"* — e "saem retos" é exatamente o
   * `null` que sobra quando ninguém está na zona.
   *
   * NÃO use `noPainel` no lugar dele. O painel tem cauda e memória de acerto de
   * propósito (para ser LIDO), e um projétil que herdasse essa cauda sairia
   * atrás de alguém que o cursor já deixou — que é a assistência decidindo pelo
   * jogador, contra o pedido.
   */
  alvoDeAtaque() {
    return this.sob;
  }

  /* ================================================== o painel: as duas razões */

  /**
   * "Eu acertei alguém" — a primeira razão de o painel aparecer.
   *
   * Chamado pelo `NS2C.HURT` cuja autoria é minha, e independe de mira, de
   * distância e de o alvo estar na tela: o pedido é literal em *"independente se
   * tiver lock-in ou não"*. O dano SOMA dentro da janela porque a pergunta que
   * ele responde é *"quanto de vida do outro player eu tirei?"* — uma rajada a
   * 6 Hz que piscasse "−7" seis vezes nunca a responderia. Vítima nova zera a
   * conta, senão o número seria a soma de duas brigas diferentes.
   *
   * @param {number} id vítima
   * @param {number} dano o que a sala cobrou (já descontada a guarda)
   */
  registrarAcerto(id, dano) {
    if (id == null) return;
    /* O chefe não tem placa — ver a nota em `_painel`. Na prática este acerto
       nem chega aqui (o dano nele vem por `NS2C.FREEZA_HURT`, outro canal), mas
       a guarda é barata e é o que impede a placa de tentar mostrar um id que
       `RemoteFighters` nunca vai conhecer. */
    if (id === NAMEK.freeza.id) return;
    const P = NAMEK.lock.painel;
    if (id !== this._acerto) this.dano = 0;
    this._acerto = id;
    this._acertoT = P.acerto;
    const d = Math.round(Number(dano) || 0);
    if (d > 0) {
      this.dano += d;
      this._danoT = P.dano;
    }
  }

  /**
   * Alguém saiu da sala: apaga o rastro dele.
   *
   * Sem isto o painel ficaria dois segundos pedindo a vida de um id que não
   * existe mais — `NamekGame` devolveria `null` e a placa sumiria de qualquer
   * jeito, mas a mira ficaria com uma cauda apontando para um fantasma.
   */
  esquecer(id) {
    if (this._acerto === id) {
      this._acerto = null;
      this._acertoT = 0;
      this.dano = 0;
      this._danoT = 0;
    }
    if (this._mira === id) {
      this._mira = null;
      this._miraT = 0;
    }
    if (this.sob === id) this.sob = null;
  }

  /** O número do dano a escrever, ou 0. Só vale para a vítima que está na placa. */
  danoNaTela() {
    if (this._danoT <= 0) return 0;
    if (this.noPainel === null || this.noPainel !== this._acerto) return 0;
    return this.dano;
  }

  /**
   * Os dois relógios do painel, e a PRECEDÊNCIA entre as duas razões.
   *
   * **O acerto ganha da mira enquanto a janela dele estiver viva.** O argumento
   * inteiro está em `NAMEK.lock.painel`; o resumo é que acertar é um
   * acontecimento com prazo de validade e mirar é um estado que volta sozinho
   * quando o prazo fecha — e que os dois são a MESMA pessoa quase sempre.
   *
   * A cauda da mira (`painel.mira`) existe contra o piscar: a zona da mira
   * assistida é apertada e um adversário a 60 m/s entra e sai dela várias vezes
   * por segundo. Ela vale só para a placa — `sob`, que é quem os projéteis
   * seguem, não tem cauda nenhuma.
   */
  _painel(dt) {
    const passo = dt > 0 ? dt : 0;

    /* O CHEFE NÃO ENTRA NO PAINEL, e é a única exceção da regra acima.
     *
     * Ele já tem a barra grande do topo da tela (`ui/boss.js`), com nome, nível,
     * fantasma e o ki dele — e ela existe justamente porque a vida do boss é a
     * partida inteira. Repeti-la na placa do canto seria a MESMA vida em dois
     * lugares, em duas escalas diferentes (11 000 pontos contra uma barra
     * desenhada para 100), e as duas divergindo por um quadro de interpolação.
     *
     * A mira nele continua valendo para tudo o mais: o anel acende no corpo dele
     * e os poderes o perseguem. O que se cala é só a placa. */
    if (this.sob !== null && this.sob !== NAMEK.freeza.id) {
      this._mira = this.sob;
      this._miraT = NAMEK.lock.painel.mira;
    } else if (this._miraT > 0) {
      this._miraT -= passo;
      if (this._miraT <= 0) {
        this._miraT = 0;
        this._mira = null;
      }
    }

    if (this._acertoT > 0) {
      this._acertoT -= passo;
      if (this._acertoT <= 0) {
        this._acertoT = 0;
        this._acerto = null;
      }
    }

    if (this._danoT > 0) {
      this._danoT -= passo;
      if (this._danoT <= 0) {
        this._danoT = 0;
        this.dano = 0;
      }
    }

    this.noPainel = this._acerto ?? this._mira;
  }

  /* ===================================================== a mira, por quadro == */

  /**
   * QUEM ESTÁ SOB O CURSOR — a mira assistida, resolvida por quadro.
   *
   * Ver `NAMEK.lock.mira` para o pedido e para cada número. O que este método
   * faz, em uma frase: projeta todo mundo, mede a distância de cada um ao CENTRO
   * DA TELA em unidades de meia-altura, e elege o mais perto que esteja dentro
   * da zona.
   *
   * Três coisas que parecem detalhe e não são:
   *
   * • **A distância é medida na TELA, não no mundo.** É o pedido inteiro: o
   *   jogador aponta com o mouse, e quem ele está apontando é quem está debaixo
   *   do cursor — não quem está mais perto dele no espaço. Um adversário colado
   *   nas costas não recebe tiro nenhum, e é assim que tem de ser.
   * • **O `x` é corrigido pela proporção da tela.** NDC é normalizado por eixo,
   *   então um círculo em NDC é uma elipse em pixels: numa tela 16:9, sem a
   *   correção, um alvo à direita entraria na assistência a quase o dobro da
   *   distância aparente de um alvo acima. A zona tem de ser redonda porque o
   *   gesto do jogador é redondo.
   * • **Quem está ATRÁS da lente é descartado, não espelhado.** A projeção
   *   divide por `-z`: atrás dela o sinal vira e o alvo aparece do lado oposto,
   *   perto do centro. Sem o descarte, um adversário nas costas seria eleito
   *   como se estivesse na mira.
   *
   * A lista `naTelaTodos` sai preenchida para o HUD. Ela é reaproveitada entre
   * quadros — os registros são um pool, e só `length` muda.
   *
   * ------------------------------------------------------------- e o CHEFE
   *
   * **O Freeza é varrido aqui como todo mundo**, e não por um caminho próprio.
   *
   * Ele não é um lutador — não está em `RemoteFighters`, não entra no `VITALS` e
   * usa um id negativo (`NAMEK.freeza.id`) —, e por isso nasceu de FORA desta
   * varredura. O preço disso foi medido e era a partida inteira: nenhum poder do
   * jogador curvava na direção dele (a rajada acertava 6,1 % contra 66,4 % depois
   * do conserto), porque `alvoDeAtaque` só podia devolver quem passasse por
   * aqui. Quem consertou foi `BossSystem.candidato()`, que entrega uma FICHA no
   * formato de lutador, e `NamekGame.mirados()`, que a costura na lista.
   *
   * O que este arquivo faz com ela é uma coisa só: reconhecer a marca
   * `boss: true` e medir o corpo dele com os números DELE — 2,24 m de altura
   * contra 1,78 m, e o peito a 1,36 m contra 1,15 m. Sem isso o anel cairia
   * abaixo do peito e teria tamanho de gente, que é exatamente o que o pedido
   * proíbe ("deve ficar claro quem é o Freeza dos outros jogadores à
   * distância"). O resto — projeção, zona de tela, eleição — é o mesmo código,
   * de propósito: dois caminhos seriam dois lugares para discordarem sobre quem
   * está sob o cursor.
   */
  _sobAMira(candidatos, origem, camera, aspecto) {
    const lista = this.naTelaTodos;
    lista.length = 0;
    this.sob = null;
    if (!candidatos || !camera) return;

    const M = NAMEK.lock.mira;
    const cosCone = Math.cos(M.cone * GRAU);
    /* A meia-altura da tela em unidades de mundo por metro de distância. Sai do
       campo de visão VIVO da câmera — que abre com a arrancada —, então o anel
       acompanha o zoom sozinho. Resolvido uma vez para o laço. */
    const tanFov = Math.tan((camera.fov * GRAU) / 2) || 1;
    /** O melhor até agora, e a distância² dele ao centro da tela. Começa na
     *  borda da zona: quem não entrar nela não é eleito. */
    let melhor = null;
    let melhorD2 = M.raioTela * M.raioTela;
    const F = NAMEK.freeza;

    for (const r of candidatos) {
      if (!r || r.down) continue;
      const p = r.pose;
      const chefe = r.boss === true;
      const m = this._marcar(
        r.id,
        p.x,
        p.y + (chefe ? F.peito : NAMEK.fighter.chest),
        p.z,
        chefe ? F.altura : NAMEK.fighter.height,
        r.color ?? (chefe ? F.cor : null),
        chefe,
        chefe ? (r.name ?? F.nome) : "",
        origem, camera, aspecto, tanFov, cosCone,
      );
      if (m && m.d2 < melhorD2) {
        melhorD2 = m.d2;
        melhor = m;
      }
    }

    if (melhor) {
      melhor.sob = true;
      this.sob = melhor.id;
    }
  }

  /**
   * Um corpo projetado na tela — o registro do HUD e a nota da eleição.
   *
   * Extraído do laço quando o boss passou a ser candidato: a alternativa era o
   * mesmo bloco de vinte linhas escrito duas vezes, e a segunda cópia é sempre a
   * que esquece a correção de proporção ou a guarda do cone.
   *
   * @returns {object|null} o registro (já dentro de `naTelaTodos`), com `d2` =
   *   distância² ao centro da tela em unidades de meia-altura, ou `Infinity`
   *   quando o corpo não pode ser eleito (atrás da lente, fora do cone).
   */
  _marcar(id, x, y, z, alturaCorpo, cor, ehBoss, nome, origem, camera, aspecto, tanFov, cosCone) {
    const dx = x - origem.x;
    const dy = y - origem.y;
    const dz = z - origem.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.001) return null;

    this._projetar(x, y, z, camera);
    const n = this.naTelaTodos.length;
    let m = this._bancoTela[n];
    if (!m) {
      m = this._bancoTela[n] = {
        id: 0, x: 0, y: 0, dist: 0, raio: 0, visivel: false, sob: false,
        cor: null, boss: false, nome: "", d2: Infinity,
      };
    }
    m.id = id;
    m.x = this._ndc.x;
    m.y = this._ndc.y;
    m.dist = d;
    m.cor = cor;
    m.sob = false;
    m.boss = ehBoss === true;
    m.nome = nome || "";
    m.d2 = Infinity;
    /* O RAIO APARENTE, em frações da meia-altura da tela — e ele sai da ÓTICA,
     * não de uma constante ajustada a olho.
     *
     * Um corpo de altura `H` a `d` metros ocupa, na tela, a fração
     * `H / (2·d·tan(fov/2))` da altura toda; em unidades de MEIA-altura (que é
     * o que o NDC usa, e o que o HUD vai multiplicar) isso é `H / (d·tanFov)`.
     * Metade disso é o raio.
     *
     * A altura vem de QUEM É O CORPO — 1,78 m de um lutador, 2,24 m do chefe —,
     * e é por isso que ela é parâmetro: um anel de tamanho de gente em volta do
     * Freeza o faria parecer mais um adversário, e o ponto do marcador dele é
     * exatamente o contrário. O fator 1,9 é comum aos dois porque um círculo
     * colado no corpo desaparece atrás dele quando o corpo está de frente: o que
     * se quer é um círculo EM VOLTA. */
    m.raio = (alturaCorpo * 1.9 * 0.5) / (d * tanFov);
    /* VISÍVEL é o que o HUD usa para decidir se desenha o círculo. Um pouco
       além da borda (1,05) de propósito: um anel cortado pela metade na beira
       da tela é informação, e some-lo ali faria o marcador piscar toda vez que
       o adversário raspasse o canto. */
    m.visivel =
      !this._ndc.atras && Math.abs(this._ndc.x) <= 1.05 && Math.abs(this._ndc.y) <= 1.05;
    this.naTelaTodos.push(m);

    /* Sem teste de distância nesta guarda, e é o ponto todo: a zona é medida
       na TELA, e zona de tela já é critério angular — vale igual a 20 m e a
       800 m. O teto em metros que existia aqui apagava a assistência inteira
       de quem subisse ao teto de voo com os adversários no chão. */
    if (this._ndc.atras) return m;
    /* O cone é a guarda contra o caso degenerado (alvo quase no plano da
       lente, em que a projeção explode). A zona de tela faz o resto. */
    if ((dx * this._eixoDaLente(camera, 0) +
         dy * this._eixoDaLente(camera, 1) +
         dz * this._eixoDaLente(camera, 2)) / d < cosCone) return m;

    const ex = this._ndc.x * aspecto;
    m.d2 = ex * ex + this._ndc.y * this._ndc.y;
    return m;
  }

  /**
   * Uma componente do eixo óptico da câmera, tirada da matriz dela.
   *
   * A terceira coluna de `matrixWorld` é o eixo `+z` LOCAL da lente, e uma
   * câmera olha para o `−z` dela — daí o sinal. Ler da matriz em vez de receber
   * a direção é o que mantém este arquivo sem depender de quem calculou a mira:
   * a câmera já se posicionou neste quadro, e a matriz dela é a verdade.
   */
  _eixoDaLente(camera, i) {
    return -camera.matrixWorld.elements[8 + i];
  }

  /** Onde o alvo cai na tela, em NDC, e se ele está atrás da lente. */
  _projetar(x, y, z, camera) {
    const o = this._ndc;
    if (!camera) {
      o.x = 0;
      o.y = 0;
      o.atras = false;
      return o;
    }
    const m = camera.matrixWorldInverse.elements;
    /* Espaço de câmera à mão, sem `THREE.Vector3`: são doze multiplicações
       contra uma alocação por quadro, e o `-z` daqui é o que diz se o alvo
       está à frente. */
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cz = m[2] * x + m[6] * y + m[10] * z + m[14];

    if (cz > -0.001) {
      /* Atrás da lente (ou no plano dela). A projeção aqui divide por um número
         que tende a zero e depois troca de sinal: `atras` é a única resposta
         honesta, e quem chama trata isso como "fora do quadro". */
      o.atras = true;
      o.x = 0;
      o.y = 0;
      return o;
    }
    o.atras = false;
    const p = camera.projectionMatrix.elements;
    const w = -cz;
    o.x = (p[0] * cx) / w;
    o.y = (p[5] * cy) / w;
    return o;
  }
}
