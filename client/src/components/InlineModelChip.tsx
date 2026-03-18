import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { AVAILABLE_MODELS, DEFAULT_COUNCIL_MODELS, DEFAULT_CHAIRMAN_MODEL, ROLE_LABELS, getCostDisplay, getRoleBadge, type ModelConfig, type Role } from "@shared/models";
import { ChevronDown, ChevronRight, Eye, EyeOff, Trophy, Lock, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const FREE_MODELS = new Set([...DEFAULT_COUNCIL_MODELS, DEFAULT_CHAIRMAN_MODEL]);

interface InlineModelChipProps {
  modelId: string;
  slotIndex: number;
  selectedModels: string[];
  onSelectModel: (slotIndex: number, modelId: string) => void;
  disabled?: boolean;
  isFreeUser?: boolean;
  onLockedModelClick?: () => void;
  dotColor?: string;
}

const ALL_ROLES: Role[] = ["coding", "marketing", "logic", "data", "quick"];

export default function InlineModelChip({ 
  modelId, 
  slotIndex, 
  selectedModels, 
  onSelectModel,
  disabled = false,
  isFreeUser = false,
  onLockedModelClick,
  dotColor = '#22c55e'
}: InlineModelChipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeRole, setActiveRole] = useState<Role | null>(null);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  const model = AVAILABLE_MODELS.find(m => m.id === modelId);

  const sortedModels = useMemo(() => {
    if (!activeRole) return AVAILABLE_MODELS;
    
    return [...AVAILABLE_MODELS].sort((a, b) => {
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
  }, [activeRole]);

  const groupedModels = useMemo(() => {
    return sortedModels.reduce((acc, m) => {
      if (!acc[m.provider]) {
        acc[m.provider] = [];
      }
      acc[m.provider].push(m);
      return acc;
    }, {} as Record<string, ModelConfig[]>);
  }, [sortedModels]);

  useEffect(() => {
    if (isOpen) {
      setExpandedProviders(new Set());
    }
  }, [activeRole]);

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
    if (isFreeUser && !FREE_MODELS.has(newModelId)) {
      setIsOpen(false);
      onLockedModelClick?.();
      return;
    }
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
            {isFreeUser && (
              <div className="model-popover-upgrade-hint" data-testid="hint-upgrade-models">
                <Lock className="w-3 h-3" />
                <span>Buy credits to unlock all models</span>
              </div>
            )}
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
            <div className="model-popover-scroll">
              {Object.keys(groupedModels).length === 0 ? (
                <div className="no-models-message">No models available</div>
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
                              const isLocked = isFreeUser && !FREE_MODELS.has(m.id);
                              const roleBadge = getRoleBadge(m.id, activeRole);
                              
                              return (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => !isDisabled && handleSelect(m.id)}
                                  disabled={isDisabled && !isLocked}
                                  className={`model-option ${isCurrentSlot ? 'active' : ''} ${isDisabled ? 'disabled' : ''} ${isLocked ? 'locked' : ''} ${roleBadge?.isNotRecommended ? 'not-recommended' : ''}`}
                                  data-testid={`option-model-${slotIndex}-${m.id.replace(/\//g, '-')}`}
                                >
                                  <div className="model-option-info">
                                    <span className="model-option-name">{m.name}{isSelected && !isCurrentSlot && <span className="text-[10px] text-[#b0b0b0] ml-1 font-normal">(selected)</span>}</span>
                                    {isLocked && <Lock className="w-3 h-3 model-lock-icon" />}
                                    {m.vision ? (
                                      <TooltipProvider delayDuration={0}>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Eye className="w-3 h-3 model-vision-icon" />
                                          </TooltipTrigger>
                                          <TooltipContent>It can see/read uploaded files</TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    ) : (
                                      <EyeOff className="w-3 h-3 model-no-vision-icon" />
                                    )}
                                  </div>
                                  <div className="model-option-meta">
                                    {activeRole && roleBadge ? (
                                      <span className={`model-badge ${roleBadge.isChampion ? 'champion' : ''} ${roleBadge.isNotRecommended ? 'not-recommended' : ''}`}>
                                        {roleBadge.isChampion && <Trophy className="w-3 h-3 inline-block mr-1" />}
                                        {roleBadge.label}
                                      </span>
                                    ) : (
                                      <span className={`model-badge ${m.badge === 'Smartest / Slow' ? 'slow' : ''}`}>
                                        {m.badge === 'Smartest / Slow' && <Clock className="w-3 h-3 inline-block mr-1" />}
                                        {m.badge}
                                      </span>
                                    )}
                                    <span className="model-option-cost" title="Relative API cost: $ = budget, $$$$ = premium">{getCostDisplay(m.cost)}</span>
                                  </div>
                                </button>
                              );
                            })}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
