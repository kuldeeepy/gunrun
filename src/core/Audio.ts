// Procedural SFX + chiptune loop on the Web Audio API. No audio files needed.
export class Audio {
  private static instance: Audio;
  static get(): Audio {
    return (Audio.instance ??= new Audio());
  }
  private constructor() {}

  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private voices = new Map<string, number>(); // per-sound voice cap
  private musicTimer = 0;
  private step = 0;
  private nextNote = 0;
  private intense = false;

  // Must run inside a user gesture (browser autoplay rule).
  unlock() {
    if (this.ctx) { void this.ctx.resume(); return; }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.music = this.ctx.createGain(); this.music.gain.value = 0.32; this.music.connect(this.master);
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, at = 0, dest?: AudioNode) {
    const c = this.ctx!, t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest ?? this.sfx);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private hiss(dur: number, vol: number, freq: number, q = 1, at = 0, type: BiquadFilterType = 'lowpass', dest?: AudioNode) {
    const c = this.ctx!, t = c.currentTime + at;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; s.loop = true; // long sounds (big booms) outlast the 1s buffer
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(dest ?? this.sfx);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  play(event: string) {
    if (!this.ctx) return;
    const [name, arg] = event.split(':'); // e.g. 'kill:7' = 7th kill in the combo
    const n = Number(arg) || 0;
    // Cap simultaneous voices per sound so rapid fire doesn't pile up.
    const now = this.ctx.currentTime, key = name.startsWith('shot') ? 'shot' : name;
    const until = this.voices.get(key) ?? 0;
    if (key === 'shot' || key === 'eshot' || key === 'hit') { if (now < until) return; this.voices.set(key, now + 0.035); }
    const r = 1 + (Math.random() - 0.5) * 0.14; // ±7% pitch variation
    switch (name) {
      // Layered gunshot: transient crack + body + low thump.
      case 'shotR': this.hiss(0.07, 0.35, 3000 * r, 0.7); this.tone('square', 520 * r, 90, 0.08, 0.12); this.tone('sine', 140, 50, 0.08, 0.3); break;
      case 'shotA': this.hiss(0.05, 0.28, 3600 * r, 0.7); this.tone('square', 700 * r, 150, 0.05, 0.09); this.tone('sine', 120, 50, 0.06, 0.22); break;
      case 'shotF': this.hiss(0.12, 0.4, 1800 * r, 0.6); this.tone('sawtooth', 300 * r, 60, 0.12, 0.12); this.tone('sine', 110, 40, 0.12, 0.35); break;
      case 'shotP': this.tone('sawtooth', 1400 * r, 200, 0.14, 0.12); this.tone('square', 2200 * r, 600, 0.1, 0.06); this.tone('sine', 90, 40, 0.1, 0.25); break;
      case 'eshot': this.tone('square', 380 * r, 180, 0.09, 0.07); break;
      case 'bossShot': this.hiss(0.2, 0.35, 900, 0.8); this.tone('sawtooth', 160, 40, 0.25, 0.25); break;
      case 'hit': this.tone('square', 900 * r, 400, 0.03, 0.08); break;
      case 'clink': this.tone('triangle', 2400 * r, 1800, 0.06, 0.12); break;
      case 'die': this.tone('square', 300 * r, 60, 0.18, 0.12); this.hiss(0.12, 0.2, 1500); break;
      case 'pop': this.hiss(0.25, 0.4, 1200 * r); this.tone('sine', 110, 30, 0.25, 0.4); break;
      case 'boom': this.hiss(0.45, 0.6, 900 * r); this.tone('sine', 90, 25, 0.4, 0.6); break;
      case 'bigboom': this.hiss(0.9, 0.8, 600 * r); this.tone('sine', 70, 20, 0.9, 0.8); this.tone('sawtooth', 120, 30, 0.6, 0.15); break;
      case 'stomp': this.tone('sine', 80, 25, 0.5, 0.9); this.hiss(0.4, 0.5, 400); break;
      case 'jump': this.tone('square', 220 * r, 420, 0.08, 0.06); break;
      case 'land': this.hiss(0.06, 0.15, 600); break;
      case 'swap': this.tone('square', 600, 900, 0.05, 0.07); this.tone('square', 900, 1200, 0.05, 0.07, 0.05); break;
      case 'pickup': [523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, 0.09, 0.1, i * 0.06)); break;
      case 'checkpoint': [392, 523, 659].forEach((f, i) => this.tone('triangle', f, f, 0.12, 0.2, i * 0.08)); break;
      case 'death': this.tone('sawtooth', 500, 60, 0.6, 0.18); this.hiss(0.5, 0.5, 800); break;
      case 'respawn': this.tone('triangle', 300, 900, 0.25, 0.15); break;
      case 'splash': this.hiss(0.5, 0.5, 2500, 0.5, 0, 'bandpass'); break;
      case 'shieldDown': [880, 660, 440].forEach((f, i) => this.tone('square', f, f * 0.9, 0.12, 0.12, i * 0.09)); break;
      case 'bossJump': this.tone('sawtooth', 90, 300, 0.4, 0.15); break;
      case 'bossIntro': this.tone('sawtooth', 55, 45, 1.4, 0.3); this.hiss(1.2, 0.3, 300); this.intense = true; break;
      // Combo kill: pitch climbs a semitone per chained kill (capped at an octave).
      case 'kill': { const f = 440 * Math.pow(2, Math.min(n - 1, 12) / 12); this.tone('square', f, f * 1.5, 0.07, 0.08); break; }
      case 'comboEnd': this.tone('triangle', 520, 260, 0.25, 0.1); break;
      case 'tick': { const f = 600 * Math.pow(2, Math.min(n, 12) / 12); this.tone('square', f, f, 0.05, 0.08); break; }
      case 'stamp': this.tone('sine', 90, 40, 0.3, 0.8); this.hiss(0.2, 0.4, 1200); break;
      case 'rankS': [784, 988, 1175, 1568].forEach((f, i) => this.tone('square', f, f, 0.22, 0.12, i * 0.09)); this.hiss(0.6, 0.25, 6000, 1, 0.3, 'highpass'); break;
      case 'clear': this.stopMusic(); [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone('square', f, f, 0.16, 0.12, i * 0.13)); break;
    }
  }

  // Driving 16-step loop in A minor, 150 BPM. Boss adds a faster hat + lead layer.
  startMusic() {
    this.intense = false; // reset even if already playing (e.g. continue after dying at the boss)
    if (!this.ctx || this.musicTimer) return;
    this.step = 0;
    this.nextNote = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.schedule(), 25);
  }

  stopMusic() {
    clearInterval(this.musicTimer);
    this.musicTimer = 0;
  }

  private schedule() {
    const c = this.ctx!;
    const s16 = 60 / 150 / 4;
    const bass = [45, 45, 57, 45, 45, 55, 45, 53, 41, 41, 53, 41, 43, 43, 55, 47];
    const lead = [69, 0, 72, 0, 76, 0, 74, 72, 0, 69, 0, 67, 69, 0, 0, 0, 65, 0, 69, 0, 72, 0, 71, 69, 0, 67, 0, 64, 67, 0, 71, 0];
    const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
    if (this.nextNote < c.currentTime) this.nextNote = c.currentTime + 0.05; // tab was throttled: skip, don't burst
    while (this.nextNote < c.currentTime + 0.12) {
      const at = this.nextNote - c.currentTime, i = this.step % 16, bar = Math.floor(this.step / 16) % 4;
      const shift = bar === 2 ? -4 : bar === 3 ? -2 : 0; // Am - Am - F - G
      this.tone('triangle', hz(bass[i] + shift), hz(bass[i] + shift), s16 * 0.9, 0.5, at, this.music);
      if (i % 4 === 0) { this.tone('sine', 150, 40, 0.12, 0.7, at, this.music); }
      if (i % 8 === 4) this.hiss(0.12, 0.35, 1800, 0.8, at, 'bandpass', this.music);
      if (this.intense || i % 2 === 0) this.hiss(0.03, 0.12, 7000, 1, at, 'highpass', this.music);
      const ln = lead[(this.step % 32)];
      if (ln && (this.intense || bar < 2 || this.step % 64 >= 32)) this.tone('square', hz(ln + shift), hz(ln + shift), s16 * 1.6, 0.1, at, this.music);
      this.nextNote += s16;
      this.step++;
    }
  }
}
