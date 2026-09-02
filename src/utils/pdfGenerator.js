import puppeteer from 'puppeteer';
import fs from 'fs';

let browserInstance = null;

/**
 * Get Chrome executable path - works for both local and production
 */
const getChromeExecutablePath = () => {
  // 1. Check if environment variable is set (for production)
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    console.log(`Using Chrome from env: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  
  // 2. Check common system paths (for Linux/DigitalOcean)
  const commonPaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/chrome',
    '/usr/local/bin/chrome',
    // For development on macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    // For development on Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  
  for (const chromePath of commonPaths) {
    try {
      if (fs.existsSync(chromePath)) {
        console.log(`Found Chrome at: ${chromePath}`);
        return chromePath;
      }
    } catch (e) {
      // Skip if fs module not available
    }
  }
  
  // 3. Check for Puppeteer's bundled Chrome (development fallback)
  try {
    // This is where puppeteer typically installs Chrome
    const puppeteerChromePath = './node_modules/puppeteer/.local-chromium';
    if (fs.existsSync(puppeteerChromePath)) {
      console.log('Using Puppeteer bundled Chrome');
      return null; // Let puppeteer use its bundled version
    }
  } catch (e) {
    // Skip
  }
  
  console.log('No Chrome found, will use puppeteer bundled version');
  return null;
};

/**
 * Get or create browser instance with better error handling
 */
const getBrowser = async () => {
  if (!browserInstance) {
    const executablePath = getChromeExecutablePath();
    
    // Launch options optimized for both development and production
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',                    // Required for Linux production
        '--disable-setuid-sandbox',        // Required for Linux production
        '--disable-dev-shm-usage',         // Fix for Docker/Linux
        '--disable-gpu',                   // Fix for Linux
        '--no-first-run',
        '--no-zygote',
        '--single-process',                // Better for production
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-popup-blocking',
        '--disable-translate',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-web-security',          // For production if needed
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-features=BlockInsecurePrivateNetworkRequests',
        '--disable-features=OutOfBlinkCors',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080',
      ],
      timeout: 60000,
      // Set a timeout for browser launch
      protocolTimeout: 60000,
    };

    // If we found a system Chrome, use it (preferred for production)
    if (executablePath) {
      launchOptions.executablePath = executablePath;
      console.log(`Launching browser with Chrome: ${executablePath}`);
    } else {
      // Let puppeteer use its bundled Chrome (good for development)
      console.log('Launching browser with Puppeteer bundled Chrome');
    }

    try {
      console.log('Attempting to launch browser...');
      browserInstance = await puppeteer.launch(launchOptions);
      console.log('Browser launched successfully!');
      
      // Get browser version for verification
      const version = await browserInstance.version();
      console.log(`Browser version: ${version}`);
      
      return browserInstance;
    } catch (error) {
      console.error('Failed to launch browser:', error.message);
      
      // Try fallback with minimal options
      console.log('Attempting fallback launch with minimal options...');
      try {
        const fallbackOptions = {
          headless: 'new',
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
          timeout: 60000,
        };
        
        // If we had a custom executable path, try without it
        if (executablePath) {
          console.log('Falling back to bundled Chrome...');
          // Don't set executablePath, use bundled
        }
        
        browserInstance = await puppeteer.launch(fallbackOptions);
        console.log('Fallback browser launched successfully!');
        return browserInstance;
      } catch (fallbackError) {
        console.error('All browser launch attempts failed:', fallbackError);
        throw new Error(
          `Could not launch Chrome browser. Please ensure Chrome is installed.\n` +
          `For DigitalOcean: sudo apt-get install -y chromium-browser\n` +
          `For local: npx puppeteer browsers install chrome\n` +
          `Or set PUPPETEER_EXECUTABLE_PATH environment variable.\n` +
          `Original error: ${error.message}`
        );
      }
    }
  }
  return browserInstance;
};

/**
 * Generate PDF from HTML content
 */
export const generatePDF = async (htmlContent, options = {}) => {
  let page;
  const startTime = Date.now();
  
  try {
    console.log('Starting PDF generation...');
    const browser = await getBrowser();
    
    // Create a new page with fresh context
    page = await browser.newPage();
    
    // Set viewport for consistent rendering
    await page.setViewport({
      width: 1200,
      height: 1600,
      deviceScaleFactor: 1,
    });

    // Set content with timeout and wait for network to be idle
    console.log('Setting HTML content...');
    await page.setContent(htmlContent, {
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    // Wait for fonts to load
    try {
      console.log('Waiting for fonts...');
      await page.evaluateHandle('document.fonts.ready');
      console.log('Fonts loaded');
    } catch (e) {
      console.warn('Font loading timeout, continuing anyway');
    }

    // Wait a bit for any dynamic content - FIXED: Use setTimeout instead of page.waitForTimeout
    console.log('Waiting for content to stabilize...');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Generate PDF
    console.log('Generating PDF...');
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: {
        top: '2.5cm',
        right: '2cm',
        bottom: '2.5cm',
        left: '2cm'
      },
      printBackground: true,
      preferCSSPageSize: true,
      timeout: 60000,
      ...options
    });
    
    console.log(`PDF generated successfully in ${Date.now() - startTime}ms`);
    await page.close();
    return pdfBuffer;
    
  } catch (error) {
    console.error('PDF generation error:', error);
    
    // Clean up page if it exists
    if (page && !page.isClosed()) {
      try {
        await page.close();
      } catch (e) {
        console.warn('Error closing page:', e.message);
      }
    }
    
    // Provide more specific error messages
    if (error.message.includes('Could not find Chrome')) {
      throw new Error(
        'Chrome browser not found. Please install Chrome:\n' +
        'DigitalOcean/Ubuntu: sudo apt-get install -y chromium-browser\n' +
        'Local: npx puppeteer browsers install chrome\n' +
        'Then set: export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser'
      );
    }
    
    throw new Error(`Failed to generate PDF: ${error.message}`);
  }
};

/**
 * Clean up browser instance
 */
export const closeBrowser = async () => {
  if (browserInstance) {
    try {
      console.log('Closing browser instance...');
      await browserInstance.close();
      browserInstance = null;
      console.log('Browser closed successfully');
    } catch (error) {
      console.error('Error closing browser:', error.message);
      browserInstance = null;
    }
  }
};

// Handle process exit
process.on('exit', async () => {
  await closeBrowser();
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception:', error);
  await closeBrowser();
});

// Handle SIGTERM (production)
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, closing browser...');
  await closeBrowser();
  process.exit(0);
});

// Handle SIGINT (development)
process.on('SIGINT', async () => {
  console.log('Received SIGINT, closing browser...');
  await closeBrowser();
  process.exit(0);
});