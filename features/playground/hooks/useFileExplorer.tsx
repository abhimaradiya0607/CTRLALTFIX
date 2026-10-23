import {create} from 'zustand';
import {toast} from 'sonner';
import { TemplateFile, TemplateFolder } from '../types';
import { closeAllEditorTabs, closeEditorTab, generateFileId, openEditorFile } from '../lib';
import { projectSwitchPatch } from '../lib/project-switch';
import { ProjectNoLongerCurrent } from '../lib/save-result';

function confirmDiscard(message: string): boolean {
    return typeof window !== "undefined" && window.confirm(message);
}

function reportExplorerError(error: unknown, message: string) {
    if (error instanceof ProjectNoLongerCurrent) return;
    console.error(message, error);
    toast.error(message);
}


interface OpenFile extends TemplateFile {
    id: string;
    hasUnsavedChanges: boolean;
    content: string;
    originalContent: string;
}

interface FileExplorerState {
    playgroundId: string;
    templateData: TemplateFolder | null;
    openFiles: OpenFile[];
    activeFileId: string | null;
    editorContent: string;
    setPlaygroundId: (id: string) => void;
    setTemplateData: (data: TemplateFolder | null) => void;
    setEditorContent: (content: string) => void;
    setOpenFiles: (files: OpenFile[]) => void;
    setActiveFileId: (fileId: string | null) => void;
    openFile: (file: TemplateFile) => void;
    closeFile: (fileId: string, discardUnsaved?: boolean) => void;
    closeAllFiles: () => void;
    handleAddFile: (
      newFile: TemplateFile,
      parentPath: string,
      writeFileSync: (filePath: string, content: string) => Promise<void>,
      instance: any,
      saveTemplateData: (data: TemplateFolder) => Promise<void>
    ) => Promise<void>;
    handleAddFolder: (
      newFolder: TemplateFolder, 
      parentPath: string, 
      instance: any, 
      saveTemplateData: (data: TemplateFolder) => Promise<void>
    ) => Promise<void>;
    handleDeleteFile: (
      file: TemplateFile, 
      parentPath: string, 
      saveTemplateData: (data: TemplateFolder) => Promise<void>
    ) => Promise<void>;
    handleDeleteFolder: (
      folder: TemplateFolder,
      parentPath: string,
      saveTemplateData: (data: TemplateFolder) => Promise<void>
    ) => Promise<void>;
    handleRenameFile: (
        file: TemplateFile,
        newFilename: string,
        newExtension: string,
        parentPath: string,
        saveTemplateData: (data: TemplateFolder) => Promise<void>
      ) => Promise<void>;
      handleRenameFolder: (
        folder: TemplateFolder,
        newFolderName: string,
        parentPath: string,
        saveTemplateData: (data: TemplateFolder) => Promise<void>
      ) => Promise<void>;
      updateFileContent: (fileId: string, content: string) => void;
}

export const useFileExplorer = create<FileExplorerState>((set, get) => {
  const applyClosedTabs = (next: {
    closed: boolean;
    openFiles: OpenFile[];
    activeFileId: string | null;
    editorContent: string;
  }) => {
    if (!next.closed) return;
    set({
      openFiles: next.openFiles,
      activeFileId: next.activeFileId,
      editorContent: next.editorContent,
    });
  };

  return {
    templateData: null,
    playgroundId: '',
    openFiles: [],
    activeFileId: null,
    editorContent: '',
    setPlaygroundId: (id: string) => {
        const patch = projectSwitchPatch(get().playgroundId, id);
        if (!patch) return;
        set(patch);
    },
    setTemplateData: (data: TemplateFolder | null) => set({ templateData: data }),
    setEditorContent: (content: string) => set({ editorContent: content }),
    setOpenFiles: (files: OpenFile[]) => set({ openFiles: files }),
    setActiveFileId: (fileId: string | null) => set({ activeFileId: fileId }),

    openFile: (file: TemplateFile) => {
        const next = openEditorFile(get().openFiles, file, get().templateData!);
        set(next);
    },
    closeFile: (fileId: string, discardUnsaved = false) => {
        const state = get();
        const tab = state.openFiles.find((item) => item.id === fileId);
        const discardUnsavedChanges =
            discardUnsaved ||
            (tab?.hasUnsavedChanges === true &&
                confirmDiscard("This file has unsaved changes. Close it without saving?"));
        applyClosedTabs(closeEditorTab(state, fileId, discardUnsavedChanges));
    },
    closeAllFiles: () => {
        const state = get();
        const hasUnsavedTab = state.openFiles.some((file) => file.hasUnsavedChanges);
        const discardUnsavedChanges =
            hasUnsavedTab &&
            confirmDiscard("Some files have unsaved changes. Close them without saving?");
        applyClosedTabs(closeAllEditorTabs(state, discardUnsavedChanges));
    },

    handleAddFile: async (newFile, parentPath, writeFileSync, instance, saveTemplateData) => {
        const { templateData } = get();
        if (!templateData) return;
    
        try {
          const updatedTemplateData = JSON.parse(JSON.stringify(templateData)) as TemplateFolder;
          const pathParts = parentPath.split("/");
          let currentFolder = updatedTemplateData;
    
          for (const part of pathParts) {
            if (part) {
              const nextFolder = currentFolder.items.find(
                (item) => "folderName" in item && item.folderName === part
              ) as TemplateFolder;
              if (nextFolder) currentFolder = nextFolder;
            }
          }
    
          currentFolder.items.push(newFile);

          await saveTemplateData(updatedTemplateData);

          set({ templateData: updatedTemplateData });
          toast.success(`Created file: ${newFile.filename}.${newFile.fileExtension}`);

          // Sync with web container
          if (writeFileSync) {
            const filePath = parentPath
              ? `${parentPath}/${newFile.filename}.${newFile.fileExtension}`
              : `${newFile.filename}.${newFile.fileExtension}`;
            await writeFileSync(filePath, newFile.content || "");
          }
    
          get().openFile(newFile);
        } catch (error) {
          reportExplorerError(error, "Failed to create file");
        }
    },

    handleAddFolder: async (newFolder, parentPath, instance, saveTemplateData) => {
        const { templateData } = get();
        if (!templateData) return;
    
        try {
          const updatedTemplateData = JSON.parse(JSON.stringify(templateData)) as TemplateFolder;
          const pathParts = parentPath.split("/");
          let currentFolder = updatedTemplateData;
    
          for (const part of pathParts) {
            if (part) {
              const nextFolder = currentFolder.items.find(
                (item) => "folderName" in item && item.folderName === part
              ) as TemplateFolder;
              if (nextFolder) currentFolder = nextFolder;
            }
          }
    
          currentFolder.items.push(newFolder);

          await saveTemplateData(updatedTemplateData);

          set({ templateData: updatedTemplateData });
          toast.success(`Created folder: ${newFolder.folderName}`);

          // Sync with web container
          if (instance && instance.fs) {
            const folderPath = parentPath
              ? `${parentPath}/${newFolder.folderName}`
              : newFolder.folderName;
            await instance.fs.mkdir(folderPath, { recursive: true });
          }
        } catch (error) {
          reportExplorerError(error, "Failed to create folder");
        }
      },

      handleDeleteFile: async (file, parentPath, saveTemplateData) => {
        const { templateData } = get();
        if (!templateData) return;
    
        try {
          const updatedTemplateData = JSON.parse(
            JSON.stringify(templateData)
          ) as TemplateFolder;
          const pathParts = parentPath.split("/");
          let currentFolder = updatedTemplateData;
    
          for (const part of pathParts) {
            if (part) {
              const nextFolder = currentFolder.items.find(
                (item) => "folderName" in item && item.folderName === part
              ) as TemplateFolder;
              if (nextFolder) currentFolder = nextFolder;
            }
          }
    
          currentFolder.items = currentFolder.items.filter(
            (item) =>
              !("filename" in item) ||
              item.filename !== file.filename ||
              item.fileExtension !== file.fileExtension
          );
    
          // Find and close the file if it's open
          // Use the same ID generation logic as in openFile
          const fileId = generateFileId(file, templateData);

          await saveTemplateData(updatedTemplateData);

          const openFile = get().openFiles.find((f) => f.id === fileId);
          if (openFile) {
            get().closeFile(fileId, true);
          }
          set({ templateData: updatedTemplateData });
          toast.success(`Deleted file: ${file.filename}.${file.fileExtension}`);
        } catch (error) {
          reportExplorerError(error, "Failed to delete file");
        }
      },

      handleDeleteFolder: async (folder, parentPath, saveTemplateData) => {
        const { templateData } = get();
        if (!templateData) return;
    
        try {
          const updatedTemplateData = JSON.parse(
            JSON.stringify(templateData)
          ) as TemplateFolder;
          const pathParts = parentPath.split("/");
          let currentFolder = updatedTemplateData;
    
          for (const part of pathParts) {
            if (part) {
              const nextFolder = currentFolder.items.find(
                (item) => "folderName" in item && item.folderName === part
              ) as TemplateFolder;
              if (nextFolder) currentFolder = nextFolder;
            }
          }
    
          currentFolder.items = currentFolder.items.filter(
            (item) =>
              !("folderName" in item) || item.folderName !== folder.folderName
          );
    
          await saveTemplateData(updatedTemplateData);

          const closeFilesInFolder = (folder: TemplateFolder, currentPath: string = "") => {
            folder.items.forEach((item) => {
              if ("filename" in item) {
                const fileId = generateFileId(item, templateData);
                get().closeFile(fileId, true);
              } else if ("folderName" in item) {
                const newPath = currentPath ? `${currentPath}/${item.folderName}` : item.folderName;
                closeFilesInFolder(item, newPath);
              }
            });
          };

          closeFilesInFolder(folder, parentPath ? `${parentPath}/${folder.folderName}` : folder.folderName);

          set({ templateData: updatedTemplateData });
          toast.success(`Deleted folder: ${folder.folderName}`);
    } catch (error) {
      reportExplorerError(error, "Failed to delete folder");
    }
  },
  handleRenameFile: async (
    file,
    newFilename,
    newExtension,
    parentPath,
    saveTemplateData
  ) => {
    const { templateData } = get();
    if (!templateData) return;

    // Generate old and new file IDs using the same logic as openFile
    const oldFileId = generateFileId(file, templateData);
    const newFile = { ...file, filename: newFilename, fileExtension: newExtension };
    const newFileId = generateFileId(newFile, templateData);

    try {
      const updatedTemplateData = JSON.parse(
        JSON.stringify(templateData)
      ) as TemplateFolder;
      const pathParts = parentPath.split("/");
      let currentFolder = updatedTemplateData;

      for (const part of pathParts) {
        if (part) {
          const nextFolder = currentFolder.items.find(
            (item) => "folderName" in item && item.folderName === part
          ) as TemplateFolder;
          if (nextFolder) currentFolder = nextFolder;
        }
      }

      const fileIndex = currentFolder.items.findIndex(
        (item) =>
          "filename" in item &&
          item.filename === file.filename &&
          item.fileExtension === file.fileExtension
      );
      if (fileIndex !== -1) {
        const updatedFile = {
          ...currentFolder.items[fileIndex],
          filename: newFilename,
          fileExtension: newExtension,
        } as TemplateFile;
        currentFolder.items[fileIndex] = updatedFile;

        await saveTemplateData(updatedTemplateData);

        const { openFiles, activeFileId } = get();
        const updatedOpenFiles = openFiles.map((f) =>
          f.id === oldFileId
            ? {
                ...f,
                id: newFileId,
                filename: newFilename,
                fileExtension: newExtension,
              }
            : f
        );

        set({
          templateData: updatedTemplateData,
          openFiles: updatedOpenFiles,
          activeFileId: activeFileId === oldFileId ? newFileId : activeFileId,
        });
        toast.success(`Renamed file to: ${newFilename}.${newExtension}`);
      }
    } catch (error) {
      reportExplorerError(error, "Failed to rename file");
    }
  },
  handleRenameFolder: async (folder, newFolderName, parentPath, saveTemplateData) => {
    const { templateData } = get();
    if (!templateData) return;

    try {
      const updatedTemplateData = JSON.parse(
        JSON.stringify(templateData)
      ) as TemplateFolder;
      const pathParts = parentPath.split("/");
      let currentFolder = updatedTemplateData;

      for (const part of pathParts) {
        if (part) {
          const nextFolder = currentFolder.items.find(
            (item) => "folderName" in item && item.folderName === part
          ) as TemplateFolder;
          if (nextFolder) currentFolder = nextFolder;
        }
      }

      const folderIndex = currentFolder.items.findIndex(
        (item) => "folderName" in item && item.folderName === folder.folderName
      );

      if (folderIndex !== -1) {
        const updatedFolder = {
          ...currentFolder.items[folderIndex],
          folderName: newFolderName,
        } as TemplateFolder;
        currentFolder.items[folderIndex] = updatedFolder;

        await saveTemplateData(updatedTemplateData);

        set({ templateData: updatedTemplateData });
        toast.success(`Renamed folder to: ${newFolderName}`);
      }
    } catch (error) {
      reportExplorerError(error, "Failed to rename folder");
    }
  },
  updateFileContent: (fileId, content) => {
    set((state) => ({
      openFiles: state.openFiles.map((file) =>
        file.id === fileId
          ? {
              ...file,
              content,
              hasUnsavedChanges: content !== file.originalContent,
            }
          : file
      ),
      editorContent:
        fileId === state.activeFileId ? content : state.editorContent,
    }));
  },
};
});
