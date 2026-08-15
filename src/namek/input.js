/* ---------------------------------------------------------------------------
   A entrada de Namekusei — teclado e mouse, e SÓ o que este modo usa.

   IRMÃO de `systems/input.js`, nunca filho. Aquele arquivo é o teclado do
   arqueiro: trinta atalhos, modos de 1 a 8, fase no 9, placar no 0, faca no E,
   javali no P, alce no L. Nada disso existe aqui, e o pedido do usuário é
   explícito — *"nesse modo todos os outros atalhos que o jogo já tem devem ser
   ignorados; deixe somente o atalho que aparece o menu geral"*. Herdar aquela
   classe seria herdar as trinta teclas para desligá-las uma a uma, e a primeira
   tecla nova que o arqueiro ganhasse voltaria a valer aqui sem ninguém pedir.

   Então este arquivo conhece DEZESSETE entradas e é surdo para o resto do
   teclado. Um `KeyT` aqui não é "a tecla de traçado desligada": é uma tecla que
   este modo nunca ouviu falar.

   ------------------------------------------------------ o TAB, que saiu do mapa

   A trava de alvo era o `Tab`, e ela não sobreviveu ao navegador. O Tab é a
   tecla de NAVEGAÇÃO da página: solto, ele leva o foco para o próximo elemento
   — e, no fim da lista, para os controles do próprio navegador. A partir daí o
   jogo não recebe mais tecla nenhuma, porque o teclado passou a ser de outro.
   `preventDefault` segura isso ENQUANTO o evento chega até nós, e o problema é
   exatamente que existem estados em que ele não chega: sem Pointer Lock — que
   aqui não é exceção, é o modo livre inteiro (iframe, painel de preview, a
   janela que ainda não recebeu um clique no canvas) — o foco já pode estar do
   lado de fora do documento quando o jogador aperta. O arqueiro tropeçou nisto
   antes e desistiu do Tab pelo mesmo motivo (`Input.scoreboard`, em
   `systems/input.js`), e o pedido do usuário aqui foi literal: *"a tecla TAB
   não é uma boa tecla para ser utilizada, pois, como está no navegador, tende a
   trocar de foco"*.

   A trava de alvo é o `R`, então, e o Tab não é tecla de nada — mas ele
   CONTINUA sendo engolido durante o jogo (`preventDefault` e mais nada), pelo
   mesmo motivo pelo qual saiu: um Tab distraído no meio de uma perseguição não
   pode levar o teclado embora só porque deixou de ter função. E é engolido
   apenas durante o JOGO: com a porta de entrada ou o menu na frente, o teclado
   é deles e o Tab volta a navegar entre botões, que é o único lugar onde
   navegar entre botões faz sentido.

   ------------------------------------------------------------ a defesa, no `E`

   A guarda (`NAMEK.guard`) é uma tecla SEGURADA — o lutador cruza os braços
   enquanto ela estiver embaixo do dedo, e a barra de ki escoa nesse tempo. Isso
   sozinho elimina metade do teclado: ela tem de ser confortável de segurar por
   segundos com a mão esquerda parada no WASD e a direita no mouse.

   O que sobrava perto do WASD já tinha dono: `Shift` corre, `Ctrl` desce, `C`
   carrega ki, `Q` é a onda de choque, `Espaço` decola, e o botão direito é a
   arrancada. O `E` é o vizinho de cima do `D`, cai debaixo do dedo indicador
   sem tirar nenhum outro do lugar, e é a mesma posição que os jogos de tiro
   usam para a ação segurada de apoio. O `R`, que ficou com a trava, é uma BORDA
   (um toque), e por isso pode morar um pouco mais longe.

   E não, o `E` da faca do arqueiro não é um conflito: é o primeiro parágrafo
   deste cabeçalho. Aquele mapa não vale aqui, e nenhuma tecla dele foi herdada
   para poder ser disputada.

   ------------------------------------------------------- o Pointer Lock, de novo

   A lição do arqueiro vale inteira e está copiada aqui de propósito (§0 do
   plano: copiar em vez de importar). O Pointer Lock é uma PERMISSÃO, e ela
   falha em iframe sem `allow="pointer-lock"`, em painel de preview e em
   política de navegador. Se a mira dependesse dele, o modo travaria numa tela
   de "clique para mirar" que nunca sai.

   Por isso a mira funciona nos dois estados, exatamente como lá:
     • travado — cursor capturado e escondido, `movementX/Y` do lock;
     • livre   — cursor visível, e AINDA `movementX/Y`, que o navegador preenche
       em qualquer `mousemove`. Só a captura depende da permissão; o delta não.

   ------------------------------------------------------------------ o menu (Esc)

   O `Escape` tem um detalhe que só aparece com o ponteiro travado: o navegador
   o INTERCEPTA para devolver o cursor, e o `keydown` não chega à página. Quem
   avisa que o jogador pediu o menu, nesse caso, é o `pointerlockchange` — é por
   isso que o pulso `menu` nasce em dois lugares. Sem o segundo, apertar Esc
   durante o jogo devolveria o cursor e mais nada, e o menu geral seria
   inalcançável justamente para quem está jogando direito.

   ------------------------------------------------ e o menu de novo: o EMPATE

   `_menuAberto` é o interruptor mais perigoso deste arquivo: ligado, ele cala o
   teclado (`_segura`), a mira (`_mouse`), os botões (`_botaoDesce`) e o próprio
   pedido de ponteiro (`engage`). Um jogo inteiro depende de alguém lembrar de
   desligá-lo — e "alguém lembrar" é a definição de bug intermitente.

   Ele JÁ ficou ligado sozinho: o menu tinha dois jeitos de fechar (o Esc, que
   passa pelo laço e avisa, e o clique no fundo, que fechava por dentro e não
   avisava ninguém). Pelo segundo caminho a tela sumia e o modo ficava mudo para
   sempre — sem teclas, sem mira, sem clique, sem jeito de recapturar o cursor.
   Hoje o menu ANUNCIA cada mudança (`EVENTO_MENU` em `ui/menu.js`) e este
   arquivo escuta: o interruptor não depende mais de quem chamou o quê.

   O segundo empate é de TEMPO, e mora no Pointer Lock: `requestPointerLock` é
   assíncrono e o navegador o RECUSA quando ele vem cedo demais depois de uma
   saída pelo Esc ("The user has exited the lock before this request was
   completed") ou fora de um gesto. Duas consequências, as duas tratadas abaixo:
   a recusa não pode virar espera eterna (`engage`), e a trava que chega ATRASADA
   não pode chegar com o menu já aberto (`_lockMudou`) — seria um menu de botões
   com o cursor preso e escondido, sem Esc que salvasse.

   ------------------------------------------------------- A PORTA DE ENTRADA

   Tudo acima é sobre o ponteiro ser uma permissão. Falta a outra metade: ela só
   é concedida a partir de um GESTO, e até este arquivo ganhar uma porta não
   havia nada na tela pedindo esse gesto. Entrar no modo era cair no meio da luta
   com o cursor do sistema pairando sobre o céu e a mira parada, esperando que
   alguém adivinhasse que precisava clicar. O pedido do usuário foi consertar
   exatamente isso: *"aparece uma mensagem pedindo pra clicar na tela. Aí, uma
   vez que a tela é clicada, a mira já começa a ficar ativa"*.

   A porta (`ui/porta.js`) é dessa classe, e não do jogo, porque a REGRA de
   quando ela aparece é uma frase só e é toda sobre estado que só existe aqui:

       a porta está na tela ⟺ o ponteiro não está travado
                            ∧ o menu não está aberto
                            ∧ este navegador ainda pode travar.

   As três pontas importam. A primeira é o pedido inteiro — "se o pointer lock
   cair depois, o overlay volta; é a mesma porta, sempre". A segunda evita duas
   telas cheias disputando o mesmo clique. A TERCEIRA é o que impede a porta de
   virar justamente a tela de "clique para mirar" que nunca sai, contra a qual o
   topo deste arquivo avisa: onde a permissão é negada de vez (iframe, painel de
   preview), a porta sai da frente e o modo livre continua jogável.

   E a regra é aplicada por um método só (`_repensarPorta`), chamado de todo
   lugar que possa mexer numa das três pontas. Espalhar `porta.abrir()` pelos
   ouvintes seria voltar ao empate que o `EVENTO_MENU` acabou de desfazer.
   --------------------------------------------------------------------------- */

import { clamp } from "../utils/math.js";
import { EVENTO_MENU } from "./ui/menu.js";
import { NamekPorta } from "./ui/porta.js";

/* Sensibilidade e limite de pitch moram AQUI e não em `shared/namek/config.js`
   por duas razões, e as duas contam: aquele arquivo é PURO (a sala o importa em
   Node, e sensibilidade de mouse não é assunto de servidor), e ele é um arquivo
   existente — o §0 do plano proíbe encostar nele. Números de tato do cliente
   ficam do lado do cliente. */

/** rad por pixel. Um tico acima do arqueiro (0,0022): aqui se gira o corpo
 *  inteiro em voo, e a mira ganha mais por ser rápida do que por ser precisa. */
const SENSIBILIDADE = 0.0024;

/** rad ≈ 83°. Não são 90°: com o olhar na vertical exata a base yaw/pitch
 *  degenera (o vetor de frente perde o componente horizontal) e a direção do
 *  voo escorrega para qualquer lado a cada pixel de mouse. */
const PITCH_LIMITE = 1.45;

/** `1`–`4` viram ÍNDICE em `NAMEK.specialOrder`, que é o que a rede manda
 *  (`packFighter.sk`). Mandar o índice e não o nome é a mesma economia que o
 *  protocolo inteiro já faz. */
const ESPECIAIS = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 };

/** ms — o quanto a porta espera antes de aparecer.
 *
 * Ela NÃO pode ser instantânea, e o motivo é uma corrida de um quadro: soltar o
 * ponteiro no Esc é também o que anuncia "o jogador pediu o menu"
 * (`_lockMudou`), mas quem abre o menu é o laço de quadro, no `actions()`
 * seguinte. Sem esta gaveta a porta piscaria por um quadro entre a perda da
 * trava e a abertura do menu — um clarão preto no meio da luta, toda vez que
 * alguém apertasse Esc. Duzentos milissegundos é folgado para o quadro chegar e
 * curto demais para alguém esperando a porta achar que ela travou. */
const PORTA_ATRASO = 200;

/** ms — quanto esperamos a trava depois de pedi-la, antes de dar por negada.
 *
 * O caminho normal é o navegador responder: ou `pointerlockchange`, ou o erro.
 * Este relógio é para o terceiro caso, o silencioso — o pedido que não vira nem
 * uma coisa nem outra. Sem ele, `_semPonteiro` nunca seria decidido nesse
 * ambiente e a porta ficaria pedindo um clique que nunca leva a lugar nenhum,
 * que é o dedo exato na ferida do topo deste arquivo. */
const LOCK_ESPERA = 1000;

export class NamekInput {
  /**
   * @param {HTMLElement} domElement o canvas do jogo — é nele que o clique
   *   engata a mira e é ele que o Pointer Lock captura.
   * @param {HTMLElement} [uiRoot] onde a porta de entrada é pendurada. O padrão
   *   é a camada de interface do documento (`#ui`), que é a mesma do HUD e do
   *   menu — e ela é procurada aqui, e não recebida, porque `NamekGame` constrói
   *   esta classe com o canvas e só. Pedir um segundo argumento obrigaria a
   *   mexer no laço do jogo para acrescentar uma porta que ele não precisa
   *   conhecer.
   */
  constructor(domElement, uiRoot = null) {
    this.dom = domElement;

    /* --------------------------------------------------------- mira ------- */
    this._yaw = 0;
    this._pitch = 0;

    /* ------------------------------------------------------- estado ------- */
    this.teclas = new Set();
    this._travado = false;
    /** Já tivemos o lock de verdade nesta sessão. Distingue "perdi o ponteiro
     *  porque o jogador apertou Esc" de "nunca consegui capturar". */
    this._jaTeveLock = false;
    /** Fomos NÓS que soltamos o ponteiro (menu abrindo, `dispose`): então a
     *  perda do lock não é um pedido de menu. */
    this._soltandoDeProposito = false;
    this._menuAberto = false;
    /** Botões físicos, guardados porque o `mouseup` se perde ao trocar de aba. */
    this._botaoEsq = false;
    this._botaoDir = false;

    /* ------------------------------------------------ a porta de entrada ---
       Ver a seção "A PORTA DE ENTRADA" no cabeçalho: a regra inteira é o
       `_repensarPorta` lá embaixo, e estes três campos são o que ela lê. */

    /** Este navegador NÃO trava o ponteiro (iframe, painel de preview, política
     *  do documento). Descoberto por tentativa — ver `_lockNegado` —, e enquanto
     *  for verdade a porta não aparece: aqui o jogo é o modo livre, e o modo
     *  livre é jogável. */
    this._semPonteiro = false;
    /** id do `setTimeout` que vai abrir a porta, ou 0. Ver `PORTA_ATRASO`. */
    this._abrindo = 0;
    /** id do `setTimeout` que desiste da trava, ou 0. Ver `LOCK_ESPERA`. */
    this._espera = 0;

    /* A porta é criada ANTES de `_ligar()` porque o teclado consulta o estado
       dela já no primeiro `keydown` que chegar. */
    this.porta = new NamekPorta(
      uiRoot ??
        document.getElementById("ui") ??
        domElement?.parentElement ??
        document.body,
      () => this._gestoDaPorta(),
    );

    /* ------------------------------------------------------- pulsos -------
       Bordas de subida acumuladas ENTRE dois `actions()`. Ficam num campo
       privado, e não no objeto devolvido, porque o objeto é reaproveitado: se o
       pulso morasse lá, quem chamasse `actions()` duas vezes no mesmo quadro
       (o HUD depois do jogo, por exemplo) veria o mesmo `Q` disparar duas
       vezes. Aqui ele é consumido na primeira leitura e acabou. */
    this._pPulo = false;
    this._pVoo = false;
    this._pOnda = false;
    this._pTravar = false;
    this._pMenu = false;
    this._pEspecial = -1;

    /**
     * O OBJETO REAPROVEITADO. Uma única alocação na vida da classe.
     *
     * Ele é o contrato com `FighterController.update`, com `NamekGame.step` e
     * com quem atira, e está documentado campo a campo porque é a única coisa
     * que outros arquivos leem daqui.
     */
    this._acoes = {
      /* ---- eixos, sempre em [-1, 1] --------------------------------------- */
      /** W/S. +1 é para frente. */
      forward: 0,
      /** D/A. +1 é para a direita. */
      strafe: 0,
      /** Espaço/Ctrl. +1 sobe. Só vale voando; no chão o espaço é decolagem. */
      up: 0,

      /* ---- mira, em radianos e ABSOLUTOS ---------------------------------- */
      /** Convenção do repositório: frente = (−sin yaw, 0, −cos yaw). */
      yaw: 0,
      /** > 0 é olhar para cima. */
      pitch: 0,

      /* ---- segurados ------------------------------------------------------ */
      /** Shift. No CHÃO é correr — quem decide o que ele significa no ar é o
       *  controlador, que é quem sabe se os pés estão no chão. */
      run: false,
      /** Botão direito: a arrancada de ki. A outra metade do mapa ("Shift no
       *  ar") é resolvida no `FighterController` pelo motivo acima. */
      boost: false,
      /** Botão esquerdo: rajada de ki enquanto segurar. */
      fire: false,
      /** `C`: carregar ki. */
      charge: false,
      /** `E`: a GUARDA, enquanto a tecla estiver embaixo do dedo.
       *
       *  É um ESTADO, e não uma borda como `flyPressed` ou `burstPressed` —
       *  irmão de `charge` e `fire`, e não deles. A diferença não é de estilo:
       *  quem lê isto (`NamekGame.step`) drena a barra de ki por SEGUNDO de
       *  guarda e corta a velocidade enquanto ela estiver de pé; com uma borda,
       *  a defesa duraria um quadro e o dreno nunca chegaria a acontecer.
       *
       *  E aqui ele é a tecla e mais nada. Defender caído, no meio do próprio
       *  especial ou com a barra vazia é proibido — mas quem sabe dessas três
       *  coisas é o laço do jogo, não o teclado. Este campo responde só *"o
       *  jogador está pedindo a guarda?"*. */
      guard: false,
      /** Espaço segurado: é o que decola do chão. */
      jumpHeld: false,

      /* ---- bordas: valem UM quadro ---------------------------------------- */
      /** Borda de subida do espaço. No chão, o pulo. */
      jumpPressed: false,
      /** O MESMO espaço, lido por quem está caído: "levantar". Não é uma tecla
       *  nova — seria uma a mais no mapa que o pedido fechou —, é a única que
       *  faz sentido quando o corpo não responde a mais nada. */
      respawn: false,
      /** `F`. */
      flyPressed: false,
      /** `Q`. */
      burstPressed: false,
      /** `R` — era o `Tab`. Ver a seção "o TAB, que saiu do mapa". */
      lockPressed: false,
      /** `Esc` — o único atalho do jogo antigo que sobrevive aqui. */
      menuPressed: false,
      /** Um por especial, na ordem de `NAMEK.specialOrder` (teclas 1–4).
       *  Array e não índice porque é assim que `NamekGame.step` o varre. */
      special: [false, false, false, false],

      /* ---- diagnóstico ---------------------------------------------------- */
      /** O ponteiro está capturado? O HUD usa para mostrar (ou não) o aviso. */
      locked: false,
    };

    this._ligar();
    /* A porta nasce com o modo, e não com o `start()`: ela é montada enquanto a
       tela de entrada (`#lobby`) ainda está por cima, e passa por baixo dela até
       o lobby sumir — o z-index em `ui/style.js` explica esse encaixe. Quem
       termina de digitar o apelido vê a porta APARECER junto com a arena, sem
       este arquivo precisar saber que existe um lobby. */
    this._repensarPorta();
  }

  /** O ponteiro está capturado de verdade? */
  get locked() {
    return this._travado;
  }

  /**
   * O estado das ações neste quadro.
   *
   * **Chame uma vez por quadro.** O objeto é o mesmo em todas as chamadas (zero
   * alocação em regime) e os pulsos são consumidos aqui: uma segunda chamada no
   * mesmo quadro devolve o mesmo objeto com as bordas já apagadas.
   */
  actions() {
    const a = this._acoes;

    a.yaw = this._yaw;
    a.pitch = this._pitch;

    a.run = this._segura("ShiftLeft") || this._segura("ShiftRight");
    a.boost = this._botaoDir;
    a.fire = this._botaoEsq;
    a.charge = this._segura("KeyC");
    /* SEGURADA, como as de cima: sai do conjunto de teclas e não de um pulso.
       O `_segura` também é o que faz a guarda cair sozinha quando o menu ou a
       porta sobem na frente — braços cruzados por trás de uma tela que pede
       clique seriam ki escoando sem ninguém tocar em nada. */
    a.guard = this._segura("KeyE");
    a.jumpHeld = this._segura("Space");

    a.forward = (this._segura("KeyW") ? 1 : 0) - (this._segura("KeyS") ? 1 : 0);
    a.strafe = (this._segura("KeyD") ? 1 : 0) - (this._segura("KeyA") ? 1 : 0);
    a.up =
      (this._segura("Space") ? 1 : 0) -
      (this._segura("ControlLeft") || this._segura("ControlRight") ? 1 : 0);

    a.jumpPressed = this._pPulo;
    a.respawn = this._pPulo;
    a.flyPressed = this._pVoo;
    a.burstPressed = this._pOnda;
    a.lockPressed = this._pTravar;
    a.menuPressed = this._pMenu;
    a.locked = this._travado;

    const esp = a.special;
    for (let i = 0; i < esp.length; i++) esp[i] = i === this._pEspecial;

    this._pPulo = false;
    this._pVoo = false;
    this._pOnda = false;
    this._pTravar = false;
    this._pMenu = false;
    this._pEspecial = -1;

    return a;
  }

  /**
   * Engata a mira: pede o ponteiro e segue em frente se ele for negado.
   *
   * Chamado pelo clique no canvas, e exposto porque quem fecha um diálogo (o
   * menu geral, a tela de morte) precisa devolver o ponteiro sem esperar um
   * clique — que cairia no botão que a pessoa acabou de apertar.
   */
  engage() {
    /* Com o menu aberto o clique é do MENU. Sem esta linha, um clique que
       passasse ao lado de um botão recapturaria o ponteiro com o menu na tela —
       o mesmo tropeço que `Input.engage` do arqueiro documenta. */
    if (this._menuAberto) return;
    /* Já é nosso. Sem esta linha o clique de cada tiro repetiria o pedido e
       armaria um relógio de espera por quadro, sessenta vezes por segundo. */
    if (this._travado) return;
    if (!this.dom?.requestPointerLock) {
      /* Nem API existe. É a forma mais crua de "este navegador não trava", e ela
         se responde na hora: modo livre, porta fora da frente. */
      this._lockNegado();
      return;
    }
    /* O relógio da desistência é armado ANTES do pedido, porque o pedido pode
       não responder nada. Ver `LOCK_ESPERA`. */
    this._pararEspera();
    this._espera = setTimeout(() => this._lockNegado(), LOCK_ESPERA);
    try {
      const r = this.dom.requestPointerLock();
      /* Navegador moderno devolve Promise, e ela REJEITA em dois casos que não
         são a mesma coisa: a permissão bloqueada de vez (iframe, painel de
         preview) e a recusa TEMPORÁRIA — pedir a trava cedo demais depois de o
         jogador tê-la solto no Esc ("The user has exited the lock before this
         request was completed"), ou pedir fora de um gesto do usuário, que é
         exatamente o que acontece quando quem fecha o menu é o laço de quadro.

         Nos dois a resposta começa igual e é a regra deste arquivo desde sempre:
         NÃO ESPERAR. Nada fica pendurado aguardando uma trava que talvez nunca
         venha — `_travado` continua falso, a mira livre por `movementX/Y` segue
         valendo, o teclado segue valendo. O que MUDA agora é quem conta isso ao
         jogador: `_lockNegado` separa os dois casos pelo único sinal honesto que
         temos (já travamos alguma vez nesta sessão?) e decide se a porta espera
         mais um clique ou se sai da frente de vez. */
      r?.catch?.(() => this._lockNegado());
    } catch {
      /* API ausente ou bloqueada de forma síncrona: segue no modo livre. */
      this._lockNegado();
    }
  }

  /**
   * O pedido de trava morreu — por erro, por recusa ou por silêncio.
   *
   * A pergunta que separa os dois desfechos é uma só: **já travamos alguma vez
   * nesta sessão?**
   *
   * • **Já** — então travar é possível aqui e esta recusa é passageira: quase
   *   sempre o "too soon", o navegador se recusando a devolver a trava logo
   *   depois de o jogador tê-la solto (fechar o menu com dois Esc seguidos faz
   *   isso todo dia). A porta CONTINUA na tela pedindo o clique, porque some-la
   *   agora deixaria o jogador sem mira e sem nada para clicar. O clique
   *   seguinte, um segundo depois, funciona.
   *
   * • **Nunca** — então não é um instante ruim, é este documento: iframe sem
   *   `allow="pointer-lock"`, painel de preview, política do navegador. Insistir
   *   seria transformar a porta na tela de "clique para mirar" que nunca sai
   *   contra a qual o topo deste arquivo avisa. Modo livre, e a porta sai.
   */
  _lockNegado() {
    this._pararEspera();
    /* A trava pode ter chegado no meio do caminho (o erro de um pedido velho
       chegando depois do sucesso de um novo). Quem está travado não foi negado. */
    if (this._travado) return;
    if (!this._jaTeveLock) this._semPonteiro = true;
    this._repensarPorta();
  }

  /**
   * O jogador clicou na porta (ou apertou Enter/Espaço).
   *
   * A porta NÃO se fecha aqui, e é de propósito: o gesto é um pedido, não uma
   * garantia. Quem a fecha é a trava chegando (`_lockMudou`) ou a constatação de
   * que ela não vai chegar (`_lockNegado`) — as duas passam por
   * `_repensarPorta`, que é o único lugar do arquivo que abre e fecha essa tela.
   */
  _gestoDaPorta() {
    /* O gesto entra pelo `click`, e antes dele veio um `mousedown` que
       `_botaoDesce` ignorou por causa da porta. Limpar aqui é a garantia de que
       nem esse botão nem uma tecla presa desde a última perda de trava chegam
       ao primeiro quadro de jogo — o clique de entrar não pode virar um tiro. */
    this._limparSegurados();
    this.porta.esperar();
    this.engage();
  }

  /**
   * A regra da porta, num lugar só.
   *
   * Chamado de tudo que possa mexer numa das três pontas da frase do cabeçalho:
   * a trava mudou, o menu abriu ou fechou, o ponteiro foi negado. É idempotente
   * de propósito — chamar duas vezes seguidas não abre duas portas nem reinicia
   * a animação de entrada.
   */
  _repensarPorta() {
    const deveAbrir = !this._travado && !this._menuAberto && !this._semPonteiro;

    if (!deveAbrir) {
      if (this._abrindo) {
        clearTimeout(this._abrindo);
        this._abrindo = 0;
      }
      this.porta.fechar();
      return;
    }

    if (this._abrindo) return;
    if (this.porta.aberta) {
      /* JÁ ESTÁ NA TELA — e é aqui que ela volta a convidar. Quem clicou pôs a
         porta em "engatando a mira…" (`_gestoDaPorta`); se a gente chegou de
         novo até aqui, aquela tentativa não vingou e a frase virou mentira.
         `abrir` numa porta aberta não a reabre: só refaz o texto. */
      this.porta.abrir(this._jaTeveLock);
      return;
    }
    this._abrindo = setTimeout(() => {
      this._abrindo = 0;
      /* `_jaTeveLock` é o que diz se esta é a primeira vez ou uma volta — e a
         porta troca uma palavra por causa disso. Ver `NamekPorta.abrir`. */
      this.porta.abrir(this._jaTeveLock);
    }, PORTA_ATRASO);
  }

  _pararEspera() {
    if (!this._espera) return;
    clearTimeout(this._espera);
    this._espera = 0;
  }

  /**
   * O menu geral abriu ou fechou.
   *
   * ELE PRECISA DO PONTEIRO — um menu de botões sem cursor é um menu impossível
   * de usar. E precisa que o corpo PARE: as teclas seguradas no instante da
   * abertura nunca recebem `keyup`, e sem limpar o conjunto o lutador sairia
   * voando sozinho por trás do menu.
   */
  setMenuOpen(aberto) {
    if (this._menuAberto === aberto) return;
    this._menuAberto = aberto;
    if (aberto) {
      this._limparSegurados();
      this._soltarPonteiro();
      /* A PORTA SAI DE CENA. As duas telas pedem o mesmo clique e a mesma tecla,
         e as duas mexem no ponteiro: juntas, uma desfaria o que a outra fez. O
         menu é quem foi chamado, então o menu manda. */
      this._repensarPorta();
      return;
    }
    /* Fechando: pede o ponteiro de volta. Se ele vier, a porta nem chega a
       aparecer (o `PORTA_ATRASO` é maior que a viagem da trava); se for negado
       — o "too soon" de quem fechou o menu logo depois de abri-lo —, ela aparece
       e vira o único lugar onde clicar. Nos dois casos, quem decide é
       `_repensarPorta`, e não este método. */
    this.engage();
    this._repensarPorta();
  }

  /** Devolve o teclado, o mouse e o ponteiro. Chamar ao sair do modo. */
  dispose() {
    const d = this._ouvintes;
    window.removeEventListener("keydown", d.keydown);
    window.removeEventListener("keyup", d.keyup);
    window.removeEventListener("blur", d.blur);
    document.removeEventListener("mousemove", d.mousemove);
    document.removeEventListener("mousedown", d.mousedown);
    document.removeEventListener("mouseup", d.mouseup);
    document.removeEventListener("contextmenu", d.contextmenu);
    document.removeEventListener("pointerlockchange", d.lockchange);
    document.removeEventListener("pointerlockerror", d.lockerror);
    document.removeEventListener(EVENTO_MENU, d.menu);
    this.dom?.removeEventListener("click", d.click);
    /* Os dois relógios ANTES da porta sair do documento: um `setTimeout` que
       sobreviva ao `dispose` acorda mexendo num nó que já não está na página, e
       é o tipo de sujeira que só aparece quando alguém troca de modo duas vezes
       seguidas. */
    this._pararEspera();
    if (this._abrindo) {
      clearTimeout(this._abrindo);
      this._abrindo = 0;
    }
    this.porta.dispose();
    this._limparSegurados();
    this._soltarPonteiro();
  }

  /* ------------------------------------------------------------- interno -- */

  /**
   * Há uma tela cheia por cima do jogo — o menu ou a porta de entrada.
   *
   * As duas calam a mesma coisa e pela mesma razão: o corpo não pode andar por
   * trás de uma tela que pede um clique, e a mira não pode girar enquanto o
   * mouse atravessa a tela ATÉ esse clique — o jogador chegaria ao primeiro
   * quadro de jogo olhando para um lugar que ele não escolheu.
   */
  get _suspenso() {
    return this._menuAberto || this.porta.aberta;
  }

  /** Uma tecla vale enquanto nada está por cima. Ver `_suspenso`. */
  _segura(code) {
    return !this._suspenso && this.teclas.has(code);
  }

  _limparSegurados() {
    this.teclas.clear();
    this._botaoEsq = false;
    this._botaoDir = false;
  }

  _soltarPonteiro() {
    if (typeof document === "undefined") return;
    if (document.pointerLockElement !== this.dom) return;
    this._soltandoDeProposito = true;
    document.exitPointerLock?.();
  }

  _ligar() {
    /* Os ouvintes são guardados um a um porque `dispose` precisa REMOVER
       exatamente estes. Arrow function criada na chamada de `addEventListener`
       é uma referência que ninguém mais tem — e um ouvinte de `keydown` que
       sobrevive à saída do modo é o teclado do jogo antigo respondendo a duas
       classes ao mesmo tempo. */
    const d = {
      keydown: (e) => this._teclaDesce(e),
      keyup: (e) => this._teclaSobe(e),
      blur: () => this._limparSegurados(),
      mousemove: (e) => this._mouse(e),
      mousedown: (e) => this._botaoDesce(e),
      mouseup: (e) => this._botaoSobe(e),
      contextmenu: (e) => e.preventDefault(),
      lockchange: () => this._lockMudou(),
      lockerror: () => {
        /* Pointer Lock indisponível (iframe, painel de preview, política) ou
           recusado por vir cedo demais — ver `engage`. Não é fatal: a mira livre
           por movementX/Y continua funcionando.

           A única coisa que PRECISA acontecer aqui é limpar a bandeira de "fomos
           nós que soltamos". Um pedido que morre no erro não devolve
           `pointerlockchange`, e a bandeira ficaria acesa esperando um evento que
           não vem — o próximo Esc de verdade seria lido como saída nossa e o
           menu não abriria.

           E a porta de entrada precisa saber: este é o sinal mais rápido de que
           a trava não vem, e é ele que decide entre "clique de novo" e "aqui não
           trava mesmo". Ver `_lockNegado`. */
        this._soltandoDeProposito = false;
        this._lockNegado();
      },
      click: () => this.engage(),
      /* O menu falando. É o conserto do empate descrito no cabeçalho: qualquer
         caminho que abra ou feche o menu chega aqui, inclusive os que não passam
         pelo laço de quadro (o clique no fundo, o `dispose`). E há um brinde:
         quando o menu fecha POR CLIQUE, este `setMenuOpen(false)` roda dentro do
         próprio evento de clique — ou seja, com gesto do usuário válido, que é a
         única hora em que o navegador devolve o ponteiro sem discutir. */
      menu: (e) => this.setMenuOpen(!!e.detail?.aberto),
    };
    this._ouvintes = d;

    window.addEventListener("keydown", d.keydown);
    window.addEventListener("keyup", d.keyup);
    window.addEventListener("blur", d.blur);
    document.addEventListener("mousemove", d.mousemove);
    document.addEventListener("mousedown", d.mousedown);
    document.addEventListener("mouseup", d.mouseup);
    /* Sem menu de contexto: o botão direito é a ARRANCADA, e ele fica segurado
       segundos a fio. Um menu do sistema abrindo no meio de uma perseguição
       come o `mouseup` e deixa o boost aceso para sempre. */
    document.addEventListener("contextmenu", d.contextmenu);
    document.addEventListener("pointerlockchange", d.lockchange);
    document.addEventListener("pointerlockerror", d.lockerror);
    document.addEventListener(EVENTO_MENU, d.menu);
    this.dom?.addEventListener("click", d.click);
  }

  _lockMudou() {
    const travado = document.pointerLockElement === this.dom;
    this._travado = travado;
    /* O navegador respondeu — de um jeito ou de outro, o relógio da desistência
       não tem mais o que vigiar. */
    this._pararEspera();

    if (travado) {
      this._jaTeveLock = true;
      /* PROVA DE QUE AQUI TRAVA. Se em algum momento desistimos do ponteiro por
         silêncio ou por erro, desistimos errado — e uma tentativa que dá certo
         vale mais que qualquer palpite anterior. */
      this._semPonteiro = false;
      this._soltandoDeProposito = false;
      /* A TRAVA ATRASADA. `requestPointerLock` é assíncrono: entre o pedido e o
         "pronto" cabe um Esc, e portanto cabe o menu inteiro abrir. Quando isso
         acontece o `_soltarPonteiro` de `setMenuOpen` não teve o que soltar (o
         lock ainda não era nosso), e a captura desembarca aqui com o menu já na
         tela — cursor preso e invisível sobre uma tela de botões, e o Esc
         seguinte devolvendo o ponteiro sem abrir nada, porque para o menu já
         aberto o pulso não vale. Fim de jogo, mouse morto.

         Devolver na hora custa uma linha e desfaz o nó: o menu manda no ponteiro
         enquanto estiver aberto, independentemente de quem pediu o quê antes. */
      if (this._menuAberto) this._soltarPonteiro();
      /* A mira está viva: a porta cumpriu o que prometeu e sai da frente. */
      this._repensarPorta();
      return;
    }

    /* Perdemos o ponteiro. Se ele era nosso e não fomos nós que soltamos, foi o
       Esc nativo do navegador — que ENGOLE o keydown (ver o cabeçalho). É a
       única notícia que temos de que o jogador pediu o menu geral. */
    if (this._jaTeveLock && !this._menuAberto && !this._soltandoDeProposito) {
      this._pMenu = true;
    }
    this._soltandoDeProposito = false;
    /* Sair do lock também come os `keyup` das teclas seguradas. */
    this._limparSegurados();
    /* E A PORTA VOLTA — é a mesma porta de entrada, sempre. Não na hora: se esta
       perda for o Esc, o menu abre no quadro seguinte e cancela a abertura antes
       de a porta piscar. Ver `PORTA_ATRASO`. */
    this._repensarPorta();
  }

  _mouse(e) {
    if (this._suspenso) return;
    /* `movementX/Y` vêm preenchidos com ou sem Pointer Lock — só a captura do
       cursor depende da permissão. Ver o cabeçalho. */
    this._yaw -= (e.movementX || 0) * SENSIBILIDADE;
    this._pitch = clamp(
      this._pitch - (e.movementY || 0) * SENSIBILIDADE,
      -PITCH_LIMITE,
      PITCH_LIMITE,
    );

    /* O mouse também carrega o estado do Shift. Se o `keyup` do Shift se
       perdeu — troca de aba, atalho do sistema operacional —, o primeiro
       movimento do mouse já desfaz a corrida presa. A lição é do arqueiro e
       vale igual aqui, onde Shift no ar é o boost e boost preso queima a barra
       de ki inteira sem ninguém tocar em nada. */
    if (!e.shiftKey) {
      this.teclas.delete("ShiftLeft");
      this.teclas.delete("ShiftRight");
    }
  }

  _botaoDesce(e) {
    if (this._suspenso) return;
    if (e.button === 0) this._botaoEsq = true;
    else if (e.button === 2) this._botaoDir = true;
  }

  _botaoSobe(e) {
    if (e.button === 0) this._botaoEsq = false;
    else if (e.button === 2) this._botaoDir = false;
  }

  _teclaDesce(e) {
    /* PORTA ABERTA: o teclado é dela, e ela só ouve o "vamos".
       O clique já basta para entrar, mas exigir mouse para começar a jogar é
       exigir mouse de quem chegou pelo teclado — e o navegador aceita o Enter
       como gesto do usuário exatamente como aceita o clique.

       O `naFrente` é o que impede a maior armadilha desta tela: a porta nasce
       junto com o modo, enquanto o LOBBY ainda está por cima com o campo do
       apelido esperando um Enter que é dele. Este ouvinte é da janela inteira e
       receberia esse Enter primeiro. Ver `NamekPorta.naFrente` — e note que não
       há `preventDefault` no caminho de saída: a tecla ignorada aqui tem de
       continuar valendo para quem está na frente. */
    if (this.porta.aberta) {
      if (e.repeat || !this.porta.naFrente()) return;
      if (e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Space") {
        e.preventDefault();
        this._gestoDaPorta();
      }
      return;
    }

    /* MENU ABERTO: o teclado é dele. Sobra o `Esc`, que é o que todo mundo
       tenta primeiro para fechar. */
    if (this._menuAberto) {
      if (e.code === "Escape") {
        e.preventDefault();
        this._pMenu = true;
      }
      return;
    }

    /* O TAB, ENGOLIDO — e não é tecla de nada. Ver a seção do cabeçalho: ele
       saiu do mapa de teclas porque leva o foco embora, e é exatamente por isso
       que continua sendo interceptado aqui. Uma tecla que tira o teclado do
       jogo não para de tirar só porque perdeu a função.

       Ele vem ACIMA do corte de `repeat`, e não como um `case` no switch, por
       um motivo que só aparece com o dedo parado: Tab segurado REPETE, e cada
       repetição é uma navegação de foco. Lá embaixo, a primeira seria contida e
       a segunda escaparia. E vem DEPOIS dos dois blocos acima de propósito —
       com a porta ou o menu na frente o teclado é deles, e ali navegar entre
       botões com o Tab é o comportamento certo. */
    if (e.code === "Tab") {
      e.preventDefault();
      return;
    }

    /* `repeat` é o teclado repetindo a tecla segurada. Ele não pode virar
       borda: `Q` segurado dispararia uma onda de empurrão a 30 Hz. As teclas
       CONTÍNUAS não se importam — elas leem o conjunto, e a tecla já está lá. */
    if (e.repeat) return;

    this.teclas.add(e.code);

    switch (e.code) {
      case "Space":
        /* Sem isto a página ROLA a cada decolagem. */
        e.preventDefault();
        this._pPulo = true;
        break;
      case "KeyF":
        this._pVoo = true;
        break;
      case "KeyQ":
        this._pOnda = true;
        break;
      case "KeyR":
        /* A TRAVA DE ALVO, que era o Tab. Sem `preventDefault`: o `R` não
           significa nada para o navegador, e essa é a diferença inteira entre
           as duas teclas — a que precisava ser defendida do navegador foi
           trocada por uma que ele não disputa. Ver a seção do cabeçalho. */
        this._pTravar = true;
        break;
      case "Escape":
        /* Chega aqui só no modo LIVRE (sem lock, o navegador não intercepta).
           Com o ponteiro travado quem dispara o menu é o `pointerlockchange`. */
        this._pMenu = true;
        break;
      case "Digit1":
      case "Digit2":
      case "Digit3":
      case "Digit4":
        this._pEspecial = ESPECIAIS[e.code];
        break;
      default:
        /* E MAIS NADA. Toda outra tecla do jogo do arqueiro — T, K, L, O, P,
           crase, 5–9, 0 — passa direto: aqui ela não existe. É o pedido.

           Não procure `KeyE` (a guarda) nem `KeyC`, `KeyW`, `ShiftLeft` neste
           switch: elas são SEGURADAS e já foram tratadas na linha que põe a
           tecla no conjunto, lá em cima. O switch é só das bordas. */
        break;
    }
  }

  _teclaSobe(e) {
    this.teclas.delete(e.code);
    /* O `keyup` do Shift é o mais fácil de perder de todos, e o `mousemove`
       acima já cobre o caso. Este ramo cobre o contrário: soltar o Shift sem
       mexer o mouse. */
    if (!e.shiftKey) {
      this.teclas.delete("ShiftLeft");
      this.teclas.delete("ShiftRight");
    }
  }
}

/* A LISTA DE TECLAS PARA O JOGADOR LER mora no HUD (`ui/hud.js`, `CONTROLES`),
   e não aqui. Havia uma cópia neste arquivo e ela foi tirada: duas tabelas das
   mesmas doze teclas são duas tabelas que envelhecem em metades, e a que
   envelhece calada é justamente a que ninguém vê na tela. */
