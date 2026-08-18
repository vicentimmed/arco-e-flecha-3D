/* ---------------------------------------------------------------------------
   O SOL — três vidas, e o segundo botão do fim do planeta.

   O pedido, inteiro: *"Esse modo Namekusei também é ativado se 3 Kamehamehas
   atingirem o sol. Eles não precisam estar juntos, mas é como se o sol tivesse
   três vidas e, no último Kamehameha, depois dos três, ele explode, ativando
   várias partículas, pegando fogo em Namekusei. E aí entra o modo de Namekusei
   destruído, assim como se fosse ativado pelo menu. E o céu escurece, enfim,
   como já acontece no jogo. Cada vez que Kamehameha o sol, ele muda um pouco de
   cor, ficando cada vez mais vermelho."*

   ============================================================================
   1. O QUE ESTE ARQUIVO NÃO FAZ, E É O MAIS IMPORTANTE DELE
   ============================================================================

   **Ele não inventa uma fase.** A última frase do pedido é a especificação
   inteira: *"assim como se fosse ativado pelo menu"*. O menu vira o clima para
   `tempestade`, e virar o clima para `tempestade` já é, por escrito e desde o §1
   do plano, o fim de Namekusei — o céu fecha, o Freeza entra, ele morre, a
   contagem de um minuto começa, o planeta explode e quem escapou continua no
   espaço (ver `server/namek/fim.js`).

   Então o terceiro acerto no sol faz UMA coisa: `sala.pedirClima("tempestade")`.
   Tudo o que vem depois é a máquina de estados que já existia, disparada pelo
   caminho que ela já conhecia. Se este módulo tivesse a sua própria ideia do que
   é "Namekusei destruído", haveria duas — e a segunda envelheceria calada.

   ============================================================================
   2. O TESTE DO ACERTO É O DOS PLANETAS, DE PROPÓSITO
   ============================================================================

   `server/namek/planetas.js` já resolve exatamente este problema para Kuraia e
   Rubel, e o §2 do cabeçalho de lá argumenta a solução em detalhe. Repetindo o
   essencial, porque é o que dá segurança a esta mensagem:

     1. o jogador está vivo e não está caído;
     2. existe um especial declarado por ele, ele é um Kamehameha, e a janela de
        tempo dele ainda está aberta (`player.especial`, criado por
        `registrarEspecial`). **Isso já custou a barra CHEIA de ki** — é o preço
        mais caro do jogo, e é ele que impede o abuso de sair de graça;
     3. a direção TRAVADA no disparo aponta para o sol, dentro do raio angular do
        disco mais `NAMEK.sol.folga` graus.

   O item 3 é o que substitui a interseção raio-esfera que o cliente faz, e a
   equivalência é a mesma dos planetas: o cliente mede a partir do peito de quem
   atirou e a sala mede a partir do vetor que veio na mensagem — o mesmo vetor.

   O teto do abuso é, portanto: um cliente mentiroso derruba o sol com três
   Kamehamehas que ele quase acertou. Não há dano, placar nem vantagem nisso —
   o planeta que ele acabou de condenar é o dele também.

   ============================================================================
   3. POR QUE ELE NÃO MORA EM `planetas.js`
   ============================================================================

   Porque o que acontece depois do acerto não tem nada a ver. Um planeta que cai
   vira uma chuva de meteoros: uma simulação de rochas, uma reta e um relógio
   para cada uma, dano por atropelamento e cratera. O sol não cai — ele acende um
   interruptor de clima e some. São dois módulos com o mesmo teste de mira e
   nenhuma outra linha em comum, e juntá-los faria de `planetas.js` um arquivo
   sobre "coisas no céu" em vez de um arquivo sobre a chuva.

   O que os dois COMPARTILHAM é o teste, e ele cabe em oito linhas. Duplicar oito
   linhas é mais barato que criar uma dependência entre uma chuva de meteoros e
   um interruptor de clima.
   --------------------------------------------------------------------------- */

import { NAMEK } from "../../src/shared/namek/config.js";
import { NS2C } from "../../src/shared/namek/protocol.js";

/** A direção do sol, normalizada UMA vez na carga do módulo. O config a traz
 *  como três números soltos porque ele é lido por Node e pelo navegador; quem
 *  precisa dela como versor normaliza na entrada. */
const DIR = normalizar(NAMEK.sol.dir);

function normalizar(v) {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

export class NamekSol {
  /** @param {import("./room.js").NamekRoom} sala */
  constructor(sala) {
    this.sala = sala;
    /** Quantos Kamehamehas ele já levou. 0 … `NAMEK.sol.vidas`. */
    this.feridas = 0;
    /** rad — o raio angular do disco, visto do olho. O mesmo que o céu desenha. */
    this.angulo = NAMEK.sol.raio;
  }

  /** Zerado quando a sala esvazia, como as crateras e o peixe: quem entra numa
   *  sala vazia não herda o sol meio morto da partida de ontem. */
  zerar() {
    this.feridas = 0;
  }

  /** O que viaja no `welcome`. Ver `NS2C.SUN` para por que ele é necessário. */
  resumo() {
    return { feridas: this.feridas };
  }

  /** Já explodiu? */
  get morto() {
    return this.feridas >= NAMEK.sol.vidas;
  }

  /**
   * "O meu Kamehameha está apontado para o sol" — o `NC2S.SUN_HIT`.
   *
   * @returns {boolean} se o acerto foi aceito
   */
  pedido(player, agora) {
    if (this.morto) return false;
    if (!player?.alive) return false;
    if (this.sala.atordoado?.(player)) return false;

    /* O ESPECIAL TEM DE EXISTIR, e é este registro que dá dentes à mensagem —
       ver o §2 do cabeçalho. Ele só é criado por `registrarEspecial`, que já
       cobrou a barra cheia e já recusou quem está caído. */
    const e = player.especial;
    if (!e || e.kind !== "kamehameha" || agora > e.ate) return false;

    /* UM KAMEHAMEHA, UM ACERTO. Sem esta linha o mesmo golpe seria contado tantas
       vezes quantas o cliente mandasse a mensagem — e o sol morreria com um tiro
       só, o que apagaria as "três vidas" do pedido. É a mesma ideia do
       `exposicao` de `registrarQueimadura`: a janela do golpe é a unidade de
       cobrança, e não o pacote. */
    if (e.solCobrado) return false;

    const d = normalizar(e.d);
    const cos = d[0] * DIR[0] + d[1] * DIR[1] + d[2] * DIR[2];
    if (cos < Math.cos(this.angulo + (NAMEK.sol.folga * Math.PI) / 180)) return false;

    e.solCobrado = true;
    this.feridas++;

    /* O ANÚNCIO. Ele sai a cada acerto, e não só no último, porque a mudança de
       cor do disco é a barra de vida deste alvo: *"cada vez que Kamehameha o
       sol, ele muda um pouco de cor, ficando cada vez mais vermelho."* Sem os
       dois primeiros o jogador não teria como saber que os tiros contaram, e o
       terceiro chegaria do nada. */
    this.sala.broadcastAll({
      t: NS2C.SUN,
      feridas: this.feridas,
      morto: this.morto ? 1 : 0,
      by: player.id,
      w: agora,
    });
    this.sala.log?.(
      `namek — o sol levou um Kamehameha de ${player.name} (${this.feridas}/${NAMEK.sol.vidas})`,
    );

    if (!this.morto) return true;

    /* ================================================== E O PLANETA ACABA ==
     *
     * Uma linha, e ela é o módulo inteiro. Ver o §1 do cabeçalho: o que o sol
     * faz é apertar o MESMO botão que o menu aperta, e a máquina de estados de
     * `fim.js` conduz o resto — o céu fechando em oito segundos
     * (`weather.fade`), o Freeza entrando, a contagem, a explosão e o espaço.
     *
     * `pedirClima` recusa em silêncio se o clima já for `tempestade`, e recusar
     * é o certo: derrubar o sol no meio de uma batalha que já começou não pode
     * reiniciar nada. O que continua acontecendo nesse caso é a explosão dele na
     * tela, que é o que o jogador pagou para ver. */
    this.sala.pedirClima("tempestade", agora);
    this.sala.log("namek — O SOL EXPLODIU: o planeta está acabando");
    return true;
  }
}
