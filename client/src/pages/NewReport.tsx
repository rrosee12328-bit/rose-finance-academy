import { useState } from "react";
import { useForm } from "react-hook-form";
import { useProcessReport } from "@/hooks/use-reports";
import { zodResolver } from "@hookform/resolvers/zod";
import { processReportSchema, type ProcessReportRequest } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, UploadCloud, FileText, CheckCircle, AlertTriangle } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

interface DebugInfo {
  filename: string;
  fileSize: number;
  mimeType: string;
  headerOk: boolean;
  parsersUsed: string[];
  errors: string[];
  charCount: number;
  pagesRead?: number;
  creditDataFound?: {
    scores: string[];
    collections: number;
    chargeOffs: number;
    latePayments: number;
    inquiries: number;
  };
}

export default function NewReport() {
  const [, setLocation] = useLocation();
  const { mutate: processReport, isPending } = useProcessReport();
  const [file, setFile] = useState<File | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const form = useForm<ProcessReportRequest>({
    resolver: zodResolver(processReportSchema),
    defaultValues: {
      consentConfirmed: false,
    }
  });

  const onDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
  });

  const onSubmit = (data: ProcessReportRequest) => {
    if (!file) return;

    setDebugInfo(null);
    setLastError(null);

    const formData = new FormData();
    formData.append("reportFile", file);
    formData.append("clientName", data.clientName);
    formData.append("reportDate", data.reportDate);
    formData.append("consentConfirmed", String(data.consentConfirmed));
    if (data.coachNotes) {
      formData.append("coachNotes", data.coachNotes);
    }

    console.log("[Frontend] Submitting form with file:", file.name, file.type, file.size);

    processReport(formData, {
      onSuccess: (data) => {
        setLocation(`/report/${data.id}`);
      },
      onError: (error: any) => {
        setLastError(error.message || "Processing failed");
        if (error.debug) {
          setDebugInfo(error.debug);
          console.log("[Frontend] Debug info:", error.debug);
        }
      }
    });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in pb-20">
      <div>
        <h1 className="text-4xl font-display font-bold text-foreground">New Client Analysis</h1>
        <p className="text-muted-foreground mt-2">Upload a credit report PDF to generate a comprehensive 30-day plan.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
          <Card className="glass-card p-8">
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="clientName">Client Name</Label>
                <Input
                  id="clientName"
                  {...form.register("clientName")}
                  placeholder="e.g. Jane Doe"
                  className="bg-background/50 border-white/10 focus:border-primary"
                />
                {form.formState.errors.clientName && (
                  <p className="text-sm text-destructive">{form.formState.errors.clientName.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="reportDate">Report Date</Label>
                <Input
                  id="reportDate"
                  type="date"
                  {...form.register("reportDate")}
                  className="bg-background/50 border-white/10 focus:border-primary"
                />
                {form.formState.errors.reportDate && (
                  <p className="text-sm text-destructive">{form.formState.errors.reportDate.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="coachNotes">Coach Notes (Optional)</Label>
                <Textarea
                  id="coachNotes"
                  {...form.register("coachNotes")}
                  placeholder="Any specific context about this client..."
                  className="bg-background/50 border-white/10 focus:border-primary h-32"
                />
              </div>

              <div className="space-y-2">
                <Label>Credit Report PDF</Label>
                <div
                  {...getRootProps()}
                  className={cn(
                    "border-2 border-dashed rounded-xl p-8 transition-colors cursor-pointer flex flex-col items-center justify-center text-center",
                    isDragActive ? "border-pink-400 bg-pink-500/5 brand-glow" : "border-white/10 hover:border-pink-400/50 hover:bg-white/5",
                    file ? "border-green-500/50 bg-green-500/5" : ""
                  )}
                >
                  <input {...getInputProps()} />
                  {file ? (
                    <>
                      <FileText className="w-10 h-10 text-green-500 mb-2" />
                      <p className="font-medium text-green-500">{file.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="w-10 h-10 text-muted-foreground mb-2" />
                      <p className="font-medium text-muted-foreground">Drag & drop or click to upload</p>
                      <p className="text-xs text-muted-foreground mt-1">PDF files only (Max 10MB)</p>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3 p-4 rounded-lg bg-primary/5 border border-primary/10">
                <Checkbox
                  id="consent"
                  checked={form.watch("consentConfirmed")}
                  onCheckedChange={(c) => form.setValue("consentConfirmed", c === true)}
                />
                <div className="grid gap-1.5 leading-none">
                  <Label htmlFor="consent" className="font-medium cursor-pointer">
                    Confirm Client Consent
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    I confirm that I have obtained necessary permission from the client to process their credit data for coaching purposes.
                  </p>
                </div>
              </div>
              {form.formState.errors.consentConfirmed && (
                <p className="text-sm text-destructive">{form.formState.errors.consentConfirmed.message}</p>
              )}

              <Button
                type="submit"
                disabled={isPending || !file}
                className="w-full bg-primary text-white hover:bg-pink-500 py-6 text-lg rounded-xl brand-glow transition-all duration-200 hover:scale-[1.01] disabled:opacity-50"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Analyzing Report with AI...
                  </>
                ) : (
                  "Generate 30-Day Plan"
                )}
              </Button>
            </form>

            {lastError && (
              <div className="mt-6 space-y-4">
                <Alert className="border-destructive/50 bg-destructive/5">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <AlertDescription className="text-destructive">
                    {lastError}
                  </AlertDescription>
                </Alert>
                {debugInfo && (
                  <Card className="p-4 bg-background/50 border-white/10">
                    <div className="text-sm space-y-2 font-mono text-muted-foreground">
                      <div><strong>Debug Info:</strong></div>
                      <div>📄 File: {debugInfo.filename}</div>
                      <div>📊 Size: {(debugInfo.fileSize / 1024 / 1024).toFixed(2)} MB</div>
                      <div>🏷️ MIME: {debugInfo.mimeType}</div>
                      <div>✅ PDF Header (%PDF): {debugInfo.headerOk ? "Yes" : "No"}</div>
                      <div>📝 Extracted Chars: {debugInfo.charCount}</div>
                      {debugInfo.pagesRead && <div>📄 Pages Read: {debugInfo.pagesRead}</div>}
                      {debugInfo.parsersUsed.length > 0 && (
                        <div>✓ Parsers Used: {debugInfo.parsersUsed.join(", ")}</div>
                      )}
                      {debugInfo.creditDataFound && (
                        <div className="mt-2 pt-2 border-t border-white/10">
                          <div><strong>💳 Credit Data Detected:</strong></div>
                          {debugInfo.creditDataFound.scores.length > 0 && (
                            <div>  • Scores: {debugInfo.creditDataFound.scores.join(", ")}</div>
                          )}
                          {debugInfo.creditDataFound.collections > 0 && (
                            <div>  • Collections: {debugInfo.creditDataFound.collections}</div>
                          )}
                          {debugInfo.creditDataFound.chargeOffs > 0 && (
                            <div>  • Charge-offs: {debugInfo.creditDataFound.chargeOffs}</div>
                          )}
                          {debugInfo.creditDataFound.latePayments > 0 && (
                            <div>  • Late Payments: {debugInfo.creditDataFound.latePayments}</div>
                          )}
                          {debugInfo.creditDataFound.inquiries > 0 && (
                            <div>  • Hard Inquiries: {debugInfo.creditDataFound.inquiries}</div>
                          )}
                        </div>
                      )}
                      {debugInfo.errors.length > 0 && (
                        <div>⚠️ Errors: {debugInfo.errors.join("; ")}</div>
                      )}
                    </div>
                  </Card>
                )}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="glass-card p-6 bg-gradient-to-br from-primary/10 to-transparent border-primary/20">
            <h3 className="font-display font-bold text-lg mb-4 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-primary" />
              What to Expect
            </h3>
            <ul className="space-y-4 text-sm text-muted-foreground">
              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold shrink-0">1</span>
                AI extracts negative accounts from the PDF instantly.
              </li>
              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold shrink-0">2</span>
                Diagnoses issue types (Late Payments, Charge-offs, etc.).
              </li>
              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold shrink-0">3</span>
                Generates a prioritized, step-by-step dispute strategy.
              </li>
              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold shrink-0">4</span>
                Creates a professional PDF download for your client.
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
