# Interpark Property Management System - User Manual

**Version:** 1.0.0  
**Last Updated:** July 21, 2026  
**Organization:** Interpark Enterprises Limited

---

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [System Overview](#system-overview)
4. [User Roles & Permissions](#user-roles--permissions)
5. [Administrative User Guide](#administrative-user-guide)
6. [Property Manager Guide](#property-manager-guide)
7. [General User Guide](#general-user-guide)
8. [Common Tasks & Workflows](#common-tasks--workflows)
9. [Payment & Invoicing](#payment--invoicing)
10. [Document Generation](#document-generation)
11. [Reports & Analytics](#reports--analytics)
12. [Frequently Asked Questions](#frequently-asked-questions)
13. [Troubleshooting](#troubleshooting)
14. [Support & Contact](#support--contact)

---

## Introduction

### What is Interpark Property Management System?

The **Interpark Property Management System** is a comprehensive digital platform designed to streamline property management operations. It enables property managers, landlords, and administrative staff to efficiently manage properties, tenants, payments, invoicing, and financial operations in one centralized system.

### Who Should Use This Manual?

This manual is designed for three main user types:

- **System Administrators** - Full platform control and configuration
- **Property Managers** - Day-to-day property management operations
- **General Users** - Standard users with limited access (tenants viewing, data entry)

### Key Benefits

✅ **Centralized Management** - Manage all properties and tenants from one dashboard  
✅ **Automated Invoicing** - Auto-generate invoices with complex payment policies  
✅ **Payment Tracking** - Complete payment history and arrears monitoring  
✅ **Professional Documents** - Auto-generate PDFs (invoices, receipts, demand letters)  
✅ **Secure Access** - Role-based permissions with granular controls  
✅ **Real-time Reminders** - Automated payment reminders via email  
✅ **Financial Reporting** - Comprehensive reports for decision-making

---

## Getting Started

### Accessing the System

#### 1. Login

1. Open your web browser
2. Navigate to the Interpark Property Management System login page
3. Enter your **Email** and **Password**
4. Click **"Login"**
5. You will be redirected to your dashboard

#### 2. First-Time Login

If you're logging in for the first time:

- Your account will be created with specific permissions based on your role
- You may need **admin approval** before full access is granted
- Check your email for activation instructions if required
- Contact your administrator if you don't receive login credentials

#### 3. Password Reset

If you forget your password:

1. Click **"Forgot Password?"** on the login page
2. Enter your email address
3. Click **"Send Reset Link"**
4. Check your email for a password reset link
5. Click the link and create a new password
6. Login with your new password

### Dashboard Overview

After login, you'll see your personalized dashboard showing:

- **Quick Stats** - Key metrics (active properties, pending payments, etc.)
- **Recent Activities** - Latest transactions and updates
- **Tasks** - Your assigned and personal to-do items
- **Navigation Menu** - Access to all system features

---

## System Overview

### Core Modules

#### 1. **Property Management**
   - Register and manage multiple properties
   - Track property details (address, type, LR number, usage)
   - Assign managers to properties
   - Support residential, commercial, and mixed-use properties

#### 2. **Tenant Management**
   - Register and track tenant information
   - Manage lease terms and rent amounts
   - Track payment policies and escalation rates
   - Monitor service charges and VAT

#### 3. **Payment & Invoicing**
   - Auto-generate invoices based on payment policies
   - Track partial payments and balances
   - Generate professional PDF invoices
   - Monitor arrears and outstanding amounts

#### 4. **Billing System**
   - Manage utility bills (water, electricity, gas)
   - Generate bill invoices from meter readings
   - Track paid/unpaid bills with VAT

#### 5. **Commission Management**
   - Calculate manager commissions
   - Generate commission invoices
   - Track payment status

#### 6. **Document Generation**
   - Professional invoices with letterhead
   - Balance invoices
   - Payment receipts
   - Demand letters
   - Offer letters

#### 7. **Role-Based Access Control (RBAC)**
   - System roles: ADMIN, MANAGER, USER
   - 90+ granular permission codes
   - Custom role creation
   - Property-level access controls

#### 8. **Reporting & Analytics**
   - Payment reports
   - Daily operational reports
   - Property financial summaries
   - Audit logs

---

## User Roles & Permissions

### System Roles Overview

| Feature | Admin | Manager | User |
|---------|:-----:|:-------:|:----:|
| **Full Platform Access** | ✅ | ✅ | ❌ |
| **Create Properties** | ✅ | ✅ | ❌ |
| **Manage Tenants** | ✅ | ✅ | ⚠️* |
| **Generate Invoices** | ✅ | ✅ | ❌ |
| **View Reports** | ✅ | ✅ | ⚠️* |
| **Manage Users** | ✅ | ❌ | ❌ |
| **Manage Roles** | ✅ | ❌ | ❌ |
| **Manage Commissions** | ✅ | ✅ | ❌ |
| **Record Payments** | ✅ | ✅ | ⚠️* |
| **Create Reports** | ✅ | ✅ | ⚠️* |

*⚠️ = Limited to assigned properties only

---

## Administrative User Guide

### Overview

**System Administrators** have full control over the platform. Your responsibilities include user management, role configuration, system settings, and audit oversight.

### Admin Dashboard Features

#### 1. User Management

**Access:** Main Menu → Users → Manage Users

**Tasks:**
- Create new user accounts
- Assign roles to users
- Enable/disable user access
- View user activity logs
- Create managed users (sub-users under managers)

**Creating a New User:**

1. Click "Add New User" button
2. Enter user details:
   - Full Name
   - Email Address
   - Temporary Password (user will change on first login)
   - Role (ADMIN, MANAGER, or USER)
3. Assign properties (for MANAGER and USER roles)
4. Click "Create User"
5. User will receive email with login details

**Assigning Roles:**

1. Go to Users → Manage Users
2. Find the user from the list
3. Click "Edit" or "Change Role"
4. Select new role from dropdown
5. Click "Update"
6. Confirm changes

#### 2. Role & Permission Management

**Access:** Main Menu → RBAC → Manage Roles

**System Roles:**
- **ADMIN** - Full access to all features
- **MANAGER** - Manage properties, tenants, and payments
- **USER** - Limited access, data entry and reporting only

**Create Custom Role:**

1. Click "Create Custom Role"
2. Enter Role Details:
   - Role Name (e.g., "Finance Officer")
   - Description
   - Select permissions from the checklist
3. Available Permissions Categories:
   - Property Management (create, read, update, delete)
   - Tenant Management
   - Invoice Management
   - Payment Processing
   - Report Generation
   - Document Management
   - RBAC Management
4. Click "Save Role"

**Assign Custom Role to User:**

1. Go to RBAC → Assign Roles
2. Select User
3. Select Custom Role
4. Set Expiry Date (optional - for temporary assignments)
5. Click "Assign"

**Property-Level Access:**

1. Go to RBAC → Property Access
2. Select Role and Property
3. Set permissions:
   - Can View
   - Can Edit
   - Can Delete
   - Can Export
4. Click "Grant Access"

#### 3. Audit & Compliance

**Access:** Main Menu → RBAC → Audit Logs

**View Audit Trail:**

1. Navigate to Audit Logs
2. Filter by:
   - Date Range
   - User
   - Action Type
   - Resource (Property, Invoice, etc.)
3. Review action details:
   - Who performed the action
   - What was changed
   - When it occurred
   - IP address and user agent

**Generate Audit Report:**

1. Click "Generate Report"
2. Select date range
3. Select report type:
   - User Activity Report
   - Permission Changes Report
   - Data Modification Report
4. Click "Generate"
5. Download as PDF or CSV

#### 4. System Configuration

**Access:** Main Menu → Settings → System Configuration

**Settings Available:**
- Company Information (name, email, address)
- Payment Reminders Schedule
- Invoice Number Format
- VAT Rates
- Email Notification Settings
- File Upload Limits
- Timezone Settings

**Update Settings:**

1. Go to System Configuration
2. Modify desired settings
3. Click "Save Changes"
4. Confirm changes
5. Changes take effect immediately

#### 5. Managed Users (Delegated Access)

**What are Managed Users?**

Managed users are sub-accounts created by MANAGERS and controlled by those managers. Admins maintain oversight but day-to-day management is delegated.

**Create Managed User:**

1. Go to Users → Managed Users
2. Click "Create Managed User"
3. Enter:
   - Full Name
   - Email
   - Assign Manager (who will oversee this user)
   - Select Properties
4. Set permissions specifically for this user
5. Click "Create"

**Monitor Managed Users:**

1. Go to Users → Activity Monitoring
2. View:
   - Login history
   - Actions performed
   - Data accessed
   - System resource usage
3. Export activity reports

#### 6. Employee Management

**Access:** Main Menu → HR → Employees

**Create Employee:**

1. Click "Add Employee"
2. Enter Details:
   - Full Name
   - Position
   - Contact Information
   - Salary Details:
     - Base Salary
     - Payment Frequency (daily, weekly, bi-weekly, monthly)
     - Bank Account
3. Click "Create Employee"

**Record Salary Payments:**

1. Go to Employees → Payment History
2. Click "Record Payment"
3. Enter:
   - Payment Amount
   - Payment Date
   - Payment Method
   - Payment Period
   - Reference Number
4. Click "Record"

**View Employee Payment History:**

1. Select Employee
2. Click "View History"
3. See all payments:
   - Date Paid
   - Amount
   - Status (Active, On Leave, Terminated)
   - Payment Frequency

---

## Property Manager Guide

### Overview

**Property Managers** are responsible for day-to-day property operations, tenant management, payment collection, and financial tracking. You have access to assigned properties and reporting.

### Manager Dashboard

Your dashboard displays:
- **Properties Overview** - All assigned properties with status
- **Active Tenants** - Tenant list with payment status
- **Pending Payments** - Overdue invoices requiring attention
- **Daily Tasks** - Assigned tasks and reminders
- **Financial Summary** - Revenue and commission tracking

### Managing Properties

#### 1. View Your Properties

**Access:** Main Menu → Properties

**View Property Details:**

1. Click on property name from list
2. See property information:
   - Address and location
   - Property type and usage
   - LR Number (Land Reference)
   - Bank account details
   - Assigned manager and units
3. View associated data:
   - Tenants
   - Units
   - Invoices
   - Bills
   - Reports

#### 2. Managing Units

**Access:** Property Details → Units

**View All Units:**

1. Click "Units" in property details
2. See list of all units with:
   - Unit number/type
   - Size (sq ft)
   - Rent amount
   - Current tenant
   - Status (Vacant/Occupied)

**Update Unit Information:**

1. Click on unit to edit
2. Modify:
   - Unit number
   - Bedrooms/bathrooms
   - Size
   - Rent type and amount
   - Status
3. Click "Update"

**Mark Unit as Vacant:**

1. Select unit
2. Click "Change Status"
3. Select "Vacant"
4. Enter date vacant
5. Click "Update"

### Tenant Management

#### 1. Register New Tenant

**Access:** Main Menu → Tenants

**Create Tenant Account:**

1. Click "Add New Tenant"
2. Enter Tenant Information:
   - Full Name
   - Phone/Email Contact
   - ID Number (National ID)
   - P.O. Box
3. Enter Lease Details:
   - Lease Term (months/years)
   - Rent Amount
   - Term Start Date
   - Rent Start Date
   - Deposit Amount
4. Enter Payment Policy:
   - Payment Frequency (monthly/quarterly/annual)
   - Escalation Rate (% annually or bi-annually)
   - Service Charge Type:
     - Fixed Amount
     - Percentage of Rent
     - Per Sq Ft
5. Enter VAT Details:
   - VAT Type (Inclusive/Exclusive/Not Applicable)
   - VAT Rate (if applicable)
6. Assign Unit
7. Click "Create Tenant"

**Import Tenants (Bulk):**

1. Go to Tenants → Import
2. Download template CSV
3. Fill in tenant information
4. Upload CSV file
5. Review and confirm
6. Click "Import"

#### 2. Update Tenant Information

**Access:** Main Menu → Tenants → Select Tenant

**Edit Tenant Details:**

1. Click "Edit" on tenant profile
2. Update information:
   - Contact details
   - Lease terms
   - Rent amount
   - Payment policy
3. Click "Update"

**Update Payment Policy:**

1. Go to tenant profile
2. Click "Payment Policy"
3. Modify:
   - Payment frequency
   - Escalation rate
   - Escalation period
4. Click "Save Changes"

#### 3. Track Tenant Payment Status

**View Payment Status:**

1. Go to Tenants → Select Tenant
2. See Payment Summary:
   - Total Due
   - Amount Paid
   - Arrears
   - Last Payment Date
3. Click "Payment History" to view details

**Contact Tenant for Payment:**

1. Go to tenant profile
2. Click "Send Payment Reminder"
3. Select reminder type:
   - Email reminder
   - SMS notification
4. Add custom message (optional)
5. Click "Send"

### Invoice Management

#### 1. Auto-Generate Invoices

**Access:** Main Menu → Invoices

**Generate Invoices for Tenant:**

1. Click "Generate Invoice"
2. Select:
   - Tenant
   - Payment Period
   - Invoice Type:
     - Regular Invoice
     - Balance Invoice (outstanding balance)
3. Review calculated amounts:
   - Rent
   - Service Charge
   - VAT
   - Total Due
4. Add notes (if any)
5. Click "Generate"
6. Invoice is created and saved

**Bulk Invoice Generation:**

1. Go to Invoices → Bulk Generate
2. Select period (e.g., January 2026)
3. Select invoicing frequency:
   - All Monthly tenants
   - All Quarterly tenants
   - All Annual tenants
4. Review tenant list
5. Click "Generate All"
6. System generates invoices for all matching tenants

#### 2. View & Download Invoices

**View Invoice:**

1. Go to Invoices
2. Search or filter by:
   - Tenant name
   - Date range
   - Status (Paid/Unpaid)
   - Invoice number
3. Click invoice to view details

**Download Invoice PDF:**

1. Click on invoice
2. Click "Download" or "Download PDF"
3. File saves to your computer
4. Share with tenant as needed

#### 3. Track Invoice Status

**Invoice Statuses:**
- **UNPAID** - Invoice created, not paid
- **PARTIALLY_PAID** - Partial payment received
- **PAID** - Full amount paid
- **OVERDUE** - Due date has passed, not paid

**Update Invoice Status:**

1. Click on invoice
2. Click "Update Status"
3. Select new status
4. Add notes (if needed)
5. Click "Update"

#### 4. Issue Balance Invoices

**What is a Balance Invoice?**

A balance invoice is generated when a tenant has a remaining balance from previous invoices (partial payments).

**Create Balance Invoice:**

1. Go to Invoices → Generate Balance Invoice
2. Select tenant
3. System calculates outstanding balance:
   - Shows previous unpaid amounts
   - Shows partial payments
   - Calculates remaining balance
4. Review and click "Generate"
5. New invoice created with outstanding balance

### Payment Management

#### 1. Record Tenant Payment

**Access:** Main Menu → Payments

**Record Payment:**

1. Click "Record Payment"
2. Select:
   - Tenant
   - Payment Amount
   - Payment Date
   - Payment Method (Cash, Check, Bank Transfer, etc.)
   - Reference Number (optional)
3. Optional: Add notes
4. Click "Record Payment"
5. Payment recorded and invoice status updated automatically

**Apply Payment to Specific Invoice:**

1. Go to Payments
2. Click "Record Payment"
3. Select tenant
4. Click "Link to Invoice"
5. Select invoice(s) to pay
6. System shows how payment is distributed:
   - Amount applied to each invoice
   - Remaining balance
7. Confirm and click "Record"

#### 2. Track Payment History

**View Payment Report:**

1. Go to Reports → Payment Reports
2. Filter by:
   - Date range
   - Tenant
   - Property
   - Payment status
3. View summary showing:
   - Number of payments
   - Total collected
   - Average payment amount
   - Payment trends

**Generate Payment Collection Report:**

1. Go to Reports → Generate Report
2. Select "Payment Collection Report"
3. Choose:
   - Date range
   - Property filter
   - Report format (PDF/Excel)
4. Click "Generate"
5. Download and share with accounting

### Commission Management

#### 1. View Your Commissions

**Access:** Main Menu → Commissions

**View Commission Summary:**

1. See commission details for assigned properties:
   - Commission percentage rate
   - Collection amount
   - Commission amount
   - Payment status (Pending/Paid/Processing)

**Commission Calculation:**

Commission = Collection Amount × Commission Rate

Example: If you collected KES 100,000 with 5% commission rate:
- Commission = KES 100,000 × 5% = KES 5,000

#### 2. Generate Commission Invoice

**Access:** Commissions → Generate Invoice

**Process:**

1. Click "Generate Commission Invoice"
2. Select period (e.g., January 2026)
3. System calculates:
   - Collections made
   - Commission rate
   - Commission amount
   - VAT (if applicable)
4. Review details
5. Click "Generate Invoice"
6. Invoice created and ready for download

#### 3. Track Commission Payment Status

**View Status:**

1. Go to Commissions
2. See payment status:
   - **PENDING** - Commission calculated, awaiting payment
   - **PROCESSING** - Payment in progress
   - **PAID** - Commission paid

**Download Commission Invoice:**

1. Click on commission record
2. Click "Download Invoice"
3. PDF downloads with:
   - Commission breakdown
   - Bank account details
   - Reference number

### Daily Reports

#### 1. Create Daily Operation Report

**Access:** Main Menu → Reports → Daily Reports

**Submit Daily Report:**

1. Click "Create Daily Report"
2. Select Property and Date
3. Fill in sections:

   **Security Section:**
   - Security provider name
   - Shift coverage
   - Security incidents reported
   - Actions taken
   - Outstanding issues

   **Cleaning Section:**
   - Cleaning contractor name
   - Areas cleaned
   - Cleanliness standard (Good/Fair/Poor)
   - Issues found
   - Corrective actions

   **Maintenance Section:**
   - Preventive maintenance tasks
   - Repairs needed
   - Repairs completed

   **Tenant Section:**
   - Complaints received
   - Nature of complaints
   - Actions taken

   **Landlord Section:**
   - Instructions from landlord
   - Action taken
   - Current status

   **Enquiries Section:**
   - New enquiries received
   - Enquiry source
   - Units enquired
   - Follow-up action
   - Site visits conducted

   **Utilities Section:**
   - Water status (Normal/Issue)
   - Electricity status (Normal/Issue)
   - Other services status
   - Remarks

4. Add attachments (photos, documents)
5. Click "Submit"

**Report Statuses:**
- **DRAFT** - Saved but not submitted
- **SUBMITTED** - Submitted for review
- **REVIEWED** - Reviewed by admin
- **ARCHIVED** - Finalized

### Tasks & To-Do Management

#### 1. View Your Tasks

**Access:** Main Menu → Tasks

**Your Task Dashboard Shows:**
- Assigned tasks from managers
- Self-created tasks
- Task status (Pending/In Progress/Pending Approval/Completed)
- Due dates
- Priority level

#### 2. Create Self-Created Task

**Steps:**

1. Click "Create New Task"
2. Enter:
   - Task Title
   - Description
   - Due Date
   - Priority (Low/Medium/High/Urgent)
   - Does task require approval? (Yes/No)
3. Click "Create"

**If approval required:**
- Task enters "Pending Approval" status
- Manager receives notification
- Await manager approval before starting

#### 3. Update Task Status

**Mark Task In Progress:**

1. Click on task
2. Click "Start Task"
3. Status changes to "In Progress"
4. System records start time

**Complete Task:**

1. Click on task
2. Click "Mark Complete"
3. Enter completion notes (optional)
4. Click "Complete Task"
5. Status changes to "Completed"
6. Completion timestamp recorded

**If Manager Review Required:**

- Task changes to "Pending Approval" after completion
- Manager reviews your completion notes
- Manager approves or requests changes

### Working with Bills

#### 1. Create Utility Bill

**Access:** Main Menu → Bills

**Create Bill:**

1. Click "Create Bill"
2. Select:
   - Tenant
   - Bill Type (Water/Electricity/Gas)
   - Reference number
3. Enter Meter Readings:
   - Previous reading
   - Current reading
4. Enter:
   - Charge per unit
   - Description (optional)
4. System calculates:
   - Units used
   - Total charge
   - VAT
   - Grand total
5. Click "Create"

#### 2. Generate Bill Invoice

**Access:** Bills → Select Bill

**Process:**

1. Click on bill
2. Click "Generate Invoice"
3. Review:
   - Bill details
   - Charges
   - VAT calculation
   - Total amount due
4. Click "Generate"
5. Invoice created and linked to tenant account

#### 3. Track Bill Payment Status

**Bill Statuses:**
- **UNPAID** - Invoice issued, not paid
- **PARTIALLY_PAID** - Partial payment received
- **PAID** - Bill fully paid

**View Bill Payment:**

1. Go to Bills
2. Check status for each bill
3. Click bill to see payment history
4. View payment dates and amounts

### Document Generation

#### 1. Generate Demand Letter

**Access:** Main Menu → Documents → Demand Letters

**What is a Demand Letter?**

A formal document requesting immediate payment of outstanding rent/arrears.

**Create Demand Letter:**

1. Click "Create Demand Letter"
2. Select:
   - Tenant
   - Property/Unit
   - Invoice(s) with outstanding balance
3. System calculates:
   - Outstanding amount
   - Due date
   - Overdue period
4. Review letter content
5. Click "Generate PDF"
6. Download or print as needed

**Bulk Demand Letter Generation:**

1. Go to Documents → Bulk Generate
2. Select properties
3. System identifies all overdue invoices
4. Click "Generate All"
5. Letters created for all overdue tenants
6. Download as PDF bundle

#### 2. Generate Payment Receipt

**Access:** Payments → View Payment

**Steps:**

1. Go to payment record
2. Click "Generate Receipt"
3. System creates official receipt with:
   - Receipt number
   - Tenant details
   - Property/unit
   - Amount paid
   - Payment date
   - Reference number
4. Download or print

#### 3. Download & Share Documents

**Download Options:**

1. Single document download - Click "Download" on document
2. Bulk download - Select multiple documents, click "Download All"

**Share Document:**

1. Click on document
2. Click "Share"
3. Enter recipient email address(es)
4. Add message (optional)
5. Click "Send"
6. Email sent with document attached

---

## General User Guide

### Overview

**General Users** have limited access to the system. You can view assigned properties, data entry, and create reports with restrictions. You cannot modify invoices, generate documents, or access financial data beyond your assigned properties.

### User Dashboard

Your dashboard shows:
- **Assigned Properties** - Properties you have access to
- **My Tasks** - Tasks assigned to you
- **Recent Activity** - Actions performed
- **Quick Links** - Frequently used features

### What You Can Do

✅ View assigned properties and units  
✅ View tenant information (assigned properties only)  
✅ Record payment data  
✅ Create and submit daily reports  
✅ Create personal tasks  
✅ View your task history  
✅ View limited reports  

### What You Cannot Do

❌ Create properties  
❌ Create/delete tenants  
❌ Generate or modify invoices  
❌ Generate invoices  
❌ Manage users or roles  
❌ View sensitive financial data  
❌ Create demand letters  

### Viewing Assigned Properties

**Access:** Main Menu → Properties

**View Property:**

1. See list of properties assigned to you
2. Click on property name
3. View:
   - Property address and details
   - Assigned manager
   - Number of units
   - Active tenants

**View Units:**

1. Go to property details
2. Click "Units"
3. See all units with status:
   - Unit number and type
   - Size
   - Rent amount
   - Occupant (if occupied)
   - Status (Vacant/Occupied)

### Tenant Information Access

**View Tenant Details:**

1. Go to Properties → Select Property → Tenants
2. See tenant list with:
   - Name
   - Contact information
   - Lease term
   - Assigned unit
3. Click tenant to view:
   - Lease details
   - Recent activity
   - Associated documents

**Important:** You can only view tenants in properties assigned to you.

### Recording Payments

**Access:** Main Menu → Payments

**Record Payment (if you have permission):**

1. Click "Record Payment"
2. Select:
   - Tenant
   - Payment Amount
   - Payment Date
   - Payment Method
   - Reference Number
3. Add notes (optional)
4. Click "Record"

**Restrictions:**
- You can only record payments for assigned properties
- All payments are logged and audited
- Manager/Admin must approve high amounts (if configured)

### Creating Task Reports

**Access:** Main Menu → Reports → Create Report

**Submit Daily Report:**

1. Click "Create Daily Report"
2. Select property and date
3. Fill in available sections:
   - Security details
   - Cleaning status
   - Maintenance information
   - Tenant issues
   - Utilities status
   - Operational notes
4. Add attachments (photos, documents)
5. Click "Submit"

**Restrictions:**
- Only for assigned properties
- Cannot view other users' reports
- Cannot delete submitted reports

### Personal Task Management

**Create Personal Task:**

1. Go to Tasks → My Tasks
2. Click "Create New Task"
3. Enter:
   - Task Title
   - Description
   - Due Date
   - Priority (Low/Medium/High/Urgent)
4. Click "Create"

**Update Task:**

1. Click on task
2. Click "Edit"
3. Modify details
4. Click "Update"

**Mark Task Complete:**

1. Click on task
2. Click "Mark Complete"
3. Add completion notes
4. Click "Complete"

**View Task History:**

1. Go to Tasks
2. See all tasks:
   - Pending
   - In Progress
   - Completed
   - Overdue

### Viewing Assigned Data

**Search Functionality:**

1. Use search bar at top of page
2. Search by:
   - Tenant name
   - Property name
   - Unit number
   - Invoice number
3. Results show only data you have access to

**Filtering Data:**

1. Click "Filters" on any list page
2. Filter by:
   - Date range
   - Status
   - Property
   - Assigned person
3. Apply filters to narrow results

---

## Common Tasks & Workflows

### Workflow 1: New Tenant Onboarding

**Timeline:** 1-2 hours  
**Users Involved:** Manager, Landlord

**Steps:**

1. **Create Property Unit** (if not exists)
   - Manager adds unit to property
   - Specifies rent type and amount

2. **Register Tenant**
   - Collect tenant information
   - Define lease terms and rent
   - Set payment policy and escalation
   - Set service charge and VAT
   - Assign to unit

3. **Create Offer Letter** (optional)
   - Generate formal offer document
   - Send to tenant for signature

4. **Generate First Invoice**
   - Create initial invoice for first month
   - Send to tenant via email

5. **Collect Deposit**
   - Record deposit payment
   - Account for in financial records

6. **Complete Tenant Onboarding**
   - Tenant receives welcome email
   - Tenant login credentials sent
   - System sends payment reminders scheduled

### Workflow 2: Monthly Invoice Generation

**Timeline:** 1 day (beginning of month)  
**Users Involved:** Manager, Admin

**Steps:**

1. **Batch Generate Invoices**
   - Go to Invoices → Bulk Generate
   - Select "Monthly Payment Policy"
   - Review tenant list
   - Click "Generate All"

2. **Review Generated Invoices**
   - Verify all invoices created
   - Check calculations
   - Confirm amounts are correct

3. **Send to Tenants**
   - System automatically emails invoices
   - Or manually send via portal

4. **Monitor Payment Status**
   - Track payments over due period
   - Send reminders to late payers

5. **Apply Payments**
   - As tenants pay, record payments
   - Update invoice status
   - Maintain payment records

### Workflow 3: Payment Collection & Reminder

**Timeline:** Throughout month  
**Users Involved:** Manager, Tenant, Admin

**Step 1: Invoice Due**
- Invoice generated
- Due date approaches

**Step 2: Automated Reminders (Daily at 9 AM & 12 PM)**
- System checks for due invoices
- Email reminders sent to tenants
- Urgency level shown:
  - 🟢 UPCOMING (7+ days to due date)
  - 🟡 REMINDER (Due today or within 7 days)
  - 🟠 WARNING (15+ days overdue)
  - 🔴 URGENT (30+ days overdue)

**Step 3: Payment Received**
- Tenant pays via bank transfer or physical payment
- Manager records payment in system
- Payment linked to invoice

**Step 4: Invoice Status Update**
- System updates invoice status:
  - Partial payment: Status = PARTIALLY_PAID
  - Full payment: Status = PAID

**Step 5: Weekly Summary**
- Every Monday 10 AM
- System sends weekly payment summary email
- Shows collections, pending, and overdue amounts

### Workflow 4: Handling Overdue Payments

**Timeline:** Escalating over weeks  
**Users Involved:** Manager, Tenant, Admin

**Day 1-7 (REMINDER Stage)**
- Payment reminder emails sent
- Tenant contacts to arrange payment
- Payment may be made

**Day 8-14 (WARNING Stage)**
- More urgent reminder emails
- Manager may call tenant
- Verbal or written arrangement made

**Day 15-29 (WARNING Stage continued)**
- Intense reminders
- Payment plan discussed if needed

**Day 30+ (URGENT Stage)**
- Formal demand letter generated
- Legal notice sent
- Potential eviction proceedings discussed
- Escalation to landlord/legal team

**Resolution:**
- Payment received and recorded
- Invoice marked as PAID
- Payment receipt issued
- Arrears cleared

### Workflow 5: Commission Calculation & Payment

**Timeline:** Monthly (end of month)  
**Users Involved:** Manager, Admin

**Step 1: Collection Period**
- Manager collects rent and payments from tenants
- All collections recorded in system

**Step 2: Calculate Commissions**
- At month-end, system calculates:
  - Total collections for manager
  - Commission percentage
  - Commission amount

**Commission Formula:**
```
Commission = Total Collections × Commission Rate %
VAT = Commission × VAT Rate %
Total Due = Commission + VAT
```

**Example:**
- Collected: KES 500,000
- Commission Rate: 5%
- Commission: KES 25,000
- VAT (16%): KES 4,000
- Total Due: KES 29,000

**Step 3: Generate Commission Invoice**
- Manager or admin generates commission invoice
- Invoice shows all calculations
- Bank details for transfer included

**Step 4: Payment**
- Admin approves and initiates payment
- Commission status changes to "PROCESSING"
- Payment transferred to manager account
- Status changes to "PAID"

---

## Payment & Invoicing

### Understanding Payment Policies

**Payment Policies Define When Tenants Must Pay**

#### Monthly Payment Policy
- **Frequency:** Once per month
- **Typical Due Date:** 1st of month or end of month
- **Invoice Frequency:** Monthly invoices generated automatically

#### Quarterly Payment Policy
- **Frequency:** Once per 3 months
- **Billing:** Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec
- **Invoice Frequency:** Quarterly invoices generated

#### Annual Payment Policy
- **Frequency:** Once per year
- **Typical Due Date:** Anniversary of lease start
- **Invoice Frequency:** Annual invoices generated

### Rent Escalation

**What is Rent Escalation?**

Automatic increase in rent amount on specified intervals (e.g., 5% increase every year).

**Types of Escalation:**

1. **Annual Escalation**
   - Rent increases yearly
   - Example: KES 50,000/month increases 5% = KES 52,500/month (next year)

2. **Bi-Annual Escalation**
   - Rent increases every 6 months
   - Example: KES 50,000/month increases 3% every 6 months

**How System Applies Escalation:**

- Escalation rate applied automatically on escalation date
- New rent amount used for next invoice
- Tenant notified of increase
- Increase documented in payment history

**Example Timeline (5% Annual Escalation, 1st January):**
```
Year 1 (Jan 1 - Dec 31): KES 50,000/month
Year 2 (Jan 1 - Dec 31): KES 52,500/month (50,000 × 1.05)
Year 3 (Jan 1 - Dec 31): KES 55,125/month (52,500 × 1.05)
```

### Service Charges

**What is a Service Charge?**

Additional charge for services (maintenance, security, cleaning, utilities).

**Types of Service Charges:**

1. **Fixed Amount**
   - Flat fee per month
   - Example: KES 5,000/month for building maintenance

2. **Percentage of Rent**
   - Calculated as % of monthly rent
   - Example: 10% of KES 50,000 rent = KES 5,000

3. **Per Square Foot**
   - Based on unit size
   - Example: KES 50 per sq ft × 1,000 sq ft = KES 50,000

**Service Charge on Invoice:**
```
Invoice Calculation:
Base Rent:          KES 50,000
Service Charge:     KES 5,000
Subtotal:           KES 55,000
VAT (16%):          KES 8,800
Total Due:          KES 63,800
```

### VAT (Value Added Tax) Handling

**VAT Types:**

1. **Inclusive**
   - VAT is included in the rent amount quoted
   - Separate VAT line not shown to tenant
   - System calculates VAT for accounting

2. **Exclusive**
   - VAT added on top of rent
   - Tenant sees VAT as separate line item
   - Invoice total = Rent + Service Charge + VAT

3. **Not Applicable**
   - No VAT charged
   - Rent amount is final

**Example: KES 50,000 rent with different VAT types:**

**Inclusive VAT (16%):**
```
Rent (inclusive):   KES 50,000
VAT (calculated):   KES 6,896
Tax Base:           KES 43,104
Total Invoice:      KES 50,000
```

**Exclusive VAT (16%):**
```
Rent:               KES 50,000
VAT:                KES 8,000
Total Invoice:      KES 58,000
```

**Not Applicable:**
```
Rent:               KES 50,000
VAT:                KES 0
Total Invoice:      KES 50,000
```

### Partial Payments & Balance Invoices

**Scenario:** Tenant pays part of invoice, owes balance

**Example:**
```
Original Invoice Amount:    KES 100,000
Tenant Pays:               KES 60,000
Outstanding Balance:       KES 40,000
```

**Process:**

1. **Record Partial Payment**
   - Manager records KES 60,000 payment
   - Invoice status changes to "PARTIALLY_PAID"
   - Balance shown as KES 40,000

2. **Generate Balance Invoice**
   - System creates new invoice for KES 40,000
   - New due date set
   - Issued to tenant for remaining balance

3. **Track Both Invoices**
   - Original invoice shows partial payment
   - Balance invoice tracked separately
   - Payment history shows both amounts

### Arrears Management

**What are Arrears?**

Outstanding amounts owed by tenant (overdue payments).

**Tracking Arrears:**

1. **In System**
   - Each tenant shows "Arrears" field
   - Calculated automatically:
     ```
     Arrears = Total Invoiced - Total Paid (not overdue)
     ```

2. **On Dashboard**
   - Arrears shown in tenant summary
   - Red flag alerts for high arrears
   - Overdue days calculated

3. **In Reports**
   - Payment reports show arrears
   - Aging analysis available
   - Over 30 days = urgent action needed

**Managing Arrears:**

1. **Send Arrears Notice**
   - Generate demand letter
   - Request immediate payment
   - Reference outstanding amounts

2. **Payment Plan**
   - If tenant unable to pay full amount
   - Set up payment plan
   - Record installment amounts
   - Track each installment

3. **Escalation**
   - If unpaid after 30 days: Formal demand
   - If unpaid after 60 days: Legal notice
   - If unpaid after 90 days: Eviction notice

---

## Document Generation

### Invoice Generation

#### Professional Invoice Layout

```
[COMPANY LETTERHEAD]

INVOICE

Invoice Number:     INV-2026-001234
Date Issued:        January 15, 2026
Due Date:          January 31, 2026
Payment Period:    January 2026

FROM:
Interpark Enterprises Limited
Address, Phone, Email

TO:
Tenant Name
Property Address
Unit Number

BILL TO:
Same as above

─────────────────────────────────────
Description          Amount
─────────────────────────────────────
Base Rent           KES 50,000.00
Service Charge      KES 5,000.00
Subtotal            KES 55,000.00

VAT (16%)           KES 8,800.00
─────────────────────────────────────
TOTAL DUE           KES 63,800.00

PAYMENT INSTRUCTIONS:
Bank Name: ABC Bank
Account: 1234567890
Branch: Nairobi
Reference: INV-2026-001234

Terms & Conditions:
- Payment due on date shown above
- Late payment: Interest at 2% per month
- Queries: Contact finance team
```

#### Invoice Numbering

**Auto-Generated Format:**
- Prefix: "INV-"
- Year: "2026-"
- Sequential: "001234"
- Full: "INV-2026-001234"

**Customizable:** Admin can set custom format in system settings

#### Download & Share Invoice

**Steps:**

1. Go to Invoices
2. Click invoice number
3. Click "Download PDF"
4. File saved as "Invoice-[number].pdf"
5. Send to tenant or print

### Balance Invoices

**Purpose:** Issue invoice for remaining owed amount after partial payment

**Key Differences from Regular Invoice:**
- Shows only outstanding balance
- Due date reset for new period
- References original invoice number
- Marked as "BALANCE INVOICE"
- New invoice number generated

**Example:**
```
BALANCE INVOICE

Original Invoice:   INV-2026-001234
This Invoice:       INV-2026-001245
Original Amount:    KES 100,000.00
Paid:               KES 60,000.00
Outstanding:       KES 40,000.00    ← Amount Due
```

### Offer Letters

**Purpose:** Formal lease offer document for prospective tenants

**Contents:**
- Offer number and date
- Property and unit details
- Tenant information
- Lease terms and duration
- Rent amount and payment schedule
- Deposit amount
- Service charges (if applicable)
- Escalation terms
- Special conditions
- Expiry date for offer acceptance

**Generation:**
1. Go to Documents → Offer Letters
2. Select Lead (prospective tenant)
3. Enter lease details
4. Click "Generate PDF"
5. Share with lead for signature

### Demand Letters

**Purpose:** Formal request for payment of outstanding amounts

**Auto-Generated Contents:**
- Letter number and date
- Tenant and property details
- Outstanding amount
- Original invoice reference
- Due date
- Overdue period
- Payment instruction
- Consequences of non-payment
- Legal reference

**Generate Demand Letter:**
1. Go to Documents → Demand Letters
2. Select tenant with overdue invoice
3. Click "Generate Letter"
4. Review details
5. Click "Generate PDF"
6. Download and send to tenant

### Payment Receipts

**Purpose:** Official confirmation of payment received

**Receipt Contents:**
- Receipt number (auto-generated)
- Date received
- Tenant name and details
- Property and unit
- Amount received
- Payment method
- Reference number
- Invoice(s) paid
- Balance remaining (if partial)
- Official seal/signature line
- Receipt terms

**Issue Receipt:**
1. Go to Payment record
2. Click "Generate Receipt"
3. System creates official receipt
4. Download and share with tenant

### Batch Document Generation

**Generate Multiple Documents:**

1. Go to Documents → Batch Generate
2. Select document type (Invoices/Receipts/Demand Letters)
3. Set filters:
   - Date range
   - Property
   - Status
   - Tenant list
4. Review tenant/invoice list
5. Click "Generate All"
6. System creates all documents
7. Download as PDF bundle (ZIP file)

---

## Reports & Analytics

### Available Report Types

#### 1. Payment Reports

**Purpose:** Track all tenant payments and collection status

**Report Contents:**
- Period date range
- Tenant-wise payment breakdown:
  - Invoices issued
  - Amount paid
  - Balance outstanding
  - Payment percentage
- Summary statistics:
  - Total collected
  - Total outstanding
  - Collection rate %
  - Average payment size
- Trend analysis

**Generate Payment Report:**
1. Go to Reports → Payment Reports
2. Select date range
3. Choose filters (Property, Tenant, Status)
4. Click "Generate Report"
5. Download as PDF or Excel

#### 2. Property Financial Summary

**Purpose:** Financial overview of each property

**Report Contents:**
- Property details
- Total rent collected (period)
- Total service charges
- Total VAT
- Outstanding balance
- Collection efficiency %
- Revenue trend (chart)
- Top-paying tenants
- Overdue tenant list

**Generate:**
1. Go to Reports → Property Financial
2. Select property
3. Select period
4. Click "Generate"

#### 3. Tenant Aging Report

**Purpose:** Analyze outstanding invoices by age

**Report Contents:**
- Tenant list with:
  - Current invoice amount
  - 30-60 days overdue
  - 60-90 days overdue
  - 90+ days overdue
- Aging summary:
  - Count of invoices in each category
  - Total amount in each age group
- Action recommendations

**Generate:**
1. Go to Reports → Tenant Aging
2. Select date
3. Property filter (optional)
4. Click "Generate"

#### 4. Commission Report

**Purpose:** Track manager commissions and payouts

**Report Contents:**
- Manager details
- Commission period
- Collections made
- Commission rate
- Commission calculated
- VAT breakdown
- Payment status
- Payment date (if paid)

**Generate:**
1. Go to Reports → Commission Report
2. Select manager (or leave blank for all)
3. Select period
4. Click "Generate"

#### 5. Daily Operation Reports Summary

**Purpose:** Consolidated operational insights

**Report Contents:**
- Properties submitted reports
- Average report submission rate
- Security incidents summary
- Maintenance issues reported
- Tenant complaints overview
- Utilities status
- Follow-up actions needed

**Generate:**
1. Go to Reports → Operations Summary
2. Select date range
3. Select properties
4. Click "Generate"

#### 6. Audit Log Report

**Purpose:** Compliance and tracking of system activities

**Report Contents:**
- All user actions logged:
  - Who performed action
  - What was modified
  - When it occurred
  - Changes made
  - IP address
- Filtered by:
  - Date range
  - User
  - Action type
  - Resource

**Generate:**
1. Go to Reports → Audit Logs (Admin only)
2. Set filters
3. Click "Generate Report"
4. Download for compliance

### Custom Report Builder

**Create Custom Reports:**

1. Go to Reports → Create Custom Report
2. Select report type:
   - Financial
   - Operational
   - Compliance
3. Choose data fields:
   - Property data
   - Tenant data
   - Invoice data
   - Payment data
4. Set filters and date ranges
5. Choose output format (PDF/Excel)
6. Click "Generate"
7. Save report template for future use

### Exporting Data

**Export Report to Excel:**
1. Go to any report
2. Click "Export to Excel"
3. File downloads as .xlsx
4. Open in Microsoft Excel or similar

**Export Report to PDF:**
1. Click "Export to PDF"
2. Choose formatting options
3. File downloads as .pdf
4. Ready for printing or sharing

---

## Frequently Asked Questions

### General Questions

**Q1: How do I reset my password?**

A: Click "Forgot Password" on the login page, enter your email, and follow the reset link sent to your email.

**Q2: Can I change my email address?**

A: Go to Settings → My Profile → Edit Email. However, email address cannot be changed as it's used for login. Contact admin to create new account if needed.

**Q3: How do I log out?**

A: Click your profile icon (top-right) → Logout. You'll be returned to login page.

**Q4: Is my data secure?**

A: Yes. System uses:
- JWT token authentication
- Password hashing (bcryptjs)
- Encrypted data transmission (HTTPS)
- Role-based access controls
- Audit logging of all actions

**Q5: Can I access from mobile phone?**

A: Currently, the system is optimized for desktop browsers. Mobile support is planned for future releases. You can access via mobile browser but functionality may be limited.

### Property & Tenant Questions

**Q6: How do I add a new property?**

A: (Manager/Admin only) Go to Properties → Add Property. Fill in property details and click Create. You'll need admin approval in some configurations.

**Q7: How do I change tenant rent amount?**

A: Go to Tenants → Select Tenant → Edit → Update Rent Amount → Save Changes. New amount applies to next invoice.

**Q8: Can I import multiple tenants at once?**

A: Yes. Go to Tenants → Import → Download Template → Fill in CSV → Upload. System validates and imports all tenants.

**Q9: What happens when a tenant's lease ends?**

A: The unit status changes to "Vacant". You can immediately assign a new tenant or leave vacant. Past payment records are retained.

### Payment & Invoice Questions

**Q10: How are invoices automatically calculated?**

A: System calculates:
```
Base Rent + Service Charge + (applicable VAT) = Total Due
```

VAT calculation depends on VAT Type configured for tenant.

**Q11: What if a tenant pays less than the full amount?**

A: Record the partial payment. Invoice status changes to "PARTIALLY_PAID". You can generate a balance invoice for remaining amount.

**Q12: Can I issue invoice before due date?**

A: Yes. Invoices can be generated anytime. The due date you set determines when system sends reminders and marks overdue.

**Q13: How do payment reminders work?**

A: System automatically sends email reminders:
- Daily at 9 AM and 12 PM (Kenya timezone)
- Weekly summary on Monday 10 AM
- Only for invoices approaching or past due date
- Email includes urgency level (UPCOMING/REMINDER/WARNING/URGENT)

**Q14: Can I set up payment plans for overdue amounts?**

A: Not automated, but you can:
- Record partial payments as they're made
- Create balance invoices for remaining amounts
- Issue new invoices with extended due dates
- Track payments in payment history

### Commission Questions

**Q15: How is commission calculated?**

A: ```
Commission = Total Collections × Commission Rate %
```
Example: KES 500,000 collected × 5% rate = KES 25,000 commission

**Q16: When are commissions paid?**

A: Commission invoices are generated monthly (end of month), but payment schedule is set by admin. Contact your administrator for payment dates.

**Q17: Is VAT included in commission?**

A: No. VAT is calculated on commission amount:
```
Commission: KES 25,000
VAT (16%): KES 4,000
Total Due to Manager: KES 29,000
```

### Document & Report Questions

**Q18: Can I customize invoice layout?**

A: Basic customization available through system settings (company info, letterhead). Advanced customization requires development. Contact admin for options.

**Q19: How do I generate a demand letter?**

A: Go to Documents → Demand Letters → Create → Select overdue tenant → System auto-fills details → Generate PDF.

**Q20: Can I schedule automatic report generation?**

A: Not currently automated, but you can:
- Generate reports manually anytime
- Save as templates for quick regeneration
- Export to Excel for further processing

### Troubleshooting Questions

**Q21: An invoice won't generate. What should I do?**

A: Check:
- Is tenant created and assigned to unit? ✓
- Is payment policy configured? ✓
- Does tenant have outstanding balance from previous invoices? (Create balance invoice instead)
- Is due date in future? ✓
Contact admin if issue persists.

**Q22: Payment isn't showing in records. How do I fix it?**

A: 
1. Verify payment was recorded in system
2. Go to Payments and search for tenant
3. Check if payment is linked to correct invoice
4. Check payment date
5. Verify payment amount matches actual payment
Contact admin if payment cannot be found.

**Q23: Tenant says they paid but invoice still shows unpaid. What happened?**

A: Possible reasons:
- Payment not yet recorded in system
- Payment recorded to wrong tenant
- Payment partial, balance remains
- Payment linked to wrong invoice
Contact manager or admin to verify and record payment.

---

## Troubleshooting

### Common Issues & Solutions

#### Issue 1: Cannot Log In

**Symptoms:**
- "Invalid email or password" error
- Account locked after multiple attempts

**Solutions:**

1. **Verify email address:**
   - Check for typos in email
   - Ensure caps lock is off
   - Try different email format if applicable

2. **Reset password:**
   - Click "Forgot Password"
   - Enter email address
   - Check email for reset link
   - Create new password
   - Try logging in with new password

3. **Account may be inactive:**
   - Contact administrator
   - Ask to activate account
   - Wait for activation email

4. **Clear browser cache:**
   - Clear browsing data in your browser
   - Close all browser windows
   - Reopen and try again

#### Issue 2: Permission Denied Error

**Symptoms:**
- "You don't have permission to access this resource"
- Cannot see some data or features

**Solutions:**

1. **Verify your role:**
   - Check your user profile
   - Confirm assigned role (Admin/Manager/User)
   - Some features only available to specific roles

2. **Check property assignment:**
   - Many features are property-specific
   - Ensure you're assigned to that property
   - Contact admin to add property access

3. **Temporary permissions:**
   - Your access may have expiration date
   - Check assignment details
   - Contact admin if access expired

#### Issue 3: Invoice Not Generating

**Symptoms:**
- "Failed to generate invoice" error
- No invoice created

**Solutions:**

1. **Verify tenant setup:**
   - Tenant must be created first
   - Tenant must be assigned to unit
   - Check tenant record is complete

2. **Check payment policy:**
   - Ensure payment policy is configured
   - Verify due date is in future

3. **Verify invoice doesn't already exist:**
   - Check if invoice for this period already created
   - System prevents duplicate invoices
   - Create balance invoice instead if needed

4. **Check system requirements:**
   - All required fields filled?
   - Valid date ranges?
   - Contact admin if error persists

#### Issue 4: Email Reminders Not Sending

**Symptoms:**
- Payment reminders not received
- No email notifications

**Solutions:**

1. **Verify email is configured:**
   - Admin must configure email settings
   - Check email service (Gmail/Resend) is active
   - Ask admin to verify email configuration

2. **Check scheduler is running:**
   - Scheduler must run separately from main app
   - Check with admin if scheduler is active
   - Restart scheduler if needed

3. **Check your email settings:**
   - Check spam/junk folder
   - Verify email address on account
   - Add system email to contacts to prevent spam filtering

4. **Verify cron schedule:**
   - Reminders run at specific times:
     - 9 AM Kenya time
     - 12 PM Kenya time
     - Monday 10 AM Kenya time
   - Wait until scheduled time

#### Issue 5: Data Not Saving

**Symptoms:**
- Changes disappear after refresh
- "Failed to save" error

**Solutions:**

1. **Check internet connection:**
   - Verify stable internet connection
   - Try again if connection interrupted
   - Check WiFi signal strength

2. **Check for validation errors:**
   - Look for red error messages
   - Fill all required fields (marked with *)
   - Verify data format (dates, numbers, emails)
   - Correct errors and try saving again

3. **Clear browser cache:**
   - Clear browsing data
   - Close browser completely
   - Reopen and try again

4. **Try different browser:**
   - Try Chrome, Firefox, Safari, or Edge
   - System best supported on modern browsers
   - Update browser to latest version

#### Issue 6: Report Won't Generate

**Symptoms:**
- "Error generating report" message
- Report generation times out
- Blank report

**Solutions:**

1. **Narrow date range:**
   - Generating large date ranges takes time
   - Try smaller date range first
   - System may time out on very large datasets

2. **Remove filters:**
   - Try generating without filters
   - Add filters one at a time to identify problem
   - Verify filter values are correct

3. **Check available data:**
   - Verify data exists for selected period
   - Confirm properties/tenants assigned to you
   - Empty date ranges return blank reports

4. **Try different format:**
   - Try PDF instead of Excel
   - Try Excel instead of PDF
   - One format may work better than other

#### Issue 7: Slow System Performance

**Symptoms:**
- Pages load slowly
- Dashboard takes long time to display
- Reports generation is very slow

**Solutions:**

1. **Check internet speed:**
   - Test internet connection speed
   - Poor connection causes slow loading
   - Contact internet provider if issue

2. **Clear browser cache:**
   - Clear browsing data
   - Close unnecessary browser tabs
   - Restart browser

3. **Close background applications:**
   - Other applications use bandwidth
   - Close unnecessary programs
   - Free up computer memory

4. **Use modern browser:**
   - Ensure browser is up-to-date
   - Modern browsers are faster
   - Avoid very old browsers

5. **Contact admin:**
   - Server may be experiencing issues
   - Admin can check system performance
   - Maintenance may be scheduled

#### Issue 8: Document Upload Failed

**Symptoms:**
- "Failed to upload file" error
- File upload doesn't complete

**Solutions:**

1. **Check file size:**
   - Maximum file size is 10 MB
   - Reduce file size using compression
   - Try smaller files

2. **Check file type:**
   - Allowed types: PDF, JPG, PNG, DOC, DOCX, XLS, XLSX
   - Ensure file is correct type
   - Check file extension is correct

3. **Clear browser cache:**
   - Clear temporary files
   - Close and reopen browser
   - Try uploading again

4. **Try different browser:**
   - Some browsers handle uploads better
   - Try Chrome or Firefox
   - Update browser to latest version

---

## Support & Contact

### Getting Help

#### 1. In-System Help

**Quick Help Available:**
- Hover over info icons (ⓘ) for tooltips
- Click "?" buttons for field explanations
- Check each page's help section

#### 2. This Manual

**Sections to Reference:**
- Use Table of Contents for quick navigation
- Search for your issue/topic
- Check Frequently Asked Questions section
- Review role-specific guides

#### 3. Contact Support

**Email Support:**
- **Email:** support@interparkenterprises.co.ke
- **Response Time:** Within 24 hours
- **Include:**
  - Your email address
  - Issue description
  - Steps to reproduce
  - Screenshots (if applicable)
  - User role

**Phone Support:**
- **Number:** +254 [XXX] [XXX] [XXXX]
- **Hours:** Monday-Friday, 9 AM-5 PM Kenya Time
- **Ask for:** Technical Support Team

**In-App Support:**
- Click "Help" or "Support" link (varies by page)
- Submit support ticket through system
- Track ticket status in account

#### 4. Reporting Issues

**Submit Bug Report:**

1. Go to Help → Report Issue
2. Select issue type:
   - Bug Report
   - Feature Request
   - General Question
3. Provide details:
   - Specific description
   - When issue occurs
   - How often it happens
   - Impact on work
4. Attach screenshot/file if applicable
5. Submit

**For Urgent Issues:**
- Call phone support immediately
- Follow up with email
- Provide as much detail as possible

### System Maintenance & Downtime

**Scheduled Maintenance:**
- Usually Thursday nights 10 PM - 12 AM
- You'll receive advance notice email
- System unavailable during maintenance
- Plan accordingly

**Emergency Maintenance:**
- Unscheduled for critical issues
- You'll be notified immediately
- Usually brief duration
- Contact support if unable to access

### Version & Updates

**Current Version:** 1.0.0

**What's New in Latest Version:**
- See system messages on login
- Check "What's New" in Help menu
- Review release notes on support page

**Staying Updated:**
- System auto-updates in background
- No action required from users
- New features available immediately

---

## Additional Resources

### Learning Materials

**Video Tutorials:**
- Available at: support.interparkenterprises.co.ke/videos
- Topics:
  - Getting started guide
  - Invoice generation walkthrough
  - Payment processing demo
  - Reporting overview

**Knowledge Base:**
- Searchable FAQ database
- Step-by-step guides
- Best practices
- Common solutions

**Webinars:**
- Monthly training webinars
- Register at: support.interparkenterprises.co.ke/webinars
- Topics cover different user roles
- Q&A session included

### Best Practices

**Property Management:**
- ✅ Create all tenants before generating invoices
- ✅ Set payment policies clearly at tenant creation
- ✅ Regularly monitor arrears (weekly recommended)
- ✅ Generate balance invoices promptly for partial payments
- ✅ Archive old reports for compliance

**Financial Management:**
- ✅ Reconcile system payments with bank statements monthly
- ✅ Review commission calculations before payment
- ✅ Maintain audit trail for all transactions
- ✅ Generate financial reports monthly for accounting
- ✅ Back up reports regularly

**User Management (Admin):**
- ✅ Review user permissions quarterly
- ✅ Disable inactive accounts after 90 days
- ✅ Audit access logs monthly
- ✅ Set expiration dates for temporary assignments
- ✅ Document all permission changes

### Glossary of Terms

**Arrears** - Amount owed by tenant that is past due date

**Commission** - Payment to manager based on collection percentage

**Invoice** - Bill issued to tenant for rent/service charges due

**Payment Policy** - Schedule of when tenant must pay (monthly/quarterly/annual)

**Escalation** - Automatic increase in rent on specified date (e.g., 5% annually)

**Service Charge** - Additional charge for services (maintenance, security, utilities)

**VAT (Value Added Tax)** - Tax on rent and services (16% in Kenya)

**Demand Letter** - Formal request for payment of overdue amounts

**Lease Term** - Duration of rental agreement (e.g., 12 months)

**Unit** - Individual rental space (apartment, office, shop, etc.)

**Property** - Building or complex containing units

**LR Number** - Land Reference number for property

**RBAC** - Role-Based Access Control (permission system)

**Audit Log** - Record of all system actions for compliance

---

## Document Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-07-21 | Interpark Dev Team | Initial comprehensive manual for all user types |

---

## Appendix: Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + S` or `Cmd + S` | Save (on forms) |
| `Ctrl + P` or `Cmd + P` | Print page |
| `Esc` | Close dialog or cancel action |
| `Enter` | Submit form |
| `Tab` | Navigate to next field |
| `Shift + Tab` | Navigate to previous field |
| `/` | Open search (global search) |
| `?` | Open keyboard shortcuts help |

---

**END OF USER MANUAL**

---

**For the latest version of this manual, visit:**
https://github.com/interparkenterprises/Interpark-property-system-backend/blob/main/USER_MANUAL.md

**Questions or feedback?** Contact support@interparkenterprises.co.ke

