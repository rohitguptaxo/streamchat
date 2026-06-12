# ✦ StreamChat

A high-performance real-time AI chat interface built with React.

![StreamChat](https://img.shields.io/badge/React-18-blue) ![Streaming](https://img.shields.io/badge/Streaming-SSE-yellow) ![Auth](https://img.shields.io/badge/Auth-LocalStorage-green)

## Features

- **Token-by-token streaming** — real-time SSE streaming from Claude API
- **Authentication** — sign up / sign in / sign out with per-user chat isolation
- **Live web search** — toggle real-time web results via Anthropic's web search tool
- **Persistent threads** — chat history saved per user in localStorage
- **Markdown rendering** — headers, code blocks with copy, lists, links, blockquotes
- **Model switcher** — swap between Claude Sonnet 4 and Opus 4
- **8,000 max tokens** — long, thorough responses
- **Token stats** — live tokens/second counter and session totals
- **Quick prompts** — world news, markets, weather, tech, sports, and more

## Tech Stack

- **React 18** — functional components + hooks
- **Zustand-lite** — custom lightweight state store (same API pattern)
- **Anthropic Claude API** — streaming messages endpoint
- **Web Search Tool** — `web_search_20250305`
- **Vite** — development and build
- **Tailwind-inspired** — all styles inline, no build step for CSS

## Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| Yellow | `#FFCE32` | Top bar, input area, logo, accents |
| Prussian Blue | `#1D63FF` | Buttons, links, assistant bubbles, badges |
| Dark Navy | `#0A1628` | Sidebar background |

## Getting Started

```bash
npm install
npm run dev
```

The app uses the Anthropic API via the claude.ai artifact proxy — no API key config needed when running inside Claude artifacts.

For standalone deployment, add your API key to a `.env` file:

```
VITE_ANTHROPIC_API_KEY=sk-ant-...
```

And update the fetch headers in `streaming-chat.jsx`:

```js
headers: {
  "Content-Type": "application/json",
  "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
  "anthropic-version": "2023-06-01",
}
```

## Project Structure

```
streamchat/
├── streaming-chat.jsx   # Main app component (all-in-one)
├── src/
│   └── main.jsx         # React entry point
├── index.html           # HTML shell
├── vite.config.js       # Vite config
└── package.json
```

## Auth System

Accounts are stored in `localStorage` — fully client-side, no backend needed.
Each user's chat history is isolated by their user ID.

> ⚠️ For production use, replace with a real auth backend (Supabase, Firebase, Auth0, etc.)

## License

MIT

## 🌐 Live Demo

| Platform | URL |
|----------|-----|
| **Vercel** | [streamchat.vercel.app](https://streamchat.vercel.app) *(deploy via vercel.com)* |
| **GitHub Pages** | [rohitguptaxo.github.io/streamchat](https://rohitguptaxo.github.io/streamchat) *(auto-deploys on push)* |

## Deploy in 1 click

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/rohitguptaxo/streamchat)
