---
name: VPS Migration Phase 20 — Employee Exit / Offboarding
description: Resignation, multi-department clearance checklist, final settlement computation with auto outstanding loans/advances, atomic employee deactivation on settle
type: feature
---

# Phase 20 — Employee Exit / Offboarding Workflow

## Tables (`046_employee_exits.ts`)

**`employee_exits`** — exit header
- exit_code (auto `EXIT-00001`), exit_type (resignation|termination|retirement|absconding|end_of_contract)
- resignation_date, last_working_date, notice_period_days, reason
- status: `initiated | clearance | settled | cancelled`
- Settlement breakdown: unpaid_salary, leave_encashment, bonus, gratuity, other_additions, outstanding_loans, outstanding_advances, other_deductions, **net_payable**
- payment_method (cash|bank), bank_account_id, settled_date
- exit_interview_notes, rehire_eligible, rehire_eligible_notes
- Unique (dealer_id, employee_id, status) — only one active exit per employee

**`employee_exit_clearances`** — checklist
- department (HR|IT|Accounts|Admin|Sales|Warehouse|Other), item, status (pending|done|na)
- cleared_by, cleared_at, remarks

## Backend (`routes/employeeExits.ts`) — `/api/employee-exits`

- `GET /summary` — counts + net per status (KPI dashboard)
- `GET /` filters: status, employee_id, q
- `GET /:id` — full detail with clearances + joined employee/bank info
- `GET /:id/settlement-preview` — live recompute of outstanding loans/advances + suggested net
- `POST /` — initiates exit, auto-seeds 11-item default clearance checklist across 6 departments, blocks duplicate active exits
- `PUT /:id` — recomputes outstandings + net_payable live on every save
- `DELETE /:id` — soft-cancels (status='cancelled')
- `POST /:id/clearance`, `PUT /clearances/:cid`, `DELETE /clearances/:cid`
- `POST /:id/settle` — **atomic**: gates on all clearances done/na, marks exit settled, marks employee inactive (or `terminated` for termination type)

### Outstanding computation
- Loans: `employee_loan_emis` joined to active loans, pending/partial/overdue, sum(amount_due - amount_paid)
- Advances: `salary_advances` status='open'

### Net formula
`net = unpaid_salary + leave_encashment + bonus + gratuity + other_additions − outstanding_loans − outstanding_advances − other_deductions`

## Frontend
- **Service**: `src/services/employeeExitService.ts`
- **Page**: `src/pages/hrm/EmployeeExitsPage.tsx`
  - 4 KPI cards (Initiated, In Clearance, Settled, Cancelled) with counts + net amounts
  - Filterable table with row click → detail dialog
  - Detail dialog: settlement panel (editable), clearance checklist grouped by department with one-click toggle, exit interview notes, rehire eligibility badge
  - Live "suggested net" warning if live outstandings differ from saved
  - Settle dialog: prevents settlement until all clearance items are done/N/A; bank account selector for non-cash payouts
- **Routing**: `/hrm/exits` registered in `App.tsx`
- **Sidebar**: "Exit / Offboarding" (LogOut icon), `dealerAdminOnly`

## RBAC
- create / update / clearance edit: dealer_admin + manager
- cancel & settle: dealer_admin only

## Deploy
```bash
cd /var/www/tilessaas && git pull && \
cd /var/www/tilessaas/backend && npx knex migrate:latest --knexfile src/db/knexfile.ts && \
cd /var/www/tilessaas && npm install && npm run build && \
pm2 restart tilessaas-backend && sudo systemctl reload nginx
```
