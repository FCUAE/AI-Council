import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/clerk-token";

export interface CouncilResponse {
  id: number;
  model: string;
  content: string;
  stage: string;
  error?: string | null;
  createdAt?: string | Date | null;
}

export interface ModelStatus {
  model: string;
  initialComplete: boolean;
  initialContent: string | null;
  reviewComplete: boolean;
  reviewContent: string | null;
  failed: boolean;
  error: string | null;
}

export interface ConversationStatus {
  isProcessing: boolean;
  stage: 'hearing' | 'review' | 'verdict' | null;
  stageProgress: {
    completed: number;
    total: number;
  };
  models: string[];
  chairmanModel: string;
  modelStatuses: ModelStatus[];
  councilResponses: CouncilResponse[];
  failures: Array<{
    model: string;
    stage: string;
    message: string;
  }>;
  isStuck: boolean;
  stuckMessage: string | null;
  errorReason: string | null;
  startedAt: string | null;
  lastActivityAt: string | null;
}

export function useConversationStatus(conversationId: number | undefined) {
  return useQuery<ConversationStatus>({
    queryKey: ['/api/conversations', conversationId, 'status'],
    queryFn: async () => {
      if (!conversationId) throw new Error("No conversation ID");
      const res = await authFetch(`/api/conversations/${conversationId}/status`);
      if (!res.ok) throw new Error("Failed to fetch status");
      return res.json();
    },
    enabled: !!conversationId && conversationId > 0,
    refetchInterval: (query) => {
      if (!query.state.data) return false;
      return query.state.data.isProcessing ? 1000 : false;
    },
    retry: false,
  });
}
