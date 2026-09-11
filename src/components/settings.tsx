import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FolderOpenIcon } from "lucide-react";

export function Settings() {
  const [downloadDir, setDownloadDir] = useState<string>("");
  const [filenameTemplate, setFilenameTemplate] = useState<string>("%(title)s.%(ext)s");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await invoke<{download_dir: string, filename_template: string | null}>("get_settings");
        setDownloadDir(settings.download_dir);
        if (settings.filename_template) {
          setFilenameTemplate(settings.filename_template);
        }
      } catch (e) {
        console.error("Failed to load settings:", e);
      }
    };
    loadSettings();
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
      }
    } catch (e) {
      console.error("Failed to select directory:", e);
    }
  };

  const saveFilenameTemplate = async () => {
    setIsSaving(true);
    try {
      await invoke("set_filename_template", { template: filenameTemplate });
    } catch (e) {
      console.error("Failed to save filename template", e);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Settings</CardTitle>
        <CardDescription>Configure global preferences for Remixer Tools.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="download-dir">Default Download Directory</Label>
          <div className="flex gap-2">
            <Input 
              id="download-dir" 
              readOnly 
              value={downloadDir || "Default (Downloads folder)"} 
              className="font-mono text-sm text-muted-foreground"
            />
            <Button variant="outline" onClick={selectDirectory}>
              <FolderOpenIcon className="mr-2 h-4 w-4" />
              Browse
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            All videos and audio files will be saved to this directory.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="filename-template">Filename Template</Label>
          <div className="flex gap-2">
            <Input 
              id="filename-template" 
              value={filenameTemplate} 
              onChange={(e) => setFilenameTemplate(e.target.value)}
              placeholder="%(title)s.%(ext)s"
              className="font-mono text-sm"
            />
            <Button onClick={saveFilenameTemplate} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Variables: <code>%(title)s</code>, <code>%(id)s</code>, <code>%(ext)s</code>, <code>%(uploader)s</code>, <code>%(resolution)s</code>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

