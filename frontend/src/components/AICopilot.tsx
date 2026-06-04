/**
 * BTI AI Copilot — Terminal AI assistant panel
 * Powered by Ollama (llama3.1:8b) with Claude API fallback
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

interface CopilotMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  provider?: string;
  latency_ms?: number;
  timestamp: string;
}

interface QuickPrompt {
  key: string;
  label: string;
}

interface AICopilotProps {
  ticker?: string;
  tickerData?: {
    price?: number;
    signal?: string;
    rsi?: number;
    xgb_proba_up?: number;
    sentiment?: string;
  };
}

const SUGGESTED_QUESTIONS = [
  'What is the current market regime?',
  'Explain the XGBoost signal for this ticker',
  'Top 3 risks in Indian markets today',
  'How does RBI policy affect banking stocks?',
  'Explain PCR ratio and what it means now',
  'Best sectors for momentum right now?',
  'How to read the IV surface chart?',
  'What are block deals indicating?',
];

function MessageBubble({ msg }: { msg: CopilotMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[85%] rounded px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? 'bg-amber-900/40 border border-amber-700/50 text-amber-100'
            : 'bg-gray-800/70 border border-gray-600/40 text-gray-200'
        }`}
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        {!isUser && (
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-green-400 font-mono text-xs font-bold">BTI COPILOT</span>
            {msg.provider && (
              <span className="text-gray-500 text-xs">
                [{msg.provider.toUpperCase()}
                {msg.latency_ms ? ` ${Math.round(msg.latency_ms)}ms` : ''}]
              </span>
            )}
          </div>
        )}
        <div
          dangerouslySetInnerHTML={{
            __html: msg.content
              .replace(/\*\*(.*?)\*\*/g, '<strong class="text-amber-300">$1</strong>')
              .replace(/\*(.*?)\*/g, '<em class="text-gray-300">$1</em>')
              .replace(/`(.*?)`/g, '<code class="bg-black/40 px-1 rounded text-green-300 font-mono text-xs">$1</code>')
              .replace(/^• /gm, '<span class="text-amber-500">• </span>')
              .replace(/^- /gm, '<span class="text-amber-500">• </span>')
              .replace(/^\d+\. /gm, (m) => `<span class="text-amber-400">${m}</span>`),
          }}
        />
        <div className="text-gray-600 text-xs mt-1 text-right">
          {msg.timestamp.slice(11, 19)}
        </div>
      </div>
    </div>
  );
}

export default function AICopilot({ ticker, tickerData }: AICopilotProps) {
  const [messages, setMessages] = useState<CopilotMessage[]>([
    {
      role: 'assistant',
      content:
        '**BTI Copilot ready.** I\'m your AI financial analyst powered by Ollama LLM.\n\n' +
        'I can help with:\n• Stock analysis & signals\n• Options strategies\n• Macro interpretation\n• Portfolio review\n\n' +
        (ticker ? `Currently analyzing **${ticker}**. Ask me anything about it.` : 'Select a ticker to get context-aware analysis.'),
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => `session_${Date.now()}`);
  const [quickPrompts, setQuickPrompts] = useState<QuickPrompt[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/api/ai/quick-prompts')
      .then((r) => r.json())
      .then(setQuickPrompts)
      .catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const buildContext = useCallback(() => {
    if (!ticker) return {};
    return {
      ticker,
      price: tickerData?.price,
      hedge_fund_signal: tickerData?.signal,
      rsi: tickerData?.rsi,
      xgb_proba_up: tickerData?.xgb_proba_up,
      sentiment: tickerData?.sentiment,
    };
  }, [ticker, tickerData]);

  const sendMessage = useCallback(
    async (text: string) => {
      const userMsg = text.trim();
      if (!userMsg || loading) return;

      const userMessage: CopilotMessage = {
        role: 'user',
        content: userMsg,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setInput('');
      setLoading(true);

      try {
        const resp = await fetch('/api/ai/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: userMsg,
            session_id: sessionId,
            context: buildContext(),
          }),
        });
        const data = await resp.json();

        const assistantMessage: CopilotMessage = {
          role: 'assistant',
          content: data.error
            ? `⚠️ ${data.error}\n\n${data.content || ''}`
            : data.content || 'No response received.',
          provider: data.provider,
          latency_ms: data.latency_ms,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: '⚠️ Failed to connect to AI backend. Check that the backend is running.',
            timestamp: new Date().toISOString(),
          },
        ]);
      } finally {
        setLoading(false);
        inputRef.current?.focus();
      }
    },
    [loading, sessionId, buildContext]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const clearChat = async () => {
    await fetch(`/api/ai/session/${sessionId}`, { method: 'DELETE' }).catch(() => {});
    setMessages([
      {
        role: 'assistant',
        content: 'Chat cleared. How can I help you?',
        timestamp: new Date().toISOString(),
      },
    ]);
  };

  return (
    <div className="flex flex-col h-full bg-gray-900/50 border border-gray-700/50 rounded">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700/50 bg-gray-800/50">
        <div className="flex items-center gap-2">
          <span className="text-green-400 font-mono font-bold text-sm">◆ BTI COPILOT</span>
          <span className="text-gray-500 text-xs">Ollama llama3.1:8b</span>
          {ticker && (
            <span className="bg-amber-900/40 border border-amber-700/50 text-amber-300 text-xs px-2 py-0.5 rounded font-mono">
              {ticker}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          )}
          <button
            onClick={clearChat}
            className="text-gray-500 hover:text-gray-300 text-xs border border-gray-600/50 rounded px-2 py-0.5 transition-colors"
          >
            CLEAR
          </button>
        </div>
      </div>

      {/* Quick Suggested Questions */}
      <div className="px-3 pt-2 pb-1 border-b border-gray-700/30">
        <div className="flex flex-wrap gap-1">
          {SUGGESTED_QUESTIONS.slice(0, 4).map((q) => (
            <button
              key={q}
              onClick={() => sendMessage(q)}
              disabled={loading}
              className="text-xs text-amber-600 hover:text-amber-400 border border-amber-900/40 hover:border-amber-700/60 rounded px-2 py-0.5 transition-colors disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-gray-500 text-xs px-3 py-2">
            <div className="flex gap-1">
              {[0, 0.15, 0.3].map((d) => (
                <div
                  key={d}
                  className="w-1.5 h-1.5 rounded-full bg-green-500 animate-bounce"
                  style={{ animationDelay: `${d}s` }}
                />
              ))}
            </div>
            <span>Analyzing…</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Context bar (when ticker selected) */}
      {ticker && tickerData && (
        <div className="px-3 py-1.5 border-t border-gray-700/30 bg-gray-800/30">
          <div className="flex gap-3 text-xs font-mono">
            {tickerData.price && (
              <span className="text-gray-400">
                Price: <span className="text-amber-300">₹{tickerData.price.toFixed(2)}</span>
              </span>
            )}
            {tickerData.rsi && (
              <span className="text-gray-400">
                RSI: <span className={tickerData.rsi > 70 ? 'text-red-400' : tickerData.rsi < 30 ? 'text-green-400' : 'text-gray-300'}>{tickerData.rsi.toFixed(1)}</span>
              </span>
            )}
            {tickerData.signal && (
              <span className="text-gray-400">
                Signal: <span className={tickerData.signal === 'BUY' ? 'text-green-400' : tickerData.signal === 'SELL' ? 'text-red-400' : 'text-gray-300'}>{tickerData.signal}</span>
              </span>
            )}
            {tickerData.xgb_proba_up != null && (
              <span className="text-gray-400">
                XGB↑: <span className="text-blue-300">{(tickerData.xgb_proba_up * 100).toFixed(0)}%</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-gray-700/50">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about any stock, macro event, strategy… (Enter to send, Shift+Enter for new line)"
            rows={2}
            disabled={loading}
            className="flex-1 bg-gray-800/70 border border-gray-600/50 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-amber-700/60 resize-none font-mono"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            className="bg-amber-800/60 hover:bg-amber-700/60 disabled:bg-gray-700/40 disabled:text-gray-600 border border-amber-700/50 disabled:border-gray-600/30 text-amber-200 font-mono text-sm px-4 py-2 rounded transition-colors h-[60px]"
          >
            SEND
          </button>
        </div>
        <div className="text-gray-600 text-xs mt-1 text-right font-mono">
          Ollama → Claude fallback • context-aware
        </div>
      </div>
    </div>
  );
}
