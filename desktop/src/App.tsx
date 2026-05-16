import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useShallow } from 'zustand/shallow';
import { AppShell } from './components/layout/AppShell';
import { MiniPlayer } from './components/layout/MiniPlayer';
import { LiquidGlassDefs } from './components/ui/LiquidGlassDefs';
import YMImportFloatingStatus from './components/music/YMImportFloatingStatus';
import { ReAuthOverlay } from './components/ReAuthOverlay';
import { ThemeProvider } from './components/ThemeProvider';
import { ApiError } from './lib/api';
import { CHECK_UPDATES } from './lib/constants';
import { checkForAppUpdate, type GithubRelease } from './lib/update-check';
import { initSleepTimer } from './lib/sleep-timer';
import { getAppMode, useAppStatusStore } from './stores/app-status';
import { useMiniPlayerStore } from './stores/mini-player';
import { useAuthStore } from './stores/auth';
import { useSessionExpiryStore } from './stores/session-expiry';
import { type StartupPage, useSettingsStore } from './stores/settings';
import { useYmImportStore } from './stores/ym-import';

/* ── Hydration guard ─────────────────────────────────────────────
 * tauriStorage reads from disk asynchronously. Until the auth and
 * settings stores have loaded their persisted data, the app renders
 * with hard-coded defaults (orange accent, no sessionId). This causes
 * a flash of wrong theme AND the login screen. Show a loading spinner
 * instead.                                                         */
function useStoresHydrated(): boolean {
  const [hydrated, setHydrated] = useState(
    () => useAuthStore.persist.hasHydrated() && useSettingsStore.persist.hasHydrated(),
  );
  useEffect(() => {
    if (hydrated) return;
    let pending = 2;
    const done = () => { if (--pending === 0) setHydrated(true); };
    const u1 = useAuthStore.persist.onFinishHydration(done);
    const u2 = useSettingsStore.persist.onFinishHydration(done);
    // If already hydrated by the time we subscribe, fire immediately
    if (useAuthStore.persist.hasHydrated()) done();
    if (useSettingsStore.persist.hasHydrated()) done();
    return () => { u1(); u2(); };
  }, [hydrated]);
  return hydrated;
}

// Start the 1-second sleep-timer tick immediately (safe to call multiple times)
initSleepTimer();

const Home = lazy(() => import('./pages/Home').then((module) => ({ default: module.Home })));
const Library = lazy(() =>
  import('./pages/Library').then((module) => ({ default: module.Library })),
);
const Login = lazy(() => import('./pages/Login').then((module) => ({ default: module.Login })));
const PlaylistPage = lazy(() =>
  import('./pages/PlaylistPage').then((module) => ({ default: module.PlaylistPage })),
);
const OfflinePage = lazy(() =>
  import('./pages/OfflinePage').then((module) => ({ default: module.OfflinePage })),
);
const Search = lazy(() => import('./pages/Search').then((module) => ({ default: module.Search })));
const Settings = lazy(() =>
  import('./pages/Settings').then((module) => ({ default: module.Settings })),
);
const TrackPage = lazy(() =>
  import('./pages/TrackPage').then((module) => ({ default: module.TrackPage })),
);
const UserPage = lazy(() =>
  import('./pages/UserPage').then((module) => ({ default: module.UserPage })),
);
const ArtistPage = lazy(() =>
  import('./pages/ArtistPage').then((module) => ({ default: module.ArtistPage })),
);
const AlbumPage = lazy(() =>
  import('./pages/AlbumPage').then((module) => ({ default: module.AlbumPage })),
);
const Discover = lazy(() =>
  import('./pages/Discover').then((module) => ({ default: module.Discover })),
);
const UpdateChecker = lazy(() =>
  import('./components/UpdateChecker').then((module) => ({ default: module.UpdateChecker })),
);

const STARTUP_PAGE_ROUTES: Record<StartupPage, string> = {
  home: '/home',
  search: '/search',
  library: '/library',
  settings: '/settings',
};

function StartPageRedirect() {
  const startupPage = useSettingsStore((s) => s.startupPage);
  return <Navigate to={STARTUP_PAGE_ROUTES[startupPage]} replace />;
}

export default function App() {
  const hydrated = useStoresHydrated();
  const { isAuthenticated, sessionId, fetchUser } = useAuthStore(
    useShallow((s) => ({
      isAuthenticated: s.isAuthenticated,
      sessionId: s.sessionId,
      fetchUser: s.fetchUser,
    })),
  );
  const [availableRelease, setAvailableRelease] = useState<GithubRelease | null>(null);
  const dismissedReleaseTagRef = useRef<string | null>(null);
  const handleUpdateDismiss = useCallback(() => {
    setAvailableRelease((prev) => {
      if (prev) dismissedReleaseTagRef.current = prev.tag_name;
      return null;
    });
  }, []);
  const appMode = useAppStatusStore((s) =>
    s.offlineBypass || !s.navigatorOnline || !s.backendReachable ? 'offline' : 'online',
  );
  // Offline-only shell (limited routes + forced /offline redirect) should only appear when
  // the device is actually offline OR the user explicitly chose offline bypass. A transient
  // backend failure should NOT block the login page — the user must be able to retry.
  const showOfflineOnlyShell = useAppStatusStore(
    (s) => !isAuthenticated && !sessionId && (!s.navigatorOnline || s.offlineBypass),
  );

  const isMini = useMiniPlayerStore((s) => s.isMini);
  const hasLocalSession = Boolean(sessionId);
  const canUseMainShell = isAuthenticated || hasLocalSession;

  // Toggle body.mini so CSS can make #root transparent (enables real backdrop-filter glass)
  // Also clip <html> to border-radius so WebView corners are truly transparent (not square cutouts)
  useEffect(() => {
    document.body.classList.toggle('mini', isMini);
  }, [isMini]);

  useEffect(() => {
    useYmImportStore.getState().initBridge();
  }, []);

  useEffect(() => {
    const syncOnline = () => {
      const online = navigator.onLine;
      const appStatus = useAppStatusStore.getState();
      appStatus.setNavigatorOnline(online);
      // When the browser comes back online, optimistically assume the backend is reachable
      // so that the fetchUser effect can re-run and re-authenticate.
      if (online) {
        appStatus.setBackendReachable(true);
      }
    };

    syncOnline();
    window.addEventListener('online', syncOnline);
    window.addEventListener('offline', syncOnline);
    return () => {
      window.removeEventListener('online', syncOnline);
      window.removeEventListener('offline', syncOnline);
    };
  }, []);

  useEffect(() => {
    if (!sessionId || appMode !== 'online') {
      return;
    }

    let cancelled = false;

    fetchUser().catch((error) => {
      if (cancelled) return;

      if (error instanceof ApiError && error.status === 401) {
        useSessionExpiryStore.getState().setSessionExpired(true);
        return;
      }

      if (getAppMode() !== 'online') {
        return;
      }

      console.warn('[Auth] Keeping local session after /me bootstrap failure:', error);
      useAuthStore.setState({ isAuthenticated: true });
    });

    void import('./lib/dislikes').then(({ loadAllDislikedIds }) => {
      if (!cancelled) void loadAllDislikedIds();
    });

    return () => {
      cancelled = true;
    };
  }, [appMode, fetchUser, sessionId]);

  // Periodic connectivity recovery: if the backend became unreachable but the browser is still
  // online, retry every 15 s so that a transient server blip doesn't leave the app in offline
  // mode forever (the retry just marks backendReachable=true optimistically; the next real API
  // call will confirm or deny).
  useEffect(() => {
    if (appMode === 'online') return; // already online, nothing to do

    const id = setInterval(() => {
      const { navigatorOnline, offlineBypass } = useAppStatusStore.getState();
      if (navigatorOnline && !offlineBypass) {
        useAppStatusStore.getState().setBackendReachable(true);
      }
    }, 15_000);

    return () => clearInterval(id);
  }, [appMode]);

  useEffect(() => {
    if (!CHECK_UPDATES || !isAuthenticated || appMode !== 'online') {
      setAvailableRelease(null);
      return;
    }

    let cancelled = false;
    const checkUpdates = () => {
      checkForAppUpdate()
        .then((release) => {
          if (cancelled) return;
          if (release && release.tag_name === dismissedReleaseTagRef.current) return;
          setAvailableRelease(release);
        })
        .catch(() => {});
    };

    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(checkUpdates, { timeout: 1200 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(id);
      };
    }

    const id = setTimeout(checkUpdates, 1);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [appMode, isAuthenticated]);

  // Wait for stores to load from disk before rendering — prevents flash of
  // default theme/login screen while tauriStorage is reading files.
  if (!hydrated) {
    return (
      <ThemeProvider>
        <LiquidGlassDefs />
        <AppLoadingScreen fullscreen />
      </ThemeProvider>
    );
  }

  // Mini-player: render a compact standalone view, bypassing all routing/shell
  if (isMini) {
    return (
      <ThemeProvider>
        <LiquidGlassDefs />
        <MiniPlayer />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <LiquidGlassDefs />
      <Toaster
        theme="dark"
        position="top-right"
        offset={48}
        toastOptions={{
          style: {
            background: 'rgba(30, 30, 34, 0.9)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.85)',
            fontSize: '13px',
          },
        }}
      />
      <ReAuthOverlay />
      <YMImportFloatingStatus />
      <BrowserRouter>
        {showOfflineOnlyShell ? (
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="/offline" replace />} />
              <Route
                path="offline"
                element={
                  <RouteLoader>
                    <OfflinePage />
                  </RouteLoader>
                }
              />
              <Route
                path="settings"
                element={
                  <RouteLoader>
                    <Settings />
                  </RouteLoader>
                }
              />
              <Route path="*" element={<Navigate to="/offline" replace />} />
            </Route>
          </Routes>
        ) : !canUseMainShell ? (
          <Suspense fallback={<AppLoadingScreen fullscreen />}>
            <Login />
          </Suspense>
        ) : (
          <>
            {availableRelease && (
              <Suspense fallback={null}>
                <UpdateChecker release={availableRelease} onDismiss={handleUpdateDismiss} />
              </Suspense>
            )}
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<StartPageRedirect />} />
                <Route
                  path="home"
                  element={
                    <RouteLoader>
                      <Home />
                    </RouteLoader>
                  }
                />
                <Route
                  path="search"
                  element={
                    <RouteLoader>
                      <Search />
                    </RouteLoader>
                  }
                />
                <Route
                  path="library"
                  element={
                    <RouteLoader>
                      <Library />
                    </RouteLoader>
                  }
                />
                <Route
                  path="offline"
                  element={
                    <RouteLoader>
                      <OfflinePage />
                    </RouteLoader>
                  }
                />
                <Route
                  path="track/:urn"
                  element={
                    <RouteLoader>
                      <TrackPage />
                    </RouteLoader>
                  }
                />
                <Route
                  path="playlist/:urn"
                  element={
                    <RouteLoader>
                      <PlaylistPage />
                    </RouteLoader>
                  }
                />
                <Route
                  path="user/:urn"
                  element={
                    <RouteLoader>
                      <UserPage />
                    </RouteLoader>
                  }
                />
                <Route
                  path="artist/:id"
                  element={
                    <RouteLoader>
                      <ArtistPage />
                    </RouteLoader>
                  }
                />
                <Route
                  path="album/:id"
                  element={
                    <RouteLoader>
                      <AlbumPage />
                    </RouteLoader>
                  }
                />
                <Route
                  path="discover"
                  element={
                    <RouteLoader>
                      <Discover />
                    </RouteLoader>
                  }
                />
                <Route
                  path="settings"
                  element={
                    <RouteLoader>
                      <Settings />
                    </RouteLoader>
                  }
                />
              </Route>
            </Routes>
          </>
        )}
      </BrowserRouter>
    </ThemeProvider>
  );
}

function RouteLoader({ children }: { children: ReactNode }) {
  return <Suspense fallback={<AppLoadingScreen />}>{children}</Suspense>;
}

function AppLoadingScreen({ fullscreen = false }: { fullscreen?: boolean }) {
  const { t } = useTranslation();

  return (
    <div
      className={`flex items-center justify-center px-6 py-8 ${fullscreen ? 'h-screen' : 'min-h-[42vh]'}`}
    >
      <div className="flex items-center gap-3 rounded-[24px] border border-white/8 bg-white/[0.035] px-4 py-3 shadow-[0_18px_44px_rgba(0,0,0,0.24)] backdrop-blur-[28px]">
        <div className="flex size-10 items-center justify-center rounded-[16px] border border-accent/18 bg-accent/[0.10]">
          <div className="size-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/28">
            SoundCloud
          </div>
          <div className="mt-0.5 text-[13px] font-medium text-white/62">{t('common.loading')}</div>
        </div>
      </div>
    </div>
  );
}
