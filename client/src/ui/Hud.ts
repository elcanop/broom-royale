import { PLAYER, SPELLS, SPELL_ORDER, WORLD, type SpellId } from '../../../shared/config';
import { buildLayout } from '../../../shared/layout';
import type { EntityInfo, MatchPhase, PackedEntity, YouState } from '../../../shared/protocol';
import { heightAt, isLake } from '../../../shared/terrain';
import { wrapAngle } from '../../../shared/vec';
import type { ZoneState } from '../../../shared/zone';

export class Hud {
  private readonly hudEl = document.getElementById('hud')!;
  private readonly lobbyEl = document.getElementById('lobby')!;
  private readonly endModalEl = document.getElementById('end-modal')!;
  private readonly endTitleEl = document.getElementById('end-title')!;
  private readonly endSubEl = document.getElementById('end-subtitle')!;
  private readonly endStatsEl = document.getElementById('end-stats')!;

  private readonly aliveEl = document.getElementById('stat-alive')!;
  private readonly killsEl = document.getElementById('stat-kills')!;
  private readonly zonePhaseEl = document.getElementById('stat-zone-phase')!;
  private readonly zoneTimeEl = document.getElementById('stat-zone-time')!;
  private readonly speedEl = document.getElementById('stat-speed')!;
  private readonly altEl = document.getElementById('stat-alt')!;

  private readonly hpFill = document.getElementById('bar-hp')!;
  private readonly hpVal = document.getElementById('val-hp')!;
  private readonly manaFill = document.getElementById('bar-mana')!;
  private readonly manaVal = document.getElementById('val-mana')!;
  private readonly stamFill = document.getElementById('bar-stam')!;
  private readonly stamVal = document.getElementById('val-stam')!;

  private readonly bannerEl = document.getElementById('center-banner')!;
  private readonly killFeedEl = document.getElementById('kill-feed')!;
  private readonly hitMarkerEl = document.getElementById('hit-marker')!;
  private readonly vignetteEl = document.getElementById('screen-vignette')!;
  private readonly spellSlots = new Map<SpellId, HTMLElement>();

  private readonly mapCanvas = document.getElementById('minimap') as HTMLCanvasElement;
  private readonly mapCtx = this.mapCanvas.getContext('2d')!;
  private readonly mapBg = document.createElement('canvas');
  private readonly waypointDistEl = document.getElementById('waypoint-dist');

  constructor(
    onSelectSpell: (s: SpellId) => void,
    onMapNavigate?: (wx: number, wz: number, fastTravel: boolean) => void,
  ) {
    for (const s of SPELL_ORDER) {
      const el = document.querySelector(`[data-spell="${s}"]`) as HTMLElement | null;
      if (el) {
        this.spellSlots.set(s, el);
        el.addEventListener('click', () => onSelectSpell(s));
      }
    }
    this.prerenderMinimapBackground();

    if (onMapNavigate) {
      const eventToWorld = (e: MouseEvent): { wx: number; wz: number } => {
        const rect = this.mapCanvas.getBoundingClientRect();
        const nx = (e.clientX - rect.left) / rect.width;
        const nz = (e.clientY - rect.top) / rect.height;
        const wx = (nx * 2 - 1) * WORLD.half;
        const wz = (nz * 2 - 1) * WORLD.half;
        return { wx, wz };
      };
      this.mapCanvas.addEventListener('click', (e) => {
        const { wx, wz } = eventToWorld(e);
        onMapNavigate(wx, wz, e.shiftKey);
      });
      this.mapCanvas.addEventListener('dblclick', (e) => {
        const { wx, wz } = eventToWorld(e);
        onMapNavigate(wx, wz, true);
      });
    }
  }

  private prerenderMinimapBackground(): void {
    const size = 200;
    this.mapCanvas.width = this.mapCanvas.height = size;
    this.mapBg.width = this.mapBg.height = size;
    const ctx = this.mapBg.getContext('2d')!;
    const img = ctx.createImageData(size, size);

    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const wx = ((px / size) * 2 - 1) * WORLD.half;
        const wz = ((py / size) * 2 - 1) * WORLD.half;
        const h = heightAt(wx, wz);
        let r = 34;
        let g = 58;
        let b = 38;
        if (isLake(wx, wz) || h < WORLD.waterLevel) {
          r = 16;
          g = 42;
          b = 68;
        } else if (h > 175) {
          r = 215;
          g = 222;
          b = 235;
        } else if (h > 75) {
          const k = Math.min(1, (h - 75) / 100);
          r = 55 + k * 75;
          g = 72 + k * 60;
          b = 52 + k * 65;
        } else {
          const k = Math.max(0, h / 75);
          r = 32 + k * 28;
          g = 56 + k * 34;
          b = 34 + k * 20;
        }
        const i = (py * size + px) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Draw Castle & Stadium footprints on the static background
    const toPx = (w: number): number => ((w / WORLD.half + 1) * 0.5) * size;
    const layout = buildLayout();
    ctx.fillStyle = '#d8cfc0';
    for (const b of layout.blocks) {
      ctx.save();
      ctx.translate(toPx(b.x), toPx(b.z));
      ctx.rotate(-b.rot);
      const pw = Math.max(2, (b.w / (WORLD.half * 2)) * size);
      const pd = Math.max(2, (b.d / (WORLD.half * 2)) * size);
      ctx.fillRect(-pw / 2, -pd / 2, pw, pd);
      ctx.restore();
    }
    ctx.fillStyle = '#f2dca0';
    for (const t of layout.towers) {
      ctx.beginPath();
      ctx.arc(toPx(t.x), toPx(t.z), Math.max(1.5, (t.r / (WORLD.half * 2)) * size), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  showLobby(visible: boolean): void {
    this.lobbyEl.classList.toggle('hidden', !visible);
    this.hudEl.classList.toggle('hidden', visible);
    if (visible) this.endModalEl.classList.add('hidden');
  }

  showEndModal(victory: boolean, placement: number, total: number, kills: number, winnerName: string): void {
    this.endModalEl.classList.remove('hidden');
    this.endTitleEl.textContent = victory ? '¡VICTORIA ARCANA!' : 'HAS CAÍDO EN COMBATE';
    this.endTitleEl.className = victory ? 'end-title victory' : 'end-title defeat';
    this.endSubEl.textContent = victory
      ? 'Dominaste los cielos del castillo y sobreviviste al vórtice.'
      : `Campeón del duelo: ${winnerName}`;
    this.endStatsEl.innerHTML = `
      <div class="stat-pill"><span>PUESTO</span><strong>#${placement} / ${total}</strong></div>
      <div class="stat-pill"><span>ELIMINACIONES</span><strong>${kills}</strong></div>
    `;
  }

  hideEndModal(): void {
    this.endModalEl.classList.add('hidden');
  }

  flashHitMarker(): void {
    this.hitMarkerEl.classList.remove('active');
    void this.hitMarkerEl.offsetWidth;
    this.hitMarkerEl.classList.add('active');
  }

  flashDamage(): void {
    this.vignetteEl.classList.add('damage');
    setTimeout(() => this.vignetteEl.classList.remove('damage'), 280);
  }

  pushKillFeed(killerName: string, victimName: string, cause: string, isLocalInvolved: boolean): void {
    const item = document.createElement('div');
    item.className = 'kill-item' + (isLocalInvolved ? ' highlight' : '');
    const spellLabel =
      cause === 'fire'
        ? 'Ignis'
        : cause === 'ice'
          ? 'Glacies'
          : cause === 'lightning'
            ? 'Fulgur'
            : cause === 'zone'
              ? 'Tormenta Arcana'
              : 'Impacto';
    item.innerHTML = `<span class="k-killer">${this.escapeHtml(killerName)}</span> <span class="k-spell">[${spellLabel}]</span> <span class="k-victim">${this.escapeHtml(victimName)}</span>`;
    this.killFeedEl.prepend(item);
    while (this.killFeedEl.children.length > 5) {
      this.killFeedEl.lastElementChild?.remove();
    }
    setTimeout(() => item.remove(), 6500);
  }

  private escapeHtml(str: string): string {
    return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  }

  update(
    phase: MatchPhase,
    countdown: number,
    you: YouState | null,
    stamina: number,
    speed: number,
    pos: { x: number; y: number; z: number },
    yaw: number,
    activeSpell: SpellId,
    shielding: boolean,
    aliveCount: number,
    zone: ZoneState,
    entities: PackedEntity[],
    names: Map<number, EntityInfo>,
    localId: number,
    waypoint: { x: number; z: number } | null = null,
  ): void {
    this.aliveEl.textContent = String(aliveCount);
    this.killsEl.textContent = String(you?.kills ?? 0);
    this.speedEl.textContent = `${Math.round(speed * 3.6)} km/h`;
    this.altEl.textContent = `${Math.max(0, Math.round(pos.y))} m`;

    const mins = Math.floor(zone.timeLeft / 60);
    const secs = Math.floor(zone.timeLeft % 60);
    this.zonePhaseEl.textContent = zone.shrinking
      ? `CERRANDO FASE ${zone.phase + 1}`
      : `TORMENTA FASE ${zone.phase + 1}`;
    this.zoneTimeEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

    // Countdown banner
    if (phase === 'countdown') {
      this.bannerEl.textContent = `DUELO EN ${Math.ceil(countdown)}...`;
      this.bannerEl.classList.remove('hidden');
    } else {
      this.bannerEl.classList.add('hidden');
    }

    if (you) {
      const hpPct = Math.max(0, Math.min(100, (you.hp / PLAYER.maxHp) * 100));
      const manaPct = Math.max(0, Math.min(100, (you.mana / PLAYER.maxMana) * 100));
      const stamPct = Math.max(0, Math.min(100, (stamina / PLAYER.maxStamina) * 100));

      this.hpFill.style.width = `${hpPct}%`;
      this.hpVal.textContent = `${Math.ceil(you.hp)} / ${PLAYER.maxHp}`;
      this.manaFill.style.width = `${manaPct}%`;
      this.manaVal.textContent = `${Math.round(you.mana)} / ${PLAYER.maxMana}`;
      this.stamFill.style.width = `${stamPct}%`;
      this.stamVal.textContent = `${Math.round(stamina)}%`;

      // Outside-zone vignette warning
      const outside = Math.hypot(pos.x - zone.cx, pos.z - zone.cz) > zone.r;
      this.vignetteEl.classList.toggle('storm', outside);

      // Update spell slots
      for (const s of SPELL_ORDER) {
        const slot = this.spellSlots.get(s);
        if (!slot) continue;
        const isActive = s === activeSpell || (s === 'shield' && shielding);
        slot.classList.toggle('active', isActive);
        const cd = you.cds[s] ?? 0;
        const lowMana = you.mana < SPELLS[s].mana;
        slot.classList.toggle('disabled', lowMana && s !== 'shield');
        const cdOverlay = slot.querySelector('.cd-overlay') as HTMLElement | null;
        if (cdOverlay) {
          if (cd > 0.05) {
            const pct = Math.min(100, (cd / SPELLS[s].cooldown) * 100);
            cdOverlay.style.height = `${pct}%`;
            cdOverlay.textContent = cd.toFixed(1);
          } else {
            cdOverlay.style.height = '0%';
            cdOverlay.textContent = '';
          }
        }
      }
    }

    // Draw Minimap
    this.drawMinimap(pos, yaw, zone, entities, localId, waypoint);
    if (this.waypointDistEl) {
      if (waypoint) {
        const dist = Math.round(Math.hypot(waypoint.x - pos.x, waypoint.z - pos.z));
        this.waypointDistEl.textContent = `BALIZA 3D: ${dist} m`;
      } else {
        this.waypointDistEl.textContent = 'Clic en mapa: Ruta 3D';
      }
    }
    void names;
  }

  private drawMinimap(
    pos: { x: number; y: number; z: number },
    yaw: number,
    zone: ZoneState,
    entities: PackedEntity[],
    localId: number,
    waypoint: { x: number; z: number } | null,
  ): void {
    const size = this.mapCanvas.width;
    const ctx = this.mapCtx;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.mapBg, 0, 0);

    const toPx = (w: number): number => ((w / WORLD.half + 1) * 0.5) * size;
    const toRad = (r: number): number => (r / (WORLD.half * 2)) * size;

    // Next safe zone circle
    if (zone.nextR > 1) {
      ctx.strokeStyle = 'rgba(255, 224, 130, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(toPx(zone.nextCx), toPx(zone.nextCz), toRad(zone.nextR), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Current storm zone circle
    ctx.strokeStyle = '#c46bff';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(toPx(zone.cx), toPx(zone.cz), Math.max(1, toRad(zone.r)), 0, Math.PI * 2);
    ctx.stroke();

    // Active 3D Waypoint route line & diamond marker
    const px = toPx(pos.x);
    const pz = toPx(pos.z);
    if (waypoint) {
      const wx = toPx(waypoint.x);
      const wz = toPx(waypoint.z);
      ctx.strokeStyle = 'rgba(56, 232, 255, 0.85)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px, pz);
      ctx.lineTo(wx, wz);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.save();
      ctx.translate(wx, wz);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#38e8ff';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.fillRect(-3.8, -3.8, 7.6, 7.6);
      ctx.strokeRect(-3.8, -3.8, 7.6, 7.6);
      ctx.restore();
    }

    // Enemy/bot dots
    ctx.fillStyle = '#ff4d5e';
    for (const e of entities) {
      const [id, ex, , ez, , , , flags] = e;
      if (id === localId || (flags & 1) === 0) continue;
      ctx.beginPath();
      ctx.arc(toPx(ex), toPx(ez), 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Local player arrow
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-wrapAngle(yaw));
    ctx.fillStyle = '#5cffb0';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

