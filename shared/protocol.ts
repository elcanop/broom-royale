import type { LootType, SpellId } from './config';

/** Events emitted by the simulation — consumed by the renderer (solo) or broadcast by the server (online). */
export type SimEvent =
  | { k: 'proj'; id: number; owner: number; spell: SpellId; x: number; y: number; z: number; vx: number; vy: number; vz: number }
  | { k: 'projEnd'; id: number; spell: SpellId; x: number; y: number; z: number; hit: number }
  | { k: 'beam'; owner: number; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; hit: number }
  | { k: 'dmg'; target: number; by: number; amount: number; cause: SpellId | 'zone' | 'crash'; shielded: boolean }
  | { k: 'death'; victim: number; killer: number; cause: SpellId | 'zone' | 'crash'; placement: number }
  | { k: 'loot'; id: number; by: number; type: LootType }
  | { k: 'win'; id: number };

export interface EntityInfo {
  id: number;
  name: string;
  house: number;
  isBot: boolean;
}

export interface LootInfo {
  id: number;
  type: LootType;
  x: number;
  y: number;
  z: number;
}

/** Packed entity tuple: id, x, y, z, yaw, pitch, roll, flags, hp. flags: 1=alive 2=shield 4=boost 8=slowed 16=overcharge */
export type PackedEntity = [number, number, number, number, number, number, number, number, number];

export interface YouState {
  hp: number;
  mana: number;
  cds: Record<SpellId, number>; // seconds remaining
  slow: number;
  over: number;
  kills: number;
  alive: boolean;
}

export type MatchPhase = 'lobby' | 'countdown' | 'playing' | 'ended';

export type ClientMsg =
  | { t: 'hello'; name: string; house: number }
  | { t: 'start' }
  | { t: 'state'; p: [number, number, number]; v: [number, number, number]; yaw: number; pitch: number; roll: number; shield: boolean; boost: boolean }
  | { t: 'cast'; spell: SpellId; o: [number, number, number]; d: [number, number, number] }
  | { t: 'crash'; dmg: number };

export type ServerMsg =
  | { t: 'welcome'; id: number }
  | { t: 'lobby'; players: EntityInfo[]; host: number; countdown: number | null }
  | { t: 'match'; seed: number; you: number; ents: EntityInfo[]; loot: LootInfo[] }
  | { t: 'snap'; time: number; phase: MatchPhase; cd: number; ents: PackedEntity[]; you: YouState | null; alive: number }
  | { t: 'ev'; list: SimEvent[] }
  | { t: 'error'; message: string };

