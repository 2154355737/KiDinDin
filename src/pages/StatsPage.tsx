import type { WorkOrder } from "../types/workOrder";
import { DatePicker } from "../components/DatePicker";
import { StatusBadge } from "../components/WorkOrderList";

export function StatsPage({ orders, date, onDateChange, onRetry }: { orders: WorkOrder[]; date: string; onDateChange: (value: string) => void; onRetry: (id: string) => void }) {
  const succeeded = orders.filter((order) => order.status === "已完成" || order.status === "已结束").length;
  const failed = orders.filter((order) => order.status === "关闭失败" || order.status === "日志失败").length;
  return <><header className="topbar"><div><p className="eyebrow">统计</p><h1>今日处理</h1></div><DatePicker value={date} onChange={onDateChange} /></header><section className="stats-hero"><span>今日已完成</span><strong>{succeeded}</strong><b>单</b><p>关闭与日志状态实时汇总</p></section><section className="stats-grid"><div><b>{orders.filter((order) => order.backendStatusCode === "20").length}</b><span>待处理</span></div><div><b>{orders.filter((order) => order.backendStatusCode === "30").length}</b><span>处理中</span></div><div><b className={failed ? "warning-text" : ""}>{failed}</b><span>失败待处理</span></div></section><h2 className="section-title">最近提交</h2><section className="record-list">{orders.filter((order) => order.status === "已结束" || order.status === "日志失败" || order.status === "关闭失败").map((order, index) => <article key={`${order.id}-${index}`}><div><b>{order.resident} · {order.unit}</b><span>{order.id} · 今天 {order.time.slice(0, 5)}</span></div><StatusBadge status={order.status} />{order.status === "日志失败" && <button className="retry-button" onClick={() => onRetry(order.id)}>补发日志</button>}</article>)}{!succeeded && !failed && <p className="empty-hint">还没有提交记录</p>}</section></>;
}
