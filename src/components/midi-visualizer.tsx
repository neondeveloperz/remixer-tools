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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
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

  // Zoom & Display Controls
  const [zoomX, setZoomX] = useState(120); // pixels per second (60px to 300px)
  const noteHeight = 20; // pixels per pitch row
  const [hoveredNote, setHoveredNote] = useState<ParsedMidiNote | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  // Virtual Viewport & Scrolling State (prevents WebKit 16k px canvas overflow)
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 450 });
  const [scrollPos, setScrollPos] = useState({ left: 0, top: 0 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gridContainerRef = useRef<HTMLDivElement | null>(null);
  const pianoKeysRef = useRef<HTMLDivElement | null>(null);
  const sequencerRef = useRef<MidiSequencer | null>(null);

  // Track filter: "all" | "melody" | "chords"
  const [selectedTrackFilter, setSelectedTrackFilter] = useState<"all" | "melody" | "chords">("all");

  const activeNotes = useMemo(() => {
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

  // Sync sequencer when activeNotes changes (track filter changed)
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

  // Track container viewport dimensions with ResizeObserver
  useEffect(() => {
    const container = gridContainerRef.current;
    if (!container) return;

    const updateSize = () => {
      setViewportSize({
        width: Math.max(200, container.clientWidth),
        height: Math.max(200, container.clientHeight),
      });
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Synchronize scroll position between canvas viewport and piano keys
  const handleGridScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    setScrollPos({ left: target.scrollLeft, top: target.scrollTop });
    if (pianoKeysRef.current) {
      pianoKeysRef.current.scrollTop = target.scrollTop;
    }
  }, []);

  // Auto-scroll vertically to center on active note pitch range when MIDI data loads
  useEffect(() => {
    if (!midiData || !gridContainerRef.current) return;
    if (midiData.notes.length === 0) return;

    const avgPitch =
      midiData.notes.reduce((sum, n) => sum + n.midi, 0) / midiData.notes.length;
    const vh = gridContainerRef.current.clientHeight || 450;
    const targetY = (midiData.maxPitch - avgPitch) * noteHeight - vh / 2;

    const clampedY = Math.max(0, targetY);
    gridContainerRef.current.scrollTop = clampedY;
    if (pianoKeysRef.current) {
      pianoKeysRef.current.scrollTop = clampedY;
    }
    setScrollPos((prev) => ({ ...prev, top: clampedY }));
  }, [midiData, noteHeight]);

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
    for (let p = midiData.maxPitch; p >= midiData.minPitch; p--) {
      list.push(p);
    }
    return list;
  }, [midiData]);

  const totalGridHeight = pitchList.length * noteHeight;
  const totalGridWidth = midiData ? Math.max(800, midiData.duration * zoomX + 200) : 800;

  // Render Virtual Viewport Canvas (avoids WebKit 16,384px texture limit)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !midiData) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const vw = viewportSize.width || gridContainerRef.current?.clientWidth || 800;
    const vh = viewportSize.height || gridContainerRef.current?.clientHeight || 450;
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

    // 2. Draw vertical time grid lines (only visible seconds)
    const startSec = Math.max(0, Math.floor((scrollLeft / zoomX) * 2) / 2);
    const endSec = Math.min(midiData.duration + 2, Math.ceil(((scrollLeft + vw) / zoomX) * 2) / 2);

    for (let s = startSec; s <= endSec; s += 0.5) {
      const x = s * zoomX - scrollLeft;
      const isWhole = Number.isInteger(s);

      ctx.strokeStyle = isWhole ? "rgba(255, 255, 255, 0.14)" : "rgba(255, 255, 255, 0.04)";
      ctx.lineWidth = isWhole ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, vh);
      ctx.stroke();
    }

    // 3. Draw Note Rectangles (only visible notes)
    const startTime = (scrollLeft / zoomX) - 0.5;
    const endTime = ((scrollLeft + vw) / zoomX) + 0.5;

    activeNotes.forEach((note) => {
      if (note.time + note.duration < startTime || note.time > endTime) return;

      const rowIndex = midiData.maxPitch - note.midi;
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
  }, [midiData, activeNotes, pitchList, viewportSize, scrollPos, zoomX, noteHeight, currentTime, hoveredNote]);

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
    const targetPitch = midiData.maxPitch - rowIndex;

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
    if (!midiData) return;
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
      className={`flex flex-col rounded-xl bg-card shadow-sm overflow-hidden text-card-foreground ${embedded ? "border-primary/30 border-2" : "border"} ${className}`}
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
                Range: {midiToNoteName(midiData.minPitch)} - {midiToNoteName(midiData.maxPitch)}
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

          {/* Time Counter */}
          <div className="px-2.5 py-1 bg-muted/60 rounded font-mono text-xs font-semibold text-foreground tracking-wider border">
            {formatTime(currentTime)} / {formatTime(midiData.duration)}
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

      {/* Main Piano Roll Visualizer Body */}
      <div className="relative flex min-h-[380px] max-h-[560px] bg-slate-950 select-none overflow-hidden">
        {/* Left Column: Vertical Piano Keys */}
        <div
          ref={pianoKeysRef}
          className="w-16 shrink-0 border-r border-border/50 bg-slate-900/90 overflow-hidden z-20 shadow-md"
          style={{ height: "100%" }}
        >
          <div style={{ height: totalGridHeight }}>
            {pitchList.map((pitch) => {
              const isBlack = isBlackKey(pitch);
              const noteName = midiToNoteName(pitch);
              const isAuditioning = auditionNote === pitch;

              return (
                <div
                  key={pitch}
                  onClick={() => handleKeyAudition(pitch)}
                  style={{ height: noteHeight }}
                  className={`flex items-center justify-end pr-1.5 text-[10px] font-mono cursor-pointer border-b transition-colors ${isBlack
                    ? isAuditioning
                      ? "bg-primary text-primary-foreground font-bold border-primary"
                      : "bg-slate-900 text-slate-400 hover:bg-slate-800 border-slate-950/80"
                    : isAuditioning
                      ? "bg-primary text-primary-foreground font-bold border-primary"
                      : "bg-slate-800/90 text-slate-200 hover:bg-slate-700/80 border-slate-700/40"
                    }`}
                  title={`Click to play ${noteName} (MIDI ${pitch})`}
                >
                  <span className="leading-none">{noteName}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Area: Scrollable Canvas Grid with Virtual Spacer */}
        <div
          ref={gridContainerRef}
          onScroll={handleGridScroll}
          className="flex-1 overflow-auto relative cursor-crosshair"
          style={{ height: "100%" }}
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
              width: viewportSize.width,
              height: viewportSize.height,
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
      <div className="px-4 py-2 bg-muted/20 border-t flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-primary" /> Click any piano key to audition sound.
          Click timeline grid to seek playhead.
        </span>
        <span className="font-mono">
          Engine: Web Audio Synth (Polyphonic)
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
      <DialogContent className="max-w-5xl p-0 overflow-hidden bg-card border shadow-2xl">
        <DialogHeader className="sr-only">
          <DialogTitle>MIDI Piano Roll Visualizer</DialogTitle>
          <DialogDescription>Interactive MIDI note visualizer and synthesizer</DialogDescription>
        </DialogHeader>
        <MidiVisualizer
          filePath={filePath}
          fileName={fileName}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
