# Database Schema — TilesERP

Complete database schema reference.

---

## Enums

```sql
app_role:          super_admin | dealer_admin | salesman
customer_type:     retailer | customer | project
product_category:  tiles | sanitary
unit_type:         box_sft | piece
user_status:       active | inactive | suspended
subscription_status: active | expired | suspended
ledger_entry_type: sale | purchase | payment | refund | expense | receipt | adjustment
payment_method_type: cash | bank | mobile_banking
payment_status_type: paid | partial | pending
```

---

## Tables

### dealers
| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | uuid | No | gen_random_uuid() | PK |
| name | text | No | — | Business name |
| phone | text | Yes | — | Contact phone |
| address | text | Yes | — | Business address |
| status | text | No | 'active' | active/inactive |
| challan_template | text | No | 'classic' | Template style |
| created_at | timestamptz | No | now() | |

### profiles
| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | uuid | No | — | PK, FK → auth.users |
| name | text | No | — | Display name |
| email | text | No | — | Email |
| dealer_id | uuid | Yes | — | FK → dealers |
| status | user_status | No | 'active' | |
| created_at | timestamptz | No | now() | |
| updated_at | timestamptz | No | now() | |

### user_roles
| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | uuid | No | gen_random_uuid() | PK |
| user_id | uuid | No | — | FK → auth.users |
| role | app_role | No | — | Role enum |
| UNIQUE(user_id, role) | | | | |

### subscription_plans
| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | uuid | No | gen_random_uuid() | PK |
| name | text | No | — | Plan name |
| monthly_price | numeric | No | 0 | BDT/month |
| yearly_price | numeric | No | 0 | BDT/year |
| max_users | integer | No | 1 | User limit |
| sms_enabled | boolean | No | false | Feature flag |
| email_enabled | boolean | No | false | Feature flag |
| daily_summary_enabled | boolean | No | false | Feature flag |
| is_active | boolean | No | true | Availability |
| created_at | timestamptz | No | now() | |
| updated_at | timestamptz | No | now() | |

### subscriptions
| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | uuid | No | gen_random_uuid() | PK |
| dealer_id | uuid | No | — | FK → dealers |
| plan_id | uuid | No | — | FK → subscription_plans |
| status | subscription_status | No | 'active' | |
| billing_cycle | text | No | 'monthly' | monthly/yearly |
| start_date | date | No | now() | |
| end_date | date | Yes | — | Expiry date |
| yearly_discount_applied | boolean | No | false | First year only |
| created_at | timestamptz | No | now() | |

### subscription_payments
| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | uuid | No | gen_random_uuid() | PK |
| dealer_id | uuid | No | — | FK → dealers |
| subscription_id | uuid | No | — | FK → subscriptions |
| amount | numeric | No | 0 | Payment amount |
| payment_method | payment_method_type | No | — | cash/bank/mobile |
| payment_status | payment_status_type | No | 'pending' | paid/partial/pending |
| payment_date | date | No | now() | |
| note | text | Yes | — | |
| collected_by | uuid | Yes | — | Admin user ID |
| created_at | timestamptz | No | now() | |

### products
| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | uuid | No | gen_random_uuid() | PK |
| dealer_id | uuid | No | — | FK → dealers |
| name | text | No | — | Product name |
| sku | text | No | — | UNIQUE(dealer_id, sku) |
| category | product_category | No | — | tiles/sanitary |
| unit_type | unit_type | No | 'box_sft' | box_sft/piece |
| per_box_sft | numeric | Yes | — | SFT per box |
| cost_price | numeric | No | 0 | Purchase cost |
| default_sale_rate | numeric | No | 0 | Default selling price |
| size | text | Yes | — | |
| color | text | Yes | — | |
| brand | text | Yes | — | |
| material | text | Yes | — | |
| warranty | text | Yes | — | |
| weight | text | Yes | — | |
| barcode | text | Yes | — | |
| reorder_level | integer | No | 0 | Alert threshold |
| active | boolean | No | true | |
| created_at | timestamptz | No | now() | |

### stock
| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | uuid | No | gen_random_uuid() | PK |
| dealer_id | uuid | No | — | FK → dealers |
| product_id | uuid | No | — | FK → products, UNIQUE(dealer_id, product_id) |
| box_qty | numeric | No | 0 | Box count |
| sft_qty | numeric | No | 0 | Total SFT |
| piece_qty | numeric | No | 0 | Piece count |
| reserved_box_qty | numeric | No | 0 | Reserved for challans |
| reserved_piece_qty | numeric | No | 0 | Reserved pieces |
| average_cost_per_unit | numeric | No | 0 | Weighted avg cost |
| updated_at | timestamptz | No | now() | |

### sales
| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | uuid | No | gen_random_uuid() | PK |
| dealer_id | uuid | No | — | FK → dealers |
| customer_id | uuid | No | — | FK → customers |
| invoice_number | text | Yes | — | Auto-generated |
| sale_date | date | No | today | |
| sale_type | text | No | 'direct_invoice' | direct_invoice/challan_first |
| sale_status | text | No | 'invoiced' | invoiced/draft |
| total_amount | numeric | No | 0 | |
| discount | numeric | No | 0 | |
| paid_amount | numeric | No | 0 | |
| due_amount | numeric | No | 0 | |
| cogs | numeric | No | 0 | **Canonical COGS** — written atomically by routes/sales.ts at create/update time using stock.average_cost_per_unit. This is the source-of-truth for P&L COGS; do NOT recompute by joining sale_items. |
| profit | numeric | No | 0 | Legacy profit |
| gross_profit | numeric | No | 0 | Revenue - COGS |
| net_profit | numeric | No | 0 | Gross - Discount |
| total_box | numeric | No | 0 | |
| total_sft | numeric | No | 0 | |
| total_piece | numeric | No | 0 | |
| payment_mode | text | Yes | — | cash/credit/bank/mobile |
| discount_reference | text | Yes | — | |
| client_reference | text | Yes | — | |
| fitter_reference | text | Yes | — | |
| notes | text | Yes | — | |
| created_by | uuid | Yes | — | |
| created_at | timestamptz | No | now() | |

### sale_items
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | No | gen_random_uuid() |
| sale_id | uuid | No | FK → sales |
| dealer_id | uuid | No | FK → dealers |
| product_id | uuid | No | FK → products |
| quantity | numeric | No | — |
| sale_rate | numeric | No | — |
| total | numeric | No | 0 |
| total_sft | numeric | Yes | — |

> NOTE: `sale_items` does **NOT** carry a `cost_price` column. For COGS,
> read `sales.cogs` (the header column). Line-level cost snapshots are a
> Track 1 Phase 2 schema addition.

### customers
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | No | gen_random_uuid() |
| dealer_id | uuid | No | FK → dealers |
| name | text | No | — |
| type | customer_type | No | 'customer' |
| phone | text | Yes | — |
| email | text | Yes | — |
| address | text | Yes | — |
| reference_name | text | Yes | — |
| opening_balance | numeric | No | 0 |
| credit_limit | numeric | No | 0 |
| max_overdue_days | integer | No | 0 |
| status | text | No | 'active' |
| created_at | timestamptz | No | now() |

### suppliers
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | No | gen_random_uuid() |
| dealer_id | uuid | No | FK → dealers |
| name | text | No | — |
| contact_person | text | Yes | — |
| phone | text | Yes | — |
| email | text | Yes | — |
| address | text | Yes | — |
| gstin | text | Yes | — |
| opening_balance | numeric | No | 0 |
| status | text | No | 'active' |
| created_at | timestamptz | No | now() |

*(Remaining tables — purchases, purchase_items, challans, deliveries, delivery_items, customer_ledger, supplier_ledger, cash_ledger, expense_ledger, expenses, sales_returns, purchase_returns, purchase_return_items, credit_overrides, customer_followups, campaign_gifts, invoice_sequences, notification_settings, notifications, audit_logs, login_attempts, contact_submissions, website_content — follow similar patterns with dealer_id isolation.)*

---

## Key Functions

| Function | Purpose | Security |
|---|---|---|
| `is_super_admin()` | Check if current user is super admin | SECURITY DEFINER |
| `has_role(_user_id, _role)` | Check user role | SECURITY DEFINER |
| `get_user_dealer_id(_user_id)` | Get dealer_id for user | SECURITY DEFINER |
| `has_active_subscription()` | Check active subscription | SECURITY DEFINER |
| `generate_next_invoice_no(_dealer_id)` | Auto-increment invoice | — |
| `generate_next_challan_no(_dealer_id)` | Auto-increment challan | — |
| `check_account_locked(_email)` | Login lockout check | — |
| `record_failed_login(_email, _ip)` | Track failed logins | — |
| `record_successful_login(_email)` | Reset login attempts | — |
