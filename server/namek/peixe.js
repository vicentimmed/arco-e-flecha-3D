/* ---------------------------------------------------------------------------
   O peixe gigante — a metade que DECIDE.

   O bicho do começo de Dragon Ball: enorme, roliço, boca larga, barbatanas
   grandes. De tempos em tempos ele emerge do mar num arco, parafusa o corpo no
   ar e mergulha de volta. Pode ser morto pelos poderes dos jogadores, e depois
   que um morre demora até aparecer outro.

   ------------------------------------------------------------- a divisão

   Este arquivo não desenha nada e não sabe o que é uma malha. Ele responde a
   quatro perguntas e só a essas quatro:

     1. QUANDO o próximo salto acontece;
     2. ONDE ele acontece e com que forma de arco;
     3. QUANTA vida o peixe ainda tem;
     4. QUANDO ele morreu, e por causa de quem.

   O corpo, a animação, o respingo e o som são de `src/namek/world/peixe.js`. A
   única coisa que os dois compartilham é a FÓRMULA DA PARÁBOLA, e ela está
   escrita nos dois lados — ver o aviso em `posicao()`.

   ------------------------------------------------------- por que a sala decide

   Pelo mesmo motivo que a vida dos lutadores é dela (§8 do plano): quinze telas
   precisam ver o MESMO peixe no mesmo lugar. Um bicho sorteado no cliente sairia
   da água em quinze instantes diferentes, em quinze pontos diferentes, e o
   jogador que atirasse nele acertaria água na tela do vizinho.

   O que viaja é o SALTO INTEIRO num pacote só (`NS2C.FISH`), mandado
   `NAMEK.peixe.aviso` segundos antes de o corpo romper a superfície — tempo de
   sobra para o cliente subir o vulto debaixo d'água e para a mensagem atravessar
   uma rede ruim. Depois disso nada mais é transmitido: a posição a cada instante
   é função fechada dos nove números do pacote, então o custo de rede de um peixe
   é UMA mensagem a cada vinte segundos.

   ---------------------------------------------------------------- o acerto

   Contrato idêntico ao do resto do modo: quem atira é a autoridade sobre o
   próprio acerto, a sala é a autoridade sobre a vida. O cliente manda
   `NC2S.FISH_HIT` e aqui se confere o que custa quase nada e pega quase tudo que
   é incoerência — o peixe existe, é o mesmo peixe (`i`), ele está NO AR neste
   instante, e quem relata está a uma distância plausível dele.
   --------------------------------------------------------------------------- */

import { NAMEK, specialInfo } from "../../src/shared/namek/config.js";

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round = (v) => Math.round(v * 1000) / 1000;

/** Contador de peixes. Cada bicho novo ganha um id inédito — ver `NC2S.FISH_HIT`. */
let proximoPeixe = 1;

export class NamekPeixeSim {
  /**
   * @param {() => number} [rnd] fonte de aleatoriedade. Injetável pelo mesmo
   *   motivo que o relógio da sala é: um banco de provas que sorteia igual em
   *   duas execuções consegue comparar duas execuções.
   */
  constructor(rnd = Math.random) {
    this.rnd = rnd;
    this.reset();
  }

  /**
   * Um peixe novo, inteiro, sem salto marcado.
   *
   * Chamado no nascimento da sala e sempre que o planeta é zerado — quem entra
   * numa sala vazia não pode herdar um peixe pela metade da partida de ontem,
   * pela mesma razão que não herda as crateras dela.
   */
  reset() {
    const P = NAMEK.peixe;
    this.id = proximoPeixe++;
    this.vida = P.vida;
    /* s — o relógio até o próximo acontecimento. Ele conta duas coisas
       diferentes conforme `vivo`: o tempo até o próximo SALTO enquanto há peixe,
       e o tempo até o próximo NASCIMENTO enquanto não há. Um contador só porque
       os dois estados são exclusivos e dois campos divergiriam. */
    this.espera = P.primeiro;
    this.vivo = true;
    /** O salto anunciado, ou null. Ver `anunciar`. */
    this.salto = null;
  }

  /* =============================================================== o passo == */

  /**
   * Um quadro. Devolve o salto NOVO a anunciar, ou `null`.
   *
   * Quem transmite é a sala — este módulo não conhece conexão nenhuma —, e é ela
   * que decide se o pacote sai. A separação vale a linha extra: com ela, o banco
   * de provas roda o peixe por dez minutos simulados sem uma única mensagem.
   *
   * @param {number} dt segundos
   * @param {number} agora relógio da sala, em ms
   * @param {Array<{x:number,z:number,alive:boolean}>} corpos quem está em campo
   */
  tick(dt, agora, corpos) {
    const P = NAMEK.peixe;

    /* MORTO: o relógio conta para o nascimento do próximo, e nada mais acontece.
       É o "depois que um morre demora um tempo até aparecer outro" literal. */
    if (!this.vivo) {
      this.espera -= dt;
      if (this.espera > 0) return null;
      this.reset();
      /* O peixe novo não salta no mesmo quadro em que nasce: `reset` já pôs
         `primeiro` no relógio, e é ele que dá ao mar alguns segundos de calmaria
         entre um bicho e o outro. */
      return null;
    }

    /* O SALTO EM CURSO trava o relógio. Sem esta guarda o intervalo continuaria
       correndo durante os três segundos e meio de voo, e um sorteio infeliz
       poria dois saltos do mesmo peixe se sobrepondo — dois corpos, um bicho. */
    if (this.salto && agora < this.salto.fim) return null;

    this.espera -= dt;
    if (this.espera > 0) return null;

    /* Intervalo sorteado em torno do médio, para os dois lados. Ver
       `NAMEK.peixe.variacao`: um salto a cada exatos dezenove segundos vira
       metrônomo, e metrônomo ninguém olha duas vezes. */
    this.espera = P.intervalo + (this.rnd() * 2 - 1) * P.variacao;
    return this.anunciar(agora, corpos);
  }

  /**
   * Sorteia um salto e o carimba. **É a única fonte de aleatoriedade do peixe.**
   *
   * O instante `w` fica `aviso` segundos NO FUTURO de propósito: é a janela em
   * que o cliente sobe o vulto debaixo d'água (o telegrama do salto) e é também
   * a folga que a mensagem tem para atravessar uma rede ruim antes de o corpo
   * precisar estar na tela.
   */
  anunciar(agora, corpos) {
    const P = NAMEK.peixe;
    const r = this.rnd;
    const entre = (a, b) => a + r() * (b - a);

    /* ONDE. O ângulo é o que decide se alguém VÊ o salto, e por isso ele não é
       um sorteio uniforme: dois terços das vezes o peixe sai na direção de
       alguém que está em campo. É a mesma regra do relâmpago
       (`NamekRoom.tempo`) e pelo mesmo motivo — um acontecimento que nasce às
       costas de todo mundo não aconteceu. */
    let ang;
    const vivos = [];
    for (const c of corpos ?? []) if (c.alive !== false) vivos.push(c);
    if (vivos.length && r() < P.perto) {
      const quem = vivos[(r() * vivos.length) | 0];
      /* O rumo DELE visto do centro da arena — é para lá que ele está olhando na
         maior parte do tempo, porque é para lá que ele está voando. Um lutador
         parado na origem não tem rumo nenhum; nesse caso o sorteio livre vale. */
      const base = Math.hypot(quem.x, quem.z) > 1 ? Math.atan2(quem.z, quem.x) : r() * TAU;
      ang = base + ((r() * 2 - 1) * P.pertoAbertura * Math.PI) / 180;
    } else {
      ang = r() * TAU;
    }

    /* O raio sai da faixa de água aberta. Sem `sqrt` na distribuição: o que se
       quer não é densidade uniforme por área, é uma distância que pareça sempre
       "logo além da praia", e a faixa tem só 78 m de largura. */
    const raio = entre(P.raioMin, P.raioMax);
    const x = Math.cos(ang) * raio;
    const z = Math.sin(ang) * raio;

    /* O RUMO DO ARCO. Ele sai de través em relação ao centro — o peixe cruza a
       vista de quem está na ilha em vez de vir na cara ou fugir de costas. `±90°`
       do raio, com um sorteio de qual lado, é exatamente isso. */
    const lado = r() < 0.5 ? 1 : -1;
    const rumo = ang + lado * (Math.PI / 2) + (r() * 2 - 1) * 0.5;

    const dur = entre(P.duracaoMin, P.duracaoMax);
    const alto = entre(P.alturaMin, P.alturaMax);
    const alcance = entre(P.alcanceMin, P.alcanceMax);
    /* A curva e o parafuso, ambos com sinal sorteado: o mesmo salto vergueando
       sempre para o mesmo lado seria uma animação, não um bicho. */
    const curva = (r() * 2 - 1) * P.curvaMax;
    const giro = (r() * 2 - 1) * P.giroMax;

    /* OS NÚMEROS SÃO ARREDONDADOS AQUI, e não na hora de mandar.
     *
     * O pacote viaja com precisão de milímetro (`round`), e se a sala guardasse
     * os valores cheios ela integraria uma parábola ligeiramente diferente da
     * que todo cliente integra. Medido: 5,3 cm de divergência no ápice — nada
     * para o jogo, mas é exatamente o tipo de "quase igual" que envelhece mal.
     * Guardando o que foi MANDADO, as duas metades passam a concordar bit a bit,
     * e o ponto do `FISH_DOWN` cai onde o corpo está em todas as telas. */
    const w = agora + P.aviso * 1000;
    this.salto = {
      i: this.id,
      w,
      x: round(x),
      z: round(z),
      rumo: round(rumo),
      alcance: round(alcance),
      alto: round(alto),
      dur: round(dur),
      curva: round(curva),
      giro: round(giro),
      /* ms — quando a cauda entra na água. Guardado em vez de recalculado porque
         ele é lido em todo `FISH_HIT` que chega: é ele que responde "o peixe
         estava no ar neste instante?". */
      fim: w + round(dur) * 1000,
    };
    return this.pacote();
  }

  /**
   * O salto no formato do `NS2C.FISH`. Ver o comentário dele no protocolo.
   *
   * Nada é arredondado aqui — `anunciar` já guardou os valores na precisão em
   * que eles viajam, justamente para que a sala e o cliente integrem a MESMA
   * parábola. Ver o comentário lá.
   *
   * `fim` NÃO viaja: ele é `w + dur × 1000` e o cliente já tem os dois. Mandar um
   * número que o outro lado sabe calcular é a forma mais barata de criar duas
   * verdades para a mesma coisa.
   */
  pacote() {
    const s = this.salto;
    if (!s) return null;
    return {
      i: s.i,
      w: s.w,
      p: [s.x, s.z],
      rumo: s.rumo,
      alcance: s.alcance,
      alto: s.alto,
      dur: s.dur,
      curva: s.curva,
      giro: s.giro,
    };
  }

  /**
   * O que mandar no `welcome`, ou `null`.
   *
   * Só o salto que ainda tem o que mostrar — o que está por vir, o que está no ar
   * e o que acabou de mergulhar (o afundamento ainda é visível). Um salto antigo
   * mandado a quem entra faria o cliente calcular `u > 1` e desenhar um peixe
   * parado embaixo da água para sempre.
   */
  view(agora) {
    if (!this.vivo || !this.salto) return null;
    if (agora > this.salto.fim + NAMEK.peixe.afundar * 1000) return null;
    return this.pacote();
  }

  /* ============================================================== o acerto == */

  /**
   * Onde o corpo está no instante `agora`. **Espelho de `NamekPeixe.pose`.**
   *
   * As duas metades integram a MESMA parábola, e a fórmula está escrita duas
   * vezes — uma aqui, outra no cliente. É duplicação consciente e a alternativa
   * era pior: o único lugar sem dono para ela seria `src/shared/namek/`, e pôr
   * lá um módulo que o cliente usa para animar rotação, barbatana e respingo
   * arrastaria meia animação para dentro do código puro que a sala importa.
   *
   * O que TEM de bater são as quatro linhas de conta. Divergindo, o estouro da
   * morte nasce num lugar e o corpo está em outro — e é só isso que este lado
   * precisa da posição.
   */
  posicao(agora) {
    const s = this.salto;
    if (!s) return null;
    const u = clamp((agora - s.w) / (s.dur * 1000), 0, 1);
    const avanco = s.alcance * u;
    const lateral = s.alcance * s.curva * Math.sin(Math.PI * u);
    const c = Math.cos(s.rumo);
    const sn = Math.sin(s.rumo);
    return {
      x: s.x + avanco * c - lateral * sn,
      y: NAMEK.world.seaLevel + 4 * s.alto * u * (1 - u),
      z: s.z + avanco * sn + lateral * c,
    };
  }

  /** Ele está fora d'água agora? Só aí ele pode ser atingido. */
  noAr(agora) {
    const s = this.salto;
    if (!this.vivo || !s) return false;
    /* A folga é o atraso de interpolação do modo (100 ms) dos dois lados: quem
       relata viu o peixe onde ele estava `interpDelay` atrás, e um acerto no
       último quadro do mergulho chega aqui com o bicho já debaixo d'água. Sem a
       folga, o tiro mais bonito do salto — o que pega a cauda entrando — seria
       justamente o único recusado. */
    const folga = NAMEK.net.interpDelay * 1000 + 60;
    return agora >= s.w - folga && agora <= s.fim + folga;
  }

  /**
   * "O meu poder acertou o peixe."
   *
   * @param {object} jogador quem relata — só a posição dele é lida
   * @param {{i:number, kind:string, dt:number}} msg
   * @param {{x:number,y:number,z:number}} de onde quem relata está
   * @param {number} agora
   * @returns {null | {dano:number, morreu:boolean, p:{x,y,z}}}
   */
  acerto(msg, de, agora) {
    const P = NAMEK.peixe;
    if (!this.vivo || !this.salto) return null;
    /* O ID DO PEIXE, e ele não é burocracia: numa rede real a bola já estava no
       ar quando o bicho morreu, e o aviso chega depois do `FISH_DOWN`. Sem esta
       linha esse acerto atrasado arrancaria vida do peixe SEGUINTE, que ninguém
       chegou a atingir. */
    if (msg.i !== this.id) return null;
    if (!this.noAr(agora)) return null;

    const p = this.posicao(agora);
    if (de) {
      const d = Math.hypot(de.x - p.x, de.y - p.y, de.z - p.z);
      if (d > P.alcanceAviso) return null;
    }

    const dano = this.danoDe(msg.kind, msg.dt);
    if (!(dano > 0)) return null;

    this.vida -= dano;
    if (this.vida > 0) return { dano, morreu: false, p };

    /* MORREU. O relógio vira o do renascimento e o salto some junto: um corpo
       morto não continua a parábola, quem o afunda é o cliente. */
    this.vida = 0;
    this.vivo = false;
    this.espera = P.respawn;
    this.salto = null;
    return { dano, morreu: true, p };
  }

  /**
   * Quanto um golpe tira dele.
   *
   * Sai das MESMAS constantes que ferem um lutador, e não de uma tabela própria:
   * uma segunda tabela de dano é uma tabela que envelhece separado, e no dia em
   * que a Genki Dama for reequilibrada o peixe continuaria com o número velho.
   *
   * A divisão é a de sempre — quem tem `dps` cobra por segundo de exposição
   * (é feixe), quem tem `damage` cobra de uma vez (é projétil).
   *
   * **O teto só vale para o feixe**, e a assimetria é deliberada: o dano de um
   * projétil sai inteiro do config e o cliente não tem como inflá-lo, enquanto o
   * do feixe é `dps × dt` com o `dt` vindo pela rede. Ver `NAMEK.peixe.danoAvisoMax`.
   */
  danoDe(kind, dt) {
    const P = NAMEK.peixe;
    if (kind === "blast") return NAMEK.blast.damage;
    const info = specialInfo(kind);
    if (!info) return 0;
    if (info.dps === undefined) return info.damage ?? 0;
    const seg = clamp(Number.isFinite(dt) ? dt : 0, 0, P.dtMax);
    return Math.min(info.dps * seg, P.danoAvisoMax);
  }
}
