export type Screen = "orders" | "mode" | "select" | "prepare" | "confirm" | "running" | "records" | "local-orders" | "appointments" | "log-audit" | "vacant-room" | "vacant-room-fill" | "all-work-orders" | "settings" | "visit-verify";
export type MainTab = "home" | "stats" | "more";
export type OrderStatus = "待处理" | "处理中" | "已完成" | "已结束" | "待提交" | "关闭失败" | "日志失败" | "未知";
export type WorkOrderStatusFilter = "all" | "20" | "30" | "done" | "60";
export type ThemeId = "light" | "dark";
export type ThemeMode = "system" | "manual";
export type AccentId = "sky" | "pink" | "green" | "purple" | "orange";
export type AccentMode = "schedule" | "manual";
export type AppearanceSettings = {
  accentMode: AccentMode;
  manualAccent: AccentId;
  manualTheme: ThemeId;
  themeMode: ThemeMode;
};
export type DrawerKind = "detail" | "gallery" | "settings";

export type WorkOrder = {
  id: string;
  backendStatusCode: string;
  building: string;
  unitNumber: string;
  floorNumber: string;
  woHeaderId: string;
  woNumber: string;
  resident: string;
  unit: string;
  address: string;
  time: string;
  status: OrderStatus;
  historicalPhoto?: string;
  libraryPhoto?: string;
  raw?: Record<string, unknown>;
  searchText: string;
};

export const workOrderStatusOptions: Array<{ label: string; value: WorkOrderStatusFilter }> = [
  { label: "全部", value: "all" },
  { label: "待处理", value: "20" },
  { label: "处理中", value: "30" },
  { label: "已完成", value: "done" },
  { label: "已结束", value: "60" },
];

export function getWorkOrderStatus(statusCode: string | number): OrderStatus {
  switch (String(statusCode)) {
    case "20": return "待处理";
    case "30": return "处理中";
    case "40":
    case "50": return "已完成";
    case "60": return "已结束";
    default: return "未知";
  }
}

export function matchesWorkOrderStatus(statusCode: string | number, filter: WorkOrderStatusFilter) {
  const code = String(statusCode);
  if (filter === "all") return true;
  if (filter === "done") return code === "40" || code === "50";
  return code === filter;
}
