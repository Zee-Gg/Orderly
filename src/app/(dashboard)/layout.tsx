import { OfflineBanner } from "@/components/ui/offline-banner";
import { BottomNav } from "@/components/shell/bottom-nav";
import { Sidebar } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/top-bar";

export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-dvh lg:pl-sidebar">
      <Sidebar className="fixed inset-y-0 left-0 z-30 hidden lg:flex" />
      <TopBar />
      <div className="px-4 pt-3 empty:hidden lg:px-8">
        <OfflineBanner />
      </div>
      <main className="px-4 pt-6 pb-[calc(var(--spacing-touch-lg)+2rem+env(safe-area-inset-bottom))] lg:px-8 lg:pb-10">
        {children}
      </main>
      <BottomNav className="lg:hidden" />
    </div>
  );
}
