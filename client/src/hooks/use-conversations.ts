import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import type { Conversation, ConversationWithMessages } from "@shared/schema";
import { authFetch } from "@/lib/clerk-token";

export function useConversations() {
  return useQuery<Conversation[]>({
    queryKey: ['/api/conversations'],
    queryFn: async () => {
      const res = await authFetch('/api/conversations');
      if (res.status === 401) return [];
      if (!res.ok) throw new Error("Failed to fetch conversations");
      return res.json();
    },
    retry: false,
  });
}

export class FetchError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'FetchError';
  }
}

export function useConversation(id: number) {
  return useQuery<ConversationWithMessages>({
    queryKey: ['/api/conversations', id],
    queryFn: async () => {
      const res = await authFetch(`/api/conversations/${id}`);
      if (res.status === 404) throw new FetchError("Session not found", 404);
      if (res.status === 401 || res.status === 403) throw new FetchError("Authentication required", res.status);
      if (!res.ok) throw new FetchError("Failed to fetch conversation", res.status);
      return res.json();
    },
    placeholderData: keepPreviousData,
    retry: (failureCount, error) => {
      if (error instanceof FetchError && (error.status === 401 || error.status === 403)) {
        return false;
      }
      if (error instanceof FetchError && error.status === 404) {
        return failureCount < 3;
      }
      return failureCount < 2;
    },
    retryDelay: (attemptIndex, error) => {
      if (error instanceof FetchError && error.status === 404) {
        return 1500;
      }
      return Math.min(1000 * Math.pow(2, attemptIndex), 10000);
    },
    refetchInterval: (query) => {
      if (!query.state.data) return false;
      const data = query.state.data;
      
      if (data.status === "processing") return 1500;
      
      const messages = data.messages || [];
      if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        if (lastMessage.role === 'user') return 1500;
      }

      if (messages.length >= 4 && !data.contextSummary) {
        const lastMsg = messages[messages.length - 1];
        const lastMsgAge = lastMsg?.createdAt ? Date.now() - new Date(lastMsg.createdAt).getTime() : Infinity;
        if (lastMsgAge < 30_000) return 3000;
      }
      
      return false;
    },
  });
}

interface Attachment {
  name: string;
  url: string;
  type: string;
  size: number;
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ prompt, attachments, models, chairmanModel, attachmentTokens }: { prompt: string; attachments?: Attachment[]; models?: string[]; chairmanModel?: string; attachmentTokens?: number }) => {
      const res = await authFetch('/api/conversations', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, attachments, models, chairmanModel, attachmentTokens }),
      });
      if (res.status === 403) {
        const data = await res.json();
        const err = new Error(data.message || "PAYWALL");
        (err as any).code = data.code;
        (err as any).creditCost = data.creditCost;
        (err as any).reserveAmount = data.reserveAmount;
        (err as any).tier = data.tier;
        (err as any).debateCredits = data.debateCredits;
        throw err;
      }
      if (!res.ok) throw new Error("Failed to create conversation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
    },
  });
}

export function useRenameConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, title }: { id: number; title: string }) => {
      const res = await authFetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error("Failed to rename conversation");
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/conversations', variables.id] });
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await authFetch(`/api/conversations/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete conversation");
      return { id };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
      queryClient.removeQueries({ queryKey: ['/api/conversations', data.id] });
    },
  });
}

export function useAddMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, prompt, attachments, attachmentTokens, expectedCost }: { conversationId: number; prompt: string; attachments?: Attachment[]; attachmentTokens?: number; expectedCost?: number }) => {
      const res = await authFetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, attachments, attachmentTokens, expectedCost }),
      });
      if (res.status === 409) {
        const data = await res.json();
        const err = new Error(data.message || "Cost changed");
        (err as any).code = data.code;
        (err as any).creditCost = data.creditCost;
        (err as any).actualCost = data.actualCost;
        throw err;
      }
      if (res.status === 403) {
        const data = await res.json();
        const err = new Error(data.message || "PAYWALL");
        (err as any).code = data.code;
        (err as any).creditCost = data.creditCost;
        (err as any).reserveAmount = data.reserveAmount;
        (err as any).tier = data.tier;
        (err as any).debateCredits = data.debateCredits;
        throw err;
      }
      if (!res.ok) throw new Error("Failed to add message");
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/conversations', variables.conversationId] });
    },
  });
}
