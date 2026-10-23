import { SidebarProvider } from "@/components/ui/sidebar";
import { getAllPlaygroundForUser } from "@/features/dashboard/actions";
import { DashboardSidebar } from "@/features/dashboard/components/dashboard-sidebar";


export default async function DashboardLayout({children}: {  children: React.ReactNode;}) {

  const playgroundData=await getAllPlaygroundForUser();

  const technologyIconMap:Record<string,string>={
    REACT:"ZAP",
    NEXTJS:"BULB",
    ANGULAR:"TERMINAL",
    VUE:"COMPASS",
    EXPRESS:"DATABASE",
    HONO:"FLAMEICON",
    SVELTE:"GITHUB",
    ASTRO:"ASTRO",
  }

  const formattedPlaygroundData=Array.isArray(playgroundData)?playgroundData.map((playground)=>({
    id:playground.id,
    name:playground.title,
    starred:playground.Starmark?.[0]?.isMarked||false,
    icon:technologyIconMap[playground.template]||"Code2",
  })):[];
  
  return(
    <SidebarProvider>
      <div className="flex min-h-screen w-full overflow-x-hidden">
        <DashboardSidebar initialPlaygroundData={formattedPlaygroundData} />
        <main className="flex-1 p-4">
          {children}
        </main>
      </div>
    </SidebarProvider>
  )
}