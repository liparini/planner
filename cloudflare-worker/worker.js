export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-App-Token",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    let body;
    try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    const { to, message, appToken } = body;
    if (env.APP_TOKEN && appToken !== env.APP_TOKEN) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!to || !message) return new Response(JSON.stringify({ error: "Missing to or message" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const phone = to.replace(/\D/g, "");
    const sid = env.TWILIO_ACCOUNT_SID;
    const token = env.TWILIO_AUTH_TOKEN;
    const from = env.TWILIO_FROM;
    if (!sid || !token || !from) return new Response(JSON.stringify({ error: "Twilio not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const params = new URLSearchParams({ From: from, To: `whatsapp:+${phone}`, Body: message });
    try {
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Authorization": "Basic " + btoa(`${sid}:${token}`) },
        body: params.toString(),
      });
      const data = await resp.json();
      if (!resp.ok) return new Response(JSON.stringify({ error: data.message, code: data.code }), { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ ok: true, sid: data.sid }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Failed to reach Twilio" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }
};
