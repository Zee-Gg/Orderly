/**
 * CLEAN RESET BEFORE LAUNCH — wipes ALL test data from the shared Supabase
 * project so real restaurants start on an empty database.
 *
 *   npm run reset:launch -- --admin-email you@example.com            (backup → dry run → confirm → reset)
 *   npm run reset:launch -- --admin-email you@example.com --dry-run  (only shows what would be deleted)
 *
 * Only DATA and FILES are touched — never the schema, migrations, RLS policies,
 * functions or triggers.
 *
 * KEEPS: plans, platform_settings, the super admin's auth user + profile.
 * DELETES: every other row in every public table (restaurants and everything
 * that belongs to them, audit logs, job runs, rate limits…), every file in
 * every storage bucket, every other auth user. order_counters is emptied, so
 * each restaurant's first real order is #1001 again. Identity numbers
 * (receipt numbers, audit/event ids) restart at 1.
 *
 * Steps:
 *  1. Safety checks (super admin email, project ref in .env.local = linked CLI project).
 *  2. Backup into backups/<timestamp>/ (git-ignored):
 *       data.sql      `supabase db dump --data-only` (needs Docker — skipped with a note when missing)
 *       tables/*.json every public table, row by row (always made, no Docker needed)
 *       storage/…     every storage file
 *       auth-users.json  users' id/email/phone/metadata (passwords can't be exported)
 *  3. DRY RUN: rows per table, files per bucket, auth users to delete.
 *  4. You type the project ref, then RESET. Anything else cancels.
 *  5. Reset: one atomic TRUNCATE of every public table except the kept ones,
 *     then storage files, then auth users.
 *  6. Summary + check that every table except plans, platform_settings and
 *     your profile is empty.
 *
 * Needs: .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY) and the
 * Supabase CLI linked to the same project (`npx supabase link`).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { createClient, type User } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");

/** Tables whose rows survive. profiles is cleaned through auth (other users' profiles cascade). */
const KEEP_TABLES = ["plans", "platform_settings", "profiles"] as const;
const PAGE = 500;

// ---------------------------------------------------------------- helpers

function fail(message: string): never {
  console.error(`\n✋ ${message}\n   Nothing was deleted.\n`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i === -1) return undefined;
  const a = argv[i];
  return a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[i + 1];
}

function quote(s: string) {
  return `"${s.replace(/"/g, '\\"')}"`;
}

/** Runs the Supabase CLI. Returns stdout; throws with stderr on failure. */
function supabaseCli(args: string[]): string {
  const r = spawnSync("npx", ["supabase", ...args].map((a) => (/[\s"]/.test(a) ? quote(a) : a)), {
    shell: true,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.status}`).trim().slice(-2000));
  return r.stdout;
}

type Row = Record<string, unknown>;

/** Runs SQL against the linked project through the CLI. read = read-only transaction. */
function sql(query: string, mode: "read" | "write"): Row[] {
  const file = join(tmpdir(), `orderly-reset-${process.pid}-${Date.now()}.sql`);
  writeFileSync(file, query, "utf8");
  try {
    const args = ["db", "query", "--remote", "--output-format", "json", "-f", file];
    args.push(mode === "read" ? "--read-only" : "--yes");
    const out = supabaseCli(args);
    const start = out.indexOf("{");
    if (start === -1) throw new Error(`Unexpected CLI output: ${out.slice(0, 500)}`);
    const parsed = JSON.parse(out.slice(start)) as { rows?: Row[]; _tag?: string; error?: { message?: string } };
    if (parsed._tag === "Error" || !parsed.rows) throw new Error(parsed.error?.message ?? out.slice(0, 1000));
    return parsed.rows;
  } finally {
    rmSync(file, { force: true });
  }
}

function json<T>(v: unknown): T {
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
}

const ident = (t: string) => `public."${t.replace(/"/g, '""')}"`;

function publicTables(): string[] {
  const rows = sql(
    "select coalesce(json_agg(table_name order by table_name), '[]'::json) as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE';",
    "read",
  );
  return json<string[]>(rows[0].t);
}

function countRows(tables: string[]): Record<string, number> {
  const parts = tables.map((t) => `'${t}', (select count(*) from ${ident(t)})`);
  const rows = sql(`select json_build_object(${parts.join(", ")}) as c;`, "read");
  return json<Record<string, number>>(rows[0].c);
}

function storageObjectCounts(): Record<string, number> {
  const rows = sql(
    "select coalesce(json_object_agg(b.id, (select count(*) from storage.objects o where o.bucket_id = b.id)), '{}'::json) as c from storage.buckets b;",
    "read",
  );
  return json<Record<string, number>>(rows[0].c);
}

// ---------------------------------------------------------------- setup

const adminEmail = arg("--admin-email")?.trim().toLowerCase();
const dryRunOnly = process.argv.includes("--dry-run");
if (!adminEmail || !adminEmail.includes("@")) {
  fail("Give your super admin email: npm run reset:launch -- --admin-email you@example.com");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local.");

const envRef = new URL(url).hostname.split(".")[0];
const linkedRefFile = join("supabase", ".temp", "project-ref");
const linkedRef = existsSync(linkedRefFile) ? readFileSync(linkedRefFile, "utf8").trim() : "";
if (!linkedRef) fail("The Supabase CLI is not linked. Run: npx supabase link --project-ref <ref>");
if (linkedRef !== envRef) {
  fail(`.env.local points at project "${envRef}" but the Supabase CLI is linked to "${linkedRef}". They must be the same.`);
}
const projectRef = envRef;

const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

async function listAllUsers(): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}

async function listBucketFiles(bucket: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      // Folders come back without an id.
      if (item.id === null) files.push(...(await listBucketFiles(bucket, path)));
      else files.push(path);
    }
    if (data.length < 1000) break;
  }
  return files;
}

async function main() {
  console.log(`\n=== Orderly — CLEAN RESET BEFORE LAUNCH ===`);
  console.log(`Project: ${projectRef} (${url})`);
  console.log(dryRunOnly ? "Mode: DRY RUN only (nothing is backed up or deleted)\n" : "Mode: backup → dry run → confirm → reset\n");

  // ---- 1. Super admin must exist and really be super admin.
  const users = await listAllUsers();
  const matches = users.filter((u) => (u.email ?? "").toLowerCase() === adminEmail);
  if (matches.length !== 1) fail(`No auth user with the email ${adminEmail}.`);
  const admin = matches[0];
  const { data: adminProfile, error: profileError } = await db.from("profiles").select("id, is_super_admin").eq("id", admin.id).maybeSingle();
  if (profileError) fail(`Could not read the profile: ${profileError.message}`);
  if (!adminProfile?.is_super_admin) fail(`${adminEmail} is not a super admin (profiles.is_super_admin is false).`);
  const usersToDelete = users.filter((u) => u.id !== admin.id);

  // ---- 2. What exists.
  const tables = publicTables();
  for (const keep of KEEP_TABLES) if (!tables.includes(keep)) fail(`Table "${keep}" not found — wrong project?`);
  const wipeTables = tables.filter((t) => !(KEEP_TABLES as readonly string[]).includes(t));
  const before = countRows(tables);

  const { data: buckets, error: bucketError } = await db.storage.listBuckets();
  if (bucketError) fail(`Could not list storage buckets: ${bucketError.message}`);
  const bucketFiles: Record<string, string[]> = {};
  for (const b of buckets) bucketFiles[b.id] = await listBucketFiles(b.id);

  // ---- 3. Backup (skipped in --dry-run).
  let backupDir = "";
  if (!dryRunOnly) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backupDir = resolve("backups", `before-launch-reset-${stamp}`);
    mkdirSync(join(backupDir, "tables"), { recursive: true });
    console.log(`Backing up to ${backupDir} …`);

    // 3a. SQL dump (needs Docker on this machine). Optional.
    const dumpFile = join(backupDir, "data.sql");
    try {
      supabaseCli(["db", "dump", "--remote", "--data-only", "-f", dumpFile]);
      if (!existsSync(dumpFile) || statSync(dumpFile).size === 0) throw new Error("empty dump file");
      console.log(`  ✓ data.sql (supabase db dump --data-only)`);
    } catch (e) {
      rmSync(dumpFile, { force: true });
      const why = String((e as Error).message ?? e).split("\n").slice(-1)[0].slice(0, 200);
      console.log(`  • data.sql skipped (supabase db dump failed: ${why}). The JSON backup below is complete.`);
    }

    // 3b. Every table as JSON (always).
    for (const t of tables) {
      const all: unknown[] = [];
      for (let offset = 0; offset < before[t]; offset += PAGE) {
        const rows = sql(
          `select coalesce(json_agg(x), '[]'::json) as d from (select * from ${ident(t)} order by ctid limit ${PAGE} offset ${offset}) x;`,
          "read",
        );
        all.push(...json<unknown[]>(rows[0].d));
      }
      if (all.length < before[t]) fail(`Backup of "${t}" is incomplete (${all.length} of ${before[t]} rows).`);
      writeFileSync(join(backupDir, "tables", `${t}.json`), JSON.stringify(all, null, 1));
    }
    console.log(`  ✓ tables/*.json (${tables.length} tables)`);

    // 3c. Storage files.
    let fileCount = 0;
    for (const [bucket, paths] of Object.entries(bucketFiles)) {
      for (const path of paths) {
        const { data, error } = await db.storage.from(bucket).download(path);
        if (error || !data) fail(`Could not back up storage file ${bucket}/${path}: ${error?.message ?? "no data"}`);
        const target = join(backupDir, "storage", bucket, ...path.split("/"));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, Buffer.from(await data.arrayBuffer()));
        fileCount++;
      }
    }
    console.log(`  ✓ storage/ (${fileCount} files)`);

    // 3d. Auth users (no passwords — Supabase can't export them).
    writeFileSync(
      join(backupDir, "auth-users.json"),
      JSON.stringify(
        users.map((u) => ({ id: u.id, email: u.email, phone: u.phone, created_at: u.created_at, user_metadata: u.user_metadata, app_metadata: u.app_metadata })),
        null,
        1,
      ),
    );
    console.log(`  ✓ auth-users.json (${users.length} users)`);
    console.log(`Backup done. It contains customer data — keep it private, never commit it.\n`);
  }

  // ---- 4. DRY RUN report.
  console.log("DRY RUN — this is what the reset deletes:\n");
  console.log("  Database rows");
  let totalRows = 0;
  for (const t of wipeTables) {
    totalRows += Number(before[t]);
    console.log(`    ${t.padEnd(28)} ${String(before[t]).padStart(7)}`);
  }
  console.log(`    ${"TOTAL".padEnd(28)} ${String(totalRows).padStart(7)}\n`);
  console.log("  Kept");
  console.log(`    ${"plans".padEnd(28)} ${String(before.plans).padStart(7)}`);
  console.log(`    ${"platform_settings".padEnd(28)} ${String(before.platform_settings).padStart(7)}`);
  console.log(`    ${"profiles".padEnd(28)} ${String(before.profiles).padStart(7)}  → only yours stays (others go with their logins)\n`);
  console.log("  Storage files");
  let totalFiles = 0;
  for (const [bucket, paths] of Object.entries(bucketFiles)) {
    totalFiles += paths.length;
    console.log(`    ${bucket.padEnd(28)} ${String(paths.length).padStart(7)}`);
  }
  console.log(`    ${"TOTAL".padEnd(28)} ${String(totalFiles).padStart(7)}\n`);
  console.log("  Auth users (logins)");
  console.log(`    delete ${usersToDelete.length} · keep 1 (${adminEmail})\n`);
  console.log("  order_counters emptied → each restaurant's first order is #1001.\n");

  if (dryRunOnly) {
    console.log("Dry run only. Nothing was backed up or deleted.\n");
    return;
  }

  // ---- 5. Confirm.
  console.log("⚠️  THIS DELETES ALL OF THE ABOVE FROM THE LIVE DATABASE. It cannot be undone (only restored from the backup).");
  console.log("    Stop the WhatsApp webhook / ngrok and close the app first, so nothing new arrives during the reset.\n");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const typedRef = (await rl.question(`Type the Supabase project ref (${projectRef}) to continue: `)).trim();
  if (typedRef !== projectRef) {
    rl.close();
    fail("Project ref did not match. Cancelled.");
  }
  const typedWord = (await rl.question('Type RESET to delete everything: ')).trim();
  rl.close();
  if (typedWord !== "RESET") fail("You did not type RESET. Cancelled.");

  // ---- 6. Reset. Database first: one atomic statement (all tables or none).
  // No CASCADE: if a kept table ever references a wiped one, Postgres refuses
  // instead of silently emptying the kept table.
  console.log("\nResetting…");
  const now = countRows(wipeTables);
  sql(`truncate table ${wipeTables.map(ident).join(", ")} restart identity;`, "write");
  console.log(`  ✓ database: ${wipeTables.length} tables emptied`);

  const deletedFiles: Record<string, number> = {};
  for (const bucket of Object.keys(bucketFiles)) {
    const paths = await listBucketFiles(bucket); // fresh list
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await db.storage.from(bucket).remove(paths.slice(i, i + 100));
      if (error) throw new Error(`Storage delete failed in ${bucket}: ${error.message}. Run the script again to finish.`);
    }
    deletedFiles[bucket] = paths.length;
  }
  console.log(`  ✓ storage: ${Object.values(deletedFiles).reduce((a, b) => a + b, 0)} files deleted`);

  let deletedUsers = 0;
  for (const u of (await listAllUsers()).filter((x) => x.id !== admin.id)) {
    const { error } = await db.auth.admin.deleteUser(u.id);
    if (error) throw new Error(`Could not delete auth user ${u.id}: ${error.message}. Run the script again to finish.`);
    deletedUsers++;
  }
  console.log(`  ✓ auth: ${deletedUsers} users deleted`);

  // ---- 7. Verify.
  const after = countRows(tables);
  const objectsAfter = storageObjectCounts();
  const usersAfter = await listAllUsers();
  const { data: profilesAfter } = await db.from("profiles").select("id");
  const problems: string[] = [];
  for (const t of wipeTables) if (Number(after[t]) !== 0) problems.push(`${t} still has ${after[t]} rows`);
  if ((profilesAfter ?? []).length !== 1 || profilesAfter?.[0].id !== admin.id) problems.push(`profiles: expected only yours, found ${(profilesAfter ?? []).length}`);
  for (const [b, n] of Object.entries(objectsAfter)) if (Number(n) !== 0) problems.push(`bucket ${b} still has ${n} files`);
  if (usersAfter.length !== 1 || usersAfter[0].id !== admin.id) problems.push(`auth: expected only your login, found ${usersAfter.length}`);

  const summary = {
    at: new Date().toISOString(),
    project: projectRef,
    keptAdmin: adminEmail,
    deletedRows: now,
    deletedFiles,
    deletedUsers,
    kept: { plans: after.plans, platform_settings: after.platform_settings, profiles: after.profiles },
    problems,
  };
  writeFileSync(join(backupDir, "reset-summary.json"), JSON.stringify(summary, null, 1));

  console.log("\n=== SUMMARY ===");
  console.log(`  Rows deleted:   ${Object.values(now).reduce((a, b) => a + Number(b), 0)} (from ${wipeTables.length} tables)`);
  console.log(`  Files deleted:  ${Object.values(deletedFiles).reduce((a, b) => a + b, 0)}`);
  console.log(`  Users deleted:  ${deletedUsers}`);
  console.log(`  Kept:           plans ${after.plans} · platform_settings ${after.platform_settings} · profiles ${after.profiles} (you) · your login`);
  console.log(`  Backup:         ${backupDir}`);
  if (problems.length) {
    console.log("\n❌ NOT fully clean:");
    for (const p of problems) console.log(`   - ${p}`);
    console.log("   Run the script again (it is safe to repeat).\n");
    process.exit(1);
  }
  console.log("\n✅ Clean: every table except plans, platform_settings and your profile is empty; no storage files; only your login remains.\n");
}

main().catch((e) => {
  console.error(`\n❌ ${(e as Error).message ?? e}`);
  console.error("   If the database step already ran, run the script again to finish (it is safe to repeat).");
  console.error("   Restore help: docs/deployment.md → 'How to restore from a backup'.\n");
  process.exit(1);
});
