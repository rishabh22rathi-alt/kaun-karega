export async function POST(req: Request) {
  try {
    const { phone } = await req.json();

    const sheetURL =
      "https://script.google.com/macros/s/AKfycbvDoOco3vTIU44KDUjPky0bIEyISdFZnBPfmzKFUXNLMRpe41lYYJaf-hAk3ZsBb8ew3w/exec";

    await fetch(sheetURL, {
      method: "POST",
      body: JSON.stringify({ phone }),
      headers: { "Content-Type": "application/json" },
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error("Registration Error:", error);
    return Response.json({ success: false, error });
  }
}
