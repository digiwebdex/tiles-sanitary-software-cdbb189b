import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Landmark, MessageCircle, Receipt, Search, Settings, ShoppingCart,
  UserCog, Users, LayoutDashboard, ChevronRight, type LucideIcon,
  UserPlus, PackagePlus, FilePlus2, ClipboardCheck, Dot,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePermissions } from "@/hooks/usePermissions";
import { filterNavItem, navSections, type NavItem } from "@/config/navConfig";

/**
 * Per-item icon lookup. Reuses the sidebar's icons for every nav path, plus a
 * supplement for the "create/new" shortcuts that aren't sidebar items — so the
 * launcher is icon-driven like the legacy Bangla ERP home.
 */
const PATH_ICON: Record<string, LucideIcon> = {};
for (const section of navSections) {
  for (const item of section.items) PATH_ICON[item.path] = item.icon;
}
Object.assign(PATH_ICON, {
  "/customers/new": UserPlus,
  "/products/new": PackagePlus,
  "/purchases/new": ShoppingCart,
  "/purchases/orders": ClipboardCheck,
  "/sales/new": Receipt,
  "/settings/roles": UserCog,
  "/settings/data-backup": FilePlus2,
  "/settings/pricing-tiers": Landmark,
} satisfies Record<string, LucideIcon>);

function iconForPath(path: string): LucideIcon {
  return PATH_ICON[path] ?? Dot;
}

/**
 * Module launcher home page (/appauth-home), mirroring the legacy Bangla ERP
 * "Home" module: every module with its grouped sub-menus in Bengali + English,
 * mapped onto this app's routes. Items reuse the sidebar's NavItem gating flags
 * so role/plan/menu-mode visibility stays consistent with navConfig.
 */

type HomeItem = Omit<NavItem, "icon"> & { labelBn: string };

type HomeGroup = {
  label: string;
  labelBn: string;
  items: HomeItem[];
};

type HomeModule = {
  id: string;
  label: string;
  labelBn: string;
  icon: LucideIcon;
  groups: HomeGroup[];
};

const HOME_MODULES: HomeModule[] = [
  {
    id: "home",
    label: "Home",
    labelBn: "হোম",
    icon: LayoutDashboard,
    groups: [
      {
        label: "Overview",
        labelBn: "সারসংক্ষেপ",
        items: [
          { path: "/dashboard", label: "Dashboard", labelBn: "ড্যাশবোর্ড", readonlyAllowed: true },
          { path: "/approvals", label: "Approvals", labelBn: "অনুমোদন তালিকা", roles: ["manager", "accountant"] },
          { path: "/notices", label: "Notice Board", labelBn: "নোটিশ বোর্ড", readonlyAllowed: true, tier: "advanced" },
          { path: "/user-guide", label: "User Guide", labelBn: "ব্যবহার নির্দেশিকা", readonlyAllowed: true },
        ],
      },
    ],
  },
  {
    id: "crm",
    label: "Customer & CRM",
    labelBn: "কাস্টমার ও সিআরএম",
    icon: Users,
    groups: [
      {
        label: "Customer Management",
        labelBn: "কাস্টমার ব্যবস্থাপনা",
        items: [
          { path: "/customers/new", label: "Create Customer", labelBn: "কাস্টমার তৈরী", roles: ["manager", "salesman", "accountant"] },
          { path: "/customers", label: "Customer List", labelBn: "কাস্টমার তালিকা (৩৬০° প্রোফাইলসহ)", roles: ["manager", "salesman", "accountant"] },
          { path: "/customers/statements", label: "Customer Statements", labelBn: "গ্রাহক লেনদেন বিবরণী", dealerAdminOnly: true },
          { path: "/collections", label: "Collections", labelBn: "কালেকশন", roles: ["manager", "salesman", "accountant"] },
        ],
      },
      {
        label: "Leads & Field Activities",
        labelBn: "লিড ও ফিল্ড কার্যক্রম",
        items: [
          { path: "/leads", label: "Leads", labelBn: "লিড তালিকা", planFeature: "leads", roles: ["manager", "salesman"] },
          { path: "/leads/visits", label: "Visit Register", labelBn: "ভিজিট রেজিস্টার", planFeature: "leads", roles: ["manager", "salesman"] },
          { path: "/projects", label: "Projects", labelBn: "প্রজেক্ট", planFeature: "projects", roles: ["manager", "salesman"] },
        ],
      },
    ],
  },
  {
    id: "finance",
    label: "Accounting",
    labelBn: "হিসাবরক্ষণ",
    icon: Landmark,
    groups: [
      {
        label: "Financial Transactions",
        labelBn: "আর্থিক লেনদেন",
        items: [
          { path: "/ledger", label: "Ledger", labelBn: "লেজার লেনদেন", roles: ["manager", "accountant"] },
          { path: "/journal", label: "Journal Voucher", labelBn: "জার্নাল ভাউচার", dealerAdminOnly: true, planFeature: "advanced_finance" },
          { path: "/bank-accounts", label: "Bank Accounts", labelBn: "ব্যাংক হিসাব", dealerAdminOnly: true },
          { path: "/cashbook", label: "Cashbook", labelBn: "ক্যাশ বই", dealerAdminOnly: true },
        ],
      },
      {
        label: "Approval & Closing",
        labelBn: "অনুমোদন ও ক্লোজিং",
        items: [
          { path: "/approvals", label: "Approval List", labelBn: "অনুমোদন তালিকা", roles: ["manager", "accountant"] },
          { path: "/cash-closing", label: "Day-End Closing", labelBn: "দিন সমাপনী", dealerAdminOnly: true },
        ],
      },
      {
        label: "Statements & Analysis",
        labelBn: "বিবরণী ও বিশ্লেষণ",
        items: [
          { path: "/financials", label: "Financial Statements", labelBn: "আর্থিক বিবরণী", dealerAdminOnly: true },
          { path: "/reports", label: "Reports Hub", labelBn: "রিপোর্ট", readonlyAllowed: true, roles: ["manager", "accountant"] },
          { path: "/reports/credit", label: "Credit Report", labelBn: "ক্রেডিট রিপোর্ট", readonlyAllowed: true, roles: ["manager", "accountant"] },
          { path: "/emi", label: "EMI Plans", labelBn: "ইএমআই পরিকল্পনা", dealerAdminOnly: true, planFeature: "advanced_finance" },
        ],
      },
    ],
  },
  {
    id: "purchase",
    label: "Purchase",
    labelBn: "ক্রয়",
    icon: ShoppingCart,
    groups: [
      {
        label: "Product Management",
        labelBn: "পণ্য ব্যবস্থাপনা",
        items: [
          { path: "/products/new", label: "Create New Product", labelBn: "নতুন পণ্য তৈরী", roles: ["manager", "salesman"] },
          { path: "/products", label: "Product List", labelBn: "পণ্য তালিকা", roles: ["manager", "salesman"] },
          { path: "/warehouses", label: "Warehouses", labelBn: "গুদাম ব্যবস্থাপনা", dealerAdminOnly: true },
          { path: "/display-sample", label: "Display & Samples", labelBn: "ডিসপ্লে ও নমুনা", roles: ["manager", "salesman"] },
        ],
      },
      {
        label: "Purchase Entry",
        labelBn: "পণ্য ক্রয় হিসাব",
        items: [
          { path: "/suppliers", label: "Suppliers", labelBn: "সরবরাহকারী তালিকা", roles: ["manager", "accountant"] },
          { path: "/purchases/new", label: "Purchase Entry", labelBn: "ক্রয় এন্ট্রি", roles: ["manager"] },
          { path: "/purchases", label: "Purchase List", labelBn: "ক্রয় তালিকা", roles: ["manager"] },
          { path: "/purchases/orders", label: "Purchase Orders", labelBn: "ক্রয় আদেশ", roles: ["manager"] },
          { path: "/purchases/auto-draft", label: "Auto-PO Drafts", labelBn: "স্বয়ংক্রিয় ক্রয় খসড়া", dealerAdminOnly: true, tier: "advanced" },
        ],
      },
      {
        label: "Return & Damage",
        labelBn: "ফেরত এবং ক্ষতি",
        items: [
          { path: "/purchase-returns", label: "Purchase Returns", labelBn: "ক্রয় ফেরত", roles: ["manager"] },
          { path: "/damage", label: "Damage / Broken", labelBn: "ক্ষতিগ্রস্ত পণ্য", dealerAdminOnly: true },
        ],
      },
      {
        label: "Supplier Payments",
        labelBn: "সরবরাহকারী পেমেন্ট",
        items: [
          { path: "/payables", label: "Supplier Payables", labelBn: "সরবরাহকারী পাওনা", dealerAdminOnly: true },
          { path: "/payables/pay", label: "Pay Supplier", labelBn: "বিল পরিশোধ", dealerAdminOnly: true },
        ],
      },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    labelBn: "বিক্রয়",
    icon: Receipt,
    groups: [
      {
        label: "Product Sales",
        labelBn: "পণ্য বিক্রয়",
        items: [
          { path: "/sales/new", label: "Sales Entry", labelBn: "বিক্রয় এন্ট্রি", roles: ["manager", "salesman"] },
          { path: "/sales/pos", label: "POS Sales", labelBn: "পিওএস বিক্রয়", planFeature: "pos", roles: ["manager", "salesman"] },
          { path: "/sales", label: "Sales Invoice List", labelBn: "বিক্রয় ইনভয়েস তালিকা", roles: ["manager", "salesman"] },
          { path: "/sales-returns", label: "Sales Returns", labelBn: "বিক্রয় ফেরত", roles: ["manager", "salesman"] },
        ],
      },
      {
        label: "Orders & Delivery",
        labelBn: "অর্ডার ও ডেলিভারি",
        items: [
          { path: "/quotations", label: "Quotations", labelBn: "কোটেশন", planFeature: "quotations", roles: ["manager", "salesman"] },
          { path: "/challans", label: "Challans", labelBn: "চালান তালিকা", roles: ["manager", "salesman"] },
          { path: "/deliveries", label: "Deliveries", labelBn: "ডেলিভারি তালিকা", roles: ["manager", "salesman"] },
        ],
      },
      {
        label: "Tools & Reports",
        labelBn: "টুলস ও রিপোর্ট",
        items: [
          { path: "/tools/tile-calculator", label: "Tile Calculator", labelBn: "টাইলস ক্যালকুলেটর", readonlyAllowed: true, roles: ["manager", "salesman"] },
          { path: "/reports/operations", label: "Operations Reports", labelBn: "অপারেশন রিপোর্ট", dealerAdminOnly: true, planFeature: "advanced_reports" },
        ],
      },
    ],
  },
  {
    id: "hrm",
    label: "HRM",
    labelBn: "এইচআরএম",
    icon: UserCog,
    groups: [
      {
        label: "Leave & Attendance",
        labelBn: "ছুটি এবং উপস্থিতি",
        items: [
          { path: "/hrm/leaves", label: "Leave Management", labelBn: "ছুটি ব্যবস্থাপনা", dealerAdminOnly: true, planFeature: "hrm" },
          { path: "/hrm/shifts", label: "Shift Management", labelBn: "শিফট ব্যবস্থাপনা", dealerAdminOnly: true, planFeature: "hrm" },
          { path: "/holidays", label: "Holiday Setup", labelBn: "ছুটির দিন সেটআপ", dealerAdminOnly: true, planFeature: "hrm" },
        ],
      },
      {
        label: "Salary Management",
        labelBn: "বেতন ব্যবস্থাপনা",
        items: [
          { path: "/hrm/salary-structure", label: "Salary Structure", labelBn: "বেতন কাঠামো", dealerAdminOnly: true, planFeature: "hrm" },
          { path: "/hrm/loans", label: "Employee Loans", labelBn: "কর্মচারী ঋণ", dealerAdminOnly: true, planFeature: "hrm" },
        ],
      },
      {
        label: "Employee Management",
        labelBn: "কর্মচারী ব্যবস্থাপনা",
        items: [
          { path: "/hrm", label: "Employees", labelBn: "কর্মচারী তালিকা", dealerAdminOnly: true, planFeature: "hrm" },
          { path: "/hrm/documents", label: "Employee Documents", labelBn: "কর্মচারী ডকুমেন্ট", dealerAdminOnly: true, planFeature: "hrm" },
          { path: "/hrm/performance", label: "Performance Reviews", labelBn: "কর্মমূল্যায়ন", dealerAdminOnly: true, planFeature: "hrm" },
          { path: "/hrm/training", label: "Training & Skills", labelBn: "প্রশিক্ষণ ও দক্ষতা", dealerAdminOnly: true, planFeature: "hrm" },
          { path: "/hrm/assets", label: "Asset Management", labelBn: "সম্পদ ব্যবস্থাপনা", dealerAdminOnly: true, planFeature: "hrm" },
          { path: "/hrm/exits", label: "Exit / Offboarding", labelBn: "অব্যাহতি", dealerAdminOnly: true, planFeature: "hrm" },
        ],
      },
    ],
  },
  {
    id: "sms",
    label: "SMS & Notification",
    labelBn: "এসএমএস ও নোটিফিকেশন",
    icon: MessageCircle,
    groups: [
      {
        label: "Messaging",
        labelBn: "বার্তা পরিচালনা",
        items: [
          { path: "/sms/single", label: "Send SMS", labelBn: "এসএমএস পাঠান", planFeature: "campaigns", roles: ["manager"] },
          { path: "/sms/templates", label: "SMS Templates", labelBn: "এসএমএস টেমপ্লেট", planFeature: "campaigns", roles: ["manager"] },
          { path: "/sms/bulk", label: "Bulk SMS", labelBn: "বাল্ক এসএমএস", planFeature: "campaigns", roles: ["manager"] },
          { path: "/whatsapp-logs", label: "WhatsApp Log", labelBn: "হোয়াটসঅ্যাপ লগ", planFeature: "campaigns", roles: ["manager"] },
        ],
      },
      {
        label: "Campaigns & Notices",
        labelBn: "ক্যাম্পেইন ও নোটিশ",
        items: [
          { path: "/campaigns", label: "Campaigns", labelBn: "ক্যাম্পেইন", planFeature: "campaigns", roles: ["manager"] },
          { path: "/referrals", label: "Referrals", labelBn: "রেফারেল", planFeature: "campaigns", roles: ["manager"] },
          { path: "/settings/notices", label: "Notice Setup", labelBn: "নোটিশ সেটআপ", dealerAdminOnly: true },
        ],
      },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    labelBn: "সেটিংস",
    icon: Settings,
    groups: [
      {
        label: "General Settings",
        labelBn: "সাধারণ সেটিংস",
        items: [
          { path: "/settings", label: "Settings", labelBn: "সেটিংস" },
          { path: "/settings/branches", label: "Manage Branches", labelBn: "শাখা ব্যবস্থাপনা", dealerAdminOnly: true, tier: "advanced" },
          { path: "/settings/roles", label: "Staff & Roles", labelBn: "কর্মী ও ভূমিকা", dealerAdminOnly: true },
          { path: "/directors", label: "Director Register", labelBn: "পরিচালক নিবন্ধন", dealerAdminOnly: true, planFeature: "advanced_finance" },
          { path: "/files", label: "File Manager", labelBn: "ফাইল ম্যানেজার", dealerAdminOnly: true, tier: "advanced" },
        ],
      },
      {
        label: "Security & Data",
        labelBn: "নিরাপত্তা ও ডেটা",
        items: [
          { path: "/settings/login-history", label: "Login History", labelBn: "লগইন ইতিহাস", dealerAdminOnly: true },
          { path: "/settings/data-backup", label: "Data Backup", labelBn: "ডেটা ব্যাকআপ", dealerAdminOnly: true },
          { path: "/settings/pricing-tiers", label: "Pricing Tiers", labelBn: "মূল্য স্তর", dealerAdminOnly: true },
          { path: "/subscription", label: "Subscription", labelBn: "সাবস্ক্রিপশন", dealerAdminOnly: true, readonlyAllowed: true },
        ],
      },
      {
        label: "Customer Portal",
        labelBn: "কাস্টমার পোর্টাল",
        items: [
          { path: "/admin/portal-users", label: "Portal Users", labelBn: "পোর্টাল ব্যবহারকারী", dealerAdminOnly: true, planFeature: "portal" },
          { path: "/admin/portal-requests", label: "Portal Inbox", labelBn: "পোর্টাল ইনবক্স", dealerAdminOnly: true, planFeature: "portal" },
        ],
      },
    ],
  },
];

const AppAuthHomePage = () => {
  const navigate = useNavigate();
  const { accessLevel, isSuperAdmin, isSaEmployee, isDealerAdmin, menuMode, planFeatures } = useAuth();
  const { isManager, isAccountant, isSalesman } = usePermissions();
  const { lang } = useLanguage();
  const [query, setQuery] = useState("");

  const isReadonly = accessLevel === "readonly";
  // Bengali-first when the app language is Bangla; English-first otherwise.
  const primary = (en: string, bnText: string) => (lang === "bn" ? bnText : en);
  const secondary = (en: string, bnText: string) => (lang === "bn" ? en : bnText);

  const visibleModules = useMemo(() => {
    const filterOpts = {
      isReadonly, isDealerAdmin, isSuperAdmin, isSaEmployee,
      isManager, isAccountant, isSalesman, menuMode, planFeatures,
    };
    const q = query.trim().toLowerCase();
    return HOME_MODULES
      .map((module) => ({
        ...module,
        groups: module.groups
          .map((group) => ({
            ...group,
            items: group.items.filter((item) => {
              // filterNavItem ignores the unused icon field
              if (!filterNavItem(item as unknown as NavItem, filterOpts)) return false;
              if (!q) return true;
              return (
                item.label.toLowerCase().includes(q) ||
                item.labelBn.includes(q) ||
                item.path.toLowerCase().includes(q)
              );
            }),
          }))
          .filter((group) => group.items.length > 0),
      }))
      .filter((module) => module.groups.length > 0);
  }, [isReadonly, isDealerAdmin, isSuperAdmin, isSaEmployee, isManager, isAccountant, isSalesman, menuMode, planFeatures, query]);

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {primary("Module Home", "মডিউল হোম")}{" "}
            <span className="text-muted-foreground font-normal">({secondary("Module Home", "মডিউল হোম")})</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {lang === "bn"
              ? "সকল মডিউল, সাব-মেনু ও স্ক্রিন একসাথে — all modules in one place"
              : "All modules, sub-menus and screens in one place — সকল মডিউল ও স্ক্রিন একসাথে"}
          </p>
        </div>
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search menu… (মেনু খুঁজুন)"
            className="pl-9"
          />
        </div>
      </div>

      {visibleModules.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No menu matches your search. (কোনো মেনু পাওয়া যায়নি)
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleModules.map((module) => (
            <Card key={module.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <module.icon className="h-5 w-5" />
                  </span>
                  <span>
                    {primary(module.label, module.labelBn)}
                    <span className="block text-xs font-normal text-muted-foreground">{secondary(module.label, module.labelBn)}</span>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {module.groups.map((group) => (
                  <div key={group.label}>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {primary(group.label, group.labelBn)} <span className="normal-case">({secondary(group.label, group.labelBn)})</span>
                    </p>
                    <div className="flex flex-col">
                      {group.items.map((item) => {
                        const disabled = isReadonly && !item.readonlyAllowed;
                        const ItemIcon = iconForPath(item.path);
                        return (
                          <button
                            key={item.path}
                            onClick={() => !disabled && navigate(item.path)}
                            disabled={disabled}
                            className={cn(
                              "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                              disabled
                                ? "opacity-40 cursor-not-allowed"
                                : "hover:bg-accent hover:text-accent-foreground",
                            )}
                          >
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                              <ItemIcon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              {primary(item.label, item.labelBn)}{" "}
                              <span className="text-xs text-muted-foreground">({secondary(item.label, item.labelBn)})</span>
                            </span>
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default AppAuthHomePage;
