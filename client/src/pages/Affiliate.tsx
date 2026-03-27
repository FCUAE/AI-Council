import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Users, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

export default function Affiliate() {
  const { user, isAuthenticated } = useAuth();
  const widgetRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isAuthenticated || !user?.email) return;
    if (!widgetRef.current) return;

    widgetRef.current.innerHTML = "";

    const container = document.createElement("div");
    container.id = "refgrow";
    container.setAttribute("data-project-id", "665");
    container.setAttribute("data-project-email", user.email);
    widgetRef.current.appendChild(container);

    const script = document.createElement("script");
    script.src = "https://scripts.refgrowcdn.com/page.js";
    script.async = true;
    script.defer = true;
    widgetRef.current.appendChild(script);

    return () => {
      if (widgetRef.current) {
        widgetRef.current.innerHTML = "";
      }
    };
  }, [isAuthenticated, user?.email]);

  if (!isAuthenticated) {
    return (
      <div className="flex-1 flex items-center justify-center p-8" data-testid="affiliate-login-prompt">
        <div className="text-center">
          <Users className="w-12 h-12 text-[#d1d5db] mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-[#1a1a1a] mb-2">Sign in to access the Affiliate Program</h2>
          <p className="text-[#737373] text-sm">Join our affiliate program and earn commissions on every referral.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-10 max-w-4xl mx-auto w-full" data-testid="affiliate-page">
      <div className="mb-8">
        <button
          onClick={() => setLocation("/")}
          className="flex items-center gap-2 text-[#737373] hover:text-[#1a1a1a] transition-colors text-[13px] font-medium mb-4 bg-transparent border-0 cursor-pointer p-0"
          data-testid="button-back-affiliate"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Council
        </button>
      </div>

      <div className="bg-white border border-[#eaeaea] rounded-xl shadow-sm overflow-hidden" data-testid="affiliate-widget-container">
        <div className="border-b border-[#eaeaea] px-5 py-3">
          <h2 className="font-semibold text-[#1a1a1a] text-sm">Your Affiliate Dashboard</h2>
        </div>
        <div ref={widgetRef} className="min-h-[400px] p-4" data-testid="affiliate-widget" />
      </div>
    </div>
  );
}
