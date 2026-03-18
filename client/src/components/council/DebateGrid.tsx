import { cn } from "@/lib/utils";
import { Check, Loader2 } from "lucide-react";
import { getModelById } from "@shared/models";

interface CouncilResponse {
  id: number;
  model: string;
  content: string;
  stage: string;
}

interface DebateGridProps {
  models: string[];
  responses?: CouncilResponse[];
  currentPhase: 'hearing' | 'review' | 'verdict';
}

export function DebateGrid({ 
  models, 
  responses = [], 
  currentPhase
}: DebateGridProps) {
  const initialResponses = responses.filter(r => r.stage === 'initial');
  const reviewResponses = responses.filter(r => r.stage === 'review');

  return (
    <div className="council-deliberation">
      <div className="model-cards-grid">
        {models.map((model) => {
          const modelInfo = getModelById(model);
          const displayName = modelInfo?.name || model.split('/').pop() || model;
          
          const initialResponse = initialResponses.find(r => r.model === model);
          const reviewResponse = reviewResponses.find(r => r.model === model);
          
          let status: 'waiting' | 'thinking' | 'done' = 'waiting';
          let content = '';
          
          if (currentPhase === 'hearing') {
            if (initialResponse) {
              status = 'done';
              content = initialResponse.content;
            } else {
              status = 'thinking';
            }
          } else if (currentPhase === 'review') {
            if (reviewResponse) {
              status = 'done';
              content = reviewResponse.content;
            } else if (initialResponse) {
              status = 'thinking';
              content = initialResponse.content;
            }
          } else {
            status = 'done';
            content = reviewResponse?.content || initialResponse?.content || '';
          }
          
          return (
            <div key={model} className="model-response-card" data-testid={`model-card-${model}`}>
              <div className="model-card-header">
                <span className="model-card-name">{displayName}</span>
                {status === 'thinking' && (
                  <span className="model-status-thinking">
                    <Loader2 size={14} className="animate-spin" />
                  </span>
                )}
                {status === 'done' && (
                  <span className="model-status-done">
                    <Check size={14} />
                  </span>
                )}
              </div>
              {status === 'thinking' && !content && (
                <div className="model-card-thinking">
                  Thinking...
                </div>
              )}
              {status === 'thinking' && content && (
                <div className="model-card-content model-card-content-reviewing text-[13px] leading-[1.7]">
                  <div className="text-xs text-muted-foreground mb-1.5">Previous response:</div>
                  {content.length > 160 ? content.slice(0, 160) + '...' : content}
                </div>
              )}
              {status === 'done' && content && (
                <div className="model-card-content text-[13px] leading-[1.7] text-[#2d2d2d]">
                  {content.length > 200 ? content.slice(0, 200) + '...' : content}
                </div>
              )}
              {status === 'waiting' && (
                <div className="model-card-waiting">
                  Waiting...
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CritiqueTicker({ message }: { message: string }) {
  return (
    <div className="critique-ticker">
      <div className="ticker-dot" />
      <p className="ticker-message">{message}</p>
    </div>
  );
}
