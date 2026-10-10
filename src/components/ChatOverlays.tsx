import React, { useState, useEffect } from 'react';
import {
  X,
  Search,
  MessageSquarePlus,
  Bell,
  CheckCheck,
  Flag,
  CheckCircle2,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import { UserSearchResult, NotificationItem } from '../types.ts';

// ============================================================================
// 1. USERNAME SEARCH MODAL / MOBILE BOTTOM SHEET (Requirement 10 & 35 & 37)
// ============================================================================

interface UserSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectConversation: (conversationId: string) => void;
  onConversationsChanged: () => Promise<void>;
  isDark: boolean;
}

export const UserSearchModal: React.FC<UserSearchModalProps> = ({
  isOpen,
  onClose,
  onSelectConversation,
  onConversationsChanged,
  isDark,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [startingUser, setStartingUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setResults([]);
      setError(null);
      return;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const trimmed = query.trim().replace(/^@/, '');
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const users = await api.searchUsers(trimmed);
        setResults(users);
      } catch (err: any) {
        setError(err.message || 'Search failed.');
      } finally {
        setLoading(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [query, isOpen]);

  if (!isOpen) return null;

  const handleOpenOrStart = async (user: UserSearchResult) => {
    setError(null);
    if (user.existingConversationId && user.existingConversationStatus !== 'declined') {
      onSelectConversation(user.existingConversationId);
      onClose();
      return;
    }

    setStartingUser(user.username);
    try {
      const conv = await api.startConversation(user.username);
      await onConversationsChanged();
      onSelectConversation(conv.id);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Could not start conversation.');
    } finally {
      setStartingUser(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-lg rounded-t-3xl sm:rounded-2xl border-t sm:border overflow-hidden flex flex-col max-h-[88dvh] sm:max-h-[82vh] pb-safe ${
          isDark
            ? 'bg-[#071829] border-teal-900/70 text-white'
            : 'bg-white border-teal-200 text-slate-900'
        }`}
      >
        {/* Mobile Drag Handle */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center">
          <div
            className={`w-10 h-1.5 rounded-full ${
              isDark ? 'bg-teal-800/80' : 'bg-teal-200'
            }`}
          />
        </div>

        <div
          className={`flex items-center justify-between px-5 py-3.5 sm:py-4 border-b ${
            isDark ? 'border-teal-900/60' : 'border-teal-200'
          }`}
        >
          <div>
            <h2 className="text-base font-bold tracking-tight">Find User by Username</h2>
            <p className={`text-xs mt-0.5 ${isDark ? 'text-cyan-100/75' : 'text-slate-600'}`}>
              Search any @username to start a private conversation.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl transition-colors -mr-1 ${
              isDark ? 'hover:bg-teal-950 text-cyan-200' : 'hover:bg-teal-50 text-slate-600'
            }`}
            aria-label="Close search"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 flex-1 overflow-y-auto">
          <div className="relative">
            <Search
              className={`w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 ${
                isDark ? 'text-emerald-400' : 'text-teal-600'
              }`}
            />
            <input
              type="text"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search username (e.g. sakha)..."
              className={`w-full pl-10 pr-4 py-3 min-h-[46px] text-base sm:text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                isDark
                  ? 'bg-[#040D1A] border-teal-800/80 text-white placeholder-cyan-400/50'
                  : 'bg-teal-50/40 border-teal-300 text-slate-900 placeholder-slate-400'
              }`}
            />
          </div>

          {error && (
            <div className="p-3 rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 text-xs">
              {error}
            </div>
          )}

          {loading ? (
            <div className="py-10 text-center text-xs text-cyan-200/70">Searching usernames...</div>
          ) : query.trim().replace(/^@/, '') === '' ? (
            <div className="py-10 text-center text-xs text-cyan-200/70">
              Type a username above to find people on VaultChat.
            </div>
          ) : results.length === 0 ? (
            <div className="py-10 text-center text-xs text-cyan-200/70">No users found.</div>
          ) : (
            <div
              className={`divide-y rounded-2xl border overflow-hidden ${
                isDark ? 'divide-teal-900/50 border-teal-900/60' : 'divide-teal-200 border-teal-200'
              }`}
            >
              {results.map((u) => (
                <div
                  key={u.username}
                  className="flex items-center justify-between gap-3 px-4 py-3.5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative shrink-0">
                      <div
                        className="w-11 h-11 rounded-full flex items-center justify-center text-white text-xs font-bold select-none"
                        style={{ backgroundColor: u.avatarColor }}
                      >
                        {u.username.slice(0, 2).toUpperCase()}
                      </div>
                      {u.isOnline && (
                        <span
                          className="w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#071829] absolute bottom-0 right-0"
                          title="Online"
                        />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">@{u.username}</div>
                      <div className={`text-xs truncate ${isDark ? 'text-cyan-100/70' : 'text-slate-600'}`}>
                        {u.bio || (u.isOnline ? 'Online' : 'VaultChat member')}
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0">
                    {u.isBlockedByMe ? (
                      <span className="text-xs text-red-400 font-medium">Blocked</span>
                    ) : u.hasBlockedMe ? (
                      <span className="text-xs text-cyan-200/60">Unavailable</span>
                    ) : (
                      <button
                        type="button"
                        disabled={startingUser === u.username}
                        onClick={() => handleOpenOrStart(u)}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[42px] text-xs font-semibold text-white bg-gradient-to-r from-blue-600 via-cyan-600 to-emerald-500 hover:from-blue-500 hover:via-cyan-500 hover:to-emerald-400 active:scale-[0.98] disabled:opacity-50 rounded-xl transition-all whitespace-nowrap"
                      >
                        <MessageSquarePlus className="w-4 h-4" />
                        <span>
                          {startingUser === u.username
                            ? 'Opening...'
                            : u.existingConversationId && u.existingConversationStatus !== 'declined'
                            ? 'Open Chat'
                            : 'Message'}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 2. NOTIFICATIONS MODAL / MOBILE BOTTOM SHEET (Requirement 33)
// ============================================================================

interface NotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: NotificationItem[];
  onMarkRead: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onSelectConversation: (conversationId: string) => void;
  isDark: boolean;
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({
  isOpen,
  onClose,
  notifications,
  onMarkRead,
  onMarkAllRead,
  onSelectConversation,
  isDark,
}) => {
  if (!isOpen) return null;

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-lg rounded-t-3xl sm:rounded-2xl border-t sm:border overflow-hidden flex flex-col max-h-[88dvh] sm:max-h-[82vh] pb-safe ${
          isDark
            ? 'bg-[#071829] border-teal-900/70 text-white'
            : 'bg-white border-teal-200 text-slate-900'
        }`}
      >
        {/* Mobile Drag Handle */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center">
          <div
            className={`w-10 h-1.5 rounded-full ${
              isDark ? 'bg-teal-800/80' : 'bg-teal-200'
            }`}
          />
        </div>

        <div
          className={`flex items-center justify-between px-5 py-3.5 sm:py-4 border-b ${
            isDark ? 'border-teal-900/60' : 'border-teal-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-emerald-400" />
            <h2 className="text-base font-bold tracking-tight">
              Notifications {unreadCount > 0 ? `(${unreadCount})` : ''}
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 min-h-[40px] text-xs font-semibold text-emerald-400 hover:underline whitespace-nowrap"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark all read</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl transition-colors -mr-1 ${
                isDark ? 'hover:bg-teal-950 text-cyan-200' : 'hover:bg-teal-50 text-slate-600'
              }`}
              aria-label="Close notifications"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-teal-900/40">
          {notifications.length === 0 ? (
            <div className="py-12 text-center text-xs text-cyan-200/70">
              No notifications yet.
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                onClick={async () => {
                  if (!n.isRead) {
                    await onMarkRead(n.id);
                  }
                  if (n.conversationId) {
                    onSelectConversation(n.conversationId);
                    onClose();
                  }
                }}
                className={`px-5 py-4 flex items-start justify-between gap-3 cursor-pointer transition-colors ${
                  !n.isRead
                    ? isDark
                      ? 'bg-teal-950/40 hover:bg-teal-950/60'
                      : 'bg-teal-50/80 hover:bg-teal-100/70'
                    : isDark
                    ? 'hover:bg-teal-950/30'
                    : 'hover:bg-teal-50/40'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {!n.isRead && (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                    )}
                    <span className="text-xs font-semibold truncate">{n.title}</span>
                  </div>
                  <p
                    className={`text-xs mt-1 line-clamp-2 ${
                      isDark ? 'text-cyan-100/80' : 'text-slate-700'
                    }`}
                  >
                    {n.body}
                  </p>
                  <span className="text-[11px] text-cyan-200/60 tabular-nums mt-1 block">
                    {new Date(n.createdAt).toLocaleString(undefined, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                </div>
                {!n.isRead && (
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      await onMarkRead(n.id);
                    }}
                    className="text-xs text-emerald-400 hover:underline shrink-0 whitespace-nowrap py-1 px-2 min-h-[36px]"
                  >
                    Mark read
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 3. REPORT USER / MESSAGE MODAL (Requirement 15)
// ============================================================================

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetUsername: string;
  messageId?: string | null;
  messagePreview?: string | null;
  isDark: boolean;
}

export const ReportModal: React.FC<ReportModalProps> = ({
  isOpen,
  onClose,
  targetUsername,
  messageId,
  messagePreview,
  isDark,
}) => {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setReason('');
      setError(null);
      setSubmitted(false);
    }
  }, [isOpen, targetUsername, messageId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (reason.trim().length < 5) {
      setError('Please enter a brief description (at least 5 characters).');
      return;
    }

    setSubmitting(true);
    try {
      await api.submitReport({
        username: targetUsername,
        messageId: messageId || undefined,
        reason: reason.trim(),
      });
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'Failed to submit report.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md rounded-t-3xl sm:rounded-2xl border-t sm:border p-5 sm:p-6 space-y-4 pb-safe ${
          isDark
            ? 'bg-[#071829] border-teal-900/70 text-white'
            : 'bg-white border-teal-200 text-slate-900'
        }`}
      >
        {/* Mobile Drag Handle */}
        <div className="sm:hidden -mt-2 pb-1 flex justify-center">
          <div
            className={`w-10 h-1.5 rounded-full ${
              isDark ? 'bg-teal-800/80' : 'bg-teal-200'
            }`}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flag className="w-4 h-4 text-emerald-400" />
            <h3 className="text-base font-bold">
              Report {messageId ? 'Message' : `@${targetUsername}`}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-teal-900/40 -mr-1"
            aria-label="Close report modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {submitted ? (
          <div className="py-6 text-center space-y-3">
            <CheckCircle2 className="w-9 h-9 text-emerald-400 mx-auto" />
            <p className="text-sm font-semibold">Report Submitted</p>
            <p className={`text-xs ${isDark ? 'text-cyan-100/75' : 'text-slate-600'}`}>
              Thank you. Your report against @{targetUsername} has been recorded securely.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 w-full sm:w-auto px-6 py-2.5 min-h-[44px] text-xs font-semibold text-white bg-gradient-to-r from-blue-600 via-cyan-600 to-emerald-500 hover:from-blue-500 hover:via-cyan-500 hover:to-emerald-400 rounded-xl"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className={`text-xs ${isDark ? 'text-cyan-100/75' : 'text-slate-600'}`}>
              Reporting <strong className="font-semibold">@{targetUsername}</strong>. Reports are
              stored confidentially and are never visible to other users.
            </p>

            {messagePreview && (
              <div
                className={`p-3 rounded-xl border text-xs italic truncate ${
                  isDark
                    ? 'bg-[#040D1A] border-teal-800/80 text-cyan-100/80'
                    : 'bg-teal-50 border-teal-200 text-slate-800'
                }`}
              >
                "{messagePreview}"
              </div>
            )}

            {error && (
              <div className="p-2.5 rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 text-xs">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold mb-1.5">Reason for report</label>
              <textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Describe spam, harassment, or policy violation..."
                required
                className={`w-full p-3 text-base sm:text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                  isDark
                    ? 'bg-[#040D1A] border-teal-800/80 text-white placeholder-cyan-400/50'
                    : 'bg-teal-50/40 border-teal-300 text-slate-900 placeholder-slate-400'
                }`}
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={onClose}
                className={`flex-1 sm:flex-initial px-4 py-2.5 min-h-[44px] text-xs font-semibold rounded-xl border ${
                  isDark
                    ? 'border-teal-800 text-cyan-100 hover:bg-teal-950'
                    : 'border-teal-300 text-slate-700 hover:bg-teal-50'
                }`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 sm:flex-initial px-5 py-2.5 min-h-[44px] text-xs font-semibold bg-gradient-to-r from-blue-600 via-cyan-600 to-emerald-500 hover:from-blue-500 hover:via-cyan-500 hover:to-emerald-400 text-white rounded-xl transition-all whitespace-nowrap"
              >
                {submitting ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
