"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label={
        mounted && isDark ? "Switch to light mode" : "Switch to dark mode"
      }
      className="inline-flex size-8 items-center justify-center rounded-[8px] text-zinc-700 transition-colors duration-200 ease-out hover:bg-black/5 hover:text-zinc-950 dark:text-white/75 dark:hover:bg-white/5 dark:hover:text-white"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {mounted && isDark ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </button>
  );
}
