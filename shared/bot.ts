import { PLAYER, SPELLS, WORLD, type SpellId } from './config';
import { isSolid } from './collision';
import { buildLayout } from './layout';
import { range, type Rng } from './rng';
import { heightAt } from './terrain';
import { clamp, wrapAngle, yawPitchFromDir } from './vec';
import type { Entity, Sim } from './sim';

export interface BotBrain {
  skill: number; // 0..1 aim + reaction quality
  target: number;
  retarget: number;
  goal: { x: number; y: number; z: number } | null;
  strafeDir: number;
  strafeTimer: number;
  shieldTimer: number;
  preferredRange: number;
  aggression: number;
  aimErr: { x: number; y: number; z: number };
  aimErrTimer: number;
}

export const createBrain = (rng: Rng, baseSkill: number): BotBrain => ({
  skill: clamp(baseSkill + range(rng, -0.25, 0.2), 0.1, 1),
  target: -1,
  retarget: 0,
  goal: null,
  strafeDir: rng() < 0.5 ? -1 : 1,
  strafeTimer: range(rng, 1, 3),
  shieldTimer: 0,
  preferredRange: range(rng, 55, 140),
  aggression: range(rng, 0.3, 1),
  aimErr: { x: 0, y: 0, z: 0 },
  aimErrTimer: 0,
});

const SIGHT = 300;

/** Decide inputs (and casts) for a bot. Called ~10 Hz. */
export const thinkBot = (sim: Sim, e: Entity, dt: number): void => {
  const b = e.brain!;
  const f = e.flight;
  const p = f.pos;
  const rng = sim.rng;
  const zone = sim.zone;

  b.retarget -= dt;
  b.strafeTimer -= dt;
  b.aimErrTimer -= dt;
  if (b.shieldTimer > 0) b.shieldTimer -= dt;
  if (b.strafeTimer <= 0) {
    b.strafeDir = -b.strafeDir;
    b.strafeTimer = range(rng, 0.8, 2.6);
  }
  if (b.aimErrTimer <= 0) {
    const m = (1 - b.skill) * 9 + 1;
    b.aimErr = { x: range(rng, -m, m), y: range(rng, -m, m) * 0.6, z: range(rng, -m, m) };
    b.aimErrTimer = range(rng, 0.4, 1.2);
  }

  // ----- Target acquisition
  let target = b.target >= 0 ? sim.entities.get(b.target) : undefined;
  if (!target || !target.alive) {
    target = undefined;
    b.target = -1;
  }
  if (b.retarget <= 0) {
    b.retarget = range(rng, 0.6, 1.4);
    let best: Entity | undefined;
    let bestD = SIGHT * (0.6 + b.aggression * 0.6);
    for (const o of sim.entities.values()) {
      if (!o.alive || o.id === e.id) continue;
      const d = Math.hypot(o.flight.pos.x - p.x, o.flight.pos.y - p.y, o.flight.pos.z - p.z);
      // Retaliate against whoever hurt us recently.
      const bias = o.id === e.lastAttacker && sim.time - e.lastDamagedAt < 4 ? 0.5 : 1;
      if (d * bias < bestD && sim.canSee(e, o)) {
        bestD = d * bias;
        best = o;
      }
    }
    target = best;
    b.target = best ? best.id : -1;
  }

  // ----- Goal selection
  const zd = Math.hypot(p.x - zone.cx, p.z - zone.cz);
  const outside = zd > zone.r - 25;
  const nextOutside = Math.hypot(p.x - zone.nextCx, p.z - zone.nextCz) > zone.nextR - 10;
  let goal = b.goal;
  if (outside || (zone.shrinking && nextOutside)) {
    const tx = outside ? zone.cx : zone.nextCx;
    const tz = outside ? zone.cz : zone.nextCz;
    goal = { x: tx, y: Math.max(heightAt(tx, tz) + 60, 120), z: tz };
  } else if (!target) {
    if (!goal || Math.hypot(goal.x - p.x, goal.y - p.y, goal.z - p.z) < 15) {
      goal = pickWanderGoal(sim, e);
    }
  }
  b.goal = goal;

  // ----- Low HP: look for healing
  if (e.hp < 45 && (!target || rng() < 0.3)) {
    let bestL: { x: number; y: number; z: number } | null = null;
    let bd = 260;
    for (const l of sim.loot) {
      if (l.taken || l.type !== 'heal') continue;
      const d = Math.hypot(l.x - p.x, l.y - p.y, l.z - p.z);
      if (d < bd && Math.hypot(l.x - zone.cx, l.z - zone.cz) < zone.r) {
        bd = d;
        bestL = l;
      }
    }
    if (bestL) b.goal = goal = { x: bestL.x, y: bestL.y, z: bestL.z };
  }

  const inp = e.input;
  inp.boost = false;
  inp.vertical = 0;
  inp.strafe = 0;

  let desiredYaw = f.yaw;
  let desiredPitch = 0;

  if (target && !(outside && zd > zone.r + 20)) {
    const tp = target.flight.pos;
    const tv = target.flight.vel;
    const dx = tp.x - p.x;
    const dy = tp.y - p.y;
    const dz = tp.z - p.z;
    const dist = Math.hypot(dx, dy, dz);

    // Spell choice
    let spell: SpellId = 'fire';
    if (e.mana > 55 && dist < SPELLS.lightning.range * 0.9 && rng() < 0.25 + b.skill * 0.2) spell = 'lightning';
    else if (dist > 170 || rng() < 0.35) spell = 'ice';
    const def = SPELLS[spell];
    const lead = def.speed > 0 ? dist / def.speed : 0;
    const ax = tp.x + tv.x * lead * b.skill + b.aimErr.x - p.x;
    const ay = tp.y + tv.y * lead * b.skill + b.aimErr.y - p.y;
    const az = tp.z + tv.z * lead * b.skill + b.aimErr.z - p.z;
    const aim = yawPitchFromDir({ x: ax, y: ay, z: az });
    desiredYaw = aim.yaw;
    desiredPitch = aim.pitch;

    // Range keeping + strafing
    const pr = b.preferredRange;
    inp.forward = dist > pr + 25 ? 1 : dist < pr - 25 ? -0.5 : 0.15;
    inp.strafe = b.strafeDir * (0.5 + b.skill * 0.5);
    inp.vertical = Math.sin(sim.time * 0.7 + e.id) * 0.4;
    inp.boost = dist > 260 && f.stamina > 50;

    // Fire when roughly aligned.
    const yawErr = Math.abs(wrapAngle(aim.yaw - f.yaw));
    const pitchErr = Math.abs(aim.pitch - f.pitch);
    const ready = sim.time >= e.cdUntil[spell] && e.mana >= def.mana;
    const fireChance = 0.35 + b.skill * 0.5;
    if (ready && yawErr < 0.22 && pitchErr < 0.22 && dist < def.range * 0.95 && rng() < fireChance && b.shieldTimer <= 0) {
      const dir = { x: ax / Math.hypot(ax, ay, az), y: ay / Math.hypot(ax, ay, az), z: az / Math.hypot(ax, ay, az) };
      const origin = { x: p.x + dir.x * 2.2, y: p.y + 0.8 + dir.y * 2.2, z: p.z + dir.z * 2.2 };
      sim.requestCast(e.id, spell, origin, dir);
    }

    // Defensive shield
    if (sim.time - e.lastDamagedAt < 0.5 && e.mana > 35 && rng() < 0.15 + b.skill * 0.2) b.shieldTimer = range(rng, 0.8, 1.6);
  } else if (goal) {
    const gx = goal.x - p.x;
    const gy = goal.y - p.y;
    const gz = goal.z - p.z;
    const aim = yawPitchFromDir({ x: gx, y: gy, z: gz });
    desiredYaw = aim.yaw;
    desiredPitch = clamp(aim.pitch, -0.6, 0.6);
    inp.forward = 1;
    inp.boost = Math.hypot(gx, gz) > 250 && f.stamina > 40;
  }
  e.shielding = b.shieldTimer > 0 && e.mana > 1;

  // ----- Obstacle & terrain avoidance (look ahead along velocity).
  const speed = Math.hypot(f.vel.x, f.vel.y, f.vel.z);
  const look = Math.max(18, speed * 1.4);
  const vx = speed > 1 ? f.vel.x / speed : -Math.sin(f.yaw);
  const vz = speed > 1 ? f.vel.z / speed : -Math.cos(f.yaw);
  const vy = speed > 1 ? f.vel.y / speed : 0;
  let danger = false;
  for (const s of [0.4, 0.75, 1]) {
    const x = p.x + vx * look * s;
    const y = p.y + vy * look * s;
    const z = p.z + vz * look * s;
    if (isSolid(x, y - 4, z) || y < heightAt(x, z) + 12) {
      danger = true;
      break;
    }
  }
  const ground = heightAt(p.x, p.z);
  const minAlt = Math.max(ground, WORLD.waterLevel) + 14;
  if (danger || p.y < minAlt) {
    inp.vertical = 1;
    desiredPitch = Math.max(desiredPitch, 0.45);
    if (danger && speed > PLAYER.cruiseSpeed * 0.6) inp.forward = Math.min(inp.forward, 0.3);
  }
  if (p.y > 300) desiredPitch = Math.min(desiredPitch, -0.15);

  // Rate-limited turning, better bots turn faster.
  const turn = (1.6 + b.skill * 2.2) * dt;
  inp.aimYaw = f.yaw + clamp(wrapAngle(desiredYaw - f.yaw), -turn, turn);
  inp.aimPitch = f.pitch + clamp(desiredPitch - f.pitch, -turn, turn);
};

const pickWanderGoal = (sim: Sim, e: Entity): { x: number; y: number; z: number } => {
  const rng = sim.rng;
  const z = sim.zone;
  // Prefer nearby loot inside the zone, else a POI, else random point in zone.
  const r = rng();
  if (r < 0.55) {
    const options = sim.loot.filter((l) => !l.taken && Math.hypot(l.x - z.cx, l.z - z.cz) < z.r * 0.9);
    if (options.length) {
      const p = e.flight.pos;
      options.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      const l = options[Math.floor(rng() * Math.min(4, options.length))];
      return { x: l.x, y: l.y, z: l.z };
    }
  }
  if (r < 0.75) {
    const pois = buildLayout().pois.filter((q) => Math.hypot(q.x - z.cx, q.z - z.cz) < z.r);
    if (pois.length) {
      const q = pois[Math.floor(rng() * pois.length)];
      return { ...q };
    }
  }
  const a = rng() * Math.PI * 2;
  const d = Math.sqrt(rng()) * Math.max(30, z.r * 0.8);
  const x = z.cx + Math.cos(a) * d;
  const zz = z.cz + Math.sin(a) * d;
  return { x, y: Math.max(heightAt(x, zz), WORLD.waterLevel) + range(rng, 30, 110), z: zz };
};

