import { ADMIN_KEY, appsScriptGet } from "./client";

export type Review = {
  roomId: string;
  reviewerPhone: string;
  reviewerRole: string;
  rating: number;
  reviewText: string;
  timestamp: string;
};

export async function getAllReviews(): Promise<Review[]> {
  if (!ADMIN_KEY) {
    console.warn("NEXT_PUBLIC_ADMIN_KEY is not set");
  }
  try {
    return await appsScriptGet<Review[]>("reviews/getAll", {}, { admin: true });
  } catch (err) {
    console.error("getAllReviews error", err);
    return [];
  }
}
