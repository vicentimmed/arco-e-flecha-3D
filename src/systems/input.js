/* ---------------------------------------------------------------------------
   Entrada: mouse para mirar, teclado para andar e comandos.

   Preferimos o Pointer Lock (cursor capturado e escondido, sensação de FPS de
   verdade), mas ele depende de uma permissão que pode estar indisponível —
   iframes sem "allow=pointer-lock", políticas de permissão do navegador, ou o
   painel de preview de uma ferramenta de desenvolvimento. Quando isso acontece
   o pedido falha silenciosamente e, sem um plano B, o jogo trava numa tela de
   "clique para mirar" que nunca sai do lugar.

   Por isso a mira funciona em dois modos:
     • travado  — Pointer Lock concedido: cursor escondido, uso de movementX/Y.
     • livre    — sem Pointer Lock: cursor visível, mas AINDA usamos
       movementX/Y, que o navegador preenche em qualquer mousemove, travado ou
       não. Só a captura do cursor depende da permissão; o delta de movimento
       não depende.
   O jogo funciona nos dois casos; a única diferença visual é o cursor.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../config.js";
import { clamp } from "../utils/math.js";

/** As teclas de andar. Elas também encerram a câmera da flecha. */
const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);

export class Input {
  constructor(canvas, lockHint) {
    this.canvas = canvas;
    this.lockHint = lockHint;

    this.yaw = 0;
    this.pitch = 0.06;
    this.forward = 0;
    this.strafe = 0;
    /** Shift segurado: corre em vez de andar. */
    this.run = false;
    /** Terceira pessoa por padrão; botão direito segurado: primeira pessoa. */
    this.firstPerson = false;
    this.drawing = false;
    /** Botão esquerdo fisicamente pressionado — distinto de `drawing`, que pode
     *  ficar false durante o reload mesmo com o clique segurado. */
    this.primaryDown = false;

    /** true assim que o jogador engatou a mira (travada OU livre). */
    this.active = false;
    /** true só quando o Pointer Lock de verdade está concedido. */
    this.locked = false;
    /** já tivemos o lock nesta sessão de mira — distingue "perdi o lock via
     *  Esc nativo" (deve voltar ao menu) de "nunca tive lock" (modo livre). */
    this.hadLock = false;

    this.keys = new Set();

    /** Menu de comandos aberto: o ponteiro é solto e o jogo fica em espera. */
    this.menuOpen = false;

    /** Quando true, o clique não tensiona o arco — ele só encerra a câmera da
     *  flecha. Quem decide é o main, olhando o estado da câmera. */
    this.blockDraw = false;
    /** Por que o draw está bloqueado: `"reload"` | `"arrowCam"` | `"dead"` | `"knife"` | `"modePrepare"` | `"trebuchet"` | null */
    this.blockDrawReason = null;

    /**
     * Placar aberto (0 segurado).
     *
     * Era o Tab, a convenção dos jogos de tiro — e ela não sobrevive ao
     * navegador: o Tab é a tecla de NAVEGAÇÃO da página, e mesmo com
     * `preventDefault` o foco escapa para a barra de endereço e para os
     * controles do próprio navegador quando o Pointer Lock não está ativo. O
     * zero não tem dono, fica ao lado das teclas de modo (1–5) e não briga
     * com ninguém.
     */
    this.scoreboard = false;

    /**
     * Quando há um diálogo de confirmação aberto, Enter e Esc pertencem a ele.
     *
     * Sem isso o `Esc` de "cancelar" também soltaria o ponteiro e tiraria o
     * jogador da mira — dois efeitos numa tecla só, e um deles indesejado.
     */
    this.dialogOpen = false;
    this.onDialogKey = null;

    /** Eventos de uma só vez, consumidos pelo main a cada frame. */
    this.actions = {
      release: false, // soltou a corda
      knifeAttack: false, // E — golpe com a faca
      dismissArrowCam: false, // clique para voltar à visão da arqueira
      cycleTarget: false,
      clearArrows: false,
      toggleDebug: false,
      toggleHelp: false,
      toggleTrace: false,
      toggleWindInfluence: false,
      toggleArrowCam: false,
      confirmOverlay: false, // Enter fora de um diálogo — fecha telas como a de vitória
      jump: false,
      spawnBoar: false,
      spawnElk: false,
      spawnElkWolves: false,
      toggleMusic: false,
      askRespawn: false, // K — renascer noutro lugar
      askResetScores: false, // Y — zerar o placar de todos
      setMode: null, // "free" | "duel" | "boarHunt"
      /* A chuva de meteoros COM NÍVEL: "easy" | "normal" | "hard".
         Separada do `setMode` porque carrega um segundo dado, e porque entrar
         nela por aqui é sempre um recomeço no nível pedido — enquanto o
         `setMode: "meteorRain"` do Shift+9 entra no nível que a sala já tem.
         Só o menu escreve neste campo: não há tecla, e é o pedido. */
      setMeteorRain: null,
      /* O cerco COM NÍVEL: "easy" | "normal" | "hard". Separado do `setMode`
         pelo mesmo motivo do `setMeteorRain`, e só o menu escreve nele — a
         tecla 8 continua entrando no cerco no nível que a sala já tem. */
      setSiege: null,
      setLevel: null, // "valley" | "moon" — a FASE, não o modo
      toggleBot: null, // "add" | "remove" — adversário de CPU
      cycleBotDifficulty: 0, // N: +1 avança, Shift+N volta, 0 = nada
      siegeSkip: null, // J: "next" | "climber" — atalho de teste do cerco
      fillSpecial: false, // Shift+Q — enche a barra do especial, para teste
      toggleCommandMenu: false, // três toques na crase — ver `Input.crase`
      /* A intenção nasceu de um CLIQUE no menu, e não de uma tecla. Quem lê é
         `Game.handleActions`, e o único efeito é pular a pergunta de
         confirmação: um botão que a pessoa foi procurar num menu já É a
         confirmação. Ver `Hud.onCommand`. */
      doMenu: false,
      /* O espaço tem DOIS eventos, e o jetpack precisa dos dois. `jump` é a
         BORDA (pular, e acender o jato no segundo toque); `jumpReleased` é o
         soltar, que apaga o jato guardando o combustível que sobrou. */
      jumpReleased: false,
    };

    this.bind();
  }

  /**
   * A CRASE: TRÊS TOQUES, e uma coisa só — o menu de comandos.
   *
   * Ela alternava o painel de depuração, e não alterna mais: a telemetria
   * passou a ser um BOTÃO dentro do menu, e mais nada. O motivo é o mesmo que
   * justifica o menu inteiro — o jogo tem trinta atalhos e nenhum deles é
   * descobrível; tirar um da lista é uma coisa a menos para decorar, e o painel
   * de depuração é justamente o mais raro de todos.
   *
   * Os três toques ficaram. Um toque só abriria o menu por acidente com a
   * frequência de uma tecla vizinha da `1` (que é o modo livre); três é um
   * gesto que ninguém faz sem querer. A janela é de 600 ms entre toques —
   * larga o bastante para uma rajada feita sem pressa.
   */
  crase() {
    const agora = performance.now();
    if (agora - (this._craseEm ?? -Infinity) > 600) this._craseN = 0;
    this._craseEm = agora;
    this._craseN = (this._craseN ?? 0) + 1;

    if (this._craseN < 3) return;
    this._craseN = 0;
    this.actions.toggleCommandMenu = true;
  }

  /**
   * O menu de comandos abriu ou fechou.
   *
   * ELE PRECISA DO PONTEIRO. O jogo roda com Pointer Lock — o cursor não
   * existe — e um menu de botões sem cursor é um menu impossível de usar. Aqui
   * o lock é solto na abertura e pedido de volta no fechamento.
   *
   * O detalhe que faz isso funcionar é `menuOpen` sendo consultado no
   * `pointerlockchange`: sair do lock normalmente significa "o jogador apertou
   * Esc, devolva-o à tela inicial" (`disengage`), e sem a bandeira o menu
   * abriria já cobrindo o aviso de "clique para mirar".
   */
  setMenuOpen(aberto) {
    if (this.menuOpen === aberto) return;
    this.menuOpen = aberto;

    if (aberto) {
      /* O corpo PARA. As teclas de movimento seguradas no instante da abertura
         não recebem `keyup` (o `keydown` deixa de ser processado), e sem isto o
         personagem sairia andando sozinho enquanto o menu estivesse aberto. */
      this.keys.clear();
      this.forward = 0;
      this.strafe = 0;
      this.run = false;
      this.drawing = false;
      this.primaryDown = false;
      this.firstPerson = false;
      if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
      return;
    }
    if (!this.active || !this.canvas.requestPointerLock) return;
    try {
      const r = this.canvas.requestPointerLock();
      r?.catch?.(() => {});
    } catch {
      /* Sem Pointer Lock a mira livre continua funcionando — ver o cabeçalho. */
    }
  }

  /** Engata a mira: some com o aviso e tenta o Pointer Lock em segundo plano. */
  engage() {
    /* Com o menu aberto o clique é do MENU. Sem esta linha, um clique que
       passasse ao lado de um botão cairia no canvas, reengataria a mira e
       recapturaria o ponteiro com o menu ainda na tela. */
    if (this.menuOpen) return;
    if (this.active) return;
    this.active = true;
    this.firstPerson = false;
    this.lockHint.classList.add("hidden");
    this.onEngage?.();

    if (this.canvas.requestPointerLock) {
      try {
        const result = this.canvas.requestPointerLock();
        // Em navegadores modernos isso devolve uma Promise que rejeita se a
        // permissão estiver bloqueada. Sem o catch, seria um erro não tratado
        // no console — e o jogo continua no modo livre de qualquer forma.
        if (result && typeof result.catch === "function") {
          result.catch(() => {});
        }
      } catch {
        /* API ausente ou bloqueada de forma síncrona: segue no modo livre. */
      }
    }
  }

  /** Sai da mira: mostra o aviso de novo e limpa o estado de movimento. */
  disengage() {
    this.active = false;
    this.locked = false;
    this.hadLock = false;
    this.lockHint.classList.remove("hidden");
    this.drawing = false;
    this.primaryDown = false;
    this.forward = 0;
    this.strafe = 0;
    this.run = false;
    this.keys.clear();
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock?.();
    }
  }

  bind() {
    const canvas = this.canvas;

    // O aviso "clique para mirar" cobre a tela inteira enquanto a mira não
    // está engatada — é nele que o clique cai, não no canvas por baixo.
    this.lockHint.addEventListener("click", () => this.engage());
    canvas.addEventListener("click", () => this.engage());

    document.addEventListener("pointerlockchange", () => {
      const isLocked = document.pointerLockElement === canvas;
      this.locked = isLocked;
      if (isLocked) {
        this.hadLock = true;
      } else if (this.hadLock && !this.menuOpen) {
        /* Tínhamos o Pointer Lock de verdade e o perdemos (Esc nativo do
           navegador): volta para a tela inicial, como um jogo de verdade.

           MENOS quando o menu de comandos está aberto: ali o lock foi solto de
           propósito, por `setMenuOpen`, e tratar isso como desistência cobriria
           o menu com o aviso de "clique para mirar". */
        this.disengage();
      }
      // Se nunca tivemos lock, este evento não deveria disparar para nós; se
      // disparar mesmo assim (alguns navegadores no caminho de falha), o jogo
      // simplesmente continua no modo livre.
    });

    document.addEventListener("pointerlockerror", () => {
      // Pointer Lock indisponível (comum em iframes e painéis de preview).
      // Não é um erro fatal: `active` já está true e a mira livre por
      // movementX/Y continua funcionando normalmente.
    });

    document.addEventListener("mousemove", (e) => {
      if (!this.active || this.menuOpen) return;
      const s = CONFIG.player.mouseSensitivity;
      // movementX/Y são preenchidos pelo navegador em QUALQUER mousemove,
      // com ou sem Pointer Lock — só a captura/ocultação do cursor depende
      // da permissão, não o delta de movimento.
      this.yaw -= (e.movementX || 0) * s;
      this.pitch = clamp(
        this.pitch - (e.movementY || 0) * s,
        CONFIG.player.pitchMin,
        CONFIG.player.pitchMax,
      );
      // O mouse também carrega o estado do Shift: se o keyup se perdeu, o
      // primeiro movimento do mouse já desfaz a corrida presa.
      if (e.shiftKey !== this.run) this.updateMovement(e);
    });

    document.addEventListener("mousedown", (e) => {
      if (!this.active || this.menuOpen) return;
      if (e.button === 2) {
        // Mira em primeira pessoa também fica bloqueada durante reload /
        // câmera da flecha / morte — o `blockDraw` cobre os três.
        if (this.blockDraw) return;
        this.firstPerson = true;
        return;
      }
      if (e.button !== 0) return;
      if (this.blockDraw) {
        /* Câmera da flecha: clique traz a visão de volta. Durante o reload — e
           na MIRA DO TRABUCO — o clique é guardado em `primaryDown`: o main
           inicia o draw quando a animação terminar, e o cerco lê a borda de
           subida para soltar a pedra.

           Sem o ramo do trabuco, o `primaryDown = false` abaixo apagava o
           clique ANTES de `updateSiege` poder vê-lo: entrar na mira e apertar o
           botão não fazia nada, porque o único caminho até `dispararMira` era
           uma borda que nunca chegava a existir. */
        if (this.blockDrawReason !== "reload" && this.blockDrawReason !== "trebuchet") {
          // O clique que fecha a câmera não pode virar um novo draw quando o
          // main processar `dismissArrowCam` e liberar o bloqueio no frame.
          this.primaryDown = false;
          this.drawing = false;
          this.actions.dismissArrowCam = true;
        } else {
          this.primaryDown = true;
        }
        return;
      }
      this.primaryDown = true;
      this.drawing = true;
    });

    document.addEventListener("mouseup", (e) => {
      if (this.menuOpen) return;
      if (e.button === 2) this.firstPerson = false;
      if (e.button !== 0) return;
      this.primaryDown = false;
      if (this.drawing) this.actions.release = true;
      this.drawing = false;
    });

    // Sem menu de contexto: o botão direito segura a primeira pessoa.
    document.addEventListener("contextmenu", (e) => {
      if (this.active) e.preventDefault();
    });

    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;

      // Diálogo aberto: Enter e Esc são dele, e mais nada é processado.
      if (
        this.dialogOpen &&
        (e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Escape")
      ) {
        e.preventDefault();
        this.onDialogKey?.(e.code === "Enter");
        return;
      }

      /* MENU DE COMANDOS ABERTO: o teclado é dele, e só ele.
       *
       * Não é preciosismo de foco — é o propósito do menu. Ele existe para que
       * ninguém precise decorar trinta atalhos, e deixar as trinta teclas vivas
       * por baixo dele significaria que um toque distraído troca o modo de jogo
       * enquanto a pessoa procura o botão. Ficam de pé duas saídas: `Esc`, que
       * é o que todo mundo tenta primeiro, e a própria crase. */
      if (this.menuOpen) {
        if (e.code === "Escape" || e.code === "Backquote" || e.code === "IntlBackslash") {
          e.preventDefault();
          this.actions.toggleCommandMenu = true;
        }
        return;
      }

      this.keys.add(e.code);

      /* Andar durante a câmera da flecha traz a visão de volta, exatamente como
         o clique já fazia. A pessoa que aperta W querendo se mexer está pedindo
         para voltar ao corpo — obrigá-la a clicar antes é um passo a mais para
         dizer a mesma coisa. Vai ANTES do switch porque W/A/S/D também precisam
         continuar valendo como movimento no mesmo evento. */
      if (this.blockDraw && MOVE_KEYS.has(e.code)) {
        this.actions.dismissArrowCam = true;
      }

      switch (e.code) {
        case "Escape":
          // Sempre processado por nós também: no modo livre não existe Esc
          // nativo para sair, então sem isso o jogador ficaria preso.
          if (this.active) this.disengage();
          break;
        case "Tab":
          /* Engolido, e só. O placar mudou para o zero (ver `scoreboard`), mas
             o Tab continua sendo interceptado: solto, ele move o foco para os
             controles do navegador no meio da partida. */
          e.preventDefault();
          break;
        case "Digit0":
        case "Numpad0":
          this.scoreboard = true;
          break;
        case "KeyK":
          this.actions.askRespawn = true;
          break;
        case "KeyE":
          this.actions.knifeAttack = true;
          break;
        case "KeyQ":
          /* Q de especial. Das letras livres (Q, X, Z, I, J, U) é a única com
             convenção a favor.

             SHIFT+Q ENCHE A BARRA — atalho de TESTE, e ele entra aqui em vez de
             numa letra própria pela convenção que o Shift+G, o Shift+9, o
             Shift+B e o Shift+J já seguem: a tecla nomeia o ASSUNTO e o Shift
             escolhe a variante. Verificar uma linha do feixe custava dez abates;
             agora custa dois toques, e não há nenhum número de balanceamento
             baixado "só para testar" que possa ser esquecido ligado. */
          if (e.shiftKey) this.actions.fillSpecial = true;
          else this.actions.special = true;
          break;
        case "KeyY":
          this.actions.askResetScores = true;
          break;
        case "Digit1":
          this.actions.setMode = "free";
          break;
        case "Digit2":
          this.actions.setMode = "duel";
          break;
        case "Digit3":
          this.actions.setMode = "boarHunt";
          break;
        case "Digit4":
          this.actions.setMode = "series";
          break;
        case "Digit5":
          this.actions.setMode = "elkHunt";
          break;
        case "Digit6":
          this.actions.setMode = "zombie";
          break;
        case "Digit7":
          this.actions.setMode = "zombieBoss";
          break;
        case "Digit8":
          this.actions.setMode = "birdHunt";
          break;
        case "Digit9":
          /* A Lua não é um modo: é uma FASE, e ela leva a sala inteira junto.
             Ver `levels/` e `docs/plano-lua.md`.

             Com Shift, a MESMA tecla pede o modo que só existe lá — e a leitura
             sai sozinha: 9 é a Lua, Shift+9 é a Lua chovendo. Não sobrou dígito
             para ele (1–8 são modos, 9 é a fase, 0 é o placar), e Shift como
             "o segundo sentido da mesma tecla" já é o padrão do B e do N. */
          if (e.shiftKey) this.actions.setMode = "meteorRain";
          else this.actions.setLevel = "moon";
          break;
        case "KeyB":
          // B de bot. Shift+B tira o último — a mesma tecla nos dois sentidos,
          // como o 9 faz com a fase.
          this.actions.toggleBot = e.shiftKey ? "remove" : "add";
          break;
        case "KeyG":
          /* G de grupo: humanos contra a máquina. Não cabe em dígito — 1–8 já
             são dos outros modos e o 9 é da fase.

             Shift+G é o MESMO grupo disputando a bandeira, e é a mesma
             convenção do Shift+9 (a Lua, chovendo) e do Shift+B (o bot, ao
             contrário): a tecla nomeia o assunto e o Shift escolhe a variante.
             A primeira versão usava H, que já era a AJUDA — e como o `case`
             novo vinha antes no mesmo `switch`, ele engolia a tecla em
             silêncio: apertar H deixava de abrir o painel de atalhos. */
          this.actions.setMode = e.shiftKey ? "captureFlag" : "teamDuel";
          break;
        case "KeyJ":
          /* ATALHO DE TESTE do cerco: J adianta para o escalão seguinte,
             Shift+J vai direto ao dos escaladores — que entram aos 105 s e são
             a coisa mais cara de esperar a cada verificação. Fora do cerco a
             tecla não faz nada; quem sabe disso é `main.js`. */
          this.actions.siegeSkip = e.shiftKey ? "climber" : "next";
          break;
        case "KeyN":
          // N de nível. Shift+N volta — a mesma tecla nos dois sentidos, como o
          // B faz com os bots e o 9 com a fase.
          this.actions.cycleBotDifficulty = e.shiftKey ? -1 : 1;
          break;
        case "KeyU":
          // U de ÚLTIMO em pé. Os dígitos acabaram (1–8 são modos, 9 é a fase,
          // 0 é o placar), então ele entra por letra — como o G do duelo de
          // times já entrava. U estava livre e tem o mnemônico a favor.
          this.actions.setMode = "lastStand";
          break;
        case "KeyC":
          /* C É A CÂMERA DA FLECHA, e mais nada.
           *
           * Ela segurava a primeira pessoa — que é exatamente o que o BOTÃO
           * DIREITO já faz, e faz melhor: a mão que segura o botão direito é a
           * mesma que mira. Duas teclas para o mesmo efeito não é redundância
           * útil, é uma tecla desperdiçada num teclado em que as letras
           * acabaram (ver os comentários do G e do U).
           *
           * A câmera da flecha estava no F, que no CERCO já tinha dono: lá o F
           * é a mão — trabuco, manivela e reparo. Com o F ocupado, o único modo
           * em que a câmera da flecha não tinha tecla era justamente o mais
           * novo. No C ela vale em todos, sem exceção escrita em lugar nenhum. */
          this.actions.toggleArrowCam = true;
          break;
        case "Enter":
        case "NumpadEnter":
          // Sem diálogo aberto (esse caso já retornou lá em cima): Enter é de
          // quem quiser fechar uma tela sozinha, como a de vitória da caçada.
          this.actions.confirmOverlay = true;
          break;
        case "KeyR":
          this.actions.clearArrows = true;
          break;
        case "KeyT":
          this.actions.toggleTrace = true;
          break;
        case "KeyV":
          this.actions.toggleWindInfluence = true;
          break;
        case "Space":
          e.preventDefault();
          this.actions.jump = true;
          break;
        case "KeyP":
          this.actions.spawnBoar = true;
          break;
        case "KeyL":
          this.actions.spawnElk = true;
          break;
        case "KeyO":
          this.actions.spawnElkWolves = true;
          break;
        case "KeyM":
          this.actions.toggleMusic = true;
          break;
        case "F1":
          // Sem isto o navegador abre a ajuda DELE por cima do jogo.
          e.preventDefault();
          this.actions.toggleHelp = true;
          break;
        case "KeyH":
          this.actions.toggleHelp = true;
          break;
        case "Backquote":
        case "IntlBackslash":
          this.crase();
          break;
      }
      this.updateMovement(e);
    });

    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      if (e.code === "Digit0" || e.code === "Numpad0") this.scoreboard = false;
      if (e.code === "Space") this.actions.jumpReleased = true;
      this.updateMovement(e);
    });

    window.addEventListener("blur", () => {
      this.keys.clear();
      this.primaryDown = false;
      this.drawing = false;
      /* Perder o foco com o espaço apertado é o caminho para um jetpack que
         queima sozinho numa aba em segundo plano. O `blur` solta a tecla. */
      this.actions.jumpReleased = true;
      // O keyup do zero se perde junto com o foco; sem isto o placar ficaria
      // aberto para sempre ao voltar para a aba.
      this.scoreboard = false;
      this.updateMovement();
    });
  }

  /**
   * Recalcula o vetor de movimento e o estado da corrida.
   *
   * Para o Shift a fonte da verdade é o EVENTO, não o conjunto de teclas: um
   * keyup de modificador se perde com facilidade (a janela perde o foco, o
   * sistema operacional captura a combinação, o Pointer Lock cai), e sem isso
   * o personagem ficaria correndo para sempre. Todo evento de teclado e de
   * mouse carrega `shiftKey` com o estado real do teclado — basta ler dali.
   */
  updateMovement(event) {
    const k = this.keys;
    this.forward = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
    this.strafe = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
    this.run = event
      ? event.shiftKey === true
      : k.has("ShiftLeft") || k.has("ShiftRight");
  }

  /** Devolve e zera os eventos pontuais. */
  consume() {
    const a = this.actions;
    const snapshot = { ...a };
    a.release = false;
    a.knifeAttack = false;
    /* TODA AÇÃO DE UM TOQUE PRECISA SER ZERADA AQUI.
     *
     * Esta lista é escrita à mão, e esquecer uma linha não quebra nada na hora:
     * a ação simplesmente fica `true` para sempre e passa a disparar em todo
     * quadro. Foi o que aconteceu com o especial — o `Q` apertado uma vez com a
     * barra vazia ficava pendurado, e no instante em que ela enchia o golpe
     * saía sozinho, sem ninguém tocar em nada. */
    a.special = false;
    a.fillSpecial = false;
    a.dismissArrowCam = false;
    a.cycleTarget = false;
    a.clearArrows = false;
    a.toggleDebug = false;
    a.toggleHelp = false;
    a.toggleTrace = false;
    a.toggleWindInfluence = false;
    a.toggleArrowCam = false;
    a.confirmOverlay = false;
    a.jump = false;
    a.spawnBoar = false;
    a.spawnElk = false;
    a.spawnElkWolves = false;
    a.toggleMusic = false;
    a.askRespawn = false;
    a.askResetScores = false;
    a.setLevel = null;
    a.toggleBot = null;
    a.cycleBotDifficulty = 0;
    a.siegeSkip = null;
    a.toggleCommandMenu = false;
    a.doMenu = false;
    a.jumpReleased = false;
    a.setMode = null;
    a.setMeteorRain = null;
    a.setSiege = null;
    return snapshot;
  }
}
