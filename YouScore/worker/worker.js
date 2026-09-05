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
      // Without this, the browser only exposes the CORS-safelisted response
      // headers to JS (e.g. Content-Type) - the frontend's technical-details
      // panel needs the rest (rate-limit headers, CF-Ray, etc.) too.
      "Access-Control-Expose-Headers": "*",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return json({ message: "Method not allowed" }, 405, corsHeaders);
    }

    if (!env.YOUSCORE_API_KEY) {
      return json({ message: "Server misconfiguration: missing API key" }, 500, corsHeaders);
    }

    const url = new URL(request.url);

    // usr = "Реєстраційні дані" (registration data), vat = "Податкові дані" (VAT payer status).
    // Both take the contractor code as a path segment.
    const pathMatch = url.pathname.match(/^\/(usr|vat)\/([^/]+)$/);
    if (pathMatch) {
      const [, method, rawCode] = pathMatch;
      const code = decodeURIComponent(rawCode);
      if (!CODE_PATTERN.test(code)) {
        return json({ message: "Invalid contractor code format" }, 400, corsHeaders);
      }
      const showCurrentData = url.searchParams.get("showCurrentData") === "true" ? "true" : "false";
      const upstreamUrl =
        `https://api.youscore.com.ua/v1/${method}/${encodeURIComponent(code)}` +
        `?showCurrentData=${showCurrentData}&apiKey=${env.YOUSCORE_API_KEY}`;
      return proxyUpstream(upstreamUrl, corsHeaders);
    }

    // licenses = "Ліцензії" (company/FOP licenses). Unlike usr/vat, the
    // contractor code is a query param here, not a path segment, matching
    // YouScore's own GET /v1/licenses?contractorCode=... shape.
    if (url.pathname === "/licenses") {
      const code = url.searchParams.get("contractorCode") || "";
      if (!CODE_PATTERN.test(code)) {
        return json({ message: "Invalid or missing contractorCode" }, 400, corsHeaders);
      }

      const upstream = new URL("https://api.youscore.com.ua/v1/licenses");
      upstream.searchParams.set("contractorCode", code);

      const top = url.searchParams.get("top");
      if (top !== null) {
        if (!/^\d{1,3}$/.test(top) || Number(top) > 100) {
          return json({ message: "Invalid 'top' (must be an integer 0-100)" }, 400, corsHeaders);
        }
        upstream.searchParams.set("top", top);
      }

      const skip = url.searchParams.get("skip");
      if (skip !== null) {
        if (!/^\d+$/.test(skip)) {
          return json({ message: "Invalid 'skip'" }, 400, corsHeaders);
        }
        upstream.searchParams.set("skip", skip);
      }

      const onlyActive = url.searchParams.get("onlyActive");
      if (onlyActive !== null) {
        upstream.searchParams.set("onlyActive", onlyActive === "true" ? "true" : "false");
      }

      for (const registryId of url.searchParams.getAll("registers")) {
        if (!/^\d+$/.test(registryId)) {
          return json({ message: "Invalid 'registers' value" }, 400, corsHeaders);
        }
        upstream.searchParams.append("registers", registryId);
      }

      upstream.searchParams.set("apiKey", env.YOUSCORE_API_KEY);
      return proxyUpstream(upstream.toString(), corsHeaders);
    }

    return json(
      { message: "Expected path /usr/{contractorCode}, /vat/{contractorCode}, or /licenses?contractorCode=..." },
      400,
      corsHeaders
    );
  },
};

async function proxyUpstream(upstreamUrl, corsHeaders) {
  let upstreamResp;
  try {
    upstreamResp = await fetch(upstreamUrl, { headers: { accept: "application/json" } });
  } catch (err) {
    return json({ message: "Upstream request failed", detail: String(err) }, 502, corsHeaders);
  }

  // Forward every header YouScore actually sent (status code, rate-limit
  // headers, CF-Ray, etc.) instead of just Content-Type, so the client
  // sees the real upstream response, not a trimmed-down version of it.
  const responseHeaders = new Headers(corsHeaders);
  const HOP_BY_HOP = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"]);
  for (const [key, value] of upstreamResp.headers.entries()) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    responseHeaders.set(key, value);
  }
  if (!responseHeaders.has("Content-Type")) {
    responseHeaders.set("Content-Type", "application/json");
  }

  const body = await upstreamResp.text();
  return new Response(body, {
    status: upstreamResp.status,
    statusText: upstreamResp.statusText,
    headers: responseHeaders,
  });
}

function json(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
