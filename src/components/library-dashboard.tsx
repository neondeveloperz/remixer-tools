import { useState, useEffect, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  FolderOpen,
  Play,
  Pause,
  Trash2,
  Music,
  Video,
  Layers,
  Sparkles,
  RefreshCw,
  HardDrive,
  Download,
  Sliders,
  Calendar,
  FileAudio,
  ChevronLeft,
  ChevronRight,
  Piano,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { usePlayer, type TrackInfo } from "@/contexts/PlayerContext";
import { extractStemName } from "@/lib/utils";

export interface StorageFileItem {
  name: string;
  path: string;
  size_bytes: number;
  modified_time: number; // Unix timestamp in seconds
  category: "download" | "stem" | "midi";
  extension: string;
  stem_type?: string | null;
  parent_group?: string | null;
}

interface StorageDirs {
  base_dir: string;
  library_dir: string;
  extractor_dir: string;
  stems_dir?: string;
}

interface SavedDownloadMetadata {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  filepath?: string;
}

interface LibraryDashboardProps {
  onSendToExtractor?: (filePath: string) => void;
  onNavigateToDownloader?: () => void;
  onNavigateToMixer?: () => void;
  onNavigateToExtractor?: () => void;
  isActive?: boolean;
}

export function LibraryDashboard({
  onSendToExtractor,
  onNavigateToDownloader,
  onNavigateToMixer,
  onNavigateToExtractor,
  isActive = true,
}: LibraryDashboardProps) {
  const navigateToMixer = onNavigateToMixer || onNavigateToExtractor;
  const player = usePlayer();
  const [files, setFiles] = useState<StorageFileItem[]>([]);
  const [_dirs, setDirs] = useState<StorageDirs | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "downloads" | "stems" | "midi">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "audio" | "video">("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "name_asc" | "size_desc">("newest");
  const [groupBySong, setGroupBySong] = useState(true);
  const [downloadMeta, setDownloadMeta] = useState<Record<string, SavedDownloadMetadata>>({});
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [midiLoading, setMidiLoading] = useState<Record<string, boolean>>({});

  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, typeFilter, searchQuery, sortBy, groupBySong]);

  // Load saved metadata from localStorage
  const loadSavedMeta = useCallback(() => {
    try {
      const saved = localStorage.getItem("remixer_downloads");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const map: Record<string, SavedDownloadMetadata> = {};
          parsed.forEach((item: SavedDownloadMetadata) => {
            if (item.filepath) {
              map[item.filepath] = item;
              const filename = item.filepath.split(/[/\\]/).pop() || "";
              map[filename] = item;
              const fileBase = filename.replace(/\.[^/.]+$/, "");
              map[fileBase] = item;
            }
            if (item.title) {
              map[item.title] = item;
            }
          });
          setDownloadMeta(map);
        }
      }
    } catch (e) {
      console.error("Failed to parse saved download metadata:", e);
    }
  }, []);

  // Fetch files and dirs from backend
  const loadFiles = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const [storageDirs, storageFiles] = await Promise.all([
        invoke<StorageDirs>("get_storage_dirs"),
        invoke<StorageFileItem[]>("list_storage_files"),
      ]);
      setDirs(storageDirs);
      setFiles(storageFiles);
    } catch (e) {
      console.error("Failed to load storage files:", e);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  // Load on mount and whenever isActive becomes true
  useEffect(() => {
    if (isActive) {
      loadFiles();
      loadSavedMeta();
    }
  }, [isActive, loadFiles, loadSavedMeta]);

  // Listen to background download and extraction events for real-time updates
  useEffect(() => {
    const unlistenYt = listen("ytdlp-done", () => {
      loadFiles(true);
      loadSavedMeta();
      setTimeout(() => {
        loadFiles(true);
        loadSavedMeta();
      }, 1200);
    });
    const unlistenPath = listen("ytdlp-filepath", () => {
      loadFiles(true);
      loadSavedMeta();
    });
    const unlistenStemDone = listen("stem-extract-done", () => {
      loadFiles(true);
      setTimeout(() => loadFiles(true), 1200);
    });
    const unlistenStemRes = listen("stem-extract-result", () => {
      loadFiles(true);
      setTimeout(() => loadFiles(true), 1200);
    });

    const handleFocus = () => {
      loadFiles(true);
      loadSavedMeta();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      unlistenYt.then((fn) => fn());
      unlistenPath.then((fn) => fn());
      unlistenStemDone.then((fn) => fn());
      unlistenStemRes.then((fn) => fn());
      window.removeEventListener("focus", handleFocus);
    };
  }, [loadFiles, loadSavedMeta]);

  // Periodic polling when isActive is true (every 4 seconds) to detect any new files smoothly
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      loadFiles(true);
    }, 4000);
    return () => clearInterval(timer);
  }, [isActive, loadFiles]);

  // Format bytes helper
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  // Format date helper
  const formatDate = (timestamp: number) => {
    if (!timestamp) return "Unknown date";
    const d = new Date(timestamp * 1000);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Handle Delete Single File
  const handleDelete = async (filePath: string) => {
    if (!confirm("Are you sure you want to delete this file? This cannot be undone.")) return;
    setDeletingPath(filePath);
    try {
      await invoke("delete_storage_file", { path: filePath });
      setFiles((prev) => prev.filter((f) => f.path !== filePath));
      if (player.tracks.some((t) => t.path === filePath)) {
        player.clearTracks();
      }
    } catch (e) {
      console.error("Failed to delete file:", e);
      alert(`Could not delete file: ${e}`);
    } finally {
      setDeletingPath(null);
    }
  };

  // Handle Delete Entire Stem Group
  const handleDeleteGroup = async (groupTitle: string, stemFiles: StorageFileItem[]) => {
    if (!confirm(`Are you sure you want to delete all ${stemFiles.length} stems for "${groupTitle}"? This cannot be undone.`)) return;
    try {
      await Promise.all(stemFiles.map((sf) => invoke("delete_storage_file", { path: sf.path })));
      const pathsToDelete = new Set(stemFiles.map((sf) => sf.path));
      setFiles((prev) => prev.filter((f) => !pathsToDelete.has(f.path)));
      if (player.tracks.some((t) => pathsToDelete.has(t.path))) {
        player.clearTracks();
      }
    } catch (e) {
      console.error("Failed to delete stem group:", e);
      alert(`Could not delete stem group: ${e}`);
    }
  };

  // Convert audio file / stem to MIDI
  const handleConvertToMidi = async (filePath: string, fileName: string) => {
    setMidiLoading((prev) => ({ ...prev, [filePath]: true }));
    toast.info(`Extracting MIDI for ${fileName}...`, {
      description: "Transcribing musical notes using Spotify Basic Pitch AI engine.",
    });

    try {
      const res = await invoke<{
        success?: boolean;
        status?: string;
        midi_path?: string;
        midiPath?: string;
        note_count?: number;
        noteCount?: number;
        duration_sec?: number;
        engine?: string;
        error?: string;
        message?: string;
      }>("convert_audio_to_midi", { filePath });

      const midiPath = res.midi_path || res.midiPath;
      const isSuccess = res.success === true || res.status === "success";

      if (isSuccess && midiPath) {
        const noteCount = res.note_count ?? res.noteCount ?? 0;
        toast.success(`MIDI converted for ${fileName}!`, {
          description: `${noteCount} notes transcribed. Ready for VST instruments in your DAW.`,
          action: {
            label: "Open Folder",
            onClick: () => {
              const dir = midiPath.replace(/[/\\][^/\\]+$/, "");
              if (dir) invoke("open_path", { path: dir });
            },
          },
        });
      } else {
        throw new Error(res.error || res.message || "Failed to convert MIDI");
      }
    } catch (err: any) {
      const errMsg = typeof err === "string" ? err : err?.message || "Unknown error";
      toast.error(`MIDI conversion failed for ${fileName}`, {
        description: errMsg,
      });
    } finally {
      setMidiLoading((prev) => ({ ...prev, [filePath]: false }));
    }
  };

  // Handle Play Single
  const handlePlaySingle = (file: StorageFileItem) => {
    const isCurrent = player.tracks.length === 1 && player.tracks[0]?.path === file.path;
    if (isCurrent) {
      player.togglePlayPause();
      return;
    }
    const baseName = file.name.replace(/\.[^/.]+$/, "");
    const meta =
      downloadMeta[file.path] ||
      downloadMeta[file.name] ||
      downloadMeta[baseName] ||
      Object.values(downloadMeta).find(
        (m) =>
          m.title &&
          (file.name.toLowerCase().includes(m.title.toLowerCase()) ||
            m.title.toLowerCase().includes(baseName.toLowerCase()))
      );
    const trackName = meta?.title || file.stem_type || extractStemName(file.name);
    player.loadTracks([{ name: trackName, path: file.path, coverUrl: meta?.thumbnail }]);
  };

  // Handle Play Stem Group
  const handlePlayStemGroup = (groupName: string, stemFiles: StorageFileItem[]) => {
    const isCurrentGroup =
      player.tracks.length === stemFiles.length &&
      stemFiles.every((sf) => player.tracks.some((t) => t.path === sf.path));
    if (isCurrentGroup) {
      navigateToMixer?.();
      return;
    }
    const groupMeta =
      downloadMeta[groupName] ||
      Object.values(downloadMeta).find(
        (m) =>
          m.title &&
          (groupName.toLowerCase().includes(m.title.toLowerCase()) ||
            m.title.toLowerCase().includes(groupName.toLowerCase()))
      );
    const tracks: TrackInfo[] = stemFiles.map((sf) => ({
      name: sf.stem_type || extractStemName(sf.name),
      path: sf.path,
      coverUrl: groupMeta?.thumbnail,
    }));
    player.loadTracks(tracks);
    navigateToMixer?.();
  };

  // Filter and sort items
  const filteredFiles = useMemo(() => {
    return files
      .filter((file) => {
        // Tab filter
        if (activeTab === "downloads" && file.category !== "download") return false;
        if (activeTab === "stems" && file.category !== "stem") return false;
        if (activeTab === "midi" && file.category !== "midi" && file.extension !== "mid" && file.extension !== "midi") return false;

        // Type filter
        const isVideo = ["mp4", "mkv", "webm", "mov"].includes(file.extension);
        if (typeFilter === "audio" && isVideo) return false;
        if (typeFilter === "video" && !isVideo) return false;

        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchName = file.name.toLowerCase().includes(q);
          const matchGroup = file.parent_group?.toLowerCase().includes(q);
          const matchStem = file.stem_type?.toLowerCase().includes(q);
          if (!matchName && !matchGroup && !matchStem) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === "newest") return b.modified_time - a.modified_time;
        if (sortBy === "oldest") return a.modified_time - b.modified_time;
        if (sortBy === "name_asc") return a.name.localeCompare(b.name);
        if (sortBy === "size_desc") return b.size_bytes - a.size_bytes;
        return 0;
      });
  }, [files, activeTab, typeFilter, searchQuery, sortBy]);

  // Group stems by parent_group
  const stemGroups = useMemo(() => {
    const groups: Record<string, StorageFileItem[]> = {};
    filteredFiles.forEach((file) => {
      if (file.category === "stem") {
        const key = file.parent_group || file.name;
        if (!groups[key]) groups[key] = [];
        groups[key].push(file);
      }
    });
    return groups;
  }, [filteredFiles]);

  // Stats calculation
  const totalSizeBytes = useMemo(() => files.reduce((acc, f) => acc + f.size_bytes, 0), [files]);
  const downloadFilesCount = useMemo(() => files.filter((f) => f.category === "download").length, [files]);
  const stemFilesCount = useMemo(() => files.filter((f) => f.category === "stem").length, [files]);
  const midiFilesCount = useMemo(() => files.filter((f) => f.category === "midi" || f.extension === "mid" || f.extension === "midi").length, [files]);

  // Helper for stem badge color
  const getStemBadgeStyle = (stemType?: string | null) => {
    const lower = (stemType || "").toLowerCase();
    if (lower.includes("vocal")) return "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30";
    if (lower.includes("drum")) return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
    if (lower.includes("bass")) return "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30";
    if (lower.includes("guitar")) return "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30";
    if (lower.includes("piano")) return "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30";
    if (lower.includes("instrumental") || lower.includes("inst"))
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
    return "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30";
  };

  const isGroupView = activeTab === "stems" && groupBySong;
  const stemGroupEntries = Object.entries(stemGroups);
  
  const totalItems = isGroupView ? stemGroupEntries.length : filteredFiles.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  
  const paginatedGroups = isGroupView 
    ? stemGroupEntries.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)
    : [];
    
  const paginatedFiles = !isGroupView
    ? filteredFiles.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)
    : [];

  return (
    <div className="space-y-6 mx-auto pb-12">
      {/* Top Header & Storage Summary */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Layers className="h-6 w-6 text-primary" />
            History & Library Dashboard
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Browse and manage all downloaded audio/video files and separated stems.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => invoke("open_storage_folder", { folderType: "base" })}
            className="gap-1.5"
          >
            <FolderOpen className="h-4 w-4" />
            Base Folder
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => invoke("open_storage_folder", { folderType: "library" })}
            className="gap-1.5"
          >
            <Download className="h-4 w-4" />
            Library
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => invoke("open_storage_folder", { folderType: "stems" })}
            className="gap-1.5"
            title="Open stems directory"
          >
            <Music className="h-4 w-4" />
            STEMs
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => invoke("open_storage_folder", { folderType: "midi" })}
            className="gap-1.5 text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
            title="Open dedicated MIDI directory"
          >
            <Piano className="h-4 w-4" />
            MIDI
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => loadFiles(false)}
            disabled={isLoading}
            className="gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-card/50 backdrop-blur-sm border-border/80">
          <CardContent className="p-4 flex items-center gap-3.5">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Storage Used</p>
              <h3 className="text-xl font-bold mt-0.5">{formatBytes(totalSizeBytes)}</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">{files.length} Total files</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/80">
          <CardContent className="p-4 flex items-center gap-3.5">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-500 shrink-0">
              <Download className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Downloads (Library)</p>
              <h3 className="text-xl font-bold mt-0.5">{downloadFilesCount} files</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/80">
          <CardContent className="p-4 flex items-center gap-3.5">
            <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-500 shrink-0">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Separated Stems</p>
              <h3 className="text-xl font-bold mt-0.5">{stemFilesCount} stems</h3>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Control Bar: Tabs, Search, Filters, Sort */}
      <div className="flex flex-col gap-3 bg-muted/30 p-3.5 rounded-xl border border-border/70">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Main Category Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-muted/60 rounded-lg shrink-0">
            <button
              onClick={() => setActiveTab("all")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${activeTab === "all"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
                }`}
            >
              All Items ({files.length})
            </button>
            <button
              onClick={() => setActiveTab("downloads")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${activeTab === "downloads"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
                }`}
            >
              Downloads ({downloadFilesCount})
            </button>
            <button
              onClick={() => setActiveTab("stems")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${activeTab === "stems"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
                }`}
            >
              Stems ({stemFilesCount})
            </button>
            <button
              onClick={() => setActiveTab("midi")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${activeTab === "midi"
                ? "bg-background text-foreground shadow-sm text-amber-400"
                : "text-muted-foreground hover:text-foreground"
                }`}
            >
              MIDI ({midiFilesCount})
            </button>
          </div>

          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, artist, stem name..."
              className="pl-9 h-9 text-sm"
            />
          </div>

          {/* Dropdown Filters */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
              <SelectTrigger className="w-[120px] h-9 text-xs">
                <SelectValue placeholder="Media Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Media</SelectItem>
                <SelectItem value="audio">Audio Only</SelectItem>
                <SelectItem value="video">Video Only</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
              <SelectTrigger className="w-[145px] h-9 text-xs">
                <SelectValue placeholder="Sort By" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest First</SelectItem>
                <SelectItem value="oldest">Oldest First</SelectItem>
                <SelectItem value="name_asc">Name (A-Z)</SelectItem>
                <SelectItem value="size_desc">Size (Largest)</SelectItem>
              </SelectContent>
            </Select>

            {activeTab === "stems" && (
              <Button
                variant={groupBySong ? "secondary" : "outline"}
                size="sm"
                onClick={() => setGroupBySong(!groupBySong)}
                className="h-9 text-xs gap-1.5"
              >
                <Layers className="h-3.5 w-3.5" />
                {groupBySong ? "Grouped by Song" : "Individual Files"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* File List / Groups */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <RefreshCw className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium">Scanning storage directories...</p>
        </div>
      ) : filteredFiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center rounded-xl border border-dashed border-border bg-card/40">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-3">
            <Layers className="h-6 w-6" />
          </div>
          <h4 className="text-base font-semibold">No files found</h4>
          <p className="text-sm text-muted-foreground max-w-sm mt-1 mb-5">
            {searchQuery
              ? `No items matching "${searchQuery}" in ${activeTab}.`
              : "Your library is currently empty. Download a track or extract stems to populate your collection!"}
          </p>
          <div className="flex gap-3">
            {onNavigateToDownloader && (
              <Button onClick={onNavigateToDownloader} size="sm" className="gap-1.5">
                <Download className="h-4 w-4" /> Go to Downloader
              </Button>
            )}
          </div>
        </div>
      ) : activeTab === "stems" && groupBySong ? (
        /* Grouped Stems View */
        <div className="space-y-4">
          {paginatedGroups.map(([groupTitle, stemItems]) => {
            const totalGroupSize = stemItems.reduce((acc, f) => acc + f.size_bytes, 0);
            const latestMod = Math.max(...stemItems.map((f) => f.modified_time));

            const isCurrentGroup =
              player.tracks.length === stemItems.length &&
              stemItems.every((si) => player.tracks.some((t) => t.path === si.path));

            return (
              <Card
                key={groupTitle}
                className={`overflow-hidden border transition-all ${isCurrentGroup
                    ? "border-primary/60 bg-card shadow-sm ring-1 ring-primary/30"
                    : "border-border/80 bg-card hover:border-border"
                  }`}
              >
                <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-muted/20 border-b border-border/50">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="h-11 w-11 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center shrink-0 border border-purple-500/20">
                      <Sliders className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-base font-bold truncate">{groupTitle}</h4>
                        <Badge variant="secondary" className="text-[11px] font-semibold">
                          {stemItems.length} Stems
                        </Badge>
                        {isCurrentGroup && (
                          <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px] font-bold">
                            {player.isPlaying ? "Playing in DAW" : "Loaded in DAW"}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span>{formatBytes(totalGroupSize)}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(latestMod)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                    <Button
                      size="sm"
                      onClick={() => handlePlayStemGroup(groupTitle, stemItems)}
                      className="gap-1.5 font-semibold"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      {isCurrentGroup ? "Open in DAW Mixer" : "Play in DAW Mixer"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const dir = stemItems[0]?.path.replace(/[/\\][^/\\]+$/, "");
                        if (dir) invoke("open_path", { path: dir });
                      }}
                      className="gap-1.5"
                    >
                      <FolderOpen className="h-3.5 w-3.5" /> Open Folder
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteGroup(groupTitle, stemItems)}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="Delete all stems in this group"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="p-3.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 bg-background/50">
                  {stemItems.map((stem) => {
                    const badgeStyle = getStemBadgeStyle(stem.stem_type);
                    return (
                      <div
                        key={stem.path}
                        className="flex items-center justify-between gap-2 p-2.5 rounded-lg border bg-card/60 hover:bg-muted/40 transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${badgeStyle}`}>
                              {stem.stem_type || "Stem"}
                            </span>
                            <span className="text-xs font-mono text-muted-foreground uppercase">
                              .{stem.extension}
                            </span>
                          </div>
                          <p className="text-[11px] font-mono text-muted-foreground truncate mt-1" title={stem.name}>
                            {stem.name}
                          </p>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {formatBytes(stem.size_bytes)}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handlePlaySingle(stem)}
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            title="Play track solo"
                          >
                            {player.tracks.length === 1 &&
                              player.tracks[0]?.path === stem.path &&
                              player.isPlaying ? (
                              <Pause className="h-3.5 w-3.5 fill-current text-primary" />
                            ) : (
                              <Play className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleConvertToMidi(stem.path, stem.name)}
                            disabled={midiLoading[stem.path]}
                            className="h-7 w-7 text-amber-400/80 hover:text-amber-300 hover:bg-amber-400/10"
                            title="Convert this stem to MIDI (.mid) using Spotify Basic Pitch"
                          >
                            {midiLoading[stem.path] ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                            ) : (
                              <Piano className="h-3.5 w-3.5 text-amber-400" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(stem.path)}
                            disabled={deletingPath === stem.path}
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            title="Delete stem file"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        /* Flat List View (Downloads or Individual Stems) */
        <div className="grid grid-cols-1 gap-2.5">
          {paginatedFiles.map((file) => {
            const isVideo = ["mp4", "mkv", "webm", "mov"].includes(file.extension);
            const isStem = file.category === "stem";
            const baseName = file.name.replace(/\.[^/.]+$/, "");
            const meta =
              downloadMeta[file.path] ||
              downloadMeta[file.name] ||
              downloadMeta[baseName] ||
              Object.values(downloadMeta).find(
                (m) =>
                  m.title &&
                  (file.name.toLowerCase().includes(m.title.toLowerCase()) ||
                    m.title.toLowerCase().includes(baseName.toLowerCase()))
              );
            const badgeStyle = isStem ? getStemBadgeStyle(file.stem_type) : "";

            const isCurrent = player.tracks.length === 1 && player.tracks[0]?.path === file.path;

            return (
              <div
                key={file.path}
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border transition-all ${isCurrent
                    ? "border-primary/60 bg-card shadow-sm ring-1 ring-primary/30"
                    : "border-border/80 bg-card hover:border-border hover:shadow-xs"
                  }`}
              >
                {/* Left: Icon / Thumbnail & Details */}
                <div className="flex items-center gap-3.5 min-w-0">
                  {meta?.thumbnail ? (
                    <img
                      src={meta.thumbnail}
                      alt={file.name}
                      className="h-12 w-16 rounded-md object-cover border shrink-0 bg-muted"
                    />
                  ) : (
                    <div
                      className={`h-11 w-11 rounded-lg flex items-center justify-center shrink-0 border ${isVideo
                        ? "bg-blue-500/10 text-blue-500 border-blue-500/20"
                        : isStem
                          ? "bg-purple-500/10 text-purple-500 border-purple-500/20"
                          : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                        }`}
                    >
                      {isVideo ? (
                        <Video className="h-5 w-5" />
                      ) : isStem ? (
                        <Sliders className="h-5 w-5" />
                      ) : (
                        <FileAudio className="h-5 w-5" />
                      )}
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-bold truncate" title={file.name}>
                        {meta?.title || file.name}
                      </h4>
                      {isStem && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${badgeStyle}`}>
                          {file.stem_type || "Stem"}
                        </span>
                      )}
                      <span className="text-[10px] bg-muted text-muted-foreground uppercase font-mono px-1.5 py-0.5 rounded font-bold">
                        {file.extension}
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5 text-xs text-muted-foreground font-mono mt-1">
                      <span>{formatBytes(file.size_bytes)}</span>
                      <span>•</span>
                      <span>{formatDate(file.modified_time)}</span>
                    </div>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                  {/* Play Button */}
                  <Button
                    variant={isCurrent ? "secondary" : "default"}
                    size="sm"
                    onClick={() => handlePlaySingle(file)}
                    className="h-8 gap-1.5 font-semibold"
                  >
                    {isCurrent && player.isPlaying ? (
                      <>
                        <Pause className="h-3.5 w-3.5 fill-current text-primary" /> Pause
                      </>
                    ) : isCurrent ? (
                      <>
                        <Play className="h-3.5 w-3.5 fill-current text-primary" /> Resume
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5 fill-current" /> Play
                      </>
                    )}
                  </Button>

                  {/* Send to STEM Extractor (for audio files) */}
                  {!isStem && onSendToExtractor && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onSendToExtractor(file.path)}
                      className="h-8 gap-1.5 text-xs font-semibold"
                      title="Send directly to STEM Extractor"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-primary" /> Separate STEMs
                    </Button>
                  )}

                  {/* Convert to MIDI (for audio files & stems) */}
                  {!isVideo && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleConvertToMidi(file.path, file.name)}
                      disabled={midiLoading[file.path]}
                      className="h-8 gap-1.5 text-xs font-semibold text-amber-400 border-amber-500/30 hover:bg-amber-500/10 hover:text-amber-300"
                      title="Convert audio to MIDI (.mid) using Spotify Basic Pitch AI"
                    >
                      {midiLoading[file.path] ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Piano className="h-3.5 w-3.5" />
                      )}
                      <span>MIDI</span>
                    </Button>
                  )}

                  {/* Open in Folder */}
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      const dir = file.path.replace(/[/\\][^/\\]+$/, "");
                      if (dir) invoke("open_path", { path: dir });
                    }}
                    className="h-8 w-8"
                    title="Open folder in File Explorer"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </Button>

                  {/* Delete Button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(file.path)}
                    disabled={deletingPath === file.path}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    title="Delete file"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> Previous
          </Button>
          <div className="text-sm font-medium text-muted-foreground px-4">
            Page {currentPage} of {totalPages}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
          >
            Next <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
