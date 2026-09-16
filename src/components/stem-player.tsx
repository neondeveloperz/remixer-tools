import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayer } from "@/contexts/PlayerContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, X, Volume2, VolumeX, FastForward, Rewind, Music, Loader2 } from "lucide-react";

export function StemPlayer() {
  const {
    tracks,
    isVisible,
    clearTracks,
    isPlaying,
    togglePlayPause,
    currentTime,
    duration,
    seek,
    isLoadingBuffers,
    masterVolume,
    setMasterVolume,
    isMasterMuted,
    setIsMasterMuted,
    toggleMasterMute,
  } = usePlayer();

  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);
  const [extractedCover, setExtractedCover] = useState<string | null>(null);
  const [hasImageError, setHasImageError] = useState(false);

  const activeTrack = tracks[0];
  const activeCover = activeTrack?.coverUrl || extractedCover;

  useEffect(() => {
    let isMounted = true;
    setExtractedCover(null);
    setHasImageError(false);

    if (!activeTrack || activeTrack.coverUrl) {
      return;
    }

    // 1. Fast cache check from localStorage remixer_downloads
    try {
      const saved = localStorage.getItem("remixer_downloads");
      if (saved && activeTrack.path) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const filename = activeTrack.path.split(/[/\\]/).pop() || "";
          const fileBase = filename.replace(/\.[^/.]+$/, "");
          const found = parsed.find(
            (item: any) =>
              item.filepath === activeTrack.path ||
              (item.title && (filename.includes(item.title) || item.title.includes(fileBase)))
          );
          if (found?.thumbnail && isMounted) {
            setExtractedCover(found.thumbnail);
            return;
          }
        }
      }
    } catch {
      // ignore
    }

    // 2. Extract embedded cover art from audio file metadata via backend
    if (activeTrack.path && !activeTrack.isUrl) {
      invoke<string | null>("get_audio_cover", { filePath: activeTrack.path })
        .then((cover) => {
          if (isMounted && cover) {
            setExtractedCover(cover);
          }
        })
        .catch((err) => {
          console.warn("Could not extract cover art:", err);
        });
    }

    return () => {
      isMounted = false;
    };
  }, [activeTrack?.path, activeTrack?.coverUrl]);

  if (!isVisible || tracks.length === 0) return null;

  const formatTime = (time: number) => {
    if (isNaN(time) || time < 0) return "0:00";
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const isMultiTrack = tracks.length > 1;
  const effectiveCurrentTime = isDragging ? dragTime : currentTime;

  const handleSeekDrag = (value: number | readonly number[]) => {
    setIsDragging(true);
    setDragTime(Array.isArray(value) ? value[0] : value);
  };

  const handleSeekCommit = (value: number | readonly number[]) => {
    const time = Array.isArray(value) ? value[0] : value;
    seek(time);
    setIsDragging(false);
  };

  return (
    <Card className="fixed bottom-0 left-0 right-0 z-50 rounded-none border-t border-b-0 border-l-0 border-r-0 shadow-[0_-4px_20px_rgba(0,0,0,0.2)] bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 flex flex-col items-center select-none overflow-visible py-0">
      {/* Top Progress Bar with smooth hover reveal thumb */}
      <div className="w-full absolute top-[-5px] h-3 group flex items-center z-[100] px-0 cursor-pointer">
        <Slider
          value={[effectiveCurrentTime]}
          max={duration || 100}
          step={0.1}
          onValueChange={handleSeekDrag}
          onValueCommitted={handleSeekCommit}
          className="w-full cursor-pointer opacity-90 group-hover:opacity-100 transition-opacity [&_[data-slot=slider-track]]:rounded-none [&_[data-slot=slider-track]]:h-1 group-hover:[&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:shadow-md [&_[data-slot=slider-thumb]]:opacity-0 group-hover:[&_[data-slot=slider-thumb]]:opacity-100 transition-all"
        />
      </div>

      <div className="flex items-center justify-between w-full max-w-screen-2xl mx-auto h-16 px-4 md:px-6">
        {/* Left: Track Info & Album Art */}
        <div className="flex items-center flex-1 min-w-0 gap-3 pr-4 overflow-hidden">
          <div className="h-10 w-10 bg-primary/10 text-primary rounded-md flex items-center justify-center shrink-0 border border-primary/20 overflow-hidden shadow-xs">
            {isLoadingBuffers ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : activeCover && !hasImageError ? (
              <img
                src={activeCover}
                alt={activeTrack?.name || "Cover art"}
                className="h-full w-full object-cover"
                onError={() => setHasImageError(true)}
              />
            ) : (
              <Music className="h-5 w-5" />
            )}
          </div>
          <div className="flex flex-col min-w-0 truncate">
            <span className="text-sm font-semibold truncate" title={tracks[0]?.name}>
              {isMultiTrack ? `${tracks[0]?.name || "STEMs"} (+${tracks.length - 1} stems)` : tracks[0]?.name || "Audio Track"}
            </span>
            <span className="text-[11px] text-muted-foreground font-mono truncate">
              {isLoadingBuffers ? "Decoding audio..." : `${formatTime(effectiveCurrentTime)} / ${formatTime(duration)}`}
            </span>
          </div>
        </div>

        {/* Center: Playback Controls (Locked Dead-Center!) */}
        <div className="flex items-center justify-center shrink-0 gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => seek(Math.max(0, currentTime - 5))}
            title="Rewind 5s"
          >
            <Rewind className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            className="h-9 w-9 rounded-full shadow-md transition-all hover:scale-105 shrink-0"
            onClick={togglePlayPause}
            disabled={isLoadingBuffers}
          >
            {isLoadingBuffers ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isPlaying ? (
              <Pause className="h-4 w-4 fill-current" />
            ) : (
              <Play className="h-4 w-4 fill-current ml-0.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => seek(Math.min(duration, currentTime + 5))}
            title="Forward 5s"
          >
            <FastForward className="h-4 w-4" />
          </Button>
        </div>

        {/* Right: Master Volume & Close */}
        <div className="flex items-center justify-end flex-1 min-w-0 gap-3 pl-4">
          <div className="flex items-center gap-2 w-32 sm:w-40">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
              onClick={toggleMasterMute}
              title={isMasterMuted ? "Unmute" : "Mute"}
            >
              {isMasterMuted || masterVolume === 0 ? (
                <VolumeX className="h-4 w-4 text-destructive" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </Button>
            <Slider
              value={[isMasterMuted ? 0 : masterVolume]}
              max={1}
              step={0.01}
              onValueChange={(val) => {
                const v = Array.isArray(val) ? val[0] : val;
                setMasterVolume(v);
                if (isMasterMuted && v > 0) {
                  setIsMasterMuted(false);
                }
              }}
              className="flex-1 cursor-pointer"
            />
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={clearTracks}
            className="text-muted-foreground hover:text-foreground shrink-0 border border-border/50 bg-muted/20 h-8 w-8"
            title="Close Player"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
