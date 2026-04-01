import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useUser, useClerk } from "@clerk/react";
import { useLocation } from "wouter";
import { FileText, Download, CreditCard, ArrowLeft, ExternalLink, Loader2, Trash2, Check, Shield, Eye, EyeOff, ChevronDown } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { authFetch } from "@/lib/clerk-token";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

interface PaymentMethod {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

interface Invoice {
  id: string;
  description: string;
  amount: number;
  currency: string;
  date: number;
  status: string;
  pdfUrl: string | null;
  receiptUrl: string | null;
}

const profileSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(100),
  lastName: z.string().max(100).default(""),
  email: z.string().min(1, "Email is required").email("Invalid email address").max(255),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().min(1, "Please confirm your new password"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type PasswordFormValues = z.infer<typeof passwordSchema>;

const setPasswordSchema = z.object({
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type SetPasswordFormValues = z.infer<typeof setPasswordSchema>;

export default function Profile() {
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const { user: clerkUser } = useUser();
  const clerk = useClerk();
  const [, setLocation] = useLocation();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const { toast } = useToast();

  const handleRecentAuthRequired = async () => {
    toast({
      title: "Re-authentication required",
      description: "For security, please sign in again to perform this action.",
      variant: "destructive",
    });
    await clerk.signOut();
    clerk.redirectToSignIn({ redirectUrl: window.location.href });
  };

  const hasPassword = clerkUser?.passwordEnabled ?? false;

  const passwordForm = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const setPasswordForm = useForm<SetPasswordFormValues>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const handleChangePassword = async (data: PasswordFormValues) => {
    if (!clerkUser) return;
    setIsChangingPassword(true);
    try {
      await clerkUser.updatePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });
      await clerkUser.reload();
      toast({ title: "Password updated", description: "Your password has been changed successfully." });
      passwordForm.reset();
      setShowPasswordForm(false);
    } catch (error: unknown) {
      const err = error as { errors?: Array<{ code?: string; longMessage?: string; message?: string }>, message?: string };
      const clerkError = err?.errors?.[0];
      const code = clerkError?.code;
      const message = clerkError?.longMessage || clerkError?.message || err?.message || "Failed to update password";
      if (code === "form_password_incorrect" || message.toLowerCase().includes("current password") || message.toLowerCase().includes("incorrect")) {
        passwordForm.setError("currentPassword", { message: message || "Current password is incorrect" });
        toast({ title: "Error", description: message || "Current password is incorrect", variant: "destructive" });
      } else if (code === "form_password_pwned" || code === "form_password_not_strong_enough") {
        passwordForm.setError("newPassword", { message });
        toast({ title: "Error", description: message, variant: "destructive" });
      } else {
        toast({ title: "Error", description: message, variant: "destructive" });
      }
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleSetPassword = async (data: SetPasswordFormValues) => {
    if (!clerkUser) return;
    setIsChangingPassword(true);
    try {
      await clerkUser.updatePassword({
        newPassword: data.newPassword,
      });
      await clerkUser.reload();
      toast({ title: "Password set", description: "Your password has been set successfully. You can now sign in with your email and password." });
      setPasswordForm.reset();
      setShowPasswordForm(false);
    } catch (error: unknown) {
      const err = error as { errors?: Array<{ code?: string; longMessage?: string; message?: string }>, message?: string };
      const clerkError = err?.errors?.[0];
      const code = clerkError?.code;
      const message = clerkError?.longMessage || clerkError?.message || err?.message || "Failed to set password";
      if (code === "form_password_pwned" || code === "form_password_not_strong_enough") {
        setPasswordForm.setError("newPassword", { message });
        toast({ title: "Error", description: message, variant: "destructive" });
      } else {
        toast({ title: "Error", description: message, variant: "destructive" });
      }
    } finally {
      setIsChangingPassword(false);
    }
  };

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
    },
  });

  useEffect(() => {
    if (user) {
      form.reset({
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
      });
    }
  }, [user?.firstName, user?.lastName, user?.email]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: ProfileFormValues) => {
      const res = await apiRequest("PATCH", "/api/auth/profile", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Profile updated", description: "Your profile information has been saved." });
    },
    onError: (error: any) => {
      let message = "Failed to update profile";
      try {
        const raw = error?.message || "";
        const jsonPart = raw.substring(raw.indexOf("{"));
        const parsed = JSON.parse(jsonPart);
        if (parsed.message) message = parsed.message;
      } catch {}
      if (message.toLowerCase().includes("email")) {
        form.setError("email", { message });
      } else {
        toast({ title: "Error", description: message, variant: "destructive" });
      }
    },
  });

  const onSubmit = (data: ProfileFormValues) => {
    updateProfileMutation.mutate({
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
      email: data.email.trim(),
    });
  };

  const { data: paymentMethod, isLoading: pmLoading } = useQuery<PaymentMethod | null>({
    queryKey: ["/api/stripe/payment-method"],
    enabled: isAuthenticated,
  });

  const { data: invoices, isLoading: invoicesLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/stripe/invoices"],
    enabled: isAuthenticated,
  });

  const setupPaymentMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/stripe/setup-payment", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "RECENT_AUTH_REQUIRED") {
          await handleRecentAuthRequired();
          return null;
        }
        throw new Error(data.message || "Failed to set up payment");
      }
      return data;
    },
    onSuccess: (data) => {
      if (data?.url) {
        if (data.url.startsWith("https://checkout.stripe.com/")) {
          window.location.href = data.url;
        } else {
          toast({ title: "Error", description: "Invalid payment redirect URL", variant: "destructive" });
        }
      }
    },
  });

  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/user", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: "Failed to delete account." }));
        if (data.code === "RECENT_AUTH_REQUIRED") {
          await handleRecentAuthRequired();
          return;
        }
        throw new Error(data.message || "Failed to delete account.");
      }
      return res.json();
    },
    onSuccess: async (data) => {
      if (!data) return;
      await logout();
      setLocation("/");
    },
  });

  if (authLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]" role="status" aria-label="Loading" aria-busy="true">
        <div className="w-8 h-8 border-2 border-[#eaeaea] border-t-[#1a1a1a] rounded-full animate-spin" />
        <span className="sr-only">Loading...</span>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <h2 className="text-2xl font-bold text-[#1a1a1a] mb-2">Sign in required</h2>
        <p className="text-[15px] text-[#737373] mb-6">You need to sign in to access your account settings.</p>
        <button
          onClick={() => { try { clerk.openSignIn(); } catch { clerk.redirectToSignIn({ redirectUrl: window.location.href }); } }}
          className="px-6 py-3 bg-[#1a1a1a] text-white rounded-lg font-medium hover:bg-[#2b2b2b] transition-colors border-0 cursor-pointer text-[14px]"
          data-testid="button-signin"
        >
          Sign In
        </button>
      </div>
    );
  }

  const formatCardBrand = (brand: string) => {
    const brands: Record<string, string> = {
      visa: "Visa",
      mastercard: "Mastercard",
      amex: "American Express",
      discover: "Discover",
      diners: "Diners Club",
      jcb: "JCB",
      unionpay: "UnionPay",
    };
    return brands[brand] || brand.charAt(0).toUpperCase() + brand.slice(1);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatAmount = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  return (
    <div className="p-4 md:p-10 max-w-4xl mx-auto w-full">
      <div className="mb-8">
        <button
          onClick={() => setLocation("/")}
          className="flex items-center gap-1.5 text-[13px] font-medium text-[#737373] hover:text-[#1a1a1a] transition-colors mb-4 bg-transparent border-0 cursor-pointer p-0"
          data-testid="button-back"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>
        <h1 className="text-3xl font-bold text-[#1a1a1a]" data-testid="heading-settings">Account Settings</h1>
        <p className="text-[#737373] mt-2 text-[15px]">Manage your profile and billing information.</p>
      </div>

      <div className="space-y-6">
        <section className="bg-white rounded-2xl border border-[#eaeaea] shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.04)] overflow-hidden" data-testid="section-profile">
          <div className="p-6 border-b border-[#eaeaea]">
            <h2 className="text-[17px] font-semibold text-[#1a1a1a]">Profile Information</h2>
            <p className="text-[13px] text-[#737373] mt-1">Update your profile details below.</p>
          </div>

          <form onSubmit={form.handleSubmit(onSubmit)} className="p-6 space-y-6">
            <div className="flex items-center gap-6">
              <div className="w-20 h-20 rounded-full bg-[#eef2ff] flex items-center justify-center flex-shrink-0" data-testid="img-profile-avatar">
                <span className="text-2xl font-semibold text-[#4f46e5]">
                  {(form.watch("firstName") || form.watch("email") || "U")[0].toUpperCase()}
                </span>
              </div>
              <div>
                <p className="text-[15px] font-semibold text-[#1a1a1a]" data-testid="text-display-name">
                  {[form.watch("firstName"), form.watch("lastName")].filter(Boolean).join(" ") || "—"}
                </p>
                <p className="text-[13px] text-[#737373] mt-0.5" data-testid="text-display-email">{form.watch("email")}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label htmlFor="profile-first-name" className="block text-[13px] font-medium text-[#737373]">First Name</label>
                <input
                  id="profile-first-name"
                  type="text"
                  {...form.register("firstName")}
                  className={`w-full border ${form.formState.errors.firstName ? "border-red-400" : "border-[#eaeaea]"} rounded-lg px-4 py-2.5 text-[14px] bg-white text-[#1a1a1a] outline-none focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5] transition-colors`}
                  data-testid="input-first-name"
                />
                {form.formState.errors.firstName && (
                  <p className="text-[12px] text-red-500" data-testid="error-first-name">{form.formState.errors.firstName.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <label htmlFor="profile-last-name" className="block text-[13px] font-medium text-[#737373]">Last Name</label>
                <input
                  id="profile-last-name"
                  type="text"
                  {...form.register("lastName")}
                  className="w-full border border-[#eaeaea] rounded-lg px-4 py-2.5 text-[14px] bg-white text-[#1a1a1a] outline-none focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5] transition-colors"
                  data-testid="input-last-name"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="profile-email" className="block text-[13px] font-medium text-[#737373]">Email Address</label>
              <input
                id="profile-email"
                type="email"
                {...form.register("email")}
                className={`w-full border ${form.formState.errors.email ? "border-red-400" : "border-[#eaeaea]"} rounded-lg px-4 py-2.5 text-[14px] bg-white text-[#1a1a1a] outline-none focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5] transition-colors`}
                data-testid="input-email"
              />
              {form.formState.errors.email && (
                <p className="text-[12px] text-red-500" data-testid="error-email">{form.formState.errors.email.message}</p>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!form.formState.isDirty || updateProfileMutation.isPending}
                className="px-5 py-2.5 bg-[#1a1a1a] text-white rounded-lg font-medium text-[14px] hover:bg-[#2b2b2b] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 border-0 cursor-pointer"
                data-testid="button-save-profile"
              >
                {updateProfileMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin" role="status" aria-label="Loading" aria-busy="true" /><span className="sr-only">Loading...</span></>
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Save Changes
              </button>
            </div>
          </form>
        </section>

        <section className="bg-white rounded-2xl border border-[#eaeaea] shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.04)] overflow-hidden" data-testid="section-security">
          <div className="p-6 border-b border-[#eaeaea]">
            <h2 className="text-[17px] font-semibold text-[#1a1a1a]">Security</h2>
            <p className="text-[13px] text-[#737373] mt-1">Manage your password and account security.</p>
          </div>

          <div className="p-6">
            {!showPasswordForm ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-[#f5f5f5] rounded-lg flex items-center justify-center">
                    <Shield className="w-5 h-5 text-[#737373]" />
                  </div>
                  <div>
                    <p className="text-[14px] font-medium text-[#1a1a1a]" data-testid="text-password-status">
                      {hasPassword ? "Password" : "No password set"}
                    </p>
                    <p className="text-[12px] text-[#737373]" data-testid="text-password-description">
                      {hasPassword
                        ? "Change your current password"
                        : "You signed in with a social account. Set a password to also sign in with email."}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowPasswordForm(true);
                    setShowCurrentPassword(false);
                    setShowNewPassword(false);
                    setShowConfirmPassword(false);
                    passwordForm.reset();
                    setPasswordForm.reset();
                  }}
                  disabled={!clerkUser}
                  className="px-4 py-2 bg-[#1a1a1a] hover:bg-[#2b2b2b] text-white rounded-lg text-[13px] font-medium shadow-sm transition-colors border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  data-testid="button-change-password"
                >
                  {hasPassword ? "Change Password" : "Set Password"}
                </button>
              </div>
            ) : hasPassword ? (
              <form onSubmit={passwordForm.handleSubmit(handleChangePassword)} className="space-y-4 w-full md:max-w-md">
                <div className="space-y-2">
                  <label htmlFor="current-password" className="block text-[13px] font-medium text-[#737373]">Current Password</label>
                  <div className="relative">
                    <input
                      id="current-password"
                      type={showCurrentPassword ? "text" : "password"}
                      {...passwordForm.register("currentPassword")}
                      className={`w-full border ${passwordForm.formState.errors.currentPassword ? "border-red-400" : "border-[#eaeaea]"} rounded-lg px-4 py-2.5 pr-10 text-[14px] bg-white text-[#1a1a1a] outline-none focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5] transition-colors`}
                      data-testid="input-current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a3a3a3] hover:text-[#737373] bg-transparent border-0 cursor-pointer p-0"
                      data-testid="button-toggle-current-password"
                    >
                      {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {passwordForm.formState.errors.currentPassword && (
                    <p className="text-[12px] text-red-500" data-testid="error-current-password">{passwordForm.formState.errors.currentPassword.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <label htmlFor="new-password" className="block text-[13px] font-medium text-[#737373]">New Password</label>
                  <div className="relative">
                    <input
                      id="new-password"
                      type={showNewPassword ? "text" : "password"}
                      {...passwordForm.register("newPassword")}
                      className={`w-full border ${passwordForm.formState.errors.newPassword ? "border-red-400" : "border-[#eaeaea]"} rounded-lg px-4 py-2.5 pr-10 text-[14px] bg-white text-[#1a1a1a] outline-none focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5] transition-colors`}
                      data-testid="input-new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a3a3a3] hover:text-[#737373] bg-transparent border-0 cursor-pointer p-0"
                      data-testid="button-toggle-new-password"
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {passwordForm.formState.errors.newPassword && (
                    <p className="text-[12px] text-red-500" data-testid="error-new-password">{passwordForm.formState.errors.newPassword.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <label htmlFor="confirm-password" className="block text-[13px] font-medium text-[#737373]">Confirm New Password</label>
                  <div className="relative">
                    <input
                      id="confirm-password"
                      type={showConfirmPassword ? "text" : "password"}
                      {...passwordForm.register("confirmPassword")}
                      className={`w-full border ${passwordForm.formState.errors.confirmPassword ? "border-red-400" : "border-[#eaeaea]"} rounded-lg px-4 py-2.5 pr-10 text-[14px] bg-white text-[#1a1a1a] outline-none focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5] transition-colors`}
                      data-testid="input-confirm-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a3a3a3] hover:text-[#737373] bg-transparent border-0 cursor-pointer p-0"
                      data-testid="button-toggle-confirm-password"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {passwordForm.formState.errors.confirmPassword && (
                    <p className="text-[12px] text-red-500" data-testid="error-confirm-password">{passwordForm.formState.errors.confirmPassword.message}</p>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowPasswordForm(false);
                      passwordForm.reset();
                    }}
                    className="px-4 py-2 bg-white border border-[#eaeaea] rounded-lg text-[13px] font-medium text-[#1a1a1a] hover:bg-[#fafafa] transition-colors cursor-pointer"
                    data-testid="button-cancel-password"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isChangingPassword}
                    className="px-5 py-2 bg-[#1a1a1a] text-white rounded-lg font-medium text-[13px] hover:bg-[#2b2b2b] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 border-0 cursor-pointer"
                    data-testid="button-submit-password"
                  >
                    {isChangingPassword && <><Loader2 className="w-3.5 h-3.5 animate-spin" role="status" aria-label="Loading" aria-busy="true" /><span className="sr-only">Loading...</span></>}
                    Update Password
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={setPasswordForm.handleSubmit(handleSetPassword)} className="space-y-4 w-full md:max-w-md">
                <p className="text-[13px] text-[#737373] mb-2">
                  Set a password so you can also sign in with your email address.
                </p>

                <div className="space-y-2">
                  <label htmlFor="set-new-password" className="block text-[13px] font-medium text-[#737373]">New Password</label>
                  <div className="relative">
                    <input
                      id="set-new-password"
                      type={showNewPassword ? "text" : "password"}
                      {...setPasswordForm.register("newPassword")}
                      className={`w-full border ${setPasswordForm.formState.errors.newPassword ? "border-red-400" : "border-[#eaeaea]"} rounded-lg px-4 py-2.5 pr-10 text-[14px] bg-white text-[#1a1a1a] outline-none focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5] transition-colors`}
                      data-testid="input-set-new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a3a3a3] hover:text-[#737373] bg-transparent border-0 cursor-pointer p-0"
                      data-testid="button-toggle-set-new-password"
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {setPasswordForm.formState.errors.newPassword && (
                    <p className="text-[12px] text-red-500" data-testid="error-set-new-password">{setPasswordForm.formState.errors.newPassword.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <label htmlFor="set-confirm-password" className="block text-[13px] font-medium text-[#737373]">Confirm Password</label>
                  <div className="relative">
                    <input
                      id="set-confirm-password"
                      type={showConfirmPassword ? "text" : "password"}
                      {...setPasswordForm.register("confirmPassword")}
                      className={`w-full border ${setPasswordForm.formState.errors.confirmPassword ? "border-red-400" : "border-[#eaeaea]"} rounded-lg px-4 py-2.5 pr-10 text-[14px] bg-white text-[#1a1a1a] outline-none focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5] transition-colors`}
                      data-testid="input-set-confirm-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a3a3a3] hover:text-[#737373] bg-transparent border-0 cursor-pointer p-0"
                      data-testid="button-toggle-set-confirm-password"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {setPasswordForm.formState.errors.confirmPassword && (
                    <p className="text-[12px] text-red-500" data-testid="error-set-confirm-password">{setPasswordForm.formState.errors.confirmPassword.message}</p>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowPasswordForm(false);
                      setPasswordForm.reset();
                    }}
                    className="px-4 py-2 bg-white border border-[#eaeaea] rounded-lg text-[13px] font-medium text-[#1a1a1a] hover:bg-[#fafafa] transition-colors cursor-pointer"
                    data-testid="button-cancel-set-password"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isChangingPassword}
                    className="px-5 py-2 bg-[#1a1a1a] text-white rounded-lg font-medium text-[13px] hover:bg-[#2b2b2b] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 border-0 cursor-pointer"
                    data-testid="button-submit-set-password"
                  >
                    {isChangingPassword && <><Loader2 className="w-3.5 h-3.5 animate-spin" role="status" aria-label="Loading" aria-busy="true" /><span className="sr-only">Loading...</span></>}
                    Set Password
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-[#eaeaea] shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.04)] overflow-hidden" data-testid="section-billing">
          <div className="p-6 border-b border-[#eaeaea]">
            <h2 className="text-[17px] font-semibold text-[#1a1a1a]">Billing</h2>
            <p className="text-[13px] text-[#737373] mt-1">Manage your payment methods and purchase history.</p>
          </div>

          <div className="p-6 space-y-6">
            <div>
              <h3 className="text-[15px] font-semibold text-[#1a1a1a] mb-4">Payment Method</h3>
              {pmLoading ? (
                <div className="flex items-center justify-center p-6 border border-[#eaeaea] rounded-xl" role="status" aria-label="Loading" aria-busy="true">
                  <Loader2 className="w-5 h-5 text-[#737373] animate-spin" />
                  <span className="sr-only">Loading...</span>
                </div>
              ) : paymentMethod ? (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border border-[#eaeaea] rounded-xl bg-white">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-8 bg-gradient-to-r from-blue-600 to-blue-400 rounded flex items-center justify-center">
                      <CreditCard className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-[14px] font-medium text-[#1a1a1a]" data-testid="text-card-info">
                        {formatCardBrand(paymentMethod.brand)} •••• {paymentMethod.last4}
                      </p>
                      <p className="text-[12px] text-[#737373]" data-testid="text-card-expiry">
                        Expires {String(paymentMethod.expMonth).padStart(2, "0")}/{paymentMethod.expYear}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setupPaymentMutation.mutate()}
                    disabled={setupPaymentMutation.isPending}
                    className="px-4 py-2 bg-white border border-[#eaeaea] rounded-lg text-[13px] font-medium text-[#1a1a1a] shadow-sm hover:bg-[#fafafa] hover:border-[#d4d4d4] transition-all cursor-pointer disabled:opacity-50"
                    data-testid="button-update-payment"
                  >
                    {setupPaymentMutation.isPending ? "Loading..." : "Update"}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border border-dashed border-[#d4d4d4] rounded-xl bg-[#fafafa]">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-8 bg-[#eaeaea] rounded flex items-center justify-center shrink-0">
                      <CreditCard className="w-5 h-5 text-[#737373]" />
                    </div>
                    <p className="text-[14px] text-[#737373]" data-testid="text-no-payment">No payment method on file</p>
                  </div>
                  <button
                    onClick={() => setupPaymentMutation.mutate()}
                    disabled={setupPaymentMutation.isPending}
                    className="px-4 py-2 bg-[#1a1a1a] hover:bg-[#2b2b2b] text-white rounded-lg text-[13px] font-medium shadow-sm transition-colors border-0 cursor-pointer disabled:opacity-50"
                    data-testid="button-add-payment"
                  >
                    {setupPaymentMutation.isPending ? "Loading..." : "Add Card"}
                  </button>
                </div>
              )}
            </div>

            <div>
              <h3 className="text-[15px] font-semibold text-[#1a1a1a] mb-4">Billing History</h3>

              {invoicesLoading ? (
                <div className="flex items-center justify-center p-6" role="status" aria-label="Loading" aria-busy="true">
                  <Loader2 className="w-5 h-5 text-[#737373] animate-spin" />
                  <span className="sr-only">Loading...</span>
                </div>
              ) : invoices && invoices.length > 0 ? (
                <div className="space-y-3">
                  {invoices.map((invoice, index) => (
                    <div
                      key={invoice.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-white rounded-lg border border-[#eaeaea]"
                      data-testid={`row-billing-${index}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 bg-[#f5f5f5] rounded-lg flex items-center justify-center">
                          <FileText className="w-[13px] h-[13px] text-[#737373]" />
                        </div>
                        <div>
                          <p className="text-[13px] font-medium text-[#1a1a1a]">{invoice.description}</p>
                          <p className="text-[12px] text-[#737373]">{formatDate(invoice.date)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[14px] font-semibold text-[#1a1a1a]">
                          {formatAmount(invoice.amount, invoice.currency)}
                        </span>
                        {(invoice.pdfUrl || invoice.receiptUrl) && (
                          <a
                            href={invoice.pdfUrl || invoice.receiptUrl || "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#737373] hover:text-[#1a1a1a] transition-colors p-0"
                            data-testid={`button-download-${index}`}
                          >
                            <Download className="w-[13px] h-[13px]" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 border border-dashed border-[#d4d4d4] rounded-xl bg-[#fafafa]">
                  <FileText className="w-8 h-8 text-[#d4d4d4] mx-auto mb-3" />
                  <p className="text-[14px] text-[#737373]" data-testid="text-no-invoices">No purchase history yet</p>
                  <p className="text-[12px] text-[#a3a3a3] mt-1">Your credit purchases will appear here.</p>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-[#eaeaea] shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.04)] overflow-hidden" data-testid="section-privacy">
          <button
            onClick={() => setPrivacyOpen(!privacyOpen)}
            className="w-full flex items-center justify-between p-6 bg-transparent border-0 cursor-pointer text-left hover:bg-[#fafafa] transition-colors"
            data-testid="button-toggle-privacy"
          >
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-[#737373]" />
              <h2 className="text-[17px] font-semibold text-[#1a1a1a]">Privacy Policy</h2>
            </div>
            <ChevronDown className={`w-5 h-5 text-[#737373] transition-transform duration-200 ${privacyOpen ? 'rotate-180' : ''}`} />
          </button>
          {privacyOpen && (
            <div className="px-6 pb-6 border-t border-[#eaeaea]">
              <div className="prose prose-sm text-[#4a4a4a] space-y-4 pt-5">
                <p className="text-[14px] leading-relaxed">
                  Your privacy is important to us. This page outlines how AI Council collects,
                  uses, and protects your information.
                </p>
                <h3 className="text-[15px] font-semibold text-[#1a1a1a]">Information We Collect</h3>
                <p className="text-[14px] leading-relaxed">
                  We collect information you provide when creating an account, such as your
                  name and email address. We also collect conversation data you submit to the
                  platform in order to provide the AI debate service.
                </p>
                <h3 className="text-[15px] font-semibold text-[#1a1a1a]">How We Use Your Information</h3>
                <p className="text-[14px] leading-relaxed">
                  Your information is used to operate the service, process payments, and
                  improve the user experience. We do not sell your personal data to third
                  parties.
                </p>
                <h3 className="text-[15px] font-semibold text-[#1a1a1a]">Data Retention</h3>
                <p className="text-[14px] leading-relaxed">
                  We retain your data for as long as your account is active or as needed to
                  provide the service. You may request deletion of your data by contacting
                  support.
                </p>
                <h3 className="text-[15px] font-semibold text-[#1a1a1a]">Contact</h3>
                <p className="text-[14px] leading-relaxed">
                  If you have questions about this privacy policy, please contact us at{" "}
                  <a href="mailto:support@askaicouncil.com" className="text-[#4f46e5] underline" data-testid="link-privacy-email">
                    support@askaicouncil.com
                  </a>.
                </p>
                <p className="text-[12px] text-[#999] mt-6">
                  This is a placeholder privacy policy. A comprehensive policy will be published soon.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="flex justify-center mt-10 mb-6">
        <button
          onClick={() => setShowDeleteDialog(true)}
          className="flex items-center gap-2 px-4 py-2 text-[13px] font-medium text-[#a3a3a3] hover:text-red-500 transition-colors bg-transparent border-0 cursor-pointer"
          data-testid="button-delete-account"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete Account
        </button>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={(open) => { if (!deleteAccountMutation.isPending) { setShowDeleteDialog(open); if (!open) setDeleteConfirmation(""); } }}>
        <AlertDialogContent className="rounded-2xl" data-testid="dialog-delete-account">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[17px] font-semibold text-[#1a1a1a]">Delete Account</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="text-[14px] text-[#737373] mb-1">
                  Are you sure you want to delete your account? This action is <span className="font-semibold text-red-600">permanent and cannot be undone</span>.
                </p>
                <p className="text-[13px] text-[#a3a3a3]">
                  All your conversations, messages, and credit history will be permanently removed.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="mb-4">
            <label className="block text-[13px] text-[#737373] mb-1.5">
              Type <span className="font-mono font-semibold text-red-600">DELETE</span> to confirm
            </label>
            <input
              type="text"
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              placeholder="Type DELETE here"
              className="w-full px-3 py-2 text-[13px] border border-[#eaeaea] rounded-lg focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
              data-testid="input-delete-confirmation"
              autoComplete="off"
            />
          </div>

          {deleteAccountMutation.isError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700" data-testid="text-delete-error">
              {deleteAccountMutation.error?.message || "Something went wrong. Please try again."}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleteAccountMutation.isPending}
              className="px-4 py-2 bg-white border border-[#eaeaea] rounded-lg text-[13px] font-medium text-[#1a1a1a] hover:bg-[#fafafa] transition-colors cursor-pointer disabled:opacity-50"
              data-testid="button-cancel-delete"
            >
              Cancel
            </AlertDialogCancel>
            <button
              onClick={() => deleteAccountMutation.mutate()}
              disabled={deleteAccountMutation.isPending || deleteConfirmation !== "DELETE"}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-[13px] font-medium transition-colors border-0 cursor-pointer disabled:opacity-50 flex items-center gap-2"
              data-testid="button-confirm-delete"
            >
              {deleteAccountMutation.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" role="status" aria-label="Loading" aria-busy="true" />
                  <span className="sr-only">Loading...</span>
                  Deleting...
                </>
              ) : (
                "Delete Account"
              )}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="h-12" />
    </div>
  );
}
