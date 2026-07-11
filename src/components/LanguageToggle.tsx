import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

/** Header button that switches the UI between English and Bangla. */
export function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { lang, setLang } = useLanguage();
  const next = lang === "en" ? "bn" : "en";
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => setLang(next)}
      className="gap-1"
      aria-label={lang === "en" ? "বাংলায় দেখুন" : "Switch to English"}
    >
      <Languages className="h-4 w-4" />
      {!compact && <span>{lang === "en" ? "বাংলা" : "English"}</span>}
    </Button>
  );
}
