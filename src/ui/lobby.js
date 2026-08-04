/* ---------------------------------------------------------------------------
   A tela de entrada.

   Também é a tela de carregamento — de propósito. Preparar o terreno, o WASM da
   física e a vegetação leva um par de segundos, e esse tempo cabe inteiro
   dentro do tempo em que a pessoa digita o nome. Quem chega vê um campo para
   preencher em vez de uma barra de progresso, e quando termina de digitar o
   mundo já está pronto: a entrada é imediata.

   O nome fica em `localStorage` porque numa sala de amigos você entra e sai
   várias vezes na mesma tarde, e redigitar toda vez é atrito à toa.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../config.js";
import { sanitizeName } from "../shared/protocol.js";

const STORAGE_KEY = "arco-flecha:nome";

export class Lobby {
  constructor(root) {
    this.root = root;
    this.ready = false;
    this.busy = false;
    /** @type {(nome: string) => Promise<void>} */
    this.onEnter = async () => {};

    root.innerHTML = `
      <div class="lobby-card">
        <div class="lobby-bow">🏹</div>
        <h1>Arco &amp; Flecha</h1>
        <p class="lobby-sub">Campo de tiro online</p>

        <label class="lobby-field">
          <span>Seu nome</span>
          <input id="lobby-name" type="text" autocomplete="off" spellcheck="false"
                 maxlength="${CONFIG.net.nameMaxLength}" placeholder="como os outros vão te ver" />
        </label>

        <button id="lobby-enter" type="button" disabled>Entrar no jogo online</button>
        <div class="lobby-status" id="lobby-status">preparando o campo de tiro…</div>
      </div>
    `;

    this.input = root.querySelector("#lobby-name");
    this.button = root.querySelector("#lobby-enter");
    this.status = root.querySelector("#lobby-status");

    this.input.value = readStoredName();
    this.input.addEventListener("input", () => this.refresh());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.submit();
    });
    this.button.addEventListener("click", () => this.submit());

    // Foco imediato: quem abre o link já pode digitar.
    requestAnimationFrame(() => this.input.focus());
  }

  /** Passo do preparo do mundo — ocupa a mesma linha do status. */
  setStep(text) {
    if (this.ready) return;
    this.status.textContent = text;
    this.status.classList.remove("error");
  }

  /** O mundo está montado; a partir daqui só falta o nome. */
  setReady() {
    this.ready = true;
    this.status.textContent = "";
    this.status.classList.remove("error");
    this.refresh();
  }

  setError(text) {
    this.status.textContent = text;
    this.status.classList.add("error");
    this.busy = false;
    this.refresh();
  }

  refresh() {
    const nome = sanitizeName(this.input.value, CONFIG.net.nameMaxLength);
    this.button.disabled = !this.ready || this.busy || nome.length === 0;
    if (this.ready && !this.busy && !nome.length) {
      this.status.classList.remove("error");
      this.status.textContent = "escreva um nome para entrar";
    }
  }

  async submit() {
    if (this.button.disabled) return;
    const nome = sanitizeName(this.input.value, CONFIG.net.nameMaxLength);
    if (!nome) return;

    this.busy = true;
    this.button.disabled = true;
    this.status.classList.remove("error");
    this.status.textContent = "entrando…";
    storeName(nome);

    try {
      await this.onEnter(nome);
    } catch (err) {
      this.setError(err?.message ?? "não deu para entrar");
    }
  }

  hide() {
    this.root.classList.add("done");
    setTimeout(() => this.root.remove(), 500);
  }
}

function readStoredName() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return ""; // navegação privada com armazenamento bloqueado
  }
}

function storeName(nome) {
  try {
    localStorage.setItem(STORAGE_KEY, nome);
  } catch {
    /* sem armazenamento: só não lembra do nome */
  }
}
