export type Screen = "orders" | "prepare" | "confirm" | "running" | "records";
export type MainTab = "home" | "stats" | "submit";
export type OrderStatus = "待准备" | "待提交" | "成功" | "关闭失败" | "日志失败";
export type Theme = "system" | "light" | "dark";
export type DrawerKind = "detail" | "gallery" | "settings";

export type WorkOrder = {
  id: string;
  resident: string;
  unit: string;
  address: string;
  time: string;
  status: OrderStatus;
  historicalPhoto?: string;
  libraryPhoto?: string;
};
