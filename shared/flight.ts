import { PLAYER } from './config';
import { resolveSphere } from './collision';
import { clamp, dirFromYawPitch, wrapAngle, type V3 } from './vec';

export interface FlightState {
  pos: V3;
  vel: V3;
  yaw: number;
  pitch: number;
  roll: number;
  stamina: number;
  boosting: boolean;
}

export interface FlightInput {
  aimYaw: number;
  aimPitch: number;
  forward: number; // -1..1
  strafe: number; // -1..1
  vertical: number; // -1..1
  boost: boolean;
}

export const emptyInput = (): FlightInput => ({ aimYaw: 0, aimPitch: 0, forward: 0, strafe: 0, vertical: 0, boost: false });

export const createFlight = (pos: V3, yaw = 0): FlightState => ({
  pos: { ...pos },
  vel: { x: 0, y: 0, z: 0 },
  yaw,
  pitch: 0,
  roll: 0,
  stamina: PLAYER.maxStamina,
  boosting: false,
});

/**
 * Advance broom flight physics. Returns impact speed (m/s) if a collision occurred this step, else 0.
 * `speedMul` < 1 applies slows (e.g. Glacies).
 */
export const stepFlight = (s: FlightState, input: FlightInput, dt: number, speedMul = 1): number => {
  const wantsBoost = input.boost && input.forward > 0.1 && s.stamina > 1;
  s.boosting = wantsBoost;
  s.stamina = clamp(
    s.stamina + (wantsBoost ? -PLAYER.staminaDrain : PLAYER.staminaRegen) * dt,
    0,
    PLAYER.maxStamina,
  );
  const vmax = (wantsBoost ? PLAYER.boostSpeed : PLAYER.cruiseSpeed) * speedMul;

  const pitch = clamp(input.aimPitch, -1.4, 1.4);
  const fwd = dirFromYawPitch(input.aimYaw, pitch);
  const rx = Math.cos(input.aimYaw);
  const rz = -Math.sin(input.aimYaw);

  const f = clamp(input.forward, -0.5, 1) * vmax;
  const st = clamp(input.strafe, -1, 1) * vmax * PLAYER.strafeFactor;
  const vt = clamp(input.vertical, -1, 1) * vmax * PLAYER.verticalFactor;

  const tx = fwd.x * f + rx * st;
  const ty = fwd.y * f + vt;
  const tz = fwd.z * f + rz * st;

  const k = 1 - Math.exp(-PLAYER.accel * dt * (wantsBoost ? 1.4 : 1));
  s.vel.x += (tx - s.vel.x) * k;
  s.vel.y += (ty - s.vel.y) * k;
  s.vel.z += (tz - s.vel.z) * k;

  s.pos.x += s.vel.x * dt;
  s.pos.y += s.vel.y * dt;
  s.pos.z += s.vel.z * dt;

  let impact = 0;
  const c = resolveSphere(s.pos, PLAYER.radius);
  if (c.hit) {
    const nl = Math.hypot(c.nx, c.ny, c.nz) || 1;
    const nx = c.nx / nl;
    const ny = c.ny / nl;
    const nz = c.nz / nl;
    const vn = s.vel.x * nx + s.vel.y * ny + s.vel.z * nz;
    if (vn < 0) {
      impact = -vn;
      // Remove the inward component and bounce a little.
      s.vel.x -= vn * nx * 1.3;
      s.vel.y -= vn * ny * 1.3;
      s.vel.z -= vn * nz * 1.3;
      s.vel.x *= 0.7;
      s.vel.y *= 0.7;
      s.vel.z *= 0.7;
    }
  }

  // Orientation: broom follows aim; roll banks with turning and strafing.
  const yawRate = wrapAngle(input.aimYaw - s.yaw) / Math.max(dt, 1e-3);
  s.yaw = input.aimYaw;
  s.pitch = pitch;
  const targetRoll = clamp(-input.strafe * 0.45 + yawRate * 0.18, -0.9, 0.9);
  s.roll += (targetRoll - s.roll) * (1 - Math.exp(-6 * dt));

  return impact;
};

/** Crash damage for an impact speed. */
export const crashDamage = (impact: number): number =>
  impact > PLAYER.crashSpeed ? Math.round((impact - PLAYER.crashSpeed) * 0.9) : 0;

