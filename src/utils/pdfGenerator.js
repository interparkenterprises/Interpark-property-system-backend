import puppeteer from 'puppeteer';

/**
 * Generate PDF from HTML using Puppeteer (proper HTML/CSS rendering)
 * @param {string} htmlContent 
 * @param {object} options 
 * @returns {Promise<Buffer>}
 */
export const generatePDF = async (htmlContent, options = {}) => {
  let browser;
  try {
    // Launch browser
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set the HTML content
    await page.setContent(htmlContent, {
      waitUntil: 'networkidle0'
    });
    
    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: {
        top: '2.5cm',
        right: '2cm',
        bottom: '2.5cm',
        left: '2cm'
      },
      printBackground: true,
      ...options
    });
    
    await browser.close();
    return pdfBuffer;
    
  } catch (error) {
    console.error('PDF generation error:', error);
    if (browser) {
      await browser.close();
    }
    throw new Error(`Failed to generate PDF: ${error.message}`);
  }
};