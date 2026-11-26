"use client";

import { useRef, useState } from "react";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp";
const ACCEPT_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  shipmentId: string;
  maxSizeMb?: number;
};

export function FileDropZone({ action, shipmentId, maxSizeMb = 20 }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function validateAndSet(file: File) {
    setError(null);
    if (!ACCEPT_MIME.includes(file.type)) {
      setError("Solo se permiten PDF, JPEG, PNG o WebP.");
      return false;
    }
    if (file.size > maxSizeMb * 1024 * 1024) {
      setError(`El archivo no puede superar ${maxSizeMb} MB.`);
      return false;
    }
    setFileName(file.name);
    return true;
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (validateAndSet(file)) {
      formRef.current?.requestSubmit();
    }
  }

  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="shipment_id" value={shipmentId} />
      <input
        ref={inputRef}
        type="file"
        name="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={[
          "flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border-2 border-dashed p-8 text-center transition",
          dragging
            ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5"
            : "border-[var(--color-border)] hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-muted)]",
        ].join(" ")}
      >
        <span className="text-2xl">📎</span>
        <span className="text-sm font-medium text-[var(--color-text)]">
          {fileName ?? "Haz clic o arrastra un archivo aquí"}
        </span>
        <span className="text-xs text-[var(--color-text-muted)]">
          PDF, JPEG, PNG, WebP — máximo {maxSizeMb} MB
        </span>
      </button>

      {error && (
        <p className="mt-2 text-sm text-[var(--color-danger)]">{error}</p>
      )}
    </form>
  );
}
