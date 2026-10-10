import React, { useState, useEffect } from 'react';
import { api } from './lib/api.ts';
import { CurrentUser, ThemeMode } from './types.ts';
import { AuthViews } from './components/AuthViews.tsx';
import { ChatWorkspace } from './components/ChatWorkspace.tsx';

export default function App() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authMode, setAuthMode] = useState<'welcome' | 'login' | 'signup'>('welcome');
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Theme preference (Requirement 19 & 21: localStorage used ONLY for harmless theme preference)
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem('vaultchat_theme');
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        return saved;
      }
    } catch {
      // Ignore storage errors
    }
    return 'dark';
  });

  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return true;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const handleThemeChange = (nextTheme: ThemeMode) => {
    setTheme(nextTheme);
    try {
      localStorage.setItem('vaultchat_theme', nextTheme);
    } catch {
      // Ignore
    }
  };

  const isDark = theme === 'dark' || (theme === 'system' && systemPrefersDark);

  // Verify authenticated server-side session on startup
  useEffect(() => {
    let mounted = true;
    api
      .getMe()
      .then((user) => {
        if (mounted) {
          setCurrentUser(user);
        }
      })
      .catch(() => {
        if (mounted) {
          setCurrentUser(null);
        }
      })
      .finally(() => {
        if (mounted) {
          setAuthChecking(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (authChecking) {
    return (
      <div
        className={`min-h-screen flex items-center justify-center ${
          isDark ? 'bg-[#14040A] text-white' : 'bg-white text-rose-950'
        }`}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="w-7 h-7 rounded-full border-2 border-rose-500 border-t-transparent animate-spin" />
          <span className="text-xs font-medium tracking-wide">
            Verifying secure session...
          </span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthViews
        mode={authMode}
        setMode={setAuthMode}
        onAuthenticated={(user) => {
          setStatusBanner(null);
          setCurrentUser(user);
        }}
        theme={theme}
        isDark={isDark}
        onToggleTheme={() => handleThemeChange(isDark ? 'light' : 'dark')}
        statusBanner={statusBanner}
        onClearBanner={() => setStatusBanner(null)}
      />
    );
  }

  return (
    <ChatWorkspace
      currentUser={currentUser}
      onUserUpdated={(updated) => setCurrentUser(updated)}
      onLoggedOut={(message) => {
        setCurrentUser(null);
        setAuthMode('login');
        if (message) {
          setStatusBanner(message);
        }
      }}
      theme={theme}
      onThemeChange={handleThemeChange}
      isDark={isDark}
    />
  );
}
