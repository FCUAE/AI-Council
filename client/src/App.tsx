import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider, useAuth as useClerkAuth, useClerk } from "@clerk/react";
import Home from "@/pages/Home";
import { lazy, Suspense } from "react";

const Chat = lazy(() => import("@/pages/Chat"));
const Credits = lazy(() => import("@/pages/Credits"));
const Profile = lazy(() => import("@/pages/Profile"));
const Affiliate = lazy(() => import("@/pages/Affiliate"));
const Admin = lazy(() => import("@/pages/Admin"));
const NotFound = lazy(() => import("@/pages/not-found"));

import { useAuth } from "@/hooks/use-auth";
import { useUsage } from "@/hooks/use-usage";
import { useConversations, useRenameConversation, useDeleteConversation } from "@/hooks/use-conversations";
import { useEffect, useState, useRef } from "react";
import { MessageSquare, Plus, Settings, LogOut, MoreHorizontal, Pencil, Trash2, Loader2, Send, Menu, X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
const logoImg = "/logo.png";
import SupportWidget from "@/components/SupportWidget";
import { setClerkTokenGetter, authFetch } from "@/lib/clerk-token";
import { useToast } from "@/hooks/use-toast";
import { trackRefgrowSignup } from "@/hooks/use-refgrow";

function groupConversationsByDate(conversations: any[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const groups: { label: string; items: any[] }[] = [];
  const todayItems: any[] = [];
  const weekItems: any[] = [];
  const olderItems: any[] = [];

  for (const conv of conversations) {
    const convDate = new Date(conv.createdAt);
    if (convDate >= today) {
      todayItems.push(conv);
    } else if (convDate >= sevenDaysAgo) {
      weekItems.push(conv);
    } else {
      olderItems.push(conv);
    }
  }

  if (todayItems.length > 0) groups.push({ label: "Today", items: todayItems });
  if (weekItems.length > 0) groups.push({ label: "Previous 7 Days", items: weekItems });
  if (olderItems.length > 0) groups.push({ label: "Older", items: olderItems });

  return groups;
}

function AppSidebar({ mobileOpen, setMobileOpen }: { mobileOpen: boolean; setMobileOpen: (open: boolean) => void }) {
  const isMobile = useIsMobile();
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const { data: usage, isLoading: usageLoading } = useUsage(isAuthenticated);
  const { data: conversations, isLoading } = useConversations();
  const [location, setLocation] = useLocation();
  const renameMutation = useRenameConversation();
  const deleteMutation = useDeleteConversation();
  const clerk = useClerk();
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId !== null && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleRenameStart = (conv: { id: number; title: string }) => {
    setEditingId(conv.id);
    setEditingTitle(conv.title);
  };

  const handleRenameSubmit = () => {
    if (editingId === null) return;
    const trimmed = editingTitle.trim();
    if (trimmed && trimmed.length <= 200) {
      renameMutation.mutate({ id: editingId, title: trimmed });
    }
    setEditingId(null);
    setEditingTitle("");
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRenameSubmit();
    } else if (e.key === "Escape") {
      setEditingId(null);
      setEditingTitle("");
    }
  };

  const handleDeleteConfirm = () => {
    if (deleteConfirmId === null) return;
    const wasActive = location === `/chat/${deleteConfirmId}`;
    deleteMutation.mutate(deleteConfirmId, {
      onSuccess: () => {
        if (wasActive) {
          setLocation("/");
        }
      },
    });
    setDeleteConfirmId(null);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setLocation("/");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setLocation]);

  const handleManagePlan = async () => {
    try {
      const res = await authFetch("/api/stripe/create-portal", {
        method: "POST",
      });
      if (res.ok) {
        const { url } = await res.json();
        if (url) window.location.href = url;
      } else {
        const data = await res.json().catch(() => ({}));
        if (data.code === "RECENT_AUTH_REQUIRED") {
          toast({
            title: "Re-authentication required",
            description: "For security, please sign in again to perform this action.",
            variant: "destructive",
          });
          await clerk.signOut();
          clerk.redirectToSignIn({ redirectUrl: window.location.href });
        }
      }
    } catch (err) {
      console.error("Portal error:", err);
    }
  };

  const conversationGroups = conversations
    ? groupConversationsByDate(conversations.slice(0, 15))
    : [];

  const maxCredits = Math.max(usage?.debateCredits || 0, 100);
  const progressWidth = usage ? Math.min((usage.debateCredits / maxCredits) * 100, 100) : 0;


  const handleNavigation = (path: string) => {
    setLocation(path);
    if (isMobile) setMobileOpen(false);
  };

  const sidebarContent = (
    <>
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="px-4 pt-4 pb-2">
            <div className="flex items-center justify-between px-2">
              <button
                onClick={() => handleNavigation("/")}
                className="bg-transparent border-0 p-0 cursor-pointer flex items-center"
                data-testid="button-home"
              >
                <img src={logoImg} alt="AI Council" className="h-7 w-auto" data-testid="img-logo" />
              </button>
              {isMobile && (
                <button
                  onClick={() => setMobileOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-transparent border border-[#eaeaea] cursor-pointer hover:bg-[#f5f5f5] transition-colors"
                  data-testid="button-close-sidebar"
                >
                  <X className="w-4 h-4 text-[#737373]" />
                </button>
              )}
            </div>
          </div>

          <div className="px-4 pt-3 pb-2">
            <button
              onClick={() => handleNavigation("/")}
              className="w-full h-11 bg-white border border-[#eaeaea] rounded-lg shadow-sm flex items-center justify-between px-3 cursor-pointer hover:border-[#d1d5db] transition-colors"
              data-testid="button-new-debate"
            >
              <div className="flex items-center gap-2">
                <Plus className="w-3 h-3 text-[#1a1a1a]" />
                <span className="font-medium text-sm text-[#1a1a1a] tracking-[-0.5px]">New debate</span>
              </div>
              <div className="bg-[#f3f4f6] border border-[#e5e7eb] rounded min-w-[28px] h-[20px] flex items-center justify-center px-1">
                <span className="font-medium text-[10px] text-[#737373] leading-none">⌘K</span>
              </div>
            </button>
          </div>

          {usage?.paymentFailed && (
            <div className="mx-4 mb-2 flex items-center gap-1.5 px-2.5 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600" data-testid="banner-payment-failed">
              <span>Payment failed.</span>
              <button onClick={handleManagePlan} className="font-semibold underline text-red-600 bg-transparent border-0 cursor-pointer text-xs p-0" data-testid="button-update-payment">
                Update
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 pt-2">
            {isAuthenticated && (
              <>
                {isLoading ? (
                  <div className="px-2 py-3 text-xs text-[#737373]">Loading...</div>
                ) : conversations?.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-[#737373]">No debates yet. Share your first challenge.</div>
                ) : (
                  conversationGroups.map((group) => (
                    <div key={group.label} className="mb-3">
                      <div className="px-2 py-1">
                        <span className="font-semibold text-[11px] text-[#737373] tracking-[0.05px] leading-[17px]">{group.label}</span>
                      </div>
                      <div className="flex flex-col">
                        {group.items.map((conv) => {
                          const isActive = location === `/chat/${conv.id}`;
                          const isEditing = editingId === conv.id;
                          return (
                            <div
                              key={conv.id}
                              className={`group w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors relative ${
                                isActive ? 'bg-[#f5f5f5]' : 'bg-transparent hover:bg-[#f5f5f5]'
                              }`}
                              data-testid={`link-conversation-${conv.id}`}
                            >
                              {isEditing ? (
                                <>
                                  <MessageSquare className="w-4 h-4 text-[#737373] flex-shrink-0" />
                                  <input
                                    ref={editInputRef}
                                    type="text"
                                    value={editingTitle}
                                    onChange={(e) => setEditingTitle(e.target.value)}
                                    onBlur={handleRenameSubmit}
                                    onKeyDown={handleRenameKeyDown}
                                    className="flex-1 min-w-0 text-[13px] tracking-[-0.5px] bg-white border border-[#d1d5db] rounded px-1.5 py-0.5 outline-none focus:border-[#1a1a1a]"
                                    data-testid={`input-rename-${conv.id}`}
                                  />
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={() => handleNavigation(`/chat/${conv.id}`)}
                                    className="flex-1 min-w-0 flex items-center gap-2.5 bg-transparent border-0 p-0 cursor-pointer text-left"
                                    data-testid={`button-conversation-${conv.id}`}
                                  >
                                    <MessageSquare className="w-4 h-4 text-[#737373] flex-shrink-0" />
                                    <span className={`text-[13px] tracking-[-0.5px] truncate ${
                                      isActive ? 'font-medium text-[#1a1a1a]' : 'font-normal text-[#1a1a1a]'
                                    }`}>
                                      {conv.title.length > 22 ? conv.title.substring(0, 22) + "..." : conv.title}
                                    </span>
                                  </button>
                                  <DropdownMenu modal={false}>
                                    <DropdownMenuTrigger asChild>
                                      <button
                                        className={`${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} focus:opacity-100 data-[state=open]:opacity-100 bg-transparent border-0 p-1 rounded cursor-pointer hover:bg-[#e5e7eb] transition-opacity flex-shrink-0`}
                                        data-testid={`button-menu-${conv.id}`}
                                      >
                                        <MoreHorizontal className="w-4 h-4 text-[#737373]" />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" side="bottom" className="w-36 z-[9000]">
                                      <DropdownMenuItem
                                        onSelect={() => handleRenameStart(conv)}
                                        data-testid={`button-rename-${conv.id}`}
                                      >
                                        <Pencil className="w-3.5 h-3.5 mr-2" />
                                        Rename
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onSelect={() => setDeleteConfirmId(conv.id)}
                                        className="text-red-600 focus:text-red-600"
                                        data-testid={`button-delete-${conv.id}`}
                                      >
                                        <Trash2 className="w-3.5 h-3.5 mr-2" />
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        </div>

        <div className="border-t border-[#eaeaea] bg-[#fafafa] px-4 pt-4 pb-4">
          {(authLoading || (isAuthenticated && usageLoading)) ? (
            <div className="h-10 rounded-lg bg-[#f5f5f5] animate-pulse" />
          ) : isAuthenticated && user ? (
            <>
              <div className="bg-white border border-[#eaeaea] rounded-lg shadow-[0px_2px_8px_rgba(0,0,0,0.05)] px-2 py-1.5 mb-2">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-medium text-[11px] text-[#1a1a1a]">Council Credits</span>
                  {usage?.isSubscribed && (
                    <span className="bg-[#eef2ff] text-[#4f46e5] font-semibold text-[9px] px-1.5 py-0.5 rounded">PRO</span>
                  )}
                </div>
                <div className="flex items-baseline gap-1 mb-0.5" data-testid="text-credits">
                  <span className="font-semibold text-base text-[#1a1a1a]">{usage?.debateCredits || 0}</span>
                  <span className="font-normal text-[10px] text-[#737373]">credits remaining</span>
                </div>
                {usage?.expiringCredits && usage?.expiringInDays != null && usage.expiringInDays <= 14 && (usage?.debateCredits || 0) > 0 && (
                  <div className="flex items-center gap-1 mb-1" data-testid="text-expiring-credits">
                    <span className={`text-[11px] font-medium ${usage.expiringInDays <= 3 ? 'text-red-500' : 'text-amber-600'}`}>
                      {usage.expiringCredits} credit{usage.expiringCredits !== 1 ? 's' : ''} expiring in {usage.expiringInDays} day{usage.expiringInDays !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}
                <div className="w-full h-1 bg-[#f3f4f6] rounded-full mb-1.5">
                  <div
                    className="h-1 bg-[#1a1a1a] rounded-full transition-all duration-300"
                    style={{ width: `${progressWidth}%` }}
                  />
                </div>
                {(usage?.debateCredits || 0) === 0 ? (
                  <button
                    onClick={() => handleNavigation("/credits")}
                    className="w-full text-[10px] font-semibold text-white bg-[#1a1a1a] border-0 py-1.5 rounded-lg cursor-pointer hover:bg-[#2b2b2b] transition-colors flex items-center justify-center gap-1"
                    data-testid="button-buy-credits"
                  >
                    Get Credits to Continue
                  </button>
                ) : (
                  <button
                    onClick={() => handleNavigation("/credits")}
                    className="w-full text-[10px] font-medium text-[#1a1a1a] bg-white border border-[#eaeaea] py-1 rounded-lg cursor-pointer hover:border-[#d1d5db] transition-colors flex items-center justify-center gap-1"
                    data-testid="button-buy-credits"
                  >
                    Get More
                  </button>
                )}
              </div>


              <button
                onClick={() => handleNavigation("/affiliate")}
                className="w-full h-8 mb-2 bg-transparent border border-[#eaeaea] rounded-lg font-medium text-xs text-[#737373] cursor-pointer hover:border-[#d1d5db] hover:text-[#1a1a1a] transition-colors flex items-center justify-center gap-1.5"
                data-testid="button-affiliate"
              >
                <Send className="w-3 h-3" />
                Refer & Earn
              </button>

              {usage?.isSubscribed && (
                <button
                  onClick={handleManagePlan}
                  className="w-full h-8 mb-2 bg-transparent border border-[#eaeaea] rounded-lg font-medium text-xs text-[#737373] cursor-pointer hover:border-[#d1d5db] hover:text-[#1a1a1a] transition-colors"
                  data-testid="button-manage-plan"
                >
                  Manage plan
                </button>
              )}

              <div className="flex items-center justify-between rounded-lg px-2 py-2 cursor-pointer hover:bg-[#f5f5f5] transition-all group" onClick={() => handleNavigation("/profile")}>
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <div className="w-7 h-7 rounded-full bg-[#eef2ff] flex items-center justify-center flex-shrink-0" data-testid="img-avatar">
                    <span className="text-[11px] font-semibold text-[#4f46e5]">
                      {(user.firstName || user.email || "U")[0].toUpperCase()}
                    </span>
                  </div>
                  <span className="font-medium text-[13px] text-[#1a1a1a] tracking-[-0.5px] truncate" data-testid="text-username">
                    {user.firstName || user.email?.split("@")[0] || "User"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <div
                    className="w-7 h-7 flex items-center justify-center rounded-md text-[#737373] hover:bg-[#eaeaea] hover:text-[#1a1a1a] transition-colors"
                    data-testid="button-settings"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); logout(); }}
                    className="w-7 h-7 flex items-center justify-center rounded-md bg-transparent border-0 text-[#737373] cursor-pointer hover:bg-[#f5f5f5] hover:text-[#1a1a1a] transition-colors"
                    data-testid="button-signout"
                    title="Sign out"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { try { clerk.openSignIn({ afterSignInUrl: window.location.href }); } catch { clerk.redirectToSignIn({ redirectUrl: window.location.href }); } }}
                className="w-full text-center text-[#737373] text-sm py-2.5 rounded-lg hover:text-[#1a1a1a] hover:bg-[#f5f5f5] transition-colors border-0 bg-transparent cursor-pointer"
                data-testid="link-signin"
              >
                Sign in
              </button>
              <button
                onClick={() => { try { clerk.openSignUp({ afterSignUpUrl: window.location.href }); } catch { clerk.redirectToSignUp({ redirectUrl: window.location.href }); } }}
                className="w-full text-center bg-[#1a1a1a] text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-[#2b2b2b] transition-colors border-0 cursor-pointer"
                data-testid="button-getstarted"
              >
                Get started free
              </button>
            </div>
          )}
        </div>
    </>
  );

  return (
    <>
      {isMobile ? (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-[280px] p-0 bg-[#fafafa] border-r border-[#eaeaea] flex flex-col [&>button]:hidden">
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
              <SheetDescription>App navigation sidebar</SheetDescription>
            </SheetHeader>
            <div className="flex-1 flex flex-col h-full overflow-hidden" data-testid="sidebar">
              {sidebarContent}
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        <aside className="fixed top-3 left-3 w-[256px] h-[calc(100vh-24px)] bg-[#fafafa] border-r border-[#eaeaea] flex flex-col z-[8000] rounded-l-2xl" data-testid="sidebar">
          {sidebarContent}
        </aside>
      )}

      <AlertDialog open={deleteConfirmId !== null} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this conversation? This action cannot be undone and all messages will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CheckoutSuccessHandler() {
  const { isAuthenticated, isLoading } = useAuth();
  const [toast, setToast] = useState<{ message: string; type: "success" | "info" } | null>(null);

  useEffect(() => {
    if (isLoading) return;

    const params = new URLSearchParams(window.location.search);
    const checkoutStatus = params.get("checkout");

    if (checkoutStatus === "success" && isAuthenticated) {
      const creditsParam = params.get("credits");
      const sessionId = params.get("session_id");
      window.history.replaceState({}, "", "/");
      
      if (sessionId) {
        setToast({ message: `${creditsParam || ''} credits added to your account!`, type: "success" });
        authFetch("/api/stripe/sync-credits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.debateCredits !== undefined) {
              queryClient.invalidateQueries({ queryKey: ["/api/user/usage"] });
            }
          })
          .catch(console.error);
      } else {
        setToast({ message: "Purchase complete! Credits added.", type: "success" });
        queryClient.invalidateQueries({ queryKey: ["/api/user/usage"] });
      }
    } else if (checkoutStatus === "cancel") {
      window.history.replaceState({}, "", "/");
      setToast({ message: "Checkout cancelled. You can upgrade anytime.", type: "info" });
    }
  }, [isAuthenticated, isLoading]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  if (!toast) return null;

  return (
    <div className={`checkout-toast checkout-toast--${toast.type}`} data-testid="toast-checkout">
      <span>{toast.message}</span>
      <button onClick={() => setToast(null)} className="checkout-toast-close" data-testid="button-close-toast">&times;</button>
    </div>
  );
}

function CreditRecoveryHandler() {
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;

    const recovered = sessionStorage.getItem("council_credits_recovered");
    if (recovered) return;
    sessionStorage.setItem("council_credits_recovered", "1");

    authFetch("/api/stripe/recover-credits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.recovered > 0) {
          queryClient.invalidateQueries({ queryKey: ["/api/user/usage"] });
        }
      })
      .catch(() => {});
  }, [isAuthenticated, isLoading]);

  return null;
}

function PendingPromptHandler() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;

    const pendingPrompt = sessionStorage.getItem("council_pending_prompt");
    if (!pendingPrompt) return;

    const pendingModels = sessionStorage.getItem("council_pending_models");
    const pendingChairman = sessionStorage.getItem("council_pending_chairman");

    sessionStorage.removeItem("council_pending_prompt");
    sessionStorage.removeItem("council_pending_models");
    sessionStorage.removeItem("council_pending_chairman");

    const models = pendingModels ? JSON.parse(pendingModels) : undefined;
    const chairmanModel = pendingChairman || undefined;

    authFetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: pendingPrompt, models, chairmanModel }),
    })
      .then(async (res) => {
        if (res.ok) return res.json();
        if (res.status === 403) {
          const data = await res.json();
          if (data.code === "PAYWALL") {
            setLocation("/credits");
            return null;
          }
        }
        throw new Error("Failed to create conversation");
      })
      .then((conv) => {
        if (!conv) return;
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
        setLocation(`/chat/${conv.id}`);
      })
      .catch((err) => {
        console.error("Failed to auto-submit pending prompt:", err);
      });
  }, [isAuthenticated, isLoading, setLocation]);

  return null;
}

function PageFallback() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[40vh]">
      <div className="w-6 h-6 border-2 border-[#eaeaea] border-t-[#1a1a1a] rounded-full animate-spin" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/chat/:id" component={Chat} />
        <Route path="/credits" component={Credits} />
        <Route path="/profile" component={Profile} />
        <Route path="/affiliate" component={Affiliate} />
        <Route path="/admin" component={Admin} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function LoggedOutHeader() {
  const clerk = useClerk();

  const handleAuth = (mode: "signIn" | "signUp") => {
    try {
      if (mode === "signIn") {
        clerk.openSignIn({ afterSignInUrl: window.location.href });
      } else {
        clerk.openSignUp({ afterSignUpUrl: window.location.href });
      }
    } catch (e) {
      console.error("[AUTH] Modal failed, trying redirect:", e);
      try {
        if (mode === "signIn") {
          clerk.redirectToSignIn({ redirectUrl: window.location.href });
        } else {
          clerk.redirectToSignUp({ redirectUrl: window.location.href });
        }
      } catch (e2) {
        console.error("[AUTH] Redirect also failed:", e2);
      }
    }
  };

  return (
    <header className="flex items-center justify-between px-3 py-3 md:p-4 lg:px-8 lg:py-5 border-b border-[#eaeaea] bg-white relative z-[100]">
      <div className="flex items-center">
        <img src={logoImg} alt="AI Council" className="h-7 md:h-8 w-auto" data-testid="img-logo-header" />
      </div>
      <div className="flex items-center gap-2 md:gap-3" style={{ position: 'relative', zIndex: 9999 }}>
        <button
          onClick={() => handleAuth("signIn")}
          className="hidden sm:flex items-center justify-center gap-2 bg-white border border-[#eaeaea] text-[#1a1a1a] text-sm font-medium py-2 px-4 rounded-lg shadow-sm hover:bg-[#fafafa] hover:border-[#d4d4d4] transition-all cursor-pointer"
          data-testid="button-login"
        >
          Log In
        </button>
        <button
          onClick={() => handleAuth("signUp")}
          className="flex items-center justify-center gap-2 bg-[#1a1a1a] text-white text-xs md:text-sm font-medium py-2 px-3 md:px-4 lg:px-5 rounded-lg shadow-sm hover:bg-[#2b2b2b] transition-colors border-0 cursor-pointer whitespace-nowrap"
          data-testid="button-get-free"
        >
          Get 3 Free Debates
        </button>
      </div>
    </header>
  );
}

function useRefgrowSignupTracking() {
  const { user, isAuthenticated } = useAuth();
  useEffect(() => {
    if (!isAuthenticated || !user?.email) return;
    const key = `refgrow_signup_tracked_${user.id}`;
    if (localStorage.getItem(key)) return;
    trackRefgrowSignup(user.email);
    localStorage.setItem(key, "1");
  }, [isAuthenticated, user?.email, user?.id]);
}

function AppLayout() {
  const { isAuthenticated, isLoading } = useAuth();
  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useRefgrowSignupTracking();

  if (isLoading) {
    return <PreAuthLayout />;
  }

  if (isAuthenticated) {
    return (
      <div className="flex min-h-screen bg-[#fafafa]">
        <AppSidebar mobileOpen={mobileMenuOpen} setMobileOpen={setMobileMenuOpen} />
        <main className={`${isMobile ? '' : 'ml-[268px]'} flex-1 min-h-screen min-w-0 overflow-x-hidden`}>
          {isMobile && (
            <div className="sticky top-0 z-40 flex items-center gap-3 px-4 py-3 bg-white border-b border-[#eaeaea]">
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-transparent border border-[#eaeaea] cursor-pointer hover:bg-[#f5f5f5] transition-colors"
                data-testid="button-hamburger"
              >
                <Menu className="w-5 h-5 text-[#1a1a1a]" />
              </button>
              <img src={logoImg} alt="AI Council" className="h-6 w-auto" />
            </div>
          )}
          <div className={`bg-white border border-[#eaeaea] shadow-[0px_1px_3px_rgba(0,0,0,0.04),0px_4px_24px_rgba(0,0,0,0.06)] min-h-[calc(100vh-24px)] ${isMobile ? 'mx-1 mt-1 mb-1 rounded-xl' : 'mt-3 mr-3 mb-3 rounded-2xl'} flex flex-col overflow-hidden`}>
            <Router />
          </div>
        </main>
        <SupportWidget />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#fafafa]">
      <div className="flex-1 flex flex-col border border-[#eaeaea] rounded-2xl shadow-[0px_4px_24px_rgba(0,0,0,0.06),0px_1px_3px_rgba(0,0,0,0.04)] bg-white overflow-hidden m-1 md:m-3">
        <LoggedOutHeader />
        <main className="flex-1 flex flex-col relative overflow-y-auto bg-white">
          <Router />
        </main>
      </div>
      <SupportWidget />
    </div>
  );
}

function ClerkTokenSync() {
  const { getToken, isSignedIn } = useClerkAuth();
  useEffect(() => {
    setClerkTokenGetter(getToken);
    if (isSignedIn) {
      queryClient.invalidateQueries();
    }
  }, [getToken, isSignedIn]);
  return null;
}

function PreAuthHeader() {
  return (
    <header className="flex items-center justify-between p-4 lg:px-8 lg:py-5 border-b border-[#eaeaea] bg-white sticky top-0 z-50">
      <div className="flex items-center">
        <img src={logoImg} alt="AI Council" className="h-8 w-auto" data-testid="img-logo-header" />
      </div>
      <div className="flex items-center gap-3">
        <div className="h-9 w-16 rounded-lg bg-[#f5f5f5] animate-pulse hidden sm:block" />
        <div className="h-9 w-36 rounded-lg bg-[#f5f5f5] animate-pulse" />
      </div>
    </header>
  );
}

function PreAuthLayout() {
  return (
    <div className="flex flex-col min-h-screen bg-[#fafafa]">
      <div className="flex-1 flex flex-col border border-[#eaeaea] rounded-2xl shadow-[0px_4px_24px_rgba(0,0,0,0.06),0px_1px_3px_rgba(0,0,0,0.04)] bg-white overflow-hidden m-1 md:m-3">
        <PreAuthHeader />
        <main className="flex-1 flex flex-col relative overflow-y-auto bg-white">
          <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
            <div className="w-full max-w-2xl space-y-8">
              <div className="text-center space-y-3">
                <div className="h-10 w-64 bg-[#f5f5f5] rounded-lg animate-pulse mx-auto" />
                <div className="h-5 w-80 bg-[#f5f5f5] rounded-lg animate-pulse mx-auto" />
              </div>
              <div className="h-[120px] w-full bg-[#f5f5f5] rounded-2xl animate-pulse" />
              <div className="flex justify-center gap-3">
                <div className="h-10 w-24 bg-[#f5f5f5] rounded-full animate-pulse" />
                <div className="h-10 w-24 bg-[#f5f5f5] rounded-full animate-pulse" />
                <div className="h-10 w-24 bg-[#f5f5f5] rounded-full animate-pulse" />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function getInitialClerkKey(): string | null {
  const viteKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  return (viteKey && viteKey !== "__RUNTIME__") ? viteKey : null;
}

function App() {
  const [clerkKey, setClerkKey] = useState<string | null>(getInitialClerkKey);
  const [configError, setConfigError] = useState(false);
  const [retryTrigger, setRetryTrigger] = useState(0);

  useEffect(() => {
    if (clerkKey) return;
    let cancelled = false;
    let activeController: AbortController | null = null;
    setConfigError(false);

    async function fetchConfigWithRetry() {
      const maxRetries = 8;
      const baseDelay = 1000;
      const maxDelay = 30000;
      const fetchTimeout = 10000;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (cancelled) return;
        const controller = new AbortController();
        activeController = controller;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        try {
          timeoutId = setTimeout(() => controller.abort("timeout"), fetchTimeout);
          const res = await fetch("/api/config", { signal: controller.signal });
          if (!res.ok) throw new Error(`Config endpoint returned ${res.status}`);
          const data = await res.json();
          if (cancelled) return;
          if (data.clerkPublishableKey) {
            setClerkKey(data.clerkPublishableKey);
            return;
          }
          throw new Error("Empty clerkPublishableKey in response");
        } catch {
          if (attempt < maxRetries) {
            const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
            await new Promise(r => setTimeout(r, delay));
          }
        } finally {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
          activeController = null;
        }
      }
      if (!cancelled) setConfigError(true);
    }
    fetchConfigWithRetry();
    return () => {
      cancelled = true;
      activeController?.abort("cleanup");
    };
  }, [retryTrigger]);

  if (configError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-red-500" data-testid="text-config-error">Unable to connect to the server. Please try again.</p>
        <button
          data-testid="button-retry-config"
          className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90 transition-colors"
          onClick={() => setRetryTrigger(t => t + 1)}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!clerkKey) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground" data-testid="text-connecting">Connecting to server…</p>
      </div>
    );
  }

  return (
    <ClerkProvider publishableKey={clerkKey}>
      <ClerkTokenSync />
      <QueryClientProvider client={queryClient}>
        <PendingPromptHandler />
        <CheckoutSuccessHandler />
        <CreditRecoveryHandler />
        <AppLayout />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;
