import {useState,useEffect,useCallback,useRef} from "react";
import {toast} from "sonner";
import { TemplateFolder } from "../lib/path-to-json";
import { getPlaygroundById, getPlaygroundSavedTemplate, saveUpdatedCode } from "../actions";
import { isPersistedSave, type TemplateSaveOutcome } from "../lib/save-result";

interface PlaygroundData{
    id:string;
    title:string;
    name:string;
    description?:string | null;
    template?:string;
}

interface UsePlaygroundReturn{
    playgroundData:PlaygroundData | null;
    templateData:TemplateFolder | null;
    isLoading:boolean;
    error:string | null;
    loadPlayground:()=>Promise<void>;
    saveTemplateData:(data:TemplateFolder)=>Promise<TemplateSaveOutcome>;
    isCurrentProject:()=>boolean;
}

function parseTemplateFolder(raw: unknown): TemplateFolder | null {
    if (raw == null) {
        return null;
    }

    let value: unknown = raw;
    if (typeof value === "string") {
        try {
            value = JSON.parse(value);
        } catch {
            return null;
        }
    }

    if (typeof value === "object" && value !== null && "folderName" in value && "items" in value) {
        return value as TemplateFolder;
    }

    if (Array.isArray(value)) {
        return {
            folderName: "Root",
            items: value,
        };
    }

    return null;
}

export const usePlayground=(id:string):UsePlaygroundReturn=>{
    const [playgroundData,setPlaygroundData]=useState<PlaygroundData | null>(null);
    const [templateData,setTemplateData]=useState<TemplateFolder | null>(null);
    const [isLoading,setIsLoading]=useState(id.length > 0);
    const [error,setError]=useState<string | null>(null);
    const [trackedId, setTrackedId] = useState(id);
    const projectIdRef = useRef(id);
    const loadGeneration = useRef(0);
    projectIdRef.current = id;

    if (trackedId !== id) {
        setTrackedId(id);
        loadGeneration.current += 1;
        if (id.length > 0) {
            setPlaygroundData(null);
            setTemplateData(null);
            setError(null);
            setIsLoading(true);
        }
    }

    const requestGeneration = loadGeneration.current;

    const loadPlayground=useCallback(async()=>{
        if(!id){
            return;
        }
        const isCurrentLoad = () =>
            projectIdRef.current === id && loadGeneration.current === requestGeneration;
        try {
            setIsLoading(true);
            setError(null);
            const data=await getPlaygroundById(id);

            if (!isCurrentLoad()) return;

            if(!data){
                throw new Error("Playground not found");
            }

            setPlaygroundData(data);

            const savedContent = await getPlaygroundSavedTemplate(id);
            if (!isCurrentLoad()) return;
            const savedTemplate = parseTemplateFolder(savedContent);
            if (savedTemplate) {
                setTemplateData(savedTemplate);
                toast.success("Template data loaded successfully");
                return;
            }

            const res=await fetch(`/api/template/${id}`);
            if (!isCurrentLoad()) return;

            if(!res.ok){
                throw new Error("Failed to load template data");
            }

            const templateRes=await res.json();
            if (!isCurrentLoad()) return;
            const loadedTemplate = parseTemplateFolder(templateRes.templateJSON);

            if (!loadedTemplate) {
                throw new Error("Invalid template data format");
            }

            setTemplateData(loadedTemplate);
            toast.success("Template data loaded successfully");
        } catch (err) {
            if (!isCurrentLoad()) return;
            console.log(err);
            const message = err instanceof Error ? err.message : "Failed to load template data";
            setError(message);
            toast.error(message);
            setTemplateData(null);
        } finally {
            if (isCurrentLoad()) {
                setIsLoading(false);
            }
        }
    }, [id, requestGeneration]);

    const saveTemplateData=useCallback(async(data:TemplateFolder): Promise<TemplateSaveOutcome>=>{
        const saveForId = id;
        const isCurrent = () => projectIdRef.current === saveForId;
        try {
            const saved = await saveUpdatedCode(saveForId, data);
            const outcome = { persisted: isPersistedSave(saved), current: isCurrent() };
            if (!outcome.current) {
                return outcome;
            }
            if (!outcome.persisted) {
                toast.error("Failed to save template data");
                return outcome;
            }
            setTemplateData(data);
            toast.success("Template data saved successfully");
            return outcome;
        } catch (error) {
            if (!isCurrent()) {
                return { persisted: false, current: false };
            }
            console.log(error);
            toast.error("Failed to save template data");
            return { persisted: false, current: true };
        }
    }, [id]);

    useEffect(()=>{
        loadPlayground();
    }, [loadPlayground]);

    const isCurrentProject = useCallback(() => projectIdRef.current === id, [id]);

    return {
        playgroundData,
        templateData,
        isLoading,
        error,
        loadPlayground,
        saveTemplateData,
        isCurrentProject,
    };
};
