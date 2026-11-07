"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, Pencil, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { archiveCategory, saveCategory } from "@/lib/menu/actions";

export type CategoryDraft = { id?: string; name: string; nameUr: string; isActive: boolean; itemCount: number };

/** Add / rename / hide / remove a category. */
export function CategoryDialog({
  category,
  onClose,
  onSaved,
}: {
  category: CategoryDraft;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState(category);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  const isNew = !values.id;

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveCategory({
        id: values.id,
        name: values.name,
        nameUr: values.nameUr,
        isActive: values.isActive,
      });
      if (!result.ok) {
        setError(result.fieldErrors ? null : result.error);
        setFieldError(result.fieldErrors?.name);
        return;
      }
      toast({ title: isNew ? `${values.name} added` : "Category saved" });
      router.refresh();
      onSaved?.(result.data!.id);
      onClose();
    });
  }

  function archive() {
    if (!values.id) return;
    startTransition(async () => {
      const result = await archiveCategory(values.id!);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ title: `${values.name} removed from the menu` });
      router.refresh();
      onClose();
    });
  }

  if (confirmArchive) {
    return (
      <Modal
        open
        onClose={() => setConfirmArchive(false)}
        tone="danger"
        icon={<Trash2 />}
        title={`Remove ${values.name}?`}
        description={
          values.itemCount > 0
            ? `Its ${values.itemCount} item${values.itemCount === 1 ? "" : "s"} will also disappear from the menu. Past orders are not affected.`
            : "Past orders are not affected."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmArchive(false)}>
              Keep it
            </Button>
            <Button variant="danger" loading={pending} onClick={archive}>
              Remove
            </Button>
          </>
        }
      >
        {error ? <Alert>{error}</Alert> : null}
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      icon={isNew ? <FolderPlus /> : <Pencil />}
      title={isNew ? "Add category" : "Edit category"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={pending} onClick={save}>
            {isNew ? "Add category" : "Save"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {error ? <Alert>{error}</Alert> : null}
        <Input
          label="Name"
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
          placeholder="e.g. Burgers"
          autoFocus
          error={fieldError}
        />
        <Input
          label="Urdu name (optional)"
          value={values.nameUr}
          onChange={(e) => setValues({ ...values, nameUr: e.target.value })}
          dir="rtl"
          lang="ur"
          className="font-urdu"
          placeholder="برگر"
        />
        {!isNew ? (
          <>
            <Switch
              checked={values.isActive}
              onCheckedChange={(isActive) => setValues({ ...values, isActive })}
              label="Show on menu"
              description={values.isActive ? "Customers can see it" : "Hidden from customers"}
            />
            <Button
              variant="danger-outline"
              icon={<Trash2 />}
              onClick={() => setConfirmArchive(true)}
              className="self-start"
            >
              Remove category
            </Button>
          </>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
