import express from 'express';
import cors from 'cors';
import errorHandler from './middleware/errorHandler.js';
import path from 'path';
import { fileURLToPath } from 'url';

// Route imports
import authRoutes from './routes/auth.routes.js';
import landlordRoutes from './routes/landlord.routes.js';
import propertyRoutes from './routes/property.routes.js';
import unitRoutes from './routes/unit.routes.js';
import tenantRoutes from './routes/tenant.routes.js';
import paymentRoutes from './routes/paymentReport.routes.js';
import serviceProviderRoutes from './routes/serviceProvider.routes.js';
import leadRoutes from './routes/lead.routes.js';
import todoRoutes from './routes/todo.routes.js';
import newsRoutes from './routes/news.routes.js';
import commissionRoutes from './routes/commission.routes.js';
import incomeRoutes from './routes/income.routes.js';
import invoiceRoutes from './routes/invoice.routes.js';
import billRoutes from './routes/bill.routes.js';
import offerLetterRoutes from './routes/offerLetter.routes.js';
import billInvoiceRoutes from './routes/billInvoice.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware
app.use(cors({
  origin: [
    "https://interpark-property-system-frontend-chi.vercel.app",
    "https://interparkpropertysystem.co.ke",
    "http://localhost:3000"
  ],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));


// Routes
app.use('/api/auth', authRoutes);
app.use('/api/landlords', landlordRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/units', unitRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/service-providers', serviceProviderRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/todos', todoRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/commissions', commissionRoutes);
app.use('/api/income', incomeRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/offer-letters', offerLetterRoutes)
app.use('/api/bill-invoices', billInvoiceRoutes);


// Basic route for health check
app.get('/api/health', (req, res) => {
  res.json({ message: 'Property Management API is running!' });
});

// Error handler middleware
app.use(errorHandler);

// Handle undefined routes
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

export default app;