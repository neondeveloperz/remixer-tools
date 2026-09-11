import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Music, FolderOpenIcon } from "lucide-react";

export function StemExtractor() {
  const [isSettingUp, setIsSettingUp] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [setupLog, setSetupLog] = useState<string[]>([]);
  
  const [inputFile, setInputFile] = useState("");
  const [model, setModel] = useState("htdemucs");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractLog, setExtractLog] = useState<string[]>([]);

  const setupStarted = useRef(false);

  useEffect(() => {
    if (setupStarted.current) return;
    setupStarted.current = true;

    // Listen to setup logs
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

    // Start setup check
    invoke("setup_stem_extractor").catch(e => {
      setSetupLog(prev => [...prev, `Error: ${e}`]);
      setIsSettingUp(false);
    });

    return () => {
      unlistenSetup.then(fn => fn());
      unlistenExtract.then(fn => fn());
      unlistenExtractDone.then(fn => fn());
    };
  }, []);

  const selectFile = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'mp4'] }]
      });
      if (selected) {
        setInputFile(selected as string);
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
      await invoke("run_stem_extractor", { inputFile, model });
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
          <div className="bg-muted p-4 rounded-md h-64 overflow-y-auto font-mono text-sm whitespace-pre-wrap flex flex-col">
            {setupLog.map((log, i) => <div key={i}>{log}</div>)}
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
    <Card className="w-full">
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

        <div className="space-y-2">
          <Label>AI Model</Label>
          <Select value={model} onValueChange={(val) => { if (val) setModel(val); }} disabled={isExtracting}>
            <SelectTrigger>
              <SelectValue placeholder="Select AI Model" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="htdemucs">htdemucs (Standard 4-Stems: Vocals, Drums, Bass, Other)</SelectItem>
              <SelectItem value="UVR_MDXNET_KARA_2">UVR MDX-Net Kara 2 (Vocal / Instrumental)</SelectItem>
              <SelectItem value="UVR-MDX-NET-Inst_HQ_3">UVR MDX-Net Inst HQ 3 (High Quality Instrumental)</SelectItem>
              <SelectItem value="Kim_Vocal_2">Kim Vocal 2 (High Quality Vocals)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button onClick={startExtraction} disabled={isExtracting || !inputFile} className="w-full">
          {isExtracting ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing (This will take a while)...</>
          ) : (
            "Extract STEMs"
          )}
        </Button>

        {extractLog.length > 0 && (
          <div className="bg-muted p-4 rounded-md h-64 overflow-y-auto font-mono text-xs whitespace-pre-wrap flex flex-col">
            {extractLog.map((log, i) => <div key={i}>{log}</div>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
