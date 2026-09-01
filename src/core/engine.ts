/**
 * Render engine: WebGL renderer, scene, camera, cinematic post chain
 * (bloom), frame loop with fps tracking and hidden-tab pause.
 *
 * Sensor styles (gods-eye-view): an optional final ShaderPass restyles
 * the rendered feed — NVG, FLIR ironbow, CRT, noir. It sits AFTER the
 * OutputPass so it reads display-referred sRGB, and it is disabled
 * entirely in NORMAL mode (zero cost). The pass touches only the WebGL
 * canvas: HUD instruments stay legible in every sensor mode.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/** 0 normal · 1 nvg · 2 flir · 3 crt · 4 noir */
export type SensorMode = 0 | 1 | 2 | 3 | 4;

const SensorShader = {
  uniforms: {
    tDiffuse: { value: null },
    uMode: { value: 0 },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uMode;
    uniform float uTime;
    uniform vec2 uRes;
    varying vec2 vUv;

    float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    // ironbow thermal ramp: black -> violet -> red -> orange -> yellow -> white
    vec3 ironbow(float t) {
      vec3 c1 = vec3(0.00, 0.00, 0.02), c2 = vec3(0.20, 0.00, 0.36),
           c3 = vec3(0.72, 0.06, 0.14), c4 = vec3(0.96, 0.44, 0.02),
           c5 = vec3(1.00, 0.86, 0.12), c6 = vec3(1.00, 1.00, 1.00);
      if (t < 0.20) return mix(c1, c2, t / 0.20);
      if (t < 0.45) return mix(c2, c3, (t - 0.20) / 0.25);
      if (t < 0.70) return mix(c3, c4, (t - 0.45) / 0.25);
      if (t < 0.88) return mix(c4, c5, (t - 0.70) / 0.18);
      return mix(c5, c6, (t - 0.88) / 0.12);
    }

    void main() {
      vec2 uv = vUv;
      vec3 src = texture2D(tDiffuse, uv).rgb;
      vec3 col = src;
      float L = lum(src);
      float grain = hash(uv * uRes + fract(uTime) * 917.0);
      float d = distance(uv, vec2(0.5));

      if (uMode < 0.5) {
        col = src;
      } else if (uMode < 1.5) {
        // NVG: gained luminance through a green phosphor, grain, tube edge
        float g = clamp(pow(L, 0.62) * 1.25, 0.0, 1.0);
        g += (grain - 0.5) * 0.09;
        col = vec3(0.05, 0.14, 0.04) + vec3(0.16, 1.0, 0.26) * g;
        col *= 0.35 + 0.65 * smoothstep(0.82, 0.44, d);
      } else if (uMode < 2.5) {
        // FLIR: luminance as pseudo-thermal through the ironbow ramp
        float t = clamp(pow(L, 0.85) * 1.12, 0.0, 1.0);
        col = ironbow(t) + (grain - 0.5) * 0.03;
      } else if (uMode < 3.5) {
        // CRT: barrel, RGB fringe, scanlines, flicker, phosphor lift
        vec2 cc = uv - 0.5;
        uv = 0.5 + cc * (1.0 + dot(cc, cc) * 0.07);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }
        float ca = 0.0016;
        col = vec3(
          texture2D(tDiffuse, uv + vec2(ca, 0.0)).r,
          texture2D(tDiffuse, uv).g,
          texture2D(tDiffuse, uv - vec2(ca, 0.0)).b);
        float scan = 0.82 + 0.18 * sin(uv.y * uRes.y * 3.14159);
        float flick = 0.97 + 0.03 * sin(uTime * 73.0);
        col = (col * 1.12 + 0.01) * scan * flick;
        col *= 0.75 + 0.25 * smoothstep(0.85, 0.55, d);
      } else {
        // NOIR: hard monochrome, film grain, heavy vignette
        float n = clamp(pow(L, 1.25) * 1.3, 0.0, 1.0);
        n = smoothstep(0.06, 0.94, n);
        col = vec3(n) + (grain - 0.5) * 0.06;
        col *= 0.45 + 0.55 * smoothstep(0.95, 0.35, d);
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export type FrameCallback = (dt: number, elapsed: number) => void;

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private sensor: ShaderPass;
  private callbacks: FrameCallback[] = [];
  private clock = new THREE.Clock();
  private running = false;
  private frames = 0;
  private fpsAccum = 0;
  fps = 60;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setClearColor(0x020409, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 120);
    this.camera.position.set(0, 0.6, 4.4);

    const renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.75, 0.82);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.sensor = new ShaderPass(SensorShader);
    this.sensor.enabled = false; // NORMAL: pass skipped, OutputPass hits screen
    this.composer.addPass(this.sensor);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clock.stop();
      else this.clock.start();
    });
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    (this.sensor.uniforms.uRes.value as THREE.Vector2).set(w * dpr, h * dpr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setSensorMode(mode: SensorMode): void {
    this.sensor.enabled = mode !== 0;
    this.sensor.uniforms.uMode.value = mode;
  }

  onFrame(cb: FrameCallback): void {
    this.callbacks.push(cb);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      if (document.hidden) return;
      const dt = Math.min(this.clock.getDelta(), 0.1);
      const elapsed = this.clock.elapsedTime;
      for (const cb of this.callbacks) cb(dt, elapsed);
      if (this.sensor.enabled) this.sensor.uniforms.uTime.value = elapsed;
      this.composer.render();
      this.fpsAccum += dt;
      this.frames++;
      if (this.fpsAccum >= 0.5) {
        this.fps = this.frames / this.fpsAccum;
        this.frames = 0;
        this.fpsAccum = 0;
      }
    };
    requestAnimationFrame(loop);
  }
}
