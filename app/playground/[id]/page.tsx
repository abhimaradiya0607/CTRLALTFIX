"use client";

import { SidebarInset } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  FileText,
  PanelLeft,
  Save,
  Settings,
  X,
} from "lucide-react";
import { useParams } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { usePlayground } from "@/features/playground/hooks/usePlayground";
import TemplateFileTree from "@/features/playground/component/template-file-tree";
import { editFileAfterUserAction, rollbackUnsavedEdit } from "@/features/ai-chat/lib/edit-proposal";
import { useFileExplorer } from "@/features/playground/hooks/useFileExplorer";
import { useCallback, useEffect, useState, useRef } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TemplateFile, TemplateFolder } from "@/features/playground/types";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import PlaygroundEditor from "@/features/playground/component/playground-editor";
import { useWebContainer } from "@/features/webContainers/hooks/usewebContainer";
import WebContainerPreview from "@/features/webContainers/components/web-container-preview";
import LoadingStep from "@/components/ui/loader";
import {
  ProjectNoLongerCurrent,
  explorerSaveDecision,
  saveFailureMessage,
  saveFilesToProject,
} from "@/features/playground/lib/save-result";
import {
  nextPreviewVisible,
  previewMenuLabel,
} from "@/features/playground/lib/preview-visibility";
import { shouldApplyLoadedTree } from "@/features/playground/lib/project-switch";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import * as React from "react";
import ToogleAI from "@/features/playground/component/toogle-ai";
import { useAISuggestions } from "@/features/ai/hooks/useAisuggesition";
import { editorFileName } from "@/features/ai/lib/suggestion-request";
import { buildCurrentProjectContext } from "@/features/ai-chat/lib/project-context";

export default function PlaygroundPage() {
  const [isPreviewVisible, setIsPreviewVisible] = useState(true);
  const previewPanelRef = useRef<PanelImperativeHandle | null>(null);
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const {
    playgroundData,
    templateData,
    isLoading,
    error,
    saveTemplateData,
    isCurrentProject,
  } = usePlayground(id);

  const {
    activeFileId,
    closeAllFiles,
    openFile,
    closeFile,
    updateFileContent,
    handleAddFile,
    handleAddFolder,
    handleDeleteFile,
    handleDeleteFolder,
    handleRenameFile,
    handleRenameFolder,
    openFiles,
    playgroundId,
    setTemplateData,
    setActiveFileId,
    setPlaygroundId,
    setOpenFiles,
  } = useFileExplorer();

  useEffect(() => {
    if (openFiles.length === 0 || isPreviewVisible) return;
    const panel = previewPanelRef.current;
    if (!panel || panel.isCollapsed()) return;
    panel.collapse();
  }, [isPreviewVisible, openFiles.length]);

  const activeFile = openFiles.find((file) => file.id === activeFileId);
  const aiSuggestion = useAISuggestions(
    activeFileId,
    editorFileName(activeFile?.filename, activeFile?.fileExtension),
  );

  const {
    serverUrl,
    isLoading: isContainerLoading,
    error: containerError,
    instance,
    writeFileSync,
  } = useWebContainer({ templateData: templateData! });

  const lastSyncedContent = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    setPlaygroundId(id);
  }, [id, setPlaygroundId]);

  useEffect(() => {
    const state = useFileExplorer.getState();
    if (
      !templateData ||
      !shouldApplyLoadedTree({
        routeId: id,
        storeId: state.playgroundId,
        openFileCount: state.openFiles.length,
        hasTree: true,
      })
    ) {
      return;
    }
    setTemplateData(templateData);
  }, [id, templateData, playgroundId, openFiles.length, setTemplateData]);

  const loadChatContext = useCallback(() => {
    const explorer = useFileExplorer.getState();
    return buildCurrentProjectContext({
      routeId: id,
      storeId: explorer.playgroundId,
      storeTree: explorer.templateData,
      loadedTree: templateData,
      openFiles: explorer.openFiles.map((file) => ({
        filename: file.filename,
        fileExtension: file.fileExtension,
        content: file.content,
      })),
    });
  }, [id, templateData]);

  const saveTemplateForExplorer = useCallback(
    async (data: TemplateFolder): Promise<void> => {
      const decision = explorerSaveDecision(await saveTemplateData(data));
      if (decision === "switched") {
        throw new ProjectNoLongerCurrent();
      }
      if (decision === "failed") {
        throw new Error("Failed to save template data");
      }
    },
    [saveTemplateData],
  );

  const wrappedHandleAddFile = useCallback(
    (newFile: TemplateFile, parentPath: string) => {
      return handleAddFile(
        newFile,
        parentPath,
        writeFileSync!,
        instance,
        saveTemplateForExplorer,
      );
    },
    [handleAddFile, writeFileSync, instance, saveTemplateForExplorer],
  );

  const wrappedHandleAddFolder = useCallback(
    (newFolder: TemplateFolder, parentPath: string) => {
      return handleAddFolder(
        newFolder,
        parentPath,
        instance,
        saveTemplateForExplorer,
      );
    },
    [handleAddFolder, instance, saveTemplateForExplorer],
  );

  const wrappedHandleDeleteFile = useCallback(
    (file: TemplateFile, parentPath: string) => {
      return handleDeleteFile(file, parentPath, saveTemplateForExplorer);
    },
    [handleDeleteFile, saveTemplateForExplorer],
  );

  const wrappedHandleDeleteFolder = useCallback(
    (folder: TemplateFolder, parentPath: string) => {
      return handleDeleteFolder(folder, parentPath, saveTemplateForExplorer);
    },
    [handleDeleteFolder, saveTemplateForExplorer],
  );

  const wrappedHandleRenameFile = useCallback(
    (
      file: TemplateFile,
      newFilename: string,
      newExtension: string,
      parentPath: string,
    ) => {
      return handleRenameFile(
        file,
        newFilename,
        newExtension,
        parentPath,
        saveTemplateForExplorer,
      );
    },
    [handleRenameFile, saveTemplateForExplorer],
  );

  const wrappedHandleRenameFolder = useCallback(
    (folder: TemplateFolder, newFolderName: string, parentPath: string) => {
      return handleRenameFolder(
        folder,
        newFolderName,
        parentPath,
        saveTemplateForExplorer,
      );
    },
    [handleRenameFolder, saveTemplateForExplorer],
  );

  const [explorerOpen, setExplorerOpen] = useState(true);

  const hasUnsavedChanges = openFiles.some((file) => file.hasUnsavedChanges);

  //   const wrappedHandleAddFile = useCallback(
  //     (newFile: TemplateFile, parentPath: string) => {
  //       return handleAddFile(
  //         newFile,
  //         parentPath,
  //         writeFileSync!,
  //         instance,
  //         saveTemplateData
  //       );
  //     },
  //     [handleAddFile, writeFileSync, instance, saveTemplateData]
  //   );

  //   const wrappedHandleAddFolder = useCallback(
  //     (newFolder: TemplateFolder, parentPath: string) => {
  //       return handleAddFolder(newFolder, parentPath, instance, saveTemplateData);
  //     },
  //     [handleAddFolder, instance, saveTemplateData]
  //   );

  //   const wrappedHandleDeleteFile = useCallback(
  //     (file: TemplateFile, parentPath: string) => {
  //       return handleDeleteFile(file, parentPath, saveTemplateData);
  //     },
  //     [handleDeleteFile, saveTemplateData]
  //   );

  //   const wrappedHandleDeleteFolder = useCallback(
  //     (folder: TemplateFolder, parentPath: string) => {
  //       return handleDeleteFolder(folder, parentPath, saveTemplateData);
  //     },
  //     [handleDeleteFolder, saveTemplateData]
  //   );

  //   const wrappedHandleRenameFile = useCallback(
  //     (
  //       file: TemplateFile,
  //       newFilename: string,
  //       newExtension: string,
  //       parentPath: string
  //     ) => {
  //       return handleRenameFile(
  //         file,
  //         newFilename,
  //         newExtension,
  //         parentPath,
  //         saveTemplateData
  //       );
  //     },
  //     [handleRenameFile, saveTemplateData]
  //   );

  //   const wrappedHandleRenameFolder = useCallback(
  //     (folder: TemplateFolder, newFolderName: string, parentPath: string) => {
  //       return handleRenameFolder(
  //         folder,
  //         newFolderName,
  //         parentPath,
  //         saveTemplateData
  //       );
  //     },
  //     [handleRenameFolder, saveTemplateData]
  //   );

  const handleFileSelect = (file: TemplateFile) => {
    openFile(file);
  };

  const persistFiles = useCallback(
    async (fileIds: string[]) => {
      const explorerTemplate = useFileExplorer.getState().templateData;
      const latestTemplateData =
        explorerTemplate &&
        typeof explorerTemplate === "object" &&
        "items" in explorerTemplate
          ? explorerTemplate
          : templateData;
      const openFilesNow = useFileExplorer.getState().openFiles;
      const filesToSave = openFilesNow.filter((file) =>
        fileIds.includes(file.id),
      );

      if (filesToSave.length === 0) return;
      if (!latestTemplateData || !("items" in latestTemplateData)) {
        throw new Error("Template data is not loaded");
      }

      const result = await saveFilesToProject({
        tree: latestTemplateData,
        files: filesToSave,
        saveTree: async (tree) => {
          const outcome = await saveTemplateData(tree);
          return outcome.persisted;
        },
        writeFile: writeFileSync,
        stillCurrent: () =>
          isCurrentProject() &&
          useFileExplorer.getState().playgroundId === id,
      });
      if (result.status !== "saved") return;

      for (const fileToSave of filesToSave) {
        lastSyncedContent.current.set(fileToSave.id, fileToSave.content);
      }

      // Keep the folder object in the explorer store after a save for this project.
      setTemplateData(result.tree);

      const savedById = new Map(
        filesToSave.map((file) => [file.id, file.content]),
      );
      setOpenFiles(
        useFileExplorer.getState().openFiles.map((file) => {
          const savedContent = savedById.get(file.id);
          if (savedContent === undefined) return file;
          return {
            ...file,
            originalContent: savedContent,
            hasUnsavedChanges: file.content !== savedContent,
          };
        }),
      );
    },
    [
      templateData,
      writeFileSync,
      saveTemplateData,
      setTemplateData,
      setOpenFiles,
      isCurrentProject,
      id,
    ],
  );

  const handleSave = useCallback(
    async (fileId?: string, notify = true) => {
      const targetFileId = fileId || activeFileId;
      if (!targetFileId) return;

      const fileToSave = useFileExplorer
        .getState()
        .openFiles.find((file) => file.id === targetFileId);
      if (!fileToSave) return;

      const label = `${fileToSave.filename}.${fileToSave.fileExtension}`;
      try {
        await persistFiles([targetFileId]);
        if (useFileExplorer.getState().playgroundId !== id) return;
        if (notify) toast.success(`Saved ${label}`);
      } catch (error) {
        console.error("Error saving file:", error);
        if (notify) toast.error(saveFailureMessage(error, label));
        throw error;
      }
    },
    [activeFileId, persistFiles, id],
  );

  const getEditTarget = useCallback(() => {
    const state = useFileExplorer.getState();
    const file = state.openFiles.find((item) => item.id === state.activeFileId);
    if (!file) return null;
    return { fileId: file.id, path: file.id, content: file.content };
  }, []);

  const applyApprovedEdit = useCallback(
    async (proposal: { fileId: string; path: string; baseContent: string; content: string }) => {
      const state = useFileExplorer.getState();
      const outcome = editFileAfterUserAction({
        action: "apply",
        openFiles: state.openFiles,
        fileId: proposal.fileId,
        activeFileId: state.activeFileId,
        baseContent: proposal.baseContent,
        nextContent: proposal.content,
      });
      if (outcome.status !== "applied") return outcome.status;
      updateFileContent(proposal.fileId, proposal.content);
      try {
        await handleSave(proposal.fileId, false);
        if (useFileExplorer.getState().playgroundId !== id) return "applied" as const;
        const savedFile = useFileExplorer
          .getState()
          .openFiles.find((file) => file.id === proposal.fileId);
        const savedName = savedFile
          ? `${savedFile.filename}.${savedFile.fileExtension}`
          : proposal.path;
        toast.success(`Saved ${savedName}`);
        return "applied" as const;
      } catch {
        const rollback = await rollbackUnsavedEdit({
          fileId: proposal.fileId,
          path: proposal.path,
          baseContent: proposal.baseContent,
          restoreEditor: updateFileContent,
          rewritePreview: async (path, content) => {
            if (
              !isCurrentProject() ||
              useFileExplorer.getState().playgroundId !== id
            ) {
              return;
            }
            await writeFileSync(path, content);
          },
        });
        if (
          !isCurrentProject() ||
          useFileExplorer.getState().playgroundId !== id
        ) {
          return "save-failed" as const;
        }
        toast.error(
          rollback.previewRestored
            ? `Failed to save ${proposal.path}`
            : `Failed to save ${proposal.path}. The preview could not be restored. Reload the preview before continuing.`,
        );
        return rollback.previewRestored
          ? ("save-failed" as const)
          : ("preview-unrestored" as const);
      }
    },
    [handleSave, updateFileContent, writeFileSync, isCurrentProject, id],
  );

  const handleSaveAll = useCallback(async () => {
    const unsavedFiles = useFileExplorer
      .getState()
      .openFiles.filter((file) => file.hasUnsavedChanges);

    if (unsavedFiles.length === 0) {
      toast.info("No unsaved changes to save");
      return;
    }

    try {
      await persistFiles(unsavedFiles.map((file) => file.id));
      if (useFileExplorer.getState().playgroundId !== id) return;
      toast.success(`Saved ${unsavedFiles.length} file(s)`);
    } catch (error) {
      console.error("Error saving files:", error);
      toast.error(saveFailureMessage(error, "one or more files"));
    }
  }, [persistFiles, id]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (e.shiftKey) {
          handleSaveAll();
        } else {
          handleSave();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleSave, handleSaveAll]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)] p-4">
        <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
        <h2 className="text-xl font-semibold text-red-600 mb-2">
          Something went wrong
        </h2>
        <p className="text-gray-600 mb-4">{error}</p>
        <Button onClick={() => window.location.reload()} variant="destructive">
          Try Again
        </Button>
      </div>
    );
  }

  //loading state
  if (isLoading || (id.length > 0 && playgroundId !== id)) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)] p-4">
        <div className="w-full max-w-md p-6 rounded-lg shadow-sm border">
          <h2 className="text-xl font-semibold mb-6 text-center">
            Loading Playground
          </h2>
          <div className="mb-8">
            <LoadingStep
              currentStep={1}
              step={1}
              label="Loading playground data"
            />
            <LoadingStep
              currentStep={2}
              step={2}
              label="Setting up environment"
            />
            <LoadingStep currentStep={3} step={3} label="Ready to code" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <TemplateFileTree
        data={templateData!}
        title="File Explorer"
        onFileSelect={handleFileSelect}
        selectedFile={activeFile}
        onAddFile={wrappedHandleAddFile}
        onAddFolder={wrappedHandleAddFolder}
        onDeleteFile={wrappedHandleDeleteFile}
        onDeleteFolder={wrappedHandleDeleteFolder}
        onRenameFile={wrappedHandleRenameFile}
        onRenameFolder={wrappedHandleRenameFolder}
      />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <Button
            variant="ghost"
            size="icon-sm"
            className="-ml-1"
            aria-label={explorerOpen ? "Close sidebar" : "Open sidebar"}
            onClick={() => setExplorerOpen((open) => !open)}
          >
            <PanelLeft />
          </Button>
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="text-sm font-medium">
              {playgroundData?.title ??
                playgroundData?.name ??
                (isLoading ? "Loading…" : "Untitled Playground")}
            </h1>
            <p className="text-xs text-muted-foreground">
              {openFiles.length} File(s) Open
              {hasUnsavedChanges && ". Unsaved Changes"}
            </p>
          </div>
          <Tooltip>
            <TooltipTrigger className="ml-auto">
              <Button
                size={"sm"}
                variant={"outline"}
                aria-label="Save"
                onClick={() => handleSave()}
                disabled={!activeFile || !activeFile.hasUnsavedChanges}
              >
                <Save className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Save (Ctrl + S)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger className="ml-auto">
              <Button
                size={"sm"}
                variant={"outline"}
                aria-label="Save"
                onClick={handleSaveAll}
                disabled={!hasUnsavedChanges}
              >
                <Save className="h-4 w-4" />
                All
              </Button>
            </TooltipTrigger>
            <TooltipContent>Save All (Ctrl + Shift + S)</TooltipContent>
          </Tooltip>
          {/* TODO: Toogle Ai */}

          <ToogleAI
            isEnabled={aiSuggestion.isEnabled}
            onToggle={aiSuggestion.toggleEnabled}
            suggestionLoading={aiSuggestion.isLoading}
            playgroundId={id}
            loadContext={loadChatContext}
            getEditTarget={getEditTarget}
            onApplyEdit={applyApprovedEdit}
          />
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button size={"sm"} variant={"outline"} aria-label="More options">
                <Settings className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  const next = nextPreviewVisible(isPreviewVisible);
                  const panel = previewPanelRef.current;
                  if (panel) {
                    if (next) {
                      if (panel.isCollapsed()) panel.expand();
                    } else if (!panel.isCollapsed()) {
                      panel.collapse();
                    }
                  }
                  setIsPreviewVisible(next);
                }}
              >
                {previewMenuLabel(isPreviewVisible)}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={closeAllFiles}>
                Close All Files
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <div className="h-[calc(100vh-64px)]">
          {openFiles.length > 0 ? (
            <div className="flex h-full flex-col">
              <div className="border-b bg-muted/30">
                <Tabs
                  value={activeFileId || " "}
                  onValueChange={setActiveFileId}
                >
                  <div className="flex items-center justify-between px-4 py-2">
                    <TabsList className="h-8 bg-transparent p-0">
                      {openFiles.map((file) => (
                        <TabsTrigger
                          key={file.id}
                          value={file.id}
                          className="relative h-8 px-3 data-[state=active]:bg-background data-[state=active]:shadow-sm group"
                        >
                          <div className="flex items-center gap-2">
                            <FileText className="size-3" />
                            <span>
                              {file.filename}.{file.fileExtension}
                            </span>
                            {file.hasUnsavedChanges && (
                              <span className="absolute -right-1 -top-1 size-3 rounded-full bg-yellow-500 animate-pulse" />
                            )}

                            <span
                              className="ml-2 h-4 w-4 hover:bg-destructive hover:text-destructive-foreground rounded-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                closeFile(file.id);
                              }}
                            >
                              <X className="h-3 w-3" />
                            </span>
                          </div>
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    {openFiles.length > 1 && (
                      <Button
                        size={"sm"}
                        variant={"ghost"}
                        onClick={closeAllFiles}
                        aria-label="More options"
                      >
                        Close All
                      </Button>
                    )}
                  </div>
                </Tabs>
              </div>
              <div className="flex-1">
                <ResizablePanelGroup
                  orientation="horizontal"
                  className="h-full"
                >
                  <ResizablePanel defaultSize={50}>
                    <PlaygroundEditor
                      activeFile={activeFile}
                      content={activeFile?.content || ""}
                      onContentChange={(value) =>
                        activeFileId && updateFileContent(activeFileId, value)
                      }
                      aiEnabled={aiSuggestion.isEnabled}
                      suggestion={aiSuggestion.suggestion}
                      suggestionLoading={aiSuggestion.isLoading}
                      suggestionPosition={aiSuggestion.position}
                      suggestionFileId={aiSuggestion.suggestionFileId}
                      onAcceptSuggestion={(editor, monaco) =>
                        aiSuggestion.acceptSuggestion(editor, monaco)
                      }
                      onRejectSuggestion={(editor) =>
                        aiSuggestion.rejectSuggestion(editor)
                      }
                      onTriggerSuggestion={(type, editor) =>
                        aiSuggestion.fetchSuggestion(type, editor)
                      }
                    />
                  </ResizablePanel>
                  <ResizableHandle
                    className={isPreviewVisible ? undefined : "hidden"}
                  />
                  <ResizablePanel
                    defaultSize={50}
                    collapsible
                    collapsedSize="0%"
                    panelRef={previewPanelRef}
                    id="playground-preview"
                    aria-hidden={!isPreviewVisible}
                    inert={!isPreviewVisible}
                  >
                    <WebContainerPreview
                      templateData={templateData!}
                      instance={instance}
                      writeFileSync={writeFileSync}
                      isLoading={isContainerLoading}
                      error={containerError}
                      serverUrl={serverUrl!}
                      forceResetup={false}
                    />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full items-center justify-center text-muted-foreground gap-4">
              <FileText className="size-16 text-gray-300" />
              <div className="text-center ">
                <p className="text-lg font-medium">No Files Open</p>
                <p className="text-sm text-gray-500">
                  Select a file from the sidebar to get started
                </p>
              </div>
            </div>
          )}
        </div>
      </SidebarInset>
    </>
  );
}
