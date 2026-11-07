"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Pencil, UserPlus, Users } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { ASSIGNABLE_ROLES, ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { addStaff, updateMember } from "@/lib/staff/actions";

export type StaffRow = {
  membershipId: string;
  userId: string;
  name: string;
  email: string | null;
  role: Role;
  branchId: string | null;
  isActive: boolean;
  isYou: boolean;
};

type BranchOption = { id: string; name: string };

const ROLE_TONE: Record<Role, BadgeTone> = {
  owner: "brand",
  manager: "accepted",
  staff: "neutral",
  kitchen: "preparing",
  rider: "delivery",
};

const ROLE_HELP: Record<(typeof ASSIGNABLE_ROLES)[number], string> = {
  manager: "Runs the restaurant day to day: orders, menu, riders, reports.",
  staff: "Takes and manages orders, chats with customers.",
  kitchen: "Sees the kitchen screen only.",
  rider: "Sees their own deliveries only.",
};

const roleOptions = ASSIGNABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

function branchOptions(branches: BranchOption[]) {
  return [{ value: "all", label: "All branches" }, ...branches.map((b) => ({ value: b.id, label: b.name }))];
}

/** Readable temporary password, e.g. "Tandoor-4827-kq". */
function generatePassword() {
  const words = ["Tandoor", "Karahi", "Biryani", "Naan", "Tikka", "Chai", "Lassi", "Kabab"];
  const bytes = crypto.getRandomValues(new Uint32Array(4));
  const letters = "abcdefghjkmnpqrstuvwxyz";
  return `${words[bytes[0] % words.length]}-${1000 + (bytes[1] % 9000)}-${letters[bytes[2] % letters.length]}${letters[bytes[3] % letters.length]}`;
}

function AddStaffForm({
  branches,
  onAdded,
}: {
  branches: BranchOption[];
  onAdded: (credentials: { name: string; email: string; password: string }) => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState({
    fullName: "",
    email: "",
    role: "staff" as (typeof ASSIGNABLE_ROLES)[number],
    branchId: branches.length === 1 ? branches[0].id : "all",
    tempPassword: generatePassword(),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const set = (key: keyof typeof values, value: string) => setValues((v) => ({ ...v, [key]: value }));

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setFormError(null);
        startSaving(async () => {
          const result = await addStaff(values);
          if (!result.ok) {
            setFormError(result.error);
            setErrors(result.fieldErrors ?? {});
            return;
          }
          router.refresh();
          onAdded({ name: values.fullName, email: values.email, password: values.tempPassword });
        });
      }}
    >
      {formError ? <Alert>{formError}</Alert> : null}
      <Input label="Name" value={values.fullName} onChange={(e) => set("fullName", e.target.value)} autoComplete="off" required error={errors.fullName} />
      <Input
        label="Email"
        type="email"
        inputMode="email"
        value={values.email}
        onChange={(e) => set("email", e.target.value)}
        autoComplete="off"
        hint="They log in with this email."
        required
        error={errors.email}
      />
      <Select
        label="Role"
        value={values.role}
        onChange={(e) => set("role", e.target.value)}
        options={roleOptions}
        hint={ROLE_HELP[values.role]}
        error={errors.role}
      />
      <Select
        label="Branch"
        value={values.branchId}
        onChange={(e) => set("branchId", e.target.value)}
        options={branchOptions(branches)}
        error={errors.branchId}
      />
      <Input
        label="Temporary password"
        value={values.tempPassword}
        onChange={(e) => set("tempPassword", e.target.value)}
        autoComplete="off"
        spellCheck={false}
        hint="They'll be asked to choose their own password when they first log in."
        error={errors.tempPassword}
        trailing={
          <button
            type="button"
            onClick={() => set("tempPassword", generatePassword())}
            className="mr-1 flex min-h-touch items-center gap-1 rounded-control px-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          >
            <KeyRound aria-hidden className="size-4" />
            New
          </button>
        }
      />
      <Button type="submit" size="lg" fullWidth loading={saving} icon={<UserPlus />}>
        Add staff
      </Button>
    </form>
  );
}

function EditMemberForm({
  member,
  branches,
  onDone,
}: {
  member: StaffRow;
  branches: BranchOption[];
  onDone: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [role, setRole] = useState(member.role === "owner" ? "manager" : member.role);
  const [branchId, setBranchId] = useState(member.branchId ?? "all");
  const [isActive, setIsActive] = useState(member.isActive);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setFormError(null);
        startSaving(async () => {
          const result = await updateMember({
            membershipId: member.membershipId,
            role: role as (typeof ASSIGNABLE_ROLES)[number],
            branchId,
            isActive,
          });
          if (!result.ok) {
            setFormError(result.error);
            return;
          }
          toast({ title: `${member.name} updated` });
          router.refresh();
          onDone();
        });
      }}
    >
      {formError ? <Alert>{formError}</Alert> : null}
      <Select
        label="Role"
        value={role}
        onChange={(e) => setRole(e.target.value as typeof role)}
        options={roleOptions}
        hint={ROLE_HELP[role as (typeof ASSIGNABLE_ROLES)[number]]}
      />
      <Select label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} options={branchOptions(branches)} />
      <Switch
        checked={isActive}
        onCheckedChange={setIsActive}
        label="Can log in"
        description={isActive ? "Active" : "Deactivated — they can't open Orderly"}
      />
      <Button type="submit" size="lg" fullWidth loading={saving}>
        Save
      </Button>
    </form>
  );
}

export function StaffManager({
  staff,
  branches,
  canManage,
}: {
  staff: StaffRow[];
  branches: BranchOption[];
  canManage: boolean;
}) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [credentials, setCredentials] = useState<{ name: string; email: string; password: string } | null>(null);

  const branchName = (id: string | null) =>
    id ? (branches.find((b) => b.id === id)?.name ?? "Unknown branch") : "All branches";

  async function copyCredentials() {
    if (!credentials) return;
    const text = `Orderly login\nEmail: ${credentials.email}\nTemporary password: ${credentials.password}\nYou'll choose your own password after logging in.`;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied. Send it on WhatsApp." });
    } catch {
      toast({ title: "Couldn't copy. Please write it down.", tone: "error" });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <Button icon={<UserPlus />} onClick={() => setAdding(true)} className="self-start">
          Add staff
        </Button>
      ) : (
        <Alert tone="info">Only the owner can add staff or change roles.</Alert>
      )}

      {staff.length <= 1 ? (
        <EmptyState
          icon={<Users />}
          title="Just you so far"
          description="Add your managers, cashiers, kitchen and riders. Each person gets their own login."
        />
      ) : null}

      <ul className="flex flex-col gap-3">
        {staff.map((m) => (
          <li key={m.membershipId}>
            <Card className={m.isActive ? "" : "opacity-70"}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold">
                    {m.name}
                    {m.isYou ? <span className="font-normal text-muted"> (you)</span> : null}
                  </p>
                  <p className="truncate text-sm text-muted">{m.email ?? "—"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={ROLE_TONE[m.role]}>{ROLE_LABELS[m.role]}</Badge>
                  <Badge tone="outline">{branchName(m.branchId)}</Badge>
                  {m.isActive ? null : <Badge tone="cancelled">Deactivated</Badge>}
                </div>
                {canManage && !m.isYou && m.role !== "owner" ? (
                  <Button variant="secondary" size="icon" aria-label={`Edit ${m.name}`} onClick={() => setEditing(m)}>
                    <Pencil />
                  </Button>
                ) : null}
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <Drawer open={adding} onClose={() => setAdding(false)} title="Add staff" description="Create a login for someone on your team.">
        {adding ? (
          <AddStaffForm
            branches={branches}
            onAdded={(c) => {
              setAdding(false);
              setCredentials(c);
            }}
          />
        ) : null}
      </Drawer>

      <Drawer open={editing !== null} onClose={() => setEditing(null)} title={editing ? `Edit ${editing.name}` : "Edit"} description={editing?.email ?? undefined}>
        {editing ? (
          <EditMemberForm key={editing.membershipId} member={editing} branches={branches} onDone={() => setEditing(null)} />
        ) : null}
      </Drawer>

      <Modal
        open={credentials !== null}
        onClose={() => setCredentials(null)}
        title={`${credentials?.name ?? "Staff"} added`}
        description="Share these login details with them. The password is shown only once."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCredentials(null)}>
              Done
            </Button>
            <Button icon={<Copy />} onClick={copyCredentials}>
              Copy
            </Button>
          </>
        }
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-card bg-subtle p-4 text-sm">
          <dt className="text-muted">Email</dt>
          <dd className="font-semibold break-all">{credentials?.email}</dd>
          <dt className="text-muted">Password</dt>
          <dd className="font-mono font-semibold break-all">{credentials?.password}</dd>
        </dl>
      </Modal>
    </div>
  );
}
