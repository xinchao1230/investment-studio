import React, { useCallback, useEffect, useId, useState } from 'react';
import { SlidersHorizontal, Palette } from 'lucide-react';
import { TintColorPicker } from './TintColorPicker';
import {
  TintColor,
  DEFAULT_TINT_COLOR,
  applyTintColor,
  normalizeTintColor,
} from '../../lib/theme/tintColor';
import '../../styles/Header.css';
import '../../styles/ContentView.css';
import '../../styles/RuntimeSettings.css';
import '../../styles/AppSettings.css';

/**
 * App-level settings page. Currently hosts the Appearance section with the
 * tint-color picker. Reads/writes the global `tintColor` field on AppConfig
 * (app.json) via `window.electronAPI.appConfig` so the choice survives restart,
 * and applies it to the live CSS tokens immediately on change.
 */
export const AppSettings: React.FC = () => {
  const [tint, setTint] = useState<TintColor>(DEFAULT_TINT_COLOR);
  const tintLabelId = useId();

  // Load the persisted tint on mount. Startup already applied it globally; this
  // just syncs the local control to the stored value.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await window.electronAPI?.appConfig?.getAppConfig();
        if (!alive) return;
        if (res?.success && res.data) {
          setTint(normalizeTintColor(res.data.tintColor));
        }
      } catch {
        // Non-fatal: fall back to the default already in state.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleChange = useCallback((next: TintColor) => {
    // 1) Single source of truth for the control.
    setTint(next);
    // 2) Update the live theme immediately (no reload).
    applyTintColor(next);
    // 3) Persist (fire-and-forget; the applied theme is already correct).
    void window.electronAPI?.appConfig
      ?.updateAppConfig({ tintColor: next })
      .catch(() => {
        /* persistence failures are non-fatal for the in-session theme */
      });
  }, []);

  return (
    <div className="runtime-settings-view">
      <div className="unified-header">
        <div className="header-title">
          <SlidersHorizontal size={18} />
          <span className="header-name">Application</span>
        </div>
      </div>

      <div className="content-view-container">
        <div className="settings-form-centered">
          <section className="app-settings-section" aria-labelledby="app-appearance-heading">
            <h2 id="app-appearance-heading" className="app-settings-section-title">
              Appearance
            </h2>

            <div className="app-settings-rows">
              <div className="app-settings-row">
                <span id={tintLabelId} className="app-settings-row-label">
                  <Palette className="app-settings-row-icon" size={18} aria-hidden="true" />
                  Accent color
                </span>
                <div className="app-settings-row-value">
                  <TintColorPicker
                    value={tint}
                    onChange={handleChange}
                    triggerId={`${tintLabelId}-trigger`}
                  />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default AppSettings;
