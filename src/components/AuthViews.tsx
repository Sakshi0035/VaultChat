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
      className={`min-h-[100dvh] flex flex-col transition-colors ${
        isDark
          ? 'bg-gradient-to-br from-[#030B17] via-[#061527] to-[#041B1D] text-white'
          : 'bg-gradient-to-br from-white via-cyan-50/40 to-emerald-50/50 text-slate-900'
      }`}
    >
      {/* Top Bar Contract: Zone 1 Brand | Zone 2 Nav Links | Zone 3 Primary Action */}
      <header
        className={`sticky top-0 z-30 flex items-center justify-between gap-4 sm:gap-8 px-4 sm:px-6 h-14 sm:h-16 border-b backdrop-blur-md ${
          isDark
            ? 'border-teal-900/60 bg-[#051221]/90'
            : 'border-teal-200/80 bg-white/90'
        }`}
      >
        <button
          type="button"
          onClick={() => switchMode('welcome')}
          className={`text-lg font-bold tracking-tight text-left cursor-pointer focus:outline-none whitespace-nowrap shrink-0 bg-gradient-to-r from-blue-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent`}
        >
          VaultChat
        </button>

        <nav
          className={`flex items-center gap-3 sm:gap-6 text-xs sm:text-sm font-medium ${
            isDark ? 'text-cyan-100/80' : 'text-slate-700'
          }`}
        >
          <button
            type="button"
            onClick={() => switchMode('welcome')}
            className={`hidden sm:inline-block hover:underline transition-colors whitespace-nowrap shrink-0 ${
              mode === 'welcome'
                ? isDark
                  ? 'text-emerald-400 font-semibold'
                  : 'text-teal-700 font-semibold'
                : ''
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className={`hover:underline transition-colors whitespace-nowrap shrink-0 min-h-[44px] px-1 flex items-center ${
              mode === 'signup'
                ? isDark
                  ? 'text-emerald-400 font-semibold'
                  : 'text-teal-700 font-semibold'
                : ''
            }`}
          >
            Create Account
          </button>
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`hover:underline transition-colors whitespace-nowrap shrink-0 min-h-[44px] px-1 flex items-center ${
              mode === 'login'
                ? isDark
                  ? 'text-emerald-400 font-semibold'
                  : 'text-teal-700 font-semibold'
                : ''
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            className="hover:underline transition-colors whitespace-nowrap shrink-0 min-h-[44px] px-1.5 flex items-center gap-1.5"
            aria-label="Toggle color theme"
          >
            {isDark ? (
              <Sun className="w-4 h-4 text-emerald-300 shrink-0" />
            ) : (
              <Moon className="w-4 h-4 text-teal-700 shrink-0" />
            )}
            <span className="hidden md:inline">
              {isDark ? 'Light Ocean' : 'Dark Ocean'}
            </span>
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          {mode === 'signup' ? (
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="px-3.5 sm:px-4 py-2 min-h-[40px] text-xs font-semibold text-white bg-gradient-to-r from-blue-600 via-cyan-600 to-emerald-500 hover:from-blue-500 hover:via-cyan-500 hover:to-emerald-400 rounded-xl transition-all whitespace-nowrap shrink-0 shadow-xs"
            >
              Sign In
            </button>
          ) : (
            <button
              type="button"
              onClick={() => switchMode('signup')}
              className="px-3.5 sm:px-4 py-2 min-h-[40px] text-xs font-semibold text-white bg-gradient-to-r from-blue-600 via-cyan-600 to-emerald-500 hover:from-blue-500 hover:via-cyan-500 hover:to-emerald-400 rounded-xl transition-all whitespace-nowrap shrink-0 shadow-xs"
            >
              Get Started
            </button>
          )}
        </div>
      </header>

      {statusBanner && (
        <div className="max-w-xl mx-auto mt-4 sm:mt-6 px-4 w-full">
          <div
            className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-xs sm:text-sm ${
              isDark
                ? 'bg-teal-950/70 border-teal-700/60 text-white'
                : 'bg-teal-50 border-teal-300 text-slate-900'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span className="break-words">{statusBanner}</span>
            </div>
            {onClearBanner && (
              <button
                type="button"
                onClick={onClearBanner}
                className="text-xs underline opacity-80 hover:opacity-100 whitespace-nowrap shrink-0 min-h-[36px] px-2"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-6 sm:py-12">
        {mode === 'welcome' && (
          <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
            <div className="lg:col-span-7 space-y-5 sm:space-y-6">
              <div
                className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold ${
                  isDark ? 'text-emerald-400' : 'text-teal-700'
                }`}
              >
                <span>Zero-Email Architecture</span>
                <span aria-hidden="true">·</span>
                <span>Neon PostgreSQL Persistence</span>
                <span aria-hidden="true">·</span>
                <span>Real-Time WebSockets</span>
              </div>

              <h1
                className="text-2xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-tight"
                style={{ textWrap: 'balance' } as React.CSSProperties}
              >
                Chat privately with a simple{' '}
                <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                  username and password.
                </span>
              </h1>

              <p
                className={`text-sm sm:text-lg leading-relaxed max-w-xl ${
                  isDark ? 'text-cyan-100/80' : 'text-slate-700'
                }`}
              >
                Direct one-to-one real-time messaging built around strict identity minimalism.
                Pick a unique handle, set a strong password, and start conversing immediately—without
                handing over an email address, phone number, or social profile.
              </p>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 pt-1 sm:pt-2">
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 min-h-[48px] text-sm font-semibold text-white bg-gradient-to-r from-blue-600 via-cyan-600 to-emerald-500 hover:from-blue-500 hover:via-cyan-500 hover:to-emerald-400 active:scale-[0.99] rounded-xl transition-all whitespace-nowrap shadow-sm"
                >
                  <span>Create Account</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className={`inline-flex items-center justify-center gap-2 px-6 py-3.5 min-h-[48px] text-sm font-semibold rounded-xl border active:scale-[0.99] transition-all whitespace-nowrap ${
                    isDark
                      ? 'border-teal-800/80 bg-[#071A2C] text-white hover:bg-teal-950/60'
                      : 'border-teal-300 bg-white text-slate-900 hover:bg-teal-50/60'
                  }`}
                >
                  <span>Sign In</span>
                </button>
              </div>
            </div>

            {/* Key Security Principles Panel */}
            <div
              className={`lg:col-span-5 rounded-2xl border p-5 sm:p-8 space-y-5 sm:space-y-6 ${
                isDark
                  ? 'bg-[#071829]/90 border-teal-900/70 text-white'
                  : 'bg-white/90 border-teal-200 text-slate-900 shadow-xs'
              }`}
            >
              <h2 className="text-base font-semibold tracking-tight">
                Core Privacy & Account Rules
              </h2>

              <div className="space-y-4 sm:space-y-5">
                <div className="flex items-start gap-3.5">
                  <Shield className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-semibold">No email required.</h3>
                    <p
                      className={`text-xs mt-1 leading-relaxed ${
                        isDark ? 'text-cyan-100/75' : 'text-slate-600'
                      }`}
                    >
                      Accounts use only a unique username and password. No email verification,
                      no phone number, no OTP, and no social login trackers.
                    </p>
                  </div>
                </div>

                <div
                  className={`border-t pt-4 sm:pt-5 flex items-start gap-3.5 ${
                    isDark ? 'border-teal-900/60' : 'border-teal-200/80'
                  }`}
                >
                  <Lock className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-semibold">
                      Remember your password — there is no password recovery.
                    </h3>
                    <p
                      className={`text-xs mt-1 leading-relaxed ${
                        isDark ? 'text-cyan-100/75' : 'text-slate-600'
                      }`}
                    >
                      Because we never collect an email or phone number, password resets do not
                      exist. If you forget your password, your account cannot be recovered.
                    </p>
                  </div>
                </div>

                <div
                  className={`border-t pt-4 sm:pt-5 flex items-start gap-3.5 ${
                    isDark ? 'border-teal-900/60' : 'border-teal-200/80'
                  }`}
                >
                  <Clock className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-semibold">
                      Inactive accounts are automatically deleted after 9 months without a sign-in.
                    </h3>
                    <p
                      className={`text-xs mt-1 leading-relaxed ${
                        isDark ? 'text-cyan-100/75' : 'text-slate-600'
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
            className={`w-full max-w-md rounded-2xl border p-5 sm:p-8 ${
              isDark
                ? 'bg-[#071829]/95 border-teal-900/70 text-white'
                : 'bg-white border-teal-200 text-slate-900 shadow-sm'
            }`}
          >
            <div className="space-y-1.5 mb-5 sm:mb-6">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Create Account</h1>
              <p className={`text-xs ${isDark ? 'text-cyan-100/75' : 'text-slate-600'}`}>
                Choose a unique username and strong password. No email required.
              </p>
            </div>

            {/* Mandatory No-Recovery Warning */}
            <div
              className={`mb-5 p-3.5 rounded-xl border text-xs leading-relaxed ${
                isDark
                  ? 'bg-teal-950/60 border-teal-700/70 text-cyan-50'
                  : 'bg-teal-50 border-teal-300 text-slate-900'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
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
                className={`mb-5 p-3.5 rounded-xl border text-xs font-medium ${
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
                    className={`absolute left-3.5 top-1/2 -translate-y-1/2 text-base sm:text-sm font-mono select-none ${
                      isDark ? 'text-emerald-400' : 'text-teal-600'
                    }`}
                  >
                    @
                  </span>
                  <input
                    id="signup-username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="sakha123"
                    maxLength={30}
                    required
                    className={`w-full pl-8 pr-3.5 py-3 min-h-[46px] text-base sm:text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${
                      isDark
                        ? 'bg-[#040D1A] border-teal-800/80 text-white placeholder-cyan-400/40'
                        : 'bg-teal-50/30 border-teal-300 text-slate-900 placeholder-slate-400'
                    }`}
                  />
                </div>
                <p
                  className={`mt-1.5 text-[11px] leading-snug ${
                    username.length > 0 && !usernameValid
                      ? 'text-amber-400 font-medium'
                      : isDark
                      ? 'text-cyan-200/60'
                      : 'text-slate-500'
                  }`}
                >
                  3–30 characters · Letters, numbers, and underscores only
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
                    className={`w-full pl-3.5 pr-12 py-3 min-h-[46px] text-base sm:text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${
                      isDark
                        ? 'bg-[#040D1A] border-teal-800/80 text-white placeholder-cyan-400/40'
                        : 'bg-teal-50/30 border-teal-300 text-slate-900 placeholder-slate-400'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className={`absolute right-1 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg ${
                      isDark ? 'text-cyan-300 hover:text-white' : 'text-teal-700 hover:text-slate-900'
                    }`}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p
                  className={`mt-1.5 text-[11px] ${
                    password.length > 0 && !passwordValid
                      ? 'text-amber-400 font-medium'
                      : isDark
                      ? 'text-cyan-200/60'
                      : 'text-slate-500'
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
                  className={`w-full px-3.5 py-3 min-h-[46px] text-base sm:text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${
                    isDark
                      ? 'bg-[#040D1A] border-teal-800/80 text-white placeholder-cyan-400/40'
                      : 'bg-teal-50/30 border-teal-300 text-slate-900 placeholder-slate-400'
                  }`}
                />
                {confirmPassword.length > 0 && !passwordsMatch && (
                  <p className="mt-1.5 text-[11px] text-amber-400 font-medium">
                    Passwords do not match yet.
                  </p>
                )}
              </div>

              <label className="flex items-start gap-3 pt-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={acknowledgedNoRecovery}
                  onChange={(e) => setAcknowledgedNoRecovery(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-teal-700 text-emerald-500 focus:ring-emerald-500 shrink-0"
                />
                <span className={`text-xs leading-snug ${isDark ? 'text-cyan-50/90' : 'text-slate-700'}`}>
                  I understand there is no password recovery and accounts inactive for 9 months
                  without signing in are automatically deleted.
                </span>
              </label>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 min-h-[48px] text-sm font-semibold text-white bg-gradient-to-r from-blue-600 via-cyan-600 to-emerald-500 hover:from-blue-500 hover:via-cyan-500 hover:to-emerald-400 active:scale-[0.99] disabled:opacity-50 rounded-xl transition-all cursor-pointer whitespace-nowrap"
              >
                {loading ? 'Creating Account...' : 'Create Account'}
              </button>
            </form>

            <div
              className={`mt-6 pt-5 border-t text-center text-xs ${
                isDark ? 'border-teal-900/60 text-cyan-100/80' : 'border-teal-200 text-slate-700'
              }`}
            >
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="font-semibold text-emerald-400 hover:underline ml-1 py-1 px-1"
              >
                Sign In
              </button>
            </div>
          </div>
        )}

        {mode === 'login' && (
          <div
            className={`w-full max-w-md rounded-2xl border p-5 sm:p-8 ${
              isDark
                ? 'bg-[#071829]/95 border-teal-900/70 text-white'
                : 'bg-white border-teal-200 text-slate-900 shadow-sm'
            }`}
          >
            <div className="space-y-1.5 mb-5 sm:mb-6">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Sign In</h1>
              <p className={`text-xs ${isDark ? 'text-cyan-100/75' : 'text-slate-600'}`}>
                Enter your username and password to open VaultChat.
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className={`mb-5 p-3.5 rounded-xl border text-xs font-medium ${
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
                    className={`absolute left-3.5 top-1/2 -translate-y-1/2 text-base sm:text-sm font-mono select-none ${
                      isDark ? 'text-emerald-400' : 'text-teal-600'
                    }`}
                  >
                    @
                  </span>
                  <input
                    id="login-username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="sakha123"
                    required
                    className={`w-full pl-8 pr-3.5 py-3 min-h-[46px] text-base sm:text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${
                      isDark
                        ? 'bg-[#040D1A] border-teal-800/80 text-white placeholder-cyan-400/40'
                        : 'bg-teal-50/30 border-teal-300 text-slate-900 placeholder-slate-400'
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
                    className={`w-full pl-3.5 pr-12 py-3 min-h-[46px] text-base sm:text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${
                      isDark
                        ? 'bg-[#040D1A] border-teal-800/80 text-white placeholder-cyan-400/40'
                        : 'bg-teal-50/30 border-teal-300 text-slate-900 placeholder-slate-400'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className={`absolute right-1 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg ${
                      isDark ? 'text-cyan-300 hover:text-white' : 'text-teal-700 hover:text-slate-900'
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
                className="w-full py-3 px-4 min-h-[48px] text-sm font-semibold text-white bg-gradient-to-r from-blue-600 via-cyan-600 to-emerald-500 hover:from-blue-500 hover:via-cyan-500 hover:to-emerald-400 active:scale-[0.99] disabled:opacity-50 rounded-xl transition-all cursor-pointer whitespace-nowrap"
              >
                {loading ? 'Signing In...' : 'Sign In'}
              </button>
            </form>

            <div
              className={`mt-5 p-3.5 rounded-xl border text-[11px] leading-relaxed ${
                isDark
                  ? 'bg-[#040D1A]/70 border-teal-900/60 text-cyan-100/75'
                  : 'bg-teal-50/60 border-teal-200 text-slate-700'
              }`}
            >
              Password recovery is intentionally disabled to protect account privacy. Sign in at
              least once every 9 months to keep your account active.
            </div>

            <div
              className={`mt-5 pt-5 border-t text-center text-xs ${
                isDark ? 'border-teal-900/60 text-cyan-100/80' : 'border-teal-200 text-slate-700'
              }`}
            >
              Need a new account?{' '}
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className="font-semibold text-emerald-400 hover:underline ml-1 py-1 px-1"
              >
                Create Account
              </button>
            </div>
          </div>
        )}
      </main>

      <footer
        className={`px-4 sm:px-6 py-4 border-t text-[11px] sm:text-xs flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left pb-safe ${
          isDark ? 'border-teal-900/50 text-cyan-200/60' : 'border-teal-200 text-slate-600'
        }`}
      >
        <span>VaultChat · Private Username & Password Messaging</span>
        <span>No Email · No Recovery · 9-Month Inactivity Auto-Deletion</span>
      </footer>
    </div>
  );
};
