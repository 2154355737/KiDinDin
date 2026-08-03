import {
  fetchWorkOrderNailInfo,
  saveWorkOrderAct,
  type WorkOrderNailInfo,
} from "./workOrderApi";
import {
  VACANT_ROOM_ACT_SET_ID,
  VACANT_ROOM_FILL_TEMPLATE,
  type VacantRoomFillTemplateLine,
} from "./vacantRoomFillTemplate";
import type { WorkOrder } from "../types/workOrder";

const PROTECTED_DYNAMIC_CODES = new Set([
  "AQKXXBH01",
  "BJXX0001",
  "isRecording",
]);

const LINES_WITHOUT_HEADER_ID = new Set([
  "SFYCNL0001",
  "SFYRSQ0001",
  "SFYZJ00001",
  "TS00000003",
  "TS00000004",
  "TS00000005",
]);

type WorkOrderLine = VacantRoomFillTemplateLine & {
  woHeaderId?: string;
};

type VacantRoomFillPayload = {
  tcisWoHeaderDto: {
    woHeaderId: string;
    woYear: number;
  };
  tcisWoLineDtoList: WorkOrderLine[];
};

export type VacantRoomFillPreview = {
  actSetId: string;
  existingFieldCount: number;
  lineCount: number;
  prefillCount: number;
  preservedFieldCount: number;
  woHeaderId: string;
  woYear: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function meaningful(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.some(meaningful);
  if (typeof value === "object") return Object.values(record(value)).some(meaningful);
  return true;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertVacantPendingOrder(order: WorkOrder) {
  if (
    order.backendStatusCode !== "20" ||
    !order.resident.includes("需首检")
  ) {
    throw new Error("仅允许预存待处理的需首检工单");
  }
}

function nailParts(nail: WorkOrderNailInfo) {
  const actSet = record(nail.tcisWoActSetDto);
  const workOrder = record(nail.tcisWorkOrderDto);
  const header = record(workOrder.tcisWoHeaderDto);
  const lines = Array.isArray(workOrder.tcisWoLineDtoList)
    ? workOrder.tcisWoLineDtoList.map(record)
    : [];
  return { actSet, header, lines };
}

function currentLineHasValue(line: Record<string, unknown>) {
  return meaningful(line.attrVal) || meaningful(line.attrDetail);
}

function preparePayload(
  order: WorkOrder,
  nail: WorkOrderNailInfo,
): { payload: VacantRoomFillPayload; preview: VacantRoomFillPreview } {
  assertVacantPendingOrder(order);
  const { actSet, header, lines: currentLines } = nailParts(nail);
  const actSetId = text(actSet.actSetId);
  if (actSetId !== VACANT_ROOM_ACT_SET_ID) {
    throw new Error(`表单方案不匹配，已安全跳过（${actSetId || "未知方案"}）`);
  }

  const woHeaderId = text(header.woHeaderId);
  const woYear = Number(header.woYear);
  if (!woHeaderId || woHeaderId !== order.woHeaderId) {
    throw new Error("表单返回的工单 ID 与目标工单不一致");
  }
  if (!Number.isInteger(woYear) || woYear < 2020 || woYear > 2100) {
    throw new Error("表单返回的工单年份无效");
  }

  const templateCodes = new Set(
    VACANT_ROOM_FILL_TEMPLATE.map((line) => line.attrCode),
  );
  if (templateCodes.size !== VACANT_ROOM_FILL_TEMPLATE.length) {
    throw new Error("空房预填模板包含重复字段");
  }

  const currentByCode = new Map<string, Record<string, unknown>>();
  for (const line of currentLines) {
    const code = text(line.attrCode);
    if (code) currentByCode.set(code, line);
  }

  let prefillCount = 0;
  let preservedFieldCount = 0;
  const mergedLines: WorkOrderLine[] = VACANT_ROOM_FILL_TEMPLATE.map(
    (templateLine) => {
      const current = currentByCode.get(templateLine.attrCode);
      const preserveCurrent = Boolean(
        current &&
          (PROTECTED_DYNAMIC_CODES.has(templateLine.attrCode) ||
            currentLineHasValue(current)),
      );
      if (preserveCurrent) preservedFieldCount += 1;
      if (
        !preserveCurrent &&
        (meaningful(templateLine.attrVal) || meaningful(templateLine.attrDetail))
      ) {
        prefillCount += 1;
      }
      const source = preserveCurrent ? current! : templateLine;
      const merged: WorkOrderLine = {
        attrCode: templateLine.attrCode,
        attrVal: clone(source.attrVal ?? ""),
        attrDetail: clone(
          Object.prototype.hasOwnProperty.call(source, "attrDetail")
            ? (source.attrDetail as Record<string, unknown> | null)
            : templateLine.attrDetail,
        ),
      };
      if (!LINES_WITHOUT_HEADER_ID.has(templateLine.attrCode)) {
        merged.woHeaderId = woHeaderId;
      }
      return merged;
    },
  );

  for (const current of currentLines) {
    const code = text(current.attrCode);
    if (!code || templateCodes.has(code) || !currentLineHasValue(current)) continue;
    mergedLines.push({
      attrCode: code,
      attrVal: clone(current.attrVal ?? ""),
      attrDetail: clone(record(current.attrDetail)),
      woHeaderId,
    });
    preservedFieldCount += 1;
  }

  const meterDetail = record(currentByCode.get("BJXX0001")?.attrDetail);
  for (const [code, detailCode] of [
    ["BZM0000001", "BZM0000001"],
    ["SYJE000002", "SYJE000002"],
  ] as const) {
    const value = text(meterDetail[detailCode]);
    if (!value) continue;
    const current = currentByCode.get(code);
    if (current && currentLineHasValue(current)) continue;
    const line = mergedLines.find((item) => item.attrCode === code);
    if (line) line.attrVal = value;
  }

  return {
    payload: {
      tcisWoHeaderDto: { woHeaderId, woYear },
      tcisWoLineDtoList: mergedLines,
    },
    preview: {
      actSetId,
      existingFieldCount: currentLines.filter(currentLineHasValue).length,
      lineCount: mergedLines.length,
      prefillCount,
      preservedFieldCount,
      woHeaderId,
      woYear,
    },
  };
}

export async function inspectVacantRoomFill(
  order: WorkOrder,
): Promise<VacantRoomFillPreview> {
  const response = await fetchWorkOrderNailInfo(order.woHeaderId);
  return preparePayload(order, response.data).preview;
}

export async function saveVacantRoomFill(
  order: WorkOrder,
): Promise<VacantRoomFillPreview> {
  const response = await fetchWorkOrderNailInfo(order.woHeaderId);
  const prepared = preparePayload(order, response.data);
  if (prepared.preview.prefillCount === 0) return prepared.preview;
  const saved = await saveWorkOrderAct(prepared.payload);
  if (text(saved.data) !== order.woHeaderId) {
    throw new Error("预存响应未返回目标工单 ID");
  }
  return prepared.preview;
}
