import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { audioMixerEngine, type TrackData } from '@/lib/audioEngine';

export interface TrackState {
  volume: number;
  muted: boolean;
  solo: boolean;
}

export interface TrackInfo {
  name: string; // e.g., "Vocals", "Drums", or filename
  path: string; // Absolute path to the local audio file
  isUrl?: boolean; // True if it's a direct URL
}

export const getTrackKey = (track: TrackInfo, index?: number): string => {
  return track.path || (index !== undefined ? `${track.name}-${index}` : track.name);
};

interface PlayerContextType {
  tracks: TrackInfo[];
  loadTracks: (tracks: TrackInfo[]) => void;
  clearTracks: () => void;
  isVisible: boolean;
  setIsVisible: (visible: boolean) => void;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  togglePlayPause: () => void;
  currentTime: number;
  setCurrentTime: (time: number) => void;
  duration: number;
  setDuration: (duration: number) => void;
  trackStates: Record<string, TrackState>;
  updateTrackState: (key: string, update: Partial<TrackState>) => void;
  seekTarget: number | null;
  seek: (time: number) => void;
  peaks: Record<string, Float32Array>;
  isLoadingBuffers: boolean;
  masterVolume: number;
  setMasterVolume: (volume: number) => void;
  isMasterMuted: boolean;
  setIsMasterMuted: (muted: boolean) => void;
  toggleMasterMute: () => void;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [trackStates, setTrackStates] = useState<Record<string, TrackState>>({});
  const [seekTarget, setSeekTarget] = useState<number | null>(null);
  const [peaks, setPeaks] = useState<Record<string, Float32Array>>({});
  const [isLoadingBuffers, setIsLoadingBuffers] = useState(false);
  const [masterVolume, setMasterVolumeState] = useState(1);
  const [isMasterMuted, setIsMasterMutedState] = useState(false);

  const setMasterVolume = (vol: number) => {
    setMasterVolumeState(vol);
    audioMixerEngine.setMasterVolume(vol);
  };

  const setIsMasterMuted = (muted: boolean) => {
    setIsMasterMutedState(muted);
    audioMixerEngine.setMasterMuted(muted);
  };

  const toggleMasterMute = () => {
    const next = !isMasterMuted;
    setIsMasterMutedState(next);
    audioMixerEngine.setMasterMuted(next);
  };

  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  // Listen to engine updates
  useEffect(() => {
    const unsubTime = audioMixerEngine.onTimeUpdate((time) => {
      setCurrentTime(time);
    });

    const unsubState = audioMixerEngine.onStateChange((playing) => {
      setIsPlaying(playing);
    });

    const unsubBuffers = audioMixerEngine.onBuffersLoaded((newPeaks, dur) => {
      setPeaks(newPeaks);
      setDuration(dur);
      setIsLoadingBuffers(false);
    });

    return () => {
      unsubTime();
      unsubState();
      unsubBuffers();
    };
  }, []);

  const loadTracks = async (newTracks: TrackInfo[]) => {
    setTracks(newTracks);
    const initialStates: Record<string, TrackState> = {};
    const engineTracks: TrackData[] = newTracks.map((track, idx) => {
      const key = getTrackKey(track, idx);
      initialStates[key] = { volume: 1, muted: false, solo: false };
      return {
        key,
        name: track.name,
        path: track.path,
        isUrl: track.isUrl,
      };
    });

    setTrackStates(initialStates);
    setIsLoadingBuffers(true);
    setCurrentTime(0);
    setDuration(0);
    setSeekTarget(0);
    setIsVisible(true);

    try {
      const loadedPeaks = await audioMixerEngine.loadTracks(engineTracks, initialStates);
      setPeaks(loadedPeaks);
      setDuration(audioMixerEngine.getDuration());
      setIsLoadingBuffers(false);
      // Auto-play immediately in sample-accurate sync
      await audioMixerEngine.play(0);
    } catch (err) {
      console.error("Failed to load tracks into audioMixerEngine:", err);
      setIsLoadingBuffers(false);
    }
  };

  const clearTracks = () => {
    audioMixerEngine.stop();
    setTracks([]);
    setTrackStates({});
    setPeaks({});
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setSeekTarget(null);
    setIsVisible(false);
  };

  const updateTrackState = (key: string, update: Partial<TrackState>) => {
    setTrackStates((prev) => {
      const current = prev[key] ?? { volume: 1, muted: false, solo: false };
      const updated = { ...current, ...update };
      audioMixerEngine.updateTrackState(key, updated);
      return {
        ...prev,
        [key]: updated,
      };
    });
  };

  const togglePlayPause = () => {
    audioMixerEngine.togglePlayPause();
  };

  const seek = (time: number) => {
    setCurrentTime(time);
    setSeekTarget(time);
    audioMixerEngine.seek(time);
  };

  return (
    <PlayerContext.Provider
      value={{
        tracks,
        loadTracks,
        clearTracks,
        isVisible,
        setIsVisible,
        isPlaying,
        setIsPlaying,
        togglePlayPause,
        currentTime,
        setCurrentTime,
        duration,
        setDuration,
        trackStates,
        updateTrackState,
        seek,
        peaks,
        isLoadingBuffers,
        masterVolume,
        setMasterVolume,
        isMasterMuted,
        setIsMasterMuted,
        toggleMasterMute,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (context === undefined) {
    throw new Error('usePlayer must be used within a PlayerProvider');
  }
  return context;
}
