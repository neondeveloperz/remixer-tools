import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function DependencyCheck({ onComplete }: { onComplete: () => void }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: () => void;

    const setup = async () => {
      try {
        const unlistenFn = await listen<string>("setup-log", (event) => {
          setLogs((prev) => [...prev, event.payload]);
        });
        unlisten = unlistenFn;

        await invoke("setup_dependencies");
        setIsDone(true);
        onComplete();
      } catch (e) {
        console.error("Setup failed:", e);
        setError(String(e));
      }
    };

    setup();

    return () => {
      if (unlisten) unlisten();
    };
  }, [onComplete]);

  if (isDone) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg border-primary/20">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-xl flex items-center justify-center gap-2">
            {!error && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
            {error ? "Setup Failed" : "Setting up dependencies..."}
          </CardTitle>
          <CardDescription>
            Checking yt-dlp and ffmpeg
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="text-destructive text-sm text-center p-2 bg-destructive/10 rounded-md">
              {error}
            </div>
          ) : (
            <div className="bg-muted p-3 rounded-md h-32 overflow-y-auto font-mono text-xs flex flex-col justify-end">
              {logs.map((log, i) => (
                <div key={i} className="text-muted-foreground">{log}</div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

