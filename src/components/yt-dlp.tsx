import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Play, Pause, X, Folder, LayoutList } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

interface DownloadItem {
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
  status: 'initializing' | 'downloading' | 'completed' | 'error';
  log: string[];
}

export function YtDlp() {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState("video");
  const [quality, setQuality] = useState("best");
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [isInitializing, setIsInitializing] = useState(false);

  useEffect(() => {
    // Load from local storage
    const saved = localStorage.getItem("remixer_downloads");
    if (saved) {
      try {
        setDownloads(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse saved downloads", e);
      }
    }

    const unlistenProgress = listen<{id: string, data: string}>("ytdlp-progress", (event) => {
      const { id, data } = event.payload;
      try {
        // data looks like: {"progress": "12.3%", "speed": "1.24MiB/s", "eta": "00:45", "downloaded": "12MiB", "total": "100MiB"}
        const parsed = JSON.parse(data);
        const percentRaw = parsed.progress?.replace('%', '')?.trim() || '0';
        const percent = percentRaw !== 'NA' ? parseFloat(percentRaw) : 0;
        
        setDownloads(prev => prev.map(d => {
          if (d.id === id) {
            return {
              ...d,
              progress: percent,
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
      // General logs (we could try to match to ID, but for now we just keep it simple)
      console.log("[yt-dlp]", event.payload);
    });

    const unlistenDone = listen<string>("ytdlp-done", (event) => {
      const id = event.payload;
      setDownloads(prev => prev.map(d => {
        if (d.id === id) {
          return { ...d, status: 'completed', progress: 100, eta: '00:00' };
        }
        return d;
      }));
    });

    return () => {
      unlistenProgress.then(fn => fn());
      unlistenLog.then(fn => fn());
      unlistenDone.then(fn => fn());
    };
  }, []);

  // Save to local storage whenever downloads change
  useEffect(() => {
    localStorage.setItem("remixer_downloads", JSON.stringify(downloads));
  }, [downloads]);

  const startDownload = async () => {
    if (!url) return;
    setIsInitializing(true);
    
    try {
      // 1. Get video info
      const infoStr = await invoke<string>("get_video_info", { url });
      const info = JSON.parse(infoStr);
      
      const newItem: DownloadItem = {
        id: Math.random().toString(36).substring(7),
        url,
        title: info.title || "Unknown Video",
        thumbnail: info.thumbnail || "",
        format,
        quality,
        progress: 0,
        speed: "0B/s",
        downloaded: "0B",
        total: "Unknown",
        eta: "calculating...",
        status: 'initializing',
        log: []
      };
      
      setDownloads(prev => [newItem, ...prev]);
      setUrl("");
      
      // 2. Start the actual download
      await invoke("run_ytdlp", { 
        id: newItem.id, 
        url: newItem.url, 
        format: newItem.format, 
        quality: newItem.quality 
      });
      
    } catch (e) {
      console.error("Failed to start download:", e);
      alert("Failed to get video info. Is the URL correct?");
    } finally {
      setIsInitializing(false);
    }
  };

  const removeDownload = (id: string) => {
    setDownloads(prev => prev.filter(d => d.id !== id));
  };

  return (
    <div className="space-y-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Video Downloader</CardTitle>
          <CardDescription>Download videos or extract MP3 audio using yt-dlp.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2">
            <div className="space-y-1">
              <Label htmlFor="video-url">Video URL</Label>
              <Input 
                id="video-url"
                placeholder="https://www.youtube.com/watch?v=..." 
                value={url} 
                onChange={(e) => setUrl(e.target.value)} 
                disabled={isInitializing}
              />
            </div>
            <div className="flex gap-4 items-end">
              <div className="space-y-1">
                <Label>Format</Label>
                <Select value={format} onValueChange={(val) => { if (val) { setFormat(val); setQuality("best"); } }} disabled={isInitializing}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="video">Video (MP4)</SelectItem>
                    <SelectItem value="mp3">Audio (MP3)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Quality</Label>
                <Select value={quality} onValueChange={(val) => { if (val) setQuality(val); }} disabled={isInitializing}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Quality" />
                  </SelectTrigger>
                  <SelectContent>
                    {format === "video" ? (
                      <>
                        <SelectItem value="best">Best Quality</SelectItem>
                        <SelectItem value="2160p">4K (2160p)</SelectItem>
                        <SelectItem value="1080p">1080p</SelectItem>
                        <SelectItem value="720p">720p</SelectItem>
                        <SelectItem value="480p">480p</SelectItem>
                      </>
                    ) : (
                      <>
                        <SelectItem value="best">Best Audio</SelectItem>
                        <SelectItem value="320K">320 kbps</SelectItem>
                        <SelectItem value="256K">256 kbps</SelectItem>
                        <SelectItem value="192K">192 kbps</SelectItem>
                        <SelectItem value="128K">128 kbps</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={startDownload} disabled={isInitializing || !url} className="ml-auto">
                {isInitializing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Download
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Downloads List */}
      {downloads.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <LayoutList className="w-4 h-4" /> Download History
          </h3>
          {downloads.map(item => (
            <Card key={item.id} className="overflow-hidden">
              <div className="flex h-24">
                {/* Thumbnail */}
                <div className="w-40 shrink-0 bg-muted flex items-center justify-center overflow-hidden">
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt={item.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-muted-foreground text-xs">No Thumb</div>
                  )}
                </div>
                
                {/* Info & Progress */}
                <div className="flex-1 flex flex-col justify-between p-3 min-w-0">
                  <div className="flex justify-between items-start">
                    <div className="truncate pr-4">
                      <span className="bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full mr-2">
                        {item.quality === 'best' ? 'Best' : item.quality} {item.format.toUpperCase()}
                      </span>
                      <span className="font-medium text-sm truncate">{item.title}</span>
                    </div>
                  </div>
                  
                  <div className="space-y-1.5">
                    <Progress value={item.progress} className="h-1.5" />
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <div className="flex gap-3">
                        <span className="font-mono text-primary/80">{item.speed}</span>
                        <span className="font-mono">{item.downloaded} / {item.total}</span>
                        <span className="font-mono">{item.progress.toFixed(1)}%</span>
                        {item.status === 'downloading' && (
                          <span className="font-mono">ETA {item.eta}</span>
                        )}
                        {item.status === 'completed' && (
                          <span className="text-green-500 font-medium">Completed</span>
                        )}
                        {item.status === 'initializing' && (
                          <span>Initializing...</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Actions */}
                <div className="w-16 border-l flex flex-col items-center justify-center gap-2 bg-muted/20">
                  {item.status === 'downloading' ? (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                      <Pause className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeDownload(item.id)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
