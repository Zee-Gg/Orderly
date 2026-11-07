import { Utensils } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-8 sm:justify-center sm:py-12">
      <div className="mb-6 flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-11 items-center justify-center rounded-card bg-brand-700 text-white"
        >
          <Utensils className="size-6" />
        </span>
        <span className="text-2xl font-bold text-ink">Orderly</span>
      </div>
      <main className="w-full max-w-md rounded-panel border border-line bg-surface p-6 shadow-card sm:p-8">
        {children}
      </main>
    </div>
  );
}
