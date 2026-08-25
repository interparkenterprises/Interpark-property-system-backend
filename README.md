# Interpark Property Management System - Backend

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Language](https://img.shields.io/badge/language-JavaScript-yellow.svg)
![License](https://img.shields.io/badge/license-ISC-green.svg)
![Node](https://img.shields.io/badge/node-16+-brightgreen.svg)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-12+-blue.svg)

A comprehensive **Node.js/Express backend** for managing residential and commercial properties. Handles tenant management, invoice generation, automated payment reminders, commission tracking, and role-based access control with 90+ granular permissions.

---

## 📋 Table of Contents

- [⚡ Quick Start (5 min)](#⚡-quick-start-5-min)
- [System Overview](#🏢-system-overview)
- [What It Accomplishes](#✅-what-it-accomplishes)
- [Tech Stack](#🛠️-tech-stack)
- [Database Schema](#🗄️-database-schema)
- [Project Structure](#📁-project-structure)
- [Setup & Installation](#🚀-setup--installation)
- [Running the System](#▶️-running-the-system)
- [Environment Variables Guide](#🔐-environment-variables-guide)
- [API Documentation](#📚-api-documentation)
- [Common Development Tasks](#🛠️-common-development-tasks)
- [Working Features](#✅-working-features)
- [Testing Status](#🧪-testing-status)
- [Logging & Debugging](#🔍-logging--debugging)
- [Git Workflow](#🔗-git-workflow)
- [Troubleshooting](#🔧-troubleshooting)
- [Performance Considerations](#⚡-performance-considerations)
- [Known Issues & Technical Debt](#⚠️-known-issues--technical-debt)
- [Additional Resources](#📖-additional-resources)
- [Roadmap](#🎯-roadmap)

---

## ⚡ Quick Start (5 min)

Get the backend running in 5 minutes:

```bash
# 1. Clone the repository
git clone https://github.com/interparkenterprises/Interpark-property-system-backend.git
cd Interpark-property-system-backend

# 2. Install dependencies
npm install

# 3. Create .env file (copy from .env.example)
cp .env.example .env
# Update DATABASE_URL, JWT_SECRET, EMAIL credentials in .env

# 4. Set up PostgreSQL
createdb interpark_db
psql -U postgres -d interpark_db -c "SELECT version();"

# 5. Run migrations
npx prisma migrate dev --name init

# 6. Start development server + scheduler
npm run dev:all

# 7. Test the API
curl http://localhost:5000/api/health
# Expected: {"message":"Property Management API is running!"}
```

**Server running on:** `http://localhost:5000`  
**API Base URL:** `http://localhost:5000/api`

---

## 🏢 System Overview

**Interpark Property Management System** is a comprehensive backend solution designed for property managers to efficiently manage landlord properties, tenants, payments, and operations.

**Target Users:**
- Property Managers (manage multiple properties)
- Landlords (property owners)
- Administrative Staff
- Finance/Accounting Teams

**Key Characteristics:**
- ✅ **Production-Ready**: Used in live deployments
- ✅ **Scalable**: Handles multiple properties, tenants, and invoices
- ✅ **Automated**: Scheduled reminders, invoice generation, commission calculations
- ✅ **Secure**: JWT authentication, password hashing (bcrypt), RBAC with 90+ permissions
- ✅ **Professional**: PDF invoices with letterhead, audit logging

---

## ✅ What It Accomplishes

### Core Functionalities

1. **Property Management**
   - Register and manage multiple properties
   - Assign managers to properties
   - Track property details (address, type, LR number, usage)
   - Support residential, commercial, and mixed-use properties

2. **Tenant Management**
   - Register and track tenant information
   - Manage lease terms, rent amounts, and payment policies
   - Track tenant financial history
   - Support escalating rent rates (annually/bi-annually)
   - Manage service charges (fixed, percentage, per-sqft)
   - Handle VAT (inclusive/exclusive/not applicable)

3. **Payment & Invoicing**
   - Auto-generate invoices based on payment policies (monthly/quarterly/annual)
   - Track payment reports and payment history
   - Handle partial payments with balance invoicing
   - Generate professional PDF invoices
   - Track arrears and outstanding balances
   - Support multiple rent types (fixed, tiered, graduated, indexed, etc.)

4. **Billing System**
   - Manage utility bills (water, electricity, gas)
   - Generate bill invoices from meter readings
   - Track paid/unpaid bills
   - Automatic calculations with VAT support

5. **Automated Reminders**
   - Daily payment reminders (9 AM & 12 PM Kenya timezone)
   - Weekly payment summaries (Monday 10 AM)
   - Email notifications with urgency levels:
     - 🔴 **URGENT**: 30+ days overdue
     - 🟠 **WARNING**: 15+ days overdue
     - 🟡 **REMINDER**: Current period due
     - 🟢 **UPCOMING**: Due within 7 days

6. **Commission Management**
   - Calculate manager commissions based on collection
   - Generate commission invoices with VAT
   - Track commission payment status
   - Support multiple calculation models

7. **Document Generation**
   - **Invoices**: Pro forma invoices with letterhead
   - **Balance Invoices**: Highlighted outstanding balances
   - **Offer Letters**: Lease offer documents
   - **Demand Letters**: Payment demand documents (auto/batch generation)
   - **Payment Receipts**: Official payment confirmations
   - All PDFs include company branding and contact info

8. **Role-Based Access Control (RBAC)**
   - Three system roles: ADMIN, MANAGER, USER
   - 90+ granular permission codes
   - Custom role creation with flexible permissions
   - Property-level access controls
   - Temporary role assignments with expiry dates
   - Permission caching for performance

9. **Reporting & Analytics**
   - Daily operational reports (security, cleaning, maintenance)
   - Payment reports with payment tracking
   - Property financial summaries
   - Audit logs for all actions
   - User activity tracking

10. **Employee Management**
    - Create and manage employees
    - Record salary payments
    - Track payment status (ACTIVE, ON_LEAVE, TERMINATED)
    - Support multiple payment frequencies (daily, weekly, bi-weekly, monthly)
    - Payment period validation

11. **Leads & Business Development**
    - Manage property leads
    - Track lead source and nature
    - Convert leads to tenants via offer letters

12. **Other Income Tracking**
    - Record additional income (consultancy, property sales, leasing fees)
    - Categorize income types
    - Generate invoices with VAT
    - Track payment status

---

## 🛠️ Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| **Runtime** | Node.js | 16+ |
| **Framework** | Express.js | 5.1.0 |
| **Database** | PostgreSQL | 12+ |
| **ORM** | Prisma | 6.19.0 |
| **Authentication** | JWT (jsonwebtoken) | 9.0.2 |
| **Password Hashing** | bcryptjs | 3.0.2 |
| **Task Scheduler** | node-cron | 4.2.1 |
| **Email Service** | Nodemailer / Resend | 9.0.5 / 6.12.4 |
| **PDF Generation** | PDFKit | 0.17.2 |
| **Server-side Rendering** | Puppeteer | 25.8.0 |
| **File Uploads** | Multer | 2.0.2 |
| **Logging** | Morgan | 1.10.1 |
| **CORS** | cors | 2.8.5 |
| **Caching** | node-cache | 5.1.2 |
| **Environment Config** | dotenv | 17.2.3 |
| **Process Manager** | PM2 (production) | - |
| **Concurrent Tasks** | concurrently | 9.2.1 |
| **Dev Tool** | Nodemon | 3.1.14 |

---

## 🗄️ Database Schema

### High-Level Architecture

```
User (Authentication)
├── CustomRole (RBAC)
├── Property (Owned/Managed)
│   ├── Unit
│   │   └── Tenant
│   │       ├── Invoice
│   │       ├── PaymentReport
│   │       ├── Bill
│   │       └── ServiceCharge
│   ├── Lead
│   ├── OfferLetter
│   ├── ManagerCommission
│   ├── DailyReport
│   └── ActivationRequest
├── Employee (Payroll)
│   └── SalaryPayment
├── OtherIncome (Additional Revenue)
└── ToDo (Task Management)
```

### Key Models (25+)

| Model | Purpose |
|-------|---------|
| **User** | System users with roles (ADMIN, MANAGER, USER) |
| **Property** | Buildings/complexes managed by the system |
| **Unit** | Individual apartments/offices within properties |
| **Tenant** | Occupants of units with lease agreements |
| **Invoice** | Rent invoices for tenants |
| **PaymentReport** | Records of payments received |
| **Bill** | Utility bills (water, electricity, gas) |
| **ManagerCommission** | Commission calculations for managers |
| **Employee** | Staff members and their salary info |
| **OtherIncome** | Non-rent income (consultancy, sales, etc.) |
| **CustomRole** | User-defined roles with permissions |
| **Permission** | Granular access controls (90+ codes) |
| **RBACAuditLog** | Audit trail for RBAC actions |
| **DailyReport** | Operational reports (security, cleaning) |
| **ActivationRequest** | Event/activation license requests |
| **Lead** | Property inquiry leads |
| **OfferLetter** | Lease offer documents |
| **DemandLetter** | Payment demand notices |

### Key Relationships

```
User → CustomRole → Permission
User → Property → Unit → Tenant → Invoice → PaymentReport
User → Employee → SalaryPayment
Property → ManagerCommission (tracks manager earnings)
Tenant → ServiceCharge (additional charges)
Tenant → Bill → BillInvoice
Landlord → Property → OfferLetter → Lead
```

---

## 📁 Project Structure

```
Interpark-property-system-backend/
│
├── 📄 server.js                    # Entry point - starts Express server
├── 📄 ecosystem.config.cjs         # PM2 config for running server + scheduler
├── 📄 package.json                 # Dependencies and npm scripts
├── 📄 .env.example                 # Environment variables template
├── 📄 .gitignore                   # Git ignore rules
│
├── 📦 prisma/
│   ├── schema.prisma               # Database schema (25+ models)
│   └── migrations/                 # Database migrations (version control)
│
├── 📦 src/
│   │
│   ├── 📄 app.js                   # Express app setup, middleware, routes mounting
│   │
│   ├── 📂 controllers/             # Request handlers (one per domain)
│   │   ├── auth.controller.js      # Authentication (register, login, reset)
│   │   ├── property.controller.js  # Property CRUD
│   │   ├── unit.controller.js      # Unit management
│   │   ├── tenant.controller.js    # Tenant CRUD
│   │   ├── invoice.controller.js   # Invoice generation & retrieval
│   │   ├── bill.controller.js      # Utility bill management
│   │   ├── paymentReport.controller.js  # Payment recording
│   │   ├── commissionController.js # Commission calculations
│   │   ├── demandLetter.controller.js   # Demand letter generation
│   │   ├── offerLetter.controller.js    # Offer letter generation
│   │   ├── dailyReport.controller.js    # Daily operational reports
│   │   ├── rbac.controller.js      # Role & permission management
│   │   ├── employee.controller.js  # Employee management
│   │   ├── lead.controller.js      # Lead tracking
│   │   ├── activation.controller.js # Activation requests
│   │   ├── todo.controller.js      # Task management
│   │   └── [more controllers...]
│   │
│   ├── 📂 services/                # Business logic & calculations
│   │   ├── permissionService.js    # RBAC permission checking (cached)
│   │   ├── employee.service.js     # Employee management & reminders
│   │   ├── paymentScheduling.js    # Payment scheduling logic
│   │   ├── rentCalculation.js      # Rent escalation & VAT calculations
│   │   ├── commissionService.js    # Commission calculations
│   │   └── cacheService.js         # In-memory caching strategy
│   │
│   ├── 📂 routes/                  # API endpoint routing
│   │   ├── auth.routes.js
│   │   ├── property.routes.js
│   │   ├── tenant.routes.js
│   │   ├── invoice.routes.js
│   │   ├── paymentReport.routes.js
│   │   ├── rbac.routes.js
│   │   ├── commission.routes.js
│   │   ├── employee.routes.js
│   │   └── [more route files...]
│   │
│   ├── 📂 middleware/              # Request processing
│   │   ├── auth.middleware.js      # JWT verification
│   │   ├── errorHandler.js         # Global error handling
│   │   └── [validation middleware]
│   │
│   ├── 📂 jobs/                    # Scheduled tasks
│   │   └── reminderJob.js          # Cron scheduler for payment reminders (runs separately)
│   │
│   ├── 📂 lib/                     # Utilities & configurations
│   │   └── prisma.js               # Prisma client singleton
│   │
│   ├── 📂 utils/                   # Helper functions
│   │   ├── storage.js              # File upload/storage handling
│   │   ├── invoiceHelpers.js       # Invoice number generation
│   │   └── [validation helpers]
│   │
│   ├── 📂 template/                # Email/document templates
│   │   └── [HTML email templates]
│   │
│   └── 📂 letterHeads/             # Branded assets
│       └── letterhead.png          # Company letterhead for PDFs
│
└── 📦 uploads/                     # Generated files storage
    ├── invoices/
    ├── receipts/
    ├── demand-letters/
    └── [other generated docs]
```

### File Responsibilities

| Folder | Responsibility |
|--------|----------------|
| **controllers/** | Handle HTTP requests, validate input, call services, return responses |
| **services/** | Business logic, database queries, calculations, email sending |
| **routes/** | Define API endpoints and map to controllers |
| **middleware/** | Authentication, error handling, request logging |
| **jobs/** | Scheduled background tasks (reminders, reports) |
| **lib/** | Database connections, singleton patterns |
| **utils/** | Reusable helper functions across the app |
| **prisma/** | Database schema and migrations (version controlled) |

---

## 🚀 Setup & Installation

### Prerequisites

- **Node.js** 16.x or higher (check with `node --version`)
- **PostgreSQL** 12.x or higher (check with `psql --version`)
- **npm** or **yarn** package manager
- **Git** for version control

### Step 1: Clone the Repository

```bash
git clone https://github.com/interparkenterprises/Interpark-property-system-backend.git
cd Interpark-property-system-backend
```

### Step 2: Install Dependencies

```bash
npm install
```

This installs all packages listed in `package.json`.

### Step 3: Configure Environment Variables

Create a `.env` file in the root directory. Copy from `.env.example` and update:

```bash
cp .env.example .env
# Then edit .env with your configuration
```

### Step 4: Set Up PostgreSQL Database

```bash
# Create database
createdb interpark_db

# Verify connection
psql -U postgres -d interpark_db -c "SELECT version();"
```

Update `DATABASE_URL` in `.env` with correct credentials.

### Step 5: Run Prisma Migrations

```bash
# Create tables and schema
npx prisma migrate dev --name init

# View database in Prisma Studio (optional, great for exploration)
npx prisma studio
```

### Step 6: Seed Initial Data (Optional)

```bash
# Create test data if seed script exists
npm run seed
```

---

## 🔐 Environment Variables Guide

### Essential Variables

```bash
# Database Connection
DATABASE_URL="postgresql://username:password@localhost:5432/interpark_db"

# Server Configuration
PORT=5000
NODE_ENV=development

# JWT Authentication
JWT_SECRET="your-super-secret-jwt-key-change-this"
JWT_EXPIRE=7d
```

### Email Configuration (Choose One)

**Option A: Gmail (with App Passwords)**
```bash
EMAIL_USER="your-email@gmail.com"
EMAIL_PASS="your-app-password"  # Use Google App Passwords, NOT regular password
EMAIL_FROM="noreply@interparkenterprises.co.ke"
```

**Option B: Resend Email Service**
```bash
RESEND_API_KEY="your-resend-api-key"
```

### Additional Configuration

```bash
# Frontend URL (for email links)
FRONTEND_URL="http://localhost:3000"

# File Storage
UPLOAD_DIR="./uploads"
MAX_FILE_SIZE=10485760  # 10MB in bytes

# Optional: Third-party services
STRIPE_KEY="your-stripe-key"

# Timezone (for scheduled tasks)
TZ="Africa/Nairobi"
```

### Security Best Practices

- ⚠️ **Change `JWT_SECRET`** to a strong random string in production
- ⚠️ **Use [Google App Passwords](https://myaccount.google.com/apppasswords)** for Gmail (not regular password)
- ⚠️ **Never commit `.env`** to version control (already in .gitignore)
- ⚠️ **Use strong database passwords** in production
- ⚠️ **Rotate secrets regularly** in production environments

---

## ▶️ Running the System

### Development Mode (Local Development)

#### Option A: Run Server Only
```bash
npm run dev
```
- Starts Express server with nodemon auto-reload
- Server runs on `http://localhost:5000`
- Watch for file changes and restart automatically

#### Option B: Run Scheduler Only
```bash
npm run scheduler:dev
```
- Starts payment reminder scheduler
- Runs cron jobs at scheduled times (9 AM, 12 PM, Mon 10 AM Kenya time)
- Watch for file changes

#### Option C: Run Both Concurrently ⭐ **RECOMMENDED**
```bash
npm run dev:all
```
- Runs server + scheduler together
- Both reload on file changes
- Perfect for full-stack development

**Test API is running:**
```bash
curl http://localhost:5000/api/health
# Expected: {"message":"Property Management API is running!"}
```

### Production Mode

#### Option A: Using Node directly
```bash
npm run start              # Starts server
npm run scheduler          # In separate terminal
npm run start:all          # Both together
```

#### Option B: Using PM2 (Recommended for Production)

```bash
# Install PM2 globally
npm install -g pm2

# Start with PM2 config
pm2 start ecosystem.config.cjs

# View running processes
pm2 list

# View logs in real-time
pm2 logs

# Monitor CPU/memory usage
pm2 monit

# Stop all processes
pm2 stop all

# Restart on system reboot
pm2 startup
pm2 save
```

---

## 📚 API Documentation

### Base URL
```
http://localhost:5000/api
```

### Authentication
All endpoints (except `/api/auth/login` and `/api/auth/register`) require JWT token in header:
```
Authorization: Bearer {jwt_token}
```

### API Endpoints by Domain

#### Authentication
- `POST /auth/register` - Create new user account
- `POST /auth/login` - Login and get JWT token
- `POST /auth/reset-password` - Request password reset
- `PATCH /auth/update-password` - Update password

#### Properties
- `GET /properties` - List all properties (with filters)
- `POST /properties` - Create new property
- `GET /properties/:id` - Get property details
- `PATCH /properties/:id` - Update property
- `DELETE /properties/:id` - Delete property

#### Tenants
- `GET /tenants` - List all tenants
- `POST /tenants` - Create new tenant
- `GET /tenants/:id` - Get tenant details
- `PATCH /tenants/:id` - Update tenant info
- `DELETE /tenants/:id` - Delete tenant

#### Invoices
- `POST /invoices/generate` - Generate invoice for tenant
- `GET /invoices` - List all invoices (with filters)
- `GET /invoices/:id` - Get invoice details
- `GET /invoices/:id/download` - Download invoice PDF
- `PATCH /invoices/:id/status` - Update invoice status
- `DELETE /invoices/:id` - Delete invoice

#### Payment Reports
- `POST /payments` - Record tenant payment
- `GET /payments` - List payment reports
- `GET /payments/:id` - Get payment details
- `PATCH /payments/:id` - Update payment

#### Bills
- `GET /bills` - List utility bills
- `POST /bills` - Create new bill
- `GET /bills/:id` - Get bill details
- `PATCH /bills/:id` - Update bill
- `DELETE /bills/:id` - Delete bill

#### Commission
- `GET /commissions` - List manager commissions
- `POST /commissions/generate` - Generate commission invoices
- `GET /commissions/:id/download` - Download commission invoice

#### Reports
- `GET /daily-reports` - List daily operation reports
- `POST /daily-reports` - Create new daily report
- `GET /daily-reports/:id` - Get report details

#### RBAC (Roles & Permissions)
- `GET /rbac/roles` - List custom roles
- `POST /rbac/roles` - Create custom role
- `POST /rbac/assign-role` - Assign role to user
- `GET /rbac/permissions` - List all permissions
- `GET /rbac/audit-logs` - View audit trail

#### Employees
- `GET /employees` - List employees
- `POST /employees` - Create employee
- `POST /employees/:id/salary` - Record salary payment
- `GET /employees/:id/history` - Payment history

**For complete API specification**, check the routes in `src/routes/` or use Postman/Swagger if available.

---

## 🛠️ Common Development Tasks

### Adding a New API Endpoint

1. **Create Controller** (`src/controllers/feature.controller.js`):
```javascript
export const createFeature = async (req, res) => {
  try {
    const { name, description } = req.body;
    const feature = await prisma.feature.create({
      data: { name, description }
    });
    res.status(201).json(feature);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
```

2. **Create Routes** (`src/routes/feature.routes.js`):
```javascript
import express from 'express';
import { createFeature, getFeatures } from '../controllers/feature.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();

router.post('/', protect, createFeature);
router.get('/', protect, getFeatures);

export default router;
```

3. **Mount Routes** in `src/app.js`:
```javascript
import featureRoutes from './routes/feature.routes.js';
app.use('/api/features', featureRoutes);
```

### Adding a New Database Model

1. **Update Schema** in `prisma/schema.prisma`:
```prisma
model Feature {
  id          String   @id @default(uuid())
  name        String
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@index([name])
}
```

2. **Create Migration**:
```bash
npx prisma migrate dev --name add_feature_model
```

3. **Use in Code**:
```javascript
const feature = await prisma.feature.create({
  data: { name: "Test", description: "Test feature" }
});
```

### Adding a New Permission

1. **Add to Database** (via seed or migration):
```javascript
await prisma.permission.create({
  data: {
    code: "FEATURE_READ",
    name: "Read Features",
    category: "FEATURE",
    scope: "GLOBAL"
  }
});
```

2. **Use in Middleware**:
```javascript
import { checkPermission } from '../services/permissionService.js';

router.get('/features', protect, async (req, res) => {
  const hasPermission = await checkPermission(req.user.id, 'FEATURE_READ');
  if (!hasPermission) return res.status(403).json({ error: 'Forbidden' });
  // Handle request
});
```

### Creating a New Scheduled Task

1. **Create Job File** (`src/jobs/myJob.js`):
```javascript
import cron from 'node-cron';
import { prisma } from '../lib/prisma.js';

export const startMyJob = () => {
  // Run every day at 9 AM Kenya time
  cron.schedule('0 9 * * *', async () => {
    try {
      console.log('Running my job...');
      // Do work here
    } catch (error) {
      console.error('Job failed:', error);
    }
  });
};
```

2. **Register in Scheduler** (`src/jobs/reminderJob.js`):
```javascript
import { startMyJob } from './myJob.js';

startMyJob();
```

### Generating PDF Documents

```javascript
import PDFDocument from 'pdfkit';
import fs from 'fs';

export const generateInvoicePDF = async (invoiceData, filename) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const stream = fs.createWriteStream(filename);
    
    doc.pipe(stream);
    doc.fontSize(20).text('INVOICE', 100, 100);
    doc.fontSize(12).text(`Invoice #: ${invoiceData.number}`);
    // Add more content...
    doc.end();
    
    stream.on('finish', () => resolve(filename));
    stream.on('error', reject);
  });
};
```

---

## ✅ Working Features (Tested & Verified)

### ✅ Core Features
- [x] User authentication with JWT
- [x] Property management (CRUD operations)
- [x] Tenant registration and tracking
- [x] Unit management within properties
- [x] Lease term and rent amount tracking

### ✅ Payment System
- [x] Invoice generation with multiple payment policies (monthly/quarterly/annual)
- [x] Automatic rent escalation (annually, bi-annually)
- [x] Service charge calculations (fixed, percentage, per-sqft)
- [x] VAT handling (inclusive, exclusive, not applicable)
- [x] Partial payment tracking with balance invoicing
- [x] Payment report recording and history

### ✅ Document Generation
- [x] Professional PDF invoice generation with letterhead
- [x] Balance invoice generation for outstanding amounts
- [x] Invoice numbering (auto-incremented)
- [x] PDF storage and retrieval
- [x] File cleanup on invoice deletion

### ✅ Billing System
- [x] Utility bill creation (water, electricity, gas)
- [x] Meter reading tracking
- [x] Bill invoice generation
- [x] Payment status tracking (paid/unpaid)
- [x] VAT calculations on bills

### ✅ RBAC System
- [x] Three system roles (ADMIN, MANAGER, USER)
- [x] 90+ permission codes defined
- [x] Custom role creation
- [x] Permission assignment to roles
- [x] User-to-role assignments
- [x] Property-level access controls
- [x] Expiring role assignments
- [x] Permission caching for performance
- [x] Audit logging of all RBAC actions

### ✅ Scheduler & Reminders
- [x] Cron job for payment reminders
- [x] Daily checks at 9 AM & 12 PM (Kenya timezone)
- [x] Weekly summary on Monday 10 AM
- [x] Email notifications with urgency levels
- [x] Separate scheduler process (can run independently)
- [x] Graceful shutdown handling

### ✅ Commission Management
- [x] Manager commission calculation
- [x] Commission invoice generation
- [x] Commission status tracking
- [x] Commission reports with VAT

### ✅ Reporting
- [x] Daily operational reports
- [x] Payment reports with summaries
- [x] Audit logs for all system actions
- [x] Report filtering and pagination

### ✅ Employee Management
- [x] Employee creation and management
- [x] Salary payment recording
- [x] Payment frequency support
- [x] Automatic status updates
- [x] Payment period validation

### ⚠️ Partial/In-Development
- [ ] Demand letter batch generation (single generation works ✅)
- [ ] Offer letter PDF refinement
- [ ] Complete test coverage
- [ ] API rate limiting
- [ ] Advanced analytics dashboard endpoints

### ❌ Not Yet Implemented
- [ ] Multi-currency support
- [ ] Bank integration for automatic payments
- [ ] Mobile app (separate frontend project)
- [ ] Advanced financial reporting
- [ ] Integration with M-Pesa/payment gateways

---

## 🧪 Testing Status

### Current Testing State
- ✅ Manual API testing via Postman/cURL completed
- ✅ Core business logic validated in production
- ✅ Payment calculations verified
- ⚠️ Unit tests NOT YET written
- ⚠️ Integration tests NOT YET written

### How to Test (Manual)

1. **Register User:**
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Manager",
    "email": "manager@test.com",
    "password": "Test@123",
    "role": "MANAGER"
  }'
```

2. **Login:**
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "manager@test.com",
    "password": "Test@123"
  }'
# Returns: {token: "jwt_token..."}
```

3. **Create Property:**
```bash
curl -X POST http://localhost:5000/api/properties \
  -H "Authorization: Bearer {jwt_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Westlands Apartment",
    "address": "123 Main Street, Nairobi",
    "form": "APARTMENT",
    "usage": "RESIDENTIAL"
  }'
```

### Recommended Test Coverage Areas
- [ ] Authentication flow (register, login, password reset)
- [ ] RBAC permission enforcement
- [ ] Invoice generation calculations
- [ ] Payment scheduling
- [ ] Email reminder sending
- [ ] PDF generation and storage
- [ ] Error handling edge cases
- [ ] Concurrent request handling

---

## 🔍 Logging & Debugging

### Enable Debug Logging

```bash
# Run with debug output
DEBUG=* npm run dev

# Or for specific module
DEBUG=express:* npm run dev
```

### View Logs

**Development:**
```bash
# Console output (with Morgan logging)
npm run dev 2>&1 | tail -100
```

**Production (PM2):**
```bash
# View all logs
pm2 logs

# View specific app logs
pm2 logs property-management-backend

# View last 100 lines
pm2 logs property-management-backend --lines 100

# Follow logs in real-time
pm2 logs --follow
```

### Database Query Logging

Enable Prisma query logs:
```bash
# In .env
DATABASE_LOG=["query", "info", "warn", "error"]
```

### Common Log Locations

| What | Location |
|------|----------|
| Express/API logs | Console / PM2 logs |
| Scheduler logs | Console / `src/jobs/reminderJob.js` output |
| Database errors | Console with DATABASE_LOG enabled |
| Generated PDFs | `uploads/invoices/`, `uploads/receipts/`, etc. |

---

## 🔗 Git Workflow

### Branch Naming Convention

```
feature/description       # New features
bugfix/description        # Bug fixes
hotfix/description        # Production hotfixes
refactor/description      # Code refactoring
docs/description          # Documentation updates
```

### Example Workflow

1. **Create Feature Branch:**
```bash
git checkout -b feature/add-invoice-export
```

2. **Make Changes & Commit:**
```bash
git add .
git commit -m "feat: add invoice PDF export functionality

- Implement PDF generation using PDFKit
- Add invoice download endpoint
- Include company letterhead
- Closes #123"
```

**Commit Message Format:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `refactor:` - Code refactoring
- `test:` - Test changes
- `chore:` - Build/dependency changes

3. **Push & Create Pull Request:**
```bash
git push origin feature/add-invoice-export
# Create PR on GitHub
```

4. **Pull Request Checklist:**
- [ ] Tests written/updated
- [ ] README updated if needed
- [ ] No console.log statements left
- [ ] Code follows project conventions
- [ ] Breaking changes documented

5. **After Approval, Merge:**
```bash
git checkout main
git pull origin main
git merge feature/add-invoice-export
git push origin main
```

### Code Style Guidelines

- Use **camelCase** for variables/functions
- Use **PascalCase** for classes/models
- Add **comments for complex logic**
- Handle **errors gracefully**
- **Test before committing**
- Keep **functions small and focused**

---

## 🔧 Troubleshooting

### Common Issues & Solutions

#### 1. **PostgreSQL Connection Error**
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```
**Solution:**
```bash
# Check if PostgreSQL is running
sudo systemctl status postgresql

# Start PostgreSQL if not running
sudo systemctl start postgresql

# Verify DATABASE_URL in .env is correct
echo $DATABASE_URL

# Test connection
psql -U postgres -d interpark_db -c "SELECT version();"
```

#### 2. **JWT Token Invalid/Expired**
```
Error: Unauthorized - Invalid token
```
**Solution:**
```bash
# Get new token by logging in again
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@test.com", "password": "password"}'

# Use new token in Authorization header
```

#### 3. **Email Reminders Not Sending**
```
Error: No transporter configured
```
**Solution:**
```bash
# Check .env variables
EMAIL_USER="your-email@gmail.com"
EMAIL_PASS="app-password"  # NOT regular password

# Use Google App Passwords:
# https://myaccount.google.com/apppasswords
# Select "Mail" and "Windows Computer"
# Use generated 16-character password

# Test email service:
npm run scheduler:dev  # Check logs for send confirmation
```

#### 4. **Prisma Migration Issues**
```
Error: Migration failed
```
**Solution:**
```bash
# Reset database (DEV ONLY - deletes all data)
npx prisma migrate reset

# Or manually rollback:
npx prisma migrate resolve --rolled-back migration_name

# Then re-run migrations:
npx prisma migrate dev
```

#### 5. **File Upload Errors**
```
Error: ENOENT: no such file or directory, open 'uploads/...'
```
**Solution:**
```bash
# Create uploads directory
mkdir -p uploads/invoices uploads/receipts uploads/letters

# Check permissions
chmod -R 755 uploads/
```

#### 6. **Port Already in Use**
```
Error: listen EADDRINUSE: address already in use :::5000
```
**Solution:**
```bash
# Find process using port 5000
lsof -i :5000

# Kill the process
kill -9 <PID>

# Or use different port
PORT=5001 npm run dev
```

#### 7. **Scheduler Not Running Payment Reminders**
**Check:**
- [ ] Is scheduler running? `npm run scheduler:dev`
- [ ] Is email configured in .env?
- [ ] Are there active employees with pending payments?
- [ ] Check current time vs cron schedule (9 AM, 12 PM, Mon 10 AM Kenya time)
- [ ] Check logs: `npm run scheduler:dev 2>&1 | tail -50`

#### 8. **Invoice PDF Not Generating**
```
Error: Letterhead image not found
```
**Solution:**
```bash
# Ensure letterhead exists
ls -la src/letterHeads/letterhead.png

# If missing, upload/create letterhead image
# System will still work with text header as fallback
```

#### 9. **Prisma Client Generation Issues**
```
Error: Cannot find module '@prisma/client'
```
**Solution:**
```bash
# Regenerate Prisma client
npx prisma generate

# Or reinstall
npm install @prisma/client
```

---

## ⚡ Performance Considerations

### Permission Caching Strategy

The system uses **node-cache** for permission caching to avoid repeated database lookups:

```javascript
// Permissions are cached with 5-minute TTL
const hasPermission = await checkPermission(userId, 'PERMISSION_CODE');
// Subsequent calls within 5 minutes use cache
```

**Cache Invalidation:** Automatically expires after 5 minutes or manually clear with:
```javascript
cacheService.clear();
```

### Invoice Generation Performance

**Batch Generation Tips:**
- Use pagination when querying invoices: `skip`, `take` parameters
- Generate PDFs asynchronously (don't block requests)
- Consider queue system for large batch operations

### Database Query Optimization

**Best Practices:**
```javascript
// ✅ Good: Select only needed fields
const invoice = await prisma.invoice.findUnique({
  where: { id },
  select: { id: true, number: true, amount: true }
});

// ❌ Avoid: Loading unnecessary relations
const invoice = await prisma.invoice.findUnique({
  where: { id },
  include: { tenant: true, paymentReport: true, /* ... */ }
});
```

### Connection Pooling

PostgreSQL connection pooling is handled by Prisma:
```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Connection pool settings are managed automatically.

---

## ⚠️ Known Issues & Technical Debt

### Outstanding Issues

1. **Batch Demand Letter Generation**
   - Single generation works ✅
   - Batch/bulk generation needs optimization
   - Consider async queue system

2. **Offer Letter PDF Refinement**
   - Current implementation works but styling could be improved
   - No template engine currently in use

3. **Test Coverage**
   - No unit tests yet
   - Manual testing is currently primary method
   - Need Jest/Mocha setup

4. **API Rate Limiting**
   - Currently no rate limiting
   - Should add for production security

5. **Error Handling**
   - Some endpoints lack detailed error messages
   - Consider structured error response format

### Technical Debt

- [ ] Add TypeScript for better type safety
- [ ] Implement comprehensive error handling middleware
- [ ] Add API documentation (Swagger/OpenAPI)
- [ ] Setup automated testing (Jest)
- [ ] Add input validation schemas (Zod/Yup)
- [ ] Implement request/response logging
- [ ] Add database connection pooling configuration
- [ ] Setup CI/CD pipeline

---

## 📖 Additional Resources

### Useful Commands for Developers

```bash
# View database in UI
npx prisma studio

# Generate Prisma client after schema changes
npx prisma generate

# Check database connection
npx prisma db execute --stdin < query.sql

# View migration history
npx prisma migrate status

# Format code
npm run lint

# Build production bundle
npm run build

# View dependency tree
npm list

# Check for outdated packages
npm outdated
```

### Documentation & Links

- [Express.js Docs](https://expressjs.com/)
- [Prisma ORM Docs](https://www.prisma.io/docs/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [JWT.io](https://jwt.io/)
- [Node Cron Docs](https://github.com/kelektiv/node-cron)
- [PDFKit Documentation](http://pdfkit.org/)

### File Locations to Know

| What | Location |
|------|----------|
| Database Schema | `prisma/schema.prisma` |
| API Routes | `src/routes/*.routes.js` |
| Business Logic | `src/services/` |
| Controllers | `src/controllers/` |
| Scheduled Jobs | `src/jobs/reminderJob.js` |
| Env Variables | `.env` |
| Generated Files | `uploads/` |
| Logs | `console` or PM2 logs |

### Next Steps for New Developers

1. ✅ Clone & install dependencies
2. ✅ Configure `.env` file
3. ✅ Set up PostgreSQL database
4. ✅ Run migrations (`npx prisma migrate dev`)
5. ✅ Start dev server (`npm run dev:all`)
6. ✅ Test API endpoints with Postman
7. ✅ Review `prisma/schema.prisma` to understand data model
8. ✅ Explore `src/controllers/` to see request handling patterns
9. ✅ Read through `src/services/` to understand business logic
10. ✅ Check `src/routes/` to understand API structure

---

## 🤝 Contributing

### Before Making Changes

1. Create a new branch: `git checkout -b feature/description`
2. Make your changes
3. Test thoroughly
4. Commit with clear messages
5. Push to branch: `git push origin feature/description`
6. Create Pull Request with description

### Code Standards

- Use consistent naming conventions (camelCase for functions/variables)
- Add comments for complex logic
- Handle errors gracefully
- Log important actions
- Test before committing
- Update this README if adding major features

---

## 📝 License

ISC License - See LICENSE file for details

---

## 🆘 Support & Questions

For issues or questions:
1. Check [Troubleshooting](#🔧-troubleshooting) section
2. Review existing GitHub issues
3. Create new issue with detailed description
4. Contact development team

---

## 🎯 Roadmap

### v1.1.0 (Upcoming)
- [ ] Unit testing framework setup
- [ ] Automated API tests
- [ ] Advanced analytics endpoints
- [ ] WhatsApp notification integration
- [ ] API documentation (Swagger)

### v1.2.0
- [ ] Mobile app backend enhancements
- [ ] Multi-currency support
- [ ] Bank statement reconciliation
- [ ] Webhook integration for payment events

### v2.0.0
- [ ] Microservices architecture
- [ ] GraphQL API alternative
- [ ] Real-time WebSocket updates
- [ ] AI-powered payment forecasting
- [ ] Advanced analytics dashboard

---

**Last Updated:** August 25, 2026  
**Maintained By:** Interpark Enterprises Limited  
**Repository:** https://github.com/interparkenterprises/Interpark-property-system-backend

---

## 📞 Contact & Support

**Development Team:** [Contact information here]  
**Email:** dev@interparkenterprises.co.ke  
**Issues & Bugs:** Use GitHub Issues tracker  
