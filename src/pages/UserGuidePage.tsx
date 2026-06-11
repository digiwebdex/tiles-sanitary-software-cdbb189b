import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookOpen, ExternalLink, Download, Check, Phone } from "lucide-react";

/**
 * Dealer-facing User Guide page.
 *
 * Renders the full Bengali A-to-Z guide (`/dealer-guide.html`) embedded
 * inside the ERP shell so dealers never have to hunt for documentation.
 * The guide itself is a static public asset — no auth needed — but this
 * page lives behind dealer auth so the sidebar entry stays in context.
 */
const UserGuidePage = () => {
  const guideUrl = `${window.location.origin}/dealer-guide.html`;
  const openGuide = () => window.open(guideUrl, "_blank");

  const sections = [
    "শুরু করার আগে", "লগইন ও ড্যাশবোর্ড", "সাপ্লায়ার (BIN সহ)",
    "কাস্টমার (BIN, ক্রেডিট)", "প্রোডাক্ট ও ইউনিট", "পারচেজ",
    "স্টক", "সেল ও POS", "ইনভয়েস ও চালান", "ডেলিভারি",
    "সেলস / পারচেজ রিটার্ন", "পেমেন্ট কালেকশন (FIFO)",
    "সাপ্লায়ার পেবল", "ভ্যাট / মুশাক ৬.৩ ও ৬.১",
    "লেজার, Cashbook, Financial Statements", "Due Aging ও VAT রিপোর্ট",
    "bKash / Nagad / SSLCommerz", "দরকারি টিপস", "সাপোর্ট",
  ];

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-primary" />
          User Guide — সফটওয়্যার ব্যবহার গাইড
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          TilesERP কীভাবে A থেকে Z পর্যন্ত ব্যবহার করবেন তার সম্পূর্ণ বাংলা গাইড (আপডেট: জুন ২০২৬)।
          ভ্যাট/মুশাক, মোবাইল ব্যাংকিং পেমেন্ট, Due Aging ও সাপ্লায়ার পেবল সহ।
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={openGuide} variant="default">
          <ExternalLink className="h-4 w-4 mr-2" />
          নতুন ট্যাবে খুলুন
        </Button>
        <a
          href={guideUrl}
          download="TilesERP-User-Guide.html"
          className="inline-flex items-center justify-center rounded-md text-sm font-medium px-4 py-2 border bg-background hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <Download className="h-4 w-4 mr-2" />
          ডাউনলোড করুন
        </a>
        <a
          href="tel:01674533303"
          className="inline-flex items-center justify-center rounded-md text-sm font-medium px-4 py-2 border bg-background hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <Phone className="h-4 w-4 mr-2" />
          সাপোর্ট: 01674533303
        </a>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>গাইডে যা যা আছে</CardTitle>
          <CardDescription>সফটওয়্যারের প্রতিটি মেনুর কাজ ধাপে ধাপে শেখানো হয়েছে।</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
            {sections.map((item) => (
              <div
                key={item}
                className="flex items-center gap-2 p-2 rounded-md bg-muted/40 border"
              >
                <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="truncate">{item}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>সম্পূর্ণ গাইড</CardTitle>
          <CardDescription>নিচে স্ক্রল করে পুরো গাইডটি পড়তে পারেন।</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden bg-background" style={{ height: "75vh" }}>
            <iframe
              src={guideUrl}
              title="TilesERP User Guide"
              className="w-full h-full"
              style={{ border: "none" }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default UserGuidePage;
