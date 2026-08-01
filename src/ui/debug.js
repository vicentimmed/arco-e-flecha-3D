/* ---------------------------------------------------------------------------
   Painel de depuração (tecla ~): telemetria, vetores no mundo, sliders para os
   parâmetros físicos e o auto-teste dos critérios de aceite.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG } from "../config.js";
import { runSelfTest } from "../systems/selftest.js";

export class DebugPanel {
  constructor(root, ctx) {
    this.ctx = ctx; // { physics, arrows, wind, rig, scene, getStats }
    this.visible = false;
    this.showVectors = false;

    this.el = document.createElement("div");
    this.el.id = "debug";
    this.el.innerHTML = `
      <h3>Telemetria</h3>
      <div class="row"><span>fps</span><b id="d-fps">—</b></div>
      <div class="row"><span>passos de física / frame</span><b id="d-steps">—</b></div>
      <div class="row"><span>flechas em voo / cravadas</span><b id="d-arrows">—</b></div>
      <div class="row"><span>velocidade</span><b id="d-speed">—</b></div>
      <div class="row"><span>força de arrasto</span><b id="d-drag">—</b></div>
      <div class="row"><span>vento</span><b id="d-wind">—</b></div>
      <div class="row"><span>tempo de voo</span><b id="d-time">—</b></div>
      <div class="row"><span>apogeu</span><b id="d-apex">—</b></div>
      <div class="row"><span>alcance</span><b id="d-range">—</b></div>

      <h3>Parâmetros</h3>
      <div class="slider" data-key="mass">
        <label>massa da flecha <b>25 g</b></label>
        <input type="range" min="5" max="80" step="1" value="25">
      </div>
      <div class="slider" data-key="cd">
        <label>coeficiente de arrasto <b>2.00</b></label>
        <input type="range" min="0" max="4" step="0.05" value="2">
      </div>
      <div class="slider" data-key="speed">
        <label>velocidade máxima <b>85 m/s</b></label>
        <input type="range" min="30" max="130" step="1" value="85">
      </div>
      <div class="slider" data-key="gravity">
        <label>gravidade <b>9.81 m/s²</b></label>
        <input type="range" min="0" max="20" step="0.01" value="9.81">
      </div>
      <div class="slider" data-key="wind">
        <label>vento base <b>3.5 m/s</b></label>
        <input type="range" min="0" max="12" step="0.1" value="3.5">
      </div>
      <div class="slider" data-key="cop">
        <label>centro de pressão <b>13 cm</b></label>
        <input type="range" min="0" max="30" step="1" value="13">
      </div>

      <h3>Chaves</h3>
      <div class="toggles">
        <button data-toggle="drag" class="on">arrasto</button>
        <button data-toggle="wind" class="on">vento</button>
        <button data-toggle="aero" class="on">estabilização</button>
        <button data-toggle="vectors">vetores</button>
        <button data-toggle="trace">traçado</button>
      </div>

      <h3>Critérios de aceite</h3>
      <div class="toggles"><button id="d-run">rodar auto-teste</button></div>
      <pre id="d-report">pressione para validar a balística contra a fórmula analítica.</pre>
    `;
    root.appendChild(this.el);

    this.fields = {
      fps: this.el.querySelector("#d-fps"),
      steps: this.el.querySelector("#d-steps"),
      arrows: this.el.querySelector("#d-arrows"),
      speed: this.el.querySelector("#d-speed"),
      drag: this.el.querySelector("#d-drag"),
      wind: this.el.querySelector("#d-wind"),
      time: this.el.querySelector("#d-time"),
      apex: this.el.querySelector("#d-apex"),
      range: this.el.querySelector("#d-range"),
      report: this.el.querySelector("#d-report"),
    };

    this.bindSliders();
    this.bindToggles();
    this.buildVectors();
  }

  bindSliders() {
    for (const slider of this.el.querySelectorAll(".slider")) {
      const key = slider.dataset.key;
      const input = slider.querySelector("input");
      const label = slider.querySelector("label b");
      input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        switch (key) {
          case "mass":
            CONFIG.arrow.mass = v / 1000;
            label.textContent = `${v} g`;
            break;
          case "cd":
            CONFIG.arrow.dragCoefficient = v;
            label.textContent = v.toFixed(2);
            break;
          case "speed":
            CONFIG.bow.maxSpeed = v;
            label.textContent = `${v} m/s`;
            break;
          case "gravity":
            this.ctx.physics.gravity = -v;
            label.textContent = `${v.toFixed(2)} m/s²`;
            break;
          case "wind":
            this.ctx.wind.setBaseSpeed(v);
            label.textContent = `${v.toFixed(1)} m/s`;
            break;
          case "cop":
            CONFIG.arrow.centerOfPressureOffset = v / 100;
            label.textContent = `${v} cm`;
            break;
        }
      });
    }
  }

  bindToggles() {
    for (const btn of this.el.querySelectorAll("[data-toggle]")) {
      btn.addEventListener("click", () => {
        const on = !btn.classList.contains("on");
        btn.classList.toggle("on", on);
        switch (btn.dataset.toggle) {
          case "drag":
            this.ctx.arrows.options.dragEnabled = on;
            break;
          case "wind":
            this.ctx.wind.setEnabled(on);
            break;
          case "aero":
            this.ctx.arrows.options.aeroStabilization = on;
            break;
          case "vectors":
            this.showVectors = on;
            this.vectorGroup.visible = on;
            break;
          case "trace":
            this.ctx.arrows.setTraceVisible(on);
            break;
        }
      });
    }

    this.el.querySelector("#d-run").addEventListener("click", (e) => {
      const btn = e.currentTarget;
      btn.textContent = "rodando…";
      this.fields.report.textContent = "";
      // Deixa o navegador pintar o "rodando…" antes de travar no teste.
      setTimeout(() => {
        const results = runSelfTest();
        this.fields.report.innerHTML = results
          .map(
            (r) =>
              `<span class="${r.pass ? "ok" : "bad"}">${r.pass ? "✓" : "✗"}</span> ${r.name}\n   ${r.detail}`,
          )
          .join("\n\n");
        btn.textContent = "rodar auto-teste";
      }, 30);
    });
  }

  buildVectors() {
    this.vectorGroup = new THREE.Group();
    this.vectorGroup.visible = false;
    const mk = (color) => {
      const a = new THREE.ArrowHelper(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(),
        1,
        color,
        0.35,
        0.18,
      );
      this.vectorGroup.add(a);
      return a;
    };
    this.arrowVelocity = mk(0x6fd36f);
    this.arrowDrag = mk(0xff7d6e);
    this.arrowWind = mk(0x8ac6ff);
    this.ctx.scene.add(this.vectorGroup);
  }

  toggle() {
    this.visible = !this.visible;
    this.el.classList.toggle("on", this.visible);
  }

  update(stats) {
    if (this.showVectors) this.updateVectors();
    if (!this.visible) return;

    const f = this.fields;
    f.fps.textContent = stats.fps.toFixed(0);
    f.steps.textContent = String(stats.steps);
    f.arrows.textContent = `${stats.live} / ${stats.stuck}`;
    f.wind.textContent = `${this.ctx.wind.speed.toFixed(1)} m/s @ ${((this.ctx.wind.direction * 180) / Math.PI).toFixed(0)}°`;

    const arrow = this.ctx.arrows.lastArrow;
    if (arrow) {
      f.speed.textContent = `${arrow.lastSpeed.toFixed(1)} m/s`;
      f.drag.textContent = `${arrow.lastDragForce.toFixed(3)} N (${(arrow.lastDragForce / CONFIG.arrow.mass).toFixed(1)} m/s²)`;
      f.time.textContent = `${arrow.flightTime.toFixed(2)} s`;
      f.apex.textContent = `${arrow.apex.toFixed(1)} m`;
      const t = arrow.body.translation();
      const d = Math.hypot(
        t.x - arrow.launchPosition.x,
        t.z - arrow.launchPosition.z,
      );
      f.range.textContent = `${d.toFixed(1)} m`;
    }
  }

  updateVectors() {
    const arrow = this.ctx.arrows.lastArrow;
    if (!arrow || arrow.stuck || arrow.dead) {
      this.vectorGroup.visible = false;
      return;
    }
    this.vectorGroup.visible = true;
    const t = arrow.body.translation();
    const origin = new THREE.Vector3(t.x, t.y, t.z);

    const v = arrow.lastVelocity;
    const speed = v.length() || 1;
    this.arrowVelocity.position.copy(origin);
    this.arrowVelocity.setDirection(v.clone().divideScalar(speed));
    this.arrowVelocity.setLength(Math.min(6, speed * 0.06), 0.3, 0.16);

    const drag = arrow.lastDragForce;
    this.arrowDrag.position.copy(origin);
    this.arrowDrag.setDirection(v.clone().divideScalar(-speed));
    this.arrowDrag.setLength(Math.max(0.2, drag * 6), 0.3, 0.16);

    const w = this.ctx.wind.vector;
    const ws = w.length();
    this.arrowWind.position.copy(origin);
    if (ws > 0.01) {
      this.arrowWind.setDirection(w.clone().divideScalar(ws));
      this.arrowWind.setLength(ws * 0.22, 0.3, 0.16);
      this.arrowWind.visible = true;
    } else {
      this.arrowWind.visible = false;
    }
  }
}
