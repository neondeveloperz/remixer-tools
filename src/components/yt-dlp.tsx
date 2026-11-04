import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  Pause,
  Play,
  X,
  LayoutList,
  FolderOpen,
  ListMusic,
  CheckSquare,
  Square,
  Trash2,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { usePlayer } from "@/contexts/PlayerContext";

export interface DownloadItem {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  quality: string;
  format: string;
  progress: number;
  speed: string;
  downloaded: string;
  total: string;
  eta: string;
  filepath?: string;
  status: 'queued' | 'initializing' | 'downloading' | 'analyzing' | 'completed' | 'error' | 'cancelled';
  log: string[];
}

export interface PlaylistEntry {
  id: string;
  title: string;
  url: string;
  duration?: number;
  thumbnail?: string;
  uploader?: string;
  selected?: boolean;
}

export interface PlaylistState {
  id: string;
  title: string;
  uploader?: string;
  trackCount: number;
  entries: PlaylistEntry[];
}

function formatDuration(sec?: number): string {
  if (!sec || isNaN(sec)) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function YtDlp() {
  const player = usePlayer();
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState("mp3_meta");
  const [quality, setQuality] = useState("best");
  const [isCheckingInfo, setIsCheckingInfo] = useState(false);
  const [isQueuePaused, setIsQueuePaused] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState<number>(2);

  // Playlist inspection modal / panel state
  const [playlist, setPlaylist] = useState<PlaylistState | null>(null);
  const [playlistSearch, setPlaylistSearch] = useState("");

  const [downloads, setDownloads] = useState<DownloadItem[]>(() => {
    const saved = localStorage.getItem("remixer_downloads");
    if (saved) {
      try {
        const parsed: DownloadItem[] = JSON.parse(saved);
        // Reset any unfinalized active downloads from previous sessions to error/cancelled
        return parsed.map(item => {
          if (item.status === 'initializing' || item.status === 'downloading' || item.status === 'analyzing') {
            return { ...item, status: 'cancelled', eta: 'Interrupted' };
          }
          return item;
        });
      } catch (e) {
        console.error("Failed to parse saved downloads", e);
      }
    }
    return [];
  });

  const filepathsRef = useRef<Record<string, string>>({});

  // Load user default settings on mount
  useEffect(() => {
    const initDefaults = async () => {
      try {
        const s = await invoke<any>("get_settings");
        if (s.default_format) setFormat(s.default_format);
        if (s.default_quality) setQuality(s.default_quality);
        if (s.max_concurrent_downloads) setMaxConcurrent(s.max_concurrent_downloads);
      } catch (e) {
        console.warn("Failed to read settings in yt-dlp:", e);
      }
    };
    initDefaults();
  }, []);

  // Detect playlist url pattern
  const isPlaylistUrl = (testUrl: string) => {
    const trimmed = testUrl.trim().toLowerCase();
    return (
      trimmed.includes("list=") ||
      trimmed.includes("/sets/") ||
      trimmed.includes("/albums/") ||
      trimmed.includes("playlist")
    );
  };

  useEffect(() => {
    const unlistenProgress = listen<{ id: string; data: string }>("ytdlp-progress", (event) => {
      const { id, data } = event.payload;
      try {
        const parsed = JSON.parse(data);
        const percentRaw = parsed.progress?.replace('%', '')?.trim() || '0';
        const percent = Math.min(100, Math.max(0, parseFloat(percentRaw)));

        setDownloads(prev => prev.map(d => {
          if (d.id === id) {
            return {
              ...d,
              progress: isNaN(percent) ? d.progress : percent,
              speed: parsed.speed || d.speed,
              eta: parsed.eta || d.eta,
              downloaded: parsed.downloaded || d.downloaded,
              total: parsed.total || d.total,
              status: 'downloading'
            };
          }
          return d;
        }));
      } catch (e) {
        console.error("Failed to parse progress", e);
      }
    });

    const unlistenLog = listen<string>("ytdlp-log", (event) => {
      console.log("[yt-dlp]", event.payload);
    });

    const unlistenFilepath = listen<{ id: string; path: string }>("ytdlp-filepath", (event) => {
      const { id, path } = event.payload;
      if (id && path) {
        filepathsRef.current[id] = path;
      }
      setDownloads(prev => prev.map(d => {
        if (d.id === id) {
          return { ...d, filepath: path };
        }
        return d;
      }));
    });

    const unlistenDone = listen<any>("ytdlp-done", async (event) => {
      const id = typeof event.payload === 'string' ? event.payload : event.payload?.id;
      const targetPath = (typeof event.payload === 'object' && event.payload?.filepath)
        ? event.payload.filepath
        : filepathsRef.current[id];

      if (targetPath) {
        let shouldAnalyze = true;
        try {
          const s = await invoke<any>("get_settings");
          if (s.auto_analyze_audio === false) {
            shouldAnalyze = false;
          }
        } catch {
          // fallback to analyzing
        }

        if (shouldAnalyze) {
          // Update status to analyzing BPM & Key
          setDownloads(current => current.map(item => item.id === id ? { ...item, status: 'analyzing', eta: 'Analyzing BPM & Key...' } : item));

          try {
            const res = await invoke<{ success: boolean; new_path?: string; bpm?: number; key?: string; message?: string }>("analyze_and_rename_audio", {
              filePath: targetPath
            });

            const finalPath = res.new_path || targetPath;
            setDownloads(current => current.map(item => {
              if (item.id === id) {
                return {
                  ...item,
                  status: 'completed',
                  progress: 100,
                  eta: '00:00',
                  filepath: finalPath
                };
              }
              return item;
            }));
          } catch (e) {
            console.error("Analysis failed:", e);
            setDownloads(current => current.map(item => {
              if (item.id === id) {
                return { ...item, status: 'completed', progress: 100, eta: '00:00', filepath: targetPath };
              }
              return item;
            }));
          }
        } else {
          // Skip auto analysis and mark complete
          setDownloads(current => current.map(item => {
            if (item.id === id) {
              return { ...item, status: 'completed', progress: 100, eta: '00:00', filepath: targetPath };
            }
            return item;
          }));
        }
      } else {
        setDownloads(current => current.map(item => {
          if (item.id === id) {
            return { ...item, status: 'completed', progress: 100, eta: '00:00' };
          }
          return item;
        }));
      }
    });

    return () => {
      unlistenProgress.then(fn => fn());
      unlistenLog.then(fn => fn());
      unlistenDone.then(fn => fn());
      unlistenFilepath.then(fn => fn());
    };
  }, []);

  // Save to local storage
  useEffect(() => {
    localStorage.setItem("remixer_downloads", JSON.stringify(downloads));
  }, [downloads]);

  // Queue Manager: picks next 'queued' item when slots available
  useEffect(() => {
    if (isQueuePaused) return;

    const activeCount = downloads.filter(d => d.status === 'initializing' || d.status === 'downloading' || d.status === 'analyzing').length;
    if (activeCount >= maxConcurrent) return;

    const nextItem = downloads.find(d => d.status === 'queued');
    if (!nextItem) return;

    // Start downloading the next item
    const startItem = async () => {
      setDownloads(prev => prev.map(d => d.id === nextItem.id ? { ...d, status: 'downloading', eta: 'Starting...' } : d));

      try {
        await invoke("run_ytdlp", {
          id: nextItem.id,
          url: nextItem.url,
          format: nextItem.format,
          quality: nextItem.quality
        });
      } catch (e) {
        console.error("Failed to run yt-dlp:", e);
        setDownloads(prev => prev.map(d => d.id === nextItem.id ? { ...d, status: 'error', eta: 'Failed to start' } : d));
      }
    };

    startItem();
  }, [downloads, isQueuePaused, maxConcurrent]);

  // Handle URL submit
  const handleFetchOrDownload = async () => {
    if (!url.trim()) return;
    setIsCheckingInfo(true);

    try {
      if (isPlaylistUrl(url)) {
        // Fetch playlist metadata
        const playlistJsonStr = await invoke<string>("get_playlist_info", { url: url.trim() });
        const parsed = JSON.parse(playlistJsonStr);

        if (parsed._type === "playlist" && Array.isArray(parsed.entries) && parsed.entries.length > 0) {
          const entries: PlaylistEntry[] = parsed.entries
            .filter((e: any) => e && (e.id || e.url))
            .map((e: any) => ({
              id: e.id || Math.random().toString(36).substring(7),
              title: e.title || "Untitled Track",
              url: e.url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : url),
              duration: e.duration,
              thumbnail: e.thumbnails?.[0]?.url || e.thumbnail || "",
              uploader: e.uploader || e.channel || parsed.uploader || "",
              selected: true,
            }));

          setPlaylist({
            id: parsed.id || "playlist",
            title: parsed.title || "Playlist",
            uploader: parsed.uploader || parsed.channel,
            trackCount: entries.length,
            entries
          });
          setIsCheckingInfo(false);
          return;
        }
      }

      // Single video fallback/direct flow
      const infoStr = await invoke<string>("get_video_info", { url: url.trim() });
      const info = JSON.parse(infoStr);

      const newItem: DownloadItem = {
        id: Math.random().toString(36).substring(7),
        url: url.trim(),
        title: info.title || "Unknown Video",
        thumbnail: info.thumbnail || "",
        format,
        quality,
        progress: 0,
        speed: "0B/s",
        downloaded: "0B",
        total: "Unknown",
        eta: "queued",
        status: 'queued',
        log: []
      };

      setDownloads(prev => [newItem, ...prev]);
      setUrl("");
    } catch (e) {
      console.error("Failed to check video info:", e);
      alert(`Could not fetch video/playlist: ${e}`);
    } finally {
      setIsCheckingInfo(false);
    }
  };

  // Add selected playlist tracks into queue
  const queueSelectedPlaylistTracks = () => {
    if (!playlist) return;

    const selectedEntries = playlist.entries.filter(e => e.selected);
    if (selectedEntries.length === 0) {
      alert("Please select at least one track to download.");
      return;
    }

    const newItems: DownloadItem[] = selectedEntries.map(entry => ({
      id: Math.random().toString(36).substring(7),
      url: entry.url,
      title: entry.title,
      thumbnail: entry.thumbnail || "",
      format,
      quality,
      progress: 0,
      speed: "0B/s",
      downloaded: "0B",
      total: "Unknown",
      eta: "queued",
      status: 'queued',
      log: []
    }));

    setDownloads(prev => [...newItems, ...prev]);
    setPlaylist(null);
    setUrl("");
  };

  const toggleSelectAllPlaylist = (selected: boolean) => {
    if (!playlist) return;
    setPlaylist({
      ...playlist,
      entries: playlist.entries.map(e => ({ ...e, selected }))
    });
  };

  const togglePlaylistEntry = (id: string) => {
    if (!playlist) return;
    setPlaylist({
      ...playlist,
      entries: playlist.entries.map(e => e.id === id ? { ...e, selected: !e.selected } : e)
    });
  };

  const cancelDownloadItem = async (id: string) => {
    try {
      await invoke("cancel_download", { id });
    } catch (e) {
      console.warn("Cancel invoke error:", e);
    }
    setDownloads(prev => prev.map(d => d.id === id ? { ...d, status: 'cancelled', eta: 'Cancelled' } : d));
  };

  const retryDownloadItem = (id: string) => {
    setDownloads(prev => prev.map(d => d.id === id ? { ...d, status: 'queued', progress: 0, eta: 'queued' } : d));
  };

  const removeDownload = (id: string) => {
    setDownloads(prev => prev.filter(d => d.id !== id));
  };

  const clearCompletedDownloads = () => {
    setDownloads(prev => prev.filter(d => d.status !== 'completed' && d.status !== 'cancelled' && d.status !== 'error'));
  };

  const openDownloadFolder = async () => {
    try {
      await invoke("open_download_folder");
    } catch (e) {
      console.error("Failed to open folder", e);
    }
  };

  // Filtered playlist entries
  const filteredPlaylistEntries = playlist?.entries.filter(e =>
    e.title.toLowerCase().includes(playlistSearch.toLowerCase()) ||
    (e.uploader && e.uploader.toLowerCase().includes(playlistSearch.toLowerCase()))
  ) || [];

  const selectedPlaylistCount = playlist?.entries.filter(e => e.selected).length || 0;

  // Queue stats
  const activeCount = downloads.filter(d => d.status === 'initializing' || d.status === 'downloading' || d.status === 'analyzing').length;
  const queuedCount = downloads.filter(d => d.status === 'queued').length;
  const completedCount = downloads.filter(d => d.status === 'completed').length;

  return (
    <div className="space-y-6">
      {/* Downloader Form Card */}
      <Card className="w-full">
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="flex items-center gap-2">
                Downloader & Playlist Batch
                {isPlaylistUrl(url) && (
                  <Badge variant="secondary" className="text-xs bg-primary/20 text-primary border-primary/30">
                    Playlist Detected
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Download single videos, YouTube playlists, or SoundCloud sets directly into your library.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Max Concurrent:</Label>
              <Select
                value={maxConcurrent.toString()}
                onValueChange={(val) => { if (val) setMaxConcurrent(parseInt(val) || 2); }}
              >
                <SelectTrigger className="h-8 w-20 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="4">4</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2">
            <div className="space-y-1">
              <Label htmlFor="video-url">Video or Playlist URL</Label>
              <Input
                id="video-url"
                placeholder="https://www.youtube.com/playlist?list=... or https://soundcloud.com/.../sets/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleFetchOrDownload(); }}
                disabled={isCheckingInfo}
              />
            </div>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1">
                <Label>Format</Label>
                <Select
                  value={format}
                  onValueChange={(val) => { if (val) { setFormat(val); setQuality("best"); } }}
                  disabled={isCheckingInfo}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Format" />
                  </SelectTrigger>
                  <SelectContent className="max-h-84">
                    <SelectGroup>
                      <SelectLabel className="text-[11px] font-semibold text-muted-foreground uppercase">
                        Lossless Studio Audio
                      </SelectLabel>
                      <SelectItem value="wav">WAV (Lossless PCM)</SelectItem>
                      <SelectItem value="flac">FLAC (Free Lossless Codec)</SelectItem>
                      <SelectItem value="alac">ALAC (Apple Lossless)</SelectItem>
                      <SelectItem value="aiff">AIFF (Uncompressed CDJ)</SelectItem>
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel className="text-[11px] font-semibold text-muted-foreground uppercase">
                        Compressed High-Res Audio
                      </SelectLabel>
                      <SelectItem value="mp3_meta">MP3 (with Cover Art & Tags)</SelectItem>
                      <SelectItem value="mp3">MP3 (Standard Clean)</SelectItem>
                      <SelectItem value="m4a">M4A (Apple AAC + Meta)</SelectItem>
                      <SelectItem value="opus">Opus (Highest Streaming Fidelity)</SelectItem>
                      <SelectItem value="aac">AAC (Advanced Audio)</SelectItem>
                      <SelectItem value="ogg">OGG (Ogg Vorbis)</SelectItem>
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel className="text-[11px] font-semibold text-muted-foreground uppercase">
                        Video Formats
                      </SelectLabel>
                      <SelectItem value="video">MP4 (Universal H.264/AAC)</SelectItem>
                      <SelectItem value="mkv">MKV (Matroska High Definition)</SelectItem>
                      <SelectItem value="webm">WebM (VP9/AV1 + Opus)</SelectItem>
                      <SelectItem value="mov">MOV (Apple QuickTime)</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Quality</Label>
                <Select
                  value={quality}
                  onValueChange={(val) => { if (val) setQuality(val); }}
                  disabled={isCheckingInfo}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Quality" />
                  </SelectTrigger>
                  <SelectContent>
                    {['video', 'mp4', 'mkv', 'webm', 'mov'].includes(format) ? (
                      <>
                        <SelectItem value="best">Best Quality Available</SelectItem>
                        <SelectItem value="4320p">8K Ultra HD (4320p)</SelectItem>
                        <SelectItem value="2160p">4K Ultra HD (2160p)</SelectItem>
                        <SelectItem value="1440p">2K Quad HD (1440p)</SelectItem>
                        <SelectItem value="1080p">Full HD (1080p 60fps)</SelectItem>
                        <SelectItem value="720p">HD (720p)</SelectItem>
                        <SelectItem value="480p">SD (480p)</SelectItem>
                        <SelectItem value="360p">Low (360p)</SelectItem>
                      </>
                    ) : ['wav', 'flac', 'alac', 'aiff'].includes(format) ? (
                      <>
                        <SelectItem value="best">Lossless (Source PCM)</SelectItem>
                      </>
                    ) : (
                      <>
                        <SelectItem value="best">Best Audio (up to 320kbps)</SelectItem>
                        <SelectItem value="320K">320 kbps (Extreme Quality)</SelectItem>
                        <SelectItem value="256K">256 kbps (High Quality)</SelectItem>
                        <SelectItem value="192K">192 kbps (Standard Quality)</SelectItem>
                        <SelectItem value="128K">128 kbps (Space Saver)</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleFetchOrDownload}
                disabled={isCheckingInfo || !url.trim()}
                className="ml-auto min-w-[140px]"
              >
                {isCheckingInfo ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Checking...
                  </>
                ) : isPlaylistUrl(url) ? (
                  <>
                    <ListMusic className="mr-2 h-4 w-4" />
                    Load Playlist
                  </>
                ) : (
                  "Download"
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Playlist Inspector Card */}
      {playlist && (
        <Card className="border-primary/40 bg-card/70 shadow-lg">
          <CardHeader className="pb-3 border-b border-border/50">
            <div className="flex flex-col md:flex-row justify-between md:items-center gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-primary text-primary">Playlist</Badge>
                  <CardTitle className="text-lg">{playlist.title}</CardTitle>
                </div>
                <CardDescription className="mt-1">
                  {playlist.uploader && `By ${playlist.uploader} • `}
                  {selectedPlaylistCount} of {playlist.trackCount} tracks selected for batch download
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleSelectAllPlaylist(selectedPlaylistCount < playlist.entries.length)}
                >
                  {selectedPlaylistCount === playlist.entries.length ? (
                    <>
                      <Square className="w-4 h-4 mr-1.5" /> Deselect All
                    </>
                  ) : (
                    <>
                      <CheckSquare className="w-4 h-4 mr-1.5" /> Select All
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  onClick={queueSelectedPlaylistTracks}
                  disabled={selectedPlaylistCount === 0}
                  className="bg-primary text-primary-foreground"
                >
                  Queue Selected ({selectedPlaylistCount})
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPlaylist(null)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="mt-3 relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Search tracks in playlist..."
                value={playlistSearch}
                onChange={(e) => setPlaylistSearch(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0 max-h-[360px] overflow-y-auto divide-y divide-border/40">
            {filteredPlaylistEntries.map((entry, index) => (
              <div
                key={entry.id || index}
                onClick={() => togglePlaylistEntry(entry.id)}
                className={`flex items-center gap-3 p-2.5 px-4 cursor-pointer transition-colors hover:bg-muted/50 ${
                  entry.selected ? "bg-primary/5" : "opacity-60"
                }`}
              >
                <Checkbox
                  checked={entry.selected}
                  onCheckedChange={() => togglePlaylistEntry(entry.id)}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="text-xs text-muted-foreground w-6 text-right font-mono">
                  {index + 1}
                </span>
                {entry.thumbnail ? (
                  <img
                    src={entry.thumbnail}
                    alt={entry.title}
                    className="w-10 h-10 rounded object-cover shrink-0 bg-muted"
                  />
                ) : (
                  <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0">
                    <ListMusic className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{entry.title}</div>
                  {entry.uploader && (
                    <div className="text-xs text-muted-foreground truncate">{entry.uploader}</div>
                  )}
                </div>
                <div className="text-xs font-mono text-muted-foreground shrink-0">
                  {formatDuration(entry.duration)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Downloads & Batch Queue List */}
      {downloads.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <LayoutList className="w-4 h-4" /> Download & Batch Queue
              </h3>
              <div className="flex gap-1.5 text-xs">
                {activeCount > 0 && (
                  <Badge variant="outline" className="text-blue-400 border-blue-400/40 bg-blue-500/10">
                    {activeCount} Active
                  </Badge>
                )}
                {queuedCount > 0 && (
                  <Badge variant="outline" className="text-amber-400 border-amber-400/40 bg-amber-500/10">
                    {queuedCount} Queued
                  </Badge>
                )}
                {completedCount > 0 && (
                  <Badge variant="outline" className="text-emerald-400 border-emerald-400/40 bg-emerald-500/10">
                    {completedCount} Completed
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {queuedCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsQueuePaused(!isQueuePaused)}
                  className="text-xs h-8"
                >
                  {isQueuePaused ? (
                    <>
                      <Play className="w-3.5 h-3.5 mr-1 text-emerald-400" /> Resume Queue
                    </>
                  ) : (
                    <>
                      <Pause className="w-3.5 h-3.5 mr-1 text-amber-400" /> Pause Queue
                    </>
                  )}
                </Button>
              )}
              {completedCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearCompletedDownloads}
                  className="text-xs h-8 text-muted-foreground hover:text-foreground"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Clear Completed
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={openDownloadFolder}
                className="text-xs h-8"
              >
                <FolderOpen className="w-3.5 h-3.5 mr-1" /> Library Folder
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {downloads.map((item) => (
              <Card key={item.id} className="overflow-hidden p-0 border-border/60">
                <div className="flex h-24">
                  {/* Thumbnail */}
                  <div className="relative w-36 shrink-0 bg-muted overflow-hidden">
                    {item.thumbnail ? (
                      <img
                        src={item.thumbnail}
                        alt={item.title}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs">
                        No Thumb
                      </div>
                    )}
                  </div>

                  {/* Info & Progress */}
                  <div className="flex-1 flex flex-col justify-between p-3 min-w-0">
                    <div className="flex justify-between items-start gap-2">
                      <div className="truncate">
                        <span className="bg-primary/10 text-primary text-[10px] font-medium px-2 py-0.5 rounded-full mr-2">
                          {['wav', 'flac', 'alac', 'aiff'].includes(item.format)
                            ? `${item.format.toUpperCase()} Lossless`
                            : ['video', 'mp4', 'mkv', 'webm', 'mov'].includes(item.format)
                            ? `${item.quality === 'best' ? 'Best' : item.quality} ${item.format === 'video' ? 'MP4' : item.format.toUpperCase()}`
                            : item.format === 'mp3_meta'
                            ? `${item.quality === 'best' ? '320K' : item.quality} MP3 + Meta`
                            : `${item.quality === 'best' ? 'Best' : item.quality} ${item.format.toUpperCase()}`}
                        </span>
                        <span className="font-medium text-sm truncate">{item.title}</span>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Progress value={item.progress} className="h-1.5" />
                      <div className="flex justify-between text-[11px] text-muted-foreground">
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          {item.status === 'downloading' && (
                            <>
                              <span className="font-mono text-primary/90">{item.speed}</span>
                              <span className="font-mono">{item.downloaded} / {item.total}</span>
                              <span className="font-mono">{item.progress.toFixed(1)}%</span>
                              <span className="font-mono">ETA {item.eta}</span>
                            </>
                          )}
                          {item.status === 'queued' && (
                            <span className="text-amber-400 font-medium flex items-center gap-1">
                              Waiting in queue...
                            </span>
                          )}
                          {item.status === 'completed' && (
                            <span className="text-emerald-400 font-medium flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Completed
                            </span>
                          )}
                          {item.status === 'initializing' && (
                            <span className="text-muted-foreground animate-pulse">Initializing...</span>
                          )}
                          {item.status === 'analyzing' && (
                            <span className="text-blue-400 font-medium animate-pulse">
                              Analyzing BPM & Key...
                            </span>
                          )}
                          {item.status === 'cancelled' && (
                            <span className="text-muted-foreground font-medium">Cancelled</span>
                          )}
                          {item.status === 'error' && (
                            <span className="text-destructive font-medium flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5" /> Failed
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="w-16 border-l border-border/50 flex flex-col items-center justify-center gap-1 px-1">
                    {(item.status === 'downloading' || item.status === 'initializing' || item.status === 'queued') && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => cancelDownloadItem(item.id)}
                        title="Cancel"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                    {(item.status === 'cancelled' || item.status === 'error') && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-primary"
                          onClick={() => retryDownloadItem(item.id)}
                          title="Retry"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeDownload(item.id)}
                          title="Remove"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {item.status === 'completed' && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-primary"
                          onClick={() => {
                            if (item.filepath) {
                              player.loadTracks([{ name: item.title, path: item.filepath, coverUrl: item.thumbnail }]);
                            }
                          }}
                          title="Play Track"
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeDownload(item.id)}
                          title="Remove from history"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
