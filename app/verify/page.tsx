"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function VerifyRedirectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const phone = searchParams.get("phone");
    const query = phone ? `?phone=${encodeURIComponent(phone)}` : "";
    router.replace(`/otp${query}`);
  }, [router, searchParams]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#FFE3C2] px-4 py-10">
      <div className="rounded-xl bg-white px-6 py-4 shadow-md text-sm text-slate-700">
        Redirecting to the OTP screen...
      </div>
    </main>
  );
}
