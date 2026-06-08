# SaniTiles ERP — Staff Training Sheet (1 Page)
# সানিটাইলস ERP — স্টাফ প্রশিক্ষণ শিট (১ পৃষ্ঠা)

**For:** Showroom sales, purchase, collection staff  
**Version:** 2026-06-08 | Fresh dealer go-live

---

## Daily workflow | দৈনিক কাজের ধাপ

| Step | English | বাংলা | Menu |
|:--:|---------|-------|------|
| 1 | Add / check **Products** (tile: set **SFT per box**) | **পণ্য** যোগ/চেক (টাইল: **বক্সে SFT** সেট করুন) | Products |
| 2 | **Purchase** from supplier → stock increases | **ক্রয়** → স্টক বাড়ে | Purchases |
| 3 | **Sale** or **POS** → invoice + stock decreases | **বিক্রয়** / POS → ইনভয়েস + স্টক কমে | Sales / POS |
| 4 | **Collect payment** (if due) | **বকেয়া আদায়** | Invoice → Payment **or** Collections |
| 5 | **Challan / Delivery** when goods go out | **চালান / ডেলিভারি** | Challans / Deliveries |
| 6 | **Sales return** if customer returns goods | **বিক্রয় ফেরত** | Sales Returns |

---

## Payment — two correct ways | পেমেন্ট — দুই সঠিক উপায়

| Where | When to use | কখন ব্যবহার |
|-------|-------------|-------------|
| **Invoice → Payment** | Customer pays for **one specific invoice** | নির্দিষ্ট **একটি ইনভয়েস** এর টাকা |
| **Collections → Record Payment** | Customer pays **without saying which invoice** — system applies to **oldest due first** | কোন ইনভয়েস বলেনি — **পুরনো বকেয়া আগে** কাটা হয় |

**Rule:** After payment, invoice **Due = ৳0** (or reduced). If Due still shows old amount → tell admin.  
**নিয়ম:** পেমেন্টের পর **Due = ০** (বা কম) হতে হবে। না হলে অ্যাডমিনকে জানান।

---

## Tile product setup (IMPORTANT) | টাইল পণ্য সেটআপ (গুরুত্বপূর্ণ)

Before first sale, every tile product must have:

| Field | Example | বাংলা |
|-------|---------|-------|
| Unit type | `box_sft` | বক্স + SFT |
| **Per box SFT** | `20` (if 1 box = 20 sqft) | **প্রতি বক্স SFT** |

**Wrong SFT = wrong stock & wrong profit report.**  
**ভুল SFT = ভুল স্টক ও ভুল লাভ।**

---

## Safe to use daily | প্রতিদিন ব্যবহার করুন

- Create **Purchase**, **Sale**, **POS**, **Challan**, **Delivery**
- Record **Payment** (Invoice or Collections)
- Check **stock** on Products page
- Print **Invoice** and **Challan**
- **Customer due** on Collections page

---

## Do NOT trust yet — ask admin | এখনো বিশ্বাস করবেন না — অ্যাডমিনকে জিজ্ঞেস করুন

- **Profit / P&L report** — only after admin confirms deploy
- **Editing a purchase** after save — not available; use Purchase Return
- **Batch/shade stock** after large sales returns — verify with admin

---

## Common mistakes | সাধারণ ভুল

| Mistake | Fix | ভুল | সমাধান |
|---------|-----|-----|--------|
| Tile product missing **per box SFT** | Edit product before sale | SFT সেট নেই | বিক্রয়ের আগে পণ্য এডিট |
| Payment recorded but Due unchanged | Use Invoice Payment or Collections (not manual ledger) | Due কমেনি | Invoice/Collections দিয়ে পেমেন্ট |
| Sold in **Challan mode** but stock not reduced | Complete **Delivery** | চালান মোডে স্টক কমেনি | **Delivery** সম্পন্ন করুন |
| Wrong purchase entered | **Purchase Return** + tell admin | ভুল ক্রয় | **Purchase Return** |

---

## Quick test before go-live (admin + staff) | গো-লাইভের আগে দ্রুত টেস্ট

1. Purchase **10 boxes** of one tile → stock shows **10 boxes**  
   **১০ বক্স** ক্রয় → স্টক **১০ বক্স**
2. Sell **2 boxes** → stock **8 boxes**, invoice shows **Due**  
   **২ বক্স** বিক্রয় → স্টক **৮ বক্স**, **Due** দেখাবে
3. Collect full payment → **Due = ৳0** on invoice AND Collections  
   পূর্ণ পেমেন্ট → Invoice ও Collections দুটোতেই **Due = ০**
4. If all 3 pass → **OK to start live sales**  
   ৩টো ঠিক থাকলে → **লাইভ বিক্রয় শুরু**

---

## Who does what | কে কী করবে

| Role | Access | ভূমিকা |
|------|--------|--------|
| **Salesman** | Sales, POS, Customers, Quotations | বিক্রয় স্টাফ |
| **Accountant** | Collections, Ledger, Reports | হিসাব |
| **Dealer Admin** | Everything + Settings, Financials | মালিক / ম্যানেজার |

---

## Need help? | সাহায্য

- In-app: **User Guide** (sidebar)  
- Admin contact: _________________________  
- Phone: _________________________

---

*Print this page and keep at cash counter.*  
*এই পৃষ্ঠা প্রিন্ট করে ক্যাশ কাউন্টারে রাখুন。*
