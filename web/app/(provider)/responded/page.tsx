"use client";

"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RespondedPage() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const role = localStorage.getItem("kk_user_role");
    if (role !== "provider") {
      router.replace("/");
    }
  }, [router]);

  return (
    <div className="bg-white rounded-2xl shadow-md p-6">
      <h1 className="text-xl font-bold text-[#0EA5E9]">Requests Responded</h1>
      <p className="text-slate-700 mt-2 text-sm">
        This is a placeholder. Your responded requests will appear here soon.
      </p>
    </div>
  );
}
