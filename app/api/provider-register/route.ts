const SHEET_URL =
  "https://script.google.com/macros/s/AKfycbyrd-7JlVYKIyr34TQrDRXiXfP0ol775obinGnd23N1apzBVmO4jZ5O6Xb8TqfaYdPF/exec";

export async function POST(req: Request) {
  try {
    const { name, phone, services, areas } = await req.json();

    if (
      !name ||
      !phone ||
      !Array.isArray(services) ||
      services.length === 0 ||
      services.length > 5 ||
      !Array.isArray(areas) ||
      areas.length === 0 ||
      areas.length > 10
    ) {
      return Response.json(
        { success: false, error: "Invalid provider payload" },
        { status: 400 }
      );
    }

    const response = await fetch(SHEET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "save_provider",
        name,
        phone,
        services: services.join(", "),
        areas: areas.join(", "),
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to forward provider data");
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error("Provider register error:", error);
    return Response.json({ success: false }, { status: 500 });
  }
}
