import type { WorkOrder } from "../types/workOrder";
import type { LocalWorkOrderMeta } from "../services/localWorkOrderStore";
import { DatePicker } from "../components/DatePicker";
import { Icon } from "../components/Icon";
import { WorkOrderList } from "../components/WorkOrderList";
import { FilterButton } from "../components/Navigation";

export function HomePage({
  orders,
  overviewOrders,
  query,
  date,
  localMetaById,
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
  const completed = overviewOrders.filter(
    (order) => order.status === "已完成",
  ).length;
  const ended = overviewOrders.filter(
    (order) => order.status === "已结束",
  ).length;
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
            aria-label="设置"
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
        collapsedFloorGroupKeys={collapsedFloorGroupKeys}
        localMetaById={localMetaById}
        onDetail={onDetail}
        onCollapsedFloorGroupKeysChange={onCollapsedFloorGroupKeysChange}
        onToggleFavorite={onToggleFavorite}
        onTogglePinned={onTogglePinned}
        onSaveNote={onSaveNote}
      />
    </>
  );
}
