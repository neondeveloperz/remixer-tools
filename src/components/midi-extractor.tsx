import { useState, useEffect } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import { usePlayer } from "@/contexts/PlayerContext";
import { extractStemName } from "@/lib/utils";

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
}

interface QuickStemItem {
  name: string;
  path: string;
  category: string;
  stem_type?: string;
  parent_group?: string;
  size_bytes: number;
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
  const [recentStems, setRecentStems] = useState<QuickStemItem[]>([]);
  const [existingMidis, setExistingMidis] = useState<ExistingMidiFile[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("general");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (initialFile) {
      setSelectedFilePath(initialFile);
    }
  }, [initialFile]);

  // Load storage files to populate both stems and existing MIDI files
  const loadStorageFiles = async () => {
    try {
      const files = await invoke<any[]>("list_storage_files");
      const stems = files
        .filter((f) => f.category === "stem")
        .slice(0, 10)
        .map((f) => ({
          name: f.name,
          path: f.path,
          category: f.category,
          stem_type: f.stem_type || extractStemName(f.name),
          parent_group: f.parent_group,
          size_bytes: f.size_bytes,
        }));
      setRecentStems(stems);

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
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
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
      const res = await invoke<{
        success?: boolean;
        status?: string;
        midi_path?: string;
        midiPath?: string;
        note_count?: number;
        noteCount?: number;
        duration_sec?: number;
        duration?: number;
        engine?: string;
        error?: string;
        message?: string;
      }>("convert_audio_to_midi", { filePath: selectedFilePath });

      const midiPath = res.midi_path || res.midiPath;
      const isSuccess = res.success === true || res.status === "success";

      if (isSuccess && midiPath) {
        const noteCount = res.note_count ?? res.noteCount ?? 0;
        const conversionRes: ConversionResult = {
          status: "success",
          midi_path: midiPath,
          note_count: noteCount,
          duration: res.duration_sec ?? res.duration,
          engine: res.engine || "Spotify Basic Pitch",
        };
        setResult(conversionRes);

        toast.success(`MIDI Transcription Complete!`, {
          description: `Extracted ${noteCount} notes. Saved to dedicated midi/ folder.`,
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

  return (
    <div className="space-y-6 relative">
      <Card
        className={`w-full transition-colors duration-200 ${
          isDraggingFile ? "border-primary border-2 border-dashed bg-primary/5" : ""
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

          {/* Quick Select from Stems */}
          {recentStems.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Quick Select from Stems</Label>
              <div className="flex flex-wrap gap-2">
                {recentStems.map((stem) => (
                  <button
                    key={stem.path}
                    type="button"
                    onClick={() => {
                      setSelectedFilePath(stem.path);
                      setResult(null);
                    }}
                    className={`text-xs px-2.5 py-1 rounded-md border transition-colors flex items-center gap-1.5 cursor-pointer ${
                      selectedFilePath === stem.path
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Badge variant="outline" className="text-[10px] px-1 py-0">
                      {stem.stem_type || "Stem"}
                    </Badge>
                    <span className="truncate max-w-[180px]">{stem.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Options Grid (Matching stem-extractor.tsx layout) */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-6 space-y-2">
              <Label>AI Engine</Label>
              <Select value="basic-pitch" disabled>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="AI Engine" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="basic-pitch">
                    Spotify Basic Pitch (Multi-Pitch Neural Net)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-3 space-y-2">
              <Label>Transcription Mode</Label>
              <Select
                value={selectedPreset}
                onValueChange={(val) => {
                  if (val) setSelectedPreset(val);
                }}
                disabled={isConverting}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">Polyphonic (Full Mix / Chords)</SelectItem>
                  <SelectItem value="bass">Bass & 808s Focus</SelectItem>
                  <SelectItem value="vocal">Vocal & Lead Melody</SelectItem>
                  <SelectItem value="fast">Fast Arpeggios / Stabs</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-3 space-y-2">
              <Label>Output Format</Label>
              <Select value="mid" disabled>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Format" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mid">.MID (Standard MIDI File)</SelectItem>
                </SelectContent>
              </Select>
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
              onClick={() => invoke("open_storage_folder", { folderType: "midi" })}
              className="gap-1.5 cursor-pointer"
              title="Open folder where converted MIDI files are stored"
            >
              <FolderOpen className="h-4 w-4" /> Open MIDI Folder
            </Button>
          </div>

          {/* Conversion Result Box */}
          {result && (
            <div className="p-4 rounded-lg border bg-muted/40 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  <span className="font-semibold text-sm">Conversion Complete</span>
                  <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
                    {result.note_count} Notes Detected
                  </Badge>
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
                    onClick={() => handleCopyPath(result.midi_path)}
                    className="text-xs gap-1.5"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? "Copied" : "Copy Path"}
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => invoke("open_path", { path: result.midi_path })}
                    className="text-xs gap-1.5"
                  >
                    <FolderOpen className="w-3.5 h-3.5" /> Show in File Explorer
                  </Button>
                </div>
              </div>
              <div
                className="p-2.5 bg-background rounded-md border font-mono text-xs text-muted-foreground truncate"
                title={result.midi_path}
              >
                {result.midi_path}
              </div>
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => invoke("open_storage_folder", { folderType: "midi" })}
              className="text-xs gap-1.5"
            >
              <FolderOpen className="w-3.5 h-3.5" /> Open MIDI Folder
            </Button>
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
