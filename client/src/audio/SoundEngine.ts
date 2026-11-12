import type { SpellId } from '../../../shared/config';

/**
 * Procedural WebAudio API Synthesizer (`SoundEngine`).
 * Produces continuous flight wind/broom turbulence and spell/combat SFX with zero external audio files.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  /** Initialize on first user interaction (required by browser autoplay policies). */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.45;
    this.master.connect(this.ctx.destination);

    // Precompute 2-second white/pink noise buffer
    const sr = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, sr * 2, sr);
    const data = this.noiseBuf.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029;
      b1 = 0.985 * b1 + w * 0.032;
      b2 = 0.95 * b2 + w * 0.048;
      data[i] = (b0 + b1 + b2 + w * 0.18) * 0.5;
    }

    // Continuous flight wind loop
    const windSrc = this.ctx.createBufferSource();
    windSrc.buffer = this.noiseBuf;
    windSrc.loop = true;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 240;
    this.windFilter.Q.value = 1.4;

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.02;

    windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    windSrc.start();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.45, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  /** Modulate wind rush by current broom speed and boost state. */
  updateFlightWind(speed: number, boosting: boolean): void {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const norm = Math.min(1, speed / 75);
    const freq = 180 + norm * 620 + (boosting ? 260 : 0);
    const gain = 0.015 + norm * 0.16 + (boosting ? 0.08 : 0);
    this.windFilter.frequency.setTargetAtTime(freq, t, 0.08);
    this.windGain.gain.setTargetAtTime(gain, t, 0.08);
  }

  playCast(spell: SpellId): void {
    if (!this.ctx || !this.noiseBuf || this.muted) return;
    const now = this.ctx.currentTime;

    if (spell === 'fire') {
      // Ignis: deep flame whoosh + crackle
      this.noiseBurst(220, 95, 0.36, 0.34, 'lowpass');
      this.tone(170, 58, 0.28, 0.24, 'sawtooth');
    } else if (spell === 'ice') {
      // Glacies: crystalline high-pitched chime + frost hiss
      this.tone(1280, 1920, 0.16, 0.18, 'triangle');
      this.tone(1760, 880, 0.22, 0.14, 'sine');
      this.noiseBurst(2800, 4200, 0.15, 0.16, 'bandpass');
    } else if (spell === 'lightning') {
      // Fulgur: thunder crack + electric zap
      this.noiseBurst(1100, 140, 0.52, 0.48, 'bandpass');
      this.tone(540, 65, 0.35, 0.32, 'sawtooth');
    } else if (spell === 'shield') {
      // Scutum: golden harmonic chord
      this.tone(330, 440, 0.28, 0.15, 'sine');
      this.tone(495, 660, 0.28, 0.12, 'triangle');
    }
    void now;
  }

  playImpact(shielded = false): void {
    if (!this.ctx || this.muted) return;
    if (shielded) {
      this.tone(580, 290, 0.22, 0.22, 'triangle');
    } else {
      this.noiseBurst(380, 80, 0.24, 0.28, 'lowpass');
      this.tone(120, 45, 0.18, 0.24, 'sine');
    }
  }

  playHitConfirm(): void {
    if (!this.ctx || this.muted) return;
    this.tone(880, 1320, 0.09, 0.18, 'sine');
  }

  playPickup(): void {
    if (!this.ctx || this.muted) return;
    this.tone(523.25, 659.25, 0.14, 0.18, 'sine');
    setTimeout(() => this.tone(659.25, 1046.5, 0.22, 0.2, 'triangle'), 90);
  }

  playEndFanfare(victory: boolean): void {
    if (!this.ctx || this.muted) return;
    const notes = victory ? [523.25, 659.25, 783.99, 1046.5] : [392.0, 349.23, 311.13, 261.63];
    notes.forEach((f, i) => {
      setTimeout(() => this.tone(f, f * 1.01, 0.38, 0.22, 'triangle'), i * 140);
    });
  }

  private tone(
    fStart: number,
    fEnd: number,
    dur: number,
    vol: number,
    type: OscillatorType,
  ): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fStart, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, fEnd), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur);
  }

  private noiseBurst(
    fStart: number,
    fEnd: number,
    dur: number,
    vol: number,
    filterType: BiquadFilterType,
  ): void {
    if (!this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(fStart, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, fEnd), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }
}

