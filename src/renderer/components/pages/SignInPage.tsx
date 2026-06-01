// src/renderer/components/pages/SignInPage.tsx (Enhanced version)
// Strictly implemented according to design document lines 648-855
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '../ui/ToastProvider';
import { Button } from '../ui/button';
import { Card, CardContent, CardTitle } from '../ui/card';
import { StartupValidationResult } from '../../types/startupValidationTypes';
import '../../styles/SignInPage.css';
import { APP_NAME, BRAND_NAME } from '@shared/constants/branding';
import { AuthManagerProxy } from "../../lib/auth/authManagerProxy";
import { createSkipLoginAuthData } from "../../lib/auth/authDataAdapter";
import { DotGridBackground } from "./DotGridBackground";
import { useNavigate } from 'react-router-dom';
import { useProfileData } from '../userData/userDataProvider';
import { useAuthContext } from '../auth/AuthProvider';

// Upper bound on how long a sign-in button spins waiting for the data gate
// (isInitialized) before we give up and let the user retry. Sits just past the
// 15s getProfile IPC timeout in profileDataManager.initialize().
const GATE_TIMEOUT_MS = 16000;

interface SignInPageProps {
  // SignInPage can optionally receive pre-scanned startup results
  startupResult?: StartupValidationResult;
}

export const SignInPage: React.FC<SignInPageProps> = ({ startupResult }) => {
  const componentStartTime = Date.now();

  const navigate = useNavigate();
  const { isAuthenticated } = useAuthContext();
  const { isInitialized: dataInitialized } = useProfileData();

  // In-button gate: after a successful setCurrentAuth we keep the clicked button
  // spinning until the data gate (isInitialized) opens, then navigate. spinningKey
  // identifies WHICH entry point is busy ('github' | 'skip' | <profile.alias>).
  const [pendingNav, setPendingNav] = useState(false);
  const [spinningKey, setSpinningKey] = useState<string | null>(null);

  // Optimization: remove sessionStorage reads to avoid blocking rendering
  // sessionStorage operations may block due to browser security policies or storage quota checks
  const [isLoading, setIsLoading] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<any | null>(null);
  const [profilesWithAuth, setProfilesWithAuth] = useState<any[]>([]);
  const [showProfileSelection, setShowProfileSelection] = useState(false);
  const [isScanning, setIsScanning] = useState(true);
  const [showGhcDeviceFlow, setShowGhcDeviceFlow] = useState(false);
  const [deviceCode, setDeviceCode] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const [showGeneratingCode, setShowGeneratingCode] = useState(false);


  // Use ref to prevent state loss on component remount
  const isInitialized = useRef(false);

  // New architecture: receive pre-processed results from StartupPage
  useEffect(() => {
    const effectStartTime = Date.now();

    if (isInitialized.current) {
      return;
    }
    isInitialized.current = true;

    const processStartupResults = async () => {
      setIsScanning(true);

      try {

        // New: detailed debug of the entire startupResult object

        // Check if we have startupResult from StartupPage validation
        if (startupResult?.stage2) {

          // Prioritize AuthManager pre-processed results
          if (startupResult.stage2.authManagerInitialized && startupResult.stage2.authManagerProfiles?.length > 0) {

            const allProfilesWithAuth = startupResult.stage2.authManagerProfiles.map((profile: any) => ({
              ...profile,
              isValid: profile.type === 'valid',
              isExpired: profile.type === 'recoverable',
              isRecoverable: profile.type === 'recoverable'
            }));

            setProfilesWithAuth(allProfilesWithAuth);
            setShowProfileSelection(allProfilesWithAuth.length > 0);

          } else {

            // Use results in legacy format
            const allProfilesWithAuth = [
              ...(startupResult.stage2.validUsers || []),
              ...(startupResult.stage2.expiredUsers || []).map((expired: any) => ({
                ...expired,
                isExpired: true
              }))
            ];

            setProfilesWithAuth(allProfilesWithAuth);
            setShowProfileSelection(allProfilesWithAuth.length > 0);
          }

        } else {
          setProfilesWithAuth([]);
          setShowProfileSelection(false);
        }

      } catch (error) {
        setProfilesWithAuth([]);
        setShowProfileSelection(false);
      } finally {
        setIsScanning(false);
      }
    };

    processStartupResults();
  }, [startupResult]);


  // Optimization: sessionStorage persistence removed to avoid frequent write blocking
  // SignInPage is a temporary page, state persistence is not needed
  // useEffect(() => {
  //   sessionStorage.setItem('signin-isLoading', JSON.stringify(isLoading));
  // }, [isLoading]);

  // ... other sessionStorage operations have been removed

  // Device code countdown
  useEffect(() => {
    if (deviceCode && showGhcDeviceFlow && timeLeft > 0) {
      const timer = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [deviceCode, showGhcDeviceFlow, timeLeft]);

  const { showError, showSuccess } = useToast();
  // Auth functionality is now handled through main process

  // Gate watcher: the single authority for post-auth navigation. Only acts when
  // pendingNav is set (i.e. THIS page started a sign-in), so it never fires on a
  // cold-start cache restore that flips isAuthenticated with no user click.
  useEffect(() => {
    if (!pendingNav) return;

    if (isAuthenticated && dataInitialized) {
      navigate(BRAND_NAME === 'investment-studio' ? '/research' : '/agent');
      return;
    }

    const timer = setTimeout(() => {
      setPendingNav(false);
      setSpinningKey(null);
      setIsLoading(false);
      showError('Loading timed out, please try again');
    }, GATE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pendingNav, isAuthenticated, dataInitialized, navigate]);

  // Use AuthData directly, without any mapping or rebuilding
  const handleProfileSelect = async (profile: any) => {
    try {
      setIsLoading(true);
      setSpinningKey(profile.alias);


      const authManager = new AuthManagerProxy();

      // Use AuthData directly
      const authData = profile.authData;

      if (!authData) {
        throw new Error('Profile is missing AuthData');
      }

      // Detailed debug of authData structure

      // Validate authData structure integrity
      if (!authData.ghcAuth) {
        throw new Error('AuthData is missing the ghcAuth field');
      }
      if (!authData.ghcAuth.user) {
        throw new Error('AuthData.ghcAuth is missing the user field');
      }
      if (!authData.ghcAuth.user.login) {
        throw new Error('AuthData.ghcAuth.user is missing the login field');
      }


      // Fix: check if this is a validated Profile (has a valid GitHub token)
      if (profile.isValid) {

        // Use the new AuthData API - setCurrentAuth internally calls handlePostAuthentication to complete initialization
        await authManager.setCurrentAuth(authData);


        // Trigger auth success event to notify App.tsx for route navigation
        const authSuccessEvent = new CustomEvent('ghc:authSuccess', {
          detail: {
            authData: authData,
            provider: 'ghc',
            source: 'signin_page_valid_profile'
          }
        });

        window.dispatchEvent(authSuccessEvent);

        setPendingNav(true);

      } else if (profile.isRecoverable) {

        // Set AuthData first, then refresh token
        await authManager.setCurrentAuth(authData);

        const refreshResult = await authManager.refreshCopilotToken();

        if (refreshResult.success && refreshResult.authData) {

          // Trigger auth success event
          const authSuccessEvent = new CustomEvent('ghc:authSuccess', {
            detail: {
              authData: refreshResult.authData,
              sessionId: profile.sessionId,
              provider: 'ghc',
              source: 'signin_page_recovered_profile'
            }
          });

          window.dispatchEvent(authSuccessEvent);

          setPendingNav(true);

        } else {
          await handleExpiredProfileReauth(profile);
          return;
        }

      } else {
        await handleExpiredProfileReauth(profile);
        return;
      }

      // Reset loading state, wait for App.tsx to handle navigation
      setTimeout(() => {
        setIsLoading(false);
      }, 100);

    } catch (error) {
      showError('Sign-in failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
      setIsLoading(false);
    }
  };

  // Handle expired profile re-authentication
  const handleExpiredProfileReauth = async (expiredProfile: any) => {
    try {
      setIsLoading(true);


      // Clear the expired auth data first
      if ((window as any).electronAPI?.authOps) {
        try {
          await (window as any).electronAPI.authOps.clearAuthData(expiredProfile.alias);
        } catch (clearError) {
        }
      }

      // Start new GitHub OAuth flow
      setShowProfileSelection(false);
      await handleGhcSignIn();

    } catch (error) {
      showError('Re-authentication failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
      setIsLoading(false);
    }
  };

  const handleUseGitHubAuth = () => {
    setShowProfileSelection(false);
  };

  // Define callback functions
  const handleDeviceCode = useCallback((event: CustomEvent) => {
    if (process.env.NODE_ENV === 'development') {
    }
    const deviceCodeData = event.detail;
    setDeviceCode(deviceCodeData);

    // Set countdown
    setTimeLeft(deviceCodeData.expires_in);

    // Automatically copy device code to clipboard
    if (deviceCodeData.user_code) {
      navigator.clipboard.writeText(deviceCodeData.user_code).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {
        // Clipboard copy failed, user can still manually copy
      });
    }

    // Automatically open GitHub authorization page (via Microsoft SSO)
    if (deviceCodeData.verification_uri) {
      window.open(deviceCodeData.verification_uri, '_blank');
    }

    // Directly show device code interface
    setTimeout(() => {
      setShowGeneratingCode(false);
      setShowGhcDeviceFlow(true);
    }, 800);
  }, []);

  const clearSessionState = () => {
    // Optimization: sessionStorage operations removed, keeping this function for backward compatibility
    // sessionStorage.removeItem('signin-isLoading');
    // sessionStorage.removeItem('signin-showGhcDeviceFlow');
    // sessionStorage.removeItem('signin-deviceCode');
    // sessionStorage.removeItem('signin-showGeneratingCode');
  };

  const handleAuthSuccess = useCallback(async (event: Event) => {
    const customEvent = event as CustomEvent;
    if (process.env.NODE_ENV === 'development') {
    }

    try {
      setShowGhcDeviceFlow(false);

      // 🔥 Fix: Check event source to distinguish between existing user and new user authentication
      const authData = customEvent.detail?.authData; // For existing users (from handleProfileSelect)
      const authInfo = customEvent.detail?.authInfo; // For new users (from Device Flow)
      const eventSource = customEvent.detail?.source || 'unknown';


      // UI cleanup
      setTimeout(async () => {
        setDeviceCode(null);
        setIsLoading(false);
        setShowGeneratingCode(false);
        clearSessionState();

        // 🔥 Case 1: Existing user authentication (from handleProfileSelect with authData)
        if (eventSource.includes('profile') || authData) {
          return;
        }

        // 🔥 Case 2: New user (Device Flow) or skip-login — both are valid successes.
        // Navigation is owned by the gate-watcher effect; nothing to do here.
        if ((eventSource === 'device_flow' && authInfo) || eventSource === 'skip_login') {
          return;
        }

        // 🔥 Case 3: Genuinely unexpected — no recognized source and no auth payload.
        if (!authData && !authInfo) {
          showError('Authentication completed but no data received');
        }
      }, 100);

    } catch (error) {

      // Authentication failed, reset state and show error
      setDeviceCode(null);
      setIsLoading(false);
      setShowGeneratingCode(false);
      clearSessionState();

      const errorMessage = error instanceof Error ? error.message : 'Unknown authentication error';
      showError(`Authentication failed: ${errorMessage}`);
    }
  }, [showSuccess, showError]);

  const handleAuthError = useCallback((event: CustomEvent) => {
    setShowGhcDeviceFlow(false);
    // Reset state
    setDeviceCode(null);
    setTimeLeft(0);
    setIsLoading(false);
    setShowGeneratingCode(false);
    clearSessionState();
    showError('GitHub Copilot authentication failed: ' + (event.detail.message || 'Unknown error'));
  }, [showError]);

  // Listen to GitHub Copilot device code events
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
    }

    // GitHub Copilot is the only auth provider now

    window.addEventListener('ghc:deviceCode', handleDeviceCode as EventListener);
    window.addEventListener('ghc:authSuccess', handleAuthSuccess as EventListener);
    window.addEventListener('ghc:authError', handleAuthError as EventListener);

    return () => {
      if (process.env.NODE_ENV === 'development') {
      }
      window.removeEventListener('ghc:deviceCode', handleDeviceCode as EventListener);
      window.removeEventListener('ghc:authSuccess', handleAuthSuccess as EventListener);
      window.removeEventListener('ghc:authError', handleAuthError as EventListener);
    };
  }, [handleDeviceCode, handleAuthSuccess, handleAuthError]);

  const handleGhcSignIn = async () => {
    if (process.env.NODE_ENV === 'development') {
    }

    // Set state (sessionStorage operations removed for performance)
    setIsLoading(true);
    setShowGeneratingCode(true);

    try {

      // Set up event listeners
      (window as any).electronAPI.auth.onDeviceCodeGenerated((deviceCode: any) => {

        // Trigger device code event
        const deviceCodeEvent = new CustomEvent('ghc:deviceCode', {
          detail: deviceCode
        });
        window.dispatchEvent(deviceCodeEvent);
      });

      (window as any).electronAPI.auth.onDeviceFlowSuccess((data: any) => {

        // Clean up event listeners
        (window as any).electronAPI.auth.removeDeviceFlowListeners();

        // Trigger auth success event
        const authSuccessEvent = new CustomEvent('ghc:authSuccess', {
          detail: {
            authInfo: data.authInfo,
            source: 'device_flow',
            provider: 'ghc'
          }
        });
        window.dispatchEvent(authSuccessEvent);

        setSpinningKey('github');
        setPendingNav(true);
      });

      (window as any).electronAPI.auth.onDeviceFlowError((data: any) => {

        // Clean up event listeners
        (window as any).electronAPI.auth.removeDeviceFlowListeners();

        // Trigger auth error event
        const errorEvent = new CustomEvent('ghc:authError', {
          detail: { message: data.error }
        });
        window.dispatchEvent(errorEvent);
      });

      // Call the main process to start the full Device Flow
      const result = await (window as any).electronAPI.auth.startGhcDeviceFlow();

      if (!result.success) {
        throw new Error(result.error || 'Failed to start device flow');
      }


    } catch (error) {
      setShowGeneratingCode(false);
      showError('GitHub Copilot login failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
      setIsLoading(false);
      clearSessionState();

      // Clean up event listeners
      (window as any).electronAPI.auth.removeDeviceFlowListeners();
    }
  };

  const handleDeviceCodeCancel = () => {
    setShowGhcDeviceFlow(false);
    // Reset state
    setDeviceCode(null);
    setTimeLeft(0);
    setIsLoading(false);
    setShowGeneratingCode(false);
    clearSessionState();
  };

  // Skip Login — use own API key without GitHub Copilot
  const [showProviderSetup, setShowProviderSetup] = useState(false);

  const handleSkipLogin = async () => {
    // Probe whether any non-Copilot provider is already configured under the
    // _local profile. If not, open an inline setup dialog instead of failing
    // — users can't reach Settings before signing in (chicken-and-egg).
    try {
      const probe = await (window as any).electronAPI?.provider?.hasApiKeyProvider?.();
      if (probe && probe.success && probe.data === false) {
        setShowProviderSetup(true);
        return;
      }
    } catch {
      // Probe is best-effort; fall through to attempting the sign-in below.
    }

    try {
      setIsLoading(true);
      setSpinningKey('skip');
      const authManager = new AuthManagerProxy();
      const skipAuthData = createSkipLoginAuthData();
      await authManager.setCurrentAuth(skipAuthData);

      // Trigger authSuccess so the in-page gate watcher navigates once data is ready
      const authSuccessEvent = new CustomEvent('ghc:authSuccess', {
        detail: {
          authInfo: skipAuthData,
          source: 'skip_login',
          provider: 'local',
        },
      });
      window.dispatchEvent(authSuccessEvent);
      setPendingNav(true);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      // Backend rejected skip-login (no provider configured) — surface the
      // setup dialog so the user has a path forward.
      if (msg.toLowerCase().includes('skip login requires')) {
        setShowProviderSetup(true);
      } else {
        showError('Skip login failed: ' + msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyCode = async () => {
    if (deviceCode?.user_code) {
      try {
        await navigator.clipboard.writeText(deviceCode.user_code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (error) {
      }
    }
  };

  const handleOpenGitHub = () => {
    if (deviceCode?.verification_uri) {
      window.open(deviceCode.verification_uri, '_blank');
    }
  };

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Debug code can be removed in production environment
  if (process.env.NODE_ENV === 'development') {
  }

  return (
    <div className="signin-page">
      {/* Animated dot-grid backdrop (sits behind the card at z-0) */}
      <DotGridBackground />
      {/* Radial paper overlay — fades the dots behind the card so it stays legible */}
      <div className="signin-dotgrid-dim" aria-hidden="true" />
      {/* Profile Selection Card */}
      {showProfileSelection && (
        <div className="signin-card-container">
          <Card className="signin-card">
            <CardContent className="pt-8 px-7 pb-7">
              <div className="si-rule" />
              <div className="si-monogram">IS</div>
              <CardTitle className="si-title">Choose your profile</CardTitle>
              <p className="si-tagline">Select an account or sign in with a new one</p>

              <div className="space-y-4 mt-6">
                {/* Valid Users Section */}
                {profilesWithAuth.filter(profile => !profile.isExpired).length > 0 && (
                  <div className="space-y-3">
                    <h5 className="si-section-label">
                      Available accounts ({profilesWithAuth.filter(profile => !profile.isExpired).length})
                    </h5>
                    {profilesWithAuth.filter(profile => !profile.isExpired).map((profile) => (
                      <div
                        key={profile.alias}
                        className="si-profile-row"
                        onClick={() => !isLoading && !pendingNav && handleProfileSelect(profile)}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'var(--si-code-bg)' }}>
                            {profile.authData?.ghcAuth?.user?.avatarUrl ? (
                              <img
                                src={profile.authData.ghcAuth.user.avatarUrl}
                                alt={profile.authData.ghcAuth.user.name}
                                className="w-10 h-10 rounded-full"
                              />
                            ) : (
                              <span style={{ color: 'var(--si-ink)', fontWeight: 600 }}>
                                {profile.authData?.ghcAuth?.user?.name?.charAt(0)?.toUpperCase() || profile.alias.charAt(0).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="flex-1">
                            <h4 className="font-medium" style={{ color: 'var(--si-ink)' }}>
                              {profile.authData?.ghcAuth?.user?.name || profile.alias}
                            </h4>
                            <p className="text-sm" style={{ color: 'var(--si-muted)' }}>
                              @{profile.authData?.ghcAuth?.user?.login || profile.alias}
                            </p>
                            {profile.authData?.ghcAuth?.user?.email && (
                              <p className="text-xs" style={{ color: 'var(--si-faint)' }}>
                                {profile.authData.ghcAuth.user.email}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="si-tag-verified">✓ Verified</div>
                            <div className="text-xs" style={{ color: 'var(--si-faint)' }}>
                              {profile.authData?.ghcAuth?.user?.copilotPlan || 'individual'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Expired Users Section */}
                {profilesWithAuth.filter(profile => profile.isExpired).length > 0 && (
                  <div className="space-y-3">
                    <h5 className="si-section-label">
                      Refresh needed ({profilesWithAuth.filter(profile => profile.isExpired).length})
                    </h5>
                    {profilesWithAuth.filter(profile => profile.isExpired).map((profile) => (
                      <div
                        key={profile.alias}
                        className="si-profile-row"
                        onClick={() => !isLoading && !pendingNav && handleProfileSelect(profile)}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'var(--si-code-bg)' }}>
                            {profile.authData?.ghcAuth?.user?.avatarUrl ? (
                              <img
                                src={profile.authData.ghcAuth.user.avatarUrl}
                                alt={profile.authData.ghcAuth.user.name}
                                className="w-10 h-10 rounded-full opacity-75"
                              />
                            ) : (
                              <span style={{ color: 'var(--si-muted)', fontWeight: 600 }}>
                                {profile.authData?.ghcAuth?.user?.name?.charAt(0)?.toUpperCase() || profile.alias.charAt(0).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="flex-1">
                            <h4 className="font-medium" style={{ color: 'var(--si-ink)' }}>
                              {profile.authData?.ghcAuth?.user?.name || profile.alias}
                            </h4>
                            <p className="text-sm" style={{ color: 'var(--si-muted)' }}>
                              @{profile.authData?.ghcAuth?.user?.login || profile.alias}
                            </p>
                            <p className="text-xs" style={{ color: 'var(--si-faint)' }}>Token expired, click to refresh</p>
                          </div>
                          <div className="text-right">
                            <div className="si-tag-expired">⚠ Expired</div>
                            <div className="text-xs" style={{ color: 'var(--si-faint)' }}>
                              Click to refresh
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="si-divider"><span>or</span></div>

                <Button
                  onClick={handleUseGitHubAuth}
                  className="si-btn-secondary"
                  disabled={isLoading}
                >
                  Sign in with a new GitHub account
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Sign-in Card */}
      {!showProfileSelection && !showGeneratingCode && !showGhcDeviceFlow && (
        <div className="signin-card-container">
          <Card className="signin-card">
            <CardContent className="pt-8 px-7 pb-7">
              <div className="si-rule" />
              <div className="si-monogram">IS</div>
              <CardTitle className="si-title">Welcome to {APP_NAME}</CardTitle>
              <p className="si-tagline">AI Investment Research Workstation</p>

              <div className="mt-6 space-y-1">
                <Button
                  onClick={handleGhcSignIn}
                  className="si-btn-primary"
                  disabled={isLoading || pendingNav}
                >
                  {spinningKey === 'github' ? (
                    <>
                      <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Signing in…
                    </>
                  ) : (
                    'Sign in with GitHub Copilot'
                  )}
                </Button>
              </div>

              <div className="si-divider"><span>or</span></div>

              <Button
                onClick={handleSkipLogin}
                className="si-btn-secondary"
                disabled={isLoading || pendingNav}
              >
                {spinningKey === 'skip' ? 'Signing in…' : 'Use your own API key'}
              </Button>
              <p className="si-footnote">
                Configure OpenAI, DeepSeek &amp; others in Settings
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Generating Device Code Loading State */}
      {showGeneratingCode && !showGhcDeviceFlow && (
        <div className="signin-card-container">
          <Card className="signin-card">
            <CardContent className="pt-8 px-7 pb-7">
              <div className="si-rule" />
              <div className="si-monogram">IS</div>
              <CardTitle className="si-title">Connecting to GitHub…</CardTitle>
              <p className="si-instruction mt-2 mb-5">
                Establishing a secure connection and generating your authorization code.
              </p>
              <div className="flex items-center justify-center space-x-1">
                <div className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--si-ink)' }}></div>
                <div className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--si-gold)', animationDelay: '0.1s' }}></div>
                <div className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--si-ink)', animationDelay: '0.2s' }}></div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* GitHub Copilot Device Code Page */}
      {showGhcDeviceFlow && (
        <div className="signin-card-container">
          <Card className="signin-card">
            <CardContent className="pt-8 px-7 pb-7">
              <div className="si-rule" />
              <CardTitle className="si-title">Authorize on GitHub</CardTitle>
              <p className="si-instruction mt-2 mb-5">
                Enter this code on the GitHub page we opened for you.
              </p>

              <div className="si-code-label">Your device code</div>
              <div className="si-code-row">
                <code className="si-code-chip">{deviceCode?.user_code || ''}</code>
                <Button
                  onClick={handleCopyCode}
                  className="si-btn-secondary"
                  style={{ width: 'auto', padding: '6px 10px' }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>

              <Button onClick={handleOpenGitHub} className="si-btn-primary">
                Open GitHub authorization
              </Button>

              <p className={`si-status${timeLeft <= 60 ? ' si-status--urgent' : ''}`}>
                Expires in {formatTime(timeLeft)} · waiting for approval…
              </p>

              <button type="button" className="si-cancel" onClick={handleDeviceCodeCancel}>
                Cancel
              </button>

              <p className="si-footnote">
                Requires an active GitHub Copilot subscription.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Provider setup modal — opened from skip-login when no provider is configured */}
      {showProviderSetup && (
        <SkipLoginProviderSetup
          onClose={() => setShowProviderSetup(false)}
          onConfigured={async () => {
            setShowProviderSetup(false);
            // Re-attempt skip-login now that a provider exists
            await handleSkipLogin();
          }}
        />
      )}
    </div>
  );
};
/**
 * Minimal inline provider-setup dialog used by Skip Login when no non-Copilot
 * provider has been configured under the _local profile yet. Solves the
 * chicken-and-egg problem where the full Settings → LLM Providers view is
 * only reachable after a successful sign-in.
 */
type SkipProviderId = 'openai' | 'deepseek' | 'ollama' | 'custom-openai';

const SKIP_PROVIDERS: Array<{ id: SkipProviderId; label: string; needsKey: boolean; needsUrl: boolean; defaultUrl: string }> = [
  { id: 'openai', label: 'OpenAI', needsKey: true, needsUrl: false, defaultUrl: 'https://api.openai.com/v1' },
  { id: 'deepseek', label: 'DeepSeek', needsKey: true, needsUrl: false, defaultUrl: 'https://api.deepseek.com/v1' },
  { id: 'ollama', label: 'Ollama (Local)', needsKey: false, needsUrl: true, defaultUrl: 'http://localhost:11434/v1' },
  { id: 'custom-openai', label: 'Custom (OpenAI-compatible)', needsKey: true, needsUrl: true, defaultUrl: '' },
];

const SkipLoginProviderSetup: React.FC<{ onClose: () => void; onConfigured: () => void }> = ({ onClose, onConfigured }) => {
  const [selected, setSelected] = useState<SkipProviderId>('openai');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spec = SKIP_PROVIDERS.find((p) => p.id === selected)!;

  const handleSave = async () => {
    setError(null);
    if (spec.needsKey && !apiKey.trim()) {
      setError('API key is required for this provider.');
      return;
    }
    setBusy(true);
    try {
      const api = (window as any).electronAPI?.provider;
      if (!api) throw new Error('Provider API unavailable');

      const updates: Record<string, unknown> = { enabled: true };
      if (spec.needsKey && apiKey.trim()) updates.apiKey = apiKey.trim();
      if (spec.needsUrl && baseUrl.trim()) updates.baseUrl = baseUrl.trim();
      else if (spec.needsUrl) updates.baseUrl = spec.defaultUrl;

      const saveResult = await api.updateConfig(selected, updates);
      if (!saveResult?.success) throw new Error(saveResult?.error || 'Failed to save provider config');

      const switchResult = await api.switch(selected);
      if (!switchResult?.success) throw new Error(switchResult?.error || 'Failed to activate provider');

      onConfigured();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // NOTE: This modal must remain a DOM descendant of `.signin-page` so the
  // scoped --si-* CSS vars cascade into the .si-rule/.si-title/.si-instruction
  // classes. If this is ever moved to a portal, give those classes explicit
  // values (the inline styles here already carry hex fallbacks).
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40">
      <div
        className="w-full max-w-md p-6"
        style={{
          background: 'var(--si-card, #fffdf9)',
          border: 'none',
          borderRadius: 16,
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        }}
      >
        <div className="si-rule" />
        <h2 className="si-title" style={{ fontSize: 18 }}>Configure an LLM provider</h2>
        <p className="si-instruction mt-2 mb-4">
          Skip Login uses your own API key instead of GitHub Copilot. Choose a provider to continue.
        </p>

        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--si-muted, #8a7f6b)' }}>Provider</label>
        <select
          value={selected}
          onChange={(e) => { setSelected(e.target.value as SkipProviderId); setError(null); }}
          className="w-full rounded px-2 py-1.5 text-sm mb-3"
          style={{ border: '1px solid var(--si-border-strong, #cabfa6)' }}
          disabled={busy}
        >
          {SKIP_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>

        {spec.needsKey && (
          <>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--si-muted, #8a7f6b)' }}>API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full rounded px-2 py-1.5 text-sm mb-3"
              style={{ border: '1px solid var(--si-border-strong, #cabfa6)' }}
              autoComplete="off"
              disabled={busy}
            />
          </>
        )}

        {spec.needsUrl && (
          <>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--si-muted, #8a7f6b)' }}>Base URL</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={spec.defaultUrl || 'https://your-api.example.com/v1'}
              className="w-full rounded px-2 py-1.5 text-sm mb-3"
              style={{ border: '1px solid var(--si-border-strong, #cabfa6)' }}
              autoComplete="off"
              disabled={busy}
            />
          </>
        )}

        {error && (
          <div className="mb-3 text-xs" style={{ color: '#b3261e' }}>{error}</div>
        )}

        <div className="flex justify-end gap-2 mt-2">
          <Button className="si-btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={onClose} disabled={busy}>Cancel</Button>
          <Button className="si-btn-primary" style={{ width: 'auto', padding: '8px 16px' }} onClick={handleSave} disabled={busy}>
            {busy ? 'Saving...' : 'Save & Continue'}
          </Button>
        </div>
      </div>
    </div>
  );
};
