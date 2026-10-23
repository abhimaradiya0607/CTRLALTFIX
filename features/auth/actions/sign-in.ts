"use server";

import { signIn } from "@/auth";

export async function continueWithGoogle() {
  await signIn("google");
}

export async function continueWithGitHub() {
  await signIn("github");
}
