export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, system } = req.body;

    // Convert messages to Gemini format
    const geminiMessages = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: geminiMessages,
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: 0.9,
        }
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err?.error?.message || 'Gemini API error' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
            // Emit in Anthropic-compatible SSE format so frontend works unchanged
            res.write(`data: ${JSON.stringify({
              type: 'content_block_delta',
              delta: { type: 'text_delta', text }
            })}\n\n`);
          }
          const finishReason = parsed?.candidates?.[0]?.finishReason;
          if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
            // keep going
          }
          if (finishReason === 'STOP' || finishReason === 'MAX_TOKENS') {
            res.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
          }
        } catch {}
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export const config = {
  api: { bodyParser: true, responseLimit: false },
};
