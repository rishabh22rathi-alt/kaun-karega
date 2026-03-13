"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthSession } from "@/lib/auth";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const session = getAuthSession();
    if (!session?.phone) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          Redirecting to login...
        </div>
      </div>
    );
  }

  return <main>{children}</main>;
}
