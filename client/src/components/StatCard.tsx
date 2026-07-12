import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  trend?: string;
  trendUp?: boolean;
  className?: string;
}

export function StatCard({ title, value, icon: Icon, trend, trendUp, className }: StatCardProps) {
  return (
    <Card className={cn("glass-card p-6 relative overflow-hidden group", className)}>
      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
        <Icon className="w-24 h-24 -mr-8 -mt-8" />
      </div>
      
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          {trend && (
            <span className={cn(
              "text-xs font-medium px-2 py-1 rounded-full",
              trendUp ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
            )}>
              {trend}
            </span>
          )}
        </div>
        
        <h3 className="text-muted-foreground text-sm font-medium mb-1">{title}</h3>
        <p className="text-3xl font-display font-bold text-foreground">{value}</p>
      </div>
    </Card>
  );
}
