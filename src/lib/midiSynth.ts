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
 * Web Audio Polyphonic Acoustic Piano Engine
 * Uses physical-acoustic modeling:
 * - Trichord string detuning (+-1.4 cents) for lush organic body
 * - Dynamic low-pass filter with velocity & register tracking (brighter on hard hits, mellow on soft)
 * - Percussive felt hammer attack transient
 * - Authentic exponential ring-out decay curve (realistic sustain / legato)
 * - Anti-clipping soft dynamics compressor
 */
export class MidiSynthEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private volume = 0.8;

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

  /**
   * Plays an individual acoustic piano note.
   * Supports an optional sample-accurate `scheduledStartTime`.
   */
  public playNote(
    midi: number,
    velocity = 0.8,
    duration = 0.4,
    scheduledStartTime?: number
  ): void {
    if (midi < 15 || midi > 115) return;

    const ctx = this.initContext();
    if (!this.masterGain) return;

    const now =
      scheduledStartTime !== undefined
        ? Math.max(ctx.currentTime, scheduledStartTime)
        : ctx.currentTime;

    const freq = midiToFreq(midi);
    const velFactor = Math.max(0.1, Math.min(1, velocity));
    // Acoustic piano strings maintain natural resonance; minimum audible ringout is ~0.24s
    const safeDuration = Math.max(0.24, duration);

    // Voice gain envelope node
    const voiceGain = ctx.createGain();

    // 1. Dynamic Lowpass Filter (Acoustic Brightness Tracking)
    // Hard key strikes & higher registers produce brighter overtones; decays darker over time.
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    const baseCutoff = Math.min(12000, Math.max(220, freq * (2.6 + velFactor * 4.2)));
    const endCutoff = Math.min(baseCutoff, Math.max(150, freq * 1.4));

    filter.frequency.setValueAtTime(baseCutoff, now);
    filter.frequency.exponentialRampToValueAtTime(endCutoff, now + Math.min(safeDuration, 1.8));
    filter.Q.setValueAtTime(0.8, now);

    // 2. Piano Trichord Multi-Oscillator Architecture
    // Real acoustic grand pianos have 3 strings per hammer. Micro-detuning creates warm chorusing.
    const oscMain = ctx.createOscillator();
    oscMain.type = "triangle";
    oscMain.frequency.setValueAtTime(freq, now);

    // String 2: Warm sine detuned +1.5 cents
    const oscWarm = ctx.createOscillator();
    oscWarm.type = "sine";
    oscWarm.frequency.setValueAtTime(freq * 1.0009, now);

    // String 3: Octave overtone with soft presence (decays rapidly)
    const oscOver = ctx.createOscillator();
    oscOver.type = "sine";
    oscOver.frequency.setValueAtTime(freq * 2, now);

    const overGain = ctx.createGain();
    overGain.gain.setValueAtTime(0.18 * velFactor, now);
    overGain.gain.exponentialRampToValueAtTime(0.001, now + Math.min(safeDuration * 0.5, 0.4));
    oscOver.connect(overGain);

    // 3. Hammer Strike Transient (Percussive felt contact)
    const hammerAttack = 0.003;
    const peakGain = velFactor * 0.36;
    const dropGain = peakGain * 0.65;

    // Realistic acoustic piano decay curve:
    // Hammer hit -> gentle drop to ringing string body -> warm exponential sustain -> smooth felt damper release
    const ringoutGain = Math.max(
      0.001,
      dropGain * Math.pow(0.5, Math.min(safeDuration, 4.0) / 1.8)
    );
    const damperReleaseTime = 0.28;
    const stopTime = now + safeDuration + damperReleaseTime;

    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.linearRampToValueAtTime(peakGain, now + hammerAttack);
    voiceGain.gain.exponentialRampToValueAtTime(dropGain, now + hammerAttack + 0.04);
    voiceGain.gain.exponentialRampToValueAtTime(ringoutGain, now + safeDuration);
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    // Audio Graph Routing:
    // Oscillators -> Filter -> VoiceGain -> MasterGain -> Compressor -> Destination
    oscMain.connect(filter);
    oscWarm.connect(filter);
    overGain.connect(filter);

    filter.connect(voiceGain);
    voiceGain.connect(this.masterGain);

    // Trigger & Cleanup via native onended
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
      } catch {
        // Already disconnected
      }
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
      const currentSongTime = ctx.currentTime - this.startTime;
      const scheduleHorizon = currentSongTime + scheduleAheadTime;

      while (this.nextNoteIndex < this.notes.length) {
        const note = this.notes[this.nextNoteIndex];
        if (note.time > scheduleHorizon) {
          break; // note is beyond our lookahead horizon
        }

        // Only schedule if the note is still sounding (within current song time)
        if (note.time + note.duration >= currentSongTime - 0.05) {
          const exactAudioTimestamp = Math.max(
            ctx.currentTime,
            this.startTime + note.time
          );
          midiSynth.playNote(
            note.midi,
            note.velocity,
            note.duration,
            exactAudioTimestamp
          );
        }

        this.nextNoteIndex++;
      }

      if (currentSongTime >= this.totalDuration && this.totalDuration > 0) {
        this.stop();
      }
    };

    // Run immediately once, then set periodic timer
    tick();
    this.lookaheadTimer = window.setInterval(tick, intervalMs);
  }

  private stopLookaheadLoop(): void {
    if (this.lookaheadTimer !== null) {
      window.clearInterval(this.lookaheadTimer);
      this.lookaheadTimer = null;
    }
  }

  private startFrameLoop(): void {
    const tick = () => {
      if (!this.isPlaying) return;

      const current = this.getCurrentTime();
      this.onTimeUpdateCallback?.(current);

      if (current >= this.totalDuration && this.totalDuration > 0) {
        this.stop();
        return;
      }

      this.animFrameId = requestAnimationFrame(tick);
    };

    this.animFrameId = requestAnimationFrame(tick);
  }

  private stopFrameLoop(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }
}
