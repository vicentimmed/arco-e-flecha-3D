/* ---------------------------------------------------------------------------
   Uma função por ação. Nada aqui toca em Three.js.

   Uma "pose" é um punhado de números: onde estão as mãos e os pés, quanto o
   tronco girou, quanto o punho fechou. Quem transforma isso em osso é o
   `Fighter`; quem decide qual pose vale agora, também. Aqui só existe a
   descrição de cada atitude — e isso é o que permite MISTURAR duas delas, que é
   a coisa mais importante do arquivo.

   ---------------------------------------------------------------- a mistura

   O que faz um lutador da referência parecer vivo não é a quantidade de poses:
   é nunca haver um corte entre duas. Parar de correr, entrar em voo, largar a
   carga de ki para levar um soco — tudo isso é o mesmo `misturarPose` com um
   peso que o `Fighter` amortece com `damp`. Uma pose que "entra de uma vez"
   parece um boneco trocado por outro, e é o defeito que se enxerga de longe
   mesmo sem saber nomear.

   Por isso TODA função aqui escreve uma pose COMPLETA (é o que `zerar` garante,
   e é o primeiro comando de todas elas). Uma pose que só escreve os braços
   parece funcionar — até ser misturada com peso 0,4 e as pernas ficarem no meio
   do caminho entre o que ela não escreveu e o lixo do quadro anterior.

   A ORDEM em que elas se cobrem é decidida pelo `Fighter` (ver `montarPose`), e
   está repetida aqui porque é ela que explica por que cada uma pode ser
   descuidada com o que a outra já resolveu:

       parado → locomoção → voo → arrancada → carga → DEFESA → especial → queda
              → (rajada por cima) → dor → arremesso → morte

   `poseDefesa` entra depois da carga e antes do especial: defender interrompe
   quem estava juntando ki, e um especial já em curso não é interrompido por
   ela. As duas ÚNICAS que não são poses completas são a rajada, que é camada de
   um braço só (`aplicarRajada`), e a morte, que não olha o contexto.

   ------------------------------------------------------------- convenções

   • Espaço do ROOT: origem nos pés, −Z para a frente, +X à direita, metros.
   • Todo campo `*Pitch` é positivo PARA A FRENTE / PARA BAIXO — tronco que se
     curva à frente, queixo que desce. O `Fighter` converte com um sinal só, e
     ter a convenção escrita uma vez evita o inferno de descobrir por tentativa
     o sentido de cada rotação.
   • `inclinacao` é o corpo inteiro: 0 em pé, 1 deitado de bruços (voo rasante),
     −1 deitado de costas (morte). Ela vira `rotation.x` no root.
   • `punho` é 0 mão aberta, 1 punho cerrado. `estica` é um ganho de alcance
     dado à IK: sem ele o braço "estendido" trava no cotovelo, que é o erro mais
     comum de IK de dois ossos e lê imediatamente como boneco de pau.
   --------------------------------------------------------------------------- */

import { NAMEK } from "../../shared/namek/config.js";
import { clamp, lerp, smoothstep } from "../../utils/math.js";
import { OSSO } from "./rig.js";

/** m — altura do pivô de rotação do corpo: o centro de massa que o config declara.
 *  O corpo inclina EM TORNO DO PEITO, não dos pés. Girar nos pés faria o lutador
 *  varrer o chão com a cabeça toda vez que mergulhasse. */
export const PIVO = NAMEK.fighter.chest;

const ANKLE = OSSO.ankleY;
const STANCE = OSSO.stanceWidth;

/** rad — `inclinacao` é 0..1 e vira ângulo de verdade multiplicada por isto.
 *  É a mesma conta que o `Fighter` faz para escrever `rotation.x` no root, e
 *  ela precisa existir aqui para a rajada saber o quanto o corpo está deitado. */
const MEIO_PI = Math.PI / 2;
/** m — altura do ombro CONTADA DO QUADRIL, que é onde o tronco gira. É com este
 *  braço de alavanca que se descobre para onde `spineYaw` e `spinePitch` levaram
 *  o ombro — ver `aplicarRajada`. */
const ALTO_TRONCO = OSSO.shoulderY - OSSO.hipY;

/** Uma pose zerada, com todos os campos que existem. Alocada uma vez por dono. */
export function criarPose() {
  return {
    /** 0 em pé … 1 de bruços … −1 de costas */
    inclinacao: 0,
    /** rad — inclinação lateral do corpo inteiro (a curva do voo) */
    rolagem: 0,
    /** m — deslocamento em Y do MUNDO (agacho, quique) */
    rootLift: 0,
    /** m — no eixo local +Z, ou seja, PARA TRÁS (recuo) */
    rootPush: 0,
    /** m — no eixo local +X (peso de um pé para o outro) */
    rootSide: 0,
    spinePitch: 0,
    spineYaw: 0,
    /** rad — rotação em Z do tronco, crua */
    spineRoll: 0,
    headPitch: 0,
    headYaw: 0,
    handR: { x: 0, y: 0, z: 0 },
    handL: { x: 0, y: 0, z: 0 },
    poleR: { x: 0, y: 0, z: 0 },
    poleL: { x: 0, y: 0, z: 0 },
    footR: { x: 0, y: 0, z: 0 },
    footL: { x: 0, y: 0, z: 0 },
    kneeR: { x: 0, y: 0, z: 0 },
    kneeL: { x: 0, y: 0, z: 0 },
    punhoR: 0,
    punhoL: 0,
    /** rad — torção do punho: para onde a palma olha */
    giroR: 0,
    giroL: 0,
    esticaR: 0,
    esticaL: 0,
    /** 0 pé neutro … 1 ponta esticada (voo) */
    pontaR: 0,
    pontaL: 0,
    /** rad — para onde a ponta do pé aponta */
    peGiro: 0,
    /** 0 cabelo em pé … 1 jogado para trás pelo vento/ki */
    cabelo: 0,
  };
}

const v3 = (o, x, y, z) => {
  o.x = x;
  o.y = y;
  o.z = z;
};

/**
 * A pose neutra: de pé, braços ao lado do corpo, joelhos de leve.
 *
 * Todas as funções começam por aqui para que nenhuma delas precise escrever os
 * quarenta campos — e, mais importante, para que nenhuma possa ESQUECER um.
 */
export function zerar(p) {
  p.inclinacao = 0;
  p.rolagem = 0;
  p.rootLift = 0;
  p.rootPush = 0;
  p.rootSide = 0;
  p.spinePitch = 0;
  p.spineYaw = 0;
  p.spineRoll = 0;
  p.headPitch = 0;
  p.headYaw = 0;
  v3(p.handR, 0.3, 0.98, -0.14);
  v3(p.handL, -0.3, 0.98, -0.14);
  /* Cotovelo para FORA, para baixo e para trás. Sem um polo definido a IK
     escolhe um plano arbitrário e os braços dobram para dentro do tórax. */
  v3(p.poleR, 0.9, -0.35, 0.28);
  v3(p.poleL, -0.9, -0.35, 0.28);
  v3(p.footR, STANCE, ANKLE, 0);
  v3(p.footL, -STANCE, ANKLE, 0);
  // Joelho para a FRENTE: é o que faz a perna agachar em vez de abrir de lado.
  v3(p.kneeR, 0.14, 0.15, -1);
  v3(p.kneeL, -0.14, 0.15, -1);
  p.punhoR = 0.4;
  p.punhoL = 0.4;
  p.giroR = 0;
  p.giroL = 0;
  p.esticaR = 0;
  p.esticaL = 0;
  p.pontaR = 0;
  p.pontaL = 0;
  p.peGiro = 0;
  p.cabelo = 0;
  return p;
}

const misturarVec = (a, b, t) => {
  a.x = lerp(a.x, b.x, t);
  a.y = lerp(a.y, b.y, t);
  a.z = lerp(a.z, b.z, t);
};

/**
 * `a = a·(1−t) + b·t`, campo a campo.
 *
 * Escrita à mão em vez de um laço sobre `Object.keys`: enumerar chaves aloca um
 * array por chamada, e são dez misturas por lutador por quadro vezes quinze
 * lutadores — 9 000 arrays por segundo que o coletor viria cobrar exatamente no
 * meio de uma luta. Ver o §3 do plano: zero alocação em regime.
 */
export function misturarPose(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) t = 1;
  a.inclinacao = lerp(a.inclinacao, b.inclinacao, t);
  a.rolagem = lerp(a.rolagem, b.rolagem, t);
  a.rootLift = lerp(a.rootLift, b.rootLift, t);
  a.rootPush = lerp(a.rootPush, b.rootPush, t);
  a.rootSide = lerp(a.rootSide, b.rootSide, t);
  a.spinePitch = lerp(a.spinePitch, b.spinePitch, t);
  a.spineYaw = lerp(a.spineYaw, b.spineYaw, t);
  a.spineRoll = lerp(a.spineRoll, b.spineRoll, t);
  a.headPitch = lerp(a.headPitch, b.headPitch, t);
  a.headYaw = lerp(a.headYaw, b.headYaw, t);
  misturarVec(a.handR, b.handR, t);
  misturarVec(a.handL, b.handL, t);
  misturarVec(a.poleR, b.poleR, t);
  misturarVec(a.poleL, b.poleL, t);
  misturarVec(a.footR, b.footR, t);
  misturarVec(a.footL, b.footL, t);
  misturarVec(a.kneeR, b.kneeR, t);
  misturarVec(a.kneeL, b.kneeL, t);
  a.punhoR = lerp(a.punhoR, b.punhoR, t);
  a.punhoL = lerp(a.punhoL, b.punhoL, t);
  a.giroR = lerp(a.giroR, b.giroR, t);
  a.giroL = lerp(a.giroL, b.giroL, t);
  a.esticaR = lerp(a.esticaR, b.esticaR, t);
  a.esticaL = lerp(a.esticaL, b.esticaL, t);
  a.pontaR = lerp(a.pontaR, b.pontaR, t);
  a.pontaL = lerp(a.pontaL, b.pontaL, t);
  a.peGiro = lerp(a.peGiro, b.peGiro, t);
  a.cabelo = lerp(a.cabelo, b.cabelo, t);
  return a;
}

/* ------------------------------------------------------------------- parado

   Respiração e uma guarda de luta leve. É a pose que mais tempo fica na tela e
   a que menos gente olha — e é justamente por isso que ela precisa se mexer:
   um boneco perfeitamente imóvel entre duas ações mata o personagem mais rápido
   que qualquer animação feia.

   Três osciladores de períodos primos entre si (respiração, troca de peso,
   micro-ajuste do tronco) — se fossem harmônicos o corpo pulsaria em bloco, que
   é o que faz um "idle" parecer um metrônomo. */
export function poseParado(p, ctx) {
  zerar(p);
  const r = Math.sin(ctx.t * 1.8 + ctx.fase);
  const peso = Math.sin(ctx.t * 0.62 + ctx.fase * 1.7);

  p.rootLift = -0.014 + r * 0.007;
  p.rootSide = peso * 0.014;
  p.spinePitch = 0.05 - r * 0.022;
  // Ombros de leve para o lado: ninguém que sabe brigar fica de peito aberto.
  p.spineYaw = 0.15;
  p.spineRoll = peso * 0.02;
  p.headPitch = -0.02 + r * 0.01;

  v3(p.handR, 0.3, 1.0 + r * 0.008, -0.17);
  v3(p.handL, -0.28, 0.98 + r * 0.008, -0.21);
  p.punhoR = 0.5;
  p.punhoL = 0.5;

  // Pé esquerdo à frente, pontas ligeiramente abertas — base de luta.
  v3(p.footR, STANCE, ANKLE, 0.08);
  v3(p.footL, -STANCE * 1.05, ANKLE, -0.1);
  p.peGiro = 0.14;
}

/* ------------------------------------------------------- andar e correr

   Uma função só para as duas, misturadas por `ctx.run`, e não duas funções.
   Andar e correr não são poses diferentes: são a MESMA passada com amplitude,
   inclinação e cadência maiores. Separá-las obrigaria a interpolar duas
   descrições do mesmo ciclo, e o resultado clássico disso é o pé patinando no
   meio da transição.

   A fase (`ctx.gait`) vem de fora e é medida em distância percorrida, não em
   segundos — quem alimenta é o dono, e é o mesmo número que viaja na rede. */
export function poseLocomocao(p, ctx) {
  zerar(p);
  const run = ctx.run;
  const amp = 0.24 + 0.18 * run;
  const alto = 0.09 + 0.11 * run;
  /* O braço BALANÇA com o cotovelo dobrado — a mão fica na altura das
     costelas, não pendurada. Além de ser como se corre, é o que mantém a mão
     dentro do alcance do ombro: com o braço estendido a passada larga da
     corrida jogava a mão 5 cm além do que o braço alcança, a IK travava o
     cotovelo e o lutador corria com dois cabos de vassoura no lugar dos braços. */
  const braco = 0.13 + 0.17 * run;
  const g = ctx.gait;
  const cosR = Math.cos(g);
  const cosL = -cosR; // as duas pernas em contrafase exata
  const senR = Math.sin(g);

  p.spinePitch = 0.1 + 0.32 * run;
  p.spineYaw = senR * 0.16 * (1 + run);
  // Dois toques de pé por ciclo: o quique tem o DOBRO da frequência do passo.
  p.rootLift = -0.02 - 0.055 * run + Math.sin(g * 2) * (0.016 + 0.022 * run);
  p.headPitch = -0.05 - 0.06 * run;

  /* O pé anda no plano do movimento: a componente frontal desloca em Z e a
     lateral em X, na proporção do vetor de marcha. É o que dá a diagonal de
     graça e o que inverte o ciclo sozinho ao andar de ré (`moveF` negativo). */
  v3(
    p.footR,
    STANCE * 0.86 + cosR * amp * 0.5 * ctx.moveS,
    ANKLE + Math.max(0, -senR) * alto,
    -cosR * amp * ctx.moveF,
  );
  v3(
    p.footL,
    -STANCE * 0.86 + cosL * amp * 0.5 * ctx.moveS,
    ANKLE + Math.max(0, senR) * alto,
    -cosL * amp * ctx.moveF,
  );

  // Braço oposto à perna, como qualquer bípede — e o balanço sobe com a corrida.
  v3(p.handR, 0.26 + 0.02 * run, 1.02 - 0.04 * run, -0.1 - cosL * braco);
  v3(p.handL, -0.26 - 0.02 * run, 1.02 - 0.04 * run, -0.1 - cosR * braco);
  v3(p.poleR, 0.85, -0.45, 0.3);
  v3(p.poleL, -0.85, -0.45, 0.3);
  p.punhoR = 0.35 + 0.6 * run;
  p.punhoL = 0.35 + 0.6 * run;
  p.peGiro = 0.05;
  p.cabelo = 0.18 * run;
}

/* ---------------------------------------------------------------------- voo

   Corpo inclinado, braços recolhidos, pernas juntas com a ponta do pé esticada.
   A inclinação segue a MIRA: quem olha para baixo mergulha, quem olha para cima
   sobe de peito. Sem isso o lutador voa sempre no mesmo ângulo e o voo lê como
   um trilho, que é exatamente o que o §"agilidade" do config quer evitar.

   A cabeça compensa a inclinação do corpo (`headPitch` negativo = queixo para
   cima): ninguém voa olhando para o próprio umbigo. */
export function poseVoo(p, ctx) {
  zerar(p);
  const inc = clamp(0.5 - ctx.pitch * 0.55, -0.15, 1.05);
  p.inclinacao = inc;
  p.headPitch = -inc * 0.72;
  p.spinePitch = -0.08;

  // Cotovelos junto às costelas, punhos fechados à frente do peito.
  v3(p.handR, 0.2, 1.1, -0.24);
  v3(p.handL, -0.2, 1.1, -0.24);
  v3(p.poleR, 0.55, -0.75, 0.35);
  v3(p.poleL, -0.55, -0.75, 0.35);
  p.punhoR = 1;
  p.punhoL = 1;

  // Pernas quase juntas e levemente dobradas, tornozelo esticado.
  v3(p.footR, 0.095, ANKLE + 0.03, 0.16);
  v3(p.footL, -0.095, ANKLE + 0.02, 0.14);
  v3(p.kneeR, 0.2, 0.1, -1);
  v3(p.kneeL, -0.2, 0.1, -1);
  p.pontaR = 0.85;
  p.pontaL = 0.85;
  p.cabelo = 0.45;
}

/* ------------------------------------------------------- voo rápido / arranque

   Quase horizontal, braços atrás ao longo do corpo, pernas retas e juntas,
   cabelo todo jogado para trás. É a pose de bala da referência, e a diferença
   dela para o voo normal é o que faz o arranque de ki PARECER rápido antes de
   qualquer partícula: o corpo deixa de ser um homem voando e vira uma linha. */
export function poseArrancada(p, ctx) {
  zerar(p);
  const inc = clamp(0.96 - ctx.pitch * 0.45, 0.2, 1.3);
  p.inclinacao = inc;
  p.headPitch = -inc * 0.86;
  p.spinePitch = -0.06;

  // Punhos para trás, colados ao quadril: os braços viram estabilizadores.
  v3(p.handR, 0.24, 0.95, 0.24);
  v3(p.handL, -0.24, 0.95, 0.24);
  /* O polo do cotovelo vai para a FRENTE aqui. É o único lugar do corpo em que
     ele inverte, e é obrigatório: com o polo atrás, a IK dobra o cotovelo para
     trás junto com a mão e o braço se fecha num Z em vez de esticar. */
  v3(p.poleR, 0.7, -0.15, -0.55);
  v3(p.poleL, -0.7, -0.15, -0.55);
  p.punhoR = 1;
  p.punhoL = 1;
  p.esticaR = 0.03;
  p.esticaL = 0.03;

  v3(p.footR, 0.075, ANKLE - 0.02, 0.03);
  v3(p.footL, -0.075, ANKLE - 0.02, 0.01);
  p.pontaR = 1;
  p.pontaL = 1;
  p.cabelo = 1;
}

/* ------------------------------------------------------------- carregar ki

   A pose. Pernas abertas e joelhos fundos, punhos cerrados junto ao quadril e
   um pouco atrás, cotovelos escancarados para trás, tronco tenso e o queixo
   baixo. É a imagem que a série inteira usa para dizer "está juntando força", e
   ela funciona porque é uma posição em que ninguém consegue ficar muito tempo.

   O TREMOR é metade do efeito. Ele é feito de dois senos de frequência alta e
   incomensurável (41 e 53,7 Hz): dois senos harmônicos dariam uma vibração
   periódica que o olho reconhece como oscilação de máquina, e o que se quer é
   um corpo que não aguenta mais segurar. A amplitude sobe com `ctx.carga` — no
   começo é tensão, no fim é o corpo perdendo o controle. */
export function poseCarga(p, ctx) {
  zerar(p);
  const c = ctx.carga;
  const tr = Math.sin(ctx.t * 41 + ctx.fase * 7) * c;
  const tr2 = Math.sin(ctx.t * 53.7 + ctx.fase * 11) * c;

  p.inclinacao = 0.14;
  p.rootLift = -0.15 + tr * 0.011;
  p.rootSide = tr2 * 0.009;
  p.spinePitch = 0.12 - tr2 * 0.02;
  p.spineRoll = tr * 0.022;
  p.headPitch = -0.12;

  // Base larga, pontas dos pés abertas, joelhos empurrados para fora.
  v3(p.footR, 0.33, ANKLE, -0.02);
  v3(p.footL, -0.33, ANKLE, -0.02);
  v3(p.kneeR, 0.62, 0.18, -1);
  v3(p.kneeL, -0.62, 0.18, -1);
  p.peGiro = 0.3;

  // Punhos no quadril, ATRÁS da linha do corpo — é o "puxar" que a pose tem.
  v3(p.handR, 0.29, 1.02 + tr * 0.006, 0.16);
  v3(p.handL, -0.29, 1.02 - tr * 0.006, 0.16);
  v3(p.poleR, 0.75, -0.25, 0.72);
  v3(p.poleL, -0.75, -0.25, 0.72);
  p.punhoR = 1;
  p.punhoL = 1;

  // O cabelo levanta com o ki. É de graça (o penteado é um grupo só) e é a
  // metade da leitura de "ele está carregando" vista de longe.
  p.cabelo = -0.55 * c;
}

/* ------------------------------------------------------------------- defesa

   Os dois antebraços cruzados à frente do rosto e o corpo se encolhendo atrás
   deles. É a guarda da referência, e é a pose que precisa ser lida MAIS
   depressa de todas: enquanto ela está na tela o lutador está tomando dano
   reduzido e gastando ki, e quem está do outro lado precisa saber disso sem
   parar para reparar — de trinta metros, de costas e no meio de um tiroteio.

   O que carrega essa leitura é a SILHUETA, não o detalhe. Três coisas, nesta
   ordem de importância:

   • os COTOVELOS sobem ACIMA DA LINHA DO OMBRO e saem 29 cm à frente dele
     (medido: cotovelo em y 1,53 e z −0,39, contra um ombro em y 1,46 e z −0,10).
     São eles que se enxergam de trás — o par de pontas que aparece por cima dos
     ombros de um corpo que se encolheu, e é de trás que se vê metade das vezes
     em que alguém está defendendo. O que NÃO dá para ter é cotovelo aberto para
     os LADOS: numa guarda cruzada a mão está do lado oposto do corpo, o eixo
     ombro→mão fica quase todo lateral, e a IK então só pode jogar o cotovelo
     para a frente ou para trás — a parte do polo que aponta para fora é comida
     pela projeção. Varridas 432 combinações de mão e polo, o máximo que o
     cotovelo sai do eixo é 0,19 m, que é exatamente a meia-largura do peito:
     ele encosta na borda da silhueta e não passa dela por lado nenhum. Quem
     passa dela é a ALTURA, e é por isso que ela é o traço que importa;
   • as duas mãos se CRUZAM à frente do queixo, uma na frente da outra e não
     lado a lado — os 7 cm de diferença em Z e os 5 cm em Y são o que faz o X ter
     profundidade em vez de virar um traço só visto de frente. No cruzamento os
     dois antebraços se tocam e se atravessam uns dois centímetros: é assim que
     dois braços cruzados de verdade ficam, um apoiado no outro, e separá-los o
     bastante para não se tocarem abriria o X num V;
   • o corpo ENCOLHE — desce nove centímetros, curva o tronco e baixa o queixo.
     Um corpo ereto com os braços cruzados lê como quem está esperando, não como
     quem está aguentando.

   As mãos cruzam na altura do QUEIXO (y 1,555) e não dos olhos, e isso é medida
   e não gosto: a franja deste penteado avança até z −0,45, e na faixa de Z em
   que os punhos ficariam ela desce só até y 1,63 — ou seja, o cabelo ocupa
   exatamente o lugar de dois punhos erguidos à frente do rosto. Oito
   centímetros mais baixo os punhos passam por baixo dela, e a guarda continua
   cobrindo a cabeça inteira de quem olha de frente.

   Esta rig não tem cintura escapular (a mesma falta que `poseKamehameha`
   documenta), então "ombros encolhidos" aqui é `spinePitch` mais `rootLift`:
   o tronco se enrola e o corpo baixa. Não é a mesma coisa, mas a 30 m é a mesma
   imagem.

   O TREMOR é o de `poseCarga` com um terço da amplitude e frequências mais
   baixas (31 e 43,7 Hz, incomensuráveis entre si E com o par da carga, para que
   defender no fim de uma carga não faça os dois tremores baterem juntos). Quem
   defende está firme; o que treme é o esforço de continuar firme.

   Ela vale no chão E no ar, e é UMA pose só para os dois. No ar o corpo para de
   mergulhar e fica de pé atrás da guarda — que é o que a referência faz quando
   alguém se defende voando, e não um efeito colateral. As pernas são as mesmas
   nos dois casos e são estreitas de propósito: uma base larga demais fica com
   cara de agachamento de luta livre quando o lutador está a duzentos metros do
   chão.

   Separar os dois casos exigiria a pose saber que está voando, e o `ctx` não tem
   esse canal — quem monta o contexto é o `Fighter`, e ele conhece o `_fly`. Se
   um dia valer a pena juntar as pernas no ar, o caminho é um campo a mais lá e
   um `lerp` a menos aqui; até lá, ter duas versões de uma pose só para as botas
   custa mais do que rende. */
export function poseDefesa(p, ctx) {
  zerar(p);
  const tr = Math.sin(ctx.t * 31 + ctx.fase * 5);
  const tr2 = Math.sin(ctx.t * 43.7 + ctx.fase * 9);

  /* O corpo se encolhe: inclina de leve, desce, recua e enrola o tronco. O
     `rootPush` é o recuo de quem já está absorvendo — a guarda não espera o
     golpe parada, ela cede. */
  p.inclinacao = 0.13;
  p.rootLift = -0.09 + tr * 0.004;
  p.rootSide = tr2 * 0.003;
  p.rootPush = 0.05;
  p.spinePitch = 0.2 + tr * 0.008;
  p.spineRoll = tr2 * 0.009;
  /* Ombros ESQUADRADOS com a ameaça: `spineYaw` fica em zero, e é o contrário
     de tudo o que as outras poses fazem (parado, corrida e rajada abrem o
     ombro). Um corpo de lado oferece o flanco; quem defende dá o peito, porque
     é atrás dele que estão os dois braços. */
  p.spineYaw = 0;
  /* O queixo desce, mas pouco: o tronco já se curvou 0,2 e a inclinação somou
     mais 0,13, e o rosto já está olhando por cima dos próprios punhos. O termo
     da MIRA é o que impede a guarda de virar uma pose cega — quem se defende de
     um tiro que vem de cima continua olhando para cima, e é o único pedaço
     desta pose que o jogador controla enquanto ela está na tela. */
  p.headPitch = 0.1 - Math.sin(ctx.pitch) * 0.5;

  /* Base ESTREITA e firme, com o pé esquerdo atrás: é uma base para resistir a
     um empurrão de frente, não para se mexer. Joelhos à frente (o `-1` em Z
     manda a perna agachar em vez de abrir), e o corpo já desceu nove
     centímetros por cima deles. */
  v3(p.footR, 0.21, ANKLE, -0.05);
  v3(p.footL, -0.2, ANKLE, 0.1);
  v3(p.kneeR, 0.3, 0.16, -1);
  v3(p.kneeL, -0.28, 0.16, -1);
  p.peGiro = 0.2;
  // Um resto de ponta de pé: no chão são sete graus que ninguém vê, e no ar são
  // o que impede as duas botas de ficarem plantadas num chão que não existe.
  p.pontaR = 0.12;
  p.pontaL = 0.12;

  /* O X. A mão DIREITA vai para o lado esquerdo e a esquerda para o direito — é
     o cruzamento que dá nome à pose. A direita passa POR FORA: 7 cm à frente em
     Z e 5 cm mais alta. Elas cruzam a só 8,5 cm do eixo do corpo, e é de
     propósito: quanto mais a mão atravessa para o lado oposto, mais o eixo
     ombro→mão fica deitado e mais o cotovelo é obrigado a cair para o meio do
     peito, onde ele desaparece. Oito centímetros e meio são o cruzamento mais
     largo que ainda deixa o cotovelo na borda da silhueta. */
  v3(p.handR, -0.085, 1.555, -0.385);
  v3(p.handL, 0.085, 1.505, -0.315);
  /* O polo quase não tem componente vertical (−0,12) e volta um pouco para TRÁS
     (+0,12), o que é contraintuitivo e é o que funciona: com o eixo do braço
     apontando para a frente e para o lado, é a parte do polo que sobra depois da
     projeção que manda, e esta combinação é a que leva o cotovelo mais para fora
     e mais para cima. Um polo apontado para baixo e para a frente — o palpite
     óbvio — punha os dois cotovelos a 9 cm do eixo, escondidos atrás do peito. */
  v3(p.poleR, 1, -0.12, 0.12);
  v3(p.poleL, -1, -0.12, 0.12);
  p.punhoR = 1;
  p.punhoL = 1;
  /* AS COSTAS DAS MÃOS PARA FORA — bloqueia-se com o lado de fora do antebraço,
     nunca com a palma. Sem esta torção o rig entrega o contrário do que se quer:
     a rotação mínima que `orientSegment` produz deixa as duas palmas olhando
     para a FRENTE (medido: palma em −Z com `giro` = 0), ou seja, o lutador
     receberia o golpe com as mãos abertas para ele. 2,6 rad viram as duas: a
     palma passa a olhar para trás e para baixo (0,93 e 0,78 de componente +Z,
     direita e esquerda) e quem encara o tiro são os nós dos dedos. O mesmo valor
     nos dois lados, e não `±`: as duas mãos apontam os dedos em sentidos opostos,
     então a torção que as espelha é a mesma, não a oposta. */
  p.giroR = 2.6;
  p.giroL = 2.6;

  // Nem levantado pelo ki nem jogado pelo vento: o cabelo só acompanha o corpo
  // que se enrolou para a frente.
  p.cabelo = 0.2;
}

/* -------------------------------------------------------------- rajada de ki

   CAMADA, não pose: ela entra por cima do que já está montado e mexe num braço
   só. Foi feita assim porque a rajada acontece ANDANDO, VOANDO e no meio de um
   arranque — se fosse uma pose completa, atirar enquanto voa devolveria o corpo
   à posição de pé por uma fração de segundo, que é o defeito clássico de quem
   trata tiro como estado em vez de como sobreposição.

   `forca` é o `handPose` do protocolo: 1 no instante do disparo, decaindo. A
   alternância esquerda/direita vem de `ctx.mao` (o `lastHand`), e é ela que dá o
   ritmo de metralhadora da referência — seis bolas por segundo, uma de cada
   mão.

   ------------------------------------------------- o braço tem de ESTICAR

   A leitura desta camada é UMA SÓ: o braço inteiro projetado à frente, na
   direção da mira, com a mão aberta na ponta e o ombro indo junto. Três coisas
   impediam isso, e as três estão MEDIDAS na bancada (um `Fighter` a 60 Hz
   levando uma rajada de seis tiros por segundo):

   1. **`forca` nunca chegava perto de 1.** Ela é o `handPose` passando por dois
      amortecimentos em série no `Fighter` — o decaimento do canal (k = 8,5) e o
      espelho `_hand` que o persegue (k = 18) —, e o alvo desce mais depressa do
      que o espelho sobe. O PICO medido é **0,48** num tiro solto e oscila entre
      0,36 e **0,58** numa rajada sustentada. Ou seja: a camada nunca aplicava
      mais que metade de si mesma, e o braço ia até o meio do caminho e voltava.
      É o que o `GANHO` conserta.
   2. **O alvo da mão estava perto demais.** Ele ficava a 0,53 m do ombro num
      braço que alcança 0,66 — 80 % do alcance, cotovelo aberto em 87°. Um braço
      a 87° não é um braço esticado: é um braço dobrado em ângulo reto.
   3. **A direção não descontava a INCLINAÇÃO DO CORPO**, e este é o caso do
      voo — o pior de todos. A pose escreve no espaço do ROOT, e voando o root
      está deitado uns 45° para a frente; um alvo "à frente" no root aponta 45°
      para BAIXO no mundo. Medido: o eixo da mão (o cano de onde `handPoint`
      tira a bola) saía **49° fora da mira** voando e **109° num arranque**, ou
      seja, a bola nascia de uma mão apontada para trás enquanto o tiro ia para
      a frente.

   A correção dos três é o corpo do que está escrito abaixo, nesta ordem: gira o
   tronco, DESCOBRE onde o ombro foi parar, e põe a mão a um braço inteiro dali
   na elevação da mira já convertida para o espaço do corpo.

   O que esta camada deliberadamente NÃO faz é mexer em pernas, inclinação,
   cabelo ou ponta do pé. É o que mantém a leitura de voo (corpo deitado, pernas
   juntas, cabelo para trás) inteira enquanto o braço dispara.
 */

/** Em quanto de `forca` a camada já vale por inteiro.
 *
 *  Meio canal é a extensão toda — e é isso porque `forca` medida no pico vale
 *  0,48 (tiro solto) e 0,58 (rajada), nunca 1. Com `smoothstep` o começo
 *  continua suave (não há estalo no primeiro quadro) e o rabo do decaimento
 *  continua trazendo o braço de volta devagar; o que muda é o meio, que agora
 *  satura. Entre dois tiros de uma rajada o valor cai a ~0,81 e volta a 1 — os
 *  sete centímetros de vaivém que sobram são o coice, e são bem-vindos. */
const GANHO = 0.5;
/** rad — quanto o TRONCO gira para levar o ombro do tiro à frente. Era 0,22,
 *  mas com `forca` valendo meio isso rendia 0,10 de verdade: o ombro
 *  praticamente não saía do lugar. */
const OMBRO_GIRO = 0.3;
/** m — a que distância do ombro a mão vai parar.
 *
 *  O braço tem 0,57 m de osso e ganha `RAJADA_ESTICA` nos dois segmentos, o que
 *  dá 0,67 m de alcance: 0,655 são 97,8 % dele, e é aí que o cotovelo fica em
 *  ~156°, com sete centímetros de arco. É o máximo que se pode pedir sem cair na
 *  armadilha que `poseBraco` documenta — a 100 % a IK põe o cotovelo na reta, a
 *  junta some e o braço vira um cabo de vassoura. "Esticar o braço todo" é isto:
 *  alcance cheio com a curvatura mínima, não uma vara. */
const RAJADA_ALCANCE = 0.655;
/** Ganho de alcance dado à IK. 0,05 é o teto da casa — é o mesmo que Kamehameha,
 *  Genki Dama e o Disco usam no empurrão. */
const RAJADA_ESTICA = 0.05;
/** Quanto a mão converge para a linha do meio. O braço não sai paralelo ao
 *  corpo: quem empurra a mão contra um alvo à frente traz o punho para dentro.
 *  22 % dos 20 cm de ombro são 4,5 cm — 4° de convergência, o bastante para a
 *  mão ficar perto do retículo sem o braço atravessar o peito. */
const RAJADA_CONVERGE = 0.22;
/** rad — torção do punho. A palma nasce virada para BAIXO num braço apontado à
 *  frente (é a rotação mínima que `orientSegment` produz); meio radiano e pouco
 *  a rola para DENTRO, e é essa a mão aberta de quem empurra ki — não a mão
 *  chapada de quem carrega uma bandeja. O sinal acompanha `lado`, como em
 *  `poseGenki`. */
const RAJADA_GIRO = 0.85;
/** rad — limites da elevação do braço NO ESPAÇO DO CORPO. Voando muito deitado
 *  a mira convertida passa da vertical, e sem o teto o braço iria parar atrás da
 *  própria cabeça — que o ombro deste rig aceita alegremente, porque ele não tem
 *  nenhum limite articular. */
const MIRA_MIN = -1.2;
const MIRA_MAX = 1.5;

export function aplicarRajada(p, ctx, forca) {
  if (forca <= 0.002) return;
  const f = smoothstep(0, GANHO, forca);
  const dir = ctx.mao === 1;
  const lado = dir ? 1 : -1;
  const mao = dir ? p.handR : p.handL;
  const polo = dir ? p.poleR : p.poleL;
  const outra = dir ? p.handL : p.handR;

  /* 1. O TRONCO gira primeiro, e é de propósito que ele venha antes de tudo: o
     braço sai do ombro, o ombro está pendurado no tronco, e quem quer o braço à
     frente tem de mandar o ombro na frente dele. */
  p.spineYaw = lerp(p.spineYaw, lado * OMBRO_GIRO, f);

  /* 2. ONDE O OMBRO FOI PARAR, em espaço do root.
   *
   * É a mesma conta que `Fighter.doTronco` faz com a matriz do tronco, refeita
   * aqui em seis linhas de trigonometria — e refeita porque a matriz ainda não
   * existe: quem monta o esqueleto é o quadro seguinte a este.
   *
   * Sem ela o alvo da mão seria uma coordenada FIXA, e aí o alcance do braço
   * passa a depender do que o tronco está fazendo. Medido, com o mesmo alvo
   * escrito à mão: 94 % de alcance parado, 68 % em corrida cheia (o tronco se
   * inclina 0,42 rad e o ombro alcança o alvo sozinho) e **104 % voando** — e
   * 104 % não é um braço bem esticado, é a IK batendo no teto de `maxReach`,
   * travando o cotovelo na reta e devolvendo exatamente o cabo de vassoura que
   * `poseBraco` existe para evitar. Ancorado no ombro de verdade, são 98 % nos
   * três casos.
   *
   * A ordem de rotação é YXZ e `rotation.x` é `−spinePitch`, igual ao `Fighter`.
   * `spineRoll` fica de fora: ele nunca passa de 0,02 rad em pose nenhuma e
   * entraria com menos de um milímetro. */
  const sy = Math.sin(p.spineYaw);
  const cy = Math.cos(p.spineYaw);
  const sp = Math.sin(p.spinePitch);
  const cp = Math.cos(p.spinePitch);
  const ox = lado * OSSO.shoulderX;
  const ombroX = ox * cy - ALTO_TRONCO * sp * sy;
  const ombroY = OSSO.hipY + ALTO_TRONCO * cp;
  const ombroZ = -ox * sy - ALTO_TRONCO * sp * cy;

  /* 3. A ELEVAÇÃO DA MIRA, convertida para o espaço do corpo.
   *
   * `ctx.pitch` é o olhar em espaço de MUNDO e a pose vive no espaço do ROOT,
   * que está deitado `inclinacao` para a frente. Somar `inclinacao · π/2`
   * desfaz exatamente essa deitada: voando nivelado (inclinação 0,5, olhar no
   * horizonte) o braço aponta 45° "para cima" no corpo, o que depois da
   * inclinação do root é horizontal no mundo — que é para onde a bola vai. */
  const mira = clamp(ctx.pitch + p.inclinacao * MEIO_PI, MIRA_MIN, MIRA_MAX);
  const sm = Math.sin(mira);
  const cm = Math.cos(mira);

  // 4. E a mão vai a um braço inteiro do ombro, nessa direção.
  mao.x = lerp(mao.x, ombroX * (1 - RAJADA_CONVERGE), f);
  mao.y = lerp(mao.y, ombroY + sm * RAJADA_ALCANCE, f);
  mao.z = lerp(mao.z, ombroZ - cm * RAJADA_ALCANCE, f);
  /* O cotovelo cai POR BAIXO do braço estendido: num braço a 97 % de alcance o
     arco do cotovelo tem sete centímetros, e a única coisa que o polo decide é
     para que lado esses sete centímetros vão. Para baixo e um pouco para fora é
     onde um cotovelo humano fica quando a mão empurra à frente. */
  polo.x = lerp(polo.x, lado * 0.62, f);
  polo.y = lerp(polo.y, -0.85, f);
  polo.z = lerp(polo.z, 0.2, f);

  /* Contrapeso: a outra mão recolhe ao quadril, como quem já vai atirar de novo.
     Entra com menos peso que o braço do tiro — recolher é um gesto de apoio, e
     no voo é ele que deixa a pose de baixo (punhos junto às costelas) ainda
     aparecer no braço que não está atirando. */
  outra.x = lerp(outra.x, -lado * 0.27, f * 0.62);
  outra.y = lerp(outra.y, 0.94, f * 0.62);
  outra.z = lerp(outra.z, 0.08, f * 0.62);

  if (dir) {
    p.punhoR = lerp(p.punhoR, 0, f);
    p.esticaR = lerp(p.esticaR, RAJADA_ESTICA, f);
    p.giroR = lerp(p.giroR, lado * RAJADA_GIRO, f);
    p.punhoL = lerp(p.punhoL, 1, f * 0.62);
  } else {
    p.punhoL = lerp(p.punhoL, 0, f);
    p.esticaL = lerp(p.esticaL, RAJADA_ESTICA, f);
    p.giroL = lerp(p.giroL, lado * RAJADA_GIRO, f);
    p.punhoR = lerp(p.punhoR, 1, f * 0.62);
  }

  // O corpo recua um dedo: é o coice.
  p.rootPush = lerp(p.rootPush, 0.03, f);
  /* E a cabeça olha para onde o braço aponta — pela mira JÁ CORRIGIDA, não pelo
     `ctx.pitch` cru. Com o valor cru, atirar voando abaixava o queixo do
     lutador (a pose de voo o havia levantado para compensar a inclinação) e ele
     passava a mirar o próprio umbigo. Meio peso, para a postura de baixo
     continuar mandando na cabeça. */
  p.headPitch = lerp(p.headPitch, -mira * 0.5, f * 0.5);
}

/* ---------------------------------------------------------------- especiais

   Quatro poses distintas, e distintas de propósito: num tiroteio a 90 m o que
   avisa que vem um Kamehameha não é a cor do feixe, é o inimigo entrando na
   concha. Ler a intenção pela POSE, e ter tempo de desviar por causa disso, é
   metade da graça do jogo da referência.

   A linha do tempo sai do próprio config (`windup` e `sustain` do golpe), e não
   de um número escolhido aqui: se alguém encurtar a carga da Genki Dama de 3,6 s
   para 2 s, o corpo acompanha sozinho. Duas fontes para a mesma duração seriam
   duas verdades, e o sintoma é o clássico — o feixe sai antes de as mãos
   chegarem à frente. */

/** Em que fração da animação o golpe SAI das mãos. */
export function pontoDeSoltura(indice) {
  const nome = NAMEK.specialOrder[indice];
  const s = nome ? NAMEK.specials[nome] : null;
  if (!s) return 0.4;
  return clamp(s.windup / (s.windup + s.sustain), 0.08, 0.92);
}

export function poseEspecial(p, ctx) {
  const solta = ctx.espSolta;
  const k = smoothstep(0, 1, clamp(ctx.espU / solta, 0, 1));
  const s = clamp((ctx.espU - solta) / (1 - solta), 0, 1);
  /* O empurrão é EXPLOSIVO e o retorno é lento: o `smoothstep(0, 0.16, s)`
     gasta um sexto da sustentação indo para a frente e o resto segurando. Uma
     rampa linear daria um braço que estica devagar, e nenhuma quantidade de luz
     conserta um golpe sem violência no corpo. */
  const solt = smoothstep(0, 0.16, s);
  const tr = Math.sin(ctx.t * 44 + ctx.fase * 5) * (1 - s * 0.8);

  switch (ctx.esp) {
    case 1:
      poseGalick(p, ctx, k, s, solt, tr);
      break;
    case 2:
      poseDisco(p, ctx, k, s, solt, tr);
      break;
    case 3:
      poseGenki(p, ctx, k, s, solt, tr);
      break;
    default:
      poseKamehameha(p, ctx, k, s, solt, tr);
  }
}

/** Concha no quadril e empurrão a duas mãos — a pose mais copiada da história. */
function poseKamehameha(p, ctx, k, s, solt, tr) {
  zerar(p);
  // Na carga o corpo fica de lado (a concha no quadril direito); no disparo ele
  // ESQUADRA para o alvo. É a mudança que anuncia o golpe antes de qualquer luz.
  p.spineYaw = -0.55 * k * (1 - solt);
  p.inclinacao = 0.1 * k + 0.12 * solt;
  p.rootLift = -0.1 - 0.05 * k + 0.03 * solt + tr * 0.008 * k;
  p.rootSide = tr * 0.006 * k;
  p.spineRoll = tr * 0.015 * k;
  p.headPitch = -0.08 + Math.sin(ctx.pitch) * -0.3 * solt;

  const largura = 0.27 + 0.05 * k;
  v3(p.footR, largura, ANKLE, 0.1 + 0.24 * solt);
  v3(p.footL, -largura * 0.95, ANKLE, -0.06 - 0.32 * solt);
  v3(p.kneeR, 0.5, 0.16, -1);
  v3(p.kneeL, -0.4, 0.16, -1);
  p.peGiro = 0.22 - 0.16 * solt;

  /* As duas palmas separadas por 16 cm fechando para 10: é a concha, e é o vão
     onde a esfera cresce. Elas ficam EMPILHADAS em Y, não lado a lado — é o
     gesto da referência, e é o que deixa o cotovelo de baixo cair naturalmente. */
  const meio = (0.16 - 0.06 * k) * 0.5;
  /* A concha fica na CINTURA do lado direito, e não lá fora no quadril. Não é
     só fidelidade à referência: a mão esquerda precisa atravessar o peito para
     chegar nela, e a 34 cm do eixo esse trajeto é 20 cm mais longo que o braço
     — a IK travava e o braço esquerdo saía apontando reto para o chão. */
  const cx = lerp(0.14, 0.09, solt);
  const cy = lerp(1.08, 1.3 + Math.sin(ctx.pitch) * 0.3, solt);
  const cz = lerp(0.11, -0.5, solt);
  v3(p.handR, cx + 0.03 * solt, cy + meio * (1 - solt), cz);
  v3(p.handL, cx - 0.2 * solt, cy - meio * (1 - solt), cz);
  v3(p.poleR, lerp(0.85, 0.6, solt), lerp(-0.1, -0.7, solt), lerp(0.6, 0.3, solt));
  v3(p.poleL, lerp(-0.2, -0.6, solt), lerp(-0.6, -0.7, solt), lerp(0.7, 0.3, solt));
  p.punhoR = 0;
  p.punhoL = 0;
  p.giroR = -1.2 * (1 - solt);
  p.giroL = 1.2 * (1 - solt);
  p.esticaR = 0.05 * solt;
  /* O braço ESQUERDO ganha três centímetros e meio na carga.
   *
   * Não é gambiarra de IK: é a cintura escapular que este rig não tem. Num
   * corpo de verdade, cupar as duas mãos do lado direito puxa o ombro esquerdo
   * para a frente e para dentro uns dez centímetros, e é isso que faz a mão
   * chegar lá. Com os ombros pregados no tronco a mão esquerda fica 3 cm além
   * do alcance, a IK trava o cotovelo e o braço vira uma vara apontando para o
   * quadril — medido em 1,03 de razão de alcance na bancada. Alongar o osso é a
   * versão barata do ombro que falta, e a diferença é invisível. */
  p.esticaL = 0.05 * solt + 0.035 * (1 - solt);
  p.cabelo = -0.5 - 0.35 * k + 0.6 * solt;
}

/** Um braço só, o outro segurando o pulso. O irmão bruto do Kamehameha. */
function poseGalick(p, ctx, k, s, solt, tr) {
  zerar(p);
  p.spineYaw = -0.42 * k * (1 - solt) + 0.14 * solt;
  p.inclinacao = 0.08 * k + 0.16 * solt;
  p.rootLift = -0.12 - 0.05 * k + tr * 0.007 * k;
  p.spineRoll = tr * 0.018 * k;
  p.headPitch = -0.06;

  v3(p.footR, 0.3, ANKLE, 0.14 + 0.3 * solt);
  v3(p.footL, -0.3, ANKLE, -0.1 - 0.3 * solt);
  v3(p.kneeR, 0.55, 0.16, -1);
  v3(p.kneeL, -0.45, 0.16, -1);
  p.peGiro = 0.26 - 0.2 * solt;

  // Mão direita armada atrás do ombro; no disparo ela SAI, e a esquerda vai
  // junto porque está agarrada ao antebraço — é o que dá peso ao gesto.
  const hx = lerp(0.34, 0.14, solt);
  const hy = lerp(1.24, 1.34 + Math.sin(ctx.pitch) * 0.32, solt);
  const hz = lerp(0.2, -0.52, solt);
  v3(p.handR, hx, hy, hz);
  // A esquerda agarra o ANTEBRAÇO, não o punho: vinte centímetros mais perto do
  // ombro esquerdo, que é a diferença entre um braço dobrado e um braço travado.
  v3(p.handL, hx - 0.22, hy - 0.02, hz + 0.06);
  v3(p.poleR, 0.9, lerp(0.2, -0.7, solt), lerp(0.5, 0.25, solt));
  v3(p.poleL, -0.85, -0.5, 0.4);
  p.punhoR = 0;
  p.punhoL = 0.9;
  p.esticaR = 0.05 * solt;
  p.giroR = -0.6 * (1 - solt);
  p.cabelo = -0.45 - 0.3 * k + 0.5 * solt;
}

/** Disco acima da mão e um talho lateral. Nenhuma outra pose levanta o braço. */
function poseDisco(p, ctx, k, s, solt, tr) {
  zerar(p);
  /* O ombro direito vai JUNTO com o talho (yaw positivo leva o ombro direito à
     frente). Com o giro para o outro lado, o braço tinha de atravessar o corpo
     sozinho e não alcançava o fim do golpe. */
  p.spineYaw = 0.45 * solt;
  p.spineRoll = 0.3 * solt + tr * 0.012 * k;
  p.inclinacao = -0.1 * k + 0.14 * solt;
  p.rootLift = -0.04 - 0.03 * k;
  p.headPitch = -0.4 * (1 - solt) + 0.1 * solt;
  p.spinePitch = -0.12 * k;

  v3(p.footR, 0.26, ANKLE, 0.06 + 0.14 * solt);
  v3(p.footL, -0.26, ANKLE, -0.04 - 0.16 * solt);
  p.peGiro = 0.18;

  /* Braço direito ESTICADO para cima, palma para o céu (o disco gira acima
     dela); no talho ele desce atravessando o corpo. `estica` é obrigatório aqui:
     um braço "para o alto" com o cotovelo dobrado não lê como um braço para o
     alto, lê como quem está pedindo a palavra. */
  v3(p.handR, lerp(0.27, -0.12, solt), lerp(2.0, 1.16, solt), lerp(-0.04, -0.42, solt));
  v3(p.handL, lerp(-0.42, -0.2, solt), lerp(1.14, 1.0, solt), lerp(-0.1, 0.12, solt));
  v3(p.poleR, lerp(1, 0.2, solt), lerp(0.3, -0.9, solt), lerp(0.4, 0.1, solt));
  v3(p.poleL, -0.9, -0.4, 0.3);
  p.punhoR = 0;
  p.punhoL = 0.3;
  p.esticaR = 0.05;
  p.giroR = 1.4 * (1 - solt);
  p.cabelo = -0.4 - 0.3 * k;
}

/** Os dois braços para o céu. A carga mais longa e a pose mais aberta. */
function poseGenki(p, ctx, k, s, solt, tr) {
  zerar(p);
  p.inclinacao = -0.18 * k + 0.3 * solt;
  p.rootLift = 0.02 * k - 0.06 * solt + tr * 0.012 * k;
  p.rootSide = tr * 0.01 * k;
  p.spinePitch = -0.22 * k + 0.2 * solt;
  p.headPitch = -0.55 * (1 - solt) + 0.15 * solt;

  // Pés quase juntos: o corpo inteiro vira uma antena.
  v3(p.footR, lerp(STANCE, 0.12, k), ANKLE, 0.02 + 0.22 * solt);
  v3(p.footL, lerp(-STANCE, -0.12, k), ANKLE, -0.02 - 0.24 * solt);
  p.peGiro = 0.1;

  const hy = lerp(2.06, 1.42, solt);
  const hz = lerp(0.06, -0.48, solt);
  v3(p.handR, lerp(0.24, 0.19, solt), hy, hz);
  v3(p.handL, lerp(-0.24, -0.19, solt), hy, hz);
  v3(p.poleR, 0.9, lerp(0.5, -0.8, solt), lerp(0.35, 0.2, solt));
  v3(p.poleL, -0.9, lerp(0.5, -0.8, solt), lerp(0.35, 0.2, solt));
  p.punhoR = 0;
  p.punhoL = 0;
  p.esticaR = 0.05;
  p.esticaL = 0.05;
  p.giroR = 0.8 * (1 - solt);
  p.giroL = -0.8 * (1 - solt);
  p.cabelo = -0.7 * k + 0.5 * solt;
}

/* -------------------------------------------------------------- levar dano

   Recuo e cabeça para trás, NA DIREÇÃO DO GOLPE. `ctx.hitX`/`ctx.hitZ` são o
   empurrão já convertido para o espaço do corpo, e é isso que faz um tiro pelas
   costas jogar o peito para a frente em vez de para trás. Sem a direção, toda
   dor é a mesma dor e o jogador não sabe de onde está apanhando — que é
   informação de jogo, não enfeite. */
export function poseDano(p, ctx) {
  zerar(p);
  const f = ctx.hitZ;
  const l = ctx.hitX;

  p.spinePitch = -0.42 * f;
  p.spineRoll = -0.34 * l;
  p.headPitch = -0.5 * f;
  p.headYaw = 0.3 * l;
  p.rootPush = 0.12 * f;
  p.rootSide = 0.12 * l;
  p.rootLift = -0.07;
  p.inclinacao = -0.12 * f;

  // Braços jogados para fora e para cima: é reflexo, não guarda.
  v3(p.handR, 0.44 + 0.06 * l, 1.18, 0.14 + 0.12 * f);
  v3(p.handL, -0.44 + 0.06 * l, 1.16, 0.16 + 0.12 * f);
  v3(p.poleR, 1, 0.1, 0.4);
  v3(p.poleL, -1, 0.1, 0.4);
  p.punhoR = 0.2;
  p.punhoL = 0.2;

  // Uma perna cede e a outra recua para segurar o corpo.
  v3(p.footR, STANCE + 0.06 + 0.1 * l, ANKLE + 0.03, 0.1 + 0.18 * f);
  v3(p.footL, -STANCE - 0.03 + 0.1 * l, ANKLE, -0.06 + 0.06 * f);
  p.cabelo = 0.3;
}

/* --------------------------------------------------------------- arremessado

   Corpo sem controle. O GIRO não está aqui — quem gira o corpo é o `Fighter`,
   porque um giro contínuo não pode ser interpolado como número (a mistura entre
   6,2 rad e 0,1 rad daria uma volta inteira para trás no meio do tombo). Aqui
   só está o que o corpo faz enquanto gira: nada. Membros soltos, arrastados.

   E "nada" é a pose mais difícil de acertar: o que a torna crível é os quatro
   membros estarem em posições ASSIMÉTRICAS e o punho estar quase aberto. Corpo
   simétrico lê como pose; corpo torto lê como corpo. */
export function poseArremessado(p, ctx) {
  zerar(p);
  p.inclinacao = 0.35;
  p.spineRoll = 0.16;
  p.spinePitch = -0.12;
  p.headPitch = -0.24;

  v3(p.handR, 0.42, 1.24, 0.28);
  v3(p.handL, -0.36, 1.32, 0.16);
  v3(p.poleR, 0.9, 0.35, 0.3);
  v3(p.poleL, -0.85, 0.4, 0.2);
  p.punhoR = 0.15;
  p.punhoL = 0.1;

  v3(p.footR, 0.27, 0.24, 0.2);
  v3(p.footL, -0.2, 0.1, 0.3);
  v3(p.kneeR, 0.4, 0.2, -1);
  v3(p.kneeL, -0.3, 0.1, -1);
  p.pontaR = 0.4;
  p.pontaL = 0.2;
  p.cabelo = 0.5;
}

/* -------------------------------------------------------------------- queda

   Cair não é voar com o motor desligado: é o corpo BUSCANDO o chão. Braços
   abertos e para cima, pernas separadas e dobradas, olhando para baixo. É a
   pose que prepara o pouso, e é ela que faz uma queda de 400 m em Namekusei
   parecer perigosa em vez de parecer um elevador. */
export function poseQueda(p, ctx) {
  zerar(p);
  p.inclinacao = 0.12;
  p.headPitch = 0.3;
  p.spinePitch = 0.08;

  v3(p.handR, 0.46, 1.34, 0.14);
  v3(p.handL, -0.46, 1.32, 0.16);
  v3(p.poleR, 1, 0.2, 0.35);
  v3(p.poleL, -1, 0.2, 0.35);
  p.punhoR = 0.3;
  p.punhoL = 0.3;

  v3(p.footR, 0.29, ANKLE + 0.08, -0.12);
  v3(p.footL, -0.27, ANKLE + 0.04, 0.14);
  v3(p.kneeR, 0.5, 0.2, -1);
  v3(p.kneeL, -0.45, 0.2, -1);
  p.cabelo = 0.75;
}

/* -------------------------------------------------------------------- morte

   De costas no chão, membros abertos, sem tônus. `inclinacao = -1` deita o
   corpo PARA TRÁS (o pivô é o peito, ver `PIVO`): quem tomba para trás é quem
   levou o golpe de frente, que é o caso comum.

   A DESCIDA até o chão não está aqui. Ela é feita pelo `Fighter` com um
   amortecimento próprio, mais lento que o da pose, e por um motivo concreto: se
   a queda viesse misturada linearmente com a pose, na metade da transição o
   corpo estaria meio em pé e já meio metro abaixo do chão — os joelhos
   enterrados na grama enquanto o tronco ainda cai. Tombar e assentar são dois
   tempos, e é assim que um corpo cai de verdade. */
export function poseMorte(p) {
  zerar(p);
  p.inclinacao = -1;
  p.rootLift = 0;
  p.spineRoll = 0.12;
  p.spinePitch = 0.1;
  // A cabeça pende para o lado. Girar em torno do eixo do corpo é, para quem
  // está deitado, exatamente isso.
  p.headYaw = 0.55;
  p.headPitch = 0.15;

  v3(p.handR, 0.38, 1.03, 0.12);
  v3(p.handL, -0.37, 0.98, 0.16);
  v3(p.poleR, 1, -0.2, 0.3);
  v3(p.poleL, -1, -0.2, 0.3);
  p.punhoR = 0.12;
  p.punhoL = 0.08;

  v3(p.footR, 0.22, ANKLE + 0.02, 0.04);
  v3(p.footL, -0.26, ANKLE, -0.02);
  v3(p.kneeR, 0.4, 0.1, -1);
  v3(p.kneeL, -0.35, 0.05, -1);
  p.peGiro = 0.4;
  p.cabelo = 0.25;
}
