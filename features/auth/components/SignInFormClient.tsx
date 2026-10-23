import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  continueWithGitHub,
  continueWithGoogle,
} from "@/features/auth/actions/sign-in";
import { signIn } from "@/auth";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.54-5.17 3.54-8.87Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.46 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28A7.21 7.21 0 0 1 4.89 12c0-.79.14-1.56.38-2.28V6.63H1.26A12 12 0 0 0 0 12c0 1.94.46 3.77 1.26 5.37l4.01-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.26 6.63l4.01 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 4.77c.68.003 1.36.092 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  );
}

async function handleGoogleSignIn() {
  'use server';
  await signIn('google')
}

async function handleGitHubSignIn() {
  'use server';
  await signIn('github')
}

const legalLinkClassName =
  "rounded-sm underline decoration-white/25 underline-offset-4 transition-colors hover:text-foreground hover:decoration-[#B8FF3D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8FF3D] focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export const SignInFormClient = () => {
  return (
    <Card className="w-full max-w-md rounded-lg border border-border shadow-sm ring-0">
      <CardHeader className="justify-items-center gap-2 text-center">
        <CardTitle className="text-2xl font-semibold tracking-tight">
          Welcome back
        </CardTitle>
        <CardDescription className="max-w-xs text-center text-sm leading-relaxed">
          Sign in to continue to your CTRLALTFIX workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <form action={handleGoogleSignIn} className="w-full">
          <Button
            type="submit"
            variant="outline"
            className="h-11 w-full font-medium"
          >
            <GoogleIcon />
            Continue with Google
          </Button>
        </form>
        <form action={handleGitHubSignIn} className="w-full">
          <Button
            type="submit"
            variant="outline"
            className="h-11 w-full font-medium"
          >
            <GitHubIcon />
            Continue with GitHub
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col items-center gap-3 border-border bg-transparent px-6 py-5 text-center">
        <p className="text-sm leading-relaxed text-muted-foreground">
          By continuing, you agree to our{" "}
          <Link href="/terms" className={legalLinkClassName}>
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className={legalLinkClassName}>
            Privacy Policy
          </Link>
          .
        </p>
        <p className="text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} CTRLALTFIX. All rights reserved.
        </p>
      </CardFooter>
    </Card>
  );
};
