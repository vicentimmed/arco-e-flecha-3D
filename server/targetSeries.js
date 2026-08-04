/* ---------------------------------------------------------------------------
   Alvos em série.

   Um alvo por vez, cada um mais longe que o anterior. Acertou: ele explode,
   some, e o próximo nasce adiante — até o último, lá na encosta da serra.

   Por que no servidor: o alvo tem de ser O MESMO para todo mundo. Se cada
   cliente sorteasse a próxima posição, dois amigos estariam mirando em alvos
   diferentes achando que miram no mesmo, e o placar não faria sentido. Aqui
   existe uma sequência só, e quem acerta primeiro leva.

   As distâncias crescem em progressão geométrica porque a dificuldade de um
   tiro não cresce com a distância, cresce com a RAZÃO entre distâncias: de 25 m
   para 32 m quase nada muda; de 230 m para 300 m muda a elevação, a deriva do
   vento e o tempo de voo. Um passo constante daria dez alvos parecidos no
   começo e um abismo no fim.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../src/config.js";
import { pathCenterX } from "../src/shared/terrainField.js";

export class TargetSeries {
  constructor(terrain) {
    this.terrain = terrain;
    this.active = false;
    this.index = 0;
    this.target = null;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.index = 0;
    this.place();
  }

  stop() {
    this.active = false;
    this.target = null;
  }

  /** Distância do alvo de índice `i`, em progressão geométrica. */
  distanceAt(i) {
    const S = CONFIG.modes.series;
    const passos = Math.max(1, S.steps - 1);
    const razao = (S.lastDistance / S.firstDistance) ** (1 / passos);
    return S.firstDistance * razao ** Math.min(i, passos);
  }

  pointsAt(i) {
    const S = CONFIG.modes.series;
    return Math.round(S.pointsBase * S.pointsPerStep ** i);
  }

  /**
   * Põe o alvo da vez sobre a estrada, na distância da sequência.
   *
   * Ele segue a curva da trilha (`pathCenterX`) em vez de uma reta: a estrada
   * serpenteia, e um alvo fora dela ficaria no meio do mato. A altura sai do
   * terreno, então o alvo distante sobe naturalmente pela encosta.
   */
  place() {
    const S = CONFIG.modes.series;
    const dist = this.distanceAt(this.index);
    const z = S.startZ - dist;
    const x = pathCenterX(z);
    const y = this.terrain.heightAt(x, z);

    this.target = {
      seq: this.index,
      x: round(x),
      y: round(y),
      z: round(z),
      distance: round(dist),
      points: this.pointsAt(this.index),
      last: this.index >= S.steps - 1,
    };
  }

  /**
   * Alguém acertou. Devolve o alvo vencido, ou null se a mensagem chegou
   * atrasada e o alvo já era outro — dois tiros quase juntos são normais.
   */
  hit(seq) {
    if (!this.active || !this.target || this.target.seq !== seq) return null;
    const vencido = this.target;
    // Chegou ao fim: recomeça a série em vez de encerrar o modo, para a
    // brincadeira não parar sozinha no meio de uma rodada boa.
    this.index = vencido.last ? 0 : this.index + 1;
    this.place();
    return vencido;
  }

  view() {
    return this.active ? this.target : null;
  }
}

const round = (v) => Math.round(v * 100) / 100;
