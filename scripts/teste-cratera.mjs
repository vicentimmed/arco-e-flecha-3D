/* Testes do campo da fase Cratera. Rodam em Node, sem navegador.
 *
 *   node scripts/teste-cratera.mjs
 *
 * O que importa aqui é o §11.6 do plano: dois campos independentes, a mesma
 * lista de impactos aplicada na mesma ordem, e a densidade comparada VOXEL A
 * VOXEL. A diferença esperada é ZERO — não "pequena". É o único jeito de a
 * promessa de multijogador não virar uma intenção.
 *
 * Os outros testes medem a FORMA: um furo que sai liso é um furo de minhoca, e
 * a única maneira de saber antes de desenhar é medir a variação do raio. */

import { CampoCratera, VOXEL } from "../src/cratera/campo.js";
import { prepararImpacto, bacia, espacamentoApos } from "../src/cratera/escavar.js";

let falhas = 0;
const ok = (nome, cond, extra = "") => {
  if (!cond) falhas++;
  console.log(`  ${cond ? "ok     " : "FALHOU "} ${nome}  ${extra}`);
};

/* ------------------------------------------------------------ o relevo --- */
console.log("\n— o relevo base —");
{
  const f = new CampoCratera();
  const hClareira = f.alturaBase(0, 0);
  const hMorro = f.alturaBase(-38, -30);
  const hParedao = f.alturaBase(0, -70);
  console.log(`  clareira ${hClareira.toFixed(1)} m · morro ${hMorro.toFixed(1)} m · paredão ${hParedao.toFixed(1)} m`);
  ok("a clareira é baixa", Math.abs(hClareira) < 8);
  ok("o morro é alto", hMorro > 30, `${hMorro.toFixed(1)} m`);
  ok("o paredão é alto", hParedao > 25, `${hParedao.toFixed(1)} m`);
  ok("acima da superfície é ar", !f.solidoEm(0, hClareira + 4, 0));
  ok("abaixo da superfície é pedra", f.solidoEm(0, hClareira - 4, 0));
}

/* ---------------------------------------------- a FORMA de uma cratera --- */
console.log("\n— a cratera tem cara de cratera? —");
{
  const R = 6;
  const c = prepararImpacto({ id: 101, x: 0, y: 0, z: 0, dx: 0, dy: -1, dz: 0, raio: R });

  /* Varre direções e mede o raio da casca em cada uma. Uma esfera daria
     desvio zero; é justamente isso que fazia o furo de minhoca. */
  let min = Infinity;
  let max = -Infinity;
  let soma = 0;
  let n = 0;
  for (let a = 0; a < 24; a++) {
    for (let b = 1; b < 12; b++) {
      /* Direções sem trigonometria: pontos de um cubo, normalizados. */
      const ux = (a % 5) - 2;
      const uy = b - 6;
      const uz = Math.floor(a / 5) - 2;
      const m = Math.sqrt(ux * ux + uy * uy + uz * uz);
      if (m < 0.5) continue;
      /* Bisseção no raio: onde a bacia cruza zero nesta direção. */
      let lo = 0;
      let hi = c.alcance * 1.2;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) * 0.5;
        if (bacia(c, (ux / m) * mid, (uy / m) * mid, (uz / m) * mid) < 0) lo = mid;
        else hi = mid;
      }
      min = Math.min(min, lo);
      max = Math.max(max, lo);
      soma += lo;
      n++;
    }
  }
  const media = soma / n;
  const variacao = (max - min) / media;
  console.log(`  raio da casca: min ${min.toFixed(2)} · médio ${media.toFixed(2)} · max ${max.toFixed(2)} m`);
  console.log(`  variação ponta a ponta: ${(variacao * 100).toFixed(0)}% do raio médio`);
  ok("a borda NÃO é uma esfera", variacao > 0.25, `${(variacao * 100).toFixed(0)}%`);
  ok("e também não é um caos", variacao < 1.4, `${(variacao * 100).toFixed(0)}%`);
}

/* ------------------------------- a variação ENTRE crateras (anti-tubo) --- */
console.log("\n— crateras diferentes entre si? —");
{
  const R = 6;
  const raios = [];
  const desvios = [];
  const passos = [];
  for (let id = 1; id <= 40; id++) {
    const c = prepararImpacto({ id, x: 0, y: 0, z: 0, dx: 1, dy: 0, dz: 0, raio: R });
    raios.push(c.R);
    desvios.push(Math.sqrt(c.cx * c.cx + c.cy * c.cy + c.cz * c.cz));
    passos.push(espacamentoApos(id, R));
  }
  const faixa = (v) => (Math.max(...v) - Math.min(...v)) / (v.reduce((a, b) => a + b) / v.length);
  console.log(`  raio      ${Math.min(...raios).toFixed(2)} – ${Math.max(...raios).toFixed(2)} m`);
  console.log(`  desvio    ${Math.min(...desvios).toFixed(2)} – ${Math.max(...desvios).toFixed(2)} m`);
  console.log(`  passo     ${Math.min(...passos).toFixed(2)} – ${Math.max(...passos).toFixed(2)} m`);
  ok("os raios variam", faixa(raios) > 0.3);
  ok("os centros saem do eixo", Math.max(...desvios) > R * 0.15);
  ok("o espaçamento varia", faixa(passos) > 0.2);
  /* O desvio tem de ser PERPENDICULAR ao tiro: com o tiro em +X, o centro não
     pode escorregar em X, senão a bacia anda para frente e não para o lado. */
  let maiorX = 0;
  for (let id = 1; id <= 40; id++) {
    const c = prepararImpacto({ id, x: 0, y: 0, z: 0, dx: 1, dy: 0, dz: 0, raio: R });
    maiorX = Math.max(maiorX, Math.abs(c.cx));
  }
  ok("o desvio é perpendicular ao tiro", maiorX < 1e-9, `maior desvio em X: ${maiorX.toExponential(1)}`);
}

/* ------------------------------------------------- escavar de verdade --- */
console.log("\n— escavar abre buraco e levanta lábio —");
{
  const f = new CampoCratera();
  const h = f.alturaBase(0, 0);
  ok("antes: é pedra logo abaixo da superfície", f.solidoEm(0, h - 2, 0));
  f.escavar({ id: 1, x: 0, y: h - 2, z: 0, dx: 0, dy: -1, dz: 0, raio: 6 });
  ok("depois: virou ar", !f.solidoEm(0, h - 2, 0));
  ok("o chunk foi materializado", f.chunks.size > 0, `${f.chunks.size} chunk(s)`);

  /* O lábio: em algum ponto do anel, a superfície tem de ter SUBIDO. */
  let subiu = 0;
  let amostras = 0;
  for (let a = 0; a < 32; a++) {
    const ux = ((a % 8) - 3.5) / 3.5;
    const uz = (Math.floor(a / 8) - 1.5) / 1.5;
    const m = Math.sqrt(ux * ux + uz * uz) || 1;
    for (const r of [7, 8, 9]) {
      const px = (ux / m) * r;
      const pz = (uz / m) * r;
      const antes = f.baseDensidade(px, f.alturaBase(px, pz) + 0.6, pz);
      const agora = f.densidadeEm(px, f.alturaBase(px, pz) + 0.6, pz);
      amostras++;
      if (agora > antes + 0.2) subiu++;
    }
  }
  console.log(`  pontos do anel com material levantado: ${subiu}/${amostras}`);
  ok("o lábio de ejeção existe", subiu > 0, `${subiu} pontos`);
}

/* ------------------------------------- o túnel é rosário, não cilindro -- */
console.log("\n— um túnel de vários impactos —");
{
  const f = new CampoCratera();
  const R = 5;
  const y = f.alturaBase(0, -70) - 22; // dentro do paredão
  let x = -18;
  let id = 1;
  const centros = [];
  while (x < 30) {
    const c = f.escavar({ id, x, y, z: -70, dx: 1, dy: 0, dz: 0, raio: R, boca: id === 1 });
    centros.push(c);
    x += espacamentoApos(id, R);
    id++;
  }
  console.log(`  ${centros.length} bacias, ${f.chunks.size} chunks escavados`);

  /* O RAIO DO VÃO ao longo do túnel: mede de quanto em quanto metro qual é a
     meia-altura livre. Num cilindro isso é constante — e constante é o defeito
     que este arquivo inteiro existe para evitar. */
  const vaos = [];
  for (let px = -16; px <= 26; px += 1) {
    /* Mede o vão livre NOS DOIS SENTIDOS a partir do eixo. Medir só para cima
       reportava zero sempre que a bacia estava desviada para baixo — o defeito
       era da régua, não do túnel. */
    if (f.solidoEm(px, y, -70)) {
      vaos.push(0);
      continue;
    }
    let cima = 0;
    for (let dy = 0.25; dy < 16; dy += 0.25) {
      if (f.solidoEm(px, y + dy, -70)) break;
      cima = dy;
    }
    let baixo = 0;
    for (let dy = 0.25; dy < 16; dy += 0.25) {
      if (f.solidoEm(px, y - dy, -70)) break;
      baixo = dy;
    }
    vaos.push(cima + baixo);
  }
  const med = vaos.reduce((a, b) => a + b) / vaos.length;
  const varia = (Math.max(...vaos) - Math.min(...vaos)) / med;
  console.log(`  vão vertical: ${Math.min(...vaos).toFixed(1)} – ${Math.max(...vaos).toFixed(1)} m (média ${med.toFixed(1)})`);
  console.log(`  variação ao longo do túnel: ${(varia * 100).toFixed(0)}%`);
  ok("o túnel NÃO é um cilindro", varia > 0.3, `${(varia * 100).toFixed(0)}% de variação`);
  ok("mas continua passável em toda a extensão — sem tampão", Math.min(...vaos) > 2.5,
     `mais estreito: ${Math.min(...vaos).toFixed(1)} m de vão`);
  ok("a boca é maior que a broca", vaos[2] > med, `boca ${vaos[2].toFixed(1)} vs média ${med.toFixed(1)}`);
}

/* ============================ §11.6 — O TESTE QUE AUTORIZA O MULTIJOGADOR = */
console.log("\n— DETERMINISMO: dois campos, a mesma lista, voxel a voxel —");
{
  const lista = [];
  let id = 1;
  /* Uma sequência variada: tiro de cima, tiro de lado, tiro de dentro. */
  for (let k = 0; k < 8; k++) {
    lista.push({ id: id++, x: -20 + k * 3, y: 6 - k * 2, z: 4, dx: 0.2, dy: -1, dz: 0, raio: 5, boca: k === 0 });
  }
  for (let k = 0; k < 10; k++) {
    lista.push({ id: id++, x: -14 + k * 4, y: 8, z: -70, dx: 1, dy: 0, dz: 0, raio: 6, boca: k === 0 });
  }
  for (let k = 0; k < 6; k++) {
    lista.push({ id: id++, x: -38, y: 10 - k * 3, z: -30 + k * 2, dx: 0, dy: -0.7, dz: 0.7, raio: 4 });
  }

  const a = new CampoCratera();
  const b = new CampoCratera();
  a.carregar(lista);
  b.carregar(lista);

  ok("mesmo número de chunks", a.chunks.size === b.chunks.size, `${a.chunks.size} vs ${b.chunks.size}`);

  let diferentes = 0;
  let comparados = 0;
  for (const [k, arrA] of a.chunks) {
    const arrB = b.chunks.get(k);
    if (!arrB) {
      diferentes += arrA.length;
      continue;
    }
    for (let i = 0; i < arrA.length; i++) {
      comparados++;
      if (arrA[i] !== arrB[i]) diferentes++;
    }
  }
  console.log(`  ${comparados.toLocaleString("pt-BR")} voxels comparados`);
  ok("ZERO voxels diferentes", diferentes === 0, `${diferentes} diferentes`);

  /* E a ordem importa mesmo? Aplicar ao contrário TEM de dar outro chão — se
     desse o mesmo, o §11.2 seria paranoia e o teste não estaria provando nada. */
  const c = new CampoCratera();
  c.carregar([...lista].reverse());
  let difOrdem = 0;
  for (const [k, arrA] of a.chunks) {
    const arrC = c.chunks.get(k);
    if (!arrC) continue;
    for (let i = 0; i < arrA.length; i++) if (arrA[i] !== arrC[i]) difOrdem++;
  }
  console.log(`  ordem invertida: ${difOrdem} voxels diferentes`);
  ok("a ordem REALMENTE importa (senão o contrato do §11.2 seria vazio)", difOrdem > 0);

  /* Idempotência: a mesma mensagem chegando duas vezes não cava duas vezes. */
  const antes = a.impactos.length;
  a.carregar(lista);
  ok("id repetido é ignorado", a.impactos.length === antes, `${a.impactos.length} impactos`);
}

/* ------------------------------------------------------------- física --- */
console.log("\n— chão, teto e normal —");
{
  const f = new CampoCratera();
  const h = f.alturaBase(20, 20);
  const chao = f.chaoAbaixo(20, h + 3, 20);
  ok("acha o chão sob os pés", Math.abs(chao - h) < 0.6, `${chao.toFixed(2)} vs ${h.toFixed(2)}`);
  ok("céu aberto acima", f.tetoAcima(20, h + 3, 20) === Infinity);

  /* Cava um vão e confere que ele passa a ter piso E teto. */
  f.escavar({ id: 900, x: 20, y: h - 10, z: 20, dx: 0, dy: -1, dz: 0, raio: 6 });
  const dentro = h - 10;
  const piso = f.chaoAbaixo(20, dentro, 20, 12);
  const teto = f.tetoAcima(20, dentro, 20, 12);
  console.log(`  vão interno: piso ${piso.toFixed(1)} · teto ${teto.toFixed(1)}`);
  ok("o vão tem piso", piso > -Infinity && piso < dentro);
  ok("o vão tem TETO — não é oco", teto < Infinity && teto > dentro, `teto ${teto.toFixed(1)}`);

  const n = f.normalEm(20, h, 20);
  ok("a normal aponta para cima na superfície", n.y > 0.3, `ny=${n.y.toFixed(2)}`);
}

console.log(`\n${falhas === 0 ? "TUDO CERTO" : falhas + " FALHA(S)"}\n`);
process.exit(falhas === 0 ? 0 : 1);
