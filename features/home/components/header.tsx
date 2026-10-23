import Link from "next/link";
import UserButton from "@/features/auth/components/UserButton";
import { ThemeToggle } from "@/components/ui/Themetoggle";

const navLinkClassName =
  "text-[14px] font-medium text-zinc-600 transition-colors duration-200 ease-out hover:text-zinc-950 dark:text-white/60 dark:hover:text-white";

export function Header() {
  return (
    <header className="sticky top-0 z-50 mx-auto mt-0 flex h-[54px] w-[min(820px,calc(100vw-16px))] items-center overflow-hidden rounded-t-none rounded-bl-[16px] rounded-br-[16px] border border-black/10 bg-white px-4 py-0 shadow-[0_5px_18px_rgba(0,0,0,0.08)] backdrop-blur-md sm:w-[min(820px,calc(100vw-24px))] dark:border-white/10 dark:bg-[#141414]/90 dark:shadow-[0_5px_18px_rgba(0,0,0,0.16)]">
      <Link href="/" className="flex shrink-0 items-center gap-2.5">
        <img
          src="/logoo.svg"
          alt="CtrlAltFix"
          width={32}
          height={32}
          className="size-8 brightness-0 dark:brightness-100"
        />
        <span className="hidden text-[15px] font-semibold tracking-tight text-zinc-950 sm:inline dark:text-white">
          CtrlAltFix
        </span>
      </Link>

      <div aria-hidden className="mx-4 h-5 w-px shrink-0 bg-black/10 dark:bg-white/10" />

      <nav className="flex items-center gap-4">
        <Link
          href="/docs/components/background-paths"
          className={navLinkClassName}
        >
          Docs
        </Link>
        <Link
          href="https://codesnippetui.pro/templates?utm_source=codesnippetui.com&utm_medium=header"
          target="_blank"
          rel="noreferrer"
          className={`${navLinkClassName} inline-flex items-center gap-2`}
        >
          API
          <span className="inline-flex h-5 items-center rounded-full border border-green-600/70 bg-green-500/5 px-1.5 text-[10px] leading-none font-medium text-green-700 dark:border-green-500/70 dark:text-green-400">
            New
          </span>
        </Link>
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <div aria-hidden className="h-5 w-px bg-black/10 dark:bg-white/10" />
        <ThemeToggle />
        <UserButton />
      </div>
    </header>
  );
}
