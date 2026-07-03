import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  filterNavItem,
  isNavItemActive,
  navSections,
  type NavItem,
  type PlanFeaturesMap,
} from "@/config/navConfig";

type SidebarNavProps = {
  isReadonly: boolean;
  isDealerAdmin: boolean;
  isSuperAdmin: boolean;
  isSaEmployee?: boolean;
  isManager?: boolean;
  isAccountant?: boolean;
  isSalesman?: boolean;
  menuMode?: "simple" | "advanced";
  planFeatures?: PlanFeaturesMap | null;
  className?: string;
  compact?: boolean;
};

function storageKey(sectionId: string) {
  return `nav-section-open-${sectionId}`;
}

export function SidebarNav({
  isReadonly,
  isDealerAdmin,
  isSuperAdmin,
  isSaEmployee = false,
  isManager = false,
  isAccountant = false,
  isSalesman = false,
  menuMode = "advanced",
  planFeatures = null,
  className,
  compact = false,
}: SidebarNavProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const visibleSections = useMemo(
    () => {
      const filterOpts = {
        isReadonly, isDealerAdmin, isSuperAdmin, isSaEmployee,
        isManager, isAccountant, isSalesman, menuMode, planFeatures,
      };
      return navSections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => filterNavItem(item, filterOpts)),
        }))
        .filter((section) => section.items.length > 0);
    },
    [isDealerAdmin, isSuperAdmin, isSaEmployee, isReadonly, isManager, isAccountant, isSalesman, menuMode, planFeatures],
  );

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const s of visibleSections) {
      const stored = localStorage.getItem(storageKey(s.id));
      initial[s.id] = stored != null ? stored === "true" : !!s.defaultOpen;
    }
    return initial;
  });

  useEffect(() => {
    for (const section of visibleSections) {
      const hasActive = section.items.some((item) =>
        isNavItemActive(location.pathname, item.path),
      );
      if (hasActive) {
        setOpenSections((prev) => {
          if (prev[section.id]) return prev;
          localStorage.setItem(storageKey(section.id), "true");
          return { ...prev, [section.id]: true };
        });
      }
    }
  }, [location.pathname, visibleSections]);

  const toggleSection = (id: string, open: boolean) => {
    localStorage.setItem(storageKey(id), String(open));
    setOpenSections((prev) => ({ ...prev, [id]: open }));
  };

  const renderItem = (item: NavItem) => {
    const disabled = isReadonly && !item.readonlyAllowed;
    const active = isNavItemActive(location.pathname, item.path);
    return (
      <button
        key={item.path}
        onClick={() => !disabled && navigate(item.path)}
        disabled={disabled}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
          active
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          disabled && "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground",
          compact && "px-2 py-1.5 text-xs whitespace-nowrap",
        )}
      >
        <item.icon className={cn("h-4 w-4 shrink-0", compact && "h-3 w-3")} />
        {item.label}
      </button>
    );
  };

  if (compact) {
    const flatItems = visibleSections.flatMap((s) => s.items);
    return (
      <nav className={cn("flex overflow-x-auto gap-1", className)}>
        {flatItems.map(renderItem)}
      </nav>
    );
  }

  return (
    <nav className={cn("flex-1 space-y-1 overflow-y-auto", className)}>
      {visibleSections.map((section) => {
        const isOpen = openSections[section.id] ?? section.defaultOpen ?? false;
        const sectionHasActive = section.items.some((item) =>
          isNavItemActive(location.pathname, item.path),
        );

        if (section.items.length === 1 && section.id === "overview") {
          return <div key={section.id} className="space-y-0.5">{section.items.map(renderItem)}</div>;
        }

        return (
          <Collapsible
            key={section.id}
            open={isOpen}
            onOpenChange={(open) => toggleSection(section.id, open)}
          >
            <CollapsibleTrigger
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wide",
                sectionHasActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {section.label}
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-0.5 pt-0.5 pb-1 pl-1">
              {section.items.map(renderItem)}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </nav>
  );
}
