import { describe, expect, it } from 'vitest';
import { planZone, zoneAt, DEFAULT_PHASES } from '../shared/zone';
import { createFlight, emptyInput, stepFlight, crashDamage } from '../shared/flight';
import { heightAt, rawHeight } from '../shared/terrain';
import { buildLayout } from '../shared/layout';
import { pointInCollider, resolveSphere } from '../shared/collision';
import { Sim } from '../shared/sim';
import { dirFromYawPitch, yawPitchFromDir, segmentSphere, wrapAngle } from '../shared/vec';
import { PLAYER, WORLD } from '../shared/config';

describe('vec', () => {
  it('yaw/pitch round-trips', () => {
    for (const [y, p] of [[0, 0], [1, 0.3], [-2.5, -0.7], [3, 1.2]]) {
      const r = yawPitchFromDir(dirFromYawPitch(y, p));
      expect(wrapAngle(r.yaw - y)).toBeCloseTo(0, 5);
      expect(r.pitch).toBeCloseTo(p, 5);
    }
  });
  it('yaw 0 faces -Z', () => {
    const d = dirFromYawPitch(0, 0);
    expect(d.z).toBeCloseTo(-1);
  });
  it('segment-sphere detects hits and misses', () => {
    const c = { x: 0, y: 0, z: -10 };
    expect(segmentSphere({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -20 }, c, 1)).toBeCloseTo(9 / 20, 5);
    expect(segmentSphere({ x: 5, y: 0, z: 0 }, { x: 5, y: 0, z: -20 }, c, 1)).toBe(-1);
  });
});

describe('zone', () => {
  const plan = planZone(42);
  it('every next circle is contained in the previous one', () => {
    let cx = plan.start.x;
    let cz = plan.start.z;
    let r = plan.startRadius;
    plan.phases.forEach((p, i) => {
      const c = plan.centers[i];
      expect(Math.hypot(c.x - cx, c.z - cz) + p.radius).toBeLessThanOrEqual(r + 1e-6);
      cx = c.x;
      cz = c.z;
      r = p.radius;
    });
  });
  it('radius never grows over time and ends at 0', () => {
    let last = Infinity;
    for (let t = 0; t < 600; t += 1) {
      const z = zoneAt(plan, t);
      expect(z.r).toBeLessThanOrEqual(last + 1e-6);
      last = z.r;
    }
    expect(zoneAt(plan, 10_000).r).toBe(0);
    expect(zoneAt(plan, 10_000).finished).toBe(true);
  });
  it('is deterministic per seed', () => {
    expect(planZone(7).centers).toEqual(planZone(7).centers);
    expect(DEFAULT_PHASES.length).toBeGreaterThan(3);
  });
});

describe('terrain', () => {
  it('castle plateau sits high, lake is below water', () => {
    expect(heightAt(WORLD.castleCenter.x, WORLD.castleCenter.z)).toBeGreaterThan(60);
    expect(heightAt(WORLD.lakeCenter.x, WORLD.lakeCenter.z)).toBeLessThan(WORLD.waterLevel);
  });
  it('grid sampling approximates the raw function', () => {
    for (const [x, z] of [[100, 100], [-300, 420], [512, -640]]) {
      expect(Math.abs(heightAt(x, z) - rawHeight(x, z))).toBeLessThan(6);
    }
  });
});

describe('layout & collision', () => {
  const layout = buildLayout();
  it('builds a substantial castle', () => {
    expect(layout.towers.length).toBeGreaterThan(15);
    expect(layout.blocks.length).toBeGreaterThan(20);
    expect(layout.colliders.length).toBe(layout.towers.length + layout.blocks.length);
  });
  it('pushes spheres out of towers', () => {
    const t = layout.towers[1];
    const p = { x: t.x + 0.5, y: t.base + t.h * 0.5, z: t.z };
    resolveSphere(p, PLAYER.radius);
    expect(Math.hypot(p.x - t.x, p.z - t.z)).toBeGreaterThanOrEqual(t.r);
  });
  it('rotated box colliders contain their centre and exclude far points', () => {
    const c = layout.colliders.find((k) => k.kind === 'box')!;
    expect(pointInCollider(c, c.x, (c.y0 + c.y1) / 2, c.z)).toBe(true);
    expect(pointInCollider(c, c.x + 500, (c.y0 + c.y1) / 2, c.z)).toBe(false);
  });
});

describe('flight', () => {
  it('accelerates forward along aim direction', () => {
    const s = createFlight({ x: 0, y: 250, z: 400 }, 0);
    const inp = { ...emptyInput(), forward: 1 };
    for (let i = 0; i < 120; i++) stepFlight(s, inp, 1 / 60);
    expect(s.pos.z).toBeLessThan(400 - 20);
    expect(Math.hypot(s.vel.x, s.vel.y, s.vel.z)).toBeGreaterThan(PLAYER.cruiseSpeed * 0.8);
  });
  it('cannot go through the ground and reports impact', () => {
    const g = heightAt(300, 300);
    const s = createFlight({ x: 300, y: g + 5, z: 300 }, 0);
    s.vel = { x: 0, y: -80, z: 0 };
    const impact = stepFlight(s, { ...emptyInput(), aimPitch: -1.4, forward: 1 }, 0.2);
    expect(s.pos.y).toBeGreaterThanOrEqual(g);
    expect(impact).toBeGreaterThan(0);
    expect(crashDamage(80)).toBeGreaterThan(0);
    expect(crashDamage(10)).toBe(0);
  });
  it('boost drains stamina', () => {
    const s = createFlight({ x: 0, y: 300, z: 0 });
    for (let i = 0; i < 60; i++) stepFlight(s, { ...emptyInput(), forward: 1, boost: true }, 1 / 30);
    expect(s.stamina).toBeLessThan(PLAYER.maxStamina);
  });
});

describe('sim', () => {
  it('a bots-only match produces exactly one winner', () => {
    const sim = new Sim({ seed: 99, botSkill: 0.8 });
    sim.fillWithBots(10);
    sim.start();
    const dt = 1 / 30;
    let deaths = 0;
    let winEvents = 0;
    for (let i = 0; i < 30 * 700 && sim.phase !== 'ended'; i++) {
      sim.step(dt);
      for (const ev of sim.drainEvents()) {
        if (ev.k === 'death') deaths++;
        if (ev.k === 'win') winEvents++;
      }
    }
    expect(sim.phase).toBe('ended');
    expect(winEvents).toBe(1);
    expect(deaths).toBe(9);
    expect(sim.aliveCount()).toBe(1);
  }, 60_000);

  it('validates casts (mana, cooldown, origin)', () => {
    const sim = new Sim({ seed: 1 });
    const a = sim.addEntity('A', false);
    sim.addEntity('B', false);
    sim.start();
    for (let i = 0; i < 400; i++) sim.step(1 / 60);
    expect(sim.phase).toBe('playing');
    const o = { ...a.flight.pos };
    expect(sim.requestCast(a.id, 'fire', o, { x: 0, y: 0, z: -1 })).toBe(true);
    expect(sim.requestCast(a.id, 'fire', o, { x: 0, y: 0, z: -1 })).toBe(false); // cooldown
    expect(sim.requestCast(a.id, 'ice', { x: o.x + 100, y: o.y, z: o.z }, { x: 0, y: 0, z: -1 })).toBe(false); // too far
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.k === 'proj')).toBe(true);
  });

  it('packs entities compactly', () => {
    const sim = new Sim({ seed: 3 });
    sim.fillWithBots(4);
    const packed = sim.pack();
    expect(packed).toHaveLength(4);
    expect(packed[0]).toHaveLength(9);
  });
});

