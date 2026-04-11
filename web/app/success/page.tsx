"use client";

import Image from "next/image";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import SuccessClient from "./SuccessClient";
import logo from "@/public/kaun-karega-logo.svg";

export default function SuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 px-4 py-8">
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center">
            <Image
              src={logo}
              alt="Kaun Karega logo"
              priority
              className="mb-8 w-full max-w-[360px] md:max-w-[460px]"
            />
            <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
              Loading...
            </div>
          </div>
        </div>
      }
    >
      <SuccessPageContent />
    </Suspense>
  );
}

function SuccessPageContent() {
  const sp = useSearchParams();
  const service = (sp.get("service") || "").trim();
  const area = (sp.get("area") || "").trim();
  const taskId = (sp.get("taskId") || "").trim();
  const displayId = (sp.get("displayId") || "").trim();
  const userPhone = (sp.get("userPhone") || "").trim();
  const status = (sp.get("status") || "").trim();
  const requestRef = (sp.get("ref") || "").trim();

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center">
        <Image
          src={logo}
          alt="Kaun Karega logo"
          priority
          className="mb-8 w-full max-w-[360px] md:max-w-[460px]"
        />
        <SuccessClient
          service={service}
          area={area}
          taskId={taskId}
          displayId={displayId}
          userPhone={userPhone}
          status={status}
          requestRef={requestRef}
        />
      </div>
    </div>
  );
}
