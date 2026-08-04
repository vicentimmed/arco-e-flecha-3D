/* ---------------------------------------------------------------------------
   Diálogo de confirmação.

   Existe porque duas teclas do jogo fazem coisas que não dá para desfazer:
   renascer em outro lugar (K) e zerar o placar de todos (Y). Uma tecla dessas
   apertada sem querer, no meio de um duelo, estraga a partida de todo mundo.

   Enquanto ele está aberto, o `Esc` fecha o DIÁLOGO em vez de soltar o mouse —
   senão o reflexo natural de cancelar tiraria o jogador da mira junto.
   --------------------------------------------------------------------------- */

export class ConfirmDialog {
  constructor(root) {
    this.el = document.createElement("div");
    this.el.id = "confirm";
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="confirm-card">
        <div class="confirm-title"></div>
        <div class="confirm-hint">
          <kbd>Enter</kbd> confirma · <kbd>Esc</kbd> cancela
        </div>
      </div>
    `;
    root.appendChild(this.el);
    this.title = this.el.querySelector(".confirm-title");
    this.onResolve = null;
  }

  get open() {
    return !this.el.hidden;
  }

  /** @param {string} pergunta texto puro — vai por `textContent` */
  ask(pergunta, onResolve) {
    this.title.textContent = pergunta;
    this.el.hidden = false;
    this.onResolve = onResolve;
  }

  confirm() {
    if (!this.open) return false;
    const fn = this.onResolve;
    this.close();
    fn?.(true);
    return true;
  }

  cancel() {
    if (!this.open) return false;
    const fn = this.onResolve;
    this.close();
    fn?.(false);
    return true;
  }

  close() {
    this.el.hidden = true;
    this.onResolve = null;
  }
}
