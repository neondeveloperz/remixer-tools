import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { FolderOpenIcon, Music, Loader2 } from "lucide-react";
import { usePlayer } from "@/contexts/PlayerContext";
import { Progress } from "@/components/ui/progress";

interface ProgressPayload {
  item: string;
  progress: number;
}

export function StemExtractor({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const player = usePlayer();
  const [isSettingUp, setIsSettingUp] = useState(true);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (onBusyChange) {
      onBusyChange(isSettingUp);
    }
  }, [isSettingUp, onBusyChange]);
  const [setupLog, setSetupLog] = useState<string[]>([]);
  const [progresses, setProgresses] = useState<Record<string, number>>({});
  
  const [inputFile, setInputFile] = useState("");
  const [model, setModel] = useState("htdemucs.yaml");
  const [outputFormat, setOutputFormat] = useState("FLAC");
  const [overlap, setOverlap] = useState("4");
  const [segmentSize, setSegmentSize] = useState("256");
  const [useGpu, setUseGpu] = useState(true);
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
      setExtractLog(prev => [...prev, event.payload]);
    });

    const unlistenExtractDone = listen<boolean>("stem-extract-done", (event) => {
      setIsExtracting(false);
      setExtractLog(prev => [...prev, event.payload ? "Extraction Complete!" : "Extraction Failed!"]);
    });

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
        segmentSize
      });
    } catch (e) {
      setExtractLog(prev => [...prev, `Error: ${e}`]);
      setIsExtracting(false);
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>AI Model</Label>
            <Select value={model} onValueChange={(val) => { if (val) setModel(val); }} disabled={isExtracting}>
              <SelectTrigger>
                <SelectValue placeholder="Select AI Model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="htdemucs.yaml">htdemucs (Standard 4-Stems)</SelectItem>
                <SelectItem value="htdemucs_6s.yaml">htdemucs_6s (6-Stems)</SelectItem>
                <SelectItem value="UVR_MDXNET_KARA_2.onnx">UVR MDX-Net Kara 2</SelectItem>
                <SelectItem value="UVR-MDX-NET-Inst_HQ_3.onnx">UVR MDX-Net Inst HQ 3</SelectItem>
                <SelectItem value="Kim_Vocal_2.onnx">Kim Vocal 2</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label>Output Format</Label>
            <Select value={outputFormat} onValueChange={(val) => { if (val) setOutputFormat(val); }} disabled={isExtracting}>
              <SelectTrigger>
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

          <div className="space-y-2">
            <Label>Overlap</Label>
            <Select value={overlap} onValueChange={(val) => { if (val) setOverlap(val); }} disabled={isExtracting}>
              <SelectTrigger>
                <SelectValue placeholder="Overlap" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">2 (Fast)</SelectItem>
                <SelectItem value="4">4 (Default)</SelectItem>
                <SelectItem value="6">6 (High Quality)</SelectItem>
                <SelectItem value="8">8 (Higher Quality)</SelectItem>
                <SelectItem value="10">10 (Maximum)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Segment</Label>
            <Select value={segmentSize} onValueChange={(val) => { if (val) setSegmentSize(val); }} disabled={isExtracting}>
              <SelectTrigger>
                <SelectValue placeholder="Segment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="128">128 (Low VRAM)</SelectItem>
                <SelectItem value="256">256 (Default)</SelectItem>
                <SelectItem value="512">512</SelectItem>
                <SelectItem value="768">768</SelectItem>
                <SelectItem value="1024">1024 (Best Quality)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center space-x-2 py-2">
          <Checkbox 
            id="use-gpu" 
            checked={useGpu} 
            onCheckedChange={(checked) => setUseGpu(checked as boolean)} 
            disabled={isExtracting}
          />
          <Label htmlFor="use-gpu" className="font-medium cursor-pointer">
            Enable GPU Acceleration (DirectML / CUDA)
          </Label>
        </div>

        <div className="flex gap-4">
          <Button onClick={startExtraction} disabled={isExtracting || !inputFile} className="flex-1">
            {isExtracting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing (This will take a while)...</>
            ) : (
              "Extract STEMs"
            )}
          </Button>
          <Button variant="secondary" onClick={async () => {
            try {
              const { open } = await import('@tauri-apps/plugin-dialog');
              const selected = await open({
                multiple: true,
                filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a'] }]
              });
              
              if (selected && Array.isArray(selected) && selected.length > 0) {
                const tracks = selected.map(path => {
                  const parts = path.split(/[/\\]/);
                  const name = parts[parts.length - 1];
                  return { name, path };
                });
                player.loadTracks(tracks);
              }
            } catch (e) {
              console.error(e);
            }
          }}>
             <Music className="mr-2 h-4 w-4" /> Play Stems
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
