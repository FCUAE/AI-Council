import { motion } from "framer-motion";
import { Bot, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface CouncilSeatProps {
  model: string;
  content?: string;
  isActive?: boolean;
  isThinking?: boolean;
  stage?: 'initial' | 'review';
}

export function CouncilSeat({ 
  model, 
  content, 
  isActive = false, 
  isThinking = false,
  stage = 'initial'
}: CouncilSeatProps) {
  const stageColors = {
    initial: {
      border: 'border-cyan-500/30',
      glow: 'glow-cyan',
      text: 'text-cyan-400',
      bg: 'bg-cyan-500/10'
    },
    review: {
      border: 'border-amber-500/30',
      glow: 'glow-amber',
      text: 'text-amber-400',
      bg: 'bg-amber-500/10'
    }
  };

  const colors = stageColors[stage];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      data-testid={`council-seat-${model.toLowerCase().replace(/\s+/g, '-')}`}
      className={cn(
        "glass-card p-4 transition-all duration-300",
        isActive && colors.glow,
        isActive && colors.border,
        !isActive && !isThinking && "border-white/10"
      )}
    >
      {/* Model Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center",
          isActive ? colors.bg : "bg-white/10"
        )} {...(isThinking ? { role: "status", "aria-label": "Loading", "aria-busy": "true" } : {})}>
          {isThinking ? (
            <>
              <Loader2 className={cn("w-4 h-4 animate-spin", isActive ? colors.text : "text-muted-foreground")} />
              <span className="sr-only">Loading...</span>
            </>
          ) : (
            <Bot className={cn("w-4 h-4", isActive ? colors.text : "text-muted-foreground")} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn(
            "text-sm font-semibold truncate",
            isActive ? colors.text : "text-foreground"
          )}>
            {model}
          </p>
          {isThinking && (
            <p className="text-xs text-muted-foreground">Deliberating...</p>
          )}
        </div>
        {isActive && (
          <div className={cn("w-2 h-2 rounded-full animate-pulse", colors.bg.replace('/10', ''))} />
        )}
      </div>

      {/* Content Area */}
      <div className="min-h-[80px]">
        {isThinking ? (
          <div className="space-y-2">
            <div className="h-3 bg-white/5 rounded animate-shimmer" />
            <div className="h-3 bg-white/5 rounded animate-shimmer w-4/5" />
            <div className="h-3 bg-white/5 rounded animate-shimmer w-3/5" />
          </div>
        ) : content ? (
          <div className="typewriter-container">
            <p className="text-sm text-foreground/80 typewriter-text leading-relaxed">
              {content}
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground/50 text-sm">
            Awaiting response...
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function CouncilSeatGrid({ 
  children, 
  className 
}: { 
  children: React.ReactNode; 
  className?: string;
}) {
  return (
    <div className={cn(
      "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4",
      className
    )}>
      {children}
    </div>
  );
}
