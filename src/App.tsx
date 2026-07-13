import { useCallback, useEffect, useMemo, useState } from "react";
import { AppDrawer } from "./components/AppDrawer";
import { PrimaryNav } from "./components/Navigation";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { StatsPage } from "./pages/StatsPage";
import { SubmitPage } from "./pages/SubmitPage";
import { ConfirmPage, PreparePage, RecordsPage, RunningPage } from "./pages/WorkflowPages";
import { configureAuthSession, fetchAuthStatus, logoutAuth } from "./services/authApi";
import {
  closeSecurityCheckWorkOrder,
  createWorkOrderExchangeLog,
  fetchWorkOrderDetail,
  fetchWorkOrderUserAjInfo,
  fetchWorkOrders,
  uploadWorkOrderFiles,
  type CisWorkOrder,
  type WorkOrderDetail,
} from "./services/workOrderApi";
import { isNativeRuntime, type AuthStatus } from "./services/tauri";
import { getWorkOrderStatus, matchesWorkOrderStatus, workOrderStatusOptions, type DrawerKind, type MainTab, type OrderStatus, type Screen, type Theme, type WorkOrder, type WorkOrderStatusFilter } from "./types/workOrder";

const CLOSE_REASON_UNREACHABLE = "11";
const EXCHANGE_TYPE_UNREACHABLE = "80";

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

function FilterPicker({ label, value, allLabel, options, open, onToggle, onSelect }: {
  label: string;
  value: string;
  allLabel: string;
  options: string[];
  open: boolean;
  onToggle: () => void;
  onSelect: (value: string) => void;
}) {
  return <div className="filter-picker"><span>{label}</span><button type="button" className="filter-picker-trigger" onClick={onToggle} aria-expanded={open}>{value === "all" ? allLabel : value}<Icon name="chevron" size={15} /></button>{open && <div className="filter-picker-menu"><button type="button" className={value === "all" ? "active" : ""} onClick={() => onSelect("all")}>{allLabel}</button>{options.map((option) => <button type="button" key={option} className={value === option ? "active" : ""} onClick={() => onSelect(option)}>{option}</button>)}</div>}</div>;
}

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [screen, setScreen] = useState<Screen>("orders");
  const [mainTab, setMainTab] = useState<MainTab>("home");
  const [theme, setTheme] = useState<Theme>("system");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<WorkOrderStatusFilter>("all");
  const [buildingFilter, setBuildingFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const [openFilterPicker, setOpenFilterPicker] = useState<"building" | "unit" | null>(null);
  const [selectedDate, setSelectedDate] = useState(today());
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [activeOrderId, setActiveOrderId] = useState("");
  const [historyFile, setHistoryFile] = useState<File | null>(null);
  const [libraryFile, setLibraryFile] = useState<File | null>(null);
  const [reason, setReason] = useState("到访不遇-有居住痕迹");
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
  const activeOrder = orders.find((order) => order.id === activeOrderId) ?? orders[0];
  const selectedOrders = useMemo(() => orders.filter((order) => selected.includes(order.id)), [orders, selected]);
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
      setSelected((current) => current.filter((id) => next.some((order) => order.id === id)));
      setActiveOrderId((current) => next.some((order) => order.id === current) ? current : (next[0]?.id ?? ""));
    } catch (error) {
      setOrders([]); setLoadError(messageOf(error));
    } finally { setLoadingOrders(false); }
  }, [loggedIn, selectedDate]);

  useEffect(() => {
    if (!isNativeRuntime()) {
      setAuth({ authenticated: false, employeeNumber: null, expiresAt: null, username: null });
      setLoginError("当前是浏览器预览，原生登录不可用。请安装并打开 KiDinDin APK 后再粘贴凭据。");
      return;
    }
    void fetchAuthStatus().then(setAuth).catch(() => setAuth({ authenticated: false, employeeNumber: null, expiresAt: null, username: null }));
  }, []);
  useEffect(() => { void loadOrders(); }, [loadOrders]);
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
    } catch (error) { setLoginError(messageOf(error)); }
    finally { setLoggingIn(false); }
  };

  const setOrderStatus = (id: string, status: OrderStatus, backendStatusCode?: string) => setOrders((current) => current.map((order) => order.id === id ? { ...order, backendStatusCode: backendStatusCode ?? order.backendStatusCode, status } : order));
  const toggleOrder = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleAllOrders = () => setSelected((current) => {
    const visibleIds = filteredOrders.map((order) => order.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.includes(id));
    return allVisibleSelected ? current.filter((id) => !visibleIds.includes(id)) : [...new Set([...current, ...visibleIds])];
  });

  const runBatch = async () => {
    if (!historyFile || !libraryFile || !selectedOrders.length) return;
    setRunning(true); setPaused(false); setScreen("running");
    for (let index = 0; index < selectedOrders.length; index += 1) {
      const order = selectedOrders[index];
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
          remark: reason,
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
          params: { closeReason: reason, remark: reason },
          userName: auth?.username || auth?.employeeNumber || "当前操作员",
          woHeaderId: order.woHeaderId,
          woNumber: order.woNumber,
        });
        setOrderStatus(order.id, "已结束", "60");
      } catch (error) {
        setOrderStatus(order.id, "日志失败");
        setRunMessage(`${order.woNumber} 已关闭，流转日志失败：${messageOf(error)}`);
      }
    }
    setRunning(false); setRunMessage("本次批量任务已结束"); setScreen("records"); setMainTab("stats");
  };

  const retryLog = async (id: string) => {
    const order = orders.find((item) => item.id === id); if (!order) return;
    try {
      await createWorkOrderExchangeLog({ exchangeType: EXCHANGE_TYPE_UNREACHABLE, params: { closeReason: reason, remark: reason }, userName: auth?.username || auth?.employeeNumber || "当前操作员", woHeaderId: order.woHeaderId, woNumber: order.woNumber });
      setOrderStatus(id, "已结束", "60");
    } catch (error) { setLoadError(`补发日志失败：${messageOf(error)}`); }
  };

  if (!loggedIn) return <div className={`app-shell theme-${theme}`}><main className="phone-frame"><LoginPage onLogin={login} error={loginError} submitting={loggingIn} /></main></div>;

  return <div className={`app-shell theme-${theme}`}><main className="phone-frame">
    {loadError ? <p className="network-error">{loadError}<button onClick={() => void loadOrders()}>重试</button></p> : null}
    {screen === "orders" && mainTab === "home" && <HomePage orders={filteredOrders} query={query} date={selectedDate} onQueryChange={setQuery} onDateChange={setSelectedDate} onOpenSettings={() => setDrawer("settings")} onFilter={() => setFilterOpen(true)} onDetail={(order) => { setActiveOrderId(order.id); setDrawer("detail"); }} />}
    {screen === "orders" && mainTab === "stats" && <StatsPage orders={orders} date={selectedDate} onDateChange={setSelectedDate} onRetry={retryLog} />}
    {screen === "orders" && mainTab === "submit" && <SubmitPage orders={filteredOrders} selected={selected} date={selectedDate} onDateChange={setSelectedDate} onFilter={() => setFilterOpen(true)} onToggle={toggleOrder} onToggleAll={toggleAllOrders} onDetail={(order) => { setActiveOrderId(order.id); setDrawer("detail"); }} onPrepare={() => { if (selected.length) { setActiveOrderId(selected[0]); setScreen("prepare"); } }} />}
    {screen === "prepare" && activeOrder && <PreparePage orders={selectedOrders} activeOrder={activeOrder} historyFileName={historyFile?.name ?? ""} libraryFileName={libraryFile?.name ?? ""} date={selectedDate} onDateChange={setSelectedDate} onBack={() => setScreen("orders")} onSelectOrder={setActiveOrderId} onPickHistoryFile={setHistoryFile} onPickLibraryFile={setLibraryFile} onNext={() => { if (!historyFile || !libraryFile) { setLoadError("请先选择历史照片和本机补图"); return; } setScreen("confirm"); }} />}
    {screen === "confirm" && <ConfirmPage orders={selectedOrders} reason={reason} date={selectedDate} onDateChange={setSelectedDate} onBack={() => setScreen("prepare")} onReasonChange={setReason} onStart={() => void runBatch()} />}
    {screen === "running" && <RunningPage total={selectedOrders.length} paused={paused} date={selectedDate} onDateChange={setSelectedDate} onBack={() => undefined} onTogglePause={() => setPaused((value) => !value)} onFinish={() => setScreen("records")} current={currentIndex} message={runMessage} running={running} />}
    {screen === "records" && <RecordsPage orders={orders} date={selectedDate} onDateChange={setSelectedDate} onBack={() => { setScreen("orders"); setMainTab("stats"); }} onRetry={(id) => void retryLog(id)} />}
    {drawer && activeOrder && <AppDrawer type={drawer} order={activeOrder} detail={detail} detailAjInfo={detailAjInfo} detailLoading={detailLoading} detailError={detailError} theme={theme} libraryPhotos={[]} setTheme={setTheme} onClose={() => setDrawer(null)} onLogout={() => { void logoutAuth().then(setAuth); setDrawer(null); setScreen("orders"); }} />}
    {filterOpen && <div className="filter-overlay" onClick={() => setFilterOpen(false)}><section className="filter-panel" onClick={(event) => event.stopPropagation()}><h2>筛选工单</h2><p>关键词、楼栋和工单状态会叠加筛选；楼栋选项来自当前日期实际加载的工单。</p><label className="building-filter"><span>楼栋</span><select value={buildingFilter} onChange={(event) => setBuildingFilter(event.target.value)}><option value="all">全部楼栋</option>{buildingOptions.map((building) => <option key={building} value={building}>{building}</option>)}</select></label><div className="status-filter-options">{workOrderStatusOptions.map((option) => <button key={option.value} className={statusFilter === option.value ? "active" : ""} onClick={() => setStatusFilter(option.value)}>{option.label}</button>)}</div><button onClick={() => setFilterOpen(false)}>完成（{filteredOrders.length} 条）</button></section></div>}
    {loadingOrders ? <div className="loading-mask">正在加载工单…</div> : null}
    {screen === "orders" && <PrimaryNav active={mainTab} onChange={(tab) => { setMainTab(tab); setScreen("orders"); }} />}
  </main></div>;
}
