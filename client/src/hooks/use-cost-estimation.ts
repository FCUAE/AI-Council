import { useState, useRef, useEffect } from "react";
import { authFetch } from "@/lib/clerk-token";
import type { UploadedFile } from "@/hooks/use-file-upload";

export interface CostEstimate {
  creditCost: number;
  userTier: string;
}

interface UseCostEstimationOptions {
  models: string[];
  chairmanModel: string;
  totalAttachmentTokens: number;
  uploadedFiles: UploadedFile[];
  isAuthenticated: boolean;
  conversationId?: number;
  prompt?: string;
  isDeliverable?: boolean;
  extraDeps?: unknown[];
}

export function useCostEstimation({
  models,
  chairmanModel,
  totalAttachmentTokens,
  uploadedFiles,
  isAuthenticated,
  conversationId,
  prompt,
  isDeliverable,
  extraDeps = [],
}: UseCostEstimationOptions) {
  const [serverEstimate, setServerEstimate] = useState<CostEstimate | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [estimateRetryCount, setEstimateRetryCount] = useState(0);
  const estimateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const estimateAbortRef = useRef<AbortController | null>(null);

  const costEstimateConfirmed = serverEstimate !== null && !isEstimating;

  useEffect(() => {
    if (!isAuthenticated) {
      setServerEstimate(null);
      setIsEstimating(false);
      return;
    }

    setIsEstimating(true);
    setServerEstimate(null);

    if (estimateTimerRef.current) clearTimeout(estimateTimerRef.current);
    if (estimateAbortRef.current) estimateAbortRef.current.abort("cleanup");

    const abortController = new AbortController();
    estimateAbortRef.current = abortController;

    estimateTimerRef.current = setTimeout(async () => {
      try {
        const attachmentMeta = uploadedFiles.map((f) => ({
          name: f.name,
          url: f.url,
          type: f.type,
          size: f.size,
        }));

        const body: Record<string, unknown> = {
          models,
          chairmanModel,
        };
        if (attachmentMeta.length > 0) body.attachments = attachmentMeta;
        if (totalAttachmentTokens > 0) body.attachmentTokens = totalAttachmentTokens;
        if (conversationId) body.conversationId = conversationId;
        if (prompt?.trim()) body.prompt = prompt.trim();

        const res = await authFetch("/api/estimate-cost", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: abortController.signal,
        });
        if (abortController.signal.aborted) return;
        if (res.ok) {
          const data: CostEstimate = await res.json();
          if (!abortController.signal.aborted) {
            setServerEstimate(data);
            setIsEstimating(false);
          }
        } else {
          if (!abortController.signal.aborted) {
            setTimeout(() => {
              if (!abortController.signal.aborted)
                setEstimateRetryCount((c) => c + 1);
            }, 3000);
          }
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return;
        if (!abortController.signal.aborted) {
          setTimeout(() => {
            if (!abortController.signal.aborted)
              setEstimateRetryCount((c) => c + 1);
          }, 3000);
        }
      }
    }, 400);

    return () => {
      if (estimateTimerRef.current) clearTimeout(estimateTimerRef.current);
      abortController.abort("cleanup");
    };
  }, [
    models,
    chairmanModel,
    totalAttachmentTokens,
    uploadedFiles,
    isAuthenticated,
    estimateRetryCount,
    conversationId,
    isDeliverable,
    ...extraDeps,
  ]);

  return {
    serverEstimate,
    setServerEstimate,
    isEstimating,
    costEstimateConfirmed,
    setEstimateRetryCount,
  };
}
