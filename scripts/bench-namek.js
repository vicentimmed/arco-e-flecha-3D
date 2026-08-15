/* ---------------------------------------------------------------------------
   Banco de provas de Namekusei.

   A `NamekRoom` é PURA — `NAMEK`, o campo de altura e mais nada —, então ela
   roda em Node sem cliente, sem Three.js e sem Rapier. Contra ela, a sala mais
   cheia que o modo aceita: **quinze bots**, o teto de `NAMEK.net.maxPlayers`,
   brigando por sessenta segundos.

   O relógio é entregue ao banco (`relogio: false`): sessenta segundos de jogo
   têm de caber em menos de um segundo de relógio real, e o `now()` da sala anda
   pelo `dt` do passo em vez do `Date.now()` — sem isso ninguém sairia da
   invulnerabilidade de nascimento e o banco mediria quinze estátuas imortais.

   -------------------------------------------------------- o que ele responde

   Cinco perguntas, e nenhuma a mais:

     1. **HÁ JOGO?** Abates por minuto. Zero significa bot que não briga;
        alto demais significa bot que não erra, e o §9.3 do plano pede
        exatamente o contrário.
     2. **ELES GERENCIAM KI?** (§9.1) A barra média, o gasto por lutador e
        quanto tempo passam carregando. Uma barra média colada em 100 quer dizer
        que ninguém atira; colada em 0, que ninguém recua para carregar.
     3. **A REPULSÃO FUNCIONA?** (§9.4) A distância ao VIZINHO MAIS PRÓXIMO, que
        é a única medida que enxerga cardume — a distância média entre todos os
        pares fica alta mesmo com dois bots colados.
     4. **AGUENTA?** Tempo de CPU por quadro. O orçamento é o passo de 20 Hz:
        50 ms. Passar de 5 ms é ficar sem margem para o resto do processo.
     5. **NINGUÉM SE PERDE?** Fora da arena, acima do teto, dentro do relevo, ou
        parado num canto. É o teste que a integração explícita (§4) tem de
        pagar: sem solver de física, o chão é responsabilidade do código.

   O que ele NÃO mede: se é divertido, se o especial impressiona, se a esquiva
   é legível de dentro do jogo. Isso é playtest, e o playtest é o juiz final.

   Uso:
     node scripts/bench-namek.js                 # 60 s, 15 bots
     node scripts/bench-namek.js 180             # três minutos
     node scripts/bench-namek.js 60 8            # oito bots
     node scripts/bench-namek.js 60 15 --espectador   # com um cliente ligado
   --------------------------------------------------------------------------- */

import { NamekRoom } from "../server/namek/room.js";
import { NAMEK } from "../src/shared/namek/config.js";
import { NAMEK_PROTOCOL_VERSION, NC2S } from "../src/shared/namek/protocol.js";

const PASSO = 1 / NAMEK.net.stateRate; // o relógio de verdade da sala: 20 Hz
/** s — de quanto em quanto tempo as métricas espaciais são amostradas. */
const AMOSTRA = 0.5;

const pos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const duracao = Number(pos[0] ?? 60);
const quantos = Math.min(Number(pos[1] ?? NAMEK.net.maxPlayers), NAMEK.net.maxPlayers);
/* O ESPECTADOR liga a serialização inteira: sem ninguém ouvindo, `broadcast`
   sai antes do `JSON.stringify` (de propósito — ver o comentário lá), e o custo
   de rede do modo não apareceria em medida nenhuma. Ele entra sem nunca mandar
   pose, então não vira alvo: `montarCorpos` só conhece quem tem pose. */
const espectador = process.argv.includes("--espectador");
const tempestade = process.argv.includes("--tempestade");

const sala = new NamekRoom({ relogio: false });

/* A conexão falsa. A sala não conhece WebSocket — ela fala com qualquer objeto
   que tenha `send` e `close`, que é a mesma abstração que `wsAdapter.js` cumpre
   em produção. Aqui ela vira uma balança. */
let bytes = 0;
let mensagens = 0;
const contagem = new Map();
const conn = {
  send(data) {
    bytes += Buffer.byteLength(data);
    mensagens++;
    /* O tipo, sem desserializar a mensagem inteira: o banco manda dezenas de
       milhares delas, e um `JSON.parse` por mensagem mediria o banco em vez de
       medir a sala. */
    const m = /"t":"([a-z]+)"/.exec(data);
    const t = m ? m[1] : "?";
    contagem.set(t, (contagem.get(t) ?? 0) + 1);
  },
  close() {},
};

for (let i = 0; i < quantos; i++) sala.addBot();
if (espectador) {
  /* Entra DEPOIS dos bots: a sala abre vaga tirando um adversário de CPU, que é
     a regra de `join` — gente ganha de bot. Daí a contagem real vir de
     `sala.bots.count` e não da linha de comando. */
  sala.handleMessage(conn, JSON.stringify({
    t: NC2S.HELLO,
    version: NAMEK_PROTOCOL_VERSION,
    name: "Espectador",
    level: NAMEK.net.levelId,
    mode: NAMEK.net.modeId,
  }));
}
if (tempestade) sala.pedirClima("tempestade", sala.now());

const bots = sala.bots.list;
const N = bots.length;

/* ------------------------------------------------------------------ medidas */

const cpu = [];            // ns por quadro
const vizinho = [];        // m — distância ao mais próximo, por amostra e por bot
const barra = [];          // ki médio da sala, por amostra
const carregando = [];     // fração da sala carregando, por amostra
const trilha = bots.map(() => []); // posições amostradas, para o teste de preso
const fugas = [];          // quem saiu do mundo, e por quê

const quadros = Math.round(duracao / PASSO);
const cadaAmostra = Math.round(AMOSTRA / PASSO);

for (let q = 0; q < quadros; q++) {
  const t0 = process.hrtime.bigint();
  sala.passo(PASSO);
  cpu.push(Number(process.hrtime.bigint() - t0));

  /* A CONTENÇÃO é conferida em TODO quadro, e não na amostra: um bot que sai da
     arena por dois décimos de segundo e volta é exatamente o defeito que uma
     amostragem de meio segundo não veria. */
  for (const b of bots) {
    if (!b.alive) continue;
    const d = Math.hypot(b.position.x, b.position.z);
    const chao = sala.field.heightAt(b.position.x, b.position.z);
    if (d > NAMEK.world.radius) marcar(b, `raio ${d.toFixed(0)} m`);
    else if (b.position.y > NAMEK.world.ceiling + 1) marcar(b, `teto ${b.position.y.toFixed(0)} m`);
    else if (b.position.y < chao - 1) marcar(b, `dentro do relevo (${(chao - b.position.y).toFixed(1)} m)`);
    else if (!Number.isFinite(d) || !Number.isFinite(b.position.y)) marcar(b, "posição não finita");
  }

  if (q % cadaAmostra) continue;

  let ki = 0;
  let carga = 0;
  for (let i = 0; i < N; i++) {
    const b = bots[i];
    ki += b.ki;
    if (b.estado === "carregar") carga++;
    trilha[i].push({ x: b.position.x, y: b.position.y, z: b.position.z, viva: b.alive, estado: b.estado });
    if (!b.alive) continue;
    let melhor = Infinity;
    for (const o of bots) {
      if (o === b || !o.alive) continue;
      melhor = Math.min(melhor, Math.hypot(o.position.x - b.position.x, o.position.y - b.position.y, o.position.z - b.position.z));
    }
    if (Number.isFinite(melhor)) vizinho.push(melhor);
  }
  barra.push(ki / N);
  carregando.push(carga / N);
}

function marcar(bot, motivo) {
  if (fugas.some((f) => f.id === bot.id && f.motivo === motivo)) return;
  fugas.push({ id: bot.id, nome: bot.name, motivo });
}

/* ------------------------------------------------------------------- presos */

/* PRESO = cinco segundos vivo sem sair de um raio de 4 m.
   A pose de CARGA está fora da conta de propósito: carregar ki TRAVA o
   personagem no lugar (§5 do plano), então um bot enchendo a barra é um bot
   parado por decisão, não por defeito. Sem esta exceção o banco acusaria como
   bug o comportamento mais importante da lista do §9. */
const JANELA = Math.round(5 / AMOSTRA);
const presos = [];
for (let i = 0; i < N; i++) {
  const t = trilha[i];
  for (let a = 0; a + JANELA < t.length; a++) {
    let ok = true;
    let andou = 0;
    for (let b = a; b <= a + JANELA; b++) {
      if (!t[b].viva || t[b].estado === "carregar") { ok = false; break; }
      andou = Math.max(andou, Math.hypot(t[b].x - t[a].x, t[b].y - t[a].y, t[b].z - t[a].z));
    }
    if (ok && andou < 4) {
      presos.push({ nome: bots[i].name, em: (a * AMOSTRA).toFixed(1), andou: andou.toFixed(1) });
      break;
    }
  }
}

/* -------------------------------------------------------------------- saída */

const media = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const quantil = (a, p) => {
  if (!a.length) return 0;
  const o = [...a].sort((x, y) => x - y);
  return o[Math.min(o.length - 1, Math.floor(p * o.length))];
};
const pct = (v) => `${(v * 100).toFixed(0)} %`;

let abates = 0;
let mortes = 0;
let gasto = 0;
let tiros = 0;
let especiais = 0;
let esquivas = 0;
for (const b of bots) {
  abates += b.score.kills;
  mortes += b.score.deaths;
  gasto += b.gastoKi;
  tiros += b.tiros;
  especiais += b.especiais;
  esquivas += b.esquivas;
}
const min = duracao / 60;

console.log(
  `namekusei — ${N} bots, ${duracao} s de partida, passo de ${(PASSO * 1000).toFixed(0)} ms` +
    `${espectador ? ", COM espectador" : ""}${tempestade ? ", TEMPESTADE" : ""}`,
);

console.log("\n── briga ─────────────────────────────────────────────");
console.log(`abates            ${(abates / min).toFixed(1)} por minuto   (${abates} em ${duracao} s)`);
console.log(`por lutador       ${(abates / N / min).toFixed(2)} abates/min   ${(mortes / N / min).toFixed(2)} mortes/min`);
console.log(`rajadas           ${(tiros / N / min).toFixed(0)} por lutador por minuto`);
console.log(`especiais         ${especiais} soltos   (${(especiais / N / min).toFixed(2)} por lutador por minuto)`);
console.log(`esquivas          ${(esquivas / N / min).toFixed(1)} por lutador por minuto`);
console.log(`crateras          ${sala.crateras} carimbadas   (${sala.field.craters.length} vivas, teto ${NAMEK.destruction.craterLimit})`);
if (abates === 0) console.log("  ⚠ ninguém morreu: ou não se acham, ou não se acertam");

console.log("\n── ki (§9.1) ─────────────────────────────────────────");
console.log(`barra média       ${media(barra).toFixed(0)} / ${NAMEK.ki.max}   (mín ${quantil(barra, 0.02).toFixed(0)}, máx ${quantil(barra, 0.98).toFixed(0)})`);
console.log(`gasto             ${(gasto / N / min).toFixed(0)} de ki por lutador por minuto`);
console.log(`carregando        ${pct(media(carregando))} da sala, em média`);
if (media(barra) > 92) console.log("  ⚠ barra parada no topo: eles não estão atirando");
if (media(barra) < 12) console.log("  ⚠ barra no chão: eles não recuam para carregar");
if (media(carregando) < 0.02) console.log("  ⚠ ninguém carrega: `kiRetreat` não está pegando");

console.log("\n── repulsão (§9.4) ───────────────────────────────────");
const perto = vizinho.filter((d) => d < NAMEK.bot.separation).length / Math.max(1, vizinho.length);
console.log(`vizinho + próximo  média ${media(vizinho).toFixed(0)} m   mediana ${quantil(vizinho, 0.5).toFixed(0)} m   p5 ${quantil(vizinho, 0.05).toFixed(0)} m`);
console.log(`abaixo de ${NAMEK.bot.separation} m       ${pct(perto)} das amostras`);
if (perto > 0.25) console.log("  ⚠ eles estão se agrupando: a repulsão não está vencendo a perseguição");

console.log("\n── CPU ───────────────────────────────────────────────");
const ms = (ns) => (ns / 1e6).toFixed(3);
console.log(`por quadro        média ${ms(media(cpu))} ms   p50 ${ms(quantil(cpu, 0.5))} ms   p95 ${ms(quantil(cpu, 0.95))} ms   pior ${ms(Math.max(...cpu))} ms`);
/* Duas casas, e não zero: o orçamento é de 50 ms e o gasto é de décimos de
   milissegundo — arredondado a inteiro, o número mais importante desta seção
   seria sempre "0 %", que não distingue folgado de folgadíssimo nem mostraria a
   folga encolhendo no dia em que alguém puser um sistema novo no tick. */
console.log(`orçamento         ${(PASSO * 1000).toFixed(0)} ms por quadro — usando ${((media(cpu) / (PASSO * 1e9)) * 100).toFixed(2)} %`);
console.log(`a partida inteira ${(cpu.reduce((s, v) => s + v, 0) / 1e6).toFixed(0)} ms de CPU para ${duracao} s de jogo`);
if (media(cpu) / (PASSO * 1e9) > 0.1) console.log("  ⚠ mais de 10 % do orçamento: sem margem para o resto do processo");

if (espectador) {
  console.log("\n── rede (um cliente ligado) ──────────────────────────");
  console.log(`descida           ${(bytes / duracao / 1024).toFixed(1)} KB/s   ${(mensagens / duracao).toFixed(0)} mensagens/s`);
  const ordem = [...contagem].sort((a, b) => b[1] - a[1]);
  console.log(`por tipo          ${ordem.map(([t, n]) => `${t} ${(n / duracao).toFixed(0)}/s`).join("   ")}`);
}

console.log("\n── contenção (§4) ────────────────────────────────────");
if (!fugas.length) console.log("arena             nenhum bot saiu do mundo, furou o teto ou entrou no relevo");
else for (const f of fugas) console.log(`  ⚠ ${f.nome} — ${f.motivo}`);
if (!presos.length) console.log(`presos            nenhum (janela de 5 s, raio de 4 m, fora a pose de carga)`);
else for (const p of presos) console.log(`  ⚠ ${p.nome} preso em ${p.em} s — andou ${p.andou} m em 5 s`);

sala.destroy();
process.exit(fugas.length || presos.length ? 1 : 0);
