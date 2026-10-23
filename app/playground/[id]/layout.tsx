import { SidebarProvider } from "@/components/ui/sidebar";

export default function PlaygroundLayout({children}:{children:React.ReactNode}){
    return (
        <div>
            <SidebarProvider>
            {children}
                </SidebarProvider>
        </div>
    )
}