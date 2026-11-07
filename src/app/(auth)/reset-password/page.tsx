import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthHeading } from "@/components/auth/auth-heading";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Set a new password" };

/** Reached from the reset email link (via /auth/callback, which signs the user in). */
async function ResetPassword() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <Alert title="This link has expired">
          Reset links work once and only for a short time. Please ask for a new one.
        </Alert>
        <Link
          href="/forgot-password"
          className={buttonVariants({ size: "lg", fullWidth: true, className: "mt-4" })}
        >
          Send a new link
        </Link>
      </>
    );
  }
  return <SetPasswordForm />;
}

export default function ResetPasswordPage() {
  return (
    <>
      <AuthHeading title="Set a new password" description="Choose a password you'll remember." />
      <Suspense fallback={<Skeleton className="h-56 w-full" />}>
        <ResetPassword />
      </Suspense>
    </>
  );
}
