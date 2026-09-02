import { listSignatureRecords } from "./signatureStore";
import { deleteStorefrontPhotoPrefill, listStorefrontPhotoPrefills } from "./storefrontPrefillStore";
import { listUsedUploadFileNames } from "./uploadFileNameStore";
import { getResidentSecurityPrefilledIds, removeResidentSecurityPrefilledId } from "./residentSecurityPrefillStore";

export type StorageCategory = "门头照片" | "离线签字" | "图片预览缓存";

export type StorageUsage = {
  category: StorageCategory;
  count: number;
  bytes: number;
};

export type StorageOverview = {
  reclaimableBytes: number;
  reclaimableCount: number;
  totalBytes: number;
  usage: StorageUsage[];
};

function dataUrlBytes(value: string | null) {
  if (!value) return 0;
  const comma = value.indexOf(",");
  const payloadLength = Math.max(0, value.length - (comma >= 0 ? comma + 1 : 0));
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(payloadLength * 0.75) - padding);
}

export async function getStorageOverview(accountKey: string, completedOrderHeaderIds: readonly string[]): Promise<StorageOverview> {
  const [storefrontPhotos, signatures, uploadRecords] = await Promise.all([
    listStorefrontPhotoPrefills(accountKey),
    listSignatureRecords(accountKey),
    listUsedUploadFileNames(),
  ]);
  const previewRecords = uploadRecords.filter((record) => Boolean(record.previewDataUrl));
  const usage: StorageUsage[] = [
    { category: "门头照片", count: storefrontPhotos.length, bytes: storefrontPhotos.reduce((total, item) => total + item.blob.size, 0) },
    { category: "离线签字", count: signatures.length, bytes: signatures.reduce((total, item) => total + item.blob.size, 0) },
    { category: "图片预览缓存", count: previewRecords.length, bytes: previewRecords.reduce((total, item) => total + dataUrlBytes(item.previewDataUrl), 0) },
  ];
  const completedIds = new Set(completedOrderHeaderIds);
  const reclaimable = storefrontPhotos.filter((item) => completedIds.has(item.woHeaderId));
  const residentPrefilledIds = getResidentSecurityPrefilledIds(accountKey);
  return {
    usage,
    totalBytes: usage.reduce((total, item) => total + item.bytes, 0),
    reclaimableBytes: reclaimable.reduce((total, item) => total + item.blob.size, 0),
    reclaimableCount: new Set([
      ...reclaimable.map((item) => item.woHeaderId),
      ...residentPrefilledIds.filter((id) => completedIds.has(id)),
    ]).size,
  };
}

export async function clearCompletedOrderPrefills(accountKey: string, completedOrderHeaderIds: readonly string[]) {
  const completedIds = new Set(completedOrderHeaderIds);
  const [storefrontPhotos, residentPrefilledIds] = await Promise.all([
    listStorefrontPhotoPrefills(accountKey),
    Promise.resolve(getResidentSecurityPrefilledIds(accountKey)),
  ]);
  const photoTargets = storefrontPhotos.filter((item) => completedIds.has(item.woHeaderId));
  const markerTargets = residentPrefilledIds.filter((id) => completedIds.has(id));
  for (const item of photoTargets) {
    await deleteStorefrontPhotoPrefill(accountKey, item.woHeaderId);
  }
  for (const woHeaderId of markerTargets) {
    removeResidentSecurityPrefilledId(accountKey, woHeaderId);
  }
  return {
    clearedHeaderIds: Array.from(new Set([...photoTargets.map((item) => item.woHeaderId), ...markerTargets])),
    count: photoTargets.length,
    bytes: photoTargets.reduce((total, item) => total + item.blob.size, 0),
    markerCount: markerTargets.length,
  };
}
