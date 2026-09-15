import { useState, useEffect, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Download,
  Trash2,
  FolderOpen,
  Upload,
  RefreshCw,
  Search,
  Sparkles,
  CheckCircle2,
  Loader2,
  HardDrive,
  Cpu,
  Layers,
  ArrowRight,
  X,
  SlidersHorizontal,
  Info
} from "lucide-react";
import rawCatalog from "@/lib/model-catalog.json";

export interface CatalogModel {
  filename: string;
  name: string;
  type: string;
  category: "vocal-inst" | "cleanup" | "karaoke" | "multistem" | string;
  stems: string[];
  target_stem: string | null;
  sdr: Record<string, number | null | undefined>;
  download_files: string[];
  is_recommended: boolean;
}

export interface InstalledModel {
  filename: string;
  size_bytes: number;
  modified_time: number;
  is_custom: boolean;
  custom_name?: string | null;
  custom_type?: string | null;
  custom_stems?: string[] | null;
}

interface ModelDownloadProgress {
  filename: string;
  log: string;
}

interface ModelDownloadDone {
  filename: string;
  success: boolean;
  error?: string | null;
}

interface ModelStoreProps {
  onSelectModelForExtraction?: (modelFilename: string) => void;
}

const catalog: CatalogModel[] = rawCatalog as unknown as CatalogModel[];

export function ModelStore({ onSelectModelForExtraction }: ModelStoreProps) {
  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([]);
  const [isLoadingInstalled, setIsLoadingInstalled] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTab, setSelectedTab] = useState<string>("all");
  const [selectedArch, setSelectedArch] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("recommended");
  const [downloading, setDownloading] = useState<Record<string, string>>({});
  const [deletingFile, setDeletingFile] = useState<string | null>(null);

  // Custom Model Importer Modal State
  const [isImporterOpen, setIsImporterOpen] = useState(false);
  const [customPath, setCustomPath] = useState("");
  const [customName, setCustomName] = useState("");
  const [customArch, setCustomArch] = useState("MDXC");
  const [customStemsInput, setCustomStemsInput] = useState("Vocals, Instrumental");
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState("");

  const loadInstalled = useCallback(async () => {
    try {
      setIsLoadingInstalled(true);
      const models = await invoke<InstalledModel[]>("get_installed_models");
      setInstalledModels(models);
    } catch (e) {
      console.error("Failed to get installed models:", e);
    } finally {
      setIsLoadingInstalled(false);
    }
  }, []);

  useEffect(() => {
    loadInstalled();

    const unlistenLog = listen<ModelDownloadProgress>("model-download-log", (event) => {
      setDownloading((prev) => ({
        ...prev,
        [event.payload.filename]: event.payload.log,
      }));
    });

    const unlistenDone = listen<ModelDownloadDone>("model-download-done", (event) => {
      setDownloading((prev) => {
        const next = { ...prev };
        delete next[event.payload.filename];
        return next;
      });
      loadInstalled();
      if (!event.payload.success) {
        alert(`Failed to download model: ${event.payload.error || "Unknown error"}`);
      }
    });

    return () => {
      unlistenLog.then((fn) => fn());
      unlistenDone.then((fn) => fn());
    };
  }, [loadInstalled]);

  const installedMap = useMemo(() => {
    const map = new Map<string, InstalledModel>();
    for (const m of installedModels) {
      map.set(m.filename, m);
    }
    return map;
  }, [installedModels]);

  const totalInstalledSizeMB = useMemo(() => {
    const totalBytes = installedModels.reduce((acc, m) => acc + m.size_bytes, 0);
    return (totalBytes / (1024 * 1024)).toFixed(1);
  }, [installedModels]);

  const allDisplayModels = useMemo(() => {
    const items: (CatalogModel & { isInstalled: boolean; installedInfo?: InstalledModel; isCustom?: boolean })[] = [];

    // Catalog items
    for (const c of catalog) {
      const installed = installedMap.get(c.filename);
      items.push({
        ...c,
        isInstalled: !!installed,
        installedInfo: installed,
        isCustom: false,
      });
    }

    // Installed custom models not in catalog
    for (const inst of installedModels) {
      if (inst.is_custom || !catalog.some((c) => c.filename === inst.filename)) {
        items.push({
          filename: inst.filename,
          name: inst.custom_name || inst.filename,
          type: inst.custom_type || "Custom",
          category: "custom",
          stems: inst.custom_stems && inst.custom_stems.length > 0 ? inst.custom_stems : ["Custom"],
          target_stem: null,
          sdr: {},
          download_files: [inst.filename],
          is_recommended: false,
          isInstalled: true,
          installedInfo: inst,
          isCustom: true,
        });
      }
    }

    return items;
  }, [installedMap, installedModels]);

  const filteredModels = useMemo(() => {
    return allDisplayModels.filter((m) => {
      // Tab filter
      if (selectedTab === "installed" && !m.isInstalled) return false;
      if (selectedTab === "vocal-inst" && m.category !== "vocal-inst") return false;
      if (selectedTab === "cleanup" && m.category !== "cleanup") return false;
      if (selectedTab === "karaoke" && m.category !== "karaoke") return false;
      if (selectedTab === "multistem" && m.category !== "multistem") return false;
      if (selectedTab === "custom" && !m.isCustom) return false;

      // Architecture filter
      if (selectedArch !== "all" && m.type !== selectedArch) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = m.name.toLowerCase().includes(q);
        const matchFilename = m.filename.toLowerCase().includes(q);
        const matchArch = m.type.toLowerCase().includes(q);
        const matchStems = m.stems.some((s) => s.toLowerCase().includes(q));
        if (!matchName && !matchFilename && !matchArch && !matchStems) {
          return false;
        }
      }

      return true;
    }).sort((a, b) => {
      if (sortBy === "recommended") {
        if (a.is_recommended && !b.is_recommended) return -1;
        if (!a.is_recommended && b.is_recommended) return 1;
        if (a.isInstalled && !b.isInstalled) return -1;
        if (!a.isInstalled && b.isInstalled) return 1;
        return a.name.localeCompare(b.name);
      }
      if (sortBy === "name") {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === "vocal_sdr") {
        const scoreA = a.sdr?.vocals ?? -999;
        const scoreB = b.sdr?.vocals ?? -999;
        return scoreB - scoreA;
      }
      if (sortBy === "inst_sdr") {
        const scoreA = a.sdr?.instrumental ?? -999;
        const scoreB = b.sdr?.instrumental ?? -999;
        return scoreB - scoreA;
      }
      if (sortBy === "size") {
        const sizeA = a.installedInfo?.size_bytes ?? 0;
        const sizeB = b.installedInfo?.size_bytes ?? 0;
        return sizeB - sizeA;
      }
      return 0;
    });
  }, [allDisplayModels, selectedTab, selectedArch, searchQuery, sortBy]);

  const handleDownload = async (filename: string) => {
    try {
      setDownloading((prev) => ({ ...prev, [filename]: "Starting download..." }));
      await invoke("download_ai_model", { filename });
    } catch (e) {
      alert(`Failed to trigger download: ${e}`);
      setDownloading((prev) => {
        const next = { ...prev };
        delete next[filename];
        return next;
      });
    }
  };

  const handleDelete = async (filename: string) => {
    if (!confirm(`Are you sure you want to delete model "${filename}" to free up disk space?`)) {
      return;
    }
    try {
      setDeletingFile(filename);
      await invoke("delete_ai_model", { filename });
      await loadInstalled();
    } catch (e) {
      alert(`Failed to delete model: ${e}`);
    } finally {
      setDeletingFile(null);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await invoke("open_models_directory");
    } catch (e) {
      console.error("Failed to open models folder:", e);
    }
  };

  const handleBrowseCustomFile = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "AI Models (*.onnx, *.pth, *.ckpt, *.yaml)", extensions: ["onnx", "pth", "ckpt", "yaml"] }],
      });
      if (selected && typeof selected === "string") {
        setCustomPath(selected);
        const fileName = selected.split(/[/\\]/).pop() || "";
        const baseName = fileName.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
        if (!customName) {
          setCustomName(baseName);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPath) {
      setImportError("Please select a model file.");
      return;
    }
    if (!customName.trim()) {
      setImportError("Please enter a model name.");
      return;
    }
    try {
      setIsImporting(true);
      setImportError("");
      const stems = customStemsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      await invoke("import_custom_model", {
        sourcePath: customPath,
        customName: customName.trim(),
        modelType: customArch,
        stems,
      });

      setIsImporterOpen(false);
      setCustomPath("");
      setCustomName("");
      setCustomStemsInput("Vocals, Instrumental");
      await loadInstalled();
    } catch (err: unknown) {
      setImportError(String(err));
    } finally {
      setIsImporting(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 MB";
    const mb = bytes / (1024 * 1024);
    if (mb < 1000) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  };

  const getArchBadge = (type: string) => {
    switch (type) {
      case "MDXC":
        return <Badge variant="secondary" className="bg-purple-500/15 text-purple-400 border-purple-500/30">Roformer (MDXC)</Badge>;
      case "MDX":
        return <Badge variant="secondary" className="bg-sky-500/15 text-sky-400 border-sky-500/30">MDX-Net</Badge>;
      case "Demucs":
        return <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">Demucs v4</Badge>;
      case "VR":
        return <Badge variant="secondary" className="bg-amber-500/15 text-amber-400 border-amber-500/30">VR Arch</Badge>;
      default:
        return <Badge variant="secondary" className="bg-pink-500/15 text-pink-400 border-pink-500/30">{type}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner & Stats */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-5 rounded-xl border bg-card/60 backdrop-blur-sm shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight">AI Model Store</h2>
            <Badge variant="outline" className="text-xs font-semibold uppercase tracking-wider text-primary border-primary/40 bg-primary/10">
              160+ Models
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Explore state-of-the-art AI models for vocal separation, karaoke, de-reverb, de-noise, and stems extraction.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleOpenFolder} title="Open local models folder in Explorer">
            <FolderOpen className="w-4 h-4 mr-1.5" />
            Models Folder
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setIsImporterOpen(true)}>
            <Upload className="w-4 h-4 mr-1.5" />
            Import Custom AI
          </Button>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={loadInstalled} disabled={isLoadingInstalled} title="Refresh installed status">
            <RefreshCw className={`w-4 h-4 ${isLoadingInstalled ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
            <Layers className="w-5 h-5" />
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{allDisplayModels.length}</div>
            <div className="text-xs text-muted-foreground">Catalog Models</div>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{installedModels.length}</div>
            <div className="text-xs text-muted-foreground">Installed Ready</div>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-sky-500/10 text-sky-400">
            <HardDrive className="w-5 h-5" />
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{totalInstalledSizeMB} MB</div>
            <div className="text-xs text-muted-foreground">Storage Used</div>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-400">
            <Cpu className="w-5 h-5" />
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">Roformer / UVR</div>
            <div className="text-xs text-muted-foreground">SOTA Engine</div>
          </div>
        </Card>
      </div>

      {/* Search, Filter & Tabs Bar */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 border-b pb-2">
          {[
            { id: "all", label: "All Models" },
            { id: "installed", label: `Installed (${installedModels.length})` },
            { id: "vocal-inst", label: "Vocals & Inst" },
            { id: "cleanup", label: "De-Reverb / De-Noise" },
            { id: "karaoke", label: "Karaoke" },
            { id: "multistem", label: "Multi-Stem (Demucs)" },
            { id: "custom", label: "Custom Imported" },
          ].map((tab) => (
            <Button
              key={tab.id}
              variant={selectedTab === tab.id ? "default" : "ghost"}
              size="sm"
              className="h-8 text-xs font-medium rounded-md"
              onClick={() => setSelectedTab(tab.id)}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by model name, architecture, stem, or filename..."
              className="pl-9 h-9 text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Select value={selectedArch} onValueChange={(val) => { if (val) setSelectedArch(val); }}>
              <SelectTrigger className="w-[150px] h-9 text-xs">
                <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5 opacity-70" />
                <SelectValue placeholder="Architecture" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Archs</SelectItem>
                <SelectItem value="MDXC">Roformer (MDXC)</SelectItem>
                <SelectItem value="MDX">MDX-Net</SelectItem>
                <SelectItem value="Demucs">Demucs v4</SelectItem>
                <SelectItem value="VR">VR Arch</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={(val) => { if (val) setSortBy(val); }}>
              <SelectTrigger className="w-[160px] h-9 text-xs">
                <SelectValue placeholder="Sort By" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recommended">Recommended First</SelectItem>
                <SelectItem value="name">Name (A-Z)</SelectItem>
                <SelectItem value="vocal_sdr">Highest Vocal SDR</SelectItem>
                <SelectItem value="inst_sdr">Highest Inst SDR</SelectItem>
                <SelectItem value="size">Disk Size</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Model Cards Grid */}
      {filteredModels.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <Info className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <h3 className="text-base font-semibold text-foreground">No models found</h3>
          <p className="text-sm mt-1">Try adjusting your search query or filters.</p>
          {(searchQuery || selectedTab !== "all" || selectedArch !== "all") && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                setSearchQuery("");
                setSelectedTab("all");
                setSelectedArch("all");
              }}
            >
              Reset Filters
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredModels.map((m) => {
            const isDownloading = !!downloading[m.filename];
            const downloadLog = downloading[m.filename];
            const isDeleting = deletingFile === m.filename;

            return (
              <Card
                key={m.filename}
                className={`flex flex-col justify-between transition-all duration-200 hover:shadow-md ${
                  m.isInstalled ? "border-primary/30 bg-primary/2" : "border-border/60"
                }`}
              >
                <CardHeader className="p-4 pb-2 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {getArchBadge(m.type)}
                      {m.is_recommended && (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px] font-semibold gap-1">
                          <Sparkles className="w-3 h-3" /> Top Pick
                        </Badge>
                      )}
                      {m.isCustom && (
                        <Badge variant="outline" className="bg-pink-500/10 text-pink-400 border-pink-500/30 text-[10px] font-semibold">
                          Custom
                        </Badge>
                      )}
                    </div>

                    {m.isInstalled && (
                      <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400 shrink-0">
                        <CheckCircle2 className="w-4 h-4" /> Ready
                      </span>
                    )}
                  </div>

                  <div>
                    <CardTitle className="text-base font-bold leading-snug line-clamp-1" title={m.name}>
                      {m.name}
                    </CardTitle>
                    <CardDescription className="text-xs font-mono text-muted-foreground truncate" title={m.filename}>
                      {m.filename}
                    </CardDescription>
                  </div>
                </CardHeader>

                <CardContent className="p-4 pt-1 space-y-3 flex-1 flex flex-col justify-between">
                  {/* Stem Tags & Quality Scores */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1">
                      {m.stems.map((s, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded-full bg-secondary/60 text-[11px] font-medium text-secondary-foreground"
                        >
                          {s}
                        </span>
                      ))}
                    </div>

                    {/* SDR Benchmark pills if available */}
                    {m.sdr && (m.sdr.vocals != null || m.sdr.instrumental != null) && (
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        {m.sdr.vocals != null && (
                          <span className="px-1.5 py-0.5 rounded bg-muted font-mono">
                            Vocals: <strong className="text-foreground">{m.sdr.vocals} dB</strong>
                          </span>
                        )}
                        {m.sdr.instrumental != null && (
                          <span className="px-1.5 py-0.5 rounded bg-muted font-mono">
                            Inst: <strong className="text-foreground">{m.sdr.instrumental} dB</strong>
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions & Status */}
                  <div className="pt-2 border-t space-y-2">
                    {/* Live Download Snippet */}
                    {isDownloading && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-primary animate-pulse">
                          <span className="flex items-center gap-1.5 font-medium">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Downloading model...
                          </span>
                        </div>
                        <div className="bg-muted/80 px-2.5 py-1.5 rounded text-[11px] font-mono text-muted-foreground truncate">
                          {downloadLog || "Fetching model weights..."}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-muted-foreground">
                        {m.isInstalled && m.installedInfo && (
                          <span>Size: {formatBytes(m.installedInfo.size_bytes)}</span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {m.isInstalled ? (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:bg-destructive/10"
                              onClick={() => handleDelete(m.filename)}
                              disabled={isDeleting}
                              title="Delete model to free space"
                            >
                              {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </Button>
                            <Button
                              size="sm"
                              className="h-8 text-xs font-semibold gap-1.5"
                              onClick={() => onSelectModelForExtraction?.(m.filename)}
                            >
                              Use Model <ArrowRight className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-8 text-xs font-semibold gap-1.5"
                            onClick={() => handleDownload(m.filename)}
                            disabled={isDownloading}
                          >
                            {isDownloading ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Downloading
                              </>
                            ) : (
                              <>
                                <Download className="w-3.5 h-3.5" /> Download
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Custom AI Importer Modal */}
      {isImporterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-lg shadow-2xl border-primary/30">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Upload className="w-5 h-5 text-primary" /> Import Custom AI Model
                </CardTitle>
                <button
                  onClick={() => setIsImporterOpen(false)}
                  className="rounded-md p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <CardDescription>
                Import external PyTorch, ONNX, or Demucs weights (.onnx, .pth, .ckpt, .yaml) into the audio-separator environment.
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleImportSubmit}>
              <CardContent className="space-y-4">
                {importError && (
                  <div className="p-3 rounded-md bg-destructive/10 text-destructive text-xs font-medium">
                    {importError}
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Model File</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={customPath}
                      placeholder="Select model file (.onnx, .pth, .ckpt, .yaml)..."
                      className="font-mono text-xs"
                    />
                    <Button type="button" variant="outline" onClick={handleBrowseCustomFile}>
                      Browse
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Display Name</Label>
                  <Input
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="e.g. My Custom Roformer Vocals"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Architecture Type</Label>
                    <Select value={customArch} onValueChange={(val) => { if (val) setCustomArch(val); }}>
                      <SelectTrigger>
                        <SelectValue placeholder="Architecture" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MDXC">Roformer (MDXC)</SelectItem>
                        <SelectItem value="MDX">MDX-Net</SelectItem>
                        <SelectItem value="Demucs">Demucs</SelectItem>
                        <SelectItem value="VR">VR Arch</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Output Stems (comma-separated)</Label>
                    <Input
                      value={customStemsInput}
                      onChange={(e) => setCustomStemsInput(e.target.value)}
                      placeholder="Vocals, Instrumental"
                    />
                  </div>
                </div>
              </CardContent>

              <div className="p-4 border-t flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setIsImporterOpen(false)} disabled={isImporting}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isImporting || !customPath || !customName.trim()}>
                  {isImporting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importing...
                    </>
                  ) : (
                    "Import Model"
                  )}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
