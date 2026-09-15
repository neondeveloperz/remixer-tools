import { convertFileSrc } from "@tauri-apps/api/core";

export interface TrackData {
  key: string;
  name: string;
  path: string;
  isUrl?: boolean;
}

export interface TrackControlState {
  volume: number; // 0 to 1
  muted: boolean;
  solo: boolean;
}

export interface LoadedTrackBuffer {
  key: string;
  name: string;
  path: string;
  buffer: AudioBuffer;
  peaks: Float32Array; // Normalized amplitude peaks (0..1)
  duration: number;
}

/**
 * Extracts normalized peaks from an AudioBuffer for high-performance waveform rendering.
 * Computes `numPoints` peaks across the buffer duration.
 */
export function extractWaveformPeaks(buffer: AudioBuffer, numPoints = 800): Float32Array {
  const channelData = buffer.getChannelData(0);
  const totalSamples = channelData.length;
  const blockSize = Math.max(1, Math.floor(totalSamples / numPoints));
  const peaks = new Float32Array(numPoints);

  for (let i = 0; i < numPoints; i++) {
    const start = i * blockSize;
    const end = Math.min(start + blockSize, totalSamples);
    let max = 0;
    for (let j = start; j < end; j++) {
      const val = Math.abs(channelData[j]);
      if (val > max) max = val;
    }
    peaks[i] = max;
  }

  // Find max peak to normalize amplitudes nicely
  let globalMax = 0;
  for (let i = 0; i < numPoints; i++) {
    if (peaks[i] > globalMax) globalMax = peaks[i];
  }
  if (globalMax > 0.01) {
    const scale = 1 / globalMax;
    for (let i = 0; i < numPoints; i++) {
      peaks[i] = Math.min(1, peaks[i] * scale);
    }
  }

  return peaks;
}

/**
 * WebAudioMultiTrackEngine
 * Provides sample-accurate, zero-drift hardware-synchronized multi-track audio playback.
 * All tracks are locked to a single AudioContext hardware timeline.
 */
export class WebAudioMultiTrackEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  private tracks: TrackData[] = [];
  private buffers = new Map<string, AudioBuffer>();
  private peaksMap = new Map<string, Float32Array>();
  private trackStates = new Map<string, TrackControlState>();

  private activeSources = new Map<string, AudioBufferSourceNode>();
  private activeGains = new Map<string, GainNode>();

  private isPlaying = false;
  private playbackStartedAt = 0;
  private playbackOffset = 0;
  private maxDuration = 0;
  private masterVolume = 1;
  private isMasterMuted = false;

  private rafId: number | null = null;
  private timeUpdateCallbacks = new Set<(time: number) => void>();
  private stateChangeCallbacks = new Set<(isPlaying: boolean) => void>();
  private buffersLoadedCallbacks = new Set<(peaks: Record<string, Float32Array>, duration: number) => void>();

  constructor() {
    // AudioContext will be initialized on first user interaction or load
  }

  private getContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(1, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public async loadTracks(
    newTracks: TrackData[],
    initialStates?: Record<string, TrackControlState>
  ): Promise<Record<string, Float32Array>> {
    this.stop();
    this.playbackOffset = 0;
    this.maxDuration = 0;
    this.tracks = newTracks;
    this.buffers.clear();
    this.peaksMap.clear();

    if (initialStates) {
      this.trackStates.clear();
      Object.entries(initialStates).forEach(([key, state]) => {
        this.trackStates.set(key, state);
      });
    }

    if (newTracks.length === 0) {
      this.notifyBuffersLoaded();
      return {};
    }

    const ctx = this.getContext();

    // Load each track audio buffer in parallel
    await Promise.all(
      newTracks.map(async (track) => {
        try {
          let arrayBuffer: ArrayBuffer;

          if (track.isUrl || track.path.startsWith("http://") || track.path.startsWith("https://")) {
            const res = await fetch(track.path);
            arrayBuffer = await res.arrayBuffer();
          } else {
            // First try direct file reading via @tauri-apps/plugin-fs
            try {
              const { readFile } = await import("@tauri-apps/plugin-fs");
              const bytes = await readFile(track.path);
              arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            } catch {
              // Fallback to Tauri asset protocol via convertFileSrc
              const fileUrl = convertFileSrc(track.path);
              const res = await fetch(fileUrl);
              arrayBuffer = await res.arrayBuffer();
            }
          }

          const decoded = await ctx.decodeAudioData(arrayBuffer);
          this.buffers.set(track.key, decoded);
          const peaks = extractWaveformPeaks(decoded, 800);
          this.peaksMap.set(track.key, peaks);

          if (decoded.duration > this.maxDuration) {
            this.maxDuration = decoded.duration;
          }
        } catch (err) {
          console.error(`Failed to load/decode audio for track ${track.key} (${track.path}):`, err);
        }
      })
    );

    this.notifyBuffersLoaded();
    return this.getPeaksObject();
  }

  public getPeaksObject(): Record<string, Float32Array> {
    const obj: Record<string, Float32Array> = {};
    this.peaksMap.forEach((peaks, key) => {
      obj[key] = peaks;
    });
    return obj;
  }

  public getDuration(): number {
    return this.maxDuration;
  }

  public getCurrentTime(): number {
    if (!this.isPlaying || !this.ctx) return this.playbackOffset;
    const elapsed = Math.max(0, this.ctx.currentTime - this.playbackStartedAt);
    const current = this.playbackOffset + elapsed;
    if (current >= this.maxDuration && this.maxDuration > 0) {
      return this.maxDuration;
    }
    return current;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public updateTrackState(key: string, update: Partial<TrackControlState>) {
    const current = this.trackStates.get(key) || { volume: 1, muted: false, solo: false };
    const updated = { ...current, ...update };
    this.trackStates.set(key, updated);
    this.syncGains();
  }

  public setTrackStates(states: Record<string, TrackControlState>) {
    Object.entries(states).forEach(([k, s]) => {
      this.trackStates.set(k, s);
    });
    this.syncGains();
  }

  private syncGains() {
    if (!this.ctx) return;
    const hasSolo = Array.from(this.trackStates.values()).some((s) => s.solo);

    this.tracks.forEach((track) => {
      const gainNode = this.activeGains.get(track.key);
      if (!gainNode) return;

      const state = this.trackStates.get(track.key) || { volume: 1, muted: false, solo: false };
      const isAudible = hasSolo ? state.solo : !state.muted;
      const targetGain = isAudible ? Math.max(0, Math.min(1, state.volume)) : 0;

      // Smooth gain transition to prevent audio clicks
      gainNode.gain.setTargetAtTime(targetGain, this.ctx!.currentTime, 0.015);
    });
  }

  public setMasterVolume(vol: number) {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    this.syncMasterGain();
  }

  public getMasterVolume(): number {
    return this.masterVolume;
  }

  public setMasterMuted(muted: boolean) {
    this.isMasterMuted = muted;
    this.syncMasterGain();
  }

  public getIsMasterMuted(): boolean {
    return this.isMasterMuted;
  }

  private syncMasterGain() {
    if (!this.masterGain || !this.ctx) return;
    const target = this.isMasterMuted ? 0 : this.masterVolume;
    this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
  }

  public async play(offset?: number) {
    const ctx = this.getContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    this.stopActiveSources();

    if (offset !== undefined) {
      this.playbackOffset = Math.max(0, Math.min(offset, this.maxDuration));
    } else if (this.playbackOffset >= this.maxDuration && this.maxDuration > 0) {
      this.playbackOffset = 0;
    }

    // Schedule 25ms in advance so the hardware audio thread starts all tracks on the EXACT same sample
    const scheduleTime = ctx.currentTime + 0.025;
    this.playbackStartedAt = scheduleTime;

    const hasSolo = Array.from(this.trackStates.values()).some((s) => s.solo);

    this.tracks.forEach((track) => {
      const buffer = this.buffers.get(track.key);
      if (!buffer) return;

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      const gainNode = ctx.createGain();
      const state = this.trackStates.get(track.key) || { volume: 1, muted: false, solo: false };
      const isAudible = hasSolo ? state.solo : !state.muted;
      const initialGain = isAudible ? Math.max(0, Math.min(1, state.volume)) : 0;

      gainNode.gain.setValueAtTime(initialGain, scheduleTime);

      source.connect(gainNode);
      if (this.masterGain) {
        gainNode.connect(this.masterGain);
      } else {
        gainNode.connect(ctx.destination);
      }

      source.start(scheduleTime, this.playbackOffset);

      this.activeSources.set(track.key, source);
      this.activeGains.set(track.key, gainNode);
    });

    this.isPlaying = true;
    this.notifyStateChange(true);
    this.startTimeLoop();
  }

  public pause() {
    if (!this.isPlaying) return;
    if (this.ctx) {
      const elapsed = Math.max(0, this.ctx.currentTime - this.playbackStartedAt);
      this.playbackOffset = Math.min(this.maxDuration, this.playbackOffset + elapsed);
    }
    this.stopActiveSources();
    this.isPlaying = false;
    this.notifyStateChange(false);
    this.stopTimeLoop();
  }

  public togglePlayPause() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play(this.playbackOffset);
    }
  }

  public seek(time: number) {
    const clamped = Math.max(0, Math.min(time, this.maxDuration));
    this.playbackOffset = clamped;
    this.notifyTimeUpdate(clamped);

    if (this.isPlaying) {
      this.play(clamped);
    }
  }

  public stop() {
    this.stopActiveSources();
    this.playbackOffset = 0;
    this.isPlaying = false;
    this.notifyStateChange(false);
    this.stopTimeLoop();
    this.notifyTimeUpdate(0);
  }

  private stopActiveSources() {
    this.activeSources.forEach((source) => {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Source might have already finished
      }
    });
    this.activeSources.clear();

    this.activeGains.forEach((gain) => {
      try {
        gain.disconnect();
      } catch {}
    });
    this.activeGains.clear();
  }

  private startTimeLoop() {
    this.stopTimeLoop();
    const tick = () => {
      if (this.isPlaying) {
        const cur = this.getCurrentTime();
        this.notifyTimeUpdate(cur);

        if (cur >= this.maxDuration && this.maxDuration > 0) {
          this.pause();
          this.playbackOffset = 0;
          this.notifyTimeUpdate(0);
          return;
        }
        this.rafId = requestAnimationFrame(tick);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopTimeLoop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // Event Listeners
  public onTimeUpdate(cb: (time: number) => void): () => void {
    this.timeUpdateCallbacks.add(cb);
    return () => this.timeUpdateCallbacks.delete(cb);
  }

  public onStateChange(cb: (isPlaying: boolean) => void): () => void {
    this.stateChangeCallbacks.add(cb);
    return () => this.stateChangeCallbacks.delete(cb);
  }

  public onBuffersLoaded(cb: (peaks: Record<string, Float32Array>, duration: number) => void): () => void {
    this.buffersLoadedCallbacks.add(cb);
    return () => this.buffersLoadedCallbacks.delete(cb);
  }

  private notifyTimeUpdate(time: number) {
    this.timeUpdateCallbacks.forEach((cb) => cb(time));
  }

  private notifyStateChange(isPlaying: boolean) {
    this.stateChangeCallbacks.forEach((cb) => cb(isPlaying));
  }

  private notifyBuffersLoaded() {
    const peaks = this.getPeaksObject();
    this.buffersLoadedCallbacks.forEach((cb) => cb(peaks, this.maxDuration));
  }
}

// Global engine singleton
export const audioMixerEngine = new WebAudioMultiTrackEngine();
