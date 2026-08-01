/* ---------------------------------------------------------------------------
   Renderização: contexto WebGL, câmera, iluminação PBR, céu e nuvens.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG } from "../config.js";

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 ground;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  varying vec3 vDir;

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;

    // Gradiente vertical: chão nebuloso → horizonte claro → zênite saturado.
    vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.62));
    col = mix(ground, col, smoothstep(-0.16, 0.02, h));

    // Halo do sol, sem disco (o sol fica fora do enquadramento de jogo).
    float sun = max(dot(dir, normalize(sunDir)), 0.0);
    col += sunColor * pow(sun, 7.0) * 0.55;
    col += sunColor * pow(sun, 2.0) * 0.07;

    gl_FragColor = vec4(col, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Tamanho da janela, nunca zero (abas em segundo plano reportam 0×0, e
 *  aspect = 0/0 = NaN envenenaria a matriz de projeção). */
function viewportSize() {
  return {
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
  };
}

export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    const { width, height } = viewportSize();
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, CONFIG.render.maxPixelRatio),
    );
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = CONFIG.render.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xbcd4e6, CONFIG.world.fogDensity);

    this.camera = new THREE.PerspectiveCamera(
      CONFIG.camera.fov,
      width / height,
      CONFIG.camera.near,
      CONFIG.camera.far,
    );
    this.camera.position.set(0, 2, 6);

    this.sunDirection = new THREE.Vector3(-0.42, 0.66, 0.62).normalize();

    this.buildSky();
    this.buildLights();

    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(600, 32, 20);
    this.skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenith: { value: new THREE.Color("#2f7fd4") },
        horizon: { value: new THREE.Color("#cfe6f5") },
        ground: { value: new THREE.Color("#b9c6c4") },
        sunDir: { value: this.sunDirection.clone() },
        sunColor: { value: new THREE.Color("#ffe6b0") },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    });
    this.sky = new THREE.Mesh(geo, this.skyMaterial);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.scene.add(this.sky);

    this.clouds = buildClouds();
    this.scene.add(this.clouds);
  }

  buildLights() {
    // Sol quente + céu frio: é o contraste que dá o visual "pintado".
    this.sun = new THREE.DirectionalLight(0xfff0d2, 3.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(
      CONFIG.render.shadowMapSize,
      CONFIG.render.shadowMapSize,
    );
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.05;
    const r = CONFIG.render.shadowRange;
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 1;
    cam.far = 190;
    cam.updateProjectionMatrix();
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xa8d3ff, 0x6b5a3c, 0.85);
    this.scene.add(this.hemi);

    // Preenchimento fraco vindo do lado oposto ao sol, para as sombras não
    // ficarem chapadas de preto.
    this.fill = new THREE.DirectionalLight(0xbcd8ff, 0.35);
    this.fill.position.set(6, 4, -8);
    this.scene.add(this.fill);
  }

  /** Mantém o frustum de sombra centrado na área de jogo relevante. */
  updateShadowFocus(target) {
    const d = 70;
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDirection, d);
    this.sun.target.updateMatrixWorld();
  }

  resize() {
    const { width, height } = viewportSize();
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, CONFIG.render.maxPixelRatio),
    );
  }

  render() {
    this.sky.position.copy(this.camera.position);
    this.clouds.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.renderer.render(this.scene, this.camera);
  }
}

/* ---------------------------------------------------------------- nuvens --- */

function cloudTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);

  // Algumas bolhas sobrepostas com gradiente radial: nuvem estilizada.
  const puffs = [
    [128, 150, 62],
    [88, 158, 46],
    [172, 156, 50],
    [110, 122, 44],
    [152, 126, 40],
  ];
  for (const [cx, cy, r] of puffs) {
    const g = ctx.createRadialGradient(cx, cy - r * 0.2, r * 0.15, cx, cy, r);
    g.addColorStop(0, "rgba(255,255,255,0.98)");
    g.addColorStop(0.55, "rgba(250,252,255,0.72)");
    g.addColorStop(1, "rgba(226,238,250,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildClouds() {
  const group = new THREE.Group();
  group.name = "clouds";
  const tex = cloudTexture();
  const material = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    fog: false,
    opacity: 0.9,
  });

  const layout = [
    [-180, 118, -300, 150],
    [90, 132, -340, 190],
    [260, 100, -190, 130],
    [-260, 96, -60, 140],
    [40, 150, -430, 230],
    [-90, 108, -480, 170],
    [330, 126, -380, 200],
    [-330, 140, -420, 210],
    [150, 92, 120, 120],
    [-140, 104, 190, 150],
  ];
  for (const [x, y, z, s] of layout) {
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, y, z);
    sprite.scale.set(s, s * 0.52, 1);
    sprite.renderOrder = -900;
    group.add(sprite);
  }
  return group;
}
