import { useRoute, useLocation, Link } from "wouter";
import { useConversation, useAddMessage, useCreateConversation, FetchError } from "@/hooks/use-conversations";
import { useConversationStatus } from "@/hooks/use-conversation-status";
import { useAuth } from "@/hooks/use-auth";
import { useUsage } from "@/hooks/use-usage";
import { EvidenceVault } from "@/components/council";
import { Loader, Paperclip, X, Image, FileText, StopCircle, Copy, Check, Clock, Star, User, RefreshCw, AlertTriangle, MessageCircle, Plus, Info, ArrowUp } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { authFetch } from "@/lib/clerk-token";
import { queryClient } from "@/lib/queryClient";
import { motion, AnimatePresence } from "framer-motion";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import { DEFAULT_COUNCIL_MODELS, DEFAULT_CHAIRMAN_MODEL, getModelById, getDebateCreditCost, FREE_TIER_CREDITS } from "@shared/models";

import { useFileUpload, useAdjustTextareaHeight } from "@/hooks/use-file-upload";
import { useCostEstimation } from "@/hooks/use-cost-estimation";
import { renderMarkdown, lightTheme } from "@/lib/markdown-renderer";
import InlineModelChip from "@/components/InlineModelChip";
import ChairmanChip from "@/components/ChairmanChip";
import { trackEvent } from "@/lib/analytics";

const messageSchema = z.object({
  message: z.string().min(1, "Give the Council more to work with."),
});

type MessageFormData = z.infer<typeof messageSchema>;

const MODEL_COLORS = ['#22c55e', '#3b82f6', '#a855f7'];
const MODEL_BG_COLORS = ['bg-green-50', 'bg-blue-50', 'bg-purple-50'];
const MODEL_TEXT_COLORS = ['text-green-700', 'text-blue-700', 'text-purple-700'];
const MODEL_BORDER_COLORS = ['border-green-200', 'border-blue-200', 'border-purple-200'];
const MODEL_DOT_COLORS = ['bg-green-500', 'bg-blue-500', 'bg-purple-500'];
const MODEL_ICON_BG = ['bg-green-100', 'bg-blue-100', 'bg-purple-100'];

const STAGE_MESSAGES: Record<string, string[]> = {
  hearing: [
    "Your council members are independently analyzing your question from different angles...",
    "Each model is forming its own thesis before the cross-examination begins.",
    "Independent analysis ensures no model anchors to another's first impression.",
  ],
  review: [
    "Cross-examination in progress — each model is challenging the others' reasoning...",
    "Models are identifying blind spots and weak assumptions in each other's arguments.",
    "The strongest ideas survive scrutiny. The weakest get replaced with better ones.",
  ],
  verdict: [
    "The Chairman is weighing all perspectives to form a decisive verdict...",
    "Synthesizing points of agreement and resolving key disagreements into a clear recommendation.",
    "Your final answer is being forged from the strongest arguments that survived debate.",
  ],
};

const FALLBACK_MESSAGES = [
  "Your question is being analyzed by multiple expert models working in parallel.",
  "Multi-model deliberation dramatically reduces blind spots and hallucinations.",
  "Every great verdict starts with genuine disagreement between independent perspectives.",
];

function StageProgressRotator({ stage, modelCount }: { stage: string | null; modelCount: number }) {
  const messages = (stage && STAGE_MESSAGES[stage]) || FALLBACK_MESSAGES;
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const stageRef = useRef(stage);

  useEffect(() => {
    if (stageRef.current !== stage) {
      stageRef.current = stage;
      setIndex(0);
      setVisible(true);
    }
  }, [stage]);

  useEffect(() => {
    let fadeTimeout: ReturnType<typeof setTimeout>;
    const interval = setInterval(() => {
      setVisible(false);
      fadeTimeout = setTimeout(() => {
        setIndex(prev => (prev + 1) % messages.length);
        setVisible(true);
      }, 500);
    }, 7000);
    return () => {
      clearInterval(interval);
      clearTimeout(fadeTimeout);
    };
  }, [messages]);

  const displayText = index === 0 && stage === 'hearing' && modelCount > 0
    ? `Your question is being analyzed by ${modelCount} expert models working independently...`
    : messages[index];

  return (
    <div className="flex-1 text-right ml-4 overflow-hidden" data-testid="stage-progress-container">
      <p
        className={`text-[11px] italic text-gray-400 transition-all duration-500 ease-in-out leading-tight ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
        }`}
        data-testid="stage-progress-text"
      >
        {displayText}
      </p>
    </div>
  );
}

function VerdictText({ content }: { content: string }) {
  return <>{renderMarkdown(content, lightTheme)}</>;
}

function useElapsedTime(startedAt: string | null | undefined) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const start = new Date(startedAt).getTime();
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return elapsed;
}

export default function Chat() {
  const [match, params] = useRoute("/chat/:id");
  const [, setLocation] = useLocation();
  const id = parseInt(params?.id || "0");
  const { data: conversation, isLoading, error } = useConversation(id);
  const { data: conversationStatus } = useConversationStatus(id);
  const addMessage = useAddMessage();
  const { isAuthenticated } = useAuth();
  const { data: usage } = useUsage(isAuthenticated);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {
    uploadedFiles, setUploadedFiles,
    pendingFiles, isUploading,
    tokenEstimates, setTokenEstimates,
    totalAttachmentTokens, pendingExtractions,
    fileError, setFileError,
    fileInputRef, handleFileUpload, removeFile, clearFiles,
  } = useFileUpload();
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; name: string } | null>(null);
  const [isExpandingCouncil, setIsExpandingCouncil] = useState(false);

  const { register, handleSubmit, reset, formState: { errors }, watch } = useForm<MessageFormData>({
    resolver: zodResolver(messageSchema),
  });

  const messageValue = watch("message");

  const adjustTextareaHeight = useAdjustTextareaHeight(textareaRef);

  useEffect(() => {
    adjustTextareaHeight();
  }, [messageValue, adjustTextareaHeight]);

  const handleCancelRequest = useCallback(async () => {
    if (!id || isCancelling) return;
    setIsCancelling(true);
    try {
      const response = await authFetch(`/api/conversations/${id}/cancel`, { method: 'POST' });
      if (response.ok) {
        const { queryClient } = await import('@/lib/queryClient');
        queryClient.invalidateQueries({ queryKey: ['/api/conversations', id] });
      }
    } catch (error) {
      console.error('Failed to cancel request:', error);
    } finally {
      setIsCancelling(false);
    }
  }, [id, isCancelling]);

  const handleRetryRequest = useCallback(async () => {
    if (!id || isRetrying) return;
    setIsRetrying(true);
    try {
      const response = await authFetch(`/api/conversations/${id}/retry`, { method: 'POST' });
      if (response.ok) {
        const { queryClient } = await import('@/lib/queryClient');
        queryClient.invalidateQueries({ queryKey: ['/api/conversations', id] });
        queryClient.invalidateQueries({ queryKey: ['/api/conversations', id, 'status'] });
      }
    } catch (error) {
      console.error('Failed to retry request:', error);
    } finally {
      setIsRetrying(false);
    }
  }, [id, isRetrying]);

  const [councilModelsOverride, setCouncilModelsOverride] = useState<string[] | null>(null);
  const [chairmanModelOverride, setChairmanModelOverride] = useState<string | null>(null);

  useEffect(() => {
    setCouncilModelsOverride(null);
    setChairmanModelOverride(null);
  }, [conversation?.models, conversation?.chairmanModel]);

  const councilModels = councilModelsOverride || conversation?.models || DEFAULT_COUNCIL_MODELS;
  const chairmanModel = chairmanModelOverride || conversation?.chairmanModel || DEFAULT_CHAIRMAN_MODEL;

  const isFreeUser = !usage?.isSubscribed && (usage?.debateCredits || 0) <= FREE_TIER_CREDITS;

  const approxPriorContextTokens = useMemo(() => {
    if (!conversation?.messages?.length) return 0;
    if (conversation.messages.length >= 4 && conversation.contextSummary) {
      return Math.ceil(conversation.contextSummary.length / 4);
    }
    const ctx = conversation.messages
      .map(m => `${m.role === 'user' ? 'User' : 'Chairman'}: ${m.content}`)
      .join("\n\n");
    return Math.ceil(ctx.length / 4);
  }, [conversation?.messages, conversation?.contextSummary]);

  const conversationMessageCount = conversation?.messages?.length ?? 0;
  const hasContextSummary = !!conversation?.contextSummary;

  const localCreditCost = getDebateCreditCost(councilModels, chairmanModel, totalAttachmentTokens, approxPriorContextTokens);
  const expandCreditCost = getDebateCreditCost(councilModels, chairmanModel, 0, approxPriorContextTokens);
  const hasEnoughCreditsForExpand = (usage?.debateCredits ?? 0) >= expandCreditCost;

  const {
    serverEstimate, setServerEstimate,
    isEstimating, costEstimateConfirmed, setEstimateRetryCount,
  } = useCostEstimation({
    models: councilModels,
    chairmanModel,
    totalAttachmentTokens,
    uploadedFiles,
    isAuthenticated,
    conversationId: id,
    extraDeps: [conversationMessageCount, hasContextSummary],
  });

  const handleSelectCouncilModel = useCallback((slotIndex: number, modelId: string) => {
    setCouncilModelsOverride(prev => {
      const current = prev || conversation?.models || DEFAULT_COUNCIL_MODELS;
      const updated = [...current];
      updated[slotIndex] = modelId;
      return updated;
    });
    setServerEstimate(null);
    setEstimateRetryCount(c => c + 1);
    trackEvent("model_selected", { modelId, slot: slotIndex, role: "council" });
  }, [conversation?.models, setServerEstimate, setEstimateRetryCount]);

  const handleSelectChairmanModel = useCallback((modelId: string) => {
    setChairmanModelOverride(modelId);
    setServerEstimate(null);
    setEstimateRetryCount(c => c + 1);
    trackEvent("model_selected", { modelId, role: "chairman" });
  }, [setServerEstimate, setEstimateRetryCount]);

  const creditCost = serverEstimate?.creditCost ?? localCreditCost;

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => {
    if (conversation?.title) {
      document.title = `${conversation.title} — Council Session`;
    } else {
      document.title = "Council Session";
    }
    return () => { document.title = "Council — AI Models That Debate to Find the Best Answer"; };
  }, [conversation?.title]);

  useEffect(() => {
    scrollToBottom();
  }, [conversation?.messages]);

  const isProcessing = conversation?.status === "processing";

  useEffect(() => {
    if (isProcessing) {
      scrollToBottom("auto");
    }
  }, [isProcessing, conversationStatus]);

  const userCredits = usage?.debateCredits ?? 0;
  const hasEnoughCreditsForReply = userCredits >= creditCost;
  const costPending = isEstimating || pendingExtractions > 0;
  const canSubmitReply = costEstimateConfirmed && hasEnoughCreditsForReply;

  const onSubmit = async (data: MessageFormData) => {
    if (!costEstimateConfirmed) {
      setFileError("Please wait for cost estimation to complete before sending.");
      return;
    }
    if (!hasEnoughCreditsForReply) {
      setFileError(`This reply costs ${creditCost} credit${creditCost !== 1 ? 's' : ''} but you only have ${userCredits}. Purchase more on the Credits page.`);
      return;
    }
    try {
      scrollToBottom("auto");
      await addMessage.mutateAsync({
        conversationId: id,
        prompt: data.message,
        attachments: uploadedFiles.length > 0 ? uploadedFiles : undefined,
        attachmentTokens: totalAttachmentTokens > 0 ? totalAttachmentTokens : undefined,
        expectedCost: creditCost > 0 ? creditCost : undefined,
        models: councilModelsOverride || undefined,
        chairmanModel: chairmanModelOverride || undefined,
      });
      reset();
      clearFiles();
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      queryClient.invalidateQueries({ queryKey: ["/api/user/usage"] });
    } catch (err: any) {
      const errorText = err?.message || "";
      const errorCode = (err as any)?.code || "";
      const serverCost = (err as any)?.creditCost;
      const serverDebateCredits = (err as any)?.debateCredits;
      if (errorCode === "COST_MISMATCH") {
        const actualCost = (err as any)?.actualCost ?? serverCost ?? creditCost;
        setServerEstimate(prev => prev
          ? { ...prev, creditCost: actualCost }
          : { creditCost: actualCost, userTier: 'free' }
        );
        setFileError(`The cost for this reply updated to ${actualCost} credit${actualCost !== 1 ? 's' : ''} (was ${creditCost}). Please review and send again.`);
        setEstimateRetryCount(c => c + 1);
      } else if (errorCode === "TIER_RESTRICTED") {
        setFileError("Please upgrade your plan to use these models.");
      } else if (errorCode === "PAYWALL" || errorText.includes("PAYWALL") || errorText.includes("credits")) {
        const costDisplay = serverCost ?? creditCost;
        const balanceDisplay = serverDebateCredits ?? userCredits;
        setFileError(errorText || `This reply costs ${costDisplay} credit${costDisplay !== 1 ? 's' : ''} but you only have ${balanceDisplay}. Purchase more on the Credits page.`);
        queryClient.invalidateQueries({ queryKey: ["/api/user/usage"] });
      } else {
        console.error("Failed to send message:", err);
        setFileError("Something went wrong. Try again in a moment.");
      }
      if (serverCost && errorCode !== "COST_MISMATCH") {
        setServerEstimate(prev => prev
          ? { ...prev, creditCost: serverCost }
          : { creditCost: serverCost, userTier: (err as any)?.tier || 'free' }
        );
      }
    }
  };

  const handleCopyVerdict = useCallback(async (content: string, messageId: number) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(messageId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  }, []);

  const handleExpandCouncil = useCallback(async () => {
    if (!id || isExpandingCouncil || conversation?.status === "processing" || addMessage.isPending || !hasEnoughCreditsForExpand) return;
    setIsExpandingCouncil(true);
    try {
      await addMessage.mutateAsync({
        conversationId: id,
        prompt: "Continue and expand on your analysis. Share additional insights the council discussed but didn't include in the verdict.",
        expectedCost: expandCreditCost > 0 ? expandCreditCost : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/user/usage"] });
    } catch (err: any) {
      console.error("Failed to expand council:", err);
      const errorCode = err?.code || "";
      const errorText = err?.message || "";
      if (errorCode === "COST_MISMATCH") {
        const actualCost = (err as any)?.actualCost ?? (err as any)?.creditCost ?? expandCreditCost;
        setServerEstimate(prev => prev
          ? { ...prev, creditCost: actualCost }
          : { creditCost: actualCost, userTier: 'free' }
        );
        setFileError(`The cost for expanding has updated to ${actualCost} credit${actualCost !== 1 ? 's' : ''} (was ${expandCreditCost}). Please try again.`);
        setEstimateRetryCount(c => c + 1);
      } else if (errorCode === "TIER_RESTRICTED") {
        setFileError("Please upgrade your plan to use these models.");
      } else if (errorCode === "PAYWALL" || errorText.includes("PAYWALL") || errorText.includes("credits")) {
        const serverCost = err?.creditCost;
        const serverDebateCredits = err?.debateCredits;
        const costDisplay = serverCost ?? expandCreditCost;
        const balanceDisplay = serverDebateCredits ?? (usage?.debateCredits ?? 0);
        setFileError(errorText || `This follow-up costs ${costDisplay} credit${costDisplay !== 1 ? 's' : ''} but you only have ${balanceDisplay}. Purchase more on the Credits page.`);
        queryClient.invalidateQueries({ queryKey: ["/api/user/usage"] });
      } else {
        setFileError("Something went wrong. Try again in a moment.");
      }
    } finally {
      setIsExpandingCouncil(false);
    }
  }, [id, isExpandingCouncil, conversation?.status, addMessage, hasEnoughCreditsForExpand, expandCreditCost, usage?.debateCredits]);

  const latestVerdictId = useMemo(() => {
    if (!conversation?.messages) return null;
    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      if (conversation.messages[i].role === 'chairman') return conversation.messages[i].id;
    }
    return null;
  }, [conversation?.messages]);

  const elapsed = useElapsedTime(conversationStatus?.startedAt);

  const errorInfo = useMemo(() => {
    if (conversation?.status !== 'error') return null;
    const reason = conversation?.errorReason || 'unknown';
    switch (reason) {
      case 'rate_limit':
        return {
          title: 'One of the AI models is temporarily overloaded',
          description: 'The model received too many requests at once. This usually resolves itself within a minute or two.',
        };
      case 'model_unavailable':
        return {
          title: 'A model in your council is currently unavailable',
          description: 'One of the AI models in your council is temporarily down for maintenance or experiencing issues.',
        };
      case 'timeout':
        return {
          title: 'The request took too long to complete',
          description: 'One or more models didn\'t respond in time. This can happen with complex questions or during high traffic.',
        };
      default:
        return {
          title: 'Something unexpected went wrong',
          description: 'An error occurred while processing your debate. Your credits have been refunded.',
        };
    }
  }, [conversation?.status, conversation?.errorReason]);

  const getPhaseState = (phase: 'hearing' | 'review' | 'verdict') => {
    if (!conversationStatus) return 'pending';
    const stages = ['hearing', 'review', 'verdict'];
    const currentIdx = stages.indexOf(conversationStatus.stage || '');
    const phaseIdx = stages.indexOf(phase);
    if (phaseIdx < currentIdx) return 'complete';
    if (phaseIdx === currentIdx) return 'active';
    return 'pending';
  };

  const getProgressPercent = () => {
    if (!conversationStatus) return 0;
    const stage = conversationStatus.stage;
    const completed = conversationStatus.stageProgress?.completed || 0;
    const total = conversationStatus.stageProgress?.total || 1;
    if (stage === 'hearing') return Math.round((completed / Math.max(total, 1)) * 33);
    if (stage === 'review') return 33 + Math.round((completed / Math.max(total, 1)) * 33);
    if (stage === 'verdict') return 66 + Math.round((completed / Math.max(total, 1)) * 34);
    return 0;
  };

  const getModelName = (modelId: string) => {
    const model = getModelById(modelId);
    return model?.name || modelId.split('/').pop() || modelId;
  };

  const getModelColorIndex = (modelId: string) => {
    const idx = councilModels.indexOf(modelId);
    return idx >= 0 ? idx % 3 : 0;
  };

  return (
    <div className="flex flex-col h-full min-h-[calc(100vh-24px)] relative">
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-[#f5f5f5] border border-[#eaeaea] flex items-center justify-center">
              <Loader className="w-6 h-6 text-[#737373] animate-spin" />
            </div>
            <p className="text-[15px] text-[#737373]">Initializing council session...</p>
          </motion.div>
        </div>
      ) : !conversation ? (
        !error ? (
          <div className="flex-1 flex items-center justify-center">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-[#f5f5f5] border border-[#eaeaea] flex items-center justify-center">
                <Loader className="w-6 h-6 text-[#737373] animate-spin" />
              </div>
              <p className="text-[15px] text-[#737373]">Loading council session...</p>
            </motion.div>
          </div>
        ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="bg-white rounded-2xl border border-[#eaeaea] shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.04)] p-8 max-w-md">
            {error instanceof FetchError && (error.status === 401 || error.status === 403) ? (
              <>
                <h2 className="text-2xl font-bold text-[#1a1a1a] mb-2" data-testid="text-auth-error-title">Please Sign In Again</h2>
                <p className="text-[15px] text-[#737373] mb-6" data-testid="text-auth-error-message">Your session has expired or you don't have access to this council session.</p>
                <button
                  onClick={() => window.location.reload()}
                  className="px-6 py-3 bg-[#1a1a1a] text-white rounded-lg font-medium hover:bg-[#2b2b2b] transition-colors border-0 cursor-pointer"
                  data-testid="button-refresh-auth"
                >
                  <RefreshCw className="w-4 h-4 inline mr-2" />
                  Refresh Page
                </button>
              </>
            ) : error instanceof FetchError && error.status === 404 ? (
              <>
                <h2 className="text-2xl font-bold text-[#1a1a1a] mb-2" data-testid="text-not-found-title">Session Not Found</h2>
                <p className="text-[15px] text-[#737373] mb-6" data-testid="text-not-found-message">This council session doesn't exist or has been archived.</p>
                <Link href="/">
                  <button className="px-6 py-3 bg-[#1a1a1a] text-white rounded-lg font-medium hover:bg-[#2b2b2b] transition-colors border-0 cursor-pointer" data-testid="button-new-question">
                    New Question
                  </button>
                </Link>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold text-[#1a1a1a] mb-2" data-testid="text-error-title">Something Went Wrong</h2>
                <p className="text-[15px] text-[#737373] mb-6" data-testid="text-error-message">We couldn't load this council session. This might be a temporary issue.</p>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  <button
                    onClick={() => queryClient.invalidateQueries({ queryKey: ['/api/conversations', id] })}
                    className="px-6 py-3 bg-[#1a1a1a] text-white rounded-lg font-medium hover:bg-[#2b2b2b] transition-colors border-0 cursor-pointer"
                    data-testid="button-retry-load"
                  >
                    <RefreshCw className="w-4 h-4 inline mr-2" />
                    Retry
                  </button>
                  <Link href="/">
                    <button className="px-6 py-3 bg-[#f5f5f5] text-[#1a1a1a] rounded-lg font-medium hover:bg-[#eaeaea] transition-colors border border-[#eaeaea] cursor-pointer" data-testid="button-go-home">
                      New Question
                    </button>
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
        )
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 pb-4">
            <div className="max-w-[1100px] mx-auto w-full space-y-6">
              <AnimatePresence>
                {conversation.messages.map((message, index) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05, duration: 0.3 }}
                    className="space-y-6"
                  >
                    {message.role === 'user' && (
                      <div className="bg-white rounded-2xl border border-[#eaeaea] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.04)]" data-testid={`message-user-${message.id}`}>
                        <div className="flex items-start gap-4">
                          <div className="w-10 h-10 rounded-full bg-[#f5f5f5] flex items-center justify-center shrink-0">
                            <User className="w-5 h-5 text-[#1a1a1a]" />
                          </div>
                          <div className="flex-1">
                            <div className="text-[13px] font-medium text-[#737373] mb-2">Your Question</div>
                            <p className="text-[15px] text-[#1a1a1a] leading-relaxed">{message.content}</p>
                            {(message as any).attachments && (message as any).attachments.length > 0 && (
                              <div className="flex flex-wrap gap-3 mt-3">
                                {(message as any).attachments.map((att: any, i: number) => {
                                  const isImage = att.type?.startsWith('image/');
                                  const isPdf = att.type === 'application/pdf';
                                  const isSpreadsheet = att.type === 'text/csv' ||
                                    att.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                                    att.type === 'application/vnd.ms-excel' ||
                                    att.name?.endsWith('.csv') || att.name?.endsWith('.xlsx') || att.name?.endsWith('.xls');

                                  if (isImage) {
                                    return (
                                      <button
                                        key={i}
                                        type="button"
                                        onClick={() => setLightboxImage({ url: att.url, name: att.name })}
                                        className="block group text-left cursor-pointer"
                                        data-testid={`attachment-image-${i}`}
                                      >
                                        <div className="relative rounded-lg overflow-hidden border border-[#eaeaea] shadow-sm hover:shadow-md transition-shadow max-w-[200px]">
                                          <img
                                            src={att.url}
                                            alt={att.name}
                                            className="w-full h-auto max-h-[160px] object-cover"
                                          />
                                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                                          <div className="px-2 py-1.5 bg-[#fafafa] border-t border-[#eaeaea]">
                                            <span className="text-[11px] text-[#737373] truncate block">{att.name}</span>
                                          </div>
                                        </div>
                                      </button>
                                    );
                                  }

                                  if (isPdf) {
                                    return (
                                      <a
                                        key={i}
                                        href={att.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="block"
                                        data-testid={`attachment-pdf-${i}`}
                                      >
                                        <div className="flex items-center gap-3 rounded-lg border border-[#eaeaea] bg-[#fafafa] px-4 py-3 hover:bg-[#f0f0f0] transition-colors shadow-sm hover:shadow-md max-w-[280px]">
                                          <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
                                            <FileText className="w-5 h-5 text-red-500" />
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <div className="text-[13px] font-medium text-[#1a1a1a] truncate">{att.name}</div>
                                            <div className="text-[11px] text-[#999]">PDF Document — Click to view</div>
                                          </div>
                                        </div>
                                      </a>
                                    );
                                  }

                                  if (isSpreadsheet) {
                                    return (
                                      <a
                                        key={i}
                                        href={att.url}
                                        download={att.name}
                                        className="block"
                                        data-testid={`attachment-spreadsheet-${i}`}
                                      >
                                        <div className="flex items-center gap-3 rounded-lg border border-[#eaeaea] bg-[#fafafa] px-4 py-3 hover:bg-[#f0f0f0] transition-colors shadow-sm hover:shadow-md max-w-[280px]">
                                          <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center shrink-0">
                                            <FileText className="w-5 h-5 text-green-600" />
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <div className="text-[13px] font-medium text-[#1a1a1a] truncate">{att.name}</div>
                                            <div className="text-[11px] text-[#999]">Spreadsheet — Click to download</div>
                                          </div>
                                        </div>
                                      </a>
                                    );
                                  }

                                  return (
                                    <a
                                      key={i}
                                      href={att.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="block"
                                      data-testid={`attachment-file-${i}`}
                                    >
                                      <div className="flex items-center gap-1.5 text-[12px] text-[#737373] bg-[#f5f5f5] px-2.5 py-1 rounded-md border border-[#eaeaea] hover:bg-[#ebebeb] transition-colors">
                                        <FileText className="w-3.5 h-3.5" />
                                        <span className="truncate max-w-[120px]">{att.name}</span>
                                      </div>
                                    </a>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {message.role === 'user' && message.status === 'processing' && !conversationStatus && (
                      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                        <div className="bg-white rounded-xl border border-[#eaeaea] p-6 shadow-sm flex flex-col items-center gap-4">
                          <Loader className="w-8 h-8 text-[#4f46e5] animate-spin" />
                          <p className="text-[15px] text-[#737373]">Preparing council session...</p>
                          <button
                            onClick={handleCancelRequest}
                            disabled={isCancelling}
                            className="flex items-center gap-1.5 text-[13px] font-medium text-red-500 hover:text-red-600 bg-transparent border-0 cursor-pointer disabled:opacity-50 p-0"
                            data-testid="button-cancel-loading"
                          >
                            <StopCircle className="w-4 h-4" />
                            {isCancelling ? 'Stopping...' : 'Stop'}
                          </button>
                        </div>
                      </motion.div>
                    )}

                    {message.role === 'user' && message.status === 'processing' && conversationStatus && (
                      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
                        <PhaseSection
                          phaseNum={1}
                          title="Phase 1: Individual Analysis"
                          description="Each AI is thinking independently"
                          state={getPhaseState('hearing')}
                          models={councilModels}
                          status={conversationStatus}
                          getModelName={getModelName}
                          getModelColorIndex={getModelColorIndex}
                          onCancel={handleCancelRequest}
                          isCancelling={isCancelling}
                          elapsed={elapsed}
                        />
                        <PhaseSection
                          phaseNum={2}
                          title="Phase 2: The Debate"
                          description="AIs are challenging each other's solutions"
                          state={getPhaseState('review')}
                          models={councilModels}
                          status={conversationStatus}
                          getModelName={getModelName}
                          getModelColorIndex={getModelColorIndex}
                          onCancel={handleCancelRequest}
                          isCancelling={isCancelling}
                        />
                        <PhaseSection
                          phaseNum={3}
                          title="Phase 3: Final Verdict"
                          description="Lead AI will synthesize the best answer"
                          state={getPhaseState('verdict')}
                          models={councilModels}
                          status={conversationStatus}
                          getModelName={getModelName}
                          getModelColorIndex={getModelColorIndex}
                          chairmanModel={chairmanModel}
                          onCancel={handleCancelRequest}
                          isCancelling={isCancelling}
                        />

                        {conversationStatus?.isStuck && conversationStatus?.stuckMessage && (
                          <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 flex items-start gap-3" data-testid="warning-stuck-processing">
                            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                            <div className="flex-1">
                              <p className="text-[13px] text-amber-800 font-medium">{conversationStatus.stuckMessage}</p>
                              <div className="flex items-center gap-3 mt-2">
                                <button
                                  onClick={handleCancelRequest}
                                  disabled={isCancelling}
                                  className="flex items-center gap-1.5 text-[12px] font-medium text-amber-700 hover:text-amber-900 bg-transparent border-0 cursor-pointer disabled:opacity-50 p-0"
                                  data-testid="button-cancel-stuck"
                                >
                                  <StopCircle className="w-3.5 h-3.5" />
                                  {isCancelling ? 'Cancelling...' : 'Cancel'}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="bg-white rounded-xl border border-[#eaeaea] p-5 shadow-sm">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[13px] font-medium text-[#1a1a1a]">Overall Progress</span>
                            <span className="text-[13px] font-semibold text-[#4f46e5]">{getProgressPercent()}%</span>
                          </div>
                          <div className="w-full bg-[#f3f4f6] rounded-full h-2">
                            <div className="bg-[#4f46e5] h-2 rounded-full transition-all duration-500" style={{ width: `${getProgressPercent()}%` }} />
                          </div>
                          <div className="flex items-center gap-2 text-[12px] text-[#737373] mt-3">
                            <Clock className="w-3.5 h-3.5" />
                            <span>{elapsed}s elapsed · {elapsed <= 90 ? 'Usually takes 30–90 seconds' : elapsed <= 150 ? 'Premium models require deep analysis...' : elapsed <= 240 ? 'Resolving conflicting viewpoints...' : 'Synthesizing your master verdict... nearly there.'}</span>
                          </div>
                          <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#eaeaea]">
                            <div className="flex items-center gap-3">
                              {(conversationStatus?.isStuck || conversationStatus?.failures?.length > 0) && (
                                <button
                                  onClick={handleRetryRequest}
                                  disabled={isRetrying}
                                  className="flex items-center gap-1.5 text-[12px] font-medium text-[#4f46e5] hover:text-[#4338ca] bg-transparent border-0 cursor-pointer disabled:opacity-50 p-0"
                                  data-testid="button-retry"
                                >
                                  <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
                                  {isRetrying ? 'Retrying...' : 'Retry'}
                                </button>
                              )}
                              <button
                                onClick={handleCancelRequest}
                                disabled={isCancelling}
                                className="flex items-center gap-1.5 text-[12px] font-medium text-red-500 hover:text-red-600 bg-transparent border-0 cursor-pointer disabled:opacity-50 p-0"
                                data-testid="button-cancel"
                              >
                                <StopCircle className="w-3.5 h-3.5" />
                                {isCancelling ? 'Stopping...' : 'Stop'}
                              </button>
                            </div>
                            <StageProgressRotator stage={conversationStatus?.stage || null} modelCount={councilModels.length} />
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {message.role === 'chairman' && (
                      <div className="bg-white rounded-2xl border border-[#eaeaea] shadow-[0_8px_32px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)] overflow-hidden" data-testid={`message-verdict-${message.id}`}>
                        <div className="px-6 py-5 border-b border-[#eaeaea] flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-[#4f46e5] flex items-center justify-center shadow-sm">
                              <Star className="w-5 h-5 text-white" />
                            </div>
                            <div>
                              <h2 className="text-lg font-bold text-[#1a1a1a]">The Verdict</h2>
                              <p className="text-[12px] text-[#737373]">Final answer synthesized by {getModelName(chairmanModel)} (Lead)</p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleCopyVerdict(message.content, message.id)}
                            className="flex items-center gap-2 px-4 py-2 text-[13px] font-medium text-[#1a1a1a] bg-[#f5f5f5] border border-[#eaeaea] rounded-lg hover:bg-[#eaeaea] transition-colors cursor-pointer"
                            data-testid={`button-copy-${message.id}`}
                          >
                            {copiedId === message.id ? (
                              <><Check className="w-4 h-4 text-green-600" /> Copied!</>
                            ) : (
                              <><Copy className="w-4 h-4" /> Copy</>
                            )}
                          </button>
                        </div>

                        <div className="px-8 py-8 md:px-10">
                          <VerdictText content={message.content} />
                        </div>

                        <div className="px-6 pb-6 pt-2 space-y-4">
                          <div className="bg-[#f5f5f5] rounded-xl p-4 border border-[#eaeaea]">
                            <p className="text-[11px] text-[#737373] mb-3 font-semibold uppercase tracking-wider">Council Contributors</p>
                            <div className="flex flex-wrap gap-2">
                              {councilModels.map((modelId, i) => {
                                const colorIdx = i % 3;
                                return (
                                  <span
                                    key={modelId}
                                    className={`inline-flex items-center gap-1.5 ${MODEL_BG_COLORS[colorIdx]} ${MODEL_TEXT_COLORS[colorIdx]} px-3 py-1.5 rounded-full text-[12px] font-medium border ${MODEL_BORDER_COLORS[colorIdx]}`}
                                  >
                                    <div className={`w-1.5 h-1.5 rounded-full ${MODEL_DOT_COLORS[colorIdx]}`} />
                                    {getModelName(modelId)}
                                  </span>
                                );
                              })}
                            </div>
                            {isFreeUser && (
                              <div className="mt-3 pt-3 border-t border-[#e0e0e0]">
                                <p className="text-[12px] text-[#737373]">
                                  Want deeper analysis? <Link href="/credits" className="text-[#4f46e5] hover:text-[#4338ca] font-medium hover:underline transition-colors" data-testid="link-upsell-credits">Purchase credits</Link> to unlock premium AI models.
                                </p>
                              </div>
                            )}
                          </div>

                        </div>
                      </div>
                    )}

                    {message.role === 'user' &&
                     message.councilResponses &&
                     message.councilResponses.length > 0 &&
                     message.status !== 'processing' && (
                      <EvidenceVault responses={message.councilResponses} />
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>

              <div ref={messagesEndRef} />
            </div>
          </div>

          {(conversation.status === 'error' || conversation.status === 'cancelled') && !isProcessing && (
            <div className="shrink-0 w-full px-6 pb-2 flex justify-center">
              <div className="w-full max-w-[960px]">
                <div className="bg-white rounded-2xl border border-[#eaeaea] shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.04)] p-6 flex flex-col items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${conversation.status === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} />
                    <span className="text-[15px] font-medium text-[#1a1a1a]" data-testid="text-conversation-status">
                      {conversation.status === 'error'
                        ? (errorInfo?.title || 'This debate encountered an error')
                        : 'This debate was cancelled'}
                    </span>
                  </div>
                  <p className="text-[13px] text-[#737373] text-center max-w-md" data-testid="text-error-description">
                    {conversation.status === 'error'
                      ? (errorInfo?.description || 'Something went wrong during processing.')
                      : 'This debate was stopped before completion. You can retry to start the analysis again.'}
                  </p>
                  <div className="flex items-center gap-3 flex-wrap justify-center">
                    <button
                      onClick={handleRetryRequest}
                      disabled={isRetrying}
                      className="px-5 py-2.5 bg-[#1a1a1a] text-white rounded-lg font-medium hover:bg-[#2b2b2b] transition-colors border-0 cursor-pointer disabled:opacity-50 flex items-center gap-2 text-[13px]"
                      data-testid="button-retry-debate"
                    >
                      {isRetrying ? <Loader className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      {isRetrying ? 'Retrying...' : 'Retry This Debate'}
                    </button>
                    <Link
                      href="/"
                      className="px-5 py-2.5 bg-[#f5f5f5] text-[#1a1a1a] rounded-lg font-medium hover:bg-[#eaeaea] transition-colors border border-[#e0e0e0] flex items-center gap-2 text-[13px] no-underline"
                      data-testid="link-start-new-chat"
                    >
                      <Plus className="w-4 h-4" />
                      Start New Chat
                    </Link>
                    <button
                      onClick={() => window.dispatchEvent(new Event('open-support-widget'))}
                      className="px-5 py-2.5 bg-transparent text-[#737373] rounded-lg font-medium hover:bg-[#f5f5f5] hover:text-[#1a1a1a] transition-colors border border-[#e0e0e0] cursor-pointer flex items-center gap-2 text-[13px]"
                      data-testid="button-contact-support"
                    >
                      <MessageCircle className="w-4 h-4" />
                      Contact Support
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!isProcessing && conversation.status !== 'error' && conversation.status !== 'cancelled' && (
            <div className="shrink-0 w-full bg-gradient-to-t from-white via-white to-transparent pt-8 pb-6 px-6 flex justify-center">
              <div className="w-full max-w-[960px]">
                {(uploadedFiles.length > 0 || pendingFiles.length > 0) && (
                  <div className="flex gap-2 mb-2 px-1 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                    {pendingFiles.map((file) => (
                      <div
                        key={file.id}
                        data-testid={`pending-file-${file.id}`}
                        className={`flex items-center gap-2 px-3 py-2 bg-white border rounded-lg text-sm shrink-0 ${file.status === 'error' ? 'border-red-300' : 'border-[#eaeaea]'}`}
                      >
                        {file.status === 'error' ? <X className="w-4 h-4 text-red-500" /> : <Loader className="w-4 h-4 text-[#737373] animate-spin" />}
                        <span className="truncate max-w-32 text-[#1a1a1a] text-[13px]">
                          {file.status === 'compressing' ? 'Compressing...' : file.status === 'error' ? 'Failed' : file.name}
                        </span>
                      </div>
                    ))}
                    {uploadedFiles.map((file, index) => (
                      <div key={index} data-testid={`uploaded-file-${index}`} className="flex items-center gap-2 px-3 py-2 bg-white border border-[#eaeaea] rounded-lg text-sm shrink-0">
                        {file.type.startsWith('image/') ? <Image className="w-4 h-4 text-[#4f46e5]" /> : <FileText className="w-4 h-4 text-[#737373]" />}
                        <span className="truncate max-w-32 text-[#1a1a1a] text-[13px]">{file.name}</span>
                        <button type="button" onClick={() => removeFile(index)} className="ml-1 p-0.5 rounded-full hover:bg-[#f5f5f5] transition-colors bg-transparent border-0 cursor-pointer" data-testid={`button-remove-file-${index}`}>
                          <X className="w-3 h-3 text-[#737373]" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {fileError && (
                  <div className="text-xs text-red-500 px-2 py-1.5 mb-1" data-testid="text-file-error">{fileError}</div>
                )}

                <form onSubmit={handleSubmit(onSubmit)}>
                  <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleFileUpload(e.target.files)} accept="image/*,.pdf,.doc,.docx,.txt,.md,.json,.csv" />
                  <div className="rounded-2xl border border-[#eaeaea] shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.04)] flex flex-col bg-white">
                    <div className="relative p-4">
                      <textarea
                        {...register("message")}
                        ref={(e) => { register("message").ref(e); (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = e; }}
                        data-testid="input-message"
                        placeholder={hasEnoughCreditsForReply ? "Reply to the verdict or ask a follow-up question..." : `You need ${creditCost} credits to reply. Purchase more on the Credits page.`}
                        disabled={isProcessing || !hasEnoughCreditsForReply}
                        rows={2}
                        onInput={adjustTextareaHeight}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(onSubmit)(); } }}
                        className="w-full resize-none outline-none text-[15px] placeholder-[#737373]/50 min-h-[60px] bg-transparent leading-relaxed pr-28 font-sans text-[#1a1a1a]"
                      />
                      <div className="absolute bottom-4 right-14 w-10 h-8 bg-gradient-to-r from-transparent to-white pointer-events-none" />
                      <button
                        type="submit"
                        disabled={addMessage.isPending || !canSubmitReply || costPending}
                        className="absolute bottom-4 right-4 w-8 h-8 bg-[#1a1a1a] hover:bg-[#2b2b2b] rounded-lg flex items-center justify-center shadow-sm border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        data-testid="button-send"
                        title="Run Council"
                      >
                        {addMessage.isPending ? <Loader className="w-4 h-4 text-white animate-spin" /> : <ArrowUp className="w-4 h-4 text-white" />}
                      </button>
                    </div>

                    <div className="bg-[#f5f5f5]/50 px-4 py-3 border-t border-[#eaeaea] rounded-b-2xl overflow-visible">
                        <div className="flex items-center gap-3 min-w-0 overflow-visible">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isProcessing || isUploading}
                            className="text-[#737373] hover:text-[#1a1a1a] transition-colors flex items-center justify-center w-7 h-7 rounded-md hover:bg-[#eaeaea] bg-transparent border-0 cursor-pointer disabled:opacity-50 shrink-0"
                            data-testid="button-upload"
                          >
                            {isUploading ? <Loader className="w-[13px] h-[13px] animate-spin" /> : <Paperclip className="w-[13px] h-[13px]" />}
                          </button>
                          <div className="h-4 w-px bg-[#d1d5db] shrink-0" />
                          <div className="flex items-center gap-1.5 min-w-0 flex-nowrap overflow-visible">
                            <span className="text-[11px] font-medium text-[#737373] uppercase tracking-wider mr-1 shrink-0">Council:</span>
                            {councilModels.map((modelId, index) => (
                              <InlineModelChip
                                key={index}
                                modelId={modelId}
                                slotIndex={index}
                                selectedModels={councilModels}
                                onSelectModel={handleSelectCouncilModel}
                                isFreeUser={isFreeUser}
                                dotColor={MODEL_COLORS[index]}
                              />
                            ))}
                            <div className="w-px h-4 bg-[#d1d5db] mx-0.5 shrink-0" />
                            <ChairmanChip
                              modelId={chairmanModel}
                              onSelectModel={handleSelectChairmanModel}
                              isFreeUser={isFreeUser}
                            />
                          {(messageValue?.trim().length ?? 0) >= 1 && (
                            !costEstimateConfirmed ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md text-[#737373] bg-[#f5f5f5] border border-[#eaeaea] animate-pulse" data-testid="badge-credit-cost">
                                Estimating...
                                <TooltipProvider delayDuration={200}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button type="button" className="inline-flex items-center justify-center text-[#737373] hover:text-[#1a1a1a] transition-colors bg-transparent border-0 cursor-pointer p-0" data-testid="button-council-info">
                                        <Info className="w-3 h-3" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-[320px] bg-[#1a1a1a] text-white border-[#333] p-3 text-[12px] leading-relaxed" side="top" align="end">
                                      <p className="m-0">Calculating approximate credit cost for this reply based on your selected models.</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </span>
                            ) : (
                              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md ${
                                !hasEnoughCreditsForReply
                                  ? 'text-red-500 bg-red-50 border border-red-200'
                                  : 'text-amber-700 bg-amber-50 border border-amber-200'
                              }`} data-testid="badge-credit-cost">
                                ≈ {creditCost} credits
                                <TooltipProvider delayDuration={200}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button type="button" className="inline-flex items-center justify-center text-current hover:opacity-70 transition-opacity bg-transparent border-0 cursor-pointer p-0" data-testid="button-council-info">
                                        <Info className="w-3 h-3" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-[320px] bg-[#1a1a1a] text-white border-[#333] p-3 text-[12px] leading-relaxed" side="top" align="end">
                                      <p className="m-0">This launches a council debate. 4 AI models will independently analyze your prompt, debate and challenge each other across 3 rounds, and synthesize a single, unified, highly intelligent answer.</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    </div>

                  </div>
                </form>
                {errors.message && <p className="text-red-500 text-xs mt-2 px-2">{errors.message.message}</p>}
                <p className="text-center text-[11px] text-[#737373] mt-4">AI models can make mistakes. Verify important information.</p>
              </div>
            </div>
          )}
        </>
      )}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setLightboxImage(null)}
          data-testid="lightbox-overlay"
        >
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setLightboxImage(null)}
              className="absolute -top-10 right-0 text-white hover:text-gray-300 transition-colors"
              data-testid="lightbox-close"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={lightboxImage.url}
              alt={lightboxImage.name}
              className="max-w-full max-h-[85vh] rounded-lg shadow-2xl object-contain"
            />
            <div className="mt-2 text-center text-white/80 text-sm">{lightboxImage.name}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function PhaseSection({
  phaseNum, title, description, state, models, status, getModelName, getModelColorIndex, chairmanModel, onCancel, isCancelling, elapsed
}: {
  phaseNum: number;
  title: string;
  description: string;
  state: 'complete' | 'active' | 'pending';
  models: string[];
  status: any;
  getModelName: (id: string) => string;
  getModelColorIndex: (id: string) => number;
  chairmanModel?: string;
  onCancel: () => void;
  isCancelling: boolean;
  elapsed?: number;
}) {
  const statusLabel = state === 'complete' ? 'Complete' : state === 'active' ? 'In Progress' : 'Pending';
  const statusColor = state === 'complete' ? 'text-green-600' : state === 'active' ? 'text-[#4f46e5]' : 'text-[#737373]';

  return (
    <div className={state === 'pending' ? 'opacity-40' : ''}>
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
          state === 'complete' ? 'bg-green-100' :
          state === 'active' ? 'bg-[#eef2ff] animate-pulse' :
          'bg-[#f5f5f5]'
        }`}>
          {state === 'complete' ? (
            <Check className="w-4 h-4 text-green-600" />
          ) : state === 'active' ? (
            <Loader className="w-4 h-4 text-[#4f46e5] animate-spin" />
          ) : phaseNum === 3 ? (
            <Star className="w-4 h-4 text-[#737373]" />
          ) : (
            <div className="w-4 h-4 rounded-full bg-[#d1d5db]" />
          )}
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-[15px] text-[#1a1a1a]">{title}</h3>
          <p className="text-[13px] text-[#737373]">{description}</p>
        </div>
        <span className={`text-[12px] font-medium ${statusColor}`}>{statusLabel}</span>
      </div>

      {phaseNum === 1 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 ml-11">
          {models.map((modelId) => {
            const colorIdx = getModelColorIndex(modelId);
            const modelStatus = status?.modelStatuses?.find((ms: any) => ms.model === modelId);
            const isComplete = modelStatus?.initialComplete;
            const isFailed = modelStatus?.failed;
            return (
              <div key={modelId} className="bg-white rounded-xl border border-[#eaeaea] p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-2 h-2 rounded-full ${MODEL_DOT_COLORS[colorIdx]}`} />
                  <span className="text-[13px] font-semibold text-[#1a1a1a]">{getModelName(modelId)}</span>
                </div>
                <div className="flex items-center gap-2 text-[12px] text-[#737373]">
                  {isFailed ? (
                    <><X className="w-3.5 h-3.5 text-red-500" /><span className="text-red-500">Failed</span></>
                  ) : isComplete ? (
                    <><Check className="w-3.5 h-3.5 text-green-600" /><span>Analysis complete</span></>
                  ) : state === 'active' ? (
                    <><Loader className="w-3.5 h-3.5 animate-spin text-[#4f46e5]" /><span>{(elapsed ?? 0) >= 90 ? "This model requires more time..." : "Analyzing..."}</span></>
                  ) : (
                    <span>Waiting...</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {phaseNum === 2 && state !== 'pending' && (
        <div className="ml-11 bg-white rounded-xl border border-[#eaeaea] p-5 shadow-sm">
          <div className="space-y-4">
            {models.map((modelId) => {
              const colorIdx = getModelColorIndex(modelId);
              const modelStatus = status?.modelStatuses?.find((ms: any) => ms.model === modelId);
              const isReviewComplete = modelStatus?.reviewComplete;
              const isFailed = modelStatus?.failed;
              return (
                <div key={modelId} className="flex items-start gap-3">
                  <div className={`w-6 h-6 rounded-full ${MODEL_ICON_BG[colorIdx]} flex items-center justify-center shrink-0 ${state === 'active' && !isReviewComplete && !isFailed ? 'animate-pulse' : ''}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${MODEL_DOT_COLORS[colorIdx]}`} />
                  </div>
                  <div className="flex-1">
                    <div className="text-[12px] font-medium text-[#1a1a1a] mb-1">{getModelName(modelId)}</div>
                    <div className="text-[13px] text-[#737373]">
                      {isFailed ? (
                        <span className="text-red-500">Review failed</span>
                      ) : isReviewComplete ? (
                        'Cross-examination complete'
                      ) : state === 'active' ? (
                        <span className="flex items-center gap-1">
                          Analyzing arguments
                          <span className="inline-flex gap-0.5 ml-1">
                            <span className="w-1 h-1 rounded-full bg-[#737373] animate-bounce" style={{ animationDelay: '0s' }} />
                            <span className="w-1 h-1 rounded-full bg-[#737373] animate-bounce" style={{ animationDelay: '0.2s' }} />
                            <span className="w-1 h-1 rounded-full bg-[#737373] animate-bounce" style={{ animationDelay: '0.4s' }} />
                          </span>
                        </span>
                      ) : (
                        'Waiting for debate phase...'
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {phaseNum === 3 && (
        <div className={`ml-11 bg-white rounded-xl border border-[#eaeaea] p-5 shadow-sm ${state === 'pending' ? 'opacity-60' : ''}`}>
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${state === 'active' ? 'bg-[#eef2ff] animate-pulse' : 'bg-[#f5f5f5]'}`}>
              <Star className={`w-4 h-4 ${state === 'active' ? 'text-[#4f46e5]' : 'text-[#737373]'}`} />
            </div>
            <div>
              <div className="text-[13px] font-semibold text-[#1a1a1a] mb-0.5">
                {chairmanModel ? getModelName(chairmanModel) : 'Lead AI'} (Lead)
              </div>
              <div className="text-[12px] text-[#737373]">
                {state === 'active' ? 'Synthesizing the final answer...' : 'Will review all arguments and provide the optimal solution'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
