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
 */
export function aplicarRajada(p, ctx, forca) {
  if (forca <= 0.002) return;
  const dir = ctx.mao === 1;
  const lado = dir ? 1 : -1;
  const mao = dir ? p.handR : p.handL;
  const polo = dir ? p.poleR : p.poleL;
  const outra = dir ? p.handL : p.handR;

  // O braço aponta na direção da mira: a bola sai de onde o cano está olhando.
  const alvoY = 1.3 + Math.sin(ctx.pitch) * 0.34;
  const alvoZ = -0.5 * Math.cos(ctx.pitch);
  mao.x = lerp(mao.x, lado * 0.23, forca);
  mao.y = lerp(mao.y, alvoY, forca);
  mao.z = lerp(mao.z, alvoZ, forca);
  polo.x = lerp(polo.x, lado * 0.75, forca);
  polo.y = lerp(polo.y, -0.62, forca);
  polo.z = lerp(polo.z, 0.35, forca);

  // Contrapeso: a outra mão recolhe ao quadril, como quem já vai atirar de novo.
  outra.x = lerp(outra.x, -lado * 0.27, forca * 0.7);
  outra.y = lerp(outra.y, 0.94, forca * 0.7);
  outra.z = lerp(outra.z, 0.08, forca * 0.7);

  if (dir) {
    p.punhoR = lerp(p.punhoR, 0, forca);
    p.esticaR = lerp(p.esticaR, 0.045, forca);
    p.punhoL = lerp(p.punhoL, 1, forca * 0.7);
  } else {
    p.punhoL = lerp(p.punhoL, 0, forca);
    p.esticaL = lerp(p.esticaL, 0.045, forca);
    p.punhoR = lerp(p.punhoR, 1, forca * 0.7);
  }

  // O ombro do tiro vai à frente e o corpo recua um dedo: é o coice.
  p.spineYaw = lerp(p.spineYaw, lado * 0.22, forca);
  p.rootPush = lerp(p.rootPush, 0.035, forca);
  p.headPitch = lerp(p.headPitch, -Math.sin(ctx.pitch) * 0.4, forca * 0.6);
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
