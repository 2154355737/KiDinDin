import type { WorkOrder } from "../types/workOrder";

export const initialOrders: WorkOrder[] = [
  { id: "AJ202607120038", resident: "张先生", unit: "2栋 1802", address: "锦江区华润二十四城 · 2栋", time: "09:00–11:00", status: "待准备" },
  { id: "AJ202607120041", resident: "李女士", unit: "8栋 1004", address: "锦江区翡翠城 · 8栋", time: "10:00–12:00", status: "待准备" },
  { id: "AJ202607120043", resident: "王先生", unit: "1栋 302", address: "成华区万科魅力之城 · 1栋", time: "13:00–15:00", status: "待准备" },
  { id: "AJ202607120047", resident: "陈女士", unit: "3栋 2401", address: "武侯区保利花园 · 3栋", time: "14:00–16:00", status: "待提交" },
  { id: "AJ202607120052", resident: "周先生", unit: "6栋 702", address: "高新区中海国际 · 6栋", time: "15:00–17:00", status: "日志失败" },
  { id: "AJ202607120057", resident: "刘女士", unit: "9栋 1103", address: "锦江区卓锦城 · 9栋", time: "15:00–17:00", status: "待准备" },
  { id: "AJ202607120061", resident: "赵先生", unit: "5栋 2602", address: "成华区首创国际城 · 5栋", time: "16:00–18:00", status: "待准备" },
  { id: "AJ202607120066", resident: "何女士", unit: "7栋 901", address: "高新区誉峰国际 · 7栋", time: "16:00–18:00", status: "待准备" },
  { id: "AJ202607120069", resident: "孙先生", unit: "11栋 603", address: "高新区朗基御今缘 · 11栋", time: "17:00–19:00", status: "待准备" },
  { id: "AJ202607120074", resident: "吴女士", unit: "4栋 1902", address: "锦江区天誉花园 · 4栋", time: "17:00–19:00", status: "待准备" },
  { id: "AJ202607120078", resident: "郑先生", unit: "12栋 1501", address: "成华区龙湖三千城 · 12栋", time: "18:00–20:00", status: "待准备" },
  { id: "AJ202607120083", resident: "冯女士", unit: "2栋 806", address: "高新区誉峰国际 · 2栋", time: "18:00–20:00", status: "待准备" },
  { id: "AJ202607120087", resident: "马先生", unit: "10栋 1205", address: "武侯区桐梓林壹号 · 10栋", time: "19:00–21:00", status: "待准备" },
  { id: "AJ202607120091", resident: "朱女士", unit: "6栋 2703", address: "锦江区东湖国际 · 6栋", time: "19:00–21:00", status: "待准备" },
  { id: "AJ202607120096", resident: "罗先生", unit: "3栋 508", address: "高新区天府新谷 · 3栋", time: "20:00–22:00", status: "待准备" },
];

export const historyPhotos = ["历史现场 · 2026-07-03", "历史现场 · 2026-06-28", "历史现场 · 2026-06-18"];
export const libraryPhotos = ["楼道远景", "单元门", "门口环境", "电梯厅"];
