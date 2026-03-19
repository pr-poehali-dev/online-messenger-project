import { useState, useEffect, useRef, useCallback } from "react";
import Icon from "@/components/ui/icon";

const API = "https://functions.poehali.dev/f75d7445-347c-442d-95f3-9bbdc1d98807";

interface User {
  id: number;
  username: string;
  display_name: string;
}

interface Chat {
  chat_id: number;
  partner_id: number;
  partner_username: string;
  partner_display_name: string;
  last_message: string | null;
  last_at: string | null;
}

interface Message {
  id: number;
  content: string;
  created_at: string;
  sender_id: number;
  sender_name: string;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин`;
  if (diff < 86400) return d.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("ru", { day: "numeric", month: "short" });
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
}

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

const AVATAR_COLORS = [
  "bg-rose-100 text-rose-600",
  "bg-blue-100 text-blue-600",
  "bg-emerald-100 text-emerald-600",
  "bg-amber-100 text-amber-600",
  "bg-violet-100 text-violet-600",
  "bg-cyan-100 text-cyan-600",
];

function avatarColor(id: number): string {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

export default function Index() {
  const [me, setMe] = useState<User | null>(null);
  const [loginForm, setLoginForm] = useState({ username: "", display_name: "" });
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [showSearch, setShowSearch] = useState(false);

  const lastMsgId = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const apiHeaders = (userId?: number) => ({
    "Content-Type": "application/json",
    ...(userId ? { "X-User-Id": String(userId) } : {}),
  });

  const fetchChats = useCallback(async (userId: number) => {
    const res = await fetch(`${API}/chats`, { headers: apiHeaders(userId) });
    if (res.ok) setChats(await res.json());
  }, []);

  const fetchMessages = useCallback(async (chatId: number, userId: number, afterId = 0): Promise<Message[]> => {
    const res = await fetch(`${API}/messages?chat_id=${chatId}&after_id=${afterId}`, {
      headers: apiHeaders(userId),
    });
    if (res.ok) return res.json();
    return [];
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("messenger_user");
    if (saved) setMe(JSON.parse(saved));
  }, []);

  useEffect(() => {
    if (!me) return;
    fetchChats(me.id);
    const interval = setInterval(() => fetchChats(me.id), 5000);
    return () => clearInterval(interval);
  }, [me, fetchChats]);

  useEffect(() => {
    if (!activeChat || !me) return;
    lastMsgId.current = 0;
    setMessages([]);

    const load = async () => {
      const msgs = await fetchMessages(activeChat.chat_id, me.id, 0);
      if (msgs.length > 0) lastMsgId.current = msgs[msgs.length - 1].id;
      setMessages(msgs);
    };
    load();

    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      const newMsgs = await fetchMessages(activeChat.chat_id, me.id, lastMsgId.current);
      if (newMsgs.length > 0) {
        lastMsgId.current = newMsgs[newMsgs.length - 1].id;
        setMessages((prev) => [...prev, ...newMsgs]);
      }
    }, 2000);

    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [activeChat, me, fetchMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleLogin = async () => {
    const u = loginForm.username.trim();
    const d = loginForm.display_name.trim();
    if (!u || !d) { setLoginError("Заполни оба поля"); return; }
    if (!/^[a-z0-9_]+$/.test(u)) { setLoginError("Логин: только латиница, цифры и _"); return; }
    setLoginError("");
    setLoginLoading(true);
    const res = await fetch(`${API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, display_name: d }),
    });
    const data = await res.json();
    setLoginLoading(false);
    if (res.ok) {
      setMe(data);
      localStorage.setItem("messenger_user", JSON.stringify(data));
    } else {
      setLoginError(data.error || "Ошибка входа");
    }
  };

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (q.length < 1) { setSearchResults([]); return; }
    const res = await fetch(`${API}/users?q=${encodeURIComponent(q)}`, { headers: apiHeaders(me?.id) });
    if (res.ok) setSearchResults(await res.json());
  };

  const startChat = async (partner: User) => {
    if (!me) return;
    const res = await fetch(`${API}/chats`, {
      method: "POST",
      headers: apiHeaders(me.id),
      body: JSON.stringify({ partner_id: partner.id }),
    });
    if (res.ok) {
      const data = await res.json();
      const chat: Chat = {
        chat_id: data.chat_id,
        partner_id: partner.id,
        partner_username: partner.username,
        partner_display_name: partner.display_name,
        last_message: null,
        last_at: null,
      };
      setActiveChat(chat);
      setShowSearch(false);
      setSearchQuery("");
      setSearchResults([]);
      fetchChats(me.id);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || !activeChat || !me || sending) return;
    setSending(true);
    const content = input.trim();
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    await fetch(`${API}/messages`, {
      method: "POST",
      headers: apiHeaders(me.id),
      body: JSON.stringify({ chat_id: activeChat.chat_id, content }),
    });
    const newMsgs = await fetchMessages(activeChat.chat_id, me.id, lastMsgId.current);
    if (newMsgs.length > 0) {
      lastMsgId.current = newMsgs[newMsgs.length - 1].id;
      setMessages((prev) => [...prev, ...newMsgs]);
    }
    setSending(false);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Login screen
  if (!me) {
    return (
      <div className="min-h-screen bg-white flex">
        <div className="hidden lg:flex w-1/2 bg-gray-50 items-center justify-center">
          <div className="text-center">
            <div className="w-14 h-14 bg-gray-900 rounded-2xl mx-auto mb-6 flex items-center justify-center">
              <Icon name="MessageSquare" size={26} className="text-white" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Мессенджер</h2>
            <p className="text-sm text-gray-400 max-w-xs">Общайся с друзьями в реальном времени</p>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center px-8">
          <div className="w-full max-w-sm">
            <div className="mb-8">
              <div className="w-10 h-10 bg-gray-900 rounded-xl mb-5 flex items-center justify-center lg:hidden">
                <Icon name="MessageSquare" size={20} className="text-white" />
              </div>
              <h1 className="text-2xl font-semibold text-gray-900 mb-1">Добро пожаловать</h1>
              <p className="text-sm text-gray-400">Войди или зарегистрируйся</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 tracking-wider uppercase">
                  Логин
                </label>
                <input
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400 transition-colors bg-gray-50 focus:bg-white"
                  placeholder="ivan_petrov"
                  value={loginForm.username}
                  onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value.toLowerCase() })}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 tracking-wider uppercase">
                  Имя
                </label>
                <input
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400 transition-colors bg-gray-50 focus:bg-white"
                  placeholder="Иван Петров"
                  value={loginForm.display_name}
                  onChange={(e) => setLoginForm({ ...loginForm, display_name: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                />
              </div>
              {loginError && (
                <p className="text-xs text-red-500">{loginError}</p>
              )}
              <button
                onClick={handleLogin}
                disabled={loginLoading}
                className="w-full bg-gray-900 text-white rounded-xl py-3 text-sm font-medium hover:bg-gray-700 active:bg-gray-800 transition-colors disabled:opacity-50"
              >
                {loginLoading ? "Входим..." : "Войти"}
              </button>
            </div>
            <p className="text-xs text-gray-300 text-center mt-5">
              Логин существует — войдёшь автоматически
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Main messenger
  return (
    <div className="min-h-screen bg-white flex overflow-hidden" style={{ height: "100vh" }}>
      {/* Sidebar */}
      <div className="w-72 xl:w-80 border-r border-gray-100 flex flex-col flex-shrink-0">
        {/* Profile header */}
        <div className="px-4 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${avatarColor(me.id)}`}>
            {getInitials(me.display_name)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">{me.display_name}</div>
            <div className="text-xs text-gray-400">@{me.username}</div>
          </div>
          <button
            onClick={() => setShowSearch(!showSearch)}
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${showSearch ? "bg-gray-900 text-white" : "hover:bg-gray-100 text-gray-400"}`}
          >
            <Icon name="Search" size={15} />
          </button>
          <button
            onClick={() => { localStorage.removeItem("messenger_user"); setMe(null); setActiveChat(null); setChats([]); }}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
          >
            <Icon name="LogOut" size={15} />
          </button>
        </div>

        {/* Search panel */}
        {showSearch && (
          <div className="px-4 pt-3 pb-2 border-b border-gray-100">
            <div className="relative">
              <Icon name="Search" size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
              <input
                className="w-full bg-gray-50 rounded-lg pl-8 pr-3 py-2 text-sm outline-none focus:ring-1 focus:ring-gray-200 transition-all"
                placeholder="Найти пользователя..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                autoFocus
              />
            </div>
            {searchResults.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {searchResults.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => startChat(u)}
                    className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${avatarColor(u.id)}`}>
                      {getInitials(u.display_name)}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-800">{u.display_name}</div>
                      <div className="text-xs text-gray-400">@{u.username}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {searchQuery.length > 0 && searchResults.length === 0 && (
              <p className="text-xs text-gray-300 text-center py-3">Никого не нашлось</p>
            )}
          </div>
        )}

        {/* Chats list */}
        <div className="flex-1 overflow-y-auto">
          {chats.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6 py-10">
              <Icon name="MessageSquare" size={32} className="text-gray-200 mb-3" />
              <p className="text-sm text-gray-400 font-medium">Нет диалогов</p>
              <p className="text-xs text-gray-300 mt-1">Найди друга через поиск ↑</p>
            </div>
          ) : (
            chats.map((chat) => (
              <button
                key={chat.chat_id}
                onClick={() => setActiveChat(chat)}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left group ${
                  activeChat?.chat_id === chat.chat_id ? "bg-gray-50 border-r-2 border-gray-900" : ""
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${avatarColor(chat.partner_id)}`}>
                  {getInitials(chat.partner_display_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-sm font-medium text-gray-900 truncate">{chat.partner_display_name}</span>
                    <span className="text-xs text-gray-300 ml-2 flex-shrink-0">{timeAgo(chat.last_at)}</span>
                  </div>
                  <p className="text-xs text-gray-400 truncate">
                    {chat.last_message || <span className="italic text-gray-300">Нет сообщений</span>}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeChat ? (
          <>
            {/* Chat header */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${avatarColor(activeChat.partner_id)}`}>
                {getInitials(activeChat.partner_display_name)}
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-900">{activeChat.partner_display_name}</div>
                <div className="text-xs text-gray-400">@{activeChat.partner_username}</div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-0.5">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full">
                  <Icon name="MessageSquare" size={28} className="text-gray-200 mb-2" />
                  <p className="text-sm text-gray-300">Начни диалог первым</p>
                </div>
              )}
              {messages.map((msg, i) => {
                const isMe = msg.sender_id === me.id;
                const prevMsg = messages[i - 1];
                const nextMsg = messages[i + 1];
                const isFirst = !prevMsg || prevMsg.sender_id !== msg.sender_id;
                const isLast = !nextMsg || nextMsg.sender_id !== msg.sender_id;
                const gap = isFirst ? "mt-4" : "mt-0.5";

                const borderRadius = isMe
                  ? `rounded-2xl rounded-br-${isLast ? "sm" : "2xl"}`
                  : `rounded-2xl rounded-bl-${isLast ? "sm" : "2xl"}`;

                return (
                  <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"} ${gap}`}>
                    <div className="max-w-xs lg:max-w-md xl:max-w-lg">
                      <div
                        className={`px-4 py-2.5 text-sm leading-relaxed ${
                          isMe
                            ? `bg-gray-900 text-white ${isFirst ? "rounded-t-2xl" : "rounded-2xl"} ${isLast ? "rounded-br-sm rounded-bl-2xl" : ""}`
                            : `bg-gray-100 text-gray-800 ${isFirst ? "rounded-t-2xl" : "rounded-2xl"} ${isLast ? "rounded-bl-sm rounded-br-2xl" : ""}`
                        }`}
                      >
                        {msg.content}
                      </div>
                      {isLast && (
                        <div className={`text-xs text-gray-300 mt-1 ${isMe ? "text-right" : "text-left"}`}>
                          {formatTime(msg.created_at)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="px-6 py-4 border-t border-gray-100 flex-shrink-0">
              <div className="flex items-end gap-3">
                <textarea
                  ref={textareaRef}
                  className="flex-1 border border-gray-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-gray-300 transition-colors resize-none bg-gray-50 focus:bg-white leading-relaxed"
                  placeholder="Сообщение... (Enter — отправить)"
                  value={input}
                  rows={1}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                  }}
                  onKeyDown={handleKeyDown}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || sending}
                  className="w-10 h-10 bg-gray-900 text-white rounded-xl flex items-center justify-center hover:bg-gray-700 active:scale-95 transition-all disabled:opacity-30 flex-shrink-0"
                >
                  <Icon name="Send" size={15} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
            <div className="w-16 h-16 bg-gray-50 rounded-3xl flex items-center justify-center mb-4">
              <Icon name="MessageSquare" size={28} className="text-gray-200" />
            </div>
            <p className="text-base font-medium text-gray-800">Выбери диалог</p>
            <p className="text-sm text-gray-400 mt-1">или найди друга через поиск в боковой панели</p>
          </div>
        )}
      </div>
    </div>
  );
}
