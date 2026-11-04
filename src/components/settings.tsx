import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  FolderOpenIcon,
  RefreshCwIcon,
  Sun,
  Moon,
  RotateCcw,
  Save,
  Download,
  Cpu,
  Layers,
  Sparkles,
  Sliders,
  CheckCircle2,
  HardDrive
} from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTheme } from "@/components/theme-provider";
import { toast } from "sonner";

export interface AppSettings {
  download_dir: string;
  filename_template?: string | null;
  default_format?: string | null;
  default_quality?: string | null;
  max_concurrent_downloads?: number | null;
  auto_analyze_audio?: boolean | null;
  default_stem_model?: string | null;
  default_stem_format?: string | null;
  default_overlap?: string | null;
  enable_gpu_acceleration?: boolean | null;
  low_memory_mode?: boolean | null;
}

interface InstalledModel {
  filename: string;
  size_bytes: number;
  modified_time: number;
  is_custom: boolean;
  custom_name?: string | null;
}

export function Settings() {
  const { theme, setTheme } = useTheme();

  // Storage
  const [downloadDir, setDownloadDir] = useState<string>("");
  const [filenameTemplate, setFilenameTemplate] = useState<string>("%(title)s.%(ext)s");

  // Downloader defaults
  const [defaultFormat, setDefaultFormat] = useState<string>("mp3_meta");
  const [defaultQuality, setDefaultQuality] = useState<string>("best");
  const [maxConcurrent, setMaxConcurrent] = useState<number>(2);
  const [autoAnalyzeAudio, setAutoAnalyzeAudio] = useState<boolean>(true);

  // STEM Extractor defaults
  const [defaultStemModel, setDefaultStemModel] = useState<string>("htdemucs.yaml");
  const [defaultStemFormat, setDefaultStemFormat] = useState<string>("FLAC");
  const [defaultOverlap, setDefaultOverlap] = useState<string>("4");
  const [enableGpu, setEnableGpu] = useState<boolean>(true);
  const [lowMemoryMode, setLowMemoryMode] = useState<boolean>(true);

  // Installed models list
  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([]);

  // State
  const [isSaving, setIsSaving] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string>("");
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isRepairingStem, setIsRepairingStem] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await invoke<AppSettings>("get_settings");
        if (settings.download_dir) setDownloadDir(settings.download_dir);
        if (settings.filename_template) setFilenameTemplate(settings.filename_template);
        if (settings.default_format) setDefaultFormat(settings.default_format);
        if (settings.default_quality) setDefaultQuality(settings.default_quality);
        if (settings.max_concurrent_downloads) setMaxConcurrent(settings.max_concurrent_downloads);
        if (settings.auto_analyze_audio !== undefined && settings.auto_analyze_audio !== null) {
          setAutoAnalyzeAudio(settings.auto_analyze_audio);
        }
        if (settings.default_stem_model) setDefaultStemModel(settings.default_stem_model);
        if (settings.default_stem_format) setDefaultStemFormat(settings.default_stem_format);
        if (settings.default_overlap) setDefaultOverlap(settings.default_overlap);
        if (settings.enable_gpu_acceleration !== undefined && settings.enable_gpu_acceleration !== null) {
          setEnableGpu(settings.enable_gpu_acceleration);
        }
        if (settings.low_memory_mode !== undefined && settings.low_memory_mode !== null) {
          setLowMemoryMode(settings.low_memory_mode);
        }
      } catch (e) {
        console.error("Failed to load settings:", e);
      }
    };

    const loadModels = async () => {
      try {
        const list = await invoke<InstalledModel[]>("get_installed_models");
        setInstalledModels(list);
      } catch {
        // ignore
      }
    };

    loadSettings();
    loadModels();
  }, []);

  const selectDirectory = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (selected) {
        setDownloadDir(selected as string);
        await invoke("set_download_dir", { dir: selected });
        toast.success("Base directory updated");
      }
    } catch (e) {
      console.error("Failed to select directory:", e);
      toast.error("Failed to select directory");
    }
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      const settingsPayload: AppSettings = {
        download_dir: downloadDir,
        filename_template: filenameTemplate.trim() || "%(title)s.%(ext)s",
        default_format: defaultFormat,
        default_quality: defaultQuality,
        max_concurrent_downloads: maxConcurrent,
        auto_analyze_audio: autoAnalyzeAudio,
        default_stem_model: defaultStemModel,
        default_stem_format: defaultStemFormat,
        default_overlap: defaultOverlap,
        enable_gpu_acceleration: enableGpu,
        low_memory_mode: lowMemoryMode,
      };

      await invoke("save_settings", { settings: settingsPayload });
      toast.success("Settings saved successfully!");
    } catch (e) {
      console.error("Failed to save settings:", e);
      toast.error(`Failed to save settings: ${e}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToDefaults = () => {
    setFilenameTemplate("%(title)s.%(ext)s");
    setDefaultFormat("mp3_meta");
    setDefaultQuality("best");
    setMaxConcurrent(2);
    setAutoAnalyzeAudio(true);
    setDefaultStemModel("htdemucs.yaml");
    setDefaultStemFormat("FLAC");
    setDefaultOverlap("4");
    setEnableGpu(true);
    setLowMemoryMode(true);
    toast.info("Settings reset to defaults. Click 'Save All' to persist.");
  };

  const checkForUpdates = async () => {
    setIsCheckingUpdate(true);
    setUpdateStatus("Checking...");
    try {
      const currentVersion = await getVersion();
      const response = await fetch("https://api.github.com/repos/neondeveloperz/remixer-tools/releases/latest");

      if (!response.ok) {
        throw new Error("Network response was not ok");
      }

      const data = await response.json();

      if (data.tag_name) {
        const latestVersion = data.tag_name.replace('v', '');
        if (latestVersion > currentVersion) {
          setUpdateStatus(`Update available: v${latestVersion}`);
          if (confirm(`New version v${latestVersion} is available! (Current: v${currentVersion})\n\nDo you want to go to the download page?`)) {
            await openUrl(data.html_url);
          }
        } else {
          setUpdateStatus(`You are up to date (v${currentVersion}).`);
        }
      } else {
        setUpdateStatus("Could not fetch latest version.");
      }
    } catch (e) {
      console.error(e);
      setUpdateStatus("Error checking for updates.");
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const repairStemEnvironment = async () => {
    try {
      setIsRepairingStem(true);
      toast.info("Repairing STEM Extractor environment... This might take a few minutes.");
      await invoke("reset_stem_extractor");
      toast.success("STEM Extractor environment reinstalled successfully!");
    } catch (e) {
      toast.error(`Failed to repair STEM environment: ${e}`);
    } finally {
      setIsRepairingStem(false);
    }
  };

  return (
    <Card className="w-full mx-auto max-w-5xl shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4 border-b">
        <div>
          <CardTitle className="text-xl font-bold flex items-center gap-2">
            <Sliders className="h-5 w-5 text-primary" />
            Preferences & Settings
          </CardTitle>
          <CardDescription className="text-xs mt-1">
            Configure global default behaviors, storage, and AI processing preferences.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleResetToDefaults} disabled={isSaving}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Reset Defaults
          </Button>
          <Button size="sm" onClick={handleSaveAll} disabled={isSaving} className="min-w-[100px]">
            {isSaving ? (
              <RefreshCwIcon className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-1.5" />
            )}
            {isSaving ? "Saving..." : "Save All"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-6">
        <Tabs defaultValue="downloader" className="w-full">
          <TabsList className="grid grid-cols-3 mb-6">
            <TabsTrigger value="downloader" className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Downloader Defaults
            </TabsTrigger>
            <TabsTrigger value="stem" className="flex items-center gap-2">
              <Layers className="h-4 w-4" />
              STEM Extractor Defaults
            </TabsTrigger>
            <TabsTrigger value="general" className="flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              Storage & Appearance
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: Downloader & Queue Defaults */}
          <TabsContent value="downloader" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Default Format */}
              <div className="space-y-2">
                <Label htmlFor="default-format" className="text-sm font-semibold">
                  Default Download Format
                </Label>
                <Select value={defaultFormat} onValueChange={(val) => val && setDefaultFormat(val)}>
                  <SelectTrigger id="default-format">
                    <SelectValue placeholder="Select format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel className="text-xs text-muted-foreground uppercase tracking-wider">Audio Formats (with Metadata & Cover)</SelectLabel>
                      <SelectItem value="mp3_meta">MP3 (with Metadata & Cover)</SelectItem>
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel className="text-xs text-muted-foreground uppercase tracking-wider">Lossless Audio Formats</SelectLabel>
                      <SelectItem value="wav">WAV (Lossless 24-bit)</SelectItem>
                      <SelectItem value="flac">FLAC (Lossless)</SelectItem>
                      <SelectItem value="alac">ALAC (Apple Lossless)</SelectItem>
                      <SelectItem value="aiff">AIFF (Uncompressed)</SelectItem>
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel className="text-xs text-muted-foreground uppercase tracking-wider">Lossy Audio Formats</SelectLabel>
                      <SelectItem value="opus">Opus (High Efficiency)</SelectItem>
                      <SelectItem value="m4a">M4A (AAC Audio)</SelectItem>
                      <SelectItem value="ogg">OGG Vorbis</SelectItem>
                      <SelectItem value="mp3">MP3 (Standard)</SelectItem>
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel className="text-xs text-muted-foreground uppercase tracking-wider">Video Formats</SelectLabel>
                      <SelectItem value="mp4">MP4 (H.264 / AAC)</SelectItem>
                      <SelectItem value="mkv">MKV (Universal Container)</SelectItem>
                      <SelectItem value="webm">WebM (VP9 / Opus)</SelectItem>
                      <SelectItem value="mov">MOV (QuickTime)</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  The initial format selected when loading the YouTube / SoundCloud downloader.
                </p>
              </div>

              {/* Default Quality */}
              <div className="space-y-2">
                <Label htmlFor="default-quality" className="text-sm font-semibold">
                  Default Quality Preset
                </Label>
                <Select value={defaultQuality} onValueChange={(val) => val && setDefaultQuality(val)}>
                  <SelectTrigger id="default-quality">
                    <SelectValue placeholder="Select quality" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel className="text-xs text-muted-foreground uppercase tracking-wider">Audio Quality</SelectLabel>
                      <SelectItem value="best">Best Available (320k Max)</SelectItem>
                      <SelectItem value="320K">320 kbps (CBR High)</SelectItem>
                      <SelectItem value="256K">256 kbps (Standard)</SelectItem>
                      <SelectItem value="192K">192 kbps (Medium)</SelectItem>
                      <SelectItem value="128K">128 kbps (Compact)</SelectItem>
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel className="text-xs text-muted-foreground uppercase tracking-wider">Video Quality</SelectLabel>
                      <SelectItem value="4320p">8K Ultra HD (4320p)</SelectItem>
                      <SelectItem value="2160p">4K Ultra HD (2160p)</SelectItem>
                      <SelectItem value="1440p">2K Quad HD (1440p)</SelectItem>
                      <SelectItem value="1080p">Full HD (1080p)</SelectItem>
                      <SelectItem value="720p">HD (720p)</SelectItem>
                      <SelectItem value="480p">SD (480p)</SelectItem>
                      <SelectItem value="360p">Low (360p)</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Target audio bitrate or video resolution used for single and batch downloads.
                </p>
              </div>

              {/* Max Concurrent Downloads */}
              <div className="space-y-2">
                <Label htmlFor="max-concurrent" className="text-sm font-semibold">
                  Max Concurrent Downloads
                </Label>
                <Select
                  value={maxConcurrent.toString()}
                  onValueChange={(val) => val && setMaxConcurrent(parseInt(val) || 2)}
                >
                  <SelectTrigger id="max-concurrent">
                    <SelectValue placeholder="Select concurrency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 Stream (Sequential - Low Bandwidth)</SelectItem>
                    <SelectItem value="2">2 Streams (Recommended - Balanced)</SelectItem>
                    <SelectItem value="3">3 Streams (Fast Connection)</SelectItem>
                    <SelectItem value="4">4 Streams (Ultra Fast - High Bandwidth)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Number of parallel download threads executed concurrently in the queue.
                </p>
              </div>

              {/* Filename Template */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="filename-template" className="text-sm font-semibold">
                    Filename Template
                  </Label>
                  <button
                    type="button"
                    onClick={() => setFilenameTemplate("%(title)s.%(ext)s")}
                    className="text-[11px] text-primary hover:underline"
                  >
                    Reset Template
                  </button>
                </div>
                <Input
                  id="filename-template"
                  value={filenameTemplate}
                  onChange={(e) => setFilenameTemplate(e.target.value)}
                  placeholder="%(title)s.%(ext)s"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Variables: <code>%(title)s</code>, <code>%(uploader)s</code>, <code>%(id)s</code>, <code>%(ext)s</code>, <code>%(resolution)s</code>
                </p>
              </div>
            </div>

            {/* Auto Analyze BPM & Key Toggle Card */}
            <div className="p-4 rounded-lg border bg-muted/20 flex items-start gap-3 mt-4">
              <Checkbox
                id="auto-analyze"
                checked={autoAnalyzeAudio}
                onCheckedChange={(checked) => setAutoAnalyzeAudio(checked === true)}
                className="mt-1"
              />
              <div className="space-y-1">
                <Label htmlFor="auto-analyze" className="text-sm font-semibold cursor-pointer flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  Automatic BPM & Musical Key Analysis
                </Label>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  When enabled, Remixer Tools automatically analyzes downloaded audio tracks for tempo (BPM) and musical key (Camelot & Traditional key), appending metadata to the audio tag and filename for quick DJ remixing.
                </p>
              </div>
            </div>
          </TabsContent>

          {/* TAB 2: STEM Extractor Defaults */}
          <TabsContent value="stem" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Default AI Model */}
              <div className="space-y-2">
                <Label htmlFor="default-stem-model" className="text-sm font-semibold">
                  Default AI Separation Model
                </Label>
                <Select value={defaultStemModel} onValueChange={(val) => val && setDefaultStemModel(val)}>
                  <SelectTrigger id="default-stem-model">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel className="text-xs text-muted-foreground uppercase tracking-wider">Demucs v4 (Hybrid Transformer)</SelectLabel>
                      <SelectItem value="htdemucs.yaml">htdemucs (Standard 4-Stems: Vocals, Drums, Bass, Other)</SelectItem>
                      <SelectItem value="htdemucs_6s.yaml">htdemucs_6s (6-Stems: + Guitar, Piano)</SelectItem>
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel className="text-xs text-muted-foreground uppercase tracking-wider">MDX-Net (ONNX Accelerated)</SelectLabel>
                      <SelectItem value="UVR_MDXNET_KARA_2.onnx">UVR MDX-Net Kara 2 (Vocals / Instrumental)</SelectItem>
                      <SelectItem value="UVR-MDX-NET-Inst_HQ_3.onnx">UVR MDX-Net Inst HQ 3 (High Fidelity Instrumental)</SelectItem>
                      <SelectItem value="Kim_Vocal_2.onnx">Kim Vocal 2 (Ultra Clean Vocal Lead)</SelectItem>
                    </SelectGroup>
                    {installedModels.filter(m => m.is_custom).length > 0 && (
                      <>
                        <SelectSeparator />
                        <SelectGroup>
                          <SelectLabel className="text-xs text-muted-foreground uppercase tracking-wider">Installed Custom Models</SelectLabel>
                          {installedModels.filter(m => m.is_custom).map(m => (
                            <SelectItem key={m.filename} value={m.filename}>
                              {m.custom_name || m.filename}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </>
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Default AI model pre-selected in the STEM Extractor studio.
                </p>
              </div>

              {/* Default Stem Format */}
              <div className="space-y-2">
                <Label htmlFor="default-stem-format" className="text-sm font-semibold">
                  Default Stem Output Format
                </Label>
                <Select value={defaultStemFormat} onValueChange={(val) => val && setDefaultStemFormat(val)}>
                  <SelectTrigger id="default-stem-format">
                    <SelectValue placeholder="Select output format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FLAC">FLAC (Lossless 24-bit - Recommended)</SelectItem>
                    <SelectItem value="WAV">WAV (Uncompressed 24-bit)</SelectItem>
                    <SelectItem value="MP3">MP3 (320 kbps CBR)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Audio encoding format used when saving isolated stem tracks.
                </p>
              </div>

              {/* Default Overlap */}
              <div className="space-y-2">
                <Label htmlFor="default-overlap" className="text-sm font-semibold">
                  Processing Chunk Overlap
                </Label>
                <Select value={defaultOverlap} onValueChange={(val) => val && setDefaultOverlap(val)}>
                  <SelectTrigger id="default-overlap">
                    <SelectValue placeholder="Select overlap" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2">2 (Fast Processing - Good Quality)</SelectItem>
                    <SelectItem value="4">4 (Recommended - High Quality)</SelectItem>
                    <SelectItem value="8">8 (Maximum Quality - Slower)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Higher overlap reduces boundary artifacts between audio segments.
                </p>
              </div>

              {/* Performance Hardware Options */}
              <div className="space-y-4 pt-1">
                <div className="p-3 rounded-lg border bg-muted/20 flex items-start gap-3">
                  <Checkbox
                    id="enable-gpu"
                    checked={enableGpu}
                    onCheckedChange={(checked) => setEnableGpu(checked === true)}
                    className="mt-0.5"
                  />
                  <div className="space-y-0.5">
                    <Label htmlFor="enable-gpu" className="text-sm font-semibold cursor-pointer flex items-center gap-1.5">
                      <Cpu className="h-4 w-4 text-emerald-500" />
                      Hardware / GPU Acceleration
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Leverage CUDA, DirectML, or Apple Silicon MPS for 5x-10x faster AI inference.
                    </p>
                  </div>
                </div>

                <div className="p-3 rounded-lg border bg-muted/20 flex items-start gap-3">
                  <Checkbox
                    id="low-memory"
                    checked={lowMemoryMode}
                    onCheckedChange={(checked) => setLowMemoryMode(checked === true)}
                    className="mt-0.5"
                  />
                  <div className="space-y-0.5">
                    <Label htmlFor="low-memory" className="text-sm font-semibold cursor-pointer">
                      Low VRAM Memory Mode
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Optimizes PyTorch VRAM allocations to prevent Out-Of-Memory errors on GPUs &lt; 6GB.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* TAB 3: Storage & Appearance */}
          <TabsContent value="general" className="space-y-6">
            <div className="space-y-3">
              <Label htmlFor="download-dir" className="text-sm font-semibold">Remixer Tools Base Directory</Label>
              <div className="flex gap-2">
                <Input
                  id="download-dir"
                  readOnly
                  value={downloadDir || "Default (~/downloads/remixer-tools)"}
                  className="font-mono text-sm text-muted-foreground"
                />
                <Button variant="outline" onClick={selectDirectory}>
                  <FolderOpenIcon className="mr-2 h-4 w-4" />
                  Browse
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Root folder for all Remixer Tools media. Subdirectories are organized automatically.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                  <div className="min-w-0 pr-2">
                    <p className="text-xs font-semibold flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                      Downloader Library
                    </p>
                    <p className="text-[11px] font-mono text-muted-foreground truncate" title={`${downloadDir}/library`}>
                      {downloadDir ? `${downloadDir}/library` : "~/downloads/remixer-tools/library"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs shrink-0"
                    onClick={() => invoke("open_storage_folder", { folderType: "library" })}
                  >
                    <FolderOpenIcon className="h-3.5 w-3.5 mr-1" />
                    Open
                  </Button>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                  <div className="min-w-0 pr-2">
                    <p className="text-xs font-semibold flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-purple-500 shrink-0" />
                      STEM Extractor
                    </p>
                    <p className="text-[11px] font-mono text-muted-foreground truncate" title={`${downloadDir}/stems`}>
                      {downloadDir ? `${downloadDir}/stems` : "~/downloads/remixer-tools/stems"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={isRepairingStem}
                      onClick={repairStemEnvironment}
                      title="Reinstall STEM Extractor Python environment and dependencies"
                    >
                      <RotateCcw className={`h-3 w-3 mr-1 ${isRepairingStem ? "animate-spin" : ""}`} />
                      {isRepairingStem ? "Repairing..." : "Repair"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => invoke("open_storage_folder", { folderType: "extractor" })}
                    >
                      <FolderOpenIcon className="h-3.5 w-3.5 mr-1" />
                      Open
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3 border-t pt-4">
              <Label className="text-sm font-semibold">Appearance Theme</Label>
              <div className="grid grid-cols-2 gap-3 max-w-md">
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={`flex items-center gap-3 p-3.5 rounded-lg border text-left transition-all cursor-pointer ${theme === "light"
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "border-border hover:bg-muted/50"
                    }`}
                >
                  <div className="p-2 rounded-md bg-amber-500/10 text-amber-500">
                    <Sun className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold flex items-center gap-1.5">
                      Light Mode
                      <span className="text-[10px] px-1.5 py-0.2 bg-muted rounded font-normal text-muted-foreground">Default</span>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={`flex items-center gap-3 p-3.5 rounded-lg border text-left transition-all cursor-pointer ${theme === "dark"
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "border-border hover:bg-muted/50"
                    }`}
                >
                  <div className="p-2 rounded-md bg-sky-500/10 text-sky-400">
                    <Moon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">Dark Mode</div>
                  </div>
                </button>
              </div>
            </div>

            <div className="space-y-2 border-t pt-4">
              <Label className="text-sm font-semibold">Application Updates</Label>
              <div className="flex items-center gap-4">
                <Button variant="secondary" onClick={checkForUpdates} disabled={isCheckingUpdate}>
                  <RefreshCwIcon className={`mr-2 h-4 w-4 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
                  {isCheckingUpdate ? "Checking..." : "Check for Updates"}
                </Button>
                {updateStatus && (
                  <span className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    {updateStatus}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Check GitHub Releases for latest features and security updates.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
