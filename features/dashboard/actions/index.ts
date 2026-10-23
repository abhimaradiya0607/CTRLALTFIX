"use server"

import {currentUser} from "@/features/auth/actions"
import {db} from "@/lib/db"
import { Prisma } from "@/lib/generated/prisma/client"
import { Templates } from "@/lib/generated/prisma/enums"
import { revalidatePath } from "next/cache"
import { getSessionUserId, readOwnedPlayground } from "@/features/playground/lib/project-access"
import { planProjectDuplicate } from "../lib/duplicate-plan"

export const createPlayground=async (data:{title:string,template:Templates,description?:string}) => {
    const {template,description,title}=data;

    const user=await currentUser();
    if(!user){
        return {error:"Unauthorized"};
    }

    if(!user.id){
        return {error:"User not found"};
    }

    try {
        const playground=await db.playground.create({
            data:{
                title,
                description,
                template,
                userId:user.id,
            },
        });
        return playground;
    } catch (error) {
        console.error(error);
        return {error:"Failed to create playground"};
    }
}

export const getAllPlaygroundForUser=async () => {
    const user=await currentUser();
    if(!user){
        return {error:"Unauthorized"};
    }

    if(!user.id){
        return {error:"User not found"};
    }

    try {
        const playground=await db.playground.findMany({
            where:{
                userId:user.id
            },
            include:{
                user:true,
                Starmark:{
                    where:{
                        userId:user?.id
                    },
                    select:{
                        isMarked:true,
                    }
                }
            }
        })

        return playground;
    } catch (error) {
        console.error(error);
        return {error:"Failed to get all playground for user"};
    }
    
}

export const deleteProjectById=async (id:string) => {
    try {
        const access = await readOwnedPlayground(id);
        if (access.decision === "unauthenticated") {
            return {error:"Unauthorized"};
        }
        if (access.decision !== "allowed") {
            return {error:"Failed to delete project"};
        }

        const sessionUserId = await getSessionUserId();
        if (!sessionUserId) {
            return {error:"Unauthorized"};
        }

        const removed = await db.playground.deleteMany({
            where:{
                id: access.playground.id,
                userId: sessionUserId,
            },
        });
        if (removed.count !== 1) {
            return {error:"Failed to delete project"};
        }

        await db.templateFile.deleteMany({
            where:{ playgroundId: access.playground.id },
        });
        await db.starMark.deleteMany({
            where:{ playgroundId: access.playground.id },
        });

        revalidatePath("/dashboard");
    } catch (error) {
        console.error(error);
        return {error:"Failed to delete project"};
    }
}

export const editProjectById=async (id:string,data:{title:string,description:string}) => {
    try {
        const access = await readOwnedPlayground(id);
        if (access.decision === "unauthenticated") {
            return {error:"Unauthorized"};
        }
        if (access.decision !== "allowed") {
            return {error:"Failed to edit project"};
        }

        const sessionUserId = await getSessionUserId();
        if (!sessionUserId) {
            return {error:"Unauthorized"};
        }

        const updated = await db.playground.updateMany({
            where:{
                id: access.playground.id,
                userId: sessionUserId,
            },
            data:{
                title: data.title,
                description: data.description,
            },
        });
        if (updated.count !== 1) {
            return {error:"Failed to edit project"};
        }
        return {success:"Project edited successfully"};
    } catch (error) {
        console.error(error);
        return {error:"Failed to edit project"};
    }
}

export const duplicateProjectById=async (id:string) => {
    try {
        const access = await readOwnedPlayground(id);
        const sessionUserId = access.decision === "allowed"
            ? await getSessionUserId()
            : null;
        const savedFile = access.decision === "allowed"
            ? await db.templateFile.findUnique({
                where: { playgroundId: access.playground.id },
                select: { content: true },
            })
            : null;

        const plan = planProjectDuplicate({
            decision: access.decision,
            sessionUserId,
            title: access.decision === "allowed" ? access.playground.title : "",
            description: access.decision === "allowed" ? access.playground.description : null,
            template: access.decision === "allowed" ? access.playground.template : "",
            savedContent: savedFile?.content ?? null,
        });

        if (plan.outcome === "error") {
            return {error: plan.error};
        }

        const duplicatedPlayground=await db.playground.create({
            data:{
                title: plan.title,
                description: plan.description,
                template: plan.template as Templates,
                userId: plan.userId,
            }
        });

        if (plan.outcome === "copy-tree") {
            try {
                await db.templateFile.create({
                    data: {
                        playgroundId: duplicatedPlayground.id,
                        content: plan.content as Prisma.InputJsonValue,
                    },
                });
            } catch (copyError) {
                console.error(copyError);
                // These writes are not a MongoDB transaction. Remove the new
                // project so a failed copy is not opened as a fresh starter.
                await db.playground.deleteMany({
                    where: {
                        id: duplicatedPlayground.id,
                        userId: plan.userId,
                    },
                });
                return {error:"Failed to duplicate project"};
            }
        }

        revalidatePath("/dashboard");
        return duplicatedPlayground;
    } catch (error) {
        console.error(error);
        return {error:"Failed to duplicate project"};
    }
}

