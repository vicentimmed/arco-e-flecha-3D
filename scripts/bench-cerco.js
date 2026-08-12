/* ---------------------------------------------------------------------------
   Banco de provas do cerco.

   `Siege` é PURO — só `CONFIG` e o campo de altura —, então roda em Node sem
   cliente, sem física e sem imagem. Contra ele, defensores simulados: um arco
   que atira a cada `1/taxa` segundos e acerta com probabilidade `p`, e uma
   tripulação de trabuco que iça, mira e solta.

   -------------------------------------------------------- o que ele responde

   As cinco perguntas do §12 do plano, e nenhuma a mais:

     1. SOBREVIVE-SE? Alvo: 75 % de vitórias com o arqueiro médio. Abaixo de
        60 % a curva está errada; acima de 90 %, também.
     2. ONDE SE PERDE? A derrota tem de se concentrar nos últimos 40 % da
        partida. Antes disso é bug de curva, não dificuldade.
     3. A FILA FECHA? Se ela nunca passa de 2, o portão é decoração; se passa
        de 6 antes do minuto 8, o teto de `gateSlots` está frouxo.
     4. O TRABUCO VALE A PENA? Com e sem. Menos de 15 pontos de diferença na
        taxa de vitória e ele é enfeite caro.
     5. O REPARO VALE A PENA? Se segurar o portão sozinho, é dominante, e
        `repairRate` desce.

   O que ele NÃO mede: se é divertido, se a maré é sentida, se dá para ouvir o
   portão. Isso é playtest, e o playtest é o juiz final.

   ------------------------------------------------------------ o modelo do tiro

   O arqueiro atira sempre no ALVO MAIS PERTO DO PORTÃO que ainda está vivo —
   que é o que um jogador faz e é o que a fila cobra. Não modela erro de mira
   por distância: `pAcerto` já é a taxa efetiva média, medida no jogo.

   A tripulação do trabuco é otimista de propósito: ela sempre acha o melhor
   aglomerado dentro do alcance e nunca erra o ponto. É o TETO do que o engenho
   dá — se nem assim ele mudar a taxa de vitória, o problema é o engenho.

   Uso:
     node scripts/bench-cerco.js [defensores] [taxaDeTiro] [acerto] [rodadas]
     node scripts/bench-cerco.js 1 0.5 0.78 60
     node scripts/bench-cerco.js 3 0.5 0.78 60 --sem-trabuco
     node scripts/bench-cerco.js 1 0.5 0.60 60          # o jogador ruim
   --------------------------------------------------------------------------- */

import { CONFIG } from "../src/config.js";
import { CastleField } from "../src/shared/castleField.js";
import { Siege } from "../server/siegeSim.js";
import { gateInfo } from "../src/shared/castleProps.js";

const PASSO = 1 / 10; // o mesmo relógio de 10 Hz da sala
const GATE = gateInfo();

const defensores = Number(process.argv[2] ?? 1);
const taxaTiro = Number(process.argv[3] ?? 0.5); // tiros por segundo, por arqueiro
const pAcerto = Number(process.argv[4] ?? 0.78);
const rodadas = Number(process.argv[5] ?? 60);
const semTrabuco = process.argv.includes("--sem-trabuco");
const semReparo = process.argv.includes("--sem-reparo");

const terreno = new CastleField();
const S = CONFIG.modes.siege;
const T = S.trebuchet;

/** Um trabuco simulado: iça sozinho e dispara no melhor aglomerado. */
class Engenho {
  constructor() {
    this.pronto = 0; // segundos até estar carregado
  }

  update(dt, cerco, tripulado) {
    if (this.pronto > 0) {
      this.pronto -= dt * (1 + tripulado * (T.reload / T.windReload - 1));
      return null;
    }
    const alvo = this.melhorAlvo(cerco);
    if (!alvo) return null;
    this.pronto = T.reload;
    return alvo;
  }

  /**
   * O ponto que pega mais gente, dentro do alcance útil.
   *
   * Alcance mínimo é v²/g com 45° fixos — 33 m —, e é ele que impede o trabuco
   * de resolver a fila do portão. Ver §5.3 do plano.
   */
  melhorAlvo(cerco) {
    const rMin = (T.speedMin * T.speedMin) / 9.81;
    const rMax = (T.speedMax * T.speedMax) / 9.81;
    let melhor = null;
    let melhorN = 2; // não vale gastar uma pedra em menos de três
    for (const a of cerco.lista) {
      if (a.dead) continue;
      const d = Math.hypot(a.x, a.z - GATE.standZ);
      if (d < rMin || d > rMax) continue;
      let n = 0;
      for (const b of cerco.lista) {
        if (b.dead) continue;
        if (Math.hypot(b.x - a.x, b.z - a.z) <= T.blastRadius) n++;
      }
      if (n > melhorN) {
        melhorN = n;
        melhor = { x: a.x, z: a.z, n };
      }
    }
    return melhor;
  }
}

/** Uma partida inteira. */
function partida() {
  const cerco = new Siege(terreno);
  cerco.start(defensores);

  /* Os defensores ficam no adarve, sobre o portão. A posição importa só para
     o xamã e a catapulta decidirem visada; para o tiro, não. */
  const jogadores = [];
  for (let i = 0; i < defensores; i++) {
    jogadores.push({ id: i + 1, x: (i - (defensores - 1) / 2) * 6, y: 25, z: 5.5, alive: true });
  }

  const engenhos = semTrabuco ? [] : [new Engenho(), new Engenho(), new Engenho()];
  /* Uma pessoa na manivela é uma pessoa que não atira — e a manivela é
     FRACIONÁRIA, não um posto.

     A primeira versão dedicava um defensor inteiro ao içamento assim que
     houvesse dois, e isso produzia um resultado impossível: a dupla saía PIOR
     que o solitário (0 % contra 0 %, mas perdendo mais cedo), porque o segundo
     jogador apertava a curva por `playerGapScale` sem acrescentar uma flecha.
     Ninguém joga assim. Dois defensores revezam: um vai à manivela entre dois
     tiros, e o custo real é meio arco, não um. */
  const naManivela = semTrabuco ? 0 : Math.min(1, (defensores - 1) * 0.5);
  const arqueiros = Math.max(1, defensores - naManivela);

  const intervalo = 1 / (taxaTiro * arqueiros);
  let proximoTiro = intervalo;
  let t = 0;
  let agora = 0;
  let filaPico = 0;
  let filaSoma = 0;
  let amostras = 0;
  let filaPassou6Em = null;
  let mortesTrabuco = 0;
  let mortesArco = 0;

  const teto = S.duration + 30;
  while (t < teto) {
    t += PASSO;
    agora += PASSO * 1000;
    const r = cerco.update(PASSO, jogadores, agora);
    /* Quem morre DENTRO do `update` morreu de fogo — o piche do trabuco é a
       única coisa que mata sozinha ali. Sem contar isto, o banco atribuía ao
       trabuco só o estouro direto e reportava 13 % de vazão para uma arma cuja
       maior parte do trabalho é a poça que fica queimando por 8 s. */
    mortesTrabuco += r.mortos.length;

    if (r.over) {
      return {
        venceu: r.venceu,
        emT: cerco.t,
        filaPico,
        filaMedia: amostras ? filaSoma / amostras : 0,
        filaPassou6Em,
        mortesArco,
        mortesTrabuco,
        critico: cerco.criticalTime,
      };
    }
    if (cerco.espera > 0) continue;

    /* ------------------------------------------------------------ arco -- */
    while (t >= proximoTiro) {
      proximoTiro += intervalo;
      const alvo = maisPertoDoPortao(cerco);
      if (!alvo) continue;
      if (Math.random() >= pAcerto) continue;
      /* Uma parte dos acertos é NA CABEÇA, e cabeça mata de primeira. É a
         diferença mais pesada que o modo tem entre o arqueiro bom e o médio, e
         ignorá-la aqui mediria um jogo que ninguém joga. 18 % é a fração
         plausível de quem mira o corpo e acerta a cabeça — não é o teto de
         quem CAÇA cabeça, que é outro jogador. */
      const naCabeca = Math.random() < 0.18;
      const h = cerco.hit(alvo.id, { head: naCabeca, from: { x: 0, y: 25, z: 5.5 } });
      if (h?.killed) {
        cerco.matar(h.b, 1, agora);
        mortesArco++;
      }
    }

    /* --------------------------------------------------------- trabuco -- */
    for (const e of engenhos) {
      const alvo = e.update(PASSO, cerco, naManivela);
      if (!alvo) continue;
      const res = cerco.blast(alvo.x, alvo.z, 1);
      for (const b of res.mortos) {
        cerco.matar(b, 1, agora);
        mortesTrabuco++;
      }
    }

    /* ---------------------------------------------------------- reparo --
       Só quando o portão passa do ponto e só se sobrar gente. Um defensor no
       portão é um defensor fora da muralha, e o modelo cobra isso: ele não
       entra na conta do arco enquanto repara. */
    if (!semReparo && defensores > 2 && cerco.gateHp < cerco.gateMax * 0.5) {
      cerco.repair(PASSO, 1);
    }

    const fila = cerco.fila;
    filaSoma += fila;
    amostras++;
    if (fila > filaPico) filaPico = fila;
    if (fila > 6 && filaPassou6Em === null) filaPassou6Em = cerco.t;
  }

  return {
    venceu: true,
    emT: cerco.t,
    filaPico,
    filaMedia: amostras ? filaSoma / amostras : 0,
    filaPassou6Em,
    mortesArco,
    mortesTrabuco,
    critico: cerco.criticalTime,
  };
}

function maisPertoDoPortao(cerco) {
  let melhor = null;
  let melhorD = Infinity;
  for (const b of cerco.lista) {
    if (b.dead) continue;
    /* O escalador fura a fila da prioridade: ele não bate no portão, mas está
       vindo atrás de quem atira. É a mesma decisão que um jogador toma. */
    const d = Math.hypot(b.x, b.z - GATE.standZ) - (b.kind === "climber" ? 20 : 0);
    if (d < melhorD) {
      melhorD = d;
      melhor = b;
    }
  }
  return melhor;
}

/* ------------------------------------------------------------------ saída -- */

console.log(
  `cerco — ${defensores} defensor(es), ${taxaTiro} tiro/s, ${(pAcerto * 100).toFixed(0)} % de acerto, ` +
    `${rodadas} partidas${semTrabuco ? ", SEM TRABUCO" : ""}${semReparo ? ", SEM REPARO" : ""}`,
);

const res = [];
for (let i = 0; i < rodadas; i++) res.push(partida());

const vitorias = res.filter((r) => r.venceu);
const derrotas = res.filter((r) => !r.venceu);
const pct = (vitorias.length / res.length) * 100;

console.log(`\nvitórias: ${vitorias.length}/${res.length} — ${pct.toFixed(1)} %`);

if (derrotas.length) {
  const min = derrotas.map((r) => r.emT / 60).sort((a, b) => a - b);
  const p = (q) => min[Math.floor(q * (min.length - 1))].toFixed(1);
  console.log(
    `derrota (min):  mais cedo ${p(0)}   mediana ${p(0.5)}   mais tarde ${p(1)}`,
  );
  /* O limiar é PROPORCIONAL à partida, não um "minuto 12" escrito à mão: o
     modo já encolheu de vinte para dez minutos uma vez, e um número absoluto
     passou a acusar como bug o que era o clímax normal. */
  const limiar = (S.duration / 60) * 0.6;
  const cedo = min.filter((m) => m < limiar).length;
  console.log(
    `  antes do minuto ${limiar.toFixed(0)}: ${cedo}/${derrotas.length}` +
      (cedo / Math.max(1, derrotas.length) > 0.35 ? "   ⚠ curva errada, não dificuldade" : ""),
  );
}

const media = (f) => res.reduce((s, r) => s + f(r), 0) / res.length;
console.log(
  `\nfila:   média ${media((r) => r.filaMedia).toFixed(2)}   pico ${Math.max(...res.map((r) => r.filaPico))}`,
);
const passou = res.filter((r) => r.filaPassou6Em !== null);
if (passou.length) {
  const t6 = media((r) => r.filaPassou6Em ?? S.duration) / 60;
  console.log(`  passou de 6 em ${t6.toFixed(1)} min (${passou.length}/${res.length} partidas)`);
}
if (media((r) => r.filaMedia) < 0.5) console.log("  ⚠ fila baixa demais: o portão virou decoração");

const mA = media((r) => r.mortesArco);
const mT = media((r) => r.mortesTrabuco);
console.log(
  `\nabates: arco ${mA.toFixed(0)}   trabuco ${mT.toFixed(0)}   ` +
    `(trabuco = ${((mT / Math.max(1, mA + mT)) * 100).toFixed(0)} % da vazão)`,
);
console.log(`portão em risco: ${media((r) => r.critico).toFixed(0)} s por partida`);
