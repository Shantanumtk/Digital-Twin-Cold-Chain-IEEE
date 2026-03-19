'use client';
import { useState, useRef, useEffect } from 'react';

interface Message { role: 'user' | 'assistant'; content: string; }

const SUGGESTIONS = [
  'Which assets are critical right now?',
  'What triggered the last alert?',
  'Compare truck temperatures',
  'Show me the worst-performing asset',
];

export default function FloatingChatBubble() {
  const [open, setOpen]         = useState(false);
  const [msgs, setMsgs]         = useState<Message[]>([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [convId]                = useState(() => Math.random().toString(36).slice(2));
  const bottomRef               = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, loading]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: Message = { role: 'user', content: text };
    setMsgs(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    try {
      const r = await fetch('/api/chat/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversation_id: convId }),
      });
      const d = await r.json();
      setMsgs(prev => [...prev, { role: 'assistant', content: d.response ?? 'No response' }]);
    } catch (err) {
      setMsgs(prev => [...prev, { role: 'assistant', content: '⚠ Could not reach the AI agent.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Bubble trigger */}
      <button onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 left-6 z-50 w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-500
          shadow-lg flex items-center justify-center text-2xl transition-transform hover:scale-110">
        {open ? '✕' : '🤖'}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 left-6 z-50 w-80 max-h-[60vh] flex flex-col
          bg-gray-900 rounded-2xl shadow-2xl border border-gray-700 overflow-hidden">

          {/* Header */}
          <div className="px-4 py-3 bg-gray-800 border-b border-gray-700 flex items-center gap-2">
            <span className="text-blue-400 text-lg">🤖</span>
            <span className="text-white font-semibold text-sm">Cold Chain AI</span>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">
            {msgs.length === 0 && (
              <div className="space-y-2">
                <p className="text-gray-500 text-xs text-center">Ask me anything about your fleet</p>
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => send(s)}
                    className="w-full text-left text-xs bg-gray-800 hover:bg-gray-700 text-gray-300
                      px-3 py-2 rounded-lg transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed
                  ${m.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-none'
                    : 'bg-gray-800 text-gray-200 rounded-bl-none'}`}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-800 text-gray-400 text-xs px-3 py-2 rounded-xl rounded-bl-none">
                  Thinking…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-2 border-t border-gray-700 flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send(input)}
              placeholder="Ask about your fleet…"
              className="flex-1 bg-gray-800 text-white text-xs rounded-lg px-3 py-2
                border border-gray-600 focus:outline-none focus:border-blue-500 placeholder-gray-500"
            />
            <button onClick={() => send(input)} disabled={loading || !input.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs
                px-3 py-2 rounded-lg transition-colors">
              ↑
            </button>
          </div>
        </div>
      )}
    </>
  );
}
