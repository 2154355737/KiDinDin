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
  onClose,
  onConfirm,
}: {
  fileName: string;
  label: string;
  url: string;
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
          <button type="button" aria-label="关闭图片预览" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </header>
        <div className="image-preview-stage">
          <img src={url} alt={`${label}：${fileName}`} />
        </div>
        {onConfirm ? (
          <footer>
            <button type="button" onClick={onClose}>取消</button>
            <button type="button" onClick={onConfirm}>选择这张图片</button>
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
  onPick,
}: {
  file: File | null | undefined;
  inputKey: string;
  label: string;
  placeholder: string;
  onPick: (file: File | null) => void;
}) {
  const url = useFilePreviewUrl(file);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const pendingUrl = useFilePreviewUrl(pendingFile);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!url) setPreviewOpen(false);
  }, [url]);

  return (
    <div className="workflow-file-picker">
      <label className="file-picker">
        <span>{file?.name || placeholder}</span>
        <input
          key={inputKey}
          type="file"
          accept="image/*"
          onChange={(event) => {
            const nextFile = event.target.files?.[0] ?? null;
            event.currentTarget.value = "";
            if (nextFile) setPendingFile(nextFile);
          }}
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
          label={`${label}候选图片`}
          url={pendingUrl}
          onClose={() => setPendingFile(null)}
          onConfirm={() => {
            onPick(pendingFile);
            setPendingFile(null);
          }}
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
