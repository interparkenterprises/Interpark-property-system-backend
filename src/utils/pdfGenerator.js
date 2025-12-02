import PDFDocument from 'pdfkit';


/**
 * Generate PDF from HTML using PDFKit (pure Node.js)
 * @param {string} htmlContent 
 * @param {object} options 
 * @returns {Promise<Buffer>}
 */
export const generatePDF = async (htmlContent, options = {}) => {
  return new Promise((resolve, reject) => {
    try {
      // Create a document
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 20, bottom: 20, left: 15, right: 15 },
        ...options.pdfkitOptions
      });
      
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      
      // For HTML to PDF, you'll need additional processing
      // Basic text rendering (for simple cases)
      doc.fontSize(10);
      doc.text(htmlContent.replace(/<[^>]*>/g, ' '), {
        align: 'left',
        width: doc.page.width - 30 // Account for margins
      });
      
      doc.end();
      
    } catch (error) {
      console.error('PDF generation error:', error);
      reject(new Error(`Failed to generate PDF: ${error.message}`));
    }
  });
};