import type { Metadata } from "next";
import { Download } from "lucide-react";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { ReportControls } from "@/components/reports/report-controls";
import { ReportsView } from "@/components/reports/reports-view";
import { buttonVariants } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";
import { requirePermission } from "@/lib/auth/session";
import { getReport } from "@/lib/reports/queries";
import { shortDate } from "@/lib/reports/range";
import { DEFAULT_TIMEZONE, localDate } from "@/lib/time";

export const metadata: Metadata = { title: "Reports" };

type Search = { range?: string | string[]; from?: string | string[]; to?: string | string[]; branch?: string | string[] };
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);

/** Reports (Phase 11): owners and managers. Aggregated in Postgres (report_* RPCs). */
async function Reports({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requirePermission("reports.view", { onDenied: "redirect" });
  const sp = await searchParams;
  const params = { range: one(sp.range), from: one(sp.from), to: one(sp.to), branch: one(sp.branch) };
  const data = await getReport(ctx, params);
  const tz = ctx.restaurant.timezone || DEFAULT_TIMEZONE;
  const today = localDate(new Date(), tz);

  const q = new URLSearchParams({ range: data.range.key, branch: data.branch.id ?? "all" });
  if (data.range.key === "custom") {
    q.set("from", data.range.from);
    q.set("to", data.range.to);
  }
  const exportQuery = q.toString();
  const dates = data.range.days === 1 ? shortDate(data.range.from, true) : `${shortDate(data.range.from)} – ${shortDate(data.range.to)}`;

  return (
    <>
      <PageHeader
        title="Reports"
        description={`${data.range.label === dates ? dates : `${data.range.label} · ${dates}`} · ${data.branch.name}`}
        actions={
          <a href={`/api/reports/export?type=orders&${exportQuery}`} download className={buttonVariants({ variant: "secondary" })} data-testid="export-orders">
            <Download aria-hidden /> Download orders (CSV)
          </a>
        }
      />
      <ReportControls
        key={exportQuery}
        range={data.range.key}
        from={data.range.from}
        to={data.range.to}
        today={today}
        branch={data.branch.id}
        branches={ctx.branches.map((b) => ({ id: b.id, name: b.name }))}
        canPickAll={ctx.role === "owner" && ctx.branches.length > 1}
      />
      <ReportsView data={data} today={today} exportQuery={exportQuery} />
    </>
  );
}

export default function ReportsPage({ searchParams }: PageProps<"/reports">) {
  return (
    <Suspense fallback={<SkeletonList />}>
      <Reports searchParams={searchParams as Promise<Search>} />
    </Suspense>
  );
}
