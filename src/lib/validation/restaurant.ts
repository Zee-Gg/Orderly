import { z } from "zod";
import { ASSIGNABLE_ROLES } from "@/lib/auth/permissions";
import { openingHoursSchema } from "@/lib/opening-hours";

const optionalText = (max: number, tooLong: string) =>
  z.string().trim().max(max, tooLong).optional().default("");

/** Accepts 0300-1234567, 03001234567, +92 300 1234567, 042-35761234. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .refine((v) => v === "" || /^\+?\d{10,13}$/.test(v), "Use a phone number like 0300-1234567")
  .optional()
  .default("");

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters")
  .max(40, "Use 40 characters or fewer")
  .regex(SLUG_PATTERN, "Use only small letters, numbers and dashes (not at the start or end)");

/** "Tandoori Junction!" → "tandoori-junction" */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export const restaurantNameSchema = z
  .string()
  .trim()
  .min(2, "Please enter your restaurant's name")
  .max(80, "Name is too long");

export const branchFieldsSchema = z.object({
  name: z.string().trim().min(1, "Please enter a branch name").max(80, "Name is too long"),
  address: optionalText(300, "Address is too long"),
  area: optionalText(80, "Area is too long"),
  city: optionalText(60, "City is too long"),
  phone: phoneSchema,
  openingHours: openingHoursSchema,
});

export const onboardingSchema = z.object({
  name: restaurantNameSchema,
  slug: slugSchema,
  city: z.string().trim().min(2, "Please enter your city").max(60, "City is too long"),
  phone: phoneSchema,
  branchName: z.string().trim().min(1, "Please enter a branch name").max(80, "Name is too long"),
  branchAddress: optionalText(300, "Address is too long"),
  branchArea: optionalText(80, "Area is too long"),
  openingHours: openingHoursSchema,
});
export type OnboardingInput = z.input<typeof onboardingSchema>;

export const restaurantProfileSchema = z.object({
  name: restaurantNameSchema,
  city: optionalText(60, "City is too long"),
  phone: phoneSchema,
  whatsappNumber: phoneSchema,
  logoUrl: z.string().trim().max(1000).optional().default(""),
});

export const branchSchema = branchFieldsSchema.extend({
  isActive: z.boolean().default(true),
  // Temporary simple delivery setup (paisa) until delivery zones (Phase 9).
  deliveryFee: z.number().int("Use whole paisa").min(0, "Can't be negative").max(10_000_000, "Too high").default(0),
  minimumOrder: z.number().int("Use whole paisa").min(0, "Can't be negative").max(100_000_000, "Too high").default(0),
});
export type BranchInput = z.input<typeof branchSchema>;

const branchChoice = z.union([z.literal("all"), z.uuid("Please choose a branch")]);

export const addStaffSchema = z.object({
  fullName: z.string().trim().min(2, "Please enter their name").max(120, "Name is too long"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("This email doesn't look right")),
  role: z.enum(ASSIGNABLE_ROLES, "Please choose a role"),
  branchId: branchChoice,
  tempPassword: z
    .string()
    .min(8, "Use at least 8 characters")
    .max(72, "Use 72 characters or fewer"),
});
export type AddStaffInput = z.input<typeof addStaffSchema>;

export const updateMemberSchema = z.object({
  membershipId: z.uuid(),
  role: z.enum(ASSIGNABLE_ROLES, "Please choose a role"),
  branchId: branchChoice,
  isActive: z.boolean(),
});
export type UpdateMemberInput = z.input<typeof updateMemberSchema>;
