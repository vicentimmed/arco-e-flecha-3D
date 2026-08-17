/* ---------------------------------------------------------------------------
   O peixe gigante — a metade que APARECE.

   É o bicho do começo de Dragon Ball, aquele que o Goku pesca: enorme, corpo
   roliço, boca escancarada, barbatanas grandes. De tempos em tempos ele rompe a
   superfície do mar num arco, parafusa o corpo no ar e mergulha de volta. Os
   poderes dos jogadores o matam; depois que um morre, demora até aparecer outro.

   Quem DECIDE tudo isso é `server/namek/peixe.js` — quando, onde, com que forma
   de arco, e quanta vida sobrou. Este arquivo não sorteia um único número: ele
   recebe o salto pronto (`NS2C.FISH`, nove números) e integra a mesma parábola
   que a sala integra. É o que garante que quinze telas vejam o MESMO peixe no
   mesmo lugar sem gastar um byte por quadro.

   ------------------------------------------------------- fora do salto ele SOME

   A escolha está aqui e ela é deliberada: **entre um salto e outro não existe
   peixe.** Nem corpo na cena, nem alvo para os projéteis, nem consulta por
   quadro. O único resto é o VULTO — o corpo subindo debaixo d'água nos
   `NAMEK.peixe.aviso` segundos que antecedem a saída.

   E o vulto sai de graça, o que é a parte bonita: o mar de `water.js` é
   TRANSLÚCIDO na faixa da costa (`alfa = 0,72` para dentro de ~700 m, que é
   justamente onde o peixe vive) e não escreve profundidade. Um corpo opaco
   debaixo dele aparece naturalmente escurecido e esverdeado, sem uma linha de
   código de sombra e sem um segundo material. O vulto não é um decalque nem uma
   mancha desenhada: é o peixe de verdade, visto através da água que já estava lá.

   O `renderOrder` 9 é o que amarra isso — um a menos que o do mar. Sem ele a
   ordenação de transparências poria o corpo DEPOIS da água em alguns ângulos, e
   o vulto ficaria alternando entre nítido e submerso conforme a câmera girasse.

   ---------------------------------------------------------- o corpo, por código

   Nenhuma textura, como todo o resto do jogo. São cinco malhas e um material só:

     corpo      anéis ao longo do eixo + dorsal + goela + lábio + olhos, tudo
                fundido num buffer — 1 chamada de desenho
     mandíbula  a boca abre e fecha; separada porque ela GIRA
     cauda      a nadadeira que varre de um lado para o outro
     peitorais  duas, batendo em espelho

   A cor mora no VÉRTICE (dorso escuro → barriga quase branca), e é ela que faz o
   corpo virado de barriga para cima ler como peixe MORTO em vez de peixe de
   cabeça para baixo. Um material com `vertexColors` custa o mesmo que um sem.

   ------------------------------------------------------------------ o respingo

   Duas camadas, e a divisão importa. A COROA de espuma (uma casca cônica que
   cresce e desbota) é geometria própria e aparece em qualquer distância — é ela
   que diz, do meio da arena, que alguma coisa saiu da água a setecentos metros.
   As GOTAS são partículas do pool de `fx/`, e o pool corta tudo além de 400 m de
   propósito (ver `NamekFx.detalhar`): elas são o detalhe de quem chegou perto.
   Sem a primeira camada, o salto visto de longe seria mudo; sem a segunda, visto
   de perto seria pobre.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { NAMEK } from "../../shared/namek/config.js";
import { clamp, damp, smoothstep } from "../../utils/math.js";

/**
 * O id do peixe na lista de alvos do sistema de poderes.
 *
 * Vem do config e não de um literal daqui porque os ids negativos são um espaço
 * de nomes COMPARTILHADO entre tudo o que é alvo sem ser gente — o Freeza tem o
 * −1, o peixe tem o −2 —, e um espaço de nomes espalhado por três arquivos é um
 * espaço de nomes que ninguém confere. Ver `NAMEK.peixe.alvoId`.
 *
 * Um NÚMERO, e não a string `"peixe"`, porque `atingivel` e `alvoPorId` comparam
 * com `!==` e um tipo diferente ali é a classe de defeito que só aparece no dia
 * em que alguém trocar a comparação.
 */
export const PEIXE_ALVO_ID = NAMEK.peixe.alvoId;

/** O eixo do sopro das gotas. Objeto de módulo: `fagulhas` só o lê, não o guarda. */
const PARA_CIMA = { x: 0, y: 1, z: 0 };

/** Anéis ao longo do corpo. 18 é onde o dorso para de facetar visivelmente. */
const ANEIS = 18;
/** Lados de cada anel. 14 basta: o corpo é redondo, não tem quina para mostrar. */
const LADOS = 14;

/* O PERFIL DO CORPO: (z normalizado, meia-altura, meia-largura), em frações de
   `NAMEK.peixe.altura` e `NAMEK.peixe.largura`.

   `zn` vai de −1 (base da cauda) a +1 (borda da boca). A tabela é lida com
   `smoothstep` entre as linhas, como a densidade radial do mar em `water.js` —
   uma tabela é mais fácil de reequilibrar do que uma fórmula, e o corpo de um
   bicho é justamente a coisa que se reequilibra olhando.

   A forma que estes números descrevem é a da referência: pedúnculo fino, bojo
   enorme logo depois do meio, cabeça larga que quase não afina, e uma boca que
   termina redonda em vez de em bico. Um peixe hidrodinâmico teria o perfil
   invertido — e leria como atum, não como o monstro do rio. */
const PERFIL = [
  [-1.0, 0.05, 0.03],
  [-0.86, 0.16, 0.08],
  [-0.72, 0.25, 0.16],
  [-0.45, 0.58, 0.54],
  [-0.1, 0.98, 0.96],
  [0.18, 1.0, 1.0],
  [0.48, 0.94, 0.97],
  [0.74, 0.8, 0.88],
  [0.9, 0.63, 0.72],
  [1.0, 0.5, 0.58],
];

/** Fração de `comprimento` que a boca afunda para dentro da cabeça. */
const GOELA_FUNDURA = 0.22;

/** Altura da coroa de espuma, em frações do raio dela. */
const COROA_PROPORCAO = 0.55;
/** s — quanto dura um respingo. */
const RESPINGO_VIDA = 1.15;

/** Tinta do material sob tempestade. Ver `setStorm`. */
const TINTA_DIA = new THREE.Color(0xffffff);
const TINTA_TEMPESTADE = new THREE.Color(0x8a5f52);

/** Interpola a tabela de perfil. Escreve em `out` para não alocar. */
function perfilEm(zn, out) {
  if (zn <= PERFIL[0][0]) {
    out.h = PERFIL[0][1];
    out.w = PERFIL[0][2];
    return out;
  }
  for (let i = 1; i < PERFIL.length; i++) {
    const [z0, h0, w0] = PERFIL[i - 1];
    const [z1, h1, w1] = PERFIL[i];
    if (zn > z1) continue;
    const t = smoothstep(z0, z1, zn);
    out.h = h0 + (h1 - h0) * t;
    out.w = w0 + (w1 - w0) * t;
    return out;
  }
  const u = PERFIL[PERFIL.length - 1];
  out.h = u[1];
  out.w = u[2];
  return out;
}

/**
 * Põe uma cor por vértice na geometria e joga fora o que não se usa.
 *
 * O `uv` sai porque não há textura nenhuma neste jogo e porque `mergeGeometries`
 * exige o MESMO conjunto de atributos em todas as peças — manter o `uv` de uma
 * `SphereGeometry` obrigaria a inventar um para os anéis feitos à mão só para as
 * duas poderem ser fundidas.
 *
 * Com `corBaixa` a cor vira um degradê pela altura LOCAL: é assim que o dorso
 * escuro vira barriga clara sem um segundo material e sem uma textura. Em `de`
 * (embaixo) vale a clara, em `ate` (em cima) vale a escura.
 */
function pintar(geo, corAlta, corBaixa = null, de = 0, ate = 1) {
  geo.deleteAttribute("uv");
  if (!geo.getAttribute("normal")) geo.computeVertexNormals();
  const pos = geo.getAttribute("position");
  const n = pos.count;
  const cores = new Float32Array(n * 3);
  const alta = new THREE.Color(corAlta);
  const baixa = corBaixa === null ? null : new THREE.Color(corBaixa);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    if (baixa) c.lerpColors(baixa, alta, smoothstep(de, ate, pos.getY(i)));
    else c.copy(alta);
    cores[i * 3] = c.r;
    cores[i * 3 + 1] = c.g;
    cores[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cores, 3));
  return geo;
}

/** Um anel elíptico do corpo, escrito direto no buffer. */
function anelEm(pos, base, zn, z, alt, larg, escala, perf) {
  perfilEm(zn, perf);
  for (let s = 0; s < LADOS; s++) {
    const ang = (s / LADOS) * Math.PI * 2;
    const i3 = (base + s) * 3;
    pos[i3] = Math.sin(ang) * perf.w * larg * 0.5 * escala;
    pos[i3 + 1] = Math.cos(ang) * perf.h * alt * 0.5 * escala;
    pos[i3 + 2] = z;
  }
}

/**
 * O tronco: anéis elípticos ao longo de +Z, fechado atrás e ABERTO na frente.
 *
 * Feito à mão em vez de uma esfera deformada porque a deformação teria de
 * dividir pelo raio da esfera para chegar ao perfil, e nos polos esse raio é
 * zero — o conserto seria uma guarda por vértice para produzir a mesma malha que
 * trinta linhas de laço produzem direito.
 *
 * A frente fica aberta de propósito: quem a tampa é `montarGoela`, com um funil
 * que entra pela cabeça adentro. É a diferença entre uma boca e um disco pintado
 * no focinho — e é o que o §"boca larga" da referência pede.
 */
function montarTronco(comp, alt, larg) {
  const meia = comp * 0.5;
  const perf = { h: 0, w: 0 };

  /* +1 vértice: a cauda vira um ponto só (leque). A boca não tem tampa. */
  const nVerts = ANEIS * LADOS + 1;
  const pos = new Float32Array(nVerts * 3);
  const idx = [];

  for (let k = 0; k < ANEIS; k++) {
    const zn = -1 + (2 * k) / (ANEIS - 1);
    anelEm(pos, k * LADOS, zn, zn * meia, alt, larg, 1, perf);
  }
  const iCauda = ANEIS * LADOS;
  pos[iCauda * 3 + 2] = -meia;

  const vert = (k, s) => k * LADOS + (((s % LADOS) + LADOS) % LADOS);
  for (let k = 0; k < ANEIS - 1; k++) {
    for (let s = 0; s < LADOS; s++) {
      const a0 = vert(k, s);
      const a1 = vert(k, s + 1);
      const b0 = vert(k + 1, s);
      const b1 = vert(k + 1, s + 1);
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  }
  for (let s = 0; s < LADOS; s++) idx.push(iCauda, vert(0, s + 1), vert(0, s));

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A GOELA: o funil que entra pela boca adentro, pintado de preto.
 *
 * Nasce exatamente sobre o último anel do tronco — mesma tabela, mesmo `LADOS`,
 * mesma elipse —, e é por isso que não há costura visível na borda da boca. Um
 * cone de `ConeGeometry` seria circular e a boca é elíptica: a junção apareceria
 * como uma coroa de triângulos abrindo e fechando conforme o giro do corpo.
 */
function montarGoela(comp, alt, larg) {
  const meia = comp * 0.5;
  const perf = { h: 0, w: 0 };
  const fundo = comp * GOELA_FUNDURA;

  const nVerts = LADOS * 2 + 1;
  const pos = new Float32Array(nVerts * 3);
  anelEm(pos, 0, 1, meia, alt, larg, 1, perf);
  anelEm(pos, LADOS, 1, meia - fundo * 0.42, alt, larg, 0.58, perf);
  const iFundo = LADOS * 2;
  pos[iFundo * 3 + 2] = meia - fundo;

  const idx = [];
  const anel = (k, s) => k * LADOS + (((s % LADOS) + LADOS) % LADOS);
  for (let s = 0; s < LADOS; s++) {
    const a0 = anel(0, s);
    const a1 = anel(0, s + 1);
    const b0 = anel(1, s);
    const b1 = anel(1, s + 1);
    idx.push(a0, a1, b0, a1, b1, b0);
    idx.push(b0, b1, iFundo);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Uma barbatana: chapa plana no plano x = 0, com o contorno em leque.
 *
 * Chapa e não cunha: uma barbatana com espessura são o dobro de triângulos para
 * mostrar dois centímetros de borda que, no tamanho de tela em que este peixe
 * aparece, valem meio pixel. O material do bicho é `DoubleSide` por causa
 * delas — ver `build`.
 *
 * @param {number} comp corda da base, ao longo de Z
 * @param {number} alt altura, em +Y
 * @param {number} recuo o quanto a ponta corre para trás — a "vela" da peça
 */
function montarBarbatana(comp, alt, recuo) {
  const pos = new Float32Array([
    0, 0, comp * 0.5,
    0, 0, -comp * 0.5,
    0, alt, -comp * 0.5 - recuo,
    0, alt * 0.62, comp * 0.16 - recuo * 0.35,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A cauda: dois lobos em V, no plano YZ, com a raiz na origem da peça.
 *
 * Ela fica ATRÁS do tronco e por isso o bicho é ~15 % mais comprido que
 * `NAMEK.peixe.comprimento`, que mede o corpo do focinho à base da cauda. É a
 * convenção mais útil das duas: `comprimento` é o número que dimensiona o
 * perfil, e ninguém quer reescrever a tabela para mudar o tamanho da nadadeira.
 */
function montarCauda(comp, alt) {
  const pos = new Float32Array([
    0, 0, 0,
    0, alt * 0.55, -comp,
    0, alt * 0.1, -comp * 0.42,
    0, -alt * 0.55, -comp,
    0, -alt * 0.1, -comp * 0.42,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex([0, 2, 1, 0, 3, 4]);
  geo.computeVertexNormals();
  return geo;
}

/* -------------------------------------------------------------- a classe --- */

export class NamekPeixe {
  /**
   * @param {import("../fx/index.js").NamekFx} [fx] o pool de partículas.
   *   Opcional pelo mesmo motivo que o da lava é: a bancada de cenário monta o
   *   mundo sem o jogo em volta, e sem o pool o peixe continua saltando — só não
   *   espirra gota nenhuma.
   */
  constructor(fx = null) {
    this.fx = fx;
    /** Preenchido por `NamekGame.build`. Este arquivo só CHAMA a API do som. */
    this.audio = null;

    /** O salto anunciado pela sala, ou null. Ver `agendar`. */
    this.salto = null;
    /** A animação de morte, ou null. É a única parte LOCAL do bicho. */
    this.morte = null;

    /* Os dois respingos já emitidos deste salto. Bandeiras e não relógios: o
       instante certo já está no salto, e o que falta saber é só se o quadro
       anterior já passou por ele. */
    this._espirrouSaida = false;
    this._espirrouEntrada = false;

    /** s desde a quebra da superfície, do último quadro. */
    this._tempo = 0;

    /* A pose do quadro, reescrita sempre. Campo e não retorno novo: `pose` roda
       uma vez por quadro enquanto há peixe, e o §3 do plano cobra 0 B por quadro
       em regime. */
    this._pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, submerso: 1, nado: 0 };
    /** Saída de `rumoEm` — o versor horizontal do arco, e o módulo dele. */
    this._dir = { x: 0, z: 0, vel: 0 };

    /* O registro de alvo entregue ao sistema de poderes. Mesmo banco reusado que
       `RemoteFighters.alvos` mantém, e pelo mesmo motivo. */
    this._alvo = {
      id: PEIXE_ALVO_ID,
      x: 0,
      y: 0,
      z: 0,
      raio: NAMEK.peixe.raioAcerto,
      /* A cápsula de `distancia2AoAlvo` degenera numa ESFERA quando a altura é
         dois raios: `de` e `ate` colapsam no mesmo ponto. É a forma certa para
         um corpo que gira no ar — ver `NAMEK.peixe.raioAcerto`. */
      altura: NAMEK.peixe.raioAcerto * 2,
      vivo: true,
      invuln: false,
    };

    /** 0…1 — o tranco de quem acabou de levar um tiro, decaindo. */
    this._dor = 0;
    /** Relógio próprio das barbatanas e da boca. */
    this._fase = 0;
    /** Abertura da boca, amortecida. 0 fechada, 1 escancarada. */
    this._boca = 0;

    this.grupo = null;
    this.corpo = null;
    this.mandibula = null;
    this.cauda = null;
    this.peitorais = [];
    this.material = null;
    this.respingos = [];
  }

  /* ---------------------------------------------------------------- monta -- */

  build(parent) {
    const P = NAMEK.peixe;
    const C = P.comprimento;
    const A = P.altura;
    const L = P.largura;

    /* UM material para o bicho inteiro. `vertexColors` é o que permite dorso,
       barriga, barbatana, olho e goela saírem de um buffer só; `DoubleSide`
       existe pelas barbatanas, que são chapas sem espessura. */
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.38,
      metalness: 0.05,
      side: THREE.DoubleSide,
      /* Transparente desde o começo, e não só na hora de afundar: trocar
         `transparent` em jogo obriga o Three a RECOMPILAR o programa do
         material, e a recompilação cairia exatamente no quadro em que o corpo
         começa a desbotar — um engasgo no meio do efeito. */
      transparent: true,
      opacity: 1,
      depthWrite: true,
    });

    /* --------------------------------------------------------------- tronco */
    const partes = [];
    partes.push(pintar(montarTronco(C, A, L), P.cor, P.corBarriga, -A * 0.34, A * 0.12));
    /* A goela, preta, fechando a boca por dentro. */
    partes.push(pintar(montarGoela(C, A, L), P.corOlho));

    /* A DORSAL, deitada no plano de simetria e enfiada no dorso — a base entra
       um pouco no corpo para não sobrar fresta quando ele rola no ar. */
    const dorsal = montarBarbatana(C * 0.34, A * 0.5, C * 0.1);
    dorsal.translate(0, A * 0.42, C * 0.02);
    partes.push(pintar(dorsal, P.corBarbatana));

    /* O LÁBIO: o anel grosso em volta da boca. É ele que dá a "boca larga" da
       referência — sem o anel, a abertura some contra o corpo à distância. O
       toro nasce circular e é achatado para a elipse da boca (o último anel do
       perfil: 0,58 de largura por 0,50 de altura). */
    const bocaW = 0.58 * L * 0.5;
    const bocaH = 0.5 * A * 0.5;
    const labio = new THREE.TorusGeometry(1, 0.16, 8, 18);
    labio.scale(bocaW * 1.04, bocaH * 1.04, Math.min(bocaW, bocaH) * 0.8);
    labio.translate(0, 0, C * 0.49);
    partes.push(pintar(labio, P.corBarbatana));

    /* OS OLHOS, grandes e altos na cabeça — é a proporção de desenho animado, e
       é ela que impede o bicho de virar peixe de enciclopédia. O branco encosta
       na pele; a pupila fica mais para fora, senão as duas esferas terminam no
       mesmo raio e brigam por profundidade. */
    for (const lado of [-1, 1]) {
      const branco = new THREE.SphereGeometry(A * 0.115, 10, 8);
      branco.translate(lado * L * 0.42, A * 0.18, C * 0.3);
      partes.push(pintar(branco, 0xf3f6ee));
      const pupila = new THREE.SphereGeometry(A * 0.075, 10, 8);
      pupila.translate(lado * L * 0.5, A * 0.18, C * 0.3);
      partes.push(pintar(pupila, P.corOlho));
    }

    this.corpo = new THREE.Mesh(mergeGeometries(partes), this.material);
    this.corpo.name = "namek-peixe-corpo";

    /* ------------------------------------------------------------ mandíbula */
    /* Uma concha rasa que sai da DOBRADIÇA para a frente. A peça é modelada
       adiante da origem e o objeto é posto na dobradiça — é o que faz
       `rotation.x` positivo derrubar a PONTA (e abrir a boca) em vez de levantar
       o queixo. Com a origem no meio da concha, abrir a boca a enterraria no
       peito. */
    const mand = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
    mand.scale(L * 0.3, A * 0.16, C * 0.13);
    mand.translate(0, 0, C * 0.12);
    this.mandibula = new THREE.Mesh(
      pintar(mand, P.corBarbatana, P.corBarriga, -A * 0.15, 0),
      this.material,
    );
    this.mandibula.position.set(0, -A * 0.1, C * 0.33);
    this.mandibula.name = "namek-peixe-mandibula";

    /* ---------------------------------------------------------------- cauda */
    this.cauda = new THREE.Mesh(pintar(montarCauda(C * 0.15, A * 1.05), P.corBarbatana), this.material);
    this.cauda.position.set(0, 0, -C * 0.47);
    this.cauda.name = "namek-peixe-cauda";

    /* ------------------------------------------------------------ peitorais */
    this.peitorais = [];
    for (const lado of [-1, 1]) {
      const geo = montarBarbatana(C * 0.2, A * 0.46, C * 0.06);
      /* Deitada: a peitoral abre para o LADO, não para cima. O giro entra na
         GEOMETRIA (e não no objeto) para o `rotation.z` do objeto ficar livre
         para a batida — dois giros no mesmo eixo brigariam. O sinal é negativo
         porque girar +90° em Z manda o +Y local para −X, e a barbatana da
         direita tem de sair para +X. */
      geo.rotateZ(-lado * Math.PI * 0.5);
      const m = new THREE.Mesh(pintar(geo, P.corBarbatana), this.material);
      m.position.set(lado * L * 0.4, -A * 0.14, C * 0.14);
      m.name = `namek-peixe-peitoral${lado > 0 ? "D" : "E"}`;
      this.peitorais.push({ mesh: m, lado });
    }

    /* -------------------------------------------------------------- o grupo */
    this.grupo = new THREE.Group();
    this.grupo.name = "namek:peixe";
    /* YXZ: primeiro o rumo, depois o mergulho, depois o parafuso em torno do
       próprio eixo. Na ordem padrão (XYZ) o parafuso sairia em torno do eixo do
       MUNDO, e o peixe rolaria de lado enquanto sobe. */
    this.grupo.rotation.order = "YXZ";
    this.grupo.add(this.corpo, this.mandibula, this.cauda);
    for (const p of this.peitorais) this.grupo.add(p.mesh);
    /* Um a menos que o do mar (10). Ver o cabeçalho: é isto que faz a água ficar
       SEMPRE por cima do corpo submerso, em vez de a ordenação de transparências
       decidir de novo a cada giro de câmera.
       **Por MALHA, e não no grupo.** `renderOrder` não desce para os filhos no
       Three — o renderizador enfileira cada objeto com o `renderOrder` DELE, e
       pôr o número só no `Group` seria uma linha que não faz nada e um comentário
       que promete o que ela não entrega. */
    for (const o of this.grupo.children) o.renderOrder = 9;
    this.grupo.visible = false;
    parent.add(this.grupo);

    /* ----------------------------------------------------------- respingos */
    /* Dois, e dois bastam: a saída e a entrada de um mesmo salto estão separadas
       por `duracaoMin` (2,6 s) e um respingo vive 1,15 s. O segundo existe para
       o corpo morto caindo, que espirra fora de hora. */
    for (let i = 0; i < 2; i++) {
      const coroa = new THREE.CylinderGeometry(1, 0.42, COROA_PROPORCAO, 14, 1, true);
      coroa.translate(0, COROA_PROPORCAO * 0.5, 0);
      const anel = new THREE.RingGeometry(0.85, 1.5, 20);
      anel.rotateX(-Math.PI / 2);
      const malha = new THREE.Mesh(
        mergeGeometries([coroa, anel]),
        new THREE.MeshBasicMaterial({
          color: P.corEspuma,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: true,
        }),
      );
      malha.name = `namek-peixe-respingo${i}`;
      malha.visible = false;
      /* DEPOIS do mar (10): a espuma é a única coisa do modo que precisa aparecer
         por cima da água, porque ela é a água sendo arrancada. */
      malha.renderOrder = 11;
      parent.add(malha);
      this.respingos.push({ malha, t: 0, raio: 1 });
    }

    return this;
  }

  /** O dono do som se apresenta. Ver `NamekGame.build`. */
  ligarAudio(audio) {
    this.audio = audio;
  }

  /* ----------------------------------------------------------------- rede -- */

  /**
   * A sala anunciou um salto (`NS2C.FISH`).
   *
   * Chega `NAMEK.peixe.aviso` segundos antes de o corpo romper a superfície, o
   * que é folga de sobra para uma rede ruim — e é também a janela do vulto.
   */
  agendar(msg) {
    if (!msg || !Array.isArray(msg.p)) return;
    this.salto = {
      i: msg.i,
      w: msg.w,
      x: msg.p[0],
      z: msg.p[1],
      rumo: msg.rumo ?? 0,
      alcance: msg.alcance ?? 60,
      alto: msg.alto ?? 30,
      dur: Math.max(0.5, msg.dur ?? 3),
      curva: msg.curva ?? 0,
      giro: msg.giro ?? 0,
    };
    this.morte = null;
    this._espirrouSaida = false;
    this._espirrouEntrada = false;
    this._dor = 0;
  }

  /**
   * A sala confirmou a morte (`NS2C.FISH_DOWN`).
   *
   * Daqui em diante a parábola não vale mais: o corpo passa a ser integrado
   * QUADRO A QUADRO, com a pose do instante da morte como condição inicial. É a
   * única coisa do peixe que cada tela resolve sozinha — e pode ser, porque um
   * corpo afundando não decide nada: ninguém atira nele, ninguém colide com ele,
   * e duas telas discordando de meio metro na barriga virada não muda o jogo.
   */
  matar(msg) {
    if (!this.salto) return;
    if (msg && msg.i !== undefined && msg.i !== this.salto.i) return;

    /* A velocidade do instante da morte, medida por DIFERENÇA de duas poses
       vizinhas: derivar a parábola à mão daria o mesmo número e mais três linhas
       de conta que teriam de ser mantidas iguais às de `pose`. */
    const t = this._tempo;
    this.pose(t);
    const p = this._pose;
    const x0 = p.x;
    const y0 = p.y;
    const z0 = p.z;
    const yaw = p.yaw;
    const pitch = p.pitch;
    const roll = p.roll;
    this.pose(t + 0.05);
    const vx = (p.x - x0) / 0.05;
    const vy = (p.y - y0) / 0.05;
    const vz = (p.z - z0) / 0.05;

    this.morte = {
      x: x0,
      y: y0,
      z: z0,
      /* O corpo perde metade do que tinha e passa a cair: um peixe morto que
         completa o arco inteiro lê como boneco arremessado, não como bicho. */
      vx: vx * 0.45,
      vy: vy * 0.45,
      vz: vz * 0.45,
      yaw,
      pitch,
      roll,
      t: 0,
      /** Já bateu na água? É o que dispara o respingo do corpo caindo. */
      molhou: y0 <= NAMEK.world.seaLevel,
    };

    const ponto = msg?.p ? { x: msg.p[0], y: msg.p[1], z: msg.p[2] } : { x: x0, y: y0, z: z0 };
    this.estourar(ponto);
    /* O ESTOURO É O SOM DA MORTE, e ele é do dono do áudio — este arquivo não
       sintetiza um sample sequer. `detonouNoAr` sem `kind` cai na escala por
       POTÊNCIA (ver `NamekAudio._receitaDeImpacto`), que é justamente o caminho
       de quem chega pela rede sem a identidade do golpe. */
    this.audio?.detonouNoAr(ponto, NAMEK.peixe.mortePotencia, null);
  }

  /**
   * Levei um acerto — o efeito LOCAL de quem atirou.
   *
   * Não tira vida nenhuma: a vida é da sala (§8), e o que acontece aqui é só o
   * tranco no corpo e a espuma saltando do ponto atingido. Sem isso, acertar um
   * bicho de vinte e seis metros seria indistinguível de errar.
   */
  levouGolpe(x, y, z) {
    if (!this.visivel || this.morte) return;
    this._dor = 1;
    const fx = this.fx;
    if (!fx || !fx.detalhar(x, y, z)) return;
    fx.fagulhas(x, y, z, 2.2, NAMEK.peixe.corEspuma, 8, 9);
  }

  /* -------------------------------------------------------------- consulta - */

  /** Há corpo na tela agora? */
  get visivel() {
    return this.grupo?.visible === true;
  }

  /**
   * O alvo para o sistema de poderes, ou `null`.
   *
   * Só FORA D'ÁGUA e só vivo — e as duas condições são as mesmas que
   * `NamekPeixeSim.noAr` confere do lado da sala. Ter as duas metades
   * concordando é o que evita o caso irritante: o cliente desenha o acerto, a
   * sala recusa o dano, e o jogador fica com a espuma de um tiro que não contou.
   */
  alvo() {
    if (!this.salto || this.morte || !this.visivel) return null;
    const p = this._pose;
    if (p.submerso > 0.5) return null;
    const a = this._alvo;
    /* `y` são os PÉS da cápsula, e a cápsula é uma esfera de raio `raioAcerto`
       (altura = 2 × raio): o centro fica em `y + raio`, que é onde o corpo está. */
    a.x = p.x;
    a.y = p.y - NAMEK.peixe.raioAcerto;
    a.z = p.z;
    return a;
  }

  /* ---------------------------------------------------------------- quadro - */

  /**
   * @param {number} dt
   * @param {THREE.Vector3} [cameraPos] não usado hoje; está na assinatura para o
   *   peixe caber no mesmo contrato das outras peças de `world/`.
   * @param {number} tempoSala relógio da SALA em ms — é ele que manda no salto
   */
  update(dt, cameraPos, tempoSala = 0) {
    if (!this.grupo) return;

    /* SEM RELÓGIO DE SALA NÃO HÁ PEIXE. A bancada de cenário monta o mundo sem
       rede nenhuma e passa zero aqui; sem esta linha o salto seria resolvido
       contra a época 0 e o bicho ficaria parado dentro do mar para sempre. */
    if (!this.salto || tempoSala <= 0) {
      this.grupo.visible = false;
      this.animarRespingos(dt);
      return;
    }

    this._fase += dt;
    this._dor = Math.max(0, this._dor - dt * 2.6);

    const P = NAMEK.peixe;
    this._tempo = (tempoSala - this.salto.w) / 1000;
    const t = this._tempo;

    if (this.morte) {
      this.animarMorte(dt);
      this.animarRespingos(dt);
      return;
    }

    /* Fora da janela do salto o peixe simplesmente não existe — ver o cabeçalho.
       O corpo some, o alvo some junto (`alvo()` lê `visivel`) e não sobra
       consulta nenhuma por quadro. */
    if (t < -P.aviso || t > this.salto.dur + P.afundar) {
      this.grupo.visible = false;
      /* O salto VENCIDO é descartado: guardá-lo faria o `alvo()` seguinte medir
         uma parábola que acabou há dez segundos. */
      if (t > this.salto.dur + P.afundar) this.salto = null;
      this.animarRespingos(dt);
      return;
    }

    this.pose(t);
    this.aplicar(dt);

    /* OS DOIS RESPINGOS. O limiar é o próprio instante do evento, e as bandeiras
       existem porque um quadro de 16 ms pode pular por cima dele: o teste é "já
       passou", não "está passando". */
    if (!this._espirrouSaida && t >= 0) {
      this._espirrouSaida = true;
      this.respingar(this.salto.x, this.salto.z, 1, true);
    }
    if (!this._espirrouEntrada && t >= this.salto.dur) {
      this._espirrouEntrada = true;
      this.respingar(this._pose.x, this._pose.z, 1.35, false);
    }

    this.animarRespingos(dt);
  }

  /**
   * O rumo horizontal do arco na fração `u`, em `this._dir`.
   *
   * **Não é o `rumo` do pacote.** Aquele é a direção da CORDA do salto; a
   * direção instantânea leva junto a derivada do desvio lateral, e a diferença
   * não é decorativa: com `curva = 0,2` o corpo sai 11° torto em relação à
   * corda e a velocidade horizontal real é 18 % maior que `alcance/dur`.
   *
   * Existe porque o VULTO e o MERGULHO precisam do mesmo número que o salto usa
   * nas pontas. Sem ele, a emenda tinha um pulo de 4° no ângulo do nariz e sete
   * centímetros de posição no quadro exato em que o peixe rompe a água — o
   * quadro que todo mundo está olhando.
   */
  rumoEm(u) {
    const s = this.salto;
    const c = Math.cos(s.rumo);
    const sn = Math.sin(s.rumo);
    const lat = s.curva * Math.PI * Math.cos(Math.PI * u);
    const dx = c - lat * sn;
    const dz = sn + lat * c;
    const m = Math.sqrt(dx * dx + dz * dz) || 1;
    const d = this._dir;
    d.x = dx / m;
    d.z = dz / m;
    /* m/s horizontais de verdade — `alcance/dur` é só a projeção na corda. */
    d.vel = (s.alcance * m) / s.dur;
    return d;
  }

  /**
   * A pose no instante `t` (segundos desde a quebra da superfície).
   *
   * **Esta é a metade cliente da fórmula que `NamekPeixeSim.posicao` tem do lado
   * da sala.** As quatro linhas da parábola têm de bater; o resto (rumo,
   * mergulho, parafuso, vulto) é só daqui, porque a sala não desenha.
   *
   * Escreve em `this._pose` e não devolve nada — zero alocação por quadro.
   */
  pose(t) {
    const s = this.salto;
    const P = NAMEK.peixe;
    const mar = NAMEK.world.seaLevel;
    const p = this._pose;
    const c = Math.cos(s.rumo);
    const sn = Math.sin(s.rumo);

    if (t < 0) {
      /* -------------------------------------------------- o VULTO, subindo --
         Ele chega ao ponto de saída na direção e na velocidade EXATAS do salto,
         e no instante exato em que o salto começa: é isso que faz a emersão não
         ter emenda nenhuma — nem de posição, nem de rumo, nem de ângulo. A
         fundura cai com o QUADRADO do tempo que falta, ou seja, ele sobe
         acelerando; um vulto de velocidade constante lê como elevador. */
      const f = clamp(-t / P.aviso, 0, 1);
      const d = this.rumoEm(0);
      const atras = d.vel * -t;
      p.x = s.x - d.x * atras;
      p.z = s.z - d.z * atras;
      p.y = mar - P.vultoFundura * f * f;
      p.yaw = Math.atan2(d.x, d.z);
      /* O nariz vai subindo até o ângulo de saída — sem esta rampa o corpo
         cruzaria a superfície na horizontal e daria um pulo de ângulo no quadro
         seguinte. */
      p.pitch = Math.atan2((4 * s.alto) / s.dur, d.vel) * (1 - f);
      p.roll = 0;
      p.submerso = 1;
      /* Debaixo d'água ele NADA: a cauda varre rápido, e é isso que faz o vulto
         parecer um bicho se preparando em vez de uma sombra sendo empurrada. */
      p.nado = 1;
      return;
    }

    const u = t / s.dur;
    if (u <= 1) {
      /* ------------------------------------------------------- o SALTO ------
         Parábola em `u` e não integração por `dt`: quinze clientes com quinze
         passos diferentes chegam ao mesmo ponto porque a conta é fechada. O
         desvio lateral é zero nas duas pontas e máximo no ápice — é a "curva no
         ar" do pedido, e ela vergueia e volta em vez de entortar a trajetória
         para um lado só. */
      const avanco = s.alcance * u;
      const lateral = s.alcance * s.curva * Math.sin(Math.PI * u);
      p.x = s.x + avanco * c - lateral * sn;
      p.z = s.z + avanco * sn + lateral * c;
      p.y = mar + 4 * s.alto * u * (1 - u);

      const dxu = s.alcance * (c - s.curva * Math.PI * Math.cos(Math.PI * u) * sn);
      const dzu = s.alcance * (sn + s.curva * Math.PI * Math.cos(Math.PI * u) * c);
      const dyu = 4 * s.alto * (1 - 2 * u);
      p.yaw = Math.atan2(dxu, dzu);
      p.pitch = Math.atan2(dyu, Math.sqrt(dxu * dxu + dzu * dzu));
      /* O PARAFUSO. Linear no salto inteiro: um giro que acelera ou freia no ar
         precisaria de um motivo, e um peixe no ar não tem nenhum. */
      p.roll = s.giro * u;
      p.submerso = 0;
      /* No ar a cauda quase para — não há água em que bater. Ela volta a valer
         perto da entrada, quando o bicho se contorce para mergulhar. */
      p.nado = smoothstep(0.72, 1, u) * 0.6;
      return;
    }

    /* --------------------------------------------------- o MERGULHO, afundando
       Fora da parábola: o corpo entra com a velocidade de saída e a água a come.
       `(1 − e^−kτ)/k` é a integral do arrasto exponencial — a distância que ele
       ainda percorre —, e é o que dá o freio assintótico em vez de uma parada
       seca no quadro seguinte à entrada. */
    const td = t - s.dur;
    const k = 2.6;
    const amort = (1 - Math.exp(-k * td)) / k;
    const vy = (-4 * s.alto) / s.dur;
    const d = this.rumoEm(1);
    p.x = s.x + s.alcance * c + d.x * d.vel * amort;
    p.z = s.z + s.alcance * sn + d.z * d.vel * amort;
    /* E A FUNDURA SATURA. Sem teto o corpo desce `4·alto/dur ÷ k` — 18 m num
       salto médio, 24 no maior —, e o fundo do mar nesta faixa está a −26 m (ver
       a terceira etapa de `NamekField.baseHeight`): o peixe terminava o mergulho
       enfiado na areia, meio corpo desaparecido dentro do relevo.
       `f · (1 − e^−d/f)` é um teto MACIO: para descidas curtas ele vale `d`
       (o mergulho começa com a velocidade física de verdade) e nunca passa de
       `f`. Um `Math.min` cru daria o mesmo teto e um cotovelo — o bicho pararia
       de descer de uma vez, a um décimo de segundo da entrada. */
    const fundoMax = P.vultoFundura * 1.2;
    p.y = mar - fundoMax * (1 - Math.exp((vy * amort) / fundoMax));
    p.yaw = Math.atan2(d.x, d.z);
    p.pitch = Math.atan2(vy, d.vel);
    p.roll = s.giro;
    p.submerso = 1;
    p.nado = 0.35;
  }

  /**
   * Põe a pose do quadro nos objetos e anima o que é vida própria do bicho:
   * cauda, peitorais, boca e o tranco de quem levou tiro.
   */
  aplicar(dt) {
    const p = this._pose;
    const g = this.grupo;
    g.visible = true;
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.yaw;
    /* Negativo: girar em X por `a` inclina o nariz para BAIXO (com a ordem YXZ e
       a frente em +Z), e `pitch` positivo quer dizer subindo. */
    g.rotation.x = -p.pitch;
    /* O tranco do golpe entra na ROLAGEM: o corpo dá um repelão de lado quando
       leva um tiro, some em meio segundo, e não mexe na trajetória — ela é da
       sala, e mexer nela aqui faria duas telas discordarem de onde o peixe está. */
    g.rotation.z = p.roll + Math.sin(this._fase * 26) * this._dor * 0.22;

    /* A CAUDA varre proporcional ao nado. No ar ela quase para: não há água para
       empurrar, e uma cauda batendo no vazio é a coisa que denuncia animação por
       relógio em vez de por situação. */
    const varredura = 0.34 + 0.5 * p.nado;
    this.cauda.rotation.y = Math.sin(this._fase * (2.2 + 5 * p.nado)) * varredura;

    /* AS PEITORAIS batem em espelho, meio ciclo atrás da cauda. No ar elas ABREM
       (a rolagem base cresce): é a pose de planeio, e é o que dá volume à
       silhueta contra o céu. */
    const abertura = (1 - p.submerso) * 0.55;
    for (const pe of this.peitorais) {
      pe.mesh.rotation.z = pe.lado * (abertura + Math.sin(this._fase * 3.1 + Math.PI) * 0.22);
    }

    /* A BOCA: escancarada no ar, fechada debaixo d'água, amortecida entre as
       duas — abrir de estalo leria como boneco articulado. E ela fecha no
       tranco: o bicho engole o golpe. */
    this._boca = damp(this._boca, 1 - p.submerso, 6, dt);
    this.mandibula.rotation.x = this._boca * 0.62 * (1 - this._dor * 0.5);

    this.material.opacity = 1;
  }

  /**
   * A morte: o corpo cai, vira de barriga para cima e afunda.
   *
   * Integração por quadro, e é a única do peixe. Ver `matar`: nada aqui decide
   * coisa nenhuma, então duas telas discordando de meio metro na barriga virada
   * custa exatamente nada.
   */
  animarMorte(dt) {
    const P = NAMEK.peixe;
    const m = this.morte;
    const mar = NAMEK.world.seaLevel;
    m.t += dt;

    if (m.y > mar) {
      m.vy -= 9.8 * dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;
      if (m.y <= mar) {
        m.y = mar;
        if (!m.molhou) {
          m.molhou = true;
          /* O corpo caindo espirra mais que o mergulho normal: são vinte e seis
             metros de peixe entrando morto, sem nada de aerodinâmico. */
          this.respingar(m.x, m.z, 1.5, false);
        }
      }
    } else {
      /* Afundando devagar e sem arrasto de verdade: um corpo morto na água tem
         empuxo, e uma pedra despencando leria errado. */
      m.y -= 1.9 * dt;
      m.x += m.vx * dt * 0.2;
      m.z += m.vz * dt * 0.2;
    }

    /* DE BARRIGA PARA CIMA. É a imagem que diz "morreu" sem uma palavra na tela,
       e é por ela que a barriga é quase branca no perfil de cor: virado, o bicho
       fica claro contra a água escura. */
    m.roll = damp(m.roll, Math.PI, 2.4, dt);
    m.pitch = damp(m.pitch, -0.12, 1.6, dt);

    const g = this.grupo;
    g.visible = true;
    g.position.set(m.x, m.y, m.z);
    g.rotation.y = m.yaw;
    g.rotation.x = -m.pitch;
    g.rotation.z = m.roll;

    this.cauda.rotation.y = Math.sin(this._fase * 1.1) * 0.12;
    for (const pe of this.peitorais) pe.mesh.rotation.z = pe.lado * 0.2;
    this.mandibula.rotation.x = 0.5;

    /* Desbota depois de submerso, e some. O peixe seguinte chega num `FISH`
       novo — a sala espera `NAMEK.peixe.respawn` segundos antes de anunciá-lo. */
    const some = P.afundar * 1.8;
    this.material.opacity = 1 - smoothstep(some * 0.35, some, m.t);
    if (m.t > some) {
      g.visible = false;
      this.morte = null;
      this.salto = null;
      this.material.opacity = 1;
    }
  }

  /* -------------------------------------------------------------- respingo - */

  /**
   * A água saltando. Duas camadas — ver o cabeçalho.
   *
   * @param {boolean} subindo saída (mais alta e fina) ou entrada (mais larga)
   */
  respingar(x, z, forca, subindo) {
    const P = NAMEK.peixe;
    const mar = NAMEK.world.seaLevel;

    /* 1. A COROA de geometria, visível em qualquer distância. */
    let livre = null;
    for (const r of this.respingos) {
      if (r.t <= 0) {
        livre = r;
        break;
      }
    }
    if (!livre) livre = this.respingos[0];
    livre.t = RESPINGO_VIDA;
    livre.raio = P.largura * (subindo ? 0.85 : 1.15) * forca;
    livre.malha.position.set(x, mar + 0.15, z);
    livre.malha.visible = true;

    /* 2. AS GOTAS do pool geral. Elas se cortam sozinhas além de 400 m (ver
       `NamekFx.detalhar`), e é por isso que a coroa acima existe: sem ela, o
       salto visto do meio da arena não teria respingo nenhum. */
    const fx = this.fx;
    if (fx && fx.detalhar(x, mar, z)) {
      fx.fagulhas(
        x,
        mar,
        z,
        P.largura * forca,
        P.corEspuma,
        Math.round(22 * forca),
        14 * forca,
        PARA_CIMA,
        subindo ? 0.55 : 0.8,
      );
    }

    /* 3. O SOM, do dono do áudio — e agora ele é ÁGUA de verdade.
       `quedaNoChao` era o paliativo previsto neste comentário: um baque grave de
       corpo em terra, que é quase o oposto do que a água faz (ver
       `NamekAudio.respingo`, que explica a diferença parte por parte).
       A força SOBE ao entrar e desce ao sair, e é a leitura certa: sair é o
       peixe empurrando a água de baixo para cima, entrar são vinte e seis metros
       de bicho despencando dentro dela. */
    this.audio?.respingo?.({ x, y: mar, z }, forca * (subindo ? 0.8 : 1.15));
  }

  /** As coroas de espuma abrindo e desbotando. */
  animarRespingos(dt) {
    for (const r of this.respingos) {
      if (r.t <= 0) continue;
      r.t -= dt;
      if (r.t <= 0) {
        r.malha.visible = false;
        r.t = 0;
        continue;
      }
      const k = 1 - r.t / RESPINGO_VIDA;
      /* Abre rápido e desacelera — `sqrt` é a curva de uma coisa que foi
         empurrada de uma vez e está perdendo energia. A altura encolhe enquanto
         a largura cresce: a coluna vira anel, que é o que uma coroa de água faz. */
      const escala = r.raio * (0.35 + 1.25 * Math.sqrt(k));
      r.malha.scale.set(escala, escala * (1.4 - k * 0.5), escala);
      r.malha.material.opacity = (1 - k) * (1 - k) * 0.85;
    }
  }

  /**
   * O estouro da morte, com o que já existe em `fx/`.
   *
   * Não há um efeito próprio de "bicho explodindo" e não devia haver: o que o
   * jogador precisa ler é o estouro de sempre, na escala certa — espuma primeiro
   * (é água que salta) e uma lasca de brasa por cima (é um poder que o matou).
   */
  estourar(p) {
    const fx = this.fx;
    if (!fx || !fx.detalhar(p.x, p.y, p.z)) return;
    const raio = NAMEK.peixe.largura;
    fx.fagulhas(p.x, p.y, p.z, raio, NAMEK.peixe.corEspuma, 26, 22);
    fx.fagulhas(p.x, p.y, p.z, raio * 0.7, 0xff9a5a, 14, 16);
  }

  /* ---------------------------------------------------------------- clima -- */

  /** 0 = dia, 1 = tempestade. O bicho escurece com o céu, como todo o resto. */
  setStorm(s) {
    if (!this.material) return;
    this.material.color.lerpColors(TINTA_DIA, TINTA_TEMPESTADE, clamp(s, 0, 1));
  }

  /* -------------------------------------------------------------- desmonta - */

  dispose() {
    /* Geometria e material saem com a raiz do mundo, na varredura de
       `NamekWorld.dispose` — a mesma nota que `water.js` e `sky.js` já têm. O
       que este método faz é soltar as referências para o coletor. */
    this.grupo = null;
    this.corpo = null;
    this.mandibula = null;
    this.cauda = null;
    this.peitorais = [];
    this.material = null;
    this.respingos = [];
    this.salto = null;
    this.morte = null;
    this.audio = null;
  }
}
