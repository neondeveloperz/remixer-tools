import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  RefreshCw,
  RotateCcw,
  ListOrdered,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Layers,
  X,
  Play,
  Copy,
  Terminal
} from "lucide-react";
import { toast } from "sonner";
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
}

export interface StemBatchItem {
  id: string;
  filePath: string;
  fileName: string;
  model: string;
  status: 'queued' | 'extracting' | 'completed' | 'error';
  bpm?: number;
  key?: string;
  error?: string;
}

interface StemExtractorProps {
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  initialInputFile?: string;
  onNavigateToModelStore?: () => void;
  onExtractionComplete?: () => void;
}

export function StemExtractor({
  selectedModel,
  onModelChange,
  initialInputFile,
  onNavigateToModelStore,
  onExtractionComplete
}: StemExtractorProps) {
  const player = usePlayer();
  const onExtractionCompleteRef = useRef(onExtractionComplete);
  onExtractionCompleteRef.current = onExtractionComplete;

  const [isSettingUp, setIsSettingUp] = useState(false);
  const [setupLog, setSetupLog] = useState<string[]>([]);
  const [isReady, setIsReady] = useState(true);
  const [progresses, setProgresses] = useState<Record<string, number>>({});
  const [inputFile, setInputFile] = useState(initialInputFile || "");
  const [model, setModel] = useState(selectedModel || "htdemucs.yaml");

  useEffect(() => {
    if (selectedModel && selectedModel !== model) {
      setModel(selectedModel);
    }
  }, [selectedModel, model]);

  useEffect(() => {
    if (initialInputFile) {
      setInputFile(initialInputFile);
    }
  }, [initialInputFile]);

  const handleModelChange = (newModel: string) => {
    setModel(newModel);
    onModelChange?.(newModel);
  };
  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([]);

  // Mode tab: 'single' | 'batch'
  const [activeTab, setActiveTab] = useState<'single' | 'batch'>('single');

  // Batch queue state
  const [batchQueue, setBatchQueue] = useState<StemBatchItem[]>([]);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [isBatchRunning, setIsBatchRunning] = useState(false);

  const isBatchRunningRef = useRef(false);
  isBatchRunningRef.current = isBatchRunning;

  const activeBatchIdRef = useRef<string | null>(null);
  activeBatchIdRef.current = activeBatchId;

  const batchQueueRef = useRef<StemBatchItem[]>([]);
  batchQueueRef.current = batchQueue;

  const loadInstalledModels = useCallback(async () => {
    try {
      const list = await invoke<InstalledModel[]>("get_installed_models");
      setInstalledModels(list);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (isReady) {
      loadInstalledModels();
    }
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
  const [copiedLog, setCopiedLog] = useState<string | null>(null);

  const handleCopyLog = (text: string, id: string = "extract") => {
    navigator.clipboard.writeText(text);
    setCopiedLog(id);
    toast.success("Log copied to clipboard");
    setTimeout(() => setCopiedLog(null), 2000);
  };
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Initialize defaults from global settings
  useEffect(() => {
    const initFromSettings = async () => {
      try {
        const s = await invoke<any>("get_settings");
        if (!selectedModel && s.default_stem_model) {
          setModel(s.default_stem_model);
          onModelChange?.(s.default_stem_model);
        }
        if (s.default_stem_format) setOutputFormat(s.default_stem_format);
        if (s.default_overlap) setOverlap(s.default_overlap);
        if (s.enable_gpu_acceleration !== undefined && s.enable_gpu_acceleration !== null) {
          setUseGpu(s.enable_gpu_acceleration);
        }
        if (s.low_memory_mode !== undefined && s.low_memory_mode !== null) {
          setLowMemory(s.low_memory_mode);
        }
      } catch (e) {
        console.warn("Failed to load settings in stem extractor:", e);
      }
    };
    initFromSettings();
  }, [selectedModel]);

  const setupStarted = useRef(false);

  // Helper to add multiple files into the batch queue
  const addFilesToBatch = useCallback((paths: string[]) => {
    const validExts = ['mp3', 'wav', 'flac', 'ogg', 'm4a'];
    const newItems: StemBatchItem[] = [];

    for (const p of paths) {
      const ext = p.split('.').pop()?.toLowerCase();
      if (validExts.includes(ext || '')) {
        const parts = p.split(/[/\\]/);
        const name = parts[parts.length - 1];
        newItems.push({
          id: Math.random().toString(36).substring(7),
          filePath: p,
          fileName: name,
          model,
          status: 'queued'
        });
      }
    }

    if (newItems.length > 0) {
      setBatchQueue(prev => [...prev, ...newItems]);
      setActiveTab('batch');
    }
  }, [model]);

  // Execute extraction on a specific batch item
  const processNextBatchItem = useCallback(async (item: StemBatchItem) => {
    setActiveBatchId(item.id);
    setBatchQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'extracting' } : q));
    setIsExtracting(true);
    setExtractLog([`[Batch] Starting extraction for: ${item.fileName} using model ${item.model}`]);

    try {
      await invoke("run_stem_extractor", {
        inputFile: item.filePath,
        model: item.model,
        outputFormat,
        useGpu,
        overlap,
        segmentSize,
        lowMemory,
      });
    } catch (e) {
      console.error("Batch extraction failed for item:", e);
      setBatchQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'error', error: String(e) } : q));
      setIsExtracting(false);

      // Continue to next queued item if available
      const nextItem = batchQueueRef.current.find(q => q.status === 'queued' && q.id !== item.id);
      if (nextItem && isBatchRunningRef.current) {
        processNextBatchItem(nextItem);
      } else {
        setIsBatchRunning(false);
        setActiveBatchId(null);
      }
    }
  }, [outputFormat, useGpu, overlap, segmentSize, lowMemory]);

  useEffect(() => {
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
        const parts = text.split('\r');
        text = parts[parts.length - 1].trim();

        if (!text) return prev;
        const isProgress = text.includes('%|') && (text.includes('it/s]') || text.includes('s/it]') || text.includes('s/step]'));

        if (prev.length > 0) {
          const lastLine = prev[prev.length - 1];
          const lastIsProgress = lastLine.includes('%|') && (lastLine.includes('it/s]') || lastLine.includes('s/it]') || lastLine.includes('s/step]'));

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
      const isSuccess = event.payload;
      setIsExtracting(false);
      setExtractLog(prev => [...prev, isSuccess ? "Extraction Complete!" : "Extraction Failed!"]);

      // Handle batch queue progression
      if (isBatchRunningRef.current && activeBatchIdRef.current) {
        const finishedId = activeBatchIdRef.current;
        setBatchQueue(prev => prev.map(item => item.id === finishedId ? {
          ...item,
          status: isSuccess ? 'completed' : 'error'
        } : item));

        // Wait brief delay before launching next queued item
        setTimeout(() => {
          const nextItem = batchQueueRef.current.find(item => item.status === 'queued' && item.id !== finishedId);
          if (nextItem && isBatchRunningRef.current) {
            processNextBatchItem(nextItem);
          } else {
            setIsBatchRunning(false);
            setActiveBatchId(null);
            setExtractLog(prev => [...prev, "🎉 Batch processing finished for all items!"]);
          }
        }, 1000);
      }
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
          if (paths.length === 1) {
            const path = paths[0];
            const ext = path.split('.').pop()?.toLowerCase();
            if (['mp3', 'wav', 'flac', 'ogg', 'm4a'].includes(ext || '')) {
              setInputFile(path);
              setExtractLog(prev => [...prev, "Analyzing BPM & Key..."]);
              invoke<{ success: boolean; new_path?: string; bpm?: number; key?: string; message?: string }>("analyze_and_rename_audio", { filePath: path })
                .then(res => {
                  if (res.new_path) setInputFile(res.new_path);
                  if (res.bpm && res.key) {
                    setExtractLog(prev => [...prev, `Analysis Complete: ${res.bpm} BPM, ${res.key}`]);
                  } else if (res.message) {
                    setExtractLog(prev => [...prev, res.message!]);
                  }
                })
                .catch(e => {
                  console.error("Analysis failed", e);
                  setExtractLog(prev => [...prev, `Analysis skipped or failed: ${e}`]);
                });
            }
          } else {
            // Multiple files dropped -> add to batch
            addFilesToBatch(paths);
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
  }, [addFilesToBatch, processNextBatchItem]);

  const selectSingleFile = async () => {
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
        setExtractLog(prev => [...prev, "Analyzing BPM & Key..."]);
        invoke<{ success: boolean; new_path?: string; bpm?: number; key?: string; message?: string }>("analyze_and_rename_audio", { filePath: selected })
          .then(res => {
            if (res.new_path) setInputFile(res.new_path);
            if (res.bpm && res.key) {
              setExtractLog(prev => [...prev, `Analysis Complete: ${res.bpm} BPM, ${res.key}`]);
            } else if (res.message) {
              setExtractLog(prev => [...prev, res.message!]);
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

  const selectMultipleBatchFiles = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Audio',
          extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a']
        }]
      });
      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        addFilesToBatch(paths);
      }
    } catch (e) {
      console.error("Failed to select multiple files:", e);
    }
  };

  const startSingleExtraction = async () => {
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

  const startBatchExtraction = () => {
    const nextItem = batchQueue.find(item => item.status === 'queued');
    if (!nextItem) return;

    setIsBatchRunning(true);
    processNextBatchItem(nextItem);
  };

  const cancelCurrentExtraction = async () => {
    try {
      await invoke("cancel_stem_extractor");
      setExtractLog(prev => [...prev, "Cancelling extraction..."]);
      if (isBatchRunning) {
        setIsBatchRunning(false);
        if (activeBatchId) {
          setBatchQueue(prev => prev.map(q => q.id === activeBatchId ? { ...q, status: 'error', error: 'Cancelled' } : q));
          setActiveBatchId(null);
        }
      }
    } catch (e) {
      console.error("Failed to cancel:", e);
    }
  };

  const removeBatchItem = (id: string) => {
    setBatchQueue(prev => prev.filter(item => item.id !== id));
  };

  const clearCompletedBatch = () => {
    setBatchQueue(prev => prev.filter(item => item.status !== 'completed'));
  };

  const handleRetrySetup = () => {
    setIsSettingUp(true);
    setSetupLog([]);
    invoke("setup_stem_extractor").catch(e => {
      setSetupLog(prev => [...prev, `Error: ${e}`]);
      setIsSettingUp(false);
    });
  };

  const handleResetSetup = () => {
    setIsSettingUp(true);
    setSetupLog(["Reinstalling environment... Please wait."]);
    invoke("reset_stem_extractor").catch(e => {
      setSetupLog(prev => [...prev, `Error: ${e}`]);
      setIsSettingUp(false);
    });
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
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span className="font-medium flex items-center gap-1.5 text-foreground">
                  <Terminal className="w-3.5 h-3.5 text-primary" /> Setup Log
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs gap-1.5"
                  onClick={() => handleCopyLog(setupLog.join("\n"), "setup")}
                >
                  {copiedLog === "setup" ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Log</span>
                    </>
                  )}
                </Button>
              </div>
              <div className="bg-muted p-4 rounded-md h-64 overflow-y-auto font-mono text-sm whitespace-pre-wrap flex flex-col">
                {setupLog.map((log, i) => <div key={i}>{log}</div>)}
              </div>
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
          <div className="flex items-center justify-between">
            <CardTitle className="text-destructive">Setup Failed</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleRetrySetup} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </Button>
              <Button variant="destructive" size="sm" onClick={handleResetSetup} className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />
                Reinstall Environment
              </Button>
            </div>
          </div>
          <CardDescription>Could not initialize the STEM Extractor environment. You can retry or reinstall the environment below.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span className="font-medium flex items-center gap-1.5 text-destructive">
              <Terminal className="w-3.5 h-3.5" /> Error Log
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs gap-1.5"
              onClick={() => handleCopyLog(setupLog.join("\n"), "setup-err")}
            >
              {copiedLog === "setup-err" ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Log</span>
                </>
              )}
            </Button>
          </div>
          <div className="bg-muted p-4 rounded-md h-64 overflow-y-auto font-mono text-sm whitespace-pre-wrap text-destructive">
            {setupLog.map((log, i) => <div key={i}>{log}</div>)}
          </div>
        </CardContent>
      </Card>
    );
  }

  const batchQueuedCount = batchQueue.filter(q => q.status === 'queued').length;
  const batchCompletedCount = batchQueue.filter(q => q.status === 'completed').length;

  return (
    <div className="relative">
      <Card className={`w-full transition-colors duration-200 ${isDraggingFile ? "border-primary border-2 border-dashed bg-primary/5" : ""}`}>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Music className="w-5 h-5 text-primary" /> STEM Extractor
              </CardTitle>
              <CardDescription>
                Separate vocals, drums, bass, and instruments using state-of-the-art AI models.
              </CardDescription>
            </div>
            <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as 'single' | 'batch')} className="w-auto">
              <TabsList className="h-9">
                <TabsTrigger value="single" className="text-xs px-3">
                  Single Track
                </TabsTrigger>
                <TabsTrigger value="batch" className="text-xs px-3 flex items-center gap-1.5">
                  <ListOrdered className="w-3.5 h-3.5" />
                  Batch Queue
                  {batchQueue.length > 0 && (
                    <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 h-4">
                      {batchQueue.length}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Shared AI Settings Bar */}
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
              <Select value={model} onValueChange={(val) => { if (val) handleModelChange(val); }} disabled={isExtracting}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select AI Model">
                    {(val) => modelOptions.find(o => o.value === val)?.label || val || "Select AI Model"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent
                  side="bottom"
                  align="start"
                  alignItemWithTrigger={false}
                  sideOffset={6}
                  className="min-w-[340px] w-max max-w-md max-h-80 p-1.5 shadow-xl border border-border/80"
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
                  <SelectValue placeholder="Overlap">
                    {(val) => val ? `${val} (${val === '2' ? 'Fast' : val === '4' ? 'Balanced' : 'High Quality'})` : "Overlap"}
                  </SelectValue>
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
                  <SelectValue placeholder="Segment">
                    {(val) => val ? `${val} (${val === '128' ? 'Low RAM' : val === '256' ? 'Balanced' : 'High Quality'})` : "Segment"}
                  </SelectValue>
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

          {/* Single Mode View */}
          {activeTab === 'single' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Audio File</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={inputFile}
                    placeholder="Select an audio or video file..."
                    className="font-mono text-sm text-muted-foreground"
                  />
                  <Button variant="outline" onClick={selectSingleFile} disabled={isExtracting}>
                    <FolderOpenIcon className="mr-2 h-4 w-4" />
                    Browse
                  </Button>
                </div>
              </div>

              <div className="flex gap-3">
                {isExtracting ? (
                  <Button onClick={cancelCurrentExtraction} variant="destructive" className="flex-1 font-semibold">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cancel Extraction
                  </Button>
                ) : (
                  <Button onClick={startSingleExtraction} disabled={!inputFile} className="flex-1 font-semibold">
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
            </div>
          )}

          {/* Batch Mode View */}
          {activeTab === 'batch' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-muted/30 p-3 rounded-lg border border-border/50">
                <div className="flex items-center gap-3">
                  <div className="text-xs">
                    <span className="font-semibold text-foreground">{batchQueue.length}</span> Total Tracks
                  </div>
                  {batchQueuedCount > 0 && (
                    <Badge variant="outline" className="text-amber-400 border-amber-400/40 text-[10px]">
                      {batchQueuedCount} Queued
                    </Badge>
                  )}
                  {batchCompletedCount > 0 && (
                    <Badge variant="outline" className="text-emerald-400 border-emerald-400/40 text-[10px]">
                      {batchCompletedCount} Done
                    </Badge>
                  )}
                </div>

                <div className="flex gap-2 w-full sm:w-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectMultipleBatchFiles}
                    disabled={isBatchRunning}
                    className="text-xs flex-1 sm:flex-none"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add Audio Files
                  </Button>
                  {batchCompletedCount > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearCompletedBatch}
                      disabled={isBatchRunning}
                      className="text-xs"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Clear Completed
                    </Button>
                  )}
                </div>
              </div>

              {/* Batch Queue Table */}
              {batchQueue.length === 0 ? (
                <div className="border border-dashed border-border/80 rounded-lg p-8 text-center text-muted-foreground space-y-2">
                  <Layers className="w-8 h-8 mx-auto opacity-50" />
                  <p className="text-sm">Batch queue is empty.</p>
                  <p className="text-xs">
                    Drop multiple audio files here or click "Add Audio Files" to process tracks in batch.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectMultipleBatchFiles}
                    className="mt-2 text-xs"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> Browse Audio Files
                  </Button>
                </div>
              ) : (
                <div className="border border-border/60 rounded-lg divide-y divide-border/40 max-h-[320px] overflow-y-auto">
                  {batchQueue.map((item, index) => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 p-3 transition-colors ${
                        item.id === activeBatchId ? "bg-primary/10 border-l-2 border-primary" : "hover:bg-muted/30"
                      }`}
                    >
                      <div className="w-6 text-center text-xs font-mono text-muted-foreground">
                        {index + 1}
                      </div>

                      <div className="shrink-0">
                        {item.status === 'extracting' && (
                          <Loader2 className="w-4 h-4 text-primary animate-spin" />
                        )}
                        {item.status === 'completed' && (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        )}
                        {item.status === 'error' && (
                          <AlertCircle className="w-4 h-4 text-destructive" />
                        )}
                        {item.status === 'queued' && (
                          <Clock className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{item.fileName}</div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">
                            {item.model}
                          </span>
                          {item.status === 'extracting' && (
                            <span className="text-primary font-medium animate-pulse">Extracting STEMs...</span>
                          )}
                          {item.status === 'completed' && (
                            <span className="text-emerald-400 font-medium">Completed</span>
                          )}
                          {item.status === 'error' && (
                            <span className="text-destructive font-medium">{item.error || 'Failed'}</span>
                          )}
                          {item.status === 'queued' && (
                            <span>Waiting in queue</span>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0">
                        {item.status !== 'extracting' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => removeBatchItem(item.id)}
                            disabled={isBatchRunning && item.id === activeBatchId}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Batch Action Buttons */}
              <div className="flex gap-3">
                {isBatchRunning ? (
                  <Button onClick={cancelCurrentExtraction} variant="destructive" className="flex-1 font-semibold">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cancel Batch Extraction
                  </Button>
                ) : (
                  <Button
                    onClick={startBatchExtraction}
                    disabled={batchQueuedCount === 0}
                    className="flex-1 font-semibold bg-primary text-primary-foreground"
                  >
                    <Play className="w-4 h-4 mr-2" /> Start Batch Extraction ({batchQueuedCount} Queued)
                  </Button>
                )}

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => invoke("open_storage_folder", { folderType: "stems" })}
                  className="gap-1.5"
                >
                  <FolderOpenIcon className="h-4 w-4" /> Open Stems Folder
                </Button>
              </div>
            </div>
          )}

          {extractLog.length > 0 && (
            <div className="space-y-2 mt-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span className="font-medium flex items-center gap-1.5 text-foreground">
                  <Terminal className="w-3.5 h-3.5 text-primary" /> Extraction Log
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2.5 text-xs gap-1.5"
                    onClick={() => handleCopyLog(extractLog.join("\n"), "extract")}
                  >
                    {copiedLog === "extract" ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Log</span>
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setExtractLog([])}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <div className="bg-muted p-4 rounded-md h-60 overflow-y-auto font-mono text-xs whitespace-pre-wrap flex flex-col">
                {extractLog.map((log, i) => <div key={i}>{log}</div>)}
              </div>
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
          <h3 className="text-xl font-bold">Drop Audio File(s) Here</h3>
          <p className="text-muted-foreground mt-2">Single track or multiple tracks for batch queue</p>
        </div>
      )}
    </div>
  );
}
