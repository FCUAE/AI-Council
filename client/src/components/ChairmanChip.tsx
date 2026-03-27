import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { AVAILABLE_MODELS, DEFAULT_COUNCIL_MODELS, DEFAULT_CHAIRMAN_MODEL, ROLE_LABELS, getRoleBadge, type ModelConfig, type Role } from "@shared/models";
import { ChevronDown, ChevronRight, Eye, Star, Trophy, Search, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "wouter";

const FREE_MODELS = new Set([...DEFAULT_COUNCIL_MODELS, DEFAULT_CHAIRMAN_MODEL]);

interface ChairmanChipProps {
  modelId: string;
  onSelectModel: (modelId: string) => void;
  disabled?: boolean;
  isFreeUser?: boolean;
  hasAttachments?: boolean;
}

const ALL_ROLES: Role[] = ["coding", "marketing", "logic", "data", "quick"];

function CostDots({ cost }: { cost: number }) {
  return (
    <span className="model-cost-dots" title={`Cost: ${cost}/4`}>
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} className={`model-cost-dot ${i < cost ? 'filled' : ''}`} />
      ))}
    </span>
  );
}

function ModelRow({
  m,
  isCurrentSelection,
  activeRole,
  hasAttachments,
  onSelect,
}: {
  m: ModelConfig;
  isCurrentSelection: boolean;
  activeRole: Role | null;
  hasAttachments: boolean;
  onSelect: (id: string) => void;
}) {
  const roleBadge = getRoleBadge(m.id, activeRole);

  return (
    <button
      type="button"
      onClick={() => onSelect(m.id)}
      className={`model-option ${isCurrentSelection ? 'active' : ''} ${roleBadge?.isNotRecommended ? 'not-recommended' : ''}`}
      data-testid={`option-chairman-${m.id.replace(/\//g, '-')}`}
    >
      <div className="model-option-info">
        <span className="model-option-name">
          {m.name}
        </span>
        {hasAttachments && m.vision && (
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Eye className="w-3 h-3 model-vision-icon" />
              </TooltipTrigger>
              <TooltipContent>Can read uploaded files</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="model-option-meta">
        {activeRole && roleBadge ? (
          <span className={`model-badge ${roleBadge.isChampion ? 'champion' : ''} ${roleBadge.isNotRecommended ? 'not-recommended' : ''}`}>
            {roleBadge.isChampion && <Trophy className="w-3 h-3 inline-block mr-1" />}
            {roleBadge.label}
          </span>
        ) : (
          <span className={`model-badge ${m.badge === 'Deep Thinker' ? 'deep-thinker' : ''}`}>
            {m.badge}
          </span>
        )}
        <CostDots cost={m.cost} />
      </div>
    </button>
  );
}

export default function ChairmanChip({ 
  modelId, 
  onSelectModel,
  disabled = false,
  isFreeUser = false,
  hasAttachments = false,
}: ChairmanChipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeRole, setActiveRole] = useState<Role | null>(null);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [showAllRanked, setShowAllRanked] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const model = AVAILABLE_MODELS.find(m => m.id === modelId);

  const filteredBySearch = useMemo(() => {
    if (!searchQuery.trim()) return AVAILABLE_MODELS;
    const q = searchQuery.toLowerCase();
    return AVAILABLE_MODELS.filter(m =>
      m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const visibleModels = useMemo(() => {
    if (isFreeUser) {
      return filteredBySearch.filter(m => FREE_MODELS.has(m.id));
    }
    return filteredBySearch;
  }, [filteredBySearch, isFreeUser]);

  const lockedCount = useMemo(() => {
    if (!isFreeUser) return 0;
    return AVAILABLE_MODELS.filter(m => !FREE_MODELS.has(m.id)).length;
  }, [isFreeUser]);

  const sortedModels = useMemo(() => {
    if (!activeRole) return visibleModels;
    
    return [...visibleModels].sort((a, b) => {
      const badgeA = getRoleBadge(a.id, activeRole);
      const badgeB = getRoleBadge(b.id, activeRole);
      
      if (badgeA?.isChampion && !badgeB?.isChampion) return -1;
      if (!badgeA?.isChampion && badgeB?.isChampion) return 1;
      if (badgeA?.isNotRecommended && !badgeB?.isNotRecommended) return 1;
      if (!badgeA?.isNotRecommended && badgeB?.isNotRecommended) return -1;
      if (badgeA && !badgeB) return -1;
      if (!badgeA && badgeB) return 1;
      return 0;
    });
  }, [activeRole, visibleModels]);

  const groupedModels = useMemo(() => {
    return sortedModels.reduce((acc, m) => {
      if (!acc[m.provider]) {
        acc[m.provider] = [];
      }
      acc[m.provider].push(m);
      return acc;
    }, {} as Record<string, ModelConfig[]>);
  }, [sortedModels]);

  const rankedTop5 = useMemo(() => sortedModels.slice(0, 5), [sortedModels]);
  const rankedRest = useMemo(() => sortedModels.slice(5), [sortedModels]);

  useEffect(() => {
    if (isOpen) {
      setExpandedProviders(new Set());
      setShowAllRanked(false);
    }
  }, [activeRole]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearchQuery("");
      setShowAllRanked(false);
      setActiveRole(null);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (newModelId: string) => {
    onSelectModel(newModelId);
    setIsOpen(false);
  };

  const handleRoleClick = (role: Role) => {
    setActiveRole(prev => prev === role ? null : role);
  };

  const toggleProvider = useCallback((provider: string) => {
    setExpandedProviders(prev => {
      const next = new Set(prev);
      if (next.has(provider)) {
        next.delete(provider);
      } else {
        next.add(provider);
      }
      return next;
    });
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (disabled && !isFreeUser) return;
          if (!isOpen) {
            setExpandedProviders(new Set());
          }
          setIsOpen(!isOpen);
        }}
        className="inline-flex items-center gap-1.5 h-7 w-[150px] min-w-[150px] max-w-[150px] px-2 bg-white border border-[#eaeaea] rounded-md shadow-sm text-xs font-medium text-[#1a1a1a] tracking-[-0.5px] cursor-pointer hover:border-[#d1d5db] transition-colors shrink-0"
        title={isFreeUser ? "Browse available lead models" : "Click to change the lead model"}
        data-testid="chip-chairman"
      >
        <Star className="w-3 h-3 text-[#f59e0b]" />
        <span className="text-[11px] font-medium text-[#737373] tracking-[0.05px] mr-0.5">Lead:</span>
        <span className="flex-1 truncate text-left">{model?.name || "Select"}</span>
        <ChevronDown className={`w-2.5 h-2.5 text-[#737373] transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="model-popover model-popover-wide"
            data-testid="popover-chairman"
          >
            <div className="model-search-container">
              <Search className="w-3.5 h-3.5 text-[#999] model-search-icon" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search models..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="model-search-input"
                data-testid="search-chairman"
              />
            </div>
            {!searchQuery && (
              <>
                <div className="model-popover-header">
                  What's your task?
                </div>
                <div className="capability-filters">
                  {ALL_ROLES.map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => handleRoleClick(role)}
                      className={`capability-filter-btn ${activeRole === role ? 'active' : ''}`}
                      data-testid={`filter-chairman-${role}`}
                    >
                      {ROLE_LABELS[role]}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="model-popover-scroll">
              {sortedModels.length === 0 ? (
                <div className="no-models-message">No models found</div>
              ) : searchQuery ? (
                sortedModels.map((m) => {
                  const isCurrentSelection = m.id === modelId;
                  return (
                    <ModelRow
                      key={m.id}
                      m={m}
                      isCurrentSelection={isCurrentSelection}
                      activeRole={activeRole}
                      hasAttachments={hasAttachments}
                      onSelect={handleSelect}
                    />
                  );
                })
              ) : activeRole ? (
                <>
                  {(showAllRanked ? sortedModels : rankedTop5).map((m) => {
                    const isCurrentSelection = m.id === modelId;
                    return (
                      <ModelRow
                        key={m.id}
                        m={m}
                        isCurrentSelection={isCurrentSelection}
                        activeRole={activeRole}
                        hasAttachments={hasAttachments}
                        onSelect={handleSelect}
                      />
                    );
                  })}
                  {!showAllRanked && rankedRest.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAllRanked(true)}
                      className="model-show-all-btn"
                      data-testid="show-all-chairman-models"
                    >
                      Show all {sortedModels.length} models
                    </button>
                  )}
                </>
              ) : (
                Object.entries(groupedModels).map(([provider, models]) => {
                  const isExpanded = expandedProviders.has(provider);
                  return (
                    <div key={provider} className="model-provider-group">
                      <button
                        type="button"
                        onClick={() => toggleProvider(provider)}
                        className="model-provider-label model-provider-toggle"
                        data-testid={`provider-toggle-chairman-${provider.toLowerCase().replace(/\s/g, '-')}`}
                      >
                        <span>{provider}</span>
                        <ChevronRight className={`w-3 h-3 model-provider-chevron ${isExpanded ? 'expanded' : ''}`} />
                      </button>
                      <AnimatePresence initial={false}>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: "easeInOut" }}
                            style={{ overflow: "hidden" }}
                          >
                            {models.map((m) => {
                              const isCurrentSelection = m.id === modelId;
                              return (
                                <ModelRow
                                  key={m.id}
                                  m={m}
                                  isCurrentSelection={isCurrentSelection}
                                  activeRole={activeRole}
                                  hasAttachments={hasAttachments}
                                  onSelect={handleSelect}
                                />
                              );
                            })}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })
              )}
              {isFreeUser && lockedCount > 0 && (
                <Link
                  href="/credits"
                  className="model-unlock-cta"
                  data-testid="unlock-chairman-cta"
                  onClick={() => setIsOpen(false)}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Unlock {lockedCount} more premium models</span>
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
