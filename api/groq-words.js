// Cloudflare Pages Function: POST /api/groq-words
// Body: { letters: string[], count?: number }
// Returns: { words: string[] }
//
// Requires an environment variable GROQ_API_KEY set in your Cloudflare Pages
// project (Settings -> Environment variables -> Production/Preview).
// Get a key at https://console.groq.com/keys

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'invalid_json' }, 400);
  }

  // letters is optional now: when the caller passes specific letters (the
  // "fix these letters" flow) we build a letter-constrained prompt; when it's
  // empty (the "AI Passage" flow) we just ask for a general 20-word passage.
  const letters = Array.isArray(body.letters) ? body.letters.filter(Boolean).slice(0, 8) : [];
  const count = Math.min(Math.max(parseInt(body.count) || 12, 5), 20);

  if (!env.GROQ_API_KEY) {
    // No key configured on this deployment — let the client fall back to its
    // local word list instead of failing the whole feature.
    return json({ error: 'missing_api_key' }, 501);
  }

  const prompt = letters.length
    ? ('Generate exactly ' + count + ' common, real, everyday Hindi words written in Devanagari script. ' +
       'Each word MUST contain at least one of these exact characters/matras: ' + letters.join(' ') + '. ' +
       'Rules: only real dictionary Hindi words (no proper nouns, no English, no made-up words), ' +
       'each word 2-6 letters long, no duplicates, no explanations. ' +
       'Respond with ONLY a JSON array of strings, nothing else. Example: ["शब्द","शिक्षा","किताब"]')
    : ('Generate exactly ' + count + ' common, real, everyday Hindi words written in Devanagari script, ' +
       'forming a natural mix suitable for a typing-practice passage (mix of nouns, verbs and adjectives, ' +
       'everyday topics, varied difficulty). ' +
       'Rules: only real dictionary Hindi words (no proper nouns, no English, no made-up words), ' +
       'each word 2-7 letters long, no duplicates, no explanations. ' +
       'Respond with ONLY a JSON array of strings, nothing else. Example: ["शब्द","शिक्षा","किताब"]');

  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + env.GROQ_API_KEY
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.6,
        max_tokens: 500
      })
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return json({ error: 'groq_error', detail }, 502);
    }

    const data = await resp.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';

    let words = [];
    try {
      const match = text.match(/\[[\s\S]*\]/);
      words = JSON.parse(match ? match[0] : text);
    } catch (e) {
      words = text.split(/[\n,،]+/).map(s => s.replace(/["'\[\]]/g, '').trim()).filter(Boolean);
    }

    words = words
      .filter(w => typeof w === 'string' && /[\u0900-\u097F]/.test(w))
      .map(w => w.trim())
      .filter(Boolean)
      .slice(0, count);

    return json({ words });
  } catch (e) {
    return json({ error: 'server_error', detail: String(e) }, 500);
  }
}

export async function onRequestGet() {
  return json({ error: 'use_post' }, 405);
}
