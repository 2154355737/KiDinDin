import { useEffect, useState } from "react";
import type { WorkOrder } from "../types/workOrder";
import type { LocalWorkOrderMeta } from "../services/localWorkOrderStore";
import { DatePicker } from "../components/DatePicker";
import { Icon } from "../components/Icon";
import { WorkOrderList } from "../components/WorkOrderList";
import { FilterButton } from "../components/Navigation";

function greetingForCurrentTime() {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function workloadMessage(total: number) {
  if (total <= 8) return "节奏轻松，慢慢来";
  if (total <= 15) return "节奏刚好，稳稳推进";
  return "任务不少，稳住加油";
}

const DAILY_BRIEFING_TEMPLATES = [
  "{greeting}！今天 {vacant} 个空房、{resident} 个住户，{pace}",
  "{greeting}！空房 {vacant} 户，住户 {resident} 户，带着好状态出发",
  "新的一天开场啦：{vacant} 个空房、{resident} 个住户，{pace}",
  "今日任务已送达：空房 {vacant} 户、住户 {resident} 户，稳稳拿下",
  "{greeting}！今天要走访 {vacant} 个空房和 {resident} 个住户，加油",
  "今日份进度条开启：空房 {vacant} 户，住户 {resident} 户，{pace}",
  "先看今日安排：{vacant} 个空房、{resident} 个住户，心中有数",
  "{greeting}！今天共 {total} 单，空房 {vacant} 户，住户 {resident} 户",
  "今日清单准备好了：空房 {vacant} 户、住户 {resident} 户，出发",
  "元气上线！{vacant} 个空房、{resident} 个住户，今天也要顺顺利利",
  "{greeting}！任务有数，脚步不乱：空房 {vacant} 户，住户 {resident} 户",
  "今天的地图已展开：{vacant} 个空房、{resident} 个住户，逐个完成",
  "今日挑战：空房 {vacant} 户、住户 {resident} 户，保持节奏就好",
  "{greeting}！{total} 个任务等你点亮，{pace}",
  "空房 {vacant} 户，住户 {resident} 户，今日目标清晰，行动起来",
  "今天也从清晰的计划开始：{vacant} 个空房、{resident} 个住户",
  "{greeting}！先稳住节奏，再拿下 {vacant} 个空房和 {resident} 个住户",
  "今日工单组合：空房 {vacant} 户 + 住户 {resident} 户，{pace}",
  "准备就绪！今天有 {vacant} 个空房、{resident} 个住户等你完成",
  "任务再多也别慌：空房 {vacant} 户，住户 {resident} 户，一个个来",
  "{greeting}！今日共 {total} 单，愿每一次上门都顺利",
  "今日行动提示：{vacant} 个空房、{resident} 个住户，记得保持好心情",
  "今天的任务版图：空房 {vacant} 户，住户 {resident} 户，稳中有进",
  "{greeting}！数字已清点：空房 {vacant} 户、住户 {resident} 户",
  "带上耐心出发吧：今天有 {vacant} 个空房和 {resident} 个住户",
  "今天共 {total} 单，空房与住户都已排好，按计划推进",
  "{greeting}！空房 {vacant} 户、住户 {resident} 户，今天也会有好进展",
  "今日节奏由你掌握：{vacant} 个空房，{resident} 个住户，{pace}",
  "工单已就位，状态请拉满：空房 {vacant} 户、住户 {resident} 户",
  "{greeting}！又是稳稳完成任务的一天：空房 {vacant} 户，住户 {resident} 户",
] as const;

function localDayKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function dailyTemplateIndex(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const dayNumber = Math.floor(
    Date.UTC(year, month - 1, day) / (24 * 60 * 60_000),
  );
  return dayNumber % DAILY_BRIEFING_TEMPLATES.length;
}

function fillDailyBriefing(
  template: string,
  values: {
    greeting: string;
    pace: string;
    resident: number;
    total: number;
    vacant: number;
  },
) {
  return template.replace(
    /\{(greeting|pace|resident|total|vacant)\}/g,
    (_, key: keyof typeof values) => String(values[key]),
  );
}

export function HomePage({
  orders,
  overviewOrders,
  query,
  date,
  localMetaById,
  storefrontPrefilledOrderHeaderIds = [],
  collapsedFloorGroupKeys = [],
  activeFilterCount = 0,
  prioritizePinned = true,
  loading = false,
  onQueryChange,
  onDateChange,
  onOpenSettings,
  onFilter,
  onResetFilters,
  onDetail,
  onCollapsedFloorGroupKeysChange,
  onToggleFavorite,
  onTogglePinned,
  onSaveNote,
}: {
  orders: WorkOrder[];
  overviewOrders: WorkOrder[];
  query: string;
  date: string;
  localMetaById: Record<string, LocalWorkOrderMeta>;
  storefrontPrefilledOrderHeaderIds?: readonly string[];
  collapsedFloorGroupKeys?: readonly string[];
  activeFilterCount?: number;
  prioritizePinned?: boolean;
  loading?: boolean;
  onQueryChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onOpenSettings: () => void;
  onFilter: () => void;
  onResetFilters: () => void;
  onDetail: (order: WorkOrder) => void;
  onCollapsedFloorGroupKeysChange: (keys: string[]) => void;
  onToggleFavorite: (order: WorkOrder) => Promise<void>;
  onTogglePinned: (order: WorkOrder) => Promise<void>;
  onSaveNote: (order: WorkOrder, note: string) => Promise<void>;
}) {
  const [briefingDay, setBriefingDay] = useState(localDayKey);
  useEffect(() => {
    const now = new Date();
    const tomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );
    const timer = window.setTimeout(
      () => setBriefingDay(localDayKey()),
      Math.max(tomorrow.getTime() - now.getTime(), 1_000) + 500,
    );
    return () => window.clearTimeout(timer);
  }, [briefingDay]);

  const completed = overviewOrders.filter(
    (order) => order.status === "已完成",
  ).length;
  const ended = overviewOrders.filter(
    (order) => order.status === "已结束",
  ).length;
  const vacantCount = overviewOrders.filter((order) =>
    order.resident.includes("需首检"),
  ).length;
  const residentCount = Math.max(overviewOrders.length - vacantCount, 0);
  const dailyTemplate =
    DAILY_BRIEFING_TEMPLATES[dailyTemplateIndex(briefingDay)];
  const floorGroupingMessage = fillDailyBriefing(dailyTemplate, {
    greeting: greetingForCurrentTime(),
    pace: workloadMessage(overviewOrders.length),
    resident: residentCount,
    total: overviewOrders.length,
    vacant: vacantCount,
  });
  const visibleOrders = [...orders];
  if (prioritizePinned)
    visibleOrders.sort(
      (left, right) =>
        Number(Boolean(localMetaById[right.woHeaderId]?.pinned)) -
        Number(Boolean(localMetaById[left.woHeaderId]?.pinned)),
    );
  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">首页</p>
          <h1>今日工单</h1>
        </div>
        <div className="topbar-actions">
          <FilterButton activeCount={activeFilterCount} onClick={onFilter} />
          <DatePicker value={date} onChange={onDateChange} />
          <button
            className="icon-button"
            onClick={onOpenSettings}
            aria-label="快速配置"
            title="快速配置"
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>
      <section className="home-metrics" aria-label="今日工单概览">
        <div>
          <span>今日工单</span>
          <b>{overviewOrders.length}</b>
        </div>
        <div>
          <span>已完成</span>
          <b className="complete-count">{completed}</b>
        </div>
        <div>
          <span>已结束</span>
          <b className="ended-count">{ended}</b>
        </div>
      </section>
      <label className="search-bar">
        <Icon name="search" size={18} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索工单号、用户或地址"
          aria-label="搜索工单"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            aria-label="清除搜索"
          >
            <Icon name="close" size={15} />
          </button>
        )}
      </label>
      {activeFilterCount ? (
        <div className="active-filter-summary" role="status">
          <button type="button" onClick={onFilter}>
            已启用 {activeFilterCount} 个筛选 · 当前 {visibleOrders.length} 条
          </button>
          <button type="button" onClick={onResetFilters}>
            重置
          </button>
        </div>
      ) : null}
      <WorkOrderList
        orders={visibleOrders}
        loading={loading}
        groupByFloor
        floorGroupingResetKey={date}
        floorGroupingMessage={floorGroupingMessage}
        collapsedFloorGroupKeys={collapsedFloorGroupKeys}
        localMetaById={localMetaById}
        storefrontPrefilledOrderHeaderIds={storefrontPrefilledOrderHeaderIds}
        onDetail={onDetail}
        onCollapsedFloorGroupKeysChange={onCollapsedFloorGroupKeysChange}
        onToggleFavorite={onToggleFavorite}
        onTogglePinned={onTogglePinned}
        onSaveNote={onSaveNote}
      />
    </>
  );
}
