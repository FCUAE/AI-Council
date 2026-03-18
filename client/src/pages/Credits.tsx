import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useUsage } from "@/hooks/use-usage";
import { useClerk } from "@clerk/react";
import { ArrowLeft, Lock, Check, CreditCard, AlertCircle, Coins, Info, Brain, Swords, Target } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { authFetch } from "@/lib/clerk-token";
import { getRefgrowReferral } from "@/hooks/use-refgrow";

const PACKS = [
  {
    size: 100,
    price: "$15.00",
    priceRaw: 15,
    perCredit: "$0.15",
    label: "Explorer",
    description: "Around 20-50 debates depending on models chosen.",
    popular: false,
    savings: null,
  },
  {
    size: 325,
    price: "$39.00",
    priceRaw: 39,
    perCredit: "$0.12",
    label: "Strategist",
    description: "Around 65-160 debates depending on models chosen.",
    popular: true,
    savings: "Save 20%",
  },
  {
    size: 900,
    price: "$89.00",
    priceRaw: 89,
    perCredit: "~$0.099",
    label: "Visionary",
    description: "Around 180-450 debates depending on models chosen.",
    popular: false,
    savings: "Save 34%",
  },
];

const FAQ_ITEMS = [
  {
    question: "Why does one debate use multiple credits?",
    answer: "Each debate isn't one AI call. It's 12+ API calls across 4 models, with multiple rounds where they challenge each other. The credits reflect the actual compute behind every answer you get.",
  },
  {
    question: "Is this worth it for every question?",
    answer: "No, and we'd rather be honest about that. If you need a quick fact or a simple rewrite, a regular AI chat is fine. The Council is for the questions where a shallow answer could actually cost you: a business decision, a strategy call, a complex problem where blind spots matter.",
  },
  {
    question: "What happens to my credits if I don't use them?",
    answer: "Credits are active for 60 days from purchase. We'll remind you 30 days before so nothing goes to waste.",
  },
  {
    question: "Can I pick which AI models are in the debate?",
    answer: "Yes. You can choose your model lineup before each debate. Premium thinking models use more credits per session but go deeper.",
  },
  {
    question: "How is this different from asking the same question to 4 AI tools myself?",
    answer: "Three things you can't do manually: (1) The models respond to each other's arguments, not just your original question. (2) There's a structured challenge round where weak reasoning gets exposed. (3) A final synthesis forces them to either agree or clearly flag where they disagree. Copying your question into 4 tabs gives you 4 separate answers. This gives you one answer that 4 models fought over.",
  },
  {
    question: "Will you offer a monthly subscription?",
    answer: "We're working on it. Right now, credit packs with a 60-day window let you try the product without a recurring commitment. When subscriptions launch, existing users will get first access.",
  },
];

export default function Credits() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { openSignIn } = useClerk();
  const { data: usage } = useUsage(isAuthenticated);
  const [selectedPack, setSelectedPack] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pack = PACKS[selectedPack];

  const handlePurchase = async () => {
    if (!isAuthenticated) {
      openSignIn();
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
      <div className="p-6 md:p-8 lg:p-12 max-w-[1100px] mx-auto w-full">

        <div className="mb-8">
          <button
            onClick={() => setLocation("/")}
            className="flex items-center gap-2 text-[#737373] hover:text-[#1a1a1a] transition-colors text-[13px] font-medium mb-4 bg-transparent border-0 cursor-pointer p-0"
            data-testid="button-back-credits"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Council
          </button>
          <h1
            className="text-3xl md:text-4xl font-semibold text-[#1a1a1a] tracking-[-0.7px] mb-2"
            data-testid="text-credits-title"
          >
            Get More Credits
          </h1>
          <p className="text-[15px] text-[#737373]">
            Purchase additional credits to continue running debates with top AI models.
          </p>
        </div>

        {usage && (
          <div className="flex items-center gap-3 mb-6 p-4 bg-white rounded-xl border border-[#eaeaea] shadow-[0_1px_3px_rgba(0,0,0,0.02)]" data-testid="current-balance">
            <div className="w-10 h-10 bg-[#f5f5f5] rounded-lg flex items-center justify-center">
              <Coins className="w-5 h-5 text-[#737373]" />
            </div>
            <div>
              <p className="text-[13px] text-[#737373]">Current Balance</p>
              <p className="text-[17px] font-semibold text-[#1a1a1a]" data-testid="text-credit-balance">
                {usage.debateCredits} credit{usage.debateCredits !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        )}

        <div
          className="mb-8 rounded-2xl bg-gradient-to-br from-[#f8f6ff] via-[#f0f4ff] to-[#f6f8ff] border border-[#e8e4f0] p-8 md:p-10 text-center"
          data-testid="category-reset-banner"
        >
          <h2 className="text-2xl md:text-[28px] font-semibold text-[#1a1a1a] tracking-[-0.5px] mb-8 leading-snug max-w-[680px] mx-auto">
            One question. Four AI models. A real argument before you get an answer.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 mb-8">
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white border border-[#e8e4f0] flex items-center justify-center shadow-sm">
                <Brain className="w-6 h-6 text-[#6d5acd]" />
              </div>
              <p className="text-[14px] text-[#4a4a4a] leading-relaxed">
                <span className="font-semibold text-[#1a1a1a]">4 AI models</span> each analyze your question independently
              </p>
            </div>
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white border border-[#e8e4f0] flex items-center justify-center shadow-sm">
                <Swords className="w-6 h-6 text-[#6d5acd]" />
              </div>
              <p className="text-[14px] text-[#4a4a4a] leading-relaxed">
                <span className="font-semibold text-[#1a1a1a]">3 rounds of debate</span> where they challenge each other's thinking
              </p>
            </div>
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white border border-[#e8e4f0] flex items-center justify-center shadow-sm">
                <Target className="w-6 h-6 text-[#6d5acd]" />
              </div>
              <p className="text-[14px] text-[#4a4a4a] leading-relaxed">
                <span className="font-semibold text-[#1a1a1a]">1 final answer</span> with the weak points already removed
              </p>
            </div>
          </div>
          <p className="text-[14px] text-[#737373] italic max-w-[600px] mx-auto leading-relaxed">
            Think of it as a room full of brilliant minds who disagree by design, all to deliver the smartest possible answer for you.
          </p>
        </div>

        <div className="mb-8" data-testid="objection-accordion">
          <Accordion type="single" collapsible>
            <AccordionItem value="objection" className="border border-[#eaeaea] rounded-xl px-5 bg-white">
              <AccordionTrigger className="text-[14px] font-semibold text-[#1a1a1a] hover:no-underline" data-testid="trigger-objection-accordion">
                How does AI Council compare to ChatGPT/Claude in pricing?
              </AccordionTrigger>
              <AccordionContent className="text-[14px] text-[#4a4a4a] leading-relaxed">
                <p className="mb-3">
                  When you ask ChatGPT or Claude a question, you get one model's single attempt at an answer. Here's what happens when you ask the Council:
                </p>
                <ul className="space-y-2 mb-3 list-disc list-inside">
                  <li><span className="font-medium text-[#1a1a1a]">4 independent analyses</span> — each model works through your question separately, with no groupthink.</li>
                  <li><span className="font-medium text-[#1a1a1a]">Structured adversarial debate</span> — models directly challenge each other's reasoning, exposing gaps and weak logic.</li>
                  <li><span className="font-medium text-[#1a1a1a]">Forced synthesis</span> — a final round integrates the strongest arguments and clearly flags unresolved disagreements.</li>
                </ul>
                <p className="mb-3">
                  That's 12+ API calls and 3 distinct processing stages per debate — not one quick request.
                </p>
                <p className="font-medium text-[#1a1a1a]">
                  You're comparing a flashlight to a search party. The cost reflects the orchestration, not a markup.
                </p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">

          <div className="lg:col-span-2 order-1">

            <section className="bg-white rounded-2xl border border-[#eaeaea] shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] overflow-hidden h-full">
              <div className="p-5 border-b border-[#eaeaea]">
                <h2 className="text-[15px] font-semibold text-[#1a1a1a]">Select Package</h2>
              </div>
              <div className="p-5 space-y-3" data-testid="pricing-cards">
                {PACKS.map((p, index) => (
                  <label
                    key={p.size}
                    className="block cursor-pointer"
                    data-testid={`pricing-card-${p.size}`}
                  >
                    <div
                      className={`flex items-center justify-between p-4 rounded-xl transition-all ${
                        selectedPack === index
                          ? "border-2 border-[#1a1a1a] bg-[#fafafa]/50"
                          : "border border-[#eaeaea] hover:border-[#d4d4d4]"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={selectedPack === index ? "text-[#1a1a1a]" : "text-gray-300"}>
                          {selectedPack === index ? (
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
                        <div>
                          <h3 className="font-semibold text-[#1a1a1a] text-[15px] flex items-center gap-2">
                            <span>{p.label}</span>
                            <span className="font-normal text-[#737373]">–</span>
                            <span className="font-normal text-[#737373]">{p.size} credits</span>
                            {p.popular && (
                              <span className="text-[11px] bg-[#eef2ff] text-[#4f46e5] px-2 py-0.5 rounded-full font-semibold">
                                Most Popular
                              </span>
                            )}
                          </h3>
                          <p className="text-[13px] text-[#737373]">{p.description}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-xl font-semibold text-[#1a1a1a]">{p.price}</span>
                        <p className="text-[12px] text-[#737373]">{p.perCredit}/credit</p>
                        {p.savings && (
                          <p className="text-[11px] text-green-600 font-medium">{p.savings}</p>
                        )}
                      </div>
                    </div>
                    <input
                      type="radio"
                      name="package"
                      className="hidden"
                      checked={selectedPack === index}
                      onChange={() => setSelectedPack(index)}
                    />
                  </label>
                ))}
              </div>
            </section>
          </div>

          <div className="lg:col-span-1 order-3 lg:order-2">
            <div className="bg-white rounded-2xl border border-[#eaeaea] shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] overflow-hidden h-full flex flex-col lg:sticky lg:top-6">
              <div className="p-5 border-b border-[#eaeaea]">
                <h2 className="text-[15px] font-semibold text-[#1a1a1a]">Order Summary</h2>
              </div>

              <div className="p-5 space-y-3 border-b border-[#eaeaea]">
                <div className="flex justify-between text-[13px]">
                  <span className="text-[#737373]">Package</span>
                  <span className="font-medium text-[#1a1a1a]">{pack.label}</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-[#737373]">Credits</span>
                  <span className="font-medium text-[#1a1a1a]">{pack.size} credits</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-[#737373]">Per credit</span>
                  <span className="font-medium text-[#1a1a1a]">{pack.perCredit}</span>
                </div>
              </div>

              <div className="p-5 border-b border-[#eaeaea]">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-[#1a1a1a] text-[15px]">Total</span>
                  <span className="text-2xl font-semibold text-[#1a1a1a]">{pack.price}</span>
                </div>
              </div>

              <div className="p-5 bg-[#f5f5f5]/30 flex-1 flex flex-col justify-end">
                <div className="flex items-center justify-between p-3 border border-[#eaeaea] rounded-lg bg-white mb-4">
                  <div className="flex items-center gap-2.5">
                    <CreditCard className="w-5 h-5 text-[#4f46e5]" />
                    <span className="text-[13px] font-medium text-[#1a1a1a]">Pay with Stripe</span>
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-2 p-3 mb-3 bg-red-50 border border-red-200 rounded-lg" data-testid="error-checkout">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-[12px] text-red-700">{error}</p>
                  </div>
                )}

                <button
                  onClick={handlePurchase}
                  disabled={loading}
                  className="w-full bg-[#1a1a1a] hover:bg-[#2b2b2b] text-white py-2.5 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 mb-3 shadow-sm text-[13px] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed border-0"
                  data-testid="button-pay"
                >
                  {loading ? "Processing..." : isAuthenticated ? `Pay ${pack.price}` : "Sign in to Purchase"}
                </button>

                <p className="text-[11px] text-center text-[#737373]">
                  <Lock className="w-3 h-3 inline mr-1 relative -top-[1px]" />
                  Secure payment powered by Stripe
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-2 px-1 order-2 lg:order-3">
            <div className="flex items-center gap-2 text-[13px] text-[#737373]">
              <Check className="w-3.5 h-3.5 text-[#737373]" />
              <span>Credits valid for ~60 days after purchase</span>
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="inline-flex items-center gap-1 cursor-help" aria-label="Credit validity info" data-testid="btn-credit-validity-info">
                      <Info className="w-3.5 h-3.5 text-[#737373]" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    className="max-w-[320px] bg-[#1a1a1a] text-white text-[13px] leading-relaxed px-4 py-3 border-none rounded-lg shadow-lg"
                  >
                    Your credits stay active for 60 days after your most recent purchase. Buy any pack before they expire and your full balance — including leftover credits — gets a fresh 60-day window.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex items-center gap-2 text-[13px] text-[#737373]">
              <Check className="w-3.5 h-3.5 text-[#737373]" />
              <span>Full model access with any purchase</span>
            </div>
            <div className="flex items-center gap-2 text-[13px] text-[#737373]">
              <Check className="w-3.5 h-3.5 text-[#737373]" />
              <span>One-time payment, no subscription</span>
            </div>
          </div>

        </div>

        <div className="mt-12 mb-8" data-testid="faq-section">
          <h2 className="text-xl font-semibold text-[#1a1a1a] tracking-[-0.3px] mb-6">
            Frequently Asked Questions
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
