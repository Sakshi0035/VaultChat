import {
  CurrentUser,
  ConversationSummary,
  ChatMessage,
  UserSearchResult,
  BlockedUserItem,
  NotificationItem,
  ActiveSessionItem,
  PeerProfile,
} from '../types.ts';

// CSRF token and ephemeral session token fallback (in memory / sessionStorage only for sandboxed iframe compatibility)
let csrfTokenMemory: string | null = null;

export function setAuthTokens(csrfToken?: string, sessionToken?: string): void {
  if (csrfToken) {
    csrfTokenMemory = csrfToken;
  }
  if (sessionToken) {
    try {
      sessionStorage.setItem('vaultchat_tab_token', sessionToken);
    } catch {
      // Ignore storage errors
    }
  }
}

export function clearAuthTokens(): void {
  csrfTokenMemory = null;
  try {
    sessionStorage.removeItem('vaultchat_tab_token');
  } catch {
    // Ignore storage errors
  }
}

export function getTabSessionToken(): string | null {
  try {
    return sessionStorage.getItem('vaultchat_tab_token');
  } catch {
    return null;
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'VaultChatClient',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (csrfTokenMemory) {
    headers['X-CSRF-Token'] = csrfTokenMemory;
  }

  const tabToken = getTabSessionToken();
  if (tabToken) {
    headers['X-Session-Token'] = tabToken;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  let data: any = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await response.json();
  }

  if (!response.ok) {
    if (
      response.status === 404 &&
      !contentType.includes('application/json') &&
      typeof window !== 'undefined' &&
      window.location.hostname.endsWith('github.io')
    ) {
      throw new Error(
        'GitHub Pages only hosts static HTML/JS and cannot run the Node.js + Neon PostgreSQL server directly. Connect your GitHub repo to Render.com or set VITE_API_BASE_URL to your backend server.'
      );
    }
    const errorMessage = data?.error || `Request failed (${response.status})`;
    const err = new Error(errorMessage) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }

  return data as T;
}

export const api = {
  // Authentication
  async signup(username: string, password: string, confirmPassword: string) {
    const res = await request<{
      user: CurrentUser;
      csrfToken: string;
      sessionToken: string;
    }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username, password, confirmPassword }),
    });
    setAuthTokens(res.csrfToken, res.sessionToken);
    return res.user;
  },

  async login(username: string, password: string) {
    const res = await request<{
      user: CurrentUser;
      csrfToken: string;
      sessionToken: string;
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setAuthTokens(res.csrfToken, res.sessionToken);
    return res.user;
  },

  async getMe() {
    const res = await request<{ user: CurrentUser; csrfToken: string }>('/api/auth/me');
    setAuthTokens(res.csrfToken);
    return res.user;
  },

  async logout() {
    try {
      await request<{ success: boolean }>('/api/auth/logout', { method: 'POST' });
    } finally {
      clearAuthTokens();
    }
  },

  async logoutAllDevices() {
    try {
      await request<{ success: boolean }>('/api/auth/logout-all', { method: 'POST' });
    } finally {
      clearAuthTokens();
    }
  },

  // Account & Settings
  async getSessions() {
    const res = await request<{ sessions: ActiveSessionItem[] }>('/api/account/sessions');
    return res.sessions;
  },

  async updateProfile(payload: {
    username?: string;
    bio?: string;
    avatarColor?: string;
    avatarUrl?: string | null;
  }) {
    const res = await request<{ user: CurrentUser }>('/api/account/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return res.user;
  },

  async changePassword(currentPassword: string, newPassword: string, confirmNewPassword: string) {
    const res = await request<{ success: boolean; message: string }>(
      '/api/account/change-password',
      {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword, confirmNewPassword }),
      }
    );
    clearAuthTokens();
    return res;
  },

  async deleteAccount(currentPassword: string) {
    const res = await request<{ success: boolean; message: string }>('/api/account/delete', {
      method: 'POST',
      body: JSON.stringify({ currentPassword }),
    });
    clearAuthTokens();
    return res;
  },

  // Username Search & Profiles
  async searchUsers(query: string) {
    const res = await request<{ users: UserSearchResult[] }>(
      `/api/users/search?q=${encodeURIComponent(query)}`
    );
    return res.users;
  },

  async getUserProfile(username: string) {
    const res = await request<{ profile: PeerProfile }>(
      `/api/users/profile/${encodeURIComponent(username)}`
    );
    return res.profile;
  },

  // Conversations & Message Requests
  async getConversations() {
    const res = await request<{ conversations: ConversationSummary[] }>('/api/conversations');
    return res.conversations;
  },

  async startConversation(username: string, initialMessage?: string) {
    const res = await request<{ conversation: ConversationSummary }>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ username, initialMessage }),
    });
    return res.conversation;
  },

  async acceptConversation(conversationId: string) {
    return request<{ success: boolean; status: 'active' }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/accept`,
      { method: 'POST' }
    );
  },

  async declineConversation(conversationId: string) {
    return request<{ success: boolean; status: 'declined' }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/decline`,
      { method: 'POST' }
    );
  },

  // Messages
  async getMessages(
    conversationId: string,
    options?: { before?: string; limit?: number; search?: string }
  ) {
    const params = new URLSearchParams();
    if (options?.before) params.set('before', options.before);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.search) params.set('search', options.search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<{ messages: ChatMessage[]; hasMore: boolean }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages${qs}`
    );
  },

  async sendMessage(
    conversationId: string,
    body: string,
    replyToId?: string | null,
    attachment?: {
      fileName: string;
      mimeType: string;
      dataBase64: string;
    } | null
  ) {
    return request<{ message: ChatMessage; conversationStatus: 'pending' | 'active' }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          body,
          replyToId: replyToId || undefined,
          attachment: attachment || undefined,
        }),
      }
    );
  },

  getAttachmentUrl(attachmentId: string): string {
    const token = getTabSessionToken();
    return `/api/storage/chats/${encodeURIComponent(attachmentId)}${
      token ? `?token=${encodeURIComponent(token)}` : ''
    }`;
  },

  async editMessage(messageId: string, body: string) {
    return request<{
      message: {
        id: string;
        conversationId: string;
        body: string;
        isDeleted: boolean;
        editedAt: string;
      };
    }>(`/api/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    });
  },

  async deleteMessage(messageId: string) {
    return request<{ success: boolean; id: string }>(
      `/api/messages/${encodeURIComponent(messageId)}`,
      { method: 'DELETE' }
    );
  },

  async markConversationRead(conversationId: string) {
    return request<{ success: boolean }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/read`,
      { method: 'POST' }
    );
  },

  // Blocking
  async getBlockedUsers() {
    const res = await request<{ blockedUsers: BlockedUserItem[] }>('/api/blocks');
    return res.blockedUsers;
  },

  async blockUser(username: string) {
    return request<{ success: boolean; blockedUsername: string }>('/api/blocks', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
  },

  async unblockUser(username: string) {
    return request<{ success: boolean; unblockedUsername: string }>(
      `/api/blocks/${encodeURIComponent(username)}`,
      { method: 'DELETE' }
    );
  },

  // Reporting
  async submitReport(payload: { username: string; messageId?: string; reason: string }) {
    return request<{ success: boolean; message: string }>('/api/reports', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Notifications
  async getNotifications() {
    const res = await request<{ notifications: NotificationItem[] }>('/api/notifications');
    return res.notifications;
  },

  async markNotificationRead(notificationId: string) {
    return request<{ success: boolean }>(
      `/api/notifications/${encodeURIComponent(notificationId)}/read`,
      { method: 'POST' }
    );
  },

  async markAllNotificationsRead() {
    return request<{ success: boolean }>('/api/notifications/read-all', {
      method: 'POST',
    });
  },
};
