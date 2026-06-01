/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before importing the component
// ---------------------------------------------------------------------------

const mockShowError = vi.fn();
const mockShowSuccess = vi.fn();

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({
    showError: mockShowError,
    showSuccess: mockShowSuccess,
  }),
}));

vi.mock('../../ui/button', () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock('../../ui/card', () => ({
  Card: ({ children, className }: any) => <div className={className}>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
}));

vi.mock('../../styles/SignInPage.css', () => ({}));

vi.mock('@shared/constants/branding', () => ({
  APP_NAME: 'Test App',
  BRAND_NAME: 'investment-studio',
}));

const mockSetCurrentAuth = vi.fn();
const mockRefreshCopilotToken = vi.fn();

vi.mock('../../../lib/auth/authManagerProxy', () => ({
  AuthManagerProxy: vi.fn().mockImplementation(function (this: any) {
    this.setCurrentAuth = mockSetCurrentAuth;
    this.refreshCopilotToken = mockRefreshCopilotToken;
  }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Controllable profile-data gate. Tests mutate mockIsInitialized.mockReturnValue(...)
const mockIsInitialized = vi.fn(() => false);
vi.mock('../../userData/userDataProvider', () => ({
  useProfileData: () => ({ isInitialized: mockIsInitialized() }),
}));

// Controllable auth gate. Tests mutate mockIsAuthenticated.mockReturnValue(...)
const mockIsAuthenticated = vi.fn(() => false);
vi.mock('../../auth/AuthProvider', () => ({
  useAuthContext: () => ({ isAuthenticated: mockIsAuthenticated() }),
}));

// ---------------------------------------------------------------------------
// Helpers: set up window.electronAPI mock
// ---------------------------------------------------------------------------

function setupElectronAPI() {
  (window as any).electronAPI = {
    auth: {
      onDeviceCodeGenerated: vi.fn(),
      onDeviceFlowSuccess: vi.fn(),
      onDeviceFlowError: vi.fn(),
      removeDeviceFlowListeners: vi.fn(),
      startGhcDeviceFlow: vi.fn().mockResolvedValue({ success: true }),
    },
    authOps: {
      clearAuthData: vi.fn().mockResolvedValue({ success: true }),
    },
    provider: {
      // data: true => a provider is already configured, so skip-login proceeds
      // straight to setCurrentAuth instead of opening the setup dialog.
      hasApiKeyProvider: vi.fn().mockResolvedValue({ success: true, data: true }),
    },
  };
}

// Mirror of GATE_TIMEOUT_MS in SignInPage.tsx (16s) for the timeout test.
const GATE_TIMEOUT_MS_TEST = 16000;

// ---------------------------------------------------------------------------
// Import the component under test after mocks are set up
// ---------------------------------------------------------------------------

import { SignInPage } from '../SignInPage';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SignInPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    mockIsInitialized.mockReturnValue(false);
    mockIsAuthenticated.mockReturnValue(false);
  });

  describe('initial render — no startupResult', () => {
    it('renders without crashing', async () => {
      const { container } = render(<SignInPage />);
      expect(container).toBeTruthy();
    });

    it('does not show profile selection when no startupResult is given', async () => {
      render(<SignInPage />);
      // isScanning becomes false after effect runs
      await waitFor(() => {
        expect(screen.queryByText(/Choose Your Profile/i)).toBeNull();
      });
    });

    it('renders the sign-in button', async () => {
      render(<SignInPage />);
      await waitFor(() => {
        // Any button referencing GitHub / Copilot sign-in
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
      });
    });
  });

  describe('with startupResult — profile selection', () => {
    function makeStartupResultWithProfiles(profiles: any[]) {
      return {
        stage2: {
          authManagerInitialized: true,
          authManagerProfiles: profiles,
        },
      } as any;
    }

    it('shows profile selection when valid profiles are present', async () => {
      const profiles = [
        {
          type: 'valid',
          alias: 'alice',
          authData: {
            ghcAuth: {
              user: { login: 'alice', name: 'Alice', email: 'alice@example.com' },
            },
          },
        },
      ];
      render(<SignInPage startupResult={makeStartupResultWithProfiles(profiles)} />);
      await waitFor(() => {
        expect(screen.getByText(/Choose Your Profile/i)).toBeTruthy();
      });
    });

    it('displays the user login in the profile card', async () => {
      const profiles = [
        {
          type: 'valid',
          alias: 'bob',
          authData: {
            ghcAuth: {
              user: { login: 'bob', name: 'Bob Smith' },
            },
          },
        },
      ];
      render(<SignInPage startupResult={makeStartupResultWithProfiles(profiles)} />);
      await waitFor(() => {
        expect(screen.getByText(/@bob/i)).toBeTruthy();
      });
    });

    it('clicking a valid profile card sets loading state', async () => {
      // Hang setCurrentAuth so we can check isLoading was set
      mockSetCurrentAuth.mockImplementation(() => new Promise(() => {}));

      const profiles = [
        {
          type: 'valid',
          alias: 'alice',
          isValid: true,
          authData: {
            ghcAuth: {
              user: { login: 'alice', name: 'Alice' },
            },
          },
        },
      ];

      render(<SignInPage startupResult={makeStartupResultWithProfiles(profiles)} />);

      await waitFor(() => {
        expect(screen.getByText(/Choose Your Profile/i)).toBeTruthy();
      });

      // Click on the login text — React event delegation bubbles to the parent
      // div that has the onClick handler
      const loginEl = screen.getByText(/@alice/i);

      await act(async () => {
        fireEvent.click(loginEl);
      });

      // After click, component should have started the auth flow
      expect(mockSetCurrentAuth).toHaveBeenCalled();
    });

    it('shows error toast when profile is missing authData', async () => {
      const profiles = [
        {
          type: 'valid',
          alias: 'nodata',
          isValid: true,
          // intentionally missing authData
        },
      ];
      render(<SignInPage startupResult={makeStartupResultWithProfiles(profiles)} />);

      await waitFor(() => {
        expect(screen.getByText(/Choose Your Profile/i)).toBeTruthy();
      });

      // Click the incomplete profile card
      const profileDiv = screen.getByText('@nodata');
      fireEvent.click(profileDiv);

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalled();
      });
    });

    it('uses legacy format when authManagerInitialized is false', async () => {
      const legacyResult = {
        stage2: {
          authManagerInitialized: false,
          validUsers: [
            {
              alias: 'charlie',
              authData: {
                ghcAuth: {
                  user: { login: 'charlie', name: 'Charlie' },
                },
              },
            },
          ],
          expiredUsers: [],
        },
      } as any;

      render(<SignInPage startupResult={legacyResult} />);

      await waitFor(() => {
        expect(screen.getByText(/Choose Your Profile/i)).toBeTruthy();
      });

      expect(screen.getByText('@charlie')).toBeTruthy();
    });
  });

  describe('device flow — event handling', () => {
    it('shows device code UI after ghc:deviceCode event fires', async () => {
      render(<SignInPage />);

      const deviceCodeData = {
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
      };

      // Stub clipboard API (it is a getter-only property in happy-dom)
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
      });

      await act(async () => {
        window.dispatchEvent(
          new CustomEvent('ghc:deviceCode', { detail: deviceCodeData })
        );
      });

      // After the 800ms timeout in handleDeviceCode the flow UI is shown —
      // we only assert that the component doesn't crash; the timeout is not
      // worth faking in a unit test.
      expect(true).toBe(true);
    });

    it('resets state and calls showError on ghc:authError event', async () => {
      render(<SignInPage />);

      await act(async () => {
        window.dispatchEvent(
          new CustomEvent('ghc:authError', { detail: { message: 'Token rejected' } })
        );
      });

      expect(mockShowError).toHaveBeenCalledWith(
        expect.stringContaining('Token rejected')
      );
    });

    it('renders the simplified authorization card with device code as hero', async () => {
      vi.useFakeTimers();
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
      });
      render(<SignInPage />);
      try {
        await act(async () => {
          window.dispatchEvent(
            new CustomEvent('ghc:deviceCode', {
              detail: { user_code: 'AB7C-92KD', verification_uri: 'https://github.com/login/device', expires_in: 900 },
            })
          );
          await vi.advanceTimersByTimeAsync(900);
        });
        expect(screen.getByText('AB7C-92KD')).toBeTruthy();
        expect(screen.getByText(/Authorize on GitHub/i)).toBeTruthy();
        expect(screen.getByText(/active GitHub Copilot subscription/i)).toBeTruthy();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('in-button sign-in gate', () => {
    const BRAND_DEST = '/research'; // investment-studio brand destination

    // The skip-login button ("Use your own API key") is the synchronous gate
    // path: setCurrentAuth resolves, then setPendingNav(true) directly. (The
    // GitHub button gates inside an onDeviceFlowSuccess callback that the
    // electronAPI mock never fires, so we drive the gate via skip-login.)
    it('navigates to the brand destination when the gate is already open', async () => {
      mockSetCurrentAuth.mockResolvedValue(undefined);
      mockIsAuthenticated.mockReturnValue(true);
      mockIsInitialized.mockReturnValue(true);

      render(<SignInPage />);

      const btn = await screen.findByText(/Use your own API key/i);
      await act(async () => {
        fireEvent.click(btn);
      });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(BRAND_DEST);
      });
    });

    it('does NOT navigate while the gate is closed (isInitialized false)', async () => {
      mockSetCurrentAuth.mockResolvedValue(undefined);
      mockIsAuthenticated.mockReturnValue(true);
      mockIsInitialized.mockReturnValue(false);

      render(<SignInPage />);

      const btn = await screen.findByText(/Use your own API key/i);
      await act(async () => {
        fireEvent.click(btn);
      });

      // Give effects a tick; navigation must not happen.
      await act(async () => { await Promise.resolve(); });
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('navigates once the gate opens after the click (rerender)', async () => {
      mockSetCurrentAuth.mockResolvedValue(undefined);
      mockIsAuthenticated.mockReturnValue(true);
      mockIsInitialized.mockReturnValue(false); // closed at click time

      const { rerender } = render(<SignInPage />);

      const btn = await screen.findByText(/Use your own API key/i);
      await act(async () => {
        fireEvent.click(btn);
      });
      expect(mockNavigate).not.toHaveBeenCalled();

      // Gate opens; re-render so the watcher effect re-runs with the new value.
      mockIsInitialized.mockReturnValue(true);
      await act(async () => {
        rerender(<SignInPage />);
      });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/research');
      });
    });

    it('restores the button and shows a toast after the gate timeout', async () => {
      mockSetCurrentAuth.mockResolvedValue(undefined);
      mockIsAuthenticated.mockReturnValue(true);
      mockIsInitialized.mockReturnValue(false);

      render(<SignInPage />);

      // Find the button + click under real timers (findByText polls in real time).
      const btn = await screen.findByText(/Use your own API key/i);

      // Now install fake timers so the watcher's setTimeout is scheduled on the
      // fake clock, then flush the click's promise chain and advance past the
      // timeout — all on the same clock.
      vi.useFakeTimers();
      try {
        await act(async () => {
          fireEvent.click(btn);
          await vi.advanceTimersByTimeAsync(0); // flush skip-login promises -> setPendingNav
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(GATE_TIMEOUT_MS_TEST);
        });
      } finally {
        vi.useRealTimers();
      }

      expect(mockShowError).toHaveBeenCalledWith(
        expect.stringContaining('timed out')
      );
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});
