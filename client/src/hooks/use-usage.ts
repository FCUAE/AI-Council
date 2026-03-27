import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/clerk-token";

export interface UsageData {
  deliberationCount: number;
  debateCredits: number;
  subscriptionStatus: string;
  monthlyDebatesUsed: number;
  canSubmit: boolean;
  isSubscribed: boolean;
  hasPurchased: boolean;
  paymentFailed: boolean;
  creditsPurchasedAt: string | null;
  expiringCredits: number | null;
  expiringInDays: number | null;
}

export function useUsage(enabled: boolean = true) {
  return useQuery<UsageData | null>({
    queryKey: ["/api/user/usage"],
    queryFn: async () => {
      const res = await authFetch("/api/user/usage");
      if (res.status === 401) return null;
      if (!res.ok) throw new Error("Failed to fetch usage");
      return res.json();
    },
    enabled,
    retry: false,
    staleTime: 1000 * 30,
  });
}
