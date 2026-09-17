import { usePlayer, type TrackInfo } from "@/contexts/PlayerContext";
import { DawTrackMixer } from "@/components/daw-track-mixer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sliders, Music, Sparkles, FolderArchive, Plus } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { extractStemName } from "@/lib/utils";

interface StemMixerPageProps {
  onNavigateToExtractor?: () => void;
  onNavigateToLibrary?: () => void;
}

export function StemMixerPage({ onNavigateToExtractor, onNavigateToLibrary }: StemMixerPageProps) {
  const player = usePlayer();

  const handleImportStems = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        filters: [{ name: "Audio", extensions: ["mp3", "wav", "flac", "ogg", "m4a"] }],
      });

      if (selected && Array.isArray(selected) && selected.length > 0) {
        const tracks: TrackInfo[] = selected.map((path) => {
          const parts = path.split(/[/\\]/);
          const filename = parts[parts.length - 1];
          const stemName = extractStemName(filename);
          return { name: stemName, path };
        });
        player.loadTracks(tracks);
      }
    } catch (e) {
      console.error("Failed to import stems:", e);
    }
  };

  const hasTracks = player.tracks && player.tracks.length > 0;

  return (
    <div className="flex flex-col gap-6 mx-auto pb-10">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center border border-primary/20">
              <Sliders className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">STEM Mixer Studio</h2>
              <p className="text-xs text-muted-foreground">
                Hardware-synchronized multi-track audio playback with real waveform visualization.
              </p>
            </div>
          </div>
        </div>

        {/* Quick Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleImportStems}
            className="gap-1.5 text-xs border-border/80 hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" /> Import Stems
          </Button>

          {onNavigateToExtractor && (
            <Button
              variant="outline"
              size="sm"
              onClick={onNavigateToExtractor}
              className="gap-1.5 text-xs border-border/80 hover:bg-muted"
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" /> STEM Extractor
            </Button>
          )}
          {onNavigateToLibrary && (
            <Button
              variant="outline"
              size="sm"
              onClick={onNavigateToLibrary}
              className="gap-1.5 text-xs border-border/80 hover:bg-muted"
            >
              <FolderArchive className="h-3.5 w-3.5" /> Library
            </Button>
          )}
        </div>
      </div>

      {/* Main Content: Mixer or Empty State */}
      {hasTracks ? (
        <div className="space-y-4">
          <DawTrackMixer
            tracks={player.tracks}
            onOpenFolder={async () => {
              const firstTrack = player.tracks[0];
              if (firstTrack?.path && !firstTrack.isUrl) {
                const dir = firstTrack.path.replace(/[/\\][^/\\]+$/, "");
                try {
                  await invoke("open_path", { path: dir });
                  return;
                } catch (e) {
                  console.warn("Failed to open dir via open_path:", e);
                }
              }
              try {
                await invoke("open_storage_folder", { folderType: "stems" });
              } catch (e) {
                console.error("Failed to open stems storage folder:", e);
              }
            }}
          />
        </div>
      ) : (
        <Card className="border border-border/60 bg-card/60 backdrop-blur shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="h-16 w-16 rounded-2xl bg-muted/60 flex items-center justify-center text-muted-foreground mb-4 border border-border/40">
              <Sliders className="h-8 w-8 text-primary/70" />
            </div>
            <h3 className="text-lg font-bold">No Stems Loaded in Mixer</h3>
            <p className="text-sm text-muted-foreground max-w-md mt-1 mb-6">
              Extract vocal and instrument stems from any audio file using AI, or import separated stem files directly into the studio.
            </p>

            <div className="flex items-center gap-3 flex-wrap justify-center">
              {onNavigateToExtractor && (
                <Button onClick={onNavigateToExtractor} className="gap-2 font-semibold shadow-md">
                  <Sparkles className="h-4 w-4" /> Extract Stems with AI
                </Button>
              )}
              <Button variant="outline" onClick={handleImportStems} className="gap-2">
                <Music className="h-4 w-4" /> Import Stems from Files
              </Button>
              {onNavigateToLibrary && (
                <Button variant="ghost" onClick={onNavigateToLibrary} className="gap-2 text-muted-foreground">
                  <FolderArchive className="h-4 w-4" /> Browse Library
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
