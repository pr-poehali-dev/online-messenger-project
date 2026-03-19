import { useState, useEffect, useRef, useCallback } from "react";
import Icon from "@/components/ui/icon";

const API_BASE = "https://functions.poehali.dev/f75d7445-347c-442d-95f3-9bbdc1d98807";
const API = (action: string) => `${API_BASE}?action=${action}`;

// ─── Types ───────────────────────────────────────────────
interface User {
  id: number;
  username: string;
  display_name: string;
  avatar_url?: string | null;
  is_verified?: boolean;
  is_admin?: boolean;
}

interface Chat {
  chat_id: number;
  partner_id: number;
  partner_username: string;
  partner_display_name: string;
  partner_avatar_url?: string | null;
  partner_verified?: boolean;
  last_message: string | null;
  last_at: string | null;
}

interface Message {
  id: number;
  content: string;
  created_at: string;
  sender_id: number;
  sender_name: string;
  msg_type: "text" | "image" | "voice" | "sticker";
  file_url?: string | null;
  is_removed?: boolean;
}

// ─── Emoji & Stickers ────────────────────────────────────
const EMOJIS = ["😀","😂","🥰","😎","🤔","😢","😡","🤯","👍","👎","❤️","🔥","✨","🎉","💯","🙏","👏","🤝","💪","🎵","🍕","☕","🚀","💡","🌟","😴","🤣","😇","🥳","😏"];
const STICKERS = ["🐶","🐱","🦊","🐻","🐼","🦁","🐸","🦋","🌈","⭐","🌺","🍦","🎸","🏆","💎","🎯","🌙","☀️","🌊","🍀"];

// ─── Helpers ─────────────────────────────────────────────
function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин`;
  if (diff < 86400) return d.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("ru", { day: "numeric", month: "short" });
}
function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
}
function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}
const AVATAR_COLORS = [
  "bg-rose-100 text-rose-600","bg-blue-100 text-blue-600",
  "bg-emerald-100 text-emerald-600","bg-amber-100 text-amber-600",
  "bg-violet-100 text-violet-600","bg-cyan-100 text-cyan-600",
];
function avatarColor(id: number): string { return AVATAR_COLORS[id % AVATAR_COLORS.length]; }

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res((reader.result as string).split(",")[1]);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

// ─── Avatar component ────────────────────────────────────
function Avatar({ user, size = 10 }: { user: { id: number; display_name: string; avatar_url?: string | null }; size?: number }) {
  const px = size * 4;
  if (user.avatar_url) {
    return <img src={user.avatar_url} className={`w-${size} h-${size} rounded-full object-cover flex-shrink-0`} style={{ width: px, height: px }} alt="" />;
  }
  return (
    <div className={`w-${size} h-${size} rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${avatarColor(user.id)}`} style={{ width: px, height: px, fontSize: px / 3.5 }}>
      {getInitials(user.display_name)}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────
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

  const [showEmoji, setShowEmoji] = useState(false);
  const [showStickers, setShowStickers] = useState(false);

  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  const [uploadingFile, setUploadingFile] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ msgId: number; x: number; y: number } | null>(null);

  // Admin panel
  const [showAdmin, setShowAdmin] = useState(false);
  const [bannedUsers, setBannedUsers] = useState<User[]>([]);

  const lastMsgId = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const apiHeaders = (userId?: number) => ({
    "Content-Type": "application/json",
    ...(userId ? { "X-User-Id": String(userId) } : {}),
  });

  // ── Fetch ────────────────────────────────────────────────
  const fetchChats = useCallback(async (userId: number) => {
    const res = await fetch(API("chats"), { headers: apiHeaders(userId) });
    if (res.ok) setChats(await res.json());
  }, []);

  const fetchMessages = useCallback(async (chatId: number, userId: number, afterId = 0): Promise<Message[]> => {
    const res = await fetch(`${API("messages")}&chat_id=${chatId}&after_id=${afterId}`, { headers: apiHeaders(userId) });
    if (res.ok) return res.json();
    return [];
  }, []);

  // ── Init ─────────────────────────────────────────────────
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

  // Close context menu on outside click
  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);

  // ── Auth ─────────────────────────────────────────────────
  const handleLogin = async () => {
    const u = loginForm.username.trim();
    const d = loginForm.display_name.trim();
    if (!u || !d) { setLoginError("Заполни оба поля"); return; }
    if (!/^[a-z0-9_]+$/.test(u)) { setLoginError("Логин: только латиница, цифры и _"); return; }
    setLoginError("");
    setLoginLoading(true);
    const res = await fetch(API("login"), {
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

  // ── Avatar upload ─────────────────────────────────────────
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!me || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    const file_data = await fileToBase64(file);
    const res = await fetch(API("upload-avatar"), {
      method: "POST",
      headers: apiHeaders(me.id),
      body: JSON.stringify({ file_data, mime: file.type }),
    });
    if (res.ok) {
      const data = await res.json();
      const updated = { ...me, avatar_url: data.avatar_url };
      setMe(updated);
      localStorage.setItem("messenger_user", JSON.stringify(updated));
    }
  };

  // ── Search ───────────────────────────────────────────────
  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (q.length < 1) { setSearchResults([]); return; }
    const res = await fetch(`${API("users")}&q=${encodeURIComponent(q)}`, { headers: apiHeaders(me?.id) });
    if (res.ok) setSearchResults(await res.json());
  };

  const startChat = async (partner: User) => {
    if (!me) return;
    const res = await fetch(API("chats"), {
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
        partner_avatar_url: partner.avatar_url,
        partner_verified: partner.is_verified,
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

  // ── Send message ─────────────────────────────────────────
  const doSend = async (content: string, msg_type: string = "text", file_url?: string) => {
    if (!activeChat || !me) return;
    setSending(true);
    await fetch(API("messages"), {
      method: "POST",
      headers: apiHeaders(me.id),
      body: JSON.stringify({ chat_id: activeChat.chat_id, content, msg_type, file_url }),
    });
    const newMsgs = await fetchMessages(activeChat.chat_id, me.id, lastMsgId.current);
    if (newMsgs.length > 0) {
      lastMsgId.current = newMsgs[newMsgs.length - 1].id;
      setMessages((prev) => [...prev, ...newMsgs]);
    }
    setSending(false);
    fetchChats(me.id);
  };

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    const content = input.trim();
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    await doSend(content, "text");
    textareaRef.current?.focus();
  };

  const sendEmoji = async (emoji: string) => {
    setShowEmoji(false);
    await doSend(emoji, "text");
  };

  const sendSticker = async (sticker: string) => {
    setShowStickers(false);
    await doSend(sticker, "sticker");
  };

  // ── File/Photo upload ─────────────────────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!me || !e.target.files?.[0] || !activeChat) return;
    const file = e.target.files[0];
    setUploadingFile(true);
    const file_data = await fileToBase64(file);
    const res = await fetch(API("upload-file"), {
      method: "POST",
      headers: apiHeaders(me.id),
      body: JSON.stringify({ file_data, mime: file.type, filename: file.name }),
    });
    if (res.ok) {
      const data = await res.json();
      const isImage = file.type.startsWith("image/");
      await doSend(isImage ? "📷 Фото" : `📎 ${file.name}`, isImage ? "image" : "text", data.file_url);
    }
    setUploadingFile(false);
    e.target.value = "";
  };

  // ── Voice ─────────────────────────────────────────────────
  const startRecording = async () => {
    if (!me || !activeChat) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    audioChunks.current = [];
    mr.ondataavailable = (e) => audioChunks.current.push(e.data);
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(audioChunks.current, { type: "audio/webm" });
      const reader = new FileReader();
      reader.onload = async () => {
        const file_data = (reader.result as string).split(",")[1];
        setUploadingFile(true);
        const res = await fetch(API("upload-file"), {
          method: "POST",
          headers: apiHeaders(me.id),
          body: JSON.stringify({ file_data, mime: "audio/webm", filename: "voice.webm" }),
        });
        if (res.ok) {
          const data = await res.json();
          await doSend("🎤 Голосовое сообщение", "voice", data.file_url);
        }
        setUploadingFile(false);
      };
      reader.readAsDataURL(blob);
    };
    mr.start();
    setMediaRecorder(mr);
    setRecording(true);
  };

  const stopRecording = () => {
    mediaRecorder?.stop();
    setMediaRecorder(null);
    setRecording(false);
  };

  // ── Delete message ────────────────────────────────────────
  const deleteMessage = async (msgId: number) => {
    if (!me) return;
    await fetch(API("delete-message"), {
      method: "POST",
      headers: apiHeaders(me.id),
      body: JSON.stringify({ msg_id: msgId }),
    });
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, is_removed: true, content: "" } : m));
    setContextMenu(null);
  };

  // ── Admin ─────────────────────────────────────────────────
  const loadBans = async () => {
    if (!me) return;
    const res = await fetch(API("bans"), { headers: apiHeaders(me.id) });
    if (res.ok) setBannedUsers(await res.json());
  };

  const banUser = async (targetId: number) => {
    if (!me) return;
    await fetch(API("ban"), {
      method: "POST",
      headers: apiHeaders(me.id),
      body: JSON.stringify({ target_id: targetId }),
    });
    loadBans();
  };

  const unbanUser = async (targetId: number) => {
    if (!me) return;
    await fetch(API("unban"), {
      method: "POST",
      headers: apiHeaders(me.id),
      body: JSON.stringify({ target_id: targetId }),
    });
    loadBans();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ═══════════════════════════════════════════════════════════
  //  LOGIN SCREEN
  // ═══════════════════════════════════════════════════════════
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
                <label className="block text-xs font-medium text-gray-500 mb-1.5 tracking-wider uppercase">Логин</label>
                <input className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400 transition-colors bg-gray-50 focus:bg-white"
                  placeholder="ivan_petrov" value={loginForm.username}
                  onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value.toLowerCase() })}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 tracking-wider uppercase">Имя</label>
                <input className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400 transition-colors bg-gray-50 focus:bg-white"
                  placeholder="Иван Петров" value={loginForm.display_name}
                  onChange={(e) => setLoginForm({ ...loginForm, display_name: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()} />
              </div>
              {loginError && <p className="text-xs text-red-500">{loginError}</p>}
              <button onClick={handleLogin} disabled={loginLoading}
                className="w-full bg-gray-900 text-white rounded-xl py-3 text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50">
                {loginLoading ? "Входим..." : "Войти"}
              </button>
            </div>
            <p className="text-xs text-gray-300 text-center mt-5">Логин существует — войдёшь автоматически</p>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════
  //  MAIN APP
  // ═══════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-white flex overflow-hidden" style={{ height: "100vh" }}>
      {/* Hidden inputs */}
      <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx" className="hidden" onChange={handleFileUpload} />
      <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />

      {/* Context menu */}
      {contextMenu && (
        <div className="fixed z-50 bg-white border border-gray-100 rounded-xl shadow-lg py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}>
          <button onClick={() => deleteMessage(contextMenu.msgId)}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors">
            <Icon name="Trash2" size={14} /> Удалить
          </button>
        </div>
      )}

      {/* ── SIDEBAR ── */}
      <div className="w-72 xl:w-80 border-r border-gray-100 flex flex-col flex-shrink-0">
        {/* Profile */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
          <div className="relative cursor-pointer group" onClick={() => avatarInputRef.current?.click()}>
            <Avatar user={me} size={9} />
            <div className="absolute inset-0 rounded-full bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Icon name="Camera" size={12} className="text-white" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-sm font-semibold text-gray-900 truncate">{me.display_name}</span>
              {me.is_verified && <span className="text-blue-500 text-xs">✓</span>}
            </div>
            <div className="text-xs text-gray-400">@{me.username}</div>
          </div>
          <button onClick={() => setShowSearch(!showSearch)}
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${showSearch ? "bg-gray-900 text-white" : "hover:bg-gray-100 text-gray-400"}`}>
            <Icon name="Search" size={15} />
          </button>
          {me.is_admin && (
            <button onClick={() => { setShowAdmin(!showAdmin); loadBans(); }}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${showAdmin ? "bg-red-500 text-white" : "hover:bg-gray-100 text-gray-400"}`}>
              <Icon name="Shield" size={15} />
            </button>
          )}
          <button onClick={() => { localStorage.removeItem("messenger_user"); setMe(null); setActiveChat(null); setChats([]); }}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <Icon name="LogOut" size={15} />
          </button>
        </div>

        {/* Admin panel */}
        {showAdmin && me.is_admin && (
          <div className="px-4 py-3 border-b border-red-50 bg-red-50/50">
            <p className="text-xs font-semibold text-red-500 mb-2 uppercase tracking-wider">Панель администратора</p>
            {bannedUsers.length === 0 ? (
              <p className="text-xs text-gray-400">Заблокированных нет</p>
            ) : (
              <div className="space-y-1">
                {bannedUsers.map((u) => (
                  <div key={u.id} className="flex items-center justify-between py-1">
                    <span className="text-xs text-gray-700">{u.display_name} <span className="text-gray-400">@{u.username}</span></span>
                    <button onClick={() => unbanUser(u.id)} className="text-xs text-blue-500 hover:underline">Разбан</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Search */}
        {showSearch && (
          <div className="px-4 pt-3 pb-2 border-b border-gray-100">
            <div className="relative">
              <Icon name="Search" size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
              <input className="w-full bg-gray-50 rounded-lg pl-8 pr-3 py-2 text-sm outline-none"
                placeholder="Найти пользователя..." value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)} autoFocus />
            </div>
            {searchResults.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {searchResults.map((u) => (
                  <div key={u.id} className="flex items-center gap-2">
                    <button onClick={() => startChat(u)}
                      className="flex-1 flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left">
                      <Avatar user={u} size={8} />
                      <div>
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-medium text-gray-800">{u.display_name}</span>
                          {u.is_verified && <span className="text-blue-500 text-xs">✓</span>}
                        </div>
                        <div className="text-xs text-gray-400">@{u.username}</div>
                      </div>
                    </button>
                    {me.is_admin && (
                      <button onClick={() => banUser(u.id)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-400 transition-colors flex-shrink-0">
                        <Icon name="Ban" size={13} />
                      </button>
                    )}
                  </div>
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
              <button key={chat.chat_id} onClick={() => setActiveChat(chat)}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left border-b border-gray-50 ${activeChat?.chat_id === chat.chat_id ? "bg-gray-50 border-r-2 border-gray-900" : ""}`}>
                <Avatar user={{ id: chat.partner_id, display_name: chat.partner_display_name, avatar_url: chat.partner_avatar_url }} size={10} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-medium text-gray-900 truncate">{chat.partner_display_name}</span>
                      {chat.partner_verified && <span className="text-blue-500 text-xs">✓</span>}
                    </div>
                    <span className="text-xs text-gray-300 ml-2 flex-shrink-0">{timeAgo(chat.last_at)}</span>
                  </div>
                  <p className="text-xs text-gray-400 truncate">{chat.last_message || <span className="italic text-gray-300">Нет сообщений</span>}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── CHAT AREA ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeChat ? (
          <>
            {/* Chat header */}
            <div className="px-6 py-3.5 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
              <Avatar user={{ id: activeChat.partner_id, display_name: activeChat.partner_display_name, avatar_url: activeChat.partner_avatar_url }} size={9} />
              <div className="flex-1">
                <div className="flex items-center gap-1">
                  <span className="text-sm font-semibold text-gray-900">{activeChat.partner_display_name}</span>
                  {activeChat.partner_verified && <span className="text-blue-500 text-sm">✓</span>}
                </div>
                <div className="text-xs text-gray-400">@{activeChat.partner_username}</div>
              </div>
              {me.is_admin && (
                <button onClick={() => banUser(activeChat.partner_id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-red-500 hover:bg-red-50 transition-colors border border-red-100">
                  <Icon name="Ban" size={13} /> Заблокировать
                </button>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
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

                if (msg.is_removed) {
                  return (
                    <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"} ${gap}`}>
                      <span className="text-xs text-gray-300 italic px-2">Сообщение удалено</span>
                    </div>
                  );
                }

                return (
                  <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"} ${gap}`}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (isMe || me.is_admin) setContextMenu({ msgId: msg.id, x: e.clientX, y: e.clientY });
                    }}>
                    <div className="max-w-xs lg:max-w-md xl:max-w-lg group relative">
                      {/* Sticker */}
                      {msg.msg_type === "sticker" ? (
                        <div className="text-5xl p-1">{msg.content}</div>
                      ) : msg.msg_type === "image" && msg.file_url ? (
                        <div className={`overflow-hidden rounded-2xl ${isFirst && isMe ? "rounded-tr-sm" : ""} ${isFirst && !isMe ? "rounded-tl-sm" : ""}`}>
                          <img src={msg.file_url} alt="фото" className="max-w-xs rounded-xl object-cover cursor-pointer"
                            onClick={() => window.open(msg.file_url!, "_blank")} />
                          {isLast && <div className={`text-xs text-gray-300 mt-1 ${isMe ? "text-right" : "text-left"}`}>{formatTime(msg.created_at)}</div>}
                        </div>
                      ) : msg.msg_type === "voice" && msg.file_url ? (
                        <div className={`px-4 py-3 rounded-2xl ${isMe ? "bg-gray-900" : "bg-gray-100"} ${isFirst && isMe ? "rounded-tr-sm" : ""} ${isFirst && !isMe ? "rounded-tl-sm" : ""}`}>
                          <audio controls src={msg.file_url} className="h-8 max-w-[220px]" />
                          {isLast && <div className={`text-xs mt-1 ${isMe ? "text-gray-400 text-right" : "text-gray-400 text-left"}`}>{formatTime(msg.created_at)}</div>}
                        </div>
                      ) : (
                        <div>
                          <div className={`px-4 py-2.5 text-sm leading-relaxed ${isMe ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-800"}
                            ${isFirst ? "rounded-t-2xl" : "rounded-2xl"}
                            ${isLast && isMe ? "rounded-br-sm rounded-bl-2xl" : ""}
                            ${isLast && !isMe ? "rounded-bl-sm rounded-br-2xl" : ""}`}>
                            {msg.content}
                          </div>
                          {isLast && (
                            <div className={`text-xs text-gray-300 mt-1 ${isMe ? "text-right" : "text-left"}`}>
                              {formatTime(msg.created_at)}
                            </div>
                          )}
                        </div>
                      )}
                      {/* Quick delete button on hover */}
                      {(isMe || me.is_admin) && (
                        <button onClick={(e) => { e.stopPropagation(); setContextMenu({ msgId: msg.id, x: e.clientX, y: e.clientY }); }}
                          className={`absolute top-0 ${isMe ? "-left-8" : "-right-8"} opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 flex items-center justify-center text-gray-300 hover:text-red-400`}>
                          <Icon name="MoreVertical" size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="px-4 py-3 border-t border-gray-100 flex-shrink-0">
              {/* Emoji picker */}
              {showEmoji && (
                <div className="mb-2 p-3 bg-white border border-gray-100 rounded-2xl shadow-sm">
                  <div className="flex flex-wrap gap-1.5">
                    {EMOJIS.map((e) => (
                      <button key={e} onClick={() => sendEmoji(e)}
                        className="text-xl hover:scale-125 transition-transform active:scale-110">{e}</button>
                    ))}
                  </div>
                </div>
              )}
              {/* Sticker picker */}
              {showStickers && (
                <div className="mb-2 p-3 bg-white border border-gray-100 rounded-2xl shadow-sm">
                  <p className="text-xs text-gray-400 mb-2">Стикеры</p>
                  <div className="flex flex-wrap gap-2">
                    {STICKERS.map((s) => (
                      <button key={s} onClick={() => sendSticker(s)}
                        className="text-3xl hover:scale-125 transition-transform active:scale-110">{s}</button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-end gap-2">
                {/* Left buttons */}
                <div className="flex items-center gap-1 pb-2">
                  <button onClick={() => { setShowEmoji(!showEmoji); setShowStickers(false); }}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors text-lg ${showEmoji ? "bg-amber-100" : "hover:bg-gray-100 text-gray-400"}`}>
                    😊
                  </button>
                  <button onClick={() => { setShowStickers(!showStickers); setShowEmoji(false); }}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors text-lg ${showStickers ? "bg-violet-100" : "hover:bg-gray-100 text-gray-400"}`}>
                    🎭
                  </button>
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploadingFile}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 transition-colors disabled:opacity-40">
                    <Icon name="Image" size={16} />
                  </button>
                </div>

                {/* Textarea */}
                <textarea ref={textareaRef}
                  className="flex-1 border border-gray-200 rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-gray-300 transition-colors resize-none bg-gray-50 focus:bg-white leading-relaxed"
                  placeholder="Сообщение... (Enter — отправить)"
                  value={input} rows={1}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                  }}
                  onKeyDown={handleKeyDown} />

                {/* Right buttons */}
                <div className="flex items-center gap-1 pb-2">
                  <button onMouseDown={startRecording} onMouseUp={stopRecording} onTouchStart={startRecording} onTouchEnd={stopRecording}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${recording ? "bg-red-500 text-white animate-pulse" : "hover:bg-gray-100 text-gray-400"}`}>
                    <Icon name="Mic" size={16} />
                  </button>
                  <button onClick={sendMessage} disabled={!input.trim() || sending}
                    className="w-9 h-9 bg-gray-900 text-white rounded-xl flex items-center justify-center hover:bg-gray-700 active:scale-95 transition-all disabled:opacity-30">
                    {uploadingFile ? <Icon name="Loader" size={15} className="animate-spin" /> : <Icon name="Send" size={15} />}
                  </button>
                </div>
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
