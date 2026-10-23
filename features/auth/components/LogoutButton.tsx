import React, { useState } from 'react'
import { LogoutButtonProps } from '../types';
import {useRouter} from 'next/navigation';
import {signOut} from 'next-auth/react';
import { Spinner } from '@/components/ui/spinner';



const LogoutButton = ({children}: LogoutButtonProps) => {
    const router=useRouter();
    const [isLoading, setIsLoading] = useState(false);
    
    const handleLogout = async () => {
        try {
            setIsLoading(true);
            await signOut();
            router.refresh();
            setIsLoading(false);
    } catch (error) {
        console.error(error);
        setIsLoading(false);
    }
    }
    return (
        <span className='cursor-pointer' onClick={handleLogout}>
            {isLoading ? <Spinner className="size-4 text-[#A3E635]" /> : children}
        </span>
    );
}

export default LogoutButton;