import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Help() {
  const [version, setVersion] = useState("0.4.0");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => { });
  }, []);

  return (
    <div className="space-y-6 mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Help & Documentation</CardTitle>
          <CardDescription>Learn how to use Remixer Tools and troubleshoot common issues.</CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion className="w-full">
            <AccordionItem value="item-1">
              <AccordionTrigger>How to use the Video Downloader?</AccordionTrigger>
              <AccordionContent className="space-y-2 text-muted-foreground">
                <p>1. Copy a video link from YouTube, Facebook, Twitter, or supported sites.</p>
                <p>2. Paste the link into the <strong>Video URL</strong> field.</p>
                <p>3. Select the <strong>Format</strong> (Video or Audio).</p>
                <p>4. Select your desired <strong>Quality</strong>.</p>
                <p>5. Click <strong>Download</strong>. The file will be saved to your default download directory.</p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-2">
              <AccordionTrigger>Where are my downloaded files saved?</AccordionTrigger>
              <AccordionContent className="space-y-2 text-muted-foreground">
                <p>By default, files are saved to your computer's <strong>Downloads</strong> folder.</p>
                <p>You can change this anytime by navigating to <strong>Settings</strong> from the sidebar and browsing for a new "Default Download Directory".</p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-3">
              <AccordionTrigger>How do I format the output filename?</AccordionTrigger>
              <AccordionContent className="space-y-2 text-muted-foreground">
                <p>In the <strong>Settings</strong> page, you can define a Filename Template. Here are some common variables you can use:</p>
                <ul className="list-disc pl-6 mt-2 space-y-1">
                  <li><code>%(title)s</code> : Video title</li>
                  <li><code>%(id)s</code> : Video ID</li>
                  <li><code>%(ext)s</code> : File extension (mp4, mp3)</li>
                  <li><code>%(uploader)s</code> : Channel or uploader name</li>
                  <li><code>%(resolution)s</code> : Video resolution (e.g., 1080p)</li>
                </ul>
                <p className="mt-2">Example: <code>%(uploader)s - %(title)s.%(ext)s</code></p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-4">
              <AccordionTrigger>The download is stuck or giving an error. What do I do?</AccordionTrigger>
              <AccordionContent className="space-y-2 text-muted-foreground">
                <p>Remixer Tools uses <strong>yt-dlp</strong> in the background. Sometimes, websites change their code, which breaks the downloader.</p>
                <p>Usually, simply restarting the app will trigger an automatic update for yt-dlp. If the issue persists, ensure you have a stable internet connection or try a different video link.</p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-5">
              <AccordionTrigger>What is STEM Extractor?</AccordionTrigger>
              <AccordionContent className="space-y-2 text-muted-foreground">
                <p>The STEM Extractor allows you to separate audio into individual tracks (vocals, drums, bass, instrumental, etc.) powered by state-of-the-art AI models, complete with a synchronized multi-track mixer.</p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About Remixer Tools</CardTitle>
          <CardDescription>Version {version}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Remixer Tools is a utility toolkit built with Tauri, React, and Tailwind CSS. It is designed to make downloading and processing media as seamless as possible.
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
