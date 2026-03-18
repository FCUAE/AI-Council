import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Users, ExternalLink, DollarSign, Link2, Share2 } from "lucide-react";

export default function Affiliate() {
  const { user, isAuthenticated } = useAuth();
  const widgetRef = useRef<HTMLDivElement>(null);

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
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-[#eef2ff] flex items-center justify-center">
            <Users className="w-5 h-5 text-[#4f46e5]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#1a1a1a] tracking-[-1px]" data-testid="text-affiliate-title">Affiliate Program</h1>
            <p className="text-sm text-[#737373]">Earn commissions by referring new users to Council</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-[#eaeaea] rounded-xl p-5 shadow-sm" data-testid="card-affiliate-step-1">
          <div className="w-8 h-8 rounded-lg bg-[#f0fdf4] flex items-center justify-center mb-3">
            <Link2 className="w-4 h-4 text-[#16a34a]" />
          </div>
          <h3 className="font-semibold text-[#1a1a1a] text-sm mb-1">1. Share your link</h3>
          <p className="text-xs text-[#737373]">Get your unique referral link from the dashboard below and share it with your audience.</p>
        </div>
        <div className="bg-white border border-[#eaeaea] rounded-xl p-5 shadow-sm" data-testid="card-affiliate-step-2">
          <div className="w-8 h-8 rounded-lg bg-[#eff6ff] flex items-center justify-center mb-3">
            <Share2 className="w-4 h-4 text-[#2563eb]" />
          </div>
          <h3 className="font-semibold text-[#1a1a1a] text-sm mb-1">2. Users sign up & buy</h3>
          <p className="text-xs text-[#737373]">When someone clicks your link and purchases credits, the referral is tracked automatically.</p>
        </div>
        <div className="bg-white border border-[#eaeaea] rounded-xl p-5 shadow-sm" data-testid="card-affiliate-step-3">
          <div className="w-8 h-8 rounded-lg bg-[#fefce8] flex items-center justify-center mb-3">
            <DollarSign className="w-4 h-4 text-[#ca8a04]" />
          </div>
          <h3 className="font-semibold text-[#1a1a1a] text-sm mb-1">3. Earn commissions</h3>
          <p className="text-xs text-[#737373]">You earn a commission on every qualifying purchase. Track earnings in real time below.</p>
        </div>
      </div>

      <div className="bg-white border border-[#eaeaea] rounded-xl shadow-sm overflow-hidden" data-testid="affiliate-widget-container">
        <div className="border-b border-[#eaeaea] px-5 py-3 flex items-center justify-between">
          <h2 className="font-semibold text-[#1a1a1a] text-sm">Your Affiliate Dashboard</h2>
          <a
            href="https://refgrow.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#737373] hover:text-[#1a1a1a] flex items-center gap-1 transition-colors"
            data-testid="link-refgrow-external"
          >
            Powered by Refgrow <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <div ref={widgetRef} className="min-h-[400px] p-4" data-testid="affiliate-widget" />
      </div>
    </div>
  );
}
