import { NextRequest, NextResponse } from "next/server";
import { appsScriptPost } from "@/lib/api/client";

export async function POST(req: NextRequest) {
  try {
    const { name, phone, categories, areas, providerId } = await req.json();

    if (
      !name ||
      !phone ||
      !Array.isArray(categories) ||
      categories.length === 0 ||
      !Array.isArray(areas) ||
      areas.length === 0
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid provider payload" },
        { status: 400 }
      );
    }

    const result = await appsScriptPost<{ success?: boolean; error?: string }>(
      "providers/register",
      {
        id: providerId,
        name,
        phone,
        categories,
        areas,
      },
      { admin: true }
    );

    if (!result?.success) {
      throw new Error(result?.error || "Unable to register provider");
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json(
      { success: false, message },
      { status: 500 }
    );
  }
}
