import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LanguageProvider, useLanguage } from "@/contexts/LanguageContext";
import { LanguageToggle } from "@/components/LanguageToggle";

function Probe() {
  const { lang, t } = useLanguage();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="dashboard">{t("Dashboard")}</span>
      <span data-testid="unknown">{t("Some untranslated string")}</span>
    </div>
  );
}

describe("LanguageContext + LanguageToggle", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to English and translates after toggling to Bangla", () => {
    render(
      <LanguageProvider>
        <LanguageToggle />
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("lang").textContent).toBe("en");
    expect(screen.getByTestId("dashboard").textContent).toBe("Dashboard");

    fireEvent.click(screen.getByRole("button", { name: "বাংলায় দেখুন" }));
    expect(screen.getByTestId("lang").textContent).toBe("bn");
    expect(screen.getByTestId("dashboard").textContent).toBe("ড্যাশবোর্ড");
    expect(localStorage.getItem("app-language")).toBe("bn");
  });

  it("falls back to the English string for missing keys", () => {
    localStorage.setItem("app-language", "bn");
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("lang").textContent).toBe("bn");
    expect(screen.getByTestId("unknown").textContent).toBe("Some untranslated string");
  });

  it("works without a provider (identity translation)", () => {
    render(<Probe />);
    expect(screen.getByTestId("lang").textContent).toBe("en");
    expect(screen.getByTestId("dashboard").textContent).toBe("Dashboard");
  });
});
