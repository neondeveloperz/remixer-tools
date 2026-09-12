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

export default function App() {
  const [activePage, setActivePage] = useState("downloader")
  const [isReady, setIsReady] = useState(false)

  const renderContent = () => {
    switch (activePage) {
      case "downloader":
        return <YtDlp />
      case "stem-extractor":
        return <StemExtractor />
      case "settings":
        return <Settings />
      case "help":
        return <Help />
      default:
        return <YtDlp />
    }
  }
  
  const getPageTitle = () => {
    switch (activePage) {
      case "downloader": return "Video Downloader"
      case "stem-extractor": return "STEM Extractor"
      case "settings": return "Settings"
      case "help": return "Help & Documentation"
      default: return "Remixer Tools"
    }
  }

  return (
    <TooltipProvider>
      {!isReady && <DependencyCheck onComplete={() => setIsReady(true)} />}
      <SidebarProvider
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 72)",
            "--header-height": "calc(var(--spacing) * 12)",
          } as CSSProperties
        }
      >
        <AppSidebar variant="inset" activePage={activePage} onSelectPage={setActivePage} />
        <SidebarInset>
          <SiteHeader title={getPageTitle()} />
          <div className="flex flex-1 flex-col">
            <div className="@container/main flex flex-1 flex-col gap-2">
              <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
                <div className="px-4 lg:px-6">
                  {renderContent()}
                </div>
              </div>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
