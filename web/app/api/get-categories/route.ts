import { getAllCategories } from "@/lib/googleSheets";

export async function GET() {
  try {
    const categories = await getAllCategories();
    return Response.json({ categories });
  } catch (error: any) {
    console.error("get-categories error", error);
    return Response.json(
      { error: error?.message || "Failed to fetch categories" },
      { status: 500 }
    );
  }
}
