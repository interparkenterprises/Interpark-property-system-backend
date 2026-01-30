import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import sizeOf from 'image-size';
import { fileURLToPath } from 'url';

// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate PDF for activation request with letterhead and footer
 * @param {Object} activation - Activation request data with relations
 * @returns {Buffer} PDF buffer
 */
export async function generateActivationPDF(activation) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        margin: 50,
        size: 'A4'
      });
      const chunks = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      /* =====================================================
         LETTERHEAD IMAGE HANDLING
      ====================================================== */

      const projectRoot = process.cwd();
      const possiblePaths = [
        path.join(projectRoot, 'src', 'letterHeads', 'letterhead.png'),
        path.join(projectRoot, 'letterHeads', 'letterhead.png'),
        path.join(__dirname, 'letterHeads', 'letterhead.png'),
        path.join(__dirname, '..', 'letterHeads', 'letterhead.png'),
        path.join(__dirname, '..', 'src', 'letterHeads', 'letterhead.png'),
      ];

      let letterheadPath = null;
      let imageLoaded = false;
      
      for (const possiblePath of possiblePaths) {
        try {
          if (fs.existsSync(possiblePath)) {
            const stats = fs.statSync(possiblePath);
            if (stats.size > 0) {
              letterheadPath = possiblePath;
              console.log(`✓ Letterhead found: ${possiblePath}`);
              break;
            }
          }
        } catch (err) {
          console.warn(`Path check failed for ${possiblePath}:`, err.message);
        }
      }

      if (letterheadPath) {
        try {
          const imageBuffer = fs.readFileSync(letterheadPath);
          const dimensions = sizeOf(imageBuffer);

          const maxWidth = doc.page.width - 100;
          const scale = maxWidth / dimensions.width;
          const scaledHeight = dimensions.height * scale;
          const finalHeight = Math.min(scaledHeight, 70);
          const finalWidth = finalHeight !== scaledHeight
            ? (dimensions.width * finalHeight) / dimensions.height
            : maxWidth;

          const xPosition = 50 + (maxWidth - finalWidth) / 2;

          doc.image(imageBuffer, xPosition, 30, {
            width: finalWidth,
          });

          doc.y = 30 + finalHeight + 15;
          imageLoaded = true;

          console.log('✓ Letterhead rendered');
        } catch (err) {
          console.warn('✗ Letterhead failed to load:', err.message);
        }
      }
      
      // Fallback if no image loaded
      if (!imageLoaded) {
        console.warn('Using fallback text header');
        doc.y = 40;
        doc.fontSize(16)
          .fillColor('#000000')
          .font('Helvetica-Bold')
          .text('INTERPARK ENTERPRISES LIMITED', { 
            align: 'center'
          });
        doc.moveDown(0.5);
      }

      // ===========================================
      // HELPER FUNCTIONS
      // ===========================================
      
      const formatDate = (date) => {
        if (!date) return '…………………………';
        const d = new Date(date);
        const day = d.getDate().toString().padStart(2, '0');
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = monthNames[d.getMonth()];
        const year = d.getFullYear();
        return `${day} ${month} ${year}`;
      };

      const formatTime = (time) => {
        if (!time) return '…………………………';
        
        // Clean the time string
        let cleanedTime = time.trim().toUpperCase();
        
        // Check if time already contains AM/PM
        const hasAMPM = cleanedTime.includes('AM') || cleanedTime.includes('PM');
        
        if (hasAMPM) {
          // Time already has AM/PM - just clean any duplicates
          // Remove duplicate AM/PM at the end (e.g., "9:00 AM AM" -> "9:00 AM")
          cleanedTime = cleanedTime.replace(/(AM|PM)\s+(AM|PM)$/i, '$1');
          return cleanedTime;
        }
        
        // If time is in HH:MM format without AM/PM, convert to 12-hour with AM/PM
        if (cleanedTime.includes(':')) {
          const [hours, minutes] = cleanedTime.split(':');
          const hour = parseInt(hours);
          const ampm = hour >= 12 ? 'PM' : 'AM';
          const hour12 = hour % 12 || 12;
          return `${hour12}:${minutes} ${ampm}`;
        }
        
        return cleanedTime;
      };

      const formatValue = (value) => {
        if (value === null || value === undefined) return null;
        if (typeof value === 'string' && value.trim() === '') return null;
        return value;
      };

      const formatBoolean = (value) => {
        return value ? 'Yes' : 'No';
      };

      const formatCurrency = (value) => {
        if (!value) return 'KES 0.00';
        return `KES ${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      };

      // Updated drawUnderline - only draws if value is null/empty
      const drawUnderline = (x, y, width, hasValue) => {
        if (!hasValue) {
          doc.moveTo(x, y).lineTo(x + width, y).stroke();
        }
      };

      // Helper function to draw a table
      const drawTable = (x, y, width, rows) => {
        const rowHeight = 20;
        const col1Width = width * 0.6;
        const col2Width = width * 0.4;
        
        let currentY = y;
        
        rows.forEach((row, index) => {
          // Draw cell borders
          doc.rect(x, currentY, col1Width, rowHeight).stroke();
          doc.rect(x + col1Width, currentY, col2Width, rowHeight).stroke();
          
          // Draw text in cells
          doc.fontSize(9)
             .font('Helvetica')
             .fillColor('#000000')
             .text(row.label, x + 5, currentY + 6, {
               width: col1Width - 10,
               align: 'left'
             });
          
          doc.text(row.value, x + col1Width + 5, currentY + 6, {
            width: col2Width - 10,
            align: 'left'
          });
          
          currentY += rowHeight;
        });
        
        return currentY;
      };

      // Helper function to wrap text into multiple lines with numbering
      const wrapTextWithNumbering = (text, number, x, startY, maxWidth, lineSpacing = 13) => {
        const prefix = `${number}. `;
        const availableWidth = maxWidth - doc.widthOfString(prefix);
        
        // Split text into words
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        
        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const testWidth = doc.widthOfString(testLine);
          
          if (testWidth <= availableWidth) {
            currentLine = testLine;
          } else {
            lines.push(currentLine);
            currentLine = word;
          }
        }
        
        if (currentLine) {
          lines.push(currentLine);
        }
        
        // Draw lines with proper numbering
        let currentY = startY;
        
        for (let i = 0; i < lines.length; i++) {
          if (i === 0) {
            // First line includes the number
            doc.text(`${prefix}${lines[i]}`, x, currentY);
          } else {
            // Subsequent lines are indented
            const indent = doc.widthOfString(prefix);
            doc.text(lines[i], x + indent, currentY);
          }
          currentY += lineSpacing;
        }
        
        return currentY;
      };

      // ===========================================
      // VAT CALCULATION LOGIC
      // ===========================================
      
      const calculateCosts = () => {
        const licenseFeePerDay = activation.licenseFeePerDay || activation.proposedBudget || 0;
        const numberOfDays = activation.numberOfDays || 0;
        const vatType = activation.vatType || 'EXCLUSIVE'; // Default to EXCLUSIVE
        const vatRate = 0.16;
        
        let subTotal = 0;
        let vatAmount = 0;
        let totalAmount = 0;
        let displayLicenseFee = licenseFeePerDay;
        
        switch (vatType) {
          case 'INCLUSIVE':
            // License fee already includes VAT
            totalAmount = licenseFeePerDay * numberOfDays;
            subTotal = totalAmount / (1 + vatRate);
            vatAmount = totalAmount - subTotal;
            break;
            
          case 'EXCLUSIVE':
            // VAT needs to be added
            subTotal = licenseFeePerDay * numberOfDays;
            vatAmount = subTotal * vatRate;
            totalAmount = subTotal + vatAmount;
            break;
            
          case 'NOT_APPLICABLE':
            // No VAT
            subTotal = licenseFeePerDay * numberOfDays;
            vatAmount = 0;
            totalAmount = subTotal;
            break;
            
          default:
            // Fallback to EXCLUSIVE
            subTotal = licenseFeePerDay * numberOfDays;
            vatAmount = subTotal * vatRate;
            totalAmount = subTotal + vatAmount;
        }
        
        return {
          licenseFeePerDay: displayLicenseFee,
          numberOfDays,
          subTotal,
          vatAmount,
          totalAmount,
          vatType
        };
      };

      const costs = calculateCosts();

      // ===========================================
      // DOCUMENT TITLE
      // ===========================================
      
      doc.fontSize(12)
         .fillColor('#000000')
         .font('Helvetica-Bold')
         .text('APPLICATION FOR ACTIVATION/EXHIBITION SPACE', { 
           align: 'center'
         });
      
      doc.moveDown(1);

      // ===========================================
      // PART 1: CLIENT INFORMATION
      // ===========================================
      
      doc.fontSize(10)
         .font('Helvetica-Bold')
         .text('PART 1 – CLIENT INFORMATION:', 50, doc.y);
      
      doc.moveDown(0.5);

      let currentY = doc.y;
      const leftMargin = 50;
      const fieldSpacing = 16;

      // Company Name
      const companyName = formatValue(activation.companyName);
      doc.fontSize(9).font('Helvetica').text('Company Name', leftMargin, currentY);
      drawUnderline(leftMargin + 85, currentY + 10, 350, companyName);
      if (companyName) {
        doc.text(companyName, leftMargin + 90, currentY);
      }
      currentY += fieldSpacing;

      // Postal address - SIMPLIFIED: Show as "P.O Box [number]" if numeric
      let postalAddress = formatValue(activation.postalAddress);
      if (postalAddress && /^\d+$/.test(postalAddress.trim())) {
        postalAddress = `P.O Box ${postalAddress}`;
      }
      doc.text('Postal address', leftMargin, currentY);
      drawUnderline(leftMargin + 85, currentY + 10, 395, postalAddress);
      if (postalAddress) {
        doc.text(postalAddress, leftMargin + 90, currentY);
      }
      currentY += fieldSpacing;

      // Telephone
      const telephone = formatValue(activation.telephone);
      doc.text('Telephone:', leftMargin, currentY);
      drawUnderline(leftMargin + 60, currentY + 10, 395, telephone);
      if (telephone) {
        doc.text(telephone, leftMargin + 65, currentY);
      }
      currentY += fieldSpacing;

      // Contact Person
      const contactPerson = formatValue(activation.contactPerson);
      doc.text('Contact Person:', leftMargin, currentY);
      drawUnderline(leftMargin + 90, currentY + 10, 365, contactPerson);
      if (contactPerson) {
        doc.text(contactPerson, leftMargin + 95, currentY);
      }
      currentY += fieldSpacing;

      // Designation/Title
      const designation = formatValue(activation.designation);
      doc.text('Designation/Title:', leftMargin, currentY);
      drawUnderline(leftMargin + 95, currentY + 10, 360, designation);
      if (designation) {
        doc.text(designation, leftMargin + 100, currentY);
      }
      currentY += fieldSpacing;

      // Email
      const email = formatValue(activation.email);
      doc.text('Email:', leftMargin, currentY);
      drawUnderline(leftMargin + 40, currentY + 10, 420, email);
      if (email) {
        doc.text(email, leftMargin + 45, currentY);
      }
      currentY += fieldSpacing;

      // Mobile No
      const mobileNo = formatValue(activation.mobileNo);
      doc.text('Mobile No:', leftMargin, currentY);
      drawUnderline(leftMargin + 60, currentY + 10, 395, mobileNo);
      if (mobileNo) {
        doc.text(mobileNo, leftMargin + 65, currentY);
      }
      currentY += fieldSpacing + 8;

      doc.y = currentY;

      // ===========================================
      // PART 2: DESCRIPTION OF ACTIVATION/EXHIBITION (WITH TABLE)
      // ===========================================
      
      doc.fontSize(10)
         .font('Helvetica-Bold')
         .text('PART 2 – DESCRIPTION OF THE ACTIVATION/EXHIBITION:', leftMargin, doc.y);
      
      doc.moveDown(0.5);
      currentY = doc.y;

      // Table for dates and times
      doc.fontSize(9)
         .font('Helvetica-Bold')
         .text('Intended dates and time of the activation', leftMargin, currentY);
      currentY += 15;

      const dateRows = [
        { label: 'Activation/Exhibition Start Date:', value: formatDate(activation.startDate) },
        { label: 'Set Up Time', value: formatTime(activation.setupTime) },
        { label: 'Activation/Exhibition End Date:', value: formatDate(activation.endDate) },
        { label: 'Tear Down Time:', value: formatTime(activation.tearDownTime) }
      ];

      currentY = drawTable(leftMargin, currentY, 495, dateRows);
      currentY += 12;

      // Nature of activation - FIXED to handle multiline text
      doc.font('Helvetica-Bold').text('Nature of the activation:', leftMargin, currentY);
      currentY += 15;

      doc.font('Helvetica');
      
      // Point 1: Activation Type
      const activationType = formatValue(activation.activationType) || '…………………………';
      doc.text(`1. ${activationType}`, leftMargin, currentY);
      currentY += 13;
      
      // Point 2: Description - Use the new wrap function
      const description = formatValue(activation.description) || 'Distribution details';
      currentY = wrapTextWithNumbering(description, 2, leftMargin, currentY, 495, 13);
      
      // Point 3: PA System
      const paSystemText = activation.soundSystem ? 'With PA system' : 'No PA system';
      doc.text(`3. ${paSystemText}`, leftMargin, currentY);
      currentY += 20;

      doc.y = currentY;

      // ===========================================
      // PART 3: COST OF ACTIVATION/EXHIBITION (WITH TABLE)
      // ===========================================
      
      // Check if we need a new page
      if (doc.y > doc.page.height - 250) {
        doc.addPage();
        doc.y = 50;
      }
      
      doc.fontSize(10)
         .font('Helvetica-Bold')
         .text('PART 3 – COST OF ACTIVATION/EXHIBITION:', leftMargin, doc.y);
      
      doc.moveDown(0.5);
      currentY = doc.y;

      // Cost table with VAT handling
      const costRows = [
        { label: 'License Fee per day:', value: formatCurrency(costs.licenseFeePerDay) },
        { label: 'No. of days:', value: costs.numberOfDays.toString() },
        { label: 'Sub Total:', value: formatCurrency(costs.subTotal) }
      ];

      // Add VAT row based on vatType
      if (costs.vatType === 'NOT_APPLICABLE') {
        costRows.push({ label: 'VAT:', value: 'Not Applicable' });
      } else {
        const vatLabel = costs.vatType === 'INCLUSIVE' ? 'VAT (16%) - Inclusive:' : 'VAT (16%):';
        costRows.push({ label: vatLabel, value: formatCurrency(costs.vatAmount) });
      }

      costRows.push({ label: 'Total:', value: formatCurrency(costs.totalAmount) });

      currentY = drawTable(leftMargin, currentY, 495, costRows);
      currentY += 12;

      // Payment Details
      doc.font('Helvetica-Bold').text('Payment Details:', leftMargin, currentY);
      currentY += 15;

      doc.font('Helvetica');
      
      // Bank name
      const bankName = formatValue(activation.bankName);
      doc.text('Bank name:', leftMargin, currentY);
      drawUnderline(leftMargin + 70, currentY + 10, 200, bankName);
      if (bankName) {
        doc.text(bankName, leftMargin + 75, currentY);
      }
      currentY += fieldSpacing;

      // Branch
      const bankBranch = formatValue(activation.bankBranch);
      doc.text('Branch:', leftMargin, currentY);
      drawUnderline(leftMargin + 50, currentY + 10, 200, bankBranch);
      if (bankBranch) {
        doc.text(bankBranch, leftMargin + 55, currentY);
      }
      currentY += fieldSpacing;

      // A/c name
      const accountName = formatValue(activation.accountName);
      doc.text('A/c name:', leftMargin, currentY);
      drawUnderline(leftMargin + 65, currentY + 10, 200, accountName);
      if (accountName) {
        doc.text(accountName, leftMargin + 70, currentY);
      }
      currentY += fieldSpacing;

      // A/c no
      const accountNumber = formatValue(activation.accountNumber);
      doc.text('A/c no.', leftMargin, currentY);
      drawUnderline(leftMargin + 50, currentY + 10, 200, accountNumber);
      if (accountNumber) {
        doc.text(accountNumber, leftMargin + 55, currentY);
      }
      currentY += fieldSpacing;

      // Swift Code
      const swiftCode = formatValue(activation.swiftCode);
      doc.text('Swift Code:', leftMargin, currentY);
      drawUnderline(leftMargin + 70, currentY + 10, 200, swiftCode);
      if (swiftCode) {
        doc.text(swiftCode, leftMargin + 75, currentY);
      }
      currentY += fieldSpacing + 5;

      // Mpesa Payment
      doc.font('Helvetica-Bold').text('Mpesa Payment:', leftMargin, currentY);
      currentY += 15;

      doc.font('Helvetica');
      
      // Paybill Number
      const paybillNumber = formatValue(activation.paybillNumber);
      doc.text('Paybill Number:', leftMargin, currentY);
      drawUnderline(leftMargin + 90, currentY + 10, 100, paybillNumber);
      if (paybillNumber) {
        doc.text(paybillNumber, leftMargin + 95, currentY);
      }
      
      // Account
      const mpesaAccount = formatValue(activation.mpesaAccount);
      doc.text('Account:', leftMargin + 230, currentY);
      drawUnderline(leftMargin + 275, currentY + 10, 160, mpesaAccount);
      if (mpesaAccount) {
        doc.text(mpesaAccount, leftMargin + 280, currentY);
      }
      currentY += fieldSpacing + 8;

      // Payment Note
      doc.fontSize(8)
         .font('Helvetica-Bold')
         .fillColor('#000000')
         .text('NB: FULL PAYMENT should be made prior to the activation/exhibition space being', leftMargin, currentY);
      currentY += 10;
      doc.text('reserved. Payments once made are NOT refundable.', leftMargin, currentY);
      currentY += 25;

      doc.y = currentY;

      // ===========================================
      // CHECK IF WE NEED NEW PAGE FOR RULES
      // ===========================================
      
      // Check if we have enough space for rules (estimate)
      const rulesHeight = 11 * 40;
      if (doc.y + rulesHeight > doc.page.height - 50) {
        doc.addPage();
        doc.y = 50;
      }

      // ===========================================
      // PART 4: RULES & REGULATIONS
      // ===========================================
      
      doc.fontSize(10)
         .font('Helvetica-Bold')
         .fillColor('#000000')
         .text('PART 4- EXHIBITION / ACTIVATION RULES & REGULATIONS', leftMargin, doc.y);
      
      doc.moveDown(0.8);

      const rules = [
        'You shall be required to obtain the requisite permits, licenses or approvals from the competent authorities.',
        'You shall be required to declare any third parties and / or co-sponsors participating in a promotion at the time of the application hereof and or prior to the date of the scheduled activation.',
        'You shall be required to procure and secure your own exhibition materials at your own cost, and the Licensor shall not be liable for any loss or damage of such material howsoever caused.',
        'Any brochures and promotional material will be distributed from the stand in the designated area only.',
        'You shall not obstruct the entrance of the Mall or any of the shops within the Mall to ensure smooth flow of traffic.',
        'You shall not obstruct the entrances and or windows shops within the Mall.',
        'The Management reserves the right to inspect the exhibition area at any time without any prior notice.',
        'You shall not use any sound system in the exhibition without prior approval of the Management of the Mall.',
        'You shall be required to assemble your exhibition area not earlier than 9pm and disassemble it by 6pm on the last day of the exhibition.',
        'You shall not undertake any political activities during the exhibition in default of which the Licensor may withdraw the License and no License Fee paid but not accrued shall be refundable.',
        'You shall assume full responsibility for any loss or damage to the property of the Licensor or any third party or injury of any person howsoever caused during the exhibition, and shall on a full and unqualified basis indemnify the Licensor for any loss, damage, claim, suit judgement, decree or order howsoever arising from such loss, damage or injury.'
      ];

      doc.fontSize(8).font('Helvetica').fillColor('#000000');

      rules.forEach((rule, index) => {
        // Check if we need a new page
        if (doc.y > doc.page.height - 60) {
          doc.addPage();
          doc.y = 50;
        }

        const ruleText = `${index + 1}. ${rule}`;
        doc.text(ruleText, leftMargin, doc.y, {
          width: 500,
          align: 'justify',
          lineGap: 2
        });
        doc.moveDown(0.5);
      });

      doc.moveDown(0.8);

      // ===========================================
      // ACCEPTANCE SECTION
      // ===========================================
      
      // Check if we need a new page for acceptance section
      if (doc.y > doc.page.height - 150) {
        doc.addPage();
        doc.y = 50;
      }
      
      doc.fontSize(9)
         .font('Helvetica-Bold')
         .fillColor('#000000')
         .text('We/I accept and undertake to fully comply with the above terms.', leftMargin, doc.y);
      
      doc.moveDown(0.8);

      currentY = doc.y;
      doc.fontSize(9).font('Helvetica');

      // Acceptance fields - Name
      const acceptanceName = formatValue(activation.contactPerson);
      doc.text('Name:', leftMargin, currentY);
      drawUnderline(leftMargin + 40, currentY + 10, 445, acceptanceName);
      if (acceptanceName) {
        doc.text(acceptanceName, leftMargin + 45, currentY);
      }
      currentY += fieldSpacing;

      // Two columns for title and company
      const acceptanceDesignation = formatValue(activation.designation);
      doc.text('Your Title / Post:', leftMargin, currentY);
      drawUnderline(leftMargin + 85, currentY + 10, 140, acceptanceDesignation);
      if (acceptanceDesignation) {
        doc.text(acceptanceDesignation, leftMargin + 90, currentY);
      }
      
      const acceptanceCompany = formatValue(activation.companyName);
      doc.text('Company Name:', leftMargin + 240, currentY);
      drawUnderline(leftMargin + 325, currentY + 10, 140, acceptanceCompany);
      if (acceptanceCompany) {
        doc.text(acceptanceCompany, leftMargin + 330, currentY);
      }
      currentY += fieldSpacing;

      // Two columns for email and mobile
      const acceptanceEmail = formatValue(activation.email);
      doc.text('E-Mail Address:', leftMargin, currentY);
      drawUnderline(leftMargin + 85, currentY + 10, 140, acceptanceEmail);
      if (acceptanceEmail) {
        doc.text(acceptanceEmail, leftMargin + 90, currentY);
      }
      
      const acceptanceMobile = formatValue(activation.mobileNo);
      doc.text('Mobile No:', leftMargin + 240, currentY);
      drawUnderline(leftMargin + 290, currentY + 10, 175, acceptanceMobile);
      if (acceptanceMobile) {
        doc.text(acceptanceMobile, leftMargin + 295, currentY);
      }
      currentY += fieldSpacing + 8;

      // Signature and Date
      doc.text('Signature: …..………………………………', leftMargin, currentY);
      doc.text(`Date: ${formatDate(activation.signatureDate || activation.createdAt)}`, leftMargin + 230, currentY);
      currentY += fieldSpacing + 12;

      doc.y = currentY;

      // ===========================================
      // FOR MANAGEMENT USE ONLY
      // ===========================================
      
      // Check if we need a new page
      if (doc.y > doc.page.height - 100) {
        doc.addPage();
        doc.y = 50;
      }
      
      doc.fontSize(9)
         .font('Helvetica-Bold')
         .fillColor('#000000')
         .text('FOR MANAGEMENT USE ONLY:-', leftMargin, doc.y);
      
      doc.moveDown(0.5);
      currentY = doc.y;

      doc.fontSize(9).font('Helvetica');

      // Management fields - Name
      const managerName = formatValue(activation.manager?.name);
      doc.text('Name:', leftMargin, currentY);
      drawUnderline(leftMargin + 40, currentY + 10, 445, managerName);
      if (managerName) {
        doc.text(managerName, leftMargin + 45, currentY);
      }
      currentY += fieldSpacing;

      // Designation and Signature
      const managerDesignation = formatValue(activation.managerDesignation || activation.manager?.role);
      doc.text('Designation/Title:', leftMargin, currentY);
      drawUnderline(leftMargin + 95, currentY + 10, 160, managerDesignation);
      if (managerDesignation) {
        doc.text(managerDesignation, leftMargin + 100, currentY);
      }
      
      doc.text('Signature:', leftMargin + 270, currentY);
      drawUnderline(leftMargin + 320, currentY + 10, 145, false); // Always show signature line
      currentY += fieldSpacing;

      // Date and Paid status
      const approvalDate = activation.approvedAt || activation.updatedAt;
      doc.text('Date:', leftMargin, currentY);
      drawUnderline(leftMargin + 30, currentY + 10, 150, approvalDate);
      if (approvalDate) {
        doc.text(formatDate(approvalDate), leftMargin + 35, currentY);
      }
      
      // Paid status
      const paidStatus = activation.paymentStatus === 'PAID' || activation.status === 'APPROVED';
      doc.text('Paid: Yes:', leftMargin + 220, currentY);
      drawUnderline(leftMargin + 270, currentY + 10, 50, false);
      if (paidStatus) doc.text('✓', leftMargin + 285, currentY);
      
      doc.text('No:', leftMargin + 340, currentY);
      drawUnderline(leftMargin + 365, currentY + 10, 50, false);
      if (!paidStatus) doc.text('✓', leftMargin + 380, currentY);

      currentY += 30;
      doc.y = currentY;

      // ===========================================
      // END DOCUMENT
      // ===========================================
      
      doc.end();
    } catch (error) {
      console.error('Activation PDF Generation Error:', error);
      reject(error);
    }
  });
}

/**
 * Generate HTML template for activation request (legacy/email version)
 * @param {Object} activation - Activation request data with relations
 * @returns {string} HTML content
 */
export const generateActivationHTML = (activation) => {
  const formatDate = (date) => {
    if (!date) return '…………………………';
    const d = new Date(date);
    const day = d.getDate().toString().padStart(2, '0');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[d.getMonth()];
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  };

  const formatTime = (time) => {
    return time || '…………………………';
  };

  const formatValue = (value) => {
    return value || null;
  };

  const hasValue = (value) => {
    return value !== null && value !== undefined && value !== '';
  };

  const formatBoolean = (value) => {
    return value ? 'Yes' : 'No';
  };

  const formatCurrency = (value) => {
    if (!value) return 'KES 0.00';
    return `KES ${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // VAT Calculation Logic for HTML
  const calculateCosts = () => {
    const licenseFeePerDay = activation.licenseFeePerDay || activation.proposedBudget || 0;
    const numberOfDays = activation.numberOfDays || 0;
    const vatType = activation.vatType || 'EXCLUSIVE';
    const vatRate = 0.16;
    
    let subTotal = 0;
    let vatAmount = 0;
    let totalAmount = 0;
    
    switch (vatType) {
      case 'INCLUSIVE':
        totalAmount = licenseFeePerDay * numberOfDays;
        subTotal = totalAmount / (1 + vatRate);
        vatAmount = totalAmount - subTotal;
        break;
        
      case 'EXCLUSIVE':
        subTotal = licenseFeePerDay * numberOfDays;
        vatAmount = subTotal * vatRate;
        totalAmount = subTotal + vatAmount;
        break;
        
      case 'NOT_APPLICABLE':
        subTotal = licenseFeePerDay * numberOfDays;
        vatAmount = 0;
        totalAmount = subTotal;
        break;
        
      default:
        subTotal = licenseFeePerDay * numberOfDays;
        vatAmount = subTotal * vatRate;
        totalAmount = subTotal + vatAmount;
    }
    
    return {
      licenseFeePerDay,
      numberOfDays,
      subTotal,
      vatAmount,
      totalAmount,
      vatType
    };
  };

  const costs = calculateCosts();
  const paidStatus = activation.paymentStatus === 'PAID' || activation.status === 'APPROVED';

  // Helper to format postal address
  const getFormattedPostalAddress = () => {
    const postal = formatValue(activation.postalAddress);
    if (postal && /^\d+$/.test(postal.trim())) {
      return `P.O Box ${postal}`;
    }
    return postal;
  };

  // Generate VAT row label
  const getVATLabel = () => {
    if (costs.vatType === 'NOT_APPLICABLE') {
      return 'VAT:';
    } else if (costs.vatType === 'INCLUSIVE') {
      return 'VAT (16%) - Inclusive:';
    } else {
      return 'VAT (16%):';
    }
  };

  const getVATValue = () => {
    if (costs.vatType === 'NOT_APPLICABLE') {
      return 'Not Applicable';
    } else {
      return formatCurrency(costs.vatAmount);
    }
  };

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Activation Request - ${activation.requestNumber}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: Arial, sans-serif;
      font-size: 10pt;
      line-height: 1.3;
      color: #000;
      padding: 30px;
      max-width: 210mm;
      margin: 0 auto;
    }

    .letterhead {
      text-align: center;
      margin-bottom: 20px;
      padding-bottom: 15px;
      border-bottom: 1px solid #000;
    }

    .letterhead-title {
      font-size: 16px;
      font-weight: bold;
      text-transform: uppercase;
    }

    .document-title {
      text-align: center;
      font-size: 12px;
      font-weight: bold;
      text-transform: uppercase;
      margin-bottom: 15px;
    }

    .section-title {
      font-size: 10px;
      font-weight: bold;
      text-transform: uppercase;
      margin: 15px 0 10px 0;
    }

    .field-row {
      margin-bottom: 10px;
      display: flex;
      align-items: baseline;
    }

    .field-label {
      font-weight: normal;
      margin-right: 8px;
      min-width: 120px;
    }

    .field-value {
      flex-grow: 1;
      padding: 0 5px;
      min-height: 16px;
    }

    .field-value.has-value {
      border-bottom: none;
    }

    .field-value.no-value {
      border-bottom: 1px solid #000;
    }

    .two-col {
      display: flex;
      gap: 15px;
    }

    .two-col .field-row {
      flex: 1;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
      font-size: 9pt;
    }

    table td {
      border: 1px solid #000;
      padding: 6px;
    }

    table td:first-child {
      width: 60%;
    }

    table td:last-child {
      width: 40%;
    }

    .nature-list {
      margin-left: 15px;
      margin-top: 8px;
    }

    .nature-list div {
      margin-bottom: 6px;
      font-size: 9pt;
      line-height: 1.3;
    }

    .nature-list div.multi-line {
      margin-bottom: 12px;
    }

    .payment-note {
      font-size: 8px;
      font-weight: bold;
      margin: 10px 0;
      padding: 8px;
      background-color: #f9f9f9;
      border: 1px solid #000;
    }

    .rules-list {
      margin-left: 15px;
      margin-top: 8px;
    }

    .rules-list li {
      margin-bottom: 8px;
      text-align: justify;
      font-size: 8pt;
      line-height: 1.2;
    }

    .acceptance-section {
      margin: 20px 0;
      padding: 15px;
      border: 1px solid #000;
      font-size: 9pt;
    }

    .management-section {
      margin: 20px 0;
      padding: 15px;
      border: 1px solid #000;
      background-color: #f5f5f5;
      font-size: 9pt;
    }

    @media print {
      body {
        padding: 15px;
      }
    }
  </style>
</head>
<body>
  <div class="letterhead">
    <div class="letterhead-title">INTERPARK ENTERPRISES LIMITED</div>
  </div>

  <div class="document-title">
    APPLICATION FOR ACTIVATION/EXHIBITION SPACE
  </div>

  <!-- PART 1: CLIENT INFORMATION -->
  <div class="section-title">PART 1 – CLIENT INFORMATION:</div>
  
  <div class="field-row">
    <span class="field-label">Company Name</span>
    <span class="field-value ${hasValue(activation.companyName) ? 'has-value' : 'no-value'}">
      ${formatValue(activation.companyName) || ''}
    </span>
  </div>

  <div class="field-row">
    <span class="field-label">Postal address</span>
    <span class="field-value ${hasValue(getFormattedPostalAddress()) ? 'has-value' : 'no-value'}">
      ${getFormattedPostalAddress() || ''}
    </span>
  </div>

  <div class="field-row">
    <span class="field-label">Telephone:</span>
    <span class="field-value ${hasValue(activation.telephone) ? 'has-value' : 'no-value'}">
      ${formatValue(activation.telephone) || ''}
    </span>
  </div>

  <div class="field-row">
    <span class="field-label">Contact Person:</span>
    <span class="field-value ${hasValue(activation.contactPerson) ? 'has-value' : 'no-value'}">
      ${formatValue(activation.contactPerson) || ''}
    </span>
  </div>

  <div class="field-row">
    <span class="field-label">Designation/Title:</span>
    <span class="field-value ${hasValue(activation.designation) ? 'has-value' : 'no-value'}">
      ${formatValue(activation.designation) || ''}
    </span>
  </div>

  <div class="field-row">
    <span class="field-label">Email:</span>
    <span class="field-value ${hasValue(activation.email) ? 'has-value' : 'no-value'}">
      ${formatValue(activation.email) || ''}
    </span>
  </div>

  <div class="field-row">
    <span class="field-label">Mobile No:</span>
    <span class="field-value ${hasValue(activation.mobileNo) ? 'has-value' : 'no-value'}">
      ${formatValue(activation.mobileNo) || ''}
    </span>
  </div>

  <!-- PART 2: DESCRIPTION WITH TABLE -->
  <div class="section-title">PART 2 – DESCRIPTION OF THE ACTIVATION/EXHIBITION:</div>
  
  <div style="font-weight: bold; margin-bottom: 8px; font-size: 9pt;">Intended dates and time of the activation</div>

  <table>
    <tr>
      <td>Activation/Exhibition Start Date:</td>
      <td>${formatDate(activation.startDate)}</td>
    </tr>
    <tr>
      <td>Set Up Time</td>
      <td>${formatTime(activation.setupTime)}</td>
    </tr>
    <tr>
      <td>Activation/Exhibition End Date:</td>
      <td>${formatDate(activation.endDate)}</td>
    </tr>
    <tr>
      <td>Tear Down Time:</td>
      <td>${formatTime(activation.tearDownTime)}</td>
    </tr>
  </table>

  <div style="font-weight: bold; margin-top: 10px; font-size: 9pt;">Nature of the activation:</div>
  <div class="nature-list">
    <div>1. ${formatValue(activation.activationType) || '…………………………'}</div>
    <div class="multi-line">2. ${formatValue(activation.description) || 'Distribution details'}</div>
    <div>3. ${activation.soundSystem ? 'With PA system' : 'No PA system'}</div>
  </div>

  <!-- PART 3: COST WITH TABLE -->
  <div class="section-title">PART 3 – COST OF ACTIVATION/EXHIBITION:</div>
  
  <table>
    <tr>
      <td>License Fee per day:</td>
      <td>${formatCurrency(costs.licenseFeePerDay)}</td>
    </tr>
    <tr>
      <td>No. of days:</td>
      <td>${costs.numberOfDays}</td>
    </tr>
    <tr>
      <td>Sub Total:</td>
      <td>${formatCurrency(costs.subTotal)}</td>
    </tr>
    <tr>
      <td>${getVATLabel()}</td>
      <td>${getVATValue()}</td>
    </tr>
    <tr>
      <td>Total:</td>
      <td>${formatCurrency(costs.totalAmount)}</td>
    </tr>
  </table>

  <div style="font-weight: bold; margin-top: 10px; font-size: 9pt;">Payment Details:</div>
  
  <div class="field-row">
    <span class="field-label">Bank name:</span>
    <span class="field-value ${hasValue(activation.bankName) ? 'has-value' : 'no-value'}">
      ${formatValue(activation.bankName) || ''}
    </span>
  </div>

  <div class="field-row">
    <span class="field-label">Branch:</span>
    <span class="field-value ${hasValue(activation.bankBranch) ? 'has-value' : 'no-value'}">
      ${formatValue(activation.bankBranch) || ''}
    </span>
  </div>

  <div class="field-row">
    <span class="field-label">A/c name:</span>
    <span class="field-value ${hasValue(activation.accountName) ? 'has-value' : 'no-value'}">
      ${formatValue(activation.accountName) || ''}
    </span>
  </div>

  <div class="field-row">
    <span class="field-label">A/c no.</span>
    <span class="field-value ${hasValue(activation.accountNumber) ? 'has-value' : 'no-value'}">
      ${formatValue(activation.accountNumber) || ''}
    </span>
  </div>

  <div class="field-row">
    <span class="field-label">Swift Code:</span>
    <span class="field-value ${hasValue(activation.swiftCode) ? 'has-value' : 'no-value'}">
      ${formatValue(activation.swiftCode) || ''}
    </span>
  </div>

  <div style="font-weight: bold; margin-top: 10px; font-size: 9pt;">Mpesa Payment:</div>
  
  <div class="two-col">
    <div class="field-row">
      <span class="field-label">Paybill Number:</span>
      <span class="field-value ${hasValue(activation.paybillNumber) ? 'has-value' : 'no-value'}">
        ${formatValue(activation.paybillNumber) || ''}
      </span>
    </div>
    <div class="field-row">
      <span class="field-label">Account:</span>
      <span class="field-value ${hasValue(activation.mpesaAccount) ? 'has-value' : 'no-value'}">
        ${formatValue(activation.mpesaAccount) || ''}
      </span>
    </div>
  </div>

  <div class="payment-note">
    NB: FULL PAYMENT should be made prior to the activation/exhibition space being reserved. Payments once made are NOT refundable.
  </div>

  <!-- PART 4: RULES -->
  <div class="section-title">PART 4- EXHIBITION / ACTIVATION RULES & REGULATIONS</div>
  
  <ol class="rules-list">
    <li>You shall be required to obtain the requisite permits, licenses or approvals from the competent authorities.</li>
    <li>You shall be required to declare any third parties and / or co-sponsors participating in a promotion at the time of the application hereof and or prior to the date of the scheduled activation.</li>
    <li>You shall be required to procure and secure your own exhibition materials at your own cost, and the Licensor shall not be liable for any loss or damage of such material howsoever caused.</li>
    <li>Any brochures and promotional material will be distributed from the stand in the designated area only.</li>
    <li>You shall not obstruct the entrance of the Mall or any of the shops within the Mall to ensure smooth flow of traffic.</li>
    <li>You shall not obstruct the entrances and or windows shops within the Mall.</li>
    <li>The Management reserves the right to inspect the exhibition area at any time without any prior notice.</li>
    <li>You shall not use any sound system in the exhibition without prior approval of the Management of the Mall.</li>
    <li>You shall be required to assemble your exhibition area not earlier than 9pm and disassemble it by 6pm on the last day of the exhibition.</li>
    <li>You shall not undertake any political activities during the exhibition in default of which the Licensor may withdraw the License and no License Fee paid but not accrued shall be refundable.</li>
    <li>You shall assume full responsibility for any loss or damage to the property of the Licensor or any third party or injury of any person howsoever caused during the exhibition, and shall on a full and unqualified basis indemnify the Licensor for any loss, damage, claim, suit judgement, decree or order howsoever arising from such loss, damage or injury.</li>
  </ol>

  <!-- ACCEPTANCE -->
  <div class="acceptance-section">
    <div style="font-weight: bold; margin-bottom: 10px;">We/I accept and undertake to fully comply with the above terms.</div>
    
    <div class="field-row">
      <span class="field-label">Name:</span>
      <span class="field-value ${hasValue(activation.contactPerson) ? 'has-value' : 'no-value'}">
        ${formatValue(activation.contactPerson) || ''}
      </span>
    </div>

    <div class="two-col">
      <div class="field-row">
        <span class="field-label">Your Title / Post:</span>
        <span class="field-value ${hasValue(activation.designation) ? 'has-value' : 'no-value'}">
          ${formatValue(activation.designation) || ''}
        </span>
      </div>
      <div class="field-row">
        <span class="field-label">Company Name:</span>
        <span class="field-value ${hasValue(activation.companyName) ? 'has-value' : 'no-value'}">
          ${formatValue(activation.companyName) || ''}
        </span>
      </div>
    </div>

    <div class="two-col">
      <div class="field-row">
        <span class="field-label">E-Mail Address:</span>
        <span class="field-value ${hasValue(activation.email) ? 'has-value' : 'no-value'}">
          ${formatValue(activation.email) || ''}
        </span>
      </div>
      <div class="field-row">
        <span class="field-label">Mobile No:</span>
        <span class="field-value ${hasValue(activation.mobileNo) ? 'has-value' : 'no-value'}">
          ${formatValue(activation.mobileNo) || ''}
        </span>
      </div>
    </div>

    <div class="two-col" style="margin-top: 15px;">
      <div>Signature: …..………………………………</div>
      <div>Date: ${formatDate(activation.signatureDate || activation.createdAt)}</div>
    </div>
  </div>

  <!-- MANAGEMENT -->
  <div class="management-section">
    <div style="font-weight: bold; margin-bottom: 10px;">FOR MANAGEMENT USE ONLY:-</div>
    
    <div class="field-row">
      <span class="field-label">Name:</span>
      <span class="field-value ${hasValue(activation.manager?.name) ? 'has-value' : 'no-value'}">
        ${formatValue(activation.manager?.name) || ''}
      </span>
    </div>

    <div class="two-col">
      <div class="field-row">
        <span class="field-label">Designation/Title:</span>
        <span class="field-value ${hasValue(activation.managerDesignation || activation.manager?.role) ? 'has-value' : 'no-value'}">
          ${formatValue(activation.managerDesignation || activation.manager?.role) || ''}
        </span>
      </div>
      <div class="field-row">
        <span class="field-label">Signature:</span>
        <span class="field-value no-value"></span>
      </div>
    </div>

    <div class="two-col" style="margin-top: 10px;">
      <div class="field-row">
        <span class="field-label">Date:</span>
        <span class="field-value ${hasValue(activation.approvedAt || activation.updatedAt) ? 'has-value' : 'no-value'}">
          ${formatDate(activation.approvedAt || activation.updatedAt)}
        </span>
      </div>
      <div>
        Paid: Yes: ${paidStatus ? '✓' : '______'} &nbsp;&nbsp; No: ${!paidStatus ? '✓' : '______'}
      </div>
    </div>
  </div>
</body>
</html>
  `;
};