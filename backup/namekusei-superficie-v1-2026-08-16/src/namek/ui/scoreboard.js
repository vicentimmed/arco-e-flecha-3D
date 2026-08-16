/* ---------------------------------------------------------------------------
   O placar do mata-mata e o feed de mortes.

   Os dois juntos num arquivo pelo mesmo motivo que `ui/scoreboard.js` faz isso
   do lado do arqueiro: são a mesma pergunta em duas escalas de tempo. O feed
   conta o que ACABOU de acontecer e some em seis segundos; o placar conta o que
   aconteceu até agora e nunca some. Separá-los daria dois arquivos que mudam
   sempre juntos.

   ------------------------------------------------------------------ o placar
   Ele fica na tela o tempo TODO, e isso é a diferença do modo. No arqueiro o
   placar é uma tecla segurada porque as partidas têm fim e ranking; aqui não há
   fim (§1 do plano) — é campo aberto, e "como eu vou" é uma pergunta que se faz
   de relance a cada trinta segundos. Uma tecla para isso seria uma tecla
   apertada duzentas vezes por partida.

   -------------------------------------------------------------------- defesa
   Nome de jogador vem da REDE e entra sempre por `textContent`. Nunca
   `innerHTML` — a regra do repositório está escrita em `sanitizeName`
   (`shared/protocol.js`) e o motivo dela está lá: a limpeza não escapa HTML de
   propósito, porque a defesa mora no ponto de SAÍDA, que é este arquivo.
   --------------------------------------------------------------------------- */

import { NAMEK } from "../../shared/namek/config.js";

/** `0x6fd8ff` → `"#6fd8ff"`. Aceita string pronta, para a bancada não sofrer. */
export function corHex(v, padrao = "#ffffff") {
  if (typeof v === "string") return v;
  if (typeof v !== "number" || !Number.isFinite(v)) return padrao;
  return `#${(v >>> 0).toString(16).padStart(6, "0").slice(-6)}`;
}

/**
 * Como o golpe se chama na linha do feed.
 *
 * Os especiais têm nome próprio no config (`NAMEK.specials[kind].nome`) e é ele
 * que entra: "Kienzan" conta uma história que "disk" não conta. O resto é uma
 * tabela curta aqui, e não no config, pela mesma razão que `NIVEIS_DA_CHUVA`
 * mora no HUD do arqueiro: config guarda NÚMERO, tela guarda PALAVRA.
 */
const GOLPES = {
  blast: "rajada de ki",
  burst: "onda de choque",
  queda: "o chão",
  slam: "o chão",
  colisao: "a pancada",
  tempestade: "a tempestade",
};

export function nomeDoGolpe(kind) {
  return NAMEK.specials[kind]?.nome ?? GOLPES[kind] ?? "ki";
}

/**
 * Normaliza quem chegou: `"Goku"`, `{nome}`, `{name}` — tudo vira o mesmo par.
 *
 * O laço principal ainda não existe quando este arquivo é escrito, e obrigá-lo
 * a montar um objeto só para pôr um nome no feed seria uma alocação por morte
 * cobrada de quem chama. Aceitar as duas formas custa três linhas.
 */
function pessoa(v) {
  if (v == null) return { id: null, nome: "alguém", cor: null };
  if (typeof v === "string") return { id: null, nome: v, cor: null };
  return {
    id: v.id ?? null,
    nome: v.nome ?? v.name ?? "alguém",
    cor: v.cor ?? v.color ?? null,
  };
}

/** É você nesta linha? Vale por id ou por nome — o que tiver chegado. */
function souEu(quem, eu) {
  if (eu.id != null && quem.id != null) return quem.id === eu.id;
  return eu.nome != null && quem.nome === eu.nome;
}

/* --------------------------------------------------------------- o placar --- */

/** Mais abates primeiro; empate se resolve por quem morreu menos. */
function porAbates(a, b) {
  const k = (b.kills ?? 0) - (a.kills ?? 0);
  if (k !== 0) return k;
  return (a.deaths ?? 0) - (b.deaths ?? 0);
}

/* Fora do método de propósito: uma função declarada dentro de `set` seria uma
   função nova por chamada, e `set` pode ser chamado por quadro. */
const ehEu = (p) => p.eu === true;

export class NamekScoreboard {
  /**
   * @param {HTMLElement} pai onde pendurar
   * @param {number} limite quantas linhas cabem antes de o placar virar lista
   */
  constructor(pai, limite = 8) {
    this.limite = limite;

    this.el = document.createElement("div");
    this.el.className = "nk-placar";

    const topo = document.createElement("div");
    topo.className = "nk-placar-topo";
    this.tituloEl = document.createElement("span");
    this.tituloEl.className = "nk-placar-titulo";
    this.tituloEl.textContent = "Mata-mata";
    this.contagemEl = document.createElement("span");
    this.contagemEl.textContent = "0 em campo";
    topo.append(this.tituloEl, this.contagemEl);

    this.corpo = document.createElement("div");
    this.corpo.className = "nk-placar-corpo";

    this.el.append(topo, this.corpo);
    pai.appendChild(this.el);

    /* AS LISTAS REAPROVEITADAS.
     *
     * `_ordem` é o vetor que se ordena, `_pos` guarda a colocação de verdade de
     * cada linha e `_linhas` são os nós já criados. Nenhuma delas é recriada: o
     * placar pode ser chamado a cada quadro por um laço distraído, e um
     * `map().sort()` ali dentro seriam dois arrays por quadro pelo resto da
     * partida. Ver o §3 do plano — o orçamento é zero byte em regime. */
    this._ordem = [];
    this._pos = [];
    this._linhas = [];
    this._contagem = -1;
  }

  /**
   * @param {Array<{id, nome, cor, kills, deaths, eu}>} lista
   */
  set(lista) {
    const dados = Array.isArray(lista) ? lista : [];

    const ordem = this._ordem;
    ordem.length = 0;
    for (let i = 0; i < dados.length; i++) ordem.push(dados[i]);
    ordem.sort(porAbates);

    const n = Math.min(ordem.length, this.limite);
    const pos = this._pos;
    pos.length = 0;
    for (let i = 0; i < n; i++) pos.push(i + 1);

    /* QUEM ESTÁ LENDO NUNCA SAI DA LISTA. Numa sala de quinze, o décimo colocado
     * é justamente quem mais precisa do placar — e é exatamente ele que um corte
     * em "os oito primeiros" apagaria. Se você não coube, a última linha é sua,
     * com a sua colocação DE VERDADE escrita nela, não a da linha. */
    const meuIndice = ordem.findIndex(ehEu);
    if (n > 0 && meuIndice >= n) {
      ordem[n - 1] = ordem[meuIndice];
      pos[n - 1] = meuIndice + 1;
    }

    if (this._contagem !== dados.length) {
      this._contagem = dados.length;
      this.contagemEl.textContent = `${dados.length} em campo`;
    }

    // Cresce o pool até caber; ele nunca encolhe — quinze nós é nada, e recriar
    // custa layout toda vez que alguém entra e sai.
    while (this._linhas.length < n) this._linhas.push(this._novaLinha());

    for (let i = 0; i < this._linhas.length; i++) {
      const linha = this._linhas[i];
      const p = i < n ? ordem[i] : null;
      if (!p) {
        if (!linha.el.hidden) linha.el.hidden = true;
        continue;
      }
      linha.el.hidden = false;
      this._escrever(linha, p, pos[i]);
    }
  }

  _novaLinha() {
    const el = document.createElement("div");
    el.className = "nk-placar-linha";

    const cor = document.createElement("i");
    cor.className = "nk-placar-cor";
    const nome = document.createElement("span");
    nome.className = "nk-placar-nome";
    const k = document.createElement("span");
    k.className = "nk-placar-k";
    const d = document.createElement("span");
    d.className = "nk-placar-d";

    el.append(cor, nome, k, d);
    this.corpo.appendChild(el);

    /* O cache do que está ESCRITO em cada nó. Escrever `textContent` num valor
       que não mudou obriga o navegador a recalcular layout à toa, e o placar de
       um mata-mata muda umas cinco vezes por minuto — o resto do tempo ele é um
       bloco parado que não pode custar nada. */
    return { el, cor, nome, k, d, corVal: null, nomeVal: null, kVal: -1, dVal: -1, euVal: null };
  }

  _escrever(linha, p, posicao) {
    const nome = `${posicao}. ${p.nome ?? p.name ?? "—"}`;
    if (linha.nomeVal !== nome) {
      linha.nomeVal = nome;
      linha.nome.textContent = nome; // nunca innerHTML: o nome vem da rede
    }
    const c = corHex(p.cor ?? p.color);
    if (linha.corVal !== c) {
      linha.corVal = c;
      linha.cor.style.background = c;
    }
    const kills = p.kills ?? 0;
    if (linha.kVal !== kills) {
      linha.kVal = kills;
      linha.k.textContent = String(kills);
    }
    const deaths = p.deaths ?? 0;
    if (linha.dVal !== deaths) {
      linha.dVal = deaths;
      linha.d.textContent = String(deaths);
    }
    const eu = p.eu === true;
    if (linha.euVal !== eu) {
      linha.euVal = eu;
      linha.el.classList.toggle("nk-eu", eu);
    }
  }

  dispose() {
    this.el.remove();
    this._linhas.length = 0;
  }
}

/* ------------------------------------------------------------- feed de mortes */

export class NamekKillFeed {
  /**
   * @param {HTMLElement} pai
   * @param {number} limite quantas linhas cabem antes de a mais velha sair
   * @param {number} vida s de cada linha na tela
   */
  constructor(pai, limite = 5, vida = 6) {
    this.el = document.createElement("div");
    this.el.className = "nk-feed";
    pai.appendChild(this.el);
    this.limite = limite;
    this.vida = vida;
    /** As linhas vivas, com o relógio de cada uma. Ver `update`. */
    this._vivas = [];
  }

  /**
   * Uma morte.
   *
   * @param {string|object} matador quem matou — texto ou `{id, nome, cor}`
   * @param {string|object} vitima quem morreu
   * @param {string} kind o golpe; vira nome por `nomeDoGolpe`
   * @param {{id: *, nome: string}|null} eu quem está lendo. A linha em que você
   *   aparece ganha destaque — sem isso, num tiroteio de quinze o feed é uma
   *   parede de nomes em que o seu não se acha.
   *
   *   São DOIS campos e não um id, porque quem chama pode mandar as duas formas:
   *   o laço do jogo resolve os ids para nome antes de chegar aqui
   *   (`Game.nomeDe`), e aí um id sozinho nunca casaria com nada.
   */
  push(matador, vitima, kind, eu = null) {
    const a = pessoa(matador);
    const b = pessoa(vitima);

    const linha = document.createElement("div");
    linha.className = "nk-feed-linha";
    if (eu && (souEu(a, eu) || souEu(b, eu))) linha.classList.add("nk-meu");

    linha.append(
      trecho(a.nome, null, a.cor),
      trecho(nomeDoGolpe(kind), "nk-golpe"),
      trecho("▸", "nk-seta"),
      trecho(b.nome, null, b.cor),
    );

    this.el.appendChild(linha);
    this._vivas.push({ el: linha, t: this.vida });
    while (this._vivas.length > this.limite) {
      this._vivas.shift().el.remove();
    }
  }

  /**
   * O relógio das linhas, movido pelo laço do jogo e não por `setTimeout`.
   *
   * Dois ganhos, e o segundo é o que importa: um `dispose()` no meio de uma
   * troca de modo não deixa cinco temporizadores pendurados mexendo em nós que
   * já saíram do documento; e o feed CONGELA junto com o jogo — se a partida
   * parou, a mensagem não deve sumir enquanto ninguém está olhando.
   */
  update(dt) {
    for (let i = this._vivas.length - 1; i >= 0; i--) {
      const v = this._vivas[i];
      v.t -= dt;
      if (v.t > 0) continue;
      v.el.remove();
      this._vivas.splice(i, 1);
    }
  }

  clear() {
    for (const v of this._vivas) v.el.remove();
    this._vivas.length = 0;
  }

  dispose() {
    this.clear();
    this.el.remove();
  }
}

/** Um pedaço de texto puro, opcionalmente colorido. Nunca `innerHTML`. */
function trecho(txt, classe = null, cor = null) {
  const span = document.createElement("span");
  span.textContent = String(txt);
  if (classe) span.className = classe;
  if (cor != null) span.style.color = corHex(cor);
  return span;
}
