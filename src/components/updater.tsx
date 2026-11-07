import { useState, useEffect } from "react";
import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import { error as logError, info as logInfo } from "@tauri-apps/plugin-log";
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
import { AlertCircle, DownloadCloud, ExternalLink, Info } from "lucide-react";

const RELEASES_URL = "https://github.com/neondeveloperz/remixer-tools/releases";

/** Release page for a version; falls back to the list if the version string looks unexpected. */
function releasePageUrl(version: string): string {
  return /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(version)
    ? `${RELEASES_URL}/tag/v${version}`
    : `${RELEASES_URL}/latest`;
}

function describeUpdateError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/signature/i.test(raw)) {
    return "The update's signature could not be verified. This happens when updating from v1.3.1 or older, because the signing key changed in v1.3.3. Download and install this version manually once; later updates will install automatically.";
  }
  if (/network|connect|timed? ?out|dns|request/i.test(raw)) {
    return "The update could not be downloaded. Check your internet connection and try again, or download it manually.";
  }
  return "The update could not be installed automatically. You can download and install it manually instead.";
}

export function Updater() {
  const [updateAvailable, setUpdateAvailable] = useState<Update | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [isDownloadFinished, setIsDownloadFinished] = useState(false);
  const [contentLength, setContentLength] = useState<number | undefined>(undefined);
  const [downloaded, setDownloaded] = useState(0);

  const progress = isDownloadFinished
    ? 100
    : contentLength
      ? Math.min(100, Math.round((downloaded / contentLength) * 100))
      : 0;

  useEffect(() => {
    // Check for updates on startup
    const checkForUpdate = async () => {
      try {
        const update = await check();
        if (update) {
          void logInfo(`Update available: ${update.currentVersion} -> ${update.version}`);
          setUpdateAvailable(update);
        }
      } catch (err) {
        void logError(`Failed to check for updates: ${String(err)}`);
      }
    };

    // Delay check slightly to not slow down initial render
    const timer = setTimeout(checkForUpdate, 3000);
    return () => clearTimeout(timer);
  }, []);

  const handleUpdate = async () => {
    if (!updateAvailable) return;
    setIsUpdating(true);
    setInstallError(null);
    setIsDownloadFinished(false);
    setDownloaded(0);
    setContentLength(undefined);

    try {
      await updateAvailable.downloadAndInstall((event: DownloadEvent) => {
        switch (event.event) {
          case 'Started':
            setContentLength(event.data.contentLength);
            break;
          case 'Progress':
            setDownloaded((prev) => prev + event.data.chunkLength);
            break;
          case 'Finished':
            setIsDownloadFinished(true);
            break;
        }
      });

      // Once installed, restart the app
      await relaunch();
    } catch (err) {
      void logError(`Failed to install update ${updateAvailable.version}: ${String(err)}`);
      setIsUpdating(false);
      setInstallError(describeUpdateError(err));
    }
  };

  const openReleasePage = async () => {
    if (!updateAvailable) return;
    try {
      await openUrl(releasePageUrl(updateAvailable.version));
    } catch (err) {
      void logError(`Failed to open release page: ${String(err)}`);
    }
  };

  if (!updateAvailable) return null;

  return (
    <Dialog
      open={!!updateAvailable}
      onOpenChange={(open) => { if (!open && !isUpdating) setUpdateAvailable(null); }}
    >
      <DialogContent className="sm:max-w-[425px]" showCloseButton={!isUpdating}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DownloadCloud className="w-5 h-5 text-primary" />
            Update Available
          </DialogTitle>
          <DialogDescription>
            A new version of Remixer Tools (v{updateAvailable.version}) is available.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-3">
          {isUpdating ? (
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
          ) : (
            <>
              {installError && (
                <div className="bg-destructive/10 p-3 rounded-md text-sm border border-destructive/30">
                  <h4 className="font-semibold mb-1 flex items-center gap-1.5 text-destructive">
                    <AlertCircle className="w-4 h-4" />
                    Update failed
                  </h4>
                  <p className="text-muted-foreground">{installError}</p>
                </div>
              )}
              <div className="bg-muted p-3 rounded-md text-sm border">
                <h4 className="font-semibold mb-1 flex items-center gap-1.5">
                  <Info className="w-4 h-4 text-primary" />
                  Release Notes:
                </h4>
                <p className="whitespace-pre-wrap text-muted-foreground max-h-48 overflow-y-auto">
                  {updateAvailable.body || "No release notes provided."}
                </p>
              </div>
            </>
          )}
        </div>

        {!isUpdating && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateAvailable(null)}>
              Skip for now
            </Button>
            {installError ? (
              <>
                <Button variant="outline" onClick={handleUpdate}>
                  Try Again
                </Button>
                <Button onClick={openReleasePage}>
                  <ExternalLink className="w-4 h-4 mr-1.5" />
                  Download Manually
                </Button>
              </>
            ) : (
              <Button onClick={handleUpdate}>
                Download & Install
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
