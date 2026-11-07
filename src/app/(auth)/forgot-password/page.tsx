"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AuthHeading } from "@/components/auth/auth-heading";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/lib/auth/actions";
import { useFormAction } from "@/lib/hooks/use-form-action";

export default function ForgotPasswordPage() {
  const { state, pending, onSubmit, fieldError, formError } = useFormAction(requestPasswordReset);

  return (
    <>
      <title>Forgot password · Orderly</title>
      <AuthHeading
        title="Forgot your password?"
        description="Enter your email and we'll send you a link to set a new one."
      />

      {state?.ok ? (
        <Alert tone="success" title="Check your email">
          If an account exists for {state.message}, we sent a reset link. It may take a
          minute to arrive. Check your spam folder too.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {formError ? <Alert>{formError}</Alert> : null}
          <Input
            name="email"
            type="email"
            label="Email"
            autoComplete="email"
            inputMode="email"
            required
            error={fieldError("email")}
          />
          <Button type="submit" size="lg" fullWidth loading={pending}>
            Send reset link
          </Button>
        </form>
      )}

      <Link
        href="/login"
        className="mt-6 flex min-h-touch items-center justify-center gap-2 text-sm font-semibold text-brand-700 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Back to log in
      </Link>
    </>
  );
}
