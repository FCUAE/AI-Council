import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Users, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

function SkeletonLoader() {
  return (
    <div className="p-6 space-y-6 animate-pulse" data-testid="affiliate-skeleton">
      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1 space-y-4">
          <div className="h-6 bg-[#f0f0f0] rounded-md w-48" />
          <div className="h-4 bg-[#f0f0f0] rounded-md w-64" />
          <div className="h-4 bg-[#f0f0f0] rounded-md w-56" />
          <div className="mt-4 flex items-center gap-3">
            <div className="h-10 bg-[#f0f0f0] rounded-lg flex-1" />
            <div className="h-10 bg-[#f0f0f0] rounded-lg w-28" />
          </div>
          <div className="flex gap-3 mt-2">
            <div className="h-8 w-8 bg-[#f0f0f0] rounded-full" />
            <div className="h-8 w-8 bg-[#f0f0f0] rounded-full" />
          </div>
        </div>
        <div className="w-full md:w-56 space-y-3 border border-[#f0f0f0] rounded-xl p-4">
          <div className="h-5 bg-[#f0f0f0] rounded-md w-24" />
          <div className="h-4 bg-[#f0f0f0] rounded-md w-full" />
          <div className="h-4 bg-[#f0f0f0] rounded-md w-full" />
          <div className="h-4 bg-[#f0f0f0] rounded-md w-full" />
          <div className="h-4 bg-[#f0f0f0] rounded-md w-full" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="border border-[#f0f0f0] rounded-xl p-5 space-y-2">
            <div className="h-4 bg-[#f0f0f0] rounded-md w-20" />
            <div className="h-8 bg-[#f0f0f0] rounded-md w-16" />
            <div className="h-1.5 bg-[#f0f0f0] rounded-full w-full mt-2" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Affiliate() {
  const { user, isAuthenticated } = useAuth();
  const widgetRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();
  const [widgetLoaded, setWidgetLoaded] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !user?.email) return;
    if (!widgetRef.current) return;

    setWidgetLoaded(false);
    widgetRef.current.innerHTML = "";

    const container = document.createElement("div");
    container.id = "refgrow";
    container.setAttribute("data-project-id", "665");
    container.setAttribute("data-project-email", user.email);
    widgetRef.current.appendChild(container);

    const observer = new MutationObserver(() => {
      if (container.children.length > 0) {
        setWidgetLoaded(true);
        observer.disconnect();
      }
    });
    observer.observe(container, { childList: true, subtree: true });

    const script = document.createElement("script");
    script.src = "https://scripts.refgrowcdn.com/page.js";
    script.async = true;
    script.defer = true;
    widgetRef.current.appendChild(script);

    const timeout = setTimeout(() => {
      setWidgetLoaded(true);
      observer.disconnect();
    }, 8000);

    return () => {
      clearTimeout(timeout);
      observer.disconnect();
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
        {!widgetLoaded && <SkeletonLoader />}
        <div
          ref={widgetRef}
          className={`min-h-[400px] p-4 ${!widgetLoaded ? "sr-only" : ""}`}
          data-testid="affiliate-widget"
        />
      </div>
    </div>
  );
}
