import type { WorkOrder } from "../types/workOrder";
import { DatePicker } from "../components/DatePicker";
import { Icon } from "../components/Icon";
import { WorkOrderList } from "../components/WorkOrderList";
import { FilterButton } from "../components/Navigation";

export function HomePage({ orders, query, date, onQueryChange, onDateChange, onOpenSettings, onFilter, onDetail }: { orders: WorkOrder[]; query: string; date: string; onQueryChange: (value: string) => void; onDateChange: (value: string) => void; onOpenSettings: () => void; onFilter: () => void; onDetail: (order: WorkOrder) => void }) {
  const completed = orders.filter((order) => order.status === "已完成").length;
  const ended = orders.filter((order) => order.status === "已结束").length;
  const visibleOrders = orders.filter((order) => order.searchText.includes(query.trim().toLowerCase()));
  return <><header className="topbar"><div><p className="eyebrow">首页</p><h1>今日工单</h1></div><div className="topbar-actions"><FilterButton onClick={onFilter} /><DatePicker value={date} onChange={onDateChange} /><button className="icon-button" onClick={onOpenSettings} aria-label="设置"><Icon name="settings" /></button></div></header><section className="home-metrics" aria-label="今日工单概览"><div><span>今日工单</span><b>{orders.length}</b></div><div><span>已完成</span><b className="complete-count">{completed}</b></div><div><span>已结束</span><b className="ended-count">{ended}</b></div></section><label className="search-bar"><Icon name="search" size={18} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索工单号、用户或地址" aria-label="搜索工单" />{query && <button type="button" onClick={() => onQueryChange("")} aria-label="清除搜索"><Icon name="close" size={15} /></button>}</label><WorkOrderList orders={visibleOrders} onDetail={onDetail} /></>;
}
