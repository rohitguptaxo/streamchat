export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, system } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured in Vercel' });
    }

    // Build valid alternating user/model conversation
    const validMessages = [];
    let lastRole = null;
    for (const m of messages) {
      if (!m.content?.trim()) continue;
      const role = m.role === 'assistant' ? 'model' : 'user';
      if (role === lastRole) {
        // Merge consecutive same-role messages
        validMessages[validMessages.length - 1].parts[0].text += '\n' + m.content;
        continue;
      }
      validMessages.push({ role, parts: [{ text: m.content }] });
      lastRole = role;
    }

    if (!validMessages.length || validMessages[0].role !== 'user') {
      return res.status(400).json({ error: 'No valid messages' });
    }

    const systemPrompt = system || `You are StreamChat, a helpful AI assistant. Today is ${new Date().toDateString()}. Use rich markdown formatting — headers, lists, bold, code blocks where appropriate.`;

    // Try models in order of preference
    const models = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'];
    let response = null;
    let lastError = null;

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: validMessages,
            generationConfig: { maxOutputTokens: 8192, temperature: 0.9 },
          }),
        });
        if (response.ok) break;
        const errBody = await response.json().catch(() => ({}));
        lastError = errBody?.error?.message || `HTTP ${response.status}`;
        if (response.status === 429) {
          // Try next model
          response = null;
          continue;
        }
        break;
      } catch (e) {
        lastError = e.message;
        response = null;
      }
    }

    if (!response || !response.ok) {
      return res.status(429).json({
        error: lastError?.includes('quota') || lastError?.includes('429')
          ? 'Rate limit reached. Wait 30 seconds and try again (free tier: 15 req/min).'
          : lastError || 'All models unavailable'
      });
    }

    // Stream the response
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

    if (!sentStop) res.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
    res.end();

  } catch (err) {
    console.error('Handler error:', err);
    res.status(500).json({ error: err.message });
  }
}

export const config = {
  api: { bodyParser: true, responseLimit: false },
};
