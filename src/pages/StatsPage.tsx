import type { CSSProperties } from "react";
import { CircleAlert, CircleCheck, Clock3, House, TrendingUp, UsersRound } from "lucide-react";
import type { WorkOrder } from "../types/workOrder";
import { DatePicker } from "../components/DatePicker";
import { StatusBadge } from "../components/WorkOrderList";

type StatProps = {
  orders: WorkOrder[];
  date: string;
  onDateChange: (value: string) => void;
  onRetry: (id: string) => void;
};

function percentage(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0;
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day) ? `${month}月${day}日` : value;
}

export function StatsPage({ orders, date, onDateChange, onRetry }: StatProps) {
  const total = orders.length;
  const pending = orders.filter((order) => order.backendStatusCode === "20").length;
  const processing = orders.filter((order) => order.backendStatusCode === "30").length;
  const completed = orders.filter((order) => order.backendStatusCode === "40" || order.backendStatusCode === "50").length;
  const ended = orders.filter((order) => order.backendStatusCode === "60").length;
  const household = completed;
  const failedOrders = orders.filter((order) => order.status === "关闭失败" || order.status === "日志失败");
  const householdRate = percentage(household, total);
  const closureRate = percentage(ended, total);
  const waitingHousehold = Math.max(total - household - ended, 0);
  const followUps = orders.filter((order) => !["40", "50", "60"].includes(order.backendStatusCode));
  const stages = [
    { label: "待处理", value: pending, tone: "pending" },
    { label: "处理中", value: processing, tone: "processing" },
    { label: "已入户", value: completed, tone: "household" },
    { label: "已结束", value: ended, tone: "completed" },
  ];

  return <>
    <header className="topbar stats-topbar">
      <div><p className="eyebrow">{formatDate(date)} · 当日工单</p><h1>今日数据统计</h1></div>
      <DatePicker value={date} onChange={onDateChange} />
    </header>

    <section className="daily-overview" aria-label="今日入户率">
      <div className="overview-copy"><span>今日入户率</span><strong>{householdRate}<small>%</small></strong><p>已入户 {household} 单 / 总工单 {total} 单</p></div>
      <div className="rate-ring" style={{ "--rate": `${householdRate * 3.6}deg` } as CSSProperties}>
        <div className="rate-ring-content"><House size={18} strokeWidth={2.2} /><b>{householdRate}%</b></div>
      </div>
      <div className="overview-foot"><TrendingUp size={15} />{householdRate >= 80 ? "今日入户率表现良好" : total ? `还有 ${waitingHousehold} 单待入户` : "加载工单后自动分析"}</div>
    </section>

    <section className="stats-kpi-grid" aria-label="关键指标">
      <article><span className="kpi-icon total"><UsersRound size={16} /></span><div><b>{total}</b><span>总工单</span></div></article>
      <article><span className="kpi-icon household"><House size={16} /></span><div><b>{household}</b><span>已入户</span></div></article>
      <article><span className="kpi-icon success"><CircleCheck size={16} /></span><div><b>{closureRate}%</b><span>完结率</span></div></article>
      <article><span className={`kpi-icon ${failedOrders.length ? "alert" : "neutral"}`}><CircleAlert size={16} /></span><div><b className={failedOrders.length ? "warning-text" : ""}>{failedOrders.length}</b><span>异常待处理</span></div></article>
    </section>

    <section className="stats-section stage-analysis">
      <div className="stats-section-heading"><div><span>工单进度分析</span><p>已结束不算已入户，仍计入总工单</p></div><b>{household}/{total || 0}</b></div>
      <div className="stage-progress" aria-label="工单状态分布">{stages.map((stage) => <i key={stage.label} className={stage.tone} style={{ width: `${percentage(stage.value, total)}%` }} title={`${stage.label} ${stage.value} 单`} />)}</div>
      <div className="stage-list">{stages.map((stage) => <div key={stage.label}><i className={stage.tone} /><span>{stage.label}</span><b>{stage.value}</b><small>{percentage(stage.value, total)}%</small></div>)}</div>
    </section>

    <section className="stats-section insight-card">
      <div className="stats-section-heading"><div><span>今日重点</span><p>帮助安排下一步处理</p></div><Clock3 size={17} /></div>
      <div className="insight-list">
        <p><b>{pending}</b><span>单仍待处理，优先安排上门。</span></p>
        <p><b>{processing}</b><span>单正在处理中，关注现场进度。</span></p>
        <p><b>{household}</b><span>单已完成入户，入户率为 {householdRate}% 。</span></p>
      </div>
    </section>

    <h2 className="section-title">待跟进工单 <small>{followUps.length}</small></h2>
    <section className="record-list stats-record-list">
      {followUps.slice(0, 8).map((order, index) => <article key={`${order.id}-${index}`}>
        <div><b>{order.resident} · {order.unit}</b><span>{order.id} · {order.time}</span></div>
        <StatusBadge status={order.status} />
        {order.status === "日志失败" && <button className="retry-button" onClick={() => onRetry(order.id)}>补发日志</button>}
      </article>)}
      {!total && <p className="empty-hint">今天还没有可统计的工单</p>}
      {total > 0 && !followUps.length && <p className="empty-hint">全部工单均已入户，继续保持</p>}
    </section>
  </>;
}
