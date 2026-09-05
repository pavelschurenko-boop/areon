/**
 * Cloudflare Worker proxy for the YouScore "Registration data" API.
 *
 * Keeps the YouScore API key server-side (as a Worker secret) so it never
 * ships in the client-side JS served from GitHub Pages. The frontend calls
 * this worker instead of api.youscore.com.ua directly.
 *
 * Deploy: see YouScore/worker/README.md
 */

// Only digits are valid for an EDRPOU code (8 digits) or an individual's
// RNOKPP/tax number (10 digits) - reject anything else before it reaches
// the upstream URL path.
const CODE_PATTERN = /^[0-9]{5,15}$/;

export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return json({ message: "Method not allowed" }, 405, corsHeaders);
    }

    const url = new URL(request.url);
    const match = url.pathname.match(/^\/usr\/([^/]+)$/);
    if (!match) {
      return json({ message: "Expected path /usr/{contractorCode}" }, 400, corsHeaders);
    }

    const code = decodeURIComponent(match[1]);
    if (!CODE_PATTERN.test(code)) {
      return json({ message: "Invalid contractor code format" }, 400, corsHeaders);
    }

    if (!env.YOUSCORE_API_KEY) {
      return json({ message: "Server misconfiguration: missing API key" }, 500, corsHeaders);
    }

    const showCurrentData = url.searchParams.get("showCurrentData") === "true" ? "true" : "false";
    const upstreamUrl =
      `https://api.youscore.com.ua/v1/usr/${encodeURIComponent(code)}` +
      `?showCurrentData=${showCurrentData}&apiKey=${env.YOUSCORE_API_KEY}`;

    let upstreamResp;
    try {
      upstreamResp = await fetch(upstreamUrl, { headers: { accept: "application/json" } });
    } catch (err) {
      return json({ message: "Upstream request failed", detail: String(err) }, 502, corsHeaders);
    }

    const body = await upstreamResp.text();
    return new Response(body, {
      status: upstreamResp.status,
      headers: {
        ...corsHeaders,
        "Content-Type": upstreamResp.headers.get("Content-Type") || "application/json",
      },
    });
  },
};

function json(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
