"use client"
"use client";

import Image from "next/image";
import { format } from "date-fns";


import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import Link from "next/link";
import { useState } from "react";
import {
  MoreHorizontal,
  Edit3,
  Trash2,
  ExternalLink,
  Copy,
  Download,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { Playground } from "@/lib/generated/prisma/client";
// import { MarkedToggleButton } from "./toggle-star";
import {Project} from '../types';
import { readActionError } from "../lib/action-result";

interface ProjectTableProps{
  projects:Project[];
  onDeleteProject:(id:string)=>void | Promise<unknown>;
  onUpdateProject:(id:string,data:{title:string,description:string})=>void | Promise<unknown>;
  onDuplicateProject:(id:string)=>void | Promise<unknown>;
}

interface EditProjectData{
    title:string;
    description:string;

}



const ProjectTable = ({projects,onDeleteProject,onUpdateProject,onDuplicateProject}:ProjectTableProps) => {
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);
    const [editData, setEditData] = useState<EditProjectData>({
      title: "",
      description: "",
    });
    const [isLoading, setIsLoading] = useState(false);
    const [favoutrie, setFavourite] = useState(false);

    

    const handleDuplicateProject=async (project:Project)=>{
        if(!onDuplicateProject) return;
        setIsLoading(true);
        try {
            const result = await onDuplicateProject(project.id);
            const actionError = readActionError(result);
            if (actionError) {
                toast.error(actionError);
                return;
            }
            toast.success("Project duplicated successfully");
        } catch (error) {
            const message = error instanceof Error && error.message
                ? error.message
                : "Failed to duplicate project";
            toast.error(message);
        }finally{
            setIsLoading(false);
        }
    }
    const handleDeleteClick=async(project:Project)=>{
        setSelectedProject(project);
        setDeleteDialogOpen(true);
    }

    const handleEditClick=async(project:Project)=>{
        setSelectedProject(project);
        setEditData({
          title:project.title,
          description:project.description||"",
        });
        setEditDialogOpen(true);
    }

    const copyProjectUrl=async(projectId:string)=>{
        try {
            const url=window.location.origin + `/playground/${projectId}`;
            navigator.clipboard.writeText(url);
            toast.success("Project URL copied to clipboard");
        } catch (error) {
            toast.error("Failed to copy project URL");
        }finally{
            setIsLoading(false);
        }
    }

    const handleUpdateProject=async()=>{
        if(!onUpdateProject || !selectedProject) return;
        setIsLoading(true);
        try {
            const result = await onUpdateProject(selectedProject.id,editData);
            const actionError = readActionError(result);
            if (actionError) {
                toast.error(actionError);
                return;
            }
            setEditDialogOpen(false);
            setSelectedProject(null);
            toast.success("Project updated successfully");
        } catch (error) {
            const message = error instanceof Error && error.message
                ? error.message
                : "Failed to update project";
            toast.error(message);
        }finally{
            setIsLoading(false);
        }
    }
    const handleDeleteProject=async()=>{
        if(!onDeleteProject || !selectedProject) return;
        setIsLoading(true);
        try {
            const result = await onDeleteProject(selectedProject.id);
            const actionError = readActionError(result);
            if (actionError) {
                toast.error(actionError);
                return;
            }
            setDeleteDialogOpen(false);
            setSelectedProject(null);
            toast.success("Project deleted successfully");
        } catch (error) {
            const message = error instanceof Error && error.message
                ? error.message
                : "Failed to delete project";
            toast.error(message);
        }finally{
            setIsLoading(false);
        }
    }

  return (
    <>
    <div className="relative border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <Spinner className="size-6 text-[#A3E635]" />
          </div>
        ) : null}
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Template</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead className="w-[50px]">Actions</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {projects.map((project)=>(
                    <TableRow key={project.id}>
                        <TableCell>
                        <div className="flex flex-col">
                        <Link href={`/playground/${project.id}`} className="hover:underline">
                        <span className="font-semibold">{project.title}</span>
                        </Link>
                        <span className="text-sm text-gray-500 line-clamp-1">{project.description}</span>
                        </div>
                        </TableCell>
                        <TableCell>
                            <Badge
                    variant="outline"
                    className="bg-[#E93F3F15] text-[#E93F3F] border-[#E93F3F]"
                  >
                    {project.template}
                  </Badge>
                </TableCell>
                <TableCell>
                  {format(new Date(project.createdAt), "MMM d, yyyy")}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full overflow-hidden">
                      <Image
                        src={project.user.image || "/placeholder.svg"}
                        alt={project.user.name ?? ""}
                        width={32}
                        height={32}
                        className="object-cover"
                      />
                    </div>
                    <span className="text-sm">{project.user.name}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger >
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Open menu</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem >
                        {/* <MarkedToggleButton
                          markedForRevision={project.Starmark[0]?.isMarked}
                          id={project.id}
                        /> */}
                      </DropdownMenuItem>
                      <DropdownMenuItem >
                        <Link
                          href={`/playground/${project.id}`}
                          className="flex items-center"
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          Open Project
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem >
                        <Link
                          href={`/playground/${project.id}`}
                          target="_blank"
                          className="flex items-center"
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Open in New Tab
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                       onClick={() => handleEditClick(project)}
                       >
                         <Edit3 className="h-4 w-4 mr-2" />
                         Edit Project
                       </DropdownMenuItem>
                       <DropdownMenuItem
                         onClick={() => handleDuplicateProject(project)}
                       >
                         <Copy className="h-4 w-4 mr-2" />
                         Duplicate
                       </DropdownMenuItem>
                       <DropdownMenuItem
                         onClick={() => copyProjectUrl(project.id)}
                       >
                         <Download className="h-4 w-4 mr-2" />
                         Copy URL
                       </DropdownMenuItem>
                       <DropdownMenuSeparator />
                       <DropdownMenuItem
                         onClick={() => handleDeleteClick(project)}
                         className="text-destructive focus:text-destructive"
                       >
                         <Trash2 className="h-4 w-4 mr-2" />
                         Delete Project
                       </DropdownMenuItem>
                     </DropdownMenuContent>
                   </DropdownMenu>
                 </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
</div>
<Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
  <DialogContent className="sm:max-w-[425px]">
    <DialogHeader>
      <DialogTitle>Edit Project</DialogTitle>
      <DialogDescription>
        Make changes to your project here. Click save when you're done.
      </DialogDescription>
    </DialogHeader>
    <div className="grid gap-4 py-4">
      <div className="grid gap-2">
                <Label htmlFor="title" className="text-sm font-medium">Project Title</Label>
                <Input
                  id="title"
                  placeholder="Enter project title"
                  value={editData.title}
                  onChange={(e) => setEditData((prev)=>({...prev,title:e.target.value}))}
                  className="mt-1"
                />
      </div>
      <div className="grid gap-2">
                <Label htmlFor="title" className="text-sm font-medium">Description</Label>
                <Textarea
                  id="description"
                  placeholder="Enter project description"
                  value={editData.description}
                  onChange={(e) => setEditData((prev)=>({...prev,description:e.target.value}))}
                  className="mt-1"
                  rows={4}
                />
      </div>
    </div>
    <DialogFooter>
      <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)} disabled={isLoading}>Cancel</Button>
      <Button type="button" variant="default" onClick={handleUpdateProject}> 
        {
          isLoading ? (
            <Spinner className="size-4 text-[#A3E635]" />
          ) : (
            "Save Changes"
          )
      }
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete Project</AlertDialogTitle>
      <AlertDialogDescription>
        Are you sure you want to delete <span className="text-destructive font-semibold ">
        "{selectedProject?.title}"
          </span> ? This action cannot be undone.All files and data 
        associated with this project will be permanently removed.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel type="button" disabled={isLoading}>Cancel</AlertDialogCancel>
      <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={isLoading} onClick={handleDeleteProject}>
        <Trash2 className="h-4 w-4 mr-2" />
        {
          isLoading ? (
            <Spinner className="size-4 text-[#A3E635]" />
          ) : (
            "Confirm Delete"
          )
        }

      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
    </>
 
  )
}

export default ProjectTable