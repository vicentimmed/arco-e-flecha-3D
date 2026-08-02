/* ---------------------------------------------------------------------------
   HUD: placar, vento, pino de mira, barra de força e mira.

   A mira é um retículo fixo no centro, sem nenhuma assistência: não segue
   alvos, não indica o ponto de queda e não muda de cor ao passar sobre um alvo.
   --------------------------------------------------------------------------- */

import { radToDeg } from "../utils/math.js";

export class HUD {
  constructor(root) {
    this.root = root;
    this.score = 0;
    this.shots = 0;
    this.hits = 0;

    root.innerHTML = `
      <div class="chip" id="score-chip">
        <span class="label">Pontos</span><span class="value" id="score">0</span>
      </div>
      <div class="chip" id="stats-chip">
        <span id="stats">0 acertos / 0 tiros · média 0.0</span>
      </div>

      <div class="chip" id="wind-chip">
        <div id="wind-dial"><div id="wind-arrow"></div></div>
        <div>
          <div class="label">Vento</div>
          <div class="value" id="wind-speed">0.0 m/s</div>
        </div>
      </div>
      <div class="chip" id="pin-chip">
        <span class="label">Mira</span>
        <span class="value" id="focus">—</span>
      </div>
      <div class="chip" id="target-chip">
        <span class="label">Alvo</span><span class="value" id="target-dist">—</span>
      </div>

      <div id="reticle">
        <i class="h1"></i><i class="h2"></i><i class="v1"></i><i class="v2"></i>
        <i class="dot"></i>
      </div>

      <div id="power">
        <div id="power-track">
          <div id="power-fill"></div>
          <div id="power-mark"></div>
        </div>
        <div id="power-label">0 m/s</div>
      </div>

      <div id="toasts"></div>

      <div id="help">
        <div><kbd>Mouse</kbd> mirar · <kbd>Clique</kbd> segurar e soltar para atirar</div>
        <div><kbd>Dir.</kbd> 1ª/3ª pessoa · <kbd>Clique</kbd> sai da câmera da flecha</div>
        <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> andar · <kbd>Shift</kbd> correr · <kbd>Tab</kbd> alvo</div>
        <div><kbd>T</kbd> traçado · <kbd>R</kbd> limpar · <kbd>~</kbd> depuração · <kbd>H</kbd> ocultar</div>
      </div>

      <div id="lock-hint">
        <div class="card">
          <h2>Clique para mirar</h2>
          <p>O ponteiro será capturado. <kbd>Esc</kbd> libera.</p>
        </div>
      </div>
    `;

    this.el = {
      score: root.querySelector("#score"),
      stats: root.querySelector("#stats"),
      windArrow: root.querySelector("#wind-arrow"),
      windSpeed: root.querySelector("#wind-speed"),
      focus: root.querySelector("#focus"),
      targetDist: root.querySelector("#target-dist"),
      power: root.querySelector("#power"),
      powerFill: root.querySelector("#power-fill"),
      powerMark: root.querySelector("#power-mark"),
      powerLabel: root.querySelector("#power-label"),
      reticle: root.querySelector("#reticle"),
      toasts: root.querySelector("#toasts"),
      help: root.querySelector("#help"),
      lockHint: root.querySelector("#lock-hint"),
    };

    // Marca da velocidade máxima útil na barra (tensão total).
    this.el.powerMark.style.left = "100%";
  }

  setDraw(fraction, speed) {
    const on = fraction > 0.001;
    this.drawing = on;
    this.el.power.classList.toggle("on", on);
    this.el.powerFill.style.width = `${fraction * 100}%`;
    this.el.powerLabel.textContent = `${speed.toFixed(0)} m/s`;
  }

  /** O retículo é fixo no centro; só escondemos na câmera da flecha. */
  setReticleVisible(visible) {
    this.el.reticle.classList.toggle("off", !visible);
    this.el.reticle.style.transform = this.drawing ? "scale(0.8)" : "scale(1)";
  }

  /** Distância até o ponto do cenário sob a mira. */
  setFocus(distance, hasFocus) {
    this.el.focus.textContent = hasFocus ? `${distance.toFixed(0)} m` : "—";
  }

  /**
   * @param {number} speed m/s
   * @param {number} relativeAngle rad — 0 = vento soprando para longe do jogador
   */
  setWind(speed, relativeAngle) {
    this.el.windSpeed.textContent = `${speed.toFixed(1)} m/s`;
    this.el.windArrow.style.transform = `rotate(${radToDeg(relativeAngle) + 180}deg)`;
  }

  setTarget(index, distance) {
    this.el.targetDist.textContent =
      index === null ? "—" : `#${index + 1} · ${distance.toFixed(0)} m`;
  }

  addShot() {
    this.shots++;
    this.refreshStats();
  }

  addScore(points, distance) {
    this.score += points;
    this.hits++;
    this.el.score.textContent = String(this.score);
    this.refreshStats();
    this.toast(
      `<span class="score">+${points}</span> &nbsp;${distance.toFixed(0)} m`,
    );
  }

  miss(what) {
    this.toast(`errou · ${what}`, "miss");
    this.refreshStats();
  }

  refreshStats() {
    const avg = this.hits > 0 ? this.score / this.hits : 0;
    this.el.stats.textContent =
      `${this.hits} acertos / ${this.shots} tiros · média ${avg.toFixed(1)}`;
  }

  toast(html, extraClass = "") {
    const node = document.createElement("div");
    node.className = `toast ${extraClass}`.trim();
    node.innerHTML = html;
    this.el.toasts.appendChild(node);
    setTimeout(() => node.remove(), 1650);
  }

  toggleHelp() {
    this.el.help.classList.toggle("hidden");
  }
}
