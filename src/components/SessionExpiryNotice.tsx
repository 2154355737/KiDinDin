import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";

type SessionExpiryNoticeBaseProps = {
  expiresAt: number | null;
  error?: string | null;
  onClose: () => void;
  className?: string;
};

type RefreshableSessionProps = {
  refreshAvailable: true;
  refreshing?: boolean;
  onRefresh: () => void | Promise<unknown>;
  canOpenSettings?: never;
  onOpenSettings?: never;
};

type SettingsRecoveryProps = {
  refreshAvailable: false;
  canOpenSettings: true;
  onOpenSettings: () => void;
  refreshing?: never;
  onRefresh?: never;
};

type LoginRecoveryProps = {
  refreshAvailable: false;
  canOpenSettings?: false;
  onOpenSettings?: never;
  onRelogin: () => void | Promise<unknown>;
  refreshing?: never;
  onRefresh?: never;
};

export type SessionExpiryNoticeProps = SessionExpiryNoticeBaseProps & (
  | RefreshableSessionProps
  | SettingsRecoveryProps
  | LoginRecoveryProps
);

const SESSION_EXPIRY_NOTICE_STYLES = `
.session-expiry-notice {
  position: relative;
  z-index: 21;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) 44px;
  gap: 10px;
  align-items: start;
  padding: 12px 10px 12px 12px;
  margin: 0 0 12px;
  border: 1px solid #f0c77f;
  border-radius: 14px;
  background: #fff9ed;
  color: #49371e;
  box-shadow: 0 8px 24px rgb(92 60 17 / 10%);
}
.session-expiry-notice-icon {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 11px;
  background: #ffedcb;
  color: #b86a12;
}
.session-expiry-notice-copy {
  min-width: 0;
  display: grid;
  gap: 4px;
  padding-top: 1px;
}
.session-expiry-notice-copy b {
  font-size: 13px;
  line-height: 1.35;
}
.session-expiry-notice-copy p {
  margin: 0;
  color: #765b36;
  font-size: 11px;
  line-height: 1.5;
}
.session-expiry-notice-copy .session-expiry-error {
  color: #b33b43;
  word-break: break-word;
}
.session-expiry-notice-close {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  margin: -4px -4px 0 0;
  padding: 0;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: #826b4d;
  touch-action: manipulation;
}
.session-expiry-notice-close:active {
  background: rgb(184 106 18 / 10%);
}
.session-expiry-notice-actions {
  grid-column: 2 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
}
.session-expiry-notice-action {
  min-height: 44px;
  min-width: 112px;
  padding: 0 16px;
  border: 0;
  border-radius: 12px;
  background: #c87417;
  color: #fff;
  font-size: 12px;
  font-weight: 750;
  touch-action: manipulation;
}
.session-expiry-notice-action:disabled {
  opacity: .58;
}
.theme-dark .session-expiry-notice {
  border-color: #3a342a;
  background: #0c0c0c;
  color: #f4f4f4;
  box-shadow: 0 10px 28px rgb(0 0 0 / 34%);
}
.theme-dark .session-expiry-notice-icon {
  background: #251b0e;
  color: #ffb65e;
}
.theme-dark .session-expiry-notice-copy p {
  color: #bdb5aa;
}
.theme-dark .session-expiry-notice-copy .session-expiry-error {
  color: #ff9da4;
}
.theme-dark .session-expiry-notice-close {
  color: #bdb5aa;
}
.theme-dark .session-expiry-notice-close:active {
  background: #242424;
}
.theme-dark .session-expiry-notice-action {
  background: #d78325;
  color: #fff;
}
`;

function normalizedExpiry(expiresAt: number | null) {
  if (!expiresAt || !Number.isFinite(expiresAt)) return null;
  return expiresAt < 2_000_000_000 ? expiresAt * 1_000 : expiresAt;
}

function remainingText(expiresAt: number | null, now: number) {
  const expiry = normalizedExpiry(expiresAt);
  if (!expiry) return "无法读取 Token 到期时间";

  const remaining = expiry - now;
  if (remaining <= 0) return "Token 已到期";

  const minutes = Math.ceil(remaining / 60_000);
  if (minutes <= 1) return "Token 将在 1 分钟内到期";
  if (minutes < 60) return `Token 剩余约 ${minutes} 分钟`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes
      ? `Token 剩余约 ${hours} 小时 ${remainingMinutes} 分钟`
      : `Token 剩余约 ${hours} 小时`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours
    ? `Token 剩余约 ${days} 天 ${remainingHours} 小时`
    : `Token 剩余约 ${days} 天`;
}

export function SessionExpiryNotice(props: SessionExpiryNoticeProps) {
  const [now, setNow] = useState(Date.now());
  const [localRefreshing, setLocalRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  useEffect(() => {
    setNow(Date.now());
    setRefreshError("");
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [props.expiresAt]);

  const expiry = normalizedExpiry(props.expiresAt);
  const expired = expiry !== null && expiry <= now;
  const remaining = useMemo(() => remainingText(props.expiresAt, now), [now, props.expiresAt]);
  const displayedError = props.error?.trim() || refreshError;
  const externallyRefreshing = props.refreshAvailable && Boolean(props.refreshing);
  const refreshing = localRefreshing || externallyRefreshing;

  const refreshSession = async () => {
    if (!props.refreshAvailable || refreshing) return;
    setLocalRefreshing(true);
    setRefreshError("");
    try {
      await props.onRefresh();
    } catch (error) {
      setRefreshError(`续期失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLocalRefreshing(false);
    }
  };

  const relogin = async () => {
    if (!("onRelogin" in props) || refreshing) return;
    setLocalRefreshing(true);
    setRefreshError("");
    try {
      await props.onRelogin();
    } catch (error) {
      setRefreshError(`重新登录失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLocalRefreshing(false);
    }
  };

  const recoveryHint = props.refreshAvailable
    ? "可以直接续期，不会中断当前页面。"
    : props.canOpenSettings
      ? "当前登录未保存 refresh_token，请打开设置补充后续期。"
      : "当前登录无法自动续期，请重新登录。";

  return <>
    <style>{SESSION_EXPIRY_NOTICE_STYLES}</style>
    <aside
      className={`session-expiry-notice${props.className ? ` ${props.className}` : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="session-expiry-notice-icon"><Icon name="clock" size={19} /></span>
      <div className="session-expiry-notice-copy">
        <b>{expired ? "登录已到期" : "登录即将到期"}</b>
        <p>{remaining}</p>
        <p>{recoveryHint}</p>
        {displayedError ? <p className="session-expiry-error" role="alert">{displayedError}</p> : null}
      </div>
      <button type="button" className="session-expiry-notice-close" aria-label="关闭登录到期提醒" onClick={props.onClose}>
        <Icon name="close" size={18} />
      </button>
      <div className="session-expiry-notice-actions">
        {props.refreshAvailable ? <button
          type="button"
          className="session-expiry-notice-action"
          disabled={refreshing}
          onClick={() => void refreshSession()}
        >{refreshing ? "正在续期…" : "一键续期"}</button> : props.canOpenSettings ? <button
          type="button"
          className="session-expiry-notice-action"
          onClick={props.onOpenSettings}
        >打开设置</button> : <button
          type="button"
          className="session-expiry-notice-action"
          disabled={refreshing}
          onClick={() => void relogin()}
        >{refreshing ? "正在退出…" : "重新登录"}</button>}
      </div>
    </aside>
  </>;
}
