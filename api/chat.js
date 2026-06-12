export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, system } = req.body;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set in Vercel environment variables' });

    // Use v1beta with gemini-2.0-flash-lite — highest free quota
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:streamGenerateContent?alt=sse&key=${apiKey}`;

    // Filter out empty messages and ensure valid alternating roles
    const validMessages = [];
    let lastRole = null;
    for (const m of messages) {
      if (!m.content || !m.content.trim()) continue;
      const role = m.role === 'assistant' ? 'model' : 'user';
      if (role === lastRole) continue; // skip duplicates
      validMessages.push({ role, parts: [{ text: m.content }] });
      lastRole = role;
    }

    // Must start with user
    if (validMessages.length === 0 || validMessages[0].role !== 'user') {
      return res.status(400).json({ error: 'Conversation must start with a user message' });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: system || `You are StreamChat, a helpful AI assistant. Today is ${new Date().toDateString()}. Use rich markdown formatting.` }]
        },
        contents: validMessages,
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: 0.9,
        }
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = err?.error?.message || `Gemini API error ${response.status}`;
      if (response.status === 429) {
        return res.status(429).json({ error: 'Rate limit hit — wait a few seconds and try again. Free tier allows 15 requests/min.' });
      }
      return res.status(response.status).json({ error: msg });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sentStop = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            res.write(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`);
          }
          const finishReason = parsed?.candidates?.[0]?.finishReason;
          if (finishReason && !sentStop) {
            sentStop = true;
            res.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
          }
        } catch {}
      }
    }

    if (!sentStop) {
      res.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
    }
    res.end();
  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: err.message });
  }
}

export const config = {
  api: { bodyParser: true, responseLimit: false },
};
