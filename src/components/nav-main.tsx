import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"

export function NavMain({
  items,
  activeItem,
  onSelectItem,
  label,
}: {
  items: {
    title: string
    id: string
    icon?: React.ReactNode
    badge?: string
  }[]
  activeItem?: string
  onSelectItem?: (id: string) => void
  label?: string
}) {
  return (
    <SidebarGroup>
      {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton 
                tooltip={item.title} 
                isActive={activeItem === item.id}
                onClick={() => onSelectItem?.(item.id)}
              >
                {item.icon}
                <span className="truncate">{item.title}</span>
                {item.badge && (
                  <Badge
                    variant="outline"
                    className="ml-auto text-[9px] h-4 px-1.5 py-0 font-bold uppercase tracking-wider text-amber-500 border-amber-500/40 bg-amber-500/10 shrink-0"
                  >
                    {item.badge}
                  </Badge>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
