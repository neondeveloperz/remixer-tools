import { useState } from "react"
import type { CSSProperties } from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { YtDlp } from "@/components/yt-dlp"
import { Settings } from "@/components/settings"
import { DependencyCheck } from "@/components/dependency-check"
import { Help } from "@/components/help"
import { StemExtractor } from "@/components/stem-extractor"
import { ModelStore } from "@/components/model-store"
import { LibraryDashboard } from "@/components/library-dashboard"
import { StemMixerPage } from "@/components/stem-mixer-page"
import { PlayerProvider, usePlayer } from "@/contexts/PlayerContext"
import { StemPlayer } from "@/components/stem-player"

function AppContent() {
  const { isVisible } = usePlayer()
  const [activePage, setActivePage] = useState("downloader")
  const [isReady, setIsReady] = useState(false)

  const [selectedModel, setSelectedModel] = useState("htdemucs.yaml")
  const [extractorInputFile, setExtractorInputFile] = useState("")

  const handleSelectPage = (page: string) => {
    setActivePage(page);
  }

  const handleSelectModelForExtraction = (modelFilename: string) => {
    setSelectedModel(modelFilename);
    setActivePage("stem-extractor");
  }

  const handleSendToExtractor = (filePath: string) => {
    setExtractorInputFile(filePath);
    setActivePage("stem-extractor");
  }

  const getPageTitle = () => {
    switch (activePage) {
      case "downloader": return "Downloader"
      case "stem-extractor": return "STEM Extractor"
      case "stem-mixer": return "STEM Mixer Studio"
      case "library": return "History & Library"
      case "model-store": return "AI Model Store"
      case "settings": return "Settings"
      case "help": return "Help & Documentation"
      default: return "Remixer Tools"
    }
  }

  return (
    <TooltipProvider>
      {!isReady && <DependencyCheck onComplete={() => setIsReady(true)} />}
      <SidebarProvider
        className="transition-all duration-300"
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 72)",
            "--header-height": "calc(var(--spacing) * 12)",
          } as CSSProperties
        }
      >
        <AppSidebar variant="inset" activePage={activePage} onSelectPage={handleSelectPage} />
        <SidebarInset>
          <SiteHeader title={getPageTitle()} />
          <div className="flex flex-1 flex-col">
            <div className="@container/main flex flex-1 flex-col gap-2">
              <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
                <div className="px-4 lg:px-6 relative min-h-[500px]">
                  <div className={activePage === "downloader" ? "block" : "hidden"}>
                    <YtDlp />
                  </div>
                  <div className={activePage === "stem-extractor" ? "block" : "hidden"}>
                    <StemExtractor
                      selectedModel={selectedModel}
                      onModelChange={setSelectedModel}
                      onNavigateToModelStore={() => setActivePage("model-store")}
                      initialInputFile={extractorInputFile}
                      onExtractionComplete={() => setActivePage("stem-mixer")}
                    />
                  </div>
                  <div className={activePage === "stem-mixer" ? "block" : "hidden"}>
                    <StemMixerPage
                      onNavigateToExtractor={() => setActivePage("stem-extractor")}
                      onNavigateToLibrary={() => setActivePage("library")}
                    />
                  </div>
                  <div className={activePage === "library" ? "block" : "hidden"}>
                    <LibraryDashboard
                      isActive={activePage === "library"}
                      onSendToExtractor={handleSendToExtractor}
                      onNavigateToDownloader={() => setActivePage("downloader")}
                      onNavigateToMixer={() => setActivePage("stem-mixer")}
                    />
                  </div>
                  <div className={activePage === "model-store" ? "block" : "hidden"}>
                    <ModelStore onSelectModelForExtraction={handleSelectModelForExtraction} />
                  </div>
                  <div className={activePage === "settings" ? "block" : "hidden"}>
                    <Settings />
                  </div>
                  <div className={activePage === "help" ? "block" : "hidden"}>
                    <Help />
                  </div>
                </div>
              </div>
            </div>
          </div>
          {isVisible && <div className="h-24 shrink-0" />}
        </SidebarInset>
      </SidebarProvider>
      <StemPlayer />
    </TooltipProvider>
  )
}

export default function App() {
  return (
    <PlayerProvider>
      <AppContent />
    </PlayerProvider>
  )
}
