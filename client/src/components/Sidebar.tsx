import { Link, useLocation } from "wouter";
import { LayoutDashboard, FileText, Settings, PlusCircle, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const [location] = useLocation();

  const navItems = [
    { label: "Dashboard", icon: LayoutDashboard, href: "/" },
    { label: "New Report", icon: PlusCircle, href: "/new" },
    { label: "Strategy Settings", icon: Settings, href: "/settings" },
  ];

  return (
    <div className="w-64 h-screen flex flex-col fixed left-0 top-0 z-50 border-r" style={{ backgroundColor: 'var(--brand-card)', borderColor: 'rgba(255,255,255,0.06)' }}>
      <div className="p-8 pb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold" style={{ background: 'var(--brand-pink-glow)', color: 'var(--brand-pink)' }}>
            R
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-gradient">
              Rose Finance
            </h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
              Academy Portal
            </p>
          </div>
        </div>
        <div className="mt-4 h-px w-full" style={{ background: 'linear-gradient(90deg, var(--brand-pink-border), transparent)' }} />
      </div>

      <nav className="flex-1 px-4 py-2 space-y-1">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer group",
                  isActive
                    ? "text-white"
                    : "text-muted-foreground hover:text-foreground"
                )}
                style={isActive ? {
                  background: 'var(--brand-pink-glow)',
                  borderLeft: '3px solid var(--brand-pink)',
                } : {}}
                data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <item.icon
                  className={cn(
                    "w-5 h-5 transition-colors",
                    isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                  )}
                />
                <span className={cn("font-medium text-sm", isActive && "text-primary")}>{item.label}</span>
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-3 px-4 py-3 text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded-xl hover:bg-white/5">
          <LogOut className="w-5 h-5" />
          <span className="font-medium text-sm">Sign Out</span>
        </div>
      </div>
    </div>
  );
}
