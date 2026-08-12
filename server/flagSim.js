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

   ----------------------------------------------------------------- os estados

   A bandeira está sempre em exatamente um destes três lugares:

   • NO CENTRO (`atBase: "center"`) — parada, esperando alguém.
   • COM ALGUÉM (`carrier` != null) — a posição dela é a de quem carrega, e
     quem carrega fica marcado para o mapa inteiro ver. Ver `entities/flag.js`.
   • CAÍDA (`carrier` null e `atBase` null) — no chão, onde o portador morreu,
     com um cronômetro de volta ao centro correndo.

   Não há um quarto estado. "Na base do time" não existe porque a bandeira é uma
   só e neutra: entregá-la na base inimiga marca ponto e ela volta ao centro na
   mesma linha, sem um instante em que ela pertença a alguém.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../src/config.js";

/** Distância no plano. A altura não decide nada aqui — ver `perto`. */
function dist2D(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

export class FlagField {
  constructor() {
    this.ativo = false;
    /** Onde a bandeira está quando ninguém a carrega. */
    this.position = { x: 0, y: 0, z: 0 };
    this.center = { x: 0, y: 0, z: 0 };
    /** Id de quem carrega, ou null. */
    this.carrier = null;
    /** `"humans"` | `"bots"` — o time de quem carrega, para a cor na tela. */
    this.carrierTeam = null;
    /** `"center"` quando está parada no meio; null quando caída ou carregada. */
    this.atBase = "center";
    /** Segundos até uma bandeira caída voltar sozinha ao centro. */
    this.retorno = 0;
    /** As duas bases: `{ humans: {x,y,z}, bots: {x,y,z} }`. */
    this.bases = null;
    this.scores = { humans: 0, bots: 0 };
    this.over = false;
    this.winner = null;
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

    this.position = { ...this.center };
    this.carrier = null;
    this.carrierTeam = null;
    this.atBase = "center";
    this.retorno = 0;
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
    this.carrier = null;
    this.carrierTeam = null;
    this.over = false;
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
    if (!this.ativo || this.over) return [];
    const C = CONFIG.modes.captureFlag;
    const eventos = [];

    /* --------------------------------------------------- com um portador -- */
    if (this.carrier != null) {
      const dono = jogadores.find((p) => p.id === this.carrier);
      /* O portador sumiu da amostra (saiu da sala no meio da corrida). A
         bandeira não pode ir embora com ele: ela volta ao centro, que é o único
         lugar em que todo mundo sabe procurá-la. */
      if (!dono || !dono.alive) {
        eventos.push({ kind: "return", p: [this.center.x, this.center.y, this.center.z] });
        this.paraOCentro();
        return eventos;
      }

      this.position.x = dono.x;
      this.position.y = dono.y;
      this.position.z = dono.z;

      // Chegou na base ADVERSÁRIA: é entrega.
      const alvo = this.carrierTeam === "humans" ? this.bases.bots : this.bases.humans;
      if (dist2D(dono.x, dono.z, alvo.x, alvo.z) <= C.baseRadius) {
        const time = this.carrierTeam;
        this.scores[time]++;
        eventos.push({
          kind: "capture",
          by: this.carrier,
          team: time,
          p: [alvo.x, alvo.y, alvo.z],
          scores: { ...this.scores },
        });
        this.paraOCentro();
        if (this.scores[time] >= C.captures) {
          this.over = true;
          this.winner = time;
        }
      }
      return eventos;
    }

    /* ---------------------------------------------------------- no chão -- */
    // Caída: o cronômetro de volta ao centro corre.
    if (this.atBase !== "center") {
      this.retorno -= dt;
      if (this.retorno <= 0) {
        eventos.push({ kind: "return", p: [this.center.x, this.center.y, this.center.z] });
        this.paraOCentro();
        return eventos;
      }
    }

    /* Quem encostar, leva. O primeiro da lista ganha o empate — e um empate
       real, no mesmo passo de 100 ms, com dois jogadores a menos de 2,6 m da
       bandeira e um do outro, é raro o bastante para não merecer regra. */
    for (const p of jogadores) {
      if (!p.alive) continue;
      /* A altura CONTA aqui, e só aqui: no vale não muda nada, mas na Lua dá
         para passar de jetpack cinquenta metros acima da bandeira, e pegá-la de
         lá seria pegá-la sem nunca ter descido ao chão em que ela está. */
      if (Math.abs(p.y - this.position.y) > 3.0) continue;
      if (dist2D(p.x, p.z, this.position.x, this.position.z) > C.pickupRadius) continue;

      this.carrier = p.id;
      this.carrierTeam = timeDe(p.id);
      this.atBase = null;
      this.retorno = 0;
      eventos.push({ kind: "pickup", by: p.id, team: this.carrierTeam });
      break;
    }

    return eventos;
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
    if (!this.ativo || this.carrier !== id) return null;
    const p = posicao ?? this.position;
    this.carrier = null;
    this.carrierTeam = null;
    this.atBase = null;
    this.retorno = CONFIG.modes.captureFlag.returnAfter;
    this.position = { x: p.x, y: p.y, z: p.z };
    return { kind: "drop", by: id, p: [p.x, p.y, p.z] };
  }

  paraOCentro() {
    this.carrier = null;
    this.carrierTeam = null;
    this.atBase = "center";
    this.retorno = 0;
    this.position = { ...this.center };
  }

  /** O que trafega a 10 Hz. Pequeno de propósito: é UM objeto. */
  view() {
    return {
      p: [
        Math.round(this.position.x * 100) / 100,
        Math.round(this.position.y * 100) / 100,
        Math.round(this.position.z * 100) / 100,
      ],
      carrier: this.carrier,
      carrierTeam: this.carrierTeam,
      atBase: this.atBase,
      // Só quando está caída: é o único momento em que a conta importa na tela.
      returnIn: this.atBase === "center" || this.carrier != null
        ? null
        : Math.max(0, Math.round(this.retorno * 10) / 10),
      bases: this.bases,
      scores: { ...this.scores },
      captures: CONFIG.modes.captureFlag.captures,
    };
  }
}
