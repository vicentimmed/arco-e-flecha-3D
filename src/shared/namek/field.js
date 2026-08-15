/* ---------------------------------------------------------------------------
   O chão de Namekusei: relevo, montanhas, mar — e as crateras que o jogo abre.

   PURO. Nada de Three.js, nada de Rapier, nada de DOM. A sala roda em Node e
   precisa das mesmas alturas para nascer gente, pousar bot e decidir onde uma
   cratera cabe; a malha, as cores e a água moram em `src/namek/world/`, que só
   existe no navegador. É a mesma divisão que `shared/moonField.js` faz do lado
   do arqueiro, e o mesmo motivo.

   ------------------------------------------------------------------ o relevo

   Um planeta inteiro não cabe numa malha, então o que existe aqui é o recorte
   que o BT3 também usava: uma CLAREIRA no meio para a briga acontecer, um anel
   de montanhas para dar parede e escala, e o mar depois delas para fechar o
   horizonte sem uma borda reta.

       centro ─────────────────────────────────► borda
       clareira      colinas      montanhas       mar
       0–180 m       180–500 m    500–760 m       760 m+

   A clareira não é plana: ela ondula o suficiente para uma cratera ter onde
   aparecer. Terreno perfeitamente liso faz toda deformação parecer um erro de
   malha.

   ---------------------------------------------------------------- as crateras

   Cratera é ALTURA, não objeto — a mesma ideia da Lua. A diferença é que aqui
   elas nascem em jogo, e isso muda duas coisas:

   • **O índice espacial precisa aceitar inserção.** O da Lua é construído uma
     vez e nunca muda. Este é um `Map` de células com listas, e uma cratera
     entra em todas as células que o raio dela toca.

   • **Elas têm de acabar.** Uma partida de dez minutos com quatro jogadores
     soltando especiais chegaria a milhares, e `heightAt` é chamada por vértice
     de malha, por passo de bot e por bala em voo. O limite é
     `NAMEK.destruction.craterLimit`, em fila: a mais velha sai quando a 97ª
     entra. Ver `addCrater`.

   ------------------------------------------------- e por que ela não é redonda

   O pedido é literal: *"as montanhas, se forem acertadas com o kamehameha ou com
   um poder mais forte, elas devem explodir parte dela"*. Uma bacia com simetria
   de revolução não faz isso. Numa encosta ela vira um PRATO inclinado — o buraco
   está lá, o campo de altura sabe dele, e mesmo assim o que o olho lê é "alguém
   afundou um pouco a ladeira", nunca "a montanha perdeu um pedaço".

   O que separa as duas leituras são três coisas, e nenhuma delas é mais buraco:

   1. **Uma parede.** O naco arrancado deixa uma ESCARPA morro acima — rocha
      exposta, quase vertical. É a face fresca que diz que ali havia material.
   2. **Uma saída.** Morro abaixo o material não fica na beira: ele desce. A
      cratera de encosta é um "U" aberto para o vale, não um "O" fechado.
   3. **Uma borda rasgada.** Circunferência perfeita é a assinatura de um
      software desenhando um disco. O que é arrancado tem contorno lascado.

   As três estão em `craterDelta`, e as três são função pura de
   (id, x, z, raio, fundura) mais o relevo BASE — que é o mesmo em toda máquina,
   por semente fixa. `esculpirNaco` resolve isso UMA vez por cratera, na
   inserção, e é chamada tanto por `addCrater` (a cratera nova) quanto por
   `loadCraters` (a lista que o retardatário recebe no `welcome`): as duas
   entradas precisam produzir a mesma pedra, ou quem chega no meio da partida
   veria outra montanha.

   Chão PLANO fica exatamente como estava, e isso não é acidente: `enc` — quanto
   este ponto é encosta — nasce zero na clareira, e com ele zerado a fórmula
   inteira colapsa na bacia com anel de sempre. A destruição de montanha não
   podia custar a cara da cratera de clareira, que é onde a briga acontece.
   --------------------------------------------------------------------------- */

import { ValueNoise } from "../../utils/noise.js";
import { makeRandom, smoothstep } from "../../utils/math.js";
import { NAMEK, craterFor } from "./config.js";

/* Célula do índice de crateras. 24 m é da ordem da cratera comum (bola de ki
   abre 3 m, Kamehameha 13 m): células muito menores multiplicariam as inserções
   de uma cratera grande, e muito maiores devolveriam listas longas demais para
   `heightAt` varrer. */
const CELL = 24; // m

/**
 * Hash de 32 bits do id da cratera. Ver `esculpirNaco`.
 *
 * O id é um CONTADOR da sala — 1, 2, 3, … —, e contadores consecutivos têm bits
 * baixos consecutivos. Usá-los crus para sortear a fase da borda lascada faria
 * as crateras nascidas em sequência terem quase o mesmo contorno, e num
 * tiroteio elas nascem justamente em sequência e lado a lado: o jogador veria
 * dois buracos gêmeos. `Math.imul` com as constantes do murmur3 embaralha os
 * bits altos nos baixos e resolve isso por três multiplicações.
 */
function embaralhar(n) {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export class NamekField {
  constructor(seed = NAMEK.world.seed) {
    this.noise = new ValueNoise(seed);
    this.radius = NAMEK.world.radius;
    this.seaLevel = NAMEK.world.seaLevel;

    /* Onde a sala sorteia nascimentos. É a clareira e as colinas — nunca a
       montanha (nasceria dentro da rocha) nem o mar. */
    this.spawnCenter = { x: 0, z: 0, radius: 460, minRadius: 40 };

    /** @type {Map<number, object[]>} célula → crateras que a tocam */
    this.grid = new Map();
    /** @type {object[]} a fila, em ordem de chegada. Ver `addCrater`. */
    this.craters = [];
    /** @type {Map<number, object>} id da sala → cratera, contra duplicata */
    this.byId = new Map();

    /**
     * Chamado quando uma cratera é APOSENTADA pela fila. Ver `addCrater`.
     *
     * Existe porque quem guarda a altura e quem guarda a malha são dois, e a
     * aposentadoria só acontecia num deles: o campo esquecia a cratera e a malha
     * ficava com o buraco. Numa partida de dez minutos a fila gira nove vezes, e
     * o resultado era ~770 buracos que só existiam para os olhos — o jogador
     * caindo dentro de depressões que a física jurava serem chão liso.
     *
     * O servidor deixa isto nulo: ele não tem malha para consertar.
     * @type {((cratera: object) => void) | null}
     */
    this.onRetire = null;

    /* As MONTANHAS não saem de ruído puro. Ruído dá relevo, não dá silhueta —
       e o que faz um cenário de Namekusei ser reconhecível são picos separados,
       com vale entre eles, não uma crista contínua. Sorteados uma vez, com
       semente fixa: o planeta é o mesmo em todas as máquinas. */
    this.peaks = this.buildPeaks(seed);
  }

  /* ---------------------------------------------------------------- picos -- */

  /**
   * Os picos do anel, sorteados uma vez.
   *
   * Eles ficam no anel de 500–760 m porque é onde a montanha cumpre o papel de
   * parede sem estreitar a arena de combate. Um pico no miolo seria um obstáculo
   * no meio da briga aérea — e brigar em volta de um obstáculo é o que torna um
   * jogo de voo irritante em vez de amplo.
   */
  buildPeaks(seed) {
    const rnd = makeRandom(seed ^ 0x5eed);
    const lista = [];
    const n = 22;
    for (let i = 0; i < n; i++) {
      /* Ângulos em setores, com sobra sorteada dentro de cada um: sorteio livre
         em 22 picos deixa buracos de 60° e aglomerados de três, e o anel de
         montanhas some de metade das direções. */
      const ang = ((i + rnd() * 0.8 - 0.4) / n) * Math.PI * 2;
      const d = 500 + rnd() * 260;
      lista.push({
        x: Math.cos(ang) * d,
        z: Math.sin(ang) * d,
        /* m — altura acrescentada no centro do pico. */
        h: 46 + rnd() * 96,
        /* m — quão largo ele é. Picos altos são largos: um cone de 140 m de
           altura e 40 m de base é uma agulha, e agulha não lê como montanha. */
        r: 78 + rnd() * 120,
        /* Achatamento em uma direção, para nenhum deles ser um cone perfeito. */
        squash: 0.62 + rnd() * 0.5,
        rot: rnd() * Math.PI,
      });
    }
    return lista;
  }

  /* --------------------------------------------------------------- índice -- */

  key(cx, cz) {
    /* Empacota duas coordenadas de célula num inteiro. A arena tem 1800 m de
       lado, ou 75 células — cabe folgado nos 16 bits de cada metade, e uma
       chave numérica é bem mais barata que a string `"12,7"` que o `Map`
       teria de hashear a cada consulta de altura. */
    return ((cx + 2048) << 16) | (cz + 2048);
  }

  /** Insere uma cratera em todas as células que o raio dela toca. */
  indexCrater(c) {
    const min = Math.floor((c.x - c.raio) / CELL);
    const max = Math.floor((c.x + c.raio) / CELL);
    const zmin = Math.floor((c.z - c.raio) / CELL);
    const zmax = Math.floor((c.z + c.raio) / CELL);
    for (let cx = min; cx <= max; cx++) {
      for (let cz = zmin; cz <= zmax; cz++) {
        const k = this.key(cx, cz);
        let lista = this.grid.get(k);
        if (!lista) this.grid.set(k, (lista = []));
        lista.push(c);
      }
    }
  }

  /** Tira uma cratera aposentada do índice. */
  unindexCrater(c) {
    const min = Math.floor((c.x - c.raio) / CELL);
    const max = Math.floor((c.x + c.raio) / CELL);
    const zmin = Math.floor((c.z - c.raio) / CELL);
    const zmax = Math.floor((c.z + c.raio) / CELL);
    for (let cx = min; cx <= max; cx++) {
      for (let cz = zmin; cz <= zmax; cz++) {
        const k = this.key(cx, cz);
        const lista = this.grid.get(k);
        if (!lista) continue;
        const i = lista.indexOf(c);
        if (i >= 0) lista.splice(i, 1);
        if (!lista.length) this.grid.delete(k);
      }
    }
  }

  /**
   * Abre uma cratera. **Determinística e idempotente.**
   *
   * Determinística porque raio e fundura saem de `craterFor(power)`, que é
   * compartilhada — os dois lados chegam ao mesmo buraco a partir dos mesmos
   * três números, e é isso que faz duas abas verem o mesmo chão (critério 5 do
   * §12 do plano).
   *
   * Idempotente pelo `id`: a mensagem da sala pode chegar duas vezes (o cliente
   * que atirou já a aplicou localmente para não esperar o retorno da rede) e a
   * segunda não pode aprofundar o buraco.
   *
   * @param {number} id       carimbo da sala; o mesmo em todas as telas
   * @param {number} x
   * @param {number} z
   * @param {number} power    potência do golpe
   * @returns {object|null} a cratera criada, ou null quando não há buraco novo
   *   a esculpir — o id já existia, ou o chão ali já está pelo menos tão fundo
   *   quanto este golpe cavaria (ver `craterMerge`). Quem chama trata os dois
   *   casos igual: não há nada a desenhar nem a retransmitir.
   */
  /**
   * O raio que uma potência abre NESTE ponto — já com o crescimento da encosta.
   *
   * `craterFor(power)` responde pelo buraco de CLAREIRA, e ele é a resposta
   * errada para quem precisa saber o alcance de um estouro na montanha: lá o
   * naco é até 60 % maior (ver `esculpirNaco`). Quem pergunta é o cliente,
   * quando decide que peças do cenário a explosão derrubou — com o raio plano,
   * as árvores da borda externa do naco ficavam de pé sobre um chão que tinha
   * sido levado embora.
   *
   * Reaproveita `esculpirNaco` em vez de repetir a medida de declividade, e
   * isso é o ponto: a inclinação medida aqui e a que esculpe o buraco têm de
   * ser a MESMA, ou a área que derruba árvore deixa de casar com a área que
   * afunda o terreno. O rascunho é de instância — a pergunta acontece uma vez
   * por estouro, não por quadro, mas não custa nada não alocar.
   */
  raioDeCratera(x, z, power) {
    const { raio, fundura } = craterFor(power);
    const c = this._medida ?? (this._medida = {});
    c.id = 0;
    c.x = x;
    c.z = z;
    c.raio = raio;
    c.fundura = fundura;
    this.esculpirNaco(c);
    return c.raio;
  }

  addCrater(id, x, z, power) {
    if (this.byId.has(id)) return null;
    const { raio, fundura } = craterFor(power);
    const c = this.esculpirNaco({ id, x, z, raio, fundura });

    /* NÃO SE CAVA DUAS VEZES NO MESMO BURACO.
     *
     * O perfil das crateras SOMA em `craterSum`, então duas no mesmo ponto dão
     * o dobro da fundura, três dão o triplo, e não havia nada segurando isso —
     * ver o comentário de `craterMerge`, que traz a medida. A regra é simples e
     * é a mesma nos dois lados da rede: se o centro do golpe novo caiu dentro
     * do miolo de uma cratera que já é tão funda quanto ele, o chão ali já está
     * cavado e nada acontece; se o golpe novo é MAIOR, ele aposenta as menores
     * que engoliu em vez de somar com elas. */
    /* A varredura é sobre a LISTA INTEIRA e não sobre o índice espacial, e é de
       propósito: o índice responde "que crateras COBREM este ponto", e a
       pergunta aqui é outra — "que crateras têm o CENTRO perto deste ponto".
       Uma cratera pequena a vinte metros não cobre o centro de uma Genki Dama e
       mesmo assim é engolida por ela. São 96 crateras no pior caso, algumas
       vezes por segundo (a sala tem balde, ver `podeCravar`); o índice existe
       para o `heightAt`, que roda milhares de vezes por quadro, não para cá. */
    const engolidas = [];
    for (let i = 0; i < this.craters.length; i++) {
      const o = this.craters[i];
      const dx = o.x - x;
      const dz = o.z - z;
      const limite = Math.max(o.raio, raio) * NAMEK.destruction.craterMerge;
      if (dx * dx + dz * dz > limite * limite) continue;
      if (o.fundura >= fundura) return null;
      engolidas.push(o);
    }
    for (let i = 0; i < engolidas.length; i++) this.aposentar(engolidas[i], false);

    this.craters.push(c);
    this.byId.set(id, c);
    this.indexCrater(c);

    /* O aviso das engolidas vem DEPOIS de a nova estar indexada: quem desenha
       vai reler a altura do disco delas, e a altura certa é a que já tem o
       buraco novo no lugar dos velhos. */
    for (let i = 0; i < engolidas.length; i++) this.onRetire?.(engolidas[i]);

    /* A FILA. Sem teto, `heightAt` degrada ao longo da partida — e ela é a
       função mais chamada do modo inteiro. A mais velha some primeiro porque é
       a que o jogador tem menos chance de estar olhando. */
    while (this.craters.length > NAMEK.destruction.craterLimit) {
      /* O aviso vem DEPOIS do desindexamento, para que o `heightAt` que o
         desenhista vai consultar já seja o de sem-ela. Ver `onRetire`. */
      this.aposentar(this.craters[0], true);
    }
    return c;
  }

  /** Tira uma cratera do campo. `avisar` dispara o `onRetire` na hora. */
  aposentar(c, avisar = true) {
    const i = this.craters.indexOf(c);
    if (i < 0) return;
    this.craters.splice(i, 1);
    this.byId.delete(c.id);
    this.unindexCrater(c);
    if (avisar) this.onRetire?.(c);
  }

  /** As crateras cujo raio pode alcançar (x, z). */
  cratersNear(x, z) {
    return this.grid.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
  }

  /**
   * Todas, para mandar a quem entra no meio da partida.
   *
   * O que vai no fio é o buraco de TERRENO PLANO (`raioBase`), e não o raio que
   * a encosta acabou dando. `esculpirNaco` roda de novo do outro lado — ela tem
   * de rodar, é ela que devolve a direção do morro e a borda lascada —, e ela
   * cresce o raio conforme a declividade. Mandar o raio já crescido faria o
   * retardatário crescê-lo uma segunda vez: uma cratera de encosta 60 % maior na
   * tela de quem chegou depois, que é a divergência de topografia que o §12 do
   * plano proíbe.
   */
  craterList() {
    return this.craters.map((c) => ({ i: c.id, p: [c.x, c.z], r: c.raioBase, f: c.funduraBase }));
  }

  /**
   * Rebate a lista recebida do `welcome` sem recalcular potência.
   *
   * Raio e fundura de TERRENO PLANO viajam prontos de propósito: quem entra no
   * meio precisa do MESMO buraco que os outros têm, e refazer a conta a partir
   * da potência daria o mesmo resultado só enquanto ninguém mexesse na fórmula.
   * No dia em que `craterFor` for ajustada, quem já está em campo continua com o
   * chão antigo e o retardatário chegaria com um chão novo — a única divergência
   * possível, fechada aqui.
   *
   * O que NÃO viaja é a forma do naco (direção do morro, borda lascada,
   * crescimento na encosta), e ela não viaja porque não precisa: sai inteira de
   * (id, x, z, raio) mais o relevo base, que é o mesmo em toda máquina. Ver
   * `esculpirNaco` e `craterList`.
   */
  loadCraters(lista) {
    for (const c of lista ?? []) {
      if (this.byId.has(c.i)) continue;
      /* `esculpirNaco` TAMBÉM aqui, e não só no `addCrater`. A forma do naco não
         viaja na rede porque ela não precisa: id, x, z, raio e fundura já
         viajam, e o relevo base é o mesmo em toda máquina por semente fixa. O
         que não pode acontecer é este caminho pular a escultura — o
         retardatário ficaria com bacias redondas onde todo mundo vê montanha
         faltando pedaço, e essa é a divergência de topografia que o cabeçalho
         inteiro existe para impedir. */
      const cratera = this.esculpirNaco({
        id: c.i,
        x: c.p[0],
        z: c.p[1],
        raio: c.r,
        fundura: c.f,
      });
      this.craters.push(cratera);
      this.byId.set(c.i, cratera);
      this.indexCrater(cratera);
    }
  }

  /* --------------------------------------------------------------- altura -- */

  /**
   * O relevo BASE, sem cratera nenhuma.
   *
   * Separado de `heightAt` porque a malha do terreno precisa dos dois: o base
   * para nascer, e o completo para ser re-esculpida quando um buraco abre perto
   * dela. Recalcular o ruído a cada re-esculpimento seria pagar FBM por vértice
   * a cada explosão — o cliente guarda o base e só soma a diferença.
   */
  baseHeight(x, z) {
    const d = Math.hypot(x, z);
    const W = NAMEK.world;

    /* ONDULAÇÃO GERAL. Duas oitavas largas dão as colinas; a terceira, o granulado
       que impede a superfície de parecer plástico à distância de voo. */
    let h = this.noise.fbm2(x * 0.0016, z * 0.0016, 3) * 26;
    h += this.noise.fbm2(x * 0.0071, z * 0.0071, 3) * 6.5;

    /* A CLAREIRA. Perto do centro o relevo é achatado contra a cota 4 — não
       zerado, ver o cabeçalho. `smoothstep` e não um corte: uma borda dura na
       clareira apareceria como um degrau circular de 180 m de raio. */
    const clareira = 1 - smoothstep(140, 320, d);
    h = h * (1 - clareira * 0.82) + 4 * clareira * 0.82;

    /* AS MONTANHAS. Cada pico é uma gaussiana achatada e girada. O `for` custa
       22 iterações por consulta, e é por isso que ele está atrás do teste de
       distância: no miolo da arena — onde estão os jogadores, os bots e a maior
       parte dos vértices — ele nem começa. */
    if (d > 300) {
      for (const p of this.peaks) {
        const dx = x - p.x;
        const dz = z - p.z;
        /* Gira no espaço do pico antes de achatar, senão todo o anel achataria
           na mesma direção do mundo e a montanha viraria um padrão. */
        const c = Math.cos(p.rot);
        const s = Math.sin(p.rot);
        const rx = dx * c - dz * s;
        const rz = (dx * s + dz * c) * p.squash;
        const dist2 = rx * rx + rz * rz;
        const r2 = p.r * p.r;
        if (dist2 > r2) continue;
        const t = 1 - dist2 / r2;
        /* t² dá uma saia larga e um topo redondo; t linear daria um cone. */
        h += p.h * t * t;
      }
      /* Cristas ridged POR CIMA das montanhas, e só nelas. É o que dá a rocha
         lascada de Namekusei sem custar oitava nenhuma na clareira. */
      const forca = smoothstep(420, 620, d);
      if (forca > 0) {
        h += this.noise.ridged2(x * 0.0135, z * 0.0135, 3) * 11 * forca;
      }
    }

    /* O MAR. Depois das montanhas o chão desce e afunda. A descida começa antes
       da borda da arena para que a barreira macia (§2 do plano) aconteça sobre
       água aberta — voar para fora e ser freado sobre o oceano lê como o mundo
       continuando; ser freado sobre um penhasco lê como uma parede invisível. */
    const praia = smoothstep(700, 880, d);
    h = h * (1 - praia) + (this.seaLevel - 14) * praia;

    return h;
  }

  /**
   * A altura de verdade: relevo base mais as crateras que alcançam este ponto.
   *
   * É a função mais chamada do modo — malha, bot, bala, pé de jogador — e por
   * isso ela é o lugar onde o índice espacial paga a si mesmo: sem ele seriam
   * 96 crateras testadas por consulta; com ele, tipicamente zero ou uma.
   */
  heightAt(x, z) {
    return this.baseHeight(x, z) + this.craterSum(x, z);
  }

  /**
   * Quanto as crateras mexem no relevo neste ponto. **Com teto de fundura.**
   *
   * Existe como método próprio porque a malha do cliente precisa exatamente
   * desta conta (ver `NamekTerrain.alturaDeVertice`): ela guarda o relevo base
   * por vértice e só soma o que as crateras mudaram. Duas somas escritas em dois
   * arquivos seriam duas topografias no dia em que uma delas mudasse — que é o
   * mesmo motivo de `craterFor` ser compartilhada.
   *
   * O teto vale só para BAIXO: a borda levantada de uma cratera é relevo
   * legítimo e nunca some com nada. Ver `craterDepthMax`.
   */
  craterSum(x, z) {
    const perto = this.cratersNear(x, z);
    if (!perto) return 0;
    let d = 0;
    for (let i = 0; i < perto.length; i++) {
      d += this.craterDelta(perto[i], x, z);
    }
    const teto = -NAMEK.destruction.craterDepthMax;
    return d < teto ? teto : d;
  }

  /**
   * Resolve, UMA vez, a forma do naco que esta cratera vai arrancar.
   *
   * Tudo o que sai daqui é função pura de (id, x, z, raio) mais o relevo BASE, e
   * é isso que faz a topografia ser a mesma nos dois lados da rede sem custar um
   * byte de protocolo. Ver o cabeçalho do arquivo.
   *
   * O preço são quatro `baseHeight` por cratera criada. Vale: `baseHeight` custa
   * três FBM mais o laço dos 22 picos, e mesmo o pior caso do modo — a fila de
   * 96 crateras girando inteira — são 384 consultas, uma única vez, contra as
   * dezenas de milhares por segundo que `craterDelta` recebe. Medir a encosta
   * DENTRO de `craterDelta` teria sido a alternativa óbvia e é justamente a que
   * não cabe: ela é a função mais chamada do modo depois de `heightAt`.
   *
   * @param {{id:number, x:number, z:number, raio:number, fundura:number}} c
   */
  esculpirNaco(c) {
    /* O que ENTROU aqui é o buraco de terreno plano — o que `craterFor` devolve,
       e o que viaja no `welcome` (ver `craterList`). Ele fica guardado porque é
       ele, e não o resultado desta função, que os dois lados trocam: fosse o
       resultado, o retardatário receberia um raio já crescido e o cresceria de
       novo ao chamar esta mesma função. */
    c.raioBase = c.raio;
    c.funduraBase = c.fundura;

    /* A DECLIVIDADE DO RELEVO BASE, e não do relevo com crateras.
     *
     * Base porque o que decide se aqui é montanha é a montanha, não os buracos
     * que já abriram nela. Medindo no relevo completo, dois Kamehamehas no mesmo
     * ponto dariam encostas diferentes — o segundo leria a parede que o primeiro
     * cavou como se fosse ladeira natural e cavaria um naco lateral no meio de
     * uma cratera de clareira.
     *
     * O passo é meia cratera, não um metro fixo: o que interessa é a inclinação
     * NA ESCALA DO BURACO. Com passo curto, a rugosidade `ridged2` das montanhas
     * (18 m de comprimento de onda) domina a medida e um ponto no fundo de uma
     * ruga daria declividade zero em plena encosta. */
    const eps = Math.max(2, c.raio * 0.5);
    const hL = this.baseHeight(c.x - eps, c.z);
    const hR = this.baseHeight(c.x + eps, c.z);
    const hD = this.baseHeight(c.x, c.z - eps);
    const hU = this.baseHeight(c.x, c.z + eps);
    const gx = (hR - hL) / (2 * eps);
    const gz = (hU - hD) / (2 * eps);
    const decl = Math.sqrt(gx * gx + gz * gz);

    /* De TANGENTE do ângulo para "quanto isto é encosta", em [0, 1].
     *
     * 0,22 e 0,78 são 12° e 38°, e os dois números foram escolhidos contra o
     * relevo que existe: a clareira do meio tem declividade abaixo de 0,1 (o
     * campo a achata contra a cota 4), as colinas ficam entre 0,1 e 0,3, e as
     * gaussianas dos picos passam de 0,6 na saia e de 1,0 perto do topo. Ou
     * seja: clareira zerada, colina mordendo de leve, montanha inteira.
     *
     * O pedido do usuário é "todas as montanhas", e é por isso que o piso não é
     * mais alto: uma encosta suave de colina também perde o seu pedaço, só que
     * proporcional ao que ela é. */
    c.enc = smoothstep(0.22, 0.78, decl);
    if (c.enc > 0 && decl > 1e-9) {
      const inv = 1 / decl;
      /* Versor MORRO ACIMA. É para lá que a escarpa olha. */
      c.hx = gx * inv;
      c.hz = gz * inv;
    } else {
      c.enc = 0;
      c.hx = 0;
      c.hz = 0;
    }

    /* O BURACO DE MONTANHA É MAIOR QUE O BURACO DE CLAREIRA, e este é o número
     * que decide se o pedido do usuário aparece na tela ou só no campo de
     * altura.
     *
     * A régua não é geologia, é a MALHA. O anel de montanhas é desenhado com
     * célula de 8 m (ver o perfil de LOD em `world/terrain.js`), e um buraco
     * precisa de umas três células de raio para ser lido como forma em vez de
     * amassado triangular. O Kamehameha abre 13,3 m em terreno plano — 1,7
     * células. Ou seja: com o raio de clareira, o naco existiria na física e
     * seria invisível justamente onde ele foi pedido.
     *
     * Com +60 % na encosta cheia ele vira 21,3 m (2,7 células) e a Genki Dama,
     * 47,5 m (5,9). A fundura cresce menos — 45 % — de propósito: um buraco que
     * ficasse tão fundo quanto largo viraria um poço, e o que se quer é uma
     * MORDIDA na ladeira. A profundidade de verdade quem dá é a escarpa, em
     * `craterDelta`, e ela já escala com o raio.
     *
     * O teto continua existindo pela mesma razão que `craterMax` existe (uma
     * potência absurda vinda da rede), só que medido na mesma moeda: 1,6 vez o
     * maior buraco plano aceito. */
    if (c.enc > 0) {
      const teto = NAMEK.destruction.craterMax * 1.6;
      c.raio = Math.min(teto, c.raioBase * (1 + c.enc * 0.6));
      c.fundura = c.funduraBase * (1 + c.enc * 0.45);
    }

    /* Guardado ao quadrado para o teste de fora-do-raio de `craterDelta`
       dispensar a raiz. A maioria esmagadora das chamadas dela é justamente
       esse teste dando negativo: o índice espacial devolve as crateras da
       CÉLULA de 24 m, e uma cratera de 4 m ocupa 2 % dela. */
    c.raio2 = c.raio * c.raio;

    /* A BORDA LASCADA, sorteada pelo id. Dois harmônicos angulares com fase
       comum: o de 2 dá o formato de amêndoa (a direção em que o golpe abriu
       mais), o de 3 quebra a simetria que sobraria do de 2 sozinho.
       Amplitudes já divididas por dois, para `craterDelta` não pagar a divisão:
       cada uma entra multiplicando um termo que vive em [0, 2]. */
    const h = embaralhar(c.id);
    const fase = ((h & 0xffff) / 0x10000) * Math.PI * 2;
    c.lx = Math.cos(fase);
    c.lz = Math.sin(fase);
    c.a2 = 0.025 + (((h >>> 16) & 0xff) / 255) * 0.045;
    c.a3 = 0.02 + (((h >>> 24) & 0xff) / 255) * 0.04;
    return c;
  }

  /**
   * Quanto uma cratera baixa o terreno num ponto. Zero fora do raio.
   *
   * Em chão PLANO o perfil é o de sempre — bacia de cosseno com BORDA
   * LEVANTADA, e a borda é a diferença entre um buraco e uma cratera: o material
   * que saiu do meio tem de estar em algum lugar, e num impacto ele está no anel
   * em volta.
   *
   *     borda            ⌒‾‾⌒
   *     ─────────────⌒‾‾      ‾‾⌒─────────────
   *     fundo              ⌄⌄⌄
   *
   * Numa ENCOSTA o mesmo perfil vira outra coisa, e é o pedido do usuário:
   *
   *                    escarpa
   *                     ╲   ╱‾‾╲            ← morro acima: fundo e parede viva
   *      morro acima     ╲ ╱    ╲
   *     ‾‾‾‾‾‾‾‾‾‾‾╲      ╳      ╲___
   *                 ╲___╱ naco       ‾‾‾╲___   ← morro abaixo: aberto, sem beira
   *
   * Nada aqui usa trigonometria nova: os harmônicos da borda saem por Chebyshev
   * a partir do versor radial (cos 2θ = 2c²−1, cos 3θ = c(4c²−3)), que é o mesmo
   * truque que o shader da poeira já usa em `fx/pool.js`. E o teste de
   * fora-do-raio virou uma comparação ao quadrado, o que ELIMINA o `Math.hypot`
   * que estava no caminho quente: com o índice espacial devolvendo a lista da
   * célula de 24 m, esse teste é o que a maioria das chamadas faz e só.
   */
  craterDelta(c, x, z) {
    const dx = x - c.x;
    const dz = z - c.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= c.raio2) return 0;

    const d = Math.sqrt(d2);
    const inv = d > 1e-6 ? 1 / d : 0;
    const ux = dx * inv;
    const uz = dz * inv;

    /* DE QUE LADO DO MORRO ESTE PONTO ESTÁ: −1 é vale, +1 é morro. Na clareira
       `hx` e `hz` são zero e isto morre junto com eles — a cratera de clareira
       não paga por nada do que só a montanha usa. */
    const dir = ux * c.hx + uz * c.hz;
    const acima = dir > 0 ? dir : 0;
    const abaixo = dir < 0 ? -dir : 0;

    /* A BORDA. Duas correções, e nenhuma delas estufa para FORA de `c.raio` —
       isso é obrigação, não estética: `indexCrater` registrou esta cratera nas
       células que o raio nominal toca, `NamekTerrain.percorrerDisco` re-esculpe
       o disco desse mesmo raio e `NamekScenery.reassentar` procura peças dentro
       dele. Terreno alterado fora do disco seria terreno que a malha nunca
       redesenha.
       • lascada pelo id, por dois harmônicos angulares (Chebyshev, sem trig);
       • ENCURTADA morro acima. Cratera em ladeira é comprida para o vale e
         curta para o morro, porque morro acima há material demais para o golpe
         empurrar. É essa assimetria que põe a escarpa PERTO do ponto de
         impacto, e parede perto é parede em pé. */
    const k1 = ux * c.lx + uz * c.lz;
    const k2 = 2 * k1 * k1 - 1;
    const k3 = k1 * (4 * k1 * k1 - 3);
    const raio = c.raio * (1 - c.a2 * (1 - k2) - c.a3 * (1 - k3) - c.enc * 0.18 * acima);
    if (d >= raio) return 0;
    const u = d / raio;

    /* A BACIA: cosseno elevado. Fundo redondo, paredes que suavizam na borda —
       um parabolóide puro encontra o terreno num ângulo vivo e a normal salta
       ali, o que aparece como um aro escuro na iluminação. */
    const bacia = -c.fundura * Math.pow(Math.cos((u * Math.PI) / 2), 1.6);

    /* O ANEL: a sobra, só no terço externo, com um quinto da fundura. */
    let anel = u > 0.66 ? Math.sin(((u - 0.66) / 0.34) * Math.PI) * c.fundura * 0.2 : 0;

    /* CHÃO PLANO ACABA AQUI, no mesmo perfil de sempre e pelo mesmo custo. É o
       caminho comum: a clareira é onde a briga acontece e é de onde vem a maior
       parte das crateras. */
    if (c.enc <= 0) return bacia + anel;

    /* O ANEL SÓ SOBRA ONDE O MATERIAL SOBROU. Morro abaixo ele praticamente
       some — o que foi arrancado não fica equilibrado na beira de uma ladeira,
       desce. Morro acima ele perde um terço: ali a beira é a lasca de cima da
       escarpa, e ela existe. */
    if (anel !== 0) anel *= 1 - c.enc * (0.95 * abaixo + 0.3 * acima);

    /* A ESCARPA — o NACO, e a peça que responde ao pedido.
     *
     * Escala pelo RAIO e não pela fundura, e essa é a decisão inteira. A fundura
     * é 35 % do raio (`craterDepth`), calibrada para uma bacia em terreno plano
     * ficar rasa o suficiente para o jogador andar dentro dela. Um pedaço
     * arrancado de uma montanha não tem esse compromisso: ele é um VOLUME que
     * sumiu, e volume se mede pelo tamanho do golpe. Com 0,40 do raio, o
     * Kamehameha come 5,3 m além da bacia numa encosta (contra 4,6 m de bacia
     * inteira) e a Genki Dama, 11,9 m — em cima de montanhas de 46 a 142 m, é um
     * naco que se vê de longe, que é exatamente o que foi pedido.
     *
     * O perfil `4u(1−u)` vale zero no centro e na borda e cheio no meio. O zero
     * no centro é o que COSTURA os dois lados: ali não existe "morro acima" nem
     * "morro abaixo", existe o fundo, e sem essa costura o naco abriria um
     * degrau vertical de metros bem no ponto para onde o jogador está olhando.
     * O zero na borda é o que fecha o corte contra o terreno intacto.
     *
     * Entre um e outro a parede é viva: de 80 % do raio até a borda, o
     * Kamehameha fecha 4 m de altura em 2,7 m de chão — 56°, rocha em pé. */
    const t = 2 * u - 1;
    const escarpa = c.enc * acima * (1 - t * t) * c.raio * 0.4;

    /* A SANGRIA — o corte que ABRE o buraco para o vale.
     *
     * Sem ela a cratera de encosta continua sendo um "O": a parede sobe de volta
     * morro abaixo e o que se vê é uma bacia funda numa ladeira. Com ela vira um
     * "U" de boca virada para o vale, que é a forma de um pedaço que se soltou e
     * DESCEU. O `× u` a zera no centro pelo mesmo motivo do naco; `1 − u⁴` a
     * segura quase cheia até 85 % do raio, em vez de fechar desde a metade como
     * `1 − u²` fecharia. */
    const u2 = u * u;
    const sangria = c.enc * abaixo * u * c.fundura * 1.1 * (1 - u2 * u2);

    return bacia + anel - escarpa - sangria;
  }

  /* ------------------------------------------------------------ geometria -- */

  /** Normal do terreno por diferença central. */
  normalAt(x, z, eps = 0.8, out = { x: 0, y: 0, z: 0 }) {
    const hL = this.heightAt(x - eps, z);
    const hR = this.heightAt(x + eps, z);
    const hD = this.heightAt(x, z - eps);
    const hU = this.heightAt(x, z + eps);
    const nx = hL - hR;
    const nz = hD - hU;
    const ny = 2 * eps;
    const inv = 1 / Math.hypot(nx, ny, nz);
    out.x = nx * inv;
    out.y = ny * inv;
    out.z = nz * inv;
    return out;
  }

  /** Cosseno do ângulo com a vertical: 1 é plano, 0 é parede. */
  slopeAt(x, z, eps = 0.8) {
    return this.normalAt(x, z, eps).y;
  }

  /** Está dentro do círculo da arena? */
  isInsideWorld(x, z) {
    return x * x + z * z <= this.radius * this.radius;
  }

  /** Dá para ficar de pé aqui? Fora d'água, dentro da arena e sem ser parede. */
  isWalkable(x, z) {
    if (!this.isInsideWorld(x, z)) return false;
    if (this.heightAt(x, z) <= this.seaLevel + 0.5) return false;
    return this.slopeAt(x, z) > 0.72;
  }

  /**
   * Um ponto plano o bastante para pousar uma casa ou nascer alguém.
   *
   * Testa o entorno, não só o centro: um ponto plano no meio de uma encosta
   * existe (o relevo passa pela horizontal ao virar), e uma vila construída ali
   * fica com metade das casas no ar.
   */
  isFlatGround(x, z, margem = 8, minSlope = 0.93) {
    if (!this.isWalkable(x, z)) return false;
    const h = this.heightAt(x, z);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const px = x + Math.cos(a) * margem;
      const pz = z + Math.sin(a) * margem;
      if (Math.abs(this.heightAt(px, pz) - h) > margem * 0.34) return false;
    }
    return this.slopeAt(x, z) > minSlope;
  }

  /**
   * Um lugar para nascer, sorteado.
   *
   * `√` no raio pelo mesmo motivo de sempre: sem ele o sorteio se acumula no
   * centro, porque a área de um anel cresce com o raio — e todo mundo nasceria
   * em cima de todo mundo no meio da clareira.
   */
  pickSpawn(rnd = Math.random) {
    const S = this.spawnCenter;
    for (let tentativa = 0; tentativa < 40; tentativa++) {
      const ang = rnd() * Math.PI * 2;
      const t = Math.sqrt(rnd());
      const d = S.minRadius + (S.radius - S.minRadius) * t;
      const x = S.x + Math.cos(ang) * d;
      const z = S.z + Math.sin(ang) * d;
      if (this.isWalkable(x, z)) return { x, z, y: this.heightAt(x, z) };
    }
    /* Quarenta tentativas sem achar chão é impossível com este relevo, mas o
       nascimento não pode ser a coisa que falha: o centro da clareira é plano
       por construção. */
    return { x: 0, z: 0, y: this.heightAt(0, 0) };
  }
}
