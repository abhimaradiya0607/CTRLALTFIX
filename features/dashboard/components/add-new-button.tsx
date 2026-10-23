'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import TemplateSelectionModal from './template-selection-modal'
import { toast } from 'sonner'
import { createPlayground } from '../actions'
import { createdPlaygroundId, readActionError } from '../lib/action-result'


const AddNewButton = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<
  {
    title:string;
    template:"REACT" | "NEXTJS" | "ANGULAR" | "VUE" | "EXPRESS" | "HONO" | "SVELTE" | "ASTRO";
    description?:string;
  }|null>(null);

  const router=useRouter();

  
  const handleSubmit = async (data: {
    title: string;
    template: "REACT" | "NEXTJS" | "ANGULAR" | "VUE" | "EXPRESS" | "HONO" | "SVELTE" | "ASTRO";
    description?: string;
  }) => {

    setSelectedTemplate(data);
    try {
      const response = await createPlayground(data);
      const playgroundId = createdPlaygroundId(response);
      if (!playgroundId) {
        toast.error(readActionError(response) ?? 'Failed to create playground');
        return;
      }
      toast.success('Playground created successfully');
      setIsModalOpen(false);
      router.push(`/playground/${playgroundId}`);
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : 'Failed to create playground';
      toast.error(message);
    }
  }

  return (
    <>
    <div 
    onClick={()=>setIsModalOpen(true)}
    className="group px-6 py-6 flex flex-row justify-between items-center border rounded-lg bg-muted cursor-pointer 
    transition-all duration-300 ease-in-out
    hover:bg-background hover:border-[#A3E635] hover:scale-[1.02]
    shadow-[0_2px_10px_rgba(0,0,0,0.08)]
    hover:shadow-[0_10px_30px_rgba(163,230,53,0.15)]"
  >
    <div className='flex flex-row justify-center items-start gap-4'>
      <Button 
      variant={'outline'}
      className="flex justify-center items-center bg-white group-hover:bg-[#fff8f8] group-hover:border-[#A3E635] group-hover:text-[#A3E635] transition-colors duration-300"
      size={'icon'}
      >
        <Plus size={30} className='transition-transform duration-300 group-hover:rotate-90' />
       </Button>
       <div className='flex flex-col'>
        <h1 className='text-xl font-bold text-[#A3E635]'>Add New</h1>
        <p className='text-sm text-muted-foreground max-w-[200px]'>Create a new project</p>

       </div>
    </div>
    <div className='relative overflow-hidden'>
      <Image src='/add-new.svg' alt='Create new PlayGround' width={120} height={120} className='transtion-transform duration-300 group-hover:scale-110' />
    </div>
    </div>


    <TemplateSelectionModal
    isOpen={isModalOpen}
    onClose={()=>setIsModalOpen(false)}
    onSubmit={handleSubmit}
    />
    </>
  )
}

export default AddNewButton;