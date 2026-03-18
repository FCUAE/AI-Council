import { motion } from "framer-motion";
import { Crown, Sparkles, Copy, Check } from "lucide-react";
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { renderMarkdown, darkTheme } from "@/lib/markdown-renderer";

function StyledVerdictText({ content }: { content: string }) {
  return <>{renderMarkdown(content, darkTheme)}</>;
}

interface ChairmanCardProps {
  content: string;
  isLoading?: boolean;
}

export function ChairmanCard({ content, isLoading = false }: ChairmanCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [content]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      data-testid="chairman-card"
      className="chairman-card p-8 md:p-12"
    >
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500/30 to-cyan-500/30 flex items-center justify-center border border-white/20">
            <Crown className="w-6 h-6 text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              The Verdict
              <Sparkles className="w-4 h-4 text-cyan-400" />
            </h2>
            <p className="text-sm text-muted-foreground">Synthesized by the lead model</p>
          </div>
        </div>
        {!isLoading && content && (
          <Button
            size="icon"
            variant="ghost"
            data-testid="button-copy-verdict"
            onClick={handleCopy}
            title={copied ? "Copied!" : "Copy verdict"}
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-400" />
            ) : (
              <Copy className="w-4 h-4 text-muted-foreground" />
            )}
          </Button>
        )}
      </div>

      <div className="border-t border-white/10 pt-6">
        {isLoading ? (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 bg-purple-500 rounded-full animate-pulse" />
              <p className="text-sm text-muted-foreground italic animate-pulse">
                Synthesizing the strongest elements into your answer...
              </p>
            </div>
            <div className="space-y-3">
              <div className="h-4 bg-white/5 rounded animate-shimmer" />
              <div className="h-4 bg-white/5 rounded animate-shimmer w-5/6" />
              <div className="h-4 bg-white/5 rounded animate-shimmer w-4/6" />
            </div>
          </div>
        ) : (
          <StyledVerdictText content={content} />
        )}
      </div>
    </motion.div>
  );
}

export function ChairmanCardCompact({ content }: { content: string }) {
  return (
    <div 
      data-testid="chairman-card-compact"
      className="glass-elevated rounded-xl p-6 border-purple-500/20"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
          <Crown className="w-4 h-4 text-purple-400" />
        </div>
        <p className="text-sm font-semibold text-purple-400">The Verdict</p>
      </div>
      <div className="verdict-text text-sm text-foreground/80 leading-relaxed">
        {content.length > 500 ? content.slice(0, 500) + '...' : content}
      </div>
    </div>
  );
}
