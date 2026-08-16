/* ---------------------------------------------------------------------------
   A TRAVA DE ALVO — o sistema, e não um campo `lockId` espalhado pelo laço.

   A regra que manda neste arquivo inteiro é uma frase, e ela é o pedido:

       **LOCK-ON ≠ CÂMERA FIXA NO INIMIGO.**

   A trava é ASSISTÊNCIA DE COMBATE. Ela responde três perguntas e mais nenhuma:

       quem é o alvo?          → `id`, `alvo`, `ponto()`
       ele ainda vale?         → `update`, que é quem o solta
       quanto ajudar a mirar?  → `assistencia`

   O que ela NÃO faz, e é o que separa este desenho do que existia antes:

   • não move o lutador. Nem um metro, nem uma vez. `movement.js` não importa
     este arquivo e nunca vai importar — quem voa é o jogador, e travar em
     alguém não pode custar um grau de liberdade;
   • não mexe na câmera. A câmera LÊ isto (`NamekCamera.update` recebe o ponto
     e a separação) e decide o enquadramento dela sozinha;
   • não decide dano. Quem cobra é a sala, como sempre.

   ------------------------------------------------------- por que um arquivo

   Antes isto era `this.lockId` em `game.js` mais um `alternarTrava()` de vinte
   linhas, e funcionava — enquanto a trava fosse um interruptor. Ela deixou de
   ser: agora tem alcance, tolerância a perda, troca de alvo, uma escada de
   assistência que depende do que o jogador está fazendo, e um estado de "alvo
   distante" que o HUD desenha. Isso é uma máquina de estados com relógio
   próprio, e máquina de estados com relógio próprio dentro de um laço de 1 500
   linhas é onde bug de multiplayer vai morar.

   Separado, ele também é a peça que o §15 do pedido pede sem dizer: **cada
   cliente tem a SUA**. Uma instância por jogador local, nada disto viaja na
   rede a não ser o alvo escolhido no instante do disparo (que já viajava, em
   `NC2S.BLAST.target`), e a trava de um jogador não toca na câmera nem no alvo
   de ninguém.

   ------------------------------------------------------------------ a perda

   *"Não quero que o lock seja perdido simplesmente porque o inimigo saiu por
   alguns frames da tela."* Por isso a perda é um RELÓGIO: `foraDe` acumula
   enquanto o alvo estiver fora do quadro, e zera assim que ele volta. Só quando
   ele passa de `perda.tempo` a trava cai.

   E DISTÂNCIA NÃO É PERDA, nem impedimento de travar. Era: um teto de 420 m
   valia tanto para adquirir quanto para segurar, e ele ficava abaixo do teto de
   voo (520 m) — subir ao céu para achar quem estava no chão desligava o sistema
   feito para achar quem está longe. Hoje o único critério é angular, em todas as
   distâncias, e é ele quem sustenta a promessa que o jogador ouve: o retículo em
   cima de alguém marca esse alguém, esteja ele colado ou do outro lado da ilha.

   As perdas INSTANTÂNEAS são outra coisa, e são só as que não têm volta: o alvo
   morreu, o alvo saiu da sala, o jogador soltou. Essas não esperam relógio
   nenhum, porque não há o que esperar.

   ------------------------------------------------------------ zero alocação

   Mesma disciplina do resto do modo (§3 do plano): o ponto do alvo é um
   rascunho reescrito, a varredura de candidatos não cria lista intermediária, e
   `update` não aloca nada em regime.
   --------------------------------------------------------------------------- */

import { NAMEK } from "../shared/namek/config.js";
import { clamp } from "../utils/math.js";

const GRAU = Math.PI / 180;

export class LockOn {
  constructor() {
    /** Id do alvo travado, ou null. É a única coisa que outros sistemas leem. */
    this.id = null;
    /** O registro do alvo (o `RemoteFighter`), ou null. Revalidado por quadro. */
    this.alvo = null;

    /** m — separação atual. A câmera a usa para o enquadramento dinâmico. */
    this.separacao = 0;
    /** s acumulados com o alvo fora do quadro. Ver a seção "a perda" no
     *  cabeçalho. */
    this.foraDe = 0;
    /** O alvo está longe o bastante para o HUD avisar? */
    this.distante = false;
    /** O alvo está fora do quadro NESTE quadro? O HUD usa para desenhar a seta
     *  em vez do anel. */
    this.foraDoQuadro = false;

    /** rad/s de correção de rumo que o combate pode aplicar NESTE quadro.
     *  Zero sem trava. Ver `assistencia` e o bloco `lock.assist` do config. */
    this.assistencia = 0;
    /** s restantes da janela de assistência forte, armada por `atacou()`. */
    this._ataque = 0;

    /**
     * Quem já foi visitado na volta corrente da troca de alvo.
     *
     * É o que faz o gesto do `R` FECHAR: sem ele, dois adversários em campo
     * trocam para sempre e não existe toque que solte a trava. Ver `alternar`.
     * Zerado ao travar do zero e ao soltar; nunca cresce além do elenco, porque
     * só recebe ids que `_melhor` aprovou.
     * @type {Set<number>}
     */
    this._ciclo = new Set();

    /** O peito do alvo, reaproveitado — lido pela câmera e pela mira por quadro. */
    this._ponto = { x: 0, y: 0, z: 0 };
    /** Rascunho da projeção. */
    this._ndc = { x: 0, y: 0, atras: false };

    /* ============================================== a MIRA ASSISTIDA (soft)
     *
     * Ver `NAMEK.lock.mira`: um alvo SEM trava, escolhido a cada quadro por quem
     * está mais perto do cursor. Ele mora nesta classe e não numa sua porque as
     * duas coisas compartilham tudo — a projeção, a varredura de candidatos, a
     * regra de quem é atingível — e porque uma governa a outra: a trava ganha
     * quando existe (`alvoDeAtaque`). Duas classes seriam duas varreduras por
     * quadro e um lugar a mais para elas discordarem sobre quem é o alvo. */

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
  }

  /* ====================================================== seleção de alvo == */

  /**
   * Trava, solta, ou TROCA — as três num gesto só, e é de propósito.
   *
   * O mapa de teclas deste modo é fechado a pedido ("só o menu geral"), então
   * não há uma segunda tecla para a troca de alvo. A regra que resolve isso sem
   * inventar tecla nenhuma é a de qualquer jogo com trava: **o botão troca
   * enquanto houver para quem trocar, e solta quando acaba a fila.**
   *
   * Na prática, com dois em campo ele é um interruptor (trava → solta), que é o
   * comportamento antigo; com três ou mais ele passa a girar entre eles e a
   * soltar no fim da volta. Ninguém precisa aprender nada novo para o caso de
   * dois, e o caso de quinze ganha a troca que o §12 pede.
   *
   * @param {Iterable} candidatos os remotos vivos
   * @param {{x,y,z}} origem o peito de quem está travando
   * @param {{x,y,z}} mira o eixo óptico — a direção para onde ele olha
   * @returns {"travou"|"trocou"|"soltou"|"nada"}
   */
  alternar(candidatos, origem, mira) {
    if (this.id === null) {
      const alvo = this._melhor(candidatos, origem, mira);
      if (!alvo) return "nada";
      this._ciclo.clear();
      this._prender(alvo);
      return "travou";
    }

    /* JÁ HÁ TRAVA: procura o PRÓXIMO ainda não visitado NESTA volta.
     *
     * O conjunto `_ciclo` é a peça que faz a volta TERMINAR, e sem ele o gesto
     * não fecha: excluindo só o alvo atual, dois adversários em campo trocam
     * para sempre — A, B, A, B — e não existe mais toque nenhum que solte a
     * trava. Medido exatamente assim antes de o conjunto existir. E soltar
     * manualmente é uma das condições de perda que o §14 lista por nome.
     *
     * Com ele, a volta é: trava em A (limpa o conjunto), troca para B, e o
     * terceiro toque não acha ninguém fora do conjunto e SOLTA. Com um
     * adversário só o segundo toque já solta, que é o interruptor de sempre;
     * com quinze, ele gira entre os quinze e solta no fim.
     *
     * O desempate dentro da volta é o mesmo de sempre (§12): mais alinhado com
     * a tela primeiro, mais próximo no desempate — ver `_melhor`. */
    const proximo = this._melhor(candidatos, origem, mira);
    if (!proximo) {
      this.soltar();
      return "soltou";
    }
    this._prender(proximo);
    return "trocou";
  }

  /** Solta a trava. Idempotente. */
  soltar() {
    this.id = null;
    this.alvo = null;
    this.separacao = 0;
    this.foraDe = 0;
    this.distante = false;
    this.foraDoQuadro = false;
    this.assistencia = 0;
    this._ciclo.clear();
  }

  _prender(r) {
    this.id = r.id;
    this.alvo = r;
    this.foraDe = 0;
    this.distante = false;
    this.foraDoQuadro = false;
    /* Visitado NESTA volta. Ver `alternar`: é este conjunto que faz o ciclo
       terminar em vez de trocar entre dois adversários para sempre. */
    this._ciclo.add(r.id);
  }

  /**
   * O melhor candidato, ou null.
   *
   * A pontuação mistura duas coisas que o §12 lista em ordem e que na prática
   * competem: **estar mirado** e **estar perto**. Só a primeira faz um
   * adversário a 300 m no eixo ganhar de um a 20 m três graus fora, o que é
   * sempre errado numa briga colada; só a segunda trava em quem está às costas.
   * `viesDaMira` é o peso entre elas — ver o comentário dele no config.
   *
   * O cone é uma ELIMINATÓRIA e não parte da nota: fora dele o candidato não
   * existe, porque travar em quem está atrás de você nunca é o que se quis.
   */
  _melhor(candidatos, origem, mira) {
    const L = NAMEK.lock;
    const cosCone = Math.cos(L.cone * GRAU);
    let melhor = null;
    let melhorNota = -Infinity;

    for (const r of candidatos) {
      if (!r || r.down) continue;
      /* Já visitado nesta volta da troca. Ver `alternar` e `_ciclo`. */
      if (this._ciclo.has(r.id)) continue;
      const p = r.pose;
      const dx = p.x - origem.x;
      const dy = p.y + NAMEK.fighter.chest - origem.y;
      const dz = p.z - origem.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      /* Nenhuma eliminatória por DISTÂNCIA: quem elimina é o cone, e cone é
         ângulo. Havia um teto de 420 m aqui, mais baixo que o teto de voo — do
         alto do céu não se travava em ninguém que estivesse no chão, que é
         justamente a situação em que se sobe ao céu. Ver `NAMEK.lock.alcance`. */
      if (d < 0.001) continue;

      const cos = (dx * mira.x + dy * mira.y + dz * mira.z) / d;
      if (cos < cosCone) continue;

      /* Duas notas em [0, 1]. `alinhamento` cresce do limite do cone (0) ao
         eixo exato (1) — normalizado pelo cone, e não pelo cosseno cru, senão
         um cone largo espremeria todos os candidatos na mesma nota alta.
         `proximidade` cresce da RÉGUA (0) para o colo (1) — e o piso em zero é o
         que a mantém dentro de [0, 1] agora que existe candidato ALÉM da régua:
         passado o limite todos empatam no pior caso e quem decide é a mira, que
         é a ordem certa quando a briga inteira está longe. */
      const alinhamento = (cos - cosCone) / (1 - cosCone);
      const proximidade = Math.max(0, 1 - d / L.alcance);
      const nota = L.viesDaMira * alinhamento + (1 - L.viesDaMira) * proximidade;
      if (nota > melhorNota) {
        melhorNota = nota;
        melhor = r;
      }
    }
    return melhor;
  }

  /* ============================================================== o quadro == */

  /**
   * Revalida a trava e recalcula a assistência. Uma vez por quadro.
   *
   * @param {number} dt
   * @param {object} ctx
   *   `origem`   {x,y,z} peito de quem travou
   *   `buscar`   (id) => registro do remoto, ou null
   *   `camera`   a `THREE.PerspectiveCamera`, já com a matriz deste quadro
   *   `manobra`  true quando o jogador está com entrada lateral/vertical
   * @returns {boolean} a trava continua de pé
   */
  update(dt, { origem, buscar, candidatos, camera, aspecto = 1, manobra = false }) {
    if (this._ataque > 0) this._ataque = Math.max(0, this._ataque - dt);

    /* A MIRA ASSISTIDA roda SEMPRE, com trava ou sem — ela é a leitura do quadro
       atual, e é dela que sai tanto o alvo dos projéteis quanto o anel aceso no
       HUD. Rodá-la só quando não há trava faria os círculos dos outros
       lutadores congelarem no instante em que alguém travasse. */
    this._sobAMira(candidatos, origem, camera, aspecto);

    if (this.id === null) {
      this.assistencia = 0;
      return false;
    }

    /* AS PERDAS SEM VOLTA, primeiro. Alvo que morreu, saiu da sala ou caiu não
       ganha relógio nenhum: não há o que esperar. */
    const r = buscar(this.id);
    if (!r || r.down) {
      this.soltar();
      return false;
    }
    this.alvo = r;

    const p = r.pose;
    const alvoY = p.y + NAMEK.fighter.chest;
    const dx = p.x - origem.x;
    const dy = alvoY - origem.y;
    const dz = p.z - origem.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this.separacao = d;

    const L = NAMEK.lock;
    this.distante = d > L.alcance * L.perda.avisoEm;

    /* O RELÓGIO DA PERDA. Ele corre por dois motivos — longe demais, ou fora do
       quadro — e zera com qualquer um dos dois resolvido. É essa tolerância que
       o §7 e o §14 do pedido descrevem: manobrar até o inimigo sair da tela não
       pode custar a trava, e passar por trás de uma montanha muito menos. */
    this._projetar(p.x, alvoY, p.z, camera);
    const margem = L.perda.margem;
    this.foraDoQuadro =
      this._ndc.atras || Math.abs(this._ndc.x) > margem || Math.abs(this._ndc.y) > margem;

    /* SÓ O QUADRO derruba a trava. A distância saiu desta conta pelo mesmo
       motivo que saiu da aquisição: perseguir quem fugiu é exatamente para o que
       a trava serve, e ela morria em pleno serviço assim que a fuga passava dos
       420 m. O que sobra é uma perda que o jogador causa e enxerga — deixar o
       adversário sair do quadro e não trazê-lo de volta a tempo. */
    if (this.foraDoQuadro) {
      this.foraDe += dt;
      if (this.foraDe >= L.perda.tempo) {
        this.soltar();
        return false;
      }
    } else {
      this.foraDe = 0;
    }

    this._calcularAssistencia(d, manobra);
    return true;
  }

  /**
   * A ESCADA DE ASSISTÊNCIA — §8 do pedido, em três degraus e um freio.
   *
   * *"A assistência deve ficar mais forte quando o jogador inicia um ataque…
   * mais fraca quando está simplesmente voando, está realizando uma manobra,
   * está tentando escapar."*
   *
   * O degrau é escolhido pelo que o jogador está FAZENDO, e não por um estado
   * do alvo:
   *
   * • `perto` — dentro do alcance de corpo a corpo E atacando. É o degrau mais
   *   forte, e é o único que chega perto de virar o corpo sozinho; o §11 pede
   *   exatamente isso ("ataques podem orientar o personagem em direção ao
   *   alvo") e pede na mesma frase o que impede o abuso ("evite teleportes ou
   *   movimentações artificiais") — daí ser velocidade angular e não posição.
   * • `ataque` — atacando, a qualquer distância. Vale pela janela inteira
   *   (`assist.janela`), senão a correção duraria um quadro.
   * • `passiva` — só voando. 40°/s, que é abaixo do que qualquer movimento de
   *   mouse produz: ela endireita quem está à deriva e não desvia quem decidiu.
   *
   * E o freio: quem está MANOBRANDO (entrada lateral ou vertical) recebe um
   * quinto disso. É a regra que garante que dar a volta no inimigo continue
   * sendo dar a volta, e não uma briga contra a assistência.
   */
  _calcularAssistencia(d, manobra) {
    const A = NAMEK.lock.assist;
    let taxa;
    if (this._ataque > 0) taxa = d <= A.alcancePerto ? A.perto : A.ataque;
    else taxa = A.passiva;
    if (manobra) taxa *= A.manobra;
    this.assistencia = taxa;
  }

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
   */
  _sobAMira(candidatos, origem, camera, aspecto) {
    const lista = this.naTelaTodos;
    lista.length = 0;
    this.sob = null;
    if (!candidatos || !camera) return;

    const M = NAMEK.lock.mira;
    const cosCone = Math.cos(M.cone * GRAU);
    const zona2 = M.raioTela * M.raioTela;
    /* A meia-altura da tela em unidades de mundo por metro de distância. Sai do
       campo de visão VIVO da câmera — que abre com a arrancada e com a trava —,
       então o anel acompanha o zoom sozinho. Resolvido uma vez para o laço. */
    const tanFov = Math.tan((camera.fov * GRAU) / 2) || 1;
    let melhor = null;
    let melhorD2 = zona2;

    for (const r of candidatos) {
      if (!r || r.down) continue;
      const p = r.pose;
      const alvoY = p.y + NAMEK.fighter.chest;
      const dx = p.x - origem.x;
      const dy = alvoY - origem.y;
      const dz = p.z - origem.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 0.001) continue;

      this._projetar(p.x, alvoY, p.z, camera);
      const n = lista.length;
      let m = this._bancoTela[n];
      if (!m) {
        m = this._bancoTela[n] = {
          id: 0, x: 0, y: 0, dist: 0, raio: 0, visivel: false, sob: false, cor: null,
        };
      }
      m.id = r.id;
      m.x = this._ndc.x;
      m.y = this._ndc.y;
      m.dist = d;
      m.cor = r.color;
      m.sob = false;
      /* O RAIO APARENTE, em frações da meia-altura da tela — e ele sai da ÓTICA,
       * não de uma constante ajustada a olho.
       *
       * Um corpo de altura `H` a `d` metros ocupa, na tela, a fração
       * `H / (2·d·tan(fov/2))` da altura toda; em unidades de MEIA-altura (que é
       * o que o NDC usa, e o que o HUD vai multiplicar) isso é `H / (d·tanFov)`.
       * Metade disso é o raio.
       *
       * A altura usada é 1,9 vez a do lutador, como no anel da trava e pelo
       * mesmo motivo: um círculo colado no corpo desaparece atrás do próprio
       * adversário quando ele está de frente. O que se quer é um círculo EM
       * VOLTA dele. */
      m.raio = (NAMEK.fighter.height * 1.9 * 0.5) / (d * tanFov);
      /* VISÍVEL é o que o HUD usa para decidir se desenha o círculo. Um pouco
         além da borda (1,05) de propósito: um anel cortado pela metade na beira
         da tela é informação, e some-lo ali faria o marcador piscar toda vez que
         o adversário raspasse o canto. */
      m.visivel =
        !this._ndc.atras && Math.abs(this._ndc.x) <= 1.05 && Math.abs(this._ndc.y) <= 1.05;
      lista.push(m);

      /* Sem teste de distância nesta guarda, e é o ponto todo: a zona é medida
         na TELA, e zona de tela já é critério angular — vale igual a 20 m e a
         800 m. O teto em metros que existia aqui apagava a assistência inteira
         de quem subisse ao teto de voo com os adversários no chão. */
      if (this._ndc.atras) continue;
      /* O cone é a guarda contra o caso degenerado (alvo quase no plano da
         lente, em que a projeção explode). A zona de tela faz o resto. */
      if ((dx * this._eixoDaLente(camera, 0) +
           dy * this._eixoDaLente(camera, 1) +
           dz * this._eixoDaLente(camera, 2)) / d < cosCone) continue;

      const ex = this._ndc.x * aspecto;
      const d2 = ex * ex + this._ndc.y * this._ndc.y;
      if (d2 < melhorD2) {
        melhorD2 = d2;
        melhor = m;
      }
    }

    if (melhor) {
      melhor.sob = true;
      this.sob = melhor.id;
    }
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

  /**
   * "Acabei de atacar" — arma a janela de assistência forte.
   *
   * Chamado por quem atira (rajada, especial, onda). Não é o mesmo que "estou
   * com o botão apertado": a janela é o que faz a correção sobreviver ao
   * intervalo entre dois tiros de uma rajada a 6 Hz.
   */
  atacou() {
    this._ataque = NAMEK.lock.assist.janela;
  }

  /* =============================================================== consultas */

  /** O peito do alvo, em espaço de mundo. `null` sem trava. Rascunho: não guarde. */
  ponto() {
    if (!this.alvo || this.alvo.down) return null;
    const p = this.alvo.pose;
    const o = this._ponto;
    o.x = p.x;
    o.y = p.y + NAMEK.fighter.chest;
    o.z = p.z;
    return o;
  }

  /**
   * O id que um ATAQUE deve perseguir, ou null.
   *
   * Separado de `id` de propósito, e a diferença é o §9 do pedido: *"não quero
   * que todos os ataques sejam mísseis teleguiados perfeitos."* Um alvo fora do
   * quadro há um segundo e meio ainda está TRAVADO (o relógio da perda não
   * venceu, e a câmera ainda o procura), e mesmo assim um Kienzan não deveria
   * sair contornando a montanha atrás dele. Quem está fora de vista deixa de ser
   * alvo de mira antes de deixar de ser alvo de trava.
   */
  alvoDeAtaque() {
    /* A TRAVA GANHA quando existe e está à vista: ela é a intenção declarada do
       jogador, e uma mira automática que a contradissesse seria o software
       desfazendo uma decisão explícita. */
    if (this.id !== null && !this.foraDoQuadro) return this.id;
    /* Sem trava (ou com o alvo travado fora de vista), vale quem está sob o
       CURSOR. É o pedido: *"os poderes sempre devem ir no player cujo cursor
       está mais próximo; se o cursor estiver muito longe, aí os poderes saem
       retos"* — e "saem retos" é exatamente o `null` que sobra aqui quando
       ninguém está na zona. */
    return this.sob;
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

  /** A posição do alvo na tela, em NDC. `null` quando não há trava. */
  naTela() {
    if (this.id === null) return null;
    return this._ndc;
  }

  /**
   * Uma direção corrigida pela assistência — o que o COMBATE usa.
   *
   * Gira `dir` em direção ao alvo, no máximo `assistencia · dt` radianos. É a
   * mesma matemática de `perseguirPonto` (em `powers/blast.js`) e pelo mesmo
   * motivo: um teto de giro é uma correção que o jogador sempre pode vencer,
   * enquanto uma atribuição de ângulo é o software jogando por ele.
   *
   * @param {{x,y,z}} dir o versor a corrigir — MUTADO no lugar
   * @param {{x,y,z}} origem de onde o ataque sai
   * @param {number} dt
   */
  corrigir(dir, origem, dt) {
    const alvo = this.ponto();
    if (!alvo || this.assistencia <= 0) return dir;

    let tx = alvo.x - origem.x;
    let ty = alvo.y - origem.y;
    let tz = alvo.z - origem.z;
    const d = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (d < 0.001) return dir;
    tx /= d;
    ty /= d;
    tz /= d;

    const cos = clamp(dir.x * tx + dir.y * ty + dir.z * tz, -1, 1);
    const ang = Math.acos(cos);
    if (ang < 1e-4) return dir;

    const passo = Math.min(ang, this.assistencia * dt);
    /* Interpolação linear entre os dois versores, renormalizada — e não um
       `slerp`: para o passo pequeno deste caso os dois coincidem dentro do erro
       de um float, e este é caminho de quadro. */
    const t = passo / ang;
    dir.x += (tx - dir.x) * t;
    dir.y += (ty - dir.y) * t;
    dir.z += (tz - dir.z) * t;
    const inv = 1 / (Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1);
    dir.x *= inv;
    dir.y *= inv;
    dir.z *= inv;
    return dir;
  }
}
