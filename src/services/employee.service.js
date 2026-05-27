import prisma from '../lib/prisma.js';
import nodemailer from 'nodemailer';

class EmployeeService {
  constructor() {
    // Configure email transporter for reminders
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        }
      });
    }
  }

  // Helper: Get a valid system user ID for audit logs
  async getSystemUserId() {
    // Try to find an ADMIN user first
    const adminUser = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
      select: { id: true }
    });
    
    if (adminUser) {
      return adminUser.id;
    }
    
    // If no ADMIN, try to find any user
    const anyUser = await prisma.user.findFirst({
      select: { id: true }
    });
    
    if (anyUser) {
      return anyUser.id;
    }
    
    return null;
  }

  // Create audit log asynchronously (non-blocking)
  async createAuditLog(action, targetUserId, changes, performedById = null) {
    try {
      let systemUserId = performedById;
      
      if (!systemUserId) {
        systemUserId = await this.getSystemUserId();
      }
      
      if (!systemUserId) {
        console.warn('No valid user found for audit log');
        return null;
      }

      // Use a separate connection for audit logs
      await prisma.rBACAuditLog.create({
        data: {
          action,
          performedBy: systemUserId,
          targetUser: targetUserId,
          changes
        }
      });
    } catch (error) {
      console.error('Failed to create audit log:', error);
      return null;
    }
  }

  // Create employee (only ADMIN/MANAGER)
  async createEmployee(data) {
    const { createdById, ...employeeData } = data;
    
    // Check if user has ADMIN or MANAGER role
    const creator = await prisma.user.findUnique({
      where: { id: createdById },
      select: { role: true, name: true }
    });

    if (!creator) {
      throw new Error('User not found');
    }

    if (creator.role !== 'ADMIN' && creator.role !== 'MANAGER') {
      throw new Error('Only ADMIN or MANAGER can create employees');
    }

    // Create employee
    return prisma.employee.create({
      data: {
        ...employeeData,
        createdBy: { connect: { id: createdById } }
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true }
        }
      }
    });
  }

  // Get all employees (ADMIN sees all, MANAGER sees only their employees)
  async getEmployees(userId, userRole, filters = {}) {
    const { status, jobTitle, page = 1, limit = 10 } = filters;
    const skip = (page - 1) * limit;

    let where = {};
    
    // Apply filters
    if (status) where.status = status;
    if (jobTitle) where.jobTitle = { contains: jobTitle, mode: 'insensitive' };
    
    // MANAGER sees only employees they created
    if (userRole === 'MANAGER') {
      where.createdById = userId;
    }
    // ADMIN sees all employees (no additional filter)

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          createdBy: {
            select: { id: true, name: true, email: true, role: true }
          },
          salaryPayments: {
            orderBy: { paymentDate: 'desc' },
            take: 5
          }
        }
      }),
      prisma.employee.count({ where })
    ]);

    // Get payment status for each employee
    const currentPeriod = this.getCurrentPaymentPeriod();
    const employeesWithStatus = await Promise.all(
      employees.map(async (employee) => {
        const lastPayment = await prisma.salaryPayment.findFirst({
          where: {
            employeeId: employee.id,
            paymentPeriod: currentPeriod
          }
        });

        return {
          ...employee,
          currentPaymentStatus: lastPayment ? 'PAID' : 'PENDING',
          currentPaymentPeriod: currentPeriod
        };
      })
    );

    return {
      employees: employeesWithStatus,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit))
    };
  }

  // Get employees due for payment (for reminders)
  async getEmployeesDueForPayment(userId, userRole) {
    const currentPeriod = this.getCurrentPaymentPeriod();
    
    let where = {
      status: 'ACTIVE',
      salaryPayments: {
        none: {
          paymentPeriod: currentPeriod
        }
      }
    };
    
    // MANAGER sees only their employees
    if (userRole === 'MANAGER') {
      where.createdById = userId;
    }

    const employees = await prisma.employee.findMany({
      where,
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true }
        },
        salaryPayments: {
          orderBy: { paymentDate: 'desc' },
          take: 1
        }
      }
    });

    return employees;
  }

  // Get upcoming payments with due dates
  async getUpcomingPayments(userId, userRole) {
    let where = { status: 'ACTIVE' };
    
    if (userRole === 'MANAGER') {
      where.createdById = userId;
    }

    const employees = await prisma.employee.findMany({
      where,
      include: {
        salaryPayments: {
          orderBy: { paymentDate: 'desc' },
          take: 1
        }
      }
    });

    const today = new Date();
    const upcoming = employees.map(employee => {
      const nextPaymentDate = this.calculateNextPaymentDate(employee.paymentFrequency);
      const daysUntilPayment = Math.ceil((nextPaymentDate - today) / (1000 * 60 * 60 * 24));
      const currentPeriod = this.getCurrentPaymentPeriod();
      
      // Check if already paid for current period
      const isPaid = employee.salaryPayments.some(
        payment => payment.paymentPeriod === currentPeriod
      );

      return {
        employee,
        nextPaymentDate,
        daysUntilPayment,
        isPaid,
        paymentPeriod: currentPeriod,
        needsPayment: !isPaid && daysUntilPayment <= 7 && daysUntilPayment >= 0
      };
    });

    // Filter to only show upcoming payments (within next 30 days)
    return upcoming.filter(item => item.daysUntilPayment <= 30 && !item.isPaid);
  }

  // Record salary payment with automatic status update
  async recordSalaryPayment(data, recordedById, userRole) {
    let { employeeId, amount, paymentPeriod, paymentMethod, transactionRef, notes } = data;

    // Verify user has permission
    if (userRole !== 'ADMIN' && userRole !== 'MANAGER') {
      throw new Error('Only ADMIN or MANAGER can record salary payments');
    }

    let payment;
    let employee;

    // Start transaction - only critical operations
    await prisma.$transaction(async (tx) => {
      // Get employee details first
      employee = await tx.employee.findUnique({
        where: { id: employeeId },
        include: { createdBy: true }
      });

      if (!employee) {
        throw new Error('Employee not found');
      }

      // Verify MANAGER can only pay their own employees
      if (userRole === 'MANAGER' && employee.createdById !== recordedById) {
        throw new Error('You can only record payments for employees you created');
      }

      // Auto-generate payment period if not provided
      if (!paymentPeriod) {
        paymentPeriod = this.generatePaymentPeriod(employee.paymentFrequency);
      }

      // Validate payment period format
      if (!this.validatePaymentPeriod(paymentPeriod, employee.paymentFrequency)) {
        throw new Error(`Invalid payment period format for ${employee.paymentFrequency} frequency. Expected format: ${this.getPaymentPeriodFormatHint(employee.paymentFrequency)}`);
      }

      // Check if payment already exists
      const existingPayment = await tx.salaryPayment.findUnique({
        where: {
          employeeId_paymentPeriod: {
            employeeId,
            paymentPeriod
          }
        }
      });

      if (existingPayment) {
        throw new Error('Payment already recorded for this period');
      }

      // Verify amount (with warning if different)
      if (amount !== employee.salaryAmount) {
        console.warn(`Payment amount ${amount} differs from salary ${employee.salaryAmount}`);
      }

      // Create payment record
      payment = await tx.salaryPayment.create({
        data: {
          employeeId,
          amount,
          paymentPeriod,
          paymentMethod,
          transactionRef,
          notes,
          recordedById,
          status: 'PAID'
        },
        include: {
          employee: true,
          recordedBy: {
            select: { id: true, name: true, email: true, role: true }
          }
        }
      });
    }, {
      timeout: 10000,
      maxWait: 10000
    });

    // Create audit log asynchronously (don't await - let it run in background)
    this.createAuditLog(
      'SALARY_PAYMENT_RECORDED',
      employeeId,
      {
        amount: payment.amount,
        paymentPeriod: payment.paymentPeriod,
        paymentMethod: payment.paymentMethod,
        employeeName: employee.name,
        paymentFrequency: employee.paymentFrequency,
        recordedBy: recordedById
      },
      recordedById
    ).catch(error => {
      console.error('Audit log creation failed:', error);
    });

    // Update employee status and send reminders asynchronously
    setImmediate(() => {
      Promise.all([
        this.updateEmployeeStatusBasedOnPayments(employeeId).catch(error => 
          console.error('Error updating employee status:', error)
        ),
        this.checkAndSendPaymentReminders().catch(error => 
          console.error('Error sending reminders:', error)
        )
      ]);
    });

    return payment;
  }

  // Auto-update employee status based on payment history
  async updateEmployeeStatusBasedOnPayments(employeeId) {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        salaryPayments: {
          orderBy: { paymentDate: 'desc' },
          take: 3
        }
      }
    });

    if (!employee) return;

    const currentPeriod = this.getCurrentPaymentPeriod();
    const hasCurrentPayment = employee.salaryPayments.some(
      payment => payment.paymentPeriod === currentPeriod
    );

    // Get last 2 payment periods to check for missed payments
    const lastTwoPeriods = this.getLastTwoPaymentPeriods();
    const paidPeriods = employee.salaryPayments
      .filter(p => p.status === 'PAID')
      .map(p => p.paymentPeriod);
    
    const missedPaymentsCount = lastTwoPeriods.filter(period => !paidPeriods.includes(period)).length;

    let newStatus = employee.status;

    // Auto-update logic
    if (hasCurrentPayment) {
      // If current payment is made, ensure status is ACTIVE
      if (employee.status !== 'ACTIVE') {
        newStatus = 'ACTIVE';
      }
    } else {
      // No payment for current period
      if (missedPaymentsCount >= 2) {
        // Missed 2 or more payments
        if (employee.status !== 'TERMINATED') {
          newStatus = 'TERMINATED';
          await this.createPaymentReminder(employeeId, 'TERMINATION_WARNING');
        }
      } else if (missedPaymentsCount === 1) {
        // Missed 1 payment
        if (employee.status === 'ACTIVE') {
          newStatus = 'ON_LEAVE';
          await this.createPaymentReminder(employeeId, 'PAYMENT_OVERDUE');
        }
      }
    }

    // Update status if changed
    if (newStatus !== employee.status) {
      await prisma.employee.update({
        where: { id: employeeId },
        data: { status: newStatus }
      });

      // Log status change asynchronously
      this.createAuditLog(
        'EMPLOYEE_STATUS_AUTO_UPDATED',
        employeeId,
        {
          oldStatus: employee.status,
          newStatus: newStatus,
          reason: missedPaymentsCount >= 2 ? 'Multiple missed payments' : 'Payment overdue',
          currentPeriod,
          missedPaymentsCount
        }
      ).catch(error => {
        console.error('Failed to log status change:', error);
      });
    }

    return newStatus;
  }

  // Get last two payment periods
  getLastTwoPaymentPeriods() {
    const now = new Date();
    const currentPeriod = this.getCurrentPaymentPeriod();
    const lastPeriod = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const secondLastPeriod = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    
    return [
      currentPeriod,
      `${lastPeriod.getFullYear()}-${String(lastPeriod.getMonth() + 1).padStart(2, '0')}`,
      `${secondLastPeriod.getFullYear()}-${String(secondLastPeriod.getMonth() + 1).padStart(2, '0')}`
    ];
  }

  // Create payment reminder
  async createPaymentReminder(employeeId, type) {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: { createdBy: true }
    });

    if (!employee) return;

    try {
      const systemUserId = await this.getSystemUserId();
      
      if (!systemUserId) {
        console.warn('No valid user found for creating payment reminder audit log');
        return;
      }

      await prisma.rBACAuditLog.create({
        data: {
          action: 'PAYMENT_REMINDER_CREATED',
          performedBy: systemUserId,
          targetUser: employeeId,
          changes: {
            type,
            employeeName: employee.name,
            employeeEmail: employee.email,
            managerEmail: employee.createdBy?.email,
            message: this.getReminderMessage(type, employee)
          }
        }
      });
    } catch (error) {
      console.error('Failed to create payment reminder audit log:', error);
      // Don't throw the error - just log it so the payment recording can continue
    }
  }

  // Get reminder message based on type
  getReminderMessage(type, employee) {
    const messages = {
      'PAYMENT_OVERDUE': `${employee.name}'s salary payment is overdue. Please process payment to avoid status change.`,
      'TERMINATION_WARNING': `${employee.name} has missed multiple payments and may be terminated if payment is not received.`,
      'MISSED_PAYMENT_WARNING': `${employee.name} has missed a payment. Please process pending salary.`
    };
    return messages[type] || `Payment reminder for ${employee.name}`;
  }

  // Check and send payment reminders to all managers
  async checkAndSendPaymentReminders() {
    const currentPeriod = this.getCurrentPaymentPeriod();
    const today = new Date();
    
    // Get all active employees with pending payments
    const pendingEmployees = await prisma.employee.findMany({
      where: {
        status: 'ACTIVE',
        salaryPayments: {
          none: {
            paymentPeriod: currentPeriod
          }
        }
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      }
    });

    if (pendingEmployees.length === 0) return;

    // Group by creator (manager/admin)
    const employeesByCreator = {};
    pendingEmployees.forEach(employee => {
      if (employee.createdBy) {
        const creatorId = employee.createdById;
        if (!employeesByCreator[creatorId]) {
          employeesByCreator[creatorId] = {
            creator: employee.createdBy,
            employees: []
          };
        }
        employeesByCreator[creatorId].employees.push(employee);
      }
    });

    // Generate and send reminders for each creator
    for (const [creatorId, data] of Object.entries(employeesByCreator)) {
      const reminders = this.generateReminders(data.employees, currentPeriod, today);
      
      if (reminders.length > 0 && data.creator.email && this.transporter) {
        await this.sendPaymentReminderEmail(data.creator, reminders, currentPeriod);
      }
      
      // Store reminders in database - use the actual creator ID
      await this.storeReminders(reminders, creatorId);
    }
  }

  // Generate reminders based on urgency
  generateReminders(employees, currentPeriod, today) {
    const reminders = [];
    
    employees.forEach(employee => {
      const dueDate = this.calculateDueDate(employee.paymentFrequency);
      const daysOverdue = Math.ceil((today - dueDate) / (1000 * 60 * 60 * 24));
      
      // Different reminder levels based on urgency
      if (daysOverdue >= 30) {
        reminders.push({
          employeeId: employee.id,
          type: 'URGENT',
          employeeName: employee.name,
          salaryAmount: employee.salaryAmount,
          message: `${employee.name} is 30+ days overdue for salary payment of ${employee.salaryAmount}`,
          dueDate,
          daysOverdue
        });
      } else if (daysOverdue >= 15) {
        reminders.push({
          employeeId: employee.id,
          type: 'WARNING',
          employeeName: employee.name,
          salaryAmount: employee.salaryAmount,
          message: `${employee.name} is 15+ days overdue for salary payment of ${employee.salaryAmount}`,
          dueDate,
          daysOverdue
        });
      } else if (daysOverdue >= 0) {
        reminders.push({
          employeeId: employee.id,
          type: 'REMINDER',
          employeeName: employee.name,
          salaryAmount: employee.salaryAmount,
          message: `${employee.name}'s salary payment of ${employee.salaryAmount} for ${currentPeriod} is due`,
          dueDate,
          daysOverdue
        });
      } else {
        // Upcoming payment (due in future)
        const daysUntilDue = -daysOverdue;
        if (daysUntilDue <= 7) {
          reminders.push({
            employeeId: employee.id,
            type: 'UPCOMING',
            employeeName: employee.name,
            salaryAmount: employee.salaryAmount,
            message: `${employee.name}'s salary payment of ${employee.salaryAmount} for ${currentPeriod} is due in ${daysUntilDue} days`,
            dueDate,
            daysUntilDue
          });
        }
      }
    });
    
    return reminders;
  }

  // Calculate due date based on payment frequency
  calculateDueDate(frequency) {
    const today = new Date();
    const dueDate = new Date(today);
    
    switch(frequency) {
      case 'MONTHLY':
        dueDate.setDate(5); // 5th of current month
        break;
      case 'BI_WEEKLY':
        dueDate.setDate(today.getDate() + 14);
        break;
      case 'WEEKLY':
        dueDate.setDate(today.getDate() + 7);
        break;
      case 'DAILY':
        dueDate.setDate(today.getDate() + 1);
        break;
      default:
        dueDate.setDate(5);
    }
    
    // If due date has passed, use last due date
    if (dueDate < today) {
      if (frequency === 'MONTHLY') {
        dueDate.setMonth(today.getMonth() - 1);
        dueDate.setDate(5);
      }
    }
    
    return dueDate;
  }

  // Send payment reminder email
  async sendPaymentReminderEmail(creator, reminders, period) {
    if (!this.transporter) {
      console.warn('Email transporter not configured. Skipping email reminder.');
      return;
    }

    const emailContent = this.generateEmailContent(creator.name, reminders, period);
    
    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: creator.email,
        subject: `Salary Payment Reminders - ${period}`,
        html: emailContent
      });
      
      console.log(`Reminder email sent to ${creator.email}`);
    } catch (error) {
      console.error(`Failed to send reminder email to ${creator.email}:`, error);
    }
  }

  // Generate email content
  generateEmailContent(managerName, reminders, period) {
    const urgentReminders = reminders.filter(r => r.type === 'URGENT');
    const warningReminders = reminders.filter(r => r.type === 'WARNING');
    const regularReminders = reminders.filter(r => r.type === 'REMINDER');
    const upcomingReminders = reminders.filter(r => r.type === 'UPCOMING');
    
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Salary Payment Reminders - ${period}</h2>
        <p>Dear ${managerName},</p>
        
        ${urgentReminders.length > 0 ? `
          <div style="background-color: #ffebee; padding: 15px; border-left: 4px solid #f44336; margin: 20px 0; border-radius: 4px;">
            <h3 style="color: #c62828; margin-top: 0;">⚠️ Urgent: Overdue Payments (30+ days)</h3>
            <ul style="margin-bottom: 0;">
              ${urgentReminders.map(r => `
                <li><strong>${r.employeeName}</strong> - ${r.message}<br/>
                <small>Amount: KES ${r.salaryAmount.toLocaleString()} | Overdue by ${r.daysOverdue} days</small></li>
              `).join('')}
            </ul>
          </div>
        ` : ''}
        
        ${warningReminders.length > 0 ? `
          <div style="background-color: #fff3e0; padding: 15px; border-left: 4px solid #ff9800; margin: 20px 0; border-radius: 4px;">
            <h3 style="color: #e65100; margin-top: 0;">⚠️ Warning: Overdue Payments (15+ days)</h3>
            <ul style="margin-bottom: 0;">
              ${warningReminders.map(r => `
                <li><strong>${r.employeeName}</strong> - ${r.message}<br/>
                <small>Amount: KES ${r.salaryAmount.toLocaleString()} | Overdue by ${r.daysOverdue} days</small></li>
              `).join('')}
            </ul>
          </div>
        ` : ''}
        
        ${regularReminders.length > 0 ? `
          <div style="background-color: #e3f2fd; padding: 15px; border-left: 4px solid #2196f3; margin: 20px 0; border-radius: 4px;">
            <h3 style="color: #0d47a1; margin-top: 0;">🔔 Payment Reminders</h3>
            <ul style="margin-bottom: 0;">
              ${regularReminders.map(r => `
                <li><strong>${r.employeeName}</strong> - ${r.message}<br/>
                <small>Amount: KES ${r.salaryAmount.toLocaleString()} | Overdue by ${r.daysOverdue} days</small></li>
              `).join('')}
            </ul>
          </div>
        ` : ''}
        
        ${upcomingReminders.length > 0 ? `
          <div style="background-color: #e8f5e9; padding: 15px; border-left: 4px solid #4caf50; margin: 20px 0; border-radius: 4px;">
            <h3 style="color: #1b5e20; margin-top: 0;">📅 Upcoming Payments</h3>
            <ul style="margin-bottom: 0;">
              ${upcomingReminders.map(r => `
                <li><strong>${r.employeeName}</strong> - ${r.message}<br/>
                <small>Amount: KES ${r.salaryAmount.toLocaleString()} | Due in ${r.daysUntilDue} days</small></li>
              `).join('')}
            </ul>
          </div>
        ` : ''}
        
        <div style="margin-top: 30px; padding: 15px; background-color: #f5f5f5; border-radius: 4px;">
          <p><strong>Quick Actions:</strong></p>
          <ul style="margin-bottom: 0;">
            <li>Click <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/employees/due" style="color: #2196f3;">here</a> to view all due employees</li>
            <li>Click <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/employees" style="color: #2196f3;">here</a> to record payments</li>
          </ul>
        </div>
        
        <p style="color: #666; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
          This is an automated reminder from your Property Management System.<br/>
          Please do not reply to this email.
        </p>
      </div>
    `;
  }

  // Store reminders in database
  async storeReminders(reminders, creatorId) {
    // Get system user ID for audit logs
    const systemUserId = await this.getSystemUserId();
    
    if (!systemUserId) {
      console.warn('No valid user found for storing reminders');
      return;
    }

    for (const reminder of reminders) {
      try {
        await prisma.rBACAuditLog.create({
          data: {
            action: 'PAYMENT_REMINDER',
            performedBy: systemUserId,
            targetUser: reminder.employeeId,
            changes: {
              type: reminder.type,
              message: reminder.message,
              dueDate: reminder.dueDate,
              daysOverdue: reminder.daysOverdue || null,
              daysUntilDue: reminder.daysUntilDue || null,
              salaryAmount: reminder.salaryAmount,
              employeeName: reminder.employeeName,
              creatorId: creatorId
            }
          }
        });
      } catch (error) {
        console.error('Failed to store reminder:', error);
        // Continue with other reminders
      }
    }
  }

  // Get reminders for a user
  async getReminders(userId, userRole) {
    let where = {};
    
    if (userRole === 'MANAGER') {
      // Get employees created by this manager
      const employees = await prisma.employee.findMany({
        where: { createdById: userId },
        select: { id: true }
      });
      const employeeIds = employees.map(e => e.id);
      where.targetUser = { in: employeeIds };
    }
    
    const reminders = await prisma.rBACAuditLog.findMany({
      where: {
        action: 'PAYMENT_REMINDER',
        ...where,
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    
    return reminders;
  }

  // Send manual reminders (ADMIN only)
  async sendManualReminders() {
    await this.checkAndSendPaymentReminders();
    return { message: 'Reminders sent successfully' };
  }

  // Get payment history for an employee
  async getEmployeePaymentHistory(employeeId, userId, userRole) {
    // Verify access
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { createdById: true }
    });

    if (!employee) {
      throw new Error('Employee not found');
    }

    // MANAGER can only see their employees
    if (userRole === 'MANAGER' && employee.createdById !== userId) {
      throw new Error('Access denied');
    }

    return prisma.salaryPayment.findMany({
      where: { employeeId },
      orderBy: { paymentDate: 'desc' },
      include: {
        recordedBy: {
          select: { id: true, name: true, email: true, role: true }
        }
      }
    });
  }

  // Get single employee
  async getEmployeeById(employeeId, userId, userRole) {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true }
        },
        salaryPayments: {
          orderBy: { paymentDate: 'desc' },
          take: 10
        }
      }
    });

    if (!employee) {
      throw new Error('Employee not found');
    }

    // Check access
    if (userRole === 'MANAGER' && employee.createdById !== userId) {
      throw new Error('Access denied');
    }

    // Add current payment status
    const currentPeriod = this.getCurrentPaymentPeriod();
    const currentPayment = await prisma.salaryPayment.findFirst({
      where: {
        employeeId,
        paymentPeriod: currentPeriod
      }
    });

    return {
      ...employee,
      currentPaymentStatus: currentPayment ? 'PAID' : 'PENDING',
      currentPaymentPeriod: currentPeriod
    };
  }

  // Update employee
  async updateEmployee(employeeId, data, userId, userRole) {
    // Check access
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { createdById: true }
    });

    if (!employee) {
      throw new Error('Employee not found');
    }

    if (userRole === 'MANAGER' && employee.createdById !== userId) {
      throw new Error('Access denied');
    }

    // Prevent certain fields from being updated
    const { id, createdAt, updatedAt, createdById, ...updateData } = data;

    return prisma.employee.update({
      where: { id: employeeId },
      data: updateData,
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true }
        }
      }
    });
  }

  // Update employee status
  async updateEmployeeStatus(employeeId, status, userId, userRole) {
    // Check access
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { createdById: true }
    });

    if (!employee) {
      throw new Error('Employee not found');
    }

    if (userRole === 'MANAGER' && employee.createdById !== userId) {
      throw new Error('Access denied');
    }

    const updatedEmployee = await prisma.employee.update({
      where: { id: employeeId },
      data: { status },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true }
        }
      }
    });

    // Log status change asynchronously
    this.createAuditLog(
      'EMPLOYEE_STATUS_MANUAL_UPDATE',
      employeeId,
      {
        oldStatus: employee.status,
        newStatus: status
      },
      userId
    ).catch(error => {
      console.error('Failed to log status change:', error);
    });

    return updatedEmployee;
  }

  // Helper: Get current payment period
  getCurrentPaymentPeriod() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  // Helper: Calculate next payment date based on frequency
  calculateNextPaymentDate(frequency) {
    const today = new Date();
    const nextDate = new Date(today);
    
    switch(frequency) {
      case 'MONTHLY':
        nextDate.setMonth(today.getMonth() + 1);
        nextDate.setDate(1);
        break;
      case 'BI_WEEKLY':
        nextDate.setDate(today.getDate() + 14);
        break;
      case 'WEEKLY':
        nextDate.setDate(today.getDate() + 7);
        break;
      case 'DAILY':
        nextDate.setDate(today.getDate() + 1);
        break;
      default:
        nextDate.setMonth(today.getMonth() + 1);
    }
    
    return nextDate;
  }

  // Helper: Generate payment period based on frequency and date
  generatePaymentPeriod(frequency, date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    switch(frequency) {
      case 'MONTHLY':
        return `${year}-${month}`;
        
      case 'DAILY':
        return `${year}-${month}-${day}`;
        
      case 'WEEKLY': {
        // Get ISO week number
        const firstDayOfYear = new Date(year, 0, 1);
        const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
        const weekNumber = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
        return `${year}-W${String(weekNumber).padStart(2, '0')}`;
      }
      
      case 'BI_WEEKLY': {
        // Calculate bi-weekly periods (14-day periods)
        const startDate = new Date(year, 0, 1);
        const dayOfYear = Math.floor((date - startDate) / 86400000);
        const biWeekNumber = Math.floor(dayOfYear / 14);
        const periodStart = new Date(year, 0, 1 + biWeekNumber * 14);
        const periodEnd = new Date(year, 0, 1 + (biWeekNumber + 1) * 14 - 1);
        
        const startYear = periodStart.getFullYear();
        const startMonth = String(periodStart.getMonth() + 1).padStart(2, '0');
        const startDay = String(periodStart.getDate()).padStart(2, '0');
        const endYear = periodEnd.getFullYear();
        const endMonth = String(periodEnd.getMonth() + 1).padStart(2, '0');
        const endDay = String(periodEnd.getDate()).padStart(2, '0');
        
        return `${startYear}-${startMonth}-${startDay}_to_${endYear}-${endMonth}-${endDay}`;
      }
      
      default:
        return `${year}-${month}`;
    }
  }

  // Helper: Validate payment period format based on frequency
  validatePaymentPeriod(period, frequency) {
    const patterns = {
      'MONTHLY': /^\d{4}-\d{2}$/,
      'DAILY': /^\d{4}-\d{2}-\d{2}$/,
      'WEEKLY': /^\d{4}-W\d{2}$/,
      'BI_WEEKLY': /^\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}$/
    };
    
    const pattern = patterns[frequency];
    if (!pattern) return false;
    
    if (!pattern.test(period)) return false;
    
    // Additional validation for BI_WEEKLY to ensure start date is before end date
    if (frequency === 'BI_WEEKLY') {
      const [startDateStr, endDateStr] = period.split('_to_');
      const startDate = new Date(startDateStr);
      const endDate = new Date(endDateStr);
      if (startDate >= endDate) return false;
      
      // Validate that the period is exactly 14 days
      const diffDays = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24));
      if (diffDays !== 13) return false;
    }
    
    return true;
  }

  // Helper: Get previous payment period
  getPreviousPaymentPeriod(currentPeriod, frequency) {
    switch(frequency) {
      case 'MONTHLY': {
        const [year, month] = currentPeriod.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 2, 1);
        return this.generatePaymentPeriod(frequency, date);
      }
      
      case 'DAILY': {
        const date = new Date(currentPeriod);
        date.setDate(date.getDate() - 1);
        return this.generatePaymentPeriod(frequency, date);
      }
      
      case 'WEEKLY': {
        const weekNum = parseInt(currentPeriod.split('-W')[1]);
        const year = parseInt(currentPeriod.split('-')[0]);
        const prevWeek = weekNum - 1;
        if (prevWeek < 1) {
          return `${year - 1}-W52`;
        }
        return `${year}-W${String(prevWeek).padStart(2, '0')}`;
      }
      
      case 'BI_WEEKLY': {
        const [startDateStr] = currentPeriod.split('_to_');
        const startDate = new Date(startDateStr);
        startDate.setDate(startDate.getDate() - 14);
        return this.generatePaymentPeriod(frequency, startDate);
      }
      
      default:
        return currentPeriod;
    }
  }

  // Helper: Get next payment period
  getNextPaymentPeriod(currentPeriod, frequency) {
    switch(frequency) {
      case 'MONTHLY': {
        const [year, month] = currentPeriod.split('-');
        const date = new Date(parseInt(year), parseInt(month), 1);
        return this.generatePaymentPeriod(frequency, date);
      }
      
      case 'DAILY': {
        const date = new Date(currentPeriod);
        date.setDate(date.getDate() + 1);
        return this.generatePaymentPeriod(frequency, date);
      }
      
      case 'WEEKLY': {
        const weekNum = parseInt(currentPeriod.split('-W')[1]);
        const year = parseInt(currentPeriod.split('-')[0]);
        const nextWeek = weekNum + 1;
        if (nextWeek > 52) {
          return `${year + 1}-W01`;
        }
        return `${year}-W${String(nextWeek).padStart(2, '0')}`;
      }
      
      case 'BI_WEEKLY': {
        const [startDateStr] = currentPeriod.split('_to_');
        const startDate = new Date(startDateStr);
        startDate.setDate(startDate.getDate() + 14);
        return this.generatePaymentPeriod(frequency, startDate);
      }
      
      default:
        return currentPeriod;
    }
  }

  // Helper: Get format hint for payment period
  getPaymentPeriodFormatHint(frequency) {
    const hints = {
      'MONTHLY': 'YYYY-MM (e.g., 2026-05)',
      'DAILY': 'YYYY-MM-DD (e.g., 2026-05-26)',
      'WEEKLY': 'YYYY-WXX (e.g., 2026-W21)',
      'BI_WEEKLY': 'YYYY-MM-DD_to_YYYY-MM-DD (e.g., 2026-05-01_to_2026-05-14)'
    };
    return hints[frequency] || 'YYYY-MM';
  }

  // Get statistics for dashboard
  async getStatistics(userId, userRole) {
    let where = {};
    
    if (userRole === 'MANAGER') {
      where.createdById = userId;
    }

    const totalEmployees = await prisma.employee.count({ where });
    const activeEmployees = await prisma.employee.count({ 
      where: { ...where, status: 'ACTIVE' }
    });
    
    const currentPeriod = this.getCurrentPaymentPeriod();
    const pendingPayments = await prisma.employee.count({
      where: {
        ...where,
        status: 'ACTIVE',
        salaryPayments: {
          none: {
            paymentPeriod: currentPeriod
          }
        }
      }
    });

    const totalPaidThisMonth = await prisma.salaryPayment.aggregate({
      where: {
        paymentPeriod: currentPeriod,
        employee: where
      },
      _sum: {
        amount: true
      }
    });

    return {
      totalEmployees,
      activeEmployees,
      pendingPayments,
      totalPaidThisMonth: totalPaidThisMonth._sum.amount || 0,
      currentPeriod
    };
  }
}

export default EmployeeService;