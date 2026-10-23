"use client";
import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogOut, User } from "lucide-react";
import LogoutButton from "./LogoutButton";
import { useCurrentUser } from "../hooks/use-current-user";

const UserButton = ({ size = "default" }: { size?: "default" | "lg" }) => {

  const user = useCurrentUser()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={
          size === "lg"
            ? "rounded-full outline-none transition-opacity duration-200 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
            : "rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        }
      >
        <Avatar
          size={size === "lg" ? "lg" : "default"}
          className={size === "lg" ? "after:border-white/12" : undefined}
        >
          <AvatarImage src={user?.image ?? undefined} alt={user?.name ?? undefined} />
          <AvatarFallback>
            <User className="size-4" />
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>

    <DropdownMenuContent align="end" sideOffset={8} className="min-w-48">
      <DropdownMenuItem>
        <span>
          {user?.email}
        </span>
      </DropdownMenuItem>
      <DropdownMenuSeparator/>
        <LogoutButton>
            <DropdownMenuItem>
                <LogOut className="h-4 w-4 mr-2"/>
                LogOut
            </DropdownMenuItem>
        </LogoutButton>
    </DropdownMenuContent>

    </DropdownMenu>
  );
};

export default UserButton;