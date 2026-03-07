// upload-decor.js — Netlify Function
// Admin-only: uploads a decoration photo to Supabase Storage (decor/ prefix).

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const ADMIN_PASSWORD    = process.env.ADMIN_PASSWORD;
  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!ADMIN_PASSWORD || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server misconfigured." }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON." }) }; }

  const { adminPassword, imageBase64, mediaType, filename } = body;

  if (!adminPassword || adminPassword !== ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: "Invalid admin password." }) };
  }
  if (!imageBase64 || !mediaType || !filename) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields." }) };
  }

  const imageBytes = Buffer.from(imageBase64, "base64");
  const safeName = `decor/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  const uploadRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/marek-reference/${safeName}`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": mediaType,
        "Cache-Control": "3600",
      },
      body: imageBytes,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    console.error("Storage upload error:", err);
    return { statusCode: 502, body: JSON.stringify({ error: "Storage upload failed." }) };
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/marek-reference/${safeName}`;

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/marek_decor_photos`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ url: publicUrl, filename }),
  });

  if (!insertRes.ok) {
    return { statusCode: 502, body: JSON.stringify({ error: "DB insert failed." }) };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ success: true, url: publicUrl }),
  };
}
