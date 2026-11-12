import * as THREE from 'three';
import { SPELL_ORDER, type SpellId } from '../../../shared/config';
import type { FlightInput } from '../../../shared/flight';
import { clamp, wrapAngle } from '../../../shared/vec';
import type { Engine } from '../engine/Engine';

export class InputManager {
  readonly flightInput: FlightInput = {
    aimYaw: 0,
    aimPitch: 0,
    forward: 0,
    strafe: 0,
    vertical: 0,
    boost: false,
  };

  activeSpell: SpellId = 'fire';
  wantsCast = false;
  shieldHeld = false;
  firstPerson = false;
  pointerLocked = false;
  autoCruise = false;
  flightActive = false;

  private keys = new Set<string>();
  private mouseDownLeft = false;
  private mouseDownRight = false;
  private lastClientX = -1;
  private lastClientY = -1;
  private xrLeftCtrl: THREE.XRTargetRaySpace;
  private xrRightCtrl: THREE.XRTargetRaySpace;
  private prevRightBtn = false;

  constructor(private readonly engine: Engine) {
    const dom = engine.renderer.domElement;

    this.xrLeftCtrl = engine.renderer.xr.getController(0);
    this.xrRightCtrl = engine.renderer.xr.getController(1);
    engine.rig.add(this.xrLeftCtrl, this.xrRightCtrl);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    dom.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === dom;
    });
  }

  lockPointer(): void {
    if (this.engine.isXR) return;
    const dom = this.engine.renderer.domElement;
    try {
      if (document.pointerLockElement !== dom && dom.requestPointerLock) {
        void dom.requestPointerLock();
      }
    } catch {
      /* fallback mouse steering handles unlocked mode automatically */
    }
  }

  unlockPointer(): void {
    try {
      if (document.pointerLockElement && document.exitPointerLock) {
        document.exitPointerLock();
      }
    } catch {
      /* ignore */
    }
  }

  setInitialYaw(yaw: number, pitch = 0): void {
    this.flightInput.aimYaw = yaw;
    this.flightInput.aimPitch = pitch;
  }

  selectSpell(spell: SpellId): void {
    this.activeSpell = spell;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    this.keys.add(e.code);
    if (e.code === 'Digit1') this.activeSpell = 'fire';
    else if (e.code === 'Digit2') this.activeSpell = 'ice';
    else if (e.code === 'Digit3') this.activeSpell = 'lightning';
    else if (e.code === 'Digit4') this.activeSpell = 'shield';
    else if (e.code === 'KeyV') this.firstPerson = !this.firstPerson;
    else if (e.code === 'KeyX') this.autoCruise = !this.autoCruise;
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.flightActive || this.engine.isXR) return;
    // Ignore mouse movements over HUD buttons/selects
    if (e.target instanceof HTMLElement && e.target.closest('button, select, input, .poi-nav, .minimap-wrap')) {
      this.lastClientX = e.clientX;
      this.lastClientY = e.clientY;
      return;
    }

    let dx = e.movementX;
    let dy = e.movementY;
    if (!this.pointerLocked) {
      if (this.lastClientX >= 0) {
        dx = e.clientX - this.lastClientX;
        dy = e.clientY - this.lastClientY;
      } else {
        dx = 0;
        dy = 0;
      }
      this.lastClientX = e.clientX;
      this.lastClientY = e.clientY;
    }

    const sens = this.pointerLocked ? 0.0022 : 0.0032;
    this.flightInput.aimYaw = wrapAngle(this.flightInput.aimYaw - dx * sens);
    this.flightInput.aimPitch = clamp(this.flightInput.aimPitch - dy * sens, -1.35, 1.35);
  };

  private onMouseDown = (e: MouseEvent): void => {
    this.lastClientX = e.clientX;
    this.lastClientY = e.clientY;
    if (!this.pointerLocked && !this.engine.isXR && this.flightActive) {
      this.lockPointer();
    }
    if (e.button === 0) {
      this.mouseDownLeft = true;
      this.wantsCast = true;
    } else if (e.button === 2) {
      this.mouseDownRight = true;
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseDownLeft = false;
    else if (e.button === 2) this.mouseDownRight = false;
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.flightActive) return;
    const idx = SPELL_ORDER.indexOf(this.activeSpell);
    const next = (idx + (e.deltaY > 0 ? 1 : -1) + SPELL_ORDER.length) % SPELL_ORDER.length;
    this.activeSpell = SPELL_ORDER[next];
  };

  /** Poll keyboard, mouse, and WebXR VR controllers each frame. */
  update(dt: number): void {
    const k = this.keys;

    // Keyboard yaw & pitch steering (so player can steer 100% with keyboard OR mouse!)
    const turnLeft = (k.has('ArrowLeft') ? 1 : 0) + (k.has('KeyA') ? 0.65 : 0);
    const turnRight = (k.has('ArrowRight') ? 1 : 0) + (k.has('KeyD') ? 0.65 : 0);
    const turnInput = turnLeft - turnRight;
    if (Math.abs(turnInput) > 0.01) {
      this.flightInput.aimYaw = wrapAngle(this.flightInput.aimYaw + turnInput * 1.85 * dt);
    }

    const pitchUp = k.has('ArrowUp') ? 1 : 0;
    const pitchDown = k.has('ArrowDown') ? 1 : 0;
    if (pitchUp !== pitchDown) {
      this.flightInput.aimPitch = clamp(this.flightInput.aimPitch + (pitchUp - pitchDown) * 1.45 * dt, -1.35, 1.35);
    }

    let fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    if (fwd === 0 && this.autoCruise) fwd = 1;
    if (k.has('KeyS')) this.autoCruise = false;

    let str = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    let vrt = (k.has('Space') || k.has('KeyE') ? 1 : 0) - (k.has('KeyC') || k.has('ControlLeft') ? 1 : 0);
    let boost = k.has('ShiftLeft') || k.has('ShiftRight');
    let shield =
      this.mouseDownRight ||
      k.has('KeyQ') ||
      (this.activeSpell === 'shield' && this.mouseDownLeft);

    if (this.mouseDownLeft && this.activeSpell !== 'shield') {
      this.wantsCast = true;
    }

    // ---- WebXR VR Controller Input ----
    const session = this.engine.renderer.xr.getSession();
    if (session) {
      for (const src of session.inputSources) {
        const gp = src.gamepad;
        if (!gp) continue;
        const axX = Math.abs(gp.axes[2] ?? 0) > 0.08 ? gp.axes[2] : (gp.axes[0] ?? 0);
        const axY = Math.abs(gp.axes[3] ?? 0) > 0.08 ? gp.axes[3] : (gp.axes[1] ?? 0);
        const trigger = gp.buttons[0]?.pressed ?? false;
        const squeeze = gp.buttons[1]?.pressed ?? false;
        const btnA = gp.buttons[4]?.pressed ?? false;
        const btnB = gp.buttons[5]?.pressed ?? false;

        if (src.handedness === 'left') {
          if (Math.abs(axY) > 0.1) fwd = -axY;
          if (Math.abs(axX) > 0.1) str = axX;
          if (trigger) boost = true;
          if (squeeze) shield = true;
          const euler = new THREE.Euler().setFromQuaternion(this.xrLeftCtrl.quaternion, 'YXZ');
          this.flightInput.aimPitch = clamp(euler.x * 0.85, -1.2, 1.2);
        } else if (src.handedness === 'right') {
          if (Math.abs(axX) > 0.15) {
            this.flightInput.aimYaw = wrapAngle(this.flightInput.aimYaw - axX * 1.9 * dt);
          }
          if (Math.abs(axY) > 0.15) {
            vrt = -axY;
          }
          if (trigger) {
            if (this.activeSpell === 'shield') shield = true;
            else this.wantsCast = true;
          }
          if (squeeze) shield = true;

          const cyclePressed = btnA || btnB;
          if (cyclePressed && !this.prevRightBtn) {
            const idx = SPELL_ORDER.indexOf(this.activeSpell);
            const step = btnA ? 1 : -1;
            this.activeSpell = SPELL_ORDER[(idx + step + SPELL_ORDER.length) % SPELL_ORDER.length];
          }
          this.prevRightBtn = cyclePressed;
        }
      }
    }

    this.flightInput.forward = clamp(fwd, -0.6, 1);
    this.flightInput.strafe = clamp(str, -1, 1);
    this.flightInput.vertical = clamp(vrt, -1, 1);
    this.flightInput.boost = boost;
    this.shieldHeld = shield;
  }

  getXrWandPose(): { pos: THREE.Vector3; quat: THREE.Quaternion } | null {
    if (!this.engine.isXR) return null;
    return {
      pos: this.xrRightCtrl.position,
      quat: this.xrRightCtrl.quaternion,
    };
  }

  getCastDirection(camera: THREE.Camera, out = new THREE.Vector3()): THREE.Vector3 {
    if (this.engine.isXR) {
      out.set(0, 0, -1).applyQuaternion(this.xrRightCtrl.getWorldQuaternion(new THREE.Quaternion()));
      return out.normalize();
    }
    camera.getWorldDirection(out);
    return out.normalize();
  }
}
