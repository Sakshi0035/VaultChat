export type ThemeMode = 'dark' | 'light' | 'system';

export interface CurrentUser {
  username: string;
  avatarColor: string;
  bio: string;
  createdAt: string;
  lastLoginAt: string;
  lastActiveAt: string;
  activeSessionsCount?: number;
  unreadNotificationsCount?: number;
}

export interface PeerProfile {
  username: string;
  avatarColor: string;
  bio: string;
  createdAt: string;
  isOnline: boolean;
  lastActiveAt?: string | null;
  isBlockedByMe: boolean;
  hasBlockedMe: boolean;
}

export interface UserSearchResult {
  username: string;
  avatarColor: string;
  bio: string;
  createdAt: string;
  isOnline: boolean;
  isBlockedByMe: boolean;
  hasBlockedMe: boolean;
  existingConversationId: string | null;
  existingConversationStatus: 'pending' | 'active' | 'declined' | null;
}

export interface MessageReplyPreview {
  id: string;
  senderUsername: string;
  body: string;
}

export interface ChatAttachment {
  id: string;
  bucket: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderUsername: string;
  isMine: boolean;
  body: string;
  isDeleted: boolean;
  replyTo: MessageReplyPreview | null;
  attachment?: ChatAttachment | null;
  createdAt: string;
  editedAt: string | null;
  isReadByPeer: boolean;
}

export interface ConversationSummary {
  id: string;
  status: 'pending' | 'active';
  isInitiatedByMe: boolean;
  createdAt: string;
  updatedAt: string;
  unreadCount: number;
  peer: PeerProfile;
  lastMessage: {
    id: string;
    senderUsername: string;
    isMine: boolean;
    body: string;
    isDeleted: boolean;
    createdAt: string;
    editedAt: string | null;
    isReadByPeer: boolean;
  } | null;
}

export interface BlockedUserItem {
  username: string;
  avatarColor: string;
  bio: string;
  blockedAt: string;
}

export interface NotificationItem {
  id: string;
  conversationId: string | null;
  type: 'new_message' | 'message_request' | 'request_accepted' | string;
  title: string;
  body: string;
  actorUsername: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface ActiveSessionItem {
  id: string;
  userAgent: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  isCurrent: boolean;
}
