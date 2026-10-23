import React from 'react'
import AddNewButton from '@/features/dashboard/components/add-new-button'
import AddNewRepoButton from '@/features/dashboard/components/add-repo-button'
import EmptyState from '@/components/ui/empty-state'
import { deleteProjectById, duplicateProjectById, editProjectById, getAllPlaygroundForUser } from '@/features/dashboard/actions'
import ProjectTable from '@/features/dashboard/components/project-table'

const page = async() => {
  const playgrounds=await getAllPlaygroundForUser();
  const projects=Array.isArray(playgrounds)?playgrounds:[];

  return (
    <>
    <div className='flex flex-col justify-start items-center min-h-screen mx-auto max-w-7xl px-4 py-10'>
      <div className='grid grid-cols-1 md:grid-cols-2 gap-6 w-full'>
        <AddNewButton/>
        <AddNewRepoButton/>

      </div>
      <div className='mt-10 flex flex-col justify-center items-center w-full'>
        {
          projects.length ===0?(<EmptyState title='No playgrounds found' description='Create a new project to get started' imagesrc='/empty-state.svg'/>):(
            <ProjectTable
              projects={projects}
              onDeleteProject={deleteProjectById}
              onUpdateProject={editProjectById}
              onDuplicateProject={duplicateProjectById}
            />
          )
        }
      </div>
    </div>
    </>
  )
}

export default page
