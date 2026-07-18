import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import type { LocalWorkOrderMeta } from "../services/localWorkOrderStore";

export type LocalWorkOrdersMode = "saved" | "appointments";

export type LocalWorkOrdersPageProps = {
  mode: LocalWorkOrdersMode;
  items: LocalWorkOrderMeta[];
  savingIds?: string[];
  message?: string;
  onBack: () => void;
  onOpenDetail: (item: LocalWorkOrderMeta) => void;
  onToggleFavorite: (item: LocalWorkOrderMeta) => void | Promise<void>;
  onTogglePinned: (item: LocalWorkOrderMeta) => void | Promise<void>;
  onClearAppointment: (item: LocalWorkOrderMeta) => void | Promise<void>;
};

type SavedFilter = "all" | "favorite" | "pinned";

type AppointmentGroup = {
  id: string;
  label: string;
  items: LocalWorkOrderMeta[];
};

function parseAppointment(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatAppointment(value: string | null) {
  const date = parseAppointment(value);
  if (!date) return value || "未设置预约时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDateLabel(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(date);
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function groupAppointments(items: LocalWorkOrderMeta[]): AppointmentGroup[] {
  const now = new Date();
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const startOfDayAfterTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  const groups = new Map<string, AppointmentGroup>();
  const sorted = items
    .filter((item) => item.appointmentAt)
    .sort((left, right) => {
      const leftTime = parseAppointment(left.appointmentAt)?.getTime() ?? Number.POSITIVE_INFINITY;
      const rightTime = parseAppointment(right.appointmentAt)?.getTime() ?? Number.POSITIVE_INFINITY;
      const leftOverdue = leftTime < now.getTime();
      const rightOverdue = rightTime < now.getTime();
      if (leftOverdue && rightOverdue) return rightTime - leftTime;
      return leftTime - rightTime;
    });

  for (const item of sorted) {
    const date = parseAppointment(item.appointmentAt);
    let id = "invalid";
    let label = "时间待确认";
    if (date && date.getTime() < now.getTime()) {
      id = "overdue";
      label = "已过期";
    } else if (date && date < startOfTomorrow) {
      id = "today";
      label = "今天";
    } else if (date && date < startOfDayAfterTomorrow) {
      id = "tomorrow";
      label = "明天";
    } else if (date) {
      id = localDateKey(date);
      label = formatDateLabel(date);
    }
    const group = groups.get(id) ?? { id, label, items: [] };
    group.items.push(item);
    groups.set(id, group);
  }

  return [...groups.values()];
}

function LocalWorkOrderCard({ item, saving, onOpenDetail, onToggleFavorite, onTogglePinned, onClearAppointment }: {
  item: LocalWorkOrderMeta;
  saving: boolean;
  onOpenDetail: (item: LocalWorkOrderMeta) => void;
  onToggleFavorite: (item: LocalWorkOrderMeta) => void | Promise<void>;
  onTogglePinned: (item: LocalWorkOrderMeta) => void | Promise<void>;
  onClearAppointment: (item: LocalWorkOrderMeta) => void | Promise<void>;
}) {
  const snapshot = item.snapshot;
  const identity = snapshot.woNumber || item.woHeaderId;
  const runAction = (action: () => void | Promise<void>) => {
    void Promise.resolve().then(action).catch(() => undefined);
  };

  return <article className={`local-work-order-card ${item.pinned ? "is-pinned" : ""} ${saving ? "is-saving" : ""}`}>
    <button type="button" className="local-work-order-main" onClick={() => onOpenDetail(item)}>
      <div className="local-work-order-heading">
        <span className="local-work-order-id">{identity}</span>
        <span className="local-work-order-status">{snapshot.status || "状态未知"}</span>
      </div>
      <div className="local-work-order-title"><b>{snapshot.resident || "未命名用户"}</b><span>{snapshot.unit || "地址待补充"}</span></div>
      <p className="local-work-order-address">{snapshot.address || "未提供服务地址"}</p>
      <div className="local-work-order-meta">
        <span><Icon name="calendar" size={13} />{item.sourceDate || "来源日期未知"}</span>
        {item.appointmentAt ? <span className="local-work-order-appointment"><Icon name="clock" size={13} />{formatAppointment(item.appointmentAt)}</span> : null}
      </div>
      <span className="local-work-order-detail-label">查看详情 <Icon name="chevron" size={15} /></span>
    </button>

    <div className={`local-work-order-note ${item.note.trim() ? "has-note" : "is-empty"}`}>
      <b>备注</b><p>{item.note.trim() || "暂无备注"}</p>
    </div>

    <div className="local-work-order-actions">
      <button type="button" disabled={saving} className={item.favorite ? "is-active" : ""} aria-pressed={item.favorite} onClick={() => runAction(() => onToggleFavorite(item))}>
        {item.favorite ? <Icon name="check" size={14} /> : null}{item.favorite ? "已收藏" : "收藏"}
      </button>
      <button type="button" disabled={saving} className={item.pinned ? "is-active" : ""} aria-pressed={item.pinned} onClick={() => runAction(() => onTogglePinned(item))}>
        {item.pinned ? <Icon name="check" size={14} /> : null}{item.pinned ? "已置顶" : "置顶"}
      </button>
      {item.appointmentAt ? <button type="button" disabled={saving} className="clear-appointment-button" onClick={() => runAction(() => onClearAppointment(item))}>
        <Icon name="close" size={14} />清除预约
      </button> : null}
    </div>
  </article>;
}

export function LocalWorkOrdersPage({
  mode,
  items,
  savingIds = [],
  message = "",
  onBack,
  onOpenDetail,
  onToggleFavorite,
  onTogglePinned,
  onClearAppointment,
}: LocalWorkOrdersPageProps) {
  const [savedFilter, setSavedFilter] = useState<SavedFilter>("all");
  const [query, setQuery] = useState("");
  const visibleSavedItems = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return items
      .filter((item) => savedFilter === "all" || (savedFilter === "favorite" ? item.favorite : item.pinned))
      .filter((item) => !keyword || [item.note, item.snapshot.woNumber, item.snapshot.resident, item.snapshot.address]
        .some((value) => value.toLocaleLowerCase("zh-CN").includes(keyword)))
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt));
  }, [items, query, savedFilter]);
  const appointmentGroups = useMemo(() => groupAppointments(items), [items]);
  const savedFilters: Array<{ id: SavedFilter; label: string; count: number }> = [
    { id: "all", label: "全部", count: items.length },
    { id: "favorite", label: "收藏", count: items.filter((item) => item.favorite).length },
    { id: "pinned", label: "置顶", count: items.filter((item) => item.pinned).length },
  ];

  const cardProps = { onOpenDetail, onToggleFavorite, onTogglePinned, onClearAppointment };

  return <>
    <header className="subheader local-work-orders-header">
      <button type="button" className="back-button" onClick={onBack} aria-label="返回"><Icon name="chevron" /></button>
      <div><h1>{mode === "saved" ? "我的工单" : "预约日程"}</h1></div>
      <span className="local-work-orders-count">{mode === "saved" ? items.length : items.filter((item) => item.appointmentAt).length}</span>
    </header>

    {message ? <p className="local-page-message" role="status" aria-live="polite">{message}</p> : null}

    {mode === "saved" ? <>
      <nav className="local-work-order-tabs" aria-label="我的工单分类">
        {savedFilters.map((filter) => <button type="button" key={filter.id} className={savedFilter === filter.id ? "active" : ""} aria-pressed={savedFilter === filter.id} onClick={() => setSavedFilter(filter.id)}>{filter.label}<span>{filter.count}</span></button>)}
      </nav>
      <label className="search-bar local-work-order-search">
        <Icon name="search" size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索备注、工单号、住户或地址" aria-label="搜索本地工单备注" />
        {query ? <button type="button" onClick={() => setQuery("")} aria-label="清除搜索"><Icon name="close" size={15} /></button> : null}
      </label>
      <section className="local-work-order-list" aria-label="本地工单列表">
        {visibleSavedItems.map((item) => <LocalWorkOrderCard key={item.key} item={item} saving={savingIds.includes(item.woHeaderId)} {...cardProps} />)}
        {!visibleSavedItems.length ? <p className="empty-hint">{query ? "没有匹配的本地工单" : savedFilter === "all" ? "还没有本地工单标记" : `还没有${savedFilter === "favorite" ? "收藏" : "置顶"}的工单`}</p> : null}
      </section>
    </> : <section className="appointment-groups" aria-label="预约工单列表">
      {appointmentGroups.map((group) => <section className={`appointment-group appointment-group-${group.id}`} key={group.id}>
        <header><h2>{group.label}</h2><span>{group.items.length} 个预约</span></header>
        <div className="local-work-order-list">{group.items.map((item) => <LocalWorkOrderCard key={item.key} item={item} saving={savingIds.includes(item.woHeaderId)} {...cardProps} />)}</div>
      </section>)}
      {!appointmentGroups.length ? <p className="empty-hint">还没有预约工单</p> : null}
    </section>}
  </>;
}
