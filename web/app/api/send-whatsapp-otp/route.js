export async function POST(req) {
  try {
    const { phone } = await req.json();

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000);

    // WhatsApp API credentials
    const TOKEN = "EAAWaMwUfNuEBP8vVbtkZCchzCzVXeZCtqK0WEnD6qUtb4kEZBACll1ZBq3YZBo2TUEcFWWy2a4a7JeI3mvQEd3xlCxcLcn7OTtI9VjyzPx5ZCqV90zSag14B75WrBFcbToGFYt2NlkDQjCcjcgZBQ0ZBgsfmGv6gxDb3eNd2Wd3e6fSDRvnJruHckb1MwPPW5TjhViztWJglYEHlUBciE7nKpwQbGKB2j7JCd2YhOTR6enXNmZBWyxEHKgU4RXmh8YgZDZD";
    const PHONE_NUMBER_ID = "819389651266958";

    const url = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;

    // WhatsApp API Request
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: `+91${phone}`,
        type: "text",
        text: {
          body: `Your Kaun Karega OTP is: ${otp}`,
        },
      }),
    });

    const data = await response.json();
    console.log("WHATSAPP API RESPONSE:", data);

    // If WhatsApp API fails
    if (!response.ok) {
      return new Response(JSON.stringify({ success: false, error: data }), {
        status: 500,
      });
    }

    // Save OTP to Google Sheet
    await fetch(
      "https://script.google.com/macros/s/AKfycbx4NqCSevXZ0JbanQJlRiYKyx6uk0448V6_-zxluldWiNi2mPCBOHCyi-9AikbYrxW79A/exec",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, otp, type: "save_otp" }),
      }
    );

    return new Response(JSON.stringify({ success: true }), { status: 200 });

  } catch (error) {
    console.error("WhatsApp OTP Error:", error);
    return new Response(JSON.stringify({ success: false }), { status: 500 });
  }
}
