/* ---------------------------------------------------------------------------
   A bandeira, no servidor.

   Ela vive AQUI e em nenhum outro lugar, pelo motivo que já mandou o alien, a
   nave e o rover para cá: a bandeira decide o placar. Se cada aba tivesse a
   sua, duas pessoas discordariam sobre quem a pegou primeiro num encontrão de
   200 ms — e discordar sobre isso é discordar sobre quem ganhou a partida.

   O cliente não pede para pegar a bandeira. Não existe `C2S.PICKUP`: a sala já
   sabe onde todo mundo está (`playerPositions`), então encostar É pegar, e a
   decisão sai de um lugar só. É o contrário do contrato da flecha — lá quem
   atira é a autoridade porque a trajetória é dele —, e a diferença é
   proposital: a flecha é um evento de UM jogador, a bandeira é o estado
   compartilhado da partida.

   --------------------------------------------------------------- SÃO DUAS

   O modo era de UMA bandeira neutra no centro: os dois times corriam para o
   mesmo ponto e levavam o troféu para a base do outro. É um modo legítimo — e
   não é rouba-bandeira. Faltava-lhe exatamente a coisa que dá nome ao gênero:
   **nada era SEU**, então não havia o que defender. Todo mundo corria para o
   meio, e a partida inteira acontecia num raio de dez metros.

   Agora cada time tem a sua, na própria base, e a base é também o gol. Isso
   parte o campo em dois pela primeira vez e cria a decisão que o modo existe
   para ter: **quantos vão e quantos ficam**. Sair todo mundo é voltar e
   encontrar a própria bandeira já do outro lado do mapa; ficar todo mundo é
   nunca pontuar.

   ----------------------------------------------------------------- os estados

   Cada bandeira está sempre em exatamente um destes três lugares:

   • EM CASA (`state: "home"`) — no mastro da própria base.
   • COM ALGUÉM (`state: "carried"`) — a posição dela é a de quem carrega, e
     quem carrega fica marcado para o mapa inteiro ver. Ver `entities/flag.js`.
   • CAÍDA (`state: "dropped"`) — no chão, onde o portador morreu, com um
     cronômetro de volta para casa correndo.

   E são TRÊS as maneiras de uma bandeira caída sair do chão, que é onde mora a
   tensão do modo:

     • um ADVERSÁRIO a pega e continua a corrida de onde o companheiro parou;
     • um DONO encosta nela e ela volta para casa na hora — o resgate;
     • ninguém chega a tempo e ela volta sozinha.

   O resgate é o que faz valer a pena correr atrás de quem levou a sua: sem ele,
   matar o ladrão a dois passos da base dele seria inútil, porque o próximo
   ladrão pegaria a bandeira exatamente ali.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../src/config.js";

/** Distância no plano. A altura não decide nada aqui — ver `perto`. */
function dist2D(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

/** Os dois lados. A ordem não significa nada; a lista existe para iterar. */
export const TIMES = ["humans", "bots"];

/** O outro. Uma função para não haver dois lugares escrevendo o mesmo ternário. */
export function adversario(time) {
  return time === "humans" ? "bots" : "humans";
}

/** Uma bandeira: de quem é, onde mora e onde está agora. */
class Bandeira {
  constructor(time, casa) {
    this.time = time;
    this.casa = { ...casa };
    this.position = { ...casa };
    /** `"home"` | `"carried"` | `"dropped"` */
    this.state = "home";
    /** Id de quem carrega, ou null. */
    this.carrier = null;
    /** O time de quem carrega — sempre o adversário, mas o campo poupa contas. */
    this.carrierTeam = null;
    /** Segundos até uma caída voltar sozinha para casa. */
    this.retorno = 0;
  }

  paraCasa() {
    this.state = "home";
    this.carrier = null;
    this.carrierTeam = null;
    this.retorno = 0;
    this.position = { ...this.casa };
  }

  view() {
    return {
      team: this.time,
      p: [
        Math.round(this.position.x * 100) / 100,
        Math.round(this.position.y * 100) / 100,
        Math.round(this.position.z * 100) / 100,
      ],
      home: [this.casa.x, this.casa.y, this.casa.z],
      state: this.state,
      carrier: this.carrier,
      carrierTeam: this.carrierTeam,
      // Só quando está caída: é o único momento em que a conta importa na tela.
      returnIn: this.state === "dropped" ? Math.max(0, Math.round(this.retorno * 10) / 10) : null,
    };
  }
}

export class FlagField {
  constructor() {
    this.ativo = false;
    this.center = { x: 0, y: 0, z: 0 };
    /** As duas bases: `{ humans: {x,y,z}, bots: {x,y,z} }`. */
    this.bases = null;
    /** @type {{humans: Bandeira, bots: Bandeira}|null} */
    this.flags = null;
    this.scores = { humans: 0, bots: 0 };
    this.over = false;
    this.winner = null;
  }

  /** A bandeira que este id está carregando, se alguma. */
  bandeiraDe(id) {
    if (!this.flags) return null;
    for (const t of TIMES) if (this.flags[t].carrier === id) return this.flags[t];
    return null;
  }

  /**
   * Monta o campo para a fase: bases nos extremos e bandeira no meio.
   *
   * As bases saem do CENTRO DE NASCIMENTO da fase, não de coordenadas escritas
   * à mão. O vale é uma bacia de 38 m e a Lua uma planície muito maior; um par
   * de números fixos poria uma base dentro de uma cratera lá ou fora da bacia
   * aqui. Perguntar ao terreno resolve as duas de uma vez — é a mesma ideia de
   * `spawnPoints.areaDeNascimento`.
   *
   * @param {object} terrain campo de altura da fase
   */
  start(terrain) {
    const C = CONFIG.modes.captureFlag;
    const centro = terrain.spawnCenter ?? {
      x: CONFIG.spawn.centerX,
      z: CONFIG.spawn.centerZ,
      radius: CONFIG.spawn.radius,
    };
    const raio = (centro.radius ?? CONFIG.spawn.radius) * C.baseRing;

    /* O EIXO É PROCURADO, não escolhido.
     *
     * A primeira versão punha as bases no eixo X, e no vale isso as jogava nas
     * duas encostas: a bacia tem 38 m de raio de nascimento mas só ±34 m de
     * largura, então 31 m para o lado é morro acima — uma base a 7,5 m de
     * altura, na ladeira, que ninguém consegue defender porque escorrega dela.
     * Fixar o eixo em Z consertaria o vale e quebraria a Lua no dia em que a
     * cratera mudasse de lugar.
     *
     * Varrer os ângulos e ficar com o par mais PLANO resolve os dois de uma vez
     * e continua certo se o relevo mudar. */
    const par = this.melhorEixo(terrain, centro, raio);
    this.bases = { humans: par.a, bots: par.b };
    this.center = this.assentar(terrain, centro.x, centro.z);

    /* CADA BANDEIRA NASCE NA PRÓPRIA BASE, e não a alguns metros dela: a base é
       o gol e o mastro é a referência visual do gol. Separar as duas coisas
       obrigaria o jogador a aprender duas marcas para o mesmo lugar. */
    this.flags = {
      humans: new Bandeira("humans", par.a),
      bots: new Bandeira("bots", par.b),
    };
    this.scores = { humans: 0, bots: 0 };
    this.over = false;
    this.winner = null;
    this.ativo = true;
    return this;
  }

  /**
   * O par de pontos opostos mais plano do anel.
   *
   * Duas bases têm de ser DIAMETRALMENTE opostas — é o que faz a corrida ser a
   * mesma para os dois lados —, então o que se procura é um eixo, não dois
   * pontos independentes. Para cada ângulo, os dois extremos são pontuados pelo
   * desnível em relação ao centro da arena, e o eixo com o menor desnível
   * somado vence.
   *
   * O desnível é o critério, e não `isFlatGround`, porque uma ladeira pode ser
   * localmente plana e ainda estar a sete metros de altura, encostada na serra
   * — que foi exatamente o caso que produziu o defeito. O que se quer é chão de
   * arena, e chão de arena é o que está na altura do resto da arena.
   */
  melhorEixo(terrain, centro, raio) {
    const yCentro = terrain.heightAt(centro.x, centro.z);
    let melhor = null;

    for (let i = 0; i < 24; i++) {
      const ang = (i * Math.PI) / 24; // meia volta basta: o eixo é simétrico
      // Do anel para dentro, como `duelPositions`: prefere longe, aceita perto.
      for (let r = raio; r >= raio * 0.45; r -= raio * 0.12) {
        const ax = centro.x + Math.cos(ang) * r;
        const az = centro.z + Math.sin(ang) * r;
        const bx = centro.x - Math.cos(ang) * r;
        const bz = centro.z - Math.sin(ang) * r;
        if (!(terrain.isWalkable?.(ax, az) ?? true)) continue;
        if (!(terrain.isWalkable?.(bx, bz) ?? true)) continue;

        const custo =
          Math.abs(terrain.heightAt(ax, az) - yCentro) +
          Math.abs(terrain.heightAt(bx, bz) - yCentro);
        // Empate no desnível: vence o eixo mais LARGO, que dá mais campo entre
        // as bases e portanto mais partida entre uma corrida e outra.
        if (!melhor || custo < melhor.custo - 1e-6) {
          melhor = {
            custo,
            a: { x: ax, y: terrain.heightAt(ax, az), z: az },
            b: { x: bx, y: terrain.heightAt(bx, bz), z: bz },
          };
        }
        break; // este ângulo já deu o seu melhor raio
      }
    }

    return (
      melhor ?? {
        a: this.assentar(terrain, centro.x, centro.z - raio),
        b: this.assentar(terrain, centro.x, centro.z + raio),
      }
    );
  }

  /**
   * Empurra um ponto para o chão plano mais próximo, andando para o centro.
   *
   * Uma base numa encosta é uma base que não dá para defender: o jogador
   * escorrega dela. O mesmo relaxamento progressivo de `duelPositions`.
   */
  assentar(terrain, x, z) {
    const cx = CONFIG.spawn.centerX;
    const cz = CONFIG.spawn.centerZ;
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const px = x + (cx - x) * t * 0.5;
      const pz = z + (cz - z) * t * 0.5;
      if (terrain.isFlatGround?.(px, pz) ?? true) {
        return { x: px, y: terrain.heightAt(px, pz), z: pz };
      }
    }
    return { x, y: terrain.heightAt(x, z), z };
  }

  stop() {
    this.ativo = false;
    this.flags = null;
    this.over = false;
    this.winner = null;
  }

  /* ------------------------------------------------------------- o passo -- */

  /**
   * Um passo do mundo da bandeira.
   *
   * @param {number} dt
   * @param {Array<{id,alive,x,y,z}>} jogadores todos os corpos em campo
   * @param {(id:number) => ("humans"|"bots")} timeDe a que time pertence um id
   * @returns {Array<object>} eventos para a sala anunciar
   */
  update(dt, jogadores, timeDe) {
    if (!this.ativo || this.over || !this.flags) return [];
    const eventos = [];
    for (const t of TIMES) {
      this.passoDaBandeira(this.flags[t], dt, jogadores, timeDe, eventos);
      if (this.over) break; // alguém fechou as cinco: a partida acabou agora
    }
    return eventos;
  }

  passoDaBandeira(f, dt, jogadores, timeDe, eventos) {
    const C = CONFIG.modes.captureFlag;

    /* --------------------------------------------------- com um portador -- */
    if (f.state === "carried") {
      const dono = jogadores.find((p) => p.id === f.carrier);
      /* O portador sumiu da amostra (saiu da sala no meio da corrida). A
         bandeira não pode ir embora com ele: volta para casa, que é o único
         lugar em que os dois times sabem procurá-la. */
      if (!dono || !dono.alive) {
        f.paraCasa();
        eventos.push({ kind: "return", team: f.time, p: [f.casa.x, f.casa.y, f.casa.z] });
        return;
      }

      f.position.x = dono.x;
      f.position.y = dono.y;
      f.position.z = dono.z;

      /* CHEGOU EM CASA — a casa DELE, não a do dono da bandeira. É esta linha
         que separa o modo do anterior: antes se entregava na base inimiga, e
         por isso ninguém tinha nada a proteger. */
      const gol = this.bases[f.carrierTeam];
      if (dist2D(dono.x, dono.z, gol.x, gol.z) <= C.baseRadius) {
        const time = f.carrierTeam;
        const quem = f.carrier;
        this.scores[time]++;
        f.paraCasa();
        eventos.push({
          kind: "capture",
          by: quem,
          team: time,
          flag: f.time,
          p: [gol.x, gol.y, gol.z],
          scores: { ...this.scores },
        });
        if (this.scores[time] >= C.captures) {
          this.over = true;
          this.winner = time;
        }
      }
      return;
    }

    /* ---------------------------------------------------------- no chão -- */
    if (f.state === "dropped") {
      f.retorno -= dt;
      if (f.retorno <= 0) {
        f.paraCasa();
        eventos.push({ kind: "return", team: f.time, p: [f.casa.x, f.casa.y, f.casa.z] });
        return;
      }
    }

    /* Quem encostar resolve — e o que acontece depende do TIME de quem encostou.
       O primeiro da lista ganha o empate: um empate real, no mesmo passo de
       100 ms, com dois corpos a menos de 2,6 m da bandeira e um do outro, é raro
       o bastante para não merecer regra. */
    for (const p of jogadores) {
      if (!p.alive) continue;
      /* A altura CONTA aqui, e só aqui: no vale não muda nada, mas na Lua dá
         para passar de jetpack cinquenta metros acima da bandeira, e pegá-la de
         lá seria pegá-la sem nunca ter descido ao chão em que ela está. */
      if (Math.abs(p.y - f.position.y) > 3.0) continue;
      if (dist2D(p.x, p.z, f.position.x, f.position.z) > C.pickupRadius) continue;

      const time = timeDe(p.id);

      if (time === f.time) {
        /* O DONO encostou. Em casa não acontece nada — ele está passando pelo
           próprio mastro, que é onde ele renasce. Caída, ele a RESGATA: ela
           volta para casa na hora.

           Sem o resgate, matar o ladrão a dois passos da base dele não
           adiantaria nada — o próximo ladrão pegaria a bandeira exatamente ali,
           e defender viraria adiar. Com ele, correr atrás de quem levou a sua é
           a jogada defensiva do modo. */
        if (f.state === "dropped") {
          f.paraCasa();
          eventos.push({
            kind: "rescue",
            by: p.id,
            team: time,
            flag: f.time,
            p: [f.casa.x, f.casa.y, f.casa.z],
          });
        }
        return;
      }

      // Adversário: leva. Vale tanto para roubar do mastro quanto para
      // continuar a corrida de onde o companheiro caiu.
      f.state = "carried";
      f.carrier = p.id;
      f.carrierTeam = time;
      f.retorno = 0;
      eventos.push({ kind: "pickup", by: p.id, team: time, flag: f.time });
      return;
    }
  }

  /**
   * O portador morreu: a bandeira CAI onde ele estava.
   *
   * Cai, e não volta ao centro. É o que dá sentido a matar o portador na porta
   * da base inimiga: a bandeira fica ali, a dois passos do gol, e as duas
   * equipes correm para ela. Se voltasse ao centro, derrubar alguém a 90 % do
   * caminho e derrubá-lo na saída teriam exatamente o mesmo resultado.
   *
   * @returns {object|null} o evento a anunciar, ou null se não era o portador
   */
  soltar(id, posicao) {
    if (!this.ativo) return null;
    const f = this.bandeiraDe(id);
    if (!f) return null;
    const p = posicao ?? f.position;
    f.state = "dropped";
    f.carrier = null;
    f.carrierTeam = null;
    f.retorno = CONFIG.modes.captureFlag.returnAfter;
    f.position = { x: p.x, y: p.y, z: p.z };
    return { kind: "drop", by: id, flag: f.time, p: [p.x, p.y, p.z] };
  }

  /** O que trafega a 10 Hz. Dois objetos pequenos, e nada mais. */
  view() {
    return {
      flags: this.flags ? TIMES.map((t) => this.flags[t].view()) : [],
      bases: this.bases,
      scores: { ...this.scores },
      captures: CONFIG.modes.captureFlag.captures,
    };
  }
}
