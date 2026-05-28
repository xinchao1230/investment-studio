import React, { useEffect, useState } from 'react';
import { HashRouter } from 'react-router-dom';
import { AuthProvider } from './components/auth/AuthProvider';
import { ReauthProvider } from './components/auth/ReauthProvider';
import { ProfileDataProvider } from './components/userData/userDataProvider';
import {
  ToastProvider,
  ToastContextSetter,
} from './components/ui/ToastProvider';
import { AppRoutes } from './routes/AppRoutes';
import WindowsTitleBar from './components/layout/WindowsTitleBar';
import WindowZoomHotkeys from './components/layout/WindowZoomHotkeys';
import McpAuthConsentDialog from './components/mcp/McpAuthConsentDialog';
import RequestOAuthClientIdDialog from './components/mcp/RequestOAuthClientIdDialog';
import { useMcpConnectionFailureToast } from './lib/mcp/useMcpConnectionFailureToast';
import { createLogger } from './lib/utilities/logger';

const logger = createLogger('[App]');

logger.debug('App component loaded');

/**
 * MCP Connection Failure Toast listener component
 * Must be used inside ToastProvider
 */
const McpConnectionFailureToastListener: React.FC = () => {
  const dialog = useMcpConnectionFailureToast();
  return dialog;
};

const AppContent: React.FC = () => {
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {/* McpConnectionFailureToastListener must be inside HashRouter because it uses useNavigate */}
      <McpConnectionFailureToastListener />
      <WindowZoomHotkeys />
      <McpAuthConsentDialog />
      <RequestOAuthClientIdDialog />
      <div className="h-screen flex flex-col overflow-hidden">
        <WindowsTitleBar />
        <div className="flex-1 min-h-0">
          <AppRoutes />
        </div>
      </div>
    </HashRouter>
  );
};

const App: React.FC = () => {
  logger.debug('Main App component rendering');

  // State to track if this is debug window
  const [isDebugWindow, setIsDebugWindow] = useState(
    (window as any).isDebugWindow || false,
  );
  // State to track token check status
  const [tokenCheckCompleted, setTokenCheckCompleted] = useState(false);
  // 🚀 State to track app readiness (backend services)
  const [isAppReady, setIsAppReady] = useState(false);

  useEffect(() => {
    // Check initial readiness
    const checkReadiness = async () => {
      try {
        if ((window as any).electronAPI?.isReady) {
          const result = await (window as any).electronAPI.isReady();
          if (result.success && result.data) {
            setIsAppReady(true);
          }
        } else {
          setIsAppReady(true); // Fallback
        }
      } catch (e) {
        logger.error('Readiness check failed', e);
        setIsAppReady(true); // Fail open
      }
    };
    checkReadiness();

    // Listen for ready event
    if ((window as any).electronAPI?.onAppReady) {
      return (window as any).electronAPI.onAppReady((ready: boolean) => {
        if (ready) setIsAppReady(true);
      });
    }
  }, []);

  useEffect(() => {
    // Listen for debug window ready event
    const handleDebugWindowReady = () => {
      setIsDebugWindow(true);
    };

    window.addEventListener('debugWindowReady', handleDebugWindowReady);

    // Also check periodically in case the flag was set before our listener
    const checkDebugFlag = () => {
      const debugFlag = (window as any).isDebugWindow;
      if (debugFlag && !isDebugWindow) {
        setIsDebugWindow(true);
      }
    };

    const interval = setInterval(checkDebugFlag, 100);

    // Clear after 5 seconds to avoid infinite checking
    setTimeout(() => {
      clearInterval(interval);
    }, 5000);

    return () => {
      window.removeEventListener('debugWindowReady', handleDebugWindowReady);
      clearInterval(interval);
    };
  }, [isDebugWindow]);

  // 🔧 Token monitoring is automatically managed by the main process's setCurrentAuth()
  useEffect(() => {
    setTokenCheckCompleted(true);
  }, [isDebugWindow]);

  // 🔧 Add token monitor event listeners for debugging and verification
  useEffect(() => {
    const handleTokenMonitorEvent = (event: CustomEvent) => {
      // logger.debug(`[TokenMonitor] Event received: ${event.type}`, event.detail);
    };

    // Listen for various token monitor events
    window.addEventListener(
      'tokenMonitor:monitor_started',
      handleTokenMonitorEvent as EventListener,
    );
    window.addEventListener(
      'tokenMonitor:monitor_stopped',
      handleTokenMonitorEvent as EventListener,
    );
    window.addEventListener(
      'tokenMonitor:refresh_success',
      handleTokenMonitorEvent as EventListener,
    );
    window.addEventListener(
      'tokenMonitor:refresh_failed_recoverable',
      handleTokenMonitorEvent as EventListener,
    );
    window.addEventListener(
      'tokenMonitor:require_reauth',
      handleTokenMonitorEvent as EventListener,
    );

    // Generic auth:monitor event
    window.addEventListener(
      'auth:monitor',
      handleTokenMonitorEvent as EventListener,
    );

    return () => {
      window.removeEventListener(
        'tokenMonitor:monitor_started',
        handleTokenMonitorEvent as EventListener,
      );
      window.removeEventListener(
        'tokenMonitor:monitor_stopped',
        handleTokenMonitorEvent as EventListener,
      );
      window.removeEventListener(
        'tokenMonitor:refresh_success',
        handleTokenMonitorEvent as EventListener,
      );
      window.removeEventListener(
        'tokenMonitor:refresh_failed_recoverable',
        handleTokenMonitorEvent as EventListener,
      );
      window.removeEventListener(
        'tokenMonitor:require_reauth',
        handleTokenMonitorEvent as EventListener,
      );
      window.removeEventListener(
        'auth:monitor',
        handleTokenMonitorEvent as EventListener,
      );
    };
  }, []);

  if (isDebugWindow) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Debug Mode Unavailable</h2>
          <p className="text-neutral-600">
            Debug window functionality has been removed.
          </p>
        </div>
      </div>
    );
  }

  // 🚀 Loading Screen (Wait for Backend Services)
  // NOTE: Previously this branch rendered a dark "Initializing Core Services..."
  // loading screen while `isAppReady` was false. We dropped that screen because:
  //  1. The Electron main process now keeps the window hidden until the renderer
  //     signals it has mounted (see main.ts `window:rendererReady` IPC), so the
  //     dark splash flashed for only a few hundred ms anyway.
  //  2. The next visible UI (`AppContent` → `WindowsTitleBar` + `AuthProvider`
  //     route) already shows a branded light-bg "logo loading" while auth and
  //     the routes resolve. Showing the dark splash first produced a
  //     dark→light flicker.
  // `isAppReady` is still tracked above in case other downstream consumers
  // want to read it, but it no longer gates the render path.
  void isAppReady;

  // Render main application with AuthProvider V2.0
  return (
    <ToastProvider>
      <ToastContextSetter />
      
        <AuthProvider>
          <ReauthProvider>
            <ProfileDataProvider>
              <AppContent />
            </ProfileDataProvider>
          </ReauthProvider>
        </AuthProvider>
      
    </ToastProvider>
  );
};

export default App;
