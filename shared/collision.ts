import { WORLD } from './config';
import { buildLayout, type Collider } from './layout';
import { heightAt } from './terrain';
import type { V3 } from './vec';

/** True if a point lies inside a collider (inflated by `pad`). */
export const pointInCollider = (c: Collider, x: number, y: number, z: number, pad = 0): boolean => {
  if (y < c.y0 - pad || y > c.y1 + pad) return false;
  const dx = x - c.x;
  const dz = z - c.z;
  if (c.kind === 'cyl') return dx * dx + dz * dz <= (c.r + pad) * (c.r + pad);
  const lx = dx * c.cos - dz * c.sin;
  const lz = dx * c.sin + dz * c.cos;
  return Math.abs(lx) <= c.hw + pad && Math.abs(lz) <= c.hd + pad;
};

export interface CollisionResult {
  hit: boolean;
  nx: number;
  ny: number;
  nz: number;
}

const tmp: CollisionResult = { hit: false, nx: 0, ny: 0, nz: 0 };

/**
 * Pushes a sphere (centre `p`, radius `r`) out of terrain, water ceiling/floor bounds and structures.
 * Mutates `p`. Returns the dominant contact normal (shared object — copy if you keep it).
 */
export const resolveSphere = (p: V3, r: number): CollisionResult => {
  tmp.hit = false;
  tmp.nx = 0;
  tmp.ny = 0;
  tmp.nz = 0;

  // Map bounds (soft walls).
  const lim = WORLD.half - 20;
  if (p.x > lim) { p.x = lim; tmp.hit = true; tmp.nx = -1; }
  if (p.x < -lim) { p.x = -lim; tmp.hit = true; tmp.nx = 1; }
  if (p.z > lim) { p.z = lim; tmp.hit = true; tmp.nz = -1; }
  if (p.z < -lim) { p.z = -lim; tmp.hit = true; tmp.nz = 1; }
  if (p.y > WORLD.maxAltitude) { p.y = WORLD.maxAltitude; tmp.hit = true; tmp.ny = -1; }

  // Terrain.
  const g = heightAt(p.x, p.z) + r;
  if (p.y < g) {
    p.y = g;
    tmp.hit = true;
    tmp.ny = 1;
  }

  // Structures.
  const { colliders } = buildLayout();
  for (const c of colliders) {
    if (p.y < c.y0 - r || p.y > c.y1 + r) continue;
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    if (c.kind === 'cyl') {
      const rr = c.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 1e-4;
      // Prefer pushing up if we're near the top surface.
      if (p.y > c.y1 - r * 0.6) {
        p.y = c.y1 + r;
        tmp.ny = 1;
      } else {
        p.x = c.x + (dx / d) * rr;
        p.z = c.z + (dz / d) * rr;
        tmp.nx = dx / d;
        tmp.nz = dz / d;
      }
      tmp.hit = true;
    } else {
      let lx = dx * c.cos - dz * c.sin;
      let lz = dx * c.sin + dz * c.cos;
      const ex = c.hw + r;
      const ez = c.hd + r;
      if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) continue;
      const penX = ex - Math.abs(lx);
      const penZ = ez - Math.abs(lz);
      const penY = c.y1 + r - p.y;
      let nlx = 0;
      let nlz = 0;
      if (penY < penX && penY < penZ) {
        p.y = c.y1 + r;
        tmp.ny = 1;
        tmp.hit = true;
        continue;
      }
      if (penX < penZ) {
        nlx = Math.sign(lx) || 1;
        lx = nlx * ex;
      } else {
        nlz = Math.sign(lz) || 1;
        lz = nlz * ez;
      }
      // Back to world space.
      p.x = c.x + lx * c.cos + lz * c.sin;
      p.z = c.z - lx * c.sin + lz * c.cos;
      tmp.nx = nlx * c.cos + nlz * c.sin;
      tmp.nz = -nlx * c.sin + nlz * c.cos;
      tmp.hit = true;
    }
  }
  return tmp;
};

/** True if a point is inside terrain or any structure. */
export const isSolid = (x: number, y: number, z: number): boolean => {
  if (y < heightAt(x, z)) return true;
  for (const c of buildLayout().colliders) if (pointInCollider(c, x, y, z)) return true;
  return false;
};

/**
 * Ray march against world geometry. Returns distance to first solid hit or `maxDist` if none.
 * Step size adapts to height above terrain for speed.
 */
export const raycastWorld = (o: V3, d: V3, maxDist: number, step = 1.5): number => {
  let t = 0;
  while (t < maxDist) {
    const x = o.x + d.x * t;
    const y = o.y + d.y * t;
    const z = o.z + d.z * t;
    if (isSolid(x, y, z)) return Math.max(0, t - step * 0.5);
    t += step;
  }
  return maxDist;
};

/** Line of sight between two points. */
export const hasLineOfSight = (a: V3, b: V3): boolean => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const L = Math.hypot(dx, dy, dz);
  if (L < 1) return true;
  const d = { x: dx / L, y: dy / L, z: dz / L };
  return raycastWorld(a, d, L - 1, 4) >= L - 1;
};

