/* ---------------------------------------------------------------------------
   O que para uma flecha, para o servidor.

   O cliente tem Rapier: cada peça de cenário é um colisor de verdade e a flecha
   bate nela sem que ninguém precise escrever geometria. O servidor não tem malha
   nenhuma — e precisa das mesmas respostas, porque é ELE que integra a flecha do
   bot (`server/botArrow.js`) e decide se o bot tem visada (`server/botSim.js`).

   Este módulo é essa geometria, e só ela. Não conhece Three, nem Rapier, nem
   fase: recebe uma lista de sólidos e um segmento, e responde se o segmento
   atravessa algum. Quem monta a lista é `valleyProps.js` (o vale) e
   `moonProps.js` (a Lua).

   ------------------------------------------------------------------ o formato

   Duas formas, porque são as duas que o cenário realmente usa:

   • CILINDRO VERTICAL — `{ x, z, r, h, base }`. Tronco, rocha, casco do foguete,
     disco de plataforma. É a forma original, e continua sendo o padrão quando o
     sólido não diz que é caixa.

   • CAIXA ORIENTADA — `{ box: true, x, y, z, hx, hy, hz, ry, rz }`, com `x,y,z`
     no CENTRO e meias-arestas `h*`. Domo, painel solar, módulo de pouso,
     contêiner. A rotação é `ry` em torno de Y e depois `rz` em torno de Z — a
     MESMA ordem que `MoonBase.solid()` usa para orientar o colisor de Rapier,
     e é o que garante que os dois lados estejam falando da mesma caixa.

   Aproximar uma caixa por um cilindro seria mais curto e estaria errado dos dois
   jeitos ao mesmo tempo: pelo raio circunscrito, a flecha do bot pararia no ar
   ao lado do contêiner; pelo inscrito, atravessaria a quina. O teste de caixa
   abaixo é exato, e custa três produtos escalares.
   --------------------------------------------------------------------------- */

/**
 * O segmento [a, b] atravessa algum sólido?
 *
 * @param {Array<object>} blockers cilindros e/ou caixas, no formato acima
 * @param {{x:number,y:number,z:number}} a início do trecho
 * @param {{x:number,y:number,z:number}} b fim do trecho
 */
export function bloqueado(blockers, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  if (dx * dx + dy * dy + dz * dz < 1e-12) return false;

  for (const o of blockers) {
    if (o.box ? cortaCaixa(o, a, dx, dy, dz) : cortaCilindro(o, a, dx, dy, dz)) {
      return true;
    }
  }
  return false;
}

/**
 * Cilindro vertical, em duas partes: a distância horizontal ao eixo e a faixa
 * de altura. Separar as duas é o que deixa a conta barata — e é correto,
 * porque o cilindro é vertical por construção.
 */
function cortaCilindro(o, a, dx, dy, dz) {
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-9) {
    /* Tiro na vertical: no plano ele é um ponto, e a faixa de altura do
       segmento inteiro é que decide. Sem este caso, uma flecha subindo em
       linha reta dentro do casco do foguete não bateria em nada. */
    if (Math.hypot(a.x - o.x, a.z - o.z) > o.r) return false;
    const yA = Math.min(a.y, a.y + dy);
    const yB = Math.max(a.y, a.y + dy);
    return yB >= o.base && yA <= o.base + o.h;
  }

  // Parâmetro do ponto mais próximo, no plano.
  let s = ((o.x - a.x) * dx + (o.z - a.z) * dz) / len2;
  if (s < 0) s = 0;
  else if (s > 1) s = 1;
  const px = a.x + dx * s;
  const pz = a.z + dz * s;
  if (Math.hypot(px - o.x, pz - o.z) > o.r) return false;

  // Passa perto no plano: a altura decide. Sem esta parte, uma flecha alta
  // sobre a copa contaria como bloqueada por um tronco de três metros.
  const y = a.y + dy * s;
  return y >= o.base && y <= o.base + o.h;
}

/**
 * Caixa orientada, pelo método das fatias (slab).
 *
 * O segmento é projetado nos três eixos LOCAIS da caixa e o intervalo de
 * parâmetro `s` vai sendo aparado por um par de planos de cada vez. Sobrou
 * intervalo no fim: atravessou. É o mesmo teste de um raio contra AABB, só que
 * feito no referencial da caixa, o que dispensa girar a caixa para o mundo.
 */
function cortaCaixa(o, a, dx, dy, dz) {
  const ry = o.ry ?? 0;
  const rz = o.rz ?? 0;
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);

  /* Os eixos locais no mundo: as colunas de R = Ry(ry)·Rz(rz). A ordem
     importa e é a de `MoonBase.solid()` — invertê-la torceria toda peça que
     tem as duas rotações. */
  const ux = { x: cy * cz, y: sz, z: -sy * cz };
  const uy = { x: -cy * sz, y: cz, z: sy * sz };
  const uz = { x: sy, y: 0, z: cy };

  // Do centro da caixa até o início do segmento.
  const ox = a.x - o.x;
  const oy = a.y - o.y;
  const oz = a.z - o.z;

  let s0 = 0;
  let s1 = 1;

  const eixos = [
    [ux, o.hx],
    [uy, o.hy],
    [uz, o.hz],
  ];
  for (const [u, h] of eixos) {
    const inicio = ox * u.x + oy * u.y + oz * u.z;
    const passo = dx * u.x + dy * u.y + dz * u.z;

    if (Math.abs(passo) < 1e-9) {
      // Paralelo a esta fatia: ou já está dentro dela o tempo todo, ou nunca.
      if (inicio < -h || inicio > h) return false;
      continue;
    }
    let t0 = (-h - inicio) / passo;
    let t1 = (h - inicio) / passo;
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
    if (t0 > s0) s0 = t0;
    if (t1 < s1) s1 = t1;
    if (s0 > s1) return false;
  }
  return true;
}
