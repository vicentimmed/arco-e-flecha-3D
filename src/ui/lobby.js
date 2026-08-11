/* ---------------------------------------------------------------------------
   A tela de entrada.

   Também é a tela de carregamento — de propósito. Preparar o terreno, o WASM da
   física e a vegetação leva um par de segundos, e esse tempo cabe inteiro
   dentro do tempo em que a pessoa digita o nome. Quem chega vê um campo para
   preencher em vez de uma barra de progresso, e quando termina de digitar o
   mundo já está pronto: a entrada é imediata.

   O nome fica em `localStorage` porque numa sala de amigos você entra e sai
   várias vezes na mesma tarde, e redigitar toda vez é atrito à toa.

   ------------------------------------------------------------------- as portas

   São quatro botões, e cada um é um LUGAR — não um ajuste que se muda depois de
   entrar. O servidor mantém uma sala por porta (ver `RoomHost`), então quem
   clica na Lua encontra quem está na Lua, e a noite dos zumbis não cai em cima
   de quem foi treinar tiro ao alvo.

   Continuam existindo as teclas de dentro do jogo (9 troca a fase, 1–8 o modo):
   elas levam a sala INTEIRA junto, que é o combinado entre quem já está lá. A
   tela de entrada é para quem ainda não está.
   --------------------------------------------------------------------------- */

import { CONFIG, applyQuality } from "../config.js";
import { sanitizeName } from "../shared/protocol.js";

const STORAGE_KEY = "arco-flecha:nome";

/**
 * As portas, na ordem em que aparecem.
 *
 * `level` e `mode` viajam no `hello` e escolhem a SALA; o resto é texto. A
 * ordem não é alfabética nem por novidade: é do mais conhecido para o mais
 * específico, porque quem chega pela primeira vez deve cair no vale.
 */
const PORTAS = [
  {
    id: "valley",
    level: "valley",
    mode: "free",
    rotulo: "Jogar online no Vale Verde",
    detalhe: "campo de tiro, caçada e duelo",
    classe: "porta-vale",
  },
  {
    id: "moon",
    level: "moon",
    mode: "free",
    rotulo: "Jogar online na Lua",
    detalhe: "1/6 de g, jetpack, alien e meteorito",
    classe: "porta-lua",
  },
  {
    id: "zombie",
    level: "valley",
    mode: "zombie",
    rotulo: "Modo Zumbi",
    detalhe: "dez hordas, quatro tochas, uma noite",
    classe: "porta-zumbi",
  },
  {
    id: "zombieBoss",
    level: "valley",
    mode: "zombieBoss",
    rotulo: "Modo Zumbi com Chefão",
    detalhe: "só ele, e ele basta",
    classe: "porta-chefao",
  },
];

export class Lobby {
  constructor(root) {
    this.root = root;
    this.ready = false;
    this.busy = false;
    /** @type {(nome: string, entrada: {level: string, mode: string}) => Promise<void>} */
    this.onEnter = async () => {};

    root.innerHTML = `
      <div class="lobby-card">
        <div class="lobby-bow">🏹</div>
        <h1>Arco &amp; Flecha</h1>
        <p class="lobby-sub">Campo de tiro online</p>

        <section class="lobby-quality" aria-labelledby="lobby-quality-title">
          <h2 id="lobby-quality-title">Qualidade gráfica do jogo</h2>
          <p>Esta escolha vale somente para você e fica salva neste navegador.</p>
          <div class="lobby-quality-options" role="radiogroup"
               aria-label="Qualidade gráfica do jogo">
            <button type="button" data-quality="low" role="radio"
                    aria-checked="false">Low</button>
            <button type="button" data-quality="medium" role="radio"
                    aria-checked="false">Medium</button>
            <button type="button" data-quality="high" role="radio"
                    aria-checked="false">High</button>
          </div>
        </section>

        <label class="lobby-field">
          <span>Seu nome</span>
          <input id="lobby-name" type="text" autocomplete="off" spellcheck="false"
                 maxlength="${CONFIG.net.nameMaxLength}" placeholder="como os outros vão te ver" />
        </label>

        <div class="lobby-portas">
          ${PORTAS.map(
            (p) => `
            <button type="button" class="lobby-porta ${p.classe}" data-porta="${p.id}" disabled>
              <span class="lobby-porta-rotulo">${p.rotulo}</span>
              <span class="lobby-porta-detalhe">${p.detalhe}</span>
            </button>`,
          ).join("")}
        </div>
        <div class="lobby-status" id="lobby-status">preparando o campo de tiro…</div>
      </div>
    `;

    this.input = root.querySelector("#lobby-name");
    this.buttons = [...root.querySelectorAll("[data-porta]")];
    this.status = root.querySelector("#lobby-status");
    this.qualityButtons = [...root.querySelectorAll("[data-quality]")];

    this.input.value = readStoredName();
    this.syncQuality();
    this.input.addEventListener("input", () => this.refresh());
    this.input.addEventListener("keydown", (e) => {
      // Enter no campo do nome entra pela porta de sempre, a primeira: é o
      // caminho de quem só quer jogar e já sabe onde.
      if (e.key === "Enter") this.submit(PORTAS[0]);
    });
    for (const botao of this.buttons) {
      const porta = PORTAS.find((p) => p.id === botao.dataset.porta);
      botao.addEventListener("click", () => this.submit(porta));
    }
    for (const qualityButton of this.qualityButtons) {
      qualityButton.addEventListener("click", () => {
        const quality = qualityButton.dataset.quality;
        if (quality === CONFIG.render.quality) return;

        applyQuality(quality);
        this.syncQuality();
        this.status.textContent = "qualidade gráfica salva — recarregando…";
        location.reload();
      });
    }

    // Foco imediato: quem abre o link já pode digitar.
    requestAnimationFrame(() => this.input.focus());
  }

  syncQuality() {
    for (const button of this.qualityButtons) {
      const selected = button.dataset.quality === CONFIG.render.quality;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-checked", String(selected));
    }
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
    const bloqueado = !this.ready || this.busy || nome.length === 0;
    for (const botao of this.buttons) botao.disabled = bloqueado;
    if (!this.ready || this.busy) return;
    this.status.classList.remove("error");
    // O aviso some quando deixa de valer: com quatro botões acesos e um nome
    // escrito, "escreva um nome para entrar" ainda na tela vira ruído — e pior,
    // parece que o nome não foi aceito.
    this.status.textContent = nome.length ? "" : "escreva um nome para entrar";
  }

  /** @param {object} porta uma entrada de `PORTAS` */
  async submit(porta = PORTAS[0]) {
    if (!this.ready || this.busy) return;
    const nome = sanitizeName(this.input.value, CONFIG.net.nameMaxLength);
    if (!nome) return;

    this.busy = true;
    for (const botao of this.buttons) botao.disabled = true;
    this.status.classList.remove("error");
    this.status.textContent = "entrando…";
    storeName(nome);

    try {
      await this.onEnter(nome, { level: porta.level, mode: porta.mode });
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
