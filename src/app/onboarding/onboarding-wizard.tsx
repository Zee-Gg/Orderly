"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { LogoPicker } from "@/components/restaurant/logo-picker";
import { OpeningHoursEditor } from "@/components/restaurant/opening-hours-editor";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Steps } from "@/components/ui/steps";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { DEFAULT_OPENING_HOURS, type OpeningHours } from "@/lib/opening-hours";
import { checkSlug, createRestaurant, setRestaurantLogo, type SlugStatus } from "@/lib/restaurants/actions";
import { uploadLogo } from "@/lib/restaurants/logo-upload";
import { onboardingSchema, slugify } from "@/lib/validation/restaurant";

const STEPS = ["Restaurant", "First branch", "Opening hours"];

const stepSchemas = [
  onboardingSchema.pick({ name: true, slug: true, city: true, phone: true }),
  onboardingSchema.pick({ branchName: true, branchAddress: true, branchArea: true }),
  onboardingSchema.pick({ openingHours: true }),
];

/** Which step a server field error belongs to. */
function stepOfField(field: string) {
  if (field.startsWith("openingHours")) return 2;
  if (field.startsWith("branch")) return 1;
  return 0;
}

type Values = {
  name: string;
  slug: string;
  city: string;
  phone: string;
  branchName: string;
  branchAddress: string;
  branchArea: string;
  openingHours: OpeningHours;
};

export function OnboardingWizard({
  firstName,
  isAdditional,
}: {
  firstName: string | null;
  isAdditional: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Values>({
    name: "",
    slug: "",
    city: "",
    phone: "",
    branchName: "Main branch",
    branchAddress: "",
    branchArea: "",
    openingHours: DEFAULT_OPENING_HOURS,
  });
  const [slugEdited, setSlugEdited] = useState(false);
  const [slugState, setSlugState] = useState<{ status: SlugStatus | "checking" | "idle"; message?: string }>({
    status: "idle",
  });
  const [logo, setLogo] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const slugTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSlug = useRef("");

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => {
      if (!e[key]) return e;
      const rest = { ...e };
      delete rest[key];
      return rest;
    });
  }

  /** Debounced live availability check. */
  function scheduleSlugCheck(slug: string) {
    latestSlug.current = slug;
    if (slugTimer.current) clearTimeout(slugTimer.current);
    if (!slug) {
      setSlugState({ status: "idle" });
      return;
    }
    setSlugState({ status: "checking" });
    slugTimer.current = setTimeout(async () => {
      const result = await checkSlug(slug);
      if (latestSlug.current === slug) setSlugState(result);
    }, 450);
  }

  function onNameChange(name: string) {
    set("name", name);
    if (!slugEdited) {
      const slug = slugify(name);
      set("slug", slug);
      scheduleSlugCheck(slug);
    }
  }

  function onSlugChange(raw: string) {
    const slug = raw.toLowerCase().replace(/[^a-z0-9-]/g, "");
    setSlugEdited(true);
    set("slug", slug);
    scheduleSlugCheck(slug);
  }

  function validateStep(index: number) {
    const result = stepSchemas[index].safeParse(values);
    if (result.success) return true;
    const found: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".");
      if (!found[key]) found[key] = issue.message;
    }
    setErrors(found);
    return false;
  }

  function next() {
    setFormError(null);
    if (!validateStep(step)) return;
    if (step === 0 && slugState.status === "taken") {
      setErrors({ slug: slugState.message ?? "This link is taken" });
      return;
    }
    setStep((s) => s + 1);
    window.scrollTo({ top: 0 });
  }

  function submit() {
    setFormError(null);
    if (!validateStep(2)) return;
    startSubmit(async () => {
      const result = await createRestaurant(values);
      if (!result.ok) {
        setFormError(result.error);
        if (result.fieldErrors) {
          setErrors(result.fieldErrors);
          setStep(Math.min(...Object.keys(result.fieldErrors).map(stepOfField)));
        }
        return;
      }

      if (logo && result.data) {
        try {
          const path = await uploadLogo(result.data.id, logo);
          const saved = await setRestaurantLogo(path);
          if (!saved.ok) throw new Error(saved.error);
        } catch {
          toast({
            title: "Logo didn't upload",
            description: "You can add it later in Settings → Restaurant.",
            tone: "error",
          });
        }
      }

      toast({
        title: `Welcome to Orderly${firstName ? `, ${firstName}` : ""}!`,
        description: `${values.name} is ready. Turn it on with the OPEN switch when you're taking orders.`,
        duration: 7000,
      });
      router.replace("/orders");
      router.refresh();
    });
  }

  const slugHint =
    slugState.status === "checking" ? (
      <span className="flex items-center gap-1">
        <LoaderCircle aria-hidden className="size-4 animate-spin" /> Checking…
      </span>
    ) : slugState.status === "available" ? (
      <span className="flex items-center gap-1 font-semibold text-status-ready-fg">
        <CircleCheck aria-hidden className="size-4" /> Available
      </span>
    ) : slugState.status === "taken" || slugState.status === "invalid" ? (
      <span className="flex items-center gap-1 text-danger">
        <CircleX aria-hidden className="size-4" /> {slugState.message}
      </span>
    ) : (
      "Customers open your menu with this link."
    );

  return (
    <div className="flex flex-col gap-6">
      {step === 0 && !isAdditional ? (
        <p className="text-lg">
          Assalam-o-Alaikum{firstName ? `, ${firstName}` : ""}! Let’s set up your restaurant.
        </p>
      ) : null}
      <Steps steps={STEPS} current={step} />

      {formError ? <Alert>{formError}</Alert> : null}

      <Card padding="lg" className="flex flex-col gap-4">
        {step === 0 ? (
          <>
            <Input
              label="Restaurant name"
              value={values.name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="e.g. Tandoori Junction"
              autoComplete="organization"
              required
              error={errors.name}
            />
            <Input
              label="Menu link"
              value={values.slug}
              onChange={(e) => onSlugChange(e.target.value)}
              leadingIcon={<span className="text-base font-medium">/m/</span>}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              error={errors.slug}
              hint={slugHint}
            />
            <Input
              label="City"
              value={values.city}
              onChange={(e) => set("city", e.target.value)}
              placeholder="e.g. Lahore"
              autoComplete="address-level2"
              list="pk-cities"
              required
              error={errors.city}
            />
            <datalist id="pk-cities">
              {["Lahore", "Karachi", "Islamabad", "Rawalpindi", "Faisalabad", "Multan", "Peshawar", "Quetta", "Sialkot", "Gujranwala", "Hyderabad"].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <Input
              label="Restaurant phone (optional)"
              type="tel"
              inputMode="tel"
              value={values.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="0300-1234567"
              autoComplete="tel"
              error={errors.phone}
            />
            <LogoPicker file={logo} onFileChange={setLogo} disabled={submitting} />
          </>
        ) : null}

        {step === 1 ? (
          <>
            <p className="text-sm text-muted">
              Your first location. You can add more branches later in Settings.
            </p>
            <Input
              label="Branch name"
              value={values.branchName}
              onChange={(e) => set("branchName", e.target.value)}
              placeholder="e.g. DHA Branch"
              required
              error={errors.branchName}
            />
            <Input
              label="Area"
              value={values.branchArea}
              onChange={(e) => set("branchArea", e.target.value)}
              placeholder="e.g. DHA Phase 5"
              error={errors.branchArea}
            />
            <Textarea
              label="Address"
              value={values.branchAddress}
              onChange={(e) => set("branchAddress", e.target.value)}
              placeholder="Shop number, street, nearby landmark"
              rows={3}
              error={errors.branchAddress}
            />
          </>
        ) : null}

        {step === 2 ? (
          <>
            <p className="text-sm text-muted">
              When do you take orders? Closing after midnight is fine, e.g. 12 PM to 2 AM.
            </p>
            <OpeningHoursEditor
              value={values.openingHours}
              onChange={(h) => set("openingHours", h)}
              errors={Object.fromEntries(
                Object.entries(errors)
                  .filter(([k]) => k.startsWith("openingHours."))
                  .map(([k, v]) => [k.replace("openingHours.", ""), v]),
              )}
              disabled={submitting}
            />
          </>
        ) : null}
      </Card>

      <div className="flex gap-3">
        {step > 0 ? (
          <Button
            variant="secondary"
            size="lg"
            icon={<ArrowLeft />}
            onClick={() => setStep((s) => s - 1)}
            disabled={submitting}
          >
            Back
          </Button>
        ) : null}
        {step < STEPS.length - 1 ? (
          <Button size="lg" className="flex-1" onClick={next}>
            Next
            <ArrowRight aria-hidden />
          </Button>
        ) : (
          <Button size="lg" className="flex-1" icon={<Check />} loading={submitting} onClick={submit}>
            Create restaurant
          </Button>
        )}
      </div>
    </div>
  );
}
