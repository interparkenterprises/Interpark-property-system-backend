import puppeteer from 'puppeteer';

let browserInstance = null;

/**
 * Get or create browser instance
 */
const getBrowser = async () => {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote'
      ],
      timeout: 60000,
    });
  }
  return browserInstance;
};

export const generatePDF = async (htmlContent, options = {}) => {
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    
    await page.setContent(htmlContent, {
      waitUntil: 'load',
      timeout: 30000
    });

    await page.evaluateHandle('document.fonts.ready');
    
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
    
    await page.close();
    return pdfBuffer;
    
  } catch (error) {
    console.error('PDF generation error:', error);
    if (page && !page.isClosed()) {
      await page.close();
    }
    throw new Error(`Failed to generate PDF: ${error.message}`);
  }
};

// Optional: Cleanup function to close browser
export const closeBrowser = async () => {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
};