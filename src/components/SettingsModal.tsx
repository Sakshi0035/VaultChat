import React, { useState, useEffect } from 'react';
import {
  X,
  User,
  Lock,
  ShieldBan,
  Palette,
  Monitor,
  Sun,
  Moon,
  LogOut,
  Trash2,
  AlertTriangle,
  Check,
  Laptop,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import {
  CurrentUser,
  BlockedUserItem,
  ActiveSessionItem,
  ThemeMode,
} from '../types.ts';

interface SettingsModalProps {
  isOpen: boolean;
  initialTab?: 'account' | 'privacy' | 'appearance' | 'sessions';
  onClose: () => void;
  currentUser: CurrentUser;
  onUserUpdated: (user: CurrentUser) => void;
  onLoggedOut: (message?: string) => void;
  onBlocksChanged: () => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  isDark: boolean;
}

const AVATAR_COLORS = [
  '#E11D48', // Rich Rose-Red
  '#BE123C', // Deep Crimson
  '#DB2777', // Rich Pink
  '#9F1239', // Ruby Red
  '#EC4899', // Vibrant Rose Pink
  '#881337', // Dark Burgundy Rose
  '#F43F5E', // Coral Crimson
  '#A21CAF', // Deep Magenta Berry
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  initialTab = 'account',
  onClose,
  currentUser,
  onUserUpdated,
  onLoggedOut,
  onBlocksChanged,
  theme,
  onThemeChange,
  isDark,
}) => {
  const [activeTab, setActiveTab] = useState<'account' | 'privacy' | 'appearance' | 'sessions'>(
    initialTab
  );

  const [username, setUsername] = useState(currentUser.username);
  const [bio, setBio] = useState(currentUser.bio || '');
  const [avatarColor, setAvatarColor] = useState(currentUser.avatarColor || '#E11D48');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [blockedUsers, setBlockedUsers] = useState<BlockedUserItem[]>([]);
  const [blocksLoading, setBlocksLoading] = useState(false);
  const [blockInputUsername, setBlockInputUsername] = useState('');
  const [blockActionMessage, setBlockActionMessage] = useState<string | null>(null);

  const [sessions, setSessions] = useState<ActiveSessionItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setUsername(currentUser.username);
      setBio(currentUser.bio || '');
      setAvatarColor(currentUser.avatarColor || '#E11D48');
      setProfileMessage(null);
      setPasswordError(null);
      setDeleteError(null);
      setShowDeleteConfirm(false);
      setDeletePassword('');
    }
  }, [isOpen, initialTab, currentUser]);

  useEffect(() => {
    if (!isOpen) return;
    if (activeTab === 'privacy') {
      setBlocksLoading(true);
      api
        .getBlockedUsers()
        .then(setBlockedUsers)
        .catch(() => {})
        .finally(() => setBlocksLoading(false));
    } else if (activeTab === 'sessions') {
      setSessionsLoading(true);
      api
        .getSessions()
        .then(setSessions)
        .catch(() => {})
        .finally(() => setSessionsLoading(false));
    }
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMessage(null);
    setProfileSaving(true);
    try {
      const updated = await api.updateProfile({
        username: username.trim(),
        bio: bio.trim(),
        avatarColor,
      });
      onUserUpdated(updated);
      setProfileMessage({ type: 'success', text: 'Profile updated.' });
    } catch (err: any) {
      setProfileMessage({ type: 'error', text: err.message || 'Failed to update profile.' });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);

    if (!currentPassword) {
      setPasswordError('Please enter your current password.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    setPasswordLoading(true);
    try {
      const res = await api.changePassword(currentPassword, newPassword, confirmNewPassword);
      onClose();
      onLoggedOut(res.message || 'Password updated. Please sign in with your new password.');
    } catch (err: any) {
      setPasswordError(err.message || 'Failed to change password.');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleteError(null);

    if (!deletePassword) {
      setDeleteError('Please enter your current password to confirm permanent account deletion.');
      return;
    }

    setDeleteLoading(true);
    try {
      const res = await api.deleteAccount(deletePassword);
      onClose();
      onLoggedOut(res.message || 'Your account has been permanently deleted.');
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete account.');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleBlockByUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setBlockActionMessage(null);
    const clean = blockInputUsername.trim().replace(/^@/, '');
    if (!clean) return;
    try {
      await api.blockUser(clean);
      setBlockInputUsername('');
      const updated = await api.getBlockedUsers();
      setBlockedUsers(updated);
      onBlocksChanged();
      setBlockActionMessage(`@${clean} has been blocked.`);
    } catch (err: any) {
      setBlockActionMessage(err.message || 'Failed to block user.');
    }
  };

  const handleUnblock = async (targetUsername: string) => {
    try {
      await api.unblockUser(targetUsername);
      setBlockedUsers((prev) => prev.filter((u) => u.username !== targetUsername));
      onBlocksChanged();
    } catch (err: any) {
      setBlockActionMessage(err.message || 'Failed to unblock user.');
    }
  };

  const handleLogoutCurrent = async () => {
    await api.logout();
    onClose();
    onLoggedOut('You have signed out.');
  };

  const handleLogoutAll = async () => {
    await api.logoutAllDevices();
    onClose();
    onLoggedOut('Signed out from all devices.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
      <div
        className={`w-full max-w-3xl max-h-[90vh] flex flex-col md:flex-row rounded-xl border overflow-hidden ${
          isDark
            ? 'bg-[#220712] border-rose-900/70 text-white'
            : 'bg-white border-rose-200 text-rose-950'
        }`}
      >
        {/* Sidebar Tabs */}
        <div
          className={`w-full md:w-56 border-b md:border-b-0 md:border-r p-4 flex flex-col justify-between shrink-0 ${
            isDark ? 'bg-[#17040B] border-rose-900/60' : 'bg-rose-50/60 border-rose-200'
          }`}
        >
          <div>
            <div className="flex items-center justify-between mb-4 px-2">
              <h2 className="text-sm font-bold tracking-tight">Settings</h2>
              <button
                type="button"
                onClick={onClose}
                className="md:hidden p-1 rounded-lg hover:bg-rose-900/40"
                aria-label="Close settings"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <nav className="flex md:flex-col gap-1 overflow-x-auto">
              <button
                type="button"
                onClick={() => setActiveTab('account')}
                className={`flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  activeTab === 'account'
                    ? 'bg-rose-600 text-white'
                    : isDark
                    ? 'text-rose-200/80 hover:bg-rose-950 hover:text-white'
                    : 'text-rose-800 hover:bg-rose-100 hover:text-rose-950'
                }`}
              >
                <User className="w-4 h-4 shrink-0" />
                <span>Account & Profile</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('privacy')}
                className={`flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  activeTab === 'privacy'
                    ? 'bg-rose-600 text-white'
                    : isDark
                    ? 'text-rose-200/80 hover:bg-rose-950 hover:text-white'
                    : 'text-rose-800 hover:bg-rose-100 hover:text-rose-950'
                }`}
              >
                <ShieldBan className="w-4 h-4 shrink-0" />
                <span>Blocked Users</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('appearance')}
                className={`flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  activeTab === 'appearance'
                    ? 'bg-rose-600 text-white'
                    : isDark
                    ? 'text-rose-200/80 hover:bg-rose-950 hover:text-white'
                    : 'text-rose-800 hover:bg-rose-100 hover:text-rose-950'
                }`}
              >
                <Palette className="w-4 h-4 shrink-0" />
                <span>Appearance</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('sessions')}
                className={`flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  activeTab === 'sessions'
                    ? 'bg-rose-600 text-white'
                    : isDark
                    ? 'text-rose-200/80 hover:bg-rose-950 hover:text-white'
                    : 'text-rose-800 hover:bg-rose-100 hover:text-rose-950'
                }`}
              >
                <Laptop className="w-4 h-4 shrink-0" />
                <span>Session & Security</span>
              </button>
            </nav>
          </div>

          <div
            className={`hidden md:block pt-4 border-t text-[11px] leading-relaxed ${
              isDark ? 'border-rose-900/60 text-rose-300/60' : 'border-rose-200 text-rose-700/70'
            }`}
          >
            Your account is automatically deleted after 9 months without signing in.
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-6 space-y-8">
          <div
            className={`flex items-center justify-between border-b pb-4 ${
              isDark ? 'border-rose-900/60' : 'border-rose-200'
            }`}
          >
            <div>
              <h3 className="text-base font-bold">
                {activeTab === 'account' && 'Account & Profile'}
                {activeTab === 'privacy' && 'Privacy & Blocked Users'}
                {activeTab === 'appearance' && 'Appearance & Theme'}
                {activeTab === 'sessions' && 'Active Sessions & Sign Out'}
              </h3>
              <p className={`text-xs mt-0.5 ${isDark ? 'text-rose-200/75' : 'text-rose-800/80'}`}>
                Signed in as @{currentUser.username}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className={`hidden md:flex p-1.5 rounded-lg transition-colors ${
                isDark ? 'hover:bg-rose-950 text-rose-300' : 'hover:bg-rose-100 text-rose-700'
              }`}
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {activeTab === 'account' && (
            <div className="space-y-8">
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div className="flex items-center gap-4">
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0 select-none"
                    style={{ backgroundColor: avatarColor }}
                  >
                    {username.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold block">Avatar Color</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      {AVATAR_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setAvatarColor(color)}
                          className={`w-6 h-6 rounded-full flex items-center justify-center transition-transform ${
                            avatarColor === color ? 'scale-110 ring-2 ring-offset-2 ring-rose-500' : ''
                          }`}
                          style={{ backgroundColor: color }}
                          aria-label={`Select color ${color}`}
                        >
                          {avatarColor === color && <Check className="w-3.5 h-3.5 text-white" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Username</label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      maxLength={30}
                      className={`w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-rose-500 ${
                        isDark
                          ? 'bg-[#14040A] border-rose-800/80 text-white'
                          : 'bg-rose-50/40 border-rose-300 text-rose-950'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Account Created</label>
                    <div
                      className={`px-3 py-2 text-sm rounded-lg border tabular-nums ${
                        isDark
                          ? 'bg-[#14040A]/60 border-rose-900/60 text-rose-200/80'
                          : 'bg-rose-50 border-rose-200 text-rose-800'
                      }`}
                    >
                      {new Date(currentUser.createdAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Bio (optional)</label>
                  <input
                    type="text"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    maxLength={160}
                    placeholder="A short note visible on your profile"
                    className={`w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-rose-500 ${
                      isDark
                        ? 'bg-[#14040A] border-rose-800/80 text-white'
                        : 'bg-rose-50/40 border-rose-300 text-rose-950'
                    }`}
                  />
                </div>

                {profileMessage && (
                  <p
                    className={`text-xs font-medium ${
                      profileMessage.type === 'success' ? 'text-rose-400' : 'text-red-400'
                    }`}
                  >
                    {profileMessage.text}
                  </p>
                )}

                <div className="flex items-center justify-between pt-1">
                  <span className={`text-[11px] tabular-nums ${isDark ? 'text-rose-300/60' : 'text-rose-700/70'}`}>
                    Last sign-in:{' '}
                    {new Date(currentUser.lastLoginAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                  <button
                    type="submit"
                    disabled={profileSaving}
                    className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
                  >
                    {profileSaving ? 'Saving...' : 'Save Profile'}
                  </button>
                </div>
              </form>

              {/* Subtle 9-Month Inactivity Notice (Requirement 29) */}
              <div
                className={`p-3.5 rounded-lg border text-xs ${
                  isDark
                    ? 'bg-[#14040A]/70 border-rose-900/60 text-rose-200/80'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                Your account is automatically deleted after 9 months without signing in.
              </div>

              {/* Change Password Section (Requirement 16 & 17) */}
              <div
                className={`pt-6 border-t space-y-4 ${
                  isDark ? 'border-rose-900/60' : 'border-rose-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-rose-500" />
                  <h4 className="text-sm font-bold">Change Password</h4>
                </div>
                <p className={`text-xs ${isDark ? 'text-rose-200/75' : 'text-rose-800/80'}`}>
                  Because there is no password recovery, you must verify your current password first.
                  Changing your password revokes all existing sessions and requires you to sign in again.
                </p>

                {passwordError && (
                  <div className="p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 text-xs">
                    {passwordError}
                  </div>
                )}

                <form onSubmit={handleChangePassword} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Current Password</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required
                      className={`w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-rose-500 ${
                        isDark
                          ? 'bg-[#14040A] border-rose-800/80 text-white'
                          : 'bg-rose-50/40 border-rose-300 text-rose-950'
                      }`}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold mb-1">New Password</label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Min 8 characters"
                        required
                        className={`w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-rose-500 ${
                          isDark
                            ? 'bg-[#14040A] border-rose-800/80 text-white'
                            : 'bg-rose-50/40 border-rose-300 text-rose-950'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Confirm New Password</label>
                      <input
                        type="password"
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        placeholder="Re-enter new password"
                        required
                        className={`w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-rose-500 ${
                          isDark
                            ? 'bg-[#14040A] border-rose-800/80 text-white'
                            : 'bg-rose-50/40 border-rose-300 text-rose-950'
                        }`}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={passwordLoading}
                      className="px-4 py-2 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-colors whitespace-nowrap"
                    >
                      {passwordLoading ? 'Updating Password...' : 'Update Password'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Permanent Account Deletion Section (Requirement 18) */}
              <div
                className={`pt-6 border-t space-y-4 ${
                  isDark ? 'border-rose-900/60' : 'border-rose-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-red-400 flex items-center gap-2">
                      <Trash2 className="w-4 h-4" />
                      <span>Delete Account</span>
                    </h4>
                    <p className={`text-xs mt-1 ${isDark ? 'text-rose-200/75' : 'text-rose-800/80'}`}>
                      Permanently delete your account, conversations, messages, and sessions.
                    </p>
                  </div>
                  {!showDeleteConfirm && (
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="px-3.5 py-2 text-xs font-semibold text-red-400 border border-red-500/40 hover:bg-red-500/10 rounded-lg transition-colors whitespace-nowrap"
                    >
                      Delete Account...
                    </button>
                  )}
                </div>

                {showDeleteConfirm && (
                  <form
                    onSubmit={handleDeleteAccount}
                    className={`p-4 rounded-xl border space-y-4 ${
                      isDark
                        ? 'bg-red-950/35 border-red-800/60'
                        : 'bg-red-50 border-red-200'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <h5 className="text-xs font-bold text-red-400">
                          Delete account permanently?
                        </h5>
                        <p className={`text-xs leading-relaxed ${isDark ? 'text-rose-100' : 'text-rose-950'}`}>
                          Your account, conversations, messages and associated data may be
                          permanently deleted. This cannot be undone.
                        </p>
                      </div>
                    </div>

                    {deleteError && (
                      <p className="text-xs font-semibold text-red-400">{deleteError}</p>
                    )}

                    <div>
                      <label className="block text-xs font-semibold mb-1">
                        Enter your current password to confirm
                      </label>
                      <input
                        type="password"
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                        placeholder="Current password"
                        required
                        className={`w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-red-500/50 ${
                          isDark
                            ? 'bg-[#14040A] border-rose-800 text-white'
                            : 'bg-white border-red-300 text-rose-950'
                        }`}
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowDeleteConfirm(false);
                          setDeletePassword('');
                          setDeleteError(null);
                        }}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
                          isDark
                            ? 'border-rose-800 text-rose-200 hover:bg-rose-950'
                            : 'border-rose-300 text-rose-800 hover:bg-white'
                        }`}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={deleteLoading}
                        className="px-4 py-1.5 text-xs font-semibold bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors whitespace-nowrap"
                      >
                        {deleteLoading ? 'Deleting Permanently...' : 'Permanently Delete Account'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}

          {activeTab === 'privacy' && (
            <div className="space-y-6">
              <form onSubmit={handleBlockByUsername} className="flex gap-2">
                <input
                  type="text"
                  value={blockInputUsername}
                  onChange={(e) => setBlockInputUsername(e.target.value)}
                  placeholder="Enter @username to block..."
                  className={`flex-1 px-3.5 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-rose-500 ${
                    isDark
                      ? 'bg-[#14040A] border-rose-800/80 text-white'
                      : 'bg-rose-50/40 border-rose-300 text-rose-950'
                  }`}
                />
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors whitespace-nowrap"
                >
                  Block User
                </button>
              </form>

              {blockActionMessage && (
                <p className="text-xs text-rose-400">{blockActionMessage}</p>
              )}

              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-rose-400">
                  Blocked Users ({blockedUsers.length})
                </h4>
                {blocksLoading ? (
                  <p className="text-xs text-rose-300/60 py-4">Loading blocked users...</p>
                ) : blockedUsers.length === 0 ? (
                  <div
                    className={`p-6 text-center rounded-xl border text-xs ${
                      isDark
                        ? 'bg-[#14040A]/60 border-rose-900/60 text-rose-200/75'
                        : 'bg-rose-50/50 border-rose-200 text-rose-800'
                    }`}
                  >
                    You have not blocked any users. Blocked users cannot send you messages or start conversations.
                  </div>
                ) : (
                  <div className="divide-y divide-rose-900/40 border border-rose-900/50 rounded-xl overflow-hidden">
                    {blockedUsers.map((b) => (
                      <div
                        key={b.username}
                        className="flex items-center justify-between px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                            style={{ backgroundColor: b.avatarColor }}
                          >
                            {b.username.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-sm font-semibold">@{b.username}</div>
                            <div className="text-[11px] text-rose-300/60 tabular-nums">
                              Blocked {new Date(b.blockedAt).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleUnblock(b.username)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                            isDark
                              ? 'border-rose-800 hover:bg-rose-950 text-white'
                              : 'border-rose-300 hover:bg-rose-50 text-rose-900'
                          }`}
                        >
                          Unblock
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="space-y-6">
              <p className={`text-xs ${isDark ? 'text-rose-200/75' : 'text-rose-800/80'}`}>
                Choose how VaultChat looks on your device. Theme preference is the only setting stored locally in your browser.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => onThemeChange('light')}
                  className={`flex items-center gap-3 p-4 rounded-xl border text-left transition-colors ${
                    theme === 'light'
                      ? 'border-rose-500 bg-rose-500/15'
                      : isDark
                      ? 'border-rose-900/60 bg-[#14040A]/60 hover:border-rose-700'
                      : 'border-rose-200 bg-rose-50/40 hover:border-rose-300'
                  }`}
                >
                  <Sun className="w-5 h-5 text-rose-500 shrink-0" />
                  <div>
                    <div className="text-sm font-semibold">White & Crimson</div>
                    <div className="text-[11px] text-rose-400">Crisp white & rich red</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onThemeChange('dark')}
                  className={`flex items-center gap-3 p-4 rounded-xl border text-left transition-colors ${
                    theme === 'dark'
                      ? 'border-rose-500 bg-rose-500/15'
                      : isDark
                      ? 'border-rose-900/60 bg-[#14040A]/60 hover:border-rose-700'
                      : 'border-rose-200 bg-rose-50/40 hover:border-rose-300'
                  }`}
                >
                  <Moon className="w-5 h-5 text-pink-400 shrink-0" />
                  <div>
                    <div className="text-sm font-semibold">Dark Pinked Red</div>
                    <div className="text-[11px] text-rose-400">Deep velvet crimson & white</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onThemeChange('system')}
                  className={`flex items-center gap-3 p-4 rounded-xl border text-left transition-colors ${
                    theme === 'system'
                      ? 'border-rose-500 bg-rose-500/15'
                      : isDark
                      ? 'border-rose-900/60 bg-[#14040A]/60 hover:border-rose-700'
                      : 'border-rose-200 bg-rose-50/40 hover:border-rose-300'
                  }`}
                >
                  <Monitor className="w-5 h-5 text-rose-400 shrink-0" />
                  <div>
                    <div className="text-sm font-semibold">System</div>
                    <div className="text-[11px] text-rose-400">Match OS setting</div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'sessions' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold">Session Controls</h4>
                  <p className={`text-xs mt-0.5 ${isDark ? 'text-rose-200/75' : 'text-rose-800/80'}`}>
                    Sign out of this browser or revoke all active sessions across every device.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleLogoutCurrent}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                      isDark
                        ? 'border-rose-800 hover:bg-rose-950 text-white'
                        : 'border-rose-300 hover:bg-rose-50 text-rose-900'
                    }`}
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Log Out</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleLogoutAll}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors whitespace-nowrap"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Log Out of All Devices</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <h5 className="text-xs font-semibold text-rose-400">
                  Active Server-Side Sessions ({sessions.length})
                </h5>
                {sessionsLoading ? (
                  <p className="text-xs text-rose-300/60 py-4">Loading active sessions...</p>
                ) : (
                  <div className="divide-y divide-rose-900/40 border border-rose-900/50 rounded-xl overflow-hidden">
                    {sessions.map((s) => (
                      <div key={s.id} className="px-4 py-3 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate">
                            {s.userAgent}
                            {s.isCurrent ? ' · Current Session' : ''}
                          </div>
                          <div className="text-[11px] text-rose-300/60 tabular-nums mt-0.5">
                            Created {new Date(s.createdAt).toLocaleString()} · Last active{' '}
                            {new Date(s.lastUsedAt).toLocaleString()}
                          </div>
                        </div>
                        {s.isCurrent && (
                          <span className="text-xs font-medium text-rose-400 shrink-0">
                            Active
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
