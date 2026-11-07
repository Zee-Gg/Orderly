"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthHeading, OrDivider } from "@/components/auth/auth-heading";
import { GoogleButton } from "@/components/auth/google-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { signIn } from "@/lib/auth/actions";
import { useFormAction } from "@/lib/hooks/use-form-action";

const LINK_ERRORS: Record<string, string> = {
  link: "That link has expired or was already used. Please try again.",
  oauth: "Google sign-in didn't finish. Please try again.",
};

export function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next");
  const linkError = LINK_ERRORS[params.get("error") ?? ""];
  const { pending, onSubmit, fieldError, formError } = useFormAction(signIn);

  return (
    <>
      <AuthHeading title="Log in" description="Welcome back. Log in to see your orders." />

      {linkError && !formError ? <Alert className="mb-4">{linkError}</Alert> : null}
      {formError ? <Alert className="mb-4">{formError}</Alert> : null}

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}
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
          autoComplete="current-password"
          required
          error={fieldError("password")}
        />
        <Link
          href="/forgot-password"
          className="-mt-1 self-end py-2 text-sm font-semibold text-brand-700 hover:underline"
        >
          Forgot password?
        </Link>
        <Button type="submit" size="lg" fullWidth loading={pending}>
          Log in
        </Button>
      </form>

      <OrDivider />
      <GoogleButton next={next} />

      <p className="mt-6 text-center text-sm text-muted">
        New to Orderly?{" "}
        <Link href="/signup" className="font-semibold text-brand-700 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
