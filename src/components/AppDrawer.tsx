import type { ExchangeLog, WorkOrderDetail } from "../services/workOrderApi";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { DrawerKind, Theme, WorkOrder } from "../types/workOrder";
import {
  fetchDeviceIdentityPreview,
  isNativeRuntime,
  type AuthStatus,
  type DeviceIdentityPreview,
} from "../services/tauri";
import { Icon } from "./Icon";
import { PhotoTile } from "./PhotoTile";
import { StatusBadge } from "./WorkOrderList";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "—";
}

function normalizedExpiry(expiresAt: number | null) {
  if (!expiresAt) return null;
  return expiresAt < 2_000_000_000 ? expiresAt * 1000 : expiresAt;
}

function formatExpiry(expiresAt: number | null) {
  const timestamp = normalizedExpiry(expiresAt);
  if (!timestamp || Number.isNaN(new Date(timestamp).getTime()))
    return "未提供";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "medium",
    hour12: false,
  }).format(timestamp);
}

function remainingExpiry(expiresAt: number | null) {
  const timestamp = normalizedExpiry(expiresAt);
  if (!timestamp) return "登录响应未提供到期时间";
  const milliseconds = timestamp - Date.now();
  if (milliseconds <= 0) return "已到期";
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 60) return `剩余约 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return `剩余约 ${hours} 小时 ${minutes % 60} 分钟`;
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{text(value)}</dd>
    </div>
  );
}

function exchangeLogType(value: unknown) {
  if (String(value) === "80") return "到访不遇";
  return text(value);
}

function exchangeLogContent(log: ExchangeLog) {
  const params = asObject(log.params);
  return text(
    log.content ??
      log.remark ??
      log.exchangeContent ??
      params.remark ??
      params.closeReason,
  );
}

const browserPreview: DeviceIdentityPreview = {
  appId: "com.alibaba.android.rimet",
  appVersion: "8.3.35",
  platform: "Android 16 · zh-CN",
  requestAgent: "DDDigitalCis",
  userAgent: "AliApp(DingTalk/8.3.35) com.alibaba.android.rimet",
  referer: "DingTalk 小程序",
};

function DeviceIdentityPreviewSection() {
  const [preview, setPreview] = useState<DeviceIdentityPreview>(browserPreview);
  const [loading, setLoading] = useState(isNativeRuntime());

  useEffect(() => {
    if (!isNativeRuntime()) return;
    let cancelled = false;
    void fetchDeviceIdentityPreview()
      .then((value) => {
        if (!cancelled) setPreview(value);
      })
      .catch(() => {
        if (!cancelled) setPreview(browserPreview);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="settings-block device-preview">
      <div className="settings-heading">
        <span>设备标识信息预览</span>
        <p>仅展示请求环境，不包含 Token、Cookie 或签名。</p>
      </div>
      <dl className="device-identity-list">
        <div>
          <dt>应用标识</dt>
          <dd>{preview.appId}</dd>
        </div>
        <div>
          <dt>应用版本</dt>
          <dd>{preview.appVersion}</dd>
        </div>
        <div>
          <dt>运行平台</dt>
          <dd>{loading ? "正在读取…" : preview.platform}</dd>
        </div>
        <div>
          <dt>请求代理</dt>
          <dd>{preview.requestAgent}</dd>
        </div>
        <div className="wide">
          <dt>User-Agent</dt>
          <dd>{preview.userAgent}</dd>
        </div>
        <div className="wide">
          <dt>请求来源</dt>
          <dd>{preview.referer}</dd>
        </div>
      </dl>
    </section>
  );
}

export function AppDrawer({
  type,
  order,
  detail,
  detailAjInfo,
  detailLoading,
  detailError,
  theme,
  auth,
  libraryPhotos,
  defaultOperatorName,
  setDefaultOperatorName,
  setTheme,
  onCheckLog,
  onRetryLog,
  onLoadExchangeLogs,
  onRefreshSession,
  onSaveRefreshToken,
  onExportSession,
  onClose,
  onLogout,
}: {
  type: DrawerKind;
  order: WorkOrder | null;
  detail: WorkOrderDetail | null;
  detailAjInfo: Record<string, unknown> | null;
  detailLoading: boolean;
  detailError: string | null;
  theme: Theme;
  auth: AuthStatus;
  libraryPhotos: string[];
  defaultOperatorName: string;
  setDefaultOperatorName: (value: string) => void;
  setTheme: (value: Theme) => void;
  onCheckLog: (id: string) => Promise<{ ok: boolean; message: string }>;
  onRetryLog: (id: string) => Promise<{ ok: boolean; message: string }>;
  onLoadExchangeLogs: (woHeaderId: string) => Promise<ExchangeLog[]>;
  onRefreshSession: () => Promise<AuthStatus>;
  onSaveRefreshToken: (refreshToken: string) => Promise<AuthStatus>;
  onExportSession: (input: {
    verification: "biometric" | "password";
    password?: string;
  }) => Promise<string>;
  onClose: () => void;
  onLogout: () => void;
}) {
  const titles = { detail: "工单详情", gallery: "本机图库", settings: "设置" };
  const header = asObject(detail?.tcisWoHeaderDto);
  const address = asObject(header.addressDetail);
  const userInfo = asObject(header.userinfo);
  const supplypoint = asObject(detailAjInfo?.tcisRsSupplypoint);
  const hasDetail = Boolean(detail);
  const [retryConfirmOpen, setRetryConfirmOpen] = useState(false);
  const [checkingLog, setCheckingLog] = useState(false);
  const [retryingLog, setRetryingLog] = useState(false);
  const [retryMessage, setRetryMessage] = useState("");
  const [exchangeLogs, setExchangeLogs] = useState<ExchangeLog[] | null>(null);
  const [exchangeLogsLoading, setExchangeLogsLoading] = useState(false);
  const [exchangeLogsError, setExchangeLogsError] = useState("");
  const [refreshingSession, setRefreshingSession] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const [refreshTokenInput, setRefreshTokenInput] = useState("");
  const [exportingSession, setExportingSession] = useState(false);
  const [exportedSession, setExportedSession] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [exportVerification, setExportVerification] = useState<
    "biometric" | "password"
  >("biometric");
  const [exportPassword, setExportPassword] = useState("");
  const [drawerDragOffset, setDrawerDragOffset] = useState(0);
  const [drawerDragging, setDrawerDragging] = useState(false);
  const drawerDragStart = useRef<{ pointerId: number; startY: number; startedAt: number } | null>(null);
  const canRetryLog = Boolean(
    order &&
      (order.backendStatusCode === "60" ||
        order.status === "日志失败" ||
        order.status === "已结束"),
  );
  useEffect(() => {
    setExchangeLogs(null);
    setExchangeLogsLoading(false);
    setExchangeLogsError("");
  }, [order?.woHeaderId]);

  const confirmRetryLog = async () => {
    if (!order) return;
    setRetryingLog(true);
    const result = await onRetryLog(order.id);
    setRetryingLog(false);
    setRetryConfirmOpen(false);
    setRetryMessage(result.message);
  };

  const checkBeforeRetryLog = async () => {
    if (!order) return;
    setCheckingLog(true);
    setRetryMessage("");
    try {
      const result = await onCheckLog(order.id);
      setRetryMessage(result.message);
      if (result.ok) setRetryConfirmOpen(true);
    } finally {
      setCheckingLog(false);
    }
  };

  const loadExchangeLogs = async () => {
    if (!order) return;
    setExchangeLogsLoading(true);
    setExchangeLogsError("");
    try {
      setExchangeLogs(await onLoadExchangeLogs(order.woHeaderId));
    } catch (error) {
      setExchangeLogsError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setExchangeLogsLoading(false);
    }
  };

  const beginDrawerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawerDragStart.current = { pointerId: event.pointerId, startY: event.clientY, startedAt: performance.now() };
    setDrawerDragging(true);
  };

  const moveDrawerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = drawerDragStart.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setDrawerDragOffset(Math.max(0, event.clientY - drag.startY));
  };

  const finishDrawerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = drawerDragStart.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const offset = Math.max(0, event.clientY - drag.startY);
    const speed = offset / Math.max(performance.now() - drag.startedAt, 1);
    drawerDragStart.current = null;
    setDrawerDragging(false);
    setDrawerDragOffset(0);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (offset >= 96 || (offset >= 42 && speed >= 0.8)) onClose();
  };

  const cancelDrawerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = drawerDragStart.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drawerDragStart.current = null;
    setDrawerDragging(false);
    setDrawerDragOffset(0);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const refreshSession = async () => {
    setRefreshingSession(true);
    setRefreshMessage("");
    try {
      const status = await onRefreshSession();
      setRefreshMessage(
        `续期成功，新 Token 到期时间：${formatExpiry(status.expiresAt)}`,
      );
    } catch (error) {
      setRefreshMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshingSession(false);
    }
  };

  const saveAndRefreshSession = async () => {
    if (!refreshTokenInput.trim()) {
      setRefreshMessage("请粘贴 refresh_token");
      return;
    }
    setRefreshingSession(true);
    setRefreshMessage("");
    try {
      await onSaveRefreshToken(refreshTokenInput.trim());
      const status = await onRefreshSession();
      setRefreshTokenInput("");
      setRefreshMessage(
        `续期成功，新 Token 到期时间：${formatExpiry(status.expiresAt)}`,
      );
    } catch (error) {
      setRefreshMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshingSession(false);
    }
  };

  useEffect(() => {
    if (!exportedSession) return;
    const clear = window.setTimeout(() => {
      setExportedSession("");
      setExportMessage("导出内容已在 60 秒后自动隐藏");
    }, 60_000);
    return () => window.clearTimeout(clear);
  }, [exportedSession]);

  const exportSession = async () => {
    if (exportVerification === "password" && !exportPassword) {
      setExportMessage("请输入公用密码");
      return;
    }
    setExportingSession(true);
    setExportMessage("");
    try {
      const payload = await onExportSession({
        verification: exportVerification,
        password:
          exportVerification === "password" ? exportPassword : undefined,
      });
      setExportPassword("");
      setExportedSession(payload);
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setExportingSession(false);
    }
  };

  const copyExportedSession = async () => {
    try {
      await navigator.clipboard.writeText(exportedSession);
      setExportMessage("已复制到剪贴板，请妥善保管");
    } catch {
      setExportMessage("复制失败，请长按导出内容手动复制");
    }
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <section
        className={`drawer ${drawerDragging ? "is-dragging" : ""}`}
        style={
          drawerDragOffset
            ? { transform: `translateY(${drawerDragOffset}px)` }
            : undefined
        }
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="drawer-grip"
          onPointerDown={beginDrawerDrag}
          onPointerMove={moveDrawerDrag}
          onPointerUp={finishDrawerDrag}
          onPointerCancel={cancelDrawerDrag}
        >
          <div className="drawer-handle" />
        </div>
        <header>
          <h2>{titles[type]}</h2>
          <button className="icon-button" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {type === "detail" && order && (
          <div className="drawer-content detail-content">
            <div className="detail-hero">
              <StatusBadge status={order.status} />
              <h3>
                {order.resident} · {order.unit}
              </h3>
              <span>
                {detailLoading
                  ? "正在加载 PC 工单详情…"
                  : detailError
                    ? "详情加载失败，以下为列表摘要"
                    : "已加载 PC 完整详情"}
              </span>
            </div>
            <section className="detail-address">
              <span>服务地址</span>
              <b>
                {text(
                  header.addressDetailed ??
                    address.addressDetailed ??
                    order.address,
                )}
              </b>
            </section>
            {detailError ? <p className="detail-error">{detailError}</p> : null}
            <DetailSection title="工单信息">
              <DetailRow
                label="工单号"
                value={header.woNumber ?? order.woNumber}
              />
              <DetailRow label="工单名称" value={header.woName} />
              <DetailRow
                label="工单类型"
                value={[header.woMainTypeName, header.woDetailTypeName]
                  .filter(Boolean)
                  .join(" / ")}
              />
              <DetailRow
                label="状态"
                value={header.statusCode ?? order.backendStatusCode}
              />
              <DetailRow label="安检年度" value={header.securityCheckYear} />
              <DetailRow
                label="来源"
                value={[header.demandsSourceName, header.demandsChannelName]
                  .filter(Boolean)
                  .join(" / ")}
              />
            </DetailSection>
            <DetailSection title="用户与联系人">
              <DetailRow
                label="用户姓名"
                value={header.userName ?? userInfo.userName ?? order.resident}
              />
              <DetailRow
                label="用户编号"
                value={header.userNumber ?? userInfo.userNumber}
              />
              <DetailRow
                label="联系人"
                value={header.contactPerson ?? userInfo.contactPerson}
              />
              <DetailRow
                label="联系电话"
                value={header.contactPhone ?? userInfo.contactPhone}
              />
              <DetailRow
                label="用户类型"
                value={header.userDetailType ?? userInfo.userDetailType}
              />
            </DetailSection>
            <DetailSection title="地址与供气点">
              <DetailRow label="小区" value={address.compoundName} />
              <DetailRow
                label="楼栋"
                value={address.building ?? order.building}
              />
              <DetailRow
                label="单元/楼层/房号"
                value={[
                  address.unitsNumber,
                  address.floorNumber,
                  address.roomNumber,
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
              <DetailRow
                label="供气点"
                value={header.supplyPointId ?? supplypoint.supplypointId}
              />
              <DetailRow
                label="供气点描述"
                value={
                  header.supplyPointDesc ??
                  supplypoint.addrDetailName ??
                  supplypoint.addrDetail
                }
              />
            </DetailSection>
            <DetailSection title="时间与执行">
              <DetailRow label="计划日期" value={header.expectingDate} />
              <DetailRow label="派工时间" value={header.dispatchTime} />
              <DetailRow label="受理时间" value={header.accetpDate} />
              <DetailRow
                label="上次安检"
                value={supplypoint.lastAjTime ?? header.lastAjTime}
              />
              <DetailRow
                label="上次计划安检"
                value={supplypoint.lastPlanAjTime ?? header.lastPlanAjTime}
              />
              <DetailRow label="最近入户" value={header.lastHouseholdTime} />
              <DetailRow label="处理班组" value={header.receivingTeamName} />
              <DetailRow label="负责人" value={header.charegeOfPersonName} />
            </DetailSection>
            <DetailSection title="处理信息">
              <DetailRow label="安检类别" value={header.securityCategory} />
              <DetailRow label="安检模式" value={header.securityMode} />
              <DetailRow
                label="关闭原因"
                value={header.closeReasonName ?? header.closeReason}
              />
              <DetailRow label="备注" value={header.remark} />
              <DetailRow label="客户反馈" value={header.customerFeedback} />
            </DetailSection>
            <section className="detail-exchange-logs">
              <div className="detail-exchange-log-heading">
                <b>流转日志</b>
                <button
                  type="button"
                  disabled={exchangeLogsLoading}
                  onClick={() => void loadExchangeLogs()}
                >
                  <Icon name="refresh" size={14} />
                  {exchangeLogsLoading
                    ? "查询中"
                    : exchangeLogs
                      ? "刷新"
                      : "查看日志"}
                </button>
              </div>
              {exchangeLogsError ? (
                <p className="detail-exchange-log-error">{exchangeLogsError}</p>
              ) : null}
              {exchangeLogs ? (
                exchangeLogs.length ? (
                  <ol className="detail-exchange-log-list">
                    {exchangeLogs.map((log, index) => (
                      <li key={`${text(log.createTime)}-${index}`}>
                        <div>
                          <b>{exchangeLogType(log.exchangeType)}</b>
                          <span>{text(log.createTime)}</span>
                        </div>
                        <p>{exchangeLogContent(log)}</p>
                        <small>
                          {text(log.userName ?? log.createBy ?? log.userNumber)}
                        </small>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="detail-exchange-log-empty">暂无流转日志</p>
                )
              ) : null}
            </section>
            <section className="detail-log-retry">
              <div>
                <b>流转日志补发</b>
                <p>
                  {canRetryLog
                    ? "会先查询是否已有“到访不遇”日志；确认未创建后，再由你确认补发。"
                    : "仅已关闭的工单可以补发流转日志。"}
                </p>
              </div>
              <button
                type="button"
                disabled={!canRetryLog || checkingLog || retryingLog}
                onClick={() => void checkBeforeRetryLog()}
              >
                {checkingLog ? "正在检查…" : "检查并补发日志"}
              </button>
              {retryMessage ? (
                <p className="detail-retry-message">{retryMessage}</p>
              ) : null}
            </section>
            {!hasDetail && !detailLoading ? (
              <p className="empty-hint">暂无详情数据</p>
            ) : null}
          </div>
        )}
        {type === "gallery" && (
          <div className="drawer-content">
            <p className="drawer-tip">
              共 {libraryPhotos.length} 张本机图片，仅用于为当前工单随机补图。
            </p>
            <div className="gallery-grid">
              {libraryPhotos.map((photo, index) => (
                <PhotoTile
                  key={photo}
                  label={photo}
                  tone={["green", "blue", "purple", "gold"][index]}
                />
              ))}
              <button className="add-photo">
                <Icon name="plus" />
                <span>导入图片</span>
              </button>
            </div>
          </div>
        )}
        {type === "settings" && (
          <div className="drawer-content settings-content">
            <section className="settings-block appearance-settings">
              <div className="settings-heading">
                <span>外观设置</span>
                <p>选择 KiDinDin 的界面显示方式。</p>
              </div>
              <div className="theme-select">
                {(["system", "light", "dark"] as Theme[]).map((item) => (
                  <button
                    key={item}
                    className={theme === item ? "active" : ""}
                    onClick={() => setTheme(item)}
                  >
                    <i className={`theme-swatch ${item}`} />
                    <span>
                      {item === "system"
                        ? "跟随系统"
                        : item === "light"
                          ? "浅色"
                          : "深色"}
                    </span>
                  </button>
                ))}
              </div>
            </section>
            <section className="settings-block operator-setting">
              <div className="settings-heading">
                <span>自定义默认流转人</span>
                <p>批量提交与补发日志始终使用此名称，可在确认页继续修改。</p>
              </div>
              <input
                value={defaultOperatorName}
                onChange={(event) => setDefaultOperatorName(event.target.value)}
                placeholder="段鑫"
              />
            </section>
            <section className="settings-block token-refresh">
              <div className="settings-heading">
                <span>Token 续期</span>
                <p>
                  使用登录响应中的 refresh_token 更新当前会话，不会展示 Token
                  内容。
                </p>
              </div>
              <dl className="token-session-list">
                <div>
                  <dt>当前账号</dt>
                  <dd>{auth.username ?? auth.employeeNumber ?? "已登录"}</dd>
                </div>
                <div>
                  <dt>到期时间</dt>
                  <dd>{formatExpiry(auth.expiresAt)}</dd>
                </div>
                <div>
                  <dt>有效期</dt>
                  <dd>{remainingExpiry(auth.expiresAt)}</dd>
                </div>
              </dl>
              {refreshMessage ? (
                <p
                  className={`token-refresh-message ${refreshMessage.startsWith("续期成功") ? "success" : "error"}`}
                >
                  {refreshMessage}
                </p>
              ) : null}
              {auth.refreshAvailable ? (
                <button
                  className="refresh-token-button"
                  disabled={refreshingSession}
                  onClick={() => void refreshSession()}
                >
                  {refreshingSession ? "正在续期…" : "立即续期"}
                </button>
              ) : (
                <>
                  <label className="refresh-token-input">
                    <span>补充 refresh_token</span>
                    <input
                      type="password"
                      value={refreshTokenInput}
                      onChange={(event) =>
                        setRefreshTokenInput(event.target.value)
                      }
                      placeholder="粘贴后不会回显"
                      autoComplete="off"
                    />
                  </label>
                  <button
                    className="refresh-token-button"
                    disabled={refreshingSession}
                    onClick={() => void saveAndRefreshSession()}
                  >
                    {refreshingSession ? "正在续期…" : "保存并立即续期"}
                  </button>
                  <p className="token-refresh-tip">
                    此历史登录建立时未保存
                    refresh_token；补充后会立即续期并更新该历史记录。
                  </p>
                </>
              )}
            </section>
            <section className="settings-block token-export">
              <div className="settings-heading">
                <span>导出当前登录 JSON</span>
                <p>
                  导出包含 access token 与 refresh
                  token，必须完成指纹或公用密码验证后才能查看。
                </p>
              </div>
              <div className="export-verification-tabs">
                <button
                  type="button"
                  className={exportVerification === "biometric" ? "active" : ""}
                  onClick={() => {
                    setExportVerification("biometric");
                    setExportMessage("");
                  }}
                >
                  指纹验证
                </button>
                <button
                  type="button"
                  className={exportVerification === "password" ? "active" : ""}
                  onClick={() => {
                    setExportVerification("password");
                    setExportMessage("");
                  }}
                >
                  公用密码
                </button>
              </div>
              {exportVerification === "password" ? (
                <label className="export-password-input">
                  <span>公用密码</span>
                  <input
                    type="password"
                    value={exportPassword}
                    onChange={(event) => setExportPassword(event.target.value)}
                    placeholder="请输入公用密码"
                    autoComplete="off"
                  />
                </label>
              ) : null}
              <button
                className="export-token-button"
                disabled={exportingSession}
                onClick={() => void exportSession()}
              >
                {exportingSession
                  ? exportVerification === "biometric"
                    ? "正在验证指纹…"
                    : "正在验证密码…"
                  : exportVerification === "biometric"
                    ? "指纹验证后导出"
                    : "验证密码后导出"}
              </button>
              {exportMessage ? (
                <p className="token-export-message">{exportMessage}</p>
              ) : null}
              {exportedSession ? (
                <div className="token-export-result">
                  <textarea
                    value={exportedSession}
                    readOnly
                    aria-label="已验证的当前登录 JSON"
                  />
                  <button
                    type="button"
                    onClick={() => void copyExportedSession()}
                  >
                    复制 JSON
                  </button>
                </div>
              ) : null}
            </section>
            <DeviceIdentityPreviewSection />
            <section className="settings-block session">
              <span>当前会话</span>
              <b>已登录 · 操作员</b>
              <p>登录信息仅保存在此设备，退出后将立即清除。</p>
              <button className="logout-button" onClick={onLogout}>
                <Icon name="logout" size={17} />
                退出登录
              </button>
            </section>
          </div>
        )}
        {retryConfirmOpen &&
          createPortal(
            <div
              className="retry-confirm-backdrop"
              onClick={(event) => {
                event.stopPropagation();
                if (!retryingLog) setRetryConfirmOpen(false);
              }}
            >
              <section
                className="retry-confirm-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="确认补发流转日志"
                onClick={(event) => event.stopPropagation()}
              >
                <h3>确认创建流转日志？</h3>
                <p>
                  刚刚未查询到“到访不遇”流转日志。确认后才会创建；提交前会再次校验，避免重复写入。
                </p>
                <div>
                  <button
                    type="button"
                    disabled={retryingLog}
                    onClick={() => setRetryConfirmOpen(false)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={retryingLog}
                    onClick={() => void confirmRetryLog()}
                  >
                    {retryingLog ? "正在创建…" : "确认创建"}
                  </button>
                </div>
              </section>
            </div>,
            document.body,
          )}
      </section>
    </div>
  );
}
