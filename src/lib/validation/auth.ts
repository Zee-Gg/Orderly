import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Please enter your email")
  .pipe(z.email("This email doesn't look right"));

export const newPasswordSchema = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(72, "Use 72 characters or fewer");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Please enter your password"),
});

export const signupSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Please enter your name")
    .max(120, "Name is too long"),
  email: emailSchema,
  password: newPasswordSchema,
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const setPasswordSchema = z
  .object({ password: newPasswordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });

/** Only allow same-site relative paths, to avoid open redirects. */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}
