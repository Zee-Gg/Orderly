"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { GroupForm } from "@/components/menu/group-form";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { archiveGroup } from "@/lib/menu/actions";
import type { LibraryGroup } from "@/lib/menu/queries";
import { formatPKR } from "@/lib/money";
import { groupRuleText } from "@/lib/validation/menu";

export function ExtrasLibrary({ groups, canEdit }: { groups: LibraryGroup[]; canEdit: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<LibraryGroup | "new" | null>(null);
  const [removing, setRemoving] = useState<LibraryGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    if (!removing) return;
    startTransition(async () => {
      const result = await archiveGroup(removing.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ title: `${removing.name} removed` });
      setRemoving(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Link href="/menu" aria-label="Back to menu" className={buttonVariants({ variant: "secondary", size: "icon" })}>
            <ArrowLeft aria-hidden />
          </Link>
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl">Extras / Choices</h1>
            <p className="text-muted">Reusable groups like “Pizza Extras” or “Choose your drink”. Use one group on many items.</p>
          </div>
        </div>
        {canEdit ? (
          <Button icon={<Plus />} onClick={() => setEditing("new")}>
            New group
          </Button>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title="No extras yet"
          description="Create groups like toppings, sauces or a drink choice, then add them to your items."
          actions={
            canEdit ? (
              <Button icon={<Plus />} onClick={() => setEditing("new")}>
                New group
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((g) => (
            <Card key={g.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold">{g.name}</h2>
                  <p className="text-sm font-semibold text-brand-800">{groupRuleText(g.minSelect, g.maxSelect)}</p>
                </div>
                {canEdit ? (
                  <div className="flex shrink-0 gap-1">
                    <Button variant="secondary" size="icon" aria-label={`Edit ${g.name}`} onClick={() => setEditing(g)}>
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${g.name}`}
                      className="text-danger"
                      onClick={() => {
                        setError(null);
                        setRemoving(g);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ) : null}
              </div>
              <ul className="flex flex-wrap gap-2 text-sm">
                {g.options.map((o) => (
                  <li key={o.id} className={o.isAvailable ? "rounded-full bg-subtle px-3 py-1" : "rounded-full bg-subtle px-3 py-1 text-muted line-through"}>
                    {o.name}
                    {o.priceDelta ? <span className="font-semibold"> +{formatPKR(o.priceDelta)}</span> : null}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted">
                {g.usedBy.length
                  ? `Used by ${g.usedBy.length} item${g.usedBy.length === 1 ? "" : "s"}: ${g.usedBy.map((i) => i.name).join(", ")}`
                  : "Not used by any item yet"}
              </p>
            </Card>
          ))}
        </div>
      )}

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New extras group" : `Edit ${editing?.name ?? "group"}`}
        size="lg"
      >
        {editing ? (
          <GroupForm
            key={editing === "new" ? "new" : editing.id}
            group={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        ) : null}
      </Drawer>

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        tone="danger"
        icon={<Trash2 />}
        title={`Remove ${removing?.name ?? "group"}?`}
        description={
          removing?.usedBy.length
            ? `It will disappear from ${removing.usedBy.length} item${removing.usedBy.length === 1 ? "" : "s"}: ${removing.usedBy.map((i) => i.name).join(", ")}.`
            : "It isn't used by any item."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button variant="danger" loading={pending} onClick={remove}>
              Remove
            </Button>
          </>
        }
      >
        {error ? <Alert>{error}</Alert> : null}
      </Modal>
    </div>
  );
}
