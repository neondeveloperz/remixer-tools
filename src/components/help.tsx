import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { appLogDir } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Copy, FolderOpen, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Help() {
  const [version, setVersion] = useState("0.4.0");
  const [logDir, setLogDir] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => { });
    appLogDir().then(setLogDir).catch(() => { });
  }, []);

  const openLogFolder = async () => {
    try {
      await invoke("open_path", { path: logDir });
    } catch (e) {
      toast.error("Could not open the log folder", { description: String(e) });
    }
  };

  const copyLogPath = async () => {
    try {
      await navigator.clipboard.writeText(logDir);
      toast.success("Log folder path copied");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <div className="space-y-6 mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Help &amp; Documentation</CardTitle>
          <CardDescription>Learn how to use Remixer Tools and troubleshoot common issues.</CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion className="w-full">
            <AccordionItem value="downloader">
              <AccordionTrigger>How do I download music or video?</AccordionTrigger>
              <AccordionContent className="space-y-2 text-muted-foreground">
                <p>1. Open <strong>Downloader</strong> and paste a link from YouTube, SoundCloud, Facebook, X/Twitter, or any other site yt-dlp supports.</p>
                <p>2. Pick a <strong>Format</strong>: lossless audio (WAV, FLAC, ALAC, AIFF), compressed audio (MP3, M4A, Opus, Ogg, AAC), or video.</p>
                <p>3. Pick a <strong>Quality</strong> and click <strong>Download</strong>.</p>
                <p><strong>Playlists:</strong> paste a YouTube playlist or SoundCloud set link. Choose the tracks you want and they are downloaded as a batch queue. Set how many downloads run at once in <strong>Settings → Downloader Defaults</strong>.</p>
                <p><strong>BPM &amp; Key:</strong> with <strong>Automatic BPM &amp; Musical Key Analysis</strong> enabled in Settings, the tempo and key are added to the file's tags and filename.</p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="storage">
              <AccordionTrigger>Where are my files saved?</AccordionTrigger>
              <AccordionContent className="space-y-2 text-muted-foreground">
                <p>Everything is kept in one base folder (default: <code>Downloads/remixer-tools</code>), split into <code>library</code> (downloads), <code>stems</code> (one folder per song), and <code>midi</code>.</p>
                <p>Change the base folder or open any sub-folder from <strong>Settings → Storage &amp; Appearance</strong>.</p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="stems">
              <AccordionTrigger>How do I separate a song into stems?</AccordionTrigger>
              <AccordionContent className="space-y-2 text-muted-foreground">
                <p>Open <strong>STEM Extractor</strong>, drop in an audio file (or pick one from <strong>History &amp; Library</strong>), choose a model, and start the extraction. The first run sets up the AI environment, which downloads a few GB and can take a while.</p>
                <p>Get more models (Demucs 4/6-stem, MDX-Net, RoFormer vocal models, and more) from the <strong>Model Store</strong>, or import your own PyTorch/ONNX model there.</p>
                <p><strong>Speed:</strong> NVIDIA GPUs (CUDA) and Apple Silicon are accelerated when <strong>Hardware / GPU Acceleration</strong> is on. AMD and Intel graphics, including on-board GPUs, run on the CPU: it works, but expect several minutes per song. If you run out of memory, enable <strong>Low VRAM Memory Mode</strong>.</p>
                <p>If extraction keeps failing, use <strong>Repair</strong> next to STEM Extractor in <strong>Settings → Storage &amp; Appearance</strong> to reinstall the environment.</p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="mixer">
              <AccordionTrigger>How do I play separated stems together?</AccordionTrigger>
              <AccordionContent className="space-y-2 text-muted-foreground">
                <p>In <strong>History &amp; Library</strong>, click <strong>Play in DAW Mixer</strong> on a song, or open <strong>STEM Mixer</strong> directly. Each stem gets its own volume, mute, and solo controls, all kept in sync.</p>
                <p>To use stems in your own DAW (Ableton, FL Studio, Logic, Reaper…), drag the files from the song's <code>stems</code> folder into your project. They all start at 0:00 and have the same length, so they line up automatically.</p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="midi">
              <AccordionTrigger>How do I convert audio to MIDI?</AccordionTrigger>
              <AccordionContent className="space-y-2 text-muted-foreground">
                <p>Open <strong>MIDI Extractor</strong>, choose an audio file, and convert. Isolated stems (bass, piano, vocals) give much cleaner MIDI than a full mix, so separate the song first.</p>
                <p><strong>Frequency Preset:</strong> match it to the instrument. <strong>Piano Solo</strong> also removes pedal resonance and overtone ghost notes.</p>
                <p><strong>Detection Sensitivity:</strong> <em>Balanced</em> suits most material. Too many stray notes? Use <em>Clean</em>. Quiet notes missing? Use <em>High</em>.</p>
                <p><strong>BPM / Tempo</strong> is detected automatically. Type it in if you already know it, so <strong>Beat Grid Snapping</strong> lines notes up with your project.</p>
                <p>Preview the result in the built-in <strong>Piano Roll</strong>, then drag the <code>.mid</code> file into your DAW. If a warning says the fallback engine was used, Basic Pitch could not be installed and the result is single-voice (monophonic). Send us the log file below.</p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="tools">
              <AccordionTrigger>Downloads suddenly fail. What should I do?</AccordionTrigger>
              <AccordionContent className="space-y-2 text-muted-foreground">
                <p>Sites change often, so update the downloader first: <strong>Settings → Storage &amp; Appearance → Media Tools → yt-dlp → Check &amp; Update</strong>. It checks GitHub and installs the newest version automatically.</p>
                <p>In the same section you can switch <strong>FFmpeg</strong> to another version if a format or conversion misbehaves. Do this while nothing is downloading or extracting.</p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="install-warning">
              <AccordionTrigger>Windows or macOS warns that the app is unsafe</AccordionTrigger>
              <AccordionContent className="space-y-2 text-muted-foreground">
                <p>Remixer Tools is not code-signed yet, so the system shows a warning the first time you run it.</p>
                <p><strong>Windows (SmartScreen):</strong> click <strong>More info</strong>, then <strong>Run anyway</strong>.</p>
                <p><strong>macOS:</strong> right-click the app, choose <strong>Open</strong>, then confirm <strong>Open</strong>.</p>
                <p>Only download Remixer Tools from the official GitHub Releases page.</p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="updates">
              <AccordionTrigger>How do I update Remixer Tools?</AccordionTrigger>
              <AccordionContent className="space-y-2 text-muted-foreground">
                <p>The app checks for a new release every time it starts, and you can check manually under <strong>Settings → Storage &amp; Appearance → Application Updates</strong>. When an update is found, click <strong>Download &amp; Install</strong> and the app restarts itself.</p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="window">
              <AccordionTrigger>I opened the app again but no new window appeared</AccordionTrigger>
              <AccordionContent className="space-y-2 text-muted-foreground">
                <p>Only one copy of Remixer Tools can run at a time, so two copies never write to the same files at once. Opening it again brings the existing window to the front.</p>
                <p>The app remembers its window size and position. If the saved position is no longer visible, for example after you unplug a monitor, the window is moved back to the main screen automatically.</p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Troubleshooting &amp; Logs</CardTitle>
          <CardDescription>
            Something not working or a button does nothing? Send us the log file so we can see what went wrong.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="list-decimal pl-5 space-y-1 text-sm text-muted-foreground">
            <li>Click <strong>Open Log Folder</strong>.</li>
            <li>Attach <code>Remixer Tools.log</code> to your bug report, together with what you clicked and what you expected.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={openLogFolder} disabled={!logDir}>
              <FolderOpen className="mr-2 h-4 w-4" />
              Open Log Folder
            </Button>
            <Button variant="outline" size="sm" onClick={copyLogPath} disabled={!logDir}>
              <Copy className="mr-2 h-4 w-4" />
              Copy Path
            </Button>
          </div>
          {logDir && (
            <p className="text-[11px] font-mono text-muted-foreground break-all select-all">{logDir}</p>
          )}
          <p className="text-xs text-muted-foreground">
            If the app is frozen, open this folder from File Explorer instead. The log contains file names and folder paths from your computer; review it before sharing publicly.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About Remixer Tools</CardTitle>
          <CardDescription>Version {version}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Remixer Tools is a desktop toolkit for DJs and producers: download audio, split songs into stems with AI, convert audio to MIDI, and detect BPM &amp; key, all in one app.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => window.open("https://github.com/yt-dlp/yt-dlp", "_blank")}>
              <Globe className="mr-2 h-4 w-4" />
              Powered by yt-dlp
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.open("https://ffmpeg.org/", "_blank")}>
              <Globe className="mr-2 h-4 w-4" />
              Powered by FFmpeg
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.open("https://github.com/nomadkaraoke/python-audio-separator", "_blank")}>
              <Globe className="mr-2 h-4 w-4" />
              Audio Separator
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.open("https://github.com/adefossez/demucs", "_blank")}>
              <Globe className="mr-2 h-4 w-4" />
              Demucs AI
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.open("https://github.com/spotify/basic-pitch", "_blank")}>
              <Globe className="mr-2 h-4 w-4" />
              Basic Pitch (MIDI)
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
