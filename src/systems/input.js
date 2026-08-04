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
    /** Terceira pessoa por padrão; botão direito (ou C) segurado: primeira pessoa. */
    this.firstPerson = false;
    this.drawing = false;

    /** true assim que o jogador engatou a mira (travada OU livre). */
    this.active = false;
    /** true só quando o Pointer Lock de verdade está concedido. */
    this.locked = false;
    /** já tivemos o lock nesta sessão de mira — distingue "perdi o lock via
     *  Esc nativo" (deve voltar ao menu) de "nunca tive lock" (modo livre). */
    this.hadLock = false;

    this.keys = new Set();

    /** Quando true, o clique não tensiona o arco — ele só encerra a câmera da
     *  flecha. Quem decide é o main, olhando o estado da câmera. */
    this.blockDraw = false;

    /** Placar aberto (Tab segurado). */
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
      dismissArrowCam: false, // clique para voltar à visão da arqueira
      cycleTarget: false,
      clearArrows: false,
      toggleDebug: false,
      toggleHelp: false,
      toggleTrace: false,
      toggleWindInfluence: false,
      jump: false,
      spawnBoar: false,
      toggleMusic: false,
      askRespawn: false, // K — renascer noutro lugar
      askResetScores: false, // Y — zerar o placar de todos
      setMode: null, // "free" | "duel" | "boarHunt"
    };

    this.bind();
  }

  /** Engata a mira: some com o aviso e tenta o Pointer Lock em segundo plano. */
  engage() {
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
      } else if (this.hadLock) {
        // Tínhamos o Pointer Lock de verdade e o perdemos (Esc nativo do
        // navegador): volta para a tela inicial, como um jogo de verdade.
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
      if (!this.active) return;
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
      if (!this.active) return;
      if (e.button === 2) {
        this.firstPerson = true;
        return;
      }
      if (e.button !== 0) return;
      if (this.blockDraw) {
        // Estamos vendo a flecha voar: este clique só traz a câmera de volta,
        // sem começar a tensionar o arco (senão soltaria um tiro fraco).
        this.actions.dismissArrowCam = true;
        return;
      }
      this.drawing = true;
    });

    document.addEventListener("mouseup", (e) => {
      if (e.button === 2) this.firstPerson = false;
      if (e.button !== 0) return;
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
      if (this.dialogOpen && (e.code === "Enter" || e.code === "Escape")) {
        e.preventDefault();
        this.onDialogKey?.(e.code === "Enter");
        return;
      }

      this.keys.add(e.code);
      switch (e.code) {
        case "Escape":
          // Sempre processado por nós também: no modo livre não existe Esc
          // nativo para sair, então sem isso o jogador ficaria preso.
          if (this.active) this.disengage();
          break;
        case "Tab":
          // Convenção de FPS. A troca de alvo, que morava aqui, foi para o Q.
          e.preventDefault();
          this.scoreboard = true;
          break;
        case "KeyQ":
          this.actions.cycleTarget = true;
          break;
        case "KeyK":
          this.actions.askRespawn = true;
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
        case "KeyC":
          this.firstPerson = true;
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
          this.actions.toggleDebug = true;
          break;
      }
      this.updateMovement(e);
    });

    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      if (e.code === "KeyC") this.firstPerson = false;
      if (e.code === "Tab") this.scoreboard = false;
      this.updateMovement(e);
    });

    window.addEventListener("blur", () => {
      this.keys.clear();
      this.drawing = false;
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
    a.dismissArrowCam = false;
    a.cycleTarget = false;
    a.clearArrows = false;
    a.toggleDebug = false;
    a.toggleHelp = false;
    a.toggleTrace = false;
    a.toggleWindInfluence = false;
    a.jump = false;
    a.spawnBoar = false;
    a.toggleMusic = false;
    a.askRespawn = false;
    a.askResetScores = false;
    a.setMode = null;
    return snapshot;
  }
}
