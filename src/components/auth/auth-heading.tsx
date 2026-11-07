import type { ReactNode } from "react";

export function AuthHeading({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold text-ink">{title}</h1>
      {description ? <p className="mt-1 text-base text-muted">{description}</p> : null}
    </div>
  );
}

export function OrDivider() {
  return (
    <div className="my-5 flex items-center gap-3 text-sm text-muted">
      <span className="h-px flex-1 bg-line" />
      or
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
