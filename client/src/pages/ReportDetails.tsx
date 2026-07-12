import { useReport, useDownloadPdf } from "@/hooks/use-reports";
import { useParams, Link } from "wouter";
import { Loader2, Download, ArrowLeft, AlertCircle, CheckCircle2, FileText, ChevronDown, ChevronUp, ExternalLink, BookOpen } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CreditPlan, NegativeAccount } from "@shared/schema";
import { useState } from "react";
import { cn } from "@/lib/utils";

export default function ReportDetails() {
  const { id } = useParams();
  const reportId = Number(id);
  const { data: report, isLoading } = useReport(reportId);
  const { mutate: downloadPdf, isPending: isDownloading } = useDownloadPdf(reportId, report?.clientName || "Client");
  const [showRawText, setShowRawText] = useState(false);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex flex-col h-screen items-center justify-center gap-4">
        <h2 className="text-2xl font-bold">Report Not Found</h2>
        <Link href="/">
          <Button variant="outline">Return Dashboard</Button>
        </Link>
      </div>
    );
  }

  const plan = report.generatedPlan as unknown as CreditPlan;

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in pb-20">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <Link href="/">
            <div className="flex items-center text-sm text-muted-foreground hover:text-primary transition-colors cursor-pointer mb-2">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Dashboard
            </div>
          </Link>
          <h1 className="text-4xl font-display font-bold text-foreground">{plan.clientName}</h1>
          <p className="text-muted-foreground">Report Date: {plan.reportDate}</p>
        </div>
        <Button 
          onClick={() => downloadPdf()} 
          disabled={isDownloading}
          className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20"
        >
          {isDownloading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Download className="w-4 h-4 mr-2" />
          )}
          Download Client PDF
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-8">
          {/* Diagnosis Summary */}
          <Card className="glass-card p-8">
            <h2 className="font-display font-bold text-2xl mb-4 text-gradient">Executive Summary</h2>
            <p className="text-muted-foreground leading-relaxed">{plan.diagnosisSummary}</p>
            
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-8">
              <StatBox label="Collections" value={plan.counts.collections} />
              <StatBox label="Charge Offs" value={plan.counts.chargeOffs} />
              <StatBox label="Public Records" value={plan.counts.publicRecords || 0} />
              <StatBox label="Late Payments" value={plan.counts.latePayments} />
              <StatBox label="Inquiries" value={plan.counts.inquiries} />
            </div>
          </Card>

          {/* 30-Day Checklist */}
          <Card className="glass-card p-8 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
            <h2 className="font-display font-bold text-2xl mb-6 flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-primary" />
              30-Day Action Plan
            </h2>
            
            <div className="space-y-5">
              <WeekChecklist label="Week 1 (Days 1–7)" items={plan.actionPlan.week1} />
              <WeekChecklist label="Week 2 (Days 8–14)" items={plan.actionPlan.week2} />
              <WeekChecklist label="Week 3 (Days 15–21)" items={plan.actionPlan.week3} />
              <WeekChecklist label="Week 4 (Days 22–30)" items={plan.actionPlan.week4} />
            </div>
          </Card>

          {/* Negative Accounts */}
          <Card className="glass-card p-8">
            <h2 className="font-display font-bold text-2xl mb-6">Negative Accounts Found</h2>
            <div className="overflow-hidden rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead className="bg-white/5">
                  <tr>
                    <th className="p-4 text-left font-medium text-muted-foreground">Account Name</th>
                    <th className="p-4 text-left font-medium text-muted-foreground">Account #</th>
                    <th className="p-4 text-left font-medium text-muted-foreground">Issue Type</th>
                    <th className="p-4 text-left font-medium text-muted-foreground">Priority</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {plan.negativeAccounts.map((acc, i) => (
                    <tr key={i} className="hover:bg-white/5 transition-colors">
                      <td className="p-4 font-medium">{acc.accountName}</td>
                      <td className="p-4 text-muted-foreground font-mono">{acc.accountNumberMasked}</td>
                      <td className="p-4">{acc.issueType}</td>
                      <td className="p-4">
                        <PriorityBadge priority={acc.priority} />
                      </td>
                    </tr>
                  ))}
                  {plan.negativeAccounts.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-muted-foreground">No negative accounts found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-6">
          <Card className="glass-card p-6">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Dispute Strategy
            </h3>
            <div className="space-y-4">
              <div>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Challenge Basis</span>
                <div className="flex flex-wrap gap-2 mt-2">
                  {plan.disputeStrategy.challengeBasis.map((basis, i) => (
                    <Badge key={i} variant="secondary" className="bg-white/10 hover:bg-white/20">{basis}</Badge>
                  ))}
                </div>
              </div>
              <Separator className="bg-white/10" />
              <div>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Timeline</span>
                <p className="text-sm mt-1">{plan.disputeStrategy.timeline}</p>
              </div>
            </div>
          </Card>

          <Card className="glass-card p-6">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-primary" />
              Resources & Training
            </h3>
            <div className="space-y-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dispute Letters</span>
              <ResourceLink label="Round 1 Letter" href="https://www.skool.com/rosefinanceacademy/classroom/3a86de80?md=3bb0c48048a94417bee271ec5f99bb21" />
              <ResourceLink label="7-Day Deletion Method" href="https://www.skool.com/rosefinanceacademy/classroom/3a86de80?md=6740a676535846689642e3f0bc9485a3" />
              <ResourceLink label="Round 2 Letter" href="https://www.skool.com/rosefinanceacademy/classroom/3a86de80?md=2b47934c79b74458b0c8f30396deb22f" />
              <ResourceLink label="Late Payments" href="https://www.skool.com/rosefinanceacademy/classroom/3a86de80?md=34c7865c1b3e4500a95a9664b3fb1c70" />
              <ResourceLink label="Student Loan Late Payments" href="https://www.skool.com/rosefinanceacademy/student-loan-relief-late-payment-edition?p=e42ed538" />
              <Separator className="bg-white/10" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Credit Building</span>
              <ResourceLink label="Kovo ($10/mo)" href="https://kovo-credit.sjv.io/XYNNOX" />
              <ResourceLink label="Ava ($9/mo)" href="https://meetava.sjv.io/rose" />
            </div>
          </Card>

          <Card className="glass-card p-6">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-primary" />
              Troubleshooting
            </h3>
            <div className="border rounded-lg border-white/10 overflow-hidden">
              <button
                onClick={() => setShowRawText(!showRawText)}
                className="w-full flex items-center justify-between p-3 bg-white/5 text-sm font-medium hover:bg-white/10 transition-colors"
                data-testid="button-toggle-raw-text"
              >
                View Extracted Text
                {showRawText ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showRawText && (
                <ScrollArea className="h-64 p-3 text-xs font-mono text-muted-foreground bg-black/20">
                  {report.extractedText.slice(0, 5000)}...
                </ScrollArea>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string, value: number }) {
  return (
    <div className="bg-white/5 rounded-xl p-4 text-center border border-white/5">
      <div className="text-2xl font-bold font-display text-primary">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function WeekChecklist({ label, items }: { label: string; items: string[] | string | undefined }) {
  const list = Array.isArray(items) ? items : items ? [items] : [];
  if (list.length === 0) return null;
  return (
    <div className="bg-background/40 p-5 rounded-xl border border-white/5">
      <h3 className="font-semibold text-primary mb-3 text-sm uppercase tracking-wide">{label}</h3>
      <ul className="space-y-2">
        {list.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground" data-testid={`checklist-item-${label.split(' ')[1]}-${i}`}>
            <span className="text-primary mt-0.5 shrink-0">{"\u2022"}</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResourceLink({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors py-1"
      data-testid={`link-resource-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
      <span>{label}</span>
    </a>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const styles = {
    High: "bg-pink-500/15 text-pink-400 border-pink-500/30",
    Medium: "bg-pink-500/8 text-pink-300 border-pink-400/20",
    Low: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  };
  
  return (
    <span className={cn(
      "px-3 py-1 rounded-full text-xs font-medium border",
      styles[priority as keyof typeof styles] || styles.Low
    )}>
      {priority}
    </span>
  );
}
