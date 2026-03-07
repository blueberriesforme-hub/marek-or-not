// upload-reference.js — Netlify Function
// Admin-only: uploads a reference photo to Supabase Storage and records its URL.

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!ADMIN_PASSWORD || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server misconfigured — missing env vars." }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body." }) };
  }

  const { adminPassword, imageBase64, mediaType, filename } = body;

  // 1. Validate admin password
  if (!adminPassword || adminPassword !== ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: "Invalid admin password." }) };
  }

  if (!imageBase64 || !mediaType || !filename) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing imageBase64, mediaType, or filename." }),
    };
  }

  // 2. Upload image bytes to Supabase Storage
  const imageBytes = Buffer.from(imageBase64, "base64");
  const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

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
    const errText = await uploadRes.text();
    console.error("Supabase upload error:", errText);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Failed to upload to storage." }),
    };
  }

  // 3. Build public URL
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/marek-reference/${safeName}`;

  // 4. Insert record into marek_photos table
  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/marek_photos`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ url: publicUrl, filename: safeName }),
  });

  if (!insertRes.ok) {
    const errText = await insertRes.text();
    console.error("Supabase insert error:", errText);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Uploaded but failed to record in database." }),
    };
  }

  const [row] = await insertRes.json();

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ success: true, url: publicUrl, id: row.id }),
  };
}
