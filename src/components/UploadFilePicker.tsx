import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

function useFilePreviewUrl(file: File | null | undefined) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!file) {
      setUrl("");
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  return url;
}

function ImagePreviewDialog({
  fileName,
  label,
  url,
  actionError,
  confirming = false,
  onClose,
  onConfirm,
}: {
  fileName: string;
  label: string;
  url: string;
  actionError?: string;
  confirming?: boolean;
  onClose: () => void;
  onConfirm?: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    const closeOnAndroidBack = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("kidindin:back", closeOnAndroidBack);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("kidindin:back", closeOnAndroidBack);
    };
  }, [onClose]);

  return createPortal(
    <div className="image-preview-backdrop" onClick={onClose}>
      <section
        className={`image-preview-dialog ${onConfirm ? "has-action" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${label}放大预览`}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <b>{label}</b>
            <span>{fileName}</span>
          </div>
          <button
            type="button"
            aria-label="关闭图片预览"
            disabled={confirming}
            onClick={onClose}
          >
            <Icon name="close" size={22} />
          </button>
        </header>
        <div className="image-preview-stage">
          <img src={url} alt={`${label}：${fileName}`} />
        </div>
        {onConfirm ? (
          <footer>
            {actionError ? (
              <p className="image-preview-action-error" role="alert">
                {actionError}
              </p>
            ) : null}
            <button type="button" disabled={confirming} onClick={onClose}>
              取消
            </button>
            <button type="button" disabled={confirming} onClick={onConfirm}>
              {confirming ? "正在检查重复…" : "选择这张图片"}
            </button>
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}

export function UploadFilePicker({
  file,
  inputKey,
  label,
  placeholder,
  cameraCapture = false,
  onPick,
}: {
  file: File | null | undefined;
  inputKey: string;
  label: string;
  placeholder: string;
  cameraCapture?: boolean;
  onPick: (file: File | null) => void | Promise<void>;
}) {
  const url = useFilePreviewUrl(file);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const pendingUrl = useFilePreviewUrl(pendingFile);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pendingSource, setPendingSource] = useState<"camera" | "library">(
    "library",
  );
  const [pendingError, setPendingError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const stageSelectedFile = (
    input: HTMLInputElement,
    source: "camera" | "library",
  ) => {
    const nextFile = input.files?.[0] ?? null;
    input.value = "";
    if (!nextFile) return;
    setPendingError("");
    setPendingSource(source);
    setPendingFile(nextFile);
  };

  const closePendingPreview = () => {
    if (confirming) return;
    setPendingError("");
    setPendingFile(null);
  };

  const confirmPendingFile = async () => {
    if (!pendingFile || confirming) return;
    setConfirming(true);
    setPendingError("");
    try {
      await onPick(pendingFile);
      setPendingFile(null);
    } catch (error) {
      setPendingError(
        error instanceof Error ? error.message : "检查图片是否重复失败",
      );
    } finally {
      setConfirming(false);
    }
  };

  useEffect(() => {
    if (!url) setPreviewOpen(false);
  }, [url]);

  return (
    <div className="workflow-file-picker">
      {cameraCapture ? (
        <label className="native-camera-picker">
          <Icon name="camera" size={20} />
          <span>
            <b>现场拍照</b>
            <small>调用安卓原生后置相机</small>
          </span>
          <Icon name="chevron" size={17} />
          <input
            key={`${inputKey}-camera`}
            type="file"
            accept="image/*"
            capture="environment"
            aria-label={`使用安卓原生相机拍摄${label}`}
            onChange={(event) =>
              stageSelectedFile(event.currentTarget, "camera")
            }
          />
        </label>
      ) : null}
      <label className="file-picker">
        <span>{file?.name || placeholder}</span>
        <input
          key={inputKey}
          type="file"
          accept="image/*"
          onChange={(event) =>
            stageSelectedFile(event.currentTarget, "library")
          }
        />
      </label>
      {url ? (
        <button
          type="button"
          className="upload-photo-preview"
          onClick={() => setPreviewOpen(true)}
          aria-label={`放大预览${label}`}
        >
          <img src={url} alt={label} />
          <span><b>{label}</b><small>点击放大预览</small></span>
          <Icon name="search" size={18} />
        </button>
      ) : null}
      {previewOpen && url ? (
        <ImagePreviewDialog
          fileName={file?.name || label}
          label={label}
          url={url}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
      {pendingFile && pendingUrl ? (
        <ImagePreviewDialog
          fileName={pendingFile.name}
          label={`${label}${pendingSource === "camera" ? "现场拍照" : "相册"}候选图片`}
          url={pendingUrl}
          actionError={pendingError}
          confirming={confirming}
          onClose={closePendingPreview}
          onConfirm={() => void confirmPendingFile()}
        />
      ) : null}
    </div>
  );
}

export function FilePreview({
  file,
  label,
}: {
  file: File | null | undefined;
  label: string;
}) {
  const url = useFilePreviewUrl(file);
  const [previewOpen, setPreviewOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="file-preview"
        disabled={!url}
        onClick={() => setPreviewOpen(true)}
        aria-label={url ? `放大预览${label}` : `${label}未选择`}
      >
        {url ? <img src={url} alt={label} /> : <span>未选择</span>}
        <small>{label}</small>
      </button>
      {previewOpen && url ? (
        <ImagePreviewDialog
          fileName={file?.name || label}
          label={label}
          url={url}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </>
  );
}
