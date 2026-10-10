import React, { useState, useEffect, useRef } from 'react';
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
  Camera,
  Upload,
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
  '#0284C7', // Ocean Blue
  '#059669', // Emerald Green
  '#0D9488', // Deep Teal
  '#2563EB', // Royal Sapphire Blue
  '#10B981', // Vibrant Mint Emerald
  '#0891B2', // Cyan Lagoon
  '#4F46E5', // Indigo Blue
  '#047857', // Forest Emerald
];

function cropAndCompressAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file.'));
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable.'));
          return;
        }
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        resolve(dataUrl);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

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
  const [avatarColor, setAvatarColor] = useState(currentUser.avatarColor || '#0284C7');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(currentUser.avatarUrl || null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const pfpInputRef = useRef<HTMLInputElement | null>(null);

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
      setAvatarColor(currentUser.avatarColor || '#0284C7');
      setAvatarUrl(currentUser.avatarUrl || null);
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

  const handlePfpFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setProfileMessage({ type: 'error', text: 'Please select an image file (JPG, PNG, WebP).' });
      return;
    }

    setProfileMessage(null);
    setProfileSaving(true);
    try {
      const compressedDataUrl = await cropAndCompressAvatar(file);
      setAvatarUrl(compressedDataUrl);
      const updated = await api.updateProfile({
        username: username.trim(),
        bio: bio.trim(),
        avatarColor,
        avatarUrl: compressedDataUrl,
      });
      onUserUpdated(updated);
      setProfileMessage({ type: 'success', text: 'Profile picture uploaded & saved!' });
    } catch (err: any) {
      setProfileMessage({
        type: 'error',
        text: err.message || 'Failed to upload profile picture.',
      });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleRemovePfp = async () => {
    setProfileMessage(null);
    setProfileSaving(true);
    try {
      setAvatarUrl(null);
      const updated = await api.updateProfile({
        username: username.trim(),
        bio: bio.trim(),
        avatarColor,
        avatarUrl: null,
      });
      onUserUpdated(updated);
      setProfileMessage({ type: 'success', text: 'Profile picture removed.' });
    } catch (err: any) {
      setProfileMessage({
        type: 'error',
        text: err.message || 'Failed to remove profile picture.',
      });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMessage(null);
    setProfileSaving(true);
    try {
      const updated = await api.updateProfile({
        username: username.trim(),
        bio: bio.trim(),
        avatarColor,
        avatarUrl,
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
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-3xl max-h-[92dvh] sm:max-h-[88vh] flex flex-col md:flex-row rounded-t-3xl sm:rounded-2xl border-t sm:border overflow-hidden pb-safe ${
          isDark
            ? 'bg-[#071829] border-teal-900/70 text-white'
            : 'bg-white border-teal-200 text-slate-900'
        }`}
      >
        {/* Sidebar / Mobile Top Tabs */}
        <div
          className={`w-full md:w-56 border-b md:border-b-0 md:border-r p-3.5 sm:p-4 flex flex-col justify-between shrink-0 ${
            isDark ? 'bg-[#040E1C] border-teal-900/60' : 'bg-teal-50/50 border-teal-200'
          }`}
        >
          <div>
            {/* Mobile Drag Handle */}
            <div className="sm:hidden -mt-1 pb-2 flex justify-center">
              <div
                className={`w-10 h-1.5 rounded-full ${
                  isDark ? 'bg-teal-800/80' : 'bg-teal-200'
                }`}
              />
            </div>

            <div className="flex items-center justify-between mb-3 md:mb-4 px-1">
              <h2 className="text-sm font-bold tracking-tight">Settings</h2>
              <button
                type="button"
                onClick={onClose}
                className="md:hidden min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-teal-900/40 -mr-1"
                aria-label="Close settings"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="grid grid-cols-4 md:flex md:flex-col gap-1">
              <button
                type="button"
                onClick={() => setActiveTab('account')}
                className={`flex flex-col md:flex-row items-center justify-center md:justify-start gap-1 md:gap-2.5 px-2 md:px-3 py-2 min-h-[44px] text-[11px] md:text-xs font-semibold rounded-xl transition-all whitespace-nowrap ${
                  activeTab === 'account'
                    ? 'bg-gradient-to-r from-blue-600 to-emerald-500 text-white shadow-xs'
                    : isDark
                    ? 'text-cyan-100/80 hover:bg-teal-950/60 hover:text-white'
                    : 'text-slate-700 hover:bg-teal-100/60 hover:text-slate-900'
                }`}
              >
                <User className="w-4 h-4 shrink-0" />
                <span className="md:hidden">Account</span>
                <span className="hidden md:inline">Account & Profile</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('privacy')}
                className={`flex flex-col md:flex-row items-center justify-center md:justify-start gap-1 md:gap-2.5 px-2 md:px-3 py-2 min-h-[44px] text-[11px] md:text-xs font-semibold rounded-xl transition-all whitespace-nowrap ${
                  activeTab === 'privacy'
                    ? 'bg-gradient-to-r from-blue-600 to-emerald-500 text-white shadow-xs'
                    : isDark
                    ? 'text-cyan-100/80 hover:bg-teal-950/60 hover:text-white'
                    : 'text-slate-700 hover:bg-teal-100/60 hover:text-slate-900'
                }`}
              >
                <ShieldBan className="w-4 h-4 shrink-0" />
                <span className="md:hidden">Blocked</span>
                <span className="hidden md:inline">Blocked Users</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('appearance')}
                className={`flex flex-col md:flex-row items-center justify-center md:justify-start gap-1 md:gap-2.5 px-2 md:px-3 py-2 min-h-[44px] text-[11px] md:text-xs font-semibold rounded-xl transition-all whitespace-nowrap ${
                  activeTab === 'appearance'
                    ? 'bg-gradient-to-r from-blue-600 to-emerald-500 text-white shadow-xs'
                    : isDark
                    ? 'text-cyan-100/80 hover:bg-teal-950/60 hover:text-white'
                    : 'text-slate-700 hover:bg-teal-100/60 hover:text-slate-900'
                }`}
              >
                <Palette className="w-4 h-4 shrink-0" />
                <span className="md:hidden">Theme</span>
                <span className="hidden md:inline">Appearance</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('sessions')}
                className={`flex flex-col md:flex-row items-center justify-center md:justify-start gap-1 md:gap-2.5 px-2 md:px-3 py-2 min-h-[44px] text-[11px] md:text-xs font-semibold rounded-xl transition-all whitespace-nowrap ${
                  activeTab === 'sessions'
                    ? 'bg-gradient-to-r from-blue-600 to-emerald-500 text-white shadow-xs'
                    : isDark
                    ? 'text-cyan-100/80 hover:bg-teal-950/60 hover:text-white'
                    : 'text-slate-700 hover:bg-teal-100/60 hover:text-slate-900'
                }`}
              >
                <Laptop className="w-4 h-4 shrink-0" />
                <span className="md:hidden">Sessions</span>
                <span className="hidden md:inline">Session & Security</span>
              </button>
            </nav>
          </div>

          <div
            className={`hidden md:block pt-4 border-t text-[11px] leading-relaxed ${
              isDark ? 'border-teal-900/60 text-cyan-200/60' : 'border-teal-200 text-slate-600'
            }`}
          >
            Your account is automatically deleted after 9 months without signing in.
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 sm:p-6 space-y-6 sm:space-y-8">
          <div
            className={`flex items-center justify-between border-b pb-3.5 sm:pb-4 ${
              isDark ? 'border-teal-900/60' : 'border-teal-200'
            }`}
          >
            <div>
              <h3 className="text-base font-bold">
                {activeTab === 'account' && 'Account & Profile'}
                {activeTab === 'privacy' && 'Privacy & Blocked Users'}
                {activeTab === 'appearance' && 'Appearance & Theme'}
                {activeTab === 'sessions' && 'Active Sessions & Sign Out'}
              </h3>
              <p className={`text-xs mt-0.5 ${isDark ? 'text-cyan-100/75' : 'text-slate-600'}`}>
                Signed in as @{currentUser.username}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className={`hidden md:flex min-w-[40px] min-h-[40px] items-center justify-center rounded-xl transition-colors ${
                isDark ? 'hover:bg-teal-950 text-cyan-200' : 'hover:bg-teal-50 text-slate-600'
              }`}
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {activeTab === 'account' && (
            <div className="space-y-6 sm:space-y-8">
              <form onSubmit={handleSaveProfile} className="space-y-5">
                {/* Profile Picture Upload & Avatar Color Section */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="relative group shrink-0 self-start">
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt={username}
                        className="w-20 h-20 rounded-full object-cover border-2 border-emerald-400 shadow-sm"
                      />
                    ) : (
                      <div
                        className="w-20 h-20 rounded-full flex items-center justify-center text-white font-bold text-xl select-none border-2 border-teal-500/40"
                        style={{ backgroundColor: avatarColor }}
                      >
                        {username.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => pfpInputRef.current?.click()}
                      className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-gradient-to-r from-blue-600 to-emerald-500 text-white flex items-center justify-center shadow-md cursor-pointer hover:scale-105 transition-transform"
                      title="Upload Profile Picture"
                      aria-label="Upload Profile Picture"
                    >
                      <Camera className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-3 flex-1">
                    <div>
                      <span className="text-xs font-semibold block mb-1.5">
                        Profile Picture (PFP)
                      </span>
                      <input
                        ref={pfpInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handlePfpFileChange}
                        className="hidden"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => pfpInputRef.current?.click()}
                          disabled={profileSaving}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] text-xs font-semibold text-white bg-gradient-to-r from-blue-600 via-cyan-600 to-emerald-500 hover:from-blue-500 hover:to-emerald-400 rounded-xl transition-all cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>{avatarUrl ? 'Change Photo' : 'Upload Photo'}</span>
                        </button>
                        {avatarUrl && (
                          <button
                            type="button"
                            onClick={handleRemovePfp}
                            disabled={profileSaving}
                            className={`px-3 py-2 min-h-[38px] text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                              isDark
                                ? 'border-red-500/40 text-red-300 hover:bg-red-500/10'
                                : 'border-red-300 text-red-600 hover:bg-red-50'
                            }`}
                          >
                            Remove Photo
                          </button>
                        )}
                      </div>
                    </div>

                    <div>
                      <span className="text-xs font-semibold block mb-1.5">
                        Fallback Avatar Color
                      </span>
                      <div className="flex items-center gap-2 flex-wrap">
                        {AVATAR_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setAvatarColor(color)}
                            className={`w-7 h-7 rounded-full flex items-center justify-center transition-transform cursor-pointer ${
                              avatarColor === color
                                ? 'scale-110 ring-2 ring-offset-2 ring-emerald-400'
                                : ''
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
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                  <div>
                    <label className="block text-xs font-semibold mb-1.5">Username</label>
                    <input
                      type="text"
                      autoCapitalize="none"
                      autoCorrect="off"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      maxLength={30}
                      className={`w-full px-3.5 py-2.5 min-h-[46px] text-base sm:text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                        isDark
                          ? 'bg-[#040D1A] border-teal-800/80 text-white'
                          : 'bg-teal-50/30 border-teal-300 text-slate-900'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5">Account Created</label>
                    <div
                      className={`px-3.5 py-2.5 min-h-[46px] flex items-center text-sm rounded-xl border tabular-nums ${
                        isDark
                          ? 'bg-[#040D1A]/60 border-teal-900/60 text-cyan-100/80'
                          : 'bg-teal-50/50 border-teal-200 text-slate-700'
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
                  <label className="block text-xs font-semibold mb-1.5">Bio (optional)</label>
                  <input
                    type="text"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    maxLength={160}
                    placeholder="A short note visible on your profile"
                    className={`w-full px-3.5 py-2.5 min-h-[46px] text-base sm:text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                      isDark
                        ? 'bg-[#040D1A] border-teal-800/80 text-white'
                        : 'bg-teal-50/30 border-teal-300 text-slate-900'
                    }`}
                  />
                </div>

                {profileMessage && (
                  <p
                    className={`text-xs font-medium ${
                      profileMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {profileMessage.text}
                  </p>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                  <span
                    className={`text-[11px] tabular-nums ${
                      isDark ? 'text-cyan-200/60' : 'text-slate-500'
                    }`}
                  >
                    Last sign-in:{' '}
                    {new Date(currentUser.lastLoginAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                  <button
                    type="submit"
                    disabled={profileSaving}
                    className="w-full sm:w-auto px-5 py-2.5 min-h-[44px] text-xs font-semibold text-white bg-gradient-to-r from-blue-600 via-cyan-600 to-emerald-500 hover:from-blue-500 hover:via-cyan-500 hover:to-emerald-400 disabled:opacity-50 rounded-xl transition-all whitespace-nowrap cursor-pointer"
                  >
                    {profileSaving ? 'Saving...' : 'Save Profile'}
                  </button>
                </div>
              </form>

              {/* Subtle 9-Month Inactivity Notice (Requirement 29) */}
              <div
                className={`p-3.5 rounded-xl border text-xs ${
                  isDark
                    ? 'bg-[#040D1A]/70 border-teal-900/60 text-cyan-100/80'
                    : 'bg-teal-50/60 border-teal-200 text-slate-800'
                }`}
              >
                Your account is automatically deleted after 9 months without signing in.
              </div>

              {/* Change Password Section (Requirement 16 & 17) */}
              <div
                className={`pt-6 border-t space-y-4 ${
                  isDark ? 'border-teal-900/60' : 'border-teal-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-emerald-400" />
                  <h4 className="text-sm font-bold">Change Password</h4>
                </div>
                <p className={`text-xs ${isDark ? 'text-cyan-100/75' : 'text-slate-600'}`}>
                  Because there is no password recovery, you must verify your current password first.
                  Changing your password revokes all existing sessions and requires you to sign in again.
                </p>

                {passwordError && (
                  <div className="p-3 rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 text-xs">
                    {passwordError}
                  </div>
                )}

                <form onSubmit={handleChangePassword} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1.5">Current Password</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required
                      className={`w-full px-3.5 py-2.5 min-h-[46px] text-base sm:text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                        isDark
                          ? 'bg-[#040D1A] border-teal-800/80 text-white'
                          : 'bg-teal-50/30 border-teal-300 text-slate-900'
                      }`}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold mb-1.5">New Password</label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Min 8 characters"
                        required
                        className={`w-full px-3.5 py-2.5 min-h-[46px] text-base sm:text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                          isDark
                            ? 'bg-[#040D1A] border-teal-800/80 text-white'
                            : 'bg-teal-50/30 border-teal-300 text-slate-900'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1.5">Confirm New Password</label>
                      <input
                        type="password"
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        placeholder="Re-enter new password"
                        required
                        className={`w-full px-3.5 py-2.5 min-h-[46px] text-base sm:text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                          isDark
                            ? 'bg-[#040D1A] border-teal-800/80 text-white'
                            : 'bg-teal-50/30 border-teal-300 text-slate-900'
                        }`}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={passwordLoading}
                      className="w-full sm:w-auto px-5 py-2.5 min-h-[44px] text-xs font-semibold rounded-xl bg-gradient-to-r from-blue-600 via-cyan-600 to-emerald-500 hover:from-blue-500 hover:via-cyan-500 hover:to-emerald-400 text-white transition-all whitespace-nowrap"
                    >
                      {passwordLoading ? 'Updating Password...' : 'Update Password'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Permanent Account Deletion Section (Requirement 18) */}
              <div
                className={`pt-6 border-t space-y-4 ${
                  isDark ? 'border-teal-900/60' : 'border-teal-200'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-red-400 flex items-center gap-2">
                      <Trash2 className="w-4 h-4" />
                      <span>Delete Account</span>
                    </h4>
                    <p className={`text-xs mt-1 ${isDark ? 'text-cyan-100/75' : 'text-slate-600'}`}>
                      Permanently delete your account, conversations, messages, and sessions.
                    </p>
                  </div>
                  {!showDeleteConfirm && (
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="w-full sm:w-auto px-4 py-2.5 min-h-[44px] text-xs font-semibold text-red-400 border border-red-500/40 hover:bg-red-500/10 rounded-xl transition-colors whitespace-nowrap"
                    >
                      Delete Account...
                    </button>
                  )}
                </div>

                {showDeleteConfirm && (
                  <form
                    onSubmit={handleDeleteAccount}
                    className={`p-4 rounded-2xl border space-y-4 ${
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
                        <p className={`text-xs leading-relaxed ${isDark ? 'text-cyan-50' : 'text-slate-900'}`}>
                          Your account, conversations, messages and associated data may be
                          permanently deleted. This cannot be undone.
                        </p>
                      </div>
                    </div>

                    {deleteError && (
                      <p className="text-xs font-semibold text-red-400">{deleteError}</p>
                    )}

                    <div>
                      <label className="block text-xs font-semibold mb-1.5">
                        Enter your current password to confirm
                      </label>
                      <input
                        type="password"
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                        placeholder="Current password"
                        required
                        className={`w-full px-3.5 py-2.5 min-h-[46px] text-base sm:text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-red-500/50 ${
                          isDark
                            ? 'bg-[#040D1A] border-teal-800 text-white'
                            : 'bg-white border-red-300 text-slate-900'
                        }`}
                      />
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowDeleteConfirm(false);
                          setDeletePassword('');
                          setDeleteError(null);
                        }}
                        className={`px-4 py-2.5 min-h-[44px] text-xs font-semibold rounded-xl border ${
                          isDark
                            ? 'border-teal-800 text-cyan-100 hover:bg-teal-950'
                            : 'border-teal-300 text-slate-700 hover:bg-white'
                        }`}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={deleteLoading}
                        className="px-4 py-2.5 min-h-[44px] text-xs font-semibold bg-red-600 hover:bg-red-500 text-white rounded-xl transition-colors whitespace-nowrap"
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
              <form onSubmit={handleBlockByUsername} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={blockInputUsername}
                  onChange={(e) => setBlockInputUsername(e.target.value)}
                  placeholder="Enter @username to block..."
                  className={`flex-1 px-3.5 py-2.5 min-h-[46px] text-base sm:text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                    isDark
                      ? 'bg-[#040D1A] border-teal-800/80 text-white'
                      : 'bg-teal-50/30 border-teal-300 text-slate-900'
                  }`}
                />
                <button
                  type="submit"
                  className="px-5 py-2.5 min-h-[46px] text-xs font-semibold bg-gradient-to-r from-blue-600 via-cyan-600 to-emerald-500 hover:from-blue-500 hover:via-cyan-500 hover:to-emerald-400 text-white rounded-xl transition-all whitespace-nowrap"
                >
                  Block User
                </button>
              </form>

              {blockActionMessage && (
                <p className="text-xs text-emerald-400">{blockActionMessage}</p>
              )}

              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-emerald-400">
                  Blocked Users ({blockedUsers.length})
                </h4>
                {blocksLoading ? (
                  <p className="text-xs text-cyan-200/60 py-4">Loading blocked users...</p>
                ) : blockedUsers.length === 0 ? (
                  <div
                    className={`p-6 text-center rounded-2xl border text-xs ${
                      isDark
                        ? 'bg-[#040D1A]/60 border-teal-900/60 text-cyan-100/75'
                        : 'bg-teal-50/50 border-teal-200 text-slate-700'
                    }`}
                  >
                    You have not blocked any users. Blocked users cannot send you messages or start conversations.
                  </div>
                ) : (
                  <div className="divide-y divide-teal-900/40 border border-teal-900/50 rounded-2xl overflow-hidden">
                    {blockedUsers.map((b) => (
                      <div
                        key={b.username}
                        className="flex items-center justify-between px-4 py-3.5 gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {b.avatarUrl ? (
                            <img
                              src={b.avatarUrl}
                              alt={b.username}
                              className="w-9 h-9 rounded-full object-cover shrink-0"
                            />
                          ) : (
                            <div
                              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                              style={{ backgroundColor: b.avatarColor }}
                            >
                              {b.username.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">@{b.username}</div>
                            <div className="text-[11px] text-cyan-200/60 tabular-nums">
                              Blocked {new Date(b.blockedAt).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleUnblock(b.username)}
                          className={`px-3.5 py-2 min-h-[40px] text-xs font-semibold rounded-xl border transition-colors whitespace-nowrap shrink-0 ${
                            isDark
                              ? 'border-teal-800 hover:bg-teal-950 text-white'
                              : 'border-teal-300 hover:bg-teal-50 text-slate-900'
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
              <p className={`text-xs ${isDark ? 'text-cyan-100/75' : 'text-slate-600'}`}>
                Choose how VaultChat looks on your device. Theme preference is the only setting stored locally in your browser.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => onThemeChange('light')}
                  className={`flex items-center gap-3 p-4 min-h-[64px] rounded-2xl border text-left transition-colors ${
                    theme === 'light'
                      ? 'border-emerald-500 bg-emerald-500/15'
                      : isDark
                      ? 'border-teal-900/60 bg-[#040D1A]/60 hover:border-teal-700'
                      : 'border-teal-200 bg-teal-50/40 hover:border-teal-300'
                  }`}
                >
                  <Sun className="w-5 h-5 text-emerald-500 shrink-0" />
                  <div>
                    <div className="text-sm font-semibold">White & Ocean</div>
                    <div className="text-[11px] text-emerald-400">Crisp white, blue & emerald</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onThemeChange('dark')}
                  className={`flex items-center gap-3 p-4 min-h-[64px] rounded-2xl border text-left transition-colors ${
                    theme === 'dark'
                      ? 'border-emerald-500 bg-emerald-500/15'
                      : isDark
                      ? 'border-teal-900/60 bg-[#040D1A]/60 hover:border-teal-700'
                      : 'border-teal-200 bg-teal-50/40 hover:border-teal-300'
                  }`}
                >
                  <Moon className="w-5 h-5 text-cyan-400 shrink-0" />
                  <div>
                    <div className="text-sm font-semibold">Dark Blue & Emerald</div>
                    <div className="text-[11px] text-emerald-400">Deep ocean & teal gradient</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onThemeChange('system')}
                  className={`flex items-center gap-3 p-4 min-h-[64px] rounded-2xl border text-left transition-colors ${
                    theme === 'system'
                      ? 'border-emerald-500 bg-emerald-500/15'
                      : isDark
                      ? 'border-teal-900/60 bg-[#040D1A]/60 hover:border-teal-700'
                      : 'border-teal-200 bg-teal-50/40 hover:border-teal-300'
                  }`}
                >
                  <Monitor className="w-5 h-5 text-blue-400 shrink-0" />
                  <div>
                    <div className="text-sm font-semibold">System</div>
                    <div className="text-[11px] text-emerald-400">Match OS setting</div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'sessions' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold">Session Controls</h4>
                  <p className={`text-xs mt-0.5 ${isDark ? 'text-cyan-100/75' : 'text-slate-600'}`}>
                    Sign out of this browser or revoke all active sessions across every device.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <button
                    type="button"
                    onClick={handleLogoutCurrent}
                    className={`inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] text-xs font-semibold rounded-xl border transition-colors whitespace-nowrap ${
                      isDark
                        ? 'border-teal-800 hover:bg-teal-950 text-white'
                        : 'border-teal-300 hover:bg-teal-50 text-slate-900'
                    }`}
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Log Out</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleLogoutAll}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] text-xs font-semibold bg-gradient-to-r from-blue-600 via-cyan-600 to-emerald-500 hover:from-blue-500 hover:via-cyan-500 hover:to-emerald-400 text-white rounded-xl transition-all whitespace-nowrap"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Log Out of All Devices</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <h5 className="text-xs font-semibold text-emerald-400">
                  Active Server-Side Sessions ({sessions.length})
                </h5>
                {sessionsLoading ? (
                  <p className="text-xs text-cyan-200/60 py-4">Loading active sessions...</p>
                ) : (
                  <div className="divide-y divide-teal-900/40 border border-teal-900/50 rounded-2xl overflow-hidden">
                    {sessions.map((s) => (
                      <div key={s.id} className="px-4 py-3.5 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate">
                            {s.userAgent}
                            {s.isCurrent ? ' · Current Session' : ''}
                          </div>
                          <div className="text-[11px] text-cyan-200/60 tabular-nums mt-0.5">
                            Created {new Date(s.createdAt).toLocaleString()} · Last active{' '}
                            {new Date(s.lastUsedAt).toLocaleString()}
                          </div>
                        </div>
                        {s.isCurrent && (
                          <span className="text-xs font-medium text-emerald-400 shrink-0">
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
