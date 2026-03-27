import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/clerk-token";
import { ArrowLeft, RefreshCw, AlertTriangle, TrendingUp, Users, Package, Clock, Activity } from "lucide-react";

function useAdminCheck() {
  return useQuery({
    queryKey: ["/api/admin/check"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/check");
      if (!res.ok) return { isAdmin: false };
      return res.json();
    },
  });
}

function useAdminDashboard(enabled: boolean) {
  return useQuery({
    queryKey: ["/api/admin/dashboard"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/dashboard");
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
    refetchInterval: 60000,
    enabled,
  });
}

function useAdminAnalytics(enabled: boolean) {
  return useQuery({
    queryKey: ["/api/admin/analytics"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/analytics");
      if (!res.ok) throw new Error("Failed to load analytics");
      return res.json();
    },
    enabled,
  });
}

function Card({ title, icon: Icon, children }: { title: string; icon?: any; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-[#eaeaea] shadow-sm p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        {Icon && <Icon className="w-4 h-4 text-[#737373]" />}
        <h3 className="text-[14px] font-semibold text-[#1a1a1a]">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-[#fafafa] rounded-lg p-3 border border-[#f0f0f0]">
      <div className="text-[11px] text-[#737373] font-medium mb-1">{label}</div>
      <div className="text-[20px] font-bold text-[#1a1a1a] tracking-[-0.5px]">{value}</div>
      {sub && <div className="text-[11px] text-[#999] mt-0.5">{sub}</div>}
    </div>
  );
}

function ModelCostTable({ data, window }: { data: any[]; window: string }) {
  if (!data?.length) return <div className="text-[12px] text-[#999]">No data for {window}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-[#f0f0f0]">
            <th className="text-left py-2 px-2 font-medium text-[#737373]">Model</th>
            <th className="text-right py-2 px-2 font-medium text-[#737373]">Debates</th>
            <th className="text-right py-2 px-2 font-medium text-[#737373]">Avg Cost</th>
            <th className="text-right py-2 px-2 font-medium text-[#737373]">Total Cost</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row: any, i: number) => (
            <tr key={i} className="border-b border-[#f8f8f8] hover:bg-[#fafafa]">
              <td className="py-2 px-2 font-mono text-[11px]">{row.model}</td>
              <td className="py-2 px-2 text-right">{row.debate_count}</td>
              <td className="py-2 px-2 text-right font-mono">${Number(row.avg_cost).toFixed(4)}</td>
              <td className="py-2 px-2 text-right font-mono">${Number(row.total_cost).toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Admin() {
  const [, setLocation] = useLocation();
  const { data: adminCheck, isLoading: checkLoading } = useAdminCheck();
  const isAdmin = adminCheck?.isAdmin === true;
  const { data: dashboard, isLoading: dashLoading, refetch: refetchDash } = useAdminDashboard(isAdmin);
  const { data: analytics, isLoading: analyticsLoading, refetch: refetchAnalytics } = useAdminAnalytics(isAdmin);
  const [refreshing, setRefreshing] = useState(false);
  const [costWindow, setCostWindow] = useState<"7d" | "30d">("7d");

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await authFetch("/api/admin/analytics/refresh", { method: "POST" });
      await Promise.all([refetchDash(), refetchAnalytics()]);
    } catch {}
    setRefreshing(false);
  };

  if (checkLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-[#eaeaea] border-t-[#1a1a1a] rounded-full animate-spin" />
      </div>
    );
  }

  if (!adminCheck?.isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-[#1a1a1a] mb-2">Access Denied</h2>
          <p className="text-[13px] text-[#737373]">You don't have permission to view this page.</p>
          <button
            onClick={() => setLocation("/")}
            className="mt-4 text-[13px] font-medium text-[#1a1a1a] underline bg-transparent border-0 cursor-pointer"
            data-testid="button-back-home"
          >
            Back to Council
          </button>
        </div>
      </div>
    );
  }

  const funnel = dashboard?.funnel || {};
  const expReport = dashboard?.expirationReport || {};

  return (
    <div className="flex flex-col h-full min-h-[calc(100vh-24px)] overflow-y-auto">
      <div className="p-6 md:p-8 max-w-[1100px] mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLocation("/")}
              className="flex items-center gap-2 text-[#737373] hover:text-[#1a1a1a] transition-colors text-[13px] font-medium bg-transparent border-0 cursor-pointer p-0"
              data-testid="button-back-admin"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <h1 className="text-xl font-semibold text-[#1a1a1a] tracking-[-0.5px]">Admin Dashboard</h1>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-[12px] font-medium text-[#737373] hover:text-[#1a1a1a] bg-white border border-[#eaeaea] rounded-lg px-3 py-1.5 cursor-pointer transition-colors disabled:opacity-50"
            data-testid="button-refresh-analytics"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {dashLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-[#eaeaea] border-t-[#1a1a1a] rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {analytics && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <StatCard label="Total Revenue" value={`$${analytics.totals.totalRevenue.toFixed(2)}`} />
                <StatCard label="Total API Cost" value={`$${analytics.totals.totalApiCost.toFixed(2)}`} />
                <StatCard label="Debates" value={analytics.totals.totalDebates} />
                <StatCard label="Active Users" value={analytics.totals.activeUsers} />
              </div>
            )}

            <Card title="Conversion Funnel" icon={Users}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Total Signups" value={funnel.total_signups || 0} />
                <StatCard
                  label="Had First Debate"
                  value={funnel.had_first_debate || 0}
                  sub={funnel.total_signups > 0 ? `${((funnel.had_first_debate / funnel.total_signups) * 100).toFixed(1)}% conversion` : undefined}
                />
                <StatCard
                  label="Credits Exhausted"
                  value={funnel.credits_exhausted || 0}
                  sub={funnel.had_first_debate > 0 ? `${((funnel.credits_exhausted / funnel.had_first_debate) * 100).toFixed(1)}% of debaters` : undefined}
                />
                <StatCard
                  label="Made Purchase"
                  value={funnel.made_purchase || 0}
                  sub={funnel.credits_exhausted > 0 ? `${((funnel.made_purchase / funnel.credits_exhausted) * 100).toFixed(1)}% purchase rate` : undefined}
                />
              </div>
            </Card>

            <Card title="Model Cost Tracker" icon={TrendingUp}>
              <div className="flex gap-2 mb-3">
                {(["7d", "30d"] as const).map((w) => (
                  <button
                    key={w}
                    onClick={() => setCostWindow(w)}
                    className={`text-[11px] font-medium px-3 py-1 rounded-full border cursor-pointer transition-colors ${
                      costWindow === w
                        ? "bg-[#1a1a1a] text-white border-[#1a1a1a]"
                        : "bg-white text-[#737373] border-[#eaeaea] hover:border-[#d4d4d4]"
                    }`}
                    data-testid={`button-cost-window-${w}`}
                  >
                    {w === "7d" ? "7 Days" : "30 Days"}
                  </button>
                ))}
              </div>
              <ModelCostTable
                data={costWindow === "7d" ? dashboard?.modelCosts?.trailing7d : dashboard?.modelCosts?.trailing30d}
                window={costWindow === "7d" ? "7 days" : "30 days"}
              />
            </Card>

            <Card title="Margin Monitor" icon={Activity}>
              {dashboard?.margins?.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-[#f0f0f0]">
                        <th className="text-left py-2 px-2 font-medium text-[#737373]">Model Config</th>
                        <th className="text-left py-2 px-2 font-medium text-[#737373]">Chairman</th>
                        <th className="text-right py-2 px-2 font-medium text-[#737373]">Debates</th>
                        <th className="text-right py-2 px-2 font-medium text-[#737373]">Avg API Cost</th>
                        <th className="text-right py-2 px-2 font-medium text-[#737373]">Avg Credit Value</th>
                        <th className="text-right py-2 px-2 font-medium text-[#737373]">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.margins.map((row: any, i: number) => {
                        const marginPct = Number(row.margin_pct);
                        const isBelowTarget = marginPct < 50;
                        return (
                          <tr key={i} className={`border-b border-[#f8f8f8] ${isBelowTarget ? "bg-red-50" : "hover:bg-[#fafafa]"}`}>
                            <td className="py-2 px-2 font-mono text-[11px] max-w-[200px] truncate">{row.model_config}</td>
                            <td className="py-2 px-2 font-mono text-[11px]">{row.chairman_model}</td>
                            <td className="py-2 px-2 text-right">{row.debate_count}</td>
                            <td className="py-2 px-2 text-right font-mono">${Number(row.avg_api_cost).toFixed(4)}</td>
                            <td className="py-2 px-2 text-right font-mono">${Number(row.avg_credit_value).toFixed(4)}</td>
                            <td className={`py-2 px-2 text-right font-semibold ${isBelowTarget ? "text-red-600" : "text-green-600"}`}>
                              {isBelowTarget && <AlertTriangle className="w-3 h-3 inline mr-1" />}
                              {marginPct.toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-[12px] text-[#999]">Not enough settled debates to calculate margins (need 2+ per config)</div>
              )}
            </Card>

            <Card title="Overrun Tracker (>20% over estimate)" icon={AlertTriangle}>
              {dashboard?.overruns?.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-[#f0f0f0]">
                        <th className="text-left py-2 px-2 font-medium text-[#737373]">ID</th>
                        <th className="text-left py-2 px-2 font-medium text-[#737373]">Title</th>
                        <th className="text-left py-2 px-2 font-medium text-[#737373]">Models</th>
                        <th className="text-right py-2 px-2 font-medium text-[#737373]">Est. Cost</th>
                        <th className="text-right py-2 px-2 font-medium text-[#737373]">Actual Cost</th>
                        <th className="text-right py-2 px-2 font-medium text-[#737373]">Overrun</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.overruns.map((row: any) => (
                        <tr key={row.id} className="border-b border-[#f8f8f8] hover:bg-[#fafafa]">
                          <td className="py-2 px-2 font-mono">#{row.id}</td>
                          <td className="py-2 px-2 max-w-[160px] truncate">{row.title}</td>
                          <td className="py-2 px-2 font-mono text-[11px] max-w-[140px] truncate">{row.models}</td>
                          <td className="py-2 px-2 text-right font-mono">${Number(row.estimated_cost).toFixed(4)}</td>
                          <td className="py-2 px-2 text-right font-mono">${Number(row.actual_api_cost).toFixed(4)}</td>
                          <td className="py-2 px-2 text-right font-semibold text-red-600">+{Number(row.overrun_pct).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-[12px] text-[#999]">No overruns detected</div>
              )}
            </Card>

            <Card title="Pack Distribution" icon={Package}>
              {dashboard?.packDistribution?.length ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {dashboard.packDistribution.map((row: any) => {
                    const totalRevenue = dashboard.packDistribution.reduce((s: number, r: any) => s + Number(r.revenue), 0);
                    const pct = totalRevenue > 0 ? ((Number(row.revenue) / totalRevenue) * 100).toFixed(1) : "0";
                    return (
                      <div key={row.pack_tier} className="bg-[#fafafa] rounded-lg p-3 border border-[#f0f0f0]">
                        <div className="text-[13px] font-semibold text-[#1a1a1a] capitalize mb-1">{row.pack_tier}</div>
                        <div className="text-[18px] font-bold text-[#1a1a1a]">${Number(row.revenue).toLocaleString()}</div>
                        <div className="text-[11px] text-[#999]">{row.purchase_count} purchases · {pct}% of revenue</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[12px] text-[#999]">No pack purchases yet</div>
              )}
            </Card>

            <Card title="Credit Expiration Report" icon={Clock}>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <StatCard label="Expiring 7d" value={expReport.expiring_7d || 0} sub="credits" />
                <StatCard label="Expiring 30d" value={expReport.expiring_30d || 0} sub="credits" />
                <StatCard label="Expiring 90d" value={expReport.expiring_90d || 0} sub="credits" />
                <StatCard label="Dormant Credits" value={expReport.dormant_credits || 0} sub="pending removal" />
                <StatCard label="Dormant Batches" value={expReport.dormant_batches || 0} sub="batches" />
              </div>
            </Card>

            <Card title="Recent Analytics Events (7d)" icon={Activity}>
              {dashboard?.recentEvents?.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-[#f0f0f0]">
                        <th className="text-left py-2 px-2 font-medium text-[#737373]">Event</th>
                        <th className="text-right py-2 px-2 font-medium text-[#737373]">Count</th>
                        <th className="text-right py-2 px-2 font-medium text-[#737373]">Last Seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.recentEvents.map((row: any, i: number) => (
                        <tr key={i} className="border-b border-[#f8f8f8] hover:bg-[#fafafa]">
                          <td className="py-2 px-2 font-mono text-[11px]">{row.event}</td>
                          <td className="py-2 px-2 text-right">{row.count}</td>
                          <td className="py-2 px-2 text-right text-[#999]">
                            {row.last_seen ? new Date(row.last_seen).toLocaleString() : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-[12px] text-[#999]">No events recorded in the last 7 days</div>
              )}
            </Card>

            {analytics?.users && (
              <Card title="User Breakdown" icon={Users}>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-[#f0f0f0]">
                        <th className="text-left py-2 px-2 font-medium text-[#737373]">Email</th>
                        <th className="text-right py-2 px-2 font-medium text-[#737373]">Debates</th>
                        <th className="text-right py-2 px-2 font-medium text-[#737373]">Credits</th>
                        <th className="text-right py-2 px-2 font-medium text-[#737373]">API Cost</th>
                        <th className="text-right py-2 px-2 font-medium text-[#737373]">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.users.map((u: any) => (
                        <tr key={u.id} className="border-b border-[#f8f8f8] hover:bg-[#fafafa]">
                          <td className="py-2 px-2 max-w-[180px] truncate">{u.email || u.id}</td>
                          <td className="py-2 px-2 text-right">{u.deliberationCount}</td>
                          <td className="py-2 px-2 text-right">{u.debateCredits}</td>
                          <td className="py-2 px-2 text-right font-mono">${Number(u.totalApiCost).toFixed(2)}</td>
                          <td className="py-2 px-2 text-right font-mono">${Number(u.totalRevenue).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
