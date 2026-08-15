/* ---------------------------------------------------------------------------
   A entrada de Namekusei — teclado e mouse, e SÓ o que este modo usa.

   IRMÃO de `systems/input.js`, nunca filho. Aquele arquivo é o teclado do
   arqueiro: trinta atalhos, modos de 1 a 8, fase no 9, placar no 0, faca no E,
   javali no P, alce no L. Nada disso existe aqui, e o pedido do usuário é
   explícito — *"nesse modo todos os outros atalhos que o jogo já tem devem ser
   ignorados; deixe somente o atalho que aparece o menu geral"*. Herdar aquela
   classe seria herdar as trinta teclas para desligá-las uma a uma, e a primeira
   tecla nova que o arqueiro ganhasse voltaria a valer aqui sem ninguém pedir.

   Então este arquivo conhece DEZESSEIS entradas e é surdo para o resto do
   teclado. Um `KeyR` aqui não é "a tecla de limpar flechas desligada": é uma
   tecla que este modo nunca ouviu falar.

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
   --------------------------------------------------------------------------- */

import { clamp } from "../utils/math.js";

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

export class NamekInput {
  /**
   * @param {HTMLElement} domElement o canvas do jogo — é nele que o clique
   *   engata a mira e é ele que o Pointer Lock captura.
   */
  constructor(domElement) {
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
      /** `E`. */
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
    if (!this.dom?.requestPointerLock) return;
    try {
      const r = this.dom.requestPointerLock();
      /* Navegador moderno devolve Promise, e ela REJEITA quando a permissão
         está bloqueada. Sem o catch isso vira um erro não tratado no console —
         e o modo livre continuaria funcionando do mesmo jeito. */
      r?.catch?.(() => {});
    } catch {
      /* API ausente ou bloqueada de forma síncrona: segue no modo livre. */
    }
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
      return;
    }
    this.engage();
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
    this.dom?.removeEventListener("click", d.click);
    this._limparSegurados();
    this._soltarPonteiro();
  }

  /* ------------------------------------------------------------- interno -- */

  /** Uma tecla vale enquanto o menu não está aberto. Ver `setMenuOpen`. */
  _segura(code) {
    return !this._menuAberto && this.teclas.has(code);
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
        /* Pointer Lock indisponível (iframe, painel de preview, política).
           Não é fatal: a mira livre por movementX/Y continua funcionando. */
      },
      click: () => this.engage(),
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
    this.dom?.addEventListener("click", d.click);
  }

  _lockMudou() {
    const travado = document.pointerLockElement === this.dom;
    this._travado = travado;

    if (travado) {
      this._jaTeveLock = true;
      this._soltandoDeProposito = false;
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
  }

  _mouse(e) {
    if (this._menuAberto) return;
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
    if (this._menuAberto) return;
    if (e.button === 0) this._botaoEsq = true;
    else if (e.button === 2) this._botaoDir = true;
  }

  _botaoSobe(e) {
    if (e.button === 0) this._botaoEsq = false;
    else if (e.button === 2) this._botaoDir = false;
  }

  _teclaDesce(e) {
    /* MENU ABERTO: o teclado é dele. Sobra o `Esc`, que é o que todo mundo
       tenta primeiro para fechar. */
    if (this._menuAberto) {
      if (e.code === "Escape") {
        e.preventDefault();
        this._pMenu = true;
      }
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
      case "KeyE":
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
        /* E MAIS NADA. Toda outra tecla do jogo do arqueiro — R, T, K, L, O,
           crase, 5–9, 0 — passa direto: aqui ela não existe. É o pedido. */
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
