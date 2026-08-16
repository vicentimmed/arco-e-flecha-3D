/* ---------------------------------------------------------------------------
   A MALHA — surface nets sobre a densidade, em pedaços.

   Ao contrário do campo, ESTE arquivo é de cliente: importa Three.js e só roda
   no navegador. A divisão é a do §11.4 do plano — a sala precisa do chão, não
   do desenho.

   ------------------------------------------------------------ o que ela faz

   Percorre a densidade e devolve a FRONTEIRA DO SÓLIDO: onde o campo troca de
   sinal, nasce superfície. Isso inclui a encosta de fora e a parede de toda
   cavidade, na mesma malha e sem distinção — é essa indiferença que faz o
   terreno não ser oco. Não há "casca do mundo" e "remendo do buraco"; há uma
   fronteira só.

   ------------------------------------------------- as três lições anteriores

   Já escrevi este malhador uma vez, e as três armadilhas dele custaram caro.
   Entram resolvidas, não descobertas de novo:

   1. **A AURÉOLA.** Um quad pertence a uma ARESTA e liga os vértices das quatro
      células em volta. Na face entre dois chunks, duas ficam de cada lado — e se
      cada chunk só varrer o próprio interior, essa face não é desenhada por
      NENHUM dos dois. O sintoma foi um anel aberto a cada chunk, por onde se via
      o outro lado da montanha. Aqui cada chunk amostra uma célula ANTES do
      próprio início e desenha as faces da sua borda baixa; a alta é do vizinho.
      Cada face sai exatamente uma vez.

   2. **A MÃO DOS QUADS.** A volta em torno da aresta tem de ter a mesma mão nos
      três eixos. Na primeira versão cada eixo tinha uma ordem escrita à mão e
      duas saíram invertidas: o túnel aparecia em pedaços, com metade dos quads
      virados para dentro. Aqui a regra é `(e+1)%3, (e+2)%3`, e a mão é a mesma
      por construção.

   3. **A NORMAL VEM DO GRADIENTE**, não da topologia dos quads. O campo é
      contínuo entre chunks; a topologia não é. Normal tirada das faces mudaria
      na fronteira e a costura apareceria como uma linha de iluminação diferente
      correndo pelo terreno.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { VOXEL, NC } from "./campo.js";

/** Células por lado, contando a auréola da borda baixa. */
const NCH = NC + 1;
/** Amostras por lado. */
const NS = NCH + 1;

/* Paleta do perfil de solo, por METROS ABAIXO da superfície original.
 *
 * A régua é a distância à superfície e não a cota, e é isso que faz um corte
 * parecer um corte: o que se vê na parede de um buraco é o subsolo daquele
 * ponto. Um poço de dez metros no alto de um morro mostra as mesmas camadas que
 * um poço de dez metros na clareira. */
const CAMADAS = [
  { p: 0, cor: new THREE.Color("#6f8f4a") }, // capim
  { p: 1.2, cor: new THREE.Color("#9c7f56") }, // terra raspada
  { p: 5, cor: new THREE.Color("#6b4b2c") }, // horizonte B
  { p: 14, cor: new THREE.Color("#5a5550") }, // rocha
  { p: 30, cor: new THREE.Color("#3b3936") }, // rocha-mãe
];

const _cor = new THREE.Color();
const _a = new THREE.Color();
const _b = new THREE.Color();

function corPorProfundidade(prof, out) {
  /* PROFUNDIDADE NEGATIVA É EJEÇÃO, e ejeção é TERRA.
   *
   * Um ponto acima da superfície original só pode estar ali porque o lábio da
   * cratera o levantou — e o que o lábio levanta é o material que saiu de
   * dentro do buraco. Sem esta linha ele herdava a primeira camada da tabela, o
   * capim, e o anel em volta da cratera nascia GRAMADO: um monte de terra
   * revirada com relva por cima, no instante seguinte à explosão.
   *
   * A transição é curta (meio metro) de propósito: manto de ejeção tem borda
   * definida. Um degradê longo leria como o capim escorrendo para dentro do
   * buraco. */
  if (prof < 0) {
    const t = prof < -0.5 ? 1 : -prof / 0.5;
    _a.copy(CAMADAS[0].cor);
    _b.copy(CAMADAS[1].cor);
    return out.copy(_a).lerp(_b, t * t * (3 - 2 * t));
  }
  if (prof <= CAMADAS[0].p) return out.copy(CAMADAS[0].cor);
  for (let i = 1; i < CAMADAS.length; i++) {
    if (prof < CAMADAS[i].p) {
      const a = CAMADAS[i - 1];
      const b = CAMADAS[i];
      const t = (prof - a.p) / (b.p - a.p);
      _a.copy(a.cor);
      _b.copy(b.cor);
      return out.copy(_a).lerp(_b, t * t * (3 - 2 * t));
    }
  }
  return out.copy(CAMADAS[CAMADAS.length - 1].cor);
}

export class MalhaCratera {
  /**
   * @param {THREE.Object3D} raiz
   * @param {import("./campo.js").CampoCratera} campo
   */
  constructor(raiz, campo) {
    this.raiz = raiz;
    this.campo = campo;

    /* LAMBERT e não Standard.
     *
     * O terreno ocupa a tela inteira, então o custo por FRAGMENTO dele é o custo
     * do quadro. O Standard paga BRDF completa — especular, rugosidade,
     * Fresnel — e este chão é terra fosca: `roughness` 0,94 e `metalness` zero
     * jogavam quase todo esse trabalho fora antes de virar pixel. O Lambert dá a
     * mesma leitura por uma fração do preço. */
    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      /* UMA FACE.
       *
       * Era `DoubleSide`, posto como rede de segurança enquanto a mão dos quads
       * ainda não era confiável. Ela passou a ser (ver a lição 2 no cabeçalho: a
       * volta em torno da aresta sai da regra `(e+1)%3, (e+2)%3` e não de três
       * ordens escritas à mão), e aí a rede de segurança virou só custo: duas
       * faces dobram o trabalho de fragmento de TODO o terreno, e o terreno é o
       * que ocupa a tela inteira.
       *
       * A parede de caverna continua visível por dentro porque a normal dela
       * aponta para o vão — é a fronteira do sólido, e o lado de fora do sólido
       * é justamente onde está quem olha. */
      side: THREE.FrontSide,
      dithering: true,
    });

    /** @type {Map<number, {cx:number,cy:number,cz:number,mesh:THREE.Mesh|null,sujo:boolean}>} */
    this.pedacos = new Map();
    this.fila = [];

    /* Rascunhos, alocados uma vez. 34³ floats são 157 KB. */
    this._d = new Float32Array(NS * NS * NS);
    this._v = new Int32Array(NCH * NCH * NCH);
    this._pos = [];
    this._nor = [];
    this._col = [];
    this._idx = [];

    this.triangulos = 0;
  }

  chave(cx, cy, cz) {
    return (((cx + 512) & 1023) << 20) | (((cy + 512) & 1023) << 10) | ((cz + 512) & 1023);
  }

  /** Este pedaço já foi escavado alguma vez? Ver a poda em `construir`. */
  escavado(p) {
    return this.campo.chunks.has(this.chave(p.cx, p.cy, p.cz));
  }

  /** Marca um pedaço para (re)construir. Chamado pelo campo, ao escavar. */
  sujar(cx, cy, cz) {
    const k = this.chave(cx, cy, cz);
    let p = this.pedacos.get(k);
    if (!p) this.pedacos.set(k, (p = { cx, cy, cz, mesh: null, sujo: true }));
    p.sujo = true;
    if (!this.fila.includes(k)) this.fila.push(k);
  }

  /** Marca a caixa inteira — usado na montagem inicial da arena. */
  sujarCaixa(cx0, cy0, cz0, cx1, cy1, cz1) {
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cz = cz0; cz <= cz1; cz++) this.sujar(cx, cy, cz);
      }
    }
  }

  /**
   * Constrói até `orcamento` pedaços. Fatiado porque um golpe suja vários de uma
   * vez, e travar o quadro para malhar troca um defeito visual por um de
   * jogabilidade.
   */
  passo(orcamento = 2) {
    let feitos = 0;
    while (this.fila.length > 0 && feitos < orcamento) {
      const k = this.fila.shift();
      const p = this.pedacos.get(k);
      if (!p || !p.sujo) continue;
      this.construir(p);
      feitos++;
    }
    return this.fila.length;
  }

  /** Constrói tudo o que está na fila, de uma vez. Para a montagem inicial. */
  tudo() {
    while (this.fila.length > 0) this.passo(64);
  }

  /**
   * Constrói pelo tempo que couber no quadro, e nem um milissegundo a mais.
   *
   * Orçamento em TEMPO e não em contagem de pedaços, e a diferença aparece
   * justamente quando importa: um pedaço vazio custa microssegundos e um atra-
   * vessado por um túnel custa dez milissegundos. Contar pedaços faz o quadro
   * engasgar exatamente no instante do tiro, que é o pior momento possível —
   * o jogador leria a escavação como travamento.
   */
  passoTempo(ms = 7) {
    if (this.fila.length === 0) return 0;
    const fim = performance.now() + ms;
    while (this.fila.length > 0) {
      this.passo(1);
      if (performance.now() >= fim) break;
    }
    return this.fila.length;
  }

  /* ------------------------------------------------------------ construir -- */

  construir(p) {
    const campo = this.campo;
    const d = this._d;

    /* A PODA. Sem ela a montagem da arena amostrava 38 milhões de pontos e
       travava a página por dezenas de segundos — e quase todos esses pontos
       eram miolo de pedra ou céu limpo, onde não há superfície nenhuma.
       
       Cinco consultas de `alturaBase` dizem em que faixa de cota a superfície
       daquele pedaço pode estar. Se a caixa do pedaço está inteira acima dela,
       é céu; inteira abaixo, é rocha. A margem cobre a rugosidade 3D do subsolo
       e o lábio de ejeção.

       Só vale para pedaço INTOCADO: um que já foi escavado pode ter cavidade em
       qualquer cota, e aí não há atalho — tem de ser amostrado. */
    if (!this.escavado(p)) {
      const x0 = p.cx * NC * VOXEL;
      const z0 = p.cz * NC * VOXEL;
      const L = NC * VOXEL;
      let hMin = Infinity;
      let hMax = -Infinity;
      for (const [ax, az] of [
        [0, 0],
        [L, 0],
        [0, L],
        [L, L],
        [L * 0.5, L * 0.5],
      ]) {
        const h = campo.alturaBase(x0 + ax, z0 + az);
        if (h < hMin) hMin = h;
        if (h > hMax) hMax = h;
      }
      const yBaixo = (p.cy * NC - 1) * VOXEL;
      const yAlto = (p.cy * NC + NC + 1) * VOXEL;
      const MARGEM = 10;
      if (yBaixo > hMax + MARGEM || yAlto < hMin - MARGEM) {
        this.soltar(p);
        p.sujo = false;
        return;
      }
    }

    /* As amostras, com a auréola: o índice 0 é UMA CÉLULA ANTES do início do
       pedaço. Ver a lição 1 no cabeçalho. */
    const ox = p.cx * NC - 1;
    const oy = p.cy * NC - 1;
    const oz = p.cz * NC - 1;

    /* Um bloco de uma vez, e não amostra a amostra: `amostrarBloco` cacheia a
       cota da superfície por coluna, o que corta trinta e quatro sextos do
       trabalho. Ver lá. */
    campo.amostrarBloco(ox, oy, oz, NS, d);
    let temPedra = false;
    let temAr = false;
    for (let i = 0; i < NS * NS * NS; i++) {
      if (d[i] > 0) temPedra = true;
      else temAr = true;
      if (temPedra && temAr) break;
    }

    this.soltar(p);
    p.sujo = false;
    /* Pedaço todo sólido ou todo vazio não tem superfície — e é a maioria
       esmagadora deles, num mundo que é quase todo miolo de pedra ou céu. Sair
       aqui é o que mantém o custo proporcional à ÁREA e não ao volume. */
    if (!temPedra || !temAr) return;

    this.malhar(p, ox, oy, oz);
  }

  malhar(p, ox, oy, oz) {
    const d = this._d;
    const vert = this._v;
    const pos = ((this._pos.length = 0), this._pos);
    const nor = ((this._nor.length = 0), this._nor);
    const col = ((this._col.length = 0), this._col);
    const idx = ((this._idx.length = 0), this._idx);
    vert.fill(-1);

    const am = (ix, iy, iz) => d[(iy * NS + iz) * NS + ix];
    const vi = (ix, iy, iz) => vert[(iy * NCH + iz) * NCH + ix];
    const campo = this.campo;

    /* ---------------------------------------------------------- vértices -- */
    for (let iy = 0; iy < NCH; iy++) {
      for (let iz = 0; iz < NCH; iz++) {
        for (let ix = 0; ix < NCH; ix++) {
          let dentro = 0;
          for (let k = 0; k < 8; k++) {
            if (am(ix + (k & 1), iy + ((k >> 1) & 1), iz + ((k >> 2) & 1)) > 0) dentro++;
          }
          if (dentro === 0 || dentro === 8) continue;

          /* O vértice é o CENTRÓIDE dos cruzamentos das doze arestas. É o que
             separa surface nets de um voxel cúbico: o ponto desliza para dentro
             da célula conforme a superfície passa, e a parede sai lisa em vez de
             escadinha de meio metro. */
          let sx = 0;
          let sy = 0;
          let sz = 0;
          let n = 0;
          for (let e = 0; e < 3; e++) {
            for (let c = 0; c < 4; c++) {
              const ax = ix + (e === 0 ? 0 : e === 1 ? c & 1 : c & 1);
              const ay = iy + (e === 0 ? c & 1 : e === 1 ? 0 : (c >> 1) & 1);
              const az = iz + (e === 0 ? (c >> 1) & 1 : e === 1 ? (c >> 1) & 1 : 0);
              const bx = ax + (e === 0 ? 1 : 0);
              const by = ay + (e === 1 ? 1 : 0);
              const bz = az + (e === 2 ? 1 : 0);
              const da = am(ax, ay, az);
              const db = am(bx, by, bz);
              if (da > 0 === db > 0) continue;
              const t = da / (da - db);
              sx += ax + (bx - ax) * t - ix;
              sy += ay + (by - ay) * t - iy;
              sz += az + (bz - az) * t - iz;
              n++;
            }
          }
          if (n === 0) continue;

          const px = (ox + ix + sx / n) * VOXEL;
          const py = (oy + iy + sy / n) * VOXEL;
          const pz = (oz + iz + sz / n) * VOXEL;

          vert[(iy * NCH + iz) * NCH + ix] = pos.length / 3;
          pos.push(px, py, pz);

          /* A NORMAL, do gradiente — lição 3, mas tirado do BLOCO já amostrado.
           *
           * A primeira versão chamava `densidadeEm` seis vezes por vértice, e
           * cada uma dessas faz oito leituras da grade: quarenta e oito por
           * vértice, cento e noventa mil vértices. Era o gargalo da montagem
           * inteira, medido. As oito amostras dos cantos desta célula já estão
           * na mão — a média das diferenças nas quatro arestas de cada eixo dá o
           * mesmo gradiente pelo custo de nada.
           *
           * Continua contínuo entre pedaços porque a grade é a mesma dos dois
           * lados da fronteira; é a TOPOLOGIA que muda, e é justamente dela que
           * este cálculo não depende. */
          const p000 = am(ix, iy, iz);
          const p100 = am(ix + 1, iy, iz);
          const p010 = am(ix, iy + 1, iz);
          const p110 = am(ix + 1, iy + 1, iz);
          const p001 = am(ix, iy, iz + 1);
          const p101 = am(ix + 1, iy, iz + 1);
          const p011 = am(ix, iy + 1, iz + 1);
          const p111 = am(ix + 1, iy + 1, iz + 1);
          const gx = p100 - p000 + (p110 - p010) + (p101 - p001) + (p111 - p011);
          const gy = p010 - p000 + (p110 - p100) + (p011 - p001) + (p111 - p101);
          const gz = p001 - p000 + (p101 - p100) + (p011 - p010) + (p111 - p110);
          const gm = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
          nor.push(-gx / gm, -gy / gm, -gz / gm);

          /* A cor por PROFUNDIDADE ESCAVADA. */
          corPorProfundidade(campo.alturaBase(px, pz) - py, _cor);
          col.push(_cor.r, _cor.g, _cor.b);
        }
      }
    }

    if (pos.length === 0) return;

    /* -------------------------------------------------------------- quads -- */
    /* Para a aresta no eixo `e`, os outros dois são (e+1)%3 e (e+2)%3, NESSA
       ordem, e as quatro células se percorrem 0, −u, −u−v, −v. Escrita assim a
       mão é a mesma nos três casos por construção — lição 2. */
    for (let iy = 1; iy < NCH; iy++) {
      for (let iz = 1; iz < NCH; iz++) {
        for (let ix = 1; ix < NCH; ix++) {
          const d0 = am(ix, iy, iz) > 0;
          const q0 = vi(ix, iy, iz);

          if (d0 !== am(ix + 1, iy, iz) > 0) {
            // e = X → u = Y, v = Z
            this.quad(idx, q0, vi(ix, iy - 1, iz), vi(ix, iy - 1, iz - 1), vi(ix, iy, iz - 1), d0);
          }
          if (d0 !== am(ix, iy + 1, iz) > 0) {
            // e = Y → u = Z, v = X
            this.quad(idx, q0, vi(ix, iy, iz - 1), vi(ix - 1, iy, iz - 1), vi(ix - 1, iy, iz), d0);
          }
          if (d0 !== am(ix, iy, iz + 1) > 0) {
            // e = Z → u = X, v = Y
            this.quad(idx, q0, vi(ix - 1, iy, iz), vi(ix - 1, iy - 1, iz), vi(ix, iy - 1, iz), d0);
          }
        }
      }
    }

    if (idx.length === 0) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, this.material);
    p.mesh = mesh;
    this.raiz.add(mesh);
    this.triangulos += idx.length / 3;
  }

  quad(idx, a, b, c, d, dentro) {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (dentro) idx.push(a, b, c, a, c, d);
    else idx.push(a, c, b, a, d, c);
  }

  soltar(p) {
    if (!p.mesh) return;
    this.triangulos -= p.mesh.geometry.index.count / 3;
    this.raiz.remove(p.mesh);
    p.mesh.geometry.dispose();
    p.mesh = null;
  }

  dispose() {
    for (const p of this.pedacos.values()) this.soltar(p);
    this.pedacos.clear();
    this.fila.length = 0;
    this.material.dispose();
  }
}
