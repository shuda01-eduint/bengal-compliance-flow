# Investors Page Schema Documentation

## 1. Page Overview

**Page URL:** `/investors`

**Purpose:** Centralized hub for managing investor/client information, including personal data, ledger statements, portfolios, commission configurations, and approval workflows for configuration changes.

**Key Functionality:**
- View and search all investors/clients
- Generate ledger statements for any investor
- Manage customer portfolios and custom fields
- View holdings and deposit/withdrawal reports
- Request and approve commission/assignment changes

---

## 2. Tab Structure

### Tab 1: Investors
**Icon:** `Contact`

**Purpose:** Master list of all investors with search, filtering, and export capabilities.

**Data Displayed:**
- Investor code, name, BO ID
- Investor type (Individual, Institutional, etc.)
- Cell phone number
- Trader assignment
- Account type (Cash, Margin)
- Status (Active, Closed, Suspended, Auto-Created)

**Key Features:**
- Full-text search (code, name, BO ID, phone)
- Filter by status, investor type, account type
- Paginated table (50 per page)
- Excel export of filtered results
- Import investors from Excel
- Import commission rates from Excel
- Click row to view investor detail dialog

**Related Database Tables:**
- `investors` (primary)
- `investor_rm_assignments` (RM relationships)
- `investor_agent_assignments` (Agent relationships)

---

### Tab 2: Ledger Statement
**Icon:** `BookOpen`

**Purpose:** Generate detailed ledger statements showing all transactions for a specific investor.

**Data Displayed:**
- Opening balance (from EOD snapshot or baseline)
- Trade transactions (BUY/SELL with aggregated values)
- Deposits and withdrawals
- Running balance after each transaction
- Closing balance summary

**Key Features:**
- Search by investor code
- Date range selection
- Automatic commission calculation
- CSV export of ledger statement
- Shows investor summary info (account type, status, category)

**Related Database Tables:**
- `investors` (investor info, baseline balance, commission rate)
- `eod_ledger_snapshots` (historical closing balances)
- `trade_history` (buy/sell transactions)
- `deposits_withdrawals` (cash movements)

---

### Tab 3: Portfolios
**Icon:** `Briefcase`

**Purpose:** Manage customer portfolios with associated financial data and custom fields.

**Data Displayed:**
- Investor code and name
- RM assignment
- Ledger balance
- Accrued fees
- Market value
- Cost value (from holdings)
- Equity

**Key Features:**
- Create new portfolios linked to investors
- Search by investor code or portfolio name
- Pagination (50 per page)
- View portfolio details
- Delete portfolios
- Custom field values per portfolio

**Related Database Tables:**
- `portfolios` (portfolio records)
- `clients` (financial data)
- `holdings` (cost value calculation)
- `portfolio_custom_fields` (field definitions)
- `portfolio_field_values` (field values per portfolio)

---

### Tab 4: Custom Fields
**Icon:** `Settings2`

**Purpose:** Define custom dropdown fields that can be applied to portfolios.

**Data Displayed:**
- Field name
- Field type (dropdown)
- Available options
- Created date

**Key Features:**
- Create new dropdown fields with custom options
- Define multiple options per field
- Delete custom fields
- Fields automatically appear in portfolio creation dialog

**Related Database Tables:**
- `portfolio_custom_fields` (field definitions)

---

### Tab 5: Reports
**Icon:** `FileBarChart`

**Purpose:** Holdings reports and deposit/withdrawal transaction management.

**Sub-tabs:**
1. **Holdings Report**
   - Investor code/name
   - Trading code (security)
   - Total stock quantity
   - Close price (market price)
   - Live value (MP × Qty)
   - Ledger balance
   - Market value

2. **Deposits/Withdrawals**
   - Transaction date
   - Investor code/name
   - Transaction type
   - Amount
   - Remarks
   - RM email

**Key Features:**
- Filter by RM email
- Search across holdings
- Export to Excel
- Import deposits/withdrawals from Excel
- Clear all transactions
- Summary totals

**Related Database Tables:**
- `holdings` (stock positions)
- `securities` (close prices)
- `deposits_withdrawals` (cash transactions)

---

### Tab 6: Commission Requests
**Icon:** `Percent`

**Purpose:** Approval workflow for commission rate changes and RM/Agent assignment changes.

**Sub-tabs:**
1. **Commission** - Commission rate change requests
2. **RM** - RM assignment change requests
3. **Agent** - Agent assignment change requests

**Data Displayed:**
- Investor code and name
- Current vs. requested values
- Reason for change
- Requester email
- Request date
- Status with badges
- Approval notes

**Key Features:**
- Two-tier approval (Manager → Admin)
- Approve/Reject with notes
- Status tracking (pending_manager, pending_admin, approved, rejected)
- Summary cards for pending counts
- Role-based action visibility

**Related Database Tables:**
- `commission_change_requests`
- `assignment_change_requests`
- `user_roles` (for admin check)
- `profiles` (for department head check)

---

## 3. Database Schema

### Primary Table: `investors`
The **master source of truth** for all investor/client data.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `investor_code` | text | Unique investor identifier |
| `investor_name` | text | Full name |
| `investor_type` | text | Individual, Institutional, etc. |
| `bo_id` | text | BO account ID |
| `father_spouse_name` | text | Father or spouse name |
| `mother_name` | text | Mother's name |
| `home_address` | text | Address |
| `date_of_birth` | date | DOB |
| `cell_no` | text | Phone number |
| `email` | text | Email address |
| `account_open_date` | date | Account opening date |
| `bank_account_no` | text | Bank account number |
| `bank_name` | text | Bank name |
| `bank_branch` | text | Bank branch |
| `status` | text | Active, Closed, Suspended, Auto-Created |
| `trader` | text | Assigned trader |
| `account_type` | text | Cash, Margin |
| `interest_rate` | numeric | Interest rate for margin |
| `brokerage_commission` | numeric | Commission rate (decimal) |
| `ledger_balance` | numeric | Baseline ledger balance |
| `rm_name` | text | RM name |
| `rm_email` | text | RM email |
| `rm_id` | text | RM employee ID |
| `created_at` | timestamp | Record creation |
| `updated_at` | timestamp | Last update |

---

### Assignment Tables

#### `investor_rm_assignments`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `investor_code` | text | FK to investors |
| `rm_email` | text | RM email |
| `rm_name` | text | RM name |
| `department` | text | Department |
| `percentage` | numeric | Share percentage (0-100) |
| `created_at` | timestamp | Created |
| `updated_at` | timestamp | Updated |

#### `investor_agent_assignments`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `investor_code` | text | FK to investors |
| `agent_id` | text | Agent ID |
| `agent_name` | text | Agent name |
| `percentage` | numeric | Share percentage |
| `created_at` | timestamp | Created |
| `updated_at` | timestamp | Updated |

---

### Ledger & Transaction Tables

#### `eod_ledger_snapshots`
Daily end-of-day snapshots for ledger tracking.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `eod_date` | date | Snapshot date |
| `investor_code` | text | Investor code |
| `investor_name` | text | Name |
| `ledger_balance` | numeric | Current ledger |
| `opening_balance` | numeric | Opening for day |
| `closing_balance` | numeric | Closing for day |
| `gross_buy` | numeric | Total buys |
| `gross_sell` | numeric | Total sells |
| `total_deposits` | numeric | Deposits |
| `total_withdrawals` | numeric | Withdrawals |
| `total_commission` | numeric | Commissions charged |
| `account_type` | text | Cash/Margin |
| `rm_email` | text | RM email |
| `rm_name` | text | RM name |
| `department` | text | Department |

#### `trade_history`
All trade transactions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `trade_date` | text | Date (YYYYMMDD format) |
| `client_code` | text | Investor code |
| `security_code` | text | Trading symbol |
| `side` | text | BUY/SELL |
| `quantity` | numeric | Shares |
| `price` | numeric | Price per share |
| `value` | numeric | Total value |
| `brokerage_commission` | numeric | Commission |

#### `deposits_withdrawals`
Cash deposits and withdrawals.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `investor_code` | text | Investor code |
| `investor_name` | text | Name |
| `transaction_type` | text | Deposit/Withdrawal |
| `amount` | numeric | Amount |
| `transaction_date` | date | Transaction date |
| `remarks` | text | Notes |
| `rm_email` | text | RM email |
| `uploaded_at` | timestamp | Upload time |

---

### Portfolio Tables

#### `portfolios`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `name` | text | Portfolio name |
| `description` | text | Description |
| `investor_code` | text | FK to investors |
| `created_at` | timestamp | Created |

#### `portfolio_custom_fields`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `field_name` | text | Display name |
| `field_type` | text | Always "dropdown" |
| `options` | jsonb | Array of option strings |
| `created_at` | timestamp | Created |

#### `portfolio_field_values`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `portfolio_id` | uuid | FK to portfolios |
| `field_id` | uuid | FK to custom_fields |
| `value` | text | Selected value |

---

### Holdings Table

#### `holdings`
Current stock positions per investor.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `investor_code` | text | Investor code |
| `investor_name` | text | Name |
| `trading_code` | text | Security symbol |
| `total_stock` | integer | Quantity held |
| `saleable` | integer | Saleable quantity |
| `avg_cost` | numeric | Average cost |
| `total_cost` | numeric | Total cost |
| `market_value` | numeric | Market value |
| `ledger_balance` | numeric | Cash balance |
| `rm_email` | text | RM email |
| `boid` | text | BO ID |

---

### Change Request Tables

#### `commission_change_requests`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `investor_code` | text | Investor |
| `investor_name` | text | Name |
| `current_commission` | numeric | Current rate |
| `requested_commission` | numeric | New rate |
| `reason` | text | Justification |
| `requested_by` | uuid | User ID |
| `requested_by_email` | text | User email |
| `requested_at` | timestamp | Request time |
| `status` | text | pending_manager/pending_admin/approved/rejected |
| `manager_approved_by` | uuid | Manager user ID |
| `manager_approved_at` | timestamp | Manager approval time |
| `manager_notes` | text | Manager notes |
| `admin_approved_by` | uuid | Admin user ID |
| `admin_approved_at` | timestamp | Admin approval time |
| `admin_notes` | text | Admin notes |
| `rejected_by` | uuid | Rejector user ID |
| `rejected_at` | timestamp | Rejection time |
| `rejection_reason` | text | Rejection reason |

#### `assignment_change_requests`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `investor_code` | text | Investor |
| `investor_name` | text | Name |
| `change_type` | text | "rm" or "agent" |
| `current_assignments` | jsonb | Current assignments array |
| `requested_assignments` | jsonb | New assignments array |
| `reason` | text | Justification |
| `requested_by` | uuid | User ID |
| `requested_by_email` | text | User email |
| `status` | text | pending_manager/pending_admin/approved/rejected |
| *(approval/rejection fields same as above)* |

---

## 4. Summary Cards

### Investors Tab
| Card | Data Source | Description |
|------|-------------|-------------|
| **Total Investors** | `investors` count | Total investor records |
| **Active Investors** | `investors` where status='Active' | Active accounts only |
| **Account Types** | Distinct `account_type` values | Number of account types |

### Commission Requests Tab
| Card | Data Source | Description |
|------|-------------|-------------|
| **Commission Pending** | `commission_change_requests` pending | Pending commission requests |
| **RM/Agent Pending** | `assignment_change_requests` pending | Pending assignment requests |
| **Total Approved** | Both tables approved | Total approved requests |
| **Total Rejected** | Both tables rejected | Total rejected requests |

### Reports Tab - Holdings
| Card | Data Source | Description |
|------|-------------|-------------|
| **Total Stock** | Sum of `holdings.total_stock` | Total shares |
| **Live Value** | `total_stock × close_price` | Current market value |
| **Ledger Balance** | Sum of `holdings.ledger_balance` | Total cash |
| **Market Value** | Sum of `holdings.market_value` | Recorded market value |

---

## 5. Filters & Search

### Investors Tab Filters

| Filter | Type | Options |
|--------|------|---------|
| **Search** | Text input | Code (exact), Name, BO ID, Phone |
| **Status** | Dropdown | Active, Closed, Suspended, Auto-Created |
| **Investor Type** | Dropdown | Individual, Institutional, etc. |
| **Account Type** | Dropdown | Cash, Margin |

### Ledger Statement Filters

| Filter | Type | Description |
|--------|------|-------------|
| **Account No** | Text input | Exact investor code |
| **From Date** | Date picker | Start date for statement |
| **To Date** | Date picker | End date for statement |

### Reports Tab Filters

| Filter | Type | Description |
|--------|------|-------------|
| **Search** | Text input | Code, name, or trading code |
| **RM Filter** | Dropdown | Filter by RM email |

---

## 6. Table Columns

### Investors Table (Main View)

| Column | Source Field | Description |
|--------|--------------|-------------|
| Code No | `investor_code` | Unique identifier |
| Name | `investor_name` | Full name |
| BO ID | `bo_id` | BO account ID |
| Type | `investor_type` | Category |
| Cell No. | `cell_no` | Phone number |
| Trader | `trader` | Assigned trader |
| Account Type | `account_type` | Cash/Margin |
| Status | `status` | Account status with badge |

### Investor Detail Dialog

**Personal Information:**
- Code No, BO ID, Investor Type
- Father/Spouse Name, Mother Name
- Date of Birth, Home Address

**RM Assignments:**
- RM Name/Email, Department, Percentage

**Agent Assignments:**
- Agent ID, Agent Name, Percentage

**Contact Information:**
- Cell No., Email (clickable mailto)

**Bank Details:**
- Bank Name, Branch, Account No.

**Account Information:**
- Account Type, Trader, Account Open Date
- Interest Rate, Brokerage Commission (with edit button)

---

## 7. Actions & Workflows

### Import Workflows
1. **Import Investors** - Bulk import investor records from Excel
2. **Import Commissions** - Update commission rates from Excel

### Approval Workflows
1. **Commission Change Request**
   - RM submits request → Department Head approves → Admin final approval
   - Status: pending_manager → pending_admin → approved/rejected

2. **Assignment Change Request**
   - Same workflow for RM or Agent assignment changes

### Export Workflows
1. **Export Investors** - Download filtered investor list as Excel
2. **Export Ledger** - Download statement as CSV
3. **Export Holdings** - Download portfolio report as Excel

---

## 8. RLS Policies Summary

| Table | Policy | Description |
|-------|--------|-------------|
| `investors` | Admin full access | Admins can CRUD |
| `investors` | Approved users read | Read-only for approved users |
| `commission_change_requests` | Users view own | Users see their own requests |
| `commission_change_requests` | Dept heads view pending | Department heads see pending |
| `commission_change_requests` | Admins full access | Admins manage all |
| `holdings` | RMs view their own | By rm_email |
| `deposits_withdrawals` | RMs view their own | By rm_email |

---

*Last Updated: February 2026*
