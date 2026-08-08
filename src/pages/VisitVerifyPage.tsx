import { Icon } from "../components/Icon";
import { saveVacantRoomImages } from "../services/vacantRoomApi";
import { nativeInvoke } from "../services/tauri";
import { useState, useRef, type ChangeEvent } from "react";

type AugmentResultItem = {
  cacheKey: string;
  previewDataUrl: string;
};

type VerifyAugmentResult = {
  augmented: AugmentResultItem;
};

type VisitVerifyPageProps = {
  onBack: () => void;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function VisitVerifyPage({ onBack }: VisitVerifyPageProps) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<VerifyAugmentResult | null>(null);
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.currentTarget.files?.[0];
    if (!selected) return;
    if (!selected.type.startsWith("image/")) {
      setFile(null);
      setResult(null);
      setError("请选择图片文件");
      return;
    }
    setError("");
    setSaveMessage("");
    setResult(null);
    setFile(selected);
  };

  const handleVerify = async () => {
    if (!file) return;
    setLoading(true);
    setError("");
    setSaveMessage("");
    setResult(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.readAsDataURL(file);
      });
      const data = await nativeInvoke<VerifyAugmentResult>(
        "verify_augment_image",
        { input: { base64 } },
      );
      setResult(data);
    } catch (err) {
      const message =
        typeof err === "string" ? err
        : err instanceof Error ? err.message
        : String(err ?? "验证失败");
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const augmented = result?.augmented ?? null;

  const handleSave = async () => {
    if (!file || !augmented || saving) return;
    setSaving(true);
    setError("");
    setSaveMessage("");
    try {
      const stem = file.name.replace(/\.[^.]+$/, "").trim() || "到访验证";
      const saved = await saveVacantRoomImages(
        [{
          cacheKey: augmented.cacheKey,
          displayName: `${stem}_左右翻转.jpg`,
          mime: "image/jpeg",
        }],
        "到访验证",
      );
      const savedImage = saved.saved[0];
      setSaveMessage(
        savedImage ? `已保存：${savedImage.displayName}` : "图片已保存",
      );
    } catch (err) {
      const message =
        typeof err === "string" ? err
        : err instanceof Error ? err.message
        : String(err ?? "保存失败");
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">工单工具</p>
          <h1>到访验证</h1>
        </div>
        <div className="topbar-actions">
          <button className="text-button" onClick={onBack}>
            返回
          </button>
        </div>
      </header>

      <section className="visit-verify-page">
        <p className="visit-verify-description">
          选择一张图片，生成固定左右镜像的增广图片。
        </p>
        <div className="visit-verify-upload">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
          <button
            type="button"
            className="secondary-button"
            disabled={loading || saving}
            onClick={() => inputRef.current?.click()}
          >
            <Icon name="upload" size={18} /> 选择图片
          </button>

          {file && (
            <div className="visit-verify-file">
              <span>{file.name}</span>
              <small>{formatBytes(file.size)}</small>
            </div>
          )}

          <button
            type="button"
            className="primary-button"
            disabled={!file || loading}
            onClick={() => void handleVerify()}
          >
            {loading ? (
              <>生成中…</>
            ) : (
              <>
                <Icon name="play" size={16} /> 生成左右镜像
              </>
            )}
          </button>
        </div>

        {error && <p className="visit-verify-error">{error}</p>}

        {augmented && (
          <div className="visit-verify-results">
            <div className="visit-verify-section">
              <h3>增广图片</h3>
              <div className="visit-verify-card">
                <img
                  src={augmented.previewDataUrl}
                  alt="左右镜像增广图片"
                  className="visit-verify-preview"
                />
              </div>
            </div>
            <div className="visit-verify-result-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={loading || saving}
                onClick={() => void handleVerify()}
              >
                <Icon name="refresh" size={16} /> 重新生成
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={loading || saving}
                onClick={() => void handleSave()}
              >
                <Icon name="download" size={16} />
                {saving ? "保存中…" : "保存图片"}
              </button>
            </div>
            {saveMessage && (
              <p className="visit-verify-save-message" role="status">
                <Icon name="check" size={15} /> {saveMessage}
              </p>
            )}
          </div>
        )}
      </section>
    </>
  );
}
