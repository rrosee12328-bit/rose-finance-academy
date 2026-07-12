import { useSettings, useUpdateSettings } from "@/hooks/use-reports";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { strategySettingsSchema, type StrategySettings } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Save } from "lucide-react";
import { useEffect } from "react";

export default function Settings() {
  const { data: settings, isLoading } = useSettings();
  const { mutate: updateSettings, isPending } = useUpdateSettings();

  const form = useForm<StrategySettings>({
    resolver: zodResolver(strategySettingsSchema),
  });

  useEffect(() => {
    if (settings) {
      form.reset(settings);
    }
  }, [settings, form]);

  const onSubmit = (data: StrategySettings) => {
    updateSettings(data);
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in pb-20">
      <div>
        <h1 className="text-4xl font-display font-bold text-foreground">Expert Strategy Settings</h1>
        <p className="text-muted-foreground mt-2">Customize the AI logic and output messaging for your reports.</p>
      </div>

      <Card className="glass-card p-8">
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="disputePhilosophy">Dispute Philosophy</Label>
              <Textarea
                id="disputePhilosophy"
                {...form.register("disputePhilosophy")}
                className="min-h-[100px] bg-background/50 border-white/10 focus:border-primary"
              />
              <p className="text-xs text-muted-foreground">Describe your approach to disputes (e.g., Factual disputing vs. Metro2 compliance).</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="creditBuildingRecommendations">Credit Building Products</Label>
              <Textarea
                id="creditBuildingRecommendations"
                {...form.register("creditBuildingRecommendations")}
                className="min-h-[100px] bg-background/50 border-white/10 focus:border-primary"
              />
              <p className="text-xs text-muted-foreground">List products you recommend (Kovo, Ava, Secured Cards) and why.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="clientEducationMessaging">Client Education Tone</Label>
              <Textarea
                id="clientEducationMessaging"
                {...form.register("clientEducationMessaging")}
                className="min-h-[100px] bg-background/50 border-white/10 focus:border-primary"
              />
              <p className="text-xs text-muted-foreground">Define the tone of voice for the educational sections.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="disputeOrder">Priority Order</Label>
              <Input
                id="disputeOrder"
                {...form.register("disputeOrder")}
                className="bg-background/50 border-white/10 focus:border-primary"
              />
              <p className="text-xs text-muted-foreground">Comma-separated list of priority (e.g., Collections, Charge Offs, Late Payments).</p>
            </div>
          </div>

          <div className="pt-4 flex justify-end">
            <Button
              type="submit"
              disabled={isPending}
              className="bg-primary text-white hover:bg-pink-500 px-8 rounded-xl brand-glow transition-all duration-200 hover:scale-[1.02]"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
