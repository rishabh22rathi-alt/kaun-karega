import type { ReactNode } from "react";

export default function ProviderLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex">
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
