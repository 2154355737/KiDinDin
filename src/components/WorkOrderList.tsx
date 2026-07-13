import type { OrderStatus, WorkOrder } from "../types/workOrder";
import { Icon } from "./Icon";

const statusClass: Record<OrderStatus, string> = { "待处理": "pending", "处理中": "processing", "已完成": "completed", "已结束": "ended", "待提交": "submitting", "关闭失败": "failed", "日志失败": "failed", "未知": "unknown" };

export function StatusBadge({ status }: { status: OrderStatus }) { return <span className={`status status-${statusClass[status]}`}>{status}</span>; }

export function WorkOrderList({ orders, selected = [], onToggle, onDetail }: { orders: WorkOrder[]; selected?: string[]; onToggle?: (id: string) => void; onDetail: (order: WorkOrder) => void }) {
  const selectable = Boolean(onToggle);
  return <section className="order-list" aria-label="可上下滚动的工单列表">{orders.map((order, index) => <article className={`order-card ${selected.includes(order.id) ? "selected" : ""}`} key={`${order.id}-${index}`}><button className="order-main" onClick={() => onDetail(order)}><div className="order-line"><span className="order-id">{order.id}</span><StatusBadge status={order.status} /></div><div className="order-title">{order.resident}<span>{order.unit}</span></div><div className="order-meta"><span>{order.address}</span><span><Icon name="clock" size={13} />{order.time}</span></div></button>{selectable && <button className="select-control" onClick={() => onToggle?.(order.id)} aria-label={`选择${order.id}`}><span>{selected.includes(order.id) && <Icon name="check" size={15} />}</span></button>}</article>)}{!orders.length && <p className="empty-hint">没有匹配的工单</p>}</section>;
}
