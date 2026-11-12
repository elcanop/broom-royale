import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { createProCinemaPass } from './ProPostShader';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  pixelRatio: number;
  shadowSize: number;
  bloom: boolean;
  proCinema: boolean;
  smaa: boolean;
  reflectiveWater: boolean;
  trees: number;
  clouds: number;
  pointLights: number;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: {
    pixelRatio: 1,
    shadowSize: 1024,
    bloom: false,
    proCinema: false,
    smaa: false,
    reflectiveWater: false,
    trees: 1200,
    clouds: 28,
    pointLights: 2,
  },
  medium: {
    pixelRatio: 1.25,
    shadowSize: 2048,
    bloom: true,
    proCinema: true,
    smaa: false,
    reflectiveWater: false,
    trees: 2600,
    clouds: 48,
    pointLights: 4,
  },
  high: {
    pixelRatio: 1.75,
    shadowSize: 2048,
    bloom: true,
    proCinema: true,
    smaa: true,
    reflectiveWater: true,
    trees: 4200,
    clouds: 68,
    pointLights: 6,
  },
  ultra: {
    pixelRatio: 2,
    shadowSize: 4096,
    bloom: true,
    proCinema: true,
    smaa: true,
    reflectiveWater: true,
    trees: 6200,
    clouds: 90,
    pointLights: 8,
  },
};

/**
 * Pro WebGL2 + WebXR Rendering Engine:
 *  - Half-Float HDR Pipeline with Hardware Depth Buffer (`THREE.DepthTexture`)
 *  - Screen-Space Ambient Occlusion (SSAO), Volumetric Sun God-Rays, Contrast-Adaptive Sharpening (CAS),
 *    Unreal Bloom, SMAA Anti-Aliasing, and ACES Filmic Tone Mapping.
 *  - Dynamic Speed-FOV Warp & Radial Chromatic Aberration when boosting.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rig = new THREE.Group();
  preset: QualityPreset;
  readonly isSoftwareGpu: boolean;

  private composer: EffectComposer | null = null;
  private depthTexture: THREE.DepthTexture | null = null;
  private cinemaPass: ShaderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private smaaPass: SMAAPass | null = null;
  private boostFactor = 0;
  private projVec = new THREE.Vector3();

  constructor(
    readonly container: HTMLElement,
    quality: Quality,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    const r = this.renderer;
    const gl = r.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpuName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    this.isSoftwareGpu = /SwiftShader|llvmpipe|Software/i.test(gpuName);
    this.preset = this.isSoftwareGpu ? QUALITY.low : QUALITY[quality];

    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio));
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.94;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.xr.enabled = true;
    r.xr.setReferenceSpaceType('local-floor');
    r.xr.setFoveation(0.5);
    container.appendChild(r.domElement);
    r.domElement.setAttribute('aria-label', 'Escena 3D Pro de Broom Royale');

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 9000);
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    this.buildPostPipeline();
    window.addEventListener('resize', this.onResize);
  }

  private buildPostPipeline(): void {
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    if (!this.preset.bloom && !this.preset.proCinema) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = this.renderer.getPixelRatio();

    this.depthTexture = new THREE.DepthTexture(w * pr, h * pr);
    this.depthTexture.type = THREE.UnsignedIntType;

    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, {
      type: THREE.HalfFloatType,
      depthTexture: this.depthTexture,
      depthBuffer: true,
    });

    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    if (this.preset.proCinema) {
      this.cinemaPass = createProCinemaPass(this.depthTexture);
      this.cinemaPass.uniforms['uResolution'].value.set(w * pr, h * pr);
      this.composer.addPass(this.cinemaPass);
    }

    if (this.preset.bloom) {
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.36, 0.4, 1.15);
      this.composer.addPass(this.bloomPass);
    }

    if (this.preset.smaa) {
      this.smaaPass = new SMAAPass();
      this.composer.addPass(this.smaaPass);
    }

    this.composer.addPass(new OutputPass());
  }

  setQuality(q: Quality): void {
    if (this.isSoftwareGpu) return;
    this.preset = QUALITY[q];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.buildPostPipeline();
  }

  get isXR(): boolean {
    return this.renderer.xr.isPresenting;
  }

  private onResize = (): void => {
    if (this.isXR) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = this.renderer.getPixelRatio();
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    if (this.cinemaPass) {
      this.cinemaPass.uniforms['uResolution'].value.set(w * pr, h * pr);
    }
  };

  /** Update God-Ray sun screen coordinates, boost chromatic aberration, and dynamic FOV speed-warp. */
  updateProEffects(
    dt: number,
    sunWorldDir: THREE.Vector3,
    sunColor: THREE.Color,
    godRayStrength: number,
    boosting: boolean,
    speedRatio: number,
  ): void {
    const targetBoost = boosting ? 1 : Math.max(0, (speedRatio - 0.7) * 1.5);
    this.boostFactor += (targetBoost - this.boostFactor) * (1 - Math.exp(-6 * dt));

    if (!this.isXR) {
      const targetFov = 72 + this.boostFactor * 12;
      if (Math.abs(this.camera.fov - targetFov) > 0.05) {
        this.camera.fov = targetFov;
        this.camera.updateProjectionMatrix();
      }
    }

    if (this.cinemaPass) {
      // Project sun direction relative to camera into normalized screen space [0..1]
      const camPos = new THREE.Vector3();
      const camDir = new THREE.Vector3();
      this.camera.getWorldPosition(camPos);
      this.camera.getWorldDirection(camDir);
      const facingDot = camDir.dot(sunWorldDir);

      this.projVec.copy(camPos).addScaledVector(sunWorldDir, 1000).project(this.camera);
      const sx = this.projVec.x * 0.5 + 0.5;
      const sy = this.projVec.y * 0.5 + 0.5;
      const vis = facingDot > 0.05 ? Math.min(1, (facingDot - 0.05) * 1.8) : 0;

      this.cinemaPass.uniforms['uSunScreenPos'].value.set(sx, sy, vis);
      this.cinemaPass.uniforms['uSunColor'].value.copy(sunColor);
      this.cinemaPass.uniforms['uGodRayIntensity'].value = godRayStrength;
      this.cinemaPass.uniforms['uBoost'].value = this.boostFactor;
    }
  }

  get pointScale(): number {
    if (this.isXR) return 900;
    const h = this.renderer.domElement.height;
    return h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  render(): void {
    if (this.composer && !this.isXR) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  async enterVR(): Promise<boolean> {
    const xr = navigator.xr;
    if (!xr || !(await xr.isSessionSupported('immersive-vr'))) return false;
    const session = await xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'],
    });
    await this.renderer.xr.setSession(session);
    return true;
  }
}
