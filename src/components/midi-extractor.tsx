import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Piano,
  FolderOpen,
  Loader2,
  CheckCircle2,
  Copy,
  Check,
  Play,
  X,
  Trash2,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { usePlayer } from "@/contexts/PlayerContext";
import { MidiVisualizer, MidiVisualizerDialog } from "@/components/midi-visualizer";

interface MidiExtractorProps {
  initialFile?: string;
  onNavigateToMixer?: () => void;
  onNavigateToLibrary?: () => void;
}

interface ConversionResult {
  status: string;
  midi_path: string;
  note_count: number;
  duration?: number;
  engine?: string;
  file_size?: number;
  detected_key?: string;
  bpm?: number;
}

interface ExistingMidiFile {
  name: string;
  path: string;
  size_bytes: number;
  modified_time: number;
  parent_group?: string;
}

export function MidiExtractor({
  initialFile = "",
}: MidiExtractorProps) {
  const player = usePlayer();
  const [selectedFilePath, setSelectedFilePath] = useState(initialFile);
  const [isConverting, setIsConverting] = useState(false);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [existingMidis, setExistingMidis] = useState<ExistingMidiFile[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState("basic-pitch");
  const [selectedPreset, setSelectedPreset] = useState("general");
  const [selectedSensitivity, setSelectedSensitivity] = useState("balanced");
  const [bpmMode, setBpmMode] = useState<"auto" | "manual">("auto");
  const [manualBpm, setManualBpm] = useState<string>("");
  const tapTimesRef = useRef<number[]>([]);
  const [quantizeGrid, setQuantizeGrid] = useState<string>("adaptive");
  const [quantizeStrength, setQuantizeStrength] = useState<number>(0.85);
  const [copied, setCopied] = useState(false);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [viewingMidi, setViewingMidi] = useState<{ path: string; name: string } | null>(null);
  const [showResultVisualizer, setShowResultVisualizer] = useState(true);

  const handleTapTempo = () => {
    const now = Date.now();
    const valid = tapTimesRef.current.filter((t) => now - t < 2500);
    const updated = [...valid, now].slice(-6);
    tapTimesRef.current = updated;

    if (updated.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < updated.length; i++) {
        intervals.push(updated[i] - updated[i - 1]);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const calculatedBpm = Math.round(60000 / avgInterval);
      if (calculatedBpm >= 40 && calculatedBpm <= 260) {
        setManualBpm(calculatedBpm.toString());
        setBpmMode("manual");
        toast.info(`Tap Tempo: ${calculatedBpm} BPM`, { duration: 1500 });
      }
    }
  };

  useEffect(() => {
    if (initialFile) {
      setSelectedFilePath(initialFile);
    }
  }, [initialFile]);

  useEffect(() => {
    if (selectedFilePath) {
      const lower = selectedFilePath.toLowerCase();
      if (lower.includes("vocal") || lower.includes("lead")) setSelectedPreset("vocal");
      else if (lower.includes("bass") || lower.includes("808")) setSelectedPreset("bass");
      else if (lower.includes("piano") || lower.includes("keys")) setSelectedPreset("piano");
      else setSelectedPreset("general");
    }
  }, [selectedFilePath]);

  // Load storage files to populate existing MIDI files
  const loadStorageFiles = async () => {
    try {
      const files = await invoke<any[]>("list_storage_files");
      const midis = files
        .filter((f) => f.category === "midi" || f.extension === "mid" || f.extension === "midi")
        .map((f) => ({
          name: f.name,
          path: f.path,
          size_bytes: f.size_bytes,
          modified_time: f.modified_time,
          parent_group: f.parent_group,
        }));
      setExistingMidis(midis);
    } catch (e) {
      console.debug("Failed to load files:", e);
    }
  };

  useEffect(() => {
    loadStorageFiles();
  }, []);

  // Listen to Tauri Drag and Drop Events
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    try {
      getCurrentWebviewWindow()
        .onDragDropEvent((event) => {
          if (event.payload.type === "enter" || event.payload.type === "over") {
            setIsDraggingFile(true);
          } else if (event.payload.type === "leave") {
            setIsDraggingFile(false);
          } else if (event.payload.type === "drop") {
            setIsDraggingFile(false);
            const paths = event.payload.paths;
            if (paths && paths.length > 0) {
              const p = paths[0];
              const ext = p.split(".").pop()?.toLowerCase();
              if (["mp3", "wav", "flac", "ogg", "m4a"].includes(ext || "")) {
                setSelectedFilePath(p);
                setResult(null);
              }
            }
          }
        })
        .then((unlistenFn) => {
          unlisten = unlistenFn;
        })
        .catch((e) => {
          console.debug("Drag & Drop listener init error:", e);
        });
    } catch (e) {
      console.debug("onDragDropEvent exception:", e);
    }

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleBrowseFile = async () => {
    try {
      const dirs = await invoke<{ stems_dir: string }>("get_storage_dirs");
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        defaultPath: dirs?.stems_dir || undefined,
        filters: [{ name: "Audio Files", extensions: ["mp3", "wav", "flac", "ogg", "m4a"] }],
      });

      if (selected && typeof selected === "string") {
        setSelectedFilePath(selected);
        setResult(null);
      }
    } catch (e) {
      console.error("Failed to select file:", e);
    }
  };

  const handleConvert = async () => {
    if (!selectedFilePath) {
      toast.warning("Please select an audio file first");
      return;
    }

    setIsConverting(true);
    const filename = selectedFilePath.split(/[/\\]/).pop() || selectedFilePath;

    toast.info(`Converting "${filename}" to MIDI...`, {
      description: "Transcribing musical notes using Spotify Basic Pitch AI engine.",
    });

    try {
      const bpmNum = bpmMode === "manual" && manualBpm ? parseFloat(manualBpm) : undefined;
      const res = await invoke<{
        success?: boolean;
        status?: string;
        midi_path?: string;
        midiPath?: string;
        note_count?: number;
        noteCount?: number;
        duration_sec?: number;
        duration?: number;
        bpm?: number;
        first_beat?: number;
        quantize_grid?: string;
        detected_key?: string;
        engine?: string;
        error?: string;
        message?: string;
      }>("convert_audio_to_midi", {
        filePath: selectedFilePath,
        engine: selectedEngine,
        preset: selectedPreset,
        sensitivity: selectedSensitivity,
        bpm: bpmNum && !isNaN(bpmNum) ? bpmNum : undefined,
        quantizeGrid: quantizeGrid,
        quantizeStrength: quantizeStrength,
      });

      const midiPath = res.midi_path || res.midiPath;
      const isSuccess = res.success === true || res.status === "success";

      if (isSuccess && midiPath) {
        const noteCount = res.note_count ?? res.noteCount ?? 0;
        const conversionRes: ConversionResult = {
          status: "success",
          midi_path: midiPath,
          note_count: noteCount,
          duration: res.duration_sec ?? res.duration,
          bpm: res.bpm,
          detected_key: res.detected_key,
          engine: res.engine || "Spotify Basic Pitch",
        };
        setResult(conversionRes);

        toast.success(`MIDI Transcription Complete!`, {
          description: `Extracted ${noteCount} notes. Saved in the same folder alongside audio stems.`,
        });

        loadStorageFiles();
      } else {
        const errMsg = res.error || res.message || "Conversion failed";
        toast.error("MIDI Extraction Failed", { description: errMsg });
      }
    } catch (err: any) {
      console.error("Conversion call failed:", err);
      toast.error("Failed to Convert", {
        description: typeof err === "string" ? err : err?.message || "Unknown error occurred.",
      });
    } finally {
      setIsConverting(false);
    }
  };

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopied(true);
    toast.success("Path copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDeleteMidi = async (filePath: string, fileName: string) => {
    if (!confirm(`Are you sure you want to delete "${fileName}"? This cannot be undone.`)) return;
    try {
      setDeletingPath(filePath);
      await invoke("delete_storage_file", { path: filePath });
      setExistingMidis((prev) => prev.filter((f) => f.path !== filePath));
      if (result?.midi_path === filePath) {
        setResult(null);
      }
      toast.success(`Deleted ${fileName}`);
    } catch (e: any) {
      console.error("Failed to delete MIDI file:", e);
      toast.error("Failed to delete MIDI file", {
        description: typeof e === "string" ? e : e?.message || "Unknown error occurred.",
      });
    } finally {
      setDeletingPath(null);
    }
  };

  const handleClearAllMidis = async () => {
    if (!confirm(`Are you sure you want to delete all ${existingMidis.length} converted MIDI files? This cannot be undone.`)) return;
    try {
      setIsDeletingAll(true);
      await Promise.all(
        existingMidis.map((item) => invoke("delete_storage_file", { path: item.path }))
      );
      setExistingMidis([]);
      setResult(null);
      toast.success("All MIDI history files deleted");
    } catch (e: any) {
      console.error("Failed to clear MIDI history:", e);
      toast.error("Failed to clear MIDI history", {
        description: typeof e === "string" ? e : e?.message || "Unknown error occurred.",
      });
      loadStorageFiles();
    } finally {
      setIsDeletingAll(false);
    }
  };

  return (
    <div className="space-y-6 relative">
      <Card
        className={`w-full transition-colors duration-200 ${isDraggingFile ? "border-primary border-2 border-dashed bg-primary/5" : ""
          }`}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Piano className="w-5 h-5" /> Audio to MIDI Extractor
          </CardTitle>
          <CardDescription>
            Convert audio tracks and isolated stems into MIDI notes using Spotify Basic Pitch AI.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Audio File Selection */}
          <div className="space-y-2">
            <Label>Audio File</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={selectedFilePath}
                placeholder="Select an audio or video file..."
                className="font-mono text-sm text-muted-foreground"
              />
              <Button variant="outline" onClick={handleBrowseFile} disabled={isConverting}>
                <FolderOpen className="mr-2 h-4 w-4" />
                Browse
              </Button>
              {selectedFilePath && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setSelectedFilePath("");
                    setResult(null);
                  }}
                  title="Clear file"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Options Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>AI Engine</Label>
              <Select
                value={selectedEngine}
                onValueChange={(val) => {
                  if (val) setSelectedEngine(val);
                }}
                disabled={isConverting}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="AI Engine" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="basic-pitch">
                    Spotify Basic Pitch (Multi-Pitch)
                  </SelectItem>
                  <SelectItem value="onset">
                    Onset-to-MIDI (Monophonic Lead)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Frequency Preset</Label>
              <Select
                value={selectedPreset}
                onValueChange={(val) => {
                  if (val) setSelectedPreset(val);
                }}
                disabled={isConverting}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Preset" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">Full Spectrum (C1 – B7 / 88 Keys)</SelectItem>
                  <SelectItem value="vocal">Vocal / Lead (Full C1 – B7 Dynamics)</SelectItem>
                  <SelectItem value="piano">🎹 Piano Solo (A0 – C8 Full Acoustic)</SelectItem>
                  <SelectItem value="bass">Bass & 808s (Sub-bass to Harmonics)</SelectItem>
                  <SelectItem value="fast">Fast Arpeggios / Staccato</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Detection Sensitivity</Label>
              <Select
                value={selectedSensitivity}
                onValueChange={(val) => {
                  if (val) setSelectedSensitivity(val);
                }}
                disabled={isConverting}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Sensitivity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">
                    High (เก็บละเอียด / ท่อนเบาไม่หลุด)
                  </SelectItem>
                  <SelectItem value="balanced">
                    Balanced (สมดุล แนะนำ)
                  </SelectItem>
                  <SelectItem value="clean">
                    Clean / Strict (เน้นโน้ตหลัก คัด Noise)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Rhythm & Tempo Precision Controls */}
          <div className="p-3.5 rounded-lg border bg-muted/20 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground flex items-center gap-1.5">
                <span>⏱️</span>
                <span>Rhythm Precision & Beat Grid (ความแม่นยำจังหวะ & Quantize)</span>
              </span>
              <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20">
                HPSS Transient Sync
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* BPM Mode & Tap Tempo */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">BPM / Tempo</Label>
                  <button
                    type="button"
                    onClick={() => {
                      if (bpmMode === "auto") setBpmMode("manual");
                      else {
                        setBpmMode("auto");
                        setManualBpm("");
                      }
                    }}
                    className="text-[11px] text-primary hover:underline cursor-pointer"
                  >
                    {bpmMode === "auto" ? "✏️ ระบุเอง / Tap" : "🔄 Auto Detect"}
                  </button>
                </div>
                {bpmMode === "auto" ? (
                  <div className="h-9 px-3 rounded-md border border-dashed flex items-center justify-between text-xs text-muted-foreground bg-background/50">
                    <span>Auto (Transient Sync)</span>
                    <span className="text-[10px] text-primary font-mono font-medium">Auto</span>
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <Input
                      type="number"
                      placeholder="e.g. 128"
                      value={manualBpm}
                      onChange={(e) => setManualBpm(e.target.value)}
                      className="h-9 text-xs font-mono"
                      min={40}
                      max={260}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleTapTempo}
                      className="h-9 px-3 text-xs font-semibold shrink-0 cursor-pointer active:scale-95 transition-transform"
                      title="เคาะตามจังหวะเพลง 3-4 ครั้งเพื่อหา BPM อัตโนมัติ"
                    >
                      TAP
                    </Button>
                  </div>
                )}
              </div>

              {/* Musical Beat Grid */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Beat Grid Snapping</Label>
                <Select
                  value={quantizeGrid}
                  onValueChange={(val) => {
                    if (val) setQuantizeGrid(val);
                  }}
                  disabled={isConverting}
                >
                  <SelectTrigger className="w-full h-9 text-xs">
                    <SelectValue placeholder="Grid" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="adaptive" className="text-xs cursor-pointer">
                      Adaptive (1/16 & Triplet Smart Snap)
                    </SelectItem>
                    <SelectItem value="1/16" className="text-xs cursor-pointer">
                      1/16 Beat (Straight Groove / Pop / EDM)
                    </SelectItem>
                    <SelectItem value="1/8" className="text-xs cursor-pointer">
                      1/8 Beat (Ballads / Slow Acoustic)
                    </SelectItem>
                    <SelectItem value="1/12" className="text-xs cursor-pointer">
                      1/12 Beat (Triplets / Swing / Trap)
                    </SelectItem>
                    <SelectItem value="1/32" className="text-xs cursor-pointer">
                      1/32 Beat (Fast Arpeggios)
                    </SelectItem>
                    <SelectItem value="off" className="text-xs cursor-pointer">
                      Off (Raw Human Performance)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Quantize Strength */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Quantize Strength</Label>
                <Select
                  value={quantizeStrength.toString()}
                  onValueChange={(val) => {
                    if (val) setQuantizeStrength(parseFloat(val));
                  }}
                  disabled={isConverting || quantizeGrid === "off"}
                >
                  <SelectTrigger className="w-full h-9 text-xs">
                    <SelectValue placeholder="Strength" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1" className="text-xs cursor-pointer">
                      100% (Hard Snap - Perfect DAW Grid)
                    </SelectItem>
                    <SelectItem value="0.85" className="text-xs cursor-pointer">
                      85% (Natural Snap - แนะนำ)
                    </SelectItem>
                    <SelectItem value="0.5" className="text-xs cursor-pointer">
                      50% (Subtle Tightening)
                    </SelectItem>
                    <SelectItem value="0" className="text-xs cursor-pointer">
                      0% (Raw Timing)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Action Buttons (flex gap-3) */}
          <div className="flex gap-3">
            {isConverting ? (
              <Button disabled className="flex-1 font-semibold">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Converting to MIDI...
              </Button>
            ) : (
              <Button
                onClick={handleConvert}
                disabled={!selectedFilePath}
                className="flex-1 font-semibold cursor-pointer"
              >
                Convert to MIDI
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                if (result?.midi_path) {
                  try {
                    await invoke("open_path", { path: result.midi_path });
                    return;
                  } catch (e) {
                    console.debug(e);
                  }
                }
                if (selectedFilePath) {
                  try {
                    await invoke("open_path", { path: selectedFilePath });
                    return;
                  } catch (e) {
                    console.debug(e);
                  }
                }
                try {
                  await invoke("open_storage_folder", { folderType: "stems" });
                } catch (e) {
                  console.debug(e);
                }
              }}
              className="gap-1.5 cursor-pointer"
              title="Open folder where audio and MIDI files are stored"
            >
              <FolderOpen className="h-4 w-4" /> Open Folder
            </Button>
          </div>

          {/* Conversion Result Box */}
          {result && (
            <div className="p-4 rounded-lg border bg-muted/40 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  <span className="font-semibold text-sm">Conversion Complete</span>
                  <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
                    {result.note_count} Notes Detected
                  </Badge>
                  {result.bpm && (
                    <Badge variant="secondary" className="text-xs bg-sky-500/15 text-sky-400 border-sky-500/30">
                      {result.bpm} BPM
                    </Badge>
                  )}
                  {result.detected_key && (
                    <Badge variant="secondary" className="text-xs bg-amber-500/15 text-amber-400 border-amber-500/30">
                      Key: {result.detected_key}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectedFilePath && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const filename = selectedFilePath.split(/[/\\]/).pop() || selectedFilePath;
                        player.loadTracks([{ name: filename, path: selectedFilePath }]);
                      }}
                      className="text-xs gap-1.5"
                    >
                      <Play className="w-3.5 h-3.5" /> Play Audio
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowResultVisualizer((prev) => !prev)}
                    className="text-xs gap-1.5 text-primary border-primary/30 hover:bg-primary/10"
                    title="Toggle embedded Piano Roll viewer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    {showResultVisualizer ? "Hide Piano Roll" : "View Piano Roll"}
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() =>
                      setViewingMidi({
                        path: result.midi_path,
                        name: result.midi_path.split(/[/\\]/).pop() || "Converted MIDI",
                      })
                    }
                    className="text-xs gap-1.5"
                    title="Open full interactive Piano Roll modal"
                  >
                    <Piano className="w-3.5 h-3.5" /> Pop-out Viewer
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopyPath(result.midi_path)}
                    className="text-xs gap-1.5"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? "Copied" : "Copy Path"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => invoke("open_path", { path: result.midi_path })}
                    className="text-xs gap-1.5"
                  >
                    <FolderOpen className="w-3.5 h-3.5" /> Show in Explorer
                  </Button>
                </div>
              </div>
              <div
                className="p-2.5 bg-background rounded-md border font-mono text-xs text-muted-foreground truncate"
                title={result.midi_path}
              >
                {result.midi_path}
              </div>

              {/* Embedded Interactive Piano Roll Visualizer */}
              {showResultVisualizer && (
                <div className="pt-2 animate-in fade-in duration-200">
                  <MidiVisualizer
                    filePath={result.midi_path}
                    fileName={result.midi_path.split(/[/\\]/).pop()}
                    embedded={true}
                    className="border-primary/20"
                  />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Overlay for drag and drop */}
      {isDraggingFile && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm rounded-xl border-2 border-dashed border-primary pointer-events-none">
          <div className="p-4 bg-primary/10 rounded-full mb-4">
            <Piano className="w-12 h-12 text-primary" />
          </div>
          <h3 className="text-xl font-bold">Drop Audio File Here</h3>
          <p className="text-muted-foreground mt-2">Supports MP3, WAV, FLAC, OGG, M4A</p>
        </div>
      )}

      {/* Converted MIDI Files History List (Matching yt-dlp.tsx and library style) */}
      {existingMidis.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Piano className="w-4 h-4" /> Converted MIDI Files ({existingMidis.length})
            </h3>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (existingMidis.length > 0 && existingMidis[0].path) {
                    invoke("open_path", { path: existingMidis[0].path });
                  } else {
                    invoke("open_storage_folder", { folderType: "stems" });
                  }
                }}
                className="text-xs gap-1.5"
              >
                <FolderOpen className="w-3.5 h-3.5" /> Open Folder
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearAllMidis}
                disabled={isDeletingAll || deletingPath !== null}
                className="text-xs gap-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/30"
                title="Delete all converted MIDI files from history"
              >
                {isDeletingAll ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                Clear All
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {existingMidis.map((item) => (
              <Card key={item.path} className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 bg-primary/10 rounded-lg text-primary shrink-0">
                      <Piano className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate" title={item.name}>
                          {item.name}
                        </span>
                        {item.parent_group && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            {item.parent_group}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <span>{(item.size_bytes / 1024).toFixed(1)} KB</span>
                        <span>•</span>
                        <span>
                          {item.modified_time
                            ? new Date(item.modified_time * 1000).toLocaleDateString()
                            : "Recently converted"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => setViewingMidi({ path: item.path, name: item.name })}
                      className="text-xs gap-1.5 bg-primary/90 hover:bg-primary text-primary-foreground font-medium"
                      title="Open interactive Piano Roll and play MIDI"
                    >
                      <Piano className="w-3.5 h-3.5" /> View Notes
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopyPath(item.path)}
                      className="text-xs gap-1"
                      title="Copy file path"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => invoke("open_path", { path: item.path })}
                      className="text-xs gap-1"
                    >
                      <FolderOpen className="w-3.5 h-3.5" /> Show
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteMidi(item.path, item.name)}
                      disabled={deletingPath === item.path || isDeletingAll}
                      className="text-xs gap-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="Delete MIDI file"
                    >
                      {deletingPath === item.path ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Pop-up Dialog for Viewing MIDI Piano Roll */}
      {viewingMidi && (
        <MidiVisualizerDialog
          open={Boolean(viewingMidi)}
          onOpenChange={(open) => !open && setViewingMidi(null)}
          filePath={viewingMidi.path}
          fileName={viewingMidi.name}
        />
      )}
    </div>
  );
}
