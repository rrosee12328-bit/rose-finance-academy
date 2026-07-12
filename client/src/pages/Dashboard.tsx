import { useReports } from "@/hooks/use-reports";
import { StatCard } from "@/components/StatCard";
import { Users, FileText, AlertTriangle, TrendingUp, ArrowRight, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell
} from "recharts";

export default function Dashboard() {
  const { data: reports, isLoading } = useReports();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Calculate analytics
  const totalReports = reports?.length || 0;
  const totalNegativeItems = reports?.reduce((acc, r) => {
    const plan = r.generatedPlan as any;
    const counts = plan?.counts || {};
    return acc + (counts.collections || 0) + (counts.latePayments || 0) + (counts.chargeOffs || 0);
  }, 0) || 0;

  // Chart data
  const chartData = reports?.slice(0, 7).map(r => ({
    name: r.clientName.split(' ')[0],
    items: (r.generatedPlan as any)?.counts?.collections || 0
  })) || [];

  return (
    <div className="space-y-8 animate-in">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-display font-bold text-foreground">Welcome Back, Coach</h1>
          <p className="text-muted-foreground mt-2">Here's what's happening with your client reports today.</p>
        </div>
        <Link href="/new">
          <Button className="bg-primary text-white hover:bg-pink-500 font-medium px-6 rounded-xl brand-glow transition-all duration-200 hover:scale-[1.02]">
            <TrendingUp className="w-4 h-4 mr-2" />
            Analyze New Report
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard
          title="Total Reports Processed"
          value={totalReports}
          icon={FileText}
          trend="+12% this month"
          trendUp={true}
        />
        <StatCard
          title="Negative Items Found"
          value={totalNegativeItems}
          icon={AlertTriangle}
          className="from-pink-500/5 to-transparent bg-gradient-to-br"
        />
        <StatCard
          title="Active Clients"
          value={new Set(reports?.map(r => r.clientName)).size || 0}
          icon={Users}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="glass-card p-6">
          <h3 className="font-display font-bold text-xl mb-6">Recent Collections Analysis</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip 
                  cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                />
                <Bar dataKey="items" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill="hsl(var(--primary))" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="glass-card p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-display font-bold text-xl">Recent Reports</h3>
            <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80">
              View All
            </Button>
          </div>
          
          <div className="space-y-4">
            {reports?.slice(0, 5).map((report) => (
              <div key={report.id} className="group flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
                    {report.clientName.charAt(0)}
                  </div>
                  <div>
                    <h4 className="font-medium text-foreground">{report.clientName}</h4>
                    <p className="text-xs text-muted-foreground">
                      Processed {format(new Date(report.createdAt), 'MMM d, yyyy')}
                    </p>
                  </div>
                </div>
                <Link href={`/report/${report.id}`}>
                  <Button size="icon" variant="ghost" className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
            ))}
            {(!reports || reports.length === 0) && (
              <div className="text-center py-8 text-muted-foreground">
                No reports processed yet.
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
