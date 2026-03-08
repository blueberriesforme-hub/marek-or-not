// identify.js — Netlify Function
// Calls Claude vision API to determine if a photo contains Marek.
// No photos are stored server-side; only anonymous verdict metadata is logged.

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
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

  const { imageBase64, mediaType } = body;
  if (!imageBase64 || !mediaType) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing imageBase64 or mediaType." }),
    };
  }

  // 1. Fetch reference photo URLs from Supabase
  let referenceUrls = [];
  try {
    const refRes = await fetch(
      `${SUPABASE_URL}/rest/v1/marek_photos?select=url&order=created_at.desc&limit=5`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    if (refRes.ok) {
      const rows = await refRes.json();
      referenceUrls = rows.map((r) => r.url);
    }
  } catch (err) {
    console.error("Failed to fetch reference photos:", err);
  }

  // 2. Build Claude message content
  // Reference photos come first, then the test photo
  const contentBlocks = [];

  if (referenceUrls.length > 0) {
    contentBlocks.push({
      type: "text",
      text: `These are reference photos of the person named Marek R. Study his facial features carefully — jawline, eye spacing, nose shape, cheekbones, and any distinctive characteristics. There are ${referenceUrls.length} reference photo(s):`,
    });
    for (const url of referenceUrls) {
      contentBlocks.push({
        type: "image",
        source: { type: "url", url },
      });
    }
  } else {
    contentBlocks.push({
      type: "text",
      text: "No reference photos are available yet. Score the test photo as 50 with low confidence.",
    });
  }

  contentBlocks.push({
    type: "text",
    text: `Now examine this test photo and compare it to the reference photos above. Respond ONLY with a JSON object — no markdown, no explanation, just raw JSON:\n{\n  "marekscore": <integer 0-100>,\n  "isMarek": <boolean — true if marekscore >= 60>,\n  "confidence": "<high|medium|low>",\n  "reason": "<one concise sentence about the facial features you observe — do NOT mention 'reference photos', 'reference images', 'hairline', or 'receding hairline', just describe what you see>"\n}\n\nScoring guide: 100 = definitely Marek, 0 = definitely not Marek, 50–65 = could be a close relative or sibling. Base your score purely on facial feature similarity. If there is no visible face, return marekscore 0 with low confidence.`,
  });

  contentBlocks.push({
    type: "image",
    source: {
      type: "base64",
      media_type: mediaType,
      data: imageBase64,
    },
  });

  // 3. Call Claude
  let result;
  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 256,
        messages: [{ role: "user", content: contentBlocks }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error("Claude API error:", errText);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Claude API error. Please try again." }),
      };
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content?.[0]?.text ?? "";

    // Strip any accidental markdown fences
    const jsonText = rawText.replace(/```(?:json)?/gi, "").trim();
    result = JSON.parse(jsonText);
  } catch (err) {
    console.error("Claude parse error:", err);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Failed to parse Claude response." }),
    };
  }

  // Enforce isMarek derived from score
  result.isMarek = result.marekscore >= 60;

  // 4. Log verdict anonymously to Supabase (no photo stored)
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/marek_verdicts`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        is_marek: result.isMarek,
        marekness_score: result.marekscore,
        confidence: result.confidence,
      }),
    });
  } catch (err) {
    console.error("Failed to log verdict:", err);
    // Non-fatal — still return result to user
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result),
  };
}
