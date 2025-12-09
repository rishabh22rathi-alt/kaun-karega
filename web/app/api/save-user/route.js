export async function POST(req) {
  const { phone } = await req.json();

  const scriptUrl = "https://script.google.com/macros/s/AKfycbxBgBvDIkg_B267YqQ2rwaPvrkMLbmtnqa7AwomGKHhaT_JS81bL_Fge5PxSfY2eOeyBg/exec";

  await fetch(scriptUrl, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      type: "user_register",
      phone: phone,
      date: new Date().toLocaleString()
    })
  });

  return new Response(JSON.stringify({ success: true }), { status: 200 });
}
