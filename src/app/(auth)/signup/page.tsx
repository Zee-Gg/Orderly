"use client";

import Link from "next/link";
import { MailCheck } from "lucide-react";
import { AuthHeading, OrDivider } from "@/components/auth/auth-heading";
import { GoogleButton } from "@/components/auth/google-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { signUp } from "@/lib/auth/actions";
import { useFormAction } from "@/lib/hooks/use-form-action";

export default function SignupPage() {
  const { state, pending, onSubmit, fieldError, formError } = useFormAction(signUp);

  if (state?.ok) {
    return (
      <div className="text-center">
        <span className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <MailCheck aria-hidden className="size-7" />
        </span>
        <h1 className="text-2xl font-bold">Check your email</h1>
        <p className="mt-2 text-muted">
          We sent a link to <span className="font-semibold text-ink">{state.message}</span>.
          Tap it to confirm your account, then you can set up your restaurant.
        </p>
        <p className="mt-6 text-sm text-muted">
          Wrong email?{" "}
          {/* Full reload resets the form state. */}
          <a href="/signup" className="font-semibold text-brand-700 hover:underline">
            Start again
          </a>
        </p>
      </div>
    );
  }

  return (
    <>
      <title>Create account · Orderly</title>
      <AuthHeading
        title="Create your account"
        description="Start taking WhatsApp orders in a few minutes."
      />
      {formError ? <Alert className="mb-4">{formError}</Alert> : null}

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Input
          name="fullName"
          label="Your name"
          autoComplete="name"
          required
          error={fieldError("fullName")}
        />
        <Input
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          inputMode="email"
          required
          error={fieldError("email")}
        />
        <PasswordInput
          name="password"
          label="Password"
          autoComplete="new-password"
          hint="At least 8 characters."
          required
          error={fieldError("password")}
        />
        <Button type="submit" size="lg" fullWidth loading={pending}>
          Create account
        </Button>
      </form>

      <OrDivider />
      <GoogleButton />

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-brand-700 hover:underline">
          Log in
        </Link>
      </p>
    </>
  );
}
