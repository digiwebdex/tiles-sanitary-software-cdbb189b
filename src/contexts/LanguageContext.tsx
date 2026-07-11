import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { bn } from "@/i18n/bn";

export type AppLanguage = "en" | "bn";

const STORAGE_KEY = "app-language";

type LanguageContextValue = {
  lang: AppLanguage;
  setLang: (lang: AppLanguage) => void;
  /** Translate an English UI string; falls back to the input when no entry exists. */
  t: (text: string) => string;
};

// Working default so components (and tests) render without a provider.
const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  setLang: () => {},
  t: (text) => text,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<AppLanguage>(() =>
    localStorage.getItem(STORAGE_KEY) === "bn" ? "bn" : "en",
  );

  const setLang = useCallback((next: AppLanguage) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLangState(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback(
    (text: string) => (lang === "bn" ? bn[text] ?? text : text),
    [lang],
  );

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLanguage() {
  return useContext(LanguageContext);
}
