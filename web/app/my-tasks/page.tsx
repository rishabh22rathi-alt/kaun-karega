"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MyTasksPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/my-requests");
    router.refresh();
  }, [router]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        Redirecting to Responses...
      </div>
    </main>
  );
}
