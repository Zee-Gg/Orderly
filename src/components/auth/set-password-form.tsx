"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { setNewPassword } from "@/lib/auth/actions";
import { useFormAction } from "@/lib/hooks/use-form-action";

/** New password + confirm. Shared by /reset-password and /change-password. */
export function SetPasswordForm({ submitLabel = "Save new password" }: { submitLabel?: string }) {
  const { pending, onSubmit, fieldError, formError } = useFormAction(setNewPassword);
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError ? <Alert>{formError}</Alert> : null}
      <PasswordInput
        name="password"
        label="New password"
        autoComplete="new-password"
        hint="At least 8 characters."
        required
        error={fieldError("password")}
      />
      <PasswordInput
        name="confirm"
        label="Type it again"
        autoComplete="new-password"
        required
        error={fieldError("confirm")}
      />
      <Button type="submit" size="lg" fullWidth loading={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}
