import React, { useState } from 'react';
import {
  Shield,
  Lock,
  Clock,
  ArrowRight,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle2,
  Sun,
  Moon,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import { CurrentUser, ThemeMode } from '../types.ts';

interface AuthViewsProps {
  mode: 'welcome' | 'login' | 'signup';
  setMode: (mode: 'welcome' | 'login' | 'signup') => void;
  onAuthenticated: (user: CurrentUser) => void;
  theme: ThemeMode;
  isDark: boolean;
  onToggleTheme: () => void;
  statusBanner?: string | null;
  onClearBanner?: () => void;
}

export const AuthViews: React.FC<AuthViewsProps> = ({
  mode,
  setMode,
  onAuthenticated,
  isDark,
  onToggleTheme,
  statusBanner,
  onClearBanner,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acknowledgedNoRecovery, setAcknowledgedNoRecovery] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchMode = (nextMode: 'welcome' | 'login' | 'signup') => {
    setError(null);
    if (onClearBanner) onClearBanner();
    setMode(nextMode);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError('Please enter both your username and password.');
      return;
    }

    setLoading(true);
    try {
      const user = await api.login(username.trim(), password);
      onAuthenticated(user);
    } catch (err: any) {
      setError(err.message || 'Incorrect username or password.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = username.trim();
    if (trimmed.length < 3 || trimmed.length > 30) {
      setError('Username must be between 3 and 30 characters.');
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      setError('Username may only contain letters, numbers, and underscores.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const user = await api.signup(trimmed, password, confirmPassword);
      onAuthenticated(user);
    } catch (err: any) {
      setError(err.message || 'Failed to create account.');
    } finally {
      setLoading(false);
    }
  };

  const usernameValid =
    username.trim().length >= 3 &&
    username.trim().length <= 30 &&
    /^[a-zA-Z0-9_]+$/.test(username.trim());
  const passwordValid = password.length >= 8;
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  return (
    <div
      className={`min-h-screen flex flex-col transition-colors ${
        isDark ? 'bg-[#14040A] text-white' : 'bg-white text-rose-950'
      }`}
    >
      {/* Top Bar Contract: Zone 1 Brand | Zone 2 Nav Links | Zone 3 Primary Actions */}
      <header
        className={`flex items-center justify-between px-6 py-4 border-b ${
          isDark
            ? 'border-rose-900/60 bg-[#1B060E]/95'
            : 'border-rose-200 bg-white/95'
        }`}
      >
        <button
          type="button"
          onClick={() => switchMode('welcome')}
          className={`text-lg font-bold tracking-tight text-left cursor-pointer focus:outline-none ${
            isDark ? 'text-white' : 'text-rose-950'
          }`}
        >
          VaultChat
        </button>

        <nav
          className={`hidden md:flex items-center gap-6 text-sm font-medium ${
            isDark ? 'text-rose-200/80' : 'text-rose-800'
          }`}
        >
          <button
            type="button"
            onClick={() => switchMode('welcome')}
            className={`hover:underline transition-colors whitespace-nowrap ${
              mode === 'welcome'
                ? isDark
                  ? 'text-white font-semibold'
                  : 'text-rose-950 font-semibold'
                : ''
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className={`hover:underline transition-colors whitespace-nowrap ${
              mode === 'signup'
                ? isDark
                  ? 'text-white font-semibold'
                  : 'text-rose-950 font-semibold'
                : ''
            }`}
          >
            Create Account
          </button>
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`hover:underline transition-colors whitespace-nowrap ${
              mode === 'login'
                ? isDark
                  ? 'text-white font-semibold'
                  : 'text-rose-950 font-semibold'
                : ''
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            className="hover:underline transition-colors whitespace-nowrap flex items-center gap-1.5"
            aria-label="Toggle color theme"
          >
            {isDark ? <Sun className="w-4 h-4 text-rose-300" /> : <Moon className="w-4 h-4 text-rose-700" />}
            <span>{isDark ? 'White Mode' : 'Dark Crimson'}</span>
          </button>
        </nav>

        <div className="flex items-center gap-3">
          {mode !== 'login' && (
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={`px-4 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                isDark
                  ? 'border-rose-800/80 text-white hover:bg-rose-950/60'
                  : 'border-rose-300 text-rose-900 hover:bg-rose-50'
              }`}
            >
              Sign In
            </button>
          )}
          {mode !== 'signup' && (
            <button
              type="button"
              onClick={() => switchMode('signup')}
              className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap shadow-xs"
            >
              Create Account
            </button>
          )}
        </div>
      </header>

      {statusBanner && (
        <div className="max-w-xl mx-auto mt-6 px-4 w-full">
          <div
            className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border text-sm ${
              isDark
                ? 'bg-rose-950/70 border-rose-700/60 text-white'
                : 'bg-rose-50 border-rose-300 text-rose-950'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{statusBanner}</span>
            </div>
            {onClearBanner && (
              <button
                type="button"
                onClick={onClearBanner}
                className="text-xs underline opacity-80 hover:opacity-100 whitespace-nowrap"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        {mode === 'welcome' && (
          <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-7 space-y-6">
              <div
                className={`flex items-center gap-2 text-xs font-semibold ${
                  isDark ? 'text-rose-400' : 'text-rose-700'
                }`}
              >
                <span>Zero-Email Architecture</span>
                <span aria-hidden="true">·</span>
                <span>Neon PostgreSQL Persistence</span>
                <span aria-hidden="true">·</span>
                <span>End-to-End Session Security</span>
              </div>

              <h1
                className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-tight"
                style={{ textWrap: 'balance' } as React.CSSProperties}
              >
                Chat privately with a simple username and password.
              </h1>

              <p
                className={`text-base sm:text-lg leading-relaxed max-w-xl ${
                  isDark ? 'text-rose-100/80' : 'text-rose-900/80'
                }`}
              >
                Direct one-to-one real-time messaging built around strict identity minimalism.
                Pick a unique handle, set a strong password, and start conversing immediately—without
                handing over an email address, phone number, or social profile.
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap shadow-sm"
                >
                  <span>Create Account</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className={`inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                    isDark
                      ? 'border-rose-800/80 bg-[#260814] text-white hover:bg-rose-950'
                      : 'border-rose-300 bg-white text-rose-950 hover:bg-rose-50'
                  }`}
                >
                  <span>Sign In</span>
                </button>
              </div>
            </div>

            {/* Key Security Principles Panel */}
            <div
              className={`lg:col-span-5 rounded-xl border p-6 sm:p-8 space-y-6 ${
                isDark
                  ? 'bg-[#220712] border-rose-900/70 text-white'
                  : 'bg-rose-50/50 border-rose-200 text-rose-950'
              }`}
            >
              <h2 className="text-base font-semibold tracking-tight">
                Core Privacy & Account Rules
              </h2>

              <div className="space-y-5">
                <div className="flex items-start gap-3.5">
                  <Shield className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-semibold">No email required.</h3>
                    <p
                      className={`text-xs mt-1 leading-relaxed ${
                        isDark ? 'text-rose-200/75' : 'text-rose-900/75'
                      }`}
                    >
                      Accounts use only a unique username and password. No email verification,
                      no phone number, no OTP, and no social login trackers.
                    </p>
                  </div>
                </div>

                <div
                  className={`border-t pt-5 flex items-start gap-3.5 ${
                    isDark ? 'border-rose-900/60' : 'border-rose-200/80'
                  }`}
                >
                  <Lock className="w-5 h-5 text-pink-400 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-semibold">
                      Remember your password — there is no password recovery.
                    </h3>
                    <p
                      className={`text-xs mt-1 leading-relaxed ${
                        isDark ? 'text-rose-200/75' : 'text-rose-900/75'
                      }`}
                    >
                      Because we never collect an email or phone number, password resets do not
                      exist. If you forget your password, your account cannot be recovered.
                    </p>
                  </div>
                </div>

                <div
                  className={`border-t pt-5 flex items-start gap-3.5 ${
                    isDark ? 'border-rose-900/60' : 'border-rose-200/80'
                  }`}
                >
                  <Clock className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-semibold">
                      Inactive accounts are automatically deleted after 9 months without a sign-in.
                    </h3>
                    <p
                      className={`text-xs mt-1 leading-relaxed ${
                        isDark ? 'text-rose-200/75' : 'text-rose-900/75'
                      }`}
                    >
                      If you do not sign in for 9 months, our automated cleanup permanently purges
                      your account, sessions, conversations, and messages.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {mode === 'signup' && (
          <div
            className={`w-full max-w-md rounded-xl border p-6 sm:p-8 ${
              isDark
                ? 'bg-[#220712] border-rose-900/70 text-white'
                : 'bg-white border-rose-200 text-rose-950 shadow-sm'
            }`}
          >
            <div className="space-y-1.5 mb-6">
              <h1 className="text-2xl font-bold tracking-tight">Create Account</h1>
              <p className={`text-xs ${isDark ? 'text-rose-200/75' : 'text-rose-800/80'}`}>
                Choose a unique username and strong password. No email required.
              </p>
            </div>

            {/* Mandatory No-Recovery Warning */}
            <div
              className={`mb-6 p-3.5 rounded-lg border text-xs leading-relaxed ${
                isDark
                  ? 'bg-rose-950/60 border-rose-700/70 text-rose-100'
                  : 'bg-rose-50 border-rose-300 text-rose-950'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <p>
                  <strong className="font-semibold">Important:</strong> Keep your username and
                  password safe. There is no password recovery. If you forget your password, this
                  account cannot be recovered.
                </p>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className={`mb-5 p-3 rounded-lg border text-xs font-medium ${
                  isDark
                    ? 'bg-red-950/70 border-red-700 text-white'
                    : 'bg-red-50 border-red-300 text-red-900'
                }`}
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSignupSubmit} className="space-y-4" noValidate>
              <div>
                <label
                  htmlFor="signup-username"
                  className="block text-xs font-semibold mb-1.5"
                >
                  Username
                </label>
                <div className="relative">
                  <span
                    className={`absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono select-none ${
                      isDark ? 'text-rose-400' : 'text-rose-500'
                    }`}
                  >
                    @
                  </span>
                  <input
                    id="signup-username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="sakha123"
                    maxLength={30}
                    required
                    className={`w-full pl-8 pr-3.5 py-2.5 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-rose-500 transition-colors ${
                      isDark
                        ? 'bg-[#14040A] border-rose-800/80 text-white placeholder-rose-400/40'
                        : 'bg-rose-50/40 border-rose-300 text-rose-950 placeholder-rose-400'
                    }`}
                  />
                </div>
                <p
                  className={`mt-1 text-[11px] ${
                    username.length > 0 && !usernameValid
                      ? 'text-pink-400 font-medium'
                      : isDark
                      ? 'text-rose-300/60'
                      : 'text-rose-700/70'
                  }`}
                >
                  3–30 characters · Letters, numbers, and underscores only · Case-insensitive sign-in
                </p>
              </div>

              <div>
                <label
                  htmlFor="signup-password"
                  className="block text-xs font-semibold mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="signup-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    required
                    className={`w-full pl-3.5 pr-10 py-2.5 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-rose-500 transition-colors ${
                      isDark
                        ? 'bg-[#14040A] border-rose-800/80 text-white placeholder-rose-400/40'
                        : 'bg-rose-50/40 border-rose-300 text-rose-950 placeholder-rose-400'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded ${
                      isDark ? 'text-rose-300 hover:text-white' : 'text-rose-600 hover:text-rose-950'
                    }`}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p
                  className={`mt-1 text-[11px] ${
                    password.length > 0 && !passwordValid
                      ? 'text-pink-400 font-medium'
                      : isDark
                      ? 'text-rose-300/60'
                      : 'text-rose-700/70'
                  }`}
                >
                  Minimum 8 characters · Hashed securely on the server
                </p>
              </div>

              <div>
                <label
                  htmlFor="signup-confirm-password"
                  className="block text-xs font-semibold mb-1.5"
                >
                  Confirm Password
                </label>
                <input
                  id="signup-confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  required
                  className={`w-full px-3.5 py-2.5 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-rose-500 transition-colors ${
                    isDark
                      ? 'bg-[#14040A] border-rose-800/80 text-white placeholder-rose-400/40'
                      : 'bg-rose-50/40 border-rose-300 text-rose-950 placeholder-rose-400'
                  }`}
                />
                {confirmPassword.length > 0 && !passwordsMatch && (
                  <p className="mt-1 text-[11px] text-pink-400 font-medium">
                    Passwords do not match yet.
                  </p>
                )}
              </div>

              <label className="flex items-start gap-2.5 pt-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={acknowledgedNoRecovery}
                  onChange={(e) => setAcknowledgedNoRecovery(e.target.checked)}
                  className="mt-0.5 rounded border-rose-700 text-rose-600 focus:ring-rose-500"
                />
                <span className={`text-xs leading-snug ${isDark ? 'text-rose-100/90' : 'text-rose-900'}`}>
                  I understand there is no password recovery and accounts inactive for 9 months
                  without signing in are automatically deleted.
                </span>
              </label>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                {loading ? 'Creating Account...' : 'Create Account'}
              </button>
            </form>

            <div
              className={`mt-6 pt-5 border-t text-center text-xs ${
                isDark ? 'border-rose-900/60 text-rose-200/80' : 'border-rose-200 text-rose-800'
              }`}
            >
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="font-semibold text-rose-500 hover:underline ml-1"
              >
                Sign In
              </button>
            </div>
          </div>
        )}

        {mode === 'login' && (
          <div
            className={`w-full max-w-md rounded-xl border p-6 sm:p-8 ${
              isDark
                ? 'bg-[#220712] border-rose-900/70 text-white'
                : 'bg-white border-rose-200 text-rose-950 shadow-sm'
            }`}
          >
            <div className="space-y-1.5 mb-6">
              <h1 className="text-2xl font-bold tracking-tight">Sign In</h1>
              <p className={`text-xs ${isDark ? 'text-rose-200/75' : 'text-rose-800/80'}`}>
                Enter your username and password to open VaultChat.
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className={`mb-5 p-3 rounded-lg border text-xs font-medium ${
                  isDark
                    ? 'bg-red-950/70 border-red-700 text-white'
                    : 'bg-red-50 border-red-300 text-red-900'
                }`}
              >
                {error}
              </div>
            )}

            <form onSubmit={handleLoginSubmit} className="space-y-4" noValidate>
              <div>
                <label
                  htmlFor="login-username"
                  className="block text-xs font-semibold mb-1.5"
                >
                  Username
                </label>
                <div className="relative">
                  <span
                    className={`absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono select-none ${
                      isDark ? 'text-rose-400' : 'text-rose-500'
                    }`}
                  >
                    @
                  </span>
                  <input
                    id="login-username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="sakha123"
                    required
                    className={`w-full pl-8 pr-3.5 py-2.5 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-rose-500 transition-colors ${
                      isDark
                        ? 'bg-[#14040A] border-rose-800/80 text-white placeholder-rose-400/40'
                        : 'bg-rose-50/40 border-rose-300 text-rose-950 placeholder-rose-400'
                    }`}
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="block text-xs font-semibold mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    className={`w-full pl-3.5 pr-10 py-2.5 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-rose-500 transition-colors ${
                      isDark
                        ? 'bg-[#14040A] border-rose-800/80 text-white placeholder-rose-400/40'
                        : 'bg-rose-50/40 border-rose-300 text-rose-950 placeholder-rose-400'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded ${
                      isDark ? 'text-rose-300 hover:text-white' : 'text-rose-600 hover:text-rose-950'
                    }`}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                {loading ? 'Signing In...' : 'Sign In'}
              </button>
            </form>

            <div
              className={`mt-5 p-3 rounded-lg border text-[11px] leading-relaxed ${
                isDark
                  ? 'bg-[#14040A]/70 border-rose-900/60 text-rose-200/75'
                  : 'bg-rose-50/60 border-rose-200 text-rose-900/80'
              }`}
            >
              Password recovery is intentionally disabled to protect account privacy. Sign in at
              least once every 9 months to keep your account active.
            </div>

            <div
              className={`mt-5 pt-5 border-t text-center text-xs ${
                isDark ? 'border-rose-900/60 text-rose-200/80' : 'border-rose-200 text-rose-800'
              }`}
            >
              Need a new account?{' '}
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className="font-semibold text-rose-500 hover:underline ml-1"
              >
                Create Account
              </button>
            </div>
          </div>
        )}
      </main>

      <footer
        className={`px-6 py-4 border-t text-xs flex flex-wrap items-center justify-between gap-4 ${
          isDark ? 'border-rose-900/50 text-rose-300/60' : 'border-rose-200 text-rose-800/70'
        }`}
      >
        <span>VaultChat · Private Username & Password Messaging</span>
        <span>No Email · No Recovery · 9-Month Inactivity Auto-Deletion</span>
      </footer>
    </div>
  );
};
