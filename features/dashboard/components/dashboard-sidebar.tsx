"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Code2,
  Compass,
  FolderPlus,
  History,
  Home,
  LayoutDashboard,
  Lightbulb,
  type LucideIcon,
  Plus,
  Settings,
  Star,
  Terminal,
  Zap,
  Database,
  FlameIcon,
  Globe,
  Coffee,
  Sparkles,
  Server,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarGroupAction,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import Image from "next/image"

// Define the interface for a single playground item, icon is now a string
interface PlaygroundData {
  id: string
  name: string
  icon: string // Changed to string
  starred: boolean
}

// Map icon names (strings) to their corresponding LucideIcon components
const lucideIconMap: Record<string, LucideIcon> = {
  Zap: Zap,
  Lightbulb: Lightbulb,
  Database: Database,
  Compass: Compass,
  FlameIcon: FlameIcon,
  Terminal: Terminal,
  Code2: Code2, // Include the default icon
}

function NextIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 16V8l6.5 8V8" />
    </svg>
  )
}

function PythonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M11.5 3H9c-2.2 0-3.5 1.2-3.5 3.2V8.5h5.2V9.8H6.2C4 9.8 3 11.2 3 13.5S4.2 17 6.5 17H8v-2.2c0-1.3.9-2.3 2.2-2.3h4.3c1.8 0 3-1 3-2.8V6.2C17.5 4.2 16.2 3 14.2 3h-2.7Z" />
      <path d="M12.5 21H15c2.2 0 3.5-1.2 3.5-3.2V15.5h-5.2V14.2h5.5c2.2 0 3.2-1.4 3.2-3.7S20.8 7 18.5 7H17v2.2c0 1.3-.9 2.3-2.2 2.3H10.5c-1.8 0-3 1-3 2.8v3.5c0 2 1.3 3.2 3.3 3.2h1.7Z" />
      <circle cx="9.2" cy="6.2" r=".6" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="17.8" r=".6" fill="currentColor" stroke="none" />
    </svg>
  )
}

type RecentIcon = LucideIcon | ((props: { className?: string }) => React.ReactElement)

const recentTechnologyIcons: Record<string, RecentIcon> = {
  ZAP: Zap,
  BULB: NextIcon,
  TERMINAL: Terminal,
  COMPASS: Compass,
  DATABASE: Globe,
  FLAMEICON: FlameIcon,
  ASTRO: Sparkles,
  GLOBE: Globe,
  SERVER: Server,
  COFFEE: Coffee,
}

function recentProjectIcon(icon: string, name: string): RecentIcon {
  const fromTemplate = recentTechnologyIcons[icon]
  if (fromTemplate) return fromTemplate

  const value = name.toLowerCase()
  if (value.includes("next")) return NextIcon
  if (value.includes("react")) return Zap
  if (value.includes("express") || value.includes("node") || value.includes("api")) return Globe
  if (value.includes("python") || value.includes("django") || value.includes("flask")) return PythonIcon
  if (/java(?!script)/.test(value)) return Coffee
  if (value.includes("angular")) return Terminal
  if (value.includes("vue")) return Compass
  if (value.includes("hono")) return FlameIcon
  if (value.includes("astro")) return Sparkles
  return Code2
}

export function DashboardSidebar({ initialPlaygroundData }: { initialPlaygroundData: PlaygroundData[] }) {
  const pathname = usePathname()
  const [starredPlaygrounds, setStarredPlaygrounds] = useState(initialPlaygroundData.filter((p) => p.starred))
  const [recentPlaygrounds, setRecentPlaygrounds] = useState(initialPlaygroundData)

  return (
    <Sidebar variant="inset" collapsible="icon" className="border-1 border-r">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-4 py-3 justify-center">
          <Image src={"/logoo.svg"} alt="logo" height={60} width={60} />
        </div>
       
      </SidebarHeader>
      <SidebarContent>
            <SidebarGroup>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton isActive={pathname === "/"} tooltip="Home">
                            <Link href="/" className="flex w-full items-center gap-2">
                                <Home className="h-4 w-4 shrink-0" />
                                <span>Home</span>
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>

<SidebarMenuItem>
    <SidebarMenuButton
        isActive={pathname === "/dashboard"}
                tooltip="Dashboard"
    >
    <Link
      href="/dashboard"
      className="flex w-full items-center gap-2"
    >
      <LayoutDashboard className="h-4 w-4 shrink-0" />
      <span>Dashboard</span>
    </Link>
  </SidebarMenuButton>
</SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>
            <Star className="h-4 w-4 mr-2" />
            Starred
          </SidebarGroupLabel>
          <SidebarGroupAction title="Add starred playground">
            <Plus className="h-4 w-4" />
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>

              {starredPlaygrounds.length === 0 && recentPlaygrounds.length === 0 ? (
                <div className="text-center text-muted-foreground py-4 w-full">Create your playground</div>
              ) : (
                starredPlaygrounds.map((playground) => {
                  const IconComponent = lucideIconMap[playground.icon] || Code2;
                  return (
                    <SidebarMenuItem key={playground.id}>
                      <SidebarMenuButton
            
                        isActive={pathname === `/playground/${playground.id}`}
                        tooltip={playground.name}
                      >
                        <Link href={`/playground/${playground.id}`}>
                          {IconComponent && <IconComponent className="h-4 w-4" />}
                          <span>{playground.name}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>
            <History className="h-4 w-4 mr-2" />
            Recent
          </SidebarGroupLabel>
          <SidebarGroupAction title="Create new playground">
            <FolderPlus className="h-4 w-4" />
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {starredPlaygrounds.length === 0 && recentPlaygrounds.length === 0 ? null : (
                recentPlaygrounds.map((playground) => {
                  const IconComponent = recentProjectIcon(playground.icon, playground.name);
                  return (
                    <SidebarMenuItem key={playground.id}>
                      <SidebarMenuButton

                        isActive={pathname === `/playground/${playground.id}`}
                        tooltip={playground.name}
                      >
                        <Link href={`/playground/${playground.id}`} className="flex w-full items-center gap-2">
                          <IconComponent className="h-4 w-4 shrink-0" />
                          <span>{playground.name}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })
              )}
              <SidebarMenuItem>
                <SidebarMenuButton  tooltip="View all">
                  <Link href="/playgrounds">
                    <span className="text-sm text-muted-foreground">View all playgrounds</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton  tooltip="Settings">
              <Link href="/settings">
                <Settings className="h-4 w-4 shrink-0" />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}