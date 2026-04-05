"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const nextPath = searchParams.get("next") || "/admin/dashboard";
    router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
  }, [router, searchParams]);

  return null;
}
