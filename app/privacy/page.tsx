import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy · CTRLALTFIX",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-6 py-16">
      <p className="text-[13px] font-semibold tracking-[0.22em]">CTRLALTFIX</p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">
        Privacy Policy
      </h1>
      <p className="mt-6 text-sm leading-7 text-muted-foreground">
        CTRLALTFIX uses your sign-in provider to identify your account. Account
        details needed to keep you signed in are stored with your workspace and
        are not sold.
      </p>
      <Link
        href="/auth/sign-in"
        className="mt-10 w-fit rounded-sm text-sm text-muted-foreground underline decoration-white/25 underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8FF3D] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Back to sign in
      </Link>
    </main>
  );
}
