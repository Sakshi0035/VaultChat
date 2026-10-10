import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search,
  MessageSquarePlus,
  Bell,
  Settings,
  Send,
  Reply,
  Edit3,
  Trash2,
  Copy,
  Check,
  Flag,
  ShieldBan,
  ShieldCheck,
  Info,
  ArrowLeft,
  X,
  CheckCheck,
  MessageSquare,
  AlertCircle,
  UserCheck,
  UserX,
  Paperclip,
  FileText,
} from 'lucide-react';
import { api, getTabSessionToken } from '../lib/api.ts';
import {
  CurrentUser,
  ConversationSummary,
  ChatMessage,
  NotificationItem,
  ThemeMode,
} from '../types.ts';
import { SettingsModal } from './SettingsModal.tsx';
import {
  UserSearchModal,
  NotificationsModal,
  ReportModal,
} from './ChatOverlays.tsx';

interface ChatWorkspaceProps {
  currentUser: CurrentUser;
  onUserUpdated: (user: CurrentUser) => void;
  onLoggedOut: (message?: string) => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  isDark: boolean;
}

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  currentUser,
  onUserUpdated,
  onLoggedOut,
  theme,
  onThemeChange,
  isDark,
}) => {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [sidebarFilter, setSidebarFilter] = useState<'all' | 'unread' | 'requests'>('all');
  const [sidebarSearch, setSidebarSearch] = useState('');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [showMessageSearch, setShowMessageSearch] = useState(false);

  const [composerText, setComposerText] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<{
    fileName: string;
    mimeType: string;
    dataBase64: string;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const [typingPeers, setTypingPeers] = useState<Record<string, string>>({});
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const [showUserSearchModal, setShowUserSearchModal] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<
    'account' | 'privacy' | 'appearance' | 'sessions'
  >('account');
  const [showPeerDetails, setShowPeerDetails] = useState(true);
  const [reportTarget, setReportTarget] = useState<{
    username: string;
    messageId?: string | null;
    messagePreview?: string | null;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedConvIdRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  selectedConvIdRef.current = selectedConvId;

  const activeConversation =
    conversations.find((c) => c.id === selectedConvId) || null;

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
    }, 30);
  }, []);

  const fetchConversations = useCallback(async () => {
    try {
      const list = await api.getConversations();
      setConversations(list);
      setConversationsError(null);
    } catch (err: any) {
      if (err?.status === 401) {
        onLoggedOut('Your session has expired. Please sign in again.');
        return;
      }
      setConversationsError(err.message || 'Could not load conversations.');
    } finally {
      setConversationsLoading(false);
    }
  }, [onLoggedOut]);

  const fetchNotifications = useCallback(async () => {
    try {
      const list = await api.getNotifications();
      setNotifications(list);
    } catch {
      // Non-fatal
    }
  }, []);

  useEffect(() => {
    void fetchConversations();
    void fetchNotifications();
  }, [fetchConversations, fetchNotifications]);

  useEffect(() => {
    if (!selectedConvId) {
      setMessages([]);
      setHasMoreMessages(false);
      return;
    }

    let cancelled = false;
    setMessagesLoading(true);
    setMessagesError(null);

    const load = async () => {
      try {
        const res = await api.getMessages(selectedConvId, {
          limit: 50,
          search: messageSearchQuery.trim() || undefined,
        });
        if (cancelled) return;
        setMessages(res.messages);
        setHasMoreMessages(res.hasMore);
        setConversations((prev) =>
          prev.map((c) => (c.id === selectedConvId ? { ...c, unreadCount: 0 } : c))
        );
        scrollToBottom('auto');
      } catch (err: any) {
        if (!cancelled) {
          setMessagesError(err.message || 'Could not load messages.');
        }
      } finally {
        if (!cancelled) {
          setMessagesLoading(false);
        }
      }
    };

    const debounce = setTimeout(load, messageSearchQuery ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
    };
  }, [selectedConvId, messageSearchQuery, scrollToBottom]);

  useEffect(() => {
    let isUnmounted = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectWebSocket = () => {
      if (isUnmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = getTabSessionToken();
      const wsUrl = `${protocol}//${window.location.host}/ws${
        token ? `?token=${encodeURIComponent(token)}` : ''
      }`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const { event: evtType, payload } = data;

          if (evtType === 'session:revoked') {
            onLoggedOut(payload?.reason || 'Your session was signed out.');
            return;
          }

          if (evtType === 'message:new') {
            const incoming: ChatMessage = payload;
            const isCurrentConv = selectedConvIdRef.current === incoming.conversationId;

            if (isCurrentConv) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === incoming.id)) return prev;
                return [...prev, incoming];
              });
              scrollToBottom('smooth');

              if (!incoming.isMine) {
                void api.markConversationRead(incoming.conversationId).catch(() => {});
              }
            }

            setTypingPeers((prev) => {
              const next = { ...prev };
              delete next[incoming.conversationId];
              return next;
            });

            void fetchConversations();
          } else if (evtType === 'message:updated') {
            const updated = payload;
            if (selectedConvIdRef.current === updated.conversationId) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === updated.id
                    ? {
                        ...m,
                        body: updated.body,
                        isDeleted: updated.isDeleted,
                        editedAt: updated.editedAt,
                        attachment: updated.isDeleted ? null : m.attachment,
                      }
                    : m
                )
              );
            }
            void fetchConversations();
          } else if (evtType === 'message:read') {
            const { conversationId } = payload;
            if (selectedConvIdRef.current === conversationId) {
              setMessages((prev) =>
                prev.map((m) => (m.isMine ? { ...m, isReadByPeer: true } : m))
              );
            }
            setConversations((prev) =>
              prev.map((c) =>
                c.id === conversationId && c.lastMessage
                  ? {
                      ...c,
                      lastMessage: { ...c.lastMessage, isReadByPeer: true },
                    }
                  : c
              )
            );
          } else if (evtType === 'conversation:updated') {
            void fetchConversations();
          } else if (evtType === 'typing:update') {
            const { conversationId, username, isTyping } = payload;
            setTypingPeers((prev) => {
              const next = { ...prev };
              if (isTyping) {
                next[conversationId] = username;
              } else {
                delete next[conversationId];
              }
              return next;
            });
          } else if (evtType === 'presence:update') {
            const { username, isOnline, lastActiveAt } = payload;
            setConversations((prev) =>
              prev.map((c) =>
                c.peer.username.toLowerCase() === String(username).toLowerCase()
                  ? {
                      ...c,
                      peer: { ...c.peer, isOnline, lastActiveAt },
                    }
                  : c
              )
            );
          } else if (evtType === 'notification:new') {
            const notif: NotificationItem = payload;
            setNotifications((prev) => {
              if (prev.some((n) => n.id === notif.id)) return prev;
              return [notif, ...prev];
            });
          }
        } catch {
          // Ignore malformed message
        }
      };

      ws.onclose = (ev) => {
        if (isUnmounted) return;
        if (ev.code === 4001) {
          return;
        }
        reconnectTimer = setTimeout(connectWebSocket, 3000);
      };
    };

    connectWebSocket();

    const pollInterval = setInterval(() => {
      void fetchConversations();
    }, 15000);

    return () => {
      isUnmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(pollInterval);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [fetchConversations, onLoggedOut, scrollToBottom]);

  const emitTyping = (isTyping: boolean) => {
    if (!selectedConvId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }
    wsRef.current.send(
      JSON.stringify({
        event: isTyping ? 'typing:start' : 'typing:stop',
        payload: { conversationId: selectedConvId },
      })
    );
  };

  const handleComposerChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setComposerText(e.target.value);
    emitTyping(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      emitTyping(false);
    }, 2000);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setSendError('File size cannot exceed 5 MB.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      setPendingAttachment({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataBase64: base64,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleLoadOlderMessages = async () => {
    if (!selectedConvId || messages.length === 0 || loadingOlder) return;
    const oldest = messages[0];
    setLoadingOlder(true);
    try {
      const res = await api.getMessages(selectedConvId, {
        before: oldest.createdAt,
        limit: 50,
      });
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const uniqueOlder = res.messages.filter((m) => !existingIds.has(m.id));
        return [...uniqueOlder, ...prev];
      });
      setHasMoreMessages(res.hasMore);
    } catch {
      // Ignore
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleSendOrEditMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedConvId || sending) return;

    const trimmed = composerText.trim();
    if (!trimmed && !pendingAttachment) return;

    setSendError(null);
    setSending(true);
    emitTyping(false);

    try {
      if (editingMessage) {
        const res = await api.editMessage(editingMessage.id, trimmed);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === editingMessage.id
              ? { ...m, body: res.message.body, editedAt: res.message.editedAt }
              : m
          )
        );
        setEditingMessage(null);
        setComposerText('');
        void fetchConversations();
      } else {
        const res = await api.sendMessage(
          selectedConvId,
          trimmed,
          replyingTo?.id,
          pendingAttachment
        );
        setMessages((prev) => {
          if (prev.some((m) => m.id === res.message.id)) return prev;
          return [...prev, res.message];
        });
        setComposerText('');
        setPendingAttachment(null);
        setReplyingTo(null);
        scrollToBottom('smooth');
        void fetchConversations();
      }
    } catch (err: any) {
      setSendError(err.message || 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendOrEditMessage();
    } else if (e.key === 'Escape') {
      setReplyingTo(null);
      setEditingMessage(null);
      setPendingAttachment(null);
    }
  };

  const handleDeleteOwnMessage = async (messageId: string) => {
    try {
      await api.deleteMessage(messageId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, body: '', isDeleted: true, attachment: null } : m
        )
      );
      void fetchConversations();
    } catch (err: any) {
      setSendError(err.message || 'Failed to delete message.');
    }
  };

  const handleCopyMessage = async (msg: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.body);
      setCopiedMessageId(msg.id);
      setTimeout(() => setCopiedMessageId(null), 1500);
    } catch {
      // Ignore clipboard error
    }
  };

  const handleAcceptRequest = async () => {
    if (!activeConversation) return;
    try {
      await api.acceptConversation(activeConversation.id);
      await fetchConversations();
    } catch (err: any) {
      setSendError(err.message || 'Failed to accept request.');
    }
  };

  const handleDeclineRequest = async () => {
    if (!activeConversation) return;
    try {
      await api.declineConversation(activeConversation.id);
      setSelectedConvId(null);
      await fetchConversations();
    } catch (err: any) {
      setSendError(err.message || 'Failed to decline request.');
    }
  };

  const handleToggleBlockPeer = async () => {
    if (!activeConversation) return;
    const peerUsername = activeConversation.peer.username;
    try {
      if (activeConversation.peer.isBlockedByMe) {
        await api.unblockUser(peerUsername);
      } else {
        await api.blockUser(peerUsername);
      }
      await fetchConversations();
    } catch (err: any) {
      setSendError(err.message || 'Could not update block status.');
    }
  };

  const handleMarkNotificationRead = async (id: string) => {
    try {
      await api.markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
    } catch {
      // Ignore
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch {
      // Ignore
    }
  };

  const pendingRequestsCount = conversations.filter(
    (c) => c.status === 'pending' && !c.isInitiatedByMe
  ).length;
  const unreadNotificationsCount = notifications.filter((n) => !n.isRead).length;

  const filteredConversations = conversations.filter((c) => {
    if (sidebarFilter === 'unread' && c.unreadCount === 0) return false;
    if (sidebarFilter === 'requests' && !(c.status === 'pending' && !c.isInitiatedByMe)) {
      return false;
    }
    if (sidebarSearch.trim()) {
      const q = sidebarSearch.trim().replace(/^@/, '').toLowerCase();
      const matchUser = c.peer.username.toLowerCase().includes(q);
      const matchMsg = c.lastMessage?.body.toLowerCase().includes(q) || false;
      return matchUser || matchMsg;
    }
    return true;
  });

  return (
    <div
      className={`h-screen w-full flex flex-col overflow-hidden transition-colors ${
        isDark ? 'bg-[#14040A] text-white' : 'bg-white text-rose-950'
      }`}
    >
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* ====================================================================
            LEFT SIDEBAR: CONVERSATIONS & NAVIGATION
            ==================================================================== */}
        <aside
          className={`${
            selectedConvId ? 'hidden md:flex' : 'flex'
          } w-full md:w-80 lg:w-96 flex-col border-r shrink-0 ${
            isDark
              ? 'bg-[#1B060E] border-rose-900/60'
              : 'bg-rose-50/40 border-rose-200'
          }`}
        >
          {/* Sidebar Header */}
          <div
            className={`px-4 py-3.5 border-b flex items-center justify-between gap-2 ${
              isDark ? 'border-rose-900/60' : 'border-rose-200'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setSettingsInitialTab('account');
                setShowSettingsModal(true);
              }}
              className="flex items-center gap-2.5 min-w-0 text-left group cursor-pointer"
              title="Open Profile & Account Settings"
            >
              <div className="relative shrink-0">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold select-none"
                  style={{ backgroundColor: currentUser.avatarColor }}
                >
                  {currentUser.username.slice(0, 2).toUpperCase()}
                </div>
                <span className="w-2.5 h-2.5 rounded-full bg-rose-400 ring-2 ring-[#1B060E] absolute bottom-0 right-0" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold truncate group-hover:text-rose-400 transition-colors">
                  @{currentUser.username}
                </div>
                <div className={`text-[11px] truncate ${isDark ? 'text-rose-300/70' : 'text-rose-700/70'}`}>
                  VaultChat
                </div>
              </div>
            </button>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setShowUserSearchModal(true)}
                className={`p-2 rounded-lg transition-colors ${
                  isDark
                    ? 'hover:bg-rose-950 text-rose-200'
                    : 'hover:bg-rose-100 text-rose-800'
                }`}
                title="Search users & start conversation"
                aria-label="Search users"
              >
                <MessageSquarePlus className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setShowNotificationsModal(true)}
                className={`relative p-2 rounded-lg transition-colors ${
                  isDark
                    ? 'hover:bg-rose-950 text-rose-200'
                    : 'hover:bg-rose-100 text-rose-800'
                }`}
                title="Notifications"
                aria-label="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadNotificationsCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500" />
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setSettingsInitialTab('account');
                  setShowSettingsModal(true);
                }}
                className={`p-2 rounded-lg transition-colors ${
                  isDark
                    ? 'hover:bg-rose-950 text-rose-200'
                    : 'hover:bg-rose-100 text-rose-800'
                }`}
                title="Settings"
                aria-label="Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Search & New Conversation Trigger */}
          <div className="p-3 space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-rose-400" />
                <input
                  type="text"
                  value={sidebarSearch}
                  onChange={(e) => setSidebarSearch(e.target.value)}
                  placeholder="Filter chats or @username..."
                  className={`w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-2 focus:ring-rose-500/50 ${
                    isDark
                      ? 'bg-[#14040A] border-rose-800/80 text-white placeholder-rose-400/50'
                      : 'bg-white border-rose-300 text-rose-950 placeholder-rose-400'
                  }`}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowUserSearchModal(true)}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Find User
              </button>
            </div>

            {/* Interactive Segmented Filter Controls */}
            <div
              className={`flex items-center gap-1 p-1 rounded-lg ${
                isDark ? 'bg-[#14040A]' : 'bg-rose-100/80'
              }`}
            >
              <button
                type="button"
                onClick={() => setSidebarFilter('all')}
                className={`flex-1 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  sidebarFilter === 'all'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : isDark
                    ? 'text-rose-200/70 hover:text-white'
                    : 'text-rose-800 hover:text-rose-950'
                }`}
              >
                All Chats
              </button>
              <button
                type="button"
                onClick={() => setSidebarFilter('unread')}
                className={`flex-1 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  sidebarFilter === 'unread'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : isDark
                    ? 'text-rose-200/70 hover:text-white'
                    : 'text-rose-800 hover:text-rose-950'
                }`}
              >
                Unread
              </button>
              <button
                type="button"
                onClick={() => setSidebarFilter('requests')}
                className={`flex-1 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  sidebarFilter === 'requests'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : isDark
                    ? 'text-rose-200/70 hover:text-white'
                    : 'text-rose-800 hover:text-rose-950'
                }`}
              >
                Requests {pendingRequestsCount > 0 ? `(${pendingRequestsCount})` : ''}
              </button>
            </div>
          </div>

          {/* Conversation List */}
          <div className="flex-1 overflow-y-auto divide-y divide-rose-900/30">
            {conversationsLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 animate-pulse">
                    <div className="w-10 h-10 rounded-full bg-rose-900/50 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 bg-rose-900/50 rounded w-1/3" />
                      <div className="h-2.5 bg-rose-900/30 rounded w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : conversationsError ? (
              <div className="p-6 text-center space-y-2">
                <p className="text-xs text-red-400">{conversationsError}</p>
                <button
                  type="button"
                  onClick={() => void fetchConversations()}
                  className="text-xs font-semibold text-rose-400 hover:underline"
                >
                  Retry
                </button>
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <MessageSquare className="w-7 h-7 text-rose-500/60 mx-auto" />
                <p className={`text-xs ${isDark ? 'text-rose-200/70' : 'text-rose-800/75'}`}>
                  Your conversations will appear here.
                </p>
                <button
                  type="button"
                  onClick={() => setShowUserSearchModal(true)}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap"
                >
                  Search Username to Chat
                </button>
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const isSelected = conv.id === selectedConvId;
                const isTyping = Boolean(typingPeers[conv.id]);
                const lastTime = conv.lastMessage?.createdAt || conv.updatedAt;

                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => {
                      setSelectedConvId(conv.id);
                      setReplyingTo(null);
                      setEditingMessage(null);
                      setPendingAttachment(null);
                      setMessageSearchQuery('');
                      setShowMessageSearch(false);
                    }}
                    className={`w-full px-4 py-3.5 flex items-start gap-3 text-left transition-colors cursor-pointer ${
                      isSelected
                        ? isDark
                          ? 'bg-rose-950/80 border-l-2 border-l-rose-500'
                          : 'bg-rose-100/90 border-l-2 border-l-rose-600'
                        : isDark
                        ? 'hover:bg-rose-950/40'
                        : 'hover:bg-rose-50'
                    }`}
                  >
                    <div className="relative shrink-0 mt-0.5">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold select-none"
                        style={{ backgroundColor: conv.peer.avatarColor }}
                      >
                        {conv.peer.username.slice(0, 2).toUpperCase()}
                      </div>
                      {conv.peer.isOnline && (
                        <span
                          className="w-2.5 h-2.5 rounded-full bg-rose-400 ring-2 ring-[#1B060E] absolute bottom-0 right-0"
                          title="Online"
                        />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold truncate">
                          @{conv.peer.username}
                        </span>
                        <span
                          className={`text-[11px] tabular-nums shrink-0 ${
                            isDark ? 'text-rose-300/60' : 'text-rose-700/70'
                          }`}
                        >
                          {new Date(lastTime).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-1">
                        <p
                          className={`text-xs truncate ${
                            isTyping
                              ? 'text-rose-400 font-medium'
                              : conv.unreadCount > 0
                              ? isDark
                                ? 'text-white font-semibold'
                                : 'text-rose-950 font-semibold'
                              : isDark
                              ? 'text-rose-200/65'
                              : 'text-rose-800/70'
                          }`}
                        >
                          {isTyping ? (
                            'Typing...'
                          ) : conv.status === 'pending' && !conv.isInitiatedByMe ? (
                            `Message request · ${
                              conv.lastMessage?.body || 'Tap to review'
                            }`
                          ) : conv.lastMessage ? (
                            conv.lastMessage.isDeleted ? (
                              <span className="italic">Message deleted</span>
                            ) : (
                              <>
                                {conv.lastMessage.isMine ? 'You: ' : ''}
                                {conv.lastMessage.body}
                              </>
                            )
                          ) : (
                            'No messages yet'
                          )}
                        </p>

                        {conv.unreadCount > 0 ? (
                          <span className="px-1.5 py-0.5 text-[11px] font-bold bg-rose-600 text-white rounded-md tabular-nums shrink-0">
                            {conv.unreadCount}
                          </span>
                        ) : conv.lastMessage?.isMine ? (
                          <CheckCheck
                            className={`w-3.5 h-3.5 shrink-0 ${
                              conv.lastMessage.isReadByPeer
                                ? 'text-rose-400'
                                : 'text-rose-400/40'
                            }`}
                          />
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ====================================================================
            CENTER PANEL: MAIN CHAT VIEWPORT
            ==================================================================== */}
        <main
          className={`${
            selectedConvId ? 'flex' : 'hidden md:flex'
          } flex-1 flex-col min-w-0 h-full`}
        >
          {!activeConversation ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div
                className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-4 border ${
                  isDark
                    ? 'bg-[#220712] border-rose-900/70 text-rose-400'
                    : 'bg-rose-50 border-rose-200 text-rose-600'
                }`}
              >
                <MessageSquare className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold tracking-tight">
                Select a conversation or start a new chat
              </h2>
              <p
                className={`text-xs max-w-sm mt-1.5 leading-relaxed ${
                  isDark ? 'text-rose-200/75' : 'text-rose-800/80'
                }`}
              >
                Search for any user by their @username to send a real-time message or share
                files in the chats storage bucket.
              </p>
              <button
                type="button"
                onClick={() => setShowUserSearchModal(true)}
                className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap"
              >
                <MessageSquarePlus className="w-4 h-4" />
                <span>Search Username</span>
              </button>
            </div>
          ) : (
            <>
              {/* Active Conversation Header */}
              <header
                className={`px-4 py-3 border-b flex items-center justify-between gap-3 shrink-0 ${
                  isDark ? 'bg-[#1B060E] border-rose-900/60' : 'bg-white border-rose-200'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => setSelectedConvId(null)}
                    className="md:hidden p-1.5 rounded-lg hover:bg-rose-900/50"
                    aria-label="Back to conversations"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>

                  <div className="relative shrink-0">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold select-none"
                      style={{ backgroundColor: activeConversation.peer.avatarColor }}
                    >
                      {activeConversation.peer.username.slice(0, 2).toUpperCase()}
                    </div>
                    {activeConversation.peer.isOnline && (
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-400 ring-2 ring-[#1B060E] absolute bottom-0 right-0" />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">
                      @{activeConversation.peer.username}
                    </div>
                    <div className="text-[11px] flex items-center gap-1.5 truncate">
                      {typingPeers[activeConversation.id] ? (
                        <span className="text-rose-400 font-medium">typing...</span>
                      ) : activeConversation.peer.isBlockedByMe ? (
                        <span className="text-red-400">Blocked by you</span>
                      ) : activeConversation.peer.isOnline ? (
                        <span className="text-rose-400">Online</span>
                      ) : activeConversation.peer.lastActiveAt ? (
                        <span className={`tabular-nums ${isDark ? 'text-rose-300/70' : 'text-rose-700/70'}`}>
                          Last active{' '}
                          {new Date(activeConversation.peer.lastActiveAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      ) : (
                        <span className={isDark ? 'text-rose-300/70' : 'text-rose-700/70'}>
                          Offline
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setShowMessageSearch(!showMessageSearch);
                      if (showMessageSearch) setMessageSearchQuery('');
                    }}
                    className={`p-2 rounded-lg transition-colors ${
                      showMessageSearch
                        ? 'bg-rose-600 text-white'
                        : isDark
                        ? 'hover:bg-rose-950 text-rose-300'
                        : 'hover:bg-rose-100 text-rose-700'
                    }`}
                    title="Search in conversation"
                    aria-label="Search in conversation"
                  >
                    <Search className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleBlockPeer}
                    className={`p-2 rounded-lg transition-colors ${
                      activeConversation.peer.isBlockedByMe
                        ? 'bg-red-500/20 text-red-400'
                        : isDark
                        ? 'hover:bg-rose-950 text-rose-300'
                        : 'hover:bg-rose-100 text-rose-700'
                    }`}
                    title={
                      activeConversation.peer.isBlockedByMe
                        ? `Unblock @${activeConversation.peer.username}`
                        : `Block @${activeConversation.peer.username}`
                    }
                    aria-label="Block or unblock user"
                  >
                    <ShieldBan className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setReportTarget({
                        username: activeConversation.peer.username,
                      })
                    }
                    className={`p-2 rounded-lg transition-colors ${
                      isDark
                        ? 'hover:bg-rose-950 text-rose-300'
                        : 'hover:bg-rose-100 text-rose-700'
                    }`}
                    title={`Report @${activeConversation.peer.username}`}
                    aria-label="Report user"
                  >
                    <Flag className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowPeerDetails(!showPeerDetails)}
                    className={`hidden lg:flex p-2 rounded-lg transition-colors ${
                      showPeerDetails
                        ? 'bg-rose-600 text-white'
                        : isDark
                        ? 'hover:bg-rose-950 text-rose-300'
                        : 'hover:bg-rose-100 text-rose-700'
                    }`}
                    title="Toggle profile sidebar"
                    aria-label="Toggle profile details"
                  >
                    <Info className="w-4 h-4" />
                  </button>
                </div>
              </header>

              {/* In-Conversation Search Bar */}
              {showMessageSearch && (
                <div
                  className={`px-4 py-2.5 border-b flex items-center gap-2 ${
                    isDark ? 'bg-[#220712] border-rose-900/60' : 'bg-rose-50 border-rose-200'
                  }`}
                >
                  <Search className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <input
                    type="text"
                    autoFocus
                    value={messageSearchQuery}
                    onChange={(e) => setMessageSearchQuery(e.target.value)}
                    placeholder="Search messages in this conversation..."
                    className="flex-1 bg-transparent text-xs focus:outline-none"
                  />
                  {messageSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setMessageSearchQuery('')}
                      className="text-xs text-rose-400 hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}

              {/* Message Request Banner (Requirement 34) */}
              {activeConversation.status === 'pending' && !activeConversation.isInitiatedByMe && (
                <div
                  className={`px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3 ${
                    isDark
                      ? 'bg-rose-950/60 border-rose-800/70'
                      : 'bg-rose-50 border-rose-200'
                  }`}
                >
                  <div className="text-xs">
                    <span className="font-semibold">
                      @{activeConversation.peer.username}
                    </span>{' '}
                    sent you a message request. Accept to chat normally, or decline/block.
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleAcceptRequest}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Accept</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDeclineRequest}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                        isDark
                          ? 'border-rose-800 hover:bg-rose-950 text-white'
                          : 'border-rose-300 hover:bg-white text-rose-900'
                      }`}
                    >
                      <UserX className="w-3.5 h-3.5" />
                      <span>Decline</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleToggleBlockPeer}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-300 border border-red-500/40 hover:bg-red-500/10 rounded-lg transition-colors whitespace-nowrap"
                    >
                      <ShieldBan className="w-3.5 h-3.5" />
                      <span>Block</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Message History Stream */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                {hasMoreMessages && (
                  <div className="text-center pb-2">
                    <button
                      type="button"
                      disabled={loadingOlder}
                      onClick={handleLoadOlderMessages}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                        isDark
                          ? 'border-rose-900 bg-[#220712] hover:bg-rose-950 text-rose-200'
                          : 'border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-900'
                      }`}
                    >
                      {loadingOlder ? 'Loading older messages...' : 'Load older messages'}
                    </button>
                  </div>
                )}

                {messagesLoading ? (
                  <div className="py-12 text-center text-xs text-rose-300/70">
                    Loading messages...
                  </div>
                ) : messagesError ? (
                  <div className="py-12 text-center space-y-2">
                    <AlertCircle className="w-6 h-6 text-red-400 mx-auto" />
                    <p className="text-xs text-red-400">{messagesError}</p>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="py-16 text-center space-y-2">
                    <p className="text-sm font-semibold">Start the conversation.</p>
                    <p className={`text-xs ${isDark ? 'text-rose-200/70' : 'text-rose-800/70'}`}>
                      Send a message below to chat privately with @{activeConversation.peer.username}.
                    </p>
                  </div>
                ) : (
                  messages.map((msg, idx) => {
                    const prev = idx > 0 ? messages[idx - 1] : null;
                    const isSameSenderAsPrev =
                      prev &&
                      prev.senderUsername === msg.senderUsername &&
                      new Date(msg.createdAt).getTime() -
                        new Date(prev.createdAt).getTime() <
                        5 * 60 * 1000;

                    return (
                      <div
                        key={msg.id}
                        className={`group flex flex-col ${
                          msg.isMine ? 'items-end' : 'items-start'
                        } ${isSameSenderAsPrev ? 'mt-1' : 'mt-4'}`}
                      >
                        {!isSameSenderAsPrev && (
                          <div
                            className={`flex items-center gap-1.5 mb-1 px-1 text-[11px] ${
                              isDark ? 'text-rose-300/70' : 'text-rose-800/70'
                            }`}
                          >
                            <span className="font-semibold">@{msg.senderUsername}</span>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums">
                              {new Date(msg.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                        )}

                        <div
                          className={`flex items-center gap-2 max-w-[85%] sm:max-w-[72%] ${
                            msg.isMine ? 'flex-row-reverse' : 'flex-row'
                          }`}
                        >
                          {/* Message Bubble: Rich Pinked Red for sent, Crisp White / Deep Ruby for received */}
                          <div
                            className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-words ${
                              msg.isDeleted
                                ? isDark
                                  ? 'bg-[#220712]/60 border border-rose-900/60 text-rose-300/50 italic'
                                  : 'bg-rose-50 border border-rose-200 text-rose-400 italic'
                                : msg.isMine
                                ? 'bg-rose-600 text-white font-medium shadow-xs'
                                : isDark
                                ? 'bg-white text-rose-950 font-medium shadow-xs'
                                : 'bg-rose-50 border border-rose-200 text-rose-950'
                            }`}
                          >
                            {msg.replyTo && !msg.isDeleted && (
                              <div
                                className={`mb-2 pl-2.5 py-1 border-l-2 text-xs rounded ${
                                  msg.isMine
                                    ? 'border-white/70 bg-rose-700/60 text-white'
                                    : 'border-rose-600 bg-rose-100 text-rose-950'
                                }`}
                              >
                                <div className="font-semibold text-[11px]">
                                  @{msg.replyTo.senderUsername}
                                </div>
                                <div className="truncate opacity-90">{msg.replyTo.body}</div>
                              </div>
                            )}

                            {/* Attachment from 'chats' bucket */}
                            {!msg.isDeleted && msg.attachment && (
                              <div className="mb-2">
                                {msg.attachment.mimeType.startsWith('image/') ? (
                                  <a
                                    href={api.getAttachmentUrl(msg.attachment.id)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block overflow-hidden rounded-lg border border-white/20"
                                  >
                                    <img
                                      src={api.getAttachmentUrl(msg.attachment.id)}
                                      alt={msg.attachment.fileName}
                                      referrerPolicy="no-referrer"
                                      className="max-h-60 w-auto object-cover rounded-lg"
                                    />
                                  </a>
                                ) : (
                                  <a
                                    href={api.getAttachmentUrl(msg.attachment.id)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs font-semibold ${
                                      msg.isMine
                                        ? 'border-white/30 bg-rose-700/50 text-white hover:bg-rose-700'
                                        : 'border-rose-300 bg-rose-100/70 text-rose-950 hover:bg-rose-200/70'
                                    }`}
                                  >
                                    <FileText className="w-4 h-4 shrink-0" />
                                    <span className="truncate">{msg.attachment.fileName}</span>
                                  </a>
                                )}
                              </div>
                            )}

                            {msg.isDeleted ? (
                              <span>Message deleted</span>
                            ) : (
                              <div className="whitespace-pre-wrap">{msg.body}</div>
                            )}

                            <div
                              className={`flex items-center justify-end gap-1.5 mt-1 text-[10px] tabular-nums ${
                                msg.isMine
                                  ? 'text-rose-100/85'
                                  : 'text-rose-800/70'
                              }`}
                            >
                              {msg.editedAt && !msg.isDeleted && <span>edited ·</span>}
                              <span>
                                {new Date(msg.createdAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              {msg.isMine && !msg.isDeleted && (
                                <span>· {msg.isReadByPeer ? 'Read' : 'Sent'}</span>
                              )}
                            </div>
                          </div>

                          {/* Hover Action Controls */}
                          {!msg.isDeleted && (
                            <div
                              className={`opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-0.5 p-1 rounded-lg border ${
                                isDark
                                  ? 'bg-[#220712] border-rose-800 text-rose-200'
                                  : 'bg-white border-rose-200 text-rose-700 shadow-xs'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMessage(null);
                                  setReplyingTo(msg);
                                }}
                                className="p-1 hover:text-rose-400 rounded"
                                title="Reply"
                                aria-label="Reply to message"
                              >
                                <Reply className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => void handleCopyMessage(msg)}
                                className="p-1 hover:text-rose-400 rounded"
                                title="Copy message"
                                aria-label="Copy message"
                              >
                                {copiedMessageId === msg.id ? (
                                  <Check className="w-3.5 h-3.5 text-rose-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>

                              {msg.isMine ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setReplyingTo(null);
                                      setEditingMessage(msg);
                                      setComposerText(msg.body);
                                    }}
                                    className="p-1 hover:text-rose-400 rounded"
                                    title="Edit message"
                                    aria-label="Edit message"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteOwnMessage(msg.id)}
                                    className="p-1 hover:text-red-400 rounded"
                                    title="Delete message"
                                    aria-label="Delete message"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setReportTarget({
                                      username: msg.senderUsername,
                                      messageId: msg.id,
                                      messagePreview: msg.body,
                                    })
                                  }
                                  className="p-1 hover:text-rose-400 rounded"
                                  title="Report message"
                                  aria-label="Report message"
                                >
                                  <Flag className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Typing Indicator Bar */}
              {typingPeers[activeConversation.id] && (
                <div className="px-6 py-1 text-xs text-rose-400 font-medium">
                  @{typingPeers[activeConversation.id]} is typing...
                </div>
              )}

              {/* Composer Area */}
              <div
                className={`p-3 sm:p-4 border-t shrink-0 ${
                  isDark ? 'bg-[#1B060E] border-rose-900/60' : 'bg-rose-50/50 border-rose-200'
                }`}
              >
                {sendError && (
                  <div className="mb-2.5 px-3 py-2 rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 text-xs flex items-center justify-between">
                    <span>{sendError}</span>
                    <button
                      type="button"
                      onClick={() => setSendError(null)}
                      className="text-xs underline ml-2"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {/* Blocked State Notice (Requirement 14) */}
                {activeConversation.peer.isBlockedByMe ? (
                  <div
                    className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                      isDark
                        ? 'bg-red-950/30 border-red-800/50 text-red-200'
                        : 'bg-red-50 border-red-200 text-red-900'
                    }`}
                  >
                    <span>
                      You have blocked <strong>@{activeConversation.peer.username}</strong>.
                      Neither of you can send messages while blocked.
                    </span>
                    <button
                      type="button"
                      onClick={handleToggleBlockPeer}
                      className="px-3 py-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-lg whitespace-nowrap"
                    >
                      Unblock @{activeConversation.peer.username}
                    </button>
                  </div>
                ) : activeConversation.peer.hasBlockedMe ? (
                  <div
                    className={`p-3 rounded-xl border text-center text-xs ${
                      isDark
                        ? 'bg-[#220712] border-rose-900/60 text-rose-200/80'
                        : 'bg-rose-50 border-rose-200 text-rose-800'
                    }`}
                  >
                    You cannot send messages to @{activeConversation.peer.username}.
                  </div>
                ) : (
                  <>
                    {/* Reply, Edit, or Pending Attachment Banner */}
                    {(replyingTo || editingMessage || pendingAttachment) && (
                      <div
                        className={`mb-2 px-3 py-2 rounded-lg border flex items-center justify-between gap-2 text-xs ${
                          isDark
                            ? 'bg-[#14040A] border-rose-800/80 text-rose-100'
                            : 'bg-white border-rose-200 text-rose-900'
                        }`}
                      >
                        <div className="min-w-0 truncate">
                          {editingMessage ? (
                            <span>
                              <strong className="text-rose-400">Editing message:</strong>{' '}
                              {editingMessage.body}
                            </span>
                          ) : pendingAttachment ? (
                            <span>
                              <strong className="text-rose-400">
                                Attached (chats bucket):
                              </strong>{' '}
                              {pendingAttachment.fileName}
                            </span>
                          ) : (
                            <span>
                              <strong className="text-rose-400">
                                Replying to @{replyingTo?.senderUsername}:
                              </strong>{' '}
                              {replyingTo?.body}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setReplyingTo(null);
                            setPendingAttachment(null);
                            if (editingMessage) {
                              setEditingMessage(null);
                              setComposerText('');
                            }
                          }}
                          className="p-1 rounded hover:bg-rose-900/40"
                          aria-label="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    <form onSubmit={handleSendOrEditMessage} className="flex items-end gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,.pdf,.txt,.doc,.docx"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className={`p-2.5 rounded-xl border transition-colors shrink-0 ${
                          isDark
                            ? 'bg-[#14040A] border-rose-800/80 text-rose-300 hover:text-white hover:bg-rose-950'
                            : 'bg-white border-rose-300 text-rose-700 hover:bg-rose-50'
                        }`}
                        title="Attach image or file to chats bucket"
                        aria-label="Attach file"
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>

                      <textarea
                        rows={1}
                        value={composerText}
                        onChange={handleComposerChange}
                        onKeyDown={handleComposerKeyDown}
                        placeholder={`Message @${activeConversation.peer.username}... (Enter to send, Shift+Enter for newline)`}
                        className={`flex-1 px-3.5 py-2.5 text-sm rounded-xl border resize-none max-h-32 focus:outline-none focus:ring-2 focus:ring-rose-500 ${
                          isDark
                            ? 'bg-[#14040A] border-rose-800/80 text-white placeholder-rose-400/50'
                            : 'bg-white border-rose-300 text-rose-950 placeholder-rose-400'
                        }`}
                      />
                      <button
                        type="submit"
                        disabled={sending || (!composerText.trim() && !pendingAttachment)}
                        className="px-4 py-2.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-40 rounded-xl transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer whitespace-nowrap shadow-xs"
                      >
                        <Send className="w-4 h-4" />
                        <span>{editingMessage ? 'Save' : 'Send'}</span>
                      </button>
                    </form>
                  </>
                )}
              </div>
            </>
          )}
        </main>

        {/* ====================================================================
            RIGHT SIDEBAR: PEER PROFILE & CONVERSATION DETAILS
            ==================================================================== */}
        {activeConversation && showPeerDetails && (
          <aside
            className={`hidden lg:flex w-72 flex-col border-l p-5 space-y-6 shrink-0 ${
              isDark
                ? 'bg-[#1B060E] border-rose-900/60'
                : 'bg-rose-50/40 border-rose-200'
            }`}
          >
            <div className="text-center space-y-3 pt-2">
              <div className="relative inline-block">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold mx-auto select-none"
                  style={{ backgroundColor: activeConversation.peer.avatarColor }}
                >
                  {activeConversation.peer.username.slice(0, 2).toUpperCase()}
                </div>
                {activeConversation.peer.isOnline && (
                  <span className="w-3.5 h-3.5 rounded-full bg-rose-400 ring-2 ring-[#1B060E] absolute bottom-0 right-0" />
                )}
              </div>

              <div>
                <h3 className="text-base font-bold">@{activeConversation.peer.username}</h3>
                <p className={`text-xs mt-0.5 ${isDark ? 'text-rose-300/70' : 'text-rose-700/70'}`}>
                  {activeConversation.peer.isOnline ? 'Online now' : 'Offline'}
                </p>
              </div>
            </div>

            <div
              className={`border-t pt-4 space-y-3 text-xs ${
                isDark ? 'border-rose-900/60' : 'border-rose-200'
              }`}
            >
              <div>
                <span className={`block mb-1 ${isDark ? 'text-rose-300/60' : 'text-rose-700/70'}`}>
                  Bio
                </span>
                <p className={isDark ? 'text-white' : 'text-rose-950'}>
                  {activeConversation.peer.bio || 'No bio set.'}
                </p>
              </div>

              <div>
                <span className={`block mb-1 ${isDark ? 'text-rose-300/60' : 'text-rose-700/70'}`}>
                  Member Since
                </span>
                <p className="tabular-nums">
                  {new Date(activeConversation.peer.createdAt).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
              </div>
            </div>

            <div
              className={`border-t pt-4 space-y-2 ${
                isDark ? 'border-rose-900/60' : 'border-rose-200'
              }`}
            >
              <button
                type="button"
                onClick={handleToggleBlockPeer}
                className={`w-full flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                  activeConversation.peer.isBlockedByMe
                    ? 'border-rose-500/40 text-rose-300 hover:bg-rose-500/10'
                    : 'border-red-500/40 text-red-400 hover:bg-red-500/10'
                }`}
              >
                {activeConversation.peer.isBlockedByMe ? (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Unblock @{activeConversation.peer.username}</span>
                  </>
                ) : (
                  <>
                    <ShieldBan className="w-4 h-4" />
                    <span>Block @{activeConversation.peer.username}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() =>
                  setReportTarget({
                    username: activeConversation.peer.username,
                  })
                }
                className={`w-full flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                  isDark
                    ? 'border-rose-800/80 text-rose-200 hover:bg-rose-950'
                    : 'border-rose-300 text-rose-900 hover:bg-rose-100'
                }`}
              >
                <Flag className="w-4 h-4 text-rose-500" />
                <span>Report @{activeConversation.peer.username}</span>
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* Modals */}
      <UserSearchModal
        isOpen={showUserSearchModal}
        onClose={() => setShowUserSearchModal(false)}
        onSelectConversation={(convId) => setSelectedConvId(convId)}
        onConversationsChanged={fetchConversations}
        isDark={isDark}
      />

      <NotificationsModal
        isOpen={showNotificationsModal}
        onClose={() => setShowNotificationsModal(false)}
        notifications={notifications}
        onMarkRead={handleMarkNotificationRead}
        onMarkAllRead={handleMarkAllNotificationsRead}
        onSelectConversation={(convId) => setSelectedConvId(convId)}
        isDark={isDark}
      />

      <SettingsModal
        isOpen={showSettingsModal}
        initialTab={settingsInitialTab}
        onClose={() => setShowSettingsModal(false)}
        currentUser={currentUser}
        onUserUpdated={onUserUpdated}
        onLoggedOut={onLoggedOut}
        onBlocksChanged={() => void fetchConversations()}
        theme={theme}
        onThemeChange={onThemeChange}
        isDark={isDark}
      />

      <ReportModal
        isOpen={Boolean(reportTarget)}
        onClose={() => setReportTarget(null)}
        targetUsername={reportTarget?.username || ''}
        messageId={reportTarget?.messageId}
        messagePreview={reportTarget?.messagePreview}
        isDark={isDark}
      />
    </div>
  );
};
