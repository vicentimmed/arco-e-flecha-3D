/* ---------------------------------------------------------------------------
   O que salta quando algo é acertado.

   Este módulo não desenha nada e não é dono de nada: ele OUVE os eventos que já
   existiam (impacto de flecha, morte de bicho) e traduz cada um numa receita de
   partículas, que o pool de `systems/particles.js` executa. Tudo sai em dois
   draw calls, para o jogo inteiro.

   Por que o efeito mora aqui, e não dentro de cada entidade: a flecha não
   deveria saber a cor da terra, e o javali não deveria saber quantas partículas
   um abate solta. O que a flecha sabe é ONDE bateu e EM QUÊ — e é exatamente
   isso que o evento de impacto carrega. A tradução de "em quê" para "que
   material voa" é uma decisão de direção de arte, e decisões de direção de arte
   ficam melhor num lugar só, onde dá para compará-las lado a lado.

   REGRA QUE ATRAVESSA TODAS AS RECEITAS: o material que voa é o material do
   ALVO, não da flecha. Terra sai marrom do chão, lasca sai da cor da madeira,
   pena sai branca do pássaro. É isso que faz o impacto informar em que você
   acertou mesmo quando o alvo está longe demais para ser identificado.
   --------------------------------------------------------------------------- */

import { gameEvents, EventType } from "../core/events.js";

/** Receitas por tipo de alvo. A chave é o `targetKind` do evento de impacto. */
export const RECEITAS = {
  // Terra levantada: muitas partículas, pesadas, que caem rápido e curto.
  terrain: {
    count: 12,
    color: 0x8a6a44,
    speed: 2.6,
    spread: 0.5,
    size: 0.07,
    grow: 1.2,
    life: 0.75,
    gravity: -9,
    drag: 1.4,
    alpha: 0.85,
  },
  // Lasca de madeira/palha do alvo: voa longe e gira.
  target: {
    count: 10,
    color: 0xd8c48a,
    speed: 4.2,
    spread: 0.55,
    size: 0.05,
    grow: 0.2,
    life: 0.9,
    gravity: -7,
    drag: 0.8,
    alpha: 0.95,
  },
  scenery: {
    count: 9,
    color: 0x9a9184,
    speed: 3.4,
    spread: 0.6,
    size: 0.05,
    grow: 0.3,
    life: 0.7,
    gravity: -8,
    drag: 1.0,
    alpha: 0.9,
  },
  // Bicho: um sopro curto e escuro. Discreto de propósito — o abate já tem som,
  // tombo e texto de pontos; mais um efeito grande vira festa em cima da morte.
  boar: {
    count: 8,
    color: 0x5a3020,
    speed: 2.2,
    spread: 0.7,
    size: 0.08,
    grow: 1.0,
    life: 0.5,
    gravity: -6,
    drag: 1.8,
    alpha: 0.7,
  },
  elk: {
    count: 10,
    color: 0x6b2f22,
    speed: 2.6,
    spread: 0.7,
    size: 0.09,
    grow: 1.0,
    life: 0.55,
    gravity: -6,
    drag: 1.8,
    alpha: 0.75,
  },
  // Pena: leve, flutua, cai devagar. É o oposto de tudo o mais nesta lista, e é
  // por isso que se reconhece um acerto no pássaro só pelo efeito.
  bird: {
    count: 9,
    color: 0xe8e4dc,
    speed: 1.6,
    spread: 0.95,
    size: 0.06,
    grow: 0.4,
    life: 1.8,
    gravity: -0.8,
    drag: 2.6,
    alpha: 0.9,
  },
  character: {
    count: 8,
    color: 0x9c2f2a,
    speed: 2.4,
    spread: 0.75,
    size: 0.06,
    grow: 0.8,
    life: 0.5,
    gravity: -7,
    drag: 2.0,
    alpha: 0.8,
  },
  // Zumbi: pó seco, sem sangue. Ele já está morto.
  zombie: {
    count: 9,
    color: 0x6a6a58,
    speed: 2.0,
    spread: 0.8,
    size: 0.075,
    grow: 1.1,
    life: 0.6,
    gravity: -5,
    drag: 2.0,
    alpha: 0.7,
  },
  boss: {
    count: 22,
    color: 0xffaa44,
    speed: 3.2,
    spread: 1.0,
    size: 0.1,
    grow: 0.6,
    life: 0.45,
    gravity: -2,
    drag: 1.8,
    alpha: 1,
    additive: true,
  },
  // Tocha: fagulhas. A única receita aditiva — ela EMITE luz.
  torch: {
    count: 16,
    color: 0xffb347,
    speed: 3.0,
    spread: 0.8,
    size: 0.06,
    grow: -0.4,
    life: 0.7,
    gravity: -2.5,
    drag: 1.2,
    alpha: 1,
    additive: true,
  },
};

export function installImpactEffects() {
  gameEvents.on(EventType.ARROW_IMPACT, (e) => {
    if (!e.impact) return;
    const receita = RECEITAS[e.targetKind] ?? RECEITAS.terrain;
    /* A direção é a da flecha REFLETIDA: o material salta de volta para o lado
       de onde o tiro veio, não para o lado em que ele ia. Sem isso, a terra
       levantada some para dentro do chão e o impacto fica invisível justamente
       nos tiros rasantes, que são a maioria. */
    const v = e.velocity;
    const direction = v ? { x: -v[0], y: Math.abs(v[1]) + 2, z: -v[2] } : null;
    gameEvents.emit(EventType.PARTICLES, { ...receita, position: e.impact, direction });
  });

  /* A morte do javali ganha um segundo sopro, mais largo e mais lento que o do
     impacto. São dois eventos diferentes no mesmo instante e é de propósito: o
     primeiro é a flecha entrando, o segundo é o corpo caindo. */
  gameEvents.on(EventType.BOAR_DEATH, (e) => {
    if (!e.impact) return;
    gameEvents.emit(EventType.PARTICLES, {
      position: e.impact,
      count: 10,
      color: 0x7a5a38,
      speed: 1.4,
      spread: 0.9,
      size: 0.12,
      grow: 1.6,
      life: 0.9,
      gravity: -2.2,
      drag: 2.6,
      alpha: 0.5,
    });
  });
}
