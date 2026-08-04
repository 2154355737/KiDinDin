import { useEffect, useRef, useState } from "react";
import appIconUrl from "../../src-tauri/icons/icon.png";

const SPLASH_MIN_DURATION_MS = 1_350;
const SPLASH_REDUCED_MOTION_DURATION_MS = 180;
const SPLASH_EXIT_DURATION_MS = 420;

type StartupSplashProps = {
  accent: string;
  onComplete: () => void;
  ready: boolean;
  status: string;
};

export function StartupSplash({
  accent,
  onComplete,
  ready,
  status,
}: StartupSplashProps) {
  const mountedAt = useRef(performance.now());
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!ready) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const minimumDuration = reducedMotion
      ? SPLASH_REDUCED_MOTION_DURATION_MS
      : SPLASH_MIN_DURATION_MS;
    const exitDuration = reducedMotion ? 20 : SPLASH_EXIT_DURATION_MS;
    const elapsed = performance.now() - mountedAt.current;
    const exitDelay = Math.max(0, minimumDuration - elapsed);
    let completeTimer: number | undefined;
    const exitTimer = window.setTimeout(() => {
      setLeaving(true);
      completeTimer = window.setTimeout(onComplete, exitDuration);
    }, exitDelay);

    return () => {
      window.clearTimeout(exitTimer);
      if (completeTimer !== undefined) window.clearTimeout(completeTimer);
    };
  }, [onComplete, ready]);

  return (
    <main
      className={`startup-splash accent-${accent}${leaving ? " is-leaving" : ""}`}
      role="status"
      aria-live="polite"
      aria-label="KiDinDin 正在启动"
    >
      <span className="startup-splash__glow startup-splash__glow--top" />
      <span className="startup-splash__glow startup-splash__glow--bottom" />

      <section className="startup-splash__content">
        <div className="startup-splash__logo-stage" aria-hidden="true">
          <span className="startup-splash__orbit startup-splash__orbit--outer" />
          <span className="startup-splash__orbit startup-splash__orbit--inner" />
          <span className="startup-splash__logo-halo" />
          <img src={appIconUrl} alt="" className="startup-splash__logo" />
        </div>

        <div className="startup-splash__brand">
          <p className="startup-splash__eyebrow">MOBILE WORKSPACE</p>
          <h1>KiDinDin</h1>
          <p>移动工单，清晰有序</p>
        </div>
      </section>

      <footer className="startup-splash__footer">
        <div className="startup-splash__progress" aria-hidden="true">
          <span />
        </div>
        <p>{status}</p>
      </footer>
    </main>
  );
}
