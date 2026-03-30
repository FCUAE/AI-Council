import { useState, useRef, useCallback, useMemo } from "react";
import { compressImageIfNeeded, isImageFile } from "@/lib/imageCompression";
import { authFetch } from "@/lib/clerk-token";

export interface UploadedFile {
  name: string;
  url: string;
  type: string;
  size: number;
}

export interface PendingFile {
  id: string;
  name: string;
  type: string;
  status: 'compressing' | 'uploading' | 'complete' | 'error';
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 30;
const UPLOAD_BATCH_SIZE = 5;
const ALLOWED_FILE_TYPES = [
  'image/',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv',
];

function isAllowedFileType(file: File): boolean {
  return (
    ALLOWED_FILE_TYPES.some((type) => file.type.startsWith(type)) ||
    ['.pdf', '.doc', '.docx', '.txt', '.md', '.json', '.csv'].some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    )
  );
}

export function useFileUpload() {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [tokenEstimates, setTokenEstimates] = useState<Map<string, number>>(new Map());
  const [pendingExtractions, setPendingExtractions] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalAttachmentTokens = useMemo(() => {
    let sum = 0;
    tokenEstimates.forEach((v) => {
      sum += v;
    });
    return sum;
  }, [tokenEstimates]);

  const handleFileUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setFileError(null);

      const allFiles = Array.from(files);

      const resetInput = () => {
        if (fileInputRef.current) fileInputRef.current.value = "";
      };

      if (uploadedFiles.length + allFiles.length > MAX_FILES) {
        setFileError("Maximum 30 files per debate.");
        resetInput();
        return;
      }

      const validFiles: { file: File; fileId: string }[] = [];
      for (const file of allFiles) {
        if (file.size > MAX_FILE_SIZE) {
          setFileError("This file is too large. Maximum size is 10MB.");
          continue;
        }
        if (!isAllowedFileType(file)) {
          setFileError(
            "This file type isn't supported yet. Try PDF, images, docs, or text files."
          );
          continue;
        }
        const fileId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        validFiles.push({ file, fileId });
      }

      if (validFiles.length === 0) {
        resetInput();
        return;
      }

      const remaining = MAX_FILES - uploadedFiles.length;
      const trimmedFiles = validFiles.slice(0, remaining);

      setPendingFiles((prev) => [
        ...prev,
        ...trimmedFiles.map(({ file, fileId }) => ({
          id: fileId,
          name: file.name,
          type: file.type,
          status: (isImageFile(file) ? "compressing" : "uploading") as PendingFile["status"],
        })),
      ]);

      setIsUploading(true);

      const processFile = async ({ file, fileId }: { file: File; fileId: string }) => {
        try {
          const processedFile = await compressImageIfNeeded(file);

          setPendingFiles((prev) =>
            prev.map((f) =>
              f.id === fileId ? { ...f, status: "uploading" as const } : f
            )
          );

          const formData = new FormData();
          formData.append("file", processedFile);

          const uploadRes = await authFetch("/api/uploads/direct", {
            method: "POST",
            body: formData,
          });

          if (!uploadRes.ok) throw new Error("Failed to upload file");
          const { objectPath } = await uploadRes.json();

          setPendingFiles((prev) => prev.filter((f) => f.id !== fileId));

          setUploadedFiles((prev) => [
            ...prev,
            {
              name: processedFile.name,
              url: objectPath,
              type: processedFile.type || "application/octet-stream",
              size: processedFile.size,
            },
          ]);

          setPendingExtractions((prev) => prev + 1);
          authFetch("/api/uploads/extract-text", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileUrl: objectPath,
              fileType: processedFile.type,
            }),
          })
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
              if (data?.tokenEstimate) {
                setTokenEstimates((prev) => {
                  const next = new Map(prev);
                  next.set(objectPath, data.tokenEstimate);
                  return next;
                });
              }
            })
            .catch(() => {})
            .finally(() => setPendingExtractions((prev) => prev - 1));
        } catch (err: any) {
          console.error("Upload failed:", err);
          const isNetworkError =
            !navigator.onLine ||
            err.message?.includes("fetch") ||
            err.message?.includes("network");
          setFileError(
            isNetworkError
              ? "Connection lost. Check your internet and try again."
              : "Upload failed. Try again or use a different file."
          );
          setPendingFiles((prev) =>
            prev.map((f) =>
              f.id === fileId ? { ...f, status: "error" as const } : f
            )
          );
          setTimeout(() => {
            setPendingFiles((prev) => prev.filter((f) => f.id !== fileId));
          }, 3000);
        }
      };

      for (let i = 0; i < trimmedFiles.length; i += UPLOAD_BATCH_SIZE) {
        const batch = trimmedFiles.slice(i, i + UPLOAD_BATCH_SIZE);
        await Promise.allSettled(batch.map(processFile));
      }

      setIsUploading(false);
      resetInput();
    },
    [uploadedFiles.length]
  );

  const removeFile = useCallback((index: number) => {
    setUploadedFiles((prev) => {
      const fileToRemove = prev[index];
      if (fileToRemove) {
        setTokenEstimates((prevEstimates) => {
          const next = new Map(prevEstimates);
          next.delete(fileToRemove.url);
          return next;
        });
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const clearFiles = useCallback(() => {
    setUploadedFiles([]);
    setTokenEstimates(new Map());
  }, []);

  return {
    uploadedFiles,
    setUploadedFiles,
    pendingFiles,
    isUploading,
    tokenEstimates,
    setTokenEstimates,
    totalAttachmentTokens,
    pendingExtractions,
    fileError,
    setFileError,
    fileInputRef,
    handleFileUpload,
    removeFile,
    clearFiles,
  };
}

export function useAdjustTextareaHeight(textareaRef: React.RefObject<HTMLTextAreaElement | null>) {
  return useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const maxHeight = 200;
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    }
  }, [textareaRef]);
}
