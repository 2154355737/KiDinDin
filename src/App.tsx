import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { AppDrawer } from "./components/AppDrawer";
import { PrimaryNav } from "./components/Navigation";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { StatsPage } from "./pages/StatsPage";
import { SubmitPage } from "./pages/SubmitPage";
import { ConfirmPage, ModePage, PreparePage, RecordsPage, RunningPage } from "./pages/WorkflowPages";
import { configureAuthSession, exportAuthSession, fetchAuthHistory, fetchAuthStatus, logoutAuth, refreshAuthSession, restoreAuthHistory, setAuthRefreshToken, type AuthHistoryItem } from "./services/authApi";
import {
  closeSecurityCheckWorkOrder,
  createWorkOrderExchangeLog,
  downloadWorkOrderFile,
  fetchHistoricalWorkOrders,
  fetchWorkOrderDetail,
  fetchWorkOrderExchangeLogs,
  fetchWorkOrderFiles,
  fetchWorkOrderUserAjInfo,
  fetchWorkOrders,
  uploadWorkOrderFiles,
  type CisWorkOrder,
  type UploadedFile,
  type WorkOrderDetail,
} from "./services/workOrderApi";
import { isNativeRuntime, type AuthStatus } from "./services/tauri";
import { getWorkOrderStatus, matchesWorkOrderStatus, workOrderStatusOptions, type DrawerKind, type MainTab, type OrderStatus, type Screen, type Theme, type WorkOrder, type WorkOrderStatusFilter } from "./types/workOrder";

const CLOSE_REASON_UNREACHABLE = "11";
const EXCHANGE_TYPE_UNREACHABLE = "80";
const DEFAULT_OPERATOR_NAME_STORAGE_KEY = "kidindin.default-operator-name";

type HistoryPhotoCandidate = {
  file: File;
  historyLabel: string;
  id: string;
  originalName: string;
  previewUrl: string;
};

type HistoryPhotoCacheEntry = {
  error: string | null;
  photos: HistoryPhotoCandidate[];
};

function textField(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function historyTimestamp(order: Record<string, unknown>) {
  const value = textField(order.actualEndDate) || textField(order.updateTime) || textField(order.createTime);
  const timestamp = Date.parse(value.replace(/-/g, "/"));
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function photoBizIds(order: Record<string, unknown>) {
  return [...new Set([order.closeAttachBizId, order["closeAttachBizId-11"], order.woHeaderId].map(textField).filter(Boolean))];
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function toUiOrder(source: CisWorkOrder): WorkOrder {
  const address = source.addressDetail ?? {};
  const building = String(source.building ?? address.building ?? "未标注楼栋");
  const unit = [source.building ?? address.building, source.unitsNumber ?? address.unitsNumber, source.floorNumber ?? address.floorNumber, source.roomNumber ?? address.roomNumber]
    .filter(Boolean).join(" ") || "地址信息待补充";
  const backendStatusCode = String(source.statusCode ?? "");
  return {
    address: String(source.addressDetailed ?? address.addressDetailed ?? "未提供服务地址"),
    backendStatusCode,
    building,
    id: source.woNumber || source.woHeaderId,
    raw: source,
    resident: String(source.userName ?? source.contactPerson ?? "未命名用户"),
    searchText: [source.woNumber, source.userName, source.contactPerson, source.contactPhone, source.addressDetailed, source.userNumber, source.building, source.roomNumber].filter(Boolean).join(" ").toLowerCase(),
    status: getWorkOrderStatus(backendStatusCode),
    time: source.expectingDate?.slice(11, 16) || "待安排",
    unit,
    unitNumber: String(source.unitsNumber ?? address.unitsNumber ?? "未标注单元"),
    woHeaderId: source.woHeaderId,
    woNumber: source.woNumber,
  };
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isUnreachableExchangeLog(log: Record<string, unknown>) {
  return String(log.exchangeType ?? "") === EXCHANGE_TYPE_UNREACHABLE || JSON.stringify(log).includes("到访不遇");
}

function FilterPicker({ label, value, allLabel, options, open, onToggle, onSelect }: {
  label: string;
  value: string;
  allLabel: string;
  options: string[];
  open: boolean;
  onToggle: () => void;
  onSelect: (value: string) => void;
}) {
  return <div className="filter-picker"><span>{label}</span><button type="button" className="filter-picker-trigger" onClick={onToggle} aria-expanded={open}>{value === "all" ? allLabel : value}<ChevronDown className="filter-picker-icon" size={16} strokeWidth={2.2} /></button>{open && <div className="filter-picker-menu"><button type="button" className={value === "all" ? "active" : ""} onClick={() => onSelect("all")}>{allLabel}</button>{options.map((option) => <button type="button" key={option} className={value === option ? "active" : ""} onClick={() => onSelect(option)}>{option}</button>)}</div>}</div>;
}

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authHistory, setAuthHistory] = useState<AuthHistoryItem[]>([]);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [screen, setScreen] = useState<Screen>("orders");
  const [mainTab, setMainTab] = useState<MainTab>("home");
  const [theme, setTheme] = useState<Theme>("system");
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<WorkOrderStatusFilter>("all");
  const [buildingFilter, setBuildingFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const [openFilterPicker, setOpenFilterPicker] = useState<"building" | "unit" | null>(null);
  const [selectedDate, setSelectedDate] = useState(today());
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [batchOrderIds, setBatchOrderIds] = useState<string[]>([]);
  const [activeOrderId, setActiveOrderId] = useState("");
  const [historyFiles, setHistoryFiles] = useState<Record<string, File>>({});
  const [historyMode, setHistoryMode] = useState<"manual" | "auto">("manual");
  const [submitMode, setSubmitMode] = useState<"manual" | "historical">("manual");
  const [submitIntervalMinSeconds, setSubmitIntervalMinSeconds] = useState(5);
  const [submitIntervalMaxSeconds, setSubmitIntervalMaxSeconds] = useState(10);
  const [historyPhotos, setHistoryPhotos] = useState<HistoryPhotoCandidate[]>([]);
  const [historyPhotoLoading, setHistoryPhotoLoading] = useState(false);
  const [historyPhotoError, setHistoryPhotoError] = useState<string | null>(null);
  const [historyPhotoCache, setHistoryPhotoCache] = useState<Record<string, HistoryPhotoCacheEntry>>({});
  const [libraryFile, setLibraryFile] = useState<File | null>(null);
  const [reason, setReason] = useState("到访不遇-有居住痕迹");
  const [remark, setRemark] = useState("");
  const [customOperatorName, setCustomOperatorName] = useState(() => localStorage.getItem(DEFAULT_OPERATOR_NAME_STORAGE_KEY)?.trim() || "段鑫");
  const [drawer, setDrawer] = useState<DrawerKind | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [runMessage, setRunMessage] = useState("等待开始");
  const [detail, setDetail] = useState<WorkOrderDetail | null>(null);
  const [detailAjInfo, setDetailAjInfo] = useState<Record<string, unknown> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loggedIn = Boolean(auth?.authenticated);
  const appliedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const operatorName = customOperatorName.trim() || "段鑫";
  const activeOrder = orders.find((order) => order.id === activeOrderId) ?? orders[0];
  const activeHistoryFile = activeOrder ? historyFiles[activeOrder.id] ?? null : null;
  const selectedOrders = useMemo(() => orders.filter((order) => selected.includes(order.id) && order.backendStatusCode === "20"), [orders, selected]);
  const pendingSelectedIds = useMemo(() => selectedOrders.map((order) => order.id), [selectedOrders]);
  const batchOrders = useMemo(() => orders.filter((order) => batchOrderIds.includes(order.id)), [batchOrderIds, orders]);
  const filteredOrders = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return orders.filter((order) =>
      (!keyword || order.searchText.includes(keyword)) &&
      matchesWorkOrderStatus(order.backendStatusCode, statusFilter) &&
      (buildingFilter === "all" || order.building === buildingFilter) &&
      (unitFilter === "all" || order.unitNumber === unitFilter)
    );
  }, [buildingFilter, orders, query, statusFilter, unitFilter]);
  const buildingOptions = useMemo(
    () => [...new Set(orders.map((order) => order.building).filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-CN")),
    [orders]
  );
  const unitOptions = useMemo(
    () => [...new Set(orders.filter((order) => buildingFilter === "all" || order.building === buildingFilter).map((order) => order.unitNumber).filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-CN")),
    [buildingFilter, orders]
  );
  const pendingSubmitOrders = useMemo(() => filteredOrders.filter((order) => order.backendStatusCode === "20"), [filteredOrders]);

  useEffect(() => {
    if (unitFilter !== "all" && !unitOptions.includes(unitFilter)) setUnitFilter("all");
  }, [unitFilter, unitOptions]);

  const loadOrders = useCallback(async () => {
    if (!loggedIn) return;
    setLoadingOrders(true); setLoadError(null);
    try {
      const response = await fetchWorkOrders(`${selectedDate} 00:00:00`);
      const next = response.data.map(toUiOrder);
      setOrders(next);
      setBuildingFilter((current) => current === "all" || next.some((order) => order.building === current) ? current : "all");
      setUnitFilter((current) => current === "all" || next.some((order) => order.unitNumber === current) ? current : "all");
      setSelected((current) => current.filter((id) => next.some((order) => order.id === id && order.backendStatusCode === "20")));
      setActiveOrderId((current) => next.some((order) => order.id === current) ? current : (next[0]?.id ?? ""));
    } catch (error) {
      setOrders([]); setLoadError(messageOf(error));
    } finally { setLoadingOrders(false); }
  }, [loggedIn, selectedDate]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => setSystemDark(media.matches);
    media.addEventListener("change", syncTheme);
    return () => media.removeEventListener("change", syncTheme);
  }, []);
  useEffect(() => { localStorage.setItem(DEFAULT_OPERATOR_NAME_STORAGE_KEY, customOperatorName.trim() || "段鑫"); }, [customOperatorName]);
  useEffect(() => {
    if (!isNativeRuntime()) {
      setAuth({ authenticated: false, employeeNumber: null, expiresAt: null, refreshAvailable: false, username: null });
      setLoginError("当前是浏览器预览，原生登录不可用。请安装并打开 KiDinDin APK 后再粘贴凭据。");
      return;
    }
    void fetchAuthStatus().then(setAuth).catch(() => setAuth({ authenticated: false, employeeNumber: null, expiresAt: null, refreshAvailable: false, username: null }));
    void fetchAuthHistory().then(setAuthHistory).catch(() => setAuthHistory([]));
  }, []);
  useEffect(() => { void loadOrders(); }, [loadOrders]);
  useEffect(() => {
    const cached = historyPhotoCache[activeOrderId];
    setHistoryPhotos(cached?.photos ?? []);
    setHistoryPhotoError(cached?.error ?? null);
  }, [activeOrderId, historyPhotoCache]);
  useEffect(() => {
    if (drawer !== "detail" || !activeOrder) return;
    let cancelled = false;
    setDetail(null); setDetailAjInfo(null); setDetailError(null); setDetailLoading(true);
    void fetchWorkOrderDetail(activeOrder.woHeaderId)
      .then(async (response) => {
        if (cancelled) return;
        setDetail(response.data);
        const header = response.data.tcisWoHeaderDto;
        const headerFields = (header ?? {}) as Record<string, unknown>;
        const userInfo = (headerFields.userinfo ?? {}) as Record<string, unknown>;
        const userInfoId = String(headerFields.userinfoId ?? userInfo.userInfoId ?? "");
        const supplypointId = String(headerFields.supplyPointId ?? headerFields.supplypointId ?? "");
        if (userInfoId && supplypointId) {
          const ajResponse = await fetchWorkOrderUserAjInfo(userInfoId, supplypointId);
          if (!cancelled) setDetailAjInfo(ajResponse.data);
        }
      })
      .catch((error) => { if (!cancelled) setDetailError(messageOf(error)); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [activeOrder, drawer]);

  const login = async (input: { tokenText: string; cookie: string; sign: string; target: string }) => {
    setLoggingIn(true); setLoginError(null);
    try {
      const status = await configureAuthSession(input);
      setAuth(status);
      void fetchAuthHistory().then(setAuthHistory).catch(() => undefined);
    } catch (error) { setLoginError(messageOf(error)); }
    finally { setLoggingIn(false); }
  };

  const loginWithHistory = async (id: string) => {
    setLoggingIn(true); setLoginError(null);
    try {
      const status = await restoreAuthHistory(id);
      setAuth(status);
      void fetchAuthHistory().then(setAuthHistory).catch(() => undefined);
    } catch (error) { setLoginError(messageOf(error)); }
    finally { setLoggingIn(false); }
  };

  const setOrderStatus = (id: string, status: OrderStatus, backendStatusCode?: string) => setOrders((current) => current.map((order) => order.id === id ? { ...order, backendStatusCode: backendStatusCode ?? order.backendStatusCode, status } : order));
  const hasUnreachableExchangeLog = async (order: WorkOrder) => {
    const logs = await fetchWorkOrderExchangeLogs(order.woHeaderId);
    return logs.some((log) => isUnreachableExchangeLog(log));
  };
  const waitForUnreachableExchangeLog = async (order: WorkOrder) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await hasUnreachableExchangeLog(order)) return;
      if (attempt < 2) await wait(700);
    }
    throw new Error("工单已关闭，但未查询到“到访不遇”流转日志，已加入待补发队列");
  };
  const toggleOrder = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleAllPendingOrders = () => setSelected((current) => {
    const visibleIds = pendingSubmitOrders.map((order) => order.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.includes(id));
    return allVisibleSelected ? current.filter((id) => !visibleIds.includes(id)) : [...new Set([...current, ...visibleIds])];
  });

  const findHistoricalPhotos = async () => {
    if (!activeOrder) return;
    const orderId = activeOrder.id;
    setHistoryMode("auto"); setHistoryPhotoLoading(true); setHistoryPhotoError(null); setHistoryPhotos([]);
    try {
      const current = activeOrder.raw ?? {};
      const currentUser = (current.userinfo ?? {}) as Record<string, unknown>;
      let userinfoId = textField(current.userinfoId) || textField(currentUser.userInfoId);
      if (!userinfoId) {
        const detailResponse = await fetchWorkOrderDetail(activeOrder.woHeaderId);
        const header = (detailResponse.data.tcisWoHeaderDto ?? {}) as Record<string, unknown>;
        const userInfo = (header.userinfo ?? {}) as Record<string, unknown>;
        userinfoId = textField(header.userinfoId) || textField(userInfo.userInfoId);
      }
      if (!userinfoId) throw new Error("当前工单缺少 userinfoId，无法查询历史到访照片");

      const historyOrders = await fetchHistoricalWorkOrders(userinfoId);
      const candidates = historyOrders
        .filter((item) => textField(item.woHeaderId) !== activeOrder.woHeaderId && textField(item.statusCode) === "60")
        .sort((left, right) => historyTimestamp(right) - historyTimestamp(left));
      if (!candidates.length) throw new Error("未找到同一用户已结束的历史工单");

      for (const historyOrder of candidates) {
        const historyId = textField(historyOrder.woHeaderId);
        if (!historyId) continue;
        const logs = await fetchWorkOrderExchangeLogs(historyId);
        if (!logs.some((log) => JSON.stringify(log).includes("到访不遇"))) continue;

        for (const bizId of photoBizIds(historyOrder)) {
          const attachments = (await fetchWorkOrderFiles(bizId)).filter((file) => textField(file.downloadFilePath));
          if (!attachments.length) continue;
          const downloaded = await Promise.allSettled(attachments.slice(0, 12).map(async (attachment: UploadedFile, index) => {
            const file = await downloadWorkOrderFile(attachment);
            return {
              file,
              historyLabel: textField(historyOrder.woNumber) || historyId,
              id: `${historyId}-${attachment.attachId ?? attachment.downloadFilePath ?? index}`,
              originalName: textField(attachment.fileName) || file.name,
              previewUrl: URL.createObjectURL(file),
            };
          }));
          const photos = downloaded.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
          if (photos.length) {
            setHistoryPhotos(photos);
            setHistoryPhotoCache((current) => ({ ...current, [orderId]: { error: null, photos } }));
            return;
          }
        }
      }
      throw new Error("已检查历史已结束工单，但未找到含“到访不遇”日志的可下载照片");
    } catch (error) {
      const message = messageOf(error);
      setHistoryPhotoError(message);
      setHistoryPhotoCache((current) => ({ ...current, [orderId]: { error: message, photos: [] } }));
      setHistoryFiles((current) => {
        const next = { ...current };
        delete next[orderId];
        return next;
      });
      const remainingOrders = selectedOrders.filter((order) => order.id !== orderId);
      setSelected((current) => current.filter((id) => id !== orderId));
      if (remainingOrders.length) {
        setActiveOrderId(remainingOrders[0].id);
      } else {
        setLoadError(`工单 ${activeOrder.woNumber} 没有可用的历史到访不遇照片，已取消提交队列`);
        setScreen("select");
      }
    }
    finally { setHistoryPhotoLoading(false); }
  };

  useEffect(() => {
    if (screen !== "prepare" || historyMode !== "auto" || !activeOrder || historyPhotoLoading || historyPhotoCache[activeOrder.id]) return;
    void findHistoricalPhotos();
  }, [activeOrder, historyMode, historyPhotoCache, historyPhotoLoading, screen]);

  const runBatch = async () => {
    if (!libraryFile || !selectedOrders.length || selectedOrders.some((order) => !historyFiles[order.id])) return;
    setBatchOrderIds(selectedOrders.map((order) => order.id));
    setRunning(true); setPaused(false); setCurrentIndex(0); setScreen("running");
    for (let index = 0; index < selectedOrders.length; index += 1) {
      const order = selectedOrders[index];
      const historyFile = historyFiles[order.id];
      if (index > 0 && submitIntervalMaxSeconds > 0) {
        const minSeconds = Math.min(submitIntervalMinSeconds, submitIntervalMaxSeconds);
        const maxSeconds = Math.max(submitIntervalMinSeconds, submitIntervalMaxSeconds);
        const delaySeconds = minSeconds + Math.floor(Math.random() * (maxSeconds - minSeconds + 1));
        setRunMessage(`随机等待 ${delaySeconds} 秒后提交下一单…`);
        await wait(delaySeconds * 1000);
      }
      setCurrentIndex(index + 1);
      try {
        setRunMessage(`正在上传 ${order.woNumber} 的两张照片…`);
        const uploaded = await uploadWorkOrderFiles([historyFile, libraryFile]);
        const bizId = uploaded.data.bizId;
        setRunMessage(`正在关闭安检工单 ${order.woNumber}…`);
        await closeSecurityCheckWorkOrder({
          "closeAttachBizId-11": bizId,
          "closeAttachBizId-ZC": "",
          closeAttachBizId: bizId,
          closeReason: CLOSE_REASON_UNREACHABLE,
          remark,
          woHeaderId: order.woHeaderId,
        });
      } catch (error) {
        setOrderStatus(order.id, "关闭失败");
        setRunMessage(`${order.woNumber} 关闭失败：${messageOf(error)}`);
        continue;
      }
      try {
        setRunMessage(`正在写入 ${order.woNumber} 的流转日志…`);
        await createWorkOrderExchangeLog({
          exchangeType: EXCHANGE_TYPE_UNREACHABLE,
          params: { closeReason: reason, remark },
          userName: operatorName.trim() || "段鑫",
          woHeaderId: order.woHeaderId,
          woNumber: order.woNumber,
        });
        setRunMessage(`正在核验 ${order.woNumber} 的流转日志…`);
        await waitForUnreachableExchangeLog(order);
        setOrderStatus(order.id, "已结束", "60");
        setSelected((current) => current.filter((id) => id !== order.id));
      } catch (error) {
        setOrderStatus(order.id, "日志失败");
        setRunMessage(`${order.woNumber} 已关闭，流转日志失败：${messageOf(error)}`);
      }
    }
    setRunning(false); setRunMessage("本次批量任务已结束"); setScreen("records"); setMainTab("submit");
  };

  const retryLog = async (id: string) => {
    const order = orders.find((item) => item.id === id);
    if (!order) return { ok: false, message: "未找到该工单" };
    if (order.backendStatusCode !== "60" && order.status !== "日志失败" && order.status !== "已结束") {
      return { ok: false, message: "该工单尚未关闭，不能补发流转日志" };
    }
    try {
      if (await hasUnreachableExchangeLog(order)) {
        setOrderStatus(id, "已结束", "60");
        return { ok: false, message: "已查询到“到访不遇”流转日志，无需重复补发" };
      }
      await createWorkOrderExchangeLog({ exchangeType: EXCHANGE_TYPE_UNREACHABLE, params: { closeReason: reason, remark }, userName: operatorName.trim() || "段鑫", woHeaderId: order.woHeaderId, woNumber: order.woNumber });
      await waitForUnreachableExchangeLog(order);
      setOrderStatus(id, "已结束", "60");
      return { ok: true, message: "流转日志已补发并完成核验" };
    } catch (error) {
      const message = `补发日志失败：${messageOf(error)}`;
      setOrderStatus(id, "日志失败", "60");
      setLoadError(message);
      return { ok: false, message };
    }
  };

  const refreshSession = async () => {
    const status = await refreshAuthSession();
    setAuth(status);
    return status;
  };

  const saveRefreshToken = async (refreshToken: string) => {
    const status = await setAuthRefreshToken(refreshToken);
    setAuth(status);
    return status;
  };

  const exportSession = (input: { verification: "biometric" | "password"; password?: string }) => exportAuthSession(input);

  const handleAndroidBack = useCallback(() => {
    const pageBackEvent = new Event("kidindin:back", { cancelable: true });
    window.dispatchEvent(pageBackEvent);
    if (pageBackEvent.defaultPrevented) return;

    if (drawer) { setDrawer(null); return; }
    if (filterOpen) { setOpenFilterPicker(null); setFilterOpen(false); return; }
    if (loadError) { setLoadError(null); return; }

    switch (screen) {
      case "records":
        setScreen("mode");
        return;
      case "confirm":
        setScreen("prepare");
        return;
      case "prepare":
        setScreen("select");
        return;
      case "select":
        setScreen("mode");
        return;
      case "mode":
        setScreen("orders");
        setMainTab("home");
        return;
      case "running":
        if (!running) setScreen("records");
        return;
      case "orders":
        if (mainTab !== "home") setMainTab("home");
        return;
    }
  }, [drawer, filterOpen, loadError, mainTab, running, screen]);

  useEffect(() => {
    if (!isNativeRuntime()) return;
    let cancelled = false;
    let listener: { unregister: () => Promise<void> } | undefined;
    void onBackButtonPress(handleAndroidBack)
      .then((dispose) => {
        if (cancelled) void dispose.unregister();
        else listener = dispose;
      })
      .catch(() => undefined);
    return () => { cancelled = true; void listener?.unregister(); };
  }, [handleAndroidBack]);

  if (!loggedIn) return <div className={`app-shell theme-${appliedTheme}`}><main className="phone-frame"><LoginPage onLogin={login} history={authHistory} error={loginError} submitting={loggingIn} onRestoreHistory={loginWithHistory} /></main></div>;

  return <div className={`app-shell theme-${appliedTheme}`}><main className="phone-frame">
    {loadError ? <p className="network-error">{loadError}<button onClick={() => void loadOrders()}>重试</button></p> : null}
    {screen === "orders" && mainTab === "home" && <HomePage orders={filteredOrders} query={query} date={selectedDate} onQueryChange={setQuery} onDateChange={setSelectedDate} onOpenSettings={() => setDrawer("settings")} onFilter={() => setFilterOpen(true)} onDetail={(order) => { setActiveOrderId(order.id); setDrawer("detail"); }} />}
    {screen === "orders" && mainTab === "stats" && <StatsPage orders={orders} date={selectedDate} onDateChange={setSelectedDate} onRetry={(id) => void retryLog(id)} />}
    {screen === "mode" && <ModePage mode={submitMode} intervalMinSeconds={submitIntervalMinSeconds} intervalMaxSeconds={submitIntervalMaxSeconds} onModeChange={(mode) => { setSubmitMode(mode); setHistoryMode(mode === "historical" ? "auto" : "manual"); }} onIntervalMinChange={(value) => { setSubmitIntervalMinSeconds(value); setSubmitIntervalMaxSeconds((current) => Math.max(current, value)); }} onIntervalMaxChange={(value) => { setSubmitIntervalMaxSeconds(value); setSubmitIntervalMinSeconds((current) => Math.min(current, value)); }} onBack={() => { setScreen("orders"); setMainTab("home"); }} onNext={() => setScreen("select")} />}
    {screen === "select" && <SubmitPage orders={pendingSubmitOrders} selected={pendingSelectedIds} mode={submitMode} date={selectedDate} onDateChange={setSelectedDate} onBack={() => setScreen("mode")} onFilter={() => setFilterOpen(true)} onToggle={toggleOrder} onToggleAll={toggleAllPendingOrders} onDetail={(order) => { setActiveOrderId(order.id); setDrawer("detail"); }} onPrepare={() => { if (selectedOrders.length) { setActiveOrderId(selectedOrders[0].id); setHistoryMode(submitMode === "historical" ? "auto" : "manual"); setScreen("prepare"); } }} />}
    {screen === "prepare" && activeOrder && <PreparePage orders={selectedOrders} activeOrder={activeOrder} historyFileName={activeHistoryFile?.name ?? ""} historyMode={historyMode} historyPhotos={historyPhotos} historyPhotoError={historyPhotoError} historyPhotoLoading={historyPhotoLoading} libraryFileName={libraryFile?.name ?? ""} date={selectedDate} onDateChange={setSelectedDate} onBack={() => setScreen("select")} onSelectOrder={setActiveOrderId} onPickHistoryFile={(file) => { setHistoryMode("manual"); setHistoryFiles((current) => { const next = { ...current }; if (file) next[activeOrder.id] = file; else delete next[activeOrder.id]; return next; }); }} onHistoryModeChange={setHistoryMode} onFindHistoricalPhotos={() => void findHistoricalPhotos()} onSelectHistoricalPhoto={(photo) => { setHistoryMode("auto"); setHistoryFiles((current) => ({ ...current, [activeOrder.id]: photo.file })); }} onPickLibraryFile={setLibraryFile} onNext={() => { if (!libraryFile || selectedOrders.some((order) => !historyFiles[order.id])) { setLoadError("请为每个工单选择一张历史照片，并选择本机补图"); return; } setScreen("confirm"); }} />}
    {screen === "confirm" && <ConfirmPage orders={selectedOrders} historyFiles={historyFiles} libraryFile={libraryFile} reason={reason} remark={remark} operatorName={operatorName} operatorLocked={false} date={selectedDate} onDateChange={setSelectedDate} onBack={() => setScreen("prepare")} onReasonChange={setReason} onRemarkChange={setRemark} onOperatorNameChange={setCustomOperatorName} onStart={() => void runBatch()} />}
    {screen === "running" && <RunningPage total={batchOrders.length || selectedOrders.length} paused={paused} date={selectedDate} onDateChange={setSelectedDate} onBack={() => undefined} onTogglePause={() => setPaused((value) => !value)} onFinish={() => setScreen("records")} current={currentIndex} message={runMessage} running={running} />}
    {screen === "records" && <RecordsPage orders={batchOrders} date={selectedDate} onDateChange={setSelectedDate} onBack={() => setScreen("mode")} onRetry={(id) => void retryLog(id)} />}
    {drawer && activeOrder && <AppDrawer type={drawer} order={activeOrder} detail={detail} detailAjInfo={detailAjInfo} detailLoading={detailLoading} detailError={detailError} theme={theme} auth={auth!} libraryPhotos={[]} defaultOperatorName={customOperatorName} setDefaultOperatorName={setCustomOperatorName} setTheme={setTheme} onRetryLog={retryLog} onRefreshSession={refreshSession} onSaveRefreshToken={saveRefreshToken} onExportSession={exportSession} onClose={() => setDrawer(null)} onLogout={() => { void logoutAuth().then(setAuth); setDrawer(null); setScreen("orders"); }} />}
    {filterOpen && <div className="filter-overlay" onClick={() => { setOpenFilterPicker(null); setFilterOpen(false); }}><section className="filter-panel" onClick={(event) => event.stopPropagation()}><h2>筛选工单</h2><p>关键词、楼栋、单元和工单状态会叠加筛选；楼栋和单元选项来自当前日期实际加载的工单。</p><FilterPicker label="楼栋" value={buildingFilter} allLabel="全部楼栋" options={buildingOptions} open={openFilterPicker === "building"} onToggle={() => setOpenFilterPicker((current) => current === "building" ? null : "building")} onSelect={(value) => { setBuildingFilter(value); setUnitFilter("all"); setOpenFilterPicker(null); }} /><FilterPicker label="单元" value={unitFilter} allLabel="全部单元" options={unitOptions} open={openFilterPicker === "unit"} onToggle={() => setOpenFilterPicker((current) => current === "unit" ? null : "unit")} onSelect={(value) => { setUnitFilter(value); setOpenFilterPicker(null); }} /><div className="status-filter-options">{workOrderStatusOptions.map((option) => <button key={option.value} className={statusFilter === option.value ? "active" : ""} onClick={() => setStatusFilter(option.value)}>{option.label}</button>)}</div><button onClick={() => { setOpenFilterPicker(null); setFilterOpen(false); }}>完成（{filteredOrders.length} 条）</button></section></div>}
    {loadingOrders ? <div className="loading-mask">正在加载工单…</div> : null}
    {screen === "orders" && <PrimaryNav active={mainTab} onChange={(tab) => { setMainTab(tab); setScreen(tab === "submit" ? "mode" : "orders"); }} />}
  </main></div>;
}
