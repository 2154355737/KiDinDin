import { fileToNativeUpload, nativeInvoke, nativeRequest } from "./tauri";

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

export type UploadedFile = {
  attachId?: string | null;
  bizId?: string | null;
  fileName?: string | null;
  downloadFilePath?: string | null;
  uploadBy?: string | null;
  uploadDate?: string | null;
  [key: string]: unknown;
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
  userAjInfo: "/api/yhbz/bzUserInfo/detailForAj/",
  fileList: "/api/appsys/file/list",
  history: "/api/workorder/tcisworkorder/newCriteria",
  household: "/api/workorder/tcisworkorderAj/updateLastHouseholdTime",
  notify: "/api/appinterface/cem/custom/orderStatusNotify",
  close: "/api/workorder/tcisworkorder/close4SecurityCheck",
  exchange: "/api/workorder/exchange/log",
  exchangeQuery: "/api/workorder/exchange/log/query_by_wo",
} as const;

async function request<T>(path: string, method: string, body?: unknown): Promise<ApiEnvelope<T>> {
  const payload = await nativeRequest(path, method, body) as ApiEnvelope<T>;
  if (!payload || typeof payload !== "object" || typeof payload.code !== "number") {
    throw new Error("接口返回格式无效");
  }
  if (payload.code !== 0) throw new Error(payload.msg || `接口业务返回 ${payload.code}`);
  return payload;
}

function records<T>(data: T[] | { records?: T[] | null; list?: T[] | null; rows?: T[] | null } | null) {
  return Array.isArray(data) ? data : data?.records ?? data?.list ?? data?.rows ?? [];
}

export function fetchWorkOrders(expectingDate: string) {
  return request<CisWorkOrder[]>(paths.list, "POST", { expectingDate });
}

export function fetchWorkOrderDetail(woHeaderId: string) {
  return request<WorkOrderDetail>(`${paths.detail}/${encodeURIComponent(woHeaderId)}`, "GET");
}

export function fetchWorkOrderNailInfo(woHeaderId: string) {
  return request<WorkOrderDetail>(`${paths.nailInfo}/${encodeURIComponent(woHeaderId)}`, "POST");
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

export function saveWorkOrderAct(payload: Pick<WorkOrderDetail, "tcisWoHeaderDto" | "tcisWoLineDtoList">) {
  return request<WorkOrderDetail>(paths.editAct, "POST", payload);
}

export function fetchWorkOrderUserAjInfo(userInfoId: string, supplypointId: string) {
  const query = new URLSearchParams({ supplypointId, userInfoId });
  return request<Record<string, unknown>>(`${paths.userAjInfo}?${query}`, "POST");
}

export async function uploadWorkOrderFiles(files: File[], bizId = "") {
  const payload = await nativeInvoke<ApiEnvelope<{ bizId: string; sysAttachList?: UploadedFile[] | null }>>(
    "cis_upload_files",
    { bizId: bizId || null, files: await Promise.all(files.map(fileToNativeUpload)) }
  );
  if (payload.code !== 0) throw new Error(payload.msg || `上传业务返回 ${payload.code}`);
  if (!payload.data?.bizId) throw new Error("上传响应缺少 data.bizId");
  return payload;
}

export async function fetchWorkOrderFiles(bizId: string) {
  const response = await request<UploadedFile[] | { sysAttachList?: UploadedFile[] | null; records?: UploadedFile[] | null; list?: UploadedFile[] | null } | null>(
    `${paths.fileList}?${new URLSearchParams({ bizId })}`, "GET"
  );
  return Array.isArray(response.data) ? response.data : response.data?.sysAttachList ?? response.data?.records ?? response.data?.list ?? [];
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

export async function fetchHistoricalWorkOrders(userinfoId: string, pageSize = 50, maxPages = 20) {
  const result: Record<string, unknown>[] = [];
  for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
    const response = await request<Record<string, unknown>[] | { records?: Record<string, unknown>[] | null; list?: Record<string, unknown>[] | null; rows?: Record<string, unknown>[] | null } | null>(paths.history, "POST", {
      queryInfo: { dateCreateStart: "", dateCreateEnd: "", userinfoId },
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
