import { getChatRoom, getReview, saveReview } from "@/lib/googleSheets";

type SubmitPayload = {
  roomId?: string;
  reviewerPhone?: string;
  reviewerRole?: "user" | "provider" | string;
  rating?: number;
  reviewText?: string;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const roomId = url.searchParams.get("roomId") || "";
  const reviewerPhone = url.searchParams.get("reviewerPhone") || "";

  if (!roomId || !reviewerPhone) {
    return Response.json(
      { ok: false, error: "roomId and reviewerPhone required" },
      { status: 400 }
    );
  }

  try {
    const review = await getReview(roomId, reviewerPhone);
    return Response.json({ ok: true, review });
  } catch (error) {
    console.error("Get review error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { roomId, reviewerPhone, reviewerRole, rating, reviewText = "" }: SubmitPayload =
      await req.json();

    if (!roomId || !reviewerPhone || !reviewerRole || typeof rating !== "number") {
      return Response.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (reviewerRole !== "user" && reviewerRole !== "provider") {
      return Response.json({ ok: false, error: "Invalid reviewerRole" }, { status: 400 });
    }

    if (rating < 1 || rating > 5) {
      return Response.json({ ok: false, error: "Rating must be 1-5" }, { status: 400 });
    }

    const chatRoom = await getChatRoom(roomId);
    if (!chatRoom) {
      return Response.json({ ok: false, error: "Chat not found" }, { status: 404 });
    }

    const now = Date.now();
    const expired = chatRoom.expiresAt
      ? now > new Date(chatRoom.expiresAt).getTime()
      : false;

    if (!expired) {
      return Response.json({ ok: false, error: "Chat still active" }, { status: 400 });
    }

    const allowed =
      reviewerPhone === chatRoom.userPhone ||
      reviewerPhone === chatRoom.providerPhone;

    if (!allowed) {
      return Response.json(
        { ok: false, error: "Not authorized for this chat" },
        { status: 403 }
      );
    }

    const result = await saveReview({
      roomId,
      reviewerPhone,
      reviewerRole,
      rating,
      reviewText,
    });

    if (result.duplicate) {
      return Response.json({ ok: false, duplicate: true });
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Submit review error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
