import { WORLD } from './config';
import { mulberry32 } from './rng';

export interface ZonePhase {
  wait: number; // seconds holding the current circle
  shrink: number; // seconds to shrink to the next circle
  radius: number; // target radius
  dps: number; // damage per second outside during this phase
}

export interface ZonePlan {
  phases: ZonePhase[];
  centers: { x: number; z: number }[]; // centers[i] is the target of phase i; centers[-1] implicit start
  startRadius: number;
  start: { x: number; z: number };
}

export interface ZoneState {
  cx: number;
  cz: number;
  r: number;
  nextCx: number;
  nextCz: number;
  nextR: number;
  phase: number;
  shrinking: boolean;
  timeLeft: number; // seconds until the next state change
  dps: number;
  finished: boolean;
}

export const DEFAULT_PHASES: ZonePhase[] = [
  { wait: 50, shrink: 40, radius: 720, dps: 1 },
  { wait: 35, shrink: 35, radius: 440, dps: 2 },
  { wait: 30, shrink: 30, radius: 250, dps: 4 },
  { wait: 25, shrink: 25, radius: 125, dps: 7 },
  { wait: 20, shrink: 20, radius: 50, dps: 10 },
  { wait: 15, shrink: 25, radius: 0, dps: 16 },
];

/** Deterministically plan the zone: each next circle lies entirely inside the previous one. */
export const planZone = (seed: number, phases: ZonePhase[] = DEFAULT_PHASES): ZonePlan => {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const startRadius = WORLD.half * 1.05;
  const start = { x: 0, z: 0 };
  const centers: { x: number; z: number }[] = [];
  let cx = start.x;
  let cz = start.z;
  let r = startRadius;
  for (let i = 0; i < phases.length; i++) {
    const nr = phases[i].radius;
    // Keep the playable circle away from the extreme mountain edge on the first shrink.
    const maxOff = Math.max(0, Math.min(r - nr, i === 0 ? 300 : r - nr));
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * maxOff;
    cx += Math.cos(a) * d;
    cz += Math.sin(a) * d;
    centers.push({ x: cx, z: cz });
    r = nr;
  }
  return { phases, centers, startRadius, start };
};

/** Pure function: zone at time `t` (seconds since match start). */
export const zoneAt = (plan: ZonePlan, t: number): ZoneState => {
  let cx = plan.start.x;
  let cz = plan.start.z;
  let r = plan.startRadius;
  let time = Math.max(0, t);
  for (let i = 0; i < plan.phases.length; i++) {
    const p = plan.phases[i];
    const n = plan.centers[i];
    if (time < p.wait) {
      return { cx, cz, r, nextCx: n.x, nextCz: n.z, nextR: p.radius, phase: i, shrinking: false, timeLeft: p.wait - time, dps: p.dps, finished: false };
    }
    time -= p.wait;
    if (time < p.shrink) {
      const k = time / p.shrink;
      return {
        cx: cx + (n.x - cx) * k,
        cz: cz + (n.z - cz) * k,
        r: r + (p.radius - r) * k,
        nextCx: n.x,
        nextCz: n.z,
        nextR: p.radius,
        phase: i,
        shrinking: true,
        timeLeft: p.shrink - time,
        dps: p.dps,
        finished: false,
      };
    }
    time -= p.shrink;
    cx = n.x;
    cz = n.z;
    r = p.radius;
  }
  const last = plan.phases[plan.phases.length - 1];
  return { cx, cz, r, nextCx: cx, nextCz: cz, nextR: r, phase: plan.phases.length, shrinking: false, timeLeft: 0, dps: last.dps * 1.5, finished: true };
};

export const isOutside = (z: ZoneState, x: number, zz: number): boolean => Math.hypot(x - z.cx, zz - z.cz) > z.r;

