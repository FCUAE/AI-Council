import { useUser, useClerk } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@shared/models/auth";
import { authFetch } from "@/lib/clerk-token";

async function fetchDbUser(): Promise<User | null> {
  const response = await authFetch("/api/auth/user");

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  return response.json();
}

export function useAuth() {
  const { isSignedIn, isLoaded, user: clerkUser } = useUser();
  const { signOut } = useClerk();

  const { data: dbUser, isLoading: dbLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchDbUser,
    enabled: isLoaded && !!isSignedIn,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  const user = isSignedIn && dbUser ? dbUser : isSignedIn && clerkUser ? {
    id: clerkUser.id,
    email: clerkUser.primaryEmailAddress?.emailAddress || null,
    firstName: clerkUser.firstName || null,
    lastName: clerkUser.lastName || null,
    profileImageUrl: clerkUser.imageUrl || null,
    debateCredits: 0,
    deliberationCount: 0,
    subscriptionStatus: "free",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    monthlyDebatesUsed: 0,
    monthlyResetAt: null,
    createdAt: null,
    updatedAt: null,
  } as User : null;

  return {
    user,
    isLoading: !isLoaded || (isSignedIn && dbLoading),
    isAuthenticated: !!isSignedIn,
    logout: () => signOut(),
    isLoggingOut: false,
  };
}
