import { BOT_FIRST, BOT_LAST, HOUSES, LOOT, MATCH, PLAYER, SPELLS, SPELL_ORDER, WORLD, type LootType, type SpellId } from './config';
import { hasLineOfSight, isSolid, raycastWorld } from './collision';
import { createFlight, emptyInput, stepFlight, crashDamage, type FlightInput, type FlightState } from './flight';
import { buildLayout } from './layout';
import { mulberry32, pick, range, type Rng } from './rng';
import { heightAt } from './terrain';
import { clamp, norm, segmentSphere, type V3 } from './vec';
import { planZone, zoneAt, type ZonePlan, type ZoneState } from './zone';
import type { EntityInfo, LootInfo, MatchPhase, PackedEntity, SimEvent, YouState } from './protocol';
import { createBrain, thinkBot, type BotBrain } from './bot';

export interface Entity {
  id: number;
  name: string;
  house: number;
  isBot: boolean;
  alive: boolean;
  hp: number;
  mana: number;
  flight: FlightState;
  input: FlightInput;
  shielding: boolean;
  slowUntil: number;
  overchargeUntil: number;
  cdUntil: Record<SpellId, number>;
  kills: number;
  placement: number;
  zoneAcc: number;
  lastDamagedAt: number;
  lastAttacker: number;
  brain: BotBrain | null;
}

export interface Projectile {
  id: number;
  owner: number;
  spell: SpellId;
  pos: V3;
  vel: V3;
  life: number;
}

export interface Loot extends LootInfo {
  taken: boolean;
}

export interface SimOptions {
  seed?: number;
  botSkill?: number; // 0..1
}

const MAX_CAST_OFFSET = 8;

export class Sim {
  readonly seed: number;
  readonly rng: Rng;
  readonly zonePlan: ZonePlan;
  readonly botSkill: number;
  phase: MatchPhase = 'lobby';
  time = 0; // seconds since 'playing'
  countdown: number = MATCH.countdown;
  zone: ZoneState;
  entities = new Map<number, Entity>();
  projectiles: Projectile[] = [];
  loot: Loot[] = [];
  winner = -1;
  private nextId = 1;
  private nextProjId = 1;
  private events: SimEvent[] = [];
  private botTick = 0;

  constructor(opts: SimOptions = {}) {
    this.seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.botSkill = clamp(opts.botSkill ?? 0.6, 0, 1);
    this.rng = mulberry32(this.seed);
    this.zonePlan = planZone(this.seed);
    this.zone = zoneAt(this.zonePlan, 0);
    this.spawnLoot();
  }

  // ---------------------------------------------------------------- setup

  addEntity(name: string, isBot: boolean, house = Math.floor(this.rng() * HOUSES.length)): Entity {
    const id = this.nextId++;
    const e: Entity = {
      id,
      name,
      house,
      isBot,
      alive: true,
      hp: PLAYER.maxHp,
      mana: PLAYER.maxMana,
      flight: createFlight({ x: 0, y: 200, z: 0 }),
      input: emptyInput(),
      shielding: false,
      slowUntil: 0,
      overchargeUntil: 0,
      cdUntil: { fire: 0, ice: 0, lightning: 0, shield: 0 },
      kills: 0,
      placement: 0,
      zoneAcc: 0,
      lastDamagedAt: -99,
      lastAttacker: -1,
      brain: isBot ? createBrain(this.rng, this.botSkill) : null,
    };
    this.entities.set(id, e);
    return e;
  }

  removeEntity(id: number): void {
    const e = this.entities.get(id);
    if (!e) return;
    if (e.alive && this.phase === 'playing') this.kill(e, -1, 'zone');
    this.entities.delete(id);
  }

  fillWithBots(total: number): void {
    const used = new Set([...this.entities.values()].map((e) => e.name));
    while (this.entities.size < total) {
      let name = `${pick(this.rng, BOT_FIRST)} ${pick(this.rng, BOT_LAST)}`;
      for (let i = 0; used.has(name) && i < 10; i++) name = `${pick(this.rng, BOT_FIRST)} ${pick(this.rng, BOT_LAST)}`;
      used.add(name);
      this.addEntity(name, true);
    }
  }

  /** Place everyone on a high ring around the castle and begin the countdown. */
  start(): void {
    const list = [...this.entities.values()];
    const n = list.length;
    const offset = this.rng() * Math.PI * 2;
    list.forEach((e, i) => {
      if (i === 0 && !e.isBot) {
        const x = -18;
        const z = 140;
        const y = WORLD.plateauHeight + 46;
        const yaw = 0;
        e.flight = createFlight({ x, y, z }, yaw);
        e.input = { ...emptyInput(), aimYaw: yaw };
      } else {
        const a = offset + (i / n) * Math.PI * 2 + range(this.rng, -0.08, 0.08);
        const R = range(this.rng, 250, 480);
        const x = WORLD.castleCenter.x + Math.sin(a) * R;
        const z = WORLD.castleCenter.z + Math.cos(a) * R;
        const y = Math.max(heightAt(x, z) + 42, WORLD.plateauHeight + 48 + range(this.rng, -15, 30));
        const yaw = Math.atan2(x - WORLD.castleCenter.x, z - WORLD.castleCenter.z);
        e.flight = createFlight({ x, y, z }, yaw);
        e.input = { ...emptyInput(), aimYaw: yaw };
      }
      e.alive = true;
      e.hp = PLAYER.maxHp;
      e.mana = PLAYER.maxMana;
      e.kills = 0;
      e.placement = 0;
    });
    this.phase = 'countdown';
    this.countdown = MATCH.countdown;
    this.time = 0;
  }

  private spawnLoot(): void {
    const rng = mulberry32(this.seed + 77);
    const layout = buildLayout();
    const types: LootType[] = ['heal', 'heal', 'mana', 'mana', 'overcharge'];
    const add = (x: number, y: number, z: number): void => {
      this.loot.push({ id: this.loot.length + 1, type: pick(rng, types), x, y, z, taken: false });
    };
    // Rooftops of tall towers.
    for (const t of layout.towers) {
      if (t.r >= 6 && t.windows && rng() < 0.55) add(t.x, t.base + t.h + t.roofH + 4, t.z);
    }
    for (const p of layout.pois) add(p.x, p.y, p.z);
    while (this.loot.length < LOOT.count) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * 900;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const g = Math.max(heightAt(x, z), WORLD.waterLevel);
      const y = g + range(rng, 6, 45);
      if (!isSolid(x, y, z)) add(x, y, z);
    }
  }

  // ---------------------------------------------------------------- inputs from humans

  setHumanState(id: number, pos: V3, vel: V3, yaw: number, pitch: number, roll: number, shielding: boolean, boosting: boolean): void {
    const e = this.entities.get(id);
    if (!e || e.isBot || !e.alive) return;
    if (this.phase === 'countdown') return; // frozen on the start ring
    const f = e.flight;
    // Basic sanity clamp: reject teleports beyond plausible speed.
    const dx = pos.x - f.pos.x;
    const dy = pos.y - f.pos.y;
    const dz = pos.z - f.pos.z;
    if (Math.hypot(dx, dy, dz) > 60) return;
    f.pos.x = clamp(pos.x, -WORLD.half, WORLD.half);
    f.pos.y = clamp(pos.y, -40, WORLD.maxAltitude);
    f.pos.z = clamp(pos.z, -WORLD.half, WORLD.half);
    f.vel.x = vel.x;
    f.vel.y = vel.y;
    f.vel.z = vel.z;
    f.yaw = yaw;
    f.pitch = pitch;
    f.roll = roll;
    f.boosting = boosting;
    e.shielding = shielding && e.mana > 1;
  }

  /** Validate and perform a spell cast. Returns true if accepted. */
  requestCast(id: number, spell: SpellId, origin: V3, dir: V3): boolean {
    const e = this.entities.get(id);
    if (!e || !e.alive || this.phase !== 'playing' || spell === 'shield') return false;
    const def = SPELLS[spell];
    if (this.time < e.cdUntil[spell] || e.mana < def.mana) return false;
    const fp = e.flight.pos;
    if (Math.hypot(origin.x - fp.x, origin.y - fp.y, origin.z - fp.z) > MAX_CAST_OFFSET) return false;
    const d = norm(dir);
    e.mana -= def.mana;
    e.cdUntil[spell] = this.time + def.cooldown;
    e.shielding = false;

    if (def.speed > 0) {
      const p: Projectile = {
        id: this.nextProjId++,
        owner: id,
        spell,
        pos: { ...origin },
        vel: { x: d.x * def.speed + e.flight.vel.x * 0.3, y: d.y * def.speed + e.flight.vel.y * 0.3, z: d.z * def.speed + e.flight.vel.z * 0.3 },
        life: def.range / def.speed,
      };
      this.projectiles.push(p);
      this.events.push({ k: 'proj', id: p.id, owner: id, spell, x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: p.vel.x, vy: p.vel.y, vz: p.vel.z });
    } else {
      // Hitscan lightning.
      let best = def.range;
      let hit = -1;
      const end = { x: origin.x + d.x * def.range, y: origin.y + d.y * def.range, z: origin.z + d.z * def.range };
      for (const o of this.entities.values()) {
        if (!o.alive || o.id === id) continue;
        const t = segmentSphere(origin, end, o.flight.pos, PLAYER.radius * 1.35);
        if (t >= 0 && t * def.range < best) {
          best = t * def.range;
          hit = o.id;
        }
      }
      const wall = raycastWorld(origin, d, best, 2);
      if (wall < best) {
        best = wall;
        hit = -1;
      }
      this.events.push({
        k: 'beam', owner: id,
        x0: origin.x, y0: origin.y, z0: origin.z,
        x1: origin.x + d.x * best, y1: origin.y + d.y * best, z1: origin.z + d.z * best,
        hit,
      });
      if (hit >= 0) this.damage(this.entities.get(hit)!, def.damage * this.dmgMul(e), id, 'lightning');
    }
    return true;
  }

  applyCrash(id: number, dmg: number): void {
    const e = this.entities.get(id);
    if (!e || !e.alive || this.phase !== 'playing') return;
    const d = clamp(dmg, 0, 60);
    if (d > 0) this.damage(e, d, e.lastDamagedAt > this.time - 5 ? e.lastAttacker : -1, 'crash');
  }

  // ---------------------------------------------------------------- core loop

  step(dt: number): void {
    if (this.phase === 'lobby' || this.phase === 'ended') {
      // keep projectiles flying for visuals after the end
      this.stepProjectiles(dt);
      return;
    }
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = 'playing';
        this.time = 0;
      }
      return;
    }

    this.time += dt;
    this.zone = zoneAt(this.zonePlan, this.time);

    // Bots think at ~10 Hz, fly every tick.
    this.botTick += dt;
    const think = this.botTick >= 0.1;
    if (think) this.botTick = 0;

    for (const e of this.entities.values()) {
      if (!e.alive) continue;
      // Regen / drains
      if (e.shielding) {
        e.mana -= PLAYER.shieldDrain * dt;
        if (e.mana <= 0) {
          e.mana = 0;
          e.shielding = false;
        }
      } else {
        e.mana = Math.min(PLAYER.maxMana, e.mana + PLAYER.manaRegen * dt);
      }

      if (e.isBot && e.brain) {
        if (think) thinkBot(this, e, 0.1);
        const impact = stepFlight(e.flight, e.input, dt, this.time < e.slowUntil ? 0.5 : 1);
        const cd = crashDamage(impact);
        if (cd > 0) this.damage(e, cd, -1, 'crash');
      }

      // Zone damage
      const f = e.flight.pos;
      if (Math.hypot(f.x - this.zone.cx, f.z - this.zone.cz) > this.zone.r) {
        e.zoneAcc += this.zone.dps * dt;
        if (e.zoneAcc >= 1) {
          const amt = Math.floor(e.zoneAcc);
          e.zoneAcc -= amt;
          this.damage(e, amt, -1, 'zone', true);
        }
      }

      // Loot pickup
      for (const l of this.loot) {
        if (l.taken) continue;
        const dx = l.x - f.x;
        const dy = l.y - f.y;
        const dz = l.z - f.z;
        if (dx * dx + dy * dy + dz * dz < LOOT.pickupRadius * LOOT.pickupRadius) this.pickup(e, l);
      }
    }

    this.stepProjectiles(dt);
    this.checkWin();
  }

  private stepProjectiles(dt: number): void {
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      const def = SPELLS[p.spell];
      const p0 = { ...p.pos };
      const p1 = { x: p0.x + p.vel.x * dt, y: p0.y + p.vel.y * dt, z: p0.z + p.vel.z * dt };
      p.life -= dt;
      let hitT = 2;
      let hitId = -1;
      if (this.phase === 'playing') {
        for (const o of this.entities.values()) {
          if (!o.alive || o.id === p.owner) continue;
          const t = segmentSphere(p0, p1, o.flight.pos, PLAYER.radius * 1.2);
          if (t >= 0 && t < hitT) {
            hitT = t;
            hitId = o.id;
          }
        }
      }
      // World collision: sample along the segment.
      const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
      const steps = Math.max(1, Math.ceil(segLen / 2.5));
      let worldT = 2;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        if (isSolid(p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t, p0.z + (p1.z - p0.z) * t)) {
          worldT = (i - 0.5) / steps;
          break;
        }
      }
      if (worldT < hitT) {
        hitT = worldT;
        hitId = -1;
      }
      if (hitT <= 1 || p.life <= 0) {
        const t = hitT <= 1 ? hitT : 1;
        const at = { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t, z: p0.z + (p1.z - p0.z) * t };
        this.events.push({ k: 'projEnd', id: p.id, spell: p.spell, x: at.x, y: at.y, z: at.z, hit: hitId });
        const owner = this.entities.get(p.owner);
        const mul = owner ? this.dmgMul(owner) : 1;
        if (this.phase === 'playing') {
          if (hitId >= 0) {
            const target = this.entities.get(hitId)!;
            this.damage(target, def.damage * mul, p.owner, p.spell);
            if (def.slow) target.slowUntil = this.time + def.slow;
          }
          if (def.splash > 0 && hitT <= 1) {
            for (const o of this.entities.values()) {
              if (!o.alive || o.id === hitId || o.id === p.owner) continue;
              const d = Math.hypot(o.flight.pos.x - at.x, o.flight.pos.y - at.y, o.flight.pos.z - at.z);
              if (d < def.splash) this.damage(o, def.damage * 0.5 * (1 - d / def.splash) * mul, p.owner, p.spell);
            }
          }
        }
        continue;
      }
      p.pos = p1;
      keep.push(p);
    }
    this.projectiles = keep;
  }

  private dmgMul(e: Entity): number {
    return this.time < e.overchargeUntil ? LOOT.overcharge.multiplier : 1;
  }

  private damage(e: Entity, raw: number, by: number, cause: SpellId | 'zone' | 'crash', ignoreShield = false): void {
    if (!e.alive) return;
    const shielded = !ignoreShield && e.shielding;
    const amount = Math.max(1, Math.round(shielded ? raw * (1 - PLAYER.shieldReduction) : raw));
    e.hp -= amount;
    e.lastDamagedAt = this.time;
    if (by > 0 && by !== e.id) e.lastAttacker = by;
    this.events.push({ k: 'dmg', target: e.id, by, amount, cause, shielded });
    if (e.hp <= 0) this.kill(e, by > 0 ? by : e.lastDamagedAt > this.time - 6 ? e.lastAttacker : -1, cause);
  }

  private kill(e: Entity, killer: number, cause: SpellId | 'zone' | 'crash'): void {
    const placement = this.aliveCount();
    e.alive = false;
    e.hp = 0;
    e.shielding = false;
    e.placement = placement;
    const k = this.entities.get(killer);
    if (k && k.id !== e.id) k.kills++;
    this.events.push({ k: 'death', victim: e.id, killer: k ? k.id : -1, cause, placement });
  }

  private pickup(e: Entity, l: Loot): void {
    if (l.type === 'heal') {
      if (e.hp >= PLAYER.maxHp) return;
      e.hp = Math.min(PLAYER.maxHp, e.hp + LOOT.heal.amount);
    } else if (l.type === 'mana') {
      if (e.mana >= PLAYER.maxMana - 1) return;
      e.mana = Math.min(PLAYER.maxMana, e.mana + LOOT.mana.amount);
    } else {
      e.overchargeUntil = this.time + LOOT.overcharge.duration;
    }
    l.taken = true;
    this.events.push({ k: 'loot', id: l.id, by: e.id, type: l.type });
  }

  private checkWin(): void {
    if (this.phase !== 'playing' || this.entities.size < 2) return;
    const alive = [...this.entities.values()].filter((e) => e.alive);
    if (alive.length <= 1) {
      this.phase = 'ended';
      this.winner = alive[0]?.id ?? -1;
      if (alive[0]) alive[0].placement = 1;
      this.events.push({ k: 'win', id: this.winner });
    }
  }

  // ---------------------------------------------------------------- queries

  aliveCount(): number {
    let n = 0;
    for (const e of this.entities.values()) if (e.alive) n++;
    return n;
  }

  drainEvents(): SimEvent[] {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  canSee(a: Entity, b: Entity): boolean {
    return hasLineOfSight(a.flight.pos, b.flight.pos);
  }

  info(): EntityInfo[] {
    return [...this.entities.values()].map((e) => ({ id: e.id, name: e.name, house: e.house, isBot: e.isBot }));
  }

  lootInfo(): LootInfo[] {
    return this.loot.filter((l) => !l.taken).map(({ id, type, x, y, z }) => ({ id, type, x, y, z }));
  }

  pack(): PackedEntity[] {
    const out: PackedEntity[] = [];
    for (const e of this.entities.values()) {
      const f = e.flight;
      const flags =
        (e.alive ? 1 : 0) |
        (e.shielding ? 2 : 0) |
        (f.boosting ? 4 : 0) |
        (this.time < e.slowUntil ? 8 : 0) |
        (this.time < e.overchargeUntil ? 16 : 0);
      out.push([e.id, +f.pos.x.toFixed(2), +f.pos.y.toFixed(2), +f.pos.z.toFixed(2), +f.yaw.toFixed(3), +f.pitch.toFixed(3), +f.roll.toFixed(3), flags, Math.ceil(e.hp)]);
    }
    return out;
  }

  you(id: number): YouState | null {
    const e = this.entities.get(id);
    if (!e) return null;
    const cds = {} as Record<SpellId, number>;
    for (const s of SPELL_ORDER) cds[s] = Math.max(0, e.cdUntil[s] - this.time);
    return {
      hp: Math.ceil(e.hp),
      mana: e.mana,
      cds,
      slow: Math.max(0, e.slowUntil - this.time),
      over: Math.max(0, e.overchargeUntil - this.time),
      kills: e.kills,
      alive: e.alive,
    };
  }
}

