import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import type { CreditReport, StrategySettings } from "@shared/schema";

// --- Reports Hooks ---

export function useReports() {
  return useQuery({
    queryKey: [api.reports.list.path],
    queryFn: async () => {
      const res = await fetch(api.reports.list.path);
      if (!res.ok) throw new Error("Failed to fetch reports");
      return api.reports.list.responses[200].parse(await res.json());
    },
  });
}

export function useReport(id: number) {
  return useQuery({
    queryKey: [api.reports.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.reports.get.path, { id });
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch report");
      return api.reports.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
  });
}

export function useProcessReport() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch(api.reports.process.path, {
        method: api.reports.process.method,
        body: formData, // FormData automatically sets multipart/form-data
      });

      if (!res.ok) {
        if (res.status === 400) {
          const errorData = await res.json();
          const error = { message: errorData.message, debug: errorData.debug };
          throw error;
        }
        throw new Error("Failed to process report");
      }
      return api.reports.process.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.reports.list.path] });
      toast({
        title: "Report Processed",
        description: "The credit report has been successfully analyzed.",
      });
    },
    onError: (error: any) => {
      const message = error.message || "Unknown error occurred";
      toast({
        title: "Processing Failed",
        description: message,
        variant: "destructive",
      });
    },
  });
}

export function useDownloadPdf(id: number, clientName: string) {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const url = buildUrl(api.reports.downloadPdf.path, { id });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to download PDF");
      return await res.blob();
    },
    onSuccess: (blob) => {
      // Create a link and trigger download
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${clientName.replace(/\s+/g, '_')}_30DayPlan.pdf`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast({
        title: "Download Started",
        description: "Your PDF report is ready.",
      });
    },
    onError: () => {
      toast({
        title: "Download Failed",
        description: "Could not generate the PDF file.",
        variant: "destructive",
      });
    }
  });
}

// --- Settings Hooks ---

export function useSettings() {
  return useQuery({
    queryKey: [api.settings.get.path],
    queryFn: async () => {
      const res = await fetch(api.settings.get.path);
      if (!res.ok) throw new Error("Failed to fetch settings");
      return api.settings.get.responses[200].parse(await res.json());
    },
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (settings: StrategySettings) => {
      const res = await fetch(api.settings.update.path, {
        method: api.settings.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (!res.ok) throw new Error("Failed to update settings");
      return api.settings.update.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.settings.get.path] });
      toast({
        title: "Settings Saved",
        description: "Strategy parameters have been updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
