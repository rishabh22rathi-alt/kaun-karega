"use client";

"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function ChooseRolePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phone, setPhone] = useState("");

  const phoneDigits = useMemo(() => phone.replace(/\D/g, "").slice(0, 10), [phone]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const role = localStorage.getItem("kk_user_role");
      if (role === "provider") {
        router.replace("/dashboard");
        return;
      }
      if (role === "receiver") {
        router.replace("/");
        return;
      }
    }

    const fromQuery = searchParams.get("phone");
    if (fromQuery) {
      setPhone(fromQuery);
      return;
    }
    if (typeof window === "undefined") return;
    const cached =
      localStorage.getItem("kk_last_phone") || localStorage.getItem("kk_user_phone");
    if (cached) {
      setPhone(cached);
    }
  }, [router, searchParams]);

  const goTo = (path: string) => {
    if (!phoneDigits) {
      router.push("/login");
      return;
    }
    const url = `${path}?phone=${encodeURIComponent(phoneDigits)}`;
    router.push(url);
  };

  return (
    <main className="min-h-screen bg-[#FFE3C2] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-lg p-8 space-y-6">
        <header className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-[#0EA5E9]">Choose your role</h1>
          <p className="text-slate-600 text-sm">
            We found a new account for {phoneDigits || "your number"}. Continue as:
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <button
            type="button"
            onClick={() => goTo("/register/provider")}
            className="rounded-2xl border-2 border-[#0EA5E9] bg-[#0EA5E9]/5 px-5 py-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <p className="text-sm uppercase tracking-wide text-[#0EA5E9]">Service Provider</p>
            <p className="text-lg font-semibold text-slate-900">I want to offer services</p>
          </button>

          <button
            type="button"
            onClick={() => goTo("/register/receiver")}
            className="rounded-2xl border-2 border-orange-400 bg-orange-50 px-5 py-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <p className="text-sm uppercase tracking-wide text-orange-500">
              Service Receiver
            </p>
            <p className="text-lg font-semibold text-slate-900">I need help with tasks</p>
          </button>
        </div>
      </div>
    </main>
  );
}

