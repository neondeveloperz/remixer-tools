import * as React from "react"

import { NavDocuments } from "@/components/nav-documents"
import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { LayoutDashboardIcon, ListIcon, ChartBarIcon, FolderIcon, UsersIcon, CameraIcon, FileTextIcon, Settings2Icon, CircleHelpIcon, SearchIcon, DatabaseIcon, FileChartColumnIcon, FileIcon, CommandIcon, DownloadIcon, MusicIcon } from "lucide-react"

const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='24' fill='%23181f2a'/%3E%3Ccircle cx='48' cy='34' r='18' fill='%23f8fafc'/%3E%3Cpath d='M18 82c6-14 18-22 30-22s24 8 30 22' fill='%23f8fafc'/%3E%3C/svg%3E",
  },
  navMain: [
    {
      title: "Downloader",
      id: "downloader",
      icon: (
        <DownloadIcon />
      ),
    },
    {
      title: "STEM Extractor",
      id: "stem-extractor",
      icon: (
        <MusicIcon />
      ),
    }
  ],
  navSecondary: [
    {
      title: "Settings",
      id: "settings",
      icon: (
        <Settings2Icon
        />
      ),
    },
    {
      title: "Get Help",
      id: "help",
      icon: (
        <CircleHelpIcon
        />
      ),
    },
  ],
}

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  activePage?: string;
  onSelectPage?: (page: string) => void;
};

export function AppSidebar({ activePage, onSelectPage, ...props }: AppSidebarProps) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              render={<a href="#" />}
            >
              <CommandIcon className="size-5!" />
              <span className="text-base font-semibold">Remixer Tools</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} activeItem={activePage} onSelectItem={onSelectPage} />
        <NavSecondary items={data.navSecondary} activeItem={activePage} onSelectItem={onSelectPage} className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  )
}
