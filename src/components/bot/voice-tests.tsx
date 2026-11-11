"use client";

import { useState, useTransition } from "react";
import { FlaskConical, Pencil, Save, Trash2, X } from "lucide-react";
import { MicRecorder } from "@/components/bot/mic-recorder";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { VOICE_TAGS, type VoiceCase, type VoiceEvalReport, type VoiceTag } from "@/lib/bot/voice/eval-types";

const URDU = /[؀-ۿ]/;
type Provider = "groq" | "google";

/** "2 Zinger Burger" / "2x Zinger Burger" / "Zinger Burger x2" per line → cart lines. */
function parseItems(text: string): { item: string; qty: number }[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const front = l.match(/^(\d+)\s*[x×]?\s+(.+)$/i);
      const back = l.match(/^(.+?)\s*[x×]\s*(\d+)$/i);
      if (front) return { item: front[2].trim(), qty: Number(front[1]) };
      if (back) return { item: back[1].trim(), qty: Number(back[2]) };
      return { item: l, qty: 1 };
    });
}
const itemsText = (c?: VoiceCase["expected"]) => (c?.cart ?? []).map((i) => `${i.qty} ${i.item}`).join("\n");

function MetaForm({
  initial,
  onSave,
  onCancel,
  saving,
  saveLabel,
}: {
  initial: { expectedText: string; tags: VoiceTag[]; items: string; behavior: string };
  onSave: (v: { expectedText: string; tags: VoiceTag[]; expected: VoiceCase["expected"] }) => void;
  onCancel?: () => void;
  saving: boolean;
  saveLabel: string;
}) {
  const [expectedText, setExpectedText] = useState(initial.expectedText);
  const [tags, setTags] = useState<VoiceTag[]>(initial.tags);
  const [items, setItems] = useState(initial.items);
  const [behavior, setBehavior] = useState(initial.behavior);
  return (
    <div className="flex flex-col gap-3">
      <Textarea
        label="What you said (exactly)"
        dir="auto"
        rows={2}
        value={expectedText}
        onChange={(e) => setExpectedText(e.target.value)}
        placeholder="e.g. do zinger burger aur ek coke"
      />
      <div>
        <p className="mb-1.5 text-sm font-semibold">Tags</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Tags">
          {VOICE_TAGS.map((tag) => {
            const on = tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={on}
                onClick={() => setTags((t) => (on ? t.filter((x) => x !== tag) : [...t, tag]))}
                className={cn(
                  "min-h-touch rounded-full border px-4 text-sm font-semibold",
                  on ? "border-brand-600 bg-brand-50 text-brand-800" : "border-line bg-surface text-ink hover:bg-subtle",
                )}
              >
                {tag.replace("_", " ")}
              </button>
            );
          })}
        </div>
      </div>
      <Textarea
        label="Expected items (optional, one per line, demo menu names)"
        rows={2}
        value={items}
        onChange={(e) => setItems(e.target.value)}
        placeholder={"2 Zinger Burger\n1 Coke 1.5L"}
        hint="If filled in, the eval also runs the transcript through the bot and checks the cart."
      />
      <Input label="Expected behaviour (optional)" value={behavior} onChange={(e) => setBehavior(e.target.value)} placeholder="e.g. asks which size" />
      <div className="flex flex-wrap gap-2">
        <Button
          icon={<Save />}
          loading={saving}
          disabled={!expectedText.trim()}
          onClick={() => {
            const cart = parseItems(items);
            onSave({
              expectedText: expectedText.trim(),
              tags,
              expected: cart.length || behavior.trim() ? { ...(cart.length ? { cart } : {}), ...(behavior.trim() ? { behavior: behavior.trim() } : {}) } : undefined,
            });
          }}
        >
          {saveLabel}
        </Button>
        {onCancel ? (
          <Button variant="ghost" icon={<X />} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function VoiceTests({ initialCases, providers }: { initialCases: VoiceCase[]; providers: Provider[] }) {
  const [cases, setCases] = useState(initialCases);
  const [recording, setRecording] = useState<{ blob: Blob; url: string; seconds: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [running, startRunning] = useTransition();
  const [evalProvider, setEvalProvider] = useState<Provider | "both">(providers.length > 1 ? "both" : (providers[0] ?? "google"));
  const [report, setReport] = useState<{ report: VoiceEvalReport; file: string } | null>(null);

  const save = (v: { expectedText: string; tags: VoiceTag[]; expected: VoiceCase["expected"] }) =>
    startSaving(async () => {
      if (!recording) return;
      setError(null);
      const form = new FormData();
      form.set("audio", recording.blob, "test.webm");
      form.set("meta", JSON.stringify(v));
      const res = await fetch("/api/dev/voice-tests", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setError(body.error ?? "Couldn't save.");
      setCases((c) => [...c, body.case]);
      URL.revokeObjectURL(recording.url);
      setRecording(null);
    });

  const update = (id: string, v: { expectedText: string; tags: VoiceTag[]; expected: VoiceCase["expected"] }) =>
    startSaving(async () => {
      setError(null);
      const res = await fetch("/api/dev/voice-tests", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...v }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setError(body.error ?? "Couldn't save.");
      setCases((c) => c.map((x) => (x.id === id ? body.case : x)));
      setEditing(null);
    });

  const remove = (id: string) =>
    startSaving(async () => {
      if (!window.confirm("Delete this voice test and its recording?")) return;
      const res = await fetch(`/api/dev/voice-tests?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) setCases((c) => c.filter((x) => x.id !== id));
    });

  const run = () =>
    startRunning(async () => {
      setError(null);
      const res = await fetch("/api/dev/voice-eval", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: evalProvider }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setError(body.error ?? "The eval failed.");
      setReport(body);
    });

  const shownProviders = report ? report.report.providers : [];
  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert>{error}</Alert> : null}
      {providers.length < 2 ? (
        <Alert tone="info">
          {providers.includes("google") ? "GROQ_API_KEY is not set: only Google is available, and “both” is skipped." : "No transcription key set."}
        </Alert>
      ) : null}

      <Card padding="lg" className="flex flex-col gap-3" aria-labelledby="record-title">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="record-title" className="text-lg font-bold">Record test</h2>
            <p className="text-sm text-muted">Hold the mic (or tap to start / tap to stop) and speak like a customer. The mic works on localhost or HTTPS only.</p>
          </div>
          <MicRecorder onRecorded={(blob, seconds) => setRecording({ blob, url: URL.createObjectURL(blob), seconds })} disabled={saving} />
        </div>
        {recording ? (
          <div className="flex flex-col gap-3 border-t border-line pt-3">
            <audio controls src={recording.url} className="h-11 w-full max-w-md" aria-label="Your recording" />
            <MetaForm
              initial={{ expectedText: "", tags: [], items: "", behavior: "" }}
              onSave={save}
              onCancel={() => setRecording(null)}
              saving={saving}
              saveLabel="Save test"
            />
          </div>
        ) : null}
      </Card>

      <Card padding="lg" className="flex flex-col gap-3" aria-labelledby="list-title">
        <h2 id="list-title" className="text-lg font-bold">Saved tests ({cases.length})</h2>
        {cases.length === 0 ? <p className="text-sm text-muted">No tests yet: record one above.</p> : null}
        <ul className="flex flex-col divide-y divide-line">
          {cases.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 py-3">
              {editing === c.id ? (
                <MetaForm
                  initial={{ expectedText: c.expectedText, tags: c.tags, items: itemsText(c.expected), behavior: c.expected?.behavior ?? "" }}
                  onSave={(v) => update(c.id, v)}
                  onCancel={() => setEditing(null)}
                  saving={saving}
                  saveLabel="Save changes"
                />
              ) : (
                <div className="flex flex-wrap items-start gap-3">
                  <audio controls preload="none" src={`/api/dev/voice-tests/audio?file=${encodeURIComponent(c.file)}`} className="h-11 w-60 max-w-full" aria-label={`Play ${c.id}`} />
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className={cn("font-semibold", URDU.test(c.expectedText) && "font-urdu leading-loose")}>
                      {c.expectedText}
                    </p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      {c.id} · {c.durationSec != null ? `${c.durationSec.toFixed(1)}s` : "?s"}
                      {c.tags.map((t) => (
                        <Badge key={t} tone="neutral" shape="square">
                          {t.replace("_", " ")}
                        </Badge>
                      ))}
                      {c.expected?.cart?.length ? <span>· items: {c.expected.cart.map((i) => `${i.qty} ${i.item}`).join(", ")}</span> : null}
                      {c.expected?.behavior ? <span>· {c.expected.behavior}</span> : null}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Edit ${c.id}`} icon={<Pencil />} onClick={() => setEditing(c.id)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${c.id}`} icon={<Trash2 />} onClick={() => remove(c.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card padding="lg" className="flex flex-col gap-3" aria-labelledby="eval-title">
        <h2 id="eval-title" className="flex items-center gap-2 text-lg font-bold">
          <FlaskConical aria-hidden className="size-5" /> Run voice eval
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <Tabs
            variant="segmented"
            aria-label="Provider"
            value={evalProvider}
            onValueChange={setEvalProvider}
            items={[
              ...providers.map((p) => ({ value: p as Provider | "both", label: p === "groq" ? "Groq" : "Google" })),
              ...(providers.length > 1 ? [{ value: "both" as const, label: "Both" }] : []),
            ]}
          />
          <Button loading={running} disabled={!cases.length || !providers.length} onClick={run}>
            Run voice eval
          </Button>
          {running ? <span className="text-sm text-muted">Transcribing every test… this can take a minute.</span> : null}
        </div>

        {report ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">Report saved: {report.file}</p>
            {report.report.skipped.map((s) => (
              <Alert key={s.provider} tone="info">
                Skipped {s.provider}: {s.reason}
              </Alert>
            ))}
            <div className="grid gap-3 md:grid-cols-2">
              {shownProviders.map((p) => {
                const s = report.report.summary[p];
                return (
                  <div key={p} className="rounded-control border border-line p-3 text-sm" data-testid={`summary-${p}`}>
                    <p className="text-base font-bold">{p === "groq" ? "Groq Whisper" : "Google Gemini"}</p>
                    <p>
                      Score <span className="text-xl font-bold">{Math.round(s.averageScore * 100)}%</span> · avg {(s.averageLatencyMs / 1000).toFixed(2)}s
                      {s.cartChecked ? ` · cart ${s.cartPassed}/${s.cartChecked}` : ""}
                    </p>
                    <p className="text-muted">
                      By tag: {Object.entries(s.byTag).map(([t, v]) => `${t.replace("_", " ")} ${Math.round(v * 100)}%`).join(" · ") || "—"}
                    </p>
                    <p className="text-muted">Script: {Object.entries(s.byScript).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>
                    <p className="text-muted">Worst: {s.worst.join(", ")}</p>
                  </div>
                );
              })}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-muted">
                    <th scope="col" className="py-1">Test (what was said)</th>
                    {shownProviders.map((p) => (
                      <th key={p} scope="col" className="py-1">
                        {p}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => (
                    <tr key={c.id} className="border-t border-line align-top">
                      <td className="py-2 pr-3" dir="auto">
                        <span className="block text-xs text-muted">{c.id}</span>
                        {c.expectedText}
                      </td>
                      {shownProviders.map((p) => {
                        const r = report.report.results[p]?.find((x) => x.id === c.id);
                        return (
                          <td key={p} className="py-2 pr-3" dir="auto">
                            {r ? (
                              <>
                                <span className={cn("font-bold", r.score >= 0.8 ? "text-status-ready-fg" : r.score >= 0.5 ? "text-status-awaiting-fg" : "text-danger")}>
                                  {Math.round(r.score * 100)}%
                                </span>{" "}
                                <span className="text-xs text-muted">
                                  {r.latencyMs}ms · {r.script}
                                </span>
                                <span className={cn("block", r.transcript && URDU.test(r.transcript) && "font-urdu leading-loose")}>
                                  {r.transcript ?? r.error ?? "—"}
                                </span>
                                {r.cart ? (
                                  <span className={cn("block text-xs", r.cart.pass ? "text-status-ready-fg" : "text-danger")}>
                                    Cart {r.cart.pass ? "✓" : "✗"} {r.cart.cart.join(", ")} {r.cart.problem ?? ""}
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
