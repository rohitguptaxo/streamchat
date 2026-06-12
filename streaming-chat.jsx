import { useState, useEffect, useRef, useCallback } from "react";

// ─── Color palette ────────────────────────────────────────────────────────────
const C = {
  yellow: "#FFCE32", yellowDark: "#E6B800", yellowLight: "#FFF8D6",
  yellowPale: "#FFFAE8", yellowBorder: "#F0C000",
  blue: "#1D63FF", blueDark: "#1450D4", blueLight: "#4D8AFF", bluePale: "#E8EEFF",
  white: "#FFFFFF", dark: "#0A1628", darkMid: "#142040", mid: "#1E3060",
  muted: "#6B85B8", border: "#C5D4FF", text: "#0D1F3C", textLight: "#3A5080",
  success: "#16A34A", successBg: "#F0FDF4", error: "#DC2626", errorBg: "#FEF2F2",
};

// ─── Auth helpers ─────────────────────────────────────────────────────────────
const AUTH_KEY = "sc_auth_users";
const SESSION_KEY = "sc_auth_session";

function getUsers() { try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "{}"); } catch { return {}; } }
function saveUsers(u) { try { localStorage.setItem(AUTH_KEY, JSON.stringify(u)); } catch {} }
function getSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; } }
function saveSession(s) { try { localStorage.setItem(SESSION_KEY, s ? JSON.stringify(s) : "null"); } catch {} }

function hashPassword(pw) {
  // Simple deterministic hash for demo (not cryptographic — real apps use bcrypt/argon2 server-side)
  let h = 0;
  for (let i = 0; i < pw.length; i++) { h = ((h << 5) - h) + pw.charCodeAt(i); h |= 0; }
  return "h_" + Math.abs(h).toString(36) + "_" + pw.length;
}

function authSignUp(name, email, password) {
  const users = getUsers();
  const key = email.toLowerCase().trim();
  if (!name.trim()) return { error: "Name is required" };
  if (!key.includes("@")) return { error: "Enter a valid email" };
  if (password.length < 6) return { error: "Password must be at least 6 characters" };
  if (users[key]) return { error: "An account with this email already exists" };
  const user = { id: genId(), name: name.trim(), email: key, passwordHash: hashPassword(password), createdAt: Date.now(), avatar: name.trim()[0].toUpperCase() };
  users[key] = user;
  saveUsers(users);
  const session = { userId: user.id, email: key, name: user.name, avatar: user.avatar, loginAt: Date.now() };
  saveSession(session);
  return { user, session };
}

function authSignIn(email, password) {
  const users = getUsers();
  const key = email.toLowerCase().trim();
  if (!users[key]) return { error: "No account found with this email" };
  const user = users[key];
  if (user.passwordHash !== hashPassword(password)) return { error: "Incorrect password" };
  const session = { userId: user.id, email: key, name: user.name, avatar: user.avatar, loginAt: Date.now() };
  saveSession(session);
  return { user, session };
}

function authSignOut() { saveSession(null); }

// ─── Zustand-lite store ───────────────────────────────────────────────────────
function createStore(initialState, actions) {
  let state = { ...initialState };
  const listeners = new Set();
  const setState = (partial) => {
    state = { ...state, ...(typeof partial === "function" ? partial(state) : partial) };
    listeners.forEach((l) => l(state));
  };
  const getState = () => state;
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const boundActions = {};
  for (const [k, fn] of Object.entries(actions)) {
    boundActions[k] = (...args) => fn(setState, getState, ...args);
  }
  return { getState, setState, subscribe, ...boundActions };
}
function useStore(store, selector = s => s) {
  const [slice, setSlice] = useState(() => selector(store.getState()));
  useEffect(() => store.subscribe(s => setSlice(selector(s))), [store]);
  return slice;
}

const genId = () => Math.random().toString(36).slice(2, 10);
const threadsKey = (uid) => `sc_threads_${uid}`;
const loadThreads = (uid) => { try { return JSON.parse(localStorage.getItem(threadsKey(uid)) || "[]"); } catch { return []; } };
const saveThreads = (uid, t) => { try { localStorage.setItem(threadsKey(uid), JSON.stringify(t)); } catch {} };

const store = createStore(
  {
    session: getSession(),
    threads: [], activeThreadId: null,
    streaming: false, streamingText: "", tokenCount: 0, tokensPerSec: 0, totalTokens: 0,
    error: null, webSearchEnabled: true, model: "llama-3.3-70b-versatile", sidebarOpen: true,
    authView: "signin", // "signin" | "signup"
    showUserMenu: false,
  },
  {
    setSession: (setState, getState, session) => {
      const threads = session ? loadThreads(session.userId) : [];
      setState({ session, threads, activeThreadId: threads[0]?.id ?? null, totalTokens: 0 });
    },
    signOut: (setState) => { authSignOut(); setState({ session: null, threads: [], activeThreadId: null, totalTokens: 0 }); },
    setAuthView: (setState, _, v) => setState({ authView: v }),
    toggleUserMenu: (setState, getState) => setState(s => ({ showUserMenu: !s.showUserMenu })),
    closeUserMenu: (setState) => setState({ showUserMenu: false }),

    newThread: (setState, getState) => {
      const { session } = getState();
      if (!session) return;
      const id = genId();
      const thread = { id, title: "New chat", createdAt: Date.now(), messages: [] };
      setState((s) => { const threads = [thread, ...s.threads]; saveThreads(session.userId, threads); return { threads, activeThreadId: id, error: null }; });
      return id;
    },
    selectThread: (setState, _, id) => setState({ activeThreadId: id, error: null }),
    deleteThread: (setState, getState, id) => {
      const { session } = getState();
      setState((s) => {
        const threads = s.threads.filter(t => t.id !== id);
        saveThreads(session.userId, threads);
        return { threads, activeThreadId: s.activeThreadId === id ? (threads[0]?.id ?? null) : s.activeThreadId };
      });
    },
    clearAll: (setState, getState) => {
      const { session } = getState();
      saveThreads(session.userId, []);
      setState({ threads: [], activeThreadId: null });
    },
    appendMessage: (setState, getState, threadId, message) => {
      const { session } = getState();
      setState((s) => {
        const threads = s.threads.map(t => {
          if (t.id !== threadId) return t;
          const messages = [...t.messages, message];
          const title = t.messages.length === 0 && message.role === "user" ? message.content.slice(0, 42) + (message.content.length > 42 ? "…" : "") : t.title;
          return { ...t, messages, title };
        });
        saveThreads(session.userId, threads);
        return { threads };
      });
    },
    updateLastAssistant: (setState, getState, threadId, content) => {
      const { session } = getState();
      setState((s) => {
        const threads = s.threads.map(t => {
          if (t.id !== threadId) return t;
          const messages = t.messages.map((m, i) => i === t.messages.length - 1 && m.role === "assistant" ? { ...m, content } : m);
          return { ...t, messages };
        });
        saveThreads(session.userId, threads);
        return { threads };
      });
    },
    setStreaming: (setState, _, val) => setState({ streaming: val }),
    setStreamingText: (setState, _, text) => setState({ streamingText: text }),
    setTokenStats: (setState, _, tokenCount, tokensPerSec) => setState(s => ({ tokenCount, tokensPerSec })),
    addTotalTokens: (setState, _, n) => setState(s => ({ totalTokens: s.totalTokens + n })),
    setError: (setState, _, error) => setState({ error }),
    toggleWebSearch: (setState) => setState(s => ({ webSearchEnabled: !s.webSearchEnabled })),
    setModel: (setState, _, model) => setState({ model }),
    toggleSidebar: (setState) => setState(s => ({ sidebarOpen: !s.sidebarOpen })),
  }
);

// ─── Markdown ─────────────────────────────────────────────────────────────────
function renderMd(text) {
  if (!text) return "";
  let h = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  h = h.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre class="md-pre"><div class="md-ch"><span class="md-lang">${lang || "code"}</span><button class="md-cp" onclick="navigator.clipboard.writeText(this.closest('pre').querySelector('code').innerText)">Copy</button></div><code class="md-code">${code.trim()}</code></pre>`);
  h = h.replace(/`([^`]+)`/g, '<code class="md-ic">$1</code>');
  h = h.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.*?)\*/g, '<em>$1</em>');
  h = h.replace(/^### (.*$)/gm, '<h3 class="md-h3">$1</h3>');
  h = h.replace(/^## (.*$)/gm, '<h2 class="md-h2">$1</h2>');
  h = h.replace(/^# (.*$)/gm, '<h1 class="md-h1">$1</h1>');
  h = h.replace(/^\> (.*$)/gm, '<blockquote class="md-bq">$1</blockquote>');
  h = h.replace(/^\- (.*$)/gm, '<li class="md-li">$1</li>');
  h = h.replace(/^\d+\. (.*$)/gm, '<li class="md-li">$1</li>');
  h = h.replace(/(<li[^>]*>.*<\/li>\n?)+/g, m => `<ul class="md-ul">${m}</ul>`);
  h = h.replace(/^---$/gm, '<hr class="md-hr"/>');
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" class="md-a">$1 ↗</a>');
  h = h.split(/\n{2,}/).map(b => b.startsWith("<") ? b : `<p class="md-p">${b.replace(/\n/g, "<br/>")}</p>`).join("\n");
  return h;
}

// ─── Stream API ───────────────────────────────────────────────────────────────
async function streamChat(messages, model, webSearch, onToken, onDone, onError) {
  try {
    const body = {
      model,
      system: `You are StreamChat — a fast, brilliant AI assistant. Today: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}. Be thorough, accurate, and use rich markdown formatting with headers, lists, and code blocks where helpful.`,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    };
    const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) { const e = await res.json(); throw new Error(e?.error?.message || `API ${res.status}`); }
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") { onDone(); return; }
        try { const evt = JSON.parse(data); if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") onToken(evt.delta.text); if (evt.type === "message_stop") { onDone(); return; } } catch {}
      }
    }
    onDone();
  } catch (e) { onError(e.message || "Stream failed"); }
}

// ─── Auth Screens ─────────────────────────────────────────────────────────────
function AuthScreen() {
  const authView = useStore(store, s => s.authView);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const isSignUp = authView === "signup";

  const handleSubmit = () => {
    setError(""); setSuccess("");
    setLoading(true);
    setTimeout(() => {
      let result;
      if (isSignUp) result = authSignUp(name, email, password);
      else result = authSignIn(email, password);
      setLoading(false);
      if (result.error) { setError(result.error); return; }
      if (isSignUp) setSuccess("Account created! Signing you in…");
      setTimeout(() => store.setSession(result.session), isSignUp ? 800 : 0);
    }, 400);
  };

  const handleKey = e => { if (e.key === "Enter") handleSubmit(); };

  return (
    <div style={{
      minHeight: "100vh", background: `linear-gradient(135deg, ${C.yellow} 0%, ${C.yellowLight} 50%, ${C.bluePale} 100%)`,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      {/* Background decoration */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden", pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: -80, right: -80, width: 320, height: 320, borderRadius: "50%", background: C.blue + "18" }} />
        <div style={{ position: "absolute", bottom: -60, left: -60, width: 240, height: 240, borderRadius: "50%", background: C.yellow + "88" }} />
        <div style={{ position: "absolute", top: "40%", left: "10%", width: 120, height: 120, borderRadius: "50%", background: C.blue + "0C" }} />
      </div>

      <div style={{
        background: C.white, borderRadius: 24,
        boxShadow: "0 24px 80px rgba(29,99,255,0.15), 0 4px 20px rgba(0,0,0,0.08)",
        width: "100%", maxWidth: 440, overflow: "hidden", position: "relative",
      }}>
        {/* Top accent bar */}
        <div style={{ height: 5, background: `linear-gradient(90deg, ${C.yellow}, ${C.blue})` }} />

        <div style={{ padding: "36px 40px 40px" }}>
          {/* Logo */}
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{
              width: 60, height: 60, borderRadius: 18, background: C.yellow,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 28, fontWeight: 900, color: C.dark, marginBottom: 14,
              border: `3px solid ${C.yellowDark}`,
              boxShadow: `0 6px 20px ${C.yellow}88`,
            }}>✦</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: C.dark, letterSpacing: "-0.03em" }}>StreamChat</div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
              {isSignUp ? "Create your account to get started" : "Welcome back! Sign in to continue"}
            </div>
          </div>

          {/* Tab switcher */}
          <div style={{
            display: "flex", background: C.yellowLight, borderRadius: 12, padding: 4, marginBottom: 28,
            border: `1.5px solid ${C.yellowBorder}`,
          }}>
            {["signin", "signup"].map(v => (
              <button key={v} onClick={() => { store.setAuthView(v); setError(""); setSuccess(""); }} style={{
                flex: 1, padding: "9px 0", borderRadius: 9, border: "none", cursor: "pointer",
                background: authView === v ? C.blue : "transparent",
                color: authView === v ? C.white : C.textLight,
                fontSize: 13, fontWeight: 700, transition: "all 0.2s",
                boxShadow: authView === v ? `0 2px 8px ${C.blue}44` : "none",
              }}>
                {v === "signin" ? "Sign In" : "Sign Up"}
              </button>
            ))}
          </div>

          {/* Form */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {isSignUp && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: C.textLight, display: "block", marginBottom: 6, letterSpacing: "0.04em", textTransform: "uppercase" }}>Full Name</label>
                <input
                  value={name} onChange={e => setName(e.target.value)} onKeyDown={handleKey}
                  placeholder="Jane Smith" autoComplete="name"
                  style={{
                    width: "100%", padding: "11px 14px", borderRadius: 10,
                    border: `1.5px solid ${C.border}`, outline: "none",
                    fontSize: 14, color: C.dark, background: C.white,
                    transition: "border-color 0.15s",
                  }}
                  onFocus={e => e.target.style.borderColor = C.blue}
                  onBlur={e => e.target.style.borderColor = C.border}
                />
              </div>
            )}

            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: C.textLight, display: "block", marginBottom: 6, letterSpacing: "0.04em", textTransform: "uppercase" }}>Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={handleKey}
                placeholder="you@example.com" autoComplete="email"
                style={{
                  width: "100%", padding: "11px 14px", borderRadius: 10,
                  border: `1.5px solid ${C.border}`, outline: "none",
                  fontSize: 14, color: C.dark, background: C.white,
                  transition: "border-color 0.15s",
                }}
                onFocus={e => e.target.style.borderColor = C.blue}
                onBlur={e => e.target.style.borderColor = C.border}
              />
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: C.textLight, display: "block", marginBottom: 6, letterSpacing: "0.04em", textTransform: "uppercase" }}>Password</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPw ? "text" : "password"}
                  value={password} onChange={e => setPassword(e.target.value)} onKeyDown={handleKey}
                  placeholder={isSignUp ? "Min. 6 characters" : "Your password"} autoComplete={isSignUp ? "new-password" : "current-password"}
                  style={{
                    width: "100%", padding: "11px 44px 11px 14px", borderRadius: 10,
                    border: `1.5px solid ${C.border}`, outline: "none",
                    fontSize: 14, color: C.dark, background: C.white,
                    transition: "border-color 0.15s",
                  }}
                  onFocus={e => e.target.style.borderColor = C.blue}
                  onBlur={e => e.target.style.borderColor = C.border}
                />
                <button onClick={() => setShowPw(v => !v)} style={{
                  position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer", fontSize: 16, color: C.muted,
                }}>{showPw ? "🙈" : "👁"}</button>
              </div>
            </div>

            {/* Error / Success */}
            {error && (
              <div style={{ padding: "10px 14px", background: C.errorBg, border: `1.5px solid #FECACA`, borderRadius: 10, color: C.error, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                <span>⚠️</span> {error}
              </div>
            )}
            {success && (
              <div style={{ padding: "10px 14px", background: C.successBg, border: `1.5px solid #BBF7D0`, borderRadius: 10, color: C.success, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                <span>✓</span> {success}
              </div>
            )}

            {/* Submit */}
            <button onClick={handleSubmit} disabled={loading} style={{
              width: "100%", padding: "13px 0",
              background: loading ? C.bluePale : `linear-gradient(135deg, ${C.blue}, ${C.blueDark})`,
              border: "none", borderRadius: 12, color: loading ? C.muted : C.white,
              fontSize: 15, fontWeight: 700, cursor: loading ? "default" : "pointer",
              transition: "all 0.15s", marginTop: 4,
              boxShadow: loading ? "none" : `0 4px 16px ${C.blue}44`,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
              {loading ? (
                <><span style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.blue, display: "inline-block", animation: "spin 0.8s linear infinite" }} /> {isSignUp ? "Creating account…" : "Signing in…"}</>
              ) : (
                isSignUp ? "Create Account →" : "Sign In →"
              )}
            </button>
          </div>

          {/* Footer switch */}
          <div style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: C.muted }}>
            {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
            <button onClick={() => { store.setAuthView(isSignUp ? "signin" : "signup"); setError(""); setSuccess(""); }} style={{
              background: "none", border: "none", color: C.blue, fontWeight: 700, cursor: "pointer", fontSize: 13,
            }}>
              {isSignUp ? "Sign In" : "Sign Up"}
            </button>
          </div>

          {/* Demo hint */}
          <div style={{
            marginTop: 20, padding: "10px 14px",
            background: C.yellowPale, border: `1px solid ${C.yellowBorder}`,
            borderRadius: 10, fontSize: 12, color: C.textLight, textAlign: "center",
          }}>
            💡 Accounts are stored locally in your browser. Each account has its own chat history.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── User Menu ────────────────────────────────────────────────────────────────
function UserMenu({ session, onSignOut, onClose }) {
  const joinDate = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return (
    <div style={{
      position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 200,
      background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 16,
      boxShadow: "0 12px 40px rgba(0,0,0,0.15)", overflow: "hidden", minWidth: 240,
    }}>
      {/* Profile section */}
      <div style={{ padding: "18px 18px 14px", borderBottom: `1px solid ${C.border}`, background: C.yellowPale }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 14, background: C.blue,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 800, color: C.white,
            border: `2px solid ${C.yellowDark}`,
          }}>{session.avatar}</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.dark }}>{session.name}</div>
            <div style={{ fontSize: 12, color: C.muted }}>{session.email}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Member since {joinDate}</div>
          </div>
        </div>
      </div>

      {/* Menu items */}
      <div style={{ padding: "8px" }}>
        {[
          { icon: "💬", label: "My Chats", action: onClose },
          { icon: "⚙️", label: "Preferences", action: onClose },
        ].map(item => (
          <button key={item.label} onClick={item.action} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 10,
            padding: "9px 12px", borderRadius: 8, border: "none", background: "none",
            cursor: "pointer", fontSize: 13, color: C.text, fontWeight: 500, textAlign: "left",
            transition: "background 0.1s",
          }}
            onMouseEnter={e => e.currentTarget.style.background = C.bluePale}
            onMouseLeave={e => e.currentTarget.style.background = "none"}
          >
            <span style={{ fontSize: 16 }}>{item.icon}</span> {item.label}
          </button>
        ))}

        <div style={{ height: 1, background: C.border, margin: "6px 0" }} />

        <button onClick={onSignOut} style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "9px 12px", borderRadius: 8, border: "none", background: "none",
          cursor: "pointer", fontSize: 13, color: C.error, fontWeight: 700, textAlign: "left",
          transition: "background 0.1s",
        }}
          onMouseEnter={e => e.currentTarget.style.background = C.errorBg}
          onMouseLeave={e => e.currentTarget.style.background = "none"}
        >
          <span style={{ fontSize: 16 }}>🚪</span> Sign Out
        </button>
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ threads, activeId, sidebarOpen, onNew, onSelect, onDelete, onClear }) {
  const [search, setSearch] = useState("");
  const filtered = threads.filter(t => t.title.toLowerCase().includes(search.toLowerCase()));
  return (
    <div style={{
      width: sidebarOpen ? 260 : 0, minWidth: sidebarOpen ? 260 : 0,
      background: C.dark, borderRight: `2px solid ${C.mid}`,
      display: "flex", flexDirection: "column", height: "100%", overflow: "hidden",
      transition: "width 0.25s, min-width 0.25s",
    }}>
      <div style={{ padding: "18px 14px 12px", borderBottom: `1px solid ${C.mid}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: C.yellow, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 900, color: C.dark }}>✦</div>
          <div>
            <div style={{ color: C.white, fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>StreamChat</div>
            <div style={{ color: C.muted, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>Real-time AI</div>
          </div>
        </div>
        <button onClick={onNew} style={{
          width: "100%", padding: "9px 0", background: C.yellow, border: "none",
          borderRadius: 10, color: C.dark, fontSize: 13, fontWeight: 700, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "background 0.15s",
        }}
          onMouseEnter={e => e.currentTarget.style.background = C.yellowDark}
          onMouseLeave={e => e.currentTarget.style.background = C.yellow}
        >+ New chat</button>
      </div>
      <div style={{ padding: "10px 10px 4px" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search chats…"
          style={{ width: "100%", padding: "7px 10px", borderRadius: 8, background: C.mid, border: `1px solid #2A4080`, color: C.white, fontSize: 12, outline: "none" }} />
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px" }}>
        {filtered.length === 0 && <div style={{ padding: "24px 8px", color: C.muted, fontSize: 12, textAlign: "center" }}>{search ? "No results" : "Start a new chat above"}</div>}
        {filtered.map(t => (
          <div key={t.id} onClick={() => onSelect(t.id)} style={{
            padding: "9px 10px", borderRadius: 8, cursor: "pointer",
            background: t.id === activeId ? C.mid : "transparent",
            border: `1px solid ${t.id === activeId ? C.blue + "66" : "transparent"}`,
            marginBottom: 2, display: "flex", alignItems: "center", justifyContent: "space-between", transition: "background 0.1s",
          }}
            onMouseEnter={e => { if (t.id !== activeId) e.currentTarget.style.background = "#142040"; }}
            onMouseLeave={e => { if (t.id !== activeId) e.currentTarget.style.background = "transparent"; }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: t.id === activeId ? C.white : "#8EA8CC", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{t.messages.length} msg{t.messages.length !== 1 ? "s" : ""}</div>
            </div>
            <button onClick={e => { e.stopPropagation(); onDelete(t.id); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 15, padding: "0 2px", opacity: 0 }}
              onMouseEnter={e => { e.target.style.opacity = "1"; e.target.style.color = "#EF4444"; }}
              onMouseLeave={e => { e.target.style.opacity = "0"; }}>×</button>
          </div>
        ))}
      </div>
      <div style={{ padding: "10px 10px", borderTop: `1px solid ${C.mid}` }}>
        <button onClick={onClear} style={{ width: "100%", padding: "6px 0", background: "transparent", border: `1px solid #2A4080`, borderRadius: 8, color: C.muted, fontSize: 11, cursor: "pointer" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "#EF4444"; e.currentTarget.style.color = "#EF4444"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "#2A4080"; e.currentTarget.style.color = C.muted; }}>
          Clear all chats
        </button>
      </div>
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────
function MsgBubble({ msg, isStreaming, streamText, tps, userName, userAvatar }) {
  const isUser = msg.role === "user";
  const content = isStreaming ? streamText : msg.content;
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 22, animation: "msgIn 0.2s ease-out", flexDirection: isUser ? "row-reverse" : "row" }}>
      <div style={{
        width: 32, height: 32, borderRadius: 9, flexShrink: 0,
        background: isUser ? C.blue : C.yellow,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: isUser ? 14 : 16, fontWeight: 800,
        color: isUser ? C.white : C.dark,
        border: isUser ? "none" : `2px solid ${C.yellowDark}`,
      }}>{isUser ? (userAvatar || "U") : "✦"}</div>
      <div style={{ flex: 1, maxWidth: "82%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexDirection: isUser ? "row-reverse" : "row" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: isUser ? C.blue : C.dark }}>{isUser ? (userName || "You") : "StreamChat"}</span>
          {isStreaming && <span style={{ fontSize: 10, color: C.muted, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#22C55E", display: "inline-block", animation: "pulse 1s ease-in-out infinite" }} />
            {tps > 0 ? `${tps} tok/s` : "streaming"}
          </span>}
        </div>
        <div style={{
          padding: isUser ? "11px 15px" : "13px 16px",
          borderRadius: isUser ? "16px 4px 16px 16px" : "4px 16px 16px 16px",
          background: isUser ? `linear-gradient(135deg, ${C.blue}, ${C.blueDark})` : C.white,
          border: isUser ? "none" : `1.5px solid ${C.border}`,
          color: isUser ? C.white : C.text, fontSize: 14, lineHeight: 1.65,
          boxShadow: isUser ? `0 3px 14px ${C.blue}33` : "0 2px 10px rgba(0,0,0,0.05)",
          overflowX: "auto",
        }}>
          {isUser ? <span style={{ whiteSpace: "pre-wrap" }}>{content}</span> : (
            <>
              <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMd(content) }} />
              {isStreaming && <span style={{ display: "inline-flex", gap: 3, marginLeft: 4, verticalAlign: "middle" }}>
                {[0, 1, 2].map(i => <span key={i} style={{ width: 4, height: 4, borderRadius: "50%", background: C.blue, display: "inline-block", animation: `dotBounce 1s ease-in-out ${i * 0.15}s infinite` }} />)}
              </span>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Quick prompts ────────────────────────────────────────────────────────────
const QP = [
  { icon: "🌍", label: "World news", prompt: "What are the most important world news stories right now?" },
  { icon: "📈", label: "Markets", prompt: "What's the current state of global financial markets today?" },
  { icon: "🌤", label: "Weather", prompt: "What's the weather like in major cities around the world today?" },
  { icon: "⚡", label: "Tech news", prompt: "What are the latest AI and technology developments this week?" },
  { icon: "🏆", label: "Sports", prompt: "What are the latest sports scores and highlights from today?" },
  { icon: "💡", label: "Explain", prompt: "Explain quantum computing in simple terms with real-world examples." },
];

const MODELS = [
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", desc: "Fast · Free" },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B", desc: "Fastest · Free" },
];

// ─── Main chat app ────────────────────────────────────────────────────────────
function ChatApp() {
  const session = useStore(store, s => s.session);
  const threads = useStore(store, s => s.threads);
  const activeId = useStore(store, s => s.activeThreadId);
  const streaming = useStore(store, s => s.streaming);
  const streamingText = useStore(store, s => s.streamingText);
  const tokenCount = useStore(store, s => s.tokenCount);
  const tokensPerSec = useStore(store, s => s.tokensPerSec);
  const totalTokens = useStore(store, s => s.totalTokens);
  const webSearchEnabled = useStore(store, s => s.webSearchEnabled);
  const model = useStore(store, s => s.model);
  const sidebarOpen = useStore(store, s => s.sidebarOpen);
  const error = useStore(store, s => s.error);
  const showUserMenu = useStore(store, s => s.showUserMenu);

  const [input, setInput] = useState("");
  const [showModelMenu, setShowModelMenu] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const streamStartRef = useRef(null);
  const tokenBufRef = useRef(0);
  const tpsIntervalRef = useRef(null);
  const activeThread = threads.find(t => t.id === activeId);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [activeThread?.messages?.length, streamingText]);
  useEffect(() => {
    const handler = e => { if (showUserMenu) store.closeUserMenu(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showUserMenu]);

  const handleSend = useCallback(async (overrideInput) => {
    const text = (overrideInput || input).trim();
    if (!text || streaming) return;
    let threadId = activeId;
    if (!threadId) threadId = store.newThread();
    const userMsg = { id: genId(), role: "user", content: text, ts: Date.now() };
    store.appendMessage(threadId, userMsg);
    setInput("");
    const assistantMsg = { id: genId(), role: "assistant", content: "", ts: Date.now() };
    store.appendMessage(threadId, assistantMsg);
    store.setStreaming(true); store.setStreamingText(""); store.setError(null);
    streamStartRef.current = Date.now(); tokenBufRef.current = 0;
    store.setTokenStats(0, 0);
    tpsIntervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - streamStartRef.current) / 1000;
      store.setTokenStats(tokenBufRef.current, elapsed > 0 ? Math.round(tokenBufRef.current / elapsed) : 0);
    }, 250);
    const currentMessages = [...(threads.find(t => t.id === threadId)?.messages || []).filter(m => m.content), userMsg];
    let accumulated = "";
    await streamChat(currentMessages, model, webSearchEnabled,
      (token) => { accumulated += token; tokenBufRef.current++; store.setStreamingText(accumulated); },
      () => {
        clearInterval(tpsIntervalRef.current);
        store.updateLastAssistant(threadId, accumulated); store.setStreaming(false); store.setStreamingText("");
        const elapsed = (Date.now() - streamStartRef.current) / 1000;
        store.setTokenStats(tokenBufRef.current, elapsed > 0 ? Math.round(tokenBufRef.current / elapsed) : 0);
        store.addTotalTokens(tokenBufRef.current);
      },
      (err) => { clearInterval(tpsIntervalRef.current); store.setStreaming(false); store.setStreamingText(""); store.setError(err); store.updateLastAssistant(threadId, `⚠️ ${err}`); }
    );
  }, [input, streaming, activeId, threads, model, webSearchEnabled]);

  const handleKey = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } };
  const messages = activeThread?.messages || [];

  return (
    <div style={{ display: "flex", height: "100vh", width: "100%", background: C.yellowLight, overflow: "hidden" }}>
      <Sidebar threads={threads} activeId={activeId} sidebarOpen={sidebarOpen}
        onNew={() => { store.newThread(); setTimeout(() => inputRef.current?.focus(), 50); }}
        onSelect={store.selectThread} onDelete={store.deleteThread}
        onClear={() => { if (confirm("Delete all your chats?")) store.clearAll(); }}
      />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top bar */}
        <div style={{
          padding: "0 18px", height: 58, borderBottom: `2px solid ${C.yellowDark}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: C.yellow, boxShadow: `0 2px 12px ${C.yellow}88`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={store.toggleSidebar} style={{ background: "none", border: "none", cursor: "pointer", padding: "6px 8px", borderRadius: 8, color: C.dark, fontSize: 18 }}>☰</button>
            <span style={{ fontSize: 14, fontWeight: 800, color: C.dark, letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
              {activeThread ? activeThread.title : "StreamChat"}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Token stats */}
            {streaming && <span style={{ fontSize: 11, color: C.dark + "99", fontFamily: "monospace", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22C55E", display: "inline-block", animation: "pulse 0.8s ease-in-out infinite" }} />
              {tokensPerSec} tok/s
            </span>}
            {totalTokens > 0 && <span style={{ fontSize: 11, background: C.bluePale, color: C.blue, padding: "2px 8px", borderRadius: 10, fontFamily: "monospace", fontWeight: 600 }}>{totalTokens.toLocaleString()} tokens</span>}

            {/* Model picker */}
            <div style={{ position: "relative" }}>
              <button onClick={() => setShowModelMenu(v => !v)} style={{
                padding: "5px 10px", borderRadius: 18, fontSize: 11, fontWeight: 700,
                background: C.bluePale, border: `1.5px solid ${C.blue}`, color: C.blue, cursor: "pointer",
              }}>
                {MODELS.find(m => m.id === model)?.label} ▾
              </button>
              {showModelMenu && (
                <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 100, background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", overflow: "hidden", minWidth: 180 }}>
                  {MODELS.map(m => (
                    <div key={m.id} onClick={() => { store.setModel(m.id); setShowModelMenu(false); }} style={{
                      padding: "9px 14px", cursor: "pointer", background: model === m.id ? C.bluePale : C.white, borderBottom: `1px solid ${C.border}`,
                    }}
                      onMouseEnter={e => { if (model !== m.id) e.currentTarget.style.background = C.yellowPale; }}
                      onMouseLeave={e => { if (model !== m.id) e.currentTarget.style.background = C.white; }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: model === m.id ? C.blue : C.dark }}>{m.label} {model === m.id ? "✓" : ""}</div>
                      <div style={{ fontSize: 10, color: C.muted }}>{m.desc}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Web search toggle */}
            <button onClick={store.toggleWebSearch} title="Toggle web search" style={{
              display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 18,
              border: `1.5px solid ${webSearchEnabled ? C.blue : C.border}`,
              background: webSearchEnabled ? C.bluePale : C.white, color: webSearchEnabled ? C.blue : C.muted,
              fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap",
            }}>
              🌐 Web
              <span style={{ width: 24, height: 14, borderRadius: 7, background: webSearchEnabled ? C.blue : "#CBD5E0", position: "relative", display: "inline-block", flexShrink: 0 }}>
                <span style={{ position: "absolute", top: 2, left: webSearchEnabled ? 11 : 2, width: 10, height: 10, borderRadius: 5, background: C.white, transition: "left 0.2s" }} />
              </span>
            </button>

            {/* User avatar + menu */}
            <div style={{ position: "relative" }} onMouseDown={e => e.stopPropagation()}>
              <button onClick={store.toggleUserMenu} style={{
                width: 36, height: 36, borderRadius: 11,
                background: C.blue, border: `2px solid ${C.yellowDark}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, fontWeight: 800, color: C.white, cursor: "pointer",
                boxShadow: `0 2px 8px ${C.blue}44`,
              }}>{session?.avatar}</button>
              {showUserMenu && (
                <UserMenu session={session}
                  onSignOut={() => { store.signOut(); store.closeUserMenu(); }}
                  onClose={store.closeUserMenu}
                />
              )}
            </div>
          </div>
        </div>

        {/* Messages area */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 0" }}>
          {!activeThread ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px", minHeight: "calc(100vh - 200px)" }}>
              <div style={{ width: 68, height: 68, borderRadius: 20, background: C.yellow, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, marginBottom: 18, border: `3px solid ${C.yellowDark}`, boxShadow: `0 8px 28px ${C.yellow}88` }}>✦</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.dark, marginBottom: 6, letterSpacing: "-0.02em" }}>
                Welcome back, {session?.name?.split(" ")[0]}!
              </div>
              <div style={{ fontSize: 13, color: C.textLight, marginBottom: 28, textAlign: "center", maxWidth: 340, lineHeight: 1.6 }}>
                Real-time AI with live web access. Ask anything about news, markets, weather, code, and more.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, maxWidth: 600, width: "100%" }}>
                {QP.map(q => (
                  <button key={q.label} onClick={() => { store.newThread(); setTimeout(() => handleSend(q.prompt), 80); }} style={{
                    padding: "12px 12px", borderRadius: 14, background: C.white,
                    border: `1.5px solid ${C.border}`, cursor: "pointer", textAlign: "left", transition: "all 0.15s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.background = C.bluePale; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.white; }}
                  >
                    <div style={{ fontSize: 18, marginBottom: 4 }}>{q.icon}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.dark }}>{q.label}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 60, gap: 12 }}>
              <div style={{ fontSize: 24 }}>✦</div>
              <div style={{ fontSize: 14, color: C.muted }}>Send a message to start</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 560 }}>
                {QP.map(q => (
                  <button key={q.label} onClick={() => handleSend(q.prompt)} style={{
                    padding: "6px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                    background: C.white, border: `1.5px solid ${C.border}`, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, transition: "all 0.15s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = C.yellow; e.currentTarget.style.borderColor = C.yellowDark; }}
                    onMouseLeave={e => { e.currentTarget.style.background = C.white; e.currentTarget.style.borderColor = C.border; }}
                  >{q.icon} {q.label}</button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: 760, width: "100%", margin: "0 auto" }}>
              {messages.map((msg, i) => {
                const isLast = i === messages.length - 1;
                const isStreamingThis = isLast && msg.role === "assistant" && streaming;
                return <MsgBubble key={msg.id} msg={msg} isStreaming={isStreamingThis} streamText={streamingText} tps={tokensPerSec} userName={session?.name?.split(" ")[0]} userAvatar={session?.avatar} />;
              })}
              <div ref={messagesEndRef} style={{ height: 20 }} />
            </div>
          )}
        </div>

        {error && (
          <div style={{ margin: "0 20px 8px", padding: "9px 14px", background: C.errorBg, border: `1.5px solid #FECACA`, borderRadius: 10, color: C.error, fontSize: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>⚠️ {error}</span>
            <button onClick={() => store.setError(null)} style={{ background: "none", border: "none", color: C.error, cursor: "pointer", fontSize: 16 }}>×</button>
          </div>
        )}

        {/* Input bar */}
        <div style={{ padding: "10px 20px 18px", borderTop: `2px solid ${C.yellowDark}`, background: C.yellow }}>
          <div style={{ maxWidth: 760, margin: "0 auto" }}>
            <div style={{
              background: C.white, border: `2px solid ${streaming ? C.blue : C.border}`, borderRadius: 16,
              display: "flex", alignItems: "flex-end", gap: 8, padding: "9px 12px",
              boxShadow: streaming ? `0 0 0 3px ${C.blue}22` : "0 2px 12px rgba(0,0,0,0.07)", transition: "border-color 0.2s, box-shadow 0.2s",
            }}>
              {webSearchEnabled && <span style={{ fontSize: 15, flexShrink: 0, marginBottom: 3, opacity: 0.5 }}>🌐</span>}
              <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
                placeholder={streaming ? "Streaming…" : webSearchEnabled ? "Ask anything — I have live web access…" : "Send a message…"}
                disabled={streaming} rows={1}
                style={{ flex: 1, background: "none", border: "none", outline: "none", color: C.dark, fontSize: 14, lineHeight: 1.6, resize: "none", fontFamily: "'Inter',sans-serif", maxHeight: 150, overflowY: "auto", caretColor: C.blue }}
                onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 150) + "px"; }}
              />
              <button onClick={() => handleSend()} disabled={!input.trim() || streaming} style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: input.trim() && !streaming ? C.blue : C.bluePale, border: "none",
                cursor: input.trim() && !streaming ? "pointer" : "default",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: input.trim() && !streaming ? C.white : C.border, fontSize: 17, fontWeight: 700, transition: "all 0.15s",
              }}
                onMouseEnter={e => { if (input.trim() && !streaming) e.currentTarget.style.background = C.blueDark; }}
                onMouseLeave={e => { if (input.trim() && !streaming) e.currentTarget.style.background = C.blue; }}
              >
                {streaming ? <span style={{ width: 13, height: 13, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.blue, display: "block", animation: "spin 0.8s linear infinite" }} /> : "↑"}
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 7, paddingLeft: 2 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {QP.slice(0, 3).map(q => (
                  <button key={q.label} onClick={() => handleSend(q.prompt)} disabled={streaming} style={{
                    padding: "3px 9px", borderRadius: 18, fontSize: 10, fontWeight: 700,
                    background: "transparent", border: `1px solid ${C.yellowDark}`, color: C.dark, cursor: "pointer", transition: "all 0.12s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = C.yellowDark; e.currentTarget.style.color = C.white; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.dark; }}
                  >{q.icon} {q.label}</button>
                ))}
              </div>
              <span style={{ fontSize: 10, color: C.dark + "77", fontFamily: "monospace" }}>Enter to send · 8k tokens</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const session = useStore(store, s => s.session);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Inter',sans-serif}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(1.2)}}
        @keyframes dotBounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}
        @keyframes msgIn{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#C5D4FF;border-radius:2px}
        .md-body{font-family:'Inter',sans-serif;color:#0D1F3C}
        .md-p{margin-bottom:10px;line-height:1.7;color:#0D1F3C}.md-p:last-child{margin-bottom:0}
        .md-h1{font-size:19px;font-weight:800;color:#0A1628;margin:14px 0 7px;letter-spacing:-0.02em}
        .md-h2{font-size:16px;font-weight:700;color:#0A1628;margin:12px 0 5px}
        .md-h3{font-size:14px;font-weight:700;color:#1D63FF;margin:10px 0 4px}
        .md-pre{background:#0A1628;border:1px solid #1E3060;border-radius:12px;margin:10px 0;overflow:hidden}
        .md-ch{display:flex;justify-content:space-between;align-items:center;padding:7px 12px;background:#142040;border-bottom:1px solid #1E3060}
        .md-lang{font-family:'JetBrains Mono',monospace;font-size:10px;color:#FFCE32;text-transform:uppercase;letter-spacing:.06em}
        .md-cp{background:none;border:1px solid #1E3060;border-radius:4px;color:#6B85B8;font-size:10px;padding:2px 7px;cursor:pointer;font-family:inherit}
        .md-cp:hover{background:#1E3060;color:#fff}
        .md-code{display:block;padding:12px 14px;font-family:'JetBrains Mono',monospace;font-size:12px;color:#A5B4FC;line-height:1.65;overflow-x:auto}
        .md-ic{font-family:'JetBrains Mono',monospace;font-size:12px;background:#E8EEFF;border:1px solid #C5D4FF;border-radius:4px;padding:1px 5px;color:#1D63FF}
        .md-ul{padding-left:18px;margin:7px 0}.md-li{margin-bottom:4px;line-height:1.65;color:#0D1F3C}
        .md-bq{border-left:3px solid #FFCE32;padding:7px 12px;background:#FFFAE8;border-radius:0 8px 8px 0;margin:8px 0;color:#3A5080;font-style:italic}
        .md-hr{border:none;border-top:1px solid #C5D4FF;margin:12px 0}
        .md-a{color:#1D63FF;text-decoration:none;border-bottom:1px solid #1D63FF44}.md-a:hover{border-bottom-color:#1D63FF}
        strong{color:#0A1628;font-weight:700} em{color:#3A5080;font-style:italic}
        input::placeholder,textarea::placeholder{color:#A0B0CC}
      `}</style>
      {session ? <ChatApp /> : <AuthScreen />}
    </>
  );
}
