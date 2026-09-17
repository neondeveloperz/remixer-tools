import { useState, useEffect } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DownloadCloud, Info } from "lucide-react";

export function Updater() {
  const [updateAvailable, setUpdateAvailable] = useState<any>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [contentLength, setContentLength] = useState<number | undefined>(undefined);
  const [downloaded, setDownloaded] = useState(0);

  useEffect(() => {
    // Check for updates on startup
    const checkForUpdate = async () => {
      try {
        const update = await check();
        if (update?.available) {
          console.log(`Update available: ${update.version}`);
          setUpdateAvailable(update);
        }
      } catch (error) {
        console.error("Failed to check for updates:", error);
      }
    };
    
    // Delay check slightly to not slow down initial render
    const timer = setTimeout(checkForUpdate, 3000);
    return () => clearTimeout(timer);
  }, []);

  const handleUpdate = async () => {
    if (!updateAvailable) return;
    setIsUpdating(true);

    try {
      await updateAvailable.downloadAndInstall((event: any) => {
        switch (event.event) {
          case 'Started':
            setContentLength(event.data.contentLength);
            break;
          case 'Progress':
            setDownloaded((prev) => prev + event.data.chunkLength);
            break;
          case 'Finished':
            setProgress(100);
            break;
        }
      });
      
      // Once installed, restart the app
      await relaunch();
    } catch (error) {
      console.error("Failed to install update:", error);
      setIsUpdating(false);
      alert("Failed to install update. Please try again later.");
    }
  };

  // Calculate percentage
  useEffect(() => {
    if (contentLength && downloaded) {
      const percentage = Math.round((downloaded / contentLength) * 100);
      setProgress(percentage > 100 ? 100 : percentage);
    }
  }, [downloaded, contentLength]);

  if (!updateAvailable) return null;

  return (
    <Dialog open={!!updateAvailable} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DownloadCloud className="w-5 h-5 text-primary" />
            Update Available
          </DialogTitle>
          <DialogDescription>
            A new version of Remixer Tools (v{updateAvailable.version}) is available.
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4">
          {!isUpdating ? (
            <div className="bg-muted p-3 rounded-md text-sm border">
              <h4 className="font-semibold mb-1 flex items-center gap-1.5">
                <Info className="w-4 h-4 text-primary" />
                Release Notes:
              </h4>
              <p className="whitespace-pre-wrap text-muted-foreground max-h-32 overflow-y-auto">
                {updateAvailable.body || "No release notes provided."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Downloading update...</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
              <div className="text-xs text-muted-foreground text-center">
                Please do not close the application.
              </div>
            </div>
          )}
        </div>

        {!isUpdating && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateAvailable(null)}>
              Skip for now
            </Button>
            <Button onClick={handleUpdate}>
              Download & Install
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
