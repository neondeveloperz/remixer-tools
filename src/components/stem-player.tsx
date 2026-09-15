import { useEffect, useRef, useState } from "react";
import { usePlayer } from "@/contexts/PlayerContext";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, X, Volume2, VolumeX, FastForward, Rewind, Music } from "lucide-react";
import { cn } from "@/lib/utils";

interface TrackState {
  volume: number;
  muted: boolean;
  solo: boolean;
}

export function StemPlayer() {
  const { tracks, isVisible, clearTracks } = usePlayer();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [trackStates, setTrackStates] = useState<Record<string, TrackState>>({});
  
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const animationRef = useRef<number>(0);
  const isDraggingRef = useRef(false);

  // Initialize track states when tracks change
  useEffect(() => {
    // Cleanup old tracks from audioRefs
    const activeTrackNames = new Set(tracks.map(t => t.name));
    Object.keys(audioRefs.current).forEach(key => {
      if (!activeTrackNames.has(key)) {
        const el = audioRefs.current[key];
        if (el) {
          el.pause();
          el.removeAttribute('src');
          el.load();
        }
        delete audioRefs.current[key];
      }
    });

    if (tracks.length > 0) {
      const initialStates: Record<string, TrackState> = {};
      tracks.forEach(track => {
        initialStates[track.name] = { volume: 1, muted: false, solo: false };
      });
      setTrackStates(initialStates);
      setIsPlaying(true);
      setCurrentTime(0);
      setDuration(0);
    } else {
      setIsPlaying(false);
    }
  }, [tracks]);

  // Sync state to audio elements
  useEffect(() => {
    const hasSolo = Object.values(trackStates).some(s => s.solo);

    Object.keys(audioRefs.current).forEach(trackName => {
      const audio = audioRefs.current[trackName];
      const state = trackStates[trackName];
      if (audio && state) {
        audio.volume = state.volume;
        // If any track is solo'd, mute this track unless it is also solo'd. 
        // Otherwise, use the track's own muted state.
        audio.muted = hasSolo ? !state.solo : state.muted;
      }
    });
  }, [trackStates]);

  const togglePlayPause = () => {
    if (isPlaying) {
      Object.values(audioRefs.current).forEach(audio => audio.pause());
    } else {
      Object.values(audioRefs.current).forEach(audio => {
        // Only play if it's not at the end
        if (audio.currentTime < audio.duration || isNaN(audio.duration)) {
          audio.play().catch(e => console.error("Playback error:", e));
        }
      });
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeekDrag = (value: number | readonly number[]) => {
    isDraggingRef.current = true;
    setCurrentTime(Array.isArray(value) ? value[0] : value);
  };

  const handleSeekCommit = (value: number | readonly number[]) => {
    const time = Array.isArray(value) ? value[0] : value;
    setCurrentTime(time);
    Object.values(audioRefs.current).forEach(audio => {
      audio.currentTime = time;
    });
    // Add a tiny delay before releasing drag state to prevent race conditions with requestAnimationFrame
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 50);
  };

  // Main playback loop for current time
  useEffect(() => {
    const updateProgress = () => {
      // Use the first track as the master timekeeper
      const masterTrack = audioRefs.current[tracks[0]?.name];
      if (masterTrack) {
        if (!isDraggingRef.current) {
          setCurrentTime(masterTrack.currentTime);
        }
        if (!isNaN(masterTrack.duration) && masterTrack.duration > duration) {
          setDuration(masterTrack.duration);
        }
        
        // Handle end of playback
        if (masterTrack.ended) {
          setIsPlaying(false);
          setCurrentTime(0);
          Object.values(audioRefs.current).forEach(audio => {
            audio.currentTime = 0;
            audio.pause();
          });
        }
      }
      
      if (isPlaying) {
        animationRef.current = requestAnimationFrame(updateProgress);
      }
    };

    if (isPlaying) {
      animationRef.current = requestAnimationFrame(updateProgress);
    }

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, tracks, duration]);

  if (!isVisible || tracks.length === 0) return null;

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const updateTrackState = (name: string, updates: Partial<TrackState>) => {
    setTrackStates(prev => ({
      ...prev,
      [name]: { ...prev[name], ...updates }
    }));
  };

  const isMultiTrack = tracks.length > 1;

  return (
    <Card className="fixed bottom-0 left-0 right-0 z-50 rounded-none border-t border-b-0 border-l-0 border-r-0 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 flex flex-col items-center">
      {/* Hidden audio elements */}
      {tracks.map((track, i) => (
        <audio
          key={track.path}
          ref={el => {
            if (el) audioRefs.current[track.name] = el;
          }}
          src={track.isUrl ? track.path : convertFileSrc(track.path)}
          preload="auto"
          autoPlay
          onPlay={(e) => {
            if (i === 0) {
              setIsPlaying(true);
              Object.values(audioRefs.current).forEach(a => {
                if (a !== e.target && a.paused) {
                  a.play().catch(err => console.error(err));
                }
              });
            }
          }}
          onPause={(e) => {
            if (i === 0) {
              setIsPlaying(false);
              Object.values(audioRefs.current).forEach(a => {
                if (a !== e.target && !a.paused) {
                  a.pause();
                }
              });
            }
          }}
        />
      ))}

      {/* Progress Bar Absolute at Top */}
      <div className="w-full absolute top-[-6px] h-3 group flex items-center z-[100] px-0">
        <Slider
          value={[currentTime]}
          max={duration || 100}
          step={0.1}
          onValueChange={handleSeekDrag}
          onValueCommitted={handleSeekCommit}
          className="w-full cursor-pointer opacity-80 group-hover:opacity-100 transition-opacity [&_[data-slot=slider-track]]:rounded-none [&_[data-slot=slider-track]]:h-1 group-hover:[&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-thumb]]:opacity-0 group-hover:[&_[data-slot=slider-thumb]]:opacity-100"
        />
      </div>

      <div className="flex items-center justify-between w-full max-w-screen-2xl mx-auto h-16 px-4">
        {/* Left: Track Info */}
        <div className="flex items-center flex-1 min-w-0 gap-3 overflow-hidden pr-4">
          <div className="h-10 w-10 bg-muted rounded-md flex items-center justify-center shrink-0">
            <Music className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex flex-col truncate">
            <span className="text-sm font-semibold truncate" title={tracks[0]?.name}>{tracks[0]?.name || "Playing"}</span>
            <span className="text-[10px] text-muted-foreground font-mono">{formatTime(currentTime)} / {formatTime(duration)}</span>
          </div>
        </div>

        {/* Center: Main Controls */}
        <div className="flex flex-col items-center justify-center shrink-0">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => handleSeekCommit([Math.max(0, currentTime - 10)])} className="h-8 w-8 text-muted-foreground hover:text-foreground">
              <Rewind className="h-4 w-4" />
            </Button>
            <Button variant="default" size="icon" className="h-9 w-9 rounded-full hover:scale-105 transition-transform shrink-0" onClick={togglePlayPause}>
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => handleSeekCommit([Math.min(duration, currentTime + 10)])} className="h-8 w-8 text-muted-foreground hover:text-foreground">
              <FastForward className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Right: Mixers & Close */}
        <div className="flex items-center justify-end flex-1 min-w-0 gap-4 pl-4">
          <div className={cn("flex items-center gap-2", isMultiTrack ? "flex-wrap justify-end" : "w-32")}>
            {tracks.map(track => {
              const state = trackStates[track.name] || { volume: 1, muted: false, solo: false };
              const hasSolo = Object.values(trackStates).some(s => s.solo);
              const isEffectivelyMuted = state.muted || (hasSolo && !state.solo);

              return (
                <div key={track.name} className={cn("flex items-center gap-2", isMultiTrack ? "w-[110px] bg-muted/40 p-1 px-2 rounded-full border border-border/50" : "w-full")}>
                  {isMultiTrack ? (
                    <div className="flex gap-0.5 shrink-0">
                      <button onClick={() => updateTrackState(track.name, { muted: !state.muted })} className={cn("text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center cursor-pointer transition-colors", state.muted ? "bg-destructive text-destructive-foreground" : "bg-muted text-muted-foreground hover:bg-muted-foreground/20")}>M</button>
                      <button onClick={() => updateTrackState(track.name, { solo: !state.solo })} className={cn("text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center cursor-pointer transition-colors", state.solo ? "bg-yellow-500 text-yellow-950" : "bg-muted text-muted-foreground hover:bg-muted-foreground/20")}>S</button>
                    </div>
                  ) : (
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => updateTrackState(track.name, { muted: !state.muted })}>
                      {isEffectivelyMuted ? <VolumeX className="h-3 w-3 text-destructive" /> : <Volume2 className="h-3 w-3 text-muted-foreground" />}
                    </Button>
                  )}
                  <Slider
                    value={[state.volume]}
                    max={1}
                    step={0.01}
                    onValueChange={(val) => updateTrackState(track.name, { volume: Array.isArray(val) ? val[0] : val })}
                    className={cn("flex-1", isEffectivelyMuted && "opacity-50")}
                  />
                </div>
              );
            })}
          </div>
          <Button variant="ghost" size="icon" onClick={clearTracks} className="text-muted-foreground hover:text-foreground shrink-0 border border-border/50 bg-muted/20">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
