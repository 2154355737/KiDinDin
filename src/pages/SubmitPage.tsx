import { AnimatePresence, m } from "framer-motion";
import type { BatchSubmitMode, WorkOrder } from "../types/workOrder";
import { DatePicker } from "../components/DatePicker";
import { Icon } from "../components/Icon";
import { WorkOrderList } from "../components/WorkOrderList";
import { FilterButton } from "../components/Navigation";
import { WorkflowSteps } from "../components/WorkflowSteps";

export function SubmitPage({ orders, selected, mode, date, onDateChange, onBack, onFilter, onToggle, onToggleAll, onDetail, onPrepare }: { orders: WorkOrder[]; selected: string[]; mode: BatchSubmitMode; date: string; onDateChange: (value: string) => void; onBack: () => void; onFilter: () => void; onToggle: (id: string) => void; onToggleAll: () => void; onDetail: (order: WorkOrder) => void; onPrepare: () => void }) {
  const selectedInView = orders.filter((order) => selected.includes(order.id)).length;
  const modeLabel = mode === "historical" ? "历史到访不遇" : mode === "all-manual" ? "全手动上传" : "手动图片提交";
  return <><header className="topbar"><div><p className="eyebrow">步骤 2 · {modeLabel}</p><h1>选择提交工单</h1></div><div className="topbar-actions"><button className="text-button" onClick={onBack}>上一步</button><FilterButton onClick={onFilter} /><DatePicker value={date} onChange={onDateChange} /></div></header><WorkflowSteps current={2} /><section className="summary-strip submit-summary"><span><b>{selected.length}</b> 单已选</span><span className="summary-dot" /><span>可继续勾选</span><button className="select-all" onClick={onToggleAll}>{orders.length > 0 && selectedInView === orders.length ? "取消全选" : "一键全选"}</button></section><WorkOrderList orders={orders} selected={selected} onToggle={onToggle} onDetail={onDetail} /><AnimatePresence initial={false}>{selected.length > 0 && <m.button
    type="button"
    className="submit-fab"
    key="submit-fab"
    initial={{ opacity: 0, scale: 0.82, y: 10 }}
    animate={{ opacity: 1, scale: 1, y: 0 }}
    exit={{ opacity: 0, scale: 0.86, y: 8 }}
    whileTap={{ scale: 0.92 }}
    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    onClick={onPrepare}
    aria-label={`继续准备 ${selected.length} 个工单`}
  ><Icon name="send" size={23} /><span>{selected.length}</span></m.button>}</AnimatePresence></>;
}
