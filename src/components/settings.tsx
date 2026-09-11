import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FolderOpenIcon, RefreshCwIcon } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

export function Settings() {
  const [downloadDir, setDownloadDir] = useState<string>("");
  const [filenameTemplate, setFilenameTemplate] = useState<string>("%(title)s.%(ext)s");
  const [isSaving, setIsSaving] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string>("");
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

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

        <div className="space-y-2 border-t pt-4 mt-4">
          <Label>Updates</Label>
          <div className="flex items-center gap-4">
            <Button variant="secondary" onClick={checkForUpdates} disabled={isCheckingUpdate}>
              <RefreshCwIcon className={`mr-2 h-4 w-4 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
              {isCheckingUpdate ? "Checking..." : "Check for Updates"}
            </Button>
            {updateStatus && (
              <span className="text-sm font-medium text-muted-foreground">{updateStatus}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Check GitHub for new releases.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

