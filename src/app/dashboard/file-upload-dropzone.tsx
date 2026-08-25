"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Status = "idle" | "selected" | "uploading" | "done" | "error";

export function FileUploadDropzone({
  uploadUrl,
  fieldName,
  accept,
  maxBytes,
  helpText,
  buttonLabel = "Upload",
  compact = false,
  className = "",
  onUploaded,
}: {
  uploadUrl: string;
  fieldName: string;
  accept: string;
  maxBytes: number;
  helpText: string;
  buttonLabel?: string;
  // Shorter idle prompt for a small space (e.g. next to an avatar preview)
  // instead of the full-height document dropzone.
  compact?: boolean;
  className?: string;
  onUploaded?: (data: unknown) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function pickFile(f: File | undefined | null) {
    if (!f) return;
    setError(null);
    if (f.size > maxBytes) {
      setError(`File is too large (${(f.size / 1024 / 1024).toFixed(1)}MB, max ${Math.round(maxBytes / 1024 / 1024)}MB).`);
      return;
    }
    setFile(f);
    setStatus("selected");
    setProgress(0);
  }

  function reset() {
    setFile(null);
    setStatus("idle");
    setProgress(0);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function upload() {
    if (!file) return;
    setStatus("uploading");
    setError(null);

    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append(fieldName, file);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    });

    xhr.addEventListener("load", () => {
      let data: unknown = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON response body -- fall through to the generic error message below
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        setStatus("done");
        setProgress(100);
        onUploaded?.(data);
        router.refresh();
        setTimeout(reset, 1800);
      } else {
        setStatus("error");
        setError((data as { error?: string })?.error || "Upload failed. Please try again.");
      }
    });

    xhr.addEventListener("error", () => {
      setStatus("error");
      setError("Upload failed. Please check your connection and try again.");
    });

    xhr.open("POST", uploadUrl);
    xhr.send(formData);
  }

  return (
    <div className={className}>
      <input ref={inputRef} type="file" name={fieldName} accept={accept} className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />

      {status === "idle" ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pickFile(e.dataTransfer.files?.[0]);
          }}
          className={`flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 text-center transition-colors ${
            compact ? "py-3.5" : "py-8"
          } ${dragOver ? "border-brand-400 bg-brand-50" : "border-gray-200 hover:border-brand-300 hover:bg-gray-50"}`}
        >
          <svg viewBox="0 0 24 24" fill="none" className={compact ? "h-5 w-5 text-gray-400" : "h-6 w-6 text-gray-400"}>
            <path d="M12 16V4M12 4l-4 4M12 4l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span className="text-sm font-medium text-gray-700">Click to upload{compact ? "" : " or drag and drop"}</span>
          <span className="text-xs text-gray-400">{helpText}</span>
        </button>
      ) : (
        <div className="flex flex-col gap-2 rounded-xl border border-gray-200 p-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
              <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5">
                <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">{file?.name}</p>
              <p className="text-xs text-gray-400">{file ? `${Math.max(1, Math.round(file.size / 1024))} KB` : ""}</p>
            </div>
            {status !== "uploading" && status !== "done" && (
              <button
                type="button"
                onClick={reset}
                aria-label="Remove file"
                className="shrink-0 cursor-pointer rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>

          {(status === "uploading" || status === "done") && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full transition-all duration-200 ${status === "done" ? "bg-green-500" : "bg-brand-500"}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          {status === "selected" && (
            <button
              type="button"
              onClick={upload}
              className="self-start cursor-pointer rounded-lg bg-brand-500 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-brand-600"
            >
              {buttonLabel}
            </button>
          )}
          {status === "uploading" && <p className="text-xs text-gray-500">Uploading... {progress}%</p>}
          {status === "done" && <p className="text-xs font-medium text-green-600">Uploaded</p>}
        </div>
      )}

      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}
