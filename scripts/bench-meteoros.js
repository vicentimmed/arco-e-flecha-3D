/* ---------------------------------------------------------------------------
   Banco de provas da chuva de meteoros.

   `MeteorRain` é PURO — só `CONFIG` e o campo de altura —, então roda em Node
   sem cliente, sem física e sem imagem. Contra ele, um arqueiro simulado:
   atira a cada `1/taxa` segundos, acerta com probabilidade `p`, e sempre na
   rocha MAIS PRÓXIMA DO CHÃO que ainda não morreu.

   O que ele mede, e por que é este número:

     • MARGEM MÍNIMA — quantos segundos sobraram na rocha que chegou mais perto
       do chão. É o número que decide o modo: abaixo de 3 s a horda é injusta,
       acima de 15 s é passeio.
     • pico de rochas no ar (a CONCORRÊNCIA, que é a dificuldade de verdade);
     • flechas exigidas ÷ tempo, contra a capacidade — o D real, medido;
     • taxa de derrota em N partidas.

   Uso:
     node scripts/bench-meteoros.js [jogadores] [taxaDeTiro] [acerto] [rodadas]
     node scripts/bench-meteoros.js 1 0.50 0.78 200
     node scripts/bench-meteoros.js 1 0.50 0.78 200 0.95 easy
   --------------------------------------------------------------------------- */

import { CONFIG } from "../src/config.js";
import { MoonField } from "../src/shared/moonField.js";
import { MeteorRain, meteorDifficultyOf } from "../server/meteorSim.js";

const PASSO = 1 / 10; // o mesmo relógio de 10 Hz da sala

const jogadores = Number(process.argv[2] ?? 1);
const taxaTiro = Number(process.argv[3] ?? 0.5); // tiros por segundo, por jogador
const pAcerto = Number(process.argv[4] ?? 0.78);
const rodadas = Number(process.argv[5] ?? 200);

/**
 * A chance de acertar O COLOSSO, que não é a mesma de acertar a chuva.
 *
 * Uma probabilidade só para todos os alvos era defensável enquanto o campo ia
 * de 5 a 28 m de diâmetro. Deixou de ser quando o colosso passou a crescer a
 * cada aparição e o último ficou com 52 m: a 150 m ele subtende 20° de campo
 * de visão, e um arqueiro que erra um quinto dos tiros nele não é um arqueiro
 * ruim, é um modelo errado. Com a probabilidade da chuva, o banco reprovava a
 * vida do colosso por um motivo que não existe na tela.
 *
 * 0,95 e não 1,00 porque ainda se perde flecha: tiro solto no instante em que
 * a pedra sai do campo de visão, tiro dado enquanto se corre, tiro que sai
 * durante o giro. O que não se perde mais é o tiro que ERRA o alvo.
 */
const pTanque = Number(process.argv[6] ?? 0.95);

/**
 * O NÍVEL a provar: `easy`, `normal` ou `hard`.
 *
 * É o argumento que existe para os outros três níveis não serem palpite. Os
 * multiplicadores de `difficulties` foram escolhidos aqui, rodando as mesmas
 * 200 partidas em cada um e olhando a taxa de vitória e a margem mínima — que
 * são os dois números que dizem se um nível é fácil ou só é curto.
 */
const dificuldade = meteorDifficultyOf(process.argv[7] ?? "normal");

const terreno = new MoonField();

/** Uma partida inteira. @returns {{venceu, horda, margem, pico, hordas}} */
function partida() {
  const chuva = new MeteorRain(terreno);
  chuva.start(jogadores, dificuldade);

  const intervalo = 1 / (taxaTiro * jogadores);
  let proximoTiro = intervalo;
  let t = 0;
  let margemGlobal = Infinity;
  let picoGlobal = 0;
  const porHorda = new Map();

  // Teto de tempo: uma partida completa dá ~12 min; 20 é rede de segurança.
  while (t < 20 * 60) {
    t += PASSO;
    const r = chuva.update(PASSO);
    if (r.impacto) {
      return { venceu: false, horda: chuva.horde, margem: 0, pico: picoGlobal, porHorda };
    }
    if (r.venceu) break;
    if (chuva.countdown > 0) continue;

    // Concorrência e margem: medidas TODO passo, não no fim.
    const vivos = chuva.meteors.filter((m) => !m.dead);
    picoGlobal = Math.max(picoGlobal, vivos.length);
    for (const m of vivos) {
      const sobra = m.altitude / Math.abs(m.vy);
      if (sobra < margemGlobal) margemGlobal = sobra;
      const h = porHorda.get(chuva.horde) ?? { margem: Infinity, pico: 0, flechas: 0 };
      h.margem = Math.min(h.margem, sobra);
      h.pico = Math.max(h.pico, vivos.length);
      porHorda.set(chuva.horde, h);
    }

    // O arqueiro simulado.
    proximoTiro -= PASSO;
    while (proximoTiro <= 0) {
      proximoTiro += intervalo;
      if (!vivos.length) break;
      // Sempre na mais perto do chão: é o que um jogador competente faz.
      let alvo = vivos[0];
      for (const m of vivos) if (m.altitude < alvo.altitude) alvo = m;
      const h = porHorda.get(chuva.horde);
      if (h) h.flechas++;
      if (Math.random() < (alvo.kind === "tank" ? pTanque : pAcerto)) chuva.hit(alvo.id);
    }
  }

  return { venceu: true, horda: chuva.horde, margem: margemGlobal, pico: picoGlobal, porHorda };
}

let vitorias = 0;
let margemMin = Infinity;
let picoMax = 0;
const derrotaPorHorda = new Map();
const margemPorHorda = new Map();

for (let i = 0; i < rodadas; i++) {
  const r = partida();
  if (r.venceu) vitorias++;
  else derrotaPorHorda.set(r.horda, (derrotaPorHorda.get(r.horda) ?? 0) + 1);
  margemMin = Math.min(margemMin, r.margem);
  picoMax = Math.max(picoMax, r.pico);
  for (const [h, d] of r.porHorda) {
    const atual = margemPorHorda.get(h) ?? Infinity;
    margemPorHorda.set(h, Math.min(atual, d.margem));
  }
}

const C = taxaTiro * pAcerto;
const D = CONFIG.modes.meteorRain.difficulties[dificuldade];
console.log(`\n  CHUVA DE METEOROS — banco de provas`);
console.log(`  ${rodadas} partidas · ${jogadores} jogador(es)`);
console.log(
  `  nível: ${dificuldade} · rochas ×${D.mix} · intervalo ×${D.gap} · colosso ×${D.tank}`,
);
console.log(`  arqueiro: ${taxaTiro} tiros/s × ${(pAcerto * 100).toFixed(0)}% = C ${C.toFixed(2)} acertos/s\n`);
console.log(`  vitórias ............ ${((vitorias / rodadas) * 100).toFixed(1)}%`);
console.log(`  margem mínima ....... ${margemMin === Infinity ? "—" : margemMin.toFixed(1)} s`);
console.log(`  pico de rochas no ar  ${picoMax}`);

if (derrotaPorHorda.size) {
  console.log(`\n  onde se perde:`);
  for (const h of [...derrotaPorHorda.keys()].sort((a, b) => a - b)) {
    const n = derrotaPorHorda.get(h);
    const barra = "█".repeat(Math.max(1, Math.round((n / rodadas) * 60)));
    console.log(`    horda ${String(h).padStart(2)}  ${String(n).padStart(4)}  ${barra}`);
  }
}

console.log(`\n  margem mínima por horda (< 3 s = injusto, > 15 s = passeio):`);
for (const h of [...margemPorHorda.keys()].sort((a, b) => a - b)) {
  const m = margemPorHorda.get(h);
  const sinal = m < 3 ? "  ← apertado demais" : m > 15 ? "  ← folgado" : "";
  console.log(`    horda ${String(h).padStart(2)}  ${m.toFixed(1).padStart(5)} s${sinal}`);
}
console.log("");
