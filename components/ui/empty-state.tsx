import React from 'react'
import Image from 'next/image'

interface Props {
  title: string;
  description: string;
  imagesrc: string;
}

const EmptyState = ({title,description,imagesrc}:Props) => {
  return (
    <div className='flex flex-col justify-center items-center py-16'>
        <Image src={imagesrc} width={150} height={150} alt={title} className='mb-4 w-48 h-48' />
        <h2 className='text-xl font-semibold text-gray-500'>
            {title}
        </h2>
        <p className='text-gray-400'>
            {description}
        </p>
    </div>
  )
}

export default EmptyState