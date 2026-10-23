import { useEffect, useState,useCallback } from "react";
import { WebContainer } from "@webcontainer/api";
import {TemplateFolder} from "../../playground/lib/path-to-json";
import { toContainerPath } from "./container-files";

let webContainerPromise: Promise<WebContainer> | null = null;

function bootWebContainer() {
    if (!webContainerPromise) {
        webContainerPromise = WebContainer.boot().catch((error) => {
            webContainerPromise = null;
            throw error;
        });
    }
    return webContainerPromise;
}

interface UseWebContainerProps {
    templateData: TemplateFolder;
}

interface UseWebContainerReturn {
    serverUrl: string|null
    isLoading: boolean;
    error: string | null;
    instance:WebContainer|null;
    writeFileSync: (path: string, content: string) => Promise<void>;
    destroy: () => void;
}

export const useWebContainer = ({templateData}: UseWebContainerProps): UseWebContainerReturn => {
   const [serverUrl, setServerUrl] = useState<string|null>(null);
   const [isLoading, setIsLoading] = useState<boolean>(false);
   const [error, setError] = useState<string|null>(null);
   const [instance, setInstance] = useState<WebContainer|null>(null);

   useEffect(() => {
     let mounted = true;
     async function initializeWebContainer() {
        try {
            setIsLoading(true);
            setError(null);
            const webcontainerInstance = await bootWebContainer();
            
            if(!mounted) return;
            setInstance(webcontainerInstance);
            
            setIsLoading(false);
        } catch (err) {
            console.error('Failed to initialize web container', err);
            if(mounted) {
                setError(err instanceof Error ? err.message : 'Failed to initialize web container');
                setIsLoading(false);
            }
        } 
   }
   initializeWebContainer();
   return ()=>{
    mounted = false;
   }
},[])

   const writeFileSync = useCallback(async (path: string, content: string):Promise<void> => {
    if(!instance) throw new Error('Web container not initialized');
    try {
        const containerPath = toContainerPath(path);
        const partPaths=containerPath.split("/");
        const folderPath=partPaths.slice(0,-1).join("/");

        if(folderPath) {
            await instance.fs.mkdir(folderPath, { recursive: true });
        }
        await instance.fs.writeFile(containerPath, content);
    } catch (error) {
        const errorMessage=error instanceof Error ? error.message : 'Failed to write file';
        console.error(`Failed to write file at ${path} :`,error);
        throw new Error(`Failed to write file at ${path} : ${errorMessage}`);
    }
}, [instance]);
  const destroy = useCallback(():void => {
    if(instance) {
        instance.teardown();
        webContainerPromise = null;
        setInstance(null);
        setServerUrl(null);
        setError(null);
    }
}, [instance]);

return { serverUrl, isLoading, error, instance, writeFileSync, destroy };
}

