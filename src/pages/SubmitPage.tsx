import type { WorkOrder } from "../types/workOrder";
import { DatePicker } from "../components/DatePicker";
import { Icon } from "../components/Icon";
import { WorkOrderList } from "../components/WorkOrderList";
import { FilterButton } from "../components/Navigation";

export function SubmitPage({ orders, selected, date, onDateChange, onFilter, onToggle, onToggleAll, onDetail, onPrepare }: { orders: WorkOrder[]; selected: string[]; date: string; onDateChange: (value: string) => void; onFilter: () => void; onToggle: (id: string) => void; onToggleAll: () => void; onDetail: (order: WorkOrder) => void; onPrepare: () => void }) {
  return <><header className="topbar"><div><p className="eyebrow">批量处理</p><h1>提交</h1></div><div className="topbar-actions"><FilterButton onClick={onFilter} /><DatePicker value={date} onChange={onDateChange} /></div></header><section className="summary-strip submit-summary"><span><b>{selected.length}</b> 单已选</span><span className="summary-dot" /><span>可继续勾选</span><button className="select-all" onClick={onToggleAll}>{selected.length === orders.length ? "取消全选" : "一键全选"}</button></section><WorkOrderList orders={orders} selected={selected} onToggle={onToggle} onDetail={onDetail} />{selected.length > 0 && <button className="submit-fab" onClick={onPrepare} aria-label={`准备并提交 ${selected.length} 个工单`}><Icon name="send" size={23} /><span>{selected.length}</span></button>}</>;
}
