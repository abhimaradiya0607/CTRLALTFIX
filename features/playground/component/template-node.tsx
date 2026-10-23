import { SidebarMenuButton, SidebarMenuItem, SidebarMenuSub } from '@/components/ui/sidebar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronRight, Edit3, File, FilePlus, Folder, FolderPlus, MoreHorizontal, Trash2 } from 'lucide-react'
import React, { useState } from 'react'
import { cn } from '@/lib/utils'
import type { TemplateFile, TemplateFolder, TemplateItem } from '../lib/path-to-json'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { NewFileDialog, RenameFileDialog, RenameFolderDialog } from './template-file-tree'
import { NewFolderDialog } from './template-file-tree'
import { AlertDialog, AlertDialogHeader, AlertDialogContent, AlertDialogTrigger, AlertDialogTitle, AlertDialogAction, AlertDialogCancel, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog'

interface TemplateNodeProps {
    item: TemplateItem
    onFileSelect?: (file: TemplateFile) => void
    selectedFile?: TemplateFile
    level: number
    path?: string
    title?: string
    onAddFile?: (file: TemplateFile,parentPath:string) => void
    onAddFolder?: (folder: TemplateFolder,parentPath:string) => void
    onDeleteFile?: (file: TemplateFile,parentPath:string) => void
    onDeleteFolder?: (folder: TemplateFolder,parentPath:string) => void
    onRenameFile?: (file: TemplateFile,newFilename:string,newExtension:string,parentPath:string) => void
    onRenameFolder?: (folder: TemplateFolder,newFolderName:string,parentPath:string) => void
  }


const TemplateNode = ({
    item,
    onFileSelect,
    selectedFile,
    level,
    path="",   
    title,
    onAddFile,
    onAddFolder,
    onDeleteFile,
    onDeleteFolder,
    onRenameFile,
    onRenameFolder
}:TemplateNodeProps) => {
    const isValidItem=item && typeof item === "object";
    const isFolder =isValidItem && "folderName" in item;
    const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [isNewFileDialogOpen, setIsNewFileDialogOpen] = useState(false);
    const [isNewFolderDialogOpen, setIsNewFolderDialogOpen] = useState(false);
    
    const[isOpen,setIsOpen]=useState(level<2);
    
    if(!isValidItem){
        return null;
    }

    if(!isFolder){
        const file=item as TemplateFile;
        const filename=`${file.filename}.${file.fileExtension}`;
        const savedName = file.fileExtension ? `${file.filename}.${file.fileExtension}` : file.filename;
        const filePath = path ? `${path}/${savedName}` : savedName;
        const selectedId =
            selectedFile && "id" in selectedFile && typeof selectedFile.id === "string"
                ? selectedFile.id
                : "";
        const isSelected = selectedId
            ? selectedId === filePath
            : Boolean(
                selectedFile &&
                selectedFile.filename === file.filename &&
                selectedFile.fileExtension === file.fileExtension,
            );

        const handleRename=()=>{
            setIsRenameDialogOpen(true);
        }
        const handleDelete=()=>{
            setIsDeleteDialogOpen(true);
        }
        
        const confirmDelete=()=>{
            onDeleteFile?.(file, path);
            setIsDeleteDialogOpen(false);
        }

        const handleRenameSubmit=(newFilename:string,newExtension:string)=>{
            onRenameFile?.(file, newFilename, newExtension, path);
            setIsRenameDialogOpen(false);
        }

        return(
            <SidebarMenuItem>
            <div className="flex items-center group" style={{ paddingLeft: `${level * 12}px` }}>
                <SidebarMenuButton
                    className='flex-1'
                    isActive={isSelected}
                    onClick={() => onFileSelect?.(file)}
                >
                    <File className='h-4 w-4 mr-2 shrink-0' />
                    <span className="truncate">{filename}</span>
                </SidebarMenuButton>
                <DropdownMenu>
                    <DropdownMenuTrigger onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                            <Button variant={"ghost"} className='h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity' >
                                <MoreHorizontal className='h-3 w-3'/>
                            </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                        <DropdownMenuItem onClick={handleRename}>
                            <Edit3 className='h-4 w-4 mr-2' />
                            Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator/>
                        <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                            <Trash2 className='h-4 w-4 mr-2' />
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <RenameFileDialog
            isOpen={isRenameDialogOpen}
            onClose={() => setIsRenameDialogOpen(false)}
            onRename={handleRenameSubmit}
            currentFilename={file.filename}
            currentExtension={file.fileExtension}
            />
            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete File</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete "{filename}"? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={confirmDelete}
                    className={cn("bg-destructive text-destructive-foreground hover:bg-destructive/90")}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
        </SidebarMenuItem>
        );
    }
    else{

      const folder = item as TemplateFolder
      const folderName = folder.folderName;
    const currentPath = path ? `${path}/${folderName}` : folderName;

    const handleAddFile=()=>{
        setIsNewFileDialogOpen(true);
    }
    const handleAddFolder=()=>{
        setIsNewFolderDialogOpen(true);
    }
    
    const handleDelete=()=>{
        setIsDeleteDialogOpen(true);
    }
    
    const confirmDelete=()=>{
        onDeleteFolder?.(folder, path);
        setIsDeleteDialogOpen(false);
    }

    const handleRename=()=>{
        setIsRenameDialogOpen(true);
    }

    const handleCreateFile=(filename:string,extension:string)=>{
    if(onAddFile){
        const newFile:TemplateFile={
            filename,
            fileExtension:extension,
            content: ""
        }
        onAddFile(newFile, currentPath);
    }
    setIsNewFileDialogOpen(false);
    }

    const handleCreateFolder=(folderName:string)=>{
        if(onAddFolder){
            const newFolder:TemplateFolder={
                folderName,
                items: []
            }
            onAddFolder(newFolder, currentPath);
        }
        setIsNewFolderDialogOpen(false);
    }

    const handleRenameSubmit=(newFolderName:string)=>{
        onRenameFolder?.(folder, newFolderName, path);
        setIsRenameDialogOpen(false);
    }


  return (
      <SidebarMenuItem>
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="group/collapsible w-full">
          <div className="flex items-center group" style={{ paddingLeft: `${level * 12}px` }}>
            <CollapsibleTrigger className="flex min-w-0 flex-1">
           <SidebarMenuButton className='flex-1'>
            <ChevronRight className={cn("h-4 w-4 shrink-0 transition-transform duration-200 ease-out", isOpen && "rotate-90")} />
            <Folder className='h-4 w-4 mr-2 shrink-0' />
            <span>{folderName}</span>
            </SidebarMenuButton> 
            </CollapsibleTrigger>

            <DropdownMenu>
              <DropdownMenuTrigger onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                            <Button variant={"ghost"} className='h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity' >
                                <MoreHorizontal className='h-3 w-3'/>
                            </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                        <DropdownMenuItem onClick={handleAddFile}>
                            <FilePlus className='h-4 w-4 mr-2' />
                            New File
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleAddFolder}>
                            <FolderPlus className='h-4 w-4 mr-2' />
                            New Folder
                        </DropdownMenuItem>
                        <DropdownMenuSeparator/>
                        <DropdownMenuItem onClick={handleRename}>
                            <Edit3 className='h-4 w-4 mr-2' />
                            Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                            <Trash2 className='h-4 w-4 mr-2' />
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <CollapsibleContent>
          <SidebarMenuSub>
            {folder.items.map((childItem, index) => (
              <TemplateNode
                key={index}
                item={childItem}
                level={level + 1}
                path={currentPath}
                onFileSelect={onFileSelect}
                selectedFile={selectedFile}
                onAddFile={onAddFile}
                onAddFolder={onAddFolder}
                onDeleteFile={onDeleteFile}
                onDeleteFolder={onDeleteFolder}
                onRenameFile={onRenameFile}
                onRenameFolder={onRenameFolder}
              />
            ))}
          </SidebarMenuSub>
          </CollapsibleContent>
        </Collapsible>
        <NewFileDialog 
        isOpen={isNewFileDialogOpen} 
        onClose={() => setIsNewFileDialogOpen(false)} 
        onCreateFile={handleCreateFile} />

        <NewFolderDialog 
        isOpen={isNewFolderDialogOpen} 
        onClose={() => setIsNewFolderDialogOpen(false)}
         onCreateFolder={handleCreateFolder} />

        <RenameFolderDialog 
        isOpen={isRenameDialogOpen} 
        onClose={() => setIsRenameDialogOpen(false)}
         onRename={handleRenameSubmit} 
         currentFolderName={folderName} />

<AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Folder</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete "{folderName}" and all its contents? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirmDelete}
            className={cn(
              "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            )}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
            
      </SidebarMenuItem>
    );
  }
}

export default TemplateNode;
