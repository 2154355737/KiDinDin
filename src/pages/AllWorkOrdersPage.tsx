import { useEffect, useMemo, useRef, useState } from "react";
import { DatePicker } from "../components/DatePicker";
import { FilterPicker } from "../components/FilterPicker";
import { Icon } from "../components/Icon";
import { FilterButton } from "../components/Navigation";
import { WorkOrderList } from "../components/WorkOrderList";
import {
  fetchAllWorkOrders,
  type AllWorkOrderFilters,
  type CisWorkOrder,
} from "../services/workOrderApi";
import { getWorkOrderStatus, type WorkOrder } from "../types/workOrder";

type AllWorkOrdersPageProps = {
  onBack: () => void;
  onOpenDetail: (order: CisWorkOrder) => void;
};

type NamedOption = { code: string; name: string };

const ALL_WORK_ORDERS_PAGE_SIZE = 100;

const statusOptions = [
  { codes: ["20"], name: "待处理" },
  { codes: ["30"], name: "处理中" },
  { codes: ["40", "50"], name: "已完成" },
  { codes: ["60"], name: "已结束" },
] as const;

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function createDefaultFilters(): AllWorkOrderFilters {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 90);
  return {
    dateCreateStart: localDate(start),
    dateCreateEnd: localDate(end),
    detailType: "",
    mainType: "",
    operatorFlag: "N",
    receivingTeam: "",
    statusCodes: [],
  };
}

function valueText(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function mergeOptions(current: NamedOption[], next: NamedOption[]) {
  const result = new Map(current.map((item) => [item.code, item]));
  for (const item of next) if (item.code) result.set(item.code, item);
  return [...result.values()].sort((left, right) =>
    left.name.localeCompare(right.name, "zh-CN"),
  );
}

function appendUniqueOrders(current: CisWorkOrder[], next: CisWorkOrder[]) {
  const merged = new Map(current.map((order) => [order.woHeaderId, order]));
  next.forEach((order) => merged.set(order.woHeaderId, order));
  return [...merged.values()];
}

function addressOf(order: CisWorkOrder) {
  return (
    valueText(order.addressDetailed) ||
    valueText(order.addressDetail?.addressDetailed) ||
    "未提供服务地址"
  );
}

function locationOf(order: CisWorkOrder) {
  const address = order.addressDetail ?? {};
  return [
    valueText(order.building) || valueText(address.building),
    valueText(order.unitsNumber) || valueText(address.unitsNumber),
    valueText(order.floorNumber) || valueText(address.floorNumber),
    valueText(order.roomNumber) || valueText(address.roomNumber),
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizeSearchText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").trim();
}

function collectSearchValues(value: unknown, result: string[], depth = 0) {
  if (depth > 5 || value == null) return;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    result.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectSearchValues(item, result, depth + 1));
    return;
  }
  if (typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) => collectSearchValues(item, result, depth + 1));
  }
}

function buildSearchDocument(order: CisWorkOrder) {
  const values: string[] = [
    addressOf(order),
    locationOf(order),
    getWorkOrderStatus(valueText(order.statusCode)),
  ];
  collectSearchValues(order, values);
  return normalizeSearchText(values.join(" "));
}

function matchesLocalSearch(order: CisWorkOrder, query: string) {
  const keywords = normalizeSearchText(query).split(" ").filter(Boolean);
  if (!keywords.length) return true;
  const document = buildSearchDocument(order);
  return keywords.every((keyword) => document.includes(keyword));
}

function toUiOrder(source: CisWorkOrder): WorkOrder {
  const address = source.addressDetail ?? {};
  const building = valueText(source.building) || valueText(address.building) || "未标注楼栋";
  const unitNumber = valueText(source.unitsNumber) || valueText(address.unitsNumber) || "未标注单元";
  const floorNumber = valueText(source.floorNumber) || valueText(address.floorNumber) || "未标注楼层";
  const location = locationOf(source) || "地址信息待补充";
  const workType =
    valueText(source.woDetailTypeName) ||
    valueText(source.woMainTypeName) ||
    valueText(source.woName);
  const backendStatusCode = valueText(source.statusCode);
  return {
    address: addressOf(source),
    backendStatusCode,
    building,
    floorNumber,
    id: valueText(source.woNumber) || source.woHeaderId,
    raw: source,
    resident: valueText(source.userName) || valueText(source.contactPerson) || "未命名用户",
    searchText: [source.woNumber, source.userName, source.contactPhone, addressOf(source)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
    status: getWorkOrderStatus(backendStatusCode),
    time: valueText(source.createTime).slice(5, 16) || "待安排",
    unit: workType ? `${location} · ${workType}` : location,
    unitNumber,
    woHeaderId: source.woHeaderId,
    woNumber: source.woNumber,
  };
}

export function AllWorkOrdersPage({ onBack, onOpenDetail }: AllWorkOrdersPageProps) {
  const initialFilters = useMemo(createDefaultFilters, []);
  const [draft, setDraft] = useState<AllWorkOrderFilters>(initialFilters);
  const [applied, setApplied] = useState<AllWorkOrderFilters>(initialFilters);
  const [records, setRecords] = useState<CisWorkOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [pageIndex, setPageIndex] = useState(1);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [draftSortDirection, setDraftSortDirection] = useState<"asc" | "desc">("desc");
  const [filterOpen, setFilterOpen] = useState(false);
  const [openFilterPicker, setOpenFilterPicker] = useState<string | null>(null);
  const [localQuery, setLocalQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [mainTypes, setMainTypes] = useState<NamedOption[]>([]);
  const [detailTypes, setDetailTypes] = useState<NamedOption[]>([]);
  const [teams, setTeams] = useState<NamedOption[]>([]);
  const requestSequence = useRef(0);
  const requestInFlight = useRef(false);
  const listHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleBack = (event: Event) => {
      if (!filterOpen) return;
      event.preventDefault();
      if (openFilterPicker) setOpenFilterPicker(null);
      else setFilterOpen(false);
    };
    window.addEventListener("kidindin:back", handleBack);
    return () => window.removeEventListener("kidindin:back", handleBack);
  }, [filterOpen, openFilterPicker]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    requestInFlight.current = true;
    setLoading(true);
    setError("");
    void fetchAllWorkOrders(applied, pageIndex, ALL_WORK_ORDERS_PAGE_SIZE, sortDirection)
      .then((response) => {
        if (sequence !== requestSequence.current) return;
        setRecords((current) => pageIndex === 1
          ? response.records
          : appendUniqueOrders(current, response.records));
        setTotal(response.total);
        setPages(response.pages);
        if (response.pages > 0 && pageIndex > response.pages) {
          setPageIndex(response.pages);
          return;
        }
        setMainTypes((current) =>
          mergeOptions(current, response.records.map((order) => ({
            code: valueText(order.woMainType),
            name: valueText(order.woMainTypeName) || valueText(order.woMainType),
          }))),
        );
        setDetailTypes((current) =>
          mergeOptions(current, response.records.map((order) => ({
            code: valueText(order.woDetailType),
            name: valueText(order.woDetailTypeName) || valueText(order.woDetailType),
          }))),
        );
        setTeams((current) =>
          mergeOptions(current, response.records.map((order) => ({
            code: valueText(order.receivingTeam),
            name: valueText(order.receivingTeamName) || valueText(order.receivingTeam),
          }))),
        );
      })
      .catch((reason) => {
        if (sequence !== requestSequence.current) return;
        if (pageIndex === 1) {
          setRecords([]);
          setTotal(0);
          setPages(0);
        }
        const message = reason instanceof Error ? reason.message : "全部工单加载失败";
        setError(pageIndex === 1 ? message : `第 ${pageIndex} 页加载失败：${message}`);
      })
      .finally(() => {
        if (sequence === requestSequence.current) {
          requestInFlight.current = false;
          setLoading(false);
        }
      });
  }, [applied, pageIndex, refreshKey, sortDirection]);

  const visibleRecords = useMemo(
    () => records.filter((order) => matchesLocalSearch(order, localQuery)),
    [localQuery, records],
  );
  const uiOrders = useMemo(() => visibleRecords.map(toUiOrder), [visibleRecords]);

  useEffect(() => {
    const list = listHostRef.current?.querySelector<HTMLElement>(".order-list");
    if (!list) return;
    const loadNextPage = () => {
      if (
        localQuery.trim() ||
        requestInFlight.current ||
        loading ||
        pages === 0 ||
        pageIndex >= pages ||
        list.scrollHeight - list.scrollTop - list.clientHeight > 220
      ) return;
      requestInFlight.current = true;
      setPageIndex((current) => Math.min(current + 1, pages));
    };
    list.addEventListener("scroll", loadNextPage, { passive: true });
    loadNextPage();
    return () => list.removeEventListener("scroll", loadNextPage);
  }, [loading, localQuery, pageIndex, pages, records.length]);
  const activeFilterCount =
    Number(applied.statusCodes.length > 0) +
    Number(Boolean(applied.mainType)) +
    Number(Boolean(applied.detailType)) +
    Number(Boolean(applied.receivingTeam));
  const selectedStatusGroups = statusOptions
    .filter((option) => option.codes.every((code) => draft.statusCodes.includes(code)))
    .map((option) => option.codes.join(","));
  const applyFilters = (next = draft) => {
    if (!next.dateCreateStart || !next.dateCreateEnd) {
      setError("请选择完整的开始和结束日期");
      return;
    }
    if (next.dateCreateStart > next.dateCreateEnd) {
      setError("开始日期不能晚于结束日期");
      return;
    }
    setRecords([]);
    setPageIndex(1);
    setSortDirection(draftSortDirection);
    setApplied(next);
    setRefreshKey((value) => value + 1);
    setOpenFilterPicker(null);
    setFilterOpen(false);
  };

  const resetFilters = () => {
    const next = createDefaultFilters();
    setDraft(next);
    setApplied(next);
    setRecords([]);
    setPageIndex(1);
    setSortDirection("desc");
    setDraftSortDirection("desc");
    setRefreshKey((value) => value + 1);
    setOpenFilterPicker(null);
    setFilterOpen(false);
  };

  return (
    <div className="all-orders-page">
      <header className="subheader all-orders-header">
        <button type="button" className="back-button" onClick={onBack} aria-label="返回更多功能"><Icon name="chevron" /></button>
        <div><span>跨类型查询</span><h1>全部工单</h1></div>
        <button type="button" className={`icon-button all-orders-refresh ${loading ? "loading" : ""}`} disabled={loading} onClick={() => { setRecords([]); setPageIndex(1); setRefreshKey((value) => value + 1); }} aria-label="刷新全部工单"><Icon name="refresh" size={17} /></button>
      </header>

      <section className="all-orders-summary" aria-label="全部工单查询概览">
        <div><small>结果总数</small><strong>{total}</strong><span>单</span></div>
        <div><small>已加载</small><b>{records.length}<i>/</i>{total || records.length}</b></div>
        <div><small>当前显示</small><b>{uiOrders.length}<i>单</i></b></div>
      </section>

      <div className="all-orders-search-row">
        <label className="search-bar all-orders-local-search">
          <Icon name="search" size={16} />
          <input
            value={localQuery}
            placeholder="搜索工单全部信息"
            aria-label="本地搜索工单全部信息"
            onChange={(event) => setLocalQuery(event.target.value)}
          />
          {localQuery ? (
            <button
              type="button"
              aria-label="清除搜索"
              onClick={() => setLocalQuery("")}
            >
              <Icon name="close" size={14} />
            </button>
          ) : null}
        </label>
        <FilterButton activeCount={activeFilterCount} onClick={() => setFilterOpen(true)} />
      </div>

      <div className="all-orders-query-caption">
        <span>{localQuery ? `本地搜索 ${uiOrders.length} / ${records.length} 条 · 不访问网络` : `${applied.dateCreateStart} 至 ${applied.dateCreateEnd}`}</span>
        {activeFilterCount ? <button type="button" onClick={resetFilters}>重置条件</button> : null}
      </div>

      {error ? <div className="all-orders-error" role="alert"><span>{error}</span><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>重试</button></div> : null}

      {loading && !uiOrders.length ? (
        <div className="all-orders-skeletons" aria-label="正在加载全部工单">
          {Array.from({ length: 10 }, (_, item) => <span key={item} className="all-orders-skeleton" />)}
        </div>
      ) : (
        <div className="all-orders-home-list" ref={listHostRef}>
          <WorkOrderList
            orders={uiOrders}
            loading={loading}
            onDetail={(order) => onOpenDetail(order.raw as CisWorkOrder)}
          />
          {loading ? <span className="all-orders-inline-loading"><Icon name="refresh" size={14} />正在加载更多</span> : null}
          {!loading && records.length > 0 && pageIndex >= pages ? <span className="all-orders-list-end">已加载全部 {records.length} 单</span> : null}
        </div>
      )}

      {filterOpen ? <div className="filter-overlay" onClick={() => { setOpenFilterPicker(null); setFilterOpen(false); }}>
        <section className="filter-panel all-orders-filter-panel" role="dialog" aria-modal="true" aria-label="筛选全部工单" onClick={(event) => event.stopPropagation()}>
          <div className="filter-panel-heading">
            <h2>筛选工单</h2>
            <button type="button" className="filter-reset-button" onClick={resetFilters}>重置筛选</button>
          </div>
          <p>日期、类型、服务组、状态和排序方式会叠加应用；点击完成后重新向服务端查询。</p>
          <span className="filter-section-label">创建日期范围</span>
          <div className="all-orders-home-date-range">
            <DatePicker value={draft.dateCreateStart} onChange={(dateCreateStart) => setDraft((current) => ({ ...current, dateCreateStart }))} />
            <span>至</span>
            <DatePicker value={draft.dateCreateEnd} onChange={(dateCreateEnd) => setDraft((current) => ({ ...current, dateCreateEnd }))} />
          </div>
          <FilterPicker
            label="主类型"
            value={draft.mainType}
            allValue=""
            allLabel="全部类型"
            options={mainTypes.map((option) => ({ label: option.name, value: option.code }))}
            open={openFilterPicker === "mainType"}
            onToggle={() => setOpenFilterPicker((current) => current === "mainType" ? null : "mainType")}
            onSelect={(mainType) => { setDraft((current) => ({ ...current, mainType, detailType: "" })); setOpenFilterPicker(null); }}
          />
          <FilterPicker
            label="详细类型"
            value={draft.detailType}
            allValue=""
            allLabel="全部详细类型"
            options={detailTypes.map((option) => ({ label: option.name, value: option.code }))}
            open={openFilterPicker === "detailType"}
            onToggle={() => setOpenFilterPicker((current) => current === "detailType" ? null : "detailType")}
            onSelect={(detailType) => { setDraft((current) => ({ ...current, detailType })); setOpenFilterPicker(null); }}
          />
          <FilterPicker
            label="服务组"
            value={draft.receivingTeam}
            allValue=""
            allLabel="全部授权服务组"
            options={teams.map((option) => ({ label: option.name, value: option.code }))}
            open={openFilterPicker === "team"}
            onToggle={() => setOpenFilterPicker((current) => current === "team" ? null : "team")}
            onSelect={(receivingTeam) => { setDraft((current) => ({ ...current, receivingTeam })); setOpenFilterPicker(null); }}
          />
          <span className="filter-section-label">工单状态</span>
          <div className="status-filter-options">
            {statusOptions.map((option) => {
              const group = option.codes.join(",");
              const active = selectedStatusGroups.includes(group);
              return <button type="button" key={group} className={active ? "active" : ""} aria-pressed={active} onClick={() => setDraft((current) => ({ ...current, statusCodes: active ? current.statusCodes.filter((code) => !option.codes.some((optionCode) => optionCode === code)) : [...new Set([...current.statusCodes, ...option.codes])] }))}>{option.name}</button>;
            })}
          </div>
          <span className="filter-section-label">排序方向</span>
          <div className="sort-filter-options">
            <button type="button" className={`sort-direction-button ${draftSortDirection === "asc" ? "active" : ""}`} aria-pressed={draftSortDirection === "asc"} onClick={() => setDraftSortDirection("asc")}>升序</button>
            <button type="button" className={`sort-direction-button ${draftSortDirection === "desc" ? "active" : ""}`} aria-pressed={draftSortDirection === "desc"} onClick={() => setDraftSortDirection("desc")}>降序</button>
          </div>
          <button type="button" onClick={() => applyFilters()}>完成并查询</button>
        </section>
      </div> : null}
    </div>
  );
}
