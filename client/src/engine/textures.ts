import * as THREE from 'three';
import { createNoise2D, fbm } from '../../../shared/noise';

/**
 * Pro Texture Pipeline:
 *  - Loads photographic textures from /assets
 *  - Synthesizes tangent-space Normal Maps (Sobel filter) AND Roughness/Cavity-AO Maps from luminance
 *  - Provides procedural fallbacks when offline
 */

export type TexName = 'stone' | 'roof' | 'grass' | 'rock' | 'wood';

export interface PbrSet {
  map: THREE.Texture;
  normal: THREE.Texture;
  roughnessMap: THREE.Texture;
}

const N = createNoise2D(4242);

const canvas = (size: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  return [c, ctx];
};

const tileNoise = (u: number, v: number, freq: number, oct = 4): number => {
  const a = u * Math.PI * 2;
  const b = v * Math.PI * 2;
  const R = freq / (Math.PI * 2);
  return (
    fbm(N, Math.cos(a) * R + 31.7, Math.sin(a) * R + Math.cos(b) * R * 0.5, oct) * 0.5 +
    fbm(N, Math.sin(b) * R + 7.3, Math.cos(b) * R + Math.sin(a) * R * 0.5, oct) * 0.5
  );
};

const fill = (size: number, fn: (u: number, v: number) => [number, number, number]): HTMLCanvasElement => {
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fn(x / size, y / size);
      const i = (y * size + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
};

const clamp255 = (v: number): number => Math.max(0, Math.min(255, v));

const fallbacks: Record<TexName, () => HTMLCanvasElement> = {
  stone: () =>
    fill(256, (u, v) => {
      const rows = 6;
      const row = Math.floor(v * rows);
      const off = row % 2 ? 0.5 / 3 : 0;
      const cu = ((u + off) * 3) % 1;
      const cv = (v * rows) % 1;
      const mortar = cu < 0.04 || cv < 0.07 ? 0.45 : 1;
      const n = tileNoise(u, v, 18) * 30 + tileNoise(u, v, 60, 2) * 14;
      const tint = (Math.sin(row * 12.9 + Math.floor((u + off) * 3) * 78.2) * 43758.5) % 1;
      const base = (118 + n + tint * 18) * mortar;
      return [clamp255(base), clamp255(base * 0.98), clamp255(base * 0.94)];
    }),
  roof: () =>
    fill(256, (u, v) => {
      const rows = 10;
      const row = Math.floor(v * rows);
      const off = row % 2 ? 0.5 / 8 : 0;
      const cu = ((u + off) * 8) % 1;
      const cv = (v * rows) % 1;
      const edge = cu < 0.05 ? 0.55 : 1;
      const grad = 0.7 + cv * 0.35;
      const n = tileNoise(u, v, 30, 3) * 18;
      const base = (62 + n) * edge * grad;
      return [clamp255(base * 0.85), clamp255(base * 0.92), clamp255(base * 1.08)];
    }),
  grass: () =>
    fill(256, (u, v) => {
      const n = tileNoise(u, v, 10) * 0.5 + tileNoise(u, v, 70, 2) * 0.5;
      const g = 95 + n * 50;
      return [clamp255(g * 0.55), clamp255(g), clamp255(g * 0.32)];
    }),
  rock: () =>
    fill(256, (u, v) => {
      const n = tileNoise(u, v, 8) * 40 + Math.abs(tileNoise(u, v, 40, 3)) * 50;
      const b = 105 + n;
      return [clamp255(b), clamp255(b * 0.97), clamp255(b * 0.92)];
    }),
  wood: () =>
    fill(256, (u, v) => {
      const ring = Math.sin((u * 40 + tileNoise(u, v, 6, 3) * 8) * Math.PI) * 0.5 + 0.5;
      const b = 60 + ring * 35;
      return [clamp255(b * 1.15), clamp255(b * 0.75), clamp255(b * 0.45)];
    }),
};

/**
 * Derive both a Tangent-Space Normal Map AND a Roughness/Cavity Map from image luminance in a single pass.
 * Crevices (dark mortar/grooves) become rougher (higher G channel) and occluded (lower R channel).
 */
export const deriveNormalAndRoughness = (
  src: CanvasImageSource,
  strength = 2.8,
  baseRoughness = 0.75,
  size = 512,
): { normal: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } => {
  const [cN, ctxN] = canvas(size);
  const [cR, ctxR] = canvas(size);
  ctxN.drawImage(src, 0, 0, size, size);
  const data = ctxN.getImageData(0, 0, size, size).data;
  const lum = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    lum[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255;
  }

  const outN = ctxN.createImageData(size, size);
  const outR = ctxR.createImageData(size, size);
  const at = (x: number, y: number): number => lum[((y + size) % size) * size + ((x + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const dy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      let nx = -dx * strength;
      let ny = -dy * strength;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;

      const idx = (y * size + x) * 4;
      outN.data[idx] = (nx * 0.5 + 0.5) * 255;
      outN.data[idx + 1] = (ny * 0.5 + 0.5) * 255;
      outN.data[idx + 2] = (nz * 0.5 + 0.5) * 255;
      outN.data[idx + 3] = 255;

      const h = lum[y * size + x];
      const slope = Math.min(1, Math.hypot(dx, dy) * 0.8);
      const rough = clamp255((baseRoughness + (0.5 - h) * 0.38 + slope * 0.18) * 255);
      const ao = clamp255((0.55 + h * 0.55 - slope * 0.2) * 255);
      outR.data[idx] = ao; // R: AO
      outR.data[idx + 1] = rough; // G: Roughness
      outR.data[idx + 2] = 255;
      outR.data[idx + 3] = 255;
    }
  }
  ctxN.putImageData(outN, 0, 0);
  ctxR.putImageData(outR, 0, 0);

  const normal = new THREE.CanvasTexture(cN);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.colorSpace = THREE.NoColorSpace;

  const roughnessMap = new THREE.CanvasTexture(cR);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.colorSpace = THREE.NoColorSpace;

  return { normal, roughnessMap };
};

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`missing ${url}`));
    img.src = url;
  });

const loadOrFallback = async (name: TexName): Promise<CanvasImageSource> => {
  for (const ext of ['jpg', 'png', 'webp']) {
    try {
      return await loadImage(`/assets/tex_${name}.${ext}`);
    } catch {
      /* try next */
    }
  }
  return fallbacks[name]();
};

export const loadPbrSet = async (
  renderer: THREE.WebGLRenderer,
  name: TexName,
  normalStrength: number,
  baseRoughness: number,
): Promise<PbrSet> => {
  const img = await loadOrFallback(name);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const map = new THREE.Texture(img as HTMLImageElement);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = aniso;
  map.generateMipmaps = true;
  map.needsUpdate = true;

  const { normal, roughnessMap } = deriveNormalAndRoughness(img, normalStrength, baseRoughness);
  normal.anisotropy = aniso;
  roughnessMap.anisotropy = aniso;
  return { map, normal, roughnessMap };
};

export const loadAllPbr = async (renderer: THREE.WebGLRenderer): Promise<Record<TexName, PbrSet>> => {
  const specs: Record<TexName, [number, number]> = {
    stone: [3.4, 0.76],
    roof: [2.8, 0.52],
    grass: [1.8, 0.86],
    rock: [3.8, 0.82],
    wood: [1.5, 0.42],
  };
  const names = Object.keys(specs) as TexName[];
  const sets = await Promise.all(names.map((n) => loadPbrSet(renderer, n, specs[n][0], specs[n][1])));
  return Object.fromEntries(names.map((n, i) => [n, sets[i]])) as Record<TexName, PbrSet>;
};

export const waterNormals = (): THREE.CanvasTexture => {
  const src = fill(256, (u, v) => {
    const h = tileNoise(u, v, 14, 4) * 0.6 + tileNoise(u, v, 40, 2) * 0.4;
    const g = clamp255(128 + h * 120);
    return [g, g, g];
  });
  return deriveNormalAndRoughness(src, 4.2, 0.1, 256).normal;
};

export const radialSprite = (
  inner = 'rgba(255,255,255,1)',
  outer = 'rgba(255,255,255,0)',
  size = 128,
): THREE.CanvasTexture => {
  const [c, ctx] = canvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.65)'));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

export const cloudSprite = (seed = 1): THREE.CanvasTexture => {
  const size = 256;
  const [c, ctx] = canvas(size);
  const n = createNoise2D(seed);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - size / 2) / (size / 2);
      const dy = (y - size / 2) / (size / 2);
      const r = Math.hypot(dx, dy * 1.4);
      const d = fbm(n, x * 0.02, y * 0.02, 5) * 0.5 + 0.5;
      const a = Math.max(0, Math.min(1, (1 - r) * 1.6 * d - 0.15));
      const shade = 200 + (1 - dy) * 28 + d * 30;
      const i = (y * size + x) * 4;
      img.data[i] = clamp255(shade);
      img.data[i + 1] = clamp255(shade);
      img.data[i + 2] = clamp255(shade + 10);
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};
