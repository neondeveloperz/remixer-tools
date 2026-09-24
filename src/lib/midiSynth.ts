// [Path: src/lib/midiSynth.ts]

export interface ParsedMidiNote {
  midi: number;
  name: string;
  time: number;
  duration: number;
  velocity: number;
  trackIndex?: number;
  trackName?: string;
}

export interface MidiPlaybackEvent {
  time: number;
  isPlaying: boolean;
}

export type InstrumentType =
  | "grand-piano"
  | "electric-piano"
  | "acoustic-guitar"
  | "electric-bass"
  | "strings"
  | "brass"
  | "synth-lead"
  | "8bit"
  | "marimba"
  | "synth-pad";

export interface InstrumentOption {
  id: InstrumentType;
  name: string;
  icon: string;
  category: string;
}

export const INSTRUMENTS_LIST: InstrumentOption[] = [
  { id: "grand-piano", name: "Grand Piano", icon: "🎹", category: "Keys" },
  { id: "electric-piano", name: "Electric Piano", icon: "🎹", category: "Keys" },
  { id: "acoustic-guitar", name: "Acoustic Guitar", icon: "🎸", category: "Strings" },
  { id: "electric-bass", name: "Electric Bass", icon: "🎸", category: "Bass" },
  { id: "strings", name: "Strings Ensemble", icon: "🎻", category: "Orchestral" },
  { id: "brass", name: "Brass Horns", icon: "🎺", category: "Orchestral" },
  { id: "synth-lead", name: "Synth Lead", icon: "⚡", category: "Synth" },
  { id: "8bit", name: "8-Bit Chiptune", icon: "👾", category: "Synth" },
  { id: "marimba", name: "Marimba / Mallet", icon: "🪵", category: "Percussive" },
  { id: "synth-pad", name: "Ambient Pad", icon: "🌊", category: "Synth" },
];

/**
 * Converts a MIDI note number (0-127) to frequency in Hertz.
 * Standard formula: f = 440 * 2^((d - 69) / 12)
 */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Maps MIDI note numbers to standard musical note names (e.g., 60 -> C4).
 */
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = ((midi % 12) + 12) % 12;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

/**
 * Multi-Instrument Web Audio Synthesizer (Online Sequencer Style)
 * Supports 10 distinct synthesized instrument voices:
 * - Grand Piano, Electric Piano (Rhodes), Acoustic Guitar, Electric Bass,
 *   Strings Ensemble, Brass Horns, Synth Lead, 8-Bit Chiptune, Marimba, Ambient Pad
 */
export class MidiSynthEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private volume = 0.8;
  private currentInstrument: InstrumentType = "grand-piano";

  public initContext(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtxClass();

      // Master gain for user volume slider
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);

      // Dynamics limiter/compressor to prevent clipping on heavy chords
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-4, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(8, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(6, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.12, this.ctx.currentTime);

      this.masterGain.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    return this.ctx;
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  public setInstrument(inst: InstrumentType): void {
    this.currentInstrument = inst;
  }

  public getInstrument(): InstrumentType {
    return this.currentInstrument;
  }

  /**
   * Plays a note using the active instrument (or overridden instrument).
   */
  public playNote(
    midi: number,
    velocity = 0.8,
    duration = 0.4,
    scheduledStartTime?: number,
    instrument?: InstrumentType
  ): void {
    if (midi < 12 || midi > 120) return;

    const ctx = this.initContext();
    if (!this.masterGain) return;

    const now =
      scheduledStartTime !== undefined
        ? Math.max(ctx.currentTime, scheduledStartTime)
        : ctx.currentTime;

    const freq = midiToFreq(midi);
    const velFactor = Math.max(0.15, Math.min(1, velocity));
    const inst = instrument || this.currentInstrument;

    switch (inst) {
      case "electric-piano":
        this.playElectricPianoNote(ctx, now, freq, velFactor, duration);
        break;
      case "acoustic-guitar":
        this.playGuitarNote(ctx, now, freq, velFactor, duration);
        break;
      case "electric-bass":
        this.playBassNote(ctx, now, freq, velFactor, duration);
        break;
      case "strings":
        this.playStringsNote(ctx, now, freq, velFactor, duration);
        break;
      case "brass":
        this.playBrassNote(ctx, now, freq, velFactor, duration);
        break;
      case "synth-lead":
        this.playSynthLeadNote(ctx, now, freq, velFactor, duration);
        break;
      case "8bit":
        this.play8BitNote(ctx, now, freq, velFactor, duration);
        break;
      case "marimba":
        this.playMarimbaNote(ctx, now, freq, velFactor, duration);
        break;
      case "synth-pad":
        this.playPadNote(ctx, now, freq, velFactor, duration);
        break;
      case "grand-piano":
      default:
        this.playPianoNote(ctx, now, freq, velFactor, duration);
        break;
    }
  }

  // 1. Grand Piano
  private playPianoNote(ctx: AudioContext, now: number, freq: number, vel: number, duration: number) {
    const safeDuration = Math.max(0.22, duration);
    const voiceGain = ctx.createGain();

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    const baseCutoff = Math.min(12000, Math.max(240, freq * (2.6 + vel * 4.2)));
    const endCutoff = Math.min(baseCutoff, Math.max(160, freq * 1.4));
    filter.frequency.setValueAtTime(baseCutoff, now);
    filter.frequency.exponentialRampToValueAtTime(endCutoff, now + Math.min(safeDuration, 1.6));
    filter.Q.setValueAtTime(0.8, now);

    const oscMain = ctx.createOscillator();
    oscMain.type = "triangle";
    oscMain.frequency.setValueAtTime(freq, now);

    const oscWarm = ctx.createOscillator();
    oscWarm.type = "sine";
    oscWarm.frequency.setValueAtTime(freq * 1.001, now);

    const oscOver = ctx.createOscillator();
    oscOver.type = "sine";
    oscOver.frequency.setValueAtTime(freq * 2, now);
    const overGain = ctx.createGain();
    overGain.gain.setValueAtTime(0.18 * vel, now);
    overGain.gain.exponentialRampToValueAtTime(0.001, now + Math.min(safeDuration * 0.5, 0.35));
    oscOver.connect(overGain);

    const hammerAttack = 0.003;
    const peakGain = vel * 0.38;
    const dropGain = peakGain * 0.65;
    const ringoutGain = Math.max(0.001, dropGain * Math.pow(0.5, Math.min(safeDuration, 4.0) / 1.8));
    const stopTime = now + safeDuration + 0.25;

    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.linearRampToValueAtTime(peakGain, now + hammerAttack);
    voiceGain.gain.exponentialRampToValueAtTime(dropGain, now + hammerAttack + 0.04);
    voiceGain.gain.exponentialRampToValueAtTime(ringoutGain, now + safeDuration);
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    oscMain.connect(filter);
    oscWarm.connect(filter);
    overGain.connect(filter);
    filter.connect(voiceGain);
    voiceGain.connect(this.masterGain!);

    oscMain.start(now);
    oscWarm.start(now);
    oscOver.start(now);
    oscMain.stop(stopTime + 0.05);
    oscWarm.stop(stopTime + 0.05);
    oscOver.stop(stopTime + 0.05);

    oscMain.onended = () => {
      try {
        oscMain.disconnect();
        oscWarm.disconnect();
        oscOver.disconnect();
        overGain.disconnect();
        filter.disconnect();
        voiceGain.disconnect();
      } catch {}
    };
  }

  // 2. Electric Piano (Rhodes / Tine Bell)
  private playElectricPianoNote(ctx: AudioContext, now: number, freq: number, vel: number, duration: number) {
    const safeDuration = Math.max(0.25, duration);
    const voiceGain = ctx.createGain();

    const oscMain = ctx.createOscillator();
    oscMain.type = "sine";
    oscMain.frequency.setValueAtTime(freq, now);

    // Bell Tine (4x frequency)
    const oscTine = ctx.createOscillator();
    oscTine.type = "sine";
    oscTine.frequency.setValueAtTime(freq * 4, now);
    const tineGain = ctx.createGain();
    tineGain.gain.setValueAtTime(vel * 0.28, now);
    tineGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    oscTine.connect(tineGain);

    const peakGain = vel * 0.42;
    const stopTime = now + safeDuration + 0.3;

    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.linearRampToValueAtTime(peakGain, now + 0.006);
    voiceGain.gain.exponentialRampToValueAtTime(peakGain * 0.5, now + 0.12);
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    oscMain.connect(voiceGain);
    tineGain.connect(voiceGain);
    voiceGain.connect(this.masterGain!);

    oscMain.start(now);
    oscTine.start(now);
    oscMain.stop(stopTime + 0.05);
    oscTine.stop(now + 0.18);

    oscMain.onended = () => {
      try {
        oscMain.disconnect();
        oscTine.disconnect();
        tineGain.disconnect();
        voiceGain.disconnect();
      } catch {}
    };
  }

  // 3. Acoustic Guitar (Plucked String)
  private playGuitarNote(ctx: AudioContext, now: number, freq: number, vel: number, duration: number) {
    const safeDuration = Math.max(0.18, duration);
    const voiceGain = ctx.createGain();

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(Math.min(5000, freq * 3.2), now);
    filter.Q.setValueAtTime(1.5, now);

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, now);

    const oscBody = ctx.createOscillator();
    oscBody.type = "triangle";
    oscBody.frequency.setValueAtTime(freq, now);

    const peakGain = vel * 0.35;
    const stopTime = now + safeDuration + 0.2;

    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.linearRampToValueAtTime(peakGain, now + 0.004);
    voiceGain.gain.exponentialRampToValueAtTime(peakGain * 0.4, now + 0.08);
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    osc.connect(filter);
    oscBody.connect(voiceGain);
    filter.connect(voiceGain);
    voiceGain.connect(this.masterGain!);

    osc.start(now);
    oscBody.start(now);
    osc.stop(stopTime + 0.05);
    oscBody.stop(stopTime + 0.05);

    osc.onended = () => {
      try {
        osc.disconnect();
        oscBody.disconnect();
        filter.disconnect();
        voiceGain.disconnect();
      } catch {}
    };
  }

  // 4. Electric Bass
  private playBassNote(ctx: AudioContext, now: number, freq: number, vel: number, duration: number) {
    const safeDuration = Math.max(0.2, duration);
    const voiceGain = ctx.createGain();

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(Math.max(freq * 1.5, Math.min(1200, freq * 3.5)), now);
    filter.Q.setValueAtTime(2.0, now);

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, now);

    const oscSub = ctx.createOscillator();
    oscSub.type = "triangle";
    oscSub.frequency.setValueAtTime(freq * 0.5, now);

    const peakGain = vel * 0.45;
    const stopTime = now + safeDuration + 0.18;

    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.linearRampToValueAtTime(peakGain, now + 0.008);
    voiceGain.gain.exponentialRampToValueAtTime(peakGain * 0.65, now + 0.09);
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    osc.connect(filter);
    oscSub.connect(voiceGain);
    filter.connect(voiceGain);
    voiceGain.connect(this.masterGain!);

    osc.start(now);
    oscSub.start(now);
    osc.stop(stopTime + 0.05);
    oscSub.stop(stopTime + 0.05);

    osc.onended = () => {
      try {
        osc.disconnect();
        oscSub.disconnect();
        filter.disconnect();
        voiceGain.disconnect();
      } catch {}
    };
  }

  // 5. Strings Ensemble (Lush Orchestral)
  private playStringsNote(ctx: AudioContext, now: number, freq: number, vel: number, duration: number) {
    const safeDuration = Math.max(0.3, duration);
    const voiceGain = ctx.createGain();

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(Math.min(4500, freq * 4), now);

    const osc1 = ctx.createOscillator();
    osc1.type = "sawtooth";
    osc1.frequency.setValueAtTime(freq * 0.998, now);

    const osc2 = ctx.createOscillator();
    osc2.type = "sawtooth";
    osc2.frequency.setValueAtTime(freq * 1.002, now);

    const peakGain = vel * 0.28;
    const attack = 0.07;
    const stopTime = now + safeDuration + 0.35;

    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.linearRampToValueAtTime(peakGain, now + attack);
    voiceGain.gain.setValueAtTime(peakGain * 0.85, now + safeDuration);
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(voiceGain);
    voiceGain.connect(this.masterGain!);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(stopTime + 0.05);
    osc2.stop(stopTime + 0.05);

    osc1.onended = () => {
      try {
        osc1.disconnect();
        osc2.disconnect();
        filter.disconnect();
        voiceGain.disconnect();
      } catch {}
    };
  }

  // 6. Brass Horns (Punchy Horn Bite)
  private playBrassNote(ctx: AudioContext, now: number, freq: number, vel: number, duration: number) {
    const safeDuration = Math.max(0.22, duration);
    const voiceGain = ctx.createGain();

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(freq * 1.4, now);
    filter.frequency.linearRampToValueAtTime(Math.min(7500, freq * 4.8), now + 0.04);
    filter.frequency.exponentialRampToValueAtTime(Math.min(4000, freq * 2.5), now + 0.15);
    filter.Q.setValueAtTime(2.2, now);

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, now);

    const peakGain = vel * 0.36;
    const stopTime = now + safeDuration + 0.2;

    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.linearRampToValueAtTime(peakGain, now + 0.025);
    voiceGain.gain.setValueAtTime(peakGain * 0.75, now + safeDuration);
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    osc.connect(filter);
    filter.connect(voiceGain);
    voiceGain.connect(this.masterGain!);

    osc.start(now);
    osc.stop(stopTime + 0.05);

    osc.onended = () => {
      try {
        osc.disconnect();
        filter.disconnect();
        voiceGain.disconnect();
      } catch {}
    };
  }

  // 7. Synth Lead (EDM / Pop)
  private playSynthLeadNote(ctx: AudioContext, now: number, freq: number, vel: number, duration: number) {
    const safeDuration = Math.max(0.18, duration);
    const voiceGain = ctx.createGain();

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(Math.min(10000, freq * 6), now);
    filter.frequency.exponentialRampToValueAtTime(Math.min(3000, freq * 2.2), now + 0.12);
    filter.Q.setValueAtTime(3.5, now);

    const osc1 = ctx.createOscillator();
    osc1.type = "sawtooth";
    osc1.frequency.setValueAtTime(freq, now);

    const osc2 = ctx.createOscillator();
    osc2.type = "square";
    osc2.frequency.setValueAtTime(freq * 1.002, now);

    const peakGain = vel * 0.32;
    const stopTime = now + safeDuration + 0.15;

    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.linearRampToValueAtTime(peakGain, now + 0.005);
    voiceGain.gain.setValueAtTime(peakGain * 0.7, now + safeDuration);
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(voiceGain);
    voiceGain.connect(this.masterGain!);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(stopTime + 0.05);
    osc2.stop(stopTime + 0.05);

    osc1.onended = () => {
      try {
        osc1.disconnect();
        osc2.disconnect();
        filter.disconnect();
        voiceGain.disconnect();
      } catch {}
    };
  }

  // 8. 8-Bit Chiptune (Retro Arcade)
  private play8BitNote(ctx: AudioContext, now: number, freq: number, vel: number, duration: number) {
    const safeDuration = Math.max(0.12, duration);
    const voiceGain = ctx.createGain();

    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(freq, now);

    const peakGain = vel * 0.28;
    const stopTime = now + safeDuration + 0.08;

    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.setValueAtTime(peakGain, now + 0.002);
    voiceGain.gain.exponentialRampToValueAtTime(peakGain * 0.5, now + 0.06);
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    osc.connect(voiceGain);
    voiceGain.connect(this.masterGain!);

    osc.start(now);
    osc.stop(stopTime + 0.03);

    osc.onended = () => {
      try {
        osc.disconnect();
        voiceGain.disconnect();
      } catch {}
    };
  }

  // 9. Marimba / Mallet (Wooden Percussive)
  private playMarimbaNote(ctx: AudioContext, now: number, freq: number, vel: number, duration: number) {
    const safeDuration = Math.max(0.15, duration);
    const voiceGain = ctx.createGain();

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);

    // Overtone (4x) for wooden bar resonance
    const oscOvertone = ctx.createOscillator();
    oscOvertone.type = "sine";
    oscOvertone.frequency.setValueAtTime(freq * 3.98, now);
    const overGain = ctx.createGain();
    overGain.gain.setValueAtTime(vel * 0.3, now);
    overGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    oscOvertone.connect(overGain);

    const peakGain = vel * 0.42;
    const stopTime = now + Math.min(safeDuration, 1.2) + 0.15;

    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.linearRampToValueAtTime(peakGain, now + 0.002);
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    osc.connect(voiceGain);
    overGain.connect(voiceGain);
    voiceGain.connect(this.masterGain!);

    osc.start(now);
    oscOvertone.start(now);
    osc.stop(stopTime + 0.05);
    oscOvertone.stop(now + 0.08);

    osc.onended = () => {
      try {
        osc.disconnect();
        oscOvertone.disconnect();
        overGain.disconnect();
        voiceGain.disconnect();
      } catch {}
    };
  }

  // 10. Ambient Pad (Warm Dreamy)
  private playPadNote(ctx: AudioContext, now: number, freq: number, vel: number, duration: number) {
    const safeDuration = Math.max(0.35, duration);
    const voiceGain = ctx.createGain();

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(Math.min(3200, freq * 3.0), now);

    const osc1 = ctx.createOscillator();
    osc1.type = "triangle";
    osc1.frequency.setValueAtTime(freq * 0.998, now);

    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(freq * 1.002, now);

    const peakGain = vel * 0.32;
    const attack = 0.16;
    const stopTime = now + safeDuration + 0.55;

    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.linearRampToValueAtTime(peakGain, now + attack);
    voiceGain.gain.setValueAtTime(peakGain * 0.8, now + safeDuration);
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(voiceGain);
    voiceGain.connect(this.masterGain!);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(stopTime + 0.05);
    osc2.stop(stopTime + 0.05);

    osc1.onended = () => {
      try {
        osc1.disconnect();
        osc2.disconnect();
        filter.disconnect();
        voiceGain.disconnect();
      } catch {}
    };
  }

  public getContext(): AudioContext {
    return this.initContext();
  }
}

export const midiSynth = new MidiSynthEngine();

/**
 * High-Precision Sample-Accurate MIDI Sequencer
 * Uses Web Audio API lookahead scheduling:
 * - Decouples audio scheduling from main-thread UI
 * - Rock-solid timing with 0ms timer drift for fast alternating notes (สลับ) and held chords (ลาก)
 * - 60 FPS requestAnimationFrame for visual playhead movement
 */
export class MidiSequencer {
  private notes: ParsedMidiNote[] = [];
  private isPlaying = false;
  private startTime = 0; // AudioContext timeline time of song zero
  private pausedAt = 0;
  private totalDuration = 0;
  private nextNoteIndex = 0;
  private lookaheadTimer: number | null = null;
  private animFrameId: number | null = null;
  private onTimeUpdateCallback: ((time: number) => void) | null = null;
  private onPlayStateChangeCallback: ((playing: boolean) => void) | null = null;

  constructor(notes: ParsedMidiNote[] = [], totalDuration = 0) {
    this.setNotes(notes, totalDuration);
  }

  public setNotes(notes: ParsedMidiNote[], totalDuration = 0): void {
    this.stop();
    this.notes = [...notes].sort((a, b) => a.time - b.time);
    this.totalDuration =
      totalDuration ||
      (this.notes.length > 0
        ? Math.max(...this.notes.map((n) => n.time + n.duration))
        : 0);
  }

  public onTimeUpdate(cb: (time: number) => void): () => void {
    this.onTimeUpdateCallback = cb;
    return () => {
      this.onTimeUpdateCallback = null;
    };
  }

  public onPlayStateChange(cb: (playing: boolean) => void): () => void {
    this.onPlayStateChangeCallback = cb;
    return () => {
      this.onPlayStateChangeCallback = null;
    };
  }

  public play(startOffset?: number): void {
    if (this.isPlaying) return;
    if (this.notes.length === 0) return;

    const ctx = midiSynth.initContext();
    const offset = startOffset !== undefined ? startOffset : this.pausedAt;

    if (offset >= this.totalDuration && this.totalDuration > 0) {
      this.pausedAt = 0;
    }

    this.isPlaying = true;
    this.startTime = ctx.currentTime - this.pausedAt;
    this.locateNextNoteIndex(this.pausedAt);

    this.onPlayStateChangeCallback?.(true);

    // Start precision lookahead audio loop (every 25ms)
    this.startLookaheadLoop();

    // Start 60fps UI playhead animation loop
    this.startFrameLoop();
  }

  public pause(): void {
    if (!this.isPlaying) return;

    const ctx = midiSynth.getContext();
    this.pausedAt = Math.max(0, ctx.currentTime - this.startTime);

    this.stopLookaheadLoop();
    this.isPlaying = false;
    this.stopFrameLoop();
    this.onPlayStateChangeCallback?.(false);
  }

  public stop(): void {
    this.stopLookaheadLoop();
    this.isPlaying = false;
    this.pausedAt = 0;
    this.nextNoteIndex = 0;
    this.stopFrameLoop();
    this.onPlayStateChangeCallback?.(false);
    this.onTimeUpdateCallback?.(0);
  }

  public seek(targetTime: number): void {
    const clamped = Math.max(0, Math.min(this.totalDuration, targetTime));
    this.pausedAt = clamped;
    this.locateNextNoteIndex(clamped);
    this.onTimeUpdateCallback?.(clamped);

    if (this.isPlaying) {
      const ctx = midiSynth.getContext();
      this.startTime = ctx.currentTime - clamped;
    }
  }

  public getCurrentTime(): number {
    if (!this.isPlaying) return this.pausedAt;
    const ctx = midiSynth.getContext();
    return Math.max(0, ctx.currentTime - this.startTime);
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Fast binary search to find the next note index for seeking
   */
  private locateNextNoteIndex(time: number): void {
    let low = 0;
    let high = this.notes.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.notes[mid].time < time) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    this.nextNoteIndex = low;
  }

  /**
   * Sample-accurate lookahead scheduling loop
   * Inspects upcoming notes in a 120ms window and schedules them directly on the Web Audio clock.
   */
  private startLookaheadLoop(): void {
    this.stopLookaheadLoop();

    const scheduleAheadTime = 0.12; // 120ms lookahead
    const intervalMs = 25; // tick every 25ms

    const tick = () => {
      if (!this.isPlaying) return;

      const ctx = midiSynth.getContext();
      const currentAudioTime = ctx.currentTime;
      const songCurrentTime = currentAudioTime - this.startTime;

      while (
        this.nextNoteIndex < this.notes.length &&
        this.notes[this.nextNoteIndex].time < songCurrentTime + scheduleAheadTime
      ) {
        const note = this.notes[this.nextNoteIndex];
        const scheduledTime = this.startTime + note.time;

        if (scheduledTime >= currentAudioTime - 0.02) {
          midiSynth.playNote(note.midi, note.velocity, note.duration, scheduledTime);
        }
        this.nextNoteIndex++;
      }

      // Check if song has completed
      if (songCurrentTime > this.totalDuration + 0.5) {
        this.stop();
        return;
      }

      this.lookaheadTimer = window.setTimeout(tick, intervalMs);
    };

    tick();
  }

  private stopLookaheadLoop(): void {
    if (this.lookaheadTimer !== null) {
      clearTimeout(this.lookaheadTimer);
      this.lookaheadTimer = null;
    }
  }

  /**
   * 60 FPS requestAnimationFrame loop for ultra-smooth playhead animation
   */
  private startFrameLoop(): void {
    this.stopFrameLoop();

    const frame = () => {
      if (!this.isPlaying) return;
      const t = this.getCurrentTime();
      this.onTimeUpdateCallback?.(t);
      this.animFrameId = requestAnimationFrame(frame);
    };

    this.animFrameId = requestAnimationFrame(frame);
  }

  private stopFrameLoop(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }
}
