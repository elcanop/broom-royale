import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * Pro Cinema Post-Processing Shader Pass (`ProCinemaPass`):
 *  1. Depth-Aware Screen-Space Ambient Occlusion (SSAO / Contact Shadows) from hardware `tDepth`
 *  2. Volumetric Screen-Space God-Rays (Crepuscular Rays) cast from `uSunScreenPos` with depth occlusion
 *  3. Contrast-Adaptive Sharpening (CAS) for razor-sharp masonry, wood grain, and distant spires
 *  4. Dynamic Supersonic Boost Chromatic Aberration & Radial Warp (`uBoost`)
 *  5. Filmic Color Grading & Subtle Cinematic Vignette
 */
export const createProCinemaPass = (depthTexture: THREE.DepthTexture): ShaderPass => {
  const shader = {
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: depthTexture },
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uSunScreenPos: { value: new THREE.Vector3(0.5, 0.7, 1.0) }, // xy in UV [0..1], z > 0 when in front of camera
      uSunColor: { value: new THREE.Color(0xffb870) },
      uGodRayIntensity: { value: 0.42 },
      uSsaoStrength: { value: 0.52 },
      uSharpness: { value: 0.35 },
      uBoost: { value: 0.0 },
      uCameraNear: { value: 0.1 },
      uCameraFar: { value: 9000.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      #include <packing>
      uniform sampler2D tDiffuse;
      uniform sampler2D tDepth;
      uniform vec2 uResolution;
      uniform vec3 uSunScreenPos;
      uniform vec3 uSunColor;
      uniform float uGodRayIntensity;
      uniform float uSsaoStrength;
      uniform float uSharpness;
      uniform float uBoost;
      uniform float uCameraNear;
      uniform float uCameraFar;
      varying vec2 vUv;

      float readLinearDepth(vec2 coord) {
        float fragCoordZ = texture2D(tDepth, coord).x;
        if (fragCoordZ >= 0.9999) return 1.0;
        float viewZ = perspectiveDepthToViewZ(fragCoordZ, uCameraNear, uCameraFar);
        return viewZToOrthographicDepth(viewZ, uCameraNear, uCameraFar);
      }

      void main() {
        vec2 texel = 1.0 / max(uResolution, vec2(1.0));
        vec2 centerVec = vUv - vec2(0.5);
        float centerDist = length(centerVec);

        // 1. Dynamic Boost Radial Chromatic Aberration & Subtle Lens Warp
        float caAmount = (0.0008 + uBoost * 0.0055) * centerDist * centerDist;
        vec2 uvR = vUv - centerVec * caAmount;
        vec2 uvB = vUv + centerVec * caAmount;
        float r = texture2D(tDiffuse, uvR).r;
        vec4 baseG = texture2D(tDiffuse, vUv);
        float b = texture2D(tDiffuse, uvB).b;
        vec3 col = vec3(r, baseG.g, b);

        // 2. Contrast-Adaptive Sharpening (5-tap cross kernel)
        if (uSharpness > 0.01) {
          vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb;
          vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
          vec3 e = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb;
          vec3 w = texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb;
          vec3 blur = (n + s + e + w) * 0.25;
          col = max(vec3(0.0), col + (col - blur) * uSharpness);
        }

        // 3. Depth-Aware Screen-Space Ambient Occlusion (SSAO / Contact Shadows)
        float rawDepth = texture2D(tDepth, vUv).x;
        if (rawDepth < 0.9995 && uSsaoStrength > 0.01) {
          float d0 = readLinearDepth(vUv);
          float occ = 0.0;
          vec2 offsets[8];
          offsets[0] = vec2( 1.0,  0.0);
          offsets[1] = vec2(-1.0,  0.0);
          offsets[2] = vec2( 0.0,  1.0);
          offsets[3] = vec2( 0.0, -1.0);
          offsets[4] = vec2( 0.7,  0.7);
          offsets[5] = vec2(-0.7,  0.7);
          offsets[6] = vec2( 0.7, -0.7);
          offsets[7] = vec2(-0.7, -0.7);

          float radius = clamp(0.0035 / max(0.02, d0 * 12.0), 0.0008, 0.006);
          for (int i = 0; i < 8; i++) {
            float ds = readLinearDepth(vUv + offsets[i] * radius);
            float diff = d0 - ds;
            if (diff > 0.00004 && diff < 0.006) {
              occ += smoothstep(0.00004, 0.0012, diff) * (1.0 - smoothstep(0.0012, 0.006, diff));
            }
          }
          float ao = clamp(1.0 - (occ / 8.0) * uSsaoStrength * 1.65, 0.42, 1.0);
          col *= ao;
        }

        // 4. Screen-Space Volumetric God-Rays (Crepuscular Sun Shafts)
        if (uSunScreenPos.z > 0.0 && uGodRayIntensity > 0.01) {
          vec2 delta = (uSunScreenPos.xy - vUv);
          float sunDist = length(delta);
          vec2 stepUv = delta / 24.0;
          vec2 sampleUv = vUv;
          float illumination = 0.0;
          float weight = 1.0;
          for (int i = 0; i < 24; i++) {
            sampleUv += stepUv;
            float sd = texture2D(tDepth, clamp(sampleUv, 0.001, 0.999)).x;
            float skySample = smoothstep(0.9985, 0.9999, sd);
            illumination += skySample * weight;
            weight *= 0.94;
          }
          float radialFalloff = exp(-sunDist * 2.1) * clamp(uSunScreenPos.z, 0.0, 1.0);
          vec3 rays = uSunColor * (illumination / 24.0) * radialFalloff * uGodRayIntensity;
          col += rays;
        }

        // 5. Subtle Cinematic Color Grading & Framing Vignette
        float vig = 1.0 - smoothstep(0.45, 0.95, centerDist) * (0.22 + uBoost * 0.16);
        col *= vig;
        // S-curve contrast polish
        col = mix(col, smoothstep(0.0, 1.0, col), 0.12);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  };

  return new ShaderPass(shader);
};

