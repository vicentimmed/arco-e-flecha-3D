/* ---------------------------------------------------------------------------
   O arranque de Namekusei.

   Existe para que o `main.js` do arqueiro precise de UM `if` e nada mais. Todo
   o resto do que este modo faz para nascer mora aqui — que é o §11 do plano
   levado a sério: quanto menos linha nossa naquele arquivo, menor a chance de
   este modo quebrar o jogo que já existe.

   --------------------------------------------------- por que uma RECARGA

   A escolha da porta de Namekusei recarrega a página com `?jogo=namek`, e isso
   parece um rodeio até se olhar o que a alternativa custaria.

   O `main()` do arqueiro constrói o jogo dele ENQUANTO a pessoa digita o nome —
   é o truque que faz a entrada ser imediata, e ele é bom. Só que a essa altura
   já foram carregados o WASM do Rapier, o vale inteiro, a vegetação e um
   `WebGLRenderer` preso ao canvas. Entrar em Namekusei depois disso significaria:

   • **Dois renderers no mesmo canvas.** Não é uma questão de desperdício: é um
     conflito. O segundo contexto WebGL sobre o mesmo elemento não nasce.
   • **O vale inteiro na memória** para sempre, sem ninguém para desenhá-lo —
     contra o pedido explícito de o modo ser leve.
   • **Ou um `dispose()` novo no `Game` do arqueiro**, que é justamente o tipo
     de alteração que o §0 proíbe.

   Recarregando, `main()` vê o parâmetro ANTES de construir qualquer coisa e
   desvia. Nada do arqueiro chega a existir: nem Rapier, nem vale, nem renderer.
   O nome já está no `localStorage` (a tela de entrada o guarda desde sempre),
   então a recarga é invisível para quem está jogando — e o próprio lobby já usa
   esse mesmo caminho quando se troca a qualidade gráfica.
   --------------------------------------------------------------------------- */

import { NamekGame } from "./game.js";

/** O parâmetro que marca a escolha. Ver o cabeçalho. */
export const NAMEK_PARAM = "jogo";
export const NAMEK_VALUE = "namek";

/** A página foi aberta pedindo Namekusei? */
export function namekRequested() {
  return new URLSearchParams(location.search).get(NAMEK_PARAM) === NAMEK_VALUE;
}

/**
 * Recarrega a página em Namekusei, preservando o resto da query.
 *
 * A chave da sala (`?k=`) precisa sobreviver: ela é o convite, e perdê-la aqui
 * trancaria justamente quem chegou pelo link certo.
 */
export function goToNamek() {
  const q = new URLSearchParams(location.search);
  q.set(NAMEK_PARAM, NAMEK_VALUE);
  location.search = q.toString();
}

/** Sai de Namekusei de volta ao jogo do arqueiro, pelo mesmo caminho. */
export function leaveNamek() {
  const q = new URLSearchParams(location.search);
  q.delete(NAMEK_PARAM);
  location.search = q.toString();
}

/**
 * Monta o jogo e o entrega pronto para o lobby.
 *
 * O mundo é construído AQUI, enquanto a pessoa digita — o mesmo princípio do
 * arranque do arqueiro, e pelo mesmo motivo: esculpir o relevo e espalhar a
 * vegetação leva alguns segundos, e esse tempo cabe inteiro dentro do tempo de
 * escrever um apelido.
 *
 * @param {(passo: string) => void} setStep para a linha de status do lobby
 */
export async function bootNamek(setStep = () => {}) {
  const canvas = document.getElementById("scene");
  const ui = document.getElementById("ui");

  setStep("acordando Namekusei…");
  const game = new NamekGame(canvas, ui);

  /* O `build` é síncrono, mas cede o quadro antes de começar para a barra de
     progresso do lobby de fato PINTAR. Sem isso a tela fica congelada no
     primeiro passo e só volta a existir com o mundo pronto — e o progresso vira
     enfeite que ninguém chega a ver. */
  await nextFrame();
  game.build((_f, texto) => setStep(texto));

  return game;
}

/**
 * Um quadro — ou 100 ms, o que vier primeiro.
 *
 * A corrida com o `setTimeout` não é cinto de segurança: **`requestAnimationFrame`
 * não dispara em aba oculta**, e sem ela o arranque de Namekusei simplesmente
 * NÃO ACONTECE numa aba de segundo plano. O sintoma é o pior possível — a tela
 * de entrada parada em "acordando Namekusei…" para sempre, sem erro nenhum no
 * console, porque não há erro: a função só nunca é chamada. Custou uma sessão
 * de depuração descobrir isso aqui, e o `main.js` do arqueiro já tinha a mesma
 * corrida escrita pelo mesmo motivo.
 *
 * Com aba visível o rAF ganha sempre, então o caminho normal não paga nada.
 */
function nextFrame() {
  return new Promise((resolve) => {
    let pronto = false;
    const fim = () => {
      if (pronto) return;
      pronto = true;
      resolve();
    };
    requestAnimationFrame(fim);
    setTimeout(fim, 100);
  });
}
