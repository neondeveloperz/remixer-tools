import React, { createContext, useContext, useState, ReactNode } from 'react';

export interface TrackInfo {
  name: string; // e.g., "Vocals", "Drums", or filename
  path: string; // Absolute path to the local audio file
  isUrl?: boolean; // True if it's a direct URL (for future-proofing)
}

interface PlayerContextType {
  tracks: TrackInfo[];
  loadTracks: (tracks: TrackInfo[]) => void;
  clearTracks: () => void;
  isVisible: boolean;
  setIsVisible: (visible: boolean) => void;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [isVisible, setIsVisible] = useState(false);

  const loadTracks = (newTracks: TrackInfo[]) => {
    setTracks(newTracks);
    setIsVisible(true);
  };

  const clearTracks = () => {
    setTracks([]);
    setIsVisible(false);
  };

  return (
    <PlayerContext.Provider value={{ tracks, loadTracks, clearTracks, isVisible, setIsVisible }}>
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
