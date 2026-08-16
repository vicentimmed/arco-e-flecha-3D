/* ---------------------------------------------------------------------------
   O LUTADOR — uma cápsula cinemática contra o campo de densidade.

   PURO: sem Three.js. Posição e velocidade são `{x,y,z}` simples, e o arquivo
   roda em Node. É a mesma disciplina do resto da fase, e pelo mesmo motivo do
   §11.4 — no dia em que houver sala, ela move bot com esta física, não com uma
   cópia dela.

   -------------------------------------------------- o que muda em terreno de VOLUME

   Num campo de altura a colisão é uma comparação: `y ≤ h(x,z)`. Aqui não existe
   `h`. A coluna pode ter qualquer número de vãos — chão, teto, chão de novo — e
   a pergunta "onde é o chão" só tem resposta se souber ONDE O CORPO ESTÁ. Daí as
   três consultas que este arquivo faz, e nenhuma delas existia antes:

       chaoAbaixo(p)   o piso, marchando para baixo a partir dos pés
       tetoAcima(p)    o teto, marchando para cima a partir da cabeça
       solidoEm(p)     tem pedra aqui?

   E a PAREDE, que num campo de altura nunca precisou existir: andar contra um
   morro era ser levantado por ele. Dentro de um túnel não há para onde levantar,
   então a parede empurra de volta — deslizando pelo gradiente da densidade, que
   é a normal da rocha naquele ponto.
   --------------------------------------------------------------------------- */

/** m — altura da cápsula, do pé ao topo da cabeça. */
export const ALTURA = 1.8;
/** m — raio da cápsula. */
export const RAIO = 0.45;
/** m — até onde à frente ainda é degrau, e a partir de onde é parede. */
const DEGRAU = 0.75;

const G = -24;
const ANDAR = 11;
const CORRER = 20;
const VOO = 26;
const VOO_TURBO = 52;
const ARRASTO_AR = 1.6;
const ARRASTO_CHAO = 9;
const PULO = 11;

export class Lutador {
  /** @param {import("./campo.js").CampoCratera} campo */
  constructor(campo) {
    this.campo = campo;
    /** m — os PÉS, não o centro. */
    this.position = { x: 0, y: 40, z: 40 };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.noChao = false;
    this.voando = true;
    this._n = { x: 0, y: 0, z: 0 };
  }

  /** Versor da direção da mira, a partir de yaw e pitch. */
  mira(out = { x: 0, y: 0, z: 0 }) {
    const cp = Math.cos(this.pitch);
    out.x = -Math.sin(this.yaw) * cp;
    out.y = Math.sin(this.pitch);
    out.z = -Math.cos(this.yaw) * cp;
    return out;
  }

  /** A cota dos olhos — de onde a câmera olha e de onde o poder sai. */
  olhos(out = { x: 0, y: 0, z: 0 }) {
    out.x = this.position.x;
    out.y = this.position.y + ALTURA * 0.92;
    out.z = this.position.z;
    return out;
  }

  /**
   * @param {number} dt
   * @param {{frente:number, lado:number, cima:number, correr:boolean, pular:boolean, voar:boolean}} a
   */
  update(dt, a) {
    /* Subpassos: a 52 m/s o corpo anda quase um metro por quadro, e um metro é
       duas vezes o voxel. Sem subdividir, ele atravessaria uma parede fina de
       túnel — que é exatamente a parede que este modo produz. */
    const passos = Math.max(1, Math.ceil((this.rapidez() * dt) / (RAIO * 0.8)));
    const h = dt / passos;
    for (let i = 0; i < passos; i++) this.passo(h, a);
  }

  rapidez() {
    const v = this.velocity;
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  }

  passo(h, a) {
    const p = this.position;
    const v = this.velocity;
    const campo = this.campo;

    if (a.voar) this.voando = true;

    /* -------------------------------------------------------- a vontade --- */
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    /* Frente = (−sin yaw, 0, −cos yaw) — a convenção do repositório. */
    let dx = -sy * a.frente + cy * a.lado;
    let dz = -cy * a.frente - sy * a.lado;
    const m = Math.sqrt(dx * dx + dz * dz);
    if (m > 1) {
      dx /= m;
      dz /= m;
    }

    if (this.voando) {
      /* VOANDO: a vontade manda nos três eixos, e o "para frente" segue a MIRA —
         apontar para baixo e acelerar é mergulhar, que é o que faz voo parecer
         voo em vez de elevador. */
      const vel = a.correr ? VOO_TURBO : VOO;
      const cp = Math.cos(this.pitch);
      const mx = -sy * cp;
      const my = Math.sin(this.pitch);
      const mz = -cy * cp;
      const alvoX = mx * a.frente * vel + cy * a.lado * vel;
      const alvoY = my * a.frente * vel + a.cima * vel * 0.8;
      const alvoZ = mz * a.frente * vel - sy * a.lado * vel;
      const k = 1 - Math.exp(-6 * h);
      v.x += (alvoX - v.x) * k;
      v.y += (alvoY - v.y) * k;
      v.z += (alvoZ - v.z) * k;
    } else {
      const vel = a.correr ? CORRER : ANDAR;
      const k = 1 - Math.exp(-(this.noChao ? 14 : 4) * h);
      v.x += (dx * vel - v.x) * k;
      v.z += (dz * vel - v.z) * k;
      v.y += G * h;
      if (a.pular && this.noChao) {
        v.y = PULO;
        this.noChao = false;
      }
      const arr = this.noChao ? ARRASTO_CHAO : ARRASTO_AR;
      v.x -= v.x * Math.min(1, arr * h) * 0.06;
      v.z -= v.z * Math.min(1, arr * h) * 0.06;
    }

    /* -------------------------------------------------------- integração -- */
    const xAnt = p.x;
    const yAnt = p.y;
    const zAnt = p.z;
    p.x += v.x * h;
    p.y += v.y * h;
    p.z += v.z * h;

    /* ----------------------------------------------------------- a parede -
       Se a canela bate em pedra, desfaz o passo horizontal e DESLIZA: a
       componente da velocidade que entra na rocha é removida, a que corre ao
       longo dela fica. Bater e parar dentro de um túnel a 52 m/s é a diferença
       entre um corredor por onde se voa e um corredor onde se fica preso. */
    if (campo.solidoEm(p.x, yAnt + DEGRAU, p.z)) {
      const n = campo.normalEm(p.x, yAnt + DEGRAU, p.z, this._n);
      p.x = xAnt;
      p.z = zAnt;
      const entra = v.x * -n.x + v.z * -n.z;
      if (entra > 0) {
        v.x -= -n.x * entra;
        v.z -= -n.z * entra;
      }
    }

    /* ------------------------------------------------------------ o teto --
       Sem isto, quem entra no furo voando sobe através do maciço e sai pelo
       alto. É a falha mais fácil de o jogador encontrar sem querer: basta
       segurar a subida lá dentro. */
    const teto = campo.tetoAcima(p.x, yAnt + ALTURA * 0.5, p.z, ALTURA + 2);
    if (teto < Infinity) {
      const limite = teto - ALTURA;
      if (p.y > limite) {
        p.y = limite;
        if (v.y > 0) v.y = 0;
      }
    }

    /* ------------------------------------------------------------ o chão -- */
    const chao = campo.chaoAbaixo(p.x, yAnt + DEGRAU, p.z, 8);
    if (chao > -Infinity && p.y <= chao) {
      p.y = chao;
      if (v.y < 0) v.y = 0;
      this.noChao = true;
      /* Encostar no chão desliga o voo: é a leitura de pousar, e evita o corpo
         flutuando um palmo acima da poeira. */
      if (this.voando && !a.voar) this.voando = false;
    } else {
      this.noChao = false;
    }

    /* --------------------------------------------------- despenetração ----
       Último recurso: se ainda assim o corpo terminou dentro da pedra — porque
       uma cratera abriu em volta dele, ou porque o teto desabou em cima —, ele é
       empurrado para fora pelo gradiente. Sem isto, escavar sob os próprios pés
       enterraria o jogador vivo. */
    if (campo.solidoEm(p.x, p.y + ALTURA * 0.5, p.z)) {
      const n = campo.normalEm(p.x, p.y + ALTURA * 0.5, p.z, this._n);
      p.x += n.x * RAIO;
      p.y += n.y * RAIO;
      p.z += n.z * RAIO;
    }

    if (p.y < -300) {
      p.y = 60;
      v.x = v.y = v.z = 0;
      this.voando = true;
    }
  }
}
