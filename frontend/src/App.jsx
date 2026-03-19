import { useState, useRef, useEffect } from "react";

const API_URL = "http://localhost:8000/ask/";

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Noto+Sans+JP:wght@400;700&family=Share+Tech+Mono&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --ink: #0e0e12;
    --ink2: #16161c;
    --ink3: #1e1e26;
    --panel: #12121a;
    --red: #e8003d;
    --red2: #ff1a54;
    --gold: #f5c842;
    --cream: #f0ead6;
    --muted: #444455;
    --font-title: 'Bebas Neue', sans-serif;
    --font-jp: 'Noto Sans JP', sans-serif;
    --font-mono: 'Share Tech Mono', monospace;
  }

  body {
    background: var(--ink);
    font-family: var(--font-mono);
    color: var(--cream);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .shell {
    background: var(--ink);
    border: 2px solid var(--red);
    position: relative;
    overflow: hidden;
    width: 100%;
    max-width: 780px;
    min-height: 640px;
    display: flex;
    flex-direction: column;
  }

  .manga-lines {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    pointer-events: none;
    z-index: 0;
    opacity: 0.03;
    background: repeating-linear-gradient(
      -45deg, #fff 0px, #fff 1px, transparent 1px, transparent 8px
    );
  }

  .top-bar {
    position: relative; z-index: 2;
    background: var(--red);
    display: flex;
    align-items: stretch;
    min-height: 64px;
    overflow: hidden;
  }
  .top-left { padding: 10px 14px; display: flex; flex-direction: column; justify-content: center; flex: 1; }
  .top-jp { font-family: var(--font-jp); font-weight: 700; font-size: 11px; color: rgba(255,255,255,0.5); letter-spacing: 4px; margin-bottom: 2px; }
  .top-title { font-family: var(--font-title); font-size: 32px; letter-spacing: 6px; color: var(--cream); line-height: 1; }
  .top-right {
    background: var(--ink);
    width: 80px;
    clip-path: polygon(20px 0, 100% 0, 100% 100%, 0 100%);
    display: flex; flex-direction: column; align-items: flex-end; justify-content: center;
    padding: 8px 10px 8px 20px; gap: 4px;
  }
  .ep-label { font-size: 8px; color: var(--muted); letter-spacing: 2px; }
  .ep-num { font-family: var(--font-title); font-size: 28px; color: var(--gold); line-height: 1; }

  .info-strip {
    position: relative; z-index: 2;
    background: var(--ink2);
    border-top: 1px solid #2a2a3a;
    border-bottom: 1px solid #2a2a3a;
    padding: 5px 14px;
    display: flex; align-items: center; gap: 16px;
    font-size: 9px; color: var(--muted); letter-spacing: 1px;
  }
  .info-dot { width: 5px; height: 5px; background: var(--gold); border-radius: 50%; animation: glow 2s infinite; }
  @keyframes glow { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
  .info-tag { color: var(--gold); }
  .info-right { margin-left: auto; color: #333344; }

  .main-content {
    position: relative; z-index: 2;
    display: flex; flex: 1; overflow: hidden;
  }

  .side-panel {
    width: 28px;
    background: var(--ink2);
    border-right: 1px solid #2a2a3a;
    display: flex; flex-direction: column; align-items: center;
    padding: 12px 0; gap: 20px; flex-shrink: 0;
  }
  .side-char { font-family: var(--font-jp); font-size: 9px; color: var(--muted); writing-mode: vertical-rl; letter-spacing: 3px; }
  .side-line { flex: 1; width: 1px; background: linear-gradient(to bottom, transparent, var(--red), transparent); }

  .messages {
    flex: 1; overflow-y: auto;
    padding: 12px 14px;
    display: flex; flex-direction: column; gap: 10px;
    min-height: 340px; max-height: 340px;
    scrollbar-width: thin;
    scrollbar-color: #2a2a3a var(--ink);
  }
  .messages::-webkit-scrollbar { width: 2px; }
  .messages::-webkit-scrollbar-thumb { background: var(--red); }

  .msg { display: flex; flex-direction: column; gap: 3px; animation: appear 0.2s ease; }
  @keyframes appear { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

  .msg-head { display: flex; align-items: center; gap: 6px; }
  .msg-name { font-family: var(--font-title); font-size: 13px; letter-spacing: 3px; }
  .msg-name.you { color: var(--gold); }
  .msg-name.cpu { color: var(--red2); }
  .msg-jp { font-family: var(--font-jp); font-size: 8px; color: var(--muted); letter-spacing: 1px; }
  .msg-ts { margin-left: auto; font-size: 8px; color: #333344; }

  .msg-body {
    font-size: 11px; line-height: 1.8;
    padding: 8px 10px;
    border-left: 2px solid;
    word-break: break-word;
    white-space: pre-wrap;
    max-width: 94%;
  }
  .msg.user .msg-body { border-color: var(--gold); color: var(--cream); background: rgba(245,200,66,0.05); align-self: flex-end; }
  .msg.bot .msg-body { border-color: var(--red); color: var(--cream); background: rgba(232,0,61,0.05); align-self: flex-start; }
  .msg.sys .msg-body { border-color: var(--muted); color: var(--muted); font-size: 9px; background: transparent; padding: 2px 8px; }

  .typing-body { display: flex; gap: 5px; align-items: center; padding: 8px 10px; border-left: 2px solid var(--red); background: rgba(232,0,61,0.05); }
  .typing-body span { width: 5px; height: 5px; border-radius: 50%; background: var(--red2); animation: tb 1s infinite; }
  .typing-body span:nth-child(2) { animation-delay: 0.15s; }
  .typing-body span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes tb { 0%,80%,100% { opacity: 0.15; transform: scale(0.7); } 40% { opacity: 1; transform: scale(1); } }

  .panel-divider {
    position: relative; z-index: 2;
    display: flex; align-items: center; gap: 10px;
    padding: 0 14px;
  }
  .panel-divider::before, .panel-divider::after { content: ''; flex: 1; height: 1px; background: #2a2a3a; }
  .panel-divider span { font-size: 8px; color: var(--red); letter-spacing: 3px; white-space: nowrap; }

  .input-zone {
    position: relative; z-index: 2;
    background: var(--ink2);
    border-top: 2px solid var(--red);
    padding: 10px 14px;
  }
  .input-label { font-size: 8px; color: var(--muted); letter-spacing: 3px; margin-bottom: 6px; display: flex; align-items: center; gap: 8px; }
  .input-label::after { content: ''; flex: 1; height: 1px; background: #2a2a3a; }
  .input-row { display: flex; align-items: center; gap: 10px; }
  .input-prefix { font-family: var(--font-title); font-size: 16px; color: var(--red); }
  .input-zone input {
    flex: 1; background: transparent;
    border: none; border-bottom: 1px solid #2a2a3a;
    outline: none; color: var(--cream);
    font-family: var(--font-mono); font-size: 11px;
    padding: 4px 0; caret-color: var(--red); letter-spacing: 1px;
  }
  .input-zone input::placeholder { color: #333344; }
  .input-zone input:focus { border-bottom-color: var(--red); }
  .send-btn {
    background: transparent;
    border: 1px solid var(--red);
    color: var(--red);
    font-family: var(--font-title);
    font-size: 13px; letter-spacing: 3px;
    padding: 5px 16px; cursor: pointer;
    transition: all 0.1s;
  }
  .send-btn:hover { background: var(--red); color: var(--cream); }
  .send-btn:disabled { border-color: var(--muted); color: var(--muted); cursor: not-allowed; }

  .history-zone {
    position: relative; z-index: 2;
    background: var(--ink);
    border-top: 1px solid #1a1a24;
    padding: 6px 14px 10px;
  }
  .hist-label { font-size: 8px; color: var(--muted); letter-spacing: 3px; margin-bottom: 5px; }
  .hist-chips { display: flex; gap: 5px; overflow-x: auto; scrollbar-width: none; }
  .hist-chips::-webkit-scrollbar { display: none; }
  .hist-chip {
    flex-shrink: 0; font-size: 8px; color: var(--muted);
    border: 1px solid #2a2a3a; padding: 3px 10px;
    cursor: pointer; white-space: nowrap; letter-spacing: 1px;
    transition: all 0.1s;
  }
  .hist-chip:hover { color: var(--gold); border-color: var(--gold); }

  .footer {
    position: relative; z-index: 2;
    border-top: 1px solid #1a1a24;
    padding: 4px 14px;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 7px; color: #333344;
  }
  .footer-jp { font-family: var(--font-jp); letter-spacing: 2px; }
`;

function getTime() {
  const d = new Date();
  return d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
}

export default function App() {
  const [messages, setMessages] = useState([
    { role: "sys", text: "// システム起動 — GCP AI Copilot initialized" },
    { role: "bot", text: "よろしく。 I am your GCP AI Copilot. Ask me anything about Google Cloud — Vertex AI, Dialogflow, BigQuery, and more. The data is loaded. Let's begin.", ts: "00:00" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([
    "What is Vertex AI?",
    "How does Dialogflow work?",
    "Explain Cloud TPU",
  ]);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage(question) {
    const q = (question || input).trim();
    if (!q || loading) return;
    setInput("");
    setLoading(true);

    const userMsg = { role: "user", text: q, ts: getTime() };
    setMessages((prev) => [...prev, userMsg]);

    if (!history.includes(q)) {
      setHistory((prev) => [q, ...prev].slice(0, 8));
    }

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) {
        setMessages((prev) => [...prev, { role: "sys", text: `// エラー — API returned ${res.status}` }]);
      } else {
        const data = await res.json();
        setMessages((prev) => [...prev, { role: "bot", text: data.answer, ts: getTime() }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "sys", text: "// 接続失敗 — run: uvicorn api.main:app --reload" }]);
    }
    setLoading(false);
    inputRef.current?.focus();
  }

  return (
    <>
      <style>{styles}</style>
      <div className="shell">
        <div className="manga-lines" />

        <div className="top-bar">
          <div className="top-left">
            <div className="top-jp">ジーシーピー・コパイロット</div>
            <div className="top-title">GCP COPILOT</div>
          </div>
          <div className="top-right">
            <span className="ep-label">EP.</span>
            <span className="ep-num">01</span>
          </div>
        </div>

        <div className="info-strip">
          <div className="info-dot" />
          <span>SYSTEM <span className="info-tag">ONLINE</span></span>
          <span>RAG <span className="info-tag">READY</span></span>
          <span>VECTORS <span className="info-tag">2594</span></span>
          <span className="info-right">localhost:8000</span>
        </div>

        <div className="main-content">
          <div className="side-panel">
            <span className="side-char">クエリ</span>
            <div className="side-line" />
            <span className="side-char">応答</span>
          </div>

          <div className="messages">
            {messages.map((msg, i) => (
              <div key={i} className={`msg ${msg.role}`}>
                {msg.role !== "sys" && (
                  <div className="msg-head">
                    <span className={`msg-name ${msg.role === "user" ? "you" : "cpu"}`}>
                      {msg.role === "user" ? "YOU" : "COPILOT"}
                    </span>
                    <span className="msg-jp">{msg.role === "user" ? "あなた" : "コパイロット"}</span>
                    <span className="msg-ts">{msg.ts}</span>
                  </div>
                )}
                <div className="msg-body">{msg.text}</div>
              </div>
            ))}
            {loading && (
              <div className="msg bot">
                <div className="msg-head">
                  <span className="msg-name cpu">COPILOT</span>
                  <span className="msg-jp">考え中...</span>
                </div>
                <div className="typing-body">
                  <span /><span /><span />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="panel-divider"><span>INPUT SEQUENCE</span></div>

        <div className="input-zone">
          <div className="input-label">質問を入力してください</div>
          <div className="input-row">
            <span className="input-prefix">▶</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="enter your question..."
              autoComplete="off"
            />
            <button className="send-btn" onClick={() => sendMessage()} disabled={loading}>
              送信
            </button>
          </div>
        </div>

        <div className="history-zone">
          <div className="hist-label">// 履歴 — RECENT QUERIES</div>
          <div className="hist-chips">
            {history.map((q, i) => (
              <div key={i} className="hist-chip" onClick={() => sendMessage(q)}>
                {q.length > 42 ? q.slice(0, 42) + "..." : q}
              </div>
            ))}
          </div>
        </div>

        <div className="footer">
          <span className="footer-jp">見ていてくれ — 宇宙カウボーイ</span>
          <span>GCP COPILOT © 2025</span>
          <span>RAG + QDRANT + GROQ</span>
        </div>
      </div>
    </>
  );
}