"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, FileText, ImagePlus, Trash2, Upload } from "lucide-react";
import { MenuImageOutdatedBanner } from "@/components/bot/menu-image-banner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { DragHandle, SortableList } from "@/components/ui/sortable-list";
import { useToast } from "@/components/ui/toast";
import {
  addMenuMediaAction,
  removeMenuMediaAction,
  reorderMenuMediaAction,
  updateMenuMediaAction,
} from "@/lib/bot/knowledge-actions";
import type { MenuMediaRow } from "@/lib/bot/knowledge-queries";
import { BOT_MAX_MENU_IMAGES } from "@/lib/bot/media-constants";
import { compressMenuImage, uploadBotMedia } from "@/lib/bot/media-upload";
import { branchOptions, type BranchOption } from "./bot-knowledge";

const kb = (bytes: number | null) => (bytes ? (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`) : "");

export function MenuMediaTab({
  media,
  outdated,
  restaurantId,
  branches,
  isRestaurantWide,
}: {
  media: MenuMediaRow[];
  outdated: boolean;
  restaurantId: string;
  branches: BranchOption[];
  isRestaurantWide: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState(media);
  const [synced, setSynced] = useState(media);
  if (synced !== media) {
    setSynced(media);
    setRows(media);
  }
  const options = branchOptions(branches, isRestaurantWide);
  const [uploadBranch, setUploadBranch] = useState(options[0]?.value ?? "");
  const [progress, setProgress] = useState<{ name: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MenuMediaRow | null>(null);
  const [removing, setRemoving] = useState<MenuMediaRow | null>(null);
  const [pending, start] = useTransition();

  const activeImages = rows.filter((r) => r.isActive && r.type === "image").length;

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    for (const file of Array.from(files)) {
      try {
        const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
        setProgress({ name: file.name, percent: 0 });
        const blob = isPdf ? file : await compressMenuImage(file);
        const path = await uploadBotMedia(restaurantId, blob, isPdf ? "pdf" : "image", (percent) => setProgress({ name: file.name, percent }));
        const r = await addMenuMediaAction({
          type: isPdf ? "pdf" : "image",
          storagePath: path,
          fileName: file.name.slice(0, 200),
          sizeBytes: blob.size,
          branchId: uploadBranch || null,
        });
        if (!r.ok) throw new Error(r.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
        break;
      }
    }
    setProgress(null);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  function run(action: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    start(async () => {
      const r = await action();
      if (!r.ok) {
        toast({ title: r.error ?? "Couldn't save", tone: "error" });
        setRows(media);
        return;
      }
      if (r.message) toast({ title: r.message });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {outdated ? <MenuImageOutdatedBanner /> : null}
      <Card padding="lg" className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-bold">Menu images and PDF</h2>
          <p className="text-sm text-muted">
            When a customer asks for the menu, the bot sends these images (up to {BOT_MAX_MENU_IMAGES}, in this order). If there are
            no images it sends the PDF, and if there is nothing it types a short menu. Photos are made smaller automatically.
          </p>
        </div>
        {error ? <Alert>{error}</Alert> : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          {options.length > 1 ? (
            <Select
              label="Show to customers of"
              options={options}
              value={uploadBranch}
              onChange={(e) => setUploadBranch(e.target.value)}
              wrapperClassName="sm:w-56"
            />
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            multiple
            className="sr-only"
            id="menu-media-file"
            data-testid="menu-media-file"
            onChange={(e) => void onFiles(e.target.files)}
          />
          <Button icon={<Upload />} loading={!!progress} onClick={() => fileRef.current?.click()}>
            Upload menu image or PDF
          </Button>
        </div>
        {progress ? (
          <div className="flex flex-col gap-1" aria-live="polite">
            <p className="text-sm text-muted">
              Uploading {progress.name}… {progress.percent}%
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-subtle">
              <div className="h-full bg-brand-700 transition-all" style={{ width: `${progress.percent}%` }} />
            </div>
          </div>
        ) : null}
        {activeImages > BOT_MAX_MENU_IMAGES ? (
          <Alert tone="info">Only the first {BOT_MAX_MENU_IMAGES} images are sent. Drag the most useful ones to the top.</Alert>
        ) : null}
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ImagePlus />}
          title="No menu images yet"
          description="Upload a clear photo of your printed menu, or a PDF. Until then the bot types a short text menu from your prices."
        />
      ) : (
        <SortableList
          id="menu-media"
          items={rows}
          onReorder={(next) => {
            setRows(next);
            run(() => reorderMenuMediaAction(next.map((r) => r.id)));
          }}
          className="flex flex-col gap-2"
        >
          {(row, { handle }) => (
            <Card className="flex items-center gap-3 p-2" data-testid="menu-media-row">
              <DragHandle handle={handle} label={`Move ${row.fileName ?? "file"}`} />
              <button
                type="button"
                onClick={() => setPreview(row)}
                className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-control border border-line bg-subtle"
                aria-label={`Preview ${row.fileName ?? "file"}`}
              >
                {row.type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- public bot-media URL; exactly what WhatsApp gets
                  <img src={row.url} alt="" className="size-full object-cover" loading="lazy" />
                ) : (
                  <FileText aria-hidden className="size-8 text-muted" />
                )}
              </button>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="truncate text-sm font-semibold">{row.fileName ?? (row.type === "pdf" ? "Menu PDF" : "Menu image")}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge tone={row.type === "pdf" ? "accepted" : "neutral"}>{row.type === "pdf" ? "PDF" : "Image"}</Badge>
                  {!row.isActive ? <Badge tone="delivered" icon={<EyeOff />}>Hidden</Badge> : null}
                  <span>{kb(row.sizeBytes)}</span>
                </div>
                {options.length > 1 ? (
                  <Select
                    aria-label="Branch"
                    options={options.some((o) => o.value === (row.branchId ?? "")) ? options : [{ value: row.branchId ?? "", label: "Other branch" }, ...options]}
                    value={row.branchId ?? ""}
                    disabled={pending}
                    onChange={(e) => run(() => updateMenuMediaAction({ id: row.id, branchId: e.target.value || null }))}
                    wrapperClassName="max-w-56"
                  />
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={row.isActive ? "Hide from customers" : "Show to customers"}
                disabled={pending}
                onClick={() => run(() => updateMenuMediaAction({ id: row.id, isActive: !row.isActive }))}
              >
                {row.isActive ? <Eye /> : <EyeOff />}
              </Button>
              <Button variant="ghost" size="icon" aria-label="Remove" disabled={pending} onClick={() => setRemoving(row)}>
                <Trash2 />
              </Button>
            </Card>
          )}
        </SortableList>
      )}

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.fileName ?? "Preview"} size="lg">
        {preview?.type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- public bot-media URL
          <img src={preview.url} alt={preview.fileName ?? "Menu image"} className="max-h-[70vh] w-full object-contain" />
        ) : preview ? (
          <a href={preview.url} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 underline">
            Open the PDF
          </a>
        ) : null}
      </Modal>

      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        tone="danger"
        icon={<Trash2 />}
        title="Remove this file?"
        description="The bot will stop sending it. This can't be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Keep
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => {
                const row = removing!;
                setRemoving(null);
                run(() => removeMenuMediaAction(row.id));
              }}
            >
              Remove
            </Button>
          </>
        }
      />
    </div>
  );
}
