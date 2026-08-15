/* ---------------------------------------------------------------------------
   A PORTA DE ENTRADA de Namekusei — a tela escura que pede o clique.

   ------------------------------------------------------------ por que existe

   Sem ela, entrar no modo era cair no meio de uma luta com o ponteiro solto: o
   mouse pairando sobre a tela, o cursor do sistema por cima do céu, a mira
   parada até alguém adivinhar que precisava clicar em algum lugar. Não há nada
   na tela que ensine isso — o Pointer Lock só nasce de um GESTO do usuário, e um
   gesto que ninguém pediu é um gesto que ninguém dá.

   O pedido do usuário foi literal: *"quando o jogo inicia, deve ficar como se
   fosse o dork flash. Aparece uma mensagem pedindo pra clicar na tela. Aí, uma
   vez que a tela é clicada, a mira já começa a ficar ativa"*. É a abertura de
   jogo de Flash, e ela resolve o problema por ser a única coisa clicável na
   tela: o clique que a fecha é exatamente o gesto de que o navegador precisa.

   ------------------------------------------------------------ o que ela NÃO é

   **Não é uma pausa.** O mundo continua sendo desenhado por baixo — é isso que
   dá a sensação de abertura em vez de tela de erro, e é por isso que o fundo é
   meio-opaco e não chapado. Quem manda no jogo é o laço; esta porta só cobre.

   **Não é dona da regra.** Quando ela abre e quando ela fecha é assunto de
   `input.js`, que é quem sabe se o ponteiro está travado, se o menu está aberto
   e se este navegador sequer permite travar. Aqui só há marcação, estilo e o
   aviso de que houve um gesto.

   ---------------------------------------------------------------- os controles

   A linha de dicas é DERIVADA da tabela `CONTROLES` do HUD, e não escrita à mão.
   O rodapé de `input.js` já explica o motivo com todas as letras: duas tabelas
   das mesmas doze teclas são duas tabelas que envelhecem em metades. Daqui sai
   só o PRIMEIRO item de cada grupo — o que abre o grupo, e o que serve de
   primeira frase para quem nunca viu o modo.
   --------------------------------------------------------------------------- */

import { aplicarEstiloNamek } from "./style.js";
import { CONTROLES } from "./hud.js";

export class NamekPorta {
  /**
   * @param {HTMLElement} root a camada de interface (`#ui`) — a mesma do HUD.
   * @param {() => void} aoGesto avisa que o jogador clicou ou apertou a tecla.
   *   A porta NÃO se fecha sozinha por causa disso: quem fecha é quem consegue
   *   (ou não) a trava do ponteiro. Ver `input.js`.
   */
  constructor(root, aoGesto = () => {}) {
    /* A porta se veste com a folha do HUD, e não com uma sua. A paleta, a fonte
       e o contorno preto são os mesmos — ver o seletor duplo no topo de
       `style.js`, que existe justamente para isto. Refcontado: a folha só sai
       do documento quando o último dono a solta. */
    this._soltarEstilo = aplicarEstiloNamek();
    this._aoGesto = aoGesto;

    /** Ela está na tela? Campo público porque `input.js` decide a partir dele. */
    this.aberta = false;

    this.el = document.createElement("div");
    this.el.className = "nk-porta";
    this.el.hidden = true;
    /* Ela é um botão do tamanho da tela, e é honesto dizer isso a quem lê a
       página por leitor de tela em vez de por pixels. */
    this.el.setAttribute("role", "button");

    /* Esqueleto FIXO, escrito à mão: nem um dado de rede, nem uma interpolação.
       Mesma regra do HUD e do menu. O texto variável (a chamada e o rodapé)
       desce por `textContent` em `abrir` e `esperar`. */
    this.el.innerHTML = `
      <div class="nk-porta-miolo">
        <div class="nk-porta-selo">Namekusei</div>
        <div class="nk-porta-chamada nk-contorno"></div>
        <div class="nk-porta-dicas"></div>
        <div class="nk-porta-rodape"></div>
      </div>`;

    this.chamadaEl = this.el.querySelector(".nk-porta-chamada");
    this.rodapeEl = this.el.querySelector(".nk-porta-rodape");
    this._montarDicas(this.el.querySelector(".nk-porta-dicas"));

    /* `click` e não `pointerdown`: um arrasto que começa aqui e termina fora não
       é um pedido de jogar, e o `mousedown` da porta é justamente o que
       `input.js` ignora para que o clique de entrada não vire um tiro de ki. */
    this._clique = () => this._aoGesto();
    this.el.addEventListener("click", this._clique);

    root.appendChild(this.el);
  }

  /**
   * Põe a porta na tela.
   *
   * @param {boolean} voltando o jogador já esteve jogando nesta sessão. Muda uma
   *   palavra, e ela responde a única pergunta que essa tela levanta quando
   *   reaparece no meio da partida: *por que isto voltou?* — porque o ponteiro
   *   saiu, e clicar o traz de volta.
   */
  abrir(voltando = false) {
    this.chamadaEl.textContent = voltando ? "Clique para voltar" : "Clique para jogar";
    this.rodapeEl.textContent = "ou aperte Enter";
    this.el.classList.remove("nk-porta--esperando");
    if (this.aberta) return;
    this.aberta = true;
    this.el.hidden = false;
  }

  /**
   * O gesto saiu e a trava ainda não veio.
   *
   * Alguns navegadores recusam `requestPointerLock` logo depois de uma saída
   * recente ("too soon"), e nesse caso a porta CONTINUA na tela — sumir aqui
   * deixaria o jogador sem mira e sem nada para clicar. Trocar a linha de baixo
   * é o que impede que essa espera pareça um clique que não funcionou.
   */
  esperar() {
    if (!this.aberta) return;
    this.el.classList.add("nk-porta--esperando");
    this.rodapeEl.textContent = "engatando a mira…";
  }

  fechar() {
    if (!this.aberta) return;
    this.aberta = false;
    this.el.hidden = true;
    this.el.classList.remove("nk-porta--esperando");
  }

  /**
   * A porta é MESMO a coisa na frente da tela?
   *
   * Ela nasce junto com o resto do modo, e nessa hora a tela de entrada
   * (`#lobby`, z-index 20) ainda está por cima — opaca, e com o campo do nome
   * esperando um Enter que é DELE. O clique já se resolve sozinho (quem está por
   * cima é quem recebe), mas o teclado deste modo é ouvido na janela inteira, e
   * sem esta pergunta um Enter digitado no lobby capturaria o ponteiro por trás
   * dele.
   *
   * Perguntar ao documento quem está no centro da tela responde isso sem esta
   * classe precisar conhecer o lobby, o HUD ou qualquer painel futuro: se há
   * outra coisa clicável na frente, a tecla é da outra coisa.
   */
  naFrente() {
    if (!this.aberta || typeof document.elementFromPoint !== "function") return this.aberta;
    const alvo = document.elementFromPoint(
      Math.round(window.innerWidth / 2),
      Math.round(window.innerHeight / 2),
    );
    return !!alvo && (alvo === this.el || this.el.contains(alvo));
  }

  dispose() {
    this.el.removeEventListener("click", this._clique);
    this.el.remove();
    this._soltarEstilo();
  }

  /* ------------------------------------------------------------- interno -- */

  /** Uma linha por grupo de `CONTROLES`, só o primeiro item de cada. */
  _montarDicas(caixa) {
    for (const grupo of CONTROLES) {
      const item = grupo.itens?.[0];
      if (!item) continue;
      const [teclas, acao] = item;

      const linha = document.createElement("span");
      linha.className = "nk-porta-dica";
      for (const t of teclas) {
        const kbd = document.createElement("kbd");
        kbd.textContent = t;
        linha.appendChild(kbd);
      }
      const desc = document.createElement("span");
      desc.className = "nk-porta-dica-acao";
      desc.textContent = acao;
      linha.appendChild(desc);

      caixa.appendChild(linha);
    }
  }
}
