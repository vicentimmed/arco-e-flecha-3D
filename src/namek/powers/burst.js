/* ---------------------------------------------------------------------------
   A explosão de ki — a onda de empurrão.

   **Isto é defesa, e o arquivo inteiro depende de essa frase ser levada a
   sério.** Custa 25 de ki (um quarto da barra), machuca 12 no centro e some em
   pouco mais de um terço de segundo. Quem tentar usá-la como ataque vai gastar
   a barra para arranhar; quem a usar quando alguém está em cima, se solta.

   O que ela faz de verdade é EMPURRAR: 26 m/s no centro, caindo até nada na
   borda dos 14 m. Num jogo em que o corpo a corpo acontece a 90 m/s, ser
   arremessado para fora do alcance de alguém é a coisa mais valiosa que meio
   segundo pode comprar. É por isso que o dano é quase simbólico — se ela
   empurrasse E matasse, não haveria motivo para usar qualquer outra coisa de
   perto.

   ------------------------------------------------------------ instantânea

   O empurrão é resolvido UMA VEZ, no primeiro quadro, para todo mundo dentro
   do raio — e não conforme a casca visual chega em cada um. Uma frente que
   viaja parece melhor num diagrama e é pior na mão: alguém a 13 m seria
   empurrado quatro quadros depois de ver a onda passar por ele, e a única
   leitura possível disso é "o jogo demorou para responder". A casca é o
   desenho da onda; a onda já aconteceu.

   -------------------------------------------------------- e varre as bolas

   Ela apaga as bolas de ki alheias que estiverem dentro do raio. Não está no
   §6 do plano por escrito, mas é a leitura inevitável de uma onda de pressão
   defensiva — e é o que a referência faz. Ver `PowerSystem.spawnBurst`, onde a
   varredura acontece, e a ressalva de sincronismo que está anotada lá.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";
import { gameEvents, EventType } from "../../core/events.js";
import { atingivel, distancia2AoAlvo, pegarVaga, TETO_DO_RELEVO } from "./blast.js";

/** Quantas ondas ao mesmo tempo. Ela é barata e curta; oito é folga. */
const MAX_ONDAS = 8;

/* s — quanto a casca leva para chegar aos 14 m e apagar.
 *
 * É FORMA, não balanço: raio, empurrão e dano estão em `NAMEK.ki`. Isto só diz
 * em quanto tempo o desenho da onda percorre aquele raio, e o número sai do que
 * a onda precisa comunicar — ela tem de ser mais rápida que a reação de quem
 * está olhando, ou vira um balão inflando. */
const DURACAO = 0.36;

/** Cor da casca. Branco-azulado de ki bruto: ela não é golpe de ninguém. */
const COR = 0xbfe8ff;

const _cor = new THREE.Color();

/* ============================================================================
   Uma onda
   ========================================================================== */

class Onda {
  constructor(scene, geo) {
    this.scene = scene;
    /* `viva`, `t` e `local` existem ANTES do primeiro disparo porque
       `pegarVaga` os lê para escolher quem reciclar. Um slot nunca usado sai
       pelo `!viva`, mas depender dessa ordem seria depender de uma ordem. */
    this.viva = false;
    this.t = 0;
    this.local = false;
    this.casca = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: COR,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.5,
        // Vista de dentro (quem soltou está no centro dela) e de fora (quem
        // levou o empurrão): as duas faces são olhadas, sempre.
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    this.casca.renderOrder = 9;
    this.casca.frustumCulled = false;
    this.casca.visible = false;
    scene.add(this.casca);
  }

  acender(field, { owner, origem, local }) {
    this.field = field;
    this.owner = owner;
    this.local = !!local;
    this.viva = true;
    this.t = 0;
    this.resolvida = false;
    this.x = origem.x;
    this.y = origem.y;
    this.z = origem.z;
    _cor.set(COR);
    this.casca.material.color.copy(_cor);
    this.casca.material.opacity = 0.5;
    this.casca.position.set(this.x, this.y, this.z);
    this.casca.scale.setScalar(0.001);
    this.casca.visible = true;

    this.estalar();
    return this;
  }

  /* ------------------------------------------------------------------ passo */

  update(dt, alvos, localId, relato) {
    if (!this.viva) return true;
    const K = NAMEK.ki;
    this.t += dt;

    if (!this.resolvida) {
      this.resolvida = true;
      if (this.owner === localId) this.empurrar(alvos, relato);
    }

    const u = this.t / DURACAO;
    if (u >= 1) return true;

    /* A casca abre com RAIZ do tempo: quase todo o caminho no primeiro terço,
       e depois desacelerando. É o perfil de uma frente de pressão perdendo
       energia — abrir em velocidade constante daria uma bolha, e bolha não
       empurra ninguém. */
    const r = K.burstRadius * Math.sqrt(u);
    this.casca.scale.setScalar(Math.max(0.001, r));
    this.casca.material.opacity = 0.5 * (1 - u) * (1 - u);
    return false;
  }

  /**
   * O empurrão e o arranhão, para quem está dentro do raio.
   *
   * A queda é LINEAR do centro à borda, e nos dois: quem está encostado leva
   * os 26 m/s e os 12 de dano inteiros, quem está nos 14 m não sente nada. Uma
   * queda quadrática concentraria tudo nos primeiros metros e a onda deixaria
   * de cumprir o papel de abrir espaço, que é o único papel que ela tem.
   */
  empurrar(alvos, relato) {
    const K = NAMEK.ki;
    const R = K.burstRadius;
    const R2 = R * R;
    for (let k = 0; k < alvos.length; k++) {
      const a = alvos[k];
      if (!atingivel(a, this.owner)) continue;
      const d2 = distancia2AoAlvo(a, this.x, this.y, this.z);
      if (d2 > R2) continue;

      /* A direção sai do CENTRO DE MASSA de quem levou, não dos pés: empurrar
         pelos pés de alguém que está no chão dá um vetor quase horizontal
         apontando para dentro do terreno, e o resultado seria uma pessoa
         raspando o chão em vez de voando. */
      let px = a.x - this.x;
      let py = a.y + a.altura * 0.5 - this.y;
      let pz = a.z - this.z;
      const d = Math.hypot(px, py, pz);
      if (d < 1e-3) {
        // Exatamente em cima: joga para cima, que é a única saída que não é
        // uma escolha arbitrária de direção horizontal.
        px = 0;
        py = 1;
        pz = 0;
      } else {
        px /= d;
        py /= d;
        pz /= d;
      }

      const forca = 1 - Math.min(1, d / R);
      const e = relato.empurrao();
      e.owner = this.owner;
      e.victim = a.id;
      e.push.x = px * K.burstPush * forca;
      e.push.y = py * K.burstPush * forca;
      e.push.z = pz * K.burstPush * forca;
      e.dano = K.burstDamage * forca;
    }
  }

  /** O estalo. E, se houver chão perto, a poeira que ele levanta. */
  estalar() {
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.x, y: this.y, z: this.z },
      count: 22,
      color: COR,
      speed: NAMEK.ki.burstPush * 1.4,
      spread: 1,
      size: 0.5,
      grow: 1.8,
      life: DURACAO,
      gravity: 0,
      drag: 2.8,
      alpha: 1,
      additive: true,
    });

    /* Uma consulta de altura, uma vez na vida da onda: se ela abriu rente ao
       chão, o chão responde. Sem isto, a explosão de ki de quem está pousado
       acontece num vácuo e some metade do peso dela. */
    if (this.y >= TETO_DO_RELEVO) return;
    const h = this.field.heightAt(this.x, this.z);
    if (this.y - h > NAMEK.ki.burstRadius * 0.6) return;
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.x, y: h + 0.2, z: this.z },
      count: 18,
      color: 0x84906a,
      speed: 16,
      spread: 0.85,
      direction: { x: 0, y: 0.35, z: 0 },
      size: 0.7,
      grow: 3,
      life: 0.9,
      gravity: NAMEK.fighter.gravity * 0.3,
      drag: 1.7,
      alpha: 0.6,
    });
  }

  apagar() {
    this.viva = false;
    this.casca.visible = false;
  }

  dispose() {
    this.scene.remove(this.casca);
    this.casca.material.dispose();
  }
}

/* ============================================================================
   O pool
   ========================================================================== */

export class BurstPool {
  constructor(scene, field, max = MAX_ONDAS) {
    this.scene = scene;
    this.field = field;
    /* Raio 1: o tamanho é escala, e as oito ondas dividem um buffer só.
       Poucos segmentos de propósito — a casca vive 0,36 s, está sempre em
       movimento e é aditiva; ninguém vai contar os gomos dela, e cada gomo a
       mais é triângulo desenhado com mistura aditiva, que é o pixel mais caro
       que existe. */
    this.geo = new THREE.SphereGeometry(1, 20, 14);
    this.ondas = new Array(max);
    for (let i = 0; i < max; i++) this.ondas[i] = new Onda(scene, this.geo);
  }

  disparar(disparo) {
    return pegarVaga(this.ondas).acender(this.field, disparo);
  }

  update(dt, alvos, localId, relato) {
    for (let i = 0; i < this.ondas.length; i++) {
      const o = this.ondas[i];
      if (!o.viva) continue;
      if (o.update(dt, alvos, localId, relato)) o.apagar();
    }
  }

  get count() {
    let n = 0;
    for (let i = 0; i < this.ondas.length; i++) if (this.ondas[i].viva) n++;
    return n;
  }

  clear() {
    for (let i = 0; i < this.ondas.length; i++) this.ondas[i].apagar();
  }

  dispose() {
    for (let i = 0; i < this.ondas.length; i++) this.ondas[i].dispose();
    this.geo.dispose();
  }
}
