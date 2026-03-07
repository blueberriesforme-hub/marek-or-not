// roast.js — Netlify Function
// When a verdict is flagged as wrong, generates a funny one-liner about the image vs. Marek.

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "Missing API key." }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON." }) };
  }

  const { imageBase64, mediaType } = body;
  if (!imageBase64 || !mediaType) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing image data." }) };
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 120,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: imageBase64 },
              },
              {
                type: "text",
                text: `Look at this image. Write ONE short, funny sentence in exactly this format:
"[Describe what this image actually shows, e.g. 'This image of a tabby cat' or 'This photo of a sunset over the ocean'] is not Marek, but [something Marek R. is probably doing right now that would be more like him — adventurous, outdoorsy, traveling, hiking, skiing, that sort of thing]."

Examples of the style:
"This image of a plate of spaghetti is not Marek, but a photo of him free-climbing a cliff face in Croatia would score a solid 94."
"This photo of a golden retriever is not Marek, but Marek is probably out there somewhere in the Alps right now, so the resemblance is understandable."

Reply with ONLY the one sentence. No quotes around it, no extra text.`,
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: "Claude error." }) };
    }

    const data = await res.json();
    const oneliner = data.content?.[0]?.text?.trim() ?? "";
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oneliner }),
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: "Failed to generate roast." }) };
  }
}
