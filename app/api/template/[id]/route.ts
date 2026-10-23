import {NextRequest,NextResponse} from "next/server";
import path from "path";

import { scanTemplateDirectory } from "@/features/playground/lib/path-to-json";
import { readOwnedPlayground } from "@/features/playground/lib/project-access";
import {templatePaths} from "@/lib/template";

function validateJsonStructure(data:unknown):boolean{
   try {
    JSON.parse(JSON.stringify(data));
    return true;
   } catch (error) {
    console.log(error);
    return false;
   }
}

export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>})
    {
    const {id}=await params;

    if(!id){
        return NextResponse.json({error:"Missing Playground ID "},{status:404});
    }

    const access = await readOwnedPlayground(id);
    if (access.decision === "unauthenticated") {
        return NextResponse.json({error:"Unauthorized"},{status:401});
    }
    if (access.decision !== "allowed") {
        return NextResponse.json({error:"Playground not found"},{status:404});
    }

    const templateKey= access.playground.template as keyof typeof templatePaths;
    const templatePath=templatePaths[templateKey];

    if(!templatePath){
        return NextResponse.json({error:"Invalid template type"},{status:404});
    }
    try {
        const inputPath=path.join(process.cwd(),templatePath);
        const result = await scanTemplateDirectory(inputPath);

        if(!validateJsonStructure(result.items)){
            return NextResponse.json({error:"Invalid JSON structure"},{status:400});
        }

        return Response.json({success:true,templateJSON:result},{status:200});
    } catch (error) {
        console.error("Error reading template structure",error);
        return Response.json({success:false,error:"Failed to read template structure"},{status:500});
    }
    
}
