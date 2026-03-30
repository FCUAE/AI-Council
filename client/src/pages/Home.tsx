import { useCreateConversation } from "@/hooks/use-conversations";
import { useAuth } from "@/hooks/use-auth";
import { useUsage } from "@/hooks/use-usage";
import { useClerk } from "@clerk/react";
import { useLocation } from "wouter";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { AnimatePresence, motion } from "framer-motion";
import InlineModelChip from "@/components/InlineModelChip";
import ChairmanChip from "@/components/ChairmanChip";

import { DEFAULT_COUNCIL_MODELS, DEFAULT_CHAIRMAN_MODEL, getDebateCreditCost, FREE_TIER_CREDITS, DELIVERABLE_KEYWORDS } from "@shared/models";

import { useFileUpload, useAdjustTextareaHeight } from "@/hooks/use-file-upload";
import { useCostEstimation } from "@/hooks/use-cost-estimation";
import { Brain, MessageSquareMore, Star, Paperclip, X, Info, ArrowUp, Zap } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { 
  Document,
  Image as ImageIcon,
  Close,
  Reset,
} from "@carbon/icons-react";

const MODEL_COLORS = ['#22c55e', '#3b82f6', '#a855f7'];

const ROTATING_WORDS = ["advice", "strategy", "campaign", "business plan", "code", "copy", "pitch"];
let globalWordIndex = 0;
let globalWordInterval: ReturnType<typeof setInterval> | null = null;

function startGlobalWordRotation(setWordIndex: (i: number) => void) {
  if (globalWordInterval) clearInterval(globalWordInterval);
  setWordIndex(globalWordIndex);
  globalWordInterval = setInterval(() => {
    globalWordIndex = (globalWordIndex + 1) % ROTATING_WORDS.length;
    setWordIndex(globalWordIndex);
  }, 2400);
  return () => {
    if (globalWordInterval) {
      clearInterval(globalWordInterval);
      globalWordInterval = null;
    }
  };
}

export default function Home() {
  const [, setLocation] = useLocation();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();
  const [wordIndex, setWordIndex] = useState(globalWordIndex);

  useEffect(() => {
    return startGlobalWordRotation(setWordIndex);
  }, []);

  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const clerk = useClerk();
  const { data: usage, refetch: refetchUsage } = useUsage(isAuthenticated);
  const createConversation = useCreateConversation();


  useEffect(() => {
    document.title = "Council \u2014 AI Models That Debate to Find the Best Answer";
  }, []);
  
  const {
    uploadedFiles, setUploadedFiles,
    pendingFiles, isUploading,
    tokenEstimates, setTokenEstimates,
    totalAttachmentTokens, pendingExtractions,
    fileError: fileUploadError, setFileError: setFileUploadError,
    fileInputRef, handleFileUpload, removeFile, clearFiles,
  } = useFileUpload();

  const adjustTextareaHeight = useAdjustTextareaHeight(textareaRef);
  
  const [selectedModels, setSelectedModels] = useState<string[]>([...DEFAULT_COUNCIL_MODELS]);
  const [chairmanModel, setChairmanModel] = useState<string>(DEFAULT_CHAIRMAN_MODEL);

  const isFreeUser = !usage?.isSubscribed && (usage?.debateCredits || 0) <= FREE_TIER_CREDITS;

  const isDeliverable = DELIVERABLE_KEYWORDS.test(prompt);
  const localCreditCost = getDebateCreditCost(selectedModels, chairmanModel, totalAttachmentTokens, 0, isDeliverable);

  const {
    serverEstimate, setServerEstimate,
    isEstimating, costEstimateConfirmed, setEstimateRetryCount,
  } = useCostEstimation({
    models: selectedModels,
    chairmanModel,
    totalAttachmentTokens,
    uploadedFiles,
    isAuthenticated,
    prompt,
    isDeliverable,
  });

  const creditCost = serverEstimate?.creditCost ?? localCreditCost;
  const userCredits = usage?.debateCredits || 0;
  const hasEnoughCredits = userCredits >= creditCost;
  const costPending = isEstimating || pendingExtractions > 0;
  const canSubmit = isAuthenticated ? (costEstimateConfirmed && hasEnoughCredits) : true;

  const upsellTrackedRef = useRef(false);
  useEffect(() => {
    if (isAuthenticated && usage && usage.debateCredits === 0 && !upsellTrackedRef.current) {
      upsellTrackedRef.current = true;
      trackEvent("upsell_shown", { location: "home" });
    }
  }, [isAuthenticated, usage]);

  const handleSelectModel = (slotIndex: number, modelId: string) => {
    const newModels = [...selectedModels];
    newModels[slotIndex] = modelId;
    setSelectedModels(newModels);
  };

  const resetToDefaults = () => {
    setSelectedModels([...DEFAULT_COUNCIL_MODELS]);
    setChairmanModel(DEFAULT_CHAIRMAN_MODEL);
  };

  const isDefaultConfig = JSON.stringify(selectedModels) === JSON.stringify(DEFAULT_COUNCIL_MODELS) 
    && chairmanModel === DEFAULT_CHAIRMAN_MODEL;

  useEffect(() => {
    adjustTextareaHeight();
  }, [prompt, adjustTextareaHeight]);

  const handleSubmit = async () => {
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt.length < 5) {
      setError("Give the Council more to work with \u2014 at least 5 characters.");
      return;
    }
    setError(null);

    if (!isAuthenticated) {
      sessionStorage.setItem("council_pending_prompt", trimmedPrompt);
      sessionStorage.setItem("council_pending_models", JSON.stringify(selectedModels));
      sessionStorage.setItem("council_pending_chairman", chairmanModel);
      try { clerk.openSignIn(); } catch { clerk.redirectToSignIn({ redirectUrl: window.location.href }); }
      return;
    }

    if (!costEstimateConfirmed) {
      setError("Please wait for cost estimation to complete before submitting.");
      return;
    }

    if (usage && !hasEnoughCredits) {
      setError(`Insufficient credits. This debate costs ${creditCost} credit${creditCost !== 1 ? 's' : ''} but you only have ${userCredits}. Purchase more on the Credits page.`);
      return;
    }
    
    try {
      const result = await createConversation.mutateAsync({
        prompt: trimmedPrompt,
        attachments: uploadedFiles.length > 0 ? uploadedFiles : undefined,
        models: selectedModels,
        chairmanModel: chairmanModel,
        attachmentTokens: totalAttachmentTokens > 0 ? totalAttachmentTokens : undefined,
      });
      clearFiles();
      setPrompt("");
      refetchUsage();
      setLocation(`/chat/${result.id}`);
    } catch (err: any) {
      const errorText = err?.message || "";
      const errorCode = (err as any)?.code || "";
      const serverCost = (err as any)?.creditCost;
      const serverDebateCredits = (err as any)?.debateCredits;
      if (errorCode === "PAYWALL" || errorText.includes("PAYWALL") || errorText.includes("credits")) {
        const costDisplay = serverCost ?? creditCost;
        const balanceDisplay = serverDebateCredits ?? userCredits;
        setError(errorText || `Insufficient credits. This debate costs ${costDisplay} credit${costDisplay !== 1 ? 's' : ''} but you only have ${balanceDisplay}. Purchase more on the Credits page.`);
      } else {
        console.error("Failed to create conversation:", err);
        setError("Something went wrong. Please try again.");
      }
      if (serverCost) {
        setServerEstimate(prev => prev
          ? { ...prev, creditCost: serverCost }
          : { creditCost: serverCost, userTier: (err as any)?.tier || 'free' }
        );
      }
    }
  };

  const featureCards = [
    {
      icon: <Brain className="w-[15px] h-[15px] text-[#737373]" />,
      title: "Step 1",
      description: "Each AI comes up with its own answer first.",
    },
    {
      icon: <MessageSquareMore className="w-[15px] h-[15px] text-[#737373]" />,
      title: "Step 2",
      description: "The AIs debate, challenging each other to find the strongest solution.",
    },
    {
      icon: <Star className="w-[15px] h-[15px] text-[#737373]" />,
      title: "Step 3",
      description: "A Lead AI takes the best parts of the debate and builds your final result.",
      hasLeadBadge: true,
    },
  ];

  return (
    <div className="flex flex-col flex-1 h-full">
      <div className="flex-1 flex flex-col items-center justify-center px-4 md:px-8 pb-0">
        <div className="w-full max-w-[960px] mx-auto">
          <div className="flex flex-col items-center text-center mb-8">
            <div className="inline-flex items-center gap-2 bg-[#f5f5f5] border border-[#eaeaea] rounded-full px-4 py-1.5 mb-6">
              <span className="relative flex items-center justify-center">
                <span className="w-2 h-2 bg-[#4f46e5] rounded-full" />
                <span className="absolute w-3.5 h-0.5 bg-[#4f46e5] rounded-full opacity-[0.12]" />
              </span>
              <span className="font-medium text-xs text-[#1a1a1a] tracking-[-0.5px]">AI Council v2.0 is live</span>
            </div>

            <h1 className="font-semibold text-[28px] leading-[36px] md:text-[48px] md:leading-[56px] text-[#1a1a1a] tracking-[-0.7px] mb-4" data-testid="text-hero-title">
              Ask once. AIs debate. You get the<br className="hidden md:inline" />
              {" "}most intelligent{" "}
              <span className="inline-block relative overflow-hidden align-bottom" style={{ height: isMobile ? '36px' : '56px' }}>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={ROTATING_WORDS[wordIndex]}
                    className="inline-block bg-gradient-to-r from-[#4f46e5] to-[#7c3aed] bg-clip-text text-transparent"
                    initial={{ y: 40, opacity: 0, filter: "blur(4px)" }}
                    animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
                    exit={{ y: -40, opacity: 0, filter: "blur(4px)" }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  >
                    {ROTATING_WORDS[wordIndex]}.
                  </motion.span>
                </AnimatePresence>
              </span>
            </h1>

            <p className="font-normal text-[17px] leading-7 text-[#737373] tracking-[-0.5px] max-w-[672px]" data-testid="text-hero-subtitle">
              It's like the most intelligent people on earth working on your problem.
            </p>

          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5 mb-6" data-testid="feature-cards">
            {featureCards.map((card, index) => (
              <div
                key={index}
                className="bg-white border border-[#eaeaea] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.02)] p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.04)]"
                data-testid={`card-feature-${index}`}
              >
                <div className="w-10 h-10 bg-[#f5f5f5] border border-[#eaeaea] rounded-xl flex items-center justify-center mb-4">
                  {card.icon}
                </div>
                <h3 className="font-semibold text-[15px] leading-[23px] text-[#1a1a1a] tracking-[-0.5px] mb-2">
                  {card.title}
                </h3>
                <p className="font-normal text-[13px] leading-[22px] text-[#737373] tracking-[-0.5px]">
                  {card.hasLeadBadge ? (
                    <>
                      The{" "}
                      <span className="inline-flex items-center gap-1 bg-[#eef2ff] border border-[#4f46e5]/20 rounded px-2 py-0.5 font-semibold text-[13px] text-[#4f46e5] align-middle">
                        Lead
                      </span>{" "}
                      AI combines the best insights into your final answer.
                    </>
                  ) : (
                    card.description
                  )}
                </p>
              </div>
            ))}
          </div>

          <div
            className="flex items-center justify-center gap-3 bg-white border border-[#eaeaea] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.02)] px-5 py-4 mb-6"
            data-testid="notice-ai-council"
          >
            <p className="font-normal text-[13px] leading-[20px] text-[#737373] tracking-[-0.3px]">
              How does AI Council compare with other AI Chats
            </p>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" aria-label="How AI Council compares" className="flex-shrink-0" data-testid="button-comparison-info">
                    <Info className="w-4 h-4 text-[#a3a3a3] cursor-help" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-[min(400px,calc(100vw-2rem))] bg-[#1a1a1a] text-white border-[#333] p-4 text-[12px] leading-relaxed" side="bottom" align="center">
                  <p className="mb-2">When you ask ChatGPT or Claude a question, you get one model's single attempt at an answer. Here's what happens when you ask the AI Council:</p>
                  <ul className="space-y-2 mb-2">
                    <li>• 3 independent analyses — each model works through your question separately, with no groupthink.</li>
                    <li>• Structured adversarial debate — models directly challenge each other's reasoning, exposing gaps and weak logic.</li>
                    <li>• Forced synthesis — a final round integrates the strongest arguments to give you the most intelligent verdict.</li>
                  </ul>
                  <p className="mb-2">That's 12+ API calls and 3 distinct processing stages per debate — not one quick request.</p>
                  <p>You're comparing one opinion to a room full of experts arguing it out.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 bg-gradient-to-t from-white via-white to-transparent pt-4 pb-4 md:pb-6 px-4 md:px-8 z-20">
        <div className="w-full max-w-[960px] mx-auto">
          <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files)}
              accept="image/*,.pdf,.doc,.docx,.txt,.md,.json,.csv"
            />

            {(uploadedFiles.length > 0 || pendingFiles.length > 0) && (
              <div className="flex gap-2 mb-3 px-1 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                {pendingFiles.map((file) => (
                  <div 
                    key={file.id} 
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border shrink-0 ${
                      file.status === 'error' 
                        ? 'border-red-300 bg-red-50 text-red-600'
                        : 'border-[#eaeaea] bg-[#f5f5f5] text-[#737373] border-dashed animate-pulse'
                    }`}
                    data-testid={`pending-file-${file.id}`}
                  >
                    {file.status === 'error' ? (
                      <X className="w-3 h-3" />
                    ) : (
                      <span className="w-3.5 h-3.5 border-2 border-[#eaeaea] border-t-[#4f46e5] rounded-full animate-spin" />
                    )}
                    <span className="max-w-[120px] truncate">
                      {file.status === 'compressing' ? 'Compressing...' : 
                       file.status === 'error' ? 'Failed' :
                       file.name}
                    </span>
                  </div>
                ))}
                {uploadedFiles.map((file, index) => (
                  <div key={index} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border border-[#eaeaea] bg-white text-[#4b5563] shrink-0" data-testid={`uploaded-file-${index}`}>
                    {file.type.startsWith('image/') ? (
                      <ImageIcon size={12} />
                    ) : (
                      <Document size={12} />
                    )}
                    <span className="max-w-[120px] truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="ml-0.5 p-0 bg-transparent border-0 text-[#737373] cursor-pointer hover:text-red-500"
                      data-testid={`button-remove-file-${index}`}
                    >
                      <Close size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {isAuthenticated && userCredits === 0 && (
              <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl mb-3" data-testid="upsell-banner">
                <Zap className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <p className="text-[13px] text-amber-800 leading-snug flex-1 m-0">
                  You're out of credits.{" "}
                  <button
                    type="button"
                    onClick={() => { trackEvent("upsell_clicked", { location: "home" }); setLocation("/credits"); }}
                    className="font-semibold underline text-amber-900 bg-transparent border-0 cursor-pointer p-0 text-[13px]"
                    data-testid="link-upsell-credits"
                  >
                    Get more credits
                  </button>
                  {" "}to keep using the Council.
                </p>
              </div>
            )}

            <div className="bg-white border border-[#eaeaea] rounded-2xl shadow-[0px_4px_12px_rgba(0,0,0,0.04),0px_1px_3px_rgba(0,0,0,0.02)]">
              <div className="relative px-4 pt-4 pb-2">
                <textarea
                  ref={textareaRef}
                  placeholder="Share your toughest problem. The more you explain, the stronger the outcome."
                  rows={1}
                  className={`w-full resize-none border-0 outline-none bg-transparent font-normal text-[15px] leading-[25px] text-[#1a1a1a] tracking-[-0.5px] placeholder:text-[rgba(26,26,26,0.5)] pr-24 ${error ? 'bg-red-50/50' : ''}`}
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    if (error) setError(null);
                  }}
                  data-testid="input-prompt"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                  onInput={adjustTextareaHeight}
                  style={{
                    minHeight: '44px',
                    maxHeight: '200px',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'break-word',
                    fontFamily: "'Inter', sans-serif",
                  }}
                />
                
                <div className="absolute bottom-2 right-14 w-10 h-8 bg-gradient-to-r from-transparent to-white pointer-events-none" />
                <button
                  type="submit"
                  disabled={createConversation.isPending || (isAuthenticated && (!canSubmit || costPending))}
                  className="absolute bottom-2 right-4 w-8 h-8 bg-[#1a1a1a] rounded-lg shadow-sm flex items-center justify-center border-0 cursor-pointer hover:bg-[#2b2b2b] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid="button-submit"
                  title={costPending ? "Estimating cost..." : !canSubmit && isAuthenticated ? "Cost estimate required" : isAuthenticated ? "Run Council" : "Sign in to run the Council"}
                >
                  {createConversation.isPending ? (
                    <span className="w-4 h-4 border-2 border-transparent border-t-white rounded-full animate-spin" />
                  ) : (
                    <ArrowUp className="w-4 h-4 text-white" />
                  )}
                </button>
              </div>

              <div className="px-3 md:px-4 py-3 border-t border-[#eaeaea] bg-[rgba(245,245,245,0.5)] rounded-b-2xl overflow-visible">
                <div className="flex items-center gap-0 min-w-0 overflow-x-auto md:overflow-visible" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="w-7 h-7 flex items-center justify-center rounded-md bg-transparent border-0 text-[#737373] cursor-pointer hover:bg-[#f5f5f5] hover:text-[#1a1a1a] transition-colors disabled:opacity-50 shrink-0"
                    data-testid="button-upload"
                    title="Attach files (PDF, images, docs)"
                  >
                    <Paperclip className="w-[11px] h-[13px]" />
                  </button>

                  <div className="w-px h-4 bg-[#d1d5db] mx-2.5 shrink-0" />

                  <div className="flex items-center gap-1.5 min-w-0 flex-nowrap overflow-visible">
                    <span className="font-medium text-[11px] text-[#737373] tracking-[0.05px] mr-1 shrink-0">Council:</span>
                    {selectedModels.map((modelId, index) => (
                      <InlineModelChip
                        key={index}
                        modelId={modelId}
                        slotIndex={index}
                        selectedModels={selectedModels}
                        onSelectModel={handleSelectModel}
                        isFreeUser={isFreeUser}
                        dotColor={MODEL_COLORS[index]}
                      />
                    ))}
                    <div className="w-px h-4 bg-[#d1d5db] mx-1 shrink-0" />
                    <ChairmanChip
                      modelId={chairmanModel}
                      onSelectModel={setChairmanModel}
                      isFreeUser={isFreeUser}
                    />
                    {!isDefaultConfig && !isFreeUser && (
                      <button
                        type="button"
                        onClick={resetToDefaults}
                        className="w-7 h-7 flex items-center justify-center rounded-md bg-transparent border-0 text-[#f59e0b] cursor-pointer hover:bg-amber-50 transition-colors shrink-0"
                        data-testid="button-reset-models"
                        title="Reset to defaults"
                      >
                        <Reset size={14} />
                      </button>
                    )}
                    {isAuthenticated && prompt.trim().length >= 5 && (
                    !costEstimateConfirmed ? (
                      <span 
                        className="inline-flex items-center gap-1 text-[11px] font-medium tracking-[-0.5px] px-2 py-0.5 rounded-md text-[#737373] animate-pulse"
                        data-testid="text-credit-cost"
                      >
                        Estimating...
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button type="button" className="inline-flex items-center justify-center text-[#737373] hover:text-[#1a1a1a] transition-colors bg-transparent border-0 cursor-pointer p-0" data-testid="button-council-info">
                                <Info className="w-3 h-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[320px] bg-[#1a1a1a] text-white border-[#333] p-3 text-[12px] leading-relaxed" side="top" align="end">
                              <p className="m-0">Calculating credit cost for this council based on your selected models.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </span>
                    ) : (
                      <span 
                        className={`inline-flex items-center gap-1 text-[11px] font-medium tracking-[-0.5px] px-2 py-0.5 rounded-md ${
                          !hasEnoughCredits 
                            ? 'text-red-500 bg-red-50 border border-red-200' 
                            : creditCost > 1 
                              ? 'text-amber-600 bg-amber-50 border border-amber-200' 
                              : 'text-[#737373]'
                        }`}
                        data-testid="text-credit-cost"
                      >
                        {creditCost} {creditCost === 1 ? 'credit' : 'credits'}
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button type="button" className="inline-flex items-center justify-center text-current hover:opacity-70 transition-opacity bg-transparent border-0 cursor-pointer p-0" data-testid="button-council-info">
                                <Info className="w-3 h-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[320px] bg-[#1a1a1a] text-white border-[#333] p-3 text-[12px] leading-relaxed" side="top" align="end">
                              <p className="m-0">Price based on selected models and input size.</p>
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

            {(error || fileUploadError) && (
              <div className="text-red-500 text-xs mt-2 px-1" data-testid="text-error">
                {error || fileUploadError}
              </div>
            )}
          </form>
        </div>
      </div>

    </div>
  );
}
