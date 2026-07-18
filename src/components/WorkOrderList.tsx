import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import type { OrderStatus, WorkOrder } from "../types/workOrder";
import type { LocalWorkOrderMeta } from "../services/localWorkOrderStore";
import { Icon } from "./Icon";

const statusClass: Record<OrderStatus, string> = { "待处理": "pending", "处理中": "processing", "已完成": "completed", "已结束": "ended", "待提交": "submitting", "关闭失败": "failed", "日志失败": "failed", "未知": "unknown" };
const MAX_ANIMATED_ORDERS = 60;

function orderMotionKey(order: WorkOrder) {
  return order.woHeaderId || order.id;
}

export function StatusBadge({ status }: { status: OrderStatus }) { return <span className={`status status-${statusClass[status]}`}>{status}</span>; }

export function WorkOrderList({ orders, selected = [], localMetaById = {}, onToggle, onDetail }: { orders: WorkOrder[]; selected?: string[]; localMetaById?: Record<string, LocalWorkOrderMeta>; onToggle?: (id: string) => void; onDetail: (order: WorkOrder) => void }) {
  const selectable = Boolean(onToggle);
  const reduceMotion = useReducedMotion();
  const previousCountRef = useRef(orders.length);
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const orderSequence = useMemo(() => orders.map(orderMotionKey).join("|"), [orders]);
  const motionEnabled = !reduceMotion && Math.max(previousCountRef.current, orders.length) <= MAX_ANIMATED_ORDERS;

  useEffect(() => { previousCountRef.current = orders.length; }, [orders.length]);

  return <m.section
    className="order-list"
    aria-label="可上下滚动的工单列表"
    layoutScroll={motionEnabled}
  >
    <AnimatePresence initial={false} mode="popLayout">
      {orders.map((order, index) => {
        const localMeta = localMetaById[order.woHeaderId];
        const isSelected = selectedIds.has(order.id);
        const enterDelay = Math.min(index, 6) * 0.018;
        return <m.article
          className={`order-card ${isSelected ? "selected" : ""} ${localMeta?.pinned ? "locally-pinned" : ""}`}
          key={orderMotionKey(order)}
          layout={motionEnabled ? "position" : false}
          layoutDependency={motionEnabled ? orderSequence : undefined}
          initial={motionEnabled ? { opacity: 0, y: 6 } : false}
          animate={motionEnabled ? { opacity: 1, y: 0 } : undefined}
          exit={motionEnabled ? { opacity: 0, y: -4, transition: { duration: 0.12 } } : undefined}
          transition={motionEnabled ? {
            layout: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 0.16, delay: enterDelay },
            y: { duration: 0.18, delay: enterDelay },
          } : undefined}
        >
          <button className="order-main" onClick={() => onDetail(order)}>
            <div className="order-line">
              <span className="order-id-line">
                <span className="order-id">{order.id}</span>
                {localMeta && <span className="local-order-flags">
                  {localMeta.pinned ? <Icon name="pin" size={10} /> : null}
                  {localMeta.favorite ? <Icon name="star" size={10} /> : null}
                  {localMeta.appointmentAt ? <Icon name="appointment" size={10} /> : null}
                  {localMeta.note ? <Icon name="note" size={10} /> : null}
                </span>}
              </span>
              <StatusBadge status={order.status} />
            </div>
            <div className="order-title">{order.resident}<span>{order.unit}</span></div>
            <div className="order-meta">
              <span>{order.address}</span>
              {order.time === "待安排" ? <span className={`order-favorite-badge ${localMeta?.favorite ? "is-favorite" : ""}`}><Icon name="star" size={11} />{localMeta?.favorite ? "已收藏" : "未收藏"}</span> : <span><Icon name="clock" size={13} />{order.time}</span>}
            </div>
          </button>
          {selectable && <button className="select-control" onClick={() => onToggle?.(order.id)} aria-label={`选择${order.id}`}>
            <span>{isSelected && <Icon name="check" size={15} />}</span>
          </button>}
        </m.article>;
      })}
      {!orders.length && <m.p
        className="empty-hint"
        key="__empty__"
        initial={motionEnabled ? { opacity: 0, y: 4 } : false}
        animate={motionEnabled ? { opacity: 1, y: 0 } : undefined}
        exit={motionEnabled ? { opacity: 0 } : undefined}
      >没有匹配的工单</m.p>}
    </AnimatePresence>
  </m.section>;
}
