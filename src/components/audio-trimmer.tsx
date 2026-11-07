import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { FolderOpenIcon, Loader2, Music, Pause, Play, Scissors } from "lucide-react";

type Range = [number, number];

// shortcut: waveform decoding is skipped above this size (decoded PCM is ~10x the file), slider still works.
const MAX_DECODE_BYTES = 150 * 1024 * 1024;
const PEAK_BINS = 600;

const fmt = (s: number) => {
  const t = Math.max(0, s);
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
};

interface AudioTrimmerProps {
  onSendToExtractor?: (filePath: string) => void;
}

export function AudioTrimmer({ onSendToExtractor }: AudioTrimmerProps) {
  const [filePath, setFilePath] = useState("");
  const [range, setRange] = useState<Range | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedPath, setSavedPath] = useState("");

  const browse = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "Audio / Video", extensions: ["mp3", "wav", "flac", "ogg", "m4a", "opus", "aac", "mp4", "mkv", "webm"] }],
      });
      if (typeof selected === "string") {
        setFilePath(selected);
        setRange(null);
        setSavedPath("");
      }
    } catch (e) {
      console.error("Failed to select file:", e);
    }
  };

  const save = async () => {
    if (!filePath || !range) return;
    setIsSaving(true);
    try {
      const out = await invoke<string>("trim_audio", { inputFile: filePath, start: range[0], end: range[1] });
      setSavedPath(out);
      toast.success("Trimmed file saved to Library");
    } catch (e) {
      toast.error(`Trim failed: ${e}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scissors className="w-5 h-5" /> Audio Trimmer
        </CardTitle>
        <CardDescription>
          Cut a section out of a song and save it to your Library. MP3/M4A/OGG are cut without re-encoding; FLAC and WAV stay lossless.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Audio File</Label>
          <div className="flex gap-2">
            <Input readOnly value={filePath} placeholder="Select an audio or video file..." className="font-mono text-sm text-muted-foreground" />
            <Button variant="outline" onClick={browse} disabled={isSaving}>
              <FolderOpenIcon className="mr-2 h-4 w-4" /> Browse
            </Button>
          </div>
        </div>

        {filePath && <TrimEditor key={filePath} filePath={filePath} value={range} onChange={setRange} disabled={isSaving} />}

        <div className="flex gap-3">
          <Button onClick={save} disabled={!range || isSaving} className="flex-1 font-semibold">
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Scissors className="mr-2 h-4 w-4" />}
            Save Trimmed File
          </Button>
          <Button type="button" variant="outline" onClick={() => invoke("open_storage_folder", { folderType: "library" })}>
            <FolderOpenIcon className="mr-2 h-4 w-4" /> Open Library Folder
          </Button>
        </div>

        {savedPath && (
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <span className="font-mono truncate text-muted-foreground" title={savedPath}>{savedPath}</span>
            {onSendToExtractor && (
              <Button size="sm" variant="secondary" onClick={() => onSendToExtractor(savedPath)}>
                <Music className="mr-2 h-4 w-4" /> Send to STEM Extractor
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface TrimEditorProps {
  filePath: string;
  value: Range | null;
  onChange: (range: Range) => void;
  disabled?: boolean;
}

// Mounted with key={filePath}, so state starts fresh per file.
function TrimEditor({ filePath, value, onChange, disabled }: TrimEditorProps) {
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rangeRef = useRef<Range | null>(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    rangeRef.current = value;
    onChangeRef.current = onChange;
  }, [value, onChange]);

  // Duration from the media element (works for video containers too); peaks are best effort.
  // Same loading path as the STEM Mixer (audioEngine.ts): plugin-fs first, asset protocol as fallback.
  // Playback uses a blob URL because the asset protocol fails for <audio> on some Windows paths.
  useEffect(() => {
    const audio = new Audio();
    audio.onloadedmetadata = () => {
      setDuration(audio.duration);
      onChangeRef.current([0, audio.duration]);
    };
    audio.onerror = () => setError("This file can't be previewed here.");
    audio.ontimeupdate = () => {
      const r = rangeRef.current;
      if (r && audio.currentTime >= r[1]) audio.pause();
    };
    audio.onpause = () => setPlaying(false);
    audio.onplay = () => setPlaying(true);
    audioRef.current = audio;

    let cancelled = false;
    let blobUrl = "";
    (async () => {
      let buf: ArrayBuffer;
      try {
        try {
          const { readFile } = await import("@tauri-apps/plugin-fs");
          const bytes = await readFile(filePath);
          buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        } catch {
          const url = convertFileSrc(filePath).replace(/#/g, "%23").replace(/\?/g, "%3F");
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          buf = await res.arrayBuffer();
        }
      } catch (e) {
        console.error("Failed to read audio file:", e);
        if (!cancelled) setError("This file can't be read.");
        return;
      }
      if (cancelled) return;
      blobUrl = URL.createObjectURL(new Blob([buf]));
      audio.src = blobUrl;

      try {
        if (buf.byteLength > MAX_DECODE_BYTES) return;
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(buf);
        void ctx.close();
        const data = decoded.getChannelData(0);
        const step = Math.max(1, Math.floor(data.length / PEAK_BINS));
        const out = new Float32Array(PEAK_BINS);
        for (let i = 0; i < PEAK_BINS; i++) {
          let max = 0;
          const end = Math.min(data.length, (i + 1) * step);
          for (let j = i * step; j < end; j++) {
            const v = Math.abs(data[j]);
            if (v > max) max = v;
          }
          out[i] = max;
        }
        if (!cancelled) setPeaks(out);
      } catch (e) {
        console.debug("Waveform decode failed:", e);
      }
    })();

    return () => {
      cancelled = true;
      audio.pause();
      audio.removeAttribute("src");
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      audioRef.current = null;
    };
  }, [filePath]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || !duration) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const [s, e] = value ?? [0, duration];
    const barW = 2;
    const cols = Math.floor(w / (barW + 1));
    ctx.fillStyle = getComputedStyle(canvas).color;
    for (let c = 0; c < cols; c++) {
      const t = (c / cols) * duration;
      ctx.globalAlpha = t >= s && t <= e ? 1 : 0.2;
      const bh = Math.max(1, peaks[Math.floor((c / cols) * peaks.length)] * (h * 0.9));
      ctx.fillRect(c * (barW + 1), (h - bh) / 2, barW, bh);
    }
  }, [peaks, duration, value]);

  const togglePreview = () => {
    const audio = audioRef.current;
    if (!audio || !value) return;
    if (playing) return audio.pause();
    if (audio.currentTime < value[0] || audio.currentTime >= value[1]) audio.currentTime = value[0];
    void audio.play();
  };

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!duration || !value) return <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading audio...</p>;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">
          {fmt(value[0])} - {fmt(value[1])} <span className="text-muted-foreground">({fmt(value[1] - value[0])} of {fmt(duration)})</span>
        </span>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={togglePreview} aria-label={playing ? "Pause preview" : "Play selection"}>
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {peaks && <canvas ref={canvasRef} className="w-full h-20 block text-primary" />}
      <Slider
        min={0}
        max={duration}
        step={0.1}
        minStepsBetweenValues={10}
        value={value}
        disabled={disabled}
        onValueChange={(v) => {
          if (Array.isArray(v) && v.length === 2) onChange([v[0], v[1]]);
        }}
      />
    </div>
  );
}
