/* ---------------------------------------------------------------------------
   Os dois planetas e a chuva de meteoros — a metade que DECIDE.

   Irmão de `bots.js` na forma e no contrato: um módulo que a sala hospeda e
   aciona uma vez por quadro, que não conhece uma única constante de `NS2C` de
   cor... — não, ele conhece, e a diferença vale ser dita: `bots.js` emite
   acontecimentos SEMÂNTICOS e a sala os traduz em mensagem, porque a IA precisa
   ser mexida sem que ninguém pense em rede. Aqui é o contrário — este módulo
   *é* o assunto das três mensagens (`PLANET_DOWN`, `METEOR`, `METEOR_HIT`), e
   inventar um dicionário no meio só produziria um segundo lugar onde a mesma
   coisa é escrita. O que ele NÃO conhece é a sala: cratera, dano e envio chegam
   como três funções no contexto do `tick`, e é por isso que este arquivo pode
   ser lido (e corrigido) sem abrir `room.js`.

   ============================================================================
   1. O QUE É AUTORIDADE AQUI
   ============================================================================

   Tudo o que decide alguma coisa (§8 do plano):

     • se o Kamehameha declarado de fato aponta para um planeta;
     • quando o planeta se parte, e o instante que quinze telas vão usar;
     • onde cada rocha cai, de que tamanho, quando entra e quanto demora;
     • quem ela atropela no caminho (50 % da vida) e quem ela mata no chão;
     • que cratera ela abre — pelo `cratera()` da sala, o MESMO de todo golpe.

   O cliente desenha. Ele não sorteia uma rocha, não escolhe um ponto de queda e
   não cobra um ponto de vida.

   ============================================================================
   2. A CONFERÊNCIA DO ACERTO NO PLANETA
   ============================================================================

   O cliente declara "apontei para Kuraia" (`NC2S.PLANET_HIT`) e a sala confere o
   que dá para conferir do lado dela — que é o mesmo modelo de confiança do
   `BLAST_HIT` e do `GROUND_HIT`, e é bastante:

     1. o jogador está vivo e não está caído;
     2. existe um especial declarado por ele, ele é um Kamehameha, e a janela de
        tempo dele ainda está aberta (`player.especial`, de `registrarEspecial`).
        Isso já custou a BARRA CHEIA — é o preço mais caro do jogo;
     3. a direção travada no disparo aponta para aquele corpo, dentro do raio
        angular dele mais uma folga de três graus.

   O item 3 é o que substitui a interseção raio-esfera que o cliente faz, e a
   equivalência é exata por um motivo que vale escrever: o cliente testa a MESMA
   direção (a do disparo, travada em `soltarEspecial`) contra uma esfera centrada
   a 2.400 m do olho dele. Um planeta a 2.400 m visto de dois pontos separados
   por dez metros — a mão e a lente — difere em 0,24°. A folga de três graus
   cobre isso com uma ordem de grandeza de sobra, e continua muito menor que os
   8° de raio do próprio corpo.

   O teto do abuso, portanto: um cliente mentiroso destrói um planeta que ele
   quase acertou, uma vez por barra cheia. Não há dano, placar nem vantagem
   nisso — a chuva cai em cima dele também.

   ============================================================================
   3. A CHUVA
   ============================================================================

   Cada rocha é uma RETA e um RELÓGIO, e este módulo integra a mesma reta que o
   cliente desenha (ver `NS2C.METEOR`). Isso não é economia de rede: é o que faz
   a rocha que passa por cima de você na tela ser a mesma que cobra os 50 %.

   O passo é o da sala (20 Hz). Uma rocha grande desce a 100 m/s, ou 5 m por
   quadro — e é por isso que o atropelamento é medido contra o SEGMENTO
   percorrido no quadro, e não contra o ponto onde ela parou: um lutador de
   0,45 m de raio cabe inteiro entre dois quadros de uma rocha rápida. É a mesma
   precaução que `passoDasBolas` toma com a bola de ki.
   --------------------------------------------------------------------------- */

import { NAMEK } from "../../src/shared/namek/config.js";
import { NS2C } from "../../src/shared/namek/protocol.js";

/** Contador de rochas. Só precisa ser único dentro da sala e crescente. */
let proximoMeteoro = 1;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round = (v) => Math.round(v * 1000) / 1000;

/**
 * Distância de um ponto ao SEGMENTO (a → b). A conta que substitui o Rapier em
 * todo este modo (§4 do plano), na versão mais curta dela.
 */
function distanciaAoSegmento(ax, ay, az, bx, by, bz, px, py, pz) {
  const sx = bx - ax;
  const sy = by - ay;
  const sz = bz - az;
  const ll = sx * sx + sy * sy + sz * sz;
  let t = 0;
  if (ll > 1e-9) t = clamp(((px - ax) * sx + (py - ay) * sy + (pz - az) * sz) / ll, 0, 1);
  const dx = px - (ax + sx * t);
  const dy = py - (ay + sy * t);
  const dz = pz - (az + sz * t);
  return Math.hypot(dx, dy, dz);
}

export class NamekPlanetas {
  /**
   * @param {import("../../src/shared/namek/field.js").NamekField} field o relevo
   *   — é dele que sai a altura do ponto de queda. A sala o troca por um novo
   *   quando esvazia, e por isso ele chega no `tick` e não no construtor: uma
   *   referência guardada aqui envelheceria calada e a chuva da partida seguinte
   *   cairia na topografia da anterior.
   */
  constructor() {
    const P = NAMEK.planetas;

    /** Um registro por corpo, na ordem do config. */
    this.corpos = P.corpos.map((def) => ({
      id: def.id,
      /* A direção normalizada. O config já a traz assim; normalizar de novo
         custa uma raiz por partida e fecha a porta para um dia em que alguém
         escreva um vetor solto lá e o teste de acerto passe a mentir por 2 %. */
      dir: normalizar(def.dir),
      /** rad — o raio angular do disco, visto do olho. Ver §2 do cabeçalho. */
      angulo: Math.atan(def.raio / P.distancia),
      /** "inteiro" | "caindo" | "ido" — `caindo` é o intervalo da viagem. */
      estado: "inteiro",
      /** ms — quando o clarão é anunciado. */
      caiEm: 0,
      /** quem o destruiu, só para o aviso na tela. */
      por: null,
      /** ms — janela em que este planeta ainda joga rocha no mapa. */
      chuvaDe: 0,
      chuvaAte: 0,
      /** ms — quando a próxima rocha entra. */
      proxima: 0,
    }));

    /* O POOL DE ROCHAS, pré-alocado no teto que o cliente também tem
       (`chuva.vivosMax`). Os dois lados com o mesmo teto é o que garante que a
       sala nunca solte uma rocha para a qual não existe vaga do outro lado — e
       uma rocha invisível que cobra cinquenta de vida seria a pior classe de
       defeito deste arquivo. */
    this.rochas = [];
    for (let i = 0; i < P.chuva.vivosMax; i++) {
      this.rochas.push({
        viva: false,
        id: 0,
        ox: 0, oy: 0, oz: 0,
        px: 0, py: 0, pz: 0,
        /** posição do quadro anterior — o atropelamento é medido no segmento */
        x: 0, y: 0, z: 0,
        raio: 1,
        power: 1,
        dur: 1,
        w: 0,
        /** m — o raio do toque em voo e o da explosão letal. Ver o config. */
        acerto: 1,
        letal: 1,
        /* Quem esta rocha já atropelou. Uma pedra não passa por cima da mesma
           pessoa duas vezes, e sem esta lista ela cobraria 50 % por QUADRO
           enquanto o corpo estivesse dentro do raio dela — quatro quadros
           colados matariam qualquer um, o que é o comportamento do raio LETAL e
           não o do toque. Array e não `Set`: são no máximo quinze ids e ele é
           varrido linearmente uma vez por corpo por quadro. */
        atingidos: [],
      });
    }
  }

  /* ============================================================== o acerto == */

  /** Os ids já destruídos — o campo `planetas` do `welcome`. */
  caidos() {
    const l = [];
    for (const p of this.corpos) if (p.estado !== "inteiro") l.push(p.id);
    return l;
  }

  /**
   * "O meu Kamehameha está apontado para o planeta X" (`NC2S.PLANET_HIT`).
   *
   * Recusa em SILÊNCIO, como todo o resto do modo: o cliente não desenha nada
   * até o `PLANET_DOWN` chegar, então uma mensagem de recusa só existiria para
   * dizer o que a ausência da outra já diz.
   *
   * @param {object} player o lutador que declarou, com `especial` de `registrarEspecial`
   * @param {object} msg `{ id }`
   * @param {number} agora ms da sala
   */
  pedido(player, msg, agora) {
    if (!player?.alive) return false;
    const p = this.corpos.find((c) => c.id === msg?.id);
    if (!p || p.estado !== "inteiro") return false;

    /* O ESPECIAL TEM DE EXISTIR, e é este registro que dá dentes à mensagem: ele
       só é criado por `registrarEspecial`, que já cobrou a barra CHEIA e já
       recusou quem está caído. Sem ele, um cliente destruiria os dois planetas
       da sala sem nunca ter soltado um Kamehameha. */
    const e = player.especial;
    if (!e || e.kind !== "kamehameha" || agora > e.ate) return false;

    const d = normalizar(e.d);
    if (!d) return false;
    const cos = d[0] * p.dir[0] + d[1] * p.dir[1] + d[2] * p.dir[2];
    /* A folga de três graus. Ver o §2 do cabeçalho: ela cobre a diferença entre
       o ângulo medido da mão de quem atirou (o teste do cliente) e o medido da
       origem do mundo (o teste daqui), que é de um quarto de grau. */
    if (cos < Math.cos(p.angulo + (3 * Math.PI) / 180)) return false;

    p.estado = "caindo";
    p.por = player.id;
    p.caiEm = agora + NAMEK.planetas.viagem * 1000;
    return true;
  }

  /* =============================================================== o passo == */

  /**
   * Um quadro.
   *
   * @param {number} dt segundos
   * @param {object} ctx
   * @param {object} ctx.field o relevo desta partida
   * @param {Array} ctx.corpos a lista uniforme da sala (`montarCorpos`)
   * @param {number} ctx.agora ms da sala
   * @param {(x:number,z:number,power:number)=>any} ctx.cratera o `cratera()` da
   *   sala — o MESMO caminho de bola de ki, Genki Dama e baque de queda
   * @param {(corpo:object,dano:number,p:object,d:number[])=>void} ctx.dano
   * @param {(corpo:object,p:object,d:number[])=>void} ctx.matar morte direta
   * @param {(msg:object)=>void} ctx.enviar broadcast para a sala inteira
   */
  tick(dt, ctx) {
    const agora = ctx.agora;
    const C = NAMEK.planetas.chuva;

    for (const p of this.corpos) {
      /* ------------------------------------------------------ o clarão --- */
      if (p.estado === "caindo" && agora >= p.caiEm) {
        p.estado = "ido";
        ctx.enviar({ t: NS2C.PLANET_DOWN, id: p.id, by: p.por, w: agora });
        p.chuvaDe = agora + C.atraso * 1000;
        p.chuvaAte = p.chuvaDe + C.duracao * 1000;
        p.proxima = p.chuvaDe;
      }

      /* ------------------------------------------------------- a chuva --- */
      if (!p.chuvaAte || agora >= p.chuvaAte) continue;
      if (agora < p.proxima) continue;

      /* SEM ENXURRADA DE RECUPERAÇÃO. Uma sala que ficou vazia continua
         envelhecendo (`now()` anda), mas `passo()` sai antes de chegar aqui —
         então, quando alguém entra, `proxima` pode estar minutos no passado e o
         laço soltaria uma rocha por iteração até alcançar o relógio. Rebasear é
         a leitura certa: a chuva não guarda fila. */
      if (agora - p.proxima > 2000) p.proxima = agora;

      p.proxima += C.intervalo * 1000 * (0.5 + Math.random());
      this.soltar(p, ctx);
    }

    this.passoDasRochas(dt, ctx);
  }

  /**
   * Uma rocha entra no céu.
   *
   * Onde ela cai é a decisão mais importante deste arquivo, e ela tem duas
   * metades: quase metade das rochas é mirada PERTO de alguém (`viesNosCorpos`)
   * e o resto cai sorteado no disco da arena. É a mesma decisão que
   * `NamekRoom.tempo` toma com os raios da tempestade, e pelo mesmo motivo —
   * uma chuva que cai onde não há ninguém é uma chuva que não aconteceu.
   *
   * O que a impede de virar uma execução é o piso de `viesPerto`: a rocha nunca
   * é mirada EM CIMA de um corpo, e a distância mínima é maior que o maior raio
   * letal do jogo. Quem morre teve o círculo de aviso desenhado no chão ao lado
   * dele durante os seis segundos da queda.
   */
  soltar(p, ctx) {
    const r = this.vaga();
    if (!r) return;
    const C = NAMEK.planetas.chuva;
    const M = NAMEK.planetas.meteoro;
    const W = NAMEK.world;

    let x;
    let z;
    const vivos = ctx.corpos.filter((c) => c.alive);
    if (vivos.length && Math.random() < C.viesNosCorpos) {
      const alvo = vivos[(Math.random() * vivos.length) | 0];
      const a = Math.random() * Math.PI * 2;
      const d = C.viesPerto + Math.random() * (C.viesLonge - C.viesPerto);
      x = alvo.x + Math.cos(a) * d;
      z = alvo.z + Math.sin(a) * d;
    } else {
      const a = Math.random() * Math.PI * 2;
      /* Raiz do sorteio: sem ela o disco fica denso no meio e vazio na borda —
         a mesma correção que `NamekRoom.tempo` faz com o raio. */
      const d = Math.sqrt(Math.random()) * W.radius * C.raioQueda;
      x = Math.cos(a) * d;
      z = Math.sin(a) * d;
    }

    /* DENTRO DO CÍRCULO, sempre. `NamekRoom.cratera` recusa qualquer ponto fora
       do raio da arena, e uma rocha que estoura sem abrir buraco seria a única
       explosão muda e sem marca do jogo — o som dela sai justamente do
       `NS2C.CRATER`. */
    const lim = W.radius * C.raioQueda;
    const dist = Math.hypot(x, z);
    if (dist > lim) {
      x = (x / dist) * lim;
      z = (z / dist) * lim;
    }

    const classe = this.sortearClasse();
    const y = ctx.field.heightAt(x, z);

    r.viva = true;
    r.id = proximoMeteoro++;
    r.px = x;
    r.py = y;
    r.pz = z;
    /* Ela vem PELO LADO DO PLANETA que explodiu — origem visível, e não uma
       pedra materializando-se no zênite. A elevação do corpo vira o ângulo de
       entrada: Kuraia está a 31°, então a chuva dela risca o céu na diagonal. */
    r.ox = x + p.dir[0] * C.comprimento;
    r.oy = y + p.dir[1] * C.comprimento;
    r.oz = z + p.dir[2] * C.comprimento;
    r.x = r.ox;
    r.y = r.oy;
    r.z = r.oz;
    r.raio = classe.raio;
    r.power = classe.power;
    r.dur = C.comprimento / classe.velocidade;
    r.w = ctx.agora;
    /* Os dois raios do pedido, e a diferença entre eles está escrita no config:
       `acerto` é a rocha em voo encostando em alguém (metade da vida) e `letal`
       é a bola de fogo no chão (morte). Somar o raio do lutador ao primeiro é a
       mesma conta que `registrarAcerto` faz com a bola de ki — quem colide é o
       corpo dele, não o ponto no meio dele. */
    r.acerto = classe.raio * M.raioAcerto + NAMEK.fighter.radius;
    r.letal = classe.raio * M.raioLetal;
    r.atingidos.length = 0;

    ctx.enviar({
      t: NS2C.METEOR,
      i: r.id,
      o: [round(r.ox), round(r.oy), round(r.oz)],
      p: [round(r.px), round(r.py), round(r.pz)],
      r: round(r.raio),
      /* A duração vai em `dur` e não em `t`: **`t` é sempre o TIPO da mensagem
         neste protocolo, nunca um tempo** — está escrito na primeira tela de
         `protocol.js` e é a convenção que o repositório inteiro segue. Um nome
         comprido não custa nada aqui: são vinte e sete rochas por chuva, não
         vinte por quadro. */
      dur: round(r.dur),
      w: ctx.agora,
    });
  }

  vaga() {
    for (const r of this.rochas) if (!r.viva) return r;
    return null;
  }

  /** Uma classe, pelo peso de cada uma. */
  sortearClasse() {
    const cls = NAMEK.planetas.meteoro.classes;
    let soma = 0;
    for (const c of cls) soma += c.peso;
    let s = Math.random() * soma;
    for (const c of cls) {
      s -= c.peso;
      if (s <= 0) return c;
    }
    return cls[cls.length - 1];
  }

  /* ------------------------------------------------------------ as rochas -- */

  passoDasRochas(dt, ctx) {
    const agora = ctx.agora;
    const dano = NAMEK.fighter.maxHealth * NAMEK.planetas.meteoro.danoDireto;

    for (const r of this.rochas) {
      if (!r.viva) continue;

      const u = clamp((agora - r.w) / 1000 / r.dur, 0, 1);
      const ax = r.x;
      const ay = r.y;
      const az = r.z;
      r.x = r.ox + (r.px - r.ox) * u;
      r.y = r.oy + (r.py - r.oy) * u;
      r.z = r.oz + (r.pz - r.oz) * u;

      /* ------------------------------------------------ o atropelamento --
         Contra o SEGMENTO do quadro, não contra o ponto: ver o §3 do cabeçalho.
         Uma vez por vítima por rocha — a lista `atingidos` é o que separa "uma
         pedra passou por cima de mim" de "uma pedra ficou me raspando durante
         quatro quadros". */
      for (const c of ctx.corpos) {
        if (!c.alive || c.invuln) continue;
        if (r.atingidos.includes(c.id)) continue;
        const py = c.y + NAMEK.fighter.chest;
        if (distanciaAoSegmento(ax, ay, az, r.x, r.y, r.z, c.x, py, c.z) > r.acerto) continue;
        r.atingidos.push(c.id);
        /* A direção do golpe é a da QUEDA: é ela que joga o corpo para o lado
           certo no `DEATH` e na pose de dor. Uma pedra empurra para baixo e
           para a frente, nunca para cima. */
        const dx = r.px - r.ox;
        const dy = r.py - r.oy;
        const dz = r.pz - r.oz;
        const n = Math.hypot(dx, dy, dz) || 1;
        ctx.dano(c, dano, { x: c.x, y: py, z: c.z }, [dx / n, dy / n, dz / n]);
      }

      if (u < 1) continue;

      /* --------------------------------------------------- e o estouro ---
         A CRATERA PRIMEIRO, e a ordem importa: `cratera()` lê a altura do ponto
         ANTES de cavar (é o que faz a poeira nascer no chão que estourou, e não
         no fundo do buraco) e é ela que carrega o som para todas as telas. Só
         depois vem o aviso do estouro e a morte de quem estava dentro. */
      ctx.cratera(r.px, r.pz, r.power);
      ctx.enviar({
        t: NS2C.METEOR_HIT,
        i: r.id,
        p: [round(r.px), round(r.py), round(r.pz)],
        r: round(r.raio),
        power: round(r.power),
      });

      /* O RAIO LETAL. Ele não passa por `aplicarDano` de propósito, e é a mesma
         decisão de `afogarNoMar`: *"o mar não tira vida, ele acaba com ela"*.
         Um dano enorme daria o mesmo resultado e mentiria no `HURT` que sairia
         antes — a barra despencando como se a pessoa tivesse levado um golpe —,
         e pior: a GUARDA o reduziria a 22 %, e sobreviver a uma bola de fogo de
         trinta metros com os braços na frente do rosto não é o que o pedido
         descreve.
         Quem está piscando de renascimento continua intocável: `matar` não
         confere invulnerabilidade (só `aplicarDano` confere), então a conferência
         é feita aqui. Sem ela, renascer no lugar errado durante a chuva mataria
         de novo, e de novo. */
      for (const c of ctx.corpos) {
        if (!c.alive || c.invuln) continue;
        const py = c.y + NAMEK.fighter.chest;
        const d = Math.hypot(c.x - r.px, py - r.py, c.z - r.pz);
        if (d > r.letal) continue;
        ctx.matar(c, { x: c.x, y: py, z: c.z }, [0, 1, 0]);
      }

      r.viva = false;
      r.atingidos.length = 0;
    }
  }

  /* ============================================================== reinício == */

  /**
   * Planeta inteiro de novo, céu limpo. A sala chama isto quando esvazia — pelo
   * mesmo motivo que ela troca o campo de altura: quem recarrega a página não
   * pode cair num planeta destruído por uma partida que acabou.
   */
  reiniciar() {
    for (const p of this.corpos) {
      p.estado = "inteiro";
      p.caiEm = 0;
      p.por = null;
      p.chuvaDe = 0;
      p.chuvaAte = 0;
      p.proxima = 0;
    }
    for (const r of this.rochas) {
      r.viva = false;
      r.atingidos.length = 0;
    }
  }

  /** Há chuva no ar? O banco de provas e o log da sala leem isto. */
  get chovendo() {
    for (const r of this.rochas) if (r.viva) return true;
    return false;
  }
}

/** Um `[x,y,z]` normalizado, ou `null` se ele for degenerado. */
function normalizar(v) {
  if (!Array.isArray(v) || v.length < 3) return null;
  const n = Math.hypot(v[0], v[1], v[2]);
  if (!(n > 1e-6)) return null;
  return [v[0] / n, v[1] / n, v[2] / n];
}
