import { NextResponse } from "next/server";

// Disabled duplicate. The canonical Meta WhatsApp Cloud API webhook is
// /api/whatsapp-webhook (which verifies the hub.mode handshake and
// persists payloads to `whatsapp_inbound`). This URL existed only as an
// older stub that returned 200 without doing anything. Returning 410 Gone
// here makes it loud if Meta is still pointed at the wrong URL.
function gone() {
  return NextResponse.json(
    {
      ok: false,
      error: "Disabled. Configure Meta to POST /api/whatsapp-webhook.",
    },
    { status: 410 }
  );
}

export async function GET() {
  return gone();
}

export async function POST() {
  return gone();
}
