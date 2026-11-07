import { PageHeader } from "@/components/shell/page-header";
import { SettingsNav } from "./settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Settings" description="Your restaurant, branches and staff." />
      <SettingsNav />
      <div className="mt-6">{children}</div>
    </>
  );
}
