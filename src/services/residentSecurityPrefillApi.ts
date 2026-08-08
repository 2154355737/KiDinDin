import {
  fetchSecurityCheckPreview,
  fetchHistoricalWorkOrders,
  fetchWorkOrderNailInfo,
  saveWorkOrderAct,
  type SecurityCheckPreview,
  type WorkOrderNailInfo,
} from "./workOrderApi";
import {
  VACANT_ROOM_ACT_SET_ID,
  VACANT_ROOM_FILL_TEMPLATE,
  WORK_ORDER_ACT_LINES_WITHOUT_HEADER_ID,
  type VacantRoomFillTemplateLine,
} from "./vacantRoomFillTemplate";
import type { WorkOrder } from "../types/workOrder";

const RESIDENT_SECURITY_SET_CODE = "JMAJ000001";
const RESIDENT_SECURITY_SET_NAME = "居民安检";
const RESIDENT_SECURITY_ORDER_NAME = "居民安检单";
const RESIDENT_SECURITY_MAIN_TYPE = "40";
const RESIDENT_SECURITY_MAIN_TYPE_NAME = "安检";
const RESIDENT_SECURITY_DETAIL_TYPE = "401";
const RESIDENT_SECURITY_DETAIL_TYPE_NAME = "居民安检";
const COMPLETED_STATUS_CODE = "50";

const COPYABLE_ATTRIBUTE_TYPES = new Set(["50", "60"]);
const INPUT_ATTRIBUTE_TYPES = new Set(["10", "20", "30", "80"]);
const PROTECTED_ROOT_CODES = new Set([
  "AQKXXBH01",
  "BJXX0001",
  "isRecording",
]);
const LINES_WITHOUT_HEADER_ID = new Set<string>(
  WORK_ORDER_ACT_LINES_WITHOUT_HEADER_ID,
);

type DeviceGroupConfig = {
  itemCode: string;
  label: string;
  listCode: string;
};

const DEVICE_GROUPS: Record<string, DeviceGroupConfig> = {
  TS00000003: {
    itemCode: "AJZJ000001",
    label: "灶具",
    listCode: "AJZJ000001List",
  },
  TS00000004: {
    itemCode: "RSQ0000002",
    label: "热水器",
    listCode: "RSQ0000002List",
  },
  TS00000005: {
    itemCode: "CNL0000003",
    label: "采暖炉",
    listCode: "CNL0000003List",
  },
};

const DEVICE_STRUCTURAL_KEYS = new Set([
  "avatarKey",
  "deviceId",
  "deviceNumber",
  "deviceSourceInformation",
  "display",
  "flag",
  "id",
  "label",
  "meterId",
  "statusCode",
  "title",
  "value",
]);

type WorkOrderLine = {
  attrCode?: unknown;
  attrVal?: unknown;
  attrDetail?: unknown;
  woHeaderId?: unknown;
  [key: string]: unknown;
};

type PreparedLine = VacantRoomFillTemplateLine & {
  woHeaderId?: string;
};

type WorkOrderActPayload = {
  tcisWoHeaderDto: {
    woHeaderId: string;
    woYear: number;
  };
  tcisWoLineDtoList: PreparedLine[];
};

type AttributeDefinition = {
  attrType: string;
  flexSetCode: string;
};

type NailParts = {
  actSet: Record<string, unknown>;
  definitions: Map<string, AttributeDefinition>;
  header: Record<string, unknown>;
  lines: WorkOrderLine[];
};

type PreparedPrefill = {
  payload: WorkOrderActPayload;
  preview: ResidentSecurityPrefillPreview;
};

export type ResidentSecurityPrefillPreview = {
  actSetId: string;
  existingFieldCount: number;
  excludedFieldCount: number;
  excludedInputCount: number;
  excludedPhotoCount: number;
  historyCompletedAt: string;
  historyWoHeaderId: string;
  historyWoNumber: string;
  historyYear: number;
  hazardMessage: string;
  hazardSource: "current" | "history" | "unavailable";
  hazardStatus: "clear" | "danger" | "unknown";
  hazards: ResidentSecurityHazard[];
  lineCount: number;
  prefillCount: number;
  preservedChoiceCount: number;
  woHeaderId: string;
  woYear: number;
};

export type ResidentSecurityHazard = {
  actCode: string;
  checkLevel: string;
  checkResultName: string;
  correctiveSuggestion: string;
  hint: string;
  order: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : 0;
}

function meaningful(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.some(meaningful);
  if (typeof value === "object") return Object.values(record(value)).some(meaningful);
  return true;
}

function booleanChoice(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
}

function shouldCopyHistoryChoice(
  code: string,
  currentValue: unknown,
  historyValue: unknown,
  definitions: Map<string, AttributeDefinition>,
) {
  if (!meaningful(currentValue)) return true;
  if (definitions.get(code)?.attrType !== "60") return false;
  // editAct serializes untouched switches as false, so a prior true must win.
  return booleanChoice(currentValue) === false && booleanChoice(historyValue) === true;
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function blankLike(value: unknown): unknown {
  if (Array.isArray(value)) return [];
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(record(value)).map((key) => [key, blankLike(record(value)[key])]),
    );
  }
  return "";
}

function lineHasValue(line: WorkOrderLine) {
  return meaningful(line.attrVal) || meaningful(line.attrDetail);
}

function attributeDefinitions(actSet: Record<string, unknown>) {
  const definitions = new Map<string, AttributeDefinition>();
  for (const setLineValue of array(actSet.line)) {
    const setLine = record(setLineValue);
    const group = record(setLine.tcisWoActGroupDto);
    for (const groupLineValue of array(group.line)) {
      const groupLine = record(groupLineValue);
      const attribute = record(groupLine.tcisWoAttribute);
      const code = text(groupLine.attrCode) || text(attribute.attrCode);
      if (!code) continue;
      definitions.set(code, {
        attrType: text(attribute.attrType),
        flexSetCode: text(attribute.flexSetCode),
      });
    }
  }
  return definitions;
}

function nailParts(nail: WorkOrderNailInfo): NailParts {
  const actSet = record(nail.tcisWoActSetDto);
  const workOrder = record(nail.tcisWorkOrderDto);
  const header = record(workOrder.tcisWoHeaderDto);
  const lines = array(workOrder.tcisWoLineDtoList).map(
    (line) => record(line) as WorkOrderLine,
  );
  return {
    actSet,
    definitions: attributeDefinitions(actSet),
    header,
    lines,
  };
}

function userinfoId(header: Record<string, unknown>) {
  return text(header.userinfoId) || text(record(header.userinfo).userInfoId);
}

function supplyPointId(header: Record<string, unknown>) {
  const address = record(header.addressDetail);
  return (
    text(header.supplyPointId) ||
    text(header.supplypointId) ||
    text(address.supplyPointId)
  );
}

function assertOptionalName(value: unknown, expected: string, label: string) {
  const actual = text(value);
  if (actual && actual !== expected) {
    throw new Error(`${label}不匹配（${actual}）`);
  }
}

function assertResidentSecurityHeader(
  header: Record<string, unknown>,
  expectedStatus: string,
) {
  if (text(header.statusCode) !== expectedStatus) {
    throw new Error(
      expectedStatus === "20"
        ? "目标工单已不是待处理状态"
        : "历史工单不是已完成状态",
    );
  }
  if (
    text(header.woMainType) !== RESIDENT_SECURITY_MAIN_TYPE ||
    text(header.woDetailType) !== RESIDENT_SECURITY_DETAIL_TYPE
  ) {
    throw new Error("工单类型不是安检 / 居民安检");
  }
  assertOptionalName(header.woName, RESIDENT_SECURITY_ORDER_NAME, "工单名称");
  assertOptionalName(
    header.woMainTypeName,
    RESIDENT_SECURITY_MAIN_TYPE_NAME,
    "工单主类型",
  );
  assertOptionalName(
    header.woDetailTypeName,
    RESIDENT_SECURITY_DETAIL_TYPE_NAME,
    "工单明细类型",
  );
}

function assertResidentSecurityActSet(actSet: Record<string, unknown>) {
  const actSetId = text(actSet.actSetId);
  if (
    actSetId !== VACANT_ROOM_ACT_SET_ID ||
    text(actSet.setCode) !== RESIDENT_SECURITY_SET_CODE ||
    text(actSet.setName) !== RESIDENT_SECURITY_SET_NAME
  ) {
    throw new Error(`居民安检表单方案不匹配（${actSetId || "未知方案"}）`);
  }
  return actSetId;
}

function previousYearRange(year: number) {
  return {
    start: `${year}-01-01 00:00:00`,
    end: `${year}-12-31 23:59:59`,
  };
}

function timestamp(value: unknown) {
  const parsed = Date.parse(text(value).replace(/-/g, "/"));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizedHazards(preview: SecurityCheckPreview) {
  const table = preview.xmlMapIn?.tables?.table;
  const rows = Array.isArray(table) ? table : table ? [table] : [];
  return rows
    .filter(
      (item) =>
        Boolean(text(item.actCode)) ||
        Boolean(text(item.hint)) ||
        Boolean(text(item.checkResultName)),
    )
    .map((item, index): ResidentSecurityHazard => ({
      actCode: text(item.actCode),
      checkLevel: text(item.checkLevel),
      checkResultName: text(item.checkResultName),
      correctiveSuggestion: text(item.correctiveSuggestion),
      hint: text(item.hint) || text(item.actCode) || `隐患 ${index + 1}`,
      order: integer(item.order) || index + 1,
    }))
    .sort((left, right) => left.order - right.order);
}

async function withSecurityCheckPreview(
  preview: ResidentSecurityPrefillPreview,
  woHeaderId: string,
  woYear: number,
  source: "current" | "history",
) {
  try {
    const response = await fetchSecurityCheckPreview(woHeaderId, woYear);
    const hazards = normalizedHazards(response.data);
    const hasDanger = text(response.data.xmlMapIn?.hasDanger).toUpperCase();
    const hazardStatus =
      hasDanger === "Y" || hazards.length > 0
        ? "danger"
        : hasDanger === "N"
          ? "clear"
          : "unknown";
    return {
      ...preview,
      hazardMessage:
        hazardStatus === "danger"
          ? `识别到 ${hazards.length} 项隐患`
          : hazardStatus === "clear"
            ? "未识别到已勾选隐患"
            : "接口未返回明确的隐患状态",
      hazardSource: source,
      hazardStatus,
      hazards,
    } satisfies ResidentSecurityPrefillPreview;
  } catch (error) {
    return {
      ...preview,
      hazardMessage: `隐患摘要读取失败：${error instanceof Error ? error.message : "未知错误"}`,
      hazardSource: "unavailable",
      hazardStatus: "unknown",
      hazards: [],
    } satisfies ResidentSecurityPrefillPreview;
  }
}

function exactHistoryCandidate(
  candidate: Record<string, unknown>,
  historyYear: number,
  currentUserinfoId: string,
  currentSupplyPointId: string,
) {
  return (
    integer(candidate.woYear) === historyYear &&
    text(candidate.woName) === RESIDENT_SECURITY_ORDER_NAME &&
    text(candidate.woMainType) === RESIDENT_SECURITY_MAIN_TYPE &&
    text(candidate.woMainTypeName) === RESIDENT_SECURITY_MAIN_TYPE_NAME &&
    text(candidate.woDetailType) === RESIDENT_SECURITY_DETAIL_TYPE &&
    text(candidate.woDetailTypeName) === RESIDENT_SECURITY_DETAIL_TYPE_NAME &&
    text(candidate.statusCode) === COMPLETED_STATUS_CODE &&
    Boolean(text(candidate.actualEndDate)) &&
    userinfoId(candidate) === currentUserinfoId &&
    supplyPointId(candidate) === currentSupplyPointId
  );
}

function compatibleChoice(
  code: string,
  currentDefinitions: Map<string, AttributeDefinition>,
  historyDefinitions: Map<string, AttributeDefinition>,
) {
  const current = currentDefinitions.get(code);
  const history = historyDefinitions.get(code);
  if (
    !current ||
    !history ||
    !COPYABLE_ATTRIBUTE_TYPES.has(current.attrType) ||
    current.attrType !== history.attrType
  ) {
    return false;
  }
  return current.flexSetCode === history.flexSetCode;
}

function exclusionKind(
  parentCode: string,
  code: string,
  definitions: Map<string, AttributeDefinition>,
) {
  if (PROTECTED_ROOT_CODES.has(parentCode)) return "protected" as const;
  const attrType = definitions.get(code)?.attrType ?? "";
  if (/PZ$/i.test(code) || attrType === "70") return "photo" as const;
  if (INPUT_ATTRIBUTE_TYPES.has(attrType)) return "input" as const;
  return "unsupported" as const;
}

function blankTemplateDetail(template: VacantRoomFillTemplateLine) {
  if (template.attrDetail === null) return null;
  return blankLike(template.attrDetail) as Record<string, unknown>;
}

function mergeCurrentDetail(
  templateDetail: Record<string, unknown> | null,
  currentDetail: unknown,
) {
  if (!currentDetail || typeof currentDetail !== "object" || Array.isArray(currentDetail)) {
    return templateDetail;
  }
  return {
    ...(templateDetail ?? {}),
    ...clone(record(currentDetail)),
  };
}

type DeviceMergeResult = {
  attrDetail: Record<string, unknown>;
  attrVal: unknown;
  excludedInputCount: number;
  excludedOtherCount: number;
  excludedPhotoCount: number;
  prefillCount: number;
  preservedChoiceCount: number;
};

function freshDeviceItem(
  woHeaderId: string,
  lineCode: string,
  config: DeviceGroupConfig,
  index: number,
) {
  const displayIndex = index + 1;
  const title = `${config.label}${displayIndex}`;
  const avatarSeed = woHeaderId.replace(/\D/g, "").slice(-10).padStart(10, "0");
  return {
    avatarKey: `${avatarSeed}${String(displayIndex).padStart(3, "0")}`,
    deviceId: "",
    deviceNumber: "",
    deviceSourceInformation: "20",
    display: "true",
    flag: lineCode,
    id: config.itemCode,
    label: title,
    meterId: "",
    statusCode: "20",
    title,
    value: title,
  };
}

function mergeHistoricalDevices(
  woHeaderId: string,
  lineCode: string,
  config: DeviceGroupConfig,
  currentAttrVal: unknown,
  currentAttrDetail: Record<string, unknown> | null,
  historyLine: WorkOrderLine | undefined,
  currentDefinitions: Map<string, AttributeDefinition>,
  historyDefinitions: Map<string, AttributeDefinition>,
): DeviceMergeResult {
  const currentDetail = record(currentAttrDetail);
  const historyDetail = record(historyLine?.attrDetail);
  const currentItems = array(currentDetail[config.listCode]).map(record);
  const historyItems = array(historyDetail[config.listCode]).map(record);
  const result: DeviceMergeResult = {
    attrDetail: currentDetail,
    attrVal: currentAttrVal,
    excludedInputCount: 0,
    excludedOtherCount: 0,
    excludedPhotoCount: 0,
    prefillCount: 0,
    preservedChoiceCount: 0,
  };
  if (historyItems.length === 0) {
    result.attrVal =
      currentItems.length > 0
        ? String(currentItems.length)
        : meaningful(currentAttrVal)
          ? currentAttrVal
          : "0";
    return result;
  }

  const mergedItems: Record<string, unknown>[] = [];
  const itemCount = Math.max(currentItems.length, historyItems.length);
  for (let index = 0; index < itemCount; index += 1) {
    const currentItem = currentItems[index];
    const historyItem = historyItems[index];
    if (!historyItem) {
      mergedItems.push(clone(currentItem));
      continue;
    }

    const mergedItem: Record<string, unknown> = currentItem
      ? clone(currentItem)
      : freshDeviceItem(woHeaderId, lineCode, config, index);
    for (const [detailCode, historyValue] of Object.entries(historyItem)) {
      if (DEVICE_STRUCTURAL_KEYS.has(detailCode)) continue;
      if (
        compatibleChoice(
          detailCode,
          currentDefinitions,
          historyDefinitions,
        )
      ) {
        if (
          meaningful(historyValue) &&
          shouldCopyHistoryChoice(
            detailCode,
            mergedItem[detailCode],
            historyValue,
            currentDefinitions,
          )
        ) {
          mergedItem[detailCode] = clone(historyValue);
          result.prefillCount += 1;
        } else if (meaningful(mergedItem[detailCode])) {
          result.preservedChoiceCount += 1;
        } else if (!(detailCode in mergedItem)) {
          mergedItem[detailCode] = blankLike(historyValue);
        }
        continue;
      }

      if (!(detailCode in mergedItem)) {
        mergedItem[detailCode] = blankLike(historyValue);
      }
      if (!meaningful(historyValue)) continue;
      const kind = exclusionKind(lineCode, detailCode, historyDefinitions);
      if (kind === "photo") result.excludedPhotoCount += 1;
      else if (kind === "input") result.excludedInputCount += 1;
      else result.excludedOtherCount += 1;
    }
    mergedItems.push(mergedItem);
  }

  result.attrDetail = {
    ...currentDetail,
    [config.listCode]: mergedItems,
  };
  result.attrVal = String(mergedItems.length);
  return result;
}

export function prepareResidentSecurityPrefillPayload(
  order: WorkOrder,
  currentNail: WorkOrderNailInfo,
  historyNail: WorkOrderNailInfo,
  historyCandidate: Record<string, unknown>,
): PreparedPrefill {
  const current = nailParts(currentNail);
  const history = nailParts(historyNail);
  assertResidentSecurityHeader(current.header, "20");
  assertResidentSecurityHeader(history.header, COMPLETED_STATUS_CODE);
  const actSetId = assertResidentSecurityActSet(current.actSet);
  const historyActSetId = assertResidentSecurityActSet(history.actSet);
  if (historyActSetId !== actSetId) {
    throw new Error("去年与今年的居民安检表单方案不一致");
  }

  const woHeaderId = text(current.header.woHeaderId);
  const woYear = integer(current.header.woYear);
  const historyYear = woYear - 1;
  if (!woHeaderId || woHeaderId !== order.woHeaderId) {
    throw new Error("表单返回的工单 ID 与目标工单不一致");
  }
  if (woYear < 2021 || woYear > 2100) {
    throw new Error("目标工单年份无效");
  }
  if (integer(history.header.woYear) !== historyYear) {
    throw new Error(`历史工单不是 ${historyYear} 年工单`);
  }
  const historyWoHeaderId = text(history.header.woHeaderId);
  if (
    !historyWoHeaderId ||
    historyWoHeaderId !== text(historyCandidate.woHeaderId)
  ) {
    throw new Error("历史表单返回的工单 ID 与历史列表不一致");
  }
  if (!text(history.header.actualEndDate)) {
    throw new Error("历史工单缺少实际完成时间");
  }
  if (
    userinfoId(current.header) !== userinfoId(history.header) ||
    supplyPointId(current.header) !== supplyPointId(history.header)
  ) {
    throw new Error("历史工单与目标工单不是同一用户或供气点");
  }

  const templateCodes = new Set(
    VACANT_ROOM_FILL_TEMPLATE.map((line) => line.attrCode),
  );
  if (templateCodes.size !== VACANT_ROOM_FILL_TEMPLATE.length) {
    throw new Error("居民安检请求模板包含重复字段");
  }

  const currentByCode = new Map<string, WorkOrderLine>();
  for (const line of current.lines) {
    const code = text(line.attrCode);
    if (code) currentByCode.set(code, line);
  }
  const historyByCode = new Map<string, WorkOrderLine>();
  for (const line of history.lines) {
    const code = text(line.attrCode);
    if (code) historyByCode.set(code, line);
  }

  let prefillCount = 0;
  let preservedChoiceCount = 0;
  let excludedInputCount = 0;
  let excludedPhotoCount = 0;
  let excludedOtherCount = 0;

  const mergedLines: PreparedLine[] = VACANT_ROOM_FILL_TEMPLATE.map(
    (templateLine) => {
      const code = templateLine.attrCode;
      const currentLine = currentByCode.get(code);
      const historyLine = historyByCode.get(code);
      let attrVal: unknown = currentLine
        ? clone(currentLine.attrVal ?? "")
        : "";
      let attrDetail = mergeCurrentDetail(
        blankTemplateDetail(templateLine),
        currentLine?.attrDetail,
      );
      const deviceGroup = DEVICE_GROUPS[code];

      if (!deviceGroup && historyLine && meaningful(historyLine.attrVal)) {
        if (
          !PROTECTED_ROOT_CODES.has(code) &&
          compatibleChoice(code, current.definitions, history.definitions)
        ) {
          if (
            shouldCopyHistoryChoice(
              code,
              attrVal,
              historyLine.attrVal,
              current.definitions,
            )
          ) {
            attrVal = clone(historyLine.attrVal);
            prefillCount += 1;
          } else preservedChoiceCount += 1;
        } else {
          const kind = exclusionKind(code, code, history.definitions);
          if (kind === "photo") excludedPhotoCount += 1;
          else if (kind === "input") excludedInputCount += 1;
          else excludedOtherCount += 1;
        }
      }

      if (deviceGroup) {
        const deviceMerge = mergeHistoricalDevices(
          woHeaderId,
          code,
          deviceGroup,
          attrVal,
          attrDetail,
          historyLine,
          current.definitions,
          history.definitions,
        );
        attrVal = deviceMerge.attrVal;
        attrDetail = deviceMerge.attrDetail;
        prefillCount += deviceMerge.prefillCount;
        preservedChoiceCount += deviceMerge.preservedChoiceCount;
        excludedInputCount += deviceMerge.excludedInputCount;
        excludedPhotoCount += deviceMerge.excludedPhotoCount;
        excludedOtherCount += deviceMerge.excludedOtherCount;
      } else {
        const historyDetail = record(historyLine?.attrDetail);
        for (const [detailCode, historyValue] of Object.entries(historyDetail)) {
          if (!meaningful(historyValue)) continue;
          if (
            !PROTECTED_ROOT_CODES.has(code) &&
            compatibleChoice(
              detailCode,
              current.definitions,
              history.definitions,
            )
          ) {
            const mergedDetail = record(attrDetail);
            if (
              shouldCopyHistoryChoice(
                detailCode,
                mergedDetail[detailCode],
                historyValue,
                current.definitions,
              )
            ) {
              attrDetail = {
                ...mergedDetail,
                [detailCode]: clone(historyValue),
              };
              prefillCount += 1;
            } else preservedChoiceCount += 1;
          } else {
            const kind = exclusionKind(code, detailCode, history.definitions);
            if (kind === "photo") excludedPhotoCount += 1;
            else if (kind === "input") excludedInputCount += 1;
            else excludedOtherCount += 1;
          }
        }
      }

      const merged: PreparedLine = {
        attrCode: code,
        attrVal,
        attrDetail,
      };
      if (!LINES_WITHOUT_HEADER_ID.has(code)) merged.woHeaderId = woHeaderId;
      return merged;
    },
  );

  for (const currentLine of current.lines) {
    const code = text(currentLine.attrCode);
    if (!code || templateCodes.has(code) || !lineHasValue(currentLine)) continue;
    const line: PreparedLine = {
      attrCode: code,
      attrVal: clone(currentLine.attrVal ?? ""),
      attrDetail:
        currentLine.attrDetail === null
          ? null
          : clone(record(currentLine.attrDetail)),
    };
    if (!LINES_WITHOUT_HEADER_ID.has(code)) line.woHeaderId = woHeaderId;
    mergedLines.push(line);
  }

  return {
    payload: {
      tcisWoHeaderDto: { woHeaderId, woYear },
      tcisWoLineDtoList: mergedLines,
    },
    preview: {
      actSetId,
      existingFieldCount: current.lines.filter(lineHasValue).length,
      excludedFieldCount:
        excludedInputCount + excludedPhotoCount + excludedOtherCount,
      excludedInputCount,
      excludedPhotoCount,
      historyCompletedAt:
        text(history.header.actualEndDate) || text(historyCandidate.actualEndDate),
      historyWoHeaderId,
      historyWoNumber:
        text(history.header.woNumber) || text(historyCandidate.woNumber),
      historyYear,
      hazardMessage: "尚未读取隐患摘要",
      hazardSource: "unavailable",
      hazardStatus: "unknown",
      hazards: [],
      lineCount: mergedLines.length,
      prefillCount,
      preservedChoiceCount,
      woHeaderId,
      woYear,
    },
  };
}

async function prepareResidentSecurityPrefill(
  order: WorkOrder,
  expectedHistoryWoHeaderId = "",
) {
  if (!isResidentSecurityPrefillTarget(order)) {
    throw new Error("仅允许预填待处理的居民安检工单");
  }

  const currentResponse = await fetchWorkOrderNailInfo(order.woHeaderId);
  const current = nailParts(currentResponse.data);
  assertResidentSecurityHeader(current.header, "20");
  assertResidentSecurityActSet(current.actSet);
  const woYear = integer(current.header.woYear);
  const historyYear = woYear - 1;
  const currentUserinfoId = userinfoId(current.header);
  const currentSupplyPointId = supplyPointId(current.header);
  if (!currentUserinfoId || !currentSupplyPointId) {
    throw new Error("当前工单缺少用户或供气点标识");
  }

  const historical = await fetchHistoricalWorkOrders(
    currentUserinfoId,
    50,
    20,
    previousYearRange(historyYear),
  );
  let candidates = historical
    .filter((candidate) =>
      exactHistoryCandidate(
        candidate,
        historyYear,
        currentUserinfoId,
        currentSupplyPointId,
      ),
    )
    .sort(
      (left, right) =>
        timestamp(right.actualEndDate) - timestamp(left.actualEndDate),
    );

  if (expectedHistoryWoHeaderId) {
    candidates = candidates.filter(
      (candidate) => text(candidate.woHeaderId) === expectedHistoryWoHeaderId,
    );
    if (!candidates.length) {
      throw new Error("历史来源已变化，请重新检查后再预存");
    }
  }
  if (!candidates.length) {
    throw new Error(
      `${historyYear} 年未找到同户已完成的居民安检单，不会回退到更早年份`,
    );
  }

  const failures: string[] = [];
  let alreadyFilled: PreparedPrefill | undefined;
  for (const candidate of candidates) {
    const historyWoHeaderId = text(candidate.woHeaderId);
    if (!historyWoHeaderId || historyWoHeaderId === order.woHeaderId) continue;
    try {
      const historyResponse = await fetchWorkOrderNailInfo(historyWoHeaderId);
      const prepared = prepareResidentSecurityPrefillPayload(
        order,
        currentResponse.data,
        historyResponse.data,
        candidate,
      );
      if (
        prepared.preview.prefillCount > 0 ||
        Boolean(expectedHistoryWoHeaderId)
      ) {
        return prepared;
      }
      if (prepared.preview.preservedChoiceCount > 0) {
        alreadyFilled ??= prepared;
      } else {
        failures.push(`${text(candidate.woNumber) || historyWoHeaderId} 没有可复用选项`);
      }
    } catch (error) {
      failures.push(
        error instanceof Error ? error.message : "历史安检表单检查失败",
      );
    }
  }

  if (alreadyFilled) return alreadyFilled;

  throw new Error(
    failures[failures.length - 1] ||
      `${historyYear} 年居民安检单没有可复用的真实选项`,
  );
}

export function isResidentSecurityPrefillTarget(order: WorkOrder) {
  if (
    order.backendStatusCode !== "20" ||
    order.resident.includes("需首检")
  ) {
    return false;
  }
  const raw = record(order.raw);
  const woName = text(raw.woName);
  const mainType = text(raw.woMainType);
  const mainTypeName = text(raw.woMainTypeName);
  const detailType = text(raw.woDetailType);
  const detailTypeName = text(raw.woDetailTypeName);
  if (woName && woName !== RESIDENT_SECURITY_ORDER_NAME) return false;
  if (mainType && mainType !== RESIDENT_SECURITY_MAIN_TYPE) return false;
  if (mainTypeName && mainTypeName !== RESIDENT_SECURITY_MAIN_TYPE_NAME)
    return false;
  if (detailType && detailType !== RESIDENT_SECURITY_DETAIL_TYPE) return false;
  if (detailTypeName && detailTypeName !== RESIDENT_SECURITY_DETAIL_TYPE_NAME)
    return false;
  return true;
}

export async function inspectResidentSecurityPrefill(order: WorkOrder) {
  const prepared = await prepareResidentSecurityPrefill(order);
  return withSecurityCheckPreview(
    prepared.preview,
    prepared.preview.historyWoHeaderId,
    prepared.preview.historyYear,
    "history",
  );
}

export async function saveResidentSecurityPrefill(
  order: WorkOrder,
  expectedHistoryWoHeaderId: string,
) {
  const prepared = await prepareResidentSecurityPrefill(
    order,
    expectedHistoryWoHeaderId,
  );
  if (prepared.preview.prefillCount === 0) {
    return withSecurityCheckPreview(
      prepared.preview,
      prepared.preview.woHeaderId,
      prepared.preview.woYear,
      "current",
    );
  }
  const saved = await saveWorkOrderAct(prepared.payload);
  const savedWoHeaderId = text(saved.data);
  if (!savedWoHeaderId || savedWoHeaderId !== order.woHeaderId) {
    throw new Error("预存响应未返回目标工单 ID");
  }
  return withSecurityCheckPreview(
    prepared.preview,
    savedWoHeaderId,
    prepared.payload.tcisWoHeaderDto.woYear,
    "current",
  );
}
