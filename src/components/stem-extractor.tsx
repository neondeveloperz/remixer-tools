import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  FolderOpenIcon,
  Music,
  Loader2,
  Store,
  Zap,
} from "lucide-react";
import { usePlayer, type TrackInfo } from "@/contexts/PlayerContext";
import { extractStemName } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import rawCatalog from "@/lib/model-catalog.json";

interface ProgressPayload {
  item: string;
  progress: number;
}

interface InstalledModel {
  filename: string;
  size_bytes: number;
  modified_time: number;
  is_custom: boolean;
  custom_name?: string | null;
  custom_type?: string | null;
  custom_stems?: string[] | null;
}

interface StemExtractorProps {
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  onNavigateToModelStore?: () => void;
  initialInputFile?: string;
  onExtractionComplete?: () => void;
}

export function StemExtractor({
  selectedModel,
  onModelChange,
  onNavigateToModelStore,
  initialInputFile,
  onExtractionComplete,
}: StemExtractorProps) {
  const player = usePlayer();
  const onExtractionCompleteRef = useRef(onExtractionComplete);
  onExtractionCompleteRef.current = onExtractionComplete;
  const [isSettingUp, setIsSettingUp] = useState(true);
  const [isReady, setIsReady] = useState(false);


  const [setupLog, setSetupLog] = useState<string[]>([]);
  const [progresses, setProgresses] = useState<Record<string, number>>({});

  const [inputFile, setInputFile] = useState(initialInputFile || "");

  useEffect(() => {
    if (initialInputFile) {
      setInputFile(initialInputFile);
    }
  }, [initialInputFile]);
  const [internalModel, setInternalModel] = useState("htdemucs.yaml");
  const model = selectedModel !== undefined ? selectedModel : internalModel;
  const setModel = (m: string) => {
    setInternalModel(m);
    onModelChange?.(m);
  };
  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([]);

  const loadInstalledModels = useCallback(async () => {
    try {
      const list = await invoke<InstalledModel[]>("get_installed_models");
      setInstalledModels(list);
    } catch (e) {
      console.error("Failed to load installed models:", e);
    }
  }, []);

  useEffect(() => {
    loadInstalledModels();
  }, [loadInstalledModels, isReady]);

  const modelOptions = useMemo(() => {
    const catMap = new Map((rawCatalog as { filename: string; name: string; type: string }[]).map((c) => [c.filename, c]));

    const defaults = [
      { value: "htdemucs.yaml", label: "htdemucs (Standard 4-Stems)", group: "Demucs v4" },
      { value: "htdemucs_6s.yaml", label: "htdemucs_6s (6-Stems)", group: "Demucs v4" },
      { value: "UVR_MDXNET_KARA_2.onnx", label: "UVR MDX-Net Kara 2", group: "MDX-Net" },
      { value: "UVR-MDX-NET-Inst_HQ_3.onnx", label: "UVR MDX-Net Inst HQ 3", group: "MDX-Net" },
      { value: "Kim_Vocal_2.onnx", label: "Kim Vocal 2", group: "MDX-Net" },
    ];

    const optionsMap = new Map<string, { value: string; label: string; group: string }>();
    defaults.forEach((d) => optionsMap.set(d.value, d));

    for (const inst of installedModels) {
      if (optionsMap.has(inst.filename)) continue;
      const cat = catMap.get(inst.filename);
      if (inst.is_custom) {
        optionsMap.set(inst.filename, {
          value: inst.filename,
          label: inst.custom_name || inst.filename,
          group: "Custom",
        });
      } else if (cat) {
        optionsMap.set(inst.filename, {
          value: inst.filename,
          label: cat.name,
          group: cat.type === "MDXC" ? "Roformer" : cat.type,
        });
      } else {
        optionsMap.set(inst.filename, {
          value: inst.filename,
          label: inst.filename,
          group: "Installed",
        });
      }
    }

    if (model && !optionsMap.has(model)) {
      const cat = catMap.get(model);
      optionsMap.set(model, {
        value: model,
        label: cat?.name || model,
        group: cat?.type || "Selected",
      });
    }

    return Array.from(optionsMap.values());
  }, [installedModels, model]);

  const groupedModelOptions = useMemo(() => {
    const groups: Record<string, { value: string; label: string; group: string }[]> = {};
    for (const opt of modelOptions) {
      if (!groups[opt.group]) {
        groups[opt.group] = [];
      }
      groups[opt.group].push(opt);
    }
    return groups;
  }, [modelOptions]);
  const [outputFormat, setOutputFormat] = useState("FLAC");
  const [overlap, setOverlap] = useState("4");
  const [segmentSize, setSegmentSize] = useState("256");
  const [useGpu, setUseGpu] = useState(true);
  const [lowMemory, setLowMemory] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractLog, setExtractLog] = useState<string[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);


  const setupStarted = useRef(false);

  useEffect(() => {
    // Register listeners every time component mounts
    const unlistenSetup = listen<string>("stem-log", (event) => {
      setSetupLog(prev => [...prev, event.payload]);
      if (event.payload === "STEM Extractor is ready!") {
        setIsSettingUp(false);
        setIsReady(true);
      }
    });

    const unlistenExtract = listen<string>("stem-extract-log", (event) => {
      setExtractLog(prev => {
        let text = event.payload || "";

        // Clean up \r characters from tqdm output
        const parts = text.split('\r');
        text = parts[parts.length - 1].trim();

        if (!text) return prev;

        // Check if current text is a progress bar update
        const isProgress = text.includes('%|') && (text.includes('it/s]') || text.includes('s/it]') || text.includes('s/step]'));

        if (prev.length > 0) {
          const lastLine = prev[prev.length - 1];
          const lastIsProgress = lastLine.includes('%|') && (lastLine.includes('it/s]') || lastLine.includes('s/it]') || lastLine.includes('s/step]'));

          // Replace the last progress line with the new one instead of appending
          if (isProgress && lastIsProgress) {
            const newLog = [...prev];
            newLog[newLog.length - 1] = text;
            return newLog;
          }
        }

        return [...prev, text];
      });
    });

    const unlistenExtractDone = listen<boolean>("stem-extract-done", (event) => {
      setIsExtracting(false);
      setExtractLog(prev => [...prev, event.payload ? "Extraction Complete!" : "Extraction Failed!"]);
    });

    const unlistenExtractResult = listen<{ success: boolean; input_file: string; output_files: string[] }>(
      "stem-extract-result",
      (event) => {
        if (event.payload.success && event.payload.output_files.length > 0) {
          const newTracks: TrackInfo[] = event.payload.output_files.map((path) => {
            const parts = path.split(/[/\\]/);
            const filename = parts[parts.length - 1];
            const stemName = extractStemName(filename);
            return {
              name: stemName,
              path,
            };
          });
          player.loadTracks(newTracks);
          onExtractionCompleteRef.current?.();
        }
      }
    );

    const unlistenSetupProgress = listen<ProgressPayload>("setup-progress", (event) => {
      setProgresses((prev) => {
        const newProg = { ...prev };
        if (event.payload.progress >= 100) {
          delete newProg[event.payload.item];
        } else {
          newProg[event.payload.item] = event.payload.progress;
        }
        return newProg;
      });
    });

    const unlistenDragDrop = getCurrentWebviewWindow().onDragDropEvent((event) => {
      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        setIsDraggingFile(true);
      } else if (event.payload.type === 'leave') {
        setIsDraggingFile(false);
      } else if (event.payload.type === 'drop') {
        setIsDraggingFile(false);
        const paths = event.payload.paths;
        if (paths && paths.length > 0) {
          const path = paths[0];
          const ext = path.split('.').pop()?.toLowerCase();
          if (['mp3', 'wav', 'flac', 'ogg', 'm4a'].includes(ext || '')) {
            setInputFile(path);
            // Auto analyze
            setExtractLog(prev => [...prev, "Analyzing BPM & Key..."]);
            invoke<{ success: boolean, new_path?: string, bpm?: number, key?: string, message?: string }>("analyze_and_rename_audio", { filePath: path })
              .then(res => {
                if (res.new_path) setInputFile(res.new_path);
                if (res.bpm && res.key) {
                  setExtractLog(prev => [...prev, `Analysis Complete: ${res.bpm} BPM, ${res.key}`]);
                } else if (res.message) {
                  const msg = res.message;
                  setExtractLog(prev => [...prev, msg]);
                }
              })
              .catch(e => {
                console.error("Analysis failed", e);
                setExtractLog(prev => [...prev, `Analysis skipped or failed: ${e}`]);
              });
          }
        }
      }
    });

    // Start setup check only once
    if (!setupStarted.current) {
      setupStarted.current = true;
      invoke("setup_stem_extractor").catch(e => {
        setSetupLog(prev => [...prev, `Error: ${e}`]);
        setIsSettingUp(false);
      });
    }

    return () => {
      unlistenSetup.then(fn => fn());
      unlistenExtract.then(fn => fn());
      unlistenExtractDone.then(fn => fn());
      unlistenExtractResult.then(fn => fn());
      unlistenSetupProgress.then(fn => fn());
      unlistenDragDrop.then(fn => fn());
    };
  }, []);

  const selectFile = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Audio',
          extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a']
        }]
      });
      if (selected && typeof selected === 'string') {
        setInputFile(selected);
        // Auto analyze
        setExtractLog(prev => [...prev, "Analyzing BPM & Key..."]);
        invoke<{ success: boolean, new_path?: string, bpm?: number, key?: string, message?: string }>("analyze_and_rename_audio", { filePath: selected })
          .then(res => {
            if (res.new_path) setInputFile(res.new_path);
            if (res.bpm && res.key) {
              setExtractLog(prev => [...prev, `Analysis Complete: ${res.bpm} BPM, ${res.key}`]);
            } else if (res.message) {
              const msg = res.message;
              setExtractLog(prev => [...prev, msg]);
            }
          })
          .catch(e => {
            console.error("Analysis failed", e);
            setExtractLog(prev => [...prev, `Analysis skipped or failed: ${e}`]);
          });
      }
    } catch (e) {
      console.error("Failed to select file:", e);
    }
  };

  const startExtraction = async () => {
    if (!inputFile) return;
    setIsExtracting(true);
    setExtractLog([]);
    try {
      await invoke("run_stem_extractor", {
        inputFile,
        model,
        outputFormat,
        useGpu,
        overlap,
        segmentSize,
        lowMemory,
      });
    } catch (e) {
      setExtractLog(prev => [...prev, `Error: ${e}`]);
      setIsExtracting(false);
    }
  };

  const cancelExtraction = async () => {
    try {
      await invoke("cancel_stem_extractor");
      setExtractLog(prev => [...prev, "Cancelling extraction..."]);
    } catch (e) {
      console.error("Failed to cancel:", e);
    }
  };

  if (isSettingUp) {
    return (
      <Card className="w-full max-w-3xl mx-auto mt-10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Initializing STEM Extractor
          </CardTitle>
          <CardDescription>We are setting up the AI environment. This may take a few minutes if downloading models for the first time.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            {Object.keys(progresses).length > 0 && (
              <div className="space-y-2 mb-2">
                {Object.entries(progresses).map(([item, prog]) => (
                  <div key={item} className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Downloading {item}...</span>
                      <span>{prog}%</span>
                    </div>
                    <Progress value={prog} className="h-2" />
                  </div>
                ))}
              </div>
            )}
            <div className="bg-muted p-4 rounded-md h-64 overflow-y-auto font-mono text-sm whitespace-pre-wrap flex flex-col">
              {setupLog.map((log, i) => <div key={i}>{log}</div>)}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!isReady) {
    return (
      <Card className="w-full max-w-3xl mx-auto mt-10 border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Setup Failed</CardTitle>
          <CardDescription>Could not initialize the STEM Extractor environment.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted p-4 rounded-md h-64 overflow-y-auto font-mono text-sm whitespace-pre-wrap text-destructive">
            {setupLog.map((log, i) => <div key={i}>{log}</div>)}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="relative">
      <Card className={`w-full transition-colors duration-200 ${isDraggingFile ? "border-primary border-2 border-dashed bg-primary/5" : ""}`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Music className="w-5 h-5" /> STEM Extractor</CardTitle>
          <CardDescription>Separate vocals and instruments using UVR-compatible AI models.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Audio File</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={inputFile}
                placeholder="Select an audio or video file..."
                className="font-mono text-sm text-muted-foreground"
              />
              <Button variant="outline" onClick={selectFile} disabled={isExtracting}>
                <FolderOpenIcon className="mr-2 h-4 w-4" />
                Browse
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-6 space-y-2">
              <div className="flex items-center justify-between">
                <Label>AI Model</Label>
                {onNavigateToModelStore && (
                  <button
                    type="button"
                    onClick={onNavigateToModelStore}
                    className="text-xs text-primary hover:underline flex items-center gap-1 font-medium cursor-pointer"
                  >
                    <Store className="w-3.5 h-3.5" /> Browse Model Store
                  </button>
                )}
              </div>
              <Select value={model} onValueChange={(val) => { if (val) setModel(val); }} disabled={isExtracting}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select AI Model" />
                </SelectTrigger>
                <SelectContent
                  side="bottom"
                  align="start"
                  alignItemWithTrigger={false}
                  sideOffset={6}
                  className="w-(--anchor-width) min-w-[340px] max-h-80 p-1.5 shadow-xl border border-border/80"
                >
                  {Object.entries(groupedModelOptions).map(([groupName, items], idx) => (
                    <SelectGroup key={groupName}>
                      {idx > 0 && <SelectSeparator className="my-1.5" />}
                      <SelectLabel className="px-2.5 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        {groupName}
                      </SelectLabel>
                      {items.map((opt) => (
                        <SelectItem
                          key={opt.value}
                          value={opt.value}
                          className="py-2 px-2.5 cursor-pointer rounded-md transition-colors"
                        >
                          <span className="truncate text-sm font-medium" title={opt.label}>
                            {opt.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-2 space-y-2">
              <Label>Output Format</Label>
              <Select value={outputFormat} onValueChange={(val) => { if (val) setOutputFormat(val); }} disabled={isExtracting}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Format" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FLAC">FLAC</SelectItem>
                  <SelectItem value="MP3">MP3</SelectItem>
                  <SelectItem value="WAV">WAV</SelectItem>
                  <SelectItem value="OGG">OGG</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-2 space-y-2">
              <Label>Overlap</Label>
              <Select value={overlap} onValueChange={(val) => { if (val) setOverlap(val); }} disabled={isExtracting}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Overlap" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2 (Fast / Low RAM)</SelectItem>
                  <SelectItem value="4">4 (Default / Balanced)</SelectItem>
                  <SelectItem value="6">6 (High Quality)</SelectItem>
                  <SelectItem value="8">8 (Higher Quality)</SelectItem>
                  <SelectItem value="10">10 (Maximum)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-2 space-y-2">
              <Label>Segment</Label>
              <Select value={segmentSize} onValueChange={(val) => { if (val) setSegmentSize(val); }} disabled={isExtracting}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Segment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="128">128 (Ultra Low RAM)</SelectItem>
                  <SelectItem value="256">256 (Default / Balanced)</SelectItem>
                  <SelectItem value="512">512 (High Quality)</SelectItem>
                  <SelectItem value="768">768 (Heavy RAM)</SelectItem>
                  <SelectItem value="1024">1024 (Max - High RAM)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2 bg-muted/40 p-3 rounded-lg border border-border/60">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="use-gpu"
                checked={useGpu}
                onCheckedChange={(checked) => setUseGpu(checked as boolean)}
                disabled={isExtracting}
              />
              <Label htmlFor="use-gpu" className="font-medium cursor-pointer text-sm">
                Enable GPU Acceleration (DirectML / CUDA)
              </Label>
            </div>

            <div className="flex items-start space-x-2.5">
              <Checkbox
                id="low-memory"
                checked={lowMemory}
                onCheckedChange={(checked) => {
                  const isChecked = checked as boolean;
                  setLowMemory(isChecked);
                  if (isChecked) {
                    if (segmentSize === "512" || segmentSize === "768" || segmentSize === "1024") {
                      setSegmentSize("256");
                    }
                  }
                }}
                disabled={isExtracting}
                className="mt-0.5"
              />
              <div className="grid gap-1 leading-none">
                <Label htmlFor="low-memory" className="font-medium cursor-pointer text-sm flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                  Memory Saver Mode
                  <span className="text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold px-1.5 py-0.5 rounded">
                    Recommended
                  </span>
                </Label>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            {isExtracting ? (
              <Button onClick={cancelExtraction} variant="destructive" className="flex-1 font-semibold">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cancel Extraction
              </Button>
            ) : (
              <Button onClick={startExtraction} disabled={!inputFile} className="flex-1 font-semibold">
                Extract STEMs
              </Button>
            )}


            <Button
              type="button"
              variant="outline"
              onClick={() => invoke("open_storage_folder", { folderType: "stems" })}
              className="gap-1.5"
              title="Open folder where extracted stems are stored"
            >
              <FolderOpenIcon className="h-4 w-4" /> Open Stems Folder
            </Button>
          </div>

          {extractLog.length > 0 && (
            <div className="bg-muted p-4 rounded-md h-64 overflow-y-auto font-mono text-xs whitespace-pre-wrap flex flex-col">
              {extractLog.map((log, i) => <div key={i}>{log}</div>)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Overlay for drag and drop */}
      {isDraggingFile && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm rounded-xl border-2 border-dashed border-primary pointer-events-none">
          <div className="p-4 bg-primary/10 rounded-full mb-4">
            <Music className="w-12 h-12 text-primary" />
          </div>
          <h3 className="text-xl font-bold">Drop Audio File Here</h3>
          <p className="text-muted-foreground mt-2">Supports MP3, WAV, FLAC, OGG, M4A</p>
        </div>
      )}
    </div>
  );
}
