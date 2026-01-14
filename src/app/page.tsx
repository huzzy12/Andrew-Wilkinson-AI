'use client';

import { useState, useRef, useEffect } from 'react';
import { Playfair_Display, Inter } from 'next/font/google';

const playfair = Playfair_Display({ subsets: ['latin'], weight: ['400', '600', '700'] });
const inter = Inter({ subsets: ['latin'], weight: ['400', '500'] });

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  id: string;
}

interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
}

const STORAGE_KEY = 'ask-andrew-chats';

export default function Home() {
  const [query, setQuery] = useState('');
  const [currentChat, setCurrentChat] = useState<Chat | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Theme effect
  useEffect(() => {
    const savedTheme = localStorage.getItem('ask-andrew-theme') as 'light' | 'dark' | null;
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('ask-andrew-theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  };
  const inputRef = useRef<HTMLInputElement>(null);

  // Load chats from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Chat[];
      setChats(parsed);
      // Load most recent chat if exists
      if (parsed.length > 0) {
        setCurrentChat(parsed[0]);
      }
    }
  }, []);

  // Save chats to localStorage
  useEffect(() => {
    if (chats.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
    }
  }, [chats]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentChat?.messages, loading]);

  const startNewChat = () => {
    setSidebarOpen(false);
    setCurrentChat(null);
  };

  const selectChat = (chat: Chat) => {
    setCurrentChat(chat);
    setSidebarOpen(false);
  };

  const deleteChat = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setChats(prev => prev.filter(c => c.id !== chatId));
    if (currentChat?.id === chatId) {
      setCurrentChat(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || loading) return;

    const userQ = query.trim();
    setQuery('');
    setLoading(true);

    const userMessage: Message = { role: 'user', content: userQ, id: Date.now().toString() };
    
    // Create new chat or update existing
    let chat = currentChat;
    if (!chat) {
      chat = {
        id: Date.now().toString(),
        title: userQ.slice(0, 50) + (userQ.length > 50 ? '...' : ''),
        messages: [],
        createdAt: Date.now(),
      };
    }
    
    chat = { ...chat, messages: [...chat.messages, userMessage] };
    setCurrentChat(chat);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userQ }),
      });
      const data = await res.json();
      
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.answer,
        sources: data.sources,
        id: (Date.now() + 1).toString()
      };
      
      chat = { ...chat, messages: [...chat.messages, assistantMessage] };
      setCurrentChat(chat);
      
      // Update chats list
      setChats(prev => {
        const existing = prev.find(c => c.id === chat!.id);
        if (existing) {
          return prev.map(c => c.id === chat!.id ? chat! : c);
        }
        return [chat!, ...prev];
      });
      
    } catch {
      const errorMessage: Message = { role: 'assistant', content: "Something went wrong. Andrew is offline.", id: 'error' };
      chat = { ...chat, messages: [...chat.messages, errorMessage] };
      setCurrentChat(chat);
    } finally {
      setLoading(false);
    }
  };

  const messages = currentChat?.messages || [];

  return (
    <div className={`min-h-screen flex ${inter.className} bg-[var(--bg)] text-[var(--fg)]`}>
      
      {/* Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      
      {/* Sidebar */}
      <aside className={`fixed md:relative z-50 h-screen w-72 bg-[var(--bg)] border-r border-[var(--border)] flex flex-col transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-4 border-b border-[var(--border)]">
          <button 
            onClick={startNewChat}
            className="w-full p-3 rounded-xl border border-[var(--border)] hover:bg-[var(--fg)] hover:text-[var(--bg)] transition-all flex items-center gap-2 text-sm font-medium"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            New Chat
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2">
          {chats.length === 0 ? (
            <p className="text-center text-sm opacity-40 py-8">No conversations yet</p>
          ) : (
            <div className="space-y-1">
              {chats.map(chat => (
                <div
                  key={chat.id}
                  onClick={() => selectChat(chat)}
                  className={`w-full text-left p-3 rounded-lg hover:bg-[var(--border)] transition-colors group flex items-center justify-between cursor-pointer ${currentChat?.id === chat.id ? 'bg-[var(--border)]' : ''}`}
                >
                  <span className="text-sm truncate flex-1">{chat.title}</span>
                  <button
                    onClick={(e) => deleteChat(chat.id, e)}
                    className="opacity-0 group-hover:opacity-50 hover:opacity-100 p-1 transition-opacity"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className="p-4 border-t border-[var(--border)] text-xs opacity-40">
          <p>Chats saved locally on your device</p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        
        {/* Navigation */}
        <nav className="sticky top-0 z-30 glass-panel h-16 flex items-center justify-between px-4 md:px-8">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="md:hidden p-2 hover:bg-[var(--border)] rounded-lg transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12h18M3 6h18M3 18h18"/>
              </svg>
            </button>
            <div className={`text-xl tracking-tight font-semibold ${playfair.className}`}>Ask Andrew</div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-full hover:bg-[var(--border)] transition-colors opacity-60 hover:opacity-100"
              title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
            >
              {theme === 'light' ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
              )}
            </button>
            <a href="https://neverenough.com" target="_blank" className="text-sm opacity-60 hover:opacity-100 transition-opacity">
              neverenough.com ↗
            </a>
          </div>
        </nav>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto w-full px-4 md:px-0 py-8 pb-48">
            
            {/* Empty State */}
            {messages.length === 0 && (
              <div className="mt-12 space-y-10 animate-warm-up">
                <h1 className={`${playfair.className} text-4xl md:text-6xl font-semibold leading-[1.1] tracking-tight`}>
                  The digital brain of<br/>Andrew Wilkinson.
                </h1>
                <p className="text-lg opacity-60 max-w-lg leading-relaxed">
                  Search across 36 newsletters for wisdom on Tiny, entrepreneurship, mental models, and life.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    "How does Tiny evaluate acquisitions?",
                    "Why is divorce awesome?",
                    "What is the 'unlived life' of a parent?",
                    "What books does Andrew recommend?"
                  ].map((q) => (
                    <button 
                      key={q}
                      onClick={() => { setQuery(q); inputRef.current?.focus(); }}
                      className="text-left p-5 border border-[var(--border)] rounded-xl hover:bg-[var(--fg)] hover:text-[var(--bg)] transition-all duration-300"
                    >
                      <span className={`${playfair.className} text-lg`}>{q}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Conversation Stream */}
            <div className="space-y-12">
              {messages.map((msg) => (
                <div key={msg.id} className="animate-warm-up space-y-4">
                  
                  {/* Question */}
                  {msg.role === 'user' && (
                    <div className="flex items-start gap-3 opacity-70">
                      <div className="w-7 h-7 rounded-full bg-[var(--fg)] flex items-center justify-center flex-shrink-0">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--bg)" strokeWidth="2">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                          <circle cx="12" cy="7" r="4"/>
                        </svg>
                      </div>
                      <h3 className={`text-xl ${playfair.className} pt-0.5`}>{msg.content}</h3>
                    </div>
                  )}

                  {/* Answer */}
                  {msg.role === 'assistant' && (
                    <div className="flex items-start gap-3">
                      {/* Andrew's photo */}
                      <img 
                        src="/andrew-image.jpg" 
                        alt="Andrew Wilkinson" 
                        className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                      />
                      <div className="flex-1 space-y-4">
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                        
                        {/* Sources */}
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="pt-3 mt-4 border-t border-dashed border-[var(--border)]">
                            <p className="text-xs uppercase tracking-wider opacity-30 mb-2">Sources</p>
                            <div className="flex flex-wrap gap-1.5">
                              {msg.sources.map(src => (
                                <span key={src} className="text-xs px-2 py-1 bg-[var(--border)] rounded-md opacity-60">
                                  {src}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Loading */}
              {loading && (
                <div className="pl-10 ml-3 border-l-2 border-[var(--border)]">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 px-3 py-2 bg-[var(--border)] rounded-full">
                      <span className="w-1.5 h-1.5 bg-[var(--fg)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                      <span className="w-1.5 h-1.5 bg-[var(--fg)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                      <span className="w-1.5 h-1.5 bg-[var(--fg)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                    </div>
                    <span className="text-sm opacity-30">Searching newsletters...</span>
                  </div>
                </div>
              )}
              <div ref={scrollRef} />
            </div>
          </div>
        </div>

        {/* Input Area */}
        <div className="sticky bottom-0 bg-gradient-to-t from-[var(--bg)] via-[var(--bg)] to-transparent pt-8 pb-6 px-4">
          <div className="max-w-3xl mx-auto relative">
            <div className="rounded-2xl bg-[var(--bg)] shadow-2xl border border-[var(--border)] p-2 flex items-center gap-2 input-ring transition-shadow duration-300">
              <input
                ref={inputRef}
                className="w-full bg-transparent p-3 text-base outline-none placeholder:opacity-30"
                placeholder="Ask a question..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit(e)}
                disabled={loading}
              />
              <button 
                onClick={handleSubmit}
                disabled={!query.trim() || loading}
                className="p-2.5 bg-[var(--fg)] text-[var(--bg)] rounded-xl hover:opacity-90 disabled:opacity-20 transition-all duration-300"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
