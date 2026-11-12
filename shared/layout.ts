import { WORLD } from './config';
import { heightAt } from './terrain';
import { mulberry32, range } from './rng';

/**
 * Data-driven layout of every landmark (castle, bridge, broom stadium, standing stones).
 * The client turns this into meshes; client + server derive colliders from it.
 */

export type RoofKind = 'cone' | 'pyramid' | 'flat' | 'none';
export type Material = 'stone' | 'wood' | 'rock';

export interface TowerDef {
  x: number;
  z: number;
  base: number;
  r: number;
  h: number;
  roof: RoofKind;
  roofH: number;
  crenel: boolean;
  windows: boolean;
  material: Material;
}

export interface BlockDef {
  x: number;
  z: number;
  base: number;
  w: number; // along local X
  d: number; // along local Z
  h: number;
  rot: number; // yaw (radians)
  roof: RoofKind | 'gable';
  roofH: number;
  crenel: boolean;
  windows: boolean;
  material: Material;
}

export interface HoopDef {
  x: number;
  y: number;
  z: number;
  r: number;
  rot: number;
}

export interface CylCollider {
  kind: 'cyl';
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
}

export interface BoxCollider {
  kind: 'box';
  x: number;
  z: number;
  hw: number;
  hd: number;
  y0: number;
  y1: number;
  cos: number;
  sin: number;
}

export type Collider = CylCollider | BoxCollider;

export interface Layout {
  towers: TowerDef[];
  blocks: BlockDef[];
  hoops: HoopDef[];
  colliders: Collider[];
  /** Interesting points (loot / spawn hints). */
  pois: { x: number; y: number; z: number }[];
}

const groundMin = (x: number, z: number, rad: number): number =>
  Math.min(
    heightAt(x, z),
    heightAt(x + rad, z),
    heightAt(x - rad, z),
    heightAt(x, z + rad),
    heightAt(x, z - rad),
  );

const tower = (
  x: number,
  z: number,
  r: number,
  h: number,
  roof: RoofKind = 'cone',
  roofH = r * 2.6,
  extra: Partial<TowerDef> = {},
): TowerDef => {
  const base = groundMin(x, z, r) - 8;
  return { x, z, base, r, h: h + 8, roof, roofH, crenel: roof === 'flat', windows: true, material: 'stone', ...extra };
};

const block = (
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  rot: number,
  roof: BlockDef['roof'],
  roofH: number,
  extra: Partial<BlockDef> = {},
): BlockDef => {
  const base = groundMin(x, z, Math.max(w, d) * 0.5) - 8;
  return { x, z, base, w, d, h: h + 8, rot, roof, roofH, crenel: false, windows: true, material: 'stone', ...extra };
};

/** A wall connecting two points. */
const wall = (ax: number, az: number, bx: number, bz: number, h: number, thick = 7): BlockDef => {
  const len = Math.hypot(bx - ax, bz - az);
  const rot = Math.atan2(-(bz - az), bx - ax);
  return block((ax + bx) / 2, (az + bz) / 2, len, thick, h, rot, 'none', 0, { crenel: true, windows: false });
};

let cached: Layout | null = null;

export const buildLayout = (): Layout => {
  if (cached) return cached;
  const rng = mulberry32(WORLD.seed + 404);
  const towers: TowerDef[] = [];
  const blocks: BlockDef[] = [];
  const hoops: HoopDef[] = [];
  const pois: Layout['pois'] = [];

  // ---------- Castle (main ring) ----------
  const ring: [number, number, number, number][] = [
    // x, z, radius, height
    [-80, -60, 9, 80],
    [60, -50, 12, 128], // astronomy tower — tallest
    [95, -140, 10, 76],
    [40, -208, 11, 62], // gatehouse
    [-55, -202, 9, 70],
  ];
  for (const [x, z, r, h] of ring) towers.push(tower(x, z, r, h));

  // Clock tower (square)
  blocks.push(block(-112, -130, 20, 20, 88, 0, 'pyramid', 28));

  // Curtain walls
  const ringPts: [number, number][] = [
    [60, -50],
    [95, -140],
    [40, -208],
    [-55, -202],
    [-112, -130],
    [-80, -60],
  ];
  for (let i = 0; i < ringPts.length - 1; i++) {
    const [ax, az] = ringPts[i];
    const [bx, bz] = ringPts[i + 1];
    blocks.push(wall(ax, az, bx, bz, 26));
  }

  // Great hall facing the lake + inner buildings
  blocks.push(block(-10, -42, 84, 30, 36, 0, 'gable', 20));
  blocks.push(block(22, -122, 52, 22, 30, 0.32, 'gable', 16));
  blocks.push(block(-42, -112, 26, 42, 42, 0, 'gable', 15));
  blocks.push(block(55, -170, 30, 20, 34, -0.5, 'gable', 12));

  // Slender spires
  towers.push(tower(-32, -58, 5, 96, 'cone', 26));
  towers.push(tower(14, -76, 6, 104, 'cone', 30));
  towers.push(tower(72, -100, 5, 86, 'cone', 22));
  towers.push(tower(-72, -160, 6, 80, 'cone', 20));
  towers.push(tower(-5, -165, 7, 70, 'cone', 22));

  // Cliff-edge watchtowers
  towers.push(tower(-150, -30, 6, 42, 'flat', 0));
  towers.push(tower(132, -22, 6, 46, 'cone', 16));
  towers.push(tower(150, -205, 7, 50, 'flat', 0));
  towers.push(tower(-152, -235, 6, 46, 'cone', 16));

  // ---------- Covered bridge to the western tower ----------
  const bx0 = -122;
  const bz0 = -132;
  const bx1 = -272;
  const bz1 = -152;
  const deck = WORLD.plateauHeight + 14;
  towers.push(tower(bx1, bz1, 10, deck - groundMin(bx1, bz1, 10) + 30, 'cone', 26));
  const blen = Math.hypot(bx1 - bx0, bz1 - bz0);
  const brot = Math.atan2(-(bz1 - bz0), bx1 - bx0);
  blocks.push({
    x: (bx0 + bx1) / 2,
    z: (bz0 + bz1) / 2,
    base: deck,
    w: blen,
    d: 7,
    h: 8,
    rot: brot,
    roof: 'gable',
    roofH: 4,
    crenel: false,
    windows: false,
    material: 'stone',
  });
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    const px = bx0 + (bx1 - bx0) * t;
    const pz = bz0 + (bz1 - bz0) * t;
    const g = groundMin(px, pz, 3) - 6;
    towers.push({ x: px, z: pz, base: g, r: 3.2, h: deck - g, roof: 'none', roofH: 0, crenel: false, windows: false, material: 'stone' });
  }
  pois.push({ x: (bx0 + bx1) / 2, y: deck + 14, z: (bz0 + bz1) / 2 });

  // ---------- Broom stadium ----------
  const S = WORLD.stadiumCenter;
  const sg = 16;
  const RX = 125;
  const RZ = 72;
  const standCount = 18;
  for (let i = 0; i < standCount; i++) {
    const a = (i / standCount) * Math.PI * 2;
    const x = S.x + Math.cos(a) * RX;
    const z = S.z + Math.sin(a) * RZ;
    // Tangent direction for the stand.
    const tx = -Math.sin(a) * RX;
    const tz = Math.cos(a) * RZ;
    const rot = Math.atan2(-tz, tx);
    blocks.push({
      x, z, base: sg + 6, w: 34, d: 9, h: 10, rot,
      roof: 'none', roofH: 0, crenel: false, windows: false, material: 'wood',
    });
    if (i % 3 === 0) {
      towers.push({
        x: S.x + Math.cos(a) * (RX + 8), z: S.z + Math.sin(a) * (RZ + 8), base: sg - 4, r: 4, h: 32,
        roof: 'cone', roofH: 12, crenel: false, windows: false, material: 'wood',
      });
    }
  }
  for (const side of [-1, 1]) {
    for (const [dz, ph] of [[-14, 32], [0, 44], [14, 32]] as const) {
      const x = S.x + side * 96;
      const z = S.z + dz;
      towers.push({ x, z, base: sg - 2, r: 0.55, h: ph, roof: 'none', roofH: 0, crenel: false, windows: false, material: 'wood' });
      hoops.push({ x, y: sg - 2 + ph + 4.4, z, r: 4.2, rot: Math.PI / 2 });
    }
  }
  pois.push({ x: S.x, y: sg + 30, z: S.z });

  // ---------- Standing stones ----------
  const St = WORLD.stonesCenter;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const x = St.x + Math.cos(a) * 30;
    const z = St.z + Math.sin(a) * 30;
    blocks.push({
      x, z, base: heightAt(x, z) - 3, w: 3.4, d: 2.2, h: range(rng, 8, 12), rot: -a + Math.PI / 2,
      roof: 'none', roofH: 0, crenel: false, windows: false, material: 'rock',
    });
  }
  pois.push({ x: St.x, y: 44, z: St.z });
  pois.push({ x: WORLD.castleCenter.x, y: WORLD.plateauHeight + 40, z: WORLD.castleCenter.z });
  pois.push({ x: 60, y: WORLD.plateauHeight + 150, z: -50 });

  // ---------- Colliders ----------
  const colliders: Collider[] = [];
  for (const t of towers) {
    colliders.push({ kind: 'cyl', x: t.x, z: t.z, r: t.r + 0.4, y0: t.base, y1: t.base + t.h + t.roofH * 0.55 });
  }
  for (const b of blocks) {
    colliders.push({
      kind: 'box',
      x: b.x,
      z: b.z,
      hw: b.w / 2 + 0.3,
      hd: b.d / 2 + 0.3,
      y0: b.base,
      y1: b.base + b.h + b.roofH * 0.6,
      cos: Math.cos(b.rot),
      sin: Math.sin(b.rot),
    });
  }

  cached = { towers, blocks, hoops, colliders, pois };
  return cached;
};

