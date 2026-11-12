/** Global gameplay tuning. Shared by the client-side simulation (solo) and the authoritative server (online). */

export const WORLD = {
  half: 1200, // map spans [-half, half] on X and Z (metres)
  waterLevel: 0,
  maxAltitude: 460,
  seed: 1337,
  castleCenter: { x: 0, z: -120 },
  plateauHeight: 70,
  lakeCenter: { x: 70, z: 270 },
  stadiumCenter: { x: -520, z: 180 },
  stonesCenter: { x: 560, z: -420 },
} as const;

export const PLAYER = {
  maxHp: 100,
  maxMana: 100,
  manaRegen: 9, // per second
  maxStamina: 100,
  staminaDrain: 28,
  staminaRegen: 14,
  radius: 1.6, // hit sphere radius
  cruiseSpeed: 40,
  boostSpeed: 72,
  strafeFactor: 0.65,
  verticalFactor: 0.7,
  accel: 2.6, // velocity response (1/s)
  crashSpeed: 30, // impacts faster than this cause damage
  shieldDrain: 26, // mana per second
  shieldReduction: 0.85,
} as const;

export type SpellId = 'fire' | 'ice' | 'lightning' | 'shield';

export interface SpellDef {
  id: SpellId;
  name: string;
  incantation: string;
  mana: number;
  cooldown: number;
  damage: number;
  speed: number; // 0 = hitscan / channel
  range: number;
  splash: number;
  color: number;
  slow?: number;
}

export const SPELLS: Record<SpellId, SpellDef> = {
  fire: {
    id: 'fire',
    name: 'Ignis',
    incantation: 'Ignis Ardens',
    mana: 13,
    cooldown: 0.5,
    damage: 24,
    speed: 140,
    range: 420,
    splash: 7,
    color: 0xff6a1a,
  },
  ice: {
    id: 'ice',
    name: 'Glacies',
    incantation: 'Glacies Acus',
    mana: 9,
    cooldown: 0.36,
    damage: 11,
    speed: 210,
    range: 460,
    splash: 0,
    color: 0x6fd8ff,
    slow: 1.8,
  },
  lightning: {
    id: 'lightning',
    name: 'Fulgur',
    incantation: 'Fulgur Tonans',
    mana: 32,
    cooldown: 1.6,
    damage: 38,
    speed: 0,
    range: 340,
    splash: 0,
    color: 0xb48cff,
  },
  shield: {
    id: 'shield',
    name: 'Scutum',
    incantation: 'Scutum Aureum',
    mana: 0,
    cooldown: 0.2,
    damage: 0,
    speed: 0,
    range: 0,
    splash: 0,
    color: 0xffd36b,
  },
};

export const SPELL_ORDER: SpellId[] = ['fire', 'ice', 'lightning', 'shield'];

export type LootType = 'heal' | 'mana' | 'overcharge';
export const LOOT = {
  heal: { amount: 40, color: 0xff3b4e },
  mana: { amount: 60, color: 0x3b8bff },
  overcharge: { duration: 15, multiplier: 1.5, color: 0xffc23b },
  pickupRadius: 5,
  count: 46,
} as const;

export const MATCH = {
  maxPlayers: 20,
  countdown: 1.5,
  tickRate: 30,
  snapshotRate: 15,
} as const;

export const HOUSES = [
  { id: 'draconis', name: 'Draconis', color: 0x8e1b1b, accent: 0xd4a017 },
  { id: 'sylvara', name: 'Sylvara', color: 0x1d5c34, accent: 0xc0c7cf },
  { id: 'aquilon', name: 'Aquilon', color: 0x1c3166, accent: 0xb08d57 },
  { id: 'solaris', name: 'Solaris', color: 0xb8860b, accent: 0x1a1a1a },
] as const;

export const BOT_FIRST = [
  'Morwen', 'Thaddeus', 'Isolde', 'Cassius', 'Elowen', 'Bram', 'Seraphina', 'Alaric', 'Wren', 'Corvin',
  'Lysandra', 'Osric', 'Ondine', 'Fenwick', 'Rowena', 'Ambrose', 'Tamsin', 'Lucan', 'Mirabel', 'Silas',
];
export const BOT_LAST = [
  'Ashgrove', 'Quillfeather', 'Thornwood', 'Blackmere', 'Vale', 'Hollowell', 'Starling', 'Duskmantle',
  'Fairweather', 'Ravenscar', 'Mossbrook', 'Grimsby', 'Larkspur', 'Stormholt', 'Wychwood',
];
