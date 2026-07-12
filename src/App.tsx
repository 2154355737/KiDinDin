import { useState } from "react";
import { AppDrawer } from "./components/AppDrawer";
import { PrimaryNav } from "./components/Navigation";
import { historyPhotos, initialOrders, libraryPhotos } from "./data/mockData";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { StatsPage } from "./pages/StatsPage";
import { SubmitPage } from "./pages/SubmitPage";
import { ConfirmPage, PreparePage, RecordsPage, RunningPage } from "./pages/WorkflowPages";
import type { DrawerKind, MainTab, Screen, Theme } from "./types/workOrder";

export default function App() {
  const [loggedIn, setLoggedIn] = useState(true);
  const [screen, setScreen] = useState<Screen>("orders");
  const [mainTab, setMainTab] = useState<MainTab>("home");
  const [theme, setTheme] = useState<Theme>("system");
  const [query, setQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState("2026-07-12");
  const [orders, setOrders] = useState(initialOrders);
  const [selected, setSelected] = useState<string[]>(["AJ202607120038", "AJ202607120041"]);
  const [activeOrderId, setActiveOrderId] = useState("AJ202607120038");
  const [pickedHistory, setPickedHistory] = useState(historyPhotos[0]);
  const [pickedLibrary, setPickedLibrary] = useState(libraryPhotos[0]);
  const [reason, setReason] = useState("到访不遇-有居住痕迹");
  const [drawer, setDrawer] = useState<DrawerKind | null>(null);
  const [isPaused, setPaused] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const activeOrder = orders.find((order) => order.id === activeOrderId) ?? orders[0];
  const selectedOrders = orders.filter((order) => selected.includes(order.id));
  const openDetail = (id: string) => { setActiveOrderId(id); setDrawer("detail"); };
  const toggleOrder = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleAllOrders = () => setSelected((current) => current.length === orders.length ? [] : orders.map((order) => order.id));
  const prepareOrder = (id: string) => setOrders((current) => current.map((order) => order.id === id ? { ...order, status: "待提交", historicalPhoto: pickedHistory, libraryPhoto: pickedLibrary } : order));
  const retryLog = (id: string) => setOrders((items) => items.map((item) => item.id === id ? { ...item, status: "成功" } : item));
  const finishRun = () => {
    setOrders((current) => current.map((order) => selected.includes(order.id) ? { ...order, status: order.id.endsWith("041") ? "日志失败" : "成功" } : order));
    setSelected(["AJ202607120041"]);
    setMainTab("stats");
    setScreen("orders");
  };

  return <div className={`app-shell theme-${theme}`}><main className="phone-frame">{!loggedIn ? <LoginPage onLogin={() => setLoggedIn(true)} /> : <>
    {screen === "orders" && mainTab === "home" && <HomePage orders={orders} query={query} date={selectedDate} onQueryChange={setQuery} onDateChange={setSelectedDate} onOpenSettings={() => setDrawer("settings")} onFilter={() => setFilterOpen(true)} onDetail={(order) => openDetail(order.id)} />}
    {screen === "orders" && mainTab === "stats" && <StatsPage orders={orders} date={selectedDate} onDateChange={setSelectedDate} onRetry={retryLog} />}
    {screen === "orders" && mainTab === "submit" && <SubmitPage orders={orders} selected={selected} date={selectedDate} onDateChange={setSelectedDate} onFilter={() => setFilterOpen(true)} onToggle={toggleOrder} onToggleAll={toggleAllOrders} onDetail={(order) => openDetail(order.id)} onPrepare={() => { if (selected.length) { setActiveOrderId(selected[0]); setMainTab("home"); setScreen("prepare"); } }} />}
    {screen === "prepare" && <PreparePage orders={selectedOrders} activeOrder={activeOrder} pickedHistory={pickedHistory} pickedLibrary={pickedLibrary} historyPhotos={historyPhotos} date={selectedDate} onDateChange={setSelectedDate} onBack={() => setScreen("orders")} onOpenGallery={() => setDrawer("gallery")} onSelectOrder={setActiveOrderId} onPickHistory={setPickedHistory} onCycleLibrary={() => setPickedLibrary(libraryPhotos[(libraryPhotos.indexOf(pickedLibrary) + 1) % libraryPhotos.length])} onNext={() => { prepareOrder(activeOrderId); setScreen("confirm"); }} />}
    {screen === "confirm" && <ConfirmPage orders={selectedOrders} reason={reason} date={selectedDate} onDateChange={setSelectedDate} onBack={() => setScreen("prepare")} onReasonChange={setReason} onStart={() => setScreen("running")} />}
    {screen === "running" && <RunningPage total={selected.length} paused={isPaused} date={selectedDate} onDateChange={setSelectedDate} onBack={() => setScreen("confirm")} onTogglePause={() => setPaused((value) => !value)} onFinish={finishRun} />}
    {screen === "records" && <RecordsPage orders={orders} date={selectedDate} onDateChange={setSelectedDate} onBack={() => setScreen("orders")} onRetry={retryLog} />}
    {drawer && <AppDrawer type={drawer} order={activeOrder} theme={theme} libraryPhotos={libraryPhotos} setTheme={setTheme} onClose={() => setDrawer(null)} onLogout={() => { setDrawer(null); setScreen("orders"); setLoggedIn(false); }} />}
    {filterOpen && <div className="filter-overlay" onClick={() => setFilterOpen(false)}><section className="filter-panel" onClick={(event) => event.stopPropagation()}><h2>筛选工单</h2><p>筛选条件将按真实接口字段接入。</p><button onClick={() => setFilterOpen(false)}>完成</button></section></div>}
    {screen === "orders" && <PrimaryNav active={mainTab} onChange={(tab) => { setMainTab(tab); setScreen("orders"); }} />}
  </>}</main></div>;
}
