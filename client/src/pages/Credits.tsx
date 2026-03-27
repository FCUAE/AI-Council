import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useClerk } from "@clerk/react";
import { ArrowLeft, Lock, AlertCircle, Zap, Shield, CreditCard, Clock } from "lucide-react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { authFetch } from "@/lib/clerk-token";
import { getRefgrowReferral } from "@/hooks/use-refgrow";

const PACKS = [
  {
    size: 100,
    priceRaw: 29,
    label: "Explorer",
    debateRange: "~15–50",
    perCredit: "$0.29",
    expirationDays: 90,
    badge: null as string | null,
    discount: null as string | null,
  },
  {
    size: 400,
    priceRaw: 89,
    label: "Strategist",
    debateRange: "~55–200",
    perCredit: "$0.22",
    expirationDays: 120,
    badge: "Most Popular",
    discount: "Save 24%",
  },
  {
    size: 1000,
    priceRaw: 179,
    label: "Mastermind",
    debateRange: "~130–500",
    perCredit: "$0.18",
    expirationDays: 180,
    badge: "Best Value",
    discount: "Save 38%",
  },
];

const FAQ_ITEMS = [
  {
    question: "Why does one debate use multiple credits?",
    answer: "Each debate runs across 4 AI models through multiple rounds of independent analysis, cross-examination, and synthesis. Premium reasoning models like GPT-5.4 Pro and o3 use more credits per debate because they perform deeper analysis — but you always choose which models participate.",
  },
  {
    question: "What happens to unused credits?",
    answer: "Credits are valid based on your pack: Explorer credits last 90 days, Strategist credits last 120 days, and Mastermind credits last 180 days from purchase.",
  },
  {
    question: "Can I choose which AI models participate?",
    answer: "Yes — you have full control over which models join each debate. Blend lightweight models for more debates per credit, or deploy premium reasoning models for maximum intelligence. The credit cost updates in real time as you change your council.",
  },
];

export default function Credits() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const clerk = useClerk();
  const [selectedPack, setSelectedPack] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pack = PACKS[selectedPack];

  const handlePurchase = async () => {
    if (!isAuthenticated) {
      try { clerk.openSignIn(); } catch { clerk.redirectToSignIn({ redirectUrl: window.location.href }); }
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const referral = getRefgrowReferral();
      const res = await authFetch("/api/stripe/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packSize: pack.size, ...(referral ? { referral } : {}) }),
      });
      let data: any;
      try {
        data = await res.json();
      } catch {
        setError("Something went wrong. Please try again.");
        return;
      }
      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        setError(data.message || "Something went wrong. Please try again.");
      }
    } catch (err) {
      setError("Unable to connect. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-[#eaeaea] border-t-[#1a1a1a] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-[calc(100vh-24px)] overflow-y-auto">
      <div className="p-6 md:p-8 lg:p-12 max-w-[880px] mx-auto w-full">

        <div className="mb-8">
          <button
            onClick={() => setLocation("/")}
            className="flex items-center gap-2 text-[#737373] hover:text-[#1a1a1a] transition-colors text-[13px] font-medium mb-4 bg-transparent border-0 cursor-pointer p-0"
            data-testid="button-back-credits"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Council
          </button>
        </div>

        <div className="mb-12 text-center" data-testid="value-anchor">
          <h1 className="text-2xl md:text-[28px] font-semibold text-[#1a1a1a] tracking-[-0.5px] mb-3 leading-snug md:whitespace-nowrap" data-testid="text-headline">
            One question. Four AI models. One pressure-tested answer.
          </h1>
          <p className="text-[15px] text-[#737373] leading-relaxed mx-auto md:whitespace-nowrap" data-testid="text-subtitle">
            Every response is debated and challenged across multiple rounds before it reaches you.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8" data-testid="pricing-cards">
          {PACKS.map((p, index) => {
            const isSelected = selectedPack === index;
            return (
              <button
                key={p.size}
                type="button"
                onClick={() => setSelectedPack(index)}
                className={`relative text-left p-6 pt-8 rounded-2xl transition-all cursor-pointer border-0 bg-white flex flex-col ${
                  isSelected
                    ? "ring-2 ring-[#1a1a1a] shadow-[0_4px_16px_-4px_rgba(0,0,0,0.12)]"
                    : "ring-1 ring-[#eaeaea] hover:ring-[#d4d4d4] shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)]"
                }`}
                data-testid={`pricing-card-${p.size}`}
              >
                {p.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold whitespace-nowrap ${
                      p.badge === "Most Popular"
                        ? "bg-[#1a1a1a] text-white"
                        : "bg-[#eef2ff] text-[#4f46e5]"
                    }`} data-testid={`badge-${p.size}`}>
                      {p.badge}
                    </span>
                  </div>
                )}

                <div className="absolute top-4 right-4">
                  {isSelected ? (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <circle cx="10" cy="10" r="9" stroke="#1a1a1a" strokeWidth="2" />
                      <circle cx="10" cy="10" r="5" fill="#1a1a1a" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <circle cx="10" cy="10" r="9" stroke="#d1d5db" strokeWidth="2" />
                    </svg>
                  )}
                </div>

                <h3 className="text-[15px] font-semibold text-[#1a1a1a] mb-3">
                  {p.label}
                </h3>

                <p className="text-[32px] font-bold text-[#1a1a1a] tracking-[-1px] leading-none mb-1" data-testid={`text-credits-${p.size}`}>
                  {p.size.toLocaleString()}
                </p>
                <p className="text-[13px] font-medium text-[#737373] mb-3">credits</p>

                <p className="text-[14px] text-[#4a4a4a] mb-1" data-testid={`text-debates-${p.size}`}>
                  {p.debateRange} debates
                </p>

                <p className="text-[12px] text-[#999] mb-auto">
                  depending on models chosen
                </p>

                <div className="mt-4 pt-3 border-t border-[#f0f0f0] flex items-center flex-wrap gap-y-1">
                  <span className="text-[14px] font-semibold text-[#1a1a1a]" data-testid={`text-price-${p.size}`}>${p.priceRaw}</span>
                  <span className="text-[12px] text-[#999] ml-2" data-testid={`text-per-credit-${p.size}`}>{p.perCredit}/credit</span>
                  {p.discount && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700" data-testid={`badge-discount-${p.size}`}>
                      {p.discount}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-[#b0b0b0]" />
                  <span className="text-[11px] text-[#b0b0b0]">Valid {p.expirationDays} days</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="bg-white rounded-2xl ring-1 ring-[#eaeaea] shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] p-6 mb-6" data-testid="checkout-strip">
          <div className="flex items-center justify-between mb-5">
            <div className="text-[14px] text-[#737373]">
              <span className="font-semibold text-[#1a1a1a]" data-testid="text-selected-plan">{pack.label}</span>
              {" — "}
              <span data-testid="text-selected-credits">{pack.size.toLocaleString()} credits</span>
              <span className="text-[#999]" data-testid="text-selected-debates">{" "}({pack.debateRange} debates)</span>
            </div>
            <span className="text-xl font-bold text-[#1a1a1a]" data-testid="text-selected-price">${pack.priceRaw}.00</span>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg" data-testid="error-checkout">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-[12px] text-red-700">{error}</p>
            </div>
          )}

          <button
            onClick={handlePurchase}
            disabled={loading}
            className="w-full bg-[#1a1a1a] hover:bg-[#2b2b2b] text-white py-3 px-4 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2 shadow-sm text-[15px] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed border-0"
            data-testid="button-pay"
          >
            {loading ? "Processing..." : isAuthenticated ? `Pay $${pack.priceRaw}.00` : "Sign in to Purchase"}
          </button>

          <div className="flex items-center justify-center gap-4 mt-4 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[11px] text-[#999]" data-testid="trust-onetime">
              <CreditCard className="w-3 h-3" />
              One-time payment
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-[#999]" data-testid="trust-models">
              <Zap className="w-3 h-3" />
              Full model access
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-[#999]" data-testid="trust-expiry">
              <Clock className="w-3 h-3" />
              Valid {pack.expirationDays} days
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-[#999]" data-testid="trust-stripe">
              <Shield className="w-3 h-3" />
              Secure via Stripe
            </span>
          </div>
        </div>

        <div className="mt-12 mb-8" data-testid="faq-section">
          <h2 className="text-[15px] font-medium text-[#737373] tracking-[-0.2px] mb-4">
            Common Questions
          </h2>
          <Accordion type="single" collapsible className="space-y-3">
            {FAQ_ITEMS.map((item, index) => (
              <AccordionItem
                key={index}
                value={`faq-${index}`}
                className="border border-[#eaeaea] rounded-xl px-5 bg-white"
                data-testid={`faq-item-${index}`}
              >
                <AccordionTrigger className="text-[14px] font-semibold text-[#1a1a1a] hover:no-underline text-left" data-testid={`trigger-faq-${index}`}>
                  {item.question}
                </AccordionTrigger>
                <AccordionContent className="text-[14px] text-[#4a4a4a] leading-relaxed">
                  {item.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

      </div>
    </div>
  );
}
