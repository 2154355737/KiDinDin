import {
  fetchHistoricalWorkOrders,
  fetchWorkOrderDetail,
  fetchWorkOrderFiles,
  fetchWorkOrderNailInfo,
  type UploadedFile,
} from "./workOrderApi";
import { nativeInvoke } from "./tauri";
import type { WorkOrder } from "../types/workOrder";

const MAX_HISTORY_CANDIDATES = 8;
const MAX_ATTACHMENTS_PER_ORDER = 30;
const MAX_BYTES_PER_ORDER = 100 * 1024 * 1024;

function createConcurrencyGate(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

const withCisRequest = createConcurrencyGate(2);
const withOssDownload = createConcurrencyGate(3);

export type VacantRoomProgressStage =
  | "history"
  | "detail"
  | "attachments"
  | "downloading";

export type CachedVacantRoomImage = {
  cacheKey: string;
  mime: string;
  originalName: string;
  previewDataUrl: string;
  sha256: string;
  size: number;
};

export type VacantRoomExtractedImage = CachedVacantRoomImage & {
  attachIds: string[];
  labels: string[];
  sourceBizIds: string[];
};

export type VacantRoomExtraction = {
  historyCompletedAt: string;
  historyWoHeaderId: string;
  historyWoNumber: string;
  images: VacantRoomExtractedImage[];
  rawAttachmentCount: number;
  warnings: string[];
};

export type VacantRoomSaveInput = {
  cacheKey: string;
  displayName: string;
  mime: string;
};

export type VacantRoomSaveResult = {
  saved: Array<{ displayName: string; uri: string }>;
};

type PhotoSource = {
  bizId: string;
  label: string;
};

type AttachmentSource = {
  attachment: UploadedFile;
  bizId: string;
  label: string;
};

type AttributeDefinition = {
  attrType: string;
  label: string;
};

const knownPhotoLabels: Record<string, string> = {
  AQKXXGL01: "安全卡、表具及管道整体概览",
  BQGJWG0004: "表前管及尾管",
  LGJFQG0001: "立管及阀前管",
  RAB000003: "燃气表整体照片",
  ZTCF0001: "厨房整体照片",
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

function isBusinessId(value: string) {
  return /^\d{16,22}$/.test(value);
}

function timestamp(item: Record<string, unknown>) {
  const value =
    text(item.actualEndDate) || text(item.updateTime) || text(item.createTime);
  const parsed = Date.parse(value.replace(/-/g, "/"));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function oneYearRange(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const start = new Date(year - 1, month - 1, day);
  const startText = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")} 00:00:00`;
  return { end: `${date} 23:59:59`, start: startText };
}

function currentUserinfoId(order: WorkOrder) {
  const raw = order.raw ?? {};
  const userinfo = record(raw.userinfo);
  return text(raw.userinfoId) || text(userinfo.userInfoId);
}

function historyHeader(data: Record<string, unknown>) {
  return record(data.tcisWoHeaderDto);
}

function photoDefinitions(nail: Record<string, unknown>) {
  const definitions = new Map<string, AttributeDefinition>();
  const actSet = record(nail.tcisWoActSetDto);
  for (const setLineValue of array(actSet.line)) {
    const setLine = record(setLineValue);
    const groupCode = text(setLine.groupCode);
    const groupName = text(setLine.groupName);
    if (groupCode && groupName) {
      definitions.set(groupCode, { attrType: "group", label: groupName });
    }
    const group = record(setLine.tcisWoActGroupDto);
    for (const itemValue of array(group.line)) {
      const item = record(itemValue);
      const attribute = record(item.tcisWoAttribute);
      const code = text(item.attrCode);
      const label =
        text(item.attrName) || text(attribute.displayLabel) || groupName;
      if (code && label) {
        definitions.set(code, {
          attrType: text(attribute.attrType),
          label,
        });
      }
    }
  }
  return definitions;
}

function addPhotoSource(
  sources: Map<string, Set<string>>,
  bizId: string,
  label: string,
) {
  if (!isBusinessId(bizId)) return;
  const labels = sources.get(bizId) ?? new Set<string>();
  labels.add(label || "安检执行照片");
  sources.set(bizId, labels);
}

function extractNailPhotoSources(nail: Record<string, unknown>) {
  const definitions = photoDefinitions(nail);
  const workOrder = record(nail.tcisWorkOrderDto);
  const sources = new Map<string, Set<string>>();

  for (const lineValue of array(workOrder.tcisWoLineDtoList)) {
    const line = record(lineValue);
    const code = text(line.attrCode);
    const definition = definitions.get(code);
    const directValue = text(line.attrVal);
    const knownLabel = knownPhotoLabels[code];
    const directLooksLikePhoto =
      definition?.attrType === "70" ||
      Boolean(knownLabel) ||
      definition?.attrType === "group" ||
      /照片|附件/.test(definition?.label ?? "");
    if (directLooksLikePhoto) {
      addPhotoSource(
        sources,
        directValue,
        knownLabel || definition?.label || "安检执行照片",
      );
    }

    const detail = record(line.attrDetail);
    for (const [detailCode, detailValue] of Object.entries(detail)) {
      const bizId = text(detailValue);
      if (!/PZ$/i.test(detailCode) || !isBusinessId(bizId)) continue;
      const parentLabel =
        knownLabel || definition?.label || knownPhotoLabels[detailCode] || code;
      addPhotoSource(
        sources,
        bizId,
        /照片/.test(parentLabel) ? parentLabel : `${parentLabel}照片`,
      );
    }
  }

  return [...sources].map(([bizId, labels]) => ({
    bizId,
    label: [...labels].join("、"),
  }));
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  task: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(values[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return results;
}

export function cacheVacantRoomImage(file: UploadedFile) {
  const path = text(file.downloadFilePath);
  if (!path) throw new Error("历史附件缺少下载地址");
  return withOssDownload(() =>
    nativeInvoke<CachedVacantRoomImage>("cis_cache_vacant_room_image", {
      fileName: text(file.fileName) || "历史安检照片.jpg",
      path,
    }),
  );
}

export function clearVacantRoomImageCache() {
  return nativeInvoke<void>("clear_vacant_room_image_cache");
}

export function saveVacantRoomImages(
  images: VacantRoomSaveInput[],
  relativePath: string,
) {
  return nativeInvoke<VacantRoomSaveResult>("save_vacant_room_images", {
    images,
    relativePath,
  });
}

export function vacantRoomImageDisplayName(
  order: WorkOrder,
  image: VacantRoomExtractedImage,
  index: number,
) {
  const extension = image.mime === "image/png" ? "png" : image.mime === "image/webp" ? "webp" : "jpg";
  const label = (image.labels[0] || "安检照片")
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .slice(0, 24);
  const orderNumber = (order.woNumber || order.id)
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .slice(0, 32);
  return `${orderNumber}_${String(index + 1).padStart(2, "0")}_${label}_${image.sha256.slice(0, 8)}.${extension}`;
}

export async function extractVacantRoomOrder(
  order: WorkOrder,
  date: string,
  onProgress?: (stage: VacantRoomProgressStage, message: string) => void,
): Promise<VacantRoomExtraction> {
  onProgress?.("history", "正在查询同户历史安检工单");
  let userinfoId = currentUserinfoId(order);
  if (!userinfoId) {
    const currentDetail = await withCisRequest(() =>
      fetchWorkOrderDetail(order.woHeaderId),
    );
    const header = historyHeader(currentDetail.data as Record<string, unknown>);
    const userinfo = record(header.userinfo);
    userinfoId = text(header.userinfoId) || text(userinfo.userInfoId);
  }
  if (!userinfoId) throw new Error("当前空房工单缺少 userinfoId");

  const historical = await withCisRequest(() =>
    fetchHistoricalWorkOrders(
      userinfoId,
      50,
      20,
      oneYearRange(date),
    ),
  );
  const candidates = historical
    .filter((candidate) => {
      const id = text(candidate.woHeaderId);
      const status = text(candidate.statusCode);
      const sameType =
        text(candidate.woMainType) === "40" ||
        text(candidate.woDetailType) === "401" ||
        text(candidate.woName).includes("安检");
      return (
        id &&
        id !== order.woHeaderId &&
        sameType &&
        (status === "50" || status === "60" || Boolean(text(candidate.actualEndDate)))
      );
    })
    .sort((left, right) => timestamp(right) - timestamp(left))
    .slice(0, MAX_HISTORY_CANDIDATES);

  if (!candidates.length) throw new Error("一年内未找到同户已完成的历史安检单");

  const candidateWarnings: string[] = [];
  for (const candidate of candidates) {
    const historyWoHeaderId = text(candidate.woHeaderId);
    const historyWoNumber = text(candidate.woNumber) || historyWoHeaderId;
    onProgress?.("detail", `正在读取历史单 ${historyWoNumber} 的安检详情`);
    try {
      const [detailResponse, nailResponse] = await Promise.all([
        withCisRequest(() => fetchWorkOrderDetail(historyWoHeaderId)),
        withCisRequest(() => fetchWorkOrderNailInfo(historyWoHeaderId)),
      ]);
      const header = historyHeader(detailResponse.data as Record<string, unknown>);
      const sources = new Map<string, Set<string>>();
      addPhotoSource(sources, text(header.closeAttachBizId), "门牌照");
      for (const source of extractNailPhotoSources(
        nailResponse.data as Record<string, unknown>,
      )) {
        addPhotoSource(sources, source.bizId, source.label);
      }
      const photoSources: PhotoSource[] = [...sources].map(
        ([bizId, labels]) => ({ bizId, label: [...labels].join("、") }),
      );
      if (!photoSources.length) {
        candidateWarnings.push(`${historyWoNumber} 没有照片业务号`);
        continue;
      }

      onProgress?.("attachments", `正在读取 ${photoSources.length} 组历史附件`);
      const attachmentGroups = await mapWithConcurrency(
        photoSources,
        2,
        async (source) => {
          try {
            const files = await withCisRequest(() =>
              fetchWorkOrderFiles(source.bizId),
            );
            return files
              .filter((file) => Boolean(text(file.downloadFilePath)))
              .map((attachment) => ({
                attachment,
                bizId: source.bizId,
                label: source.label,
              }));
          } catch (error) {
            candidateWarnings.push(
              `${source.label}附件读取失败：${error instanceof Error ? error.message : "未知错误"}`,
            );
            return [] as AttachmentSource[];
          }
        },
      );
      const attachments = attachmentGroups.flat().slice(0, MAX_ATTACHMENTS_PER_ORDER);
      if (!attachments.length) {
        candidateWarnings.push(`${historyWoNumber} 没有可下载照片`);
        continue;
      }

      onProgress?.("downloading", `正在安全下载 ${attachments.length} 个历史附件`);
      const cached: Array<{
        cached: CachedVacantRoomImage;
        source: AttachmentSource;
      }> = [];
      let downloadedBytes = 0;
      let reachedSizeLimit = false;
      for (let offset = 0; offset < attachments.length; offset += 3) {
        const batch = await Promise.all(
          attachments.slice(offset, offset + 3).map(async (source) => {
            try {
              return {
                cached: await cacheVacantRoomImage(source.attachment),
                source,
              };
            } catch (error) {
              candidateWarnings.push(
                `${source.label}下载失败：${error instanceof Error ? error.message : "未知错误"}`,
              );
              return null;
            }
          }),
        );
        for (const item of batch) {
          if (!item) continue;
          if (downloadedBytes + item.cached.size > MAX_BYTES_PER_ORDER) {
            reachedSizeLimit = true;
            break;
          }
          downloadedBytes += item.cached.size;
          cached.push(item);
        }
        if (reachedSizeLimit) {
          candidateWarnings.push("照片总量超过 100MB，已停止继续下载");
          break;
        }
      }

      const imagesByHash = new Map<string, VacantRoomExtractedImage>();
      for (const item of cached) {
        const existing = imagesByHash.get(item.cached.sha256);
        const attachId = text(item.source.attachment.attachId);
        if (existing) {
          if (!existing.labels.includes(item.source.label))
            existing.labels.push(item.source.label);
          if (attachId && !existing.attachIds.includes(attachId))
            existing.attachIds.push(attachId);
          if (!existing.sourceBizIds.includes(item.source.bizId))
            existing.sourceBizIds.push(item.source.bizId);
          continue;
        }
        imagesByHash.set(item.cached.sha256, {
          ...item.cached,
          attachIds: attachId ? [attachId] : [],
          labels: [item.source.label],
          sourceBizIds: [item.source.bizId],
        });
      }
      const images = [...imagesByHash.values()];
      if (!images.length) continue;

      return {
        historyCompletedAt:
          text(header.actualEndDate) ||
          text(candidate.actualEndDate) ||
          text(candidate.updateTime),
        historyWoHeaderId,
        historyWoNumber,
        images,
        rawAttachmentCount: attachments.length,
        warnings: candidateWarnings,
      };
    } catch (error) {
      candidateWarnings.push(
        `${historyWoNumber} 检查失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
    }
  }

  throw new Error(
    candidateWarnings[candidateWarnings.length - 1] ||
      "已检查最近历史安检单，但未找到可用照片",
  );
}
