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
          <Accordion type="single" collapsible className="w-full">
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
                <p>By default, files are saved to your computer's <strong>Downloads</strong> folder. However, they are organized cleanly in <code>remixer-tools/library</code> and <code>remixer-tools/stems</code>.</p>
                <p>You can change this anytime by navigating to <strong>Settings</strong> from the sidebar and browsing for a new "Default Storage Location".</p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-3">
              <AccordionTrigger>How do I manage my past downloads & separated stems?</AccordionTrigger>
              <AccordionContent className="space-y-2 text-muted-foreground">
                <p>Navigate to the <strong>History & Library</strong> tab. This dashboard automatically catalogs all your downloaded media and AI-separated stems.</p>
                <p>From here, you can search, filter, delete files, or instantly load separated stems into the <strong>STEM Mixer Studio</strong> with a single click.</p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-4">
              <AccordionTrigger>What is STEM Extractor and the Model Store?</AccordionTrigger>
              <AccordionContent className="space-y-2 text-muted-foreground">
                <p>The <strong>STEM Extractor</strong> allows you to separate audio into individual tracks (vocals, drums, bass, instrumental, etc.) powered by state-of-the-art AI models like Demucs and MDX-Net.</p>
                <p>You can browse, download, and manage these AI models directly from the <strong>AI Model Store</strong> tab. Different models provide different separation targets (e.g. 4-stem, 6-stem) and quality levels.</p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-5">
              <AccordionTrigger>How do I update Remixer Tools to the latest version?</AccordionTrigger>
              <AccordionContent className="space-y-2 text-muted-foreground">
                <p>Remixer Tools features a <strong>Built-in Auto Updater</strong>. Every time you open the application, it will seamlessly check for a new release.</p>
                <p>If an update is available, a prompt will appear showing the release notes. Just click "Download & Install" and the app will handle the rest!</p>
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
            Remixer Tools is an advanced utility toolkit built with Tauri, React, and Tailwind CSS. It is designed to make downloading, processing, and AI-powered STEM separation as seamless as possible for DJs and producers.
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
