import * as THREE from 'three';
import { MATCH, WORLD } from '../../shared/config';
import { crashDamage, createFlight, stepFlight, type FlightState } from '../../shared/flight';
import type { EntityInfo, MatchPhase, PackedEntity, SimEvent, YouState } from '../../shared/protocol';
import { Sim } from '../../shared/sim';
import { heightAt } from '../../shared/terrain';
import { wrapAngle } from '../../shared/vec';
import { planZone, zoneAt, type ZonePlan, type ZoneState } from '../../shared/zone';
import { SoundEngine } from './audio/SoundEngine';
import { Engine, type Quality } from './engine/Engine';
import { FirstPersonCockpit, LootVisuals, WizardAvatar } from './entities/Models';
import { InputManager } from './input/InputManager';
import { NetClient } from './net/NetClient';
import './styles.css';
import { Hud } from './ui/Hud';
import { VfxManager } from './vfx/VfxManager';
import { World, type AtmospherePreset } from './world/WorldBuilder';

class BroomRoyaleApp {
  private engine!: Engine;
  private world!: World;
  private vfx!: VfxManager;
  private lootVis!: LootVisuals;
  private cockpit!: FirstPersonCockpit;
  private input!: InputManager;
  private sound = new SoundEngine();
  private hud!: Hud;
  private net = new NetClient();

  // Simulation state (local solo mode or online client mode)
  private mode: 'menu' | 'solo' | 'online' = 'menu';
  private sim: Sim | null = null;
  private localId = 1;
  private localFlight: FlightState = createFlight({ x: 0, y: 180, z: 320 }, 0);
  private avatars = new Map<number, WizardAvatar>();
  private entityMeta = new Map<number, EntityInfo>();
  private packedEntities: PackedEntity[] = [];
  private youState: YouState | null = null;
  private phase: MatchPhase = 'lobby';
  private countdown: number = MATCH.countdown;
  private matchTime = 0;
  private aliveCount = 0;
  private zonePlan: ZonePlan = planZone(WORLD.seed);
  private zone: ZoneState = zoneAt(this.zonePlan, 0);
  private endShown = false;

  private lastFrameMs = performance.now();
  private elapsedSec = 0;
  private netSendAccum = 0;

  async init(): Promise<void> {
    const container = document.getElementById('viewport')!;
    const qualitySelect = document.getElementById('sel-quality') as HTMLSelectElement | null;
    const initialQuality = (qualitySelect?.value as Quality) || 'high';

    this.engine = new Engine(container, initialQuality);
    this.vfx = new VfxManager();
    this.lootVis = new LootVisuals();
    this.cockpit = new FirstPersonCockpit();

    this.engine.scene.add(this.vfx.group);
    this.engine.scene.add(this.lootVis.group);
    this.engine.rig.add(this.cockpit.group);

    this.input = new InputManager(this.engine);
    this.hud = new Hud(
      (spell) => this.input.selectSpell(spell),
      (wx, wz, fastTravel) => this.handleMapNavigate(wx, wz, fastTravel),
    );

    const atmoSelect = document.getElementById('sel-atmo') as HTMLSelectElement | null;
    const initialAtmo = (atmoSelect?.value as AtmospherePreset) || 'sunset';
    this.world = await World.create(this.engine, initialAtmo);

    const loadingEl = document.getElementById('loading-overlay');
    if (loadingEl) loadingEl.classList.add('hidden');

    this.bindUiEvents();
    void this.checkVrSupport();

    this.engine.renderer.setAnimationLoop(() => this.onFrame());
  }

  private handleMapNavigate(wx: number, wz: number, fastTravel: boolean): void {
    this.world.setWaypoint(wx, wz);
    const f = this.localFlight;
    if (fastTravel) {
      const ground = Math.max(heightAt(wx, wz), WORLD.waterLevel);
      const targetY = ground + 44;
      const yawToCenter = Math.atan2(wx - WORLD.castleCenter.x, wz - WORLD.castleCenter.z);
      this.teleportPlayer(wx, targetY, wz, yawToCenter);
    } else {
      // Orient broomstick toward the selected map waypoint
      const yawToTarget = Math.atan2(-(wx - f.pos.x), -(wz - f.pos.z));
      f.yaw = yawToTarget;
      this.input.setInitialYaw(yawToTarget);
    }
  }

  private teleportPlayer(x: number, y: number, z: number, yaw: number): void {
    this.localFlight.pos.x = x;
    this.localFlight.pos.y = y;
    this.localFlight.pos.z = z;
    this.localFlight.vel.x = -Math.sin(yaw) * 18;
    this.localFlight.vel.y = 0;
    this.localFlight.vel.z = -Math.cos(yaw) * 18;
    this.localFlight.yaw = yaw;
    this.localFlight.pitch = -0.05;
    this.input.setInitialYaw(yaw);
    if (this.sim) {
      const me = this.sim.entities.get(this.localId);
      if (me) {
        me.flight.pos.x = x;
        me.flight.pos.y = y;
        me.flight.pos.z = z;
        me.flight.vel.x = -Math.sin(yaw) * 18;
        me.flight.vel.y = 0;
        me.flight.vel.z = -Math.cos(yaw) * 18;
        me.flight.yaw = yaw;
        me.flight.pitch = -0.05;
      }
    }
  }

  private async checkVrSupport(): Promise<void> {
    const vrBtn = document.getElementById('btn-vr') as HTMLButtonElement | null;
    const vrBadge = document.getElementById('vr-status');
    if (!vrBtn || !vrBadge) return;
    const supported = !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr').catch(() => false)));
    if (supported) {
      vrBadge.textContent = 'Gafas VR WebXR Detectadas — Listo para Inmersión 6DoF';
      vrBadge.classList.add('ready');
    } else {
      vrBadge.textContent = 'Modo Escritorio Activo (Abre en Meta Quest / Pico / WebXR para VR)';
    }
  }

  private bindUiEvents(): void {
    const getProfile = (): { name: string; house: number; skill: number } => {
      const nameInput = document.getElementById('inp-name') as HTMLInputElement | null;
      const houseBtn = document.querySelector('.house-card.selected') as HTMLElement | null;
      const diffSelect = document.getElementById('sel-diff') as HTMLSelectElement | null;
      const name = (nameInput?.value.trim() || 'Archimago').slice(0, 18);
      const house = Number(houseBtn?.dataset.house ?? 0);
      const skill = Number(diffSelect?.value ?? 0.65);
      return { name, house, skill };
    };

    // House selection cards
    document.querySelectorAll('.house-card').forEach((card) => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.house-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
      });
    });

    // Solo Battle Royale button
    document.getElementById('btn-solo')?.addEventListener('click', () => {
      this.sound.init();
      const { name, house, skill } = getProfile();
      this.startSoloMatch(name, house, skill);
    });

    // Online Multiplayer button
    document.getElementById('btn-online')?.addEventListener('click', async () => {
      this.sound.init();
      const { name, house, skill } = getProfile();
      const ok = await this.net.connect(name, house);
      if (ok) {
        this.setupOnlineHandlers();
        this.net.send({ t: 'start' });
      } else {
        // Fallback seamlessly to solo match if WS server isn't running
        this.startSoloMatch(name, house, skill);
      }
    });

    // Enter VR (WebXR) button
    document.getElementById('btn-vr')?.addEventListener('click', async () => {
      this.sound.init();
      const { name, house, skill } = getProfile();
      if (this.mode === 'menu') {
        this.startSoloMatch(name, house, skill);
      }
      const entered = await this.engine.enterVR();
      if (!entered) {
        // Enable 1st-person cockpit view as VR preview on desktop browsers without a headset
        this.input.firstPerson = true;
      }
    });

    // Play again button in end modal
    document.getElementById('btn-replay')?.addEventListener('click', () => {
      this.hud.hideEndModal();
      const { name, house, skill } = getProfile();
      this.startSoloMatch(name, house, skill);
    });

    // Return to lobby button
    document.getElementById('btn-lobby')?.addEventListener('click', () => {
      this.net.close();
      this.clearAvatars();
      this.mode = 'menu';
      this.input.flightActive = false;
      this.world.clearWaypoint();
      this.hud.hideEndModal();
      this.hud.showLobby(true);
      this.input.unlockPointer();
    });

    // Mute toggle
    const muteBtn = document.getElementById('btn-mute');
    muteBtn?.addEventListener('click', () => {
      const m = this.sound.toggleMute();
      muteBtn.textContent = m ? 'Audio: Silenciado' : 'Audio: Activo';
    });

    // Camera view toggle button in HUD
    document.getElementById('btn-cam')?.addEventListener('click', () => {
      this.input.firstPerson = !this.input.firstPerson;
    });

    // Auto-Cruise toggle button & X key sync
    const cruiseBtn = document.getElementById('btn-cruise');
    const syncCruiseBtn = (): void => {
      if (!cruiseBtn) return;
      cruiseBtn.textContent = this.input.autoCruise ? 'Crucero: ON (X)' : 'Crucero: OFF (X)';
      cruiseBtn.classList.toggle('active', this.input.autoCruise);
    };
    cruiseBtn?.addEventListener('click', () => {
      this.input.autoCruise = !this.input.autoCruise;
      syncCruiseBtn();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyX' && !(e.target instanceof HTMLInputElement)) {
        setTimeout(syncCruiseBtn, 0);
      }
    });

    // Interactive Landmark / POI Fast-Travel & Waypoint buttons
    const poiLocations: Record<string, { x: number; y: number; z: number; yaw: number; wx: number; wz: number }> = {
      castle: { x: -10, y: WORLD.plateauHeight + 48, z: 42, yaw: 0, wx: -10, wz: -42 },
      astronomy: { x: 105, y: WORLD.plateauHeight + 115, z: 32, yaw: 0.5, wx: 60, wz: -50 },
      bridge: { x: -195, y: WORLD.plateauHeight + 44, z: -55, yaw: 0, wx: -197, wz: -142 },
      stadium: { x: WORLD.stadiumCenter.x, y: 66, z: WORLD.stadiumCenter.z + 115, yaw: 0, wx: WORLD.stadiumCenter.x, wz: WORLD.stadiumCenter.z },
      lake: { x: 160, y: 42, z: 375, yaw: 0.7, wx: WORLD.lakeCenter.x, wz: WORLD.lakeCenter.z },
      stones: { x: WORLD.stonesCenter.x, y: 68, z: WORLD.stonesCenter.z + 95, yaw: 0, wx: WORLD.stonesCenter.x, wz: WORLD.stonesCenter.z },
    };
    document.querySelectorAll('.poi-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = (btn as HTMLElement).dataset.poi ?? '';
        const loc = poiLocations[key];
        if (!loc) return;
        document.querySelectorAll('.poi-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.world.setWaypoint(loc.wx, loc.wz);
        this.teleportPlayer(loc.x, loc.y, loc.z, loc.yaw);
      });
    });

    // Quality selector change
    const qualSelect = document.getElementById('sel-quality') as HTMLSelectElement | null;
    qualSelect?.addEventListener('change', () => {
      this.engine.setQuality(qualSelect.value as Quality);
    });

    // Atmosphere selector & live hotkey (L)
    const atmoSelect = document.getElementById('sel-atmo') as HTMLSelectElement | null;
    const atmoBtn = document.getElementById('btn-atmo');
    const labels: Record<AtmospherePreset, string> = {
      sunset: 'Clima: Atardecer (L)',
      night: 'Clima: Noche Aurora (L)',
      storm: 'Clima: Tormenta (L)',
    };
    const applyAtmo = (a: AtmospherePreset): void => {
      this.world.setAtmosphere(a);
      if (atmoSelect) atmoSelect.value = a;
      if (atmoBtn) atmoBtn.textContent = labels[a];
    };
    atmoSelect?.addEventListener('change', () => applyAtmo(atmoSelect.value as AtmospherePreset));
    const cycleAtmo = (): void => {
      const order: AtmospherePreset[] = ['sunset', 'night', 'storm'];
      const next = order[(order.indexOf(this.world.atmosphere) + 1) % order.length];
      applyAtmo(next);
    };
    atmoBtn?.addEventListener('click', cycleAtmo);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyL' && !(e.target instanceof HTMLInputElement)) cycleAtmo();
    });
  }

  // ---------------------------------------------------------------- Match Setup

  private clearAvatars(): void {
    for (const av of this.avatars.values()) {
      this.engine.scene.remove(av.root);
    }
    this.avatars.clear();
    this.entityMeta.clear();
  }

  private startSoloMatch(playerName: string, house: number, botSkill: number): void {
    this.net.close();
    this.clearAvatars();
    this.mode = 'solo';
    this.endShown = false;

    const sim = new Sim({ seed: Math.floor(Math.random() * 1_000_000), botSkill });
    const me = sim.addEntity(playerName, false, house);
    sim.fillWithBots(MATCH.maxPlayers);
    sim.start();

    this.sim = sim;
    this.localId = me.id;
    this.zonePlan = sim.zonePlan;
    this.zone = sim.zone;
    this.localFlight = me.flight;
    this.input.setInitialYaw(me.flight.yaw);
    this.input.flightActive = true;

    for (const info of sim.info()) {
      this.entityMeta.set(info.id, info);
      const av = new WizardAvatar(info.id, info.name, info.house, info.id === this.localId);
      this.avatars.set(info.id, av);
      this.engine.scene.add(av.root);
    }
    this.lootVis.setLoot(sim.lootInfo());

    this.hud.hideEndModal();
    this.hud.showLobby(false);
    this.input.lockPointer();
  }

  private setupOnlineHandlers(): void {
    this.mode = 'online';
    this.sim = null;
    this.endShown = false;
    this.input.flightActive = true;

    this.net.onMessage = (msg) => {
      if (msg.t === 'welcome') {
        this.localId = msg.id;
      } else if (msg.t === 'match') {
        this.clearAvatars();
        this.localId = msg.you;
        this.zonePlan = planZone(msg.seed);
        this.zone = zoneAt(this.zonePlan, 0);
        for (const info of msg.ents) {
          this.entityMeta.set(info.id, info);
          const av = new WizardAvatar(info.id, info.name, info.house, info.id === this.localId);
          this.avatars.set(info.id, av);
          this.engine.scene.add(av.root);
        }
        this.lootVis.setLoot(msg.loot);
        this.hud.hideEndModal();
        this.hud.showLobby(false);
        this.input.lockPointer();
      } else if (msg.t === 'snap') {
        this.matchTime = msg.time;
        this.phase = msg.phase;
        this.countdown = msg.cd;
        this.packedEntities = msg.ents;
        this.youState = msg.you;
        this.aliveCount = msg.alive;
        this.zone = zoneAt(this.zonePlan, this.matchTime);
        if (this.phase === 'countdown') {
          const mine = msg.ents.find((e) => e[0] === this.localId);
          if (mine) {
            this.localFlight.pos = { x: mine[1], y: mine[2], z: mine[3] };
            this.localFlight.yaw = mine[4];
            this.input.setInitialYaw(mine[4]);
          }
        }
      } else if (msg.t === 'ev') {
        this.processEvents(msg.list);
      }
    };
  }

  // ---------------------------------------------------------------- Frame Loop

  private onFrame(): void {
    const nowMs = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (nowMs - this.lastFrameMs) / 1000));
    this.lastFrameMs = nowMs;
    this.elapsedSec += dt;
    const elapsed = this.elapsedSec;

    if (this.mode === 'menu') {
      // Orbiting cinematic camera around the castle at sunset
      const a = elapsed * 0.08;
      const cx = WORLD.castleCenter.x + Math.sin(a) * 280;
      const cz = WORLD.castleCenter.z + Math.cos(a) * 290 + 90;
      const cy = WORLD.plateauHeight + 88 + Math.sin(elapsed * 0.25) * 18;
      this.engine.rig.position.set(cx, cy, cz);
      this.engine.rig.rotation.set(0, 0, 0);
      this.engine.camera.position.set(0, 0, 0);
      this.engine.camera.lookAt(WORLD.castleCenter.x, WORLD.plateauHeight + 35, WORLD.castleCenter.z);
      this.cockpit.group.visible = false;
      this.world.update(elapsed, dt, this.engine.rig.position, this.zone);
      this.engine.updateProEffects(dt, this.world.sunDir, this.world.sunColor, this.world.godRayStrength, false, 0);
      this.engine.render();
      return;
    }

    this.input.update(dt);

    if (this.mode === 'solo' && this.sim) {
      this.stepSolo(dt);
    } else if (this.mode === 'online') {
      this.stepOnline(dt);
    }

    this.updateCameraAndCockpit(dt, elapsed);
    this.syncAvatars(elapsed);

    const p = this.localFlight.pos;
    const speed = Math.hypot(this.localFlight.vel.x, this.localFlight.vel.y, this.localFlight.vel.z);
    this.sound.updateFlightWind(speed, this.localFlight.boosting);

    const wp = this.world.getWaypoint();
    if (wp && Math.hypot(wp.x - p.x, wp.z - p.z) < 28) {
      this.world.clearWaypoint();
    }

    this.world.update(elapsed, dt, new THREE.Vector3(p.x, p.y, p.z), this.zone);
    this.engine.updateProEffects(
      dt,
      this.world.sunDir,
      this.world.sunColor,
      this.world.godRayStrength,
      this.localFlight.boosting,
      speed / 72,
    );
    this.lootVis.update(elapsed);
    this.vfx.update(dt, this.engine.pointScale);

    this.hud.update(
      this.phase,
      this.countdown,
      this.youState,
      this.localFlight.stamina,
      speed,
      p,
      this.localFlight.yaw,
      this.input.activeSpell,
      this.input.shieldHeld && (this.youState?.mana ?? 0) > 1,
      this.aliveCount,
      this.zone,
      this.packedEntities,
      this.entityMeta,
      this.localId,
      this.world.getWaypoint(),
    );

    this.engine.render();
  }

  private getCastOrigin(): THREE.Vector3 {
    if (this.engine.isXR || this.input.firstPerson) {
      return this.cockpit.getWandTipWorld();
    }
    const f = this.localFlight;
    return new THREE.Vector3(
      f.pos.x - Math.sin(f.yaw) * 1.15,
      f.pos.y + 0.68 + Math.sin(f.pitch) * 0.7,
      f.pos.z - Math.cos(f.yaw) * 1.15,
    );
  }

  private stepSolo(dt: number): void {
    const sim = this.sim!;
    const me = sim.entities.get(this.localId);

    if (me && me.alive && (sim.phase === 'playing' || sim.phase === 'countdown')) {
      const slowMul = sim.time < me.slowUntil ? 0.5 : 1;
      const impact = stepFlight(me.flight, this.input.flightInput, dt, slowMul);
      const cDmg = crashDamage(impact);
      if (cDmg > 0 && sim.phase === 'playing') sim.applyCrash(this.localId, cDmg);
      me.shielding = this.input.shieldHeld && me.mana > 1;

      if (this.input.wantsCast && sim.phase === 'playing') {
        this.input.wantsCast = false;
        const tip = this.getCastOrigin();
        const dir = this.input.getCastDirection(this.engine.camera);
        if (sim.requestCast(this.localId, this.input.activeSpell, { x: tip.x, y: tip.y, z: tip.z }, { x: dir.x, y: dir.y, z: dir.z })) {
          this.cockpit.triggerCastRecoil();
          this.avatars.get(this.localId)?.triggerCast(this.input.activeSpell);
          this.sound.playCast(this.input.activeSpell);
        }
      }
    } else {
      this.input.wantsCast = false;
    }

    sim.step(dt);
    this.phase = sim.phase;
    this.countdown = sim.countdown;
    this.matchTime = sim.time;
    this.zone = sim.zone;
    this.packedEntities = sim.pack();
    this.youState = sim.you(this.localId);
    this.aliveCount = sim.aliveCount();
    this.processEvents(sim.drainEvents());
  }

  private stepOnline(dt: number): void {
    const alive = this.youState?.alive ?? true;
    if (alive && (this.phase === 'playing' || this.phase === 'countdown')) {
      const slowMul = (this.youState?.slow ?? 0) > 0 ? 0.5 : 1;
      const impact = stepFlight(this.localFlight, this.input.flightInput, dt, slowMul);
      const cDmg = crashDamage(impact);
      if (cDmg > 0 && this.phase === 'playing') this.net.send({ t: 'crash', dmg: cDmg });

      if (this.input.wantsCast && this.phase === 'playing') {
        this.input.wantsCast = false;
        const tip = this.getCastOrigin();
        const dir = this.input.getCastDirection(this.engine.camera);
        this.net.send({
          t: 'cast',
          spell: this.input.activeSpell,
          o: [tip.x, tip.y, tip.z],
          d: [dir.x, dir.y, dir.z],
        });
        this.cockpit.triggerCastRecoil();
        this.avatars.get(this.localId)?.triggerCast(this.input.activeSpell);
        this.sound.playCast(this.input.activeSpell);
      }

      this.netSendAccum += dt;
      if (this.netSendAccum >= 1 / 20) {
        this.netSendAccum = 0;
        const f = this.localFlight;
        this.net.send({
          t: 'state',
          p: [f.pos.x, f.pos.y, f.pos.z],
          v: [f.vel.x, f.vel.y, f.vel.z],
          yaw: f.yaw,
          pitch: f.pitch,
          roll: f.roll,
          shield: this.input.shieldHeld,
          boost: f.boosting,
        });
      }
    } else {
      this.input.wantsCast = false;
    }
  }

  private updateCameraAndCockpit(dt: number, elapsed: number): void {
    const f = this.localFlight;
    const isFirstPerson = this.engine.isXR || this.input.firstPerson;

    this.cockpit.group.visible = isFirstPerson;

    if (this.engine.isXR) {
      // In WebXR VR, place the tracking rig at the broom saddle and rotate by yaw
      this.engine.rig.position.set(f.pos.x, f.pos.y + 0.15, f.pos.z);
      this.engine.rig.rotation.order = 'YXZ';
      this.engine.rig.rotation.set(0, f.yaw, 0);
    } else if (isFirstPerson) {
      this.engine.rig.position.set(f.pos.x, f.pos.y + 0.85, f.pos.z);
      this.engine.rig.rotation.set(0, 0, 0);
      this.engine.camera.position.set(0, 0, 0);
      this.engine.camera.rotation.order = 'YXZ';
      this.engine.camera.rotation.set(f.pitch, f.yaw, f.roll * 0.35);
    } else {
      // Smooth 3rd-person chase camera behind & above the wizard, framing character heroically
      this.engine.rig.position.set(f.pos.x, f.pos.y, f.pos.z);
      this.engine.rig.rotation.set(0, 0, 0);
      this.engine.rig.updateMatrixWorld(true);
      const camDist = f.boosting ? 5.6 : 4.7;
      const lookDir = new THREE.Vector3(
        -Math.sin(f.yaw) * Math.cos(f.pitch),
        Math.sin(f.pitch),
        -Math.cos(f.yaw) * Math.cos(f.pitch),
      );
      this.engine.camera.position.set(
        -lookDir.x * camDist,
        1.55 - lookDir.y * camDist * 0.5,
        -lookDir.z * camDist,
      );
      // Note: Object3D.lookAt expects WORLD coordinates in Three.js
      this.engine.camera.lookAt(
        f.pos.x + lookDir.x * 35,
        f.pos.y + 0.35 + lookDir.y * 35,
        f.pos.z + lookDir.z * 35,
      );
    }

    // Relative angle to safe zone center for the 3D diegetic broom compass
    const angleToZone = Math.atan2(-(this.zone.cx - f.pos.x), -(this.zone.cz - f.pos.z));
    const relZoneAngle = wrapAngle(angleToZone - f.yaw);

    this.cockpit.update(
      dt,
      elapsed,
      this.input.activeSpell,
      this.youState?.hp ?? 100,
      this.youState?.mana ?? 100,
      f.stamina,
      relZoneAngle,
      f.roll,
      this.engine.isXR,
      this.input.getXrWandPose(),
      this.engine.camera,
    );
  }

  private syncAvatars(elapsed: number): void {
    const isFP = this.engine.isXR || this.input.firstPerson;
    for (const e of this.packedEntities) {
      const [id, x, y, z, yaw, pitch, roll, flags, hp] = e;
      const av = this.avatars.get(id);
      if (!av) continue;
      if (id === this.localId) {
        const f = this.localFlight;
        av.update(elapsed, f.pos, f.yaw, f.pitch, f.roll, hp, flags, isFP, this.input.activeSpell);
      } else {
        av.update(elapsed, { x, y, z }, yaw, pitch, roll, hp, flags, false);
      }
    }
  }

  // ---------------------------------------------------------------- Event Processing

  private processEvents(events: SimEvent[]): void {
    for (const ev of events) {
      if (ev.k === 'proj') {
        this.vfx.spawnProjectile(ev.id, ev.spell, ev.x, ev.y, ev.z, ev.vx, ev.vy, ev.vz);
        if (ev.owner !== this.localId) this.sound.playCast(ev.spell);
      } else if (ev.k === 'projEnd') {
        this.vfx.endProjectile(ev.id, ev.spell, ev.x, ev.y, ev.z, ev.hit >= 0);
      } else if (ev.k === 'beam') {
        this.vfx.spawnLightningBeam(ev.x0, ev.y0, ev.z0, ev.x1, ev.y1, ev.z1);
        if (ev.owner !== this.localId) this.sound.playCast('lightning');
      } else if (ev.k === 'dmg') {
        if (ev.target === this.localId) {
          this.sound.playImpact(ev.shielded);
          if (ev.cause !== 'zone') this.hud.flashDamage();
        } else if (ev.by === this.localId) {
          this.sound.playHitConfirm();
          this.hud.flashHitMarker();
        }
      } else if (ev.k === 'loot') {
        this.lootVis.remove(ev.id);
        if (ev.by === this.localId) this.sound.playPickup();
      } else if (ev.k === 'death') {
        const victim = this.entityMeta.get(ev.victim)?.name ?? `Mago #${ev.victim}`;
        const killer =
          ev.killer > 0
            ? (this.entityMeta.get(ev.killer)?.name ?? `Mago #${ev.killer}`)
            : ev.cause === 'zone'
              ? 'Vórtice Arcano'
              : 'Colisión';
        this.hud.pushKillFeed(killer, victim, ev.cause, ev.victim === this.localId || ev.killer === this.localId);

        if (ev.victim === this.localId && !this.endShown) {
          this.endShown = true;
          this.input.unlockPointer();
          this.sound.playEndFanfare(false);
          this.hud.showEndModal(false, ev.placement, this.entityMeta.size, this.youState?.kills ?? 0, killer);
        }
      } else if (ev.k === 'win') {
        if (!this.endShown) {
          this.endShown = true;
          this.input.unlockPointer();
          const won = ev.id === this.localId;
          const winnerName = this.entityMeta.get(ev.id)?.name ?? 'Archimago';
          this.sound.playEndFanfare(won);
          this.hud.showEndModal(won, won ? 1 : 2, this.entityMeta.size, this.youState?.kills ?? 0, winnerName);
        }
      }
    }
  }
}

const app = new BroomRoyaleApp();
void app.init();
