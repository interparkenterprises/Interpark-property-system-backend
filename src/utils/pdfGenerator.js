import puppeteer from 'puppeteer';
import fs from 'fs';

let browserInstance = null;
let isBrowserValid = false;
let browserErrorCount = 0;
const MAX_BROWSER_ERRORS = 3;

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
  
  console.log('No Chrome found, will use puppeteer bundled version');
  return null;
};

/**
 * Check if browser instance is still valid
 */
const isBrowserHealthy = async () => {
  if (!browserInstance) return false;
  
  try {
    // Try to get the browser version to check if connection is alive
    await browserInstance.version();
    return true;
  } catch (error) {
    console.warn('Browser health check failed:', error.message);
    return false;
  }
};

/**
 * Get or create browser instance with better error handling
 */
const getBrowser = async () => {
  // Check if we need to recreate the browser
  if (browserInstance) {
    const healthy = await isBrowserHealthy();
    if (healthy && isBrowserValid) {
      return browserInstance;
    }
    // Browser is not healthy, close and recreate
    console.log('Browser instance is not healthy, recreating...');
    await closeBrowser();
  }

  const executablePath = getChromeExecutablePath();
  
  // Launch options optimized for both development and production
  const launchOptions = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-popup-blocking',
      '--disable-translate',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-features=BlockInsecurePrivateNetworkRequests',
      '--disable-features=OutOfBlinkCors',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080',
      // Additional stability flags
      '--disable-accelerated-2d-canvas',
      '--disable-accelerated-jpeg-decoding',
      '--disable-accelerated-mjpeg-decode',
      '--disable-accelerated-video-decode',
      '--disable-background-networking',
      '--disable-breakpad',
      '--disable-component-extensions-with-background-pages',
      '--disable-component-update',
      '--disable-domain-reliability',
      '--disable-ipc-flooding-protection',
      '--disable-renderer-process-reuse',
      '--disable-sync',
      '--disable-windows10-custom-titlebar',
      '--disable-features=TranslateUI,BlinkGenPropertyTrees',
      '--disable-ipc-flooding-protection',
      '--enable-features=NetworkService,NetworkServiceInProcess',
      '--force-color-profile=srgb',
      '--hide-scrollbars',
      '--ignore-certificate-errors',
      '--ignore-ssl-errors',
      '--mute-audio',
      '--no-default-browser-check',
      '--no-pings',
      '--password-store=basic',
      '--use-mock-keychain',
      '--disable-software-rasterizer',
    ],
    timeout: 60000,
    protocolTimeout: 60000,
    // Increase connection stability
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    handleSIGQUIT: false,
    // Reuse browser context across pages
    waitForInitialPage: false,
  };

  // If we found a system Chrome, use it (preferred for production)
  if (executablePath) {
    launchOptions.executablePath = executablePath;
    console.log(`Launching browser with Chrome: ${executablePath}`);
  } else {
    console.log('Launching browser with Puppeteer bundled Chrome');
  }

  try {
    console.log('Attempting to launch browser...');
    browserInstance = await puppeteer.launch(launchOptions);
    
    // Set up connection error handlers
    browserInstance.on('disconnected', () => {
      console.warn('Browser disconnected unexpectedly');
      isBrowserValid = false;
      browserInstance = null;
    });

    browserInstance.on('error', (error) => {
      console.error('Browser error:', error);
      isBrowserValid = false;
      browserInstance = null;
    });

    // Verify browser is working
    const version = await browserInstance.version();
    console.log(`Browser version: ${version}`);
    
    isBrowserValid = true;
    browserErrorCount = 0;
    console.log('Browser launched successfully!');
    
    return browserInstance;
  } catch (error) {
    console.error('Failed to launch browser:', error.message);
    browserInstance = null;
    isBrowserValid = false;
    browserErrorCount++;
    
    // Try fallback with minimal options
    console.log('Attempting fallback launch with minimal options...');
    try {
      const fallbackOptions = {
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        timeout: 60000,
        protocolTimeout: 60000,
      };
      
      browserInstance = await puppeteer.launch(fallbackOptions);
      
      browserInstance.on('disconnected', () => {
        console.warn('Browser disconnected unexpectedly');
        isBrowserValid = false;
        browserInstance = null;
      });

      const version = await browserInstance.version();
      console.log(`Fallback browser version: ${version}`);
      
      isBrowserValid = true;
      browserErrorCount = 0;
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
};

/**
 * Generate PDF from HTML content with improved stability
 */
export const generatePDF = async (htmlContent, options = {}) => {
  let page = null;
  const startTime = Date.now();
  const maxRetries = 2;
  let lastError = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`Retry attempt ${attempt} for PDF generation...`);
        // Force browser recreation on retry
        await closeBrowser();
        // Small delay before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log(`Starting PDF generation (attempt ${attempt + 1})...`);
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

      // Wait a bit for any dynamic content
      console.log('Waiting for content to stabilize...');
      await new Promise(resolve => setTimeout(resolve, 800));

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
      
      // Close page properly
      try {
        await page.close();
      } catch (closeError) {
        console.warn('Error closing page:', closeError.message);
      }
      
      // Reset error count on success
      browserErrorCount = 0;
      
      return pdfBuffer;
      
    } catch (error) {
      lastError = error;
      console.error(`PDF generation error (attempt ${attempt + 1}):`, error.message);
      
      // Clean up page if it exists
      if (page && !page.isClosed()) {
        try {
          await page.close();
        } catch (e) {
          console.warn('Error closing page:', e.message);
        }
        page = null;
      }
      
      // If this was the last attempt, throw the error
      if (attempt === maxRetries) {
        break;
      }
      
      // If it's a connection error, force browser recreation
      if (error.message.includes('Connection closed') || 
          error.message.includes('detached') ||
          error.message.includes('Protocol error')) {
        console.log('Connection error detected, will recreate browser on retry');
        await closeBrowser();
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  
  // If we get here, all retries failed
  throw new Error(`Failed to generate PDF after ${maxRetries + 1} attempts: ${lastError?.message || 'Unknown error'}`);
};

/**
 * Clean up browser instance
 */
export const closeBrowser = async () => {
  if (browserInstance) {
    try {
      console.log('Closing browser instance...');
      await browserInstance.close();
    } catch (error) {
      console.warn('Error closing browser:', error.message);
    } finally {
      browserInstance = null;
      isBrowserValid = false;
    }
  }
};

// Handle process exit - cleanup
const cleanup = async () => {
  console.log('Cleaning up browser...');
  await closeBrowser();
};

// Handle process exit
process.on('exit', cleanup);

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception:', error);
  await cleanup();
});

// Handle SIGTERM (production)
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, cleaning up...');
  await cleanup();
  process.exit(0);
});

// Handle SIGINT (development)
process.on('SIGINT', async () => {
  console.log('Received SIGINT, cleaning up...');
  await cleanup();
  process.exit(0);
});