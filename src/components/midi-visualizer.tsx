// [Path: src/components/midi-visualizer.tsx]

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { Midi } from "@tonejs/midi";
import {
  Play,
  Pause,
  Square,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Piano,
  Info,
  Layers,
  Music,
  Activity,
  X,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Compass,
  Crosshair,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  midiSynth,
  MidiSequencer,
  midiToNoteName,
  INSTRUMENTS_LIST,
  type InstrumentType,
  type ParsedMidiNote,
} from "@/lib/midiSynth";

interface MidiVisualizerProps {
  filePath?: string;
  fileName?: string;
  arrayBuffer?: ArrayBuffer;
  onClose?: () => void;
  className?: string;
  embedded?: boolean;
}

interface MidiFileInfo {
  name: string;
  duration: number;
  bpm: number;
  timeSignature: string;
  trackCount: number;
  totalNotes: number;
  minPitch: number;
  maxPitch: number;
  detectedKey?: string;
  firstBeat?: number;
  notes: ParsedMidiNote[];
}

const BLACK_KEY_INDICES = new Set([1, 3, 6, 8, 10]); // C#, D#, F#, G#, A#

function isBlackKey(midi: number): boolean {
  return BLACK_KEY_INDICES.has(midi % 12);
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms}`;
}

function formatTimelineLabel(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const frac = Math.round((seconds % 1) * 10);
  if (frac > 0) {
    return `${mins}:${secs.toString().padStart(2, "0")}.${frac}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function getNoteColor(midi: number, velocity: number, trackIndex?: number): string {
  // Track 0 = Right Hand / Lead Vocal Melody (Radiant Gold)
  if (trackIndex === 0 || (trackIndex === undefined && midi >= 60)) {
    const lightness = Math.round(48 + velocity * 22);
    return `hsl(45, 96%, ${lightness}%)`;
  }
  // Track 1 = Left Hand / Accompaniment & Chords (Rich Indigo / Violet)
  if (trackIndex === 1 || (trackIndex === undefined && midi < 60)) {
    const lightness = Math.round(42 + velocity * 20);
    return `hsl(255, 75%, ${lightness}%)`;
  }
  const normalizedPitch = Math.max(0, Math.min(1, (midi - 36) / 48));
  const hue = Math.round(30 + normalizedPitch * 240);
  const lightness = Math.round(45 + velocity * 25);
  return `hsl(${hue}, 85%, ${lightness}%)`;
}

export type VisualizerQuantizeGrid = "off" | "adaptive" | "1/16" | "1/8" | "1/12" | "1/4";

function quantizeNotesClient(
  notes: ParsedMidiNote[],
  bpm: number,
  grid: VisualizerQuantizeGrid,
  strength = 1.0,
  firstBeat = 0.0
): ParsedMidiNote[] {
  if (grid === "off" || bpm <= 0 || !notes || notes.length === 0) return notes;

  const beatSec = 60 / bpm;
  let stepSec = beatSec / 4; // default 1/16
  if (grid === "1/8") stepSec = beatSec / 2;
  else if (grid === "1/4") stepSec = beatSec;
  else if (grid === "1/12") stepSec = beatSec / 3;

  const step16 = beatSec / 4;
  const stepTrip = beatSec / 3;

  return notes.map((note) => {
    let targetTime = note.time;

    if (grid === "adaptive") {
      const idx16 = Math.round((note.time - firstBeat) / step16);
      const t16 = firstBeat + idx16 * step16;
      const idxTrip = Math.round((note.time - firstBeat) / stepTrip);
      const tTrip = firstBeat + idxTrip * stepTrip;
      const dist16 = Math.abs(note.time - t16);
      const distTrip = Math.abs(note.time - tTrip);
      targetTime = distTrip < dist16 * 0.72 ? tTrip : t16;
    } else {
      const idx = Math.round((note.time - firstBeat) / stepSec);
      targetTime = firstBeat + idx * stepSec;
    }

    const newTime = Math.max(0, note.time + strength * (targetTime - note.time));
    const targetDur = Math.max(stepSec * 0.45, Math.round(note.duration / stepSec) * stepSec);
    const newDur = Math.max(0.04, note.duration + strength * (targetDur - note.duration));

    return {
      ...note,
      time: Number(newTime.toFixed(4)),
      duration: Number(newDur.toFixed(4)),
    };
  });
}

export function MidiVisualizer({
  filePath,
  fileName,
  arrayBuffer,
  onClose,
  className = "",
  embedded = false,
}: MidiVisualizerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [midiData, setMidiData] = useState<MidiFileInfo | null>(null);

  // Transport & Playback State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [auditionNote, setAuditionNote] = useState<number | null>(null);
  const [selectedInstrument, setSelectedInstrument] = useState<InstrumentType>("grand-piano");

  const handleInstrumentChange = (inst: InstrumentType) => {
    setSelectedInstrument(inst);
    midiSynth.setInstrument(inst);
    midiSynth.playNote(60, 0.8, 0.35);
  };

  // Zoom & Display Controls
  const [zoomX, setZoomX] = useState(120); // pixels per second (60px to 300px)
  const noteHeight = 20; // pixels per pitch row
  const [pitchRangeMode, setPitchRangeMode] = useState<"c1-b7" | "full-88" | "auto-fit">("c1-b7");
  const [quantizeGrid, setQuantizeGrid] = useState<VisualizerQuantizeGrid>("adaptive");
  const [hoveredNote, setHoveredNote] = useState<ParsedMidiNote | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  // Virtual Viewport & Scrolling State (prevents WebKit 16k px canvas overflow)
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 450 });
  const [scrollPos, setScrollPos] = useState({ left: 0, top: 0 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gridContainerRef = useRef<HTMLDivElement | null>(null);
  const pianoKeysRef = useRef<HTMLDivElement | null>(null);
  const sequencerRef = useRef<MidiSequencer | null>(null);

  // Timeline Ruler & Overview Mini-Map Refs & State
  const rulerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rulerContainerRef = useRef<HTMLDivElement | null>(null);
  const [rulerHoverX, setRulerHoverX] = useState<number | null>(null);
  const isDraggingRulerRef = useRef(false);

  const overviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overviewContainerRef = useRef<HTMLDivElement | null>(null);
  const isDraggingOverviewRef = useRef(false);

  const isPanningRef = useRef(false);

  // Track filter: "all" | "melody" | "chords"
  const [selectedTrackFilter, setSelectedTrackFilter] = useState<"all" | "melody" | "chords">("all");

  const baseActiveNotes = useMemo(() => {
    if (!midiData) return [];
    if (selectedTrackFilter === "melody") {
      return midiData.notes.filter(
        (n) => n.trackIndex === 0 || (n.trackIndex === undefined && n.midi >= 60)
      );
    }
    if (selectedTrackFilter === "chords") {
      return midiData.notes.filter(
        (n) => n.trackIndex === 1 || (n.trackIndex === undefined && n.midi < 60)
      );
    }
    return midiData.notes;
  }, [midiData, selectedTrackFilter]);

  const activeNotes = useMemo(() => {
    if (!midiData) return [];
    return quantizeNotesClient(baseActiveNotes, midiData.bpm, quantizeGrid, 1.0, midiData.firstBeat ?? 0.0);
  }, [baseActiveNotes, midiData, quantizeGrid]);

  // Sync sequencer when activeNotes changes (track filter or quantize grid changed)
  useEffect(() => {
    if (sequencerRef.current && midiData) {
      const wasPlaying = sequencerRef.current.getIsPlaying();
      const currentT = sequencerRef.current.getCurrentTime();
      sequencerRef.current.setNotes(activeNotes, midiData.duration);
      if (wasPlaying) {
        sequencerRef.current.play(currentT);
      }
    }
  }, [activeNotes, midiData]);

  // Load and Parse MIDI file
  useEffect(() => {
    let isCancelled = false;

    async function loadMidi() {
      setLoading(true);
      setError(null);

      try {
        let buffer: ArrayBuffer | null = null;

        if (arrayBuffer) {
          buffer = arrayBuffer;
        } else if (filePath) {
          // Attempt 1: Fetch via Tauri convertFileSrc
          try {
            const assetUrl = convertFileSrc(filePath);
            const res = await fetch(assetUrl);
            if (res.ok) {
              buffer = await res.arrayBuffer();
            }
          } catch (fetchErr) {
            console.debug("Fetch asset failed, attempting fs fallback:", fetchErr);
          }

          // Attempt 2: Fallback to Tauri plugin-fs readFile
          if (!buffer) {
            const uint8Array = await readFile(filePath);
            buffer = uint8Array.buffer.slice(
              uint8Array.byteOffset,
              uint8Array.byteOffset + uint8Array.byteLength
            );
          }
        }

        if (!buffer || buffer.byteLength === 0) {
          throw new Error("No MIDI data available to parse.");
        }

        if (isCancelled) return;

        const parsed = new Midi(buffer);
        const allNotes: ParsedMidiNote[] = [];

        parsed.tracks.forEach((track, trackIdx) => {
          track.notes.forEach((n) => {
            allNotes.push({
              midi: n.midi,
              name: n.name,
              time: n.time,
              duration: n.duration,
              velocity: n.velocity,
              trackIndex: trackIdx,
              trackName: track.name || (trackIdx === 0 ? "Vocal Melody (เนื้อเพลง)" : "Accompaniment & Chords"),
            });
          });
        });

        if (allNotes.length === 0) {
          throw new Error("MIDI file contains no note events.");
        }

        const pitches = allNotes.map((n) => n.midi);
        const rawMin = Math.min(...pitches);
        const rawMax = Math.max(...pitches);

        // Pad range with 2 semitones on either side, clamped between 21 (A0) and 108 (C8)
        const minPitch = Math.max(21, rawMin - 2);
        const maxPitch = Math.min(108, rawMax + 2);

        const duration = parsed.duration || Math.max(...allNotes.map((n) => n.time + n.duration));
        const bpm = parsed.header.tempos[0]?.bpm ? Math.round(parsed.header.tempos[0].bpm) : 120;
        const ts = parsed.header.timeSignatures[0]?.timeSignature
          ? `${parsed.header.timeSignatures[0].timeSignature[0]}/${parsed.header.timeSignatures[0].timeSignature[1]}`
          : "4/4";

        const keyMatch = (filePath || fileName || "").match(/([A-G][#b]?)[_ ](Major|Minor)/i);
        const detectedKey = keyMatch
          ? `${keyMatch[1].toUpperCase()} ${keyMatch[2].charAt(0).toUpperCase() + keyMatch[2].slice(1).toLowerCase()}`
          : undefined;

        const firstBeat = allNotes.length > 0 ? Math.min(...allNotes.map((n) => n.time)) : 0.0;

        const info: MidiFileInfo = {
          name: parsed.name || fileName || (filePath ? filePath.split(/[/\\]/).pop() || "MIDI" : "Untitled MIDI"),
          duration: Math.max(1, duration),
          bpm,
          timeSignature: ts,
          trackCount: parsed.tracks.length,
          totalNotes: allNotes.length,
          minPitch,
          maxPitch,
          detectedKey,
          firstBeat,
          notes: allNotes,
        };

        if (isCancelled) return;

        setMidiData(info);

        // Initialize sequencer
        if (!sequencerRef.current) {
          sequencerRef.current = new MidiSequencer(allNotes, info.duration);
        } else {
          sequencerRef.current.setNotes(allNotes, info.duration);
        }

        sequencerRef.current.onTimeUpdate((time) => {
          setCurrentTime(time);
        });

        sequencerRef.current.onPlayStateChange((playing) => {
          setIsPlaying(playing);
        });

        setLoading(false);
      } catch (err: unknown) {
        if (!isCancelled) {
          console.error("MIDI visualizer parse error:", err);
          setError(err instanceof Error ? err.message : "Failed to load or parse MIDI file.");
          setLoading(false);
        }
      }
    }

    loadMidi();

    return () => {
      isCancelled = true;
      if (sequencerRef.current) {
        sequencerRef.current.stop();
      }
    };
  }, [filePath, fileName, arrayBuffer]);

  // Handle master volume changes
  useEffect(() => {
    midiSynth.setVolume(isMuted ? 0 : volume);
  }, [volume, isMuted]);

  // Track container viewport dimensions with ResizeObserver (Responsive window scaling)
  useEffect(() => {
    if (loading) return;
    const container = gridContainerRef.current;
    if (!container) return;

    const updateSize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        setViewportSize((prev) => {
          if (prev.width === w && prev.height === h) return prev;
          return { width: w, height: h };
        });
      }
    };

    updateSize();
    const raf = requestAnimationFrame(updateSize);
    const ro = new ResizeObserver(updateSize);
    ro.observe(container);
    window.addEventListener("resize", updateSize);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, [loading, midiData]);

  // Synchronize scroll position between canvas viewport and piano keys
  const handleGridScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    setScrollPos({ left: target.scrollLeft, top: target.scrollTop });
    if (pianoKeysRef.current) {
      pianoKeysRef.current.scrollTop = target.scrollTop;
    }
  }, []);

  // Dynamic Pitch Boundaries (C1 = 24 to B7 = 107 default)
  // C1 is MIDI 24, B7 is MIDI 107
  // A0 is MIDI 21, C8 is MIDI 108
  const effectiveMinPitch = useMemo(() => {
    if (!midiData) return 24;
    if (pitchRangeMode === "full-88") return Math.min(21, midiData.minPitch);
    if (pitchRangeMode === "c1-b7") return Math.min(24, midiData.minPitch);
    return Math.max(21, midiData.minPitch - 2);
  }, [midiData, pitchRangeMode]);

  const effectiveMaxPitch = useMemo(() => {
    if (!midiData) return 107;
    if (pitchRangeMode === "full-88") return Math.max(108, midiData.maxPitch);
    if (pitchRangeMode === "c1-b7") return Math.max(107, midiData.maxPitch);
    return Math.min(108, midiData.maxPitch + 2);
  }, [midiData, pitchRangeMode]);

  // Auto-scroll vertically to center on active note pitch range when MIDI data loads or range mode changes
  useEffect(() => {
    if (!midiData || !gridContainerRef.current) return;
    if (midiData.notes.length === 0) return;

    const avgPitch =
      midiData.notes.reduce((sum, n) => sum + n.midi, 0) / midiData.notes.length;
    const vh = gridContainerRef.current.clientHeight || 450;
    const targetY = (effectiveMaxPitch - avgPitch) * noteHeight - vh / 2;

    const clampedY = Math.max(0, targetY);
    gridContainerRef.current.scrollTop = clampedY;
    if (pianoKeysRef.current) {
      pianoKeysRef.current.scrollTop = clampedY;
    }
    setScrollPos((prev) => ({ ...prev, top: clampedY }));
  }, [midiData, effectiveMaxPitch, noteHeight]);

  // Auto-scroll when playhead leaves viewport during playback
  useEffect(() => {
    if (!isPlaying || !gridContainerRef.current) return;

    const container = gridContainerRef.current;
    const playheadX = currentTime * zoomX;
    const scrollLeft = container.scrollLeft;
    const clientWidth = container.clientWidth;

    if (playheadX > scrollLeft + clientWidth - 80 || playheadX < scrollLeft) {
      container.scrollLeft = Math.max(0, playheadX - 60);
    }
  }, [currentTime, isPlaying, zoomX]);

  // Pitch keys list (highest down to lowest)
  const pitchList = useMemo(() => {
    if (!midiData) return [];
    const list: number[] = [];
    for (let p = effectiveMaxPitch; p >= effectiveMinPitch; p--) {
      list.push(p);
    }
    return list;
  }, [midiData, effectiveMaxPitch, effectiveMinPitch]);

  const beatsPerBar = useMemo(() => {
    if (!midiData) return 4;
    const num = parseInt(midiData.timeSignature.split("/")[0], 10);
    return isNaN(num) || num <= 0 ? 4 : num;
  }, [midiData]);

  const secondsPerBar = useMemo(() => {
    if (!midiData || midiData.bpm <= 0) return 2.0;
    return (60 / midiData.bpm) * beatsPerBar;
  }, [midiData, beatsPerBar]);

  const totalGridHeight = pitchList.length * noteHeight;
  const totalGridWidth = midiData ? Math.max(800, midiData.duration * zoomX + 200) : 800;

  // Render Virtual Viewport Canvas (avoids WebKit 16,384px texture limit)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !midiData) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const container = gridContainerRef.current;
    const vw = container?.clientWidth || viewportSize.width || 800;
    const vh = container?.clientHeight || viewportSize.height || 450;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, vw, vh);

    const scrollLeft = scrollPos.left;
    const scrollTop = scrollPos.top;

    // 1. Draw pitch row backgrounds (only visible rows)
    const startRow = Math.max(0, Math.floor(scrollTop / noteHeight) - 1);
    const endRow = Math.min(pitchList.length - 1, Math.ceil((scrollTop + vh) / noteHeight) + 1);

    for (let r = startRow; r <= endRow; r++) {
      const pitch = pitchList[r];
      const y = r * noteHeight - scrollTop;
      const isBlack = isBlackKey(pitch);

      ctx.fillStyle = isBlack ? "rgba(15, 23, 42, 0.55)" : "rgba(30, 41, 59, 0.20)";
      ctx.fillRect(0, y, vw, noteHeight);

      // Pitch row dividing line
      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + noteHeight);
      ctx.lineTo(vw, y + noteHeight);
      ctx.stroke();
    }

    // 2. Draw vertical musical measure/bar & beat grid lines
    const secondsPerBeat = midiData.bpm > 0 ? 60 / midiData.bpm : 0.5;
    const firstBeatOffset = midiData.firstBeat ?? 0.0;
    const barOffset = ((firstBeatOffset % secondsPerBar) + secondsPerBar) % secondsPerBar;
    const startBar = Math.floor(((scrollLeft / zoomX) - barOffset) / secondsPerBar) - 1;
    const endBar = Math.ceil((((scrollLeft + vw) / zoomX) - barOffset) / secondsPerBar) + 1;

    for (let b = startBar; b <= endBar; b++) {
      const barTime = barOffset + b * secondsPerBar;
      if (barTime < 0) continue;
      const barX = barTime * zoomX - scrollLeft;

      if (barX >= -2 && barX <= vw + 2) {
        // Measure / Bar dividing line (Bright cyan)
        ctx.strokeStyle = "rgba(56, 189, 248, 0.40)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(barX, 0);
        ctx.lineTo(barX, vh);
        ctx.stroke();
      }

      // Draw intermediate beat lines within the bar
      for (let beat = 1; beat < beatsPerBar; beat++) {
        const beatTime = barTime + beat * secondsPerBeat;
        const beatX = beatTime * zoomX - scrollLeft;
        if (beatX >= 0 && beatX <= vw) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(beatX, 0);
          ctx.lineTo(beatX, vh);
          ctx.stroke();

          // If zoomed in (zoomX >= 110), draw 8th note subdivisions
          if (zoomX >= 110) {
            const subTime = beatTime - secondsPerBeat / 2;
            const subX = subTime * zoomX - scrollLeft;
            if (subX >= 0 && subX <= vw) {
              ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(subX, 0);
              ctx.lineTo(subX, vh);
              ctx.stroke();
            }
          }
        }
      }
    }

    // 3. Draw Note Rectangles (only visible notes)
    const startTime = (scrollLeft / zoomX) - 0.5;
    const endTime = ((scrollLeft + vw) / zoomX) + 0.5;

    activeNotes.forEach((note) => {
      if (note.time + note.duration < startTime || note.time > endTime) return;

      const rowIndex = effectiveMaxPitch - note.midi;
      if (rowIndex < startRow - 1 || rowIndex > endRow + 1) return;

      const x = note.time * zoomX - scrollLeft;
      const y = rowIndex * noteHeight - scrollTop + 1.5;
      const w = Math.max(3, note.duration * zoomX - 1.5);
      const h = noteHeight - 3;
      const radius = Math.min(3, h / 3);

      const color = getNoteColor(note.midi, note.velocity, note.trackIndex);
      const isHovered = hoveredNote === note;

      ctx.save();
      ctx.fillStyle = isHovered ? "#ffffff" : color;
      ctx.shadowColor = color;
      ctx.shadowBlur = isHovered ? 8 : 4;

      // Rounded rectangle note block
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.fill();

      // Inner note border
      ctx.strokeStyle = isHovered ? "#38bdf8" : "rgba(255, 255, 255, 0.45)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Note label if block is wide enough
      if (w > 26 && h >= 12) {
        ctx.fillStyle = isHovered ? "#000000" : "#ffffff";
        ctx.font = `bold ${Math.max(9, Math.min(11, h - 4))}px monospace`;
        ctx.textBaseline = "middle";
        ctx.shadowBlur = 0;
        ctx.fillText(note.name, x + 4, y + h / 2);
      }
      ctx.restore();
    });

    // 4. Draw Playhead (if within visible viewport)
    const screenPlayheadX = currentTime * zoomX - scrollLeft;
    if (screenPlayheadX >= 0 && screenPlayheadX <= vw) {
      ctx.save();
      ctx.strokeStyle = "#38bdf8"; // vibrant cyan playhead
      ctx.lineWidth = 2;
      ctx.shadowColor = "#0284c7";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(screenPlayheadX, 0);
      ctx.lineTo(screenPlayheadX, vh);
      ctx.stroke();
      ctx.restore();
    }
  }, [midiData, activeNotes, pitchList, viewportSize, scrollPos, zoomX, noteHeight, currentTime, hoveredNote, effectiveMaxPitch, effectiveMinPitch, secondsPerBar, beatsPerBar]);

  // Render Overview Mini-Map Track
  useEffect(() => {
    const canvas = overviewCanvasRef.current;
    const container = overviewContainerRef.current;
    if (!canvas || !container || !midiData) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const ow = container.clientWidth || viewportSize.width || 800;
    const oh = 28;

    canvas.width = Math.round(ow * dpr);
    canvas.height = Math.round(oh * dpr);
    ctx.scale(dpr, dpr);

    // Dark sleek background
    ctx.fillStyle = "#060911";
    ctx.fillRect(0, 0, ow, oh);

    // Periodic time grid lines across full song
    const stepSec = midiData.duration <= 45 ? 5 : midiData.duration <= 90 ? 10 : midiData.duration <= 180 ? 15 : 30;
    for (let s = 0; s <= midiData.duration; s += stepSec) {
      const x = (s / midiData.duration) * ow;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, oh);
      ctx.stroke();

      if (x > 15 && x < ow - 25) {
        ctx.font = "8px monospace";
        ctx.fillStyle = "rgba(148, 163, 184, 0.45)";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(formatTimelineLabel(s), x, 2);
      }
    }

    // Mini notes preview
    const pitchSpan = Math.max(1, effectiveMaxPitch - effectiveMinPitch);
    activeNotes.forEach((n) => {
      const nx = (n.time / midiData.duration) * ow;
      const nw = Math.max(1.5, (n.duration / midiData.duration) * ow);
      const pitchRatio = (n.midi - effectiveMinPitch) / pitchSpan;
      const ny = oh - 5 - pitchRatio * (oh - 10);

      ctx.fillStyle = n.trackIndex === 0 || (n.trackIndex === undefined && n.midi >= 60)
        ? "rgba(251, 191, 36, 0.65)"
        : "rgba(129, 140, 248, 0.55)";
      ctx.fillRect(nx, ny, nw, 1.8);
    });

    // Playhead line on overview
    const px = (currentTime / midiData.duration) * ow;
    if (px >= 0 && px <= ow) {
      ctx.fillStyle = "#38bdf8";
      ctx.shadowColor = "#0284c7";
      ctx.shadowBlur = 4;
      ctx.fillRect(px - 1, 0, 2, oh);
      ctx.shadowBlur = 0;
    }
  }, [midiData, activeNotes, viewportSize, currentTime, effectiveMaxPitch, effectiveMinPitch]);

  // Render Timeline Ruler Canvas
  useEffect(() => {
    const canvas = rulerCanvasRef.current;
    const container = rulerContainerRef.current;
    if (!canvas || !container || !midiData) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const vw = container.clientWidth || viewportSize.width || 800;
    const vh = 30;

    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    ctx.scale(dpr, dpr);

    // Background: sleek dark slate
    ctx.fillStyle = "#090d16";
    ctx.fillRect(0, 0, vw, vh);

    // Bottom border
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, vh - 0.5);
    ctx.lineTo(vw, vh - 0.5);
    ctx.stroke();

    const scrollLeft = scrollPos.left;
    const intervalSec = zoomX >= 180 ? 2 : zoomX >= 90 ? 5 : zoomX >= 50 ? 10 : 15;
    const minorSec = intervalSec === 2 ? 0.5 : intervalSec === 5 ? 1 : 2;

    const startSec = Math.max(0, Math.floor(scrollLeft / zoomX / minorSec) * minorSec);
    const endSec = Math.min(midiData.duration + 2, Math.ceil((scrollLeft + vw) / zoomX / minorSec) * minorSec);

    for (let s = startSec; s <= endSec; s += minorSec) {
      const x = s * zoomX - scrollLeft;
      if (x < -60 || x > vw + 60) continue;

      const isMajor = Math.abs(s % intervalSec) < 0.001 || Math.abs((s % intervalSec) - intervalSec) < 0.001;
      const isWhole = Math.abs(s % 1) < 0.001;

      if (isMajor) {
        // Major interval tick
        ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, 14);
        ctx.lineTo(x, vh);
        ctx.stroke();

        // Time label & Measure/Bar
        const timeText = formatTimelineLabel(s);
        const firstBeatOffset = midiData.firstBeat ?? 0.0;
        const barOffset = ((firstBeatOffset % secondsPerBar) + secondsPerBar) % secondsPerBar;
        const barNum = Math.floor(Math.max(0, s - barOffset) / secondsPerBar) + 1;

        ctx.font = "bold 10px monospace";
        ctx.fillStyle = "#38bdf8";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(timeText, x + 4, 9);

        ctx.font = "9px sans-serif";
        ctx.fillStyle = "rgba(148, 163, 184, 0.8)";
        const timeWidth = ctx.measureText(timeText).width;
        ctx.fillText(`M${barNum}`, x + 6 + timeWidth, 9);
      } else if (isWhole) {
        // Medium whole-second tick
        ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 18);
        ctx.lineTo(x, vh);
        ctx.stroke();

        if (zoomX >= 130) {
          ctx.font = "9px monospace";
          ctx.fillStyle = "rgba(148, 163, 184, 0.5)";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(`${Math.round(s)}s`, x + 3, 13);
        }
      } else {
        // Minor sub-second tick
        ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 23);
        ctx.lineTo(x, vh);
        ctx.stroke();
      }
    }

    // Draw Playhead Marker on Ruler
    const playheadX = currentTime * zoomX - scrollLeft;
    if (playheadX >= -10 && playheadX <= vw + 10) {
      ctx.fillStyle = "#38bdf8";
      ctx.beginPath();
      ctx.moveTo(playheadX - 6, 0);
      ctx.lineTo(playheadX + 6, 0);
      ctx.lineTo(playheadX + 6, 12);
      ctx.lineTo(playheadX, 20);
      ctx.lineTo(playheadX - 6, 12);
      ctx.closePath();
      ctx.fill();

      // Playhead vertical line connecting to piano roll
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 20);
      ctx.lineTo(playheadX, vh);
      ctx.stroke();
    }

    // Draw Hover Time Tooltip on Ruler
    if (rulerHoverX !== null && rulerHoverX >= 0 && rulerHoverX <= vw) {
      const hoverSec = (rulerHoverX + scrollLeft) / zoomX;
      if (hoverSec >= 0 && hoverSec <= midiData.duration) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(rulerHoverX, 0);
        ctx.lineTo(rulerHoverX, vh);
        ctx.stroke();
        ctx.setLineDash([]);

        const hoverText = formatTime(hoverSec);
        const barNum = Math.floor(hoverSec / secondsPerBar) + 1;
        const badgeLabel = `${hoverText} (M${barNum})`;

        ctx.font = "bold 9px monospace";
        const badgeWidth = ctx.measureText(badgeLabel).width + 10;
        const badgeX = Math.min(vw - badgeWidth - 4, Math.max(4, rulerHoverX - badgeWidth / 2));

        ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
        ctx.beginPath();
        ctx.roundRect(badgeX, 3, badgeWidth, 16, 3);
        ctx.fill();
        ctx.strokeStyle = "rgba(56, 189, 248, 0.7)";
        ctx.stroke();

        ctx.fillStyle = "#38bdf8";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(badgeLabel, badgeX + 5, 11);
      }
    }
  }, [midiData, viewportSize, scrollPos.left, zoomX, currentTime, rulerHoverX, secondsPerBar]);

  // Handle canvas mouse move for note hover tooltip (accounting for scrollPos)
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!midiData) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left + scrollPos.left;
    const mouseY = e.clientY - rect.top + scrollPos.top;

    const clickedTime = mouseX / zoomX;
    const rowIndex = Math.floor(mouseY / noteHeight);
    const targetPitch = effectiveMaxPitch - rowIndex;

    // Find note under cursor
    const found = activeNotes.find(
      (n) =>
        n.midi === targetPitch &&
        clickedTime >= n.time &&
        clickedTime <= n.time + n.duration
    );

    if (found) {
      setHoveredNote(found);
      setHoverPos({ x: e.clientX, y: e.clientY });
    } else {
      setHoveredNote(null);
      setHoverPos(null);
    }
  };

  const handleCanvasMouseLeave = () => {
    setHoveredNote(null);
    setHoverPos(null);
  };

  // Click on grid to seek (accounting for scrollPos)
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!midiData || isPanningRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left + scrollPos.left;
    const seekTime = Math.max(0, Math.min(midiData.duration, mouseX / zoomX));

    if (sequencerRef.current) {
      sequencerRef.current.seek(seekTime);
    }
    setCurrentTime(seekTime);
  };

  // Key audition
  const handleKeyAudition = (pitch: number) => {
    setAuditionNote(pitch);
    midiSynth.playNote(pitch, 0.85, 0.45);
    setTimeout(() => setAuditionNote(null), 300);
  };

  // Play / Pause toggle
  const togglePlay = () => {
    if (!sequencerRef.current || !midiData) return;
    if (isPlaying) {
      sequencerRef.current.pause();
    } else {
      sequencerRef.current.play();
    }
  };

  // Stop playback
  const handleStop = () => {
    if (sequencerRef.current) {
      sequencerRef.current.stop();
    }
    setCurrentTime(0);
    if (gridContainerRef.current) {
      gridContainerRef.current.scrollLeft = 0;
    }
  };

  // Zoom helpers
  const handleZoomIn = () => {
    setZoomX((prev) => Math.min(260, prev + 25));
  };

  const handleZoomOut = () => {
    setZoomX((prev) => Math.max(60, prev - 25));
  };

  const handleFitZoom = () => {
    if (!midiData || !gridContainerRef.current) return;
    const containerW = gridContainerRef.current.clientWidth - 40;
    const optimal = Math.max(50, Math.min(200, containerW / midiData.duration));
    setZoomX(Math.round(optimal));
    if (gridContainerRef.current) {
      gridContainerRef.current.scrollLeft = 0;
    }
  };

  // Horizontal Pan & Navigation Handlers
  const handlePanBySeconds = (deltaSec: number) => {
    const grid = gridContainerRef.current;
    if (!grid) return;
    grid.scrollLeft = Math.max(
      0,
      Math.min(totalGridWidth - viewportSize.width, grid.scrollLeft + deltaSec * zoomX)
    );
  };

  const handleScrollToStart = () => {
    if (gridContainerRef.current) {
      gridContainerRef.current.scrollLeft = 0;
    }
  };

  const handleScrollToEnd = () => {
    if (gridContainerRef.current) {
      gridContainerRef.current.scrollLeft = Math.max(0, totalGridWidth - viewportSize.width);
    }
  };

  const handleCenterPlayhead = () => {
    const grid = gridContainerRef.current;
    if (!grid || !midiData) return;
    const targetX = currentTime * zoomX - viewportSize.width / 2;
    grid.scrollLeft = Math.max(0, Math.min(totalGridWidth - viewportSize.width, targetX));
  };

  // Overview Viewport Window Geometry
  const overviewViewportBox = useMemo(() => {
    if (!midiData || totalGridWidth <= 0) return { left: 0, width: 100 };
    const leftFrac = Math.max(0, Math.min(1, scrollPos.left / totalGridWidth));
    const widthFrac = Math.max(0.04, Math.min(1 - leftFrac, viewportSize.width / totalGridWidth));
    return {
      left: leftFrac * 100,
      width: widthFrac * 100,
    };
  }, [midiData, scrollPos.left, totalGridWidth, viewportSize.width]);

  // Overview Mini-Map Click to jump & center
  const handleOverviewTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = overviewContainerRef.current;
    const grid = gridContainerRef.current;
    if (!container || !grid || !midiData) return;

    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));

    const targetSec = ratio * midiData.duration;
    const targetScrollLeft = targetSec * zoomX - viewportSize.width / 2;
    grid.scrollLeft = Math.max(0, Math.min(totalGridWidth - viewportSize.width, targetScrollLeft));
  };

  // Overview Viewport Window Drag
  const handleViewportBoxMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const grid = gridContainerRef.current;
    const container = overviewContainerRef.current;
    if (!grid || !container) return;

    isDraggingOverviewRef.current = true;
    const startX = e.clientX;
    const startScrollLeft = grid.scrollLeft;
    const trackWidth = container.clientWidth || 1;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingOverviewRef.current) return;
      const deltaX = moveEvent.clientX - startX;
      const deltaRatio = deltaX / trackWidth;
      const deltaScroll = deltaRatio * totalGridWidth;
      grid.scrollLeft = Math.max(
        0,
        Math.min(totalGridWidth - viewportSize.width, startScrollLeft + deltaScroll)
      );
    };

    const handleMouseUp = () => {
      isDraggingOverviewRef.current = false;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Timeline Ruler Scrubbing & Seeking
  const handleRulerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = rulerContainerRef.current;
    const grid = gridContainerRef.current;
    if (!container || !midiData) return;

    isDraggingRulerRef.current = true;

    const updateSeekFromEvent = (clientX: number) => {
      const rect = container.getBoundingClientRect();
      const clickX = clientX - rect.left;
      const seekTime = Math.max(
        0,
        Math.min(midiData.duration, (clickX + scrollPos.left) / zoomX)
      );
      if (sequencerRef.current) {
        sequencerRef.current.seek(seekTime);
      }
      setCurrentTime(seekTime);

      if (grid) {
        if (clickX > rect.width - 35) {
          grid.scrollLeft = Math.min(totalGridWidth - viewportSize.width, grid.scrollLeft + 15);
        } else if (clickX < 35) {
          grid.scrollLeft = Math.max(0, grid.scrollLeft - 15);
        }
      }
    };

    updateSeekFromEvent(e.clientX);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRulerRef.current) return;
      updateSeekFromEvent(moveEvent.clientX);
    };

    const handleMouseUp = () => {
      isDraggingRulerRef.current = false;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleRulerMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = rulerContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setRulerHoverX(e.clientX - rect.left);
  };

  const handleRulerMouseLeave = () => {
    setRulerHoverX(null);
  };

  const handleRulerWheel = (e: React.WheelEvent) => {
    const grid = gridContainerRef.current;
    if (!grid) return;
    const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
    grid.scrollLeft = Math.max(
      0,
      Math.min(totalGridWidth - viewportSize.width, grid.scrollLeft + delta)
    );
  };

  // Middle-Click & Alt-Click Pan on the Note Grid
  const handleGridMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === 1 || e.altKey) {
      e.preventDefault();
      const grid = gridContainerRef.current;
      if (!grid) return;

      isPanningRef.current = true;
      const startX = e.clientX;
      const startY = e.clientY;
      const startScrollLeft = grid.scrollLeft;
      const startScrollTop = grid.scrollTop;

      const handlePanMove = (moveEvent: MouseEvent) => {
        if (!isPanningRef.current) return;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        grid.scrollLeft = startScrollLeft - dx;
        grid.scrollTop = startScrollTop - dy;
      };

      const handlePanUp = () => {
        isPanningRef.current = false;
        window.removeEventListener("mousemove", handlePanMove);
        window.removeEventListener("mouseup", handlePanUp);
      };

      window.addEventListener("mousemove", handlePanMove);
      window.addEventListener("mouseup", handlePanUp);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-3 border rounded-xl bg-card/60 min-h-[360px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="text-sm font-medium text-muted-foreground">
          Parsing MIDI notes and events...
        </span>
      </div>
    );
  }

  if (error || !midiData) {
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-3 border border-destructive/30 rounded-xl bg-destructive/5 min-h-[300px] text-center">
        <AlertCircle className="w-8 h-8 text-destructive" />
        <h4 className="font-semibold text-sm">Failed to Load MIDI</h4>
        <p className="text-xs text-muted-foreground max-w-md">{error || "Unknown error"}</p>
        {onClose && (
          <Button variant="outline" size="sm" onClick={onClose} className="mt-2">
            Close
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col rounded-xl bg-card shadow-sm overflow-hidden text-card-foreground ${
        embedded ? "border-primary/30 border-2 min-h-[500px] h-[65vh] max-h-[850px]" : "border h-full flex-1"
      } ${className}`}
    >
      {/* Top Header / Metadata Bar */}
      <div className="p-4 border-b bg-muted/30 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-primary/10 rounded-lg text-primary shrink-0">
            <Piano className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm truncate" title={midiData.name}>
                {midiData.name}
              </h3>
              <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20">
                Piano Roll
              </Badge>
              {midiData.detectedKey && (
                <Badge variant="secondary" className="text-[10px] bg-amber-500/15 text-amber-400 border-amber-500/30">
                  Key: {midiData.detectedKey}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 font-mono">
              <span className="flex items-center gap-1">
                <Music className="w-3 h-3" /> {midiData.totalNotes} notes
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Activity className="w-3 h-3" /> {midiData.bpm} BPM
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Layers className="w-3 h-3" /> {midiData.timeSignature}
              </span>
              <span>•</span>
              <span>
                Range: {midiToNoteName(effectiveMinPitch)} - {midiToNoteName(effectiveMaxPitch)} ({pitchList.length} Keys)
              </span>
            </div>
          </div>
        </div>

        {/* Right action / Close button */}
        <div className="flex items-center gap-2">
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              title="Close Visualizer"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Transport Controls Bar */}
      <div className="px-4 py-2.5 border-b bg-background flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Playback buttons */}
        <div className="flex items-center gap-2">
          <Button
            variant={isPlaying ? "secondary" : "default"}
            size="sm"
            onClick={togglePlay}
            className="h-8 gap-1.5 font-semibold text-xs min-w-[80px]"
          >
            {isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5 fill-current" /> Pause
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" /> Play
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleStop}
            className="h-8 w-8 p-0"
            title="Stop & Reset"
          >
            <Square className="w-3.5 h-3.5 fill-current text-muted-foreground" />
          </Button>

          {/* Time & Measure Counter */}
          <div className="px-2.5 py-1 bg-muted/60 rounded font-mono text-xs font-semibold text-foreground tracking-wider border flex items-center gap-2">
            <span>{formatTime(currentTime)} / {formatTime(midiData.duration)}</span>
            <span className="text-[10px] text-sky-400 border-l border-border/60 pl-2 font-mono font-bold">
              Bar {Math.floor(currentTime / secondsPerBar) + 1}
            </span>
          </div>

          {/* Quick Horizontal Pan & Navigation Controls */}
          <div className="flex items-center gap-1 border-l pl-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleScrollToStart}
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              title="Jump to Start (0:00)"
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePanBySeconds(-5)}
              className="h-8 px-2 text-xs font-mono gap-1 text-muted-foreground hover:text-foreground"
              title="Pan Left 5s (เลื่อนซ้าย 5 วินาที)"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> 5s
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePanBySeconds(5)}
              className="h-8 px-2 text-xs font-mono gap-1 text-muted-foreground hover:text-foreground"
              title="Pan Right 5s (เลื่อนขวา 5 วินาที)"
            >
              5s <ChevronRight className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleScrollToEnd}
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              title="Jump to End"
            >
              <ChevronsRight className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCenterPlayhead}
              className="h-8 px-2 text-xs gap-1 text-sky-400 hover:text-sky-300 hover:bg-sky-950/40"
              title="Center View on Playhead (เลื่อนไปที่ตำแหน่งเล่นปัจจุบัน)"
            >
              <Crosshair className="w-3.5 h-3.5" /> Follow
            </Button>
          </div>
        </div>

        {/* Track Filter Toggle: All / Melody / Chords */}
        <div className="flex items-center rounded-md border p-0.5 bg-muted/40 text-[11px]">
          <button
            type="button"
            onClick={() => setSelectedTrackFilter("all")}
            className={`px-2 py-1 rounded transition-colors font-medium ${
              selectedTrackFilter === "all"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All Notes
          </button>
          <button
            type="button"
            onClick={() => setSelectedTrackFilter("melody")}
            className={`px-2 py-1 rounded transition-colors font-medium flex items-center gap-1.5 ${
              selectedTrackFilter === "melody"
                ? "bg-amber-500/20 text-amber-500 font-semibold shadow-sm"
                : "text-muted-foreground hover:text-amber-500"
            }`}
            title="Solo Right Hand / Lead Vocal Melody (เนื้อเพลง)"
          >
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
            🎤 Melody (เนื้อเพลง)
          </button>
          <button
            type="button"
            onClick={() => setSelectedTrackFilter("chords")}
            className={`px-2 py-1 rounded transition-colors font-medium flex items-center gap-1.5 ${
              selectedTrackFilter === "chords"
                ? "bg-indigo-500/20 text-indigo-400 font-semibold shadow-sm"
                : "text-muted-foreground hover:text-indigo-400"
            }`}
            title="Solo Left Hand / Accompaniment & Chords (คอร์ด)"
          >
            <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />
            🎹 Chords (คอร์ด)
          </button>
        </div>

        {/* Instrument Selector (Online Sequencer Style) */}
        <div className="flex items-center gap-1.5">
          <Select
            value={selectedInstrument}
            onValueChange={(val) => handleInstrumentChange(val as InstrumentType)}
          >
            <SelectTrigger className="h-8 w-[170px] text-xs bg-muted/40 border font-medium">
              <SelectValue placeholder="Instrument" />
            </SelectTrigger>
            <SelectContent className="max-h-[320px]">
              {INSTRUMENTS_LIST.map((inst) => (
                <SelectItem key={inst.id} value={inst.id} className="text-xs cursor-pointer">
                  <span className="mr-1.5">{inst.icon}</span>
                  <span>{inst.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Keyboard Pitch Range Mode Selector (C1-B7 Full / 88 Keys / Auto-Fit) */}
        <div className="flex items-center gap-1.5">
          <Select
            value={pitchRangeMode}
            onValueChange={(val) => setPitchRangeMode(val as "c1-b7" | "full-88" | "auto-fit")}
          >
            <SelectTrigger className="h-8 w-[155px] text-xs bg-muted/40 border font-medium">
              <SelectValue placeholder="Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="c1-b7" className="text-xs cursor-pointer">
                🎹 C1 – B7 (Full Range)
              </SelectItem>
              <SelectItem value="full-88" className="text-xs cursor-pointer">
                🎹 A0 – C8 (88 Keys)
              </SelectItem>
              <SelectItem value="auto-fit" className="text-xs cursor-pointer">
                🎯 Auto-Fit Notes
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Live Beat Grid Quantize Selector */}
        <div className="flex items-center gap-1.5">
          <Select
            value={quantizeGrid}
            onValueChange={(val) => setQuantizeGrid(val as VisualizerQuantizeGrid)}
          >
            <SelectTrigger className="h-8 w-[150px] text-xs bg-muted/40 border font-medium">
              <SelectValue placeholder="Grid Snap" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="adaptive" className="text-xs cursor-pointer">
                ⏱️ Snap: Adaptive
              </SelectItem>
              <SelectItem value="1/16" className="text-xs cursor-pointer">
                ⏱️ Snap: 1/16 Beat
              </SelectItem>
              <SelectItem value="1/8" className="text-xs cursor-pointer">
                ⏱️ Snap: 1/8 Beat
              </SelectItem>
              <SelectItem value="1/12" className="text-xs cursor-pointer">
                ⏱️ Snap: 1/12 Triplet
              </SelectItem>
              <SelectItem value="1/4" className="text-xs cursor-pointer">
                ⏱️ Snap: 1/4 Beat
              </SelectItem>
              <SelectItem value="off" className="text-xs cursor-pointer">
                ⏱️ Snap: Off (Raw)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Volume & Zoom Controls */}
        <div className="flex items-center gap-4">
          {/* Master Volume */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsMuted((prev) => !prev)}
              className="h-7 w-7 text-muted-foreground"
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-3.5 h-3.5 text-destructive" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
            </Button>
            <div className="w-20">
              <Slider
                value={[isMuted ? 0 : volume * 100]}
                min={0}
                max={100}
                step={1}
                onValueChange={(val) => {
                  const num = Array.isArray(val) ? val[0] : typeof val === "number" ? val : 80;
                  if (typeof num === "number") {
                    setVolume(num / 100);
                    if (isMuted) setIsMuted(false);
                  }
                }}
              />
            </div>
          </div>

          {/* Zoom In / Zoom Out */}
          <div className="flex items-center gap-1 border-l pl-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomOut}
              className="h-7 w-7"
              title="Zoom Out (Timeline)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <span className="font-mono text-[10px] text-muted-foreground w-9 text-center">
              {zoomX}px
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomIn}
              className="h-7 w-7"
              title="Zoom In (Timeline)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleFitZoom}
              className="h-7 w-7"
              title="Fit to Window"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Overview Mini-Map Track (Full Song Nav + Viewport Slider) */}
      <div className="flex w-full h-[28px] bg-slate-950 border-b border-border/40 select-none shrink-0 z-30">
        <div
          className="w-16 shrink-0 border-r border-border/50 flex items-center justify-center text-[10px] font-mono text-muted-foreground bg-slate-900/90 gap-1"
          title="Overview Song Mini-map (คลิกเพื่อกระโดดข้ามช่วงเวลา / ลากแถบสีฟ้าเพื่อเลื่อนซ้ายขวา)"
        >
          <Compass className="w-3 h-3 text-sky-400" />
          <span>Map</span>
        </div>
        <div
          ref={overviewContainerRef}
          onClick={handleOverviewTrackClick}
          onWheel={handleRulerWheel}
          className="flex-1 h-full relative cursor-pointer overflow-hidden bg-slate-950"
          title="Overview Map: Click anywhere to jump, or drag the cyan viewport box to scroll horizontally"
        >
          <canvas
            ref={overviewCanvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
          />
          {/* Draggable Viewport Slider Box */}
          <div
            onMouseDown={handleViewportBoxMouseDown}
            style={{
              left: `${overviewViewportBox.left}%`,
              width: `${overviewViewportBox.width}%`,
            }}
            className="absolute top-0 bottom-0 bg-sky-500/25 border-2 border-sky-400 rounded-sm cursor-grab active:cursor-grabbing shadow-[0_0_8px_rgba(56,189,248,0.35)] flex items-center justify-center z-10 transition-colors hover:border-sky-300"
            title="Drag left/right to scroll timeline (เลื่อนซ้ายขวา)"
          >
            <div className="w-2.5 h-3.5 flex items-center justify-between opacity-80 pointer-events-none">
              <span className="w-0.5 h-full bg-sky-200 rounded-full" />
              <span className="w-0.5 h-full bg-sky-200 rounded-full" />
            </div>
          </div>
        </div>
      </div>

      {/* Periodic Timeline Ruler Header Bar */}
      <div className="flex w-full h-[30px] bg-slate-900 border-b border-border/50 select-none shrink-0 z-20 shadow-sm">
        <div
          className="w-16 shrink-0 border-r border-border/50 flex items-center justify-center text-[10px] font-mono text-sky-400 bg-slate-900 gap-1 font-semibold"
          title="Timeline Ruler (บอกเวลาและห้องเพลงตามช่วง)"
        >
          <Clock className="w-3 h-3" />
          <span>Time</span>
        </div>
        <div
          ref={rulerContainerRef}
          onMouseDown={handleRulerMouseDown}
          onMouseMove={handleRulerMouseMove}
          onMouseLeave={handleRulerMouseLeave}
          onWheel={handleRulerWheel}
          className="flex-1 h-full relative cursor-ew-resize overflow-hidden bg-slate-900"
          title="Timeline Ruler: Click or drag to scrub time, wheel to scroll left/right"
        >
          <canvas
            ref={rulerCanvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
          />
        </div>
      </div>

      {/* Main Piano Roll Visualizer Body */}
      <div
        onMouseDown={handleGridMouseDown}
        className="relative flex flex-1 w-full min-h-[420px] bg-slate-950 select-none overflow-hidden"
      >
        {/* Left Column: Vertical Piano Keys */}
        <div
          ref={pianoKeysRef}
          className="w-16 shrink-0 border-r border-border/50 bg-slate-900/90 overflow-hidden z-20 shadow-md h-full"
        >
          <div style={{ height: totalGridHeight }}>
            {pitchList.map((pitch) => {
              const isBlack = isBlackKey(pitch);
              const noteName = midiToNoteName(pitch);
              const isAuditioning = auditionNote === pitch;
              const isC = pitch % 12 === 0;
              const isMiddleC = pitch === 60;
              const isC1 = pitch === 24;
              const isB7 = pitch === 107;

              return (
                <div
                  key={pitch}
                  onClick={() => handleKeyAudition(pitch)}
                  style={{ height: noteHeight }}
                  className={`flex items-center justify-end pr-1.5 text-[10px] font-mono cursor-pointer border-b transition-colors relative ${
                    isBlack
                      ? isAuditioning
                        ? "bg-primary text-primary-foreground font-bold border-primary"
                        : "bg-slate-900 text-slate-400 hover:bg-slate-800 border-slate-950/80"
                      : isAuditioning
                        ? "bg-primary text-primary-foreground font-bold border-primary"
                        : isMiddleC
                          ? "bg-amber-950/40 text-amber-300 font-bold hover:bg-amber-900/50 border-amber-600/40 border-l-4 border-l-amber-400"
                          : isC
                            ? "bg-slate-800 text-sky-300 font-bold hover:bg-slate-700/90 border-slate-700/60 border-l-2 border-l-sky-400"
                            : isC1 || isB7
                              ? "bg-slate-800 text-sky-400 font-bold hover:bg-slate-700 border-slate-700/60"
                              : "bg-slate-800/90 text-slate-200 hover:bg-slate-700/80 border-slate-700/40"
                  }`}
                  title={`Click to play ${noteName} (MIDI ${pitch})`}
                >
                  <span className={`leading-none ${isMiddleC ? "text-amber-300 font-bold" : isC ? "text-sky-300 font-bold" : ""}`}>
                    {noteName}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Area: Scrollable Canvas Grid with Virtual Spacer */}
        <div
          ref={gridContainerRef}
          onScroll={handleGridScroll}
          className="flex-1 w-full h-full overflow-auto relative cursor-crosshair piano-roll-scrollbar"
        >
          {/* Virtual scroll spacer establishing canvas scroll boundary */}
          <div
            style={{
              width: totalGridWidth,
              height: totalGridHeight,
              position: "absolute",
              top: 0,
              left: 0,
              pointerEvents: "none",
            }}
          />

          {/* Sticky Viewport Canvas - Never exceeds WebKit 16,384px texture limit */}
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            onMouseMove={handleCanvasMouseMove}
            onMouseLeave={handleCanvasMouseLeave}
            style={{
              position: "sticky",
              top: 0,
              left: 0,
              width: viewportSize.width || "100%",
              height: viewportSize.height || "100%",
              display: "block",
            }}
          />
        </div>

        {/* Floating Tooltip for Hovered Note */}
        {hoveredNote && hoverPos && (
          <div
            className="fixed pointer-events-none z-50 px-2.5 py-1.5 rounded bg-popover/95 backdrop-blur-sm border shadow-lg text-[11px] font-mono text-popover-foreground flex flex-col gap-0.5"
            style={{
              left: hoverPos.x + 12,
              top: hoverPos.y - 45,
            }}
          >
            <div className="font-bold text-primary flex items-center gap-1.5">
              <span>{hoveredNote.name}</span>
              <span className="text-muted-foreground text-[10px]">
                (MIDI {hoveredNote.midi})
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground text-[11px]">
              <span>Start: {hoveredNote.time.toFixed(2)}s</span>
              <span>Len: {hoveredNote.duration.toFixed(2)}s</span>
              <span>Vel: {Math.round(hoveredNote.velocity * 100)}%</span>
              <span className="font-semibold text-primary">
                {hoveredNote.trackName || (hoveredNote.trackIndex === 0 ? "Melody (เนื้อเพลง)" : "Chords & Bass")}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Footer Info / Hints */}
      <div className="px-4 py-2 bg-muted/20 border-t flex flex-wrap items-center justify-between text-[11px] text-muted-foreground gap-2">
        <span className="flex items-center gap-1.5 flex-wrap">
          <Info className="w-3.5 h-3.5 text-primary shrink-0" />
          <span>💡 <b>Navigation:</b> Drag cyan <b>Map</b> box or <b>Shift+Wheel</b> to scroll left/right • Click/drag <b>Time Ruler</b> to scrub • Middle-click canvas to pan.</span>
        </span>
        <span className="font-mono text-[10px]">
          Engine: Web Audio ({INSTRUMENTS_LIST.find((i) => i.id === selectedInstrument)?.name || "Polyphonic"})
        </span>
      </div>
    </div>
  );
}

/**
 * Modal Dialog Wrapper for opening the MIDI Visualizer anywhere in the application
 */
interface MidiVisualizerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath?: string;
  fileName?: string;
}

export function MidiVisualizerDialog({
  open,
  onOpenChange,
  filePath,
  fileName,
}: MidiVisualizerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[92vh] max-h-[92vh] p-0 overflow-hidden bg-card border shadow-2xl flex flex-col">
        <DialogHeader className="sr-only">
          <DialogTitle>MIDI Piano Roll Visualizer</DialogTitle>
          <DialogDescription>Interactive MIDI note visualizer and synthesizer</DialogDescription>
        </DialogHeader>
        <MidiVisualizer
          filePath={filePath}
          fileName={fileName}
          onClose={() => onOpenChange(false)}
          className="h-full flex-1"
        />
      </DialogContent>
    </Dialog>
  );
}
