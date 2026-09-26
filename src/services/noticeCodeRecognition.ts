import { invoke, isTauri } from "@tauri-apps/api/core";
import type { NoticeRecognition } from "./noticeCodePolicy";

export async function prepareNoticeImage(file: File, signal: AbortSignal) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    if (signal.aborted) throw new Error("编码识别已取消");
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法读取图片进行编码识别");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const base64 = canvas.toDataURL("image/jpeg", 0.93).split(",")[1];
    const previewCanvas = document.createElement("canvas");
    previewCanvas.width = Math.max(1, Math.round(canvas.width * Math.min(1, 360 / Math.max(canvas.width, canvas.height))));
    previewCanvas.height = Math.max(1, Math.round(canvas.height * Math.min(1, 360 / Math.max(canvas.width, canvas.height))));
    previewCanvas.getContext("2d")?.drawImage(canvas, 0, 0, previewCanvas.width, previewCanvas.height);
    const preview = await new Promise<Blob | null>((resolve) => previewCanvas.toBlob(resolve, "image/jpeg", 0.65));
    return { base64, preview };
  } finally { bitmap.close(); }
}

export async function recognizeNoticeCode(base64: string, signal: AbortSignal) {
  if (signal.aborted) throw new Error("编码识别已取消");
  if (!isTauri()) throw new Error("当前环境不支持 Android 本地编码识别，可手动填写或继续");
  return invoke<NoticeRecognition>("recognize_notice_code", { imageBase64: base64 });
}
