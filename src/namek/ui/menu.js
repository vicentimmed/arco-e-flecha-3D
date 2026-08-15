/* ---------------------------------------------------------------------------
   O menu geral (Esc).

   ------------------------------------------------------- por que ele EXISTE

   O pedido sobre teclado foi taxativo: *"nesse modo todos os outros atalhos que
   o jogo já tem devem ser ignorados; deixe somente o atalho que aparece o menu
   geral do game"*. `systems/input.js` do arqueiro tem quinze atalhos — 1 a 9
   trocam modo e fase, R limpa flechas, T liga traçados, K renasce, L solta um
   alce, O adianta a horda, crase abre o painel. Nenhum deles vale aqui.

   Só que duas coisas deste modo PRECISAM ser alcançáveis, e no arqueiro elas
   seriam teclas: **pôr um bot** e **virar o clima**. Sem elas, quem entra sozinho
   fica sozinho para sempre — 1 500 linhas de IA e a tempestade inteira ficam
   escritas e inalcançáveis, que foi exatamente o estado em que este arquivo as
   encontrou.

   O menu é a resposta que respeita as duas coisas ao mesmo tempo: nenhum atalho
   novo, e nada inalcançável. É a única superfície de comando do modo.

   ----------------------------------------------------------------- o ponteiro

   Um menu de botões sem cursor é um menu impossível, então abrir o menu SOLTA o
   ponteiro — e é por isso que `NamekInput.setMenuOpen` existe: sem avisar o
   input, soltar o lock seria lido como "o jogador pediu o menu" e o menu se
   reabriria sozinho para sempre. Enquanto ele está aberto o teclado do jogo
   inteiro é ignorado, ou o lutador ficaria voando por trás da tela.
   --------------------------------------------------------------------------- */

import { NAMEK } from "../../shared/namek/config.js";

const CSS = `
.nk-menu {
  position: absolute; inset: 0; z-index: 40;
  display: flex; align-items: flex-end; justify-content: center;
  padding-bottom: 4vh;
  background: rgba(4, 12, 10, 0.62);
  backdrop-filter: blur(3px);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  pointer-events: auto;
}
/* O cartão fica na METADE DE BAIXO por causa do vizinho: a ficha de teclas
   (.nk-ajuda) se abre junto no mesmo Esc e mora no topo — ver style.js.
   Centralizado, os dois disputariam o mesmo miolo da tela. */
.nk-menu[hidden] { display: none !important; }
.nk-menu-card {
  width: min(420px, 92vw);
  padding: 22px 24px 20px;
  border-radius: 14px;
  border: 1px solid rgba(126, 224, 160, 0.28);
  background: linear-gradient(180deg, rgba(14, 30, 26, 0.97), rgba(9, 20, 18, 0.97));
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
  color: #e7f3ec;
}
.nk-menu-card h2 {
  margin: 0 0 2px; font-size: 19px; letter-spacing: 0.5px;
  color: #ffb257;
}
.nk-menu-sub {
  margin: 0 0 16px; font-size: 12px; color: rgba(231, 243, 236, 0.55);
}
.nk-menu-grupo { margin-bottom: 14px; }
.nk-menu-rot {
  display: block; margin-bottom: 6px;
  font-size: 10.5px; letter-spacing: 1.4px; text-transform: uppercase;
  color: rgba(231, 243, 236, 0.45);
}
.nk-menu-linha { display: flex; gap: 8px; }
.nk-menu button {
  flex: 1; padding: 9px 10px;
  border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.05);
  color: #e7f3ec; font-size: 13px; font-family: inherit;
  cursor: pointer; transition: background 0.12s, border-color 0.12s;
}
.nk-menu button:hover { background: rgba(255, 255, 255, 0.11); }
.nk-menu button:active { transform: translateY(1px); }
.nk-menu button.nk-on {
  border-color: rgba(126, 224, 160, 0.7);
  background: rgba(126, 224, 160, 0.16);
  color: #b6f3cd;
}
.nk-menu-conta {
  font-size: 12px; color: rgba(231, 243, 236, 0.6); text-align: center;
  margin-top: 7px;
}
.nk-menu-sair {
  width: 100%; margin-top: 6px;
  border-color: rgba(224, 110, 90, 0.4) !important;
  color: #ffb3a2 !important;
}
.nk-menu-rodape {
  margin-top: 14px; padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 11.5px; color: rgba(231, 243, 236, 0.42); text-align: center;
}
`;

let folha = null;

function aplicarEstilo() {
  if (folha) return;
  folha = document.createElement("style");
  folha.dataset.nk = "menu";
  folha.textContent = CSS;
  document.head.appendChild(folha);
}

export class NamekMenu {
  /**
   * @param {HTMLElement} root o container do HUD (`#ui`)
   * @param {object} acoes o que os botões fazem — o menu não conhece o jogo:
   *   `{ addBot, removeBot, setWeather, sair }`
   */
  constructor(root, acoes = {}) {
    aplicarEstilo();
    this.acoes = acoes;
    this.aberto = false;

    this.el = document.createElement("div");
    this.el.className = "nk-menu";
    this.el.hidden = true;
    /* Esqueleto FIXO, escrito à mão. Nenhum dado de rede entra por aqui — o
       único texto variável é a contagem de lutadores, e ela desce por
       `textContent` em `setRoster`. É a mesma regra do HUD. */
    this.el.innerHTML = `
      <div class="nk-menu-card">
        <h2>Namekusei</h2>
        <p class="nk-menu-sub">mata-mata · até ${NAMEK.net.maxPlayers} lutadores</p>

        <div class="nk-menu-grupo">
          <span class="nk-menu-rot">Adversários de CPU</span>
          <div class="nk-menu-linha">
            <button type="button" data-nk="bot-menos">− tirar bot</button>
            <button type="button" data-nk="bot-mais">+ pôr bot</button>
          </div>
          <div class="nk-menu-conta" data-nk="conta"></div>
        </div>

        <div class="nk-menu-grupo">
          <span class="nk-menu-rot">Clima do planeta</span>
          <div class="nk-menu-linha">
            <button type="button" data-nk="clima-dia">Dia</button>
            <button type="button" data-nk="clima-tempestade">Tempestade</button>
          </div>
        </div>

        <button type="button" class="nk-menu-sair" data-nk="sair">sair da arena</button>

        <div class="nk-menu-rodape">Esc fecha · o clima vale para a sala inteira</div>
      </div>
    `;
    root.appendChild(this.el);

    this.conta = this.el.querySelector('[data-nk="conta"]');
    this.botoesClima = {
      dia: this.el.querySelector('[data-nk="clima-dia"]'),
      tempestade: this.el.querySelector('[data-nk="clima-tempestade"]'),
    };

    this._cliques = [
      ["bot-mais", () => this.acoes.addBot?.()],
      ["bot-menos", () => this.acoes.removeBot?.()],
      ["clima-dia", () => this.acoes.setWeather?.("dia")],
      ["clima-tempestade", () => this.acoes.setWeather?.("tempestade")],
      ["sair", () => this.acoes.sair?.()],
    ];
    for (const [nome, fn] of this._cliques) {
      this.el.querySelector(`[data-nk="${nome}"]`).addEventListener("click", fn);
    }

    /* O clique no FUNDO fecha. É o gesto que todo mundo tenta, e sem ele o menu
       só sai pelo Esc — que é a tecla que o jogador acabou de usar para chegar
       aqui e que ele não necessariamente associa a "fechar". */
    this._fundo = (e) => {
      if (e.target === this.el) this.toggle(false);
    };
    this.el.addEventListener("click", this._fundo);
  }

  /** @param {boolean} [forcar] omitido alterna */
  toggle(forcar) {
    const novo = forcar === undefined ? !this.aberto : forcar;
    if (novo === this.aberto) return this.aberto;
    this.aberto = novo;
    this.el.hidden = !novo;
    return this.aberto;
  }

  /** Quantos estão em campo, para o botão de bot dizer alguma coisa. */
  setRoster(total, bots) {
    const cheio = total >= NAMEK.net.maxPlayers;
    this.conta.textContent = cheio
      ? `arena cheia — ${total} em campo`
      : `${total} em campo · ${bots} de CPU`;
    this.el.querySelector('[data-nk="bot-mais"]').disabled = cheio;
    this.el.querySelector('[data-nk="bot-menos"]').disabled = bots <= 0;
  }

  /** Qual clima está no ar, para o botão certo ficar aceso. */
  setWeather(id) {
    for (const [nome, botao] of Object.entries(this.botoesClima)) {
      botao.classList.toggle("nk-on", nome === id);
    }
  }

  dispose() {
    this.el.removeEventListener("click", this._fundo);
    this.el.remove();
  }
}
