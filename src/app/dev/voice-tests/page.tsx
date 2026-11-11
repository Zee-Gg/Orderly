import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SkeletonList } from "@/components/ui/skeleton";
import { SimplePage } from "@/components/shell/simple-page";
import { VoiceTests } from "@/components/bot/voice-tests";
import { requireSuperAdmin } from "@/lib/auth/session";
import { devToolsEnabled } from "@/lib/bot/playground-shared";
import { availableTranscribeProviders } from "@/lib/bot/transcribe";
import { listVoiceCases } from "@/lib/bot/voice/eval-files";

export const metadata: Metadata = { title: "Voice tests", robots: { index: false, follow: false } };

/** Development only + super admin: record voice tests with the mic and run the voice eval. */
async function Page() {
  await connection(); // decide per request, never at build time
  if (!devToolsEnabled()) notFound();
  await requireSuperAdmin();
  return (
    <SimplePage title="Voice tests" subtitle="Development only · recordings in tests/voice-eval/">
      <VoiceTests initialCases={listVoiceCases()} providers={availableTranscribeProviders()} />
    </SimplePage>
  );
}

export default function VoiceTestsPage() {
  return (
    <Suspense fallback={<SkeletonList count={3} />}>
      <Page />
    </Suspense>
  );
}
