import {
  fileToNativeUpload,
  nativeInvoke,
  nativeRequest,
  reportWorkOrderAuthExpired,
} from "./tauri";
import { updateUploadFileNameStatus } from "./uploadFileNameStore";

export type ApiEnvelope<T> = { code: number; msg: string | null; data: T };

export type CisAddress = {
  addressDetailed?: string | null;
  building?: string | null;
  unitsNumber?: string | null;
  floorNumber?: string | null;
  roomNumber?: string | null;
  supplyPointId?: string | number | null;
  [key: string]: unknown;
};

export type CisWorkOrder = {
  woHeaderId: string;
  woNumber: string;
  statusCode: string | number;
  userName?: string | null;
  contactPerson?: string | null;
  addressDetailed?: string | null;
  expectingDate?: string | null;
  supplypointId?: string | number | null;
  userinfoId?: string | number | null;
  building?: string | null;
  unitsNumber?: string | null;
  floorNumber?: string | null;
  roomNumber?: string | null;
  createTime?: string | null;
  updateTime?: string | null;
  woName?: string | null;
  woMainType?: string | null;
  woMainTypeName?: string | null;
  woDetailType?: string | null;
  woDetailTypeName?: string | null;
  receivingTeam?: string | null;
  receivingTeamName?: string | null;
  charegeOfPersonName?: string | null;
  contactPhone?: string | null;
  userNumber?: string | null;
  addressDetail?: CisAddress | null;
  [key: string]: unknown;
};

export type WorkOrderDetail = {
  tcisWoHeaderDto?: CisWorkOrder | null;
  tcisWoAttributeValDtoList?: unknown[] | null;
  tcisWoPartyDtoList?: unknown[] | null;
  tcisWoLineDtoList?: unknown[] | null;
  tcisWoMaterialDtoList?: unknown[] | null;
  [key: string]: unknown;
};

export type WorkOrderNailInfo = {
  tcisWoActSetDto?: Record<string, unknown> | null;
  tcisWorkOrderDto?: WorkOrderDetail | null;
  [key: string]: unknown;
};

export type WorkOrderActSavePayload = {
  tcisWoHeaderDto: {
    woHeaderId: string;
    woYear: number;
  };
  tcisWoLineDtoList: unknown[];
};

export type SecurityCheckDangerItem = {
  actCode?: string | null;
  checkLevel?: string | null;
  checkResultCode?: string | null;
  checkResultName?: string | null;
  correctiveSuggestion?: string | null;
  hint?: string | null;
  order?: string | number | null;
  [key: string]: unknown;
};

export type SecurityCheckPreview = {
  downloadFileName?: string | null;
  xdoCode?: string | null;
  xmlMapIn?: {
    completeTime?: string | null;
    hasDanger?: string | null;
    tables?: {
      table?: SecurityCheckDangerItem[] | SecurityCheckDangerItem | null;
    } | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
};

export type SupplyPointScanAddress = {
  supplypointScanId?: string | number | null;
  xz?: string | null;
  [key: string]: unknown;
};

export type UploadedFile = {
  attachId?: string | null;
  bizId?: string | null;
  fileName?: string | null;
  downloadFilePath?: string | null;
  uploadBy?: string | null;
  uploadDate?: string | null;
  [key: string]: unknown;
};

type DownloadedFile = {
  base64: string;
  mime: string;
  name: string;
};

export type ExchangeLog = {
  createTime?: string | null;
  createBy?: string | null;
  userName?: string | null;
  userNumber?: string | null;
  exchangeType?: string | null;
  content?: string | null;
  [key: string]: unknown;
};

const paths = {
  list: "/api/workorder/tcisworkorderAj/queryAjWorkOrderList",
  detail: "/api/workorder/tcisworkorder/woInfoWithAttrAndParties",
  nailInfo: "/api/workorder/tcisworkorder/queryWoInfoForNail",
  postDetail: "/api/workorder/tcisworkorder",
  simple: "/api/workorder/tcisworkorder/simple",
  edit: "/api/workorder/tcisworkorder/edit",
  editAct: "/api/workorder/tcisworkorderAj/editAct",
  securityCheckPreview: "/api/sl/tCisWoSecurityCheck/previewVo",
  userAjInfo: "/api/yhbz/bzUserInfo/detailForAj/",
  fileList: "/api/appsys/file/list",
  history: "/api/workorder/tcisworkorder/newCriteria",
  allWorkOrders: "/api/workorder/tcisworkorder/newCriteriaHandle",
  household: "/api/workorder/tcisworkorderAj/updateLastHouseholdTime",
  notify: "/api/appinterface/cem/custom/orderStatusNotify",
  close: "/api/workorder/tcisworkorder/close4SecurityCheck",
  exchange: "/api/workorder/exchange/log",
  exchangeQuery: "/api/workorder/exchange/log/query_by_wo",
} as const;

export type AllWorkOrderFilters = {
  dateCreateEnd: string;
  dateCreateStart: string;
  detailType: string;
  mainType: string;
  operatorFlag: "N";
  receivingTeam: string;
  statusCodes: string[];
};

export type AllWorkOrderPage = {
  pageIndex: number;
  pageSize: number;
  pages: number;
  records: CisWorkOrder[];
  total: number;
};

export const ALL_WORK_ORDER_ORG_ID = "1011";
export const ALL_WORK_ORDER_RECEIVING_TEAMS = [
  "10110008", "10110009", "10110010", "10110011", "10110015",
  "10110301", "10110302", "10110303", "10110304", "10110305",
  "10110306", "10110307", "10110308", "10110309", "10110310",
  "10110311", "10110312", "10110313", "10110314", "10110315",
  "10110316", "10110317", "10110319", "10110321", "10110323",
  "10110325", "10110327", "10110329", "10110331", "10110333",
  "10110336", "10110337", "10140017", "10110338",
  "PRODUCT2024112100035", "PRODUCT2024112100026", "PRODUCT2024112100028",
  "PRODUCT2024112100029", "PRODUCT2024112100030", "PRODUCT2024112100031",
  "PRODUCT2024112100032", "PRODUCT2024112100033", "PRODUCT2024112100034",
  "PRODUCT2025041400038", "PRODUCT2025041400039", "PRODUCT2025041400040",
  "PRODUCT2025041400041", "PRODUCT2025041400042", "PRODUCT2025041400043",
  "PRODUCT2025041400044", "PRODUCT2025041400045", "PRODUCT2025053000024",
  "PRODUCT2025053000025", "PRODUCT2025053000026", "PRODUCT2025053000027",
  "PRODUCT2025053000028", "PRODUCT2025053000029", "PRODUCT2025053000030",
  "PRODUCT2025053000031", "PRODUCT2025060500002",
] as const;

async function request<T>(path: string, method: string, body?: unknown): Promise<ApiEnvelope<T>> {
  const requestStartedAt = Date.now();
  const payload = await nativeRequest(path, method, body) as ApiEnvelope<T>;
  if (!payload || typeof payload !== "object" || typeof payload.code !== "number") {
    throw new Error("接口返回格式无效");
  }
  if (payload.code !== 0) {
    const error = new Error(payload.msg || `接口业务返回 ${payload.code}`);
    reportWorkOrderAuthExpired(error, {
      command: "cis_request",
      path,
      requestStartedAt,
    });
    throw error;
  }
  return payload;
}

function records<T>(data: T[] | { records?: T[] | null; list?: T[] | null; rows?: T[] | null } | null) {
  return Array.isArray(data) ? data : data?.records ?? data?.list ?? data?.rows ?? [];
}

function supportsLegacyWorkOrderDateFallback(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/401|403|未授权|登录|凭证|token/i.test(message)) return false;
  return (
    /\b(?:400|422)\b/.test(message) ||
    /createTime|请求参数|参数错误|参数校验|未知字段|必填|不能为空/i.test(message)
  );
}

export async function fetchWorkOrders(dateTime: string) {
  try {
    return await request<CisWorkOrder[]>(paths.list, "POST", {
      createTime: dateTime,
    });
  } catch (error) {
    if (!supportsLegacyWorkOrderDateFallback(error)) throw error;
    return request<CisWorkOrder[]>(paths.list, "POST", {
      expectingDate: dateTime,
    });
  }
}

function pageNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function fetchAllWorkOrders(
  filters: AllWorkOrderFilters,
  pageIndex: number,
  pageSize: number,
  sortDirection: "asc" | "desc" = "desc",
): Promise<AllWorkOrderPage> {
  const queryInfo: Record<string, unknown> = {
    statusCodeList: filters.statusCodes,
    operatorFlag: filters.operatorFlag,
    woMainType: filters.mainType,
    dateCreateStart: `${filters.dateCreateStart} 00:00:00`,
    dateCreateEnd: `${filters.dateCreateEnd} 23:59:59`,
    woDetailTypeList: filters.detailType ? [filters.detailType] : [],
    orgId: ALL_WORK_ORDER_ORG_ID,
    receivingTeams: filters.receivingTeam
      ? [filters.receivingTeam]
      : [...ALL_WORK_ORDER_RECEIVING_TEAMS],
  };

  const response = await request<{
    records?: CisWorkOrder[] | null;
    total?: string | number | null;
    pageSize?: string | number | null;
    pageIndex?: string | number | null;
    pages?: string | number | null;
  } | CisWorkOrder[] | null>(paths.allWorkOrders, "POST", {
    queryInfo,
    page: {
      pageSize,
      pageIndex,
      orders: [
        { asc: sortDirection === "asc", column: "create_time" },
        { asc: true, column: "address_detailed" },
      ],
    },
  });
  if (Array.isArray(response.data)) {
    return {
      records: response.data,
      total: response.data.length,
      pageSize,
      pageIndex,
      pages: response.data.length ? 1 : 0,
    };
  }
  const data = response.data ?? {};
  return {
    records: data.records ?? [],
    total: pageNumber(data.total, 0),
    pageSize: pageNumber(data.pageSize, pageSize),
    pageIndex: pageNumber(data.pageIndex, pageIndex),
    pages: pageNumber(data.pages, 0),
  };
}

export function fetchWorkOrderDetail(woHeaderId: string) {
  return request<WorkOrderDetail>(`${paths.detail}/${encodeURIComponent(woHeaderId)}`, "GET");
}

export function fetchWorkOrderNailInfo(woHeaderId: string) {
  return request<WorkOrderNailInfo>(`${paths.nailInfo}/${encodeURIComponent(woHeaderId)}`, "POST");
}

export function postWorkOrderForEdit(woHeaderId: string) {
  return request<WorkOrderDetail>(`${paths.postDetail}/${encodeURIComponent(woHeaderId)}`, "POST");
}

export function fetchSimpleWorkOrder(woHeaderId: string) {
  return request<WorkOrderDetail>(`${paths.simple}/${encodeURIComponent(woHeaderId)}`, "GET");
}

export function saveWorkOrderEdit(payload: WorkOrderDetail) {
  return request<WorkOrderDetail>(paths.edit, "POST", payload);
}

export function saveWorkOrderAct(payload: WorkOrderActSavePayload) {
  return request<string>(paths.editAct, "POST", payload);
}

export function fetchSecurityCheckPreview(woHeaderId: string, woYear: number) {
  return request<SecurityCheckPreview>(
    `${paths.securityCheckPreview}/${encodeURIComponent(woHeaderId)}/${encodeURIComponent(String(woYear))}`,
    "GET",
  );
}

export function fetchWorkOrderUserAjInfo(userInfoId: string, supplypointId: string) {
  const query = new URLSearchParams({ supplypointId, userInfoId });
  return request<Record<string, unknown>>(`${paths.userAjInfo}?${query}`, "POST");
}

export function fetchSupplyPointScanAddress(supplypointId: string) {
  return request<SupplyPointScanAddress | null>(
    `/api/yhbz/supplypointscanaddress/criteria/${encodeURIComponent(supplypointId)}`,
    "POST",
  );
}

export function bindSupplyPointScanAddress(
  supplypointId: string,
  url: string,
) {
  return request<SupplyPointScanAddress>(
    "/api/yhbz/supplypointscanaddress/scanAddress",
    "POST",
    { supplypointId, url },
  );
}

export async function uploadWorkOrderFiles(
  files: File[],
  bizId = "",
  options: { securityWatermark?: boolean; watermarkAddress?: string } = {},
) {
  const requestStartedAt = Date.now();
  const nativeFiles = await Promise.all(files.map(fileToNativeUpload));
  const names = nativeFiles.map((file) => file.name);
  let payload: ApiEnvelope<{ bizId: string; sysAttachList?: UploadedFile[] | null }>;
  try {
    payload = await nativeInvoke<ApiEnvelope<{ bizId: string; sysAttachList?: UploadedFile[] | null }>>(
      "cis_upload_files",
      {
        addWatermark: Boolean(options.securityWatermark),
        bizId: bizId || null,
        files: nativeFiles,
        watermarkAddress: options.watermarkAddress?.trim() || null,
      },
    );
  } catch (error) {
    void updateUploadFileNameStatus(names, "failed", error instanceof Error ? error.message : String(error)).catch(() => undefined);
    throw error;
  }
  if (payload.code !== 0) {
    const error = new Error(payload.msg || `上传业务返回 ${payload.code}`);
    void updateUploadFileNameStatus(names, "failed", error.message).catch(() => undefined);
    reportWorkOrderAuthExpired(error, {
      command: "cis_upload_files",
      path: "/api/appsys/file/upload",
      requestStartedAt,
    });
    throw error;
  }
  if (!payload.data?.bizId) {
    const error = new Error("上传响应缺少 data.bizId");
    void updateUploadFileNameStatus(names, "failed", error.message).catch(() => undefined);
    throw error;
  }
  void updateUploadFileNameStatus(names, "uploaded").catch(() => undefined);
  return payload;
}

export async function fetchWorkOrderFiles(bizId: string) {
  const response = await request<UploadedFile[] | { sysAttachList?: UploadedFile[] | null; records?: UploadedFile[] | null; list?: UploadedFile[] | null } | null>(
    `${paths.fileList}?${new URLSearchParams({ bizId })}`, "GET"
  );
  return Array.isArray(response.data) ? response.data : response.data?.sysAttachList ?? response.data?.records ?? response.data?.list ?? [];
}

export async function downloadWorkOrderFile(file: UploadedFile) {
  const path = String(file.downloadFilePath ?? "").trim();
  if (!path) throw new Error("历史附件缺少下载地址");
  const downloaded = await nativeInvoke<DownloadedFile>("cis_download_file", { path });
  const binary = atob(downloaded.base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new File([bytes], downloaded.name, { type: downloaded.mime || "image/jpeg" });
}

export function updateLastHouseholdTime(payload: {
  woHeaderId: string; woYear: number; reachSceneGeocode: { longitude: number; latitude: number }; closeAttachBizId: string; address: string;
}) { return request<null>(paths.household, "POST", payload); }

export function notifyWorkOrderStatus(payload: { status: string; deviceNo: string | null; orderNo: string }) {
  return request<unknown>(paths.notify, "POST", payload);
}

export function closeSecurityCheckWorkOrder(payload: {
  remark: string; closeAttachBizId: string; "closeAttachBizId-ZC": string; closeReason: string; "closeAttachBizId-11": string; woHeaderId: string;
}) { return request<string | null>(paths.close, "POST", payload); }

export function createWorkOrderExchangeLog(payload: {
  exchangeType: string; woHeaderId: string; woNumber: string; userName: string; params: { closeReason: string; remark: string };
}) { return request<unknown>(paths.exchange, "POST", payload); }

export async function fetchHistoricalWorkOrders(
  userinfoId: string,
  pageSize = 50,
  maxPages = 20,
  dateRange?: { start: string; end: string },
) {
  const result: Record<string, unknown>[] = [];
  for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
    const response = await request<Record<string, unknown>[] | { records?: Record<string, unknown>[] | null; list?: Record<string, unknown>[] | null; rows?: Record<string, unknown>[] | null } | null>(paths.history, "POST", {
      queryInfo: {
        dateCreateStart: dateRange?.start ?? "",
        dateCreateEnd: dateRange?.end ?? "",
        userinfoId,
      },
      page: { pageSize, pageIndex, orders: [{ asc: "true", column: "" }] },
    });
    const page = records(response.data); result.push(...page);
    if (page.length < pageSize) break;
  }
  return result;
}

export async function fetchWorkOrderExchangeLogs(woHeaderId: string, pageSize = 100, maxPages = 20) {
  const result: ExchangeLog[] = [];
  for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
    const response = await request<ExchangeLog[] | { records?: ExchangeLog[] | null; list?: ExchangeLog[] | null; rows?: ExchangeLog[] | null } | null>(paths.exchangeQuery, "POST", { woHeaderId, page: { pageSize, pageIndex } });
    const page = records(response.data); result.push(...page);
    if (page.length < pageSize) break;
  }
  return result;
}
