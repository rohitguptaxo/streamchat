# ✦ StreamChat

A high-performance real-time AI chat interface built with React.

![StreamChat](https://img.shields.io/badge/React-18-blue) ![Streaming](https://img.shields.io/badge/Streaming-SSE-yellow) ![Auth](https://img.shields.io/badge/Auth-LocalStorage-green) ![Vercel](https://img.shields.io/badge/Deployed-Vercel-black)

## 🌐 Live Demo

👉 **[streamchat-2a2euhowt-rohitguptaxos-projects.vercel.app](https://streamchat-jnsct51wj-rohitguptaxos-projects.vercel.app)**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/rohitguptaxo/streamchat)

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
- **Zustand-lite** — custom lightweight state store
- **Anthropic Claude API** — streaming messages endpoint
- **Web Search Tool** — `web_search_20250305`
- **Vite** — development and build
- **Vercel** — deployment

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

## Project Structure

```
streamchat/
├── streaming-chat.jsx   # Main app component (all-in-one)
├── src/
│   └── main.jsx         # React entry point
├── index.html           # HTML shell
├── vite.config.js       # Vite config
├── vercel.json          # Vercel deployment config
└── package.json
```

## Auth System

Accounts are stored in `localStorage` — fully client-side, no backend needed.
Each user's chat history is isolated by their user ID.

> ⚠️ For production use, replace with a real auth backend (Supabase, Firebase, Auth0, etc.)

## License

MIT — built by [@rohitguptaxo](https://github.com/rohitguptaxo)
