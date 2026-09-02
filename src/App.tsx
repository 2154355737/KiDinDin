import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { FilterPicker } from "./components/FilterPicker";
import { Icon } from "./components/Icon";
import { PrimaryNav } from "./components/Navigation";
import { SessionExpiryNotice } from "./components/SessionExpiryNotice";
import { StartupSplash } from "./components/StartupSplash";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import type { LogAuditResult } from "./pages/LogAuditPage";
import {
  configureAuthSession,
  exportAuthSession,
  fetchAuthHistory,
  fetchAuthStatus,
  logoutAuth,
  refreshAuthSession,
  restoreAuthHistory,
  setAuthRefreshToken,
  type AuthHistoryItem,
} from "./services/authApi";
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
import {
  consumePendingPrefillTarget,
  fetchFloatingOverlayStatus,
  fetchIsMobileRuntime,
  isWorkOrderAuthExpiredError,
  isNativeRuntime,
  reportNativeWorkOrderPrefill,
  reportNativeWorkOrderSecurityDate,
  syncNativeWorkOrderIndex,
  WORK_ORDER_AUTH_EXPIRED_EVENT,
  type AuthStatus,
  type WorkOrderAuthExpiredDetail,
} from "./services/tauri";
import {
  APPEARANCE_STORAGE_KEY,
  getThemeMetaColor,
  loadAppearanceSettings,
  resolveAccent,
  resolveTheme,
} from "./services/theme";
import {
  APP_SETTINGS_STORAGE_KEY,
  loadAppSettings,
  type AppSettings,
} from "./services/appSettings";
import { saveUtf8JsonFile } from "./services/fullBackup";
import {
  getStorefrontPhotoPrefillHeaderIds,
  getStorefrontPhotoPrefills,
  storefrontPhotoPrefillToFile,
} from "./services/storefrontPrefillStore";
import { getSignedWorkOrderHeaderIds } from "./services/signatureStore";
import { getResidentSecurityPrefilledIds } from "./services/residentSecurityPrefillStore";
import {
  findDuplicateImage,
  findFirstDuplicateImage,
  type ImageDeduplicationEntry,
} from "./services/imageDeduplication";
import {
  inspectResidentSecurityPrefill,
  isResidentSecurityPrefillTarget,
  saveResidentSecurityPrefill,
} from "./services/residentSecurityPrefillApi";
import {
  getWorkOrderStatus,
  matchesWorkOrderStatus,
  workOrderStatusOptions,
  type BatchSubmitMode,
  type DrawerKind,
  type MainTab,
  type OrderStatus,
  type Screen,
  type AppearanceSettings,
  type WorkOrder,
  type WorkOrderStatusFilter,
} from "./types/workOrder";

const AppDrawer = lazy(() =>
  import("./components/AppDrawer").then((module) => ({
    default: module.AppDrawer,
  })),
);

const STARTUP_ORDERS_PRELOAD_TIMEOUT_MS = 8_000;
const LocalWorkOrdersPage = lazy(() =>
  import("./pages/LocalWorkOrdersPage").then((module) => ({
    default: module.LocalWorkOrdersPage,
  })),
);
const LogAuditPage = lazy(() =>
  import("./pages/LogAuditPage").then((module) => ({
    default: module.LogAuditPage,
  })),
);
const MorePage = lazy(() =>
  import("./pages/MorePage").then((module) => ({
    default: module.MorePage,
  })),
);
const ImageEncodingPage = lazy(() =>
  import("./pages/ImageEncodingPage").then((module) => ({
    default: module.ImageEncodingPage,
  })),
);
const SignaturePage = lazy(() =>
  import("./pages/SignaturePage").then((module) => ({
    default: module.SignaturePage,
  })),
);
const SignatureManagementPage = lazy(() =>
  import("./pages/SignatureManagementPage").then((module) => ({
    default: module.SignatureManagementPage,
  })),
);
const AllWorkOrdersPage = lazy(() =>
  import("./pages/AllWorkOrdersPage").then((module) => ({
    default: module.AllWorkOrdersPage,
  })),
);
const VacantRoomPage = lazy(() =>
  import("./pages/VacantRoomPage").then((module) => ({
    default: module.VacantRoomPage,
  })),
);
const VacantRoomFillPage = lazy(() =>
  import("./pages/VacantRoomFillPage").then((module) => ({
    default: module.VacantRoomFillPage,
  })),
);
const ResidentSecurityPrefillPage = lazy(() =>
  import("./pages/ResidentSecurityPrefillPage").then((module) => ({
    default: module.ResidentSecurityPrefillPage,
  })),
);
const DailyBatchPrefillPage = lazy(() =>
  import("./pages/DailyBatchPrefillPage").then((module) => ({
    default: module.DailyBatchPrefillPage,
  })),
);
const VisitVerifyPage = lazy(() =>
  import("./pages/VisitVerifyPage").then((module) => ({
    default: module.VisitVerifyPage,
  })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);
const BackupRestorePage = lazy(() =>
  import("./pages/BackupRestorePage").then((module) => ({
    default: module.BackupRestorePage,
  })),
);
const StatsPage = lazy(() =>
  import("./pages/StatsPage").then((module) => ({
    default: module.StatsPage,
  })),
);
const SubmitPage = lazy(() =>
  import("./pages/SubmitPage").then((module) => ({
    default: module.SubmitPage,
  })),
);
const ModePage = lazy(() =>
  import("./pages/WorkflowPages").then((module) => ({
    default: module.ModePage,
  })),
);
const PreparePage = lazy(() =>
  import("./pages/WorkflowPages").then((module) => ({
    default: module.PreparePage,
  })),
);
const ConfirmPage = lazy(() =>
  import("./pages/WorkflowPages").then((module) => ({
    default: module.ConfirmPage,
  })),
);
const RunningPage = lazy(() =>
  import("./pages/WorkflowPages").then((module) => ({
    default: module.RunningPage,
  })),
);
const RecordsPage = lazy(() =>
  import("./pages/WorkflowPages").then((module) => ({
    default: module.RecordsPage,
  })),
);

const CLOSE_REASON_UNREACHABLE = "11";
const EXCHANGE_TYPE_UNREACHABLE = "80";
const DEFAULT_OPERATOR_NAME_STORAGE_KEY = "kidindin.default-operator-name";
const AUTO_LOGIN_HISTORY_STORAGE_KEY = "kidindin.auto-login-history-id";
const AUTO_REFRESH_STORAGE_PREFIX = "kidindin.auto-refresh-at:";
const PENDING_LOG_RETRY_STORAGE_PREFIX = "kidindin.pending-log-retries:";
const HOME_FLOOR_GROUPING_STORAGE_KEY =
  "kidindin.home-floor-grouping-state.v1";
const AUTO_LOGIN_DISABLED = "disabled";
const AUTO_REFRESH_COOLDOWN_MS = 3 * 60 * 60_000;
const TOKEN_EXPIRY_WARNING_MS = 30 * 60_000;

type HomeFloorGroupingState = Record<string, string[]>;

function loadHomeFloorGroupingState(): HomeFloorGroupingState {
  try {
    const raw = localStorage.getItem(HOME_FLOOR_GROUPING_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};

    return Object.fromEntries(
      Object.entries(parsed)
        .filter(
          (entry): entry is [string, string[]] =>
            Array.isArray(entry[1]) &&
            entry[1].every((key) => typeof key === "string"),
        )
        .map(([key, values]) => [key, Array.from(new Set(values)).sort()]),
    );
  } catch {
    return {};
  }
}

function normalizeExpiryTimestamp(expiresAt: number | null | undefined) {
  if (!expiresAt || !Number.isFinite(expiresAt)) return null;
  return expiresAt < 2_000_000_000 ? expiresAt * 1_000 : expiresAt;
}

function unauthenticatedStatus(): AuthStatus {
  return {
    authenticated: false,
    employeeNumber: null,
    expiresAt: null,
    refreshAvailable: false,
    username: null,
  };
}

function localAccountKeyFor(status: AuthStatus, historyId?: string | null) {
  const employeeNumber = status.employeeNumber?.trim();
  if (employeeNumber) return `employee:${employeeNumber}`;
  const username = status.username?.trim();
  if (username) return `username:${username}`;
  return historyId?.trim() ? `history:${historyId.trim()}` : null;
}

function autoRefreshStorageKey(accountKey: string) {
  return `${AUTO_REFRESH_STORAGE_PREFIX}${accountKey}`;
}

function isAutoRefreshCoolingDown(accountKey: string, now = Date.now()) {
  const lastRefreshAt = Number(
    localStorage.getItem(autoRefreshStorageKey(accountKey)),
  );
  return (
    Number.isFinite(lastRefreshAt) &&
    lastRefreshAt > 0 &&
    lastRefreshAt <= now &&
    now - lastRefreshAt < AUTO_REFRESH_COOLDOWN_MS
  );
}

function tokenHintFromInput(tokenText: string) {
  const raw = tokenText.trim();
  let token = raw;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const payload =
      parsed.data && typeof parsed.data === "object"
        ? (parsed.data as Record<string, unknown>)
        : parsed;
    const value = [
      parsed.access_token,
      parsed.accessToken,
      parsed.token,
      parsed.authorization,
      payload.access_token,
      payload.accessToken,
      payload.token,
      payload.authorization,
    ].find((item) => typeof item === "string" && item.trim()) as
      | string
      | undefined;
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

type HistoryPhotoStatus = "idle" | "loading" | "ready" | "error";

type WatermarkedOrderUpload = {
  address: string;
  bizId: string;
  previewFiles: File[];
  sourceFiles: [File, File];
};

function registeredWatermarkAddress(order: WorkOrder) {
  const fullAddress = order.address.trim();
  const buildingAddress = fullAddress.match(
    /^(.+?(?:\d+|[一二三四五六七八九十]+)\s*(?:号楼|栋|幢|座))/,
  )?.[1]?.trim();
  const address = buildingAddress || fullAddress;
  if (!address || address === "未提供服务地址" || address === "地址信息待补充") {
    throw new Error(`${order.woNumber || order.id} 缺少可用于水印的工单登记地址`);
  }
  return address;
}

function batchImageEntries(
  orders: readonly WorkOrder[],
  storefrontFiles: Readonly<Record<string, File>>,
  detailFiles: Readonly<Record<string, File>>,
) {
  return orders.flatMap((order) => {
    const label = order.woNumber || order.id;
    const entries: ImageDeduplicationEntry[] = [];
    const storefrontFile = storefrontFiles[order.id];
    const detailFile = detailFiles[order.id];
    if (storefrontFile) {
      entries.push({
        file: storefrontFile,
        key: `${order.id}:storefront`,
        label: `${label} 的门头照片`,
      });
    }
    if (detailFile) {
      entries.push({
        file: detailFile,
        key: `${order.id}:detail`,
        label: `${label} 的详细单近景照片`,
      });
    }
    return entries;
  });
}

type PendingLogRetry = {
  createdAt: string;
  woHeaderId: string;
  woNumber: string;
};

type PullRefreshGesture = {
  axis: "pending" | "horizontal" | "vertical";
  distance: number;
  scroller: HTMLElement;
  startX: number;
  startY: number;
};

type WorkOrderSortField =
  | "original"
  | "number"
  | "resident"
  | "location"
  | "time"
  | "status";
type SortDirection = "asc" | "desc";

const workOrderSortOptions: Array<{
  label: string;
  value: WorkOrderSortField;
}> = [
  { label: "默认", value: "original" },
  { label: "工单号", value: "number" },
  { label: "住户", value: "resident" },
  { label: "位置/楼层", value: "location" },
  { label: "计划时间", value: "time" },
  { label: "状态", value: "status" },
];

const naturalCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

function statusSortRank(statusCode: string) {
  switch (statusCode) {
    case "20":
      return 0;
    case "30":
      return 1;
    case "40":
    case "50":
      return 2;
    case "60":
      return 3;
    default:
      return 4;
  }
}

function compareWorkOrders(
  left: WorkOrder,
  right: WorkOrder,
  field: Exclude<WorkOrderSortField, "original">,
) {
  switch (field) {
    case "number":
      return naturalCollator.compare(
        left.woNumber || left.id,
        right.woNumber || right.id,
      );
    case "resident":
      return naturalCollator.compare(left.resident, right.resident);
    case "location": {
      const buildingComparison = naturalCollator.compare(
        left.building,
        right.building,
      );
      if (buildingComparison !== 0) return buildingComparison;
      const unitNumberComparison = naturalCollator.compare(
        left.unitNumber,
        right.unitNumber,
      );
      if (unitNumberComparison !== 0) return unitNumberComparison;
      const floorComparison = naturalCollator.compare(
        left.floorNumber,
        right.floorNumber,
      );
      return floorComparison !== 0
        ? floorComparison
        : naturalCollator.compare(left.unit, right.unit);
    }
    case "time":
      return naturalCollator.compare(left.time, right.time);
    case "status":
      return (
        statusSortRank(left.backendStatusCode) -
        statusSortRank(right.backendStatusCode)
      );
  }
}

function isMissingPlanTime(value: string) {
  const normalized = value.trim();
  return !normalized || normalized === "待安排";
}

function sortWorkOrders(
  items: WorkOrder[],
  field: WorkOrderSortField,
  direction: SortDirection,
) {
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
      return comparison === 0
        ? left.index - right.index
        : comparison * directionFactor;
    })
    .map(({ order }) => order);
}

function textField(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function historyTimestamp(order: Record<string, unknown>) {
  const value =
    textField(order.actualEndDate) ||
    textField(order.updateTime) ||
    textField(order.createTime);
  const timestamp = Date.parse(value.replace(/-/g, "/"));
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function photoBizIds(order: Record<string, unknown>) {
  return [
    ...new Set(
      [order.closeAttachBizId, order["closeAttachBizId-11"], order.woHeaderId]
        .map(textField)
        .filter(Boolean),
    ),
  ];
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function toUiOrder(source: CisWorkOrder): WorkOrder {
  const address = source.addressDetail ?? {};
  const building =
    textField(source.building) ||
    textField(address.building) ||
    "未标注楼栋";
  const unitNumber =
    textField(source.unitsNumber) ||
    textField(address.unitsNumber) ||
    "未标注单元";
  const floorNumber =
    textField(source.floorNumber) ||
    textField(address.floorNumber) ||
    "未标注楼层";
  const roomNumber =
    textField(source.roomNumber) ||
    textField(address.roomNumber) ||
    "未标注房号";
  const unit =
    [building, unitNumber, floorNumber, roomNumber]
      .filter((value) => value && !value.startsWith("未标注"))
      .join(" ") || "地址信息待补充";
  const backendStatusCode = String(source.statusCode ?? "");
  return {
    address: String(
      source.addressDetailed ?? address.addressDetailed ?? "未提供服务地址",
    ),
    backendStatusCode,
    building,
    id: source.woNumber || source.woHeaderId,
    raw: source,
    resident: String(source.userName ?? source.contactPerson ?? "未命名用户"),
    searchText: [
      source.woNumber,
      source.userName,
      source.contactPerson,
      source.contactPhone,
      source.addressDetailed,
      address.addressDetailed,
      source.userNumber,
      building,
      unitNumber,
      floorNumber,
      roomNumber,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
    status: getWorkOrderStatus(backendStatusCode),
    time: source.expectingDate?.slice(11, 16) || "待安排",
    unit,
    unitNumber,
    floorNumber,
    woHeaderId: source.woHeaderId,
    woNumber: source.woNumber,
  };
}

function toLocalSnapshot(order: WorkOrder): LocalWorkOrderSnapshot {
  return {
    address: order.address,
    backendStatusCode: order.backendStatusCode,
    building: order.building,
    floorNumber: order.floorNumber,
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
  const status: OrderStatus = [
    "待处理",
    "处理中",
    "已完成",
    "已结束",
    "待提交",
    "关闭失败",
    "日志失败",
    "未知",
  ].includes(snapshot.status)
    ? (snapshot.status as OrderStatus)
    : "未知";
  return {
    address: snapshot.address,
    backendStatusCode: snapshot.backendStatusCode,
    building: snapshot.building,
    floorNumber: snapshot.floorNumber,
    id: snapshot.woNumber || item.woHeaderId,
    resident: snapshot.resident,
    searchText: [
      snapshot.woNumber,
      snapshot.resident,
      snapshot.address,
      snapshot.building,
      snapshot.unitNumber,
      snapshot.floorNumber,
      item.note,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
    status,
    time: snapshot.time,
    unit: snapshot.unit,
    unitNumber: snapshot.unitNumber,
    woHeaderId: item.woHeaderId,
    woNumber: snapshot.woNumber,
  };
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isUnreachableExchangeLog(log: Record<string, unknown>) {
  return (
    String(log.exchangeType ?? "") === EXCHANGE_TYPE_UNREACHABLE ||
    JSON.stringify(log).includes("到访不遇")
  );
}

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [isMobileRuntime, setIsMobileRuntime] = useState(false);
  const [startupSplashVisible, setStartupSplashVisible] = useState(true);
  const [startupOrdersPreloadTimedOut, setStartupOrdersPreloadTimedOut] =
    useState(false);
  const [authHistory, setAuthHistory] = useState<AuthHistoryItem[]>([]);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [startupRefreshNotice, setStartupRefreshNotice] = useState<
    string | null
  >(null);
  const [sessionExpiryNow, setSessionExpiryNow] = useState(() => Date.now());
  const [dismissedSessionExpiryKey, setDismissedSessionExpiryKey] = useState<
    string | null
  >(null);
  const [screen, setScreen] = useState<Screen>("orders");
  const [mainTab, setMainTab] = useState<MainTab>("home");
  const [appearanceSettings, setAppearanceSettings] =
    useState<AppearanceSettings>(loadAppearanceSettings);
  const [appSettings, setAppSettings] =
    useState<AppSettings>(loadAppSettings);
  const settingsReturnTabRef = useRef<MainTab>("more");
  const [appearanceClock, setAppearanceClock] = useState(() => Date.now());
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<WorkOrderStatusFilter>("all");
  const [buildingFilter, setBuildingFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const [floorFilter, setFloorFilter] = useState("all");
  const [sortField, setSortField] = useState<WorkOrderSortField>("original");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [openFilterPicker, setOpenFilterPicker] = useState<
    "building" | "unit" | "floor" | null
  >(null);
  const [selectedDate, setSelectedDate] = useState(today());
  const [homeFloorGroupingState, setHomeFloorGroupingState] =
    useState<HomeFloorGroupingState>(loadHomeFloorGroupingState);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [batchOrderIds, setBatchOrderIds] = useState<string[]>([]);
  const [activeOrderId, setActiveOrderId] = useState("");
  const [localDetailOrder, setLocalDetailOrder] = useState<WorkOrder | null>(
    null,
  );
  const [localAccountKey, setLocalAccountKey] = useState<string | null>(null);
  const [localWorkOrders, setLocalWorkOrders] = useState<LocalWorkOrderMeta[]>(
    [],
  );
  const [localDataBusy, setLocalDataBusy] = useState(false);
  const [localDataMessage, setLocalDataMessage] = useState("");
  const [localSavingOrderIds, setLocalSavingOrderIds] = useState<string[]>([]);
  const [, setPendingLogRetries] = useState<Record<string, PendingLogRetry>>(
    {},
  );
  const pendingLogRetriesRef = useRef<Record<string, PendingLogRetry>>({});
  const localSaveLocks = useRef(new Set<string>());
  const sessionRefreshPromise = useRef<Promise<AuthStatus> | null>(null);
  const authExpiryHandlingRef = useRef(false);
  const sessionEstablishedAtRef = useRef(0);
  const ordersRequestSequenceRef = useRef(0);
  const securityDateLookupsRef = useRef(new Set<string>());
  const [historyFiles, setHistoryFiles] = useState<Record<string, File>>({});
  const [historyMode, setHistoryMode] = useState<"manual" | "auto">("manual");
  const [submitMode, setSubmitMode] =
    useState<BatchSubmitMode>("all-manual");
  const [submitIntervalMinSeconds, setSubmitIntervalMinSeconds] = useState(5);
  const [submitIntervalMaxSeconds, setSubmitIntervalMaxSeconds] = useState(10);
  const [historyPhotos, setHistoryPhotos] = useState<HistoryPhotoCandidate[]>(
    [],
  );
  const [historyPhotoLoadingOrderIds, setHistoryPhotoLoadingOrderIds] =
    useState<string[]>([]);
  const [historyPhotoError, setHistoryPhotoError] = useState<string | null>(
    null,
  );
  const [historyPhotoCache, setHistoryPhotoCache] = useState<
    Record<string, HistoryPhotoCacheEntry>
  >({});
  const [selectedHistoryPhotoIds, setSelectedHistoryPhotoIds] = useState<
    Record<string, string>
  >({});
  const historyPhotoRequestsRef = useRef(
    new Map<string, Promise<HistoryPhotoCacheEntry>>(),
  );
  const [libraryFile, setLibraryFile] = useState<File | null>(null);
  const [detailCloseupFiles, setDetailCloseupFiles] = useState<
    Record<string, File>
  >({});
  const [watermarkedUploads, setWatermarkedUploads] = useState<
    Record<string, WatermarkedOrderUpload>
  >({});
  const [storefrontPrefilledOrderIds, setStorefrontPrefilledOrderIds] =
    useState<string[]>([]);
  const [storefrontPrefilledOrderHeaderIds, setStorefrontPrefilledOrderHeaderIds] =
    useState<string[]>([]);
  const [residentSecurityPrefilledOrderHeaderIds, setResidentSecurityPrefilledOrderHeaderIds] =
    useState<string[]>([]);
  const [signedOrderHeaderIds, setSignedOrderHeaderIds] = useState<string[]>([]);
  const [signatureOrder, setSignatureOrder] = useState<WorkOrder | null>(null);
  const signatureReturnRef = useRef<{
    mainTab: MainTab;
    order: WorkOrder;
    screen: Screen;
  } | null>(null);
  const [batchStorefrontMessage, setBatchStorefrontMessage] = useState("");
  const [batchStorefrontLoading, setBatchStorefrontLoading] = useState(false);
  const [batchDuplicateChecking, setBatchDuplicateChecking] = useState(false);
  const batchAutoSelectKeyRef = useRef("");
  const [reason, setReason] = useState("到访不遇-有居住痕迹");
  const [remark, setRemark] = useState("");
  const [customOperatorName, setCustomOperatorName] = useState(
    () =>
      localStorage.getItem(DEFAULT_OPERATOR_NAME_STORAGE_KEY)?.trim() || "段鑫",
  );
  const [drawer, setDrawer] = useState<DrawerKind | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [runMessage, setRunMessage] = useState("等待开始");
  const [detail, setDetail] = useState<WorkOrderDetail | null>(null);
  const [detailAjInfo, setDetailAjInfo] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [logAuditResults, setLogAuditResults] = useState<
    Record<string, LogAuditResult>
  >({});
  const [logAuditRunning, setLogAuditRunning] = useState(false);
  const [logAuditRetryRunning, setLogAuditRetryRunning] = useState(false);
  const [pullRefreshDistance, setPullRefreshDistance] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const pullRefreshGesture = useRef<PullRefreshGesture | null>(null);
  const pullRefreshDistanceRef = useRef(0);
  const [logAuditMessage, setLogAuditMessage] = useState("");

  const loggedIn = Boolean(auth?.authenticated);
  const finishStartupSplash = useCallback(
    () => setStartupSplashVisible(false),
    [],
  );
  const homeFloorGroupingStateKey = `${localAccountKey ?? "unidentified"}:${selectedDate}`;
  const collapsedHomeFloorGroupKeys =
    homeFloorGroupingState[homeFloorGroupingStateKey] ?? [];
  const updateCollapsedHomeFloorGroupKeys = useCallback(
    (keys: string[]) => {
      const normalizedKeys = Array.from(
        new Set(keys.filter((key) => key.trim())),
      ).sort();
      setHomeFloorGroupingState((current) => {
        const existing = current[homeFloorGroupingStateKey] ?? [];
        if (
          existing.length === normalizedKeys.length &&
          existing.every((key, index) => key === normalizedKeys[index])
        )
          return current;

        const next = { ...current };
        if (normalizedKeys.length)
          next[homeFloorGroupingStateKey] = normalizedKeys;
        else delete next[homeFloorGroupingStateKey];
        return next;
      });
    },
    [homeFloorGroupingStateKey],
  );
  const changeSelectedDate = useCallback(
    (value: string) => {
      if (value === selectedDate) return;
      ordersRequestSequenceRef.current += 1;
      setLoadingOrders(true);
      setSelectedDate(value);
    },
    [selectedDate],
  );
  const sessionExpiryAt = normalizeExpiryTimestamp(auth?.expiresAt);
  const sessionExpiryKey =
    sessionExpiryAt === null
      ? null
      : `${localAccountKey ?? auth?.employeeNumber ?? auth?.username ?? "session"}:${sessionExpiryAt}`;
  const sessionRemainingMs =
    sessionExpiryAt === null ? null : sessionExpiryAt - sessionExpiryNow;
  const showSessionExpiryNotice =
    loggedIn &&
    sessionRemainingMs !== null &&
    sessionRemainingMs <= TOKEN_EXPIRY_WARNING_MS &&
    dismissedSessionExpiryKey !== sessionExpiryKey;
  const displaySessionExpiryNotice =
    showSessionExpiryNotice && !drawer && !filterOpen;
  const appliedTheme = resolveTheme(appearanceSettings, systemDark);
  const appliedAccent = resolveAccent(
    appearanceSettings,
    new Date(appearanceClock),
  );
  const startupSplashReady =
    auth !== null &&
    (!loggedIn || !loadingOrders || startupOrdersPreloadTimedOut);
  const startupSplashStatus =
    auth === null
      ? "正在安全恢复本机会话"
      : !loggedIn
        ? loginError?.includes("过期")
          ? "凭证已过期，正在返回登录页"
          : "会话检查完成"
        : startupOrdersPreloadTimedOut && loadingOrders
          ? "工单加载超过 8 秒，进入首页继续加载"
          : loadingOrders
            ? "正在预加载今日工单"
            : loadError
              ? "今日工单预加载失败，可进入后重试"
              : `今日工单已就绪 · ${orders.length} 条`;
  const operatorName = customOperatorName.trim() || "段鑫";
  const pendingLogRetryStorageKey = localAccountKey
    ? `${PENDING_LOG_RETRY_STORAGE_PREFIX}${localAccountKey}`
    : null;
  const localMetaById = useMemo(
    () =>
      Object.fromEntries(
        localWorkOrders.map((item) => [item.woHeaderId, item]),
      ),
    [localWorkOrders],
  );
  const activeOrder =
    localDetailOrder ??
    orders.find((order) => order.id === activeOrderId) ??
    orders[0];
  const activeHistoryFile = activeOrder
    ? (historyFiles[activeOrder.id] ?? null)
    : null;
  const activeDetailCloseupFile = activeOrder
    ? (detailCloseupFiles[activeOrder.id] ?? null)
    : null;
  const activeHistoryPhotoId = activeOrder
    ? (selectedHistoryPhotoIds[activeOrder.id] ?? "")
    : "";
  const selectedOrders = useMemo(
    () =>
      sortWorkOrders(
        orders.filter(
          (order) =>
            selected.includes(order.id) && order.backendStatusCode === "20",
        ),
        sortField,
        sortDirection,
      ),
    [orders, selected, sortDirection, sortField],
  );
  const allManualReadyByOrder = useMemo(
    () =>
      Object.fromEntries(
        selectedOrders.map((order) => [
          order.id,
          Boolean(historyFiles[order.id] && detailCloseupFiles[order.id]),
        ]),
      ),
    [detailCloseupFiles, historyFiles, selectedOrders],
  );
  const allManualDoorfrontReadyByOrder = useMemo(
    () =>
      Object.fromEntries(
        selectedOrders.map((order) => [order.id, Boolean(historyFiles[order.id])]),
      ),
    [historyFiles, selectedOrders],
  );
  const storefrontPrefilledByOrder = useMemo(
    () =>
      Object.fromEntries(
        selectedOrders.map((order) => [
          order.id,
          storefrontPrefilledOrderIds.includes(order.id),
        ]),
      ),
    [selectedOrders, storefrontPrefilledOrderIds],
  );
  const pendingSelectedIds = useMemo(
    () => selectedOrders.map((order) => order.id),
    [selectedOrders],
  );
  const historyPhotoStatusByOrder = useMemo(
    () =>
      Object.fromEntries(
        selectedOrders.map((order) => {
          const entry = historyPhotoCache[order.id];
          let status: HistoryPhotoStatus = "idle";
          if (historyPhotoLoadingOrderIds.includes(order.id)) status = "loading";
          else if (entry?.error) status = "error";
          else if (entry?.photos.length) status = "ready";
          return [order.id, status];
        }),
      ) as Record<string, HistoryPhotoStatus>,
    [historyPhotoCache, historyPhotoLoadingOrderIds, selectedOrders],
  );
  const batchOrders = useMemo(() => {
    const orderById = new Map(orders.map((order) => [order.id, order]));
    return batchOrderIds.flatMap((id) =>
      orderById.get(id) ? [orderById.get(id)!] : [],
    );
  }, [batchOrderIds, orders]);
  const filteredOrders = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const matchingOrders = orders.filter(
      (order) =>
        (!keyword || order.searchText.includes(keyword)) &&
        matchesWorkOrderStatus(order.backendStatusCode, statusFilter) &&
        (buildingFilter === "all" || order.building === buildingFilter) &&
        (unitFilter === "all" || order.unitNumber === unitFilter) &&
        (floorFilter === "all" || order.floorNumber === floorFilter),
    );
    return sortWorkOrders(matchingOrders, sortField, sortDirection);
  }, [
    buildingFilter,
    floorFilter,
    orders,
    query,
    sortDirection,
    sortField,
    statusFilter,
    unitFilter,
  ]);
  const buildingOptions = useMemo(
    () =>
      [...new Set(orders.map((order) => order.building).filter(Boolean))].sort(
        (left, right) => left.localeCompare(right, "zh-CN"),
      ),
    [orders],
  );
  const unitOptions = useMemo(
    () =>
      [
        ...new Set(
          orders
            .filter(
              (order) =>
                buildingFilter === "all" || order.building === buildingFilter,
            )
            .map((order) => order.unitNumber)
            .filter(Boolean),
        ),
      ].sort((left, right) => left.localeCompare(right, "zh-CN")),
    [buildingFilter, orders],
  );
  const floorOptions = useMemo(
    () =>
      [
        ...new Set(
          orders
            .filter(
              (order) =>
                (buildingFilter === "all" ||
                  order.building === buildingFilter) &&
                (unitFilter === "all" || order.unitNumber === unitFilter),
            )
            .map((order) => order.floorNumber)
            .filter(Boolean),
        ),
      ].sort((left, right) => naturalCollator.compare(left, right)),
    [buildingFilter, orders, unitFilter],
  );
  const activeFilterCount = [
    statusFilter !== "all",
    buildingFilter !== "all",
    unitFilter !== "all",
    floorFilter !== "all",
  ].filter(Boolean).length;
  const pendingSubmitOrders = useMemo(
    () => filteredOrders.filter((order) => order.backendStatusCode === "20"),
    [filteredOrders],
  );
  const storefrontPrefillLookupIds = useMemo(
    () =>
      Array.from(
        new Set(orders.map((order) => order.woHeaderId).filter(Boolean)),
      ),
    [orders],
  );
  const storefrontPrefillLookupKey = storefrontPrefillLookupIds.join("\u0000");
  const batchAutoSelectionKey = `${localAccountKey ?? "unidentified"}:${selectedDate}:${pendingSubmitOrders
    .map((order) => order.woHeaderId)
    .join("\u0000")}`;

  useEffect(() => {
    let active = true;
    if (!localAccountKey || !storefrontPrefillLookupIds.length) {
      setStorefrontPrefilledOrderHeaderIds([]);
      return () => {
        active = false;
      };
    }

    void getStorefrontPhotoPrefillHeaderIds(
      localAccountKey,
      storefrontPrefillLookupIds,
    )
      .then((storedHeaderIds) => {
        if (!active) return;
        setStorefrontPrefilledOrderHeaderIds(storedHeaderIds);
      })
      .catch(() => {
        if (active) setStorefrontPrefilledOrderHeaderIds([]);
      });
    return () => {
      active = false;
    };
  }, [localAccountKey, storefrontPrefillLookupKey]);

  useEffect(() => {
    let active = true;
    if (!localAccountKey || !storefrontPrefillLookupIds.length) {
      setSignedOrderHeaderIds([]);
      return () => {
        active = false;
      };
    }
    void getSignedWorkOrderHeaderIds(localAccountKey, storefrontPrefillLookupIds)
      .then((storedHeaderIds) => {
        if (active) setSignedOrderHeaderIds(storedHeaderIds);
      })
      .catch(() => {
        if (active) setSignedOrderHeaderIds([]);
      });

    // 加载居民安检预填记录
    const residentSecurityPrefilledIds = getResidentSecurityPrefilledIds(localAccountKey);
    setResidentSecurityPrefilledOrderHeaderIds(residentSecurityPrefilledIds);

    return () => {
      active = false;
    };
  }, [localAccountKey, storefrontPrefillLookupKey]);

  useEffect(() => {
    if (screen !== "select" || submitMode !== "all-manual") return;
    if (batchAutoSelectKeyRef.current === batchAutoSelectionKey) return;

    if (!localAccountKey) {
      batchAutoSelectKeyRef.current = batchAutoSelectionKey;
      setBatchStorefrontMessage(
        "当前登录缺少本地账号标识，无法自动勾选预填工单；仍可手动勾选并上传照片",
      );
      return;
    }

    let active = true;
    const visibleOrderIds = new Set(
      pendingSubmitOrders.map((order) => order.id),
    );
    const visibleHeaderIds = new Set(
      pendingSubmitOrders.map((order) => order.woHeaderId),
    );
    setBatchStorefrontLoading(true);
    setBatchStorefrontMessage("正在读取本机已预填的到访不遇照片…");
    void getStorefrontPhotoPrefillHeaderIds(
      localAccountKey,
      Array.from(visibleHeaderIds),
    )
      .then((storedHeaderIds) => {
        if (!active) return;
        batchAutoSelectKeyRef.current = batchAutoSelectionKey;
        const storedHeaderIdSet = new Set(storedHeaderIds);
        const autoSelectedOrderIds = pendingSubmitOrders
          .filter((order) => storedHeaderIdSet.has(order.woHeaderId))
          .map((order) => order.id);
        setStorefrontPrefilledOrderHeaderIds((current) => [
          ...current.filter((id) => !visibleHeaderIds.has(id)),
          ...storedHeaderIds,
        ]);
        setSelected((current) => [
          ...current.filter((id) => !visibleOrderIds.has(id)),
          ...autoSelectedOrderIds,
        ]);
        setBatchStorefrontMessage(
          autoSelectedOrderIds.length
            ? `已自动勾选 ${autoSelectedOrderIds.length} 个预填过到访不遇门头照片的工单`
            : "当前列表没有已预填到访不遇门头照片的工单，可按需手动勾选",
        );
      })
      .catch((error) => {
        if (!active) return;
        batchAutoSelectKeyRef.current = batchAutoSelectionKey;
        setBatchStorefrontMessage(
          `读取预填状态失败：${messageOf(error)}；请按需手动勾选工单`,
        );
      })
      .finally(() => {
        if (active) setBatchStorefrontLoading(false);
      });
    return () => {
      active = false;
      setBatchStorefrontLoading(false);
    };
  }, [
    batchAutoSelectionKey,
    localAccountKey,
    pendingSubmitOrders,
    screen,
    submitMode,
  ]);

  const replacePendingLogRetries = useCallback(
    (next: Record<string, PendingLogRetry>) => {
      pendingLogRetriesRef.current = next;
      setPendingLogRetries(next);
      if (!pendingLogRetryStorageKey) return;
      try {
        localStorage.setItem(
          pendingLogRetryStorageKey,
          JSON.stringify(Object.values(next)),
        );
      } catch {
        // The active submission flow remains usable when local persistence is unavailable.
      }
    },
    [pendingLogRetryStorageKey],
  );

  const queuePendingLogRetry = useCallback(
    (order: WorkOrder) => {
      const current = pendingLogRetriesRef.current;
      if (current[order.woHeaderId]) return;
      replacePendingLogRetries({
        ...current,
        [order.woHeaderId]: {
          createdAt: new Date().toISOString(),
          woHeaderId: order.woHeaderId,
          woNumber: order.woNumber,
        },
      });
    },
    [replacePendingLogRetries],
  );

  const resolvePendingLogRetry = useCallback(
    (order: WorkOrder) => {
      const current = pendingLogRetriesRef.current;
      if (!current[order.woHeaderId]) return;
      const next = { ...current };
      delete next[order.woHeaderId];
      replacePendingLogRetries(next);
    },
    [replacePendingLogRetries],
  );

  useEffect(() => {
    if (
      buildingFilter !== "all" &&
      !buildingOptions.includes(buildingFilter)
    ) {
      setBuildingFilter("all");
      setUnitFilter("all");
      setFloorFilter("all");
    }
  }, [buildingFilter, buildingOptions]);

  useEffect(() => {
    if (unitFilter !== "all" && !unitOptions.includes(unitFilter)) {
      setUnitFilter("all");
      setFloorFilter("all");
    }
  }, [unitFilter, unitOptions]);

  useEffect(() => {
    if (floorFilter !== "all" && !floorOptions.includes(floorFilter))
      setFloorFilter("all");
  }, [floorFilter, floorOptions]);

  useEffect(() => {
    if (!pendingLogRetryStorageKey) {
      pendingLogRetriesRef.current = {};
      setPendingLogRetries({});
      return;
    }
    try {
      const parsed = JSON.parse(
        localStorage.getItem(pendingLogRetryStorageKey) ?? "[]",
      ) as unknown;
      const entries = Array.isArray(parsed) ? parsed : [];
      const next = Object.fromEntries(
        entries.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const item = entry as Partial<PendingLogRetry>;
          return typeof item.woHeaderId === "string" && item.woHeaderId
            ? [
                [
                  item.woHeaderId,
                  {
                    createdAt:
                      typeof item.createdAt === "string" ? item.createdAt : "",
                    woHeaderId: item.woHeaderId,
                    woNumber:
                      typeof item.woNumber === "string"
                        ? item.woNumber
                        : item.woHeaderId,
                  },
                ],
              ]
            : [];
        }),
      ) as Record<string, PendingLogRetry>;
      pendingLogRetriesRef.current = next;
      setPendingLogRetries(next);
    } catch {
      pendingLogRetriesRef.current = {};
      setPendingLogRetries({});
    }
  }, [pendingLogRetryStorageKey]);

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
    const requestSequence = ++ordersRequestSequenceRef.current;
    setLoadingOrders(true);
    setLoadError(null);
    try {
      const response = await fetchWorkOrders(`${selectedDate} 00:00:00`);
      if (requestSequence !== ordersRequestSequenceRef.current) return;
      const next = response.data
        .map(toUiOrder)
        .map((order) =>
          pendingLogRetriesRef.current[order.woHeaderId] &&
          order.backendStatusCode === "60"
            ? { ...order, status: "日志失败" as OrderStatus }
            : order,
        );
      setOrders(next);
      setSelected((current) =>
        current.filter((id) =>
          next.some(
            (order) => order.id === id && order.backendStatusCode === "20",
          ),
        ),
      );
      setActiveOrderId((current) =>
        next.some((order) => order.id === current)
          ? current
          : (next[0]?.id ?? ""),
      );
    } catch (error) {
      if (requestSequence !== ordersRequestSequenceRef.current) return;
      setOrders([]);
      setLoadError(messageOf(error));
    } finally {
      if (requestSequence === ordersRequestSequenceRef.current)
        setLoadingOrders(false);
    }
  }, [loggedIn, selectedDate]);

  useEffect(() => {
    if (!isNativeRuntime() || !loggedIn || !localAccountKey || loadingOrders)
      return;
    const entries = orders.map((order) => {
      const raw = order.raw ?? {};
      return {
        address: order.address,
        contactPhone:
          textField(raw.contactPhone) ||
          textField(raw.phoneNumber) ||
          textField(raw.mobile),
        eligiblePrefill: isResidentSecurityPrefillTarget(order),
        rawJson: JSON.stringify(raw),
        resident: order.resident,
        woHeaderId: order.woHeaderId,
        woNumber: order.woNumber,
      };
    });
    void syncNativeWorkOrderIndex(localAccountKey, selectedDate, entries).catch(
      (error) => console.warn("同步本地工单索引失败", error),
    );
  }, [loadingOrders, localAccountKey, loggedIn, orders, selectedDate]);

  useEffect(() => {
    if (!isNativeRuntime() || !loggedIn || !localAccountKey) return;
    let disposed = false;
    let checking = false;
    const updateRecentSecurityDate = async () => {
      if (checking || disposed) return;
      checking = true;
      try {
        const status = await fetchFloatingOverlayStatus();
        const recognition = status.recognition;
        if (
          !recognition.woHeaderId ||
          recognition.securityDate ||
          ![
            "matched",
            "repeat_confirm",
            "prefill_error",
            "prefill_success",
          ].includes(
            recognition.state,
          ) ||
          (recognition.accountKey && recognition.accountKey !== localAccountKey)
        ) {
          return;
        }
        const lookupKey = `${recognition.woHeaderId}:${recognition.recognizedAt}`;
        if (securityDateLookupsRef.current.has(lookupKey)) return;
        securityDateLookupsRef.current.add(lookupKey);
        let recentDate = "暂无历史记录";
        try {
          const parsed = JSON.parse(recognition.rawJson || "{}") as CisWorkOrder;
          const target = toUiOrder({
            ...parsed,
            woHeaderId: recognition.woHeaderId,
            woNumber: recognition.woNumber || parsed.woNumber,
            userName: parsed.userName || recognition.resident,
            addressDetailed: parsed.addressDetailed || recognition.address,
          });
          if (isResidentSecurityPrefillTarget(target)) {
            const inspected = await inspectResidentSecurityPrefill(target);
            recentDate = inspected.historyCompletedAt || "暂无历史记录";
          } else {
            recentDate = "不适用";
          }
        } catch (error) {
          console.warn("读取最近安检日期失败", error);
        }
        if (!disposed) {
          await reportNativeWorkOrderSecurityDate(
            recognition.woHeaderId,
            recentDate,
          );
        }
      } catch (error) {
        console.warn("同步悬浮窗最近安检日期失败", error);
      } finally {
        checking = false;
      }
    };
    void updateRecentSecurityDate();
    const interval = window.setInterval(
      () => void updateRecentSecurityDate(),
      1_000,
    );
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [localAccountKey, loggedIn]);

  useEffect(() => {
    if (!isNativeRuntime() || !loggedIn || !localAccountKey) return;
    let consuming = false;
    const consumeTarget = async () => {
      if (consuming) return;
      consuming = true;
      let targetWoHeaderId = "";
      try {
        const pending = await consumePendingPrefillTarget();
        if (!pending.pending || !("woHeaderId" in pending) || !pending.woHeaderId)
          return;
        targetWoHeaderId = pending.woHeaderId;
        if (pending.accountKey && pending.accountKey !== localAccountKey) {
          throw new Error("识别工单不属于当前登录账号");
        }
        const parsed = JSON.parse(pending.rawJson || "{}") as CisWorkOrder;
        const target = toUiOrder({
          ...parsed,
          woHeaderId: pending.woHeaderId,
          woNumber: pending.woNumber || parsed.woNumber,
          userName: parsed.userName || pending.resident,
          addressDetailed: parsed.addressDetailed || pending.address,
        });
        if (!isResidentSecurityPrefillTarget(target)) {
          throw new Error("当前工单不是可预填的待处理居民安检单");
        }
        await reportNativeWorkOrderPrefill(
          target.woHeaderId,
          "prefill_running",
          `正在核对 ${target.woNumber || target.woHeaderId} 的上一年安检内容…`,
        );
        const inspected = await inspectResidentSecurityPrefill(target);
        await reportNativeWorkOrderSecurityDate(
          target.woHeaderId,
          inspected.historyCompletedAt || "暂无历史记录",
        );
        const saved = await saveResidentSecurityPrefill(
          target,
          inspected.historyWoHeaderId,
        );
        const message = saved.prefillCount > 0
          ? `安检预填完成：已写入 ${saved.prefillCount} 项，来源 ${saved.historyYear} 年 ${saved.historyWoNumber}`
          : "安检预填完成：当前工单已有相同内容，无需重复写入";
        await reportNativeWorkOrderPrefill(
          target.woHeaderId,
          "prefill_success",
          message,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "安检预填失败";
        if (targetWoHeaderId) {
          await reportNativeWorkOrderPrefill(
            targetWoHeaderId,
            "prefill_error",
            `安检预填失败：${message}`,
          ).catch(() => undefined);
        }
        console.warn("悬浮窗安检预填失败", error);
      } finally {
        consuming = false;
      }
    };
    void consumeTarget();
    const interval = window.setInterval(() => void consumeTarget(), 750);
    return () => window.clearInterval(interval);
  }, [localAccountKey, loggedIn]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => setSystemDark(media.matches);
    media.addEventListener("change", syncTheme);
    return () => media.removeEventListener("change", syncTheme);
  }, []);
  useEffect(() => {
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify(appearanceSettings),
    );
  }, [appearanceSettings]);
  useEffect(() => {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(appSettings));
  }, [appSettings]);
  useEffect(() => {
    if (appearanceSettings.accentMode !== "schedule") return;
    const syncClock = () => setAppearanceClock(Date.now());
    const timer = window.setInterval(syncClock, 30_000);
    window.addEventListener("focus", syncClock);
    document.addEventListener("visibilitychange", syncClock);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", syncClock);
      document.removeEventListener("visibilitychange", syncClock);
    };
  }, [appearanceSettings.accentMode]);
  useEffect(() => {
    const root = document.documentElement;
    const themeColor = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    root.dataset.theme = appliedTheme;
    root.style.colorScheme = appliedTheme === "dark" ? "dark" : "light";
    (["light", "dark"] as const).forEach((themeName) => {
      document.body.classList.toggle(
        `theme-${themeName}`,
        appliedTheme === themeName,
      );
    });
    (["sky", "pink", "green", "purple", "orange"] as const).forEach(
      (accentName) => {
        document.body.classList.toggle(
          `accent-${accentName}`,
          appliedAccent === accentName,
        );
      },
    );
    themeColor?.setAttribute("content", getThemeMetaColor(appliedTheme));
  }, [appliedAccent, appliedTheme]);
  useEffect(() => {
    localStorage.setItem(
      DEFAULT_OPERATOR_NAME_STORAGE_KEY,
      customOperatorName.trim() || "段鑫",
    );
  }, [customOperatorName]);
  useEffect(() => {
    const handleAuthExpired = (event: Event) => {
      const detail = (event as CustomEvent<WorkOrderAuthExpiredDetail>).detail;
      if (
        detail?.requestStartedAt &&
        detail.requestStartedAt < sessionEstablishedAtRef.current
      )
        return;
      if (authExpiryHandlingRef.current) return;

      authExpiryHandlingRef.current = true;
      sessionEstablishedAtRef.current = 0;
      ordersRequestSequenceRef.current += 1;
      localStorage.setItem(
        AUTO_LOGIN_HISTORY_STORAGE_KEY,
        AUTO_LOGIN_DISABLED,
      );
      setAuth(unauthenticatedStatus());
      setLoginError("用户凭证已过期，请重新粘贴最新登录凭据。");
      setLocalAccountKey(null);
      setOrders([]);
      setSelected([]);
      setBatchOrderIds([]);
      setActiveOrderId("");
      setLocalDetailOrder(null);
      setLoadingOrders(false);
      setStartupOrdersPreloadTimedOut(false);
      setStartupRefreshNotice(null);
      setDrawer(null);
      setFilterOpen(false);
      setOpenFilterPicker(null);
      setRunning(false);
      setPaused(false);
      setScreen("orders");
      setMainTab("home");
      void logoutAuth().catch(() => undefined);
    };

    window.addEventListener(WORK_ORDER_AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () =>
      window.removeEventListener(
        WORK_ORDER_AUTH_EXPIRED_EVENT,
        handleAuthExpired,
      );
  }, []);
  useEffect(() => {
    let active = true;
    if (!isNativeRuntime()) {
      setIsMobileRuntime(false);
      setAuth(unauthenticatedStatus());
      setLoginError(
        "当前是浏览器预览，原生登录不可用。请安装并打开 KiDinDin APK 后再粘贴凭据。",
      );
      return;
    }

    const bootstrapAuth = async () => {
      try {
        const [mobileRuntime, current, history] = await Promise.all([
          fetchIsMobileRuntime(),
          fetchAuthStatus(),
          fetchAuthHistory(),
        ]);
        if (!active) return;
        setIsMobileRuntime(mobileRuntime);
        setAuthHistory(history);

        let next = current;
        let restoredHistory = false;
        const savedHistoryId = localStorage.getItem(
          AUTO_LOGIN_HISTORY_STORAGE_KEY,
        );
        let activeHistoryId =
          savedHistoryId &&
          savedHistoryId !== AUTO_LOGIN_DISABLED &&
          history.some((item) => item.id === savedHistoryId)
            ? savedHistoryId
            : undefined;
        const autoLoginHistory =
          savedHistoryId === AUTO_LOGIN_DISABLED
            ? undefined
            : (history.find((item) => item.id === savedHistoryId) ??
              history[0]);
        if (!next.authenticated && autoLoginHistory) {
          next = await restoreAuthHistory(autoLoginHistory.id);
          localStorage.setItem(
            AUTO_LOGIN_HISTORY_STORAGE_KEY,
            autoLoginHistory.id,
          );
          activeHistoryId = autoLoginHistory.id;
          restoredHistory = true;
        }

        const refreshAccountKey = localAccountKeyFor(
          next,
          activeHistoryId ?? autoLoginHistory?.id ?? history[0]?.id,
        );
        const autoRefreshCoolingDown = refreshAccountKey
          ? isAutoRefreshCoolingDown(refreshAccountKey)
          : false;
        let autoRefreshError: unknown = null;
        if (
          mobileRuntime &&
          next.authenticated &&
          next.refreshAvailable &&
          !autoRefreshCoolingDown
        ) {
          let refreshRequest = sessionRefreshPromise.current;
          if (!refreshRequest) {
            refreshRequest = refreshAuthSession();
            sessionRefreshPromise.current = refreshRequest;
          }
          try {
            next = await refreshRequest;
            restoredHistory = true;
            if (refreshAccountKey) {
              const refreshedAccountKey =
                localAccountKeyFor(
                  next,
                  activeHistoryId ?? autoLoginHistory?.id ?? history[0]?.id,
                ) ?? refreshAccountKey;
              const refreshedAt = String(Date.now());
              localStorage.setItem(
                autoRefreshStorageKey(refreshAccountKey),
                refreshedAt,
              );
              if (refreshedAccountKey !== refreshAccountKey)
                localStorage.setItem(
                  autoRefreshStorageKey(refreshedAccountKey),
                  refreshedAt,
                );
            }
            if (active)
              setStartupRefreshNotice(
                "Token 自动续期成功，3 小时内启动 App 不会重复续期",
              );
          } catch (error) {
            autoRefreshError = error;
            if (isWorkOrderAuthExpiredError(error)) throw error;
          } finally {
            if (sessionRefreshPromise.current === refreshRequest)
              sessionRefreshPromise.current = null;
          }
        }

        const nextExpiryAt = normalizeExpiryTimestamp(next.expiresAt);
        if (
          next.authenticated &&
          nextExpiryAt !== null &&
          nextExpiryAt <= Date.now()
        ) {
          if (!next.refreshAvailable)
            throw new Error("最近一次登录已过期，且没有可用的 refresh_token");
          if (autoRefreshError)
            throw new Error(
              `最近一次登录已过期，自动续期失败：${messageOf(autoRefreshError)}`,
            );
        }

        if (!active) return;
        if (next.authenticated) {
          setScreen("orders");
          setMainTab("home");
          const accountKey = localAccountKeyFor(
            next,
            activeHistoryId ?? autoLoginHistory?.id ?? history[0]?.id,
          );
          setLocalAccountKey(accountKey);
          if (!accountKey)
            setLocalDataMessage(
              "当前登录缺少可识别的账号信息，本地工单功能已停用",
            );
        } else {
          setLocalAccountKey(null);
        }
        authExpiryHandlingRef.current = false;
        sessionEstablishedAtRef.current = next.authenticated
          ? Date.now()
          : 0;
        setAuth(next);
        if (restoredHistory)
          void fetchAuthHistory()
            .then(setAuthHistory)
            .catch(() => undefined);
      } catch (error) {
        if (!active) return;
        setLocalAccountKey(null);
        setAuth(unauthenticatedStatus());
        setLoginError(
          isWorkOrderAuthExpiredError(error)
            ? "用户凭证已过期，请重新粘贴最新登录凭据。"
            : `自动恢复登录失败：${messageOf(error)}`,
        );
      }
    };

    void bootstrapAuth();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        HOME_FLOOR_GROUPING_STORAGE_KEY,
        JSON.stringify(homeFloorGroupingState),
      );
    } catch {
      // The in-memory state still preserves the UI while this app session is open.
    }
  }, [homeFloorGroupingState]);
  useEffect(() => {
    if (!loggedIn || !localAccountKey) {
      setLocalWorkOrders([]);
      setLocalDataBusy(false);
      if (!loggedIn) setLocalDataMessage("");
      else
        setLocalDataMessage("当前登录缺少可识别的账号信息，本地工单功能已停用");
      return;
    }
    let active = true;
    setLocalDataBusy(true);
    void listLocalWorkOrderMeta(localAccountKey)
      .then((items) => {
        if (active) setLocalWorkOrders(items);
      })
      .catch((error) => {
        if (active)
          setLocalDataMessage(`读取本地工单失败：${messageOf(error)}`);
      })
      .finally(() => {
        if (active) setLocalDataBusy(false);
      });
    return () => {
      active = false;
    };
  }, [localAccountKey, loggedIn]);
  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);
  useEffect(() => {
    if (
      !startupSplashVisible ||
      !loggedIn ||
      !loadingOrders ||
      startupOrdersPreloadTimedOut
    )
      return;

    const timeout = window.setTimeout(
      () => setStartupOrdersPreloadTimedOut(true),
      STARTUP_ORDERS_PRELOAD_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [
    loadingOrders,
    loggedIn,
    startupOrdersPreloadTimedOut,
    startupSplashVisible,
  ]);
  useEffect(() => {
    const cached = historyPhotoCache[activeOrderId];
    setHistoryPhotos(cached?.photos ?? []);
    setHistoryPhotoError(cached?.error ?? null);
  }, [activeOrderId, historyPhotoCache]);
  useEffect(() => {
    if (drawer !== "detail" || !activeOrder) return;
    let cancelled = false;
    setDetail(null);
    setDetailAjInfo(null);
    setDetailError(null);
    setDetailLoading(true);
    void fetchWorkOrderDetail(activeOrder.woHeaderId)
      .then(async (response) => {
        if (cancelled) return;
        setDetail(response.data);
        const header = response.data.tcisWoHeaderDto;
        const headerFields = (header ?? {}) as Record<string, unknown>;
        const userInfo = (headerFields.userinfo ?? {}) as Record<
          string,
          unknown
        >;
        const userInfoId = String(
          headerFields.userinfoId ?? userInfo.userInfoId ?? "",
        );
        const supplypointId = String(
          headerFields.supplyPointId ?? headerFields.supplypointId ?? "",
        );
        if (userInfoId && supplypointId) {
          const ajResponse = await fetchWorkOrderUserAjInfo(
            userInfoId,
            supplypointId,
          );
          if (!cancelled) setDetailAjInfo(ajResponse.data);
        }
      })
      .catch((error) => {
        if (!cancelled) setDetailError(messageOf(error));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrder, drawer]);

  const login = async (input: {
    tokenText: string;
    cookie: string;
    sign: string;
    target: string;
  }) => {
    setLoggingIn(true);
    setLoginError(null);
    try {
      const status = await configureAuthSession(input);
      setLoadingOrders(true);
      localStorage.removeItem(AUTO_LOGIN_HISTORY_STORAGE_KEY);
      const history = await fetchAuthHistory().catch(
        () => [] as AuthHistoryItem[],
      );
      const tokenHint = tokenHintFromInput(input.tokenText);
      const matchedHistory =
        history.find(
          (item) =>
            (status.employeeNumber &&
              item.employeeNumber === status.employeeNumber) ||
            (status.username && item.username === status.username) ||
            (tokenHint && item.tokenHint === tokenHint),
        ) ??
        history.find(
          (item) => !authHistory.some((previous) => previous.id === item.id),
        ) ??
        history[0];
      const historyId = matchedHistory?.id;
      const accountKey = localAccountKeyFor(status, historyId);
      setLocalAccountKey(accountKey);
      setLocalDataMessage(
        accountKey ? "" : "当前登录缺少可识别的账号信息，本地工单功能已停用",
      );
      authExpiryHandlingRef.current = false;
      sessionEstablishedAtRef.current = Date.now();
      setAuth(status);
      if (history.length) {
        setAuthHistory(history);
        if (historyId)
          localStorage.setItem(AUTO_LOGIN_HISTORY_STORAGE_KEY, historyId);
      }
    } catch (error) {
      setLoginError(
        isWorkOrderAuthExpiredError(error)
          ? "用户凭证已过期，请重新粘贴最新登录凭据。"
          : messageOf(error),
      );
    } finally {
      setLoggingIn(false);
    }
  };

  const loginWithHistory = async (id: string) => {
    setLoggingIn(true);
    setLoginError(null);
    try {
      const status = await restoreAuthHistory(id);
      setLoadingOrders(true);
      localStorage.setItem(AUTO_LOGIN_HISTORY_STORAGE_KEY, id);
      setLocalAccountKey(localAccountKeyFor(status, id));
      authExpiryHandlingRef.current = false;
      sessionEstablishedAtRef.current = Date.now();
      setAuth(status);
      void fetchAuthHistory()
        .then(setAuthHistory)
        .catch(() => undefined);
    } catch (error) {
      setLoginError(
        isWorkOrderAuthExpiredError(error)
          ? "用户凭证已过期，请重新粘贴最新登录凭据。"
          : messageOf(error),
      );
    } finally {
      setLoggingIn(false);
    }
  };

  const persistLocalWorkOrder = async (
    order: WorkOrder,
    patch: Partial<
      Pick<LocalWorkOrderMeta, "appointmentAt" | "favorite" | "note" | "pinned">
    >,
  ) => {
    const accountKey = localAccountKey;
    if (!accountKey)
      throw new Error("当前登录缺少本地账号标识，无法保存工单资料");
    if (localSaveLocks.current.has(order.woHeaderId))
      throw new Error("这张工单的本地资料正在保存，请稍候");

    localSaveLocks.current.add(order.woHeaderId);
    setLocalSavingOrderIds((current) =>
      current.includes(order.woHeaderId)
        ? current
        : [...current, order.woHeaderId],
    );
    setLocalDataMessage("");
    try {
      const existing = localMetaById[order.woHeaderId];
      const appointmentAt =
        patch.appointmentAt === ""
          ? null
          : patch.appointmentAt !== undefined
            ? patch.appointmentAt
            : (existing?.appointmentAt ?? null);
      const next: LocalWorkOrderMeta = {
        accountKey,
        appointmentAt,
        favorite: patch.favorite ?? existing?.favorite ?? false,
        key: makeLocalWorkOrderKey(accountKey, order.woHeaderId),
        note:
          patch.note !== undefined ? patch.note.trim() : (existing?.note ?? ""),
        pinned: patch.pinned ?? existing?.pinned ?? false,
        snapshot: toLocalSnapshot(order),
        sourceDate: existing?.sourceDate ?? selectedDate,
        updatedAt: new Date().toISOString(),
        woHeaderId: order.woHeaderId,
      };
      const hasLocalData =
        next.favorite ||
        next.pinned ||
        Boolean(next.note) ||
        Boolean(next.appointmentAt);
      if (!hasLocalData) {
        if (existing) await deleteLocalWorkOrderMeta(existing.key);
        setLocalWorkOrders((current) =>
          current.filter((item) => item.woHeaderId !== order.woHeaderId),
        );
        return;
      }
      const saved = await saveLocalWorkOrderMeta(next);
      setLocalWorkOrders((current) =>
        [
          ...current.filter((item) => item.woHeaderId !== saved.woHeaderId),
          saved,
        ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      );
    } catch (error) {
      setLocalDataMessage(`保存本地工单失败：${messageOf(error)}`);
      throw error;
    } finally {
      localSaveLocks.current.delete(order.woHeaderId);
      setLocalSavingOrderIds((current) =>
        current.filter((id) => id !== order.woHeaderId),
      );
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

  const openSignatureFromDetail = (order: WorkOrder) => {
    signatureReturnRef.current = { mainTab, order, screen };
    setSignatureOrder(order);
    setDrawer(null);
    setScreen("signature");
  };

  const returnFromSignature = useCallback(() => {
    const destination = signatureReturnRef.current;
    setSignatureOrder(null);
    signatureReturnRef.current = null;
    if (!destination) {
      setScreen("orders");
      setMainTab("home");
      return;
    }
    setScreen(destination.screen);
    setMainTab(destination.mainTab);
    setActiveOrderId(destination.order.id);
    setLocalDetailOrder(destination.order);
    setDrawer("detail");
  }, []);

  const updateSignedOrderState = useCallback((woHeaderId: string, saved: boolean) => {
    setSignedOrderHeaderIds((current) =>
      saved
        ? Array.from(new Set([...current, woHeaderId]))
        : current.filter((id) => id !== woHeaderId),
    );
  }, []);

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
      const saved = await saveUtf8JsonFile(
        `kidindin-local-work-orders-${today()}.json`,
        payload,
      );
      setLocalDataMessage(
        saved.method === "native"
          ? `已写入 ${localWorkOrders.length} 条本地工单资料到 ${saved.destination}：${saved.fileName}`
          : `已发起浏览器下载：${saved.fileName}（${localWorkOrders.length} 条本地工单资料）`,
      );
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
      setLocalDataMessage(
        `已从 ${fileName} 导入，本机现有 ${items.length} 条工单资料`,
      );
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
    if (
      !window.confirm(
        "确定清空当前账号的全部收藏、置顶、备注和预约吗？此操作不可撤销。",
      )
    )
      return;
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

  const setOrderStatus = (
    id: string,
    status: OrderStatus,
    backendStatusCode?: string,
  ) =>
    setOrders((current) =>
      current.map((order) =>
        order.id === id
          ? {
              ...order,
              backendStatusCode: backendStatusCode ?? order.backendStatusCode,
              status,
            }
          : order,
      ),
    );
  const hasUnreachableExchangeLog = async (order: WorkOrder) => {
    const logs = await fetchWorkOrderExchangeLogs(order.woHeaderId);
    return logs.some((log) => isUnreachableExchangeLog(log));
  };
  const isWorkOrderClosedOnServer = async (order: WorkOrder) => {
    const response = await fetchWorkOrderDetail(order.woHeaderId);
    const header = (response.data.tcisWoHeaderDto ?? {}) as Record<
      string,
      unknown
    >;
    return textField(header.statusCode) === "60";
  };
  const waitForUnreachableExchangeLog = async (order: WorkOrder) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await hasUnreachableExchangeLog(order)) return;
      if (attempt < 2) await wait(700);
    }
    throw new Error(
      "工单已关闭，但未查询到“到访不遇”流转日志，已加入待补发队列",
    );
  };
  const ensureUnreachableExchangeLog = async (order: WorkOrder) => {
    if (await hasUnreachableExchangeLog(order)) return false;
    await createWorkOrderExchangeLog({
      exchangeType: EXCHANGE_TYPE_UNREACHABLE,
      params: { closeReason: reason, remark },
      userName: operatorName.trim() || "段鑫",
      woHeaderId: order.woHeaderId,
      woNumber: order.woNumber,
    });
    await waitForUnreachableExchangeLog(order);
    return true;
  };
  const toggleOrder = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  const toggleAllPendingOrders = () =>
    setSelected((current) => {
      const visibleIds = pendingSubmitOrders.map((order) => order.id);
      const allVisibleSelected =
        visibleIds.length > 0 && visibleIds.every((id) => current.includes(id));
      return allVisibleSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : [...new Set([...current, ...visibleIds])];
    });

  const loadHistoricalPhotosForOrder = (
    order: WorkOrder,
    force = false,
  ): Promise<HistoryPhotoCacheEntry> => {
    const orderId = order.id;
    const cached = historyPhotoCache[orderId];
    if (!force && cached) return Promise.resolve(cached);
    const existingRequest = historyPhotoRequestsRef.current.get(orderId);
    if (existingRequest) return existingRequest;

    if (force) {
      setHistoryPhotoCache((current) => {
        const next = { ...current };
        delete next[orderId];
        return next;
      });
      setHistoryFiles((current) => {
        const next = { ...current };
        delete next[orderId];
        return next;
      });
      setSelectedHistoryPhotoIds((current) => {
        const next = { ...current };
        delete next[orderId];
        return next;
      });
    }
    setHistoryPhotoLoadingOrderIds((current) =>
      current.includes(orderId) ? current : [...current, orderId],
    );

    const request = (async (): Promise<HistoryPhotoCacheEntry> => {
      try {
      const current = order.raw ?? {};
      const currentUser = (current.userinfo ?? {}) as Record<string, unknown>;
      let userinfoId =
        textField(current.userinfoId) || textField(currentUser.userInfoId);
      if (!userinfoId) {
        const detailResponse = await fetchWorkOrderDetail(
          order.woHeaderId,
        );
        const header = (detailResponse.data.tcisWoHeaderDto ?? {}) as Record<
          string,
          unknown
        >;
        const userInfo = (header.userinfo ?? {}) as Record<string, unknown>;
        userinfoId =
          textField(header.userinfoId) || textField(userInfo.userInfoId);
      }
      if (!userinfoId)
        throw new Error("当前工单缺少 userinfoId，无法查询历史到访照片");

      const historyOrders = await fetchHistoricalWorkOrders(userinfoId);
      const candidates = historyOrders
        .filter(
          (item) =>
            textField(item.woHeaderId) !== order.woHeaderId &&
            textField(item.statusCode) === "60",
        )
        .sort(
          (left, right) => historyTimestamp(right) - historyTimestamp(left),
        );
      if (!candidates.length) throw new Error("未找到同一用户已结束的历史工单");

      for (const historyOrder of candidates) {
        const historyId = textField(historyOrder.woHeaderId);
        if (!historyId) continue;
        const logs = await fetchWorkOrderExchangeLogs(historyId);
        if (!logs.some((log) => isUnreachableExchangeLog(log)))
          continue;

        for (const bizId of photoBizIds(historyOrder)) {
          const attachments = (await fetchWorkOrderFiles(bizId)).filter(
            (file) => textField(file.downloadFilePath),
          );
          if (!attachments.length) continue;
          const downloaded = await Promise.allSettled(
            attachments
              .slice(0, 12)
              .map(async (attachment: UploadedFile, index) => {
                const file = await downloadWorkOrderFile(attachment);
                return {
                  file,
                  historyLabel: textField(historyOrder.woNumber) || historyId,
                  id: `${historyId}:${bizId}:${textField(attachment.attachId) || textField(attachment.downloadFilePath) || index}`,
                  originalName: textField(attachment.fileName) || file.name,
                  previewUrl: URL.createObjectURL(file),
                };
              }),
          );
          const photos = downloaded.flatMap((result) =>
            result.status === "fulfilled" ? [result.value] : [],
          );
          if (photos.length) {
            const entry = { error: null, photos };
            setHistoryPhotoCache((current) => ({
              ...current,
              [orderId]: entry,
            }));
            return entry;
          }
        }
      }
      throw new Error(
        "已检查历史已结束工单，但未找到含“到访不遇”日志的可下载照片",
      );
      } catch (error) {
        const entry = { error: messageOf(error), photos: [] };
        setHistoryPhotoCache((current) => ({
          ...current,
          [orderId]: entry,
        }));
        setHistoryFiles((current) => {
          const next = { ...current };
          delete next[orderId];
          return next;
        });
        setSelectedHistoryPhotoIds((current) => {
          const next = { ...current };
          delete next[orderId];
          return next;
        });
        return entry;
      } finally {
        historyPhotoRequestsRef.current.delete(orderId);
        setHistoryPhotoLoadingOrderIds((current) =>
          current.filter((id) => id !== orderId),
        );
      }
    })();
    historyPhotoRequestsRef.current.set(orderId, request);
    return request;
  };

  const findHistoricalPhotos = async (force = true) => {
    if (!activeOrder) return;
    setHistoryMode("auto");
    if (force) {
      setHistoryPhotoError(null);
      setHistoryPhotos([]);
    }
    await loadHistoricalPhotosForOrder(activeOrder, force);
  };

  const prefetchHistoricalPhotos = async (targetOrders: WorkOrder[]) => {
    const queue = targetOrders.filter(
      (order) => !historyPhotoCache[order.id]?.photos.length,
    );
    if (!queue.length) return;

    const results = new Map<string, HistoryPhotoCacheEntry>();
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < queue.length) {
        const order = queue[nextIndex];
        nextIndex += 1;
        const entry = await loadHistoricalPhotosForOrder(
          order,
          Boolean(historyPhotoCache[order.id]?.error),
        );
        results.set(order.id, entry);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(2, queue.length) }, () => worker()),
    );

    const failedIds = new Set(
      [...results].filter(([, entry]) => entry.error).map(([id]) => id),
    );
    if (!failedIds.size) return;
    setSelected((current) => current.filter((id) => !failedIds.has(id)));
    const remainingOrders = targetOrders.filter(
      (order) => !failedIds.has(order.id),
    );
    if (remainingOrders.length) {
      if (failedIds.has(targetOrders[0]?.id))
        setActiveOrderId(remainingOrders[0].id);
      setLoadError(
        `${failedIds.size} 个工单未找到可用的历史到访不遇照片，已自动取消勾选`,
      );
    } else {
      setLoadError("所选工单均未找到可用的历史到访不遇照片，已取消提交队列");
      setScreen("select");
    }
  };

  const openBatchPreparation = async () => {
    if (!selectedOrders.length || batchStorefrontLoading) return;
    setBatchStorefrontLoading(true);
    setActiveOrderId(selectedOrders[0].id);
    setHistoryMode(submitMode === "historical" ? "auto" : "manual");
    setBatchStorefrontMessage("");
    try {
      if (submitMode === "all-manual") {
        if (!localAccountKey) {
          setStorefrontPrefilledOrderIds([]);
          setBatchStorefrontMessage(
            "当前登录缺少本地账号标识，无法读取持久门头预填；请在本页手动选择门头照片",
          );
        } else {
          const storedByHeaderId = await getStorefrontPhotoPrefills(
            localAccountKey,
            selectedOrders.map((order) => order.woHeaderId),
          );
          const existingPrefilledIds = new Set(storefrontPrefilledOrderIds);
          const loadedFiles: Record<string, File> = {};
          const loadedPrefilledIds: string[] = [];
          for (const order of selectedOrders) {
            const stored = storedByHeaderId[order.woHeaderId];
            if (!stored) continue;
            loadedFiles[order.id] = storefrontPhotoPrefillToFile(stored);
            if (!historyFiles[order.id] || existingPrefilledIds.has(order.id)) {
              loadedPrefilledIds.push(order.id);
            }
          }
          setHistoryFiles((current) => ({ ...loadedFiles, ...current }));
          setWatermarkedUploads({});
          setStorefrontPrefilledOrderIds(loadedPrefilledIds);
          setBatchStorefrontMessage(
            loadedPrefilledIds.length
              ? `已从工单详情自动带入 ${loadedPrefilledIds.length} 张持久门头照片；这些照片在 App 重启后仍会保留`
              : "所选工单尚未保存门头预填，请返回工单详情预填或在本页手动选择",
          );
        }
      } else {
        setStorefrontPrefilledOrderIds([]);
      }
      setScreen("prepare");
      if (submitMode === "historical") {
        void prefetchHistoricalPhotos(selectedOrders);
      }
    } catch (error) {
      setStorefrontPrefilledOrderIds([]);
      setBatchStorefrontMessage(
        `读取持久门头预填失败：${messageOf(error)}；可在本页手动选择照片`,
      );
      setScreen("prepare");
    } finally {
      setBatchStorefrontLoading(false);
    }
  };

  const openBatchConfirmation = async () => {
    if (batchDuplicateChecking) return;
    if (submitMode !== "all-manual") {
      setLoadError("当前批量到访不遇仅开放手动上传模式");
      return;
    }
    if (
      !selectedOrders.length ||
      selectedOrders.some(
        (order) =>
          !historyFiles[order.id] || !detailCloseupFiles[order.id],
      )
    ) {
      setLoadError(
        "请为每个工单分别准备门头照片和到访不遇详细单近景照片",
      );
      return;
    }

    setBatchDuplicateChecking(true);
    try {
      const duplicate = await findFirstDuplicateImage(
        batchImageEntries(selectedOrders, historyFiles, detailCloseupFiles),
      );
      if (duplicate) {
        setLoadError(
          `检测到重复图片：“${duplicate.duplicate.label}”与“${duplicate.original.label}”内容完全相同，请更换其中一张；已预存照片不会被删除`,
        );
        return;
      }
      const nextWatermarkedUploads = { ...watermarkedUploads };
      for (const order of selectedOrders) {
        const storefrontFile = historyFiles[order.id];
        const detailFile = detailCloseupFiles[order.id];
        if (!storefrontFile || !detailFile) {
          throw new Error(`${order.woNumber || order.id} 缺少两张提交图片`);
        }
        const address = registeredWatermarkAddress(order);
        const existing = nextWatermarkedUploads[order.id];
        if (
          existing &&
          existing.address === address &&
          existing.sourceFiles[0] === storefrontFile &&
          existing.sourceFiles[1] === detailFile
        ) {
          continue;
        }
        setRunMessage(`正在生成 ${order.woNumber} 的带水印图片预览…`);
        const uploaded = await uploadWorkOrderFiles(
          [storefrontFile, detailFile],
          "",
          { securityWatermark: true, watermarkAddress: address },
        );
        let attachments = (uploaded.data.sysAttachList ?? []).filter((file) =>
          String(file.downloadFilePath ?? "").trim(),
        );
        if (attachments.length < 2) {
          attachments = (await fetchWorkOrderFiles(uploaded.data.bizId)).filter(
            (file) => String(file.downloadFilePath ?? "").trim(),
          );
        }
        if (attachments.length < 2) {
          throw new Error(
            `${order.woNumber || order.id} 上传后未返回两张可预览的带水印附件`,
          );
        }
        const previewFiles = await Promise.all(
          attachments.slice(0, 2).map((attachment) => downloadWorkOrderFile(attachment)),
        );
        nextWatermarkedUploads[order.id] = {
          address,
          bizId: uploaded.data.bizId,
          previewFiles,
          sourceFiles: [storefrontFile, detailFile],
        };
        setWatermarkedUploads({ ...nextWatermarkedUploads });
      }
      setScreen("confirm");
    } catch (error) {
      setLoadError(`带水印图片准备失败：${messageOf(error)}`);
    } finally {
      setBatchDuplicateChecking(false);
    }
  };

  useEffect(() => {
    if (
      screen !== "prepare" ||
      historyMode !== "auto" ||
      !activeOrder ||
      historyPhotoLoadingOrderIds.includes(activeOrder.id) ||
      historyPhotoCache[activeOrder.id]
    )
      return;
    void findHistoricalPhotos(false);
  }, [
    activeOrder,
    historyMode,
    historyPhotoCache,
    historyPhotoLoadingOrderIds,
    screen,
  ]);

  const runBatch = async () => {
    if (
      submitMode !== "all-manual" ||
      !selectedOrders.length ||
      selectedOrders.some(
        (order) =>
          !historyFiles[order.id] ||
          (submitMode === "all-manual"
            ? !detailCloseupFiles[order.id]
            : !libraryFile),
      )
    )
      return;
    if (
      selectedOrders.some((order) => {
        const uploaded = watermarkedUploads[order.id];
        return (
          !uploaded ||
          uploaded.address !== order.address.trim() ||
          uploaded.sourceFiles[0] !== historyFiles[order.id] ||
          uploaded.sourceFiles[1] !== detailCloseupFiles[order.id]
        );
      })
    ) {
      setLoadError("请返回确认页重新生成每个工单的带水印图片预览");
      setScreen("prepare");
      return;
    }
    setBatchOrderIds(selectedOrders.map((order) => order.id));
    setRunning(true);
    setPaused(false);
    setCurrentIndex(0);
    setScreen("running");
    let submittedCount = 0;
    for (let index = 0; index < selectedOrders.length; index += 1) {
      const order = selectedOrders[index];
      const watermarkedUpload = watermarkedUploads[order.id];
      setCurrentIndex(index + 1);

      if (!watermarkedUpload) {
        setOrderStatus(order.id, "关闭失败");
        setRunMessage(`${order.woNumber} 缺少已确认的带水印附件，已停止该单`);
        continue;
      }

      let closedBeforeSubmit: boolean;
      let hasLogBeforeSubmit: boolean;
      try {
        setRunMessage(`正在提交前核验 ${order.woNumber} 的状态与流转日志…`);
        [closedBeforeSubmit, hasLogBeforeSubmit] = await Promise.all([
          isWorkOrderClosedOnServer(order),
          hasUnreachableExchangeLog(order),
        ]);
      } catch (error) {
        setOrderStatus(order.id, "关闭失败");
        setRunMessage(
          `${order.woNumber} 提交前核验失败，已停止该单：${messageOf(error)}`,
        );
        continue;
      }

      if (closedBeforeSubmit && hasLogBeforeSubmit) {
        setOrderStatus(order.id, "已结束", "60");
        resolvePendingLogRetry(order);
        setSelected((current) => current.filter((id) => id !== order.id));
        setRunMessage(`${order.woNumber} 已关闭且已有到访不遇日志，已跳过重复提交`);
        continue;
      }

      if (!closedBeforeSubmit && hasLogBeforeSubmit) {
        setOrderStatus(order.id, "关闭失败");
        setRunMessage(
          `${order.woNumber} 尚未关闭但已有到访不遇日志，状态矛盾，已停止该单`,
        );
        continue;
      }

      if (closedBeforeSubmit) {
        queuePendingLogRetry(order);
        setOrderStatus(order.id, "日志失败", "60");
        try {
          setRunMessage(`${order.woNumber} 已关闭，正在补写缺失的到访不遇日志…`);
          await ensureUnreachableExchangeLog(order);
          setOrderStatus(order.id, "已结束", "60");
          resolvePendingLogRetry(order);
          setSelected((current) => current.filter((id) => id !== order.id));
          setRunMessage(`${order.woNumber} 缺失日志已补写并核验`);
        } catch (error) {
          setRunMessage(
            `${order.woNumber} 已关闭，流转日志补写失败：${messageOf(error)}`,
          );
        }
        continue;
      }

      if (submittedCount > 0 && submitIntervalMaxSeconds > 0) {
        const minSeconds = Math.min(
          submitIntervalMinSeconds,
          submitIntervalMaxSeconds,
        );
        const maxSeconds = Math.max(
          submitIntervalMinSeconds,
          submitIntervalMaxSeconds,
        );
        const delaySeconds =
          minSeconds +
          Math.floor(Math.random() * (maxSeconds - minSeconds + 1));
        setRunMessage(`随机等待 ${delaySeconds} 秒后提交下一单…`);
        await wait(delaySeconds * 1000);
      }
      submittedCount += 1;
      try {
        setRunMessage(`正在使用 ${order.woNumber} 已确认的带水印照片…`);
        const bizId = watermarkedUpload.bizId;
        setRunMessage(`正在关闭安检工单 ${order.woNumber}…`);
        queuePendingLogRetry(order);
        await closeSecurityCheckWorkOrder({
          "closeAttachBizId-11": bizId,
          "closeAttachBizId-ZC": "",
          closeAttachBizId: bizId,
          closeReason: CLOSE_REASON_UNREACHABLE,
          remark,
          woHeaderId: order.woHeaderId,
        });
      } catch (error) {
        setRunMessage(`${order.woNumber} 关闭响应异常，正在核验服务端状态…`);
        try {
          if (!(await isWorkOrderClosedOnServer(order))) {
            resolvePendingLogRetry(order);
            setOrderStatus(order.id, "关闭失败");
            setRunMessage(`${order.woNumber} 关闭失败：${messageOf(error)}`);
            continue;
          }
          setOrderStatus(order.id, "日志失败", "60");
          setRunMessage(`${order.woNumber} 已在服务端关闭，继续创建流转日志…`);
        } catch (verifyError) {
          setOrderStatus(order.id, "关闭失败");
          setRunMessage(
            `${order.woNumber} 关闭结果无法核验：${messageOf(verifyError)}`,
          );
          continue;
        }
      }
      try {
        setRunMessage(`正在检查并写入 ${order.woNumber} 的流转日志…`);
        const created = await ensureUnreachableExchangeLog(order);
        setOrderStatus(order.id, "已结束", "60");
        resolvePendingLogRetry(order);
        setSelected((current) => current.filter((id) => id !== order.id));
        setRunMessage(
          created
            ? `${order.woNumber} 到访不遇日志已写入并核验`
            : `${order.woNumber} 已存在到访不遇日志，未重复写入`,
        );
      } catch (error) {
        setOrderStatus(order.id, "日志失败");
        setRunMessage(
          `${order.woNumber} 已关闭，流转日志失败：${messageOf(error)}`,
        );
      }
    }
    setRunning(false);
    setRunMessage("本次批量任务已结束");
    setScreen("records");
    setMainTab("more");
  };

  const retryLog = async (id: string) => {
    const order = orders.find((item) => item.id === id);
    if (!order) return { ok: false, message: "未找到该工单" };
    if (
      order.backendStatusCode !== "60" &&
      order.status !== "日志失败" &&
      order.status !== "已结束"
    ) {
      return { ok: false, message: "该工单尚未关闭，不能补发流转日志" };
    }
    try {
      if (await hasUnreachableExchangeLog(order)) {
        setOrderStatus(id, "已结束", "60");
        resolvePendingLogRetry(order);
        return {
          ok: false,
          message: "已查询到“到访不遇”流转日志，无需重复补发",
        };
      }
      await createWorkOrderExchangeLog({
        exchangeType: EXCHANGE_TYPE_UNREACHABLE,
        params: { closeReason: reason, remark },
        userName: operatorName.trim() || "段鑫",
        woHeaderId: order.woHeaderId,
        woNumber: order.woNumber,
      });
      await waitForUnreachableExchangeLog(order);
      setOrderStatus(id, "已结束", "60");
      resolvePendingLogRetry(order);
      return { ok: true, message: "流转日志已补发并完成核验" };
    } catch (error) {
      const message = `补发日志失败：${messageOf(error)}`;
      setOrderStatus(id, "日志失败", "60");
      setLoadError(message);
      return { ok: false, message };
    }
  };

  const checkLogBeforeRetry = async (id: string) => {
    const order = orders.find((item) => item.id === id);
    if (!order) return { ok: false, message: "未找到该工单" };
    if (
      order.backendStatusCode !== "60" &&
      order.status !== "日志失败" &&
      order.status !== "已结束"
    ) {
      return { ok: false, message: "该工单尚未关闭，不能创建流转日志" };
    }
    try {
      if (await hasUnreachableExchangeLog(order)) {
        setOrderStatus(id, "已结束", "60");
        return { ok: false, message: "已存在“到访不遇”流转日志，无需创建" };
      }
      return {
        ok: true,
        message: "未查询到“到访不遇”流转日志，确认后将创建一条新日志",
      };
    } catch (error) {
      return { ok: false, message: `查询流转日志失败：${messageOf(error)}` };
    }
  };

  const runLogAudit = async () => {
    setLogAuditResults({});
    setLogAuditRunning(true);
    setLogAuditMessage("正在加载该日期工单…");
    try {
      const response = await fetchWorkOrders(`${selectedDate} 00:00:00`);
      const auditOrders = response.data.map(toUiOrder);
      const endedOrders = auditOrders.filter(
        (order) => order.backendStatusCode === "60",
      );
      setOrders(auditOrders);
      if (!endedOrders.length) {
        setLogAuditMessage("该日期没有已结束的工单可审核");
        return;
      }
      setLogAuditMessage(`正在审核 0/${endedOrders.length} 单…`);
      for (let index = 0; index < endedOrders.length; index += 1) {
        const order = endedOrders[index];
        setLogAuditResults((current) => ({
          ...current,
          [order.id]: { state: "checking" },
        }));
        try {
          const exists = await hasUnreachableExchangeLog(order);
          setLogAuditResults((current) => ({
            ...current,
            [order.id]: { state: exists ? "present" : "missing" },
          }));
        } catch (error) {
          setLogAuditResults((current) => ({
            ...current,
            [order.id]: { state: "error", message: messageOf(error) },
          }));
        }
        setLogAuditMessage(`正在审核 ${index + 1}/${endedOrders.length} 单…`);
      }
      setLogAuditMessage(`审核完成：共核验 ${endedOrders.length} 单已结束工单`);
    } catch (error) {
      setLogAuditMessage(`加载工单失败：${messageOf(error)}`);
    } finally {
      setLogAuditRunning(false);
    }
  };

  const retryMissingAuditLogs = async (
    minSeconds: number,
    maxSeconds: number,
  ) => {
    const retryOrders = orders.filter(
      (order) => logAuditResults[order.id]?.state === "missing",
    );
    if (!retryOrders.length) {
      setLogAuditMessage("没有可补发的缺失日志，请先完成审核");
      return;
    }
    const minDelay = Math.max(0, Math.min(minSeconds, maxSeconds));
    const maxDelay = Math.max(minDelay, Math.max(minSeconds, maxSeconds));
    setLogAuditRetryRunning(true);
    try {
      for (let index = 0; index < retryOrders.length; index += 1) {
        const order = retryOrders[index];
        if (index > 0 && maxDelay > 0) {
          const delaySeconds =
            minDelay + Math.floor(Math.random() * (maxDelay - minDelay + 1));
          setLogAuditMessage(
            `等待 ${delaySeconds} 秒后补发下一单（${index + 1}/${retryOrders.length}）…`,
          );
          await wait(delaySeconds * 1000);
        }
        setLogAuditMessage(
          `正在补发 ${index + 1}/${retryOrders.length}：${order.woNumber}`,
        );
        setLogAuditResults((current) => ({
          ...current,
          [order.id]: { state: "checking", message: "正在创建流转日志…" },
        }));
        try {
          if (await hasUnreachableExchangeLog(order)) {
            setLogAuditResults((current) => ({
              ...current,
              [order.id]: {
                state: "present",
                message: "补发前复核到现有日志，未重复创建",
              },
            }));
            setOrderStatus(order.id, "已结束", "60");
            resolvePendingLogRetry(order);
            continue;
          }
          await createWorkOrderExchangeLog({
            exchangeType: EXCHANGE_TYPE_UNREACHABLE,
            params: { closeReason: reason, remark },
            userName: operatorName,
            woHeaderId: order.woHeaderId,
            woNumber: order.woNumber,
          });
          await waitForUnreachableExchangeLog(order);
          setLogAuditResults((current) => ({
            ...current,
            [order.id]: { state: "present", message: "已补发并完成核验" },
          }));
          setOrderStatus(order.id, "已结束", "60");
          resolvePendingLogRetry(order);
        } catch (error) {
          setLogAuditResults((current) => ({
            ...current,
            [order.id]: {
              state: "error",
              message: `补发失败：${messageOf(error)}`,
            },
          }));
        }
      }
      setLogAuditMessage(`批量补发完成：共处理 ${retryOrders.length} 单`);
    } finally {
      setLogAuditRetryRunning(false);
    }
  };

  const pullRefreshEnabled =
    !drawer &&
    !filterOpen &&
    ((screen === "orders" && (mainTab === "home" || mainTab === "stats")) ||
      screen === "log-audit");
  const refreshCurrentPage = async () => {
    if (
      pullRefreshing ||
      loadingOrders ||
      logAuditRunning ||
      logAuditRetryRunning
    )
      return;
    setPullRefreshing(true);
    try {
      if (screen === "log-audit") await runLogAudit();
      else await loadOrders();
    } finally {
      setPullRefreshing(false);
      pullRefreshDistanceRef.current = 0;
      setPullRefreshDistance(0);
    }
  };
  const resetPullRefreshGesture = () => {
    pullRefreshGesture.current = null;
    pullRefreshDistanceRef.current = 0;
    setPullRefreshDistance(0);
  };
  const handlePullRefreshStart = (event: React.TouchEvent<HTMLElement>) => {
    if (
      !pullRefreshEnabled ||
      pullRefreshing ||
      event.touches.length !== 1 ||
      event.currentTarget.scrollTop > 0
    )
      return;
    const target = event.target as HTMLElement;
    if (
      target.closest(
        ".drawer-overlay, .filter-overlay, .date-dialog-backdrop, .appointment-picker-backdrop, .order-note-backdrop, .order-pin-popover-backdrop, .audit-retry-confirm-backdrop, [role='dialog'], [role='menu']",
      )
    )
      return;
    const nestedScroller = target.closest<HTMLElement>(
      ".order-list, .stats-record-list, .audit-record-list",
    );
    if (!nestedScroller || nestedScroller.scrollTop > 0) return;
    const touch = event.touches[0];
    pullRefreshGesture.current = {
      axis: "pending",
      distance: 0,
      scroller: nestedScroller,
      startX: touch.clientX,
      startY: touch.clientY,
    };
    pullRefreshDistanceRef.current = 0;
  };
  const handlePullRefreshMove = (event: React.TouchEvent<HTMLElement>) => {
    const gesture = pullRefreshGesture.current;
    if (!gesture || pullRefreshing) return;
    if (event.touches.length !== 1) {
      resetPullRefreshGesture();
      return;
    }
    if (gesture.scroller.scrollTop > 0 || event.currentTarget.scrollTop > 0) {
      resetPullRefreshGesture();
      return;
    }
    const touch = event.touches[0];
    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;
    const absoluteX = Math.abs(deltaX);
    const absoluteY = Math.abs(deltaY);

    if (gesture.axis === "pending") {
      if (Math.max(absoluteX, absoluteY) < 10) return;
      if (absoluteX >= absoluteY * 0.9) {
        gesture.axis = "horizontal";
        resetPullRefreshGesture();
        return;
      }
      if (deltaY <= 0 || absoluteY < absoluteX * 1.2) return;
      gesture.axis = "vertical";
    }
    if (gesture.axis !== "vertical" || deltaY <= 0) return;
    if (event.cancelable) event.preventDefault();
    const distance = Math.min(92, Math.max(0, deltaY - 10) * 0.45);
    gesture.distance = distance;
    pullRefreshDistanceRef.current = distance;
    setPullRefreshDistance(distance);
  };
  const handlePullRefreshEnd = (event: React.TouchEvent<HTMLElement>) => {
    const shouldRefresh =
      event.touches.length === 0 &&
      pullRefreshGesture.current?.axis === "vertical" &&
      pullRefreshDistanceRef.current >= 60;
    pullRefreshGesture.current = null;
    pullRefreshDistanceRef.current = 0;
    if (shouldRefresh) void refreshCurrentPage();
    else setPullRefreshDistance(0);
  };
  const handlePullRefreshCancel = () => resetPullRefreshGesture();

  useEffect(() => {
    pullRefreshGesture.current = null;
    pullRefreshDistanceRef.current = 0;
    setPullRefreshDistance(0);
  }, [drawer, filterOpen, mainTab, screen]);

  const applyUpdatedAuthStatus = (status: AuthStatus) => {
    const savedHistoryId = localStorage.getItem(AUTO_LOGIN_HISTORY_STORAGE_KEY);
    const currentHistoryId = localAccountKey?.startsWith("history:")
      ? localAccountKey.slice("history:".length)
      : null;
    const nextAccountKey = localAccountKeyFor(
      status,
      currentHistoryId ??
        (savedHistoryId === AUTO_LOGIN_DISABLED ? null : savedHistoryId),
    );
    if (
      localAccountKey &&
      nextAccountKey &&
      localAccountKey !== nextAccountKey
    ) {
      setLocalWorkOrders([]);
      setLocalDataMessage("登录账号标识已更新，已切换到对应账号的本地工单数据");
    } else if (!nextAccountKey) {
      setLocalDataMessage("当前登录缺少可识别的账号信息，本地工单功能已停用");
    }
    setLocalAccountKey(nextAccountKey);
    authExpiryHandlingRef.current = false;
    sessionEstablishedAtRef.current = status.authenticated ? Date.now() : 0;
    setAuth(status);
  };

  const refreshSession = async () => {
    if (sessionRefreshPromise.current) return sessionRefreshPromise.current;
    const savedHistoryId = localStorage.getItem(AUTO_LOGIN_HISTORY_STORAGE_KEY);
    const currentRefreshAccountKey =
      localAccountKey ??
      (auth
        ? localAccountKeyFor(
            auth,
            savedHistoryId === AUTO_LOGIN_DISABLED ? null : savedHistoryId,
          )
        : null);
    const request = refreshAuthSession().then((status) => {
      const refreshedAt = String(Date.now());
      const nextRefreshAccountKey =
        localAccountKeyFor(
          status,
          savedHistoryId === AUTO_LOGIN_DISABLED ? null : savedHistoryId,
        ) ?? currentRefreshAccountKey;
      if (currentRefreshAccountKey)
        localStorage.setItem(
          autoRefreshStorageKey(currentRefreshAccountKey),
          refreshedAt,
        );
      if (
        nextRefreshAccountKey &&
        nextRefreshAccountKey !== currentRefreshAccountKey
      )
        localStorage.setItem(
          autoRefreshStorageKey(nextRefreshAccountKey),
          refreshedAt,
        );
      applyUpdatedAuthStatus(status);
      return status;
    });
    sessionRefreshPromise.current = request;
    try {
      return await request;
    } finally {
      if (sessionRefreshPromise.current === request)
        sessionRefreshPromise.current = null;
    }
  };

  const saveRefreshToken = async (refreshToken: string) => {
    const status = await setAuthRefreshToken(refreshToken);
    applyUpdatedAuthStatus(status);
    return status;
  };

  const exportSession = (input: {
    verification: "biometric" | "password";
    password?: string;
  }) => exportAuthSession(input);

  const logout = async () => {
    ordersRequestSequenceRef.current += 1;
    authExpiryHandlingRef.current = false;
    sessionEstablishedAtRef.current = 0;
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

  useEffect(() => {
    if (!loadError) return;
    const timeout = window.setTimeout(() => setLoadError(null), 7_000);
    return () => window.clearTimeout(timeout);
  }, [loadError]);

  useEffect(() => {
    if (!startupRefreshNotice) return;
    const timeout = window.setTimeout(
      () => setStartupRefreshNotice(null),
      5_000,
    );
    return () => window.clearTimeout(timeout);
  }, [startupRefreshNotice]);

  const handleAndroidBack = useCallback(() => {
    const pageBackEvent = new Event("kidindin:back", { cancelable: true });
    window.dispatchEvent(pageBackEvent);
    if (pageBackEvent.defaultPrevented) return;

    if (drawer) {
      setDrawer(null);
      setLocalDetailOrder(null);
      return;
    }
    if (filterOpen) {
      setOpenFilterPicker(null);
      setFilterOpen(false);
      return;
    }
    if (displaySessionExpiryNotice) {
      setDismissedSessionExpiryKey(sessionExpiryKey);
      return;
    }
    if (loadError) {
      setLoadError(null);
      return;
    }

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
      case "log-audit":
      case "vacant-room":
      case "vacant-room-fill":
      case "resident-security-prefill":
      case "visit-verify":
      case "image-encoding":
      case "signature-management":
      case "all-work-orders":
        setScreen("orders");
        setMainTab("more");
        return;
      case "signature":
        returnFromSignature();
        return;
      case "settings":
        setScreen("orders");
        setMainTab(settingsReturnTabRef.current);
        return;
      case "backup-restore":
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
  }, [
    displaySessionExpiryNotice,
    drawer,
    filterOpen,
    loadError,
    mainTab,
    running,
    screen,
    sessionExpiryKey,
    returnFromSignature,
  ]);

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
    return () => {
      cancelled = true;
      void listener?.unregister();
    };
  }, [handleAndroidBack]);

  if (startupSplashVisible)
    return (
      <StartupSplash
        accent={appliedAccent}
        ready={startupSplashReady}
        status={startupSplashStatus}
        onComplete={finishStartupSplash}
      />
    );
  if (auth === null)
    return (
      <div
        className={`app-shell theme-${appliedTheme} accent-${appliedAccent}`}
      >
        <main className="phone-frame">
          <div className="loading-mask" aria-live="polite">
            正在恢复登录…
          </div>
        </main>
      </div>
    );
  if (!loggedIn)
    return (
      <div
        className={`app-shell theme-${appliedTheme} accent-${appliedAccent}`}
      >
        <main className="phone-frame">
          <LoginPage
            onLogin={login}
            history={authHistory}
            error={loginError}
            submitting={loggingIn}
            onRestoreHistory={loginWithHistory}
          />
        </main>
      </div>
    );

  return (
    <div
      className={`app-shell theme-${appliedTheme} accent-${appliedAccent}`}
    >
      <main
        className={`phone-frame screen-${screen} density-${appSettings.display.density} motion-${appSettings.display.motion}`}
        aria-busy={loadingOrders}
        inert={loadingOrders}
        onTouchStart={handlePullRefreshStart}
        onTouchMove={handlePullRefreshMove}
        onTouchEnd={handlePullRefreshEnd}
        onTouchCancel={handlePullRefreshCancel}
      >
        {pullRefreshEnabled && (
          <div
            className={`pull-refresh-indicator ${pullRefreshing ? "refreshing" : ""} ${pullRefreshDistance > 0 && !pullRefreshing ? "pulling" : ""} ${pullRefreshDistance >= 60 ? "ready" : ""}`}
            style={{
              transform: `translate(-50%, ${pullRefreshing ? 44 : pullRefreshDistance - 48}px)`,
            }}
          >
            <Icon name="refresh" size={15} />
            <span>
              {pullRefreshing
                ? "正在刷新"
                : pullRefreshDistance >= 60
                  ? "松开刷新"
                  : "下拉刷新"}
            </span>
          </div>
        )}
        {displaySessionExpiryNotice && auth!.refreshAvailable ? (
          <SessionExpiryNotice
            expiresAt={sessionExpiryAt}
            refreshAvailable
            onRefresh={refreshSession}
            onClose={() => setDismissedSessionExpiryKey(sessionExpiryKey)}
          />
        ) : null}
        {displaySessionExpiryNotice &&
        !auth!.refreshAvailable &&
        activeOrder ? (
          <SessionExpiryNotice
            expiresAt={sessionExpiryAt}
            refreshAvailable={false}
            canOpenSettings
            onOpenSettings={() => {
              setDismissedSessionExpiryKey(sessionExpiryKey);
              setDrawer("settings");
            }}
            onClose={() => setDismissedSessionExpiryKey(sessionExpiryKey)}
          />
        ) : null}
        {displaySessionExpiryNotice &&
        !auth!.refreshAvailable &&
        !activeOrder ? (
          <SessionExpiryNotice
            expiresAt={sessionExpiryAt}
            refreshAvailable={false}
            canOpenSettings={false}
            onRelogin={logout}
            onClose={() => setDismissedSessionExpiryKey(sessionExpiryKey)}
          />
        ) : null}
        {loadError ? (
          <div className="network-error" role="alert">
            <span>{loadError}</span>
            <div className="network-error-actions">
              <button onClick={() => void loadOrders()}>重试</button>
              <button
                className="network-error-close"
                onClick={() => setLoadError(null)}
                aria-label="关闭提示"
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          </div>
        ) : null}
        <Suspense
          fallback={
            <div className="route-loading" role="status" aria-live="polite">
              正在打开页面…
            </div>
          }
        >
          {screen === "orders" && mainTab === "home" && (
            <HomePage
            orders={filteredOrders}
            overviewOrders={orders}
            query={query}
            date={selectedDate}
            localMetaById={localMetaById}
            storefrontPrefilledOrderHeaderIds={
              storefrontPrefilledOrderHeaderIds
            }
            residentSecurityPrefilledOrderHeaderIds={
              residentSecurityPrefilledOrderHeaderIds
            }
            signedOrderHeaderIds={signedOrderHeaderIds}
            collapsedFloorGroupKeys={collapsedHomeFloorGroupKeys}
            activeFilterCount={activeFilterCount}
            prioritizePinned={sortField === "original"}
            loading={loadingOrders}
            onQueryChange={setQuery}
            onDateChange={changeSelectedDate}
            onOpenSettings={() => setDrawer("settings")}
            onFilter={() => setFilterOpen(true)}
            onResetFilters={() => {
              setStatusFilter("all");
              setBuildingFilter("all");
              setUnitFilter("all");
              setFloorFilter("all");
            }}
            onDetail={openCurrentOrderDetail}
            onCollapsedFloorGroupKeysChange={
              updateCollapsedHomeFloorGroupKeys
            }
            onToggleFavorite={(order) =>
              persistLocalWorkOrder(order, {
                favorite: !localMetaById[order.woHeaderId]?.favorite,
              })
            }
            onTogglePinned={(order) =>
              persistLocalWorkOrder(order, {
                pinned: !localMetaById[order.woHeaderId]?.pinned,
              })
            }
            onSaveNote={(order, note) =>
              persistLocalWorkOrder(order, { note })
            }
            />
          )}
          {screen === "orders" && mainTab === "stats" && (
            <StatsPage
            orders={orders}
            date={selectedDate}
            onDateChange={changeSelectedDate}
            onRetry={(id) => void retryLog(id)}
            />
          )}
          {screen === "orders" && mainTab === "more" && (
            <MorePage
            items={localWorkOrders}
            busy={
              localDataBusy ||
              !localAccountKey ||
              localSavingOrderIds.length > 0
            }
            message={localDataMessage}
            onOpenAllWorkOrders={() => setScreen("all-work-orders")}
            onOpenBatchSubmit={() => {
              setLocalDetailOrder(null);
              setSubmitMode("all-manual");
              setHistoryMode("manual");
              setSelected([]);
              setHistoryFiles({});
              setDetailCloseupFiles({});
              setWatermarkedUploads({});
              setStorefrontPrefilledOrderIds([]);
              setBatchStorefrontMessage("");
              setBatchDuplicateChecking(false);
              batchAutoSelectKeyRef.current = "";
              setLibraryFile(null);
              setSelectedHistoryPhotoIds({});
              setScreen("mode");
            }}
            onOpenResidentSecurityPrefill={() => setScreen("resident-security-prefill")}
            onOpenDailyBatchPrefill={() => setScreen("daily-batch-prefill")}
            onOpenVacantRoom={() => setScreen("vacant-room")}
            onOpenVacantRoomFill={() => setScreen("vacant-room-fill")}
            onOpenLogAudit={() => {
              setLogAuditResults({});
              setLogAuditMessage("");
              setScreen("log-audit");
            }}
            onOpenSaved={() => setScreen("local-orders")}
            onOpenAppointments={() => setScreen("appointments")}
            onOpenBackupRestore={() => setScreen("backup-restore")}
            onOpenSettings={() => {
              settingsReturnTabRef.current = "more";
              setScreen("settings");
            }}
            onOpenVisitVerify={() => setScreen("visit-verify")}
            onOpenImageEncoding={() => setScreen("image-encoding")}
            onOpenSignatureManagement={() => setScreen("signature-management")}
            showToolDescriptions={appSettings.display.showToolDescriptions}
            onExportLocalData={exportLocalData}
            onImportLocalData={importLocalData}
            onClearLocalData={clearLocalData}
            />
          )}
          {screen === "vacant-room" && (
            <VacantRoomPage
            autoSelectImages={appSettings.vacantRoom.autoSelectImages}
            autoSelectOrders={appSettings.vacantRoom.autoSelectOrders}
            orders={orders}
            date={selectedDate}
            onDateChange={changeSelectedDate}
            onBack={() => {
              setScreen("orders");
              setMainTab("more");
            }}
            />
          )}
          {screen === "all-work-orders" && (
            <AllWorkOrdersPage
              accountKey={localAccountKey ?? ""}
              onBack={() => {
              setScreen("orders");
              setMainTab("more");
            }}
            onOpenDetail={(source) => openCurrentOrderDetail(toUiOrder(source))}
            />
          )}
          {screen === "vacant-room-fill" && (
            <VacantRoomFillPage
            autoSelectOrders={appSettings.vacantRoom.fillAutoSelectOrders}
            defaultIntervalSeconds={appSettings.vacantRoom.fillIntervalSeconds}
            orders={orders}
            date={selectedDate}
            onDateChange={changeSelectedDate}
            onBack={() => {
              setScreen("orders");
              setMainTab("more");
            }}
            />
          )}
          {screen === "resident-security-prefill" && (
            <ResidentSecurityPrefillPage
              orders={orders}
              date={selectedDate}
              onDateChange={changeSelectedDate}
              onBack={() => {
                setScreen("orders");
                setMainTab("more");
              }}
            />
          )}
          {screen === "daily-batch-prefill" && localAccountKey && (
            <DailyBatchPrefillPage
              accountKey={localAccountKey}
              orders={orders}
              date={selectedDate}
              onDateChange={changeSelectedDate}
              onPrefilledIdsChange={(woHeaderIds) => {
                setResidentSecurityPrefilledOrderHeaderIds((current) =>
                  Array.from(new Set([...current, ...woHeaderIds])),
                );
              }}
              onBack={() => {
                setScreen("orders");
                setMainTab("more");
              }}
            />
          )}
          {screen === "visit-verify" && (
            <VisitVerifyPage
            onBack={() => {
              setScreen("orders");
              setMainTab("more");
            }}
            />
          )}
          {screen === "image-encoding" && (
            <ImageEncodingPage
            onBack={() => {
              setScreen("orders");
              setMainTab("more");
            }}
            />
          )}
          {screen === "signature-management" && (
            <SignatureManagementPage
            accountKey={localAccountKey}
            onSignatureChange={updateSignedOrderState}
            onBack={() => {
              setScreen("orders");
              setMainTab("more");
            }}
            />
          )}
          {screen === "signature" && signatureOrder && (
            <SignaturePage
            accountKey={localAccountKey}
            order={signatureOrder}
            onSignatureChange={updateSignedOrderState}
            onBack={returnFromSignature}
            />
          )}
          {screen === "settings" && (
            <SettingsPage
            accountLabel={auth!.username ?? auth!.employeeNumber ?? "当前账号"}
            appearanceSettings={appearanceSettings}
            appSettings={appSettings}
            defaultOperatorName={customOperatorName}
            localDataBusy={localDataBusy}
            localDataMessage={localDataMessage}
            localWorkOrderCount={localWorkOrders.length}
            setAppearanceSettings={setAppearanceSettings}
            setAppSettings={setAppSettings}
            setDefaultOperatorName={setCustomOperatorName}
            onBack={() => {
              setScreen("orders");
              setMainTab(settingsReturnTabRef.current);
            }}
            onOpenQuickConfig={() => setDrawer("settings")}
            onOpenBackupRestore={() => setScreen("backup-restore")}
            onExportLocalData={exportLocalData}
            onImportLocalData={importLocalData}
            onClearLocalData={clearLocalData}
            />
          )}
          {screen === "backup-restore" && (
            <BackupRestorePage
              accountKey={localAccountKey}
              accountLabel={auth!.username ?? auth!.employeeNumber ?? "当前账号"}
              onBack={() => {
                setScreen("orders");
                setMainTab("more");
              }}
            />
          )}
          {screen === "local-orders" && (
            <LocalWorkOrdersPage
            mode="saved"
            items={localWorkOrders}
            savingIds={localSavingOrderIds}
            message={localDataMessage}
            onBack={() => {
              setScreen("orders");
              setMainTab("more");
            }}
            onOpenDetail={openLocalOrderDetail}
            onToggleFavorite={(item) =>
              persistLocalWorkOrder(fromLocalMeta(item), {
                favorite: !item.favorite,
              })
            }
            onTogglePinned={(item) =>
              persistLocalWorkOrder(fromLocalMeta(item), {
                pinned: !item.pinned,
              })
            }
            onClearAppointment={(item) =>
              persistLocalWorkOrder(fromLocalMeta(item), {
                appointmentAt: null,
              })
            }
            />
          )}
          {screen === "appointments" && (
            <LocalWorkOrdersPage
            mode="appointments"
            items={localWorkOrders}
            savingIds={localSavingOrderIds}
            message={localDataMessage}
            onBack={() => {
              setScreen("orders");
              setMainTab("more");
            }}
            onOpenDetail={openLocalOrderDetail}
            onToggleFavorite={(item) =>
              persistLocalWorkOrder(fromLocalMeta(item), {
                favorite: !item.favorite,
              })
            }
            onTogglePinned={(item) =>
              persistLocalWorkOrder(fromLocalMeta(item), {
                pinned: !item.pinned,
              })
            }
            onClearAppointment={(item) =>
              persistLocalWorkOrder(fromLocalMeta(item), {
                appointmentAt: null,
              })
            }
            />
          )}
          {screen === "log-audit" && (
            <LogAuditPage
            orders={orders}
            date={selectedDate}
            results={logAuditResults}
            auditing={logAuditRunning}
            retrying={logAuditRetryRunning}
            message={logAuditMessage}
            onDateChange={(value) => {
              if (logAuditRetryRunning) return;
              changeSelectedDate(value);
              setLogAuditResults({});
              setLogAuditMessage("");
            }}
            onBack={() => {
              setScreen("orders");
              setMainTab("more");
            }}
            onStartAudit={() => void runLogAudit()}
            onBatchRetry={(minSeconds, maxSeconds) =>
              void retryMissingAuditLogs(minSeconds, maxSeconds)
            }
            />
          )}
          {screen === "mode" && (
            <ModePage
            mode={submitMode}
            intervalMinSeconds={submitIntervalMinSeconds}
            intervalMaxSeconds={submitIntervalMaxSeconds}
            onModeChange={(mode) => {
              setSubmitMode(mode);
              setHistoryMode(mode === "historical" ? "auto" : "manual");
              if (mode !== submitMode) {
                setHistoryFiles({});
                setDetailCloseupFiles({});
                setWatermarkedUploads({});
                setStorefrontPrefilledOrderIds([]);
                setBatchStorefrontMessage("");
                setSelectedHistoryPhotoIds({});
              }
            }}
            onIntervalMinChange={(value) => {
              setSubmitIntervalMinSeconds(value);
              setSubmitIntervalMaxSeconds((current) =>
                Math.max(current, value),
              );
            }}
            onIntervalMaxChange={(value) => {
              setSubmitIntervalMaxSeconds(value);
              setSubmitIntervalMinSeconds((current) =>
                Math.min(current, value),
              );
            }}
            onBack={() => {
              setScreen("orders");
              setMainTab("more");
            }}
            onNext={() => {
              setSubmitMode("all-manual");
              setHistoryMode("manual");
              setScreen("select");
            }}
            />
          )}
          {screen === "select" && (
            <SubmitPage
            orders={pendingSubmitOrders}
            selected={pendingSelectedIds}
            mode={submitMode}
            preparing={batchStorefrontLoading}
            prefillMessage={batchStorefrontMessage}
            storefrontPrefilledOrderHeaderIds={
              storefrontPrefilledOrderHeaderIds
            }
            date={selectedDate}
            onDateChange={changeSelectedDate}
            onBack={() => setScreen("mode")}
            onFilter={() => setFilterOpen(true)}
            onToggle={toggleOrder}
            onToggleAll={toggleAllPendingOrders}
            onDetail={openCurrentOrderDetail}
            onPrepare={() => void openBatchPreparation()}
            />
          )}
          {screen === "prepare" && activeOrder && (
            <PreparePage
            orders={selectedOrders}
            activeOrder={activeOrder}
            submitMode={submitMode}
            historyFile={activeHistoryFile}
            selectedHistoryPhotoId={activeHistoryPhotoId}
            historyMode={historyMode}
            historyPhotos={historyPhotos}
            historyPhotoError={historyPhotoError}
            historyPhotoLoading={historyPhotoLoadingOrderIds.includes(
              activeOrder.id,
            )}
            historyPhotoStatusByOrder={historyPhotoStatusByOrder}
            libraryFile={libraryFile}
            detailCloseupFile={activeDetailCloseupFile}
            allManualReadyByOrder={allManualReadyByOrder}
            allManualDoorfrontReadyByOrder={allManualDoorfrontReadyByOrder}
            storefrontPrefilledByOrder={storefrontPrefilledByOrder}
            storefrontPrefillMessage={batchStorefrontMessage}
            checkingDuplicates={batchDuplicateChecking}
            date={selectedDate}
            onDateChange={changeSelectedDate}
            onBack={() => setScreen("select")}
            onSelectOrder={setActiveOrderId}
            onPickHistoryFile={async (file) => {
              if (file && submitMode === "all-manual") {
                const slotKey = `${activeOrder.id}:storefront`;
                const duplicate = await findDuplicateImage(
                  file,
                  batchImageEntries(
                    selectedOrders,
                    historyFiles,
                    detailCloseupFiles,
                  ).filter((entry) => entry.key !== slotKey),
                );
                if (duplicate) {
                  throw new Error(
                    `这张图片与“${duplicate.label}”内容完全相同，请选择另一张照片`,
                  );
                }
              }
              setHistoryMode("manual");
              setStorefrontPrefilledOrderIds((current) =>
                current.filter((id) => id !== activeOrder.id),
              );
              setSelectedHistoryPhotoIds((current) => {
                const next = { ...current };
                delete next[activeOrder.id];
                return next;
              });
              setHistoryFiles((current) => {
                const next = { ...current };
                if (file) next[activeOrder.id] = file;
                else delete next[activeOrder.id];
                return next;
              });
              setWatermarkedUploads((current) => {
                const next = { ...current };
                delete next[activeOrder.id];
                return next;
              });
            }}
            onHistoryModeChange={setHistoryMode}
            onFindHistoricalPhotos={() => void findHistoricalPhotos()}
            onSelectHistoricalPhoto={(photo) => {
              setHistoryMode("auto");
              setHistoryFiles((current) => ({
                ...current,
                [activeOrder.id]: photo.file,
              }));
              setWatermarkedUploads((current) => {
                const next = { ...current };
                delete next[activeOrder.id];
                return next;
              });
              setSelectedHistoryPhotoIds((current) => ({
                ...current,
                [activeOrder.id]: photo.id,
              }));
            }}
            onPickLibraryFile={setLibraryFile}
            onPickDetailCloseupFile={async (file) => {
              if (file && submitMode === "all-manual") {
                const slotKey = `${activeOrder.id}:detail`;
                const duplicate = await findDuplicateImage(
                  file,
                  batchImageEntries(
                    selectedOrders,
                    historyFiles,
                    detailCloseupFiles,
                  ).filter((entry) => entry.key !== slotKey),
                );
                if (duplicate) {
                  throw new Error(
                    `这张图片与“${duplicate.label}”内容完全相同，请选择另一张照片`,
                  );
                }
              }
              setDetailCloseupFiles((current) => {
                const next = { ...current };
                if (file) next[activeOrder.id] = file;
                else delete next[activeOrder.id];
                return next;
              });
              setWatermarkedUploads((current) => {
                const next = { ...current };
                delete next[activeOrder.id];
                return next;
              });
            }}
            onNext={() => void openBatchConfirmation()}
            />
          )}
          {screen === "confirm" && (
            <ConfirmPage
            orders={selectedOrders}
            submitMode={submitMode}
            historyFiles={historyFiles}
            libraryFile={libraryFile}
            detailCloseupFiles={detailCloseupFiles}
            watermarkedUploads={watermarkedUploads}
            reason={reason}
            remark={remark}
            operatorName={operatorName}
            operatorLocked={false}
            date={selectedDate}
            onDateChange={changeSelectedDate}
            onBack={() => setScreen("prepare")}
            onReasonChange={setReason}
            onRemarkChange={setRemark}
            onOperatorNameChange={setCustomOperatorName}
            onStart={() => void runBatch()}
            />
          )}
          {screen === "running" && (
            <RunningPage
            total={batchOrders.length || selectedOrders.length}
            paused={paused}
            date={selectedDate}
            onDateChange={changeSelectedDate}
            onTogglePause={() => setPaused((value) => !value)}
            onFinish={() => setScreen("records")}
            current={currentIndex}
            message={runMessage}
            running={running}
            />
          )}
          {screen === "records" && (
            <RecordsPage
            orders={batchOrders}
            date={selectedDate}
            onDateChange={changeSelectedDate}
            onBack={() => setScreen("mode")}
            onRetry={(id) => void retryLog(id)}
            />
          )}
        </Suspense>
        <Suspense fallback={null}>
          {drawer && (drawer === "settings" || activeOrder) && (
            <AppDrawer
            type={drawer}
            order={activeOrder ?? null}
            detail={detail}
            detailAjInfo={detailAjInfo}
            detailLoading={detailLoading}
            detailError={detailError}
            appliedTheme={appliedTheme}
            appliedAccent={appliedAccent}
            appearanceSettings={appearanceSettings}
            auth={auth!}
            mobileRuntime={isMobileRuntime}
            libraryPhotos={[]}
            localAccountKey={localAccountKey}
            defaultOperatorName={customOperatorName}
            setDefaultOperatorName={setCustomOperatorName}
            setAppearanceSettings={setAppearanceSettings}
            onCheckLog={checkLogBeforeRetry}
            onRetryLog={retryLog}
            onLoadExchangeLogs={fetchWorkOrderExchangeLogs}
            onRefreshSession={refreshSession}
            onSaveRefreshToken={saveRefreshToken}
            onExportSession={exportSession}
            onStorefrontPrefillChange={(woHeaderId, saved) => {
              setStorefrontPrefilledOrderHeaderIds((current) =>
                saved
                  ? Array.from(new Set([...current, woHeaderId]))
                  : current.filter((id) => id !== woHeaderId),
              );
              if (saved && screen === "select") {
                const order = pendingSubmitOrders.find(
                  (item) => item.woHeaderId === woHeaderId,
                );
                if (order) {
                  setSelected((current) =>
                    current.includes(order.id)
                      ? current
                      : [...current, order.id],
                  );
                  setBatchStorefrontMessage(
                    `已保存并自动勾选 ${order.woNumber || order.id}`,
                  );
                }
              }
            }}
            signatureSaved={Boolean(activeOrder && signedOrderHeaderIds.includes(activeOrder.woHeaderId))}
            onOpenSignature={openSignatureFromDetail}
            onClose={() => {
              setDrawer(null);
              setLocalDetailOrder(null);
            }}
            onLogout={() => {
              void logout().catch((error) =>
                setLoadError(`退出登录失败：${messageOf(error)}`),
              );
            }}
            />
          )}
        </Suspense>
        {filterOpen && (
          <div
            className="filter-overlay"
            onClick={() => {
              setOpenFilterPicker(null);
              setFilterOpen(false);
            }}
          >
            <section
              className="filter-panel"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="filter-panel-heading">
                <h2>筛选工单</h2>
                <button
                  type="button"
                  className="filter-reset-button"
                  disabled={!activeFilterCount}
                  onClick={() => {
                    setStatusFilter("all");
                    setBuildingFilter("all");
                    setUnitFilter("all");
                    setFloorFilter("all");
                    setOpenFilterPicker(null);
                  }}
                >
                  重置筛选
                </button>
              </div>
              <p>
                关键词、楼栋、单元、楼层、工单状态和排序方式会叠加应用；位置选项来自当前日期实际加载的工单。
                {screen === "orders" && mainTab === "home"
                  ? " 首页会先按楼层聚合，排序同时决定楼层组及组内工单顺序。"
                  : ""}
              </p>
              <FilterPicker
                label="楼栋"
                value={buildingFilter}
                allLabel="全部楼栋"
                options={buildingOptions}
                open={openFilterPicker === "building"}
                onToggle={() =>
                  setOpenFilterPicker((current) =>
                    current === "building" ? null : "building",
                  )
                }
                onSelect={(value) => {
                  setBuildingFilter(value);
                  setUnitFilter("all");
                  setFloorFilter("all");
                  setOpenFilterPicker(null);
                }}
              />
              <FilterPicker
                label="单元"
                value={unitFilter}
                allLabel="全部单元"
                options={unitOptions}
                open={openFilterPicker === "unit"}
                onToggle={() =>
                  setOpenFilterPicker((current) =>
                    current === "unit" ? null : "unit",
                  )
                }
                onSelect={(value) => {
                  setUnitFilter(value);
                  setFloorFilter("all");
                  setOpenFilterPicker(null);
                }}
              />
              <FilterPicker
                label="楼层"
                value={floorFilter}
                allLabel="全部楼层"
                options={floorOptions}
                open={openFilterPicker === "floor"}
                onToggle={() =>
                  setOpenFilterPicker((current) =>
                    current === "floor" ? null : "floor",
                  )
                }
                onSelect={(value) => {
                  setFloorFilter(value);
                  setOpenFilterPicker(null);
                }}
              />
              <span className="filter-section-label">工单状态</span>
              <div className="status-filter-options">
                {workOrderStatusOptions.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={statusFilter === option.value ? "active" : ""}
                    onClick={() => setStatusFilter(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <span className="filter-section-label">排序方式</span>
              <div className="sort-filter-options">
                {workOrderSortOptions.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={sortField === option.value ? "active" : ""}
                    aria-pressed={sortField === option.value}
                    onClick={() => setSortField(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <span className="filter-section-label">排序方向</span>
              <div className="sort-filter-options">
                <button
                  type="button"
                  className={`sort-direction-button ${sortDirection === "asc" ? "active" : ""}`}
                  aria-pressed={sortDirection === "asc"}
                  disabled={sortField === "original"}
                  onClick={() => setSortDirection("asc")}
                >
                  升序
                </button>
                <button
                  type="button"
                  className={`sort-direction-button ${sortDirection === "desc" ? "active" : ""}`}
                  aria-pressed={sortDirection === "desc"}
                  disabled={sortField === "original"}
                  onClick={() => setSortDirection("desc")}
                >
                  降序
                </button>
              </div>
              <button
                onClick={() => {
                  setOpenFilterPicker(null);
                  setFilterOpen(false);
                }}
              >
                完成（筛选并排序后 {filteredOrders.length} 条）
              </button>
            </section>
          </div>
        )}
        {screen === "orders" && (
          <PrimaryNav active={mainTab} onChange={setMainTab} />
        )}
      </main>
      {loadingOrders ? (
        <div className="orders-loading-shield" role="status" aria-live="polite">
          <span>
            <Icon name="refresh" size={13} />
            正在加载工单…
          </span>
        </div>
      ) : null}
      {startupRefreshNotice ? (
        <div
          className="startup-refresh-notice"
          role="status"
          aria-live="polite"
        >
          <span className="startup-refresh-notice-icon">
            <Icon name="check" size={15} />
          </span>
          <span>{startupRefreshNotice}</span>
          <button
            type="button"
            aria-label="关闭 Token 续期提示"
            onClick={() => setStartupRefreshNotice(null)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
