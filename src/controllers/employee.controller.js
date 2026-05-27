import EmployeeService from '../services/employee.service.js';

const employeeService = new EmployeeService();

export const createEmployee = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    
    // Only ADMIN or MANAGER can create employees
    if (userRole !== 'ADMIN' && userRole !== 'MANAGER') {
      return res.status(403).json({
        success: false,
        error: 'Only ADMIN or MANAGER can create employees'
      });
    }

    const employee = await employeeService.createEmployee({
      ...req.body,
      createdById: userId
    });

    res.status(201).json({
      success: true,
      data: employee,
      message: 'Employee created successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
};

export const getEmployees = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { status, jobTitle, page, limit } = req.query;

    const result = await employeeService.getEmployees(userId, userRole, {
      status,
      jobTitle,
      page,
      limit
    });

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
};

export const getEmployeeById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const employee = await employeeService.getEmployeeById(id, userId, userRole);

    res.status(200).json({
      success: true,
      data: employee
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
};

export const getEmployeesDueForPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    const dueEmployees = await employeeService.getEmployeesDueForPayment(userId, userRole);

    res.status(200).json({
      success: true,
      data: dueEmployees,
      count: dueEmployees.length,
      message: 'Employees due for payment retrieved'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
};

export const getUpcomingPayments = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    const upcomingPayments = await employeeService.getUpcomingPayments(userId, userRole);

    res.status(200).json({
      success: true,
      data: upcomingPayments,
      count: upcomingPayments.length,
      message: 'Upcoming payments retrieved'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
};

export const recordSalaryPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { employeeId } = req.params;

    const payment = await employeeService.recordSalaryPayment(
      { ...req.body, employeeId },
      userId,
      userRole
    );

    res.status(200).json({
      success: true,
      data: payment,
      message: 'Salary payment recorded successfully. Employee status will be automatically updated if needed.'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
};

export const getPaymentHistory = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const history = await employeeService.getEmployeePaymentHistory(employeeId, userId, userRole);

    res.status(200).json({
      success: true,
      data: history,
      count: history.length,
      message: 'Payment history retrieved'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
};

export const updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const employee = await employeeService.updateEmployee(id, req.body, userId, userRole);

    res.status(200).json({
      success: true,
      data: employee,
      message: 'Employee updated successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
};

export const updateEmployeeStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    const employee = await employeeService.updateEmployeeStatus(id, status, userId, userRole);

    res.status(200).json({
      success: true,
      data: employee,
      message: 'Employee status updated successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
};

export const getStatistics = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    const stats = await employeeService.getStatistics(userId, userRole);

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
};

// New: Get reminders for logged-in user
export const getReminders = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    
    const reminders = await employeeService.getReminders(userId, userRole);
    
    res.status(200).json({
      success: true,
      data: reminders,
      count: reminders.length,
      message: 'Reminders retrieved successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
};

// New: Send manual reminders (ADMIN only)
export const sendManualReminders = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    
    // Only ADMIN can send manual reminders
    if (userRole !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Only ADMIN can send manual reminders'
      });
    }
    
    const result = await employeeService.sendManualReminders();
    
    res.status(200).json({
      success: true,
      message: 'Reminders sent successfully',
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
};

// New: Get payment status summary
export const getPaymentStatusSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    
    const currentPeriod = employeeService.getCurrentPaymentPeriod();
    const dueEmployees = await employeeService.getEmployeesDueForPayment(userId, userRole);
    const upcomingPayments = await employeeService.getUpcomingPayments(userId, userRole);
    
    res.status(200).json({
      success: true,
      data: {
        currentPeriod,
        dueCount: dueEmployees.length,
        upcomingCount: upcomingPayments.length,
        dueEmployees: dueEmployees.slice(0, 10),
        upcomingPayments: upcomingPayments.slice(0, 10)
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
};