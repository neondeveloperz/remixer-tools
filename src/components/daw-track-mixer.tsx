import React, { useRef, useEffect, useState, useCallback } from "react";
import { usePlayer, getTrackKey, type TrackInfo } from "@/contexts/PlayerContext";
import { Button } from "@/components/ui/button";
import { Play, Pause, RotateCcw, FolderOpen, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DawTrackMixerProps {
  tracks?: TrackInfo[];
  title?: string;
  onOpenFolder?: () => void;
  className?: string;
}

interface StemTheme {
  bg: string;
  waveform: string;
  dimmedBg: string;
  name: string;
}

const TRACK_HEADER_WIDTH = 140;

// Visual theme matching DAW standards and user's screenshot
const getStemTheme = (trackName: string): StemTheme => {
  const lower = trackName.toLowerCase();
  if (lower.includes("vocal")) {
    return {
      bg: "#221e3d",
      waveform: "#9d7bf5",
      dimmedBg: "#17142b",
      name: "Vocal",
    };
  }
  if (lower.includes("drum")) {
    return {
      bg: "#15273b",
      waveform: "#38bdf8",
      dimmedBg: "#0f1c2b",
      name: "Drums",
    };
  }
  if (lower.includes("bass")) {
    return {
      bg: "#183626",
      waveform: "#2ee59d",
      dimmedBg: "#11261b",
      name: "Bass",
    };
  }
  if (lower.includes("guitar")) {
    return {
      bg: "#362114",
      waveform: "#fb923c",
      dimmedBg: "#26170e",
      name: "Guitar",
    };
  }
  if (lower.includes("piano")) {
    return {
      bg: "#122e33",
      waveform: "#22d3ee",
      dimmedBg: "#0c2024",
      name: "Piano",
    };
  }
  if (lower.includes("inst") || lower.includes("music") || lower.includes("other")) {
    return {
      bg: "#1b3828",
      waveform: "#2ee59d",
      dimmedBg: "#12261b",
      name: "Music",
    };
  }
  // Default green like the user's screenshot
  return {
    bg: "#1b3828",
    waveform: "#2ee59d",
    dimmedBg: "#12261b",
    name: trackName,
  };
};

/**
 * Interactive Wedge-shaped Volume Slider (DAW Style)
 * Matches the triangular volume ramp with vertical thumb in the user's screenshot.
 */
function WedgeVolumeSlider({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (val: number) => void;
  disabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const updateFromPointer = useCallback(
    (clientX: number) => {
      if (!containerRef.current || disabled) return;
      const rect = containerRef.current.getBoundingClientRect();
      const rawX = clientX - rect.left;
      const clamped = Math.max(0, Math.min(1, rawX / rect.width));
      onChange(Math.round(clamped * 100) / 100);
    },
    [disabled, onChange]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (disabled) return;
    isDragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    updateFromPointer(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (isDragging.current) {
      updateFromPointer(e.clientX);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (isDragging.current) {
      isDragging.current = false;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const width = 48;
  const height = 18;
  const thumbX = Math.max(3, Math.min(width - 3, value * width));

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={cn(
        "relative w-[48px] h-[18px] select-none cursor-pointer flex items-center group",
        disabled && "opacity-40 cursor-not-allowed"
      )}
      title={`Volume: ${Math.round(value * 100)}%`}
    >
      <svg width={width} height={height} className="overflow-visible">
        {/* Background wedge ramp */}
        <polygon
          points={`0,${height} ${width},2 ${width},${height}`}
          fill="#333846"
          className="transition-colors group-hover:fill-[#444a5b]"
        />

        {/* Active volume filled wedge */}
        <clipPath id={`wedge-clip-${thumbX}`}>
          <rect x="0" y="0" width={thumbX} height={height} />
        </clipPath>
        <polygon
          points={`0,${height} ${width},2 ${width},${height}`}
          fill="#ffffff"
          opacity="0.25"
          clipPath={`url(#wedge-clip-${thumbX})`}
        />

        {/* White vertical slider thumb */}
        <rect
          x={thumbX - 2.5}
          y="0"
          width="5"
          height={height}
          rx="1"
          fill="#ffffff"
          className="drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)] group-hover:brightness-110"
        />
      </svg>
    </div>
  );
}

/**
 * Format time with tenths of seconds (e.g. 00:09.2) matching user's screenshot
 */
function formatTimeWithTenths(timeSec: number): string {
  if (isNaN(timeSec) || timeSec < 0) return "00:00.0";
  const mins = Math.floor(timeSec / 60);
  const secs = Math.floor(timeSec % 60);
  const tenths = Math.floor((timeSec % 1) * 10);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${tenths}`;
}

export function DawTrackMixer({ tracks: propTracks, title, onOpenFolder, className }: DawTrackMixerProps) {
  const player = usePlayer();
  const activeTracks = propTracks || player.tracks;

  const waveformContainerRef = useRef<HTMLDivElement>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);

  // Global spacebar listener for play/pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        player.togglePlayPause();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [player]);

  // Waveform click / drag seek handler with offset compensation for the 140px header
  const handleWaveformSeek = useCallback(
    (clientX: number) => {
      if (!waveformContainerRef.current || player.duration <= 0) return;
      const rect = waveformContainerRef.current.getBoundingClientRect();
      const waveLeft = rect.left + TRACK_HEADER_WIDTH;
      const waveWidth = rect.width - TRACK_HEADER_WIDTH;
      if (waveWidth <= 0) return;

      const fraction = Math.max(0, Math.min(1, (clientX - waveLeft) / waveWidth));
      const targetTime = fraction * player.duration;
      player.seek(targetTime);
    },
    [player]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!waveformContainerRef.current) return;
    const rect = waveformContainerRef.current.getBoundingClientRect();
    // Only engage seek if clicking within the waveform area (after 140px)
    if (e.clientX < rect.left + TRACK_HEADER_WIDTH) return;

    setIsScrubbing(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    handleWaveformSeek(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!waveformContainerRef.current || player.duration <= 0) return;
    const rect = waveformContainerRef.current.getBoundingClientRect();
    const waveLeft = rect.left + TRACK_HEADER_WIDTH;
    const waveWidth = rect.width - TRACK_HEADER_WIDTH;

    if (e.clientX >= waveLeft && waveWidth > 0) {
      const fraction = Math.max(0, Math.min(1, (e.clientX - waveLeft) / waveWidth));
      setHoverTime(fraction * player.duration);
    } else {
      setHoverTime(null);
    }

    if (isScrubbing) {
      handleWaveformSeek(e.clientX);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isScrubbing) {
      setIsScrubbing(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const handlePointerLeave = () => {
    if (!isScrubbing) {
      setHoverTime(null);
    }
  };

  if (activeTracks.length === 0) {
    return null;
  }

  const hasSolo = Object.values(player.trackStates).some((s) => s.solo);
  const progressFraction = player.duration > 0 ? player.currentTime / player.duration : 0;
  const hoverFraction = hoverTime !== null && player.duration > 0 ? hoverTime / player.duration : null;

  // Extract song title from first track path or fallback
  const displayTitle =
    title ||
    (activeTracks[0]?.path
      ? activeTracks[0].path.split(/[/\\]/).pop()?.replace(/_\([^)]+\)_[^.]+\.[^.]+$/, "")
      : "Multi-Track Session");

  return (
    <div
      className={cn(
        "flex flex-col bg-[#10121a] border border-[#222533] rounded-xl overflow-hidden shadow-2xl select-none",
        className
      )}
    >
      {/* Top Header & Transport Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-[#141722] border-b border-[#222533]">
        {/* Left: Master Playback Controls */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={player.togglePlayPause}
            disabled={player.isLoadingBuffers}
            className={cn(
              "h-8 px-3.5 font-bold gap-1.5 transition-all",
              player.isPlaying
                ? "bg-amber-500 hover:bg-amber-600 text-black shadow-md shadow-amber-500/20"
                : "bg-primary hover:bg-primary/90 text-primary-foreground"
            )}
          >
            {player.isLoadingBuffers ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : player.isPlaying ? (
              <Pause className="h-4 w-4 fill-current" />
            ) : (
              <Play className="h-4 w-4 fill-current ml-0.5" />
            )}
            <span className="text-xs font-semibold">{player.isPlaying ? "Pause" : "Play"}</span>
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={() => player.seek(0)}
            className="h-8 w-8 text-muted-foreground hover:text-foreground border-[#2a2e40] bg-[#1a1d2b]"
            title="Return to Start (0:00)"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>

          {/* Time Counter Badge */}
          <div className="flex items-center gap-1.5 px-3 py-1 bg-[#0a0c12] border border-[#222533] rounded-md font-mono text-xs">
            <span className="text-emerald-400 font-bold">{formatTimeWithTenths(player.currentTime)}</span>
            <span className="text-muted-foreground/60">/</span>
            <span className="text-muted-foreground">{formatTimeWithTenths(player.duration)}</span>
          </div>

          {player.isLoadingBuffers && (
            <span className="text-[11px] text-amber-400 flex items-center gap-1.5 animate-pulse pl-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Decoding Waveforms...
            </span>
          )}
        </div>

        {/* Right: Song title & Folder */}
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-xs italic text-muted-foreground/80 truncate max-w-[280px]" title={displayTitle}>
              {displayTitle}
            </p>
          </div>

          {hasSolo && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                activeTracks.forEach((t, i) => {
                  const k = getTrackKey(t, i);
                  player.updateTrackState(k, { solo: false });
                });
              }}
              className="h-7 text-[11px] px-2 text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
            >
              Clear Solo
            </Button>
          )}

          {onOpenFolder && (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenFolder}
              className="h-8 px-2.5 text-xs gap-1.5 text-muted-foreground hover:text-foreground border-[#2a2e40] bg-[#1a1d2b]"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Open Folder</span>
            </Button>
          )}
        </div>
      </div>

      {/* Main Multi-Track DAW Container */}
      <div className="flex flex-col relative w-full overflow-hidden bg-[#0c0d14]">
        {/* Synchronized Playhead / Hover Guide Line across ALL tracks */}
        <div
          ref={waveformContainerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          className="relative w-full cursor-crosshair flex flex-col divide-y divide-[#10121a]"
        >
          {/* Active Playhead Cursor Needle */}
          <div
            className="absolute top-0 bottom-0 pointer-events-none z-30 transition-none"
            style={{
              left: `calc(${TRACK_HEADER_WIDTH}px + (100% - ${TRACK_HEADER_WIDTH}px) * ${progressFraction})`,
              transform: "translateX(-50%)",
            }}
          >
            {/* Top Playhead Triangle Handle */}
            <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[7px] border-t-white mx-auto drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />
            {/* Vertical Playhead Needle */}
            <div className="w-[2px] h-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)] mx-auto" />
          </div>

          {/* Hover Guide Line with Floating Time */}
          {hoverFraction !== null && !isScrubbing && (
            <div
              className="absolute top-0 bottom-0 pointer-events-none z-20"
              style={{
                left: `calc(${TRACK_HEADER_WIDTH}px + (100% - ${TRACK_HEADER_WIDTH}px) * ${hoverFraction})`,
                transform: "translateX(-50%)",
              }}
            >
              <div className="w-[1px] h-full bg-white/40 border-r border-dashed border-white/60 mx-auto" />
              <div className="absolute top-1 -translate-x-1/2 bg-black/90 text-white text-[10px] font-mono px-1.5 py-0.5 rounded shadow border border-white/20 whitespace-nowrap">
                {formatTimeWithTenths(hoverTime || 0)}
              </div>
            </div>
          )}

          {/* Render Each Track Lane */}
          {activeTracks.map((track, idx) => {
            const key = getTrackKey(track, idx);
            const state = player.trackStates[key] || { volume: 1, muted: false, solo: false };
            const isAudible = hasSolo ? state.solo : !state.muted;
            const theme = getStemTheme(track.name);
            const trackPeaks = player.peaks[key];

            return (
              <div key={key} className="flex w-full h-[64px] relative group">
                {/* Left Track Control Strip (140px fixed width) */}
                <div className="w-[140px] shrink-0 bg-[#161822] border-r border-[#222533] px-3 flex items-center justify-between z-10">
                  {/* Track Label */}
                  <div className="flex flex-col min-w-0 pr-1">
                    <span
                      className="text-xs font-semibold text-white/90 truncate tracking-wide"
                      title={track.name}
                    >
                      {track.name}
                    </span>
                    <div className="flex items-center gap-1 mt-1">
                      {/* Solo Button (S) */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          player.updateTrackState(key, { solo: !state.solo });
                        }}
                        className={cn(
                          "w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center transition-colors",
                          state.solo
                            ? "bg-amber-500 text-black shadow-[0_0_6px_rgba(245,158,11,0.6)]"
                            : "bg-[#25293a] text-muted-foreground hover:bg-[#32374d] hover:text-white"
                        )}
                        title={state.solo ? "Unsolo" : "Solo (S)"}
                      >
                        S
                      </button>

                      {/* Mute Button (M) */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          player.updateTrackState(key, { muted: !state.muted });
                        }}
                        className={cn(
                          "w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center transition-colors",
                          state.muted
                            ? "bg-rose-600 text-white shadow-[0_0_6px_rgba(225,29,72,0.6)]"
                            : "bg-[#25293a] text-muted-foreground hover:bg-[#32374d] hover:text-white"
                        )}
                        title={state.muted ? "Unmute" : "Mute (M)"}
                      >
                        M
                      </button>
                    </div>
                  </div>

                  {/* Wedge Volume Slider */}
                  <div className="shrink-0 pl-1">
                    <WedgeVolumeSlider
                      value={state.volume}
                      onChange={(vol) => player.updateTrackState(key, { volume: vol })}
                      disabled={!isAudible}
                    />
                  </div>
                </div>

                {/* Right Waveform Lane (Full Remaining Width) */}
                <div
                  className="flex-1 relative overflow-hidden transition-colors duration-200"
                  style={{
                    backgroundColor: isAudible ? theme.bg : theme.dimmedBg,
                  }}
                >
                  {/* Real Waveform Canvas */}
                  <WaveformCanvas
                    peaks={trackPeaks}
                    color={theme.waveform}
                    isAudible={isAudible}
                    height={64}
                  />

                  {/* Muted / Dimmed Overlay */}
                  {!isAudible && (
                    <div className="absolute inset-0 bg-black/40 backdrop-grayscale-[0.5] flex items-center justify-end pr-4 pointer-events-none">
                      <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider bg-black/50 px-2 py-0.5 rounded border border-white/10">
                        {state.muted ? "Muted" : "Dimmed"}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Bottom Time Indicator Display (00:09.2) */}
          <div className="w-full bg-[#0c0d14] border-t border-[#1e202b] py-1.5 flex items-center justify-center">
            <span className="font-mono text-xs text-muted-foreground tracking-widest">
              {formatTimeWithTenths(player.currentTime)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * High-performance Canvas Waveform Renderer with ResizeObserver
 * Draws dual-mirrored peaks symmetrically around the center vertical line.
 */
function WaveformCanvas({
  peaks,
  color,
  isAudible,
  height,
}: {
  peaks?: Float32Array;
  color: string;
  isAudible: boolean;
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.parentElement) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(Math.floor(entry.contentRect.width));
        }
      }
    });

    observer.observe(canvas.parentElement);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = containerWidth || 600;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const centerY = height / 2;
    const maxAmplitude = (height / 2) * 0.88;

    if (!peaks || peaks.length === 0) {
      // Draw subtle placeholder sound wave line while loading
      ctx.strokeStyle = color;
      ctx.globalAlpha = isAudible ? 0.35 : 0.15;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();
      return;
    }

    ctx.fillStyle = color;
    ctx.globalAlpha = isAudible ? 1.0 : 0.25;

    // Step through canvas columns
    const totalPeaks = peaks.length;
    const barWidth = 1.5;
    const barSpacing = 0.5;
    const totalCols = Math.floor(width / (barWidth + barSpacing));

    for (let col = 0; col < totalCols; col++) {
      const peakIdx = Math.floor((col / totalCols) * totalPeaks);
      const amp = (peaks[peakIdx] || 0) * maxAmplitude;
      const x = col * (barWidth + barSpacing);
      const barHeight = Math.max(1.5, amp * 2);
      const y = centerY - barHeight / 2;

      ctx.fillRect(x, y, barWidth, barHeight);
    }
  }, [peaks, color, isAudible, height, containerWidth]);

  return <canvas ref={canvasRef} className="w-full h-full block pointer-events-none" />;
}
