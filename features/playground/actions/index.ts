"use server"

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { TemplateFolder } from "../lib/path-to-json";
import { readOwnedPlayground } from "../lib/project-access";

export const getPlaygroundById = async (id: string) => {
  try {
    const access = await readOwnedPlayground(id);
    if (access.decision !== "allowed") {
      return null;
    }

    const { id: playgroundId, title, description, template } = access.playground;
    return {
      id: playgroundId,
      title,
      description,
      template,
      name: title,
    };
  } catch (error) {
    console.log(error);
    return null;
  }
};

export const getPlaygroundSavedTemplate = async (id: string) => {
  try {
    const access = await readOwnedPlayground(id);
    if (access.decision !== "allowed") {
      return null;
    }

    const templateFile = await db.templateFile.findUnique({
      where: { playgroundId: access.playground.id },
      select: { content: true },
    });
    return templateFile?.content ?? null;
  } catch (error) {
    console.log(error);
    return null;
  }
};

export const saveUpdatedCode = async (
  playgroundId: string,
  data: TemplateFolder,
) => {
  try {
    const access = await readOwnedPlayground(playgroundId);
    if (access.decision !== "allowed") {
      return null;
    }

    const updatedPlayground = await db.templateFile.upsert({
      where: {
        playgroundId: access.playground.id,
      },
      update: {
        content: data as unknown as Prisma.InputJsonValue,
      },
      create: {
        playgroundId: access.playground.id,
        content: data as unknown as Prisma.InputJsonValue,
      },
    });
    return updatedPlayground;
  } catch (error) {
    console.log(error);
    return null;
  }
};
