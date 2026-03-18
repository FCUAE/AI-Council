import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, MessageSquare, BarChart3, ChevronDown, ChevronRight, Trophy, Medal, Award, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { getModelById } from "@shared/models";
import { renderMarkdown, darkTheme } from "@/lib/markdown-renderer";

interface CouncilResponse {
  id: number;
  model: string;
  content: string;
  stage: string;
}

interface EvidenceVaultProps {
  responses: CouncilResponse[];
  defaultOpen?: boolean;
}

interface ModelRanking {
  model: string;
  displayName: string;
  score: number;
  mentions: number;
}

type TabId = 'initial' | 'reviews' | 'rankings';

function calculateRankings(initialResponses: CouncilResponse[], reviewResponses: CouncilResponse[]): ModelRanking[] {
  if (reviewResponses.length === 0) return [];
  
  const models = Array.from(new Set(initialResponses.map(r => r.model)));
  const rankings: ModelRanking[] = [];
  
  for (const model of models) {
    const modelInfo = getModelById(model);
    const displayName = modelInfo?.name || model.split('/').pop() || model;
    
    let score = 50;
    let mentions = 0;
    
    for (const review of reviewResponses) {
      if (review.model === model) continue;
      
      const content = review.content.toLowerCase();
      const modelNameLower = displayName.toLowerCase();
      
      if (content.includes(modelNameLower)) {
        mentions++;
        
        if (content.includes('agree') || content.includes('correct') || 
            content.includes('good point') || content.includes('well reasoned') ||
            content.includes('accurate') || content.includes('comprehensive') ||
            content.includes('excellent') || content.includes('strong')) {
          score += 15;
        }
        
        if (content.includes('disagree') || content.includes('incorrect') ||
            content.includes('missing') || content.includes('overlook') ||
            content.includes('wrong') || content.includes('incomplete')) {
          score -= 10;
        }
      }
    }
    
    const initialResponse = initialResponses.find(r => r.model === model);
    if (initialResponse && initialResponse.content.length > 500) {
      score += 5;
    }
    
    score = Math.max(0, Math.min(100, score));
    
    rankings.push({ model, displayName, score, mentions });
  }
  
  return rankings.sort((a, b) => b.score - a.score);
}

export function EvidenceVault({ responses, defaultOpen = false }: EvidenceVaultProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [activeTab, setActiveTab] = useState<TabId>('initial');

  const initialResponses = responses.filter(r => r.stage === 'initial');
  const reviewResponses = responses.filter(r => r.stage === 'review');

  const rankings = calculateRankings(initialResponses, reviewResponses);
  
  const tabs = [
    { id: 'initial' as const, label: 'Individual Opinions', icon: MessageSquare, count: initialResponses.length },
    { id: 'reviews' as const, label: 'Cross-Examination', icon: FileText, count: reviewResponses.length },
    { id: 'rankings' as const, label: 'Performance Rankings', icon: BarChart3, count: rankings.length },
  ];

  return (
    <div 
      data-testid="evidence-vault"
      className="glass-card overflow-hidden"
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        data-testid="button-toggle-evidence"
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
            <FileText className="w-4 h-4 text-muted-foreground" />
          </div>
          <span className="text-sm font-medium text-foreground">Behind the Verdict</span>
          <span className="text-xs text-muted-foreground">
            {isOpen ? "Hide full deliberation" : "Show full deliberation"}
          </span>
        </div>
        <ChevronDown 
          className={cn(
            "w-4 h-4 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180"
          )} 
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex gap-2 px-4 py-2 border-t border-white/10">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  data-testid={`tab-${tab.id}`}
                  className={cn(
                    "evidence-tab flex items-center gap-2",
                    activeTab === tab.id && "active"
                  )}
                >
                  <tab.icon className="w-3 h-3" />
                  <span>{tab.label}</span>
                  {tab.count > 0 && (
                    <span className="text-xs opacity-60">({tab.count})</span>
                  )}
                </button>
              ))}
            </div>

            <div className="p-4 border-t border-white/5 max-h-80 overflow-y-auto">
              <AnimatePresence mode="wait">
                {activeTab === 'initial' && (
                  <motion.div
                    key="initial"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
                  >
                    {initialResponses.map((response) => (
                      <ResponseCard
                        key={response.id}
                        response={response}
                        variant="initial"
                      />
                    ))}
                    {initialResponses.length === 0 && (
                      <p className="text-sm text-muted-foreground col-span-full text-center py-8">
                        No individual opinions recorded yet.
                      </p>
                    )}
                  </motion.div>
                )}

                {activeTab === 'reviews' && (
                  <motion.div
                    key="reviews"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
                  >
                    {reviewResponses.map((response) => (
                      <ResponseCard
                        key={response.id}
                        response={response}
                        variant="review"
                      />
                    ))}
                    {reviewResponses.length === 0 && (
                      <p className="text-sm text-muted-foreground col-span-full text-center py-8">
                        No cross-examinations recorded yet.
                      </p>
                    )}
                  </motion.div>
                )}

                {activeTab === 'rankings' && (
                  <motion.div
                    key="rankings"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="space-y-3"
                  >
                    {rankings.length > 0 ? (
                      rankings.map((ranking, index) => (
                        <RankingCard 
                          key={ranking.model} 
                          ranking={ranking} 
                          position={index + 1} 
                        />
                      ))
                    ) : (
                      <div className="text-center py-8">
                        <BarChart3 className="w-8 h-8 text-muted-foreground/50 mx-auto mb-3" />
                        <p className="text-sm text-muted-foreground">
                          Performance rankings will appear after cross-examination.
                        </p>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface ResponseCardProps {
  response: CouncilResponse;
  variant: string;
}

function ResponseCard({ response, variant }: ResponseCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const [copied, setCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const modelInfo = getModelById(response.model);
  const displayName = modelInfo?.name || response.model.split('/').pop() || response.model;

  useEffect(() => {
    const el = contentRef.current;
    if (el) {
      setIsTruncated(el.scrollHeight > el.clientHeight);
    }
  }, [response.content]);
  
  const variantStyles: Record<string, { border: string; bg: string; text: string }> = {
    initial: {
      border: 'border-cyan-500/20',
      bg: 'bg-cyan-500/5',
      text: 'text-cyan-400'
    },
    review: {
      border: 'border-amber-500/20',
      bg: 'bg-amber-500/5',
      text: 'text-amber-400'
    }
  };

  const styles = variantStyles[variant] || variantStyles.initial;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(response.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silently fail if clipboard not available
    }
  };

  return (
    <div
      data-testid={`response-card-${response.id}`}
      className={cn(
        "rounded-lg p-4 border transition-colors",
        !isExpanded && "cursor-pointer hover:bg-white/5",
        styles.border,
        styles.bg
      )}
      onClick={!isExpanded ? () => setIsExpanded(true) : undefined}
    >
      <div
        className={cn("flex items-center justify-between mb-2", isExpanded && "cursor-pointer")}
        onClick={isExpanded ? () => setIsExpanded(false) : undefined}
      >
        <p className={cn("text-[13px] font-semibold", styles.text)}>
          {displayName}
          {variant === 'review' && "'s Cross-Examination"}
        </p>
        <div className="flex items-center gap-1">
          {isExpanded && (
            <button
              data-testid={`button-copy-response-${response.id}`}
              onClick={handleCopy}
              className="p-1 rounded hover:bg-white/10 transition-colors"
              title="Copy full text"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-green-400" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-muted-foreground" />
              )}
            </button>
          )}
          {(isTruncated || isExpanded) && (
            <ChevronRight className={cn(
              "w-3.5 h-3.5 text-muted-foreground transition-transform duration-200",
              isExpanded && "rotate-90"
            )} />
          )}
        </div>
      </div>
      {isExpanded ? (
        <div className="text-[13px] text-foreground/80 leading-[1.7]">
          {renderMarkdown(response.content, darkTheme)}
        </div>
      ) : (
        <div
          ref={contentRef}
          className="text-[13px] text-foreground/80 leading-[1.7] line-clamp-6"
        >
          {response.content}
        </div>
      )}
      {!isExpanded && isTruncated && (
        <p className={cn("text-xs mt-2 opacity-70", styles.text)}>
          Click to read more
        </p>
      )}
    </div>
  );
}

interface RankingCardProps {
  ranking: ModelRanking;
  position: number;
}

function RankingCard({ ranking, position }: RankingCardProps) {
  const PositionIcon = position === 1 ? Trophy : position === 2 ? Medal : Award;
  const positionColors = {
    1: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400', icon: 'text-yellow-400' },
    2: { bg: 'bg-slate-400/10', border: 'border-slate-400/30', text: 'text-slate-300', icon: 'text-slate-300' },
    3: { bg: 'bg-amber-600/10', border: 'border-amber-600/30', text: 'text-amber-500', icon: 'text-amber-500' },
  };
  const colors = positionColors[position as keyof typeof positionColors] || { 
    bg: 'bg-white/5', border: 'border-white/10', text: 'text-muted-foreground', icon: 'text-muted-foreground' 
  };

  return (
    <div
      data-testid={`ranking-${position}`}
      className={cn(
        "flex items-center gap-4 p-3 rounded-lg border transition-colors",
        colors.bg,
        colors.border
      )}
    >
      <div className={cn("flex items-center justify-center w-8 h-8 rounded-full", colors.bg)}>
        <PositionIcon className={cn("w-4 h-4", colors.icon)} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm font-semibold", colors.text)}>
          {ranking.displayName}
        </p>
        <p className="text-xs text-muted-foreground">
          Confidence: {ranking.score}%
        </p>
      </div>
      <div className="w-20">
        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
          <div 
            className={cn("h-full rounded-full transition-all", 
              position === 1 ? 'bg-yellow-400' : 
              position === 2 ? 'bg-slate-300' : 
              position === 3 ? 'bg-amber-500' : 'bg-white/30'
            )}
            style={{ width: `${ranking.score}%` }}
          />
        </div>
      </div>
    </div>
  );
}
