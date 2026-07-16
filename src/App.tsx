import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { AppDrawer } from "./components/AppDrawer";
import { PrimaryNav } from "./components/Navigation";
import { SessionExpiryNotice } from "./components/SessionExpiryNotice";
import { HomePage } from "./pages/HomePage";
import { LocalWorkOrdersPage } from "./pages/LocalWorkOrdersPage";
import { LoginPage } from "./pages/LoginPage";
import { MorePage } from "./pages/MorePage";
import { StatsPage } from "./pages/StatsPage";
import { SubmitPage } from "./pages/SubmitPage";
import { ConfirmPage, ModePage, PreparePage, RecordsPage, RunningPage } from "./pages/WorkflowPages";
import { configureAuthSession, exportAuthSession, fetchAuthHistory, fetchAuthStatus, logoutAuth, refreshAuthSession, restoreAuthHistory, setAuthRefreshToken, type AuthHistoryItem } from "./services/authApi";
import {
  clearLocalWorkOrderMeta,
  deleteLocalWorkOrderMeta,
  exportLocalWorkOrderMeta,
  importLocalWorkOrderMeta,
  listLocalWorkOrderMeta,
  makeLocalWorkOrderKey,
  saveLocalWorkOrderMeta,
  type LocalWorkOrderMeta,
  type LocalWorkOrderSnapshot,
} from "./services/localWorkOrderStore";
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
const AUTO_LOGIN_HISTORY_STORAGE_KEY = "kidindin.auto-login-history-id";
const AUTO_LOGIN_DISABLED = "disabled";
const TOKEN_EXPIRY_WARNING_MS = 30 * 60_000;

function normalizeExpiryTimestamp(expiresAt: number | null | undefined) {
  if (!expiresAt || !Number.isFinite(expiresAt)) return null;
  return expiresAt < 2_000_000_000 ? expiresAt * 1_000 : expiresAt;
}

function unauthenticatedStatus(): AuthStatus {
  return { authenticated: false, employeeNumber: null, expiresAt: null, refreshAvailable: false, username: null };
}

function localAccountKeyFor(status: AuthStatus, historyId?: string | null) {
  const employeeNumber = status.employeeNumber?.trim();
  if (employeeNumber) return `employee:${employeeNumber}`;
  const username = status.username?.trim();
  if (username) return `username:${username}`;
  return historyId?.trim() ? `history:${historyId.trim()}` : null;
}

function tokenHintFromInput(tokenText: string) {
  const raw = tokenText.trim();
  let token = raw;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const payload = parsed.data && typeof parsed.data === "object" ? parsed.data as Record<string, unknown> : parsed;
    const value = [parsed.access_token, parsed.accessToken, parsed.token, parsed.authorization, payload.access_token, payload.accessToken, payload.token, payload.authorization]
      .find((item) => typeof item === "string" && item.trim()) as string | undefined;
    if (value) token = value;
  } catch {
    // A plain Bearer token is also a supported login input.
  }
  token = token.replace(/^Bearer\s+/i, "").trim();
  return token ? `${token.slice(0, 6)}…${token.slice(-4)}` : "";
}

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

type WorkOrderSortField = "original" | "number" | "resident" | "location" | "time" | "status";
type SortDirection = "asc" | "desc";

const workOrderSortOptions: Array<{ label: string; value: WorkOrderSortField }> = [
  { label: "默认", value: "original" },
  { label: "工单号", value: "number" },
  { label: "住户", value: "resident" },
  { label: "楼栋单元", value: "location" },
  { label: "计划时间", value: "time" },
  { label: "状态", value: "status" },
];

const naturalCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

function statusSortRank(statusCode: string) {
  switch (statusCode) {
    case "20": return 0;
    case "30": return 1;
    case "40":
    case "50": return 2;
    case "60": return 3;
    default: return 4;
  }
}

function compareWorkOrders(left: WorkOrder, right: WorkOrder, field: Exclude<WorkOrderSortField, "original">) {
  switch (field) {
    case "number":
      return naturalCollator.compare(left.woNumber || left.id, right.woNumber || right.id);
    case "resident":
      return naturalCollator.compare(left.resident, right.resident);
    case "location": {
      const buildingComparison = naturalCollator.compare(left.building, right.building);
      if (buildingComparison !== 0) return buildingComparison;
      const unitNumberComparison = naturalCollator.compare(left.unitNumber, right.unitNumber);
      return unitNumberComparison !== 0 ? unitNumberComparison : naturalCollator.compare(left.unit, right.unit);
    }
    case "time":
      return naturalCollator.compare(left.time, right.time);
    case "status":
      return statusSortRank(left.backendStatusCode) - statusSortRank(right.backendStatusCode);
  }
}

function isMissingPlanTime(value: string) {
  const normalized = value.trim();
  return !normalized || normalized === "待安排";
}

function sortWorkOrders(items: WorkOrder[], field: WorkOrderSortField, direction: SortDirection) {
  if (field === "original") return items;
  const directionFactor = direction === "asc" ? 1 : -1;
  return items
    .map((order, index) => ({ index, order }))
    .sort((left, right) => {
      if (field === "time") {
        const leftMissing = isMissingPlanTime(left.order.time);
        const rightMissing = isMissingPlanTime(right.order.time);
        if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
      }
      const comparison = compareWorkOrders(left.order, right.order, field);
      return comparison === 0 ? left.index - right.index : comparison * directionFactor;
    })
    .map(({ order }) => order);
}

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

function toLocalSnapshot(order: WorkOrder): LocalWorkOrderSnapshot {
  return {
    address: order.address,
    backendStatusCode: order.backendStatusCode,
    building: order.building,
    resident: order.resident,
    status: order.status,
    time: order.time,
    unit: order.unit,
    unitNumber: order.unitNumber,
    woNumber: order.woNumber,
  };
}

function fromLocalMeta(item: LocalWorkOrderMeta): WorkOrder {
  const snapshot = item.snapshot;
  const status: OrderStatus = ["待处理", "处理中", "已完成", "已结束", "待提交", "关闭失败", "日志失败", "未知"].includes(snapshot.status)
    ? snapshot.status as OrderStatus
    : "未知";
  return {
    address: snapshot.address,
    backendStatusCode: snapshot.backendStatusCode,
    building: snapshot.building,
    id: snapshot.woNumber || item.woHeaderId,
    resident: snapshot.resident,
    searchText: [snapshot.woNumber, snapshot.resident, snapshot.address, snapshot.building, snapshot.unitNumber, item.note].filter(Boolean).join(" ").toLowerCase(),
    status,
    time: snapshot.time,
    unit: snapshot.unit,
    unitNumber: snapshot.unitNumber,
    woHeaderId: item.woHeaderId,
    woNumber: snapshot.woNumber,
  };
}

function downloadJsonFile(fileName: string, payload: string) {
  const url = URL.createObjectURL(new Blob([payload], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
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
  const [sessionExpiryNow, setSessionExpiryNow] = useState(() => Date.now());
  const [dismissedSessionExpiryKey, setDismissedSessionExpiryKey] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("orders");
  const [mainTab, setMainTab] = useState<MainTab>("home");
  const [theme, setTheme] = useState<Theme>("system");
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<WorkOrderStatusFilter>("all");
  const [buildingFilter, setBuildingFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const [sortField, setSortField] = useState<WorkOrderSortField>("original");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [openFilterPicker, setOpenFilterPicker] = useState<"building" | "unit" | null>(null);
  const [selectedDate, setSelectedDate] = useState(today());
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [batchOrderIds, setBatchOrderIds] = useState<string[]>([]);
  const [activeOrderId, setActiveOrderId] = useState("");
  const [localDetailOrder, setLocalDetailOrder] = useState<WorkOrder | null>(null);
  const [localAccountKey, setLocalAccountKey] = useState<string | null>(null);
  const [localWorkOrders, setLocalWorkOrders] = useState<LocalWorkOrderMeta[]>([]);
  const [localDataBusy, setLocalDataBusy] = useState(false);
  const [localDataMessage, setLocalDataMessage] = useState("");
  const [localSavingOrderIds, setLocalSavingOrderIds] = useState<string[]>([]);
  const localSaveLocks = useRef(new Set<string>());
  const sessionRefreshPromise = useRef<Promise<AuthStatus> | null>(null);
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
  const sessionExpiryAt = normalizeExpiryTimestamp(auth?.expiresAt);
  const sessionExpiryKey = sessionExpiryAt === null
    ? null
    : `${localAccountKey ?? auth?.employeeNumber ?? auth?.username ?? "session"}:${sessionExpiryAt}`;
  const sessionRemainingMs = sessionExpiryAt === null ? null : sessionExpiryAt - sessionExpiryNow;
  const showSessionExpiryNotice = loggedIn
    && sessionRemainingMs !== null
    && sessionRemainingMs <= TOKEN_EXPIRY_WARNING_MS
    && dismissedSessionExpiryKey !== sessionExpiryKey;
  const displaySessionExpiryNotice = showSessionExpiryNotice && !drawer && !filterOpen;
  const appliedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const operatorName = customOperatorName.trim() || "段鑫";
  const localMetaById = useMemo(() => Object.fromEntries(localWorkOrders.map((item) => [item.woHeaderId, item])), [localWorkOrders]);
  const activeOrder = localDetailOrder ?? orders.find((order) => order.id === activeOrderId) ?? orders[0];
  const activeHistoryFile = activeOrder ? historyFiles[activeOrder.id] ?? null : null;
  const selectedOrders = useMemo(() => sortWorkOrders(orders.filter((order) => selected.includes(order.id) && order.backendStatusCode === "20"), sortField, sortDirection), [orders, selected, sortDirection, sortField]);
  const pendingSelectedIds = useMemo(() => selectedOrders.map((order) => order.id), [selectedOrders]);
  const batchOrders = useMemo(() => {
    const orderById = new Map(orders.map((order) => [order.id, order]));
    return batchOrderIds.flatMap((id) => orderById.get(id) ? [orderById.get(id)!] : []);
  }, [batchOrderIds, orders]);
  const filteredOrders = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const matchingOrders = orders.filter((order) =>
      (!keyword || order.searchText.includes(keyword)) &&
      matchesWorkOrderStatus(order.backendStatusCode, statusFilter) &&
      (buildingFilter === "all" || order.building === buildingFilter) &&
      (unitFilter === "all" || order.unitNumber === unitFilter)
    );
    return sortWorkOrders(matchingOrders, sortField, sortDirection);
  }, [buildingFilter, orders, query, sortDirection, sortField, statusFilter, unitFilter]);
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

  useEffect(() => {
    if (!loggedIn || sessionExpiryAt === null) return;
    const updateSessionExpiryClock = () => setSessionExpiryNow(Date.now());
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") updateSessionExpiryClock();
    };
    updateSessionExpiryClock();
    const timer = window.setInterval(updateSessionExpiryClock, 60_000);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", updateSessionExpiryClock);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", updateSessionExpiryClock);
    };
  }, [loggedIn, sessionExpiryAt]);

  useEffect(() => {
    setSessionExpiryNow(Date.now());
    if (!loggedIn) setDismissedSessionExpiryKey(null);
  }, [loggedIn, sessionExpiryAt]);

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
  useEffect(() => {
    const root = document.documentElement;
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    root.dataset.theme = appliedTheme;
    root.style.colorScheme = appliedTheme;
    document.body.classList.toggle("theme-dark", appliedTheme === "dark");
    themeColor?.setAttribute("content", appliedTheme === "dark" ? "#000000" : "#f7f9fc");
  }, [appliedTheme]);
  useEffect(() => { localStorage.setItem(DEFAULT_OPERATOR_NAME_STORAGE_KEY, customOperatorName.trim() || "段鑫"); }, [customOperatorName]);
  useEffect(() => {
    let active = true;
    if (!isNativeRuntime()) {
      setAuth(unauthenticatedStatus());
      setLoginError("当前是浏览器预览，原生登录不可用。请安装并打开 KiDinDin APK 后再粘贴凭据。");
      return;
    }

    const bootstrapAuth = async () => {
      try {
        const [current, history] = await Promise.all([fetchAuthStatus(), fetchAuthHistory()]);
        if (!active) return;
        setAuthHistory(history);

        let next = current;
        let restoredHistory = false;
        const savedHistoryId = localStorage.getItem(AUTO_LOGIN_HISTORY_STORAGE_KEY);
        let activeHistoryId = savedHistoryId && savedHistoryId !== AUTO_LOGIN_DISABLED && history.some((item) => item.id === savedHistoryId)
          ? savedHistoryId
          : undefined;
        const autoLoginHistory = savedHistoryId === AUTO_LOGIN_DISABLED
          ? undefined
          : history.find((item) => item.id === savedHistoryId) ?? history[0];
        if (!next.authenticated && autoLoginHistory) {
          next = await restoreAuthHistory(autoLoginHistory.id);
          localStorage.setItem(AUTO_LOGIN_HISTORY_STORAGE_KEY, autoLoginHistory.id);
          activeHistoryId = autoLoginHistory.id;
          restoredHistory = true;
        }

        const nextExpiryAt = normalizeExpiryTimestamp(next.expiresAt);
        if (next.authenticated && nextExpiryAt !== null && nextExpiryAt <= Date.now()) {
          if (!next.refreshAvailable) throw new Error("最近一次登录已过期，且没有可用的 refresh_token");
          next = await refreshAuthSession();
          restoredHistory = true;
        }

        if (!active) return;
        if (next.authenticated) {
          setScreen("orders");
          setMainTab("home");
          const accountKey = localAccountKeyFor(next, activeHistoryId ?? autoLoginHistory?.id ?? history[0]?.id);
          setLocalAccountKey(accountKey);
          if (!accountKey) setLocalDataMessage("当前登录缺少可识别的账号信息，本地工单功能已停用");
        } else {
          setLocalAccountKey(null);
        }
        setAuth(next);
        if (restoredHistory) void fetchAuthHistory().then(setAuthHistory).catch(() => undefined);
      } catch (error) {
        if (!active) return;
        setLocalAccountKey(null);
        setAuth(unauthenticatedStatus());
        setLoginError(`自动恢复登录失败：${messageOf(error)}`);
      }
    };

    void bootstrapAuth();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!loggedIn || !localAccountKey) {
      setLocalWorkOrders([]);
      setLocalDataBusy(false);
      if (!loggedIn) setLocalDataMessage("");
      else setLocalDataMessage("当前登录缺少可识别的账号信息，本地工单功能已停用");
      return;
    }
    let active = true;
    setLocalDataBusy(true);
    void listLocalWorkOrderMeta(localAccountKey)
      .then((items) => { if (active) setLocalWorkOrders(items); })
      .catch((error) => { if (active) setLocalDataMessage(`读取本地工单失败：${messageOf(error)}`); })
      .finally(() => { if (active) setLocalDataBusy(false); });
    return () => { active = false; };
  }, [localAccountKey, loggedIn]);
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
      localStorage.removeItem(AUTO_LOGIN_HISTORY_STORAGE_KEY);
      const history = await fetchAuthHistory().catch(() => [] as AuthHistoryItem[]);
      const tokenHint = tokenHintFromInput(input.tokenText);
      const matchedHistory = history.find((item) =>
        (status.employeeNumber && item.employeeNumber === status.employeeNumber)
        || (status.username && item.username === status.username)
        || (tokenHint && item.tokenHint === tokenHint)
      ) ?? history.find((item) => !authHistory.some((previous) => previous.id === item.id)) ?? history[0];
      const historyId = matchedHistory?.id;
      const accountKey = localAccountKeyFor(status, historyId);
      setLocalAccountKey(accountKey);
      setLocalDataMessage(accountKey ? "" : "当前登录缺少可识别的账号信息，本地工单功能已停用");
      setAuth(status);
      if (history.length) {
        setAuthHistory(history);
        if (historyId) localStorage.setItem(AUTO_LOGIN_HISTORY_STORAGE_KEY, historyId);
      }
    } catch (error) { setLoginError(messageOf(error)); }
    finally { setLoggingIn(false); }
  };

  const loginWithHistory = async (id: string) => {
    setLoggingIn(true); setLoginError(null);
    try {
      const status = await restoreAuthHistory(id);
      localStorage.setItem(AUTO_LOGIN_HISTORY_STORAGE_KEY, id);
      setLocalAccountKey(localAccountKeyFor(status, id));
      setAuth(status);
      void fetchAuthHistory().then(setAuthHistory).catch(() => undefined);
    } catch (error) { setLoginError(messageOf(error)); }
    finally { setLoggingIn(false); }
  };

  const persistLocalWorkOrder = async (order: WorkOrder, patch: Partial<Pick<LocalWorkOrderMeta, "appointmentAt" | "favorite" | "note" | "pinned">>) => {
    const accountKey = localAccountKey;
    if (!accountKey) throw new Error("当前登录缺少本地账号标识，无法保存工单资料");
    if (localSaveLocks.current.has(order.woHeaderId)) throw new Error("这张工单的本地资料正在保存，请稍候");

    localSaveLocks.current.add(order.woHeaderId);
    setLocalSavingOrderIds((current) => current.includes(order.woHeaderId) ? current : [...current, order.woHeaderId]);
    setLocalDataMessage("");
    try {
      const existing = localMetaById[order.woHeaderId];
      const appointmentAt = patch.appointmentAt === "" ? null : patch.appointmentAt !== undefined ? patch.appointmentAt : existing?.appointmentAt ?? null;
      const next: LocalWorkOrderMeta = {
        accountKey,
        appointmentAt,
        favorite: patch.favorite ?? existing?.favorite ?? false,
        key: makeLocalWorkOrderKey(accountKey, order.woHeaderId),
        note: patch.note !== undefined ? patch.note.trim() : existing?.note ?? "",
        pinned: patch.pinned ?? existing?.pinned ?? false,
        snapshot: toLocalSnapshot(order),
        sourceDate: existing?.sourceDate ?? selectedDate,
        updatedAt: new Date().toISOString(),
        woHeaderId: order.woHeaderId,
      };
      const hasLocalData = next.favorite || next.pinned || Boolean(next.note) || Boolean(next.appointmentAt);
      if (!hasLocalData) {
        if (existing) await deleteLocalWorkOrderMeta(existing.key);
        setLocalWorkOrders((current) => current.filter((item) => item.woHeaderId !== order.woHeaderId));
        return;
      }
      const saved = await saveLocalWorkOrderMeta(next);
      setLocalWorkOrders((current) => [...current.filter((item) => item.woHeaderId !== saved.woHeaderId), saved]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    } catch (error) {
      setLocalDataMessage(`保存本地工单失败：${messageOf(error)}`);
      throw error;
    } finally {
      localSaveLocks.current.delete(order.woHeaderId);
      setLocalSavingOrderIds((current) => current.filter((id) => id !== order.woHeaderId));
    }
  };

  const openCurrentOrderDetail = (order: WorkOrder) => {
    setLocalDetailOrder(null);
    setActiveOrderId(order.id);
    setDrawer("detail");
  };

  const openLocalOrderDetail = (item: LocalWorkOrderMeta) => {
    const order = fromLocalMeta(item);
    setLocalDetailOrder(order);
    setActiveOrderId(order.id);
    setDrawer("detail");
  };

  const exportLocalData = async () => {
    const accountKey = localAccountKey;
    if (!accountKey) {
      setLocalDataMessage("当前登录缺少本地账号标识，无法导出数据");
      return;
    }
    setLocalDataBusy(true);
    setLocalDataMessage("");
    try {
      const payload = await exportLocalWorkOrderMeta(accountKey);
      downloadJsonFile(`kidindin-local-work-orders-${today()}.json`, payload);
      setLocalDataMessage(`已导出 ${localWorkOrders.length} 条本地工单资料`);
    } catch (error) {
      setLocalDataMessage(`导出失败：${messageOf(error)}`);
    } finally {
      setLocalDataBusy(false);
    }
  };

  const importLocalData = async (payload: string, fileName: string) => {
    const accountKey = localAccountKey;
    if (!accountKey) throw new Error("当前登录缺少本地账号标识，无法导入数据");
    setLocalDataBusy(true);
    setLocalDataMessage("");
    try {
      const items = await importLocalWorkOrderMeta(accountKey, payload);
      setLocalWorkOrders(items);
      setLocalDataMessage(`已从 ${fileName} 导入，本机现有 ${items.length} 条工单资料`);
    } catch (error) {
      setLocalDataMessage(`导入失败：${messageOf(error)}`);
      throw error;
    } finally {
      setLocalDataBusy(false);
    }
  };

  const clearLocalData = async () => {
    const accountKey = localAccountKey;
    if (!accountKey) {
      setLocalDataMessage("当前登录缺少本地账号标识，无法清空数据");
      return;
    }
    if (!window.confirm("确定清空当前账号的全部收藏、置顶、备注和预约吗？此操作不可撤销。")) return;
    setLocalDataBusy(true);
    setLocalDataMessage("");
    try {
      await clearLocalWorkOrderMeta(accountKey);
      setLocalWorkOrders([]);
      setLocalDataMessage("当前账号的本地工单资料已清空");
    } catch (error) {
      setLocalDataMessage(`清空失败：${messageOf(error)}`);
    } finally {
      setLocalDataBusy(false);
    }
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
    setRunning(false); setRunMessage("本次批量任务已结束"); setScreen("records"); setMainTab("more");
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

  const applyUpdatedAuthStatus = (status: AuthStatus) => {
    const savedHistoryId = localStorage.getItem(AUTO_LOGIN_HISTORY_STORAGE_KEY);
    const currentHistoryId = localAccountKey?.startsWith("history:") ? localAccountKey.slice("history:".length) : null;
    const nextAccountKey = localAccountKeyFor(status, currentHistoryId ?? (savedHistoryId === AUTO_LOGIN_DISABLED ? null : savedHistoryId));
    if (localAccountKey && nextAccountKey && localAccountKey !== nextAccountKey) {
      setLocalWorkOrders([]);
      setLocalDataMessage("登录账号标识已更新，已切换到对应账号的本地工单数据");
    } else if (!nextAccountKey) {
      setLocalDataMessage("当前登录缺少可识别的账号信息，本地工单功能已停用");
    }
    setLocalAccountKey(nextAccountKey);
    setAuth(status);
  };

  const refreshSession = async () => {
    if (sessionRefreshPromise.current) return sessionRefreshPromise.current;
    const request = refreshAuthSession().then((status) => {
      applyUpdatedAuthStatus(status);
      return status;
    });
    sessionRefreshPromise.current = request;
    try {
      return await request;
    } finally {
      if (sessionRefreshPromise.current === request) sessionRefreshPromise.current = null;
    }
  };

  const saveRefreshToken = async (refreshToken: string) => {
    const status = await setAuthRefreshToken(refreshToken);
    applyUpdatedAuthStatus(status);
    return status;
  };

  const exportSession = (input: { verification: "biometric" | "password"; password?: string }) => exportAuthSession(input);

  const logout = async () => {
    localStorage.setItem(AUTO_LOGIN_HISTORY_STORAGE_KEY, AUTO_LOGIN_DISABLED);
    const status = await logoutAuth();
    setLocalAccountKey(null);
    setAuth(status);
    setDrawer(null);
    setLocalDetailOrder(null);
    setScreen("orders");
    setMainTab("home");
    return status;
  };

  const handleAndroidBack = useCallback(() => {
    const pageBackEvent = new Event("kidindin:back", { cancelable: true });
    window.dispatchEvent(pageBackEvent);
    if (pageBackEvent.defaultPrevented) return;

    if (drawer) { setDrawer(null); setLocalDetailOrder(null); return; }
    if (filterOpen) { setOpenFilterPicker(null); setFilterOpen(false); return; }
    if (displaySessionExpiryNotice) { setDismissedSessionExpiryKey(sessionExpiryKey); return; }
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
        setMainTab("more");
        return;
      case "local-orders":
      case "appointments":
        setScreen("orders");
        setMainTab("more");
        return;
      case "running":
        if (!running) setScreen("records");
        return;
      case "orders":
        if (mainTab !== "home") setMainTab("home");
        return;
    }
  }, [displaySessionExpiryNotice, drawer, filterOpen, loadError, mainTab, running, screen, sessionExpiryKey]);

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

  if (auth === null) return <div className={`app-shell theme-${appliedTheme}`}><main className="phone-frame"><div className="loading-mask" aria-live="polite">正在恢复登录…</div></main></div>;
  if (!loggedIn) return <div className={`app-shell theme-${appliedTheme}`}><main className="phone-frame"><LoginPage onLogin={login} history={authHistory} error={loginError} submitting={loggingIn} onRestoreHistory={loginWithHistory} /></main></div>;

  return <div className={`app-shell theme-${appliedTheme}`}><main className={`phone-frame screen-${screen}`}>
    {displaySessionExpiryNotice && auth!.refreshAvailable ? <SessionExpiryNotice
      expiresAt={sessionExpiryAt}
      refreshAvailable
      onRefresh={refreshSession}
      onClose={() => setDismissedSessionExpiryKey(sessionExpiryKey)}
    /> : null}
    {displaySessionExpiryNotice && !auth!.refreshAvailable && activeOrder ? <SessionExpiryNotice
      expiresAt={sessionExpiryAt}
      refreshAvailable={false}
      canOpenSettings
      onOpenSettings={() => { setDismissedSessionExpiryKey(sessionExpiryKey); setDrawer("settings"); }}
      onClose={() => setDismissedSessionExpiryKey(sessionExpiryKey)}
    /> : null}
    {displaySessionExpiryNotice && !auth!.refreshAvailable && !activeOrder ? <SessionExpiryNotice
      expiresAt={sessionExpiryAt}
      refreshAvailable={false}
      canOpenSettings={false}
      onRelogin={logout}
      onClose={() => setDismissedSessionExpiryKey(sessionExpiryKey)}
    /> : null}
    {loadError ? <p className="network-error">{loadError}<button onClick={() => void loadOrders()}>重试</button></p> : null}
    {screen === "orders" && mainTab === "home" && <HomePage orders={filteredOrders} query={query} date={selectedDate} localMetaById={localMetaById} prioritizePinned={sortField === "original"} onQueryChange={setQuery} onDateChange={setSelectedDate} onOpenSettings={() => setDrawer("settings")} onFilter={() => setFilterOpen(true)} onDetail={openCurrentOrderDetail} />}
    {screen === "orders" && mainTab === "stats" && <StatsPage orders={orders} date={selectedDate} onDateChange={setSelectedDate} onRetry={(id) => void retryLog(id)} />}
    {screen === "orders" && mainTab === "more" && <MorePage items={localWorkOrders} busy={localDataBusy || !localAccountKey || localSavingOrderIds.length > 0} message={localDataMessage} onOpenBatchSubmit={() => { setLocalDetailOrder(null); setScreen("mode"); }} onOpenSaved={() => setScreen("local-orders")} onOpenAppointments={() => setScreen("appointments")} onExportLocalData={exportLocalData} onImportLocalData={importLocalData} onClearLocalData={clearLocalData} />}
    {screen === "local-orders" && <LocalWorkOrdersPage mode="saved" items={localWorkOrders} savingIds={localSavingOrderIds} message={localDataMessage} onBack={() => { setScreen("orders"); setMainTab("more"); }} onOpenDetail={openLocalOrderDetail} onToggleFavorite={(item) => persistLocalWorkOrder(fromLocalMeta(item), { favorite: !item.favorite })} onTogglePinned={(item) => persistLocalWorkOrder(fromLocalMeta(item), { pinned: !item.pinned })} onClearAppointment={(item) => persistLocalWorkOrder(fromLocalMeta(item), { appointmentAt: null })} />}
    {screen === "appointments" && <LocalWorkOrdersPage mode="appointments" items={localWorkOrders} savingIds={localSavingOrderIds} message={localDataMessage} onBack={() => { setScreen("orders"); setMainTab("more"); }} onOpenDetail={openLocalOrderDetail} onToggleFavorite={(item) => persistLocalWorkOrder(fromLocalMeta(item), { favorite: !item.favorite })} onTogglePinned={(item) => persistLocalWorkOrder(fromLocalMeta(item), { pinned: !item.pinned })} onClearAppointment={(item) => persistLocalWorkOrder(fromLocalMeta(item), { appointmentAt: null })} />}
    {screen === "mode" && <ModePage mode={submitMode} intervalMinSeconds={submitIntervalMinSeconds} intervalMaxSeconds={submitIntervalMaxSeconds} onModeChange={(mode) => { setSubmitMode(mode); setHistoryMode(mode === "historical" ? "auto" : "manual"); }} onIntervalMinChange={(value) => { setSubmitIntervalMinSeconds(value); setSubmitIntervalMaxSeconds((current) => Math.max(current, value)); }} onIntervalMaxChange={(value) => { setSubmitIntervalMaxSeconds(value); setSubmitIntervalMinSeconds((current) => Math.min(current, value)); }} onBack={() => { setScreen("orders"); setMainTab("more"); }} onNext={() => setScreen("select")} />}
    {screen === "select" && <SubmitPage orders={pendingSubmitOrders} selected={pendingSelectedIds} mode={submitMode} date={selectedDate} onDateChange={setSelectedDate} onBack={() => setScreen("mode")} onFilter={() => setFilterOpen(true)} onToggle={toggleOrder} onToggleAll={toggleAllPendingOrders} onDetail={openCurrentOrderDetail} onPrepare={() => { if (selectedOrders.length) { setActiveOrderId(selectedOrders[0].id); setHistoryMode(submitMode === "historical" ? "auto" : "manual"); setScreen("prepare"); } }} />}
    {screen === "prepare" && activeOrder && <PreparePage orders={selectedOrders} activeOrder={activeOrder} historyFileName={activeHistoryFile?.name ?? ""} historyMode={historyMode} historyPhotos={historyPhotos} historyPhotoError={historyPhotoError} historyPhotoLoading={historyPhotoLoading} libraryFileName={libraryFile?.name ?? ""} date={selectedDate} onDateChange={setSelectedDate} onBack={() => setScreen("select")} onSelectOrder={setActiveOrderId} onPickHistoryFile={(file) => { setHistoryMode("manual"); setHistoryFiles((current) => { const next = { ...current }; if (file) next[activeOrder.id] = file; else delete next[activeOrder.id]; return next; }); }} onHistoryModeChange={setHistoryMode} onFindHistoricalPhotos={() => void findHistoricalPhotos()} onSelectHistoricalPhoto={(photo) => { setHistoryMode("auto"); setHistoryFiles((current) => ({ ...current, [activeOrder.id]: photo.file })); }} onPickLibraryFile={setLibraryFile} onNext={() => { if (!libraryFile || selectedOrders.some((order) => !historyFiles[order.id])) { setLoadError("请为每个工单选择一张历史照片，并选择本机补图"); return; } setScreen("confirm"); }} />}
    {screen === "confirm" && <ConfirmPage orders={selectedOrders} historyFiles={historyFiles} libraryFile={libraryFile} reason={reason} remark={remark} operatorName={operatorName} operatorLocked={false} date={selectedDate} onDateChange={setSelectedDate} onBack={() => setScreen("prepare")} onReasonChange={setReason} onRemarkChange={setRemark} onOperatorNameChange={setCustomOperatorName} onStart={() => void runBatch()} />}
    {screen === "running" && <RunningPage total={batchOrders.length || selectedOrders.length} paused={paused} date={selectedDate} onDateChange={setSelectedDate} onTogglePause={() => setPaused((value) => !value)} onFinish={() => setScreen("records")} current={currentIndex} message={runMessage} running={running} />}
    {screen === "records" && <RecordsPage orders={batchOrders} date={selectedDate} onDateChange={setSelectedDate} onBack={() => setScreen("mode")} onRetry={(id) => void retryLog(id)} />}
    {drawer && activeOrder && <AppDrawer type={drawer} order={activeOrder} detail={detail} detailAjInfo={detailAjInfo} detailLoading={detailLoading} detailError={detailError} localMeta={localMetaById[activeOrder.woHeaderId] ?? null} theme={theme} auth={auth!} libraryPhotos={[]} defaultOperatorName={customOperatorName} setDefaultOperatorName={setCustomOperatorName} setTheme={setTheme} onUpdateLocalMeta={(patch) => persistLocalWorkOrder(activeOrder, patch)} onRetryLog={retryLog} onRefreshSession={refreshSession} onSaveRefreshToken={saveRefreshToken} onExportSession={exportSession} onClose={() => { setDrawer(null); setLocalDetailOrder(null); }} onLogout={() => { void logout().catch((error) => setLoadError(`退出登录失败：${messageOf(error)}`)); }} />}
    {filterOpen && <div className="filter-overlay" onClick={() => { setOpenFilterPicker(null); setFilterOpen(false); }}><section className="filter-panel" onClick={(event) => event.stopPropagation()}>
      <h2>筛选工单</h2>
      <p>关键词、楼栋、单元、工单状态和排序方式会叠加应用；楼栋和单元选项来自当前日期实际加载的工单。</p>
      <FilterPicker label="楼栋" value={buildingFilter} allLabel="全部楼栋" options={buildingOptions} open={openFilterPicker === "building"} onToggle={() => setOpenFilterPicker((current) => current === "building" ? null : "building")} onSelect={(value) => { setBuildingFilter(value); setUnitFilter("all"); setOpenFilterPicker(null); }} />
      <FilterPicker label="单元" value={unitFilter} allLabel="全部单元" options={unitOptions} open={openFilterPicker === "unit"} onToggle={() => setOpenFilterPicker((current) => current === "unit" ? null : "unit")} onSelect={(value) => { setUnitFilter(value); setOpenFilterPicker(null); }} />
      <span className="filter-section-label">工单状态</span>
      <div className="status-filter-options">{workOrderStatusOptions.map((option) => <button type="button" key={option.value} className={statusFilter === option.value ? "active" : ""} onClick={() => setStatusFilter(option.value)}>{option.label}</button>)}</div>
      <span className="filter-section-label">排序方式</span>
      <div className="sort-filter-options">{workOrderSortOptions.map((option) => <button type="button" key={option.value} className={sortField === option.value ? "active" : ""} aria-pressed={sortField === option.value} onClick={() => setSortField(option.value)}>{option.label}</button>)}</div>
      <span className="filter-section-label">排序方向</span>
      <div className="sort-filter-options">
        <button type="button" className={`sort-direction-button ${sortDirection === "asc" ? "active" : ""}`} aria-pressed={sortDirection === "asc"} disabled={sortField === "original"} onClick={() => setSortDirection("asc")}>升序</button>
        <button type="button" className={`sort-direction-button ${sortDirection === "desc" ? "active" : ""}`} aria-pressed={sortDirection === "desc"} disabled={sortField === "original"} onClick={() => setSortDirection("desc")}>降序</button>
      </div>
      <button onClick={() => { setOpenFilterPicker(null); setFilterOpen(false); }}>完成（筛选并排序后 {filteredOrders.length} 条）</button>
    </section></div>}
    {loadingOrders ? <div className="loading-mask">正在加载工单…</div> : null}
    {screen === "orders" && <PrimaryNav active={mainTab} onChange={setMainTab} />}
  </main></div>;
}
