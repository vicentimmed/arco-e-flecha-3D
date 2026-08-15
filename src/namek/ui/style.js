/* ---------------------------------------------------------------------------
   O estilo do HUD de Namekusei — em JavaScript, e não no `src/style.css`.

   Não é preciosismo: é o §0 do plano cobrado no lugar mais fácil de errar. O
   `style.css` é do jogo do arqueiro, tem 2 400 linhas, e uma regra nova ali
   dentro é uma regra que a próxima pessoa vai mover, agrupar ou "limpar" junto
   com as vizinhas sem saber que ela pertence a outro jogo. Aqui o estilo mora
   ao lado do módulo que o usa, entra quando o modo entra, e sai quando ele sai.

   Todo seletor começa com `nk-`. Não é convenção de organização — é a garantia
   de que este arquivo não pode pintar um único pixel do vale, mesmo que o modo
   seja aberto por cima dele com o HUD do arqueiro ainda montado.

   NENHUM ARQUIVO EXTERNO. Nem fonte, nem ícone, nem imagem: a mira, o retrato e
   as setas de dano são desenhados por código, como o resto do repositório.

   ------------------------------------------------------------------ caráter --
   A referência é o HUD do *Budokai Tenkaichi 3*: barras grandes e INCLINADAS
   nos cantos de cima, retrato do lutador na ponta, nome em caixa alta, vida em
   número grande, e a barra de ki logo abaixo, dividida em cinco gomos. Contorno
   preto grosso em tudo, porque o fundo desta arena é céu claro e explosão
   branca — um HUD de traço fino desaparece no primeiro Kamehameha.
   --------------------------------------------------------------------------- */

/** O id da tag. Único: duas instâncias não injetam o estilo duas vezes. */
const ID = "nk-estilo";

/* Quantos HUDs vivos dependem desta tag.
 *
 * Existe porque `dispose()` não pode arrancar o estilo enquanto outra instância
 * ainda estiver na tela (a bancada de desenvolvimento monta duas), e também não
 * pode deixá-lo para sempre — sair do modo e voltar ao arqueiro tem de devolver
 * o documento ao estado em que ele estava. Contar é o único jeito de as duas
 * coisas serem verdade ao mesmo tempo. */
let vivos = 0;

/**
 * Põe o estilo no documento (uma vez só) e devolve como tirá-lo.
 *
 * @returns {() => void} solta a referência; a última apaga a tag.
 */
export function aplicarEstiloNamek() {
  if (!document.getElementById(ID)) {
    const tag = document.createElement("style");
    tag.id = ID;
    tag.textContent = CSS;
    document.head.appendChild(tag);
  }
  vivos++;
  let solto = false;
  return () => {
    if (solto) return;
    solto = true;
    if (--vivos > 0) return;
    document.getElementById(ID)?.remove();
  };
}

/* ------------------------------------------------------------------- o CSS -- */

const CSS = `
/* Os tokens vivem na RAIZ DO HUD, não no ':root' do documento.
   Um '--ki' no ':root' seria uma variável global com nome de duas letras num
   documento que já tem o tema do arqueiro — e a primeira colisão seria
   silenciosa. Presas aqui, elas não existem fora desta árvore. */
/* A PORTA DE ENTRADA ENTRA NO MESMO SELETOR, e é por isso que os tokens estão
   num bloco só e o posicionamento do HUD num bloco à parte logo abaixo.
   Ela não está DENTRO do HUD — quem a monta é a entrada ('ui/porta.js', erguida
   por 'input.js', que só conhece o canvas) —, então sem esta segunda âncora ela
   ficaria com a fonte do documento e com 'var(--nk-ouro)' resolvendo para nada.
   A alternativa era copiar os oito tokens num segundo bloco, e isso é a paleta
   do modo em duas versões que envelhecem separadas. */
.nk-hud,
.nk-porta {
  font-family: "Nunito", "Trebuchet MS", "Segoe UI", system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
  color: var(--nk-tinta);
  -webkit-font-smoothing: antialiased;
  /* A sombra base vale para TUDO que este HUD escreve. O contorno grosso
     ('.nk-contorno') é para os números e nomes grandes; esta aqui é o mínimo
     que faz um "3 em campo" de 10 px sobreviver ao céu de Namekusei. */
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95), 0 0 7px rgba(0, 0, 0, 0.7);

  --nk-tinta: #f2f8ff;
  --nk-fraca: rgba(226, 240, 255, 0.62);
  --nk-traco: #04080e;
  --nk-vidro: rgba(6, 14, 24, 0.58);
  --nk-ki: #6fd8ff;
  --nk-perigo: #ff3a2a;
  --nk-ouro: #ffd34d;
  /* A inclinação das barras. Uma variável e não um número solto porque a placa
     do alvo usa o SIMÉTRICO dela — as duas se espelham como no BT3, e um sinal
     trocado à mão em seis lugares é um sinal esquecido em algum deles. */
  --nk-skew: -14deg;
}

.nk-hud {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

/* O contorno grosso, em texto. Quatro sombras em cruz fazem o papel de um
   'stroke' que o HTML não tem, e a quinta afunda o bloco no cenário. Sem isto,
   nome branco sobre céu verde-claro some. */
.nk-hud .nk-contorno,
.nk-porta .nk-contorno {
  text-shadow:
    0 2px 0 var(--nk-traco), 0 -2px 0 var(--nk-traco),
    2px 0 0 var(--nk-traco), -2px 0 0 var(--nk-traco),
    2px 2px 0 var(--nk-traco), -2px 2px 0 var(--nk-traco),
    2px -2px 0 var(--nk-traco), -2px -2px 0 var(--nk-traco),
    0 4px 10px rgba(0, 0, 0, 0.75);
}

.nk-hud [hidden] { display: none !important; }

/* ============================================================ placa do lutador
   Retrato à esquerda, medidores à direita, especiais por baixo. É o bloco que
   ocupa o canto superior — o mesmo lugar, e pela mesma razão, do BT3: é a única
   informação que se consulta com o olho de canto no meio de uma perseguição. */

.nk-placa {
  position: absolute;
  top: 14px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  z-index: 3;
}

.nk-placa--eu { left: 16px; align-items: flex-start; }

/* O ALVO É A IMAGEM ESPELHADA — inclinação, ordem e alinhamento invertidos.
   No BT3 os dois lutadores ocupam cantos opostos e apontam um para o outro; é
   isso que faz a tela dizer "vocês dois" sem escrever nada. */
.nk-placa--alvo {
  right: 16px;
  align-items: flex-end;
  --nk-skew: 14deg;
}

.nk-placa-corpo { display: flex; align-items: center; gap: 10px; }
.nk-placa--alvo .nk-placa-corpo { flex-direction: row-reverse; }

/* ------------------------------------------------------------------ retrato -- */

/* Hexágono cortado, moldura escura e um halo na cor do jogador. O halo não é
   enfeite: é a MESMA cor que o corpo dele tem em campo, e é ela que liga o nome
   da placa ao boneco que está voando na sua frente. */
.nk-retrato {
  position: relative;
  width: 62px;
  height: 62px;
  flex: none;
  clip-path: polygon(50% 0%, 100% 26%, 100% 74%, 50% 100%, 0% 74%, 0% 26%);
  background: linear-gradient(160deg, rgba(10, 22, 36, 0.95), rgba(4, 10, 18, 0.98));
  box-shadow:
    0 0 0 2px var(--nk-traco),
    0 0 16px 2px var(--nk-cor, #6fd8ff),
    0 6px 16px rgba(0, 0, 0, 0.6);
}

.nk-retrato svg { display: block; width: 100%; height: 100%; }

/* A placa do alvo espelha até o retrato: os dois se encaram. */
.nk-placa--alvo .nk-retrato { transform: scaleX(-1); }

.nk-retrato--pequeno { width: 46px; height: 46px; }

/* ---------------------------------------------------------------- medidores -- */

.nk-medidores { display: flex; flex-direction: column; gap: 5px; }
.nk-placa--alvo .nk-medidores { align-items: flex-end; }

.nk-nome {
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  max-width: min(34vw, 340px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.1;
}

.nk-linha { display: flex; align-items: center; gap: 10px; }
.nk-placa--alvo .nk-linha { flex-direction: row-reverse; }

/* ------------------------------------------------------------ barra de vida --
   Casco inclinado, borda preta de 3 px e três camadas dentro:
     1. o FANTASMA — quanto de vida havia um instante atrás;
     2. o preenchimento de verdade;
     3. um brilho no topo, que é o que dá volume à barra chapada. */

.nk-vida {
  position: relative;
  width: clamp(230px, 25vw, 400px);
  height: 26px;
  transform: skewX(var(--nk-skew));
  background: rgba(2, 6, 12, 0.82);
  border: 3px solid var(--nk-traco);
  border-radius: 3px;
  overflow: hidden;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.55), inset 0 0 0 1px rgba(255, 255, 255, 0.09);
}

.nk-vida--alvo { width: clamp(190px, 20vw, 320px); height: 21px; }

.nk-vida-fantasma,
.nk-vida-fill {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 100%;
}

/* O FANTASMA É O GOLPE QUE VOCÊ ACABOU DE LEVAR.
   Ele desce mais devagar que a vida, e por um instante existe uma faixa quente
   entre os dois valores. É a peça mais barata do HUD inteiro e a que mais faz
   diferença: sem ela, tomar 6 de dano e tomar 48 são a mesma barra encolhendo —
   com ela, o jogador SENTE o tamanho da pancada sem ler número nenhum. */
/* PÁLIDO E QUENTE, quase branco. A primeira versão era laranja, e com a vida
   baixa — que é justamente quando o fantasma importa — ela ficava da mesma cor
   do preenchimento: duas faixas laranja encostadas não contam pancada nenhuma.
   Ouro claro se separa do verde, do âmbar e do vermelho ao mesmo tempo. */
.nk-vida-fantasma {
  background: linear-gradient(180deg, #fffdf0, #ffd76a 58%, #ff9a2e);
  box-shadow: inset 0 0 12px rgba(255, 240, 200, 0.6);
}

/* Verde → âmbar → vermelho por um giro de matiz. O gradiente vertical é o que
   transforma a faixa chapada num tubo — é o mesmo truque de todo HUD de luta. */
/* O 'inset -3px 0' é a LINHA BRANCA na ponta do preenchimento, e ela desenha
   exatamente onde a vida está agora. É o que separa o preenchimento do fantasma
   sem depender de as duas cores serem diferentes o bastante — e é ela que se
   vê andar para trás quando o dano entra. */
.nk-vida-fill {
  background: linear-gradient(
    180deg,
    hsl(var(--nk-hue, 112) 92% 68%) 0%,
    hsl(var(--nk-hue, 112) 96% 50%) 44%,
    hsl(var(--nk-hue, 112) 88% 33%) 100%
  );
  box-shadow: inset 0 -6px 12px rgba(0, 0, 0, 0.35), inset -3px 0 0 rgba(255, 255, 255, 0.92);
}

/* O risco de luz que corre no alto da barra. Puramente óptico, e o que separa
   "retângulo colorido" de "medidor". */
.nk-vida-verniz {
  position: absolute;
  inset: 2px 2px auto 2px;
  height: 34%;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0));
  pointer-events: none;
}

/* As divisórias da vida: quatro talhos claros que dão RÉGUA à barra. Sem elas
   não há como estimar "metade" num relance — e é sempre um relance. */
.nk-vida-regua {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    90deg,
    rgba(0, 0, 0, 0) 0 calc(20% - 2px),
    rgba(0, 0, 0, 0.42) calc(20% - 2px) 20%
  );
  pointer-events: none;
}

.nk-vida-num {
  font-size: 30px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.01em;
  min-width: 2.4ch;
  text-align: center;
}

.nk-vida-num--alvo { font-size: 22px; }

/* Abaixo de um quarto o número vira vermelho e PULSA. O aviso precisa chegar
   enquanto ainda dá para fazer alguma coisa a respeito — carregar ki, fugir,
   soltar a onda —, não no quadro em que a vida acaba. */
.nk-vida-num.nk-critico {
  color: #ff5140;
  animation: nk-bater 0.62s ease-in-out infinite;
}

@keyframes nk-bater {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.16); }
}

/* ================================================================ barra de ki
   A PEÇA MAIS IMPORTANTE DESTE HUD.

   O modo inteiro pende de uma regra (§5 do plano): o especial só sai com a
   barra CHEIA. Uma barra que enche em silêncio é a diferença entre um jogador
   que solta Kamehameha e um que passa a partida atirando bolinha sem saber por
   quê. Por isso encher aqui não é chegar a 100 % — é um EVENTO: a barra
   estoura de brilho por um instante, passa a pulsar, ganha um selo escrito e
   acende os quatro especiais logo abaixo. Quatro avisos para uma informação só,
   e nenhum deles é demais. */

.nk-ki {
  position: relative;
  width: clamp(200px, 22vw, 350px);
  height: 14px;
  transform: skewX(var(--nk-skew));
  background: rgba(2, 6, 12, 0.85);
  border: 2px solid var(--nk-traco);
  border-radius: 2px;
  overflow: hidden;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.5);
}

.nk-ki-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0;
  background: linear-gradient(180deg, #bff0ff, #37b6ff 52%, #1157c9);
}

/* CINCO GOMOS, como no BT3. O número não é arbitrário: cinco divisões são o
   máximo que o olho conta sem contar. */
.nk-ki-grade {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    90deg,
    rgba(0, 0, 0, 0) 0 calc(20% - 3px),
    rgba(2, 8, 14, 0.92) calc(20% - 3px) 20%
  );
}

/* A LÂMINA DE LUZ que corre pela barra cheia. Estreita de propósito: a primeira
   versão tinha o dobro da largura e cobria a barra inteira a cada volta — o
   resultado era uma faixa branca chapada, que é justamente o que a barra de ki
   não pode virar. Ela tem de continuar AZUL e só parecer energizada. */
.nk-ki-brilho {
  position: absolute;
  inset: 0;
  opacity: 0;
  background: linear-gradient(
    100deg,
    rgba(255, 255, 255, 0) 46%,
    rgba(255, 255, 255, 0.8) 50%,
    rgba(255, 255, 255, 0) 54%
  );
}

/* --------------------------------------------------------- ki cheio: o aviso */

.nk-ki.nk-cheio {
  border-color: #eaf9ff;
  animation: nk-ki-pulso 1.15s ease-in-out infinite;
}

/* Cheia ela ganha um branco no topo e ESCURECE embaixo. Clarear tudo foi a
   primeira tentativa e apagou a barra: branco sobre branco não é "carregada",
   é "sem informação". O contraste interno é o que a faz parecer acesa. */
.nk-ki.nk-cheio .nk-ki-fill {
  background: linear-gradient(180deg, #f2ffff 0%, #6fd8ff 22%, #1e86ff 60%, #0a49b4 100%);
}

.nk-ki.nk-cheio .nk-ki-brilho {
  opacity: 0.9;
  animation: nk-varredura 1.6s linear infinite;
}

/* O CLARÃO DE UM QUADRO SÓ, no instante em que ela fecha.
   Uma animação contínua ensina que a barra está cheia; esta ensina QUANDO ela
   encheu — que é a informação que muda o que a pessoa faz no segundo seguinte.
   Reposta à mão a cada subida de borda (ver '_acenderKi').

   AS DUAS TOCAM JUNTAS, e a linha de baixo é o motivo de esta regra existir em
   três versões em vez de uma. A primeira tentativa deixou as duas disputando a
   mesma propriedade 'animation': com as duas classes no elemento, o clarão
   vencia e o PULSO NUNCA MAIS TOCAVA — a barra acendia uma vez na vida e depois
   ficava cheia em silêncio, que é o defeito exato que este HUD existe para não
   ter. Declaradas juntas, cada uma mexe no que é seu (o clarão na escala e no
   brilho, o pulso na sombra) e nenhuma apaga a outra. */
.nk-ki.nk-acendeu { animation: nk-ki-estouro 0.5s ease-out; }

.nk-ki.nk-cheio.nk-acendeu {
  animation:
    nk-ki-estouro 0.5s ease-out,
    nk-ki-pulso 1.15s ease-in-out infinite;
}

@keyframes nk-ki-pulso {
  0%, 100% { box-shadow: 0 0 0 0 rgba(120, 225, 255, 0), inset 0 0 8px rgba(255, 255, 255, 0.25); }
  50% { box-shadow: 0 0 24px 5px rgba(120, 225, 255, 0.75), inset 0 0 16px rgba(255, 255, 255, 0.55); }
}

@keyframes nk-varredura {
  from { transform: translateX(-115%); }
  to { transform: translateX(115%); }
}

/* A escala vertical entra no MESMO 'transform' da inclinação: uma animação que
   escrevesse só 'scaleY' apagaria o 'skewX' e a barra se desentortaria no meio
   do clarão. */
@keyframes nk-ki-estouro {
  0% { transform: skewX(var(--nk-skew)) scaleY(1); filter: brightness(1); }
  22% { transform: skewX(var(--nk-skew)) scaleY(1.85); filter: brightness(2.8); }
  100% { transform: skewX(var(--nk-skew)) scaleY(1); filter: brightness(1); }
}

/* O SELO ESCRITO. É o único aviso que funciona para quem nunca viu o modo:
   brilho e pulso dizem "alguma coisa mudou", a palavra diz O QUÊ.

   Ele é uma PLAQUETA com fundo escuro e borda, e não um texto solto. Solto, ele
   atravessava a montanha do cenário e desaparecia — e um aviso que só se lê
   contra fundo liso é um aviso que falha exatamente na hora da briga. Ele
   ocupa lugar mesmo apagado (opacidade, não 'hidden'): a barra não pode dar um
   pulo de layout no instante em que a pessoa está olhando para ela. */
.nk-ki-selo {
  padding: 2px 8px 3px;
  border: 2px solid rgba(234, 250, 255, 0.9);
  border-radius: 3px;
  background: rgba(5, 18, 34, 0.86);
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.16em;
  color: #eafaff;
  opacity: 0;
  transition: opacity 0.14s ease-out;
  white-space: nowrap;
}

.nk-medidores.nk-pronto .nk-ki-selo {
  opacity: 1;
  animation: nk-selo 1.15s ease-in-out infinite;
}

@keyframes nk-selo {
  0%, 100% {
    color: #cdf3ff;
    border-color: rgba(140, 231, 255, 0.75);
    box-shadow: 0 0 0 0 rgba(120, 225, 255, 0);
  }
  50% {
    color: #ffffff;
    border-color: #ffffff;
    box-shadow: 0 0 18px 2px rgba(120, 225, 255, 0.7);
  }
}

/* ============================================================ especiais 1–4 --
   Ficam COLADOS embaixo da barra de ki, e não num canto próprio. A adjacência é
   a explicação da regra: a barra fecha, e a fileira inteira acende no mesmo
   quadro, um palmo abaixo. Ninguém precisa contar isso a ninguém. */

.nk-especiais {
  display: flex;
  gap: 6px;
  /* Alinhados com os medidores, não com o retrato: a fileira é a continuação
     da barra de ki, e o recuo é a largura do retrato mais o vão. */
  margin-left: 72px;
}

.nk-esp {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px 4px 6px;
  background: rgba(4, 10, 18, 0.72);
  border: 2px solid rgba(255, 255, 255, 0.14);
  border-radius: 4px;
  transform: skewX(var(--nk-skew));
  /* APAGADOS por padrão: sem a barra cheia eles não são um menu, são uma
     promessa. Dessaturar é mais honesto que esconder — some a tentação, fica a
     informação de que existem quatro. */
  opacity: 0.34;
  filter: saturate(0.15);
  transition: opacity 0.16s ease-out, filter 0.16s ease-out, border-color 0.16s ease-out;
}

.nk-esp > * { transform: skewX(calc(-1 * var(--nk-skew))); }

.nk-esp-tecla {
  display: grid;
  place-items: center;
  width: 17px;
  height: 17px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.14);
  font-size: 11px;
  font-weight: 900;
  line-height: 1;
}

.nk-esp-nome {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
}

/* Barra cheia: a fileira inteira acende, cada tijolo na cor do próprio golpe. */
.nk-especiais.nk-pronto .nk-esp {
  opacity: 1;
  filter: none;
  border-color: color-mix(in srgb, var(--nk-esp-cor) 70%, transparent);
  box-shadow: 0 0 10px -2px var(--nk-esp-cor);
}

.nk-especiais.nk-pronto .nk-esp .nk-esp-tecla {
  background: var(--nk-esp-cor);
  color: #04080e;
}

/* O ARMADO fica maior e ganha a cor cheia — é o que a tecla 1–4 escolheu, e é
   o que vai sair quando a pessoa apertar. Vale mesmo com a barra vazia: saber
   o que está armado é útil justamente enquanto se carrega. */
.nk-esp.nk-armado {
  opacity: 1;
  filter: none;
  border-color: var(--nk-esp-cor);
  background: rgba(10, 24, 40, 0.9);
  transform: skewX(var(--nk-skew)) scale(1.08);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.7), 0 0 16px -1px var(--nk-esp-cor);
}

.nk-especiais.nk-pronto .nk-esp.nk-armado {
  animation: nk-armado 1.15s ease-in-out infinite;
}

@keyframes nk-armado {
  0%, 100% { box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.7), 0 0 12px -2px var(--nk-esp-cor); }
  50% { box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.7), 0 0 26px 2px var(--nk-esp-cor); }
}

/* ==================================================================== mira ---
   Fixa no centro, como a do arqueiro e pela mesma razão: a linha de tiro sai do
   eixo óptico da câmera. O que muda aqui é o ESTADO — e ele muda porque este
   modo tem trava de alvo, e uma mira que não diz se travou obriga a olhar para
   o outro canto da tela para descobrir. */

.nk-mira {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 60px;
  height: 60px;
  margin: -30px 0 0 -30px;
  z-index: 2;
  color: #ffffff;
}

/* CADA TRAÇO TEM CONTORNO PRETO — um anel de 1 px em volta, via 'box-shadow'.
   A primeira versão era branco puro com uma sombra difusa, e ela sumia por
   completo sobre o clarão de um Kamehameha, que é o pior momento possível para
   perder a mira. Branco sobre branco não existe; branco com borda preta,
   sim. */
.nk-mira i {
  position: absolute;
  background: currentColor;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.92), 0 0 5px rgba(0, 0, 0, 0.8);
  transition: transform 0.12s ease-out;
}

.nk-mira .nk-t {
  width: 3px;
  height: 11px;
  left: 28.5px;
}
.nk-mira .nk-h { width: 11px; height: 3px; top: 28.5px; }
.nk-mira .nk-t1 { top: 1px; }
.nk-mira .nk-t2 { bottom: 1px; }
.nk-mira .nk-h1 { left: 1px; }
.nk-mira .nk-h2 { right: 1px; }

.nk-mira .nk-ponto {
  width: 4px;
  height: 4px;
  left: 28px;
  top: 28px;
  border-radius: 50%;
}

.nk-mira-anel {
  position: absolute;
  inset: 8px;
  border: 2px dashed currentColor;
  border-radius: 50%;
  opacity: 0;
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.95));
  transition: opacity 0.14s ease-out;
}

/* TRAVADO: a mira do centro SAI DA TELA.
 *
 * Ela era pintada de vermelho com os traços puxados para dentro — "a mira morde
 * o alvo", dizia o comentário —, e isso era exatamente o problema que o pedido
 * aponta: *"o retículo não deve ser aquele; deve ser um círculo vermelho em
 * volta do player."*
 *
 * A razão não é de gosto. Com a trava, o tiro NÃO sai pelo eixo óptico: ele sai
 * na direção do alvo (ver 'direcaoDeTiro', e o cabeçalho de 'camera.js' sobre
 * 'aimPoint' deixar de ser o centro da tela). Uma cruz no meio da tela enquanto
 * o tiro vai para outro lugar é uma mira que mente, e ela mentia mais quanto
 * mais o alvo derivasse para fora do centro — que, com a zona morta da câmera
 * nova, passou a ser o tempo todo.
 *
 * Quem diz para onde o tiro vai, travado, é o anel em volta do adversário
 * ('.nk-alvo-anel'). Duas miras na tela ao mesmo tempo, uma delas errada, é pior
 * que nenhuma. */
.nk-mira.nk-travado { display: none; }

/* Carregando: dourado e girando. Carregar ki trava o lutador no lugar (§5), e a
   mira girando é o que diz que o corpo não vai responder até soltar. */
.nk-mira.nk-carregando { color: var(--nk-ouro); }
.nk-mira.nk-carregando .nk-mira-anel { opacity: 1; animation: nk-girar 1.1s linear infinite; }

@keyframes nk-girar { to { transform: rotate(360deg); } }

/* ============================================================ anel da trava
 *
 * O CÍRCULO VERMELHO EM VOLTA DO ADVERSÁRIO — o retículo do pedido.
 *
 * Ele não fica no centro da tela: ele é ancorado no corpo de quem está travado,
 * e a razão está em 'NamekHud.setLockRing'. O que este bloco resolve é fazer um
 * círculo vermelho de tamanho variável ler como MIRA e não como enfeite, e são
 * três coisas:
 *
 * • **o contorno duplo** — um anel vermelho com uma sombra preta por fora e um
 *   brilho vermelho por dentro. Vermelho puro sobre o clarão de um Kamehameha
 *   some, e sobre o céu verde de Namekusei ele vibra; a borda preta resolve os
 *   dois, e é a mesma lição que o retículo do centro já tinha aprendido.
 * • **as quatro cantoneiras** — quatro cantos de um quadrado imaginário em volta
 *   do círculo. É a diferença entre "um círculo" e "uma mira travada": nenhum
 *   objeto do mundo tem cantoneiras, então elas são lidas como interface na
 *   hora, sem precisar de nada escrito.
 * • **nada de 'transition' na posição** — o anel persegue um corpo que voa a
 *   64 m/s, e uma transição de CSS por cima disso faria o anel ficar atrasado em
 *   relação ao adversário de um jeito que o olho lê como "o jogo travou". A cor
 *   e a opacidade, essas sim, transicionam.
 */

.nk-alvo-anel {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 3;
  border: 2px solid #ff3b28;
  border-radius: 50%;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.85),
    inset 0 0 0 1px rgba(0, 0, 0, 0.55),
    0 0 12px rgba(255, 59, 40, 0.55);
  pointer-events: none;
  /* 'will-change' porque ele muda de transform em TODO quadro: é o aviso ao
     navegador para deixar o elemento numa camada própria e não repintar o HUD
     inteiro por causa dele. */
  will-change: transform, width, height;
}
.nk-alvo-anel[hidden] { display: none !important; }

/* As cantoneiras. 'inset' negativo as põe FORA do círculo — coladas nele, elas
   somem contra a própria borda. */
.nk-alvo-anel .nk-c {
  position: absolute;
  width: 9px;
  height: 9px;
  border: 2px solid #ff3b28;
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.9));
}
.nk-alvo-anel .nk-c1 { left: -7px;  top: -7px;    border-right: 0; border-bottom: 0; }
.nk-alvo-anel .nk-c2 { right: -7px; top: -7px;    border-left: 0;  border-bottom: 0; }
.nk-alvo-anel .nk-c3 { left: -7px;  bottom: -7px; border-right: 0; border-top: 0; }
.nk-alvo-anel .nk-c4 { right: -7px; bottom: -7px; border-left: 0;  border-top: 0; }

/* ALVO DISTANTE: o anel pisca devagar. É a "indicação visual de que o alvo está
   distante" do §13 — a trava ainda vale, mas está perto do limite de alcance e
   pode cair. Piscar e não mudar de cor: cor nova é informação nova para
   aprender, e piscar todo mundo já entende como "atenção". */
.nk-alvo-anel.nk-longe { animation: nk-alvo-pulso 1.1s ease-in-out infinite; }

/* PERDENDO: o alvo saiu do quadro e o relógio da perda está correndo (§14). O
   anel fica tracejado e desbota — ele está descrevendo alguém que já não se vê,
   e um anel sólido sobre o vazio seria mentira. Ele continua na tela de
   propósito: é a borda do quadro por onde o adversário saiu, e é para lá que o
   jogador tem de virar. */
.nk-alvo-anel.nk-perdendo {
  border-style: dashed;
  opacity: 0.55;
  animation: nk-alvo-pulso 0.5s ease-in-out infinite;
}

@keyframes nk-alvo-pulso {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

/* ============================================================= dano recebido */

/* O clarão. Vinheta e não lavagem de tela: o vermelho entra pelas bordas e
   deixa o meio limpo, senão o aviso de dano cega justamente na hora de revidar. */
.nk-flash {
  position: absolute;
  inset: 0;
  z-index: 1;
  opacity: 0;
  background: radial-gradient(ellipse at center, rgba(255, 0, 0, 0) 34%, rgba(190, 12, 6, 0.85) 100%);
}

/* De onde veio. Um HUD sem isto obriga a girar 360° para descobrir quem está
   atirando — e girar é justamente o que não dá tempo de fazer. */
/* ------------------------------------------------------------- a bússola ----

   Os pinos que dizem onde estão os outros lutadores. Mesma peça dos marcadores
   de rocha da chuva de meteoros (a classe .mm de src/style.css), com duas
   diferenças que estão explicadas em NamekHud.setMarcas: a cor vem do LUTADOR e
   o pino só existe de longe.

   (Sem crase em nenhum lugar deste arquivo, inclusive nos comentários: ele
   inteiro é UM template literal, e uma crase aqui dentro o fecha no meio.)

   O 'z-index: 1' põe a bússola abaixo das marcas de dano (2) e de tudo o que é
   placa. Ela é a camada mais funda do HUD de propósito: informa sobre o que
   está longe, e nada que esteja longe pode tapar o que está acontecendo agora. */
.nk-bussola { position: absolute; inset: 0; z-index: 1; pointer-events: none; }

.nk-pino {
  position: absolute;
  left: 50%;
  top: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  /* A cor é UMA variável e o bloco inteiro a herda — trocar de lutador é
     trocar uma linha, e é o que setMarcas escreve. */
  --nk-pino-cor: #ff8a2a;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.95);
  will-change: transform, opacity;
}

.nk-pino[hidden] { display: none; }

/* NA TELA: o anel circula o corpo. Miolo vazio — é sobre o lutador que ele
   cai, e um disco o cobriria justamente quando ele já está visível. */
.nk-pino-anel {
  width: 30px;
  height: 30px;
  border: 2px solid var(--nk-pino-cor);
  border-radius: 50%;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.6), inset 0 0 8px rgba(255, 255, 255, 0.18);
}

.nk-pino-seta {
  display: none;
  font-size: 26px;
  line-height: 1;
  font-style: normal;
  color: var(--nk-pino-cor);
  filter: drop-shadow(0 0 4px rgba(0, 0, 0, 0.95));
  transform: rotate(var(--nk-pino-giro, 0deg));
}

/* FORA DA TELA: a seta aponta o rumo, o anel sai de cena. */
.nk-pino.fora .nk-pino-anel { display: none; }
.nk-pino.fora .nk-pino-seta { display: block; }

.nk-pino-d {
  font-family: var(--nk-fonte, inherit);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #fff;
  -webkit-text-stroke: 2px rgba(0, 0, 0, 0.85);
  paint-order: stroke fill;
}

/* O ALVO TRAVADO é maior e pulsa. Ele é o único pino que descreve uma decisão
   sua — os outros descrevem o mundo —, e sem essa separação a bússola vira uma
   lista em que a pessoa contra quem você está lutando some no meio. */
.nk-pino.travado {
  --nk-pino-cor: #fff2b0;
  animation: nk-pino-pulso 0.9s ease-in-out infinite;
}
.nk-pino.travado .nk-pino-seta { font-size: 34px; }
.nk-pino.travado .nk-pino-anel { width: 38px; height: 38px; border-width: 3px; }

@keyframes nk-pino-pulso {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.6); }
}

.nk-marcas { position: absolute; inset: 0; z-index: 2; }

.nk-marca {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
  opacity: 0;
}

/* Um arco grosso apontando para FORA, a 140 px do centro. Grande de propósito:
   ele tem de ser lido pela visão periférica, que é onde ele aparece — se
   exigisse que o olho saísse da mira para ser notado, teria custado justamente
   o que veio avisar. */
.nk-marca::before {
  content: "";
  position: absolute;
  left: -46px;
  top: -152px;
  width: 92px;
  height: 34px;
  background: linear-gradient(
    180deg,
    rgba(255, 246, 240, 0.95) 0%,
    rgba(255, 86, 58, 0.95) 34%,
    rgba(210, 30, 14, 0) 100%
  );
  clip-path: polygon(50% 0%, 100% 100%, 50% 74%, 0% 100%);
  filter: drop-shadow(0 0 5px rgba(0, 0, 0, 0.95));
}

/* ================================================================ kill feed --
   Encostado embaixo da placa do alvo, no mesmo canto: as duas coisas falam do
   mesmo assunto — os outros. */

.nk-feed {
  position: absolute;
  /* Logo abaixo de onde a placa do alvo termina — nem colado nela, nem com um
     vão que faça as duas coisas parecerem de assuntos diferentes. */
  top: 118px;
  right: 16px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.nk-feed-linha {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 11px;
  background: var(--nk-vidro);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-left: 3px solid rgba(255, 255, 255, 0.35);
  border-radius: 4px;
  font-size: 13px;
  font-weight: 800;
  white-space: nowrap;
  animation: nk-feed-entra 0.22s ease-out;
}

.nk-feed-linha .nk-golpe {
  color: var(--nk-ki);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.nk-feed-linha .nk-seta { color: var(--nk-fraca); }

/* A linha que fala de VOCÊ tem borda dourada. Numa sala de quinze, o feed
   inteiro é ruído menos as duas linhas que são suas. */
.nk-feed-linha.nk-meu { border-left-color: var(--nk-ouro); background: rgba(48, 34, 6, 0.62); }

@keyframes nk-feed-entra {
  from { opacity: 0; transform: translateX(16px); }
}

/* ==================================================================== placar */

.nk-placar {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 3;
  min-width: 224px;
  padding: 8px 10px 9px;
  background: var(--nk-vidro);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(5px);
}

.nk-placar-topo {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
  padding-bottom: 5px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--nk-fraca);
}

.nk-placar-titulo { color: var(--nk-ouro); }

.nk-placar-linha {
  display: grid;
  grid-template-columns: 9px 1fr auto auto;
  align-items: center;
  gap: 8px;
  padding: 2px 4px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 800;
}

.nk-placar-cor { width: 9px; height: 9px; border-radius: 50%; }

.nk-placar-nome {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nk-placar-k { color: #8dffa8; min-width: 2.5ch; text-align: right; }
.nk-placar-d { color: rgba(255, 140, 130, 0.85); min-width: 2.5ch; text-align: right; }

.nk-placar-linha.nk-eu { background: rgba(255, 211, 77, 0.16); }
.nk-placar-linha.nk-eu .nk-placar-nome { color: var(--nk-ouro); }

/* ============================================================ faixa e avisos */

.nk-faixa {
  position: absolute;
  left: 50%;
  top: 26%;
  z-index: 5;
  transform: translateX(-50%);
  padding: 8px 26px;
  font-size: clamp(24px, 3.6vw, 46px);
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
  animation: nk-faixa-entra 0.32s cubic-bezier(0.16, 1.4, 0.4, 1);
}

@keyframes nk-faixa-entra {
  from { opacity: 0; transform: translateX(-50%) scale(1.45); }
}

/* O mais NOVO fica embaixo, encostado no canto, e os velhos sobem e somem pelo
   topo. Como a pilha é ancorada por baixo, quem expira não empurra ninguém: o
   aviso que a pessoa está lendo não pula de lugar por causa do que morreu. */
.nk-avisos {
  position: absolute;
  left: 16px;
  bottom: 16px;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
}

.nk-aviso {
  padding: 5px 12px;
  background: var(--nk-vidro);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  font-size: 13px;
  font-weight: 800;
  white-space: nowrap;
  animation: nk-aviso-entra 0.2s ease-out;
}

@keyframes nk-aviso-entra {
  from { opacity: 0; transform: translateY(8px); }
}

/* ================================================================ estar morto
   Escurece tudo e põe UM NÚMERO no meio. O jogador não tem o que mirar, não tem
   o que decidir e não tem o que ler: a única pergunta é quanto falta. */

.nk-morte {
  position: absolute;
  inset: 0;
  z-index: 9;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: radial-gradient(ellipse at center, rgba(60, 0, 0, 0.45), rgba(2, 4, 8, 0.86));
  animation: nk-morte-entra 0.5s ease-out;
}

@keyframes nk-morte-entra { from { opacity: 0; } }

/* CAÍDO NÃO TEM MIRA. Ela ficava por cima da contagem, oferecendo pontaria a
   quem não tem corpo — e o HUD não precisa esperar o laço mandar apagá-la para
   saber disso: estar morto é um estado que ele já conhece. */
.nk-hud.nk-morto .nk-mira { display: none; }

.nk-morte-titulo {
  font-size: clamp(28px, 4.4vw, 58px);
  font-weight: 900;
  letter-spacing: 0.16em;
  color: #ff5a45;
}

.nk-morte-num {
  font-size: clamp(72px, 12vw, 150px);
  font-weight: 900;
  line-height: 0.95;
  color: #ffffff;
}

.nk-morte-sub {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--nk-fraca);
}

/* ================================================================ os atalhos
   Este modo tem teclas que o arqueiro não tem, e nenhuma delas é descobrível
   com o mouse. Um painel que ninguém abre é melhor que uma tecla que ninguém
   encontra. */

.nk-ajuda {
  position: absolute;
  left: 50%;
  /* TOPO, não centro. O menu (Esc) também se centraliza na tela e fica em
     cima dela — z-index 40 contra o 8 antigo daqui —, então os dois disputando
     o mesmo miolo escondia esta ficha inteira atrás do cartão do menu. Ancorada
     no topo ela sobra sempre visível ACIMA do cartão, os dois abrem juntos no
     mesmo Esc e nenhum tampa o outro. */
  top: 3vh;
  z-index: 41;
  transform: translateX(-50%);
  overflow-y: auto;
  /* LARGURA EXPLÍCITA, e não 'max-width'. Um bloco posicionado sem largura
     encolhe até o conteúdo, e uma grade de 'auto-fit' dentro de um contêiner de
     largura indefinida resolve para UMA coluna — o painel virava uma tira alta
     que estourava a altura da tela e cortava o título. Com a largura definida,
     as três colunas cabem lado a lado e ele nunca passa de meia tela. */
  width: min(94vw, 800px);
  max-height: 40vh;
  padding: 18px 22px 16px;
  background: rgba(6, 12, 22, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 14px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.65);
}

.nk-ajuda-titulo {
  margin-bottom: 12px;
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--nk-ouro);
}

.nk-ajuda-grades {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 14px 22px;
  align-items: start;
}

.nk-ajuda-grupo h4 {
  margin-bottom: 6px;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--nk-ki);
}

.nk-ajuda-grupo {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  align-items: center;
  font-size: 12.5px;
}

.nk-ajuda-grupo h4 { grid-column: 1 / -1; }

.nk-teclas { display: flex; gap: 3px; justify-self: start; }

.nk-teclas kbd {
  min-width: 20px;
  padding: 2px 5px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-bottom-width: 2px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 11px;
  font-weight: 900;
  text-align: center;
}

.nk-ajuda-acao { color: rgba(240, 248, 255, 0.86); font-weight: 700; }

.nk-ajuda-rodape {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.14);
  font-size: 11.5px;
  font-weight: 700;
  color: var(--nk-fraca);
}

/* ========================================================= a porta de entrada
   A tela escura do primeiro clique. Ver 'ui/porta.js' para o porquê dela; aqui
   está só o porquê de cada número.

   O Z-INDEX É A PEÇA QUE FAZ ELA NASCER NA HORA CERTA, e ele está preso entre
   duas coisas que existem fora deste arquivo:

     • acima de todo o HUD (o maior lá dentro é 9, a tela de morte);
     • ABAIXO DA TELA DE ENTRADA ('#lobby', z-index 20 em 'src/style.css'). Isto
       não é detalhe: a porta é montada junto com o resto do modo, enquanto a
       pessoa ainda está digitando o apelido. Passando por baixo do lobby ela
       fica invisível e inalcançável até ele sair — e quando ele sai, some com
       meio segundo de transição e a REVELA. A abertura não custou uma linha de
       coordenação com o lobby;
     • abaixo do menu geral ('.nk-menu', z-index 40), que é a única coisa que
       pode legitimamente cobri-la.

   'pointer-events: auto' porque o '#ui' inteiro é 'none' — e a porta é
   justamente a exceção: ela precisa comer o clique para que ele não vire um
   tiro de ki no primeiro quadro. */

.nk-porta {
  position: absolute;
  inset: 0;
  z-index: 12;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  cursor: pointer;
  user-select: none;
  /* VINHETA, e não preto chapado: o mundo continua desenhando por baixo e é
     isso que faz a tela parecer uma ABERTURA e não um erro. O meio fica mais
     claro que as bordas de propósito — quem chega vê a arena para onde está
     indo. */
  background: radial-gradient(
    ellipse at center,
    rgba(3, 10, 18, 0.6) 12%,
    rgba(1, 4, 9, 0.9) 100%
  );
  backdrop-filter: blur(2px);
  animation: nk-porta-entra 0.3s ease-out;
}

/* O atributo 'hidden' contra um 'display: flex' não vale nada sem isto. */
.nk-porta[hidden] { display: none !important; }

@keyframes nk-porta-entra { from { opacity: 0; } }

.nk-porta-miolo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 0 24px;
  text-align: center;
}

.nk-porta-selo {
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  color: var(--nk-ouro);
}

/* A CHAMADA PULSA, e o pulso é o único trabalho desta tela: ele diz que a
   página não travou, que alguém está esperando você, e que a coisa a fazer é a
   que está escrita. Sem ele, uma frase parada no meio de uma tela escura é
   indistinguível de um carregamento emperrado. */
.nk-porta-chamada {
  font-size: clamp(26px, 4.6vw, 56px);
  font-weight: 900;
  letter-spacing: 0.08em;
  line-height: 1.05;
  text-transform: uppercase;
  animation: nk-porta-pulso 1.7s ease-in-out infinite;
}

@keyframes nk-porta-pulso {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.72; transform: scale(0.985); }
}

/* -------------------------------------------------------------- as dicas ---
   Três lembretes, e nenhum deles escrito aqui: saem do primeiro item de cada
   grupo de 'CONTROLES' (ver 'ui/porta.js'). */

.nk-porta-dicas {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px 16px;
  margin-top: 6px;
  max-width: min(92vw, 720px);
}

.nk-porta-dica {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px 5px 8px;
  background: var(--nk-vidro);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 800;
}

.nk-porta-dica-acao { color: rgba(240, 248, 255, 0.84); }

.nk-porta kbd {
  min-width: 20px;
  padding: 2px 5px;
  background: rgba(255, 255, 255, 0.13);
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-bottom-width: 2px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 11px;
  font-weight: 900;
  text-align: center;
}

.nk-porta-rodape {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--nk-fraca);
}

/* ESPERANDO A TRAVA. O gesto já saiu e o navegador ainda não devolveu o
   ponteiro (o "too soon" de quem acabou de sair de um lock). A chamada para de
   pulsar — o pedido já foi atendido, insistir nele seria mentira — e o rodapé
   passa a dizer o que está acontecendo. */
.nk-porta--esperando .nk-porta-chamada {
  animation: none;
  opacity: 0.55;
}

/* ------------------------------------------------------------------ telinha --
   Abaixo de 1000 px de largura a placa encolhe em vez de vazar por cima da
   mira. Nada some: o que este HUD mostra já é o mínimo. */
@media (max-width: 1000px) {
  .nk-hud .nk-vida { height: 22px; }
  .nk-hud .nk-vida-num { font-size: 24px; }
  .nk-hud .nk-retrato { width: 50px; height: 50px; }
  .nk-hud .nk-especiais { margin-left: 60px; }
  .nk-hud .nk-esp-nome { display: none; }
}

/* Quem pediu menos movimento leva menos movimento. As animações deste HUD
   informam, então elas não somem — param de repetir. */
@media (prefers-reduced-motion: reduce) {
  .nk-hud *,
  .nk-hud *::before,
  .nk-porta,
  .nk-porta * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;
