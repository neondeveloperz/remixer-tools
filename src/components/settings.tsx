import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FolderOpenIcon, RefreshCwIcon, Sun, Moon } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTheme } from "@/components/theme-provider";

export function Settings() {
  const { theme, setTheme } = useTheme();
  const [downloadDir, setDownloadDir] = useState<string>("");
  const [filenameTemplate, setFilenameTemplate] = useState<string>("%(title)s.%(ext)s");
  const [isSaving, setIsSaving] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string>("");
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await invoke<{ download_dir: string, filename_template: string | null }>("get_settings");
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
    <Card className="w-full mx-auto">
      <CardHeader>
        <CardTitle>Settings</CardTitle>
        <CardDescription>Configure global preferences for Remixer Tools.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Label htmlFor="download-dir">Remixer Tools Base Directory</Label>
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
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs shrink-0"
                onClick={() => invoke("open_storage_folder", { folderType: "extractor" })}
              >
                <FolderOpenIcon className="h-3.5 w-3.5 mr-1" />
                Open
              </Button>
            </div>
          </div>
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

        <div className="space-y-3 border-t pt-4 mt-4">
          <Label>Appearance</Label>
          <div className="grid grid-cols-2 gap-3">
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

