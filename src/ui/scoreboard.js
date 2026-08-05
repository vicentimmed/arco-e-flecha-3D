/* ---------------------------------------------------------------------------
   O placar (0) e o kill feed.

   Uma tabela só para os dois modos. Sem isto o duelo e a caçada não têm como
   ser lidos: matar alguém ou abater um porco vira um número que ninguém vê.

   As colunas do modo em curso ficam destacadas em vez de as outras sumirem —
   trocar de modo não deveria mudar a forma da tabela debaixo dos olhos de quem
   está lendo. E a caçada tem DUAS colunas de propósito: quantos porcos você
   abateu e quantos pontos valeram, porque um porco a 90 m não é o mesmo feito
   que um a 12 m.

   Nada aqui usa `innerHTML` com dado de jogador: nomes vêm da rede e entram
   sempre por `textContent`.
   --------------------------------------------------------------------------- */

const COLUNAS = [
  { chave: "kills", titulo: "Abates", modo: "duel" },
  { chave: "deaths", titulo: "Mortes", modo: "duel" },
  { chave: "boars", titulo: "Porcos", modo: "boarHunt" },
  { chave: "elks", titulo: "Alces", modo: "elkHunt" },
  // Os pássaros não têm modo: eles voam em todas as partidas, e a coluna nunca
  // se destaca por isso mesmo — ela é um extra, não um objetivo.
  { chave: "birds", titulo: "Aves", modo: null },
  { chave: "targets", titulo: "Alvos", modo: "series" },
  // Pontos servem a TODOS os modos de pontaria: porco longe, alvo longe, alce.
  { chave: "points", titulo: "Pontos", modo: ["boarHunt", "series", "elkHunt"] },
  { chave: "ping", titulo: "Ping", modo: null },
];

/** Uma coluna pode servir a mais de um modo (Pontos vale na caçada e na série). */
function ehDoModo(coluna, modo) {
  return Array.isArray(coluna.modo) ? coluna.modo.includes(modo) : coluna.modo === modo;
}

export class Scoreboard {
  constructor(root) {
    this.el = document.createElement("div");
    this.el.id = "scoreboard";
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="sb-card">
        <div class="sb-head">
          <span class="sb-modo"></span>
          <span class="sb-contagem"></span>
        </div>
        <table><thead></thead><tbody></tbody></table>
      </div>
    `;
    root.appendChild(this.el);
    this.thead = this.el.querySelector("thead");
    this.tbody = this.el.querySelector("tbody");
    this.modoEl = this.el.querySelector(".sb-modo");
    this.contagemEl = this.el.querySelector(".sb-contagem");

    this.scores = [];
    this.mode = "free";
    this.selfId = null;
    this.buildHead();
  }

  buildHead() {
    const tr = document.createElement("tr");
    for (const titulo of ["", "Jogador", ...COLUNAS.map((c) => c.titulo)]) {
      const th = document.createElement("th");
      th.textContent = titulo;
      tr.appendChild(th);
    }
    this.thead.replaceChildren(tr);
  }

  setScores(scores) {
    this.scores = scores ?? [];
    if (this.open) this.render();
  }

  setMode(mode) {
    this.mode = mode;
    if (this.open) this.render();
  }

  get open() {
    return !this.el.hidden;
  }

  show(selfId) {
    this.selfId = selfId;
    this.el.hidden = false;
    this.render();
  }

  hide() {
    this.el.hidden = true;
  }

  render() {
    const nomeDoModo =
      {
        duel: "Duelo",
        boarHunt: "Caçada aos porcos",
        series: "Alvos em série",
        elkHunt: "Caçada ao alce",
      }[this.mode] ?? "Livre";
    this.modoEl.textContent = nomeDoModo;
    this.contagemEl.textContent = `${this.scores.length} na sala`;

    // Ordena pela coluna que interessa AO MODO — no duelo, quem mais matou; na
    // caçada, quem fez mais pontos; no livre, quem chegou primeiro.
    const chave = {
      duel: "kills",
      boarHunt: "points",
      series: "points",
      elkHunt: "points",
    }[this.mode];
    const linhas = [...this.scores];
    if (chave) linhas.sort((a, b) => (b[chave] ?? 0) - (a[chave] ?? 0));

    this.tbody.replaceChildren(
      ...linhas.map((p) => this.linha(p)),
    );

    for (const th of this.thead.querySelectorAll("th")) th.classList.remove("ativa");
    COLUNAS.forEach((c, i) => {
      if (!ehDoModo(c, this.mode)) return;
      this.thead.querySelectorAll("th")[i + 2]?.classList.add("ativa");
    });
  }

  linha(p) {
    const tr = document.createElement("tr");
    if (p.id === this.selfId) tr.className = "eu";

    const tdCor = document.createElement("td");
    const ponto = document.createElement("i");
    ponto.className = "sb-cor";
    ponto.style.background = `#${(p.color ?? 0xffffff).toString(16).padStart(6, "0")}`;
    tdCor.appendChild(ponto);
    tr.appendChild(tdCor);

    const tdNome = document.createElement("td");
    tdNome.className = "sb-nome";
    tdNome.textContent = p.name ?? "—"; // nunca innerHTML: o nome vem da rede
    tr.appendChild(tdNome);

    for (const c of COLUNAS) {
      const td = document.createElement("td");
      td.textContent = String(p[c.chave] ?? 0);
      if (ehDoModo(c, this.mode)) td.className = "ativa";
      tr.appendChild(td);
    }
    return tr;
  }
}

/* ------------------------------------------------------------- kill feed --- */

export class KillFeed {
  constructor(root, limite = 5) {
    this.el = document.createElement("div");
    this.el.id = "killfeed";
    root.appendChild(this.el);
    this.limite = limite;
  }

  /** @param {Array<{text: string, color?: number, forte?: boolean}>} trechos */
  push(trechos) {
    const linha = document.createElement("div");
    linha.className = "kf-linha";
    for (const t of trechos) {
      const span = document.createElement("span");
      span.textContent = t.text;
      if (t.color != null) {
        span.style.color = `#${t.color.toString(16).padStart(6, "0")}`;
      }
      if (t.forte) span.className = "forte";
      linha.appendChild(span);
    }
    this.el.appendChild(linha);
    while (this.el.childElementCount > this.limite) {
      this.el.firstElementChild.remove();
    }
    setTimeout(() => linha.remove(), 6000);
  }

  clear() {
    this.el.replaceChildren();
  }
}
