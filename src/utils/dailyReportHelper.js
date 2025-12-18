import { generatePDF } from './pdfGenerator.js';

export class DailyReportHelper {
  // Prepare report data for database
  static prepareReportData(data) {
    const dbData = {};
    
    // Security Report
    if (data.securityProvider) dbData.securityProvider = data.securityProvider;
    if (data.shiftCoverage) dbData.shiftCoverage = data.shiftCoverage;
    if (data.securityIncidents) dbData.securityIncidents = data.securityIncidents;
    if (data.securityActions) dbData.securityActions = data.securityActions;
    if (data.securityOutstandingIssues) dbData.securityOutstandingIssues = data.securityOutstandingIssues;
    
    // Cleaning & Sanitation
    if (data.cleaningContractor) dbData.cleaningContractor = data.cleaningContractor;
    if (data.areasCleaned) dbData.areasCleaned = JSON.stringify(data.areasCleaned);
    if (data.cleanlinessStandard) dbData.cleanlinessStandard = data.cleanlinessStandard;
    if (data.cleaningIssues) dbData.cleaningIssues = data.cleaningIssues;
    if (data.cleaningCorrectiveAction) dbData.cleaningCorrectiveAction = data.cleaningCorrectiveAction;
    
    // Maintenance & Repairs
    if (data.preventiveTasks) dbData.preventiveTasks = JSON.stringify(data.preventiveTasks);
    if (data.repairs) dbData.repairs = JSON.stringify(data.repairs);
    
    // Tenant Complaints
    if (data.tenantComplaints) dbData.tenantComplaints = JSON.stringify(data.tenantComplaints);
    
    // Landlord Instructions
    if (data.landlordInstructions) dbData.landlordInstructions = data.landlordInstructions;
    if (data.landlordActionTaken) dbData.landlordActionTaken = data.landlordActionTaken;
    if (data.landlordStatus) dbData.landlordStatus = data.landlordStatus;
    
    // Leads & Enquiries
    if (data.newEnquiries !== undefined) dbData.newEnquiries = data.newEnquiries;
    if (data.enquirySource) dbData.enquirySource = data.enquirySource;
    if (data.unitsEnquired) dbData.unitsEnquired = data.unitsEnquired;
    if (data.followUpAction) dbData.followUpAction = data.followUpAction;
    if (data.siteVisits !== undefined) dbData.siteVisits = data.siteVisits;
    
    // Bookings & Occupancy
    if (data.bookingsReceived) dbData.bookingsReceived = data.bookingsReceived;
    if (data.bookingsConfirmed !== undefined) dbData.bookingsConfirmed = data.bookingsConfirmed;
    if (data.bookingsCancelled !== undefined) dbData.bookingsCancelled = data.bookingsCancelled;
    if (data.occupancyLevel !== undefined) dbData.occupancyLevel = data.occupancyLevel;
    if (data.bookingsRemarks) dbData.bookingsRemarks = data.bookingsRemarks;
    
    // Utilities Status
    if (data.waterStatus) dbData.waterStatus = data.waterStatus;
    if (data.electricityStatus) dbData.electricityStatus = data.electricityStatus;
    if (data.otherServicesStatus) dbData.otherServicesStatus = data.otherServicesStatus;
    if (data.utilitiesRemarks) dbData.utilitiesRemarks = data.utilitiesRemarks;
    
    // General Observations
    if (data.operationalChallenges) dbData.operationalChallenges = data.operationalChallenges;
    if (data.healthSafetyIssues) dbData.healthSafetyIssues = data.healthSafetyIssues;

    return dbData;
  }

  // Generate HTML template for PDF
  static generateHTMLTemplate(report) {
    const formatDate = (date) => {
      return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
      });
    };

    const formatTime = (date) => {
      return new Date(date).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });
    };

    const parseJSON = (jsonString) => {
      try {
        return jsonString ? JSON.parse(jsonString) : null;
      } catch {
        return null;
      }
    };

    // Helper to create table rows - NOW USED
    const createTableRows = (data, columns) => {
      if (!data || !Array.isArray(data)) return '';
      return data.map(item => `
        <tr>
          ${columns.map(col => `<td>${item[col] || ''}</td>`).join('')}
        </tr>
      `).join('');
    };

    // Helper to create dynamic table with headers
    const createDynamicTable = (data, headers) => {
      if (!data || !Array.isArray(data) || data.length === 0) {
        return '<div class="field-value">No data available</div>';
      }
      
      const columns = Object.keys(data[0]);
      return `
        <table>
          <thead>
            <tr>
              ${headers.map(header => `<th>${header}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${createTableRows(data, columns)}
          </tbody>
        </table>
      `;
    };

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Daily Operations Report - ${report.property?.name || ''}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
          
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Inter', sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #fff;
            font-size: 12px;
          }
          
          .report-container {
            max-width: 210mm;
            margin: 0 auto;
            padding: 20px;
          }
          
          .header {
            text-align: center;
            margin-bottom: 30px;
            border-bottom: 3px solid #2c3e50;
            padding-bottom: 20px;
          }
          
          .title {
            color: #2c3e50;
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 10px;
          }
          
          .subtitle {
            color: #7f8c8d;
            font-size: 14px;
            margin-bottom: 20px;
          }
          
          .property-info {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
            margin-bottom: 30px;
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid #3498db;
          }
          
          .info-item {
            margin-bottom: 8px;
          }
          
          .info-label {
            font-weight: 600;
            color: #2c3e50;
            margin-right: 5px;
          }
          
          .info-value {
            color: #34495e;
          }
          
          .section {
            margin-bottom: 25px;
            page-break-inside: avoid;
          }
          
          .section-title {
            background: #2c3e50;
            color: white;
            padding: 10px 15px;
            border-radius: 6px;
            margin-bottom: 15px;
            font-size: 14px;
            font-weight: 600;
          }
          
          .subsection {
            margin-bottom: 20px;
          }
          
          .subsection-title {
            color: #2c3e50;
            font-weight: 600;
            margin-bottom: 10px;
            padding-bottom: 5px;
            border-bottom: 1px solid #ecf0f1;
            font-size: 13px;
          }
          
          .content {
            padding: 0 10px;
          }
          
          .grid-2 {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
          }
          
          .grid-3 {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 15px;
          }
          
          .grid-4 {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 15px;
          }
          
          .field {
            margin-bottom: 12px;
          }
          
          .field-label {
            font-weight: 500;
            color: #7f8c8d;
            margin-bottom: 4px;
            font-size: 11px;
          }
          
          .field-value {
            color: #2c3e50;
            padding: 8px;
            background: #f8f9fa;
            border-radius: 4px;
            border-left: 3px solid #3498db;
            min-height: 35px;
          }
          
          table {
            width: 100%;
            border-collapse: collapse;
            margin: 10px 0;
            font-size: 11px;
          }
          
          th {
            background: #34495e;
            color: white;
            padding: 10px;
            text-align: left;
            font-weight: 600;
          }
          
          td {
            padding: 8px 10px;
            border: 1px solid #ecf0f1;
          }
          
          tr:nth-child(even) {
            background-color: #f8f9fa;
          }
          
          .status {
            display: inline-block;
            padding: 3px 10px;
            border-radius: 20px;
            font-size: 10px;
            font-weight: 600;
          }
          
          .status-completed { background: #d4edda; color: #155724; }
          .status-ongoing { background: #fff3cd; color: #856404; }
          .status-pending { background: #f8d7da; color: #721c24; }
          
          .checkbox-group {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: 5px;
          }
          
          .checkbox-item {
            display: flex;
            align-items: center;
            gap: 5px;
          }
          
          .checkbox {
            display: inline-block;
            width: 12px;
            height: 12px;
            border: 1px solid #7f8c8d;
            border-radius: 2px;
          }
          
          .checked {
            background-color: #2c3e50;
            position: relative;
          }
          
          .checked:after {
            content: '✓';
            color: white;
            font-size: 8px;
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
          }
          
          .signature-section {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 2px solid #ecf0f1;
          }
          
          .signature-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 40px;
            margin-top: 20px;
          }
          
          .signature-box {
            padding: 20px;
            border: 1px solid #bdc3c7;
            border-radius: 4px;
            text-align: center;
          }
          
          .signature-line {
            height: 1px;
            background: #333;
            margin: 30px 0 10px;
          }
          
          .footer {
            margin-top: 40px;
            text-align: center;
            color: #7f8c8d;
            font-size: 10px;
            border-top: 1px solid #ecf0f1;
            padding-top: 10px;
          }
          
          .page-break {
            page-break-before: always;
          }
          
          @media print {
            body {
              font-size: 10pt;
            }
            
            .report-container {
              padding: 15px;
            }
            
            .section {
              page-break-inside: avoid;
              break-inside: avoid;
            }
            
            .no-print {
              display: none;
            }
          }
        </style>
      </head>
      <body>
        <div class="report-container">
          <!-- Header -->
          <div class="header">
            <h1 class="title">PROPERTY MANAGER DAILY OPERATIONS REPORT</h1>
            <div class="subtitle">Daily Operations and Management Documentation</div>
          </div>
          
          <!-- Property Information -->
          <div class="property-info">
            <div class="info-item">
              <span class="info-label">Property Name:</span>
              <span class="info-value">${report.property?.name || 'N/A'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Location:</span>
              <span class="info-value">${report.property?.address || 'N/A'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Report Date:</span>
              <span class="info-value">${formatDate(report.reportDate)}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Day:</span>
              <span class="info-value">${formatDate(report.reportDate).split(',')[0]}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Time Submitted:</span>
              <span class="info-value">${formatTime(report.timeSubmitted)}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Prepared By:</span>
              <span class="info-value">${report.preparedBy || 'N/A'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Landlord:</span>
              <span class="info-value">${report.property?.landlord?.name || 'N/A'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Report Status:</span>
              <span class="info-value">${report.status}</span>
            </div>
          </div>
          
          <!-- Section 1: Security Report -->
          <div class="section">
            <h2 class="section-title">1. SECURITY REPORT</h2>
            <div class="grid-2">
              <div class="field">
                <div class="field-label">Security Provider / Guards on Duty</div>
                <div class="field-value">${report.securityProvider || 'N/A'}</div>
              </div>
              <div class="field">
                <div class="field-label">Shift Coverage (Day/Night)</div>
                <div class="field-value">${report.shiftCoverage || 'N/A'}</div>
              </div>
            </div>
            <div class="field">
              <div class="field-label">Incidents Reported (if any)</div>
              <div class="field-value">${report.securityIncidents || 'None reported'}</div>
            </div>
            <div class="field">
              <div class="field-label">Actions Taken</div>
              <div class="field-value">${report.securityActions || 'N/A'}</div>
            </div>
            <div class="field">
              <div class="field-label">Outstanding Security Issues / Risks</div>
              <div class="field-value">${report.securityOutstandingIssues || 'None'}</div>
            </div>
          </div>
          
          <!-- Section 2: Cleaning & Sanitation -->
          <div class="section">
            <h2 class="section-title">2. CLEANING & SANITATION</h2>
            <div class="field">
              <div class="field-label">Cleaning Contractor / Staff</div>
              <div class="field-value">${report.cleaningContractor || 'N/A'}</div>
            </div>
            
            <div class="field">
              <div class="field-label">Areas Cleaned Today</div>
              <div class="checkbox-group">
                ${(() => {
                  const areas = parseJSON(report.areasCleaned) || {};
                  const areasList = [
                    { key: 'commonAreas', label: '☐ Common Areas' },
                    { key: 'toilets', label: '☐ Toilets' },
                    { key: 'parking', label: '☐ Parking' },
                    { key: 'externalAreas', label: '☐ External Areas' },
                    { key: 'other', label: '☐ Other: ' + (areas.otherSpecify || '') }
                  ];
                  
                  return areasList.map(area => `
                    <div class="checkbox-item">
                      <span class="checkbox ${areas[area.key] ? 'checked' : ''}"></span>
                      <span>${area.label}</span>
                    </div>
                  `).join('');
                })()}
              </div>
            </div>
            
            <div class="grid-2">
              <div class="field">
                <div class="field-label">Standard of Cleanliness</div>
                <div class="field-value">${report.cleanlinessStandard || 'N/A'}</div>
              </div>
              <div class="field">
                <div class="field-label">Issues Observed</div>
                <div class="field-value">${report.cleaningIssues || 'None'}</div>
              </div>
            </div>
            
            <div class="field">
              <div class="field-label">Corrective Action Taken / Required</div>
              <div class="field-value">${report.cleaningCorrectiveAction || 'N/A'}</div>
            </div>
          </div>
          
          <!-- Section 3: Maintenance & Repairs -->
          <div class="section">
            <h2 class="section-title">3. MAINTENANCE & REPAIRS</h2>
            
            <div class="subsection">
              <h3 class="subsection-title">A. Preventive / Routine Maintenance</h3>
              ${(() => {
                const tasks = parseJSON(report.preventiveTasks) || [];
                if (tasks.length === 0) {
                  return '<div class="field-value">No preventive maintenance tasks today</div>';
                }
                
                return createDynamicTable(tasks, ['Task Performed', 'Area / Unit', 'Status']);
              })()}
            </div>
            
            <div class="subsection">
              <h3 class="subsection-title">B. Repairs</h3>
              ${(() => {
                const repairs = parseJSON(report.repairs) || [];
                if (repairs.length === 0) {
                  return '<div class="field-value">No repairs reported today</div>';
                }
                
                return createDynamicTable(repairs, ['Fault / Issue', 'Area / Unit', 'Contractor / Technician', 'Status', 'Estimated Cost (KES)']);
              })()}
            </div>
          </div>
          
          <!-- Section 4: Tenants' Complaints & Requests -->
          <div class="section">
            <h2 class="section-title">4. TENANTS' COMPLAINTS & REQUESTS</h2>
            ${(() => {
              const complaints = parseJSON(report.tenantComplaints) || [];
              if (complaints.length === 0) {
                return '<div class="field-value">No tenant complaints or requests today</div>';
              }
              
              return createDynamicTable(complaints, ['Tenant / Unit', 'Complaint / Request', 'Action Taken', 'Status', 'Remarks']);
            })()}
          </div>
          
          <!-- Section 5: Landlord / Owner Instructions -->
          <div class="section">
            <h2 class="section-title">5. LANDLORD / OWNER INSTRUCTIONS</h2>
            <div class="field">
              <div class="field-label">Instruction Issued Today</div>
              <div class="field-value">${report.landlordInstructions || 'None'}</div>
            </div>
            <div class="field">
              <div class="field-label">Action Taken</div>
              <div class="field-value">${report.landlordActionTaken || 'N/A'}</div>
            </div>
            <div class="field">
              <div class="field-label">Status</div>
              <div class="field-value">
                ${report.landlordStatus ? `
                  <span class="status status-${report.landlordStatus.toLowerCase().replace(' ', '-')}">
                    ${report.landlordStatus}
                  </span>
                ` : 'N/A'}
              </div>
            </div>
          </div>
          
          <!-- Section 6: Leads & Enquiries -->
          <div class="section">
            <h2 class="section-title">6. LEADS & ENQUIRIES (LETTING / SALES)</h2>
            <div class="grid-3">
              <div class="field">
                <div class="field-label">New Enquiries Received</div>
                <div class="field-value">${report.newEnquiries || 0}</div>
              </div>
              <div class="field">
                <div class="field-label">Source</div>
                <div class="field-value">${report.enquirySource || 'N/A'}</div>
              </div>
              <div class="field">
                <div class="field-label">Site Visits Conducted</div>
                <div class="field-value">${report.siteVisits || 0}</div>
              </div>
            </div>
            <div class="field">
              <div class="field-label">Unit(s) Enquired</div>
              <div class="field-value">${report.unitsEnquired || 'N/A'}</div>
            </div>
            <div class="field">
              <div class="field-label">Follow-up Action Taken</div>
              <div class="field-value">${report.followUpAction || 'N/A'}</div>
            </div>
          </div>
          
          <!-- Section 7: Bookings & Occupancy -->
          <div class="section">
            <h2 class="section-title">7. BOOKINGS & OCCUPANCY</h2>
            <div class="grid-4">
              <div class="field">
                <div class="field-label">Bookings Received Today</div>
                <div class="field-value">${report.bookingsReceived || 'None'}</div>
              </div>
              <div class="field">
                <div class="field-label">Confirmed</div>
                <div class="field-value">${report.bookingsConfirmed || 0}</div>
              </div>
              <div class="field">
                <div class="field-label">Cancelled</div>
                <div class="field-value">${report.bookingsCancelled || 0}</div>
              </div>
              <div class="field">
                <div class="field-label">Current Occupancy Level</div>
                <div class="field-value">${report.occupancyLevel ? `${report.occupancyLevel}%` : 'N/A'}</div>
              </div>
            </div>
            <div class="field">
              <div class="field-label">Remarks</div>
              <div class="field-value">${report.bookingsRemarks || 'N/A'}</div>
            </div>
          </div>
          
          <!-- Section 9: Utilities & Services Status -->
          <div class="section">
            <h2 class="section-title">9. UTILITIES & SERVICES STATUS</h2>
            <div class="grid-3">
              <div class="field">
                <div class="field-label">Water</div>
                <div class="field-value">${report.waterStatus || 'Normal'}</div>
              </div>
              <div class="field">
                <div class="field-label">Electricity</div>
                <div class="field-value">${report.electricityStatus || 'Normal'}</div>
              </div>
              <div class="field">
                <div class="field-label">Internet / CCTV / Lifts</div>
                <div class="field-value">${report.otherServicesStatus || 'Normal'}</div>
              </div>
            </div>
            <div class="field">
              <div class="field-label">Remarks</div>
              <div class="field-value">${report.utilitiesRemarks || 'N/A'}</div>
            </div>
          </div>
          
          <!-- Section 10: General Observations & Risks -->
          <div class="section">
            <h2 class="section-title">10. GENERAL OBSERVATIONS & RISKS</h2>
            <div class="field">
              <div class="field-label">Operational Challenges Identified</div>
              <div class="field-value">${report.operationalChallenges || 'None'}</div>
            </div>
            <div class="field">
              <div class="field-label">Health & Safety Issues</div>
              <div class="field-value">${report.healthSafetyIssues || 'None'}</div>
            </div>
          </div>
          
          <!-- Signature Section -->
          <div class="signature-section">
            <div class="signature-grid">
              <div class="signature-box">
                <div>Property Manager Signature</div>
                <div class="signature-line"></div>
                <div><strong>${report.preparedBy || 'N/A'}</strong></div>
                <div>Property Manager</div>
                <div style="margin-top: 10px;">Date: ${formatDate(report.createdAt)}</div>
              </div>
              
              <div class="signature-box">
                <div>Reviewed By (Landlord / Supervisor)</div>
                <div class="signature-line"></div>
                <div><strong>${report.property?.landlord?.name || 'N/A'}</strong></div>
                <div>${report.property?.landlord ? 'Landlord' : 'Supervisor'}</div>
                <div style="margin-top: 10px;">Date: ________________</div>
              </div>
            </div>
          </div>
          
          <!-- Footer -->
          <div class="footer">
            <p>Generated on ${formatDate(new Date())} at ${formatTime(new Date())}</p>
            <p>Report ID: ${report.id} | Status: ${report.status}</p>
            <p class="no-print">This is a system-generated report. Do not respond to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // Generate PDF for existing report
  static async generateReportPDF(report) {
    const htmlContent = this.generateHTMLTemplate(report);
    return await generatePDF(htmlContent);
  }
}