import type { WorkOrder } from "../types/workOrder";

// 真实数据由 CIS 原生请求层加载；保留空导出以兼容旧页面引用。
export const initialOrders: WorkOrder[] = [];

export const historyPhotos = ["历史现场 · 2026-07-03", "历史现场 · 2026-06-28", "历史现场 · 2026-06-18"];
export const libraryPhotos = ["楼道远景", "单元门", "门口环境", "电梯厅"];
