import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";

// Canonical Meta WhatsApp Cloud API webhook. Verifies subscription via the
// hub.mode handshake and persists every inbound delivery to
// `whatsapp_inbound` (see docs/migrations/whatsapp-inbound.sql) before
// returning 200. Returning 200 even on persistence failure is intentional:
// Meta retries non-2xx, and we don't want a transient DB blip to make Meta
// duplicate-deliver every status callback.
//
// The duplicate route at /api/webhook/whatsapp is intentionally disabled.

type WhatsAppEntry = {
  changes?: Array<{
    value?: {
      messaging_product?: string;
      messages?: Array<{
        id?: string;
        from?: string;
        to?: string;
        type?: string;
      }>;
      statuses?: Array<{
        id?: string;
        status?: string;
        recipient_id?: string;
      }>;
      contacts?: Array<{ wa_id?: string }>;
      metadata?: { display_phone_number?: string; phone_number_id?: string };
    };
  }>;
};

type WhatsAppWebhookBody = {
  object?: string;
  entry?: WhatsAppEntry[];
};

function extractFingerprint(payload: WhatsAppWebhookBody) {
  const change = payload?.entry?.[0]?.changes?.[0]?.value;
  const message = change?.messages?.[0];
  const status = change?.statuses?.[0];
  const contact = change?.contacts?.[0];
  const metadata = change?.metadata;
  return {
    messageId: String(message?.id || status?.id || "").trim() || null,
    status: String(status?.status || "").trim() || null,
    fromPhone:
      String(message?.from || contact?.wa_id || "").trim() || null,
    toPhone:
      String(message?.to || status?.recipient_id || metadata?.display_phone_number || "")
        .trim() || null,
    templateName: null as string | null,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WA_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  let payload: WhatsAppWebhookBody | null = null;
  try {
    payload = (await req.json()) as WhatsAppWebhookBody;
  } catch {
    payload = null;
  }

  // Always ack with 200 — Meta retries on non-2xx and we don't want a
  // body-parse failure to cause duplicate deliveries.
  if (!payload) {
    console.warn("[whatsapp-webhook] empty or non-JSON payload");
    return NextResponse.json({ status: "ok" });
  }

  const fingerprint = extractFingerprint(payload);

  try {
    const { error } = await adminSupabase.from("whatsapp_inbound").insert({
      source: "meta_webhook",
      message_id: fingerprint.messageId,
      status: fingerprint.status,
      from_phone: fingerprint.fromPhone,
      to_phone: fingerprint.toPhone,
      template_name: fingerprint.templateName,
      payload,
    });
    if (error) {
      console.warn(
        "[whatsapp-webhook] persist failed",
        error.message || error
      );
    }
  } catch (err) {
    console.warn(
      "[whatsapp-webhook] persist threw",
      err instanceof Error ? err.message : err
    );
  }

  return NextResponse.json({ status: "ok" });
}
