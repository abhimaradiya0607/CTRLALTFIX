import Image from "next/image";
import { SignInFormClient } from "@/features/auth/components/SignInFormClient";

export default function SignInPage() {
  return (
    <div className="flex w-full max-w-md flex-col items-center">
      <div className="mb-8 flex flex-col items-center gap-3">
        <Image
          src="/logoo.svg"
          alt=""
          width={56}
          height={50}
          priority
          className="h-12 w-auto"
        />
        <p className="text-[13px] font-semibold tracking-[0.22em] text-foreground">
          CTRLALTFIX
        </p>
      </div>
      <SignInFormClient />
    </div>
  );
}
