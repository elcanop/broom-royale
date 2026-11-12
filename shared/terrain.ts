import { WORLD } from './config';
import { createNoise2D, fbm, ridged } from './noise';
import { smoothstep, lerp } from './vec';

const nBase = createNoise2D(WORLD.seed);
const nRidge = createNoise2D(WORLD.seed + 17);
const nDetail = createNoise2D(WORLD.seed + 91);

const LAKE_RX = 300;
const LAKE_RZ = 210;
const PLATEAU_R = 185;

/** Ellipse metric for the lake: < 1 inside. */
const lakeMetric = (x: number, z: number): number => {
  const dx = (x - WORLD.lakeCenter.x) / LAKE_RX;
  const dz = (z - WORLD.lakeCenter.z) / LAKE_RZ;
  return Math.sqrt(dx * dx + dz * dz);
};

/**
 * Deterministic terrain height (metres) at world X/Z.
 * Layout: misty highlands, a central lake, a high cliff plateau for the castle,
 * a ring of snow-capped mountains at the map edge.
 */
export const rawHeight = (x: number, z: number): number => {
  const d = Math.hypot(x, z);
  // Rolling hills.
  let h = 14 + fbm(nBase, x * 0.0022, z * 0.0022, 5) * 34 + fbm(nDetail, x * 0.012, z * 0.012, 3) * 3;

  // Mountain ring at the edges.
  const edge = smoothstep(720, 1160, d);
  h += edge * (90 + ridged(nRidge, x * 0.0034, z * 0.0034, 5) * 330);

  // Hills rise toward the castle (behind it, north).
  const north = smoothstep(0, -500, z) * (1 - edge);
  h += north * 25 * (0.5 + 0.5 * fbm(nBase, x * 0.004 + 9, z * 0.004, 3));

  // Lake basin.
  const lm = lakeMetric(x, z);
  const lakeMask = 1 - smoothstep(0.78, 1.12, lm);
  h = lerp(h, -22 - (1 - lm) * 10, lakeMask);

  // Castle plateau with a steep cliff dropping to the lake.
  const pd = Math.hypot(x - WORLD.castleCenter.x, z - WORLD.castleCenter.z);
  const plateau = 1 - smoothstep(PLATEAU_R - 18, PLATEAU_R + 26, pd);
  const rock = fbm(nDetail, x * 0.03, z * 0.03, 2) * 2.2;
  h = lerp(h, WORLD.plateauHeight + rock, plateau);

  // Flatten the broom stadium and the standing stones.
  const sd = Math.hypot(x - WORLD.stadiumCenter.x, z - WORLD.stadiumCenter.z);
  h = lerp(h, 16, 1 - smoothstep(150, 230, sd));
  const st = Math.hypot(x - WORLD.stonesCenter.x, z - WORLD.stonesCenter.z);
  h = lerp(h, 34, 1 - smoothstep(45, 110, st));

  return h;
};

/** Terrain grid resolution: (SEG+1)² samples spanning the whole map. Rendering uses the same grid. */
export const TERRAIN_SEGMENTS = 240;
export const TERRAIN_SIZE = WORLD.half * 2;
const CELL = TERRAIN_SIZE / TERRAIN_SEGMENTS;
let grid: Float32Array | null = null;

/** Lazily computed height grid, row-major [iz * (SEG+1) + ix], from -half to +half. */
export const heightGrid = (): Float32Array => {
  if (grid) return grid;
  const n = TERRAIN_SEGMENTS + 1;
  grid = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) {
    const z = -WORLD.half + iz * CELL;
    for (let ix = 0; ix < n; ix++) grid[iz * n + ix] = rawHeight(-WORLD.half + ix * CELL, z);
  }
  return grid;
};

/** Fast bilinear terrain height (matches the rendered mesh closely). */
export const heightAt = (x: number, z: number): number => {
  const g = heightGrid();
  const n = TERRAIN_SEGMENTS + 1;
  const fx = Math.min(Math.max((x + WORLD.half) / CELL, 0), TERRAIN_SEGMENTS - 1e-4);
  const fz = Math.min(Math.max((z + WORLD.half) / CELL, 0), TERRAIN_SEGMENTS - 1e-4);
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const i = iz * n + ix;
  const a = g[i];
  const b = g[i + 1];
  const c = g[i + n];
  const d = g[i + n + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
};

/** Approximate surface normal via central differences. */
export const normalAt = (x: number, z: number, e = 2): { x: number; y: number; z: number } => {
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx;
  const ny = 2 * e;
  const nz = -hz;
  const l = Math.hypot(nx, ny, nz);
  return { x: nx / l, y: ny / l, z: nz / l };
};

export const isLake = (x: number, z: number): boolean => lakeMetric(x, z) < 0.95 && heightAt(x, z) < WORLD.waterLevel;

/** Ground or water surface, whichever is higher. */
export const surfaceAt = (x: number, z: number): number => Math.max(heightAt(x, z), WORLD.waterLevel);
