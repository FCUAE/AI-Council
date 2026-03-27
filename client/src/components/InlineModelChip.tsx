import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { AVAILABLE_MODELS, DEFAULT_COUNCIL_MODELS, DEFAULT_CHAIRMAN_MODEL, ROLE_LABELS, getRoleBadge, type ModelConfig, type Role } from "@shared/models";
import { ChevronDown, ChevronRight, Eye, Trophy, Search, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { Link } from "wouter";

const FREE_MODELS = new Set([...DEFAULT_COUNCIL_MODELS, DEFAULT_CHAIRMAN_MODEL]);

interface InlineModelChipProps {
  modelId: string;
  slotIndex: number;
  selectedModels: string[];
  onSelectModel: (slotIndex: number, modelId: string) => void;
  disabled?: boolean;
  isFreeUser?: boolean;
  dotColor?: string;
}

const ALL_ROLES: Role[] = ["coding", "marketing", "logic", "data", "quick"];

function CostIndicator({ cost }: { cost: number }) {
  return (
    <span className="model-cost-dollars" title={`Cost: ${cost}/4`}>
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} className={`model-cost-sign ${i < cost ? 'filled' : ''}`}>$</span>
      ))}
    </span>
  );
}

function ModelRow({
  m,
  isCurrentSlot,
  isDisabled,
  isSelected,
  activeRole,
  onSelect,
  testIdPrefix,
}: {
  m: ModelConfig;
  isCurrentSlot: boolean;
  isDisabled: boolean;
  isSelected: boolean;
  activeRole: Role | null;
  onSelect: (id: string) => void;
  testIdPrefix: string;
}) {
  const roleBadge = getRoleBadge(m.id, activeRole);

  return (
    <button
      type="button"
      onClick={() => !isDisabled && onSelect(m.id)}
      disabled={isDisabled}
      className={`model-option ${isCurrentSlot ? 'active' : ''} ${isDisabled ? 'disabled' : ''} ${roleBadge?.isNotRecommended ? 'not-recommended' : ''}`}
      data-testid={`${testIdPrefix}-${m.id.replace(/\//g, '-')}`}
    >
      <div className="model-option-info">
        <span className="model-option-name">
          {m.name}
          {isSelected && !isCurrentSlot && <span className="text-[10px] text-[#b0b0b0] ml-1 font-normal">(selected)</span>}
        </span>
        {m.vision && (
          <Eye className="w-3 h-3 model-vision-icon" />
        )}
      </div>
      <div className="model-option-meta">
        {m.cost >= 4 && <span className="model-premium-tag">Premium</span>}
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
        <CostIndicator cost={m.cost} />
      </div>
    </button>
  );
}

export default function InlineModelChip({ 
  modelId, 
  slotIndex, 
  selectedModels, 
  onSelectModel,
  disabled = false,
  isFreeUser = false,
  dotColor = '#22c55e',
}: InlineModelChipProps) {
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
    onSelectModel(slotIndex, newModelId);
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

  const testIdPrefix = `option-model-${slotIndex}`;

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
        className="inline-flex items-center gap-1.5 h-7 w-[120px] min-w-[120px] max-w-[120px] px-2 bg-white border border-[#eaeaea] rounded-md shadow-sm text-xs font-medium text-[#1a1a1a] tracking-[-0.5px] cursor-pointer hover:border-[#d1d5db] transition-colors shrink-0"
        title={isFreeUser ? "Browse available models" : "Click to change this council member"}
        data-testid={`chip-model-${slotIndex}`}
      >
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: dotColor }} />
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
            data-testid={`popover-model-${slotIndex}`}
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
                data-testid={`search-model-${slotIndex}`}
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
                      data-testid={`filter-${role}`}
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
                  const isSelected = selectedModels.includes(m.id);
                  const isCurrentSlot = m.id === modelId;
                  const isDisabled = isSelected && !isCurrentSlot;
                  return (
                    <ModelRow
                      key={m.id}
                      m={m}
                      isCurrentSlot={isCurrentSlot}
                      isDisabled={isDisabled}
                      isSelected={isSelected}
                      activeRole={activeRole}
                      onSelect={handleSelect}
                      testIdPrefix={testIdPrefix}
                    />
                  );
                })
              ) : activeRole ? (
                <>
                  {(showAllRanked ? sortedModels : rankedTop5).map((m) => {
                    const isSelected = selectedModels.includes(m.id);
                    const isCurrentSlot = m.id === modelId;
                    const isDisabled = isSelected && !isCurrentSlot;
                    return (
                      <ModelRow
                        key={m.id}
                        m={m}
                        isCurrentSlot={isCurrentSlot}
                        isDisabled={isDisabled}
                        isSelected={isSelected}
                        activeRole={activeRole}

                        onSelect={handleSelect}
                        testIdPrefix={testIdPrefix}
                      />
                    );
                  })}
                  {!showAllRanked && rankedRest.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAllRanked(true)}
                      className="model-show-all-btn"
                      data-testid={`show-all-models-${slotIndex}`}
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
                        data-testid={`provider-toggle-${slotIndex}-${provider.toLowerCase().replace(/\s/g, '-')}`}
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
                              const isSelected = selectedModels.includes(m.id);
                              const isCurrentSlot = m.id === modelId;
                              const isDisabled = isSelected && !isCurrentSlot;
                              return (
                                <ModelRow
                                  key={m.id}
                                  m={m}
                                  isCurrentSlot={isCurrentSlot}
                                  isDisabled={isDisabled}
                                  isSelected={isSelected}
                                  activeRole={activeRole}
          
                                  onSelect={handleSelect}
                                  testIdPrefix={testIdPrefix}
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
                  data-testid={`unlock-models-cta-${slotIndex}`}
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
