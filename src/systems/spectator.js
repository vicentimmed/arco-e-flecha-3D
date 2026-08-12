/* ---------------------------------------------------------------------------
   A câmera de quem já morreu.

   Ela existe por causa de um único modo — o último em pé —, e existe porque a
   alternativa é pior do que parece. Num modo de vida única, quem toma a
   primeira flecha ficaria olhando para o próprio cadáver por três minutos. O
   jogo teria acabado para essa pessoa antes de ter começado, e a punição por
   errar uma vez seria "vá fazer outra coisa".

   Assistir conserta isso, e conserta de um jeito que ACRESCENTA em vez de
   consolar: ver de cima os três que sobraram se caçando é a melhor vista que o
   jogo tem para oferecer, e é uma vista que ninguém consegue enquanto está
   jogando. Quem morre cedo ganha o lugar do camarote.

   ------------------------------------------------------------------- o voo

   Voo livre, sem colisão e sem gravidade — as mesmas teclas de andar, com o
   olhar do mouse decidindo a direção. Sem colisão de propósito: um espectador
   preso do lado de fora de uma pedra é um espectador que não está vendo nada, e
   ninguém pode ser prejudicado por ele atravessar o cenário, porque ele não
   participa mais de nada.

   O CORPO CONTINUA CAÍDO onde morreu. Esta câmera não move o arqueiro: ela é
   uma câmera solta, e o cadáver fica no chão para os outros verem — inclusive
   como marca de onde alguém foi pego. Ver `main.js`, `entrarNoEspectador`.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { damp } from "../utils/math.js";

/** Metros por segundo. Rápido: a arena tem 300 m de ponta a ponta. */
const VEL_BASE = 22;
const VEL_CORRIDA = 62; // com Shift — atravessar o mapa não pode custar meia partida
const SUAVIZA = 9; // a velocidade é amortecida, senão o voo fica duro

export class Spectator {
  constructor(camera) {
    this.camera = camera;
    this.ativo = false;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this._alvo = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._look = new THREE.Vector3();
  }

  /**
   * Entra em modo espectador a partir de onde a câmera está agora.
   *
   * Do ponto ATUAL, e não de um ponto calculado: a câmera acabou de acompanhar
   * o próprio tombo, então ela já está exatamente onde o jogador estava
   * olhando. Qualquer outro ponto de partida seria um corte, e um corte no
   * instante da morte tira a única coisa que a morte tem para comunicar — onde
   * ela aconteceu.
   */
  entrar(deOnde) {
    this.position.copy(deOnde ?? this.camera.position);
    this.velocity.set(0, 0, 0);
    this.ativo = true;
  }

  sair() {
    this.ativo = false;
    this.velocity.set(0, 0, 0);
  }

  /**
   * @param {number} dt
   * @param {{yaw:number, pitch:number, forward:number, strafe:number,
   *          run:boolean}} input o MESMO objeto de entrada do jogo
   * @param {boolean} subir espaço segurado
   * @param {boolean} descer control/C segurado
   */
  update(dt, input, subir = false, descer = false) {
    if (!this.ativo) return;

    /* A direção do olhar sai de yaw/pitch, como a mira do arqueiro. É a mesma
       convenção do resto do jogo (−sin(yaw), −cos(yaw) no plano), e mantê-la
       aqui é o que faz o mouse continuar respondendo do jeito que a mão já
       aprendeu — a única coisa que muda ao morrer é o que se move. */
    const cp = Math.cos(input.pitch);
    this._fwd.set(
      -Math.sin(input.yaw) * cp,
      Math.sin(input.pitch),
      -Math.cos(input.yaw) * cp,
    );
    this._right.crossVectors(this._fwd, this._up).normalize();

    const vel = input.run ? VEL_CORRIDA : VEL_BASE;
    this._alvo
      .set(0, 0, 0)
      .addScaledVector(this._fwd, input.forward)
      .addScaledVector(this._right, input.strafe);
    // O vertical é ABSOLUTO, não relativo ao olhar: subir é subir, mesmo com a
    // câmera apontada para o chão. É o que todo editor de cena faz, e a mão
    // espera isso.
    this._alvo.y += (subir ? 1 : 0) - (descer ? 1 : 0);
    if (this._alvo.lengthSq() > 1) this._alvo.normalize();
    this._alvo.multiplyScalar(vel);

    this.velocity.x = damp(this.velocity.x, this._alvo.x, SUAVIZA, dt);
    this.velocity.y = damp(this.velocity.y, this._alvo.y, SUAVIZA, dt);
    this.velocity.z = damp(this.velocity.z, this._alvo.z, SUAVIZA, dt);

    this.position.addScaledVector(this.velocity, dt);

    this.camera.position.copy(this.position);
    this._look.copy(this.position).add(this._fwd);
    this.camera.lookAt(this._look);
  }
}
