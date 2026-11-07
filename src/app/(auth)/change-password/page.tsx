import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthHeading } from "@/components/auth/auth-heading";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { signOut } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Change password" };

async function ChangePassword() {
  const user = await requireUser({ allowPasswordChange: true });
  return (
    <>
      {user.profile.must_change_password ? (
        <Alert tone="info" className="mb-4" title="Please choose your own password">
          You logged in with a temporary password from your manager. Set a new one to continue.
        </Alert>
      ) : null}
      <SetPasswordForm submitLabel="Save and continue" />
      <form action={signOut} className="mt-4">
        <Button type="submit" variant="ghost" fullWidth>
          Log out
        </Button>
      </form>
    </>
  );
}

export default function ChangePasswordPage() {
  return (
    <>
      <AuthHeading title="Change password" />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <ChangePassword />
      </Suspense>
    </>
  );
}
