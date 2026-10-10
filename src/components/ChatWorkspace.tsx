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
  Users,
  Plus,
} from 'lucide-react';
import { api, getTabSessionToken } from '../lib/api.ts';
import {
  CurrentUser,
  ConversationSummary,
  ChatMessage,
  NotificationItem,
  ThemeMode,
  UserSearchResult,
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
  const [isComposingNew, setIsComposingNew] = useState(false);
  const [mobileView, setMobileView] = useState<'chat' | 'list'>('chat');
  const [sidebarFilter, setSidebarFilter] = useState<'all' | 'unread' | 'requests'>('all');
  const [sidebarSearch, setSidebarSearch] = useState('');

  // Inline "To: @username" state when composing a new chat directly inside the Chat Box
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recipientResults, setRecipientResults] = useState<UserSearchResult[]>([]);
  const [recipientSearching, setRecipientSearching] = useState(false);

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
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);

  const [typingPeers, setTypingPeers] = useState<Record<string, string>>({});
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const [showUserSearchModal, setShowUserSearchModal] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<
    'account' | 'privacy' | 'appearance' | 'sessions'
  >('account');
  const [showPeerDetails, setShowPeerDetails] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    username: string;
    messageId?: string | null;
    messagePreview?: string | null;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recipientInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedConvIdRef = useRef<string | null>(null);
  const isComposingNewRef = useRef<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  selectedConvIdRef.current = selectedConvId;
  isComposingNewRef.current = isComposingNew;

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
      if (!selectedConvIdRef.current && !isComposingNewRef.current && list.length > 0) {
        setSelectedConvId(list[0].id);
      }
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

  // Inline recipient search when composing a new chat inside the Chat Box
  useEffect(() => {
    const trimmed = recipientQuery.trim().replace(/^@/, '');
    if (!trimmed) {
      setRecipientResults([]);
      setRecipientSearching(false);
      return;
    }

    setRecipientSearching(true);
    const timer = setTimeout(async () => {
      try {
        const users = await api.searchUsers(trimmed);
        setRecipientResults(users);
      } catch {
        setRecipientResults([]);
      } finally {
        setRecipientSearching(false);
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [recipientQuery]);

  useEffect(() => {
    if (!selectedConvId) {
      setMessages([]);
      setHasMoreMessages(false);
      setSelectedMessageId(null);
      return;
    }

    let cancelled = false;
    setMessagesLoading(true);
    setMessagesError(null);
    setSelectedMessageId(null);

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
    if (sendError) setSendError(null);
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

  const handleSelectRecipientUser = async (user: UserSearchResult) => {
    setSendError(null);
    if (user.existingConversationId && user.existingConversationStatus !== 'declined') {
      setIsComposingNew(false);
      setSelectedConvId(user.existingConversationId);
      setRecipientQuery('');
      setRecipientResults([]);
      setMobileView('chat');
      setTimeout(() => composerInputRef.current?.focus(), 50);
      return;
    }

    try {
      const conv = await api.startConversation(user.username);
      await fetchConversations();
      setIsComposingNew(false);
      setSelectedConvId(conv.id);
      setRecipientQuery('');
      setRecipientResults([]);
      setMobileView('chat');
      setTimeout(() => composerInputRef.current?.focus(), 50);
    } catch (err: any) {
      setSendError(err.message || 'Could not start conversation.');
    }
  };

  const handleSendOrEditMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (sending) return;

    const trimmed = composerText.trim();
    if (!trimmed && !pendingAttachment) {
      setSendError('Type a message or attach a file before sending.');
      composerInputRef.current?.focus();
      return;
    }

    // If no active conversation is selected yet, allow sending directly to the @username in the "To:" bar!
    if (!selectedConvId || !activeConversation) {
      const targetUser = recipientQuery.trim().replace(/^@/, '');
      if (!targetUser) {
        setSendError(
          'Enter a @username in the "To:" box at the top of the chat (or tap Find User) to send your message.'
        );
        recipientInputRef.current?.focus();
        return;
      }

      setSendError(null);
      setSending(true);
      try {
        const conv = await api.startConversation(
          targetUser,
          trimmed && !pendingAttachment ? trimmed : undefined
        );
        if (pendingAttachment) {
          await api.sendMessage(conv.id, trimmed, null, pendingAttachment);
        }
        await fetchConversations();
        setIsComposingNew(false);
        setSelectedConvId(conv.id);
        setRecipientQuery('');
        setRecipientResults([]);
        setComposerText('');
        setPendingAttachment(null);
        setMobileView('chat');
        scrollToBottom('smooth');
      } catch (err: any) {
        setSendError(err.message || 'Failed to start chat and send message.');
      } finally {
        setSending(false);
      }
      return;
    }

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
        setSelectedMessageId(null);
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
        setSelectedMessageId(null);
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
      setSelectedMessageId(null);
      void fetchConversations();
    } catch (err: any) {
      setSendError(err.message || 'Failed to delete message.');
    }
  };

  const handleCopyMessage = async (msg: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.body);
      setCopiedMessageId(msg.id);
      setTimeout(() => {
        setCopiedMessageId(null);
        setSelectedMessageId(null);
      }, 1200);
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

  const handleStartNewChatMode = () => {
    setIsComposingNew(true);
    setSelectedConvId(null);
    setMobileView('chat');
    setSendError(null);
    setTimeout(() => recipientInputRef.current?.focus(), 60);
  };

  const pendingRequestsCount = conversations.filter(
    (c) => c.status === 'pending' && !c.isInitiatedByMe
  ).length;
  const totalUnreadChatsCount = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
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
      className={`fixed inset-0 w-full h-full flex flex-col overflow-hidden transition-colors ${
        isDark
          ? 'bg-gradient-to-br from-[#030B17] via-[#051324] to-[#041A1C] text-white'
          : 'bg-white text-slate-900'
      }`}
    >
      {/* ======================================================================
          UNIVERSAL MOBILE & TABLET TOP NAVIGATION BAR (< md)
          Allows 1-tap switching between Chat Box and Chats List on mobile!
          ====================================================================== */}
      <header
        className={`md:hidden px-3 h-14 border-b flex items-center justify-between gap-2 shrink-0 z-30 ${
          isDark ? 'bg-[#040E1C] border-teal-900/70' : 'bg-white border-teal-200'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            setSettingsInitialTab('account');
            setShowSettingsModal(true);
          }}
          className="flex items-center gap-2 min-w-0 py-1 text-left cursor-pointer shrink-0"
          title="Account Settings"
        >
          <div className="relative shrink-0">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold select-none"
              style={{ backgroundColor: currentUser.avatarColor }}
            >
              {currentUser.username.slice(0, 2).toUpperCase()}
            </div>
            <span className="w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-[#040E1C] absolute bottom-0 right-0" />
          </div>
          <span className="text-xs font-bold truncate max-w-[76px] sm:max-w-[120px]">
            @{currentUser.username}
          </span>
        </button>

        {/* Mobile Mode Switcher: Chat Box vs Chats List */}
        <div
          className={`flex items-center p-1 rounded-xl border ${
            isDark ? 'bg-[#020810] border-teal-900/80' : 'bg-teal-50 border-teal-200'
          }`}
        >
          <button
            type="button"
            onClick={() => setMobileView('chat')}
            className={`px-3 py-1.5 min-h-[34px] text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap ${
              mobileView === 'chat'
                ? 'bg-gradient-to-r from-blue-600 via-cyan-600 to-emerald-500 text-white shadow-xs'
                : isDark
                ? 'text-cyan-200/70 hover:text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Chat Box</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileView('list')}
            className={`px-3 py-1.5 min-h-[34px] text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap ${
              mobileView === 'list'
                ? 'bg-gradient-to-r from-blue-600 via-cyan-600 to-emerald-500 text-white shadow-xs'
                : isDark
                ? 'text-cyan-200/70 hover:text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Chats ({conversations.length})</span>
            {totalUnreadChatsCount > 0 && (
              <span className="px-1.5 py-0.2 bg-emerald-500 text-white text-[10px] rounded-full">
                {totalUnreadChatsCount}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowUserSearchModal(true)}
            className={`min-w-[38px] min-h-[38px] flex items-center justify-center rounded-xl transition-colors ${
              isDark ? 'hover:bg-teal-950 text-emerald-400' : 'hover:bg-teal-50 text-teal-700'
            }`}
            title="Find user"
            aria-label="Find user"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setShowNotificationsModal(true)}
            className={`relative min-w-[38px] min-h-[38px] flex items-center justify-center rounded-xl transition-colors ${
              isDark ? 'hover:bg-teal-950 text-cyan-100' : 'hover:bg-teal-50 text-slate-700'
            }`}
            title="Notifications"
            aria-label="Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadNotificationsCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-400" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setSettingsInitialTab('account');
              setShowSettingsModal(true);
            }}
            className={`min-w-[38px] min-h-[38px] flex items-center justify-center rounded-xl transition-colors ${
              isDark ? 'hover:bg-teal-950 text-cyan-100' : 'hover:bg-teal-50 text-slate-700'
            }`}
            title="Settings"
            aria-label="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden relative">
        {/* ====================================================================
            LEFT SIDEBAR: CONVERSATIONS & NAVIGATION
            Visible on Desktop/Tablet (md:flex) OR on Mobile when 'list' tab is selected
            ==================================================================== */}
        <aside
          className={`${
            mobileView === 'list' ? 'flex' : 'hidden md:flex'
          } w-full md:w-72 lg:w-80 xl:w-96 flex-col border-r shrink-0 min-h-0 h-full ${
            isDark
              ? 'bg-[#051221] border-teal-900/60'
              : 'bg-teal-50/30 border-teal-200/80'
          }`}
        >
          {/* Desktop/Tablet Sidebar Header */}
          <div
            className={`hidden md:flex px-4 h-16 border-b items-center justify-between gap-2 shrink-0 ${
              isDark ? 'border-teal-900/60' : 'border-teal-200/80'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setSettingsInitialTab('account');
                setShowSettingsModal(true);
              }}
              className="flex items-center gap-2.5 min-w-0 py-1 text-left group cursor-pointer"
              title="Open Profile & Account Settings"
            >
              <div className="relative shrink-0">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold select-none"
                  style={{ backgroundColor: currentUser.avatarColor }}
                >
                  {currentUser.username.slice(0, 2).toUpperCase()}
                </div>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#051221] absolute bottom-0 right-0" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold truncate group-hover:text-emerald-400 transition-colors">
                  @{currentUser.username}
                </div>
                <div className={`text-[11px] truncate ${isDark ? 'text-cyan-200/70' : 'text-teal-700'}`}>
                  VaultChat
                </div>
              </div>
            </button>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleStartNewChatMode}
                className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl transition-colors ${
                  isDark
                    ? 'hover:bg-teal-950 text-emerald-400'
                    : 'hover:bg-teal-100/70 text-teal-800'
                }`}
                title="Compose new message"
                aria-label="Compose new message"
              >
                <MessageSquarePlus className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setShowNotificationsModal(true)}
                className={`relative min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl transition-colors ${
                  isDark
                    ? 'hover:bg-teal-950 text-cyan-100'
                    : 'hover:bg-teal-100/70 text-teal-800'
                }`}
                title="Notifications"
                aria-label="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadNotificationsCount > 0 && (
                  <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-400" />
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setSettingsInitialTab('account');
                  setShowSettingsModal(true);
                }}
                className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl transition-colors ${
                  isDark
                    ? 'hover:bg-teal-950 text-cyan-100'
                    : 'hover:bg-teal-100/70 text-teal-800'
                }`}
                title="Settings"
                aria-label="Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Search & New Conversation Trigger */}
          <div className="p-3 space-y-2.5 shrink-0">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400" />
                <input
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={sidebarSearch}
                  onChange={(e) => setSidebarSearch(e.target.value)}
                  placeholder="Filter chats or @username..."
                  className={`w-full pl-9 pr-3 py-2 min-h-[42px] text-base sm:text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
                    isDark
                      ? 'bg-[#030B17] border-teal-800/80 text-white placeholder-cyan-400/50'
                      : 'bg-white border-teal-300 text-slate-900 placeholder-slate-400'
                  }`}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowUserSearchModal(true)}
                className="px-3.5 py-2 min-h-[42px] text-xs font-semibold text-white bg-gradient-to-r from-blue-600 via-cyan-600 to-emerald-500 hover:from-blue-500 hover:via-cyan-500 hover:to-emerald-400 active:scale-[0.98] rounded-xl transition-all whitespace-nowrap shrink-0 cursor-pointer"
              >
                Find User
              </button>
            </div>

            {/* Interactive Segmented Filter Controls */}
            <div
              className={`flex items-center gap-1 p-1 rounded-xl ${
                isDark ? 'bg-[#030B17]' : 'bg-teal-100/70'
              }`}
            >
              <button
                type="button"
                onClick={() => setSidebarFilter('all')}
                className={`flex-1 py-1.5 min-h-[36px] text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
                  sidebarFilter === 'all'
                    ? 'bg-gradient-to-r from-blue-600 to-emerald-500 text-white shadow-xs'
                    : isDark
                    ? 'text-cyan-100/70 hover:text-white'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                All Chats
              </button>
              <button
                type="button"
                onClick={() => setSidebarFilter('unread')}
                className={`flex-1 py-1.5 min-h-[36px] text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
                  sidebarFilter === 'unread'
                    ? 'bg-gradient-to-r from-blue-600 to-emerald-500 text-white shadow-xs'
                    : isDark
                    ? 'text-cyan-100/70 hover:text-white'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                Unread {totalUnreadChatsCount > 0 ? `(${totalUnreadChatsCount})` : ''}
              </button>
              <button
                type="button"
                onClick={() => setSidebarFilter('requests')}
                className={`flex-1 py-1.5 min-h-[36px] text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
                  sidebarFilter === 'requests'
                    ? 'bg-gradient-to-r from-blue-600 to-emerald-500 text-white shadow-xs'
                    : isDark
                    ? 'text-cyan-100/70 hover:text-white'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                Requests {pendingRequestsCount > 0 ? `(${pendingRequestsCount})` : ''}
              </button>
            </div>
          </div>

          {/* Conversation List */}
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-teal-900/30">
            {conversationsLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 animate-pulse">
                    <div className="w-11 h-11 rounded-full bg-teal-900/50 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 bg-teal-900/50 rounded w-1/3" />
                      <div className="h-2.5 bg-teal-900/30 rounded w-2/3" />
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
                  className="px-4 py-2 min-h-[40px] text-xs font-semibold text-emerald-400 hover:underline"
                >
                  Retry
                </button>
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <MessageSquare className="w-8 h-8 text-emerald-400/60 mx-auto" />
                <p className={`text-xs ${isDark ? 'text-cyan-100/70' : 'text-slate-600'}`}>
                  No conversations yet. Start chatting right in the Chat Box or search a username!
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleStartNewChatMode}
                    className="px-4 py-2.5 min-h-[44px] text-xs font-semibold text-white bg-gradient-to-r from-blue-600 via-cyan-600 to-emerald-500 hover:from-blue-500 hover:via-cyan-500 hover:to-emerald-400 rounded-xl transition-all whitespace-nowrap cursor-pointer"
                  >
                    Open Chat Box & Send Message
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowUserSearchModal(true)}
                    className={`px-4 py-2 min-h-[40px] text-xs font-semibold rounded-xl border transition-colors ${
                      isDark
                        ? 'border-teal-800 text-cyan-100 hover:bg-teal-950'
                        : 'border-teal-300 text-teal-800 hover:bg-teal-50'
                    }`}
                  >
                    Search Username Directory
                  </button>
                </div>
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const isSelected = conv.id === selectedConvId && !isComposingNew;
                const isTyping = Boolean(typingPeers[conv.id]);
                const lastTime = conv.lastMessage?.createdAt || conv.updatedAt;

                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => {
                      setIsComposingNew(false);
                      setSelectedConvId(conv.id);
                      setMobileView('chat');
                      setReplyingTo(null);
                      setEditingMessage(null);
                      setPendingAttachment(null);
                      setMessageSearchQuery('');
                      setShowMessageSearch(false);
                      setSelectedMessageId(null);
                    }}
                    className={`w-full px-4 py-3.5 min-h-[68px] flex items-center gap-3.5 text-left transition-colors cursor-pointer ${
                      isSelected
                        ? isDark
                          ? 'bg-teal-950/80 border-l-4 border-emerald-400'
                          : 'bg-teal-100/80 border-l-4 border-teal-600'
                        : isDark
                        ? 'hover:bg-teal-950/40 active:bg-teal-950/60'
                        : 'hover:bg-teal-50/70 active:bg-teal-100/50'
                    }`}
                  >
                    <div className="relative shrink-0">
                      <div
                        className="w-11 h-11 rounded-full flex items-center justify-center text-white text-xs font-bold select-none"
                        style={{ backgroundColor: conv.peer.avatarColor }}
                      >
                        {conv.peer.username.slice(0, 2).toUpperCase()}
                      </div>
                      {conv.peer.isOnline && (
                        <span
                          className="w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#051221] absolute bottom-0 right-0"
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
                            isDark ? 'text-cyan-200/60' : 'text-slate-500'
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
                              ? 'text-emerald-400 font-medium'
                              : conv.unreadCount > 0
                              ? isDark
                                ? 'text-white font-semibold'
                                : 'text-slate-900 font-semibold'
                              : isDark
                              ? 'text-cyan-100/65'
                              : 'text-slate-600'
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
                          <span className="px-2 py-0.5 text-[11px] font-bold bg-gradient-to-r from-blue-600 to-emerald-500 text-white rounded-md tabular-nums shrink-0">
                            {conv.unreadCount}
                          </span>
                        ) : conv.lastMessage?.isMine ? (
                          <CheckCheck
                            className={`w-3.5 h-3.5 shrink-0 ${
                              conv.lastMessage.isReadByPeer
                                ? 'text-emerald-400'
                                : 'text-cyan-400/40'
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
            CENTER PANEL: MAIN CHAT BOX VIEWPORT
            Visible on Desktop, Tablet, AND Mobile (when mobileView === 'chat')!
            ==================================================================== */}
        <main
          className={`${
            mobileView === 'chat' ? 'flex' : 'hidden md:flex'
          } flex-1 flex-col min-w-0 min-h-0 h-full overflow-hidden`}
        >
          {/* Mobile Quick Conversation Switcher Strip (< md) */}
          {conversations.length > 0 && (
            <div
              className={`md:hidden px-2.5 py-1.5 border-b flex items-center gap-1.5 overflow-x-auto shrink-0 ${
                isDark ? 'bg-[#030B17] border-teal-900/60' : 'bg-teal-50/60 border-teal-200'
              }`}
            >
              <button
                type="button"
                onClick={handleStartNewChatMode}
                className={`px-2.5 py-1 min-h-[32px] rounded-lg text-xs font-semibold flex items-center gap-1 shrink-0 transition-all ${
                  isComposingNew || !activeConversation
                    ? 'bg-gradient-to-r from-blue-600 to-emerald-500 text-white shadow-xs'
                    : isDark
                    ? 'bg-[#071829] text-emerald-400 border border-teal-800/80'
                    : 'bg-white text-teal-700 border border-teal-300'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New</span>
              </button>

              {conversations.map((conv) => {
                const active = conv.id === selectedConvId && !isComposingNew;
                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => {
                      setIsComposingNew(false);
                      setSelectedConvId(conv.id);
                      setSendError(null);
                    }}
                    className={`px-2.5 py-1 min-h-[32px] rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-all ${
                      active
                        ? 'bg-gradient-to-r from-blue-600 to-emerald-500 text-white shadow-xs'
                        : isDark
                        ? 'bg-[#071829] text-cyan-100/80 border border-teal-900/60'
                        : 'bg-white text-slate-700 border border-teal-200'
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{
                        backgroundColor: conv.peer.isOnline
                          ? '#34D399'
                          : conv.peer.avatarColor,
                      }}
                    />
                    <span className="truncate max-w-[110px]">@{conv.peer.username}</span>
                    {conv.unreadCount > 0 && (
                      <span className="px-1.5 text-[10px] rounded-full bg-emerald-500 text-white font-bold">
                        {conv.unreadCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* ==================================================================
              CHAT BOX TOP HEADER:
              Shows Active Peer Header OR "To: @username" New Chat Bar
              ================================================================== */}
          {activeConversation && !isComposingNew ? (
            <header
              className={`px-2.5 sm:px-4 h-14 sm:h-16 border-b flex items-center justify-between gap-2 shrink-0 ${
                isDark ? 'bg-[#051221] border-teal-900/60' : 'bg-white border-teal-200/80'
              }`}
            >
              <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => {
                    setMobileView('list');
                    setShowPeerDetails(false);
                  }}
                  className={`md:hidden min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl transition-colors shrink-0 ${
                    isDark ? 'hover:bg-teal-950 text-white' : 'hover:bg-teal-50 text-slate-900'
                  }`}
                  aria-label="View all conversations"
                  title="All conversations"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>

                <button
                  type="button"
                  onClick={() => setShowPeerDetails(!showPeerDetails)}
                  className="flex items-center gap-2.5 min-w-0 text-left py-1 cursor-pointer"
                  title="View user profile details"
                >
                  <div className="relative shrink-0">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold select-none"
                      style={{ backgroundColor: activeConversation.peer.avatarColor }}
                    >
                      {activeConversation.peer.username.slice(0, 2).toUpperCase()}
                    </div>
                    {activeConversation.peer.isOnline && (
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#051221] absolute bottom-0 right-0" />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">
                      @{activeConversation.peer.username}
                    </div>
                    <div className="text-[11px] flex items-center gap-1.5 truncate">
                      {typingPeers[activeConversation.id] ? (
                        <span className="text-emerald-400 font-medium">typing...</span>
                      ) : activeConversation.peer.isBlockedByMe ? (
                        <span className="text-red-400">Blocked by you</span>
                      ) : activeConversation.peer.isOnline ? (
                        <span className="text-emerald-400">Online</span>
                      ) : activeConversation.peer.lastActiveAt ? (
                        <span
                          className={`tabular-nums truncate ${
                            isDark ? 'text-cyan-200/70' : 'text-slate-500'
                          }`}
                        >
                          Active{' '}
                          {new Date(activeConversation.peer.lastActiveAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      ) : (
                        <span className={isDark ? 'text-cyan-200/70' : 'text-slate-500'}>
                          Tap for info
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              </div>

              <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                <button
                  type="button"
                  onClick={handleStartNewChatMode}
                  className={` px-2.5 min-h-[38px] hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold rounded-xl border transition-colors mr-1 ${
                    isDark
                      ? 'border-teal-800/80 bg-[#071829] text-emerald-400 hover:bg-teal-950'
                      : 'border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100'
                  }`}
                  title="Start a new chat"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Chat</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowMessageSearch(!showMessageSearch);
                    if (showMessageSearch) setMessageSearchQuery('');
                  }}
                  className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl transition-colors ${
                    showMessageSearch
                      ? 'bg-gradient-to-r from-blue-600 to-emerald-500 text-white'
                      : isDark
                      ? 'hover:bg-teal-950 text-cyan-200'
                      : 'hover:bg-teal-50 text-slate-700'
                  }`}
                  title="Search in conversation"
                  aria-label="Search in conversation"
                >
                  <Search className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={handleToggleBlockPeer}
                  className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl transition-colors ${
                    activeConversation.peer.isBlockedByMe
                      ? 'bg-red-500/20 text-red-400'
                      : isDark
                      ? 'hover:bg-teal-950 text-cyan-200'
                      : 'hover:bg-teal-50 text-slate-700'
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
                  className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl transition-colors ${
                    isDark
                      ? 'hover:bg-teal-950 text-cyan-200'
                      : 'hover:bg-teal-50 text-slate-700'
                  }`}
                  title={`Report @${activeConversation.peer.username}`}
                  aria-label="Report user"
                >
                  <Flag className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => setShowPeerDetails(!showPeerDetails)}
                  className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl transition-colors ${
                    showPeerDetails
                      ? 'bg-gradient-to-r from-blue-600 to-emerald-500 text-white'
                      : isDark
                      ? 'hover:bg-teal-950 text-cyan-200'
                      : 'hover:bg-teal-50 text-slate-700'
                  }`}
                  title="Profile details"
                  aria-label="Toggle profile details"
                >
                  <Info className="w-4 h-4" />
                </button>
              </div>
            </header>
          ) : (
            /* Direct "To: @username" Recipient Header Bar when no chat is selected yet */
            <header
              className={`px-3 sm:px-4 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
                isDark ? 'bg-[#051221] border-teal-900/60' : 'bg-white border-teal-200/80'
              }`}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 shrink-0">
                  To:
                </span>
                <div className="relative flex-1 min-w-0">
                  <input
                    ref={recipientInputRef}
                    type="text"
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={recipientQuery}
                    onChange={(e) => {
                      setRecipientQuery(e.target.value);
                      if (sendError) setSendError(null);
                    }}
                    placeholder="Type @username to message (e.g. sakha)..."
                    className={`w-full px-3 py-2 min-h-[40px] text-base sm:text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                      isDark
                        ? 'bg-[#030B17] border-teal-800/80 text-white placeholder-cyan-400/50'
                        : 'bg-teal-50/50 border-teal-300 text-slate-900 placeholder-slate-400'
                    }`}
                  />
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {conversations.length > 0 && isComposingNew && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsComposingNew(false);
                      setSelectedConvId(conversations[0].id);
                    }}
                    className={`px-3 py-2 min-h-[40px] text-xs font-semibold rounded-xl border transition-colors ${
                      isDark
                        ? 'border-teal-800 text-cyan-100 hover:bg-teal-950'
                        : 'border-teal-300 text-slate-700 hover:bg-teal-50'
                    }`}
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowUserSearchModal(true)}
                  className="px-3 py-2 min-h-[40px] text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-emerald-500 hover:from-blue-500 hover:to-emerald-400 rounded-xl transition-all whitespace-nowrap cursor-pointer"
                >
                  Directory
                </button>
              </div>
            </header>
          )}

          {/* In-Conversation Search Bar */}
          {activeConversation && !isComposingNew && showMessageSearch && (
            <div
              className={`px-4 py-2.5 border-b flex items-center gap-2 shrink-0 ${
                isDark ? 'bg-[#071829] border-teal-900/60' : 'bg-teal-50/70 border-teal-200'
              }`}
            >
              <Search className="w-4 h-4 text-emerald-400 shrink-0" />
              <input
                type="text"
                autoFocus
                value={messageSearchQuery}
                onChange={(e) => setMessageSearchQuery(e.target.value)}
                placeholder="Search messages in this chat..."
                className="flex-1 bg-transparent text-base sm:text-xs focus:outline-none min-h-[36px]"
              />
              {messageSearchQuery && (
                <button
                  type="button"
                  onClick={() => setMessageSearchQuery('')}
                  className="text-xs text-emerald-400 hover:underline px-2 py-1"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {/* Message Request Banner (Requirement 34) */}
          {activeConversation &&
            !isComposingNew &&
            activeConversation.status === 'pending' &&
            !activeConversation.isInitiatedByMe && (
              <div
                className={`px-4 py-3 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shrink-0 ${
                  isDark
                    ? 'bg-teal-950/60 border-teal-800/70'
                    : 'bg-teal-50 border-teal-200'
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
                    className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[40px] text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-emerald-500 hover:from-blue-500 hover:to-emerald-400 rounded-xl transition-all whitespace-nowrap"
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Accept</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDeclineRequest}
                    className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[40px] text-xs font-semibold rounded-xl border transition-colors whitespace-nowrap ${
                      isDark
                        ? 'border-teal-800 hover:bg-teal-950 text-white'
                        : 'border-teal-300 hover:bg-white text-slate-900'
                    }`}
                  >
                    <UserX className="w-3.5 h-3.5" />
                    <span>Decline</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleBlockPeer}
                    className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[40px] text-xs font-semibold text-red-300 border border-red-500/40 hover:bg-red-500/10 rounded-xl transition-colors whitespace-nowrap"
                  >
                    <ShieldBan className="w-3.5 h-3.5" />
                    <span>Block</span>
                  </button>
                </div>
              </div>
            )}

          {/* ==================================================================
              CENTER SCROLLABLE STREAM:
              Shows Message History OR Inline Recipient Picker when composing new
              ================================================================== */}
          <div
            className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-4 space-y-3"
            onClick={() => setSelectedMessageId(null)}
          >
            {!activeConversation || isComposingNew ? (
              <div className="max-w-lg mx-auto py-4 space-y-4">
                {recipientQuery.trim().replace(/^@/, '') !== '' ? (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-emerald-400 px-1">
                      {recipientSearching
                        ? 'Searching matching usernames...'
                        : recipientResults.length > 0
                        ? 'Tap a user below to open chat, or type your message below and press Send:'
                        : 'No exact user found yet — check the username spelling'}
                    </div>
                    {recipientResults.length > 0 && (
                      <div
                        className={`divide-y rounded-2xl border overflow-hidden ${
                          isDark
                            ? 'bg-[#051221] divide-teal-900/60 border-teal-800/80'
                            : 'bg-white divide-teal-100 border-teal-200 shadow-xs'
                        }`}
                      >
                        {recipientResults.map((u) => (
                          <button
                            key={u.username}
                            type="button"
                            onClick={() => void handleSelectRecipientUser(u)}
                            className={`w-full px-4 py-3 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                              isDark ? 'hover:bg-teal-950/70' : 'hover:bg-teal-50'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                                style={{ backgroundColor: u.avatarColor }}
                              >
                                {u.username.slice(0, 2).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-bold truncate">@{u.username}</div>
                                <div
                                  className={`text-xs truncate ${
                                    isDark ? 'text-cyan-200/70' : 'text-slate-500'
                                  }`}
                                >
                                  {u.bio || (u.isOnline ? 'Online now' : 'VaultChat user')}
                                </div>
                              </div>
                            </div>
                            <span className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-gradient-to-r from-blue-600 to-emerald-500 text-white shrink-0">
                              Select
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    className={`p-5 sm:p-6 rounded-2xl border text-center space-y-3 ${
                      isDark
                        ? 'bg-[#051221]/90 border-teal-900/70'
                        : 'bg-teal-50/60 border-teal-200'
                    }`}
                  >
                    <div
                      className={`w-12 h-12 rounded-2xl flex items-center justify-center mx-auto border ${
                        isDark
                          ? 'bg-[#071829] border-teal-800 text-emerald-400'
                          : 'bg-white border-teal-200 text-teal-600'
                      }`}
                    >
                      <MessageSquare className="w-6 h-6" />
                    </div>
                    <h2 className="text-base sm:text-lg font-bold tracking-tight">
                      Send a Private Message
                    </h2>
                    <p
                      className={`text-xs max-w-md mx-auto leading-relaxed ${
                        isDark ? 'text-cyan-100/75' : 'text-slate-600'
                      }`}
                    >
                      Enter any <strong>@username</strong> in the <strong>To:</strong> box at the
                      top, then type your message in the chat box below and press{' '}
                      <strong>Send</strong>.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => recipientInputRef.current?.focus()}
                        className="px-4 py-2.5 min-h-[42px] text-xs font-semibold text-white bg-gradient-to-r from-blue-600 via-cyan-600 to-emerald-500 hover:from-blue-500 hover:to-emerald-400 rounded-xl transition-all cursor-pointer"
                      >
                        Type @username in "To:"
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowUserSearchModal(true)}
                        className={`px-4 py-2.5 min-h-[42px] text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                          isDark
                            ? 'border-teal-800 text-cyan-100 hover:bg-teal-950'
                            : 'border-teal-300 text-slate-800 hover:bg-white'
                        }`}
                      >
                        Search User Directory
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                {hasMoreMessages && (
                  <div className="text-center pb-2">
                    <button
                      type="button"
                      disabled={loadingOlder}
                      onClick={handleLoadOlderMessages}
                      className={`px-4 py-2 min-h-[40px] text-xs font-medium rounded-xl border transition-colors ${
                        isDark
                          ? 'border-teal-900 bg-[#071829] hover:bg-teal-950 text-cyan-100'
                          : 'border-teal-200 bg-teal-50 hover:bg-teal-100 text-slate-900'
                      }`}
                    >
                      {loadingOlder ? 'Loading older messages...' : 'Load older messages'}
                    </button>
                  </div>
                )}

                {messagesLoading ? (
                  <div className="py-12 text-center text-xs text-cyan-200/70">
                    Loading messages...
                  </div>
                ) : messagesError ? (
                  <div className="py-12 text-center space-y-2">
                    <AlertCircle className="w-6 h-6 text-red-400 mx-auto" />
                    <p className="text-xs text-red-400">{messagesError}</p>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="py-12 text-center space-y-2 px-4">
                    <p className="text-sm font-semibold">
                      Chat with @{activeConversation.peer.username}
                    </p>
                    <p className={`text-xs ${isDark ? 'text-cyan-100/70' : 'text-slate-600'}`}>
                      Type your message in the box below and press Send.
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
                    const isActionOpen = selectedMessageId === msg.id;

                    return (
                      <div
                        key={msg.id}
                        className={`group flex flex-col ${
                          msg.isMine ? 'items-end' : 'items-start'
                        } ${isSameSenderAsPrev ? 'mt-1' : 'mt-3.5'}`}
                      >
                        {!isSameSenderAsPrev && (
                          <div
                            className={`flex items-center gap-1.5 mb-1 px-1 text-[11px] ${
                              isDark ? 'text-cyan-200/70' : 'text-slate-500'
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
                          className={`flex items-center gap-2 max-w-[88%] sm:max-w-[74%] ${
                            msg.isMine ? 'flex-row-reverse' : 'flex-row'
                          }`}
                        >
                          {/* Message Bubble: Blue & Green Gradient for sent, Crisp White / Deep Ocean for received */}
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!msg.isDeleted) {
                                setSelectedMessageId((prevId) =>
                                  prevId === msg.id ? null : msg.id
                                );
                              }
                            }}
                            className={`rounded-2xl px-3.5 sm:px-4 py-2.5 text-sm leading-relaxed break-words cursor-pointer select-text transition-transform active:scale-[0.99] ${
                              msg.isDeleted
                                ? isDark
                                  ? 'bg-[#071829]/60 border border-teal-900/60 text-cyan-200/50 italic'
                                  : 'bg-teal-50/50 border border-teal-200 text-slate-400 italic'
                                : msg.isMine
                                ? 'bg-gradient-to-r from-blue-600 via-cyan-600 to-emerald-500 text-white font-medium shadow-xs'
                                : isDark
                                ? 'bg-[#0A2239] border border-teal-800/70 text-white font-medium shadow-xs'
                                : 'bg-teal-50/70 border border-teal-200 text-slate-900'
                            }`}
                          >
                            {msg.replyTo && !msg.isDeleted && (
                              <div
                                className={`mb-2 px-2.5 py-1.5 text-xs rounded-xl border ${
                                  msg.isMine
                                    ? 'border-white/30 bg-black/20 text-white'
                                    : isDark
                                    ? 'border-teal-700 bg-[#04101E] text-cyan-100'
                                    : 'border-teal-300 bg-white/80 text-slate-800'
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
                              <div className="mb-2" onClick={(e) => e.stopPropagation()}>
                                {msg.attachment.mimeType.startsWith('image/') ? (
                                  <a
                                    href={api.getAttachmentUrl(msg.attachment.id)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block overflow-hidden rounded-xl border border-white/20"
                                  >
                                    <img
                                      src={api.getAttachmentUrl(msg.attachment.id)}
                                      alt={msg.attachment.fileName}
                                      referrerPolicy="no-referrer"
                                      className="max-h-60 w-auto object-cover rounded-xl"
                                    />
                                  </a>
                                ) : (
                                  <a
                                    href={api.getAttachmentUrl(msg.attachment.id)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`flex items-center gap-2 p-2.5 rounded-xl border text-xs font-semibold ${
                                      msg.isMine
                                        ? 'border-white/30 bg-black/20 text-white hover:bg-black/30'
                                        : isDark
                                        ? 'border-teal-700 bg-[#04101E] text-cyan-100 hover:bg-teal-950'
                                        : 'border-teal-300 bg-white text-slate-900 hover:bg-teal-100/60'
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
                                  ? 'text-cyan-50/90'
                                  : isDark
                                  ? 'text-cyan-200/70'
                                  : 'text-slate-500'
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

                          {/* Desktop Hover Action Controls */}
                          {!msg.isDeleted && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className={`hidden md:flex opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity items-center gap-0.5 p-1 rounded-xl border shrink-0 ${
                                isDark
                                  ? 'bg-[#071829] border-teal-800 text-cyan-100'
                                  : 'bg-white border-teal-200 text-slate-700 shadow-xs'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMessage(null);
                                  setReplyingTo(msg);
                                }}
                                className="p-1.5 hover:text-emerald-400 rounded-lg"
                                title="Reply"
                                aria-label="Reply to message"
                              >
                                <Reply className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => void handleCopyMessage(msg)}
                                className="p-1.5 hover:text-emerald-400 rounded-lg"
                                title="Copy message"
                                aria-label="Copy message"
                              >
                                {copiedMessageId === msg.id ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
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
                                    className="p-1.5 hover:text-emerald-400 rounded-lg"
                                    title="Edit message"
                                    aria-label="Edit message"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteOwnMessage(msg.id)}
                                    className="p-1.5 hover:text-red-400 rounded-lg"
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
                                  className="p-1.5 hover:text-emerald-400 rounded-lg"
                                  title="Report message"
                                  aria-label="Report message"
                                >
                                  <Flag className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Mobile Tap-to-Reveal Action Bar */}
                        {!msg.isDeleted && isActionOpen && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className={`flex md:hidden items-center gap-1 mt-1.5 p-1 rounded-xl border shadow-sm ${
                              isDark
                                ? 'bg-[#071829] border-teal-800 text-cyan-50'
                                : 'bg-white border-teal-200 text-slate-900'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setEditingMessage(null);
                                setReplyingTo(msg);
                                setSelectedMessageId(null);
                              }}
                              className="flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] text-xs font-medium rounded-lg hover:bg-emerald-500/20"
                            >
                              <Reply className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Reply</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleCopyMessage(msg)}
                              className="flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] text-xs font-medium rounded-lg hover:bg-emerald-500/20"
                            >
                              {copiedMessageId === msg.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>Copy</span>
                                </>
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
                                    setSelectedMessageId(null);
                                  }}
                                  className="flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] text-xs font-medium rounded-lg hover:bg-emerald-500/20"
                                >
                                  <Edit3 className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>Edit</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteOwnMessage(msg.id)}
                                  className="flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] text-xs font-medium text-red-400 rounded-lg hover:bg-red-500/15"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Delete</span>
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedMessageId(null);
                                  setReportTarget({
                                    username: msg.senderUsername,
                                    messageId: msg.id,
                                    messagePreview: msg.body,
                                  });
                                }}
                                className="flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] text-xs font-medium text-emerald-400 rounded-lg hover:bg-emerald-500/20"
                              >
                                <Flag className="w-3.5 h-3.5" />
                                <span>Report</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Typing Indicator Bar */}
          {activeConversation && !isComposingNew && typingPeers[activeConversation.id] && (
            <div className="px-4 sm:px-6 py-1 text-xs text-emerald-400 font-medium shrink-0">
              @{typingPeers[activeConversation.id]} is typing...
            </div>
          )}

          {/* ==================================================================
              ALWAYS-VISIBLE MESSAGE COMPOSER BOX (Mobile, Tablet & Desktop)
              ================================================================== */}
          <div
            className={`p-2.5 sm:p-3.5 border-t pb-safe shrink-0 z-20 ${
              isDark ? 'bg-[#04101E] border-teal-800/80' : 'bg-teal-50/60 border-teal-200'
            }`}
          >
            {sendError && (
              <div className="mb-2 px-3 py-2 rounded-xl border border-red-500/40 bg-red-500/15 text-red-200 text-xs flex items-center justify-between">
                <span>{sendError}</span>
                <button
                  type="button"
                  onClick={() => setSendError(null)}
                  className="text-xs underline ml-2 px-2 py-0.5 font-semibold"
                >
                  Dismiss
                </button>
              </div>
            )}

            {activeConversation &&
            !isComposingNew &&
            activeConversation.peer.isBlockedByMe ? (
              <div
                className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs ${
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
                  className="px-4 py-2 min-h-[40px] text-xs font-semibold bg-gradient-to-r from-blue-600 to-emerald-500 hover:from-blue-500 hover:to-emerald-400 text-white rounded-xl whitespace-nowrap"
                >
                  Unblock @{activeConversation.peer.username}
                </button>
              </div>
            ) : activeConversation &&
              !isComposingNew &&
              activeConversation.peer.hasBlockedMe ? (
              <div
                className={`p-3 rounded-xl border text-center text-xs ${
                  isDark
                    ? 'bg-[#071829] border-teal-900/60 text-cyan-100/80'
                    : 'bg-teal-50 border-teal-200 text-slate-700'
                }`}
              >
                You cannot send messages to @{activeConversation.peer.username}.
              </div>
            ) : (
              <>
                {/* Reply, Edit, or Pending Attachment Banner */}
                {(replyingTo || editingMessage || pendingAttachment) && (
                  <div
                    className={`mb-2 px-3 py-2 rounded-xl border flex items-center justify-between gap-2 text-xs ${
                      isDark
                        ? 'bg-[#030B17] border-teal-800/80 text-cyan-50'
                        : 'bg-white border-teal-200 text-slate-900'
                    }`}
                  >
                    <div className="min-w-0 truncate">
                      {editingMessage ? (
                        <span>
                          <strong className="text-emerald-400">Editing:</strong>{' '}
                          {editingMessage.body}
                        </span>
                      ) : pendingAttachment ? (
                        <span>
                          <strong className="text-emerald-400">Attached (chats):</strong>{' '}
                          {pendingAttachment.fileName}
                        </span>
                      ) : (
                        <span>
                          <strong className="text-emerald-400">
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
                      className="min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg hover:bg-teal-900/40 shrink-0"
                      aria-label="Cancel"
                    >
                      <X className="w-4 h-4" />
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
                    className={`min-w-[46px] min-h-[46px] flex items-center justify-center rounded-xl border-2 transition-colors shrink-0 cursor-pointer ${
                      isDark
                        ? 'bg-[#071A2E] border-teal-700/80 text-cyan-200 hover:text-white hover:border-emerald-400'
                        : 'bg-white border-teal-300 text-teal-700 hover:bg-teal-50'
                    }`}
                    title="Attach image or file to chats bucket"
                    aria-label="Attach file"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>

                  <textarea
                    ref={composerInputRef}
                    rows={1}
                    value={composerText}
                    onChange={handleComposerChange}
                    onKeyDown={handleComposerKeyDown}
                    placeholder={
                      activeConversation && !isComposingNew
                        ? `Type a message to @${activeConversation.peer.username}...`
                        : recipientQuery.trim()
                        ? `Type a message to @${recipientQuery.trim().replace(/^@/, '')}...`
                        : 'Type a chat message here...'
                    }
                    className={`flex-1 px-3.5 py-2.5 min-h-[46px] text-base sm:text-sm rounded-xl border-2 resize-none max-h-28 focus:outline-none focus:ring-2 focus:ring-emerald-400 ${
                      isDark
                        ? 'bg-[#071A2E] border-teal-700/80 text-white placeholder-cyan-300/60 focus:border-emerald-400'
                        : 'bg-white border-teal-300 text-slate-900 placeholder-slate-400 focus:border-teal-600'
                    }`}
                  />

                  <button
                    type="submit"
                    disabled={sending}
                    className="px-4 sm:px-5 min-h-[46px] text-xs sm:text-sm font-bold text-white bg-gradient-to-r from-blue-600 via-cyan-500 to-emerald-500 hover:from-blue-500 hover:via-cyan-400 hover:to-emerald-400 active:scale-[0.98] disabled:opacity-60 rounded-xl transition-all flex items-center justify-center gap-1.5 shrink-0 cursor-pointer whitespace-nowrap shadow-sm"
                  >
                    <Send className="w-4 h-4" />
                    <span>{editingMessage ? 'Save' : 'Send'}</span>
                  </button>
                </form>
              </>
            )}
          </div>
        </main>

        {/* ====================================================================
            RIGHT SIDEBAR (Desktop) & BOTTOM SHEET (Mobile): PEER PROFILE DETAILS
            ==================================================================== */}
        {activeConversation && !isComposingNew && showPeerDetails && (
          <>
            {/* Mobile / Tablet Bottom Sheet Overlay (< lg) */}
            <div
              className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 backdrop-blur-xs lg:hidden"
              onClick={() => setShowPeerDetails(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className={`w-full max-w-lg rounded-t-3xl border-t p-5 space-y-5 pb-safe ${
                  isDark
                    ? 'bg-[#071829] border-teal-900/70 text-white'
                    : 'bg-white border-teal-200 text-slate-900'
                }`}
              >
                <div className="-mt-2 pb-1 flex justify-center">
                  <div
                    className={`w-10 h-1.5 rounded-full ${
                      isDark ? 'bg-teal-800/80' : 'bg-teal-200'
                    }`}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold">Contact Profile</h3>
                  <button
                    type="button"
                    onClick={() => setShowPeerDetails(false)}
                    className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-teal-900/40 -mr-1"
                    aria-label="Close contact info"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex items-center gap-4">
                  <div className="relative shrink-0">
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold select-none"
                      style={{ backgroundColor: activeConversation.peer.avatarColor }}
                    >
                      {activeConversation.peer.username.slice(0, 2).toUpperCase()}
                    </div>
                    {activeConversation.peer.isOnline && (
                      <span className="w-3.5 h-3.5 rounded-full bg-emerald-400 ring-2 ring-[#071829] absolute bottom-0 right-0" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-base font-bold truncate">
                      @{activeConversation.peer.username}
                    </h4>
                    <p className={`text-xs mt-0.5 ${isDark ? 'text-cyan-200/70' : 'text-slate-500'}`}>
                      {activeConversation.peer.isOnline ? 'Online now' : 'Offline'} · Joined{' '}
                      {new Date(activeConversation.peer.createdAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                      })}
                    </p>
                  </div>
                </div>

                <div
                  className={`p-3.5 rounded-2xl border text-xs space-y-1 ${
                    isDark
                      ? 'bg-[#040D1A]/70 border-teal-900/60'
                      : 'bg-teal-50/60 border-teal-200'
                  }`}
                >
                  <span className={`block font-semibold ${isDark ? 'text-cyan-200/70' : 'text-slate-500'}`}>
                    Bio
                  </span>
                  <p className={isDark ? 'text-white' : 'text-slate-900'}>
                    {activeConversation.peer.bio || 'No bio set.'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      void handleToggleBlockPeer();
                      setShowPeerDetails(false);
                    }}
                    className={`flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] text-xs font-semibold rounded-xl border transition-colors whitespace-nowrap ${
                      activeConversation.peer.isBlockedByMe
                        ? 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10'
                        : 'border-red-500/40 text-red-400 hover:bg-red-500/10'
                    }`}
                  >
                    {activeConversation.peer.isBlockedByMe ? (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        <span>Unblock</span>
                      </>
                    ) : (
                      <>
                        <ShieldBan className="w-4 h-4" />
                        <span>Block User</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowPeerDetails(false);
                      setReportTarget({
                        username: activeConversation.peer.username,
                      });
                    }}
                    className={`flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] text-xs font-semibold rounded-xl border transition-colors whitespace-nowrap ${
                      isDark
                        ? 'border-teal-800/80 text-cyan-100 hover:bg-teal-950'
                        : 'border-teal-300 text-slate-800 hover:bg-teal-50'
                    }`}
                  >
                    <Flag className="w-4 h-4 text-emerald-400" />
                    <span>Report User</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Desktop Right Sidebar (lg:flex) */}
            <aside
              className={`hidden lg:flex w-72 flex-col border-l p-5 space-y-6 shrink-0 ${
                isDark
                  ? 'bg-[#051221] border-teal-900/60'
                  : 'bg-teal-50/40 border-teal-200'
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
                    <span className="w-3.5 h-3.5 rounded-full bg-emerald-400 ring-2 ring-[#051221] absolute bottom-0 right-0" />
                  )}
                </div>

                <div>
                  <h3 className="text-base font-bold">@{activeConversation.peer.username}</h3>
                  <p className={`text-xs mt-0.5 ${isDark ? 'text-cyan-200/70' : 'text-slate-500'}`}>
                    {activeConversation.peer.isOnline ? 'Online now' : 'Offline'}
                  </p>
                </div>
              </div>

              <div
                className={`border-t pt-4 space-y-3 text-xs ${
                  isDark ? 'border-teal-900/60' : 'border-teal-200'
                }`}
              >
                <div>
                  <span className={`block mb-1 ${isDark ? 'text-cyan-200/60' : 'text-slate-500'}`}>
                    Bio
                  </span>
                  <p className={isDark ? 'text-white' : 'text-slate-900'}>
                    {activeConversation.peer.bio || 'No bio set.'}
                  </p>
                </div>

                <div>
                  <span className={`block mb-1 ${isDark ? 'text-cyan-200/60' : 'text-slate-500'}`}>
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
                  isDark ? 'border-teal-900/60' : 'border-teal-200'
                }`}
              >
                <button
                  type="button"
                  onClick={handleToggleBlockPeer}
                  className={`w-full flex items-center justify-center gap-2 px-3.5 py-2.5 min-h-[42px] text-xs font-semibold rounded-xl border transition-colors whitespace-nowrap ${
                    activeConversation.peer.isBlockedByMe
                      ? 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10'
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
                  className={`w-full flex items-center justify-center gap-2 px-3.5 py-2.5 min-h-[42px] text-xs font-semibold rounded-xl border transition-colors whitespace-nowrap ${
                    isDark
                      ? 'border-teal-800/80 text-cyan-100 hover:bg-teal-950'
                      : 'border-teal-300 text-slate-800 hover:bg-teal-100/60'
                  }`}
                >
                  <Flag className="w-4 h-4 text-emerald-400" />
                  <span>Report @{activeConversation.peer.username}</span>
                </button>
              </div>
            </aside>
          </>
        )}
      </div>

      {/* Modals */}
      <UserSearchModal
        isOpen={showUserSearchModal}
        onClose={() => setShowUserSearchModal(false)}
        onSelectConversation={(convId) => {
          setIsComposingNew(false);
          setSelectedConvId(convId);
          setMobileView('chat');
        }}
        onConversationsChanged={fetchConversations}
        isDark={isDark}
      />

      <NotificationsModal
        isOpen={showNotificationsModal}
        onClose={() => setShowNotificationsModal(false)}
        notifications={notifications}
        onMarkRead={handleMarkNotificationRead}
        onMarkAllRead={handleMarkAllNotificationsRead}
        onSelectConversation={(convId) => {
          setIsComposingNew(false);
          setSelectedConvId(convId);
          setMobileView('chat');
        }}
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
