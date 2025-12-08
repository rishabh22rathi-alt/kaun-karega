export async function POST() {
  return new Response(
    JSON.stringify({
      success: false,
      message: "Deprecated route. Use /api/verify-otp instead.",
    }),
    { status: 410, headers: { "Content-Type": "application/json" } }
  );
}
