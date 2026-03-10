/**
 * Strider Labs - Ticketmaster Browser Automation
 *
 * Playwright-based browser automation for Ticketmaster operations.
 * Uses stealth patches and random delays to avoid bot detection.
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";
import {
  saveCookies,
  loadCookies,
  saveSessionInfo,
  type SessionInfo,
} from "./auth.js";

const TM_BASE_URL = "https://www.ticketmaster.com";
const DEFAULT_TIMEOUT = 45000;

// Singleton browser instance
let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

// ─── Data Interfaces ────────────────────────────────────────────────────────

export interface EventResult {
  id: string;
  name: string;
  date: string;
  time?: string;
  venue: string;
  city: string;
  state?: string;
  url: string;
  imageUrl?: string;
  priceRange?: string;
  genre?: string;
  status: string;
}

export interface VenueResult {
  id: string;
  name: string;
  address: string;
  city: string;
  state?: string;
  postalCode?: string;
  url: string;
  capacity?: string;
}

export interface TicketAvailability {
  eventId: string;
  eventName: string;
  available: boolean;
  totalTickets?: number;
  sections?: SectionInfo[];
  message?: string;
}

export interface SectionInfo {
  name: string;
  available: boolean;
  ticketCount?: number;
  priceRange?: string;
}

export interface PriceInfo {
  eventId: string;
  eventName: string;
  minPrice?: string;
  maxPrice?: string;
  priceRanges: PriceRange[];
  fees?: string;
}

export interface PriceRange {
  type: string;
  min: string;
  max: string;
  currency: string;
}

export interface SelectedTickets {
  eventId: string;
  section: string;
  row?: string;
  seats: string[];
  quantity: number;
  priceEach: string;
  total: string;
}

export interface CartSummary {
  items: CartItem[];
  subtotal: string;
  fees?: string;
  tax?: string;
  total: string;
  itemCount: number;
}

export interface CartItem {
  eventName: string;
  date: string;
  venue: string;
  section: string;
  row?: string;
  seats: string;
  quantity: number;
  price: string;
}

export interface OrderResult {
  orderId: string;
  eventName: string;
  date: string;
  venue: string;
  section: string;
  seats: string;
  total: string;
  deliveryMethod?: string;
  confirmationUrl?: string;
}

export interface OrderHistoryItem {
  orderId: string;
  eventName: string;
  date: string;
  venue: string;
  quantity: number;
  total: string;
  status: string;
  orderDate: string;
}

// ─── Random Delay Helper ─────────────────────────────────────────────────────

async function randomDelay(min = 800, max = 2500): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Browser Initialization ──────────────────────────────────────────────────

async function initBrowser(): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
}> {
  if (browser && context && page) {
    return { browser, context, page };
  }

  browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--window-size=1280,720",
      "--disable-infobars",
      "--disable-notifications",
    ],
  });

  context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
    locale: "en-US",
    timezoneId: "America/New_York",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    },
  });

  // Load saved cookies if available
  const cookiesLoaded = await loadCookies(context);
  if (cookiesLoaded) {
    console.error("Loaded saved Ticketmaster cookies");
  }

  page = await context.newPage();

  // Stealth patches - mask automation signals
  await page.addInitScript(() => {
    // Mask webdriver
    Object.defineProperty(navigator, "webdriver", { get: () => false });

    // Mask plugins length (real browsers have plugins)
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });

    // Mask languages
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });

    // Remove automation-related properties
    // @ts-ignore
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
    // @ts-ignore
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    // @ts-ignore
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

    // Override permissions query to avoid detection
    const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
    // @ts-ignore
    window.navigator.permissions.query = (parameters: PermissionDescriptor) =>
      parameters.name === "notifications"
        // @ts-ignore
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters);
  });

  return { browser, context, page };
}

// ─── Queue / CAPTCHA Detection ───────────────────────────────────────────────

async function detectQueueOrCaptcha(p: Page): Promise<string | null> {
  const url = p.url();

  // Ticketmaster queue detection
  if (url.includes("queue") || url.includes("waiting-room")) {
    return "queue";
  }

  // CAPTCHA detection
  const captchaEl = await p.$(
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [class*="captcha"], [id*="captcha"]'
  );
  if (captchaEl) {
    return "captcha";
  }

  // Ticketmaster-specific bot detection page
  const botEl = await p.$('[class*="error-page"], :text("Access Denied")');
  if (botEl) {
    return "blocked";
  }

  return null;
}

async function waitForPageOrQueue(
  p: Page,
  selector: string,
  timeout = 15000
): Promise<boolean> {
  try {
    await p.waitForSelector(selector, { timeout });
    return true;
  } catch {
    const issue = await detectQueueOrCaptcha(p);
    if (issue === "queue") {
      console.error("Ticketmaster queue detected - waiting in queue...");
      // Wait up to 60s for queue to clear
      try {
        await p.waitForURL((url) => !url.href.includes("queue"), {
          timeout: 60000,
        });
        await randomDelay(1500, 3000);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

// ─── Auth Functions ──────────────────────────────────────────────────────────

export async function checkLoginStatus(): Promise<SessionInfo> {
  const { page, context } = await initBrowser();

  try {
    await page.goto(TM_BASE_URL, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });
    await randomDelay();

    // Check for sign-in indicators
    const signInBtn = await page.$(
      '[data-testid="sign-in-button"], a[href*="/login"], button:has-text("Sign In")'
    );
    const accountBtn = await page.$(
      '[data-testid="account-menu"], [aria-label*="My Account"], a[href*="/my-account"]'
    );

    const isLoggedIn = accountBtn !== null && signInBtn === null;

    let userEmail: string | undefined;
    let userName: string | undefined;

    if (isLoggedIn && accountBtn) {
      try {
        await accountBtn.click();
        await randomDelay(800, 1500);
        const emailEl = await page.$('[data-testid="user-email"], .user-email');
        const nameEl = await page.$('[data-testid="user-name"], .user-name');
        userEmail =
          (await emailEl?.textContent())?.trim() || undefined;
        userName = (await nameEl?.textContent())?.trim() || undefined;
        await page.keyboard.press("Escape");
      } catch {
        // ignore menu errors
      }
    }

    const sessionInfo: SessionInfo = {
      isLoggedIn,
      userEmail,
      userName,
      lastUpdated: new Date().toISOString(),
    };

    saveSessionInfo(sessionInfo);
    await saveCookies(context);

    return sessionInfo;
  } catch (error) {
    throw new Error(
      `Failed to check login status: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function initiateLogin(): Promise<{
  loginUrl: string;
  instructions: string;
}> {
  const { page, context } = await initBrowser();

  try {
    await page.goto(`${TM_BASE_URL}/login`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });
    await saveCookies(context);

    return {
      loginUrl: `${TM_BASE_URL}/login`,
      instructions:
        "Please log in to Ticketmaster manually:\n" +
        "1. Open the URL in your browser\n" +
        "2. Log in with your Ticketmaster account\n" +
        "3. Once logged in, run 'ticketmaster_status' to verify the session\n\n" +
        "Note: For headless operation, you may need to log in using a visible browser first, " +
        "then the session cookies will be saved for future use.",
    };
  } catch (error) {
    throw new Error(
      `Failed to initiate login: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function closeBrowser(): Promise<void> {
  if (context) {
    await saveCookies(context);
  }
  if (browser) {
    await browser.close();
    browser = null;
    context = null;
    page = null;
  }
}

// ─── Event Search ─────────────────────────────────────────────────────────────

export async function searchEvents(
  keyword: string,
  location?: string,
  startDate?: string,
  endDate?: string,
  maxResults = 20
): Promise<EventResult[]> {
  const { page, context } = await initBrowser();

  try {
    // Build search URL
    const params = new URLSearchParams();
    params.set("q", keyword);
    if (location) params.set("where", location);
    if (startDate) params.set("dateStart", startDate);
    if (endDate) params.set("dateEnd", endDate);

    const searchUrl = `${TM_BASE_URL}/search?${params.toString()}`;
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });
    await randomDelay();

    await waitForPageOrQueue(
      page,
      '[data-testid="event-card"], [class*="EventCard"], [class*="event-listing"]',
      10000
    );
    await randomDelay(500, 1200);

    const events = await page.evaluate(
      (max: number) => {
        const cards = document.querySelectorAll(
          '[data-testid="event-card"], [class*="EventCard"], [class*="event-listing"], li[class*="event"]'
        );
        const results: EventResult[] = [];

        cards.forEach((card, index) => {
          if (index >= max) return;

          const nameEl = card.querySelector(
            '[data-testid="event-name"], [class*="EventName"], h2, h3, [class*="event-name"]'
          );
          const dateEl = card.querySelector(
            '[data-testid="event-date"], [class*="EventDate"], [class*="date"], time'
          );
          const timeEl = card.querySelector(
            '[data-testid="event-time"], [class*="EventTime"], [class*="time"]'
          );
          const venueEl = card.querySelector(
            '[data-testid="venue-name"], [class*="VenueName"], [class*="venue"]'
          );
          const cityEl = card.querySelector(
            '[data-testid="event-location"], [class*="Location"], [class*="city"]'
          );
          const linkEl = card.querySelector("a[href]");
          const imgEl = card.querySelector("img");
          const priceEl = card.querySelector(
            '[data-testid="price"], [class*="Price"], [class*="price"]'
          );
          const genreEl = card.querySelector(
            '[data-testid="genre"], [class*="Genre"], [class*="genre"]'
          );

          const href = linkEl?.getAttribute("href") || "";
          const id =
            href.match(/event\/([A-Z0-9]+)/i)?.[1] ||
            card.getAttribute("data-event-id") ||
            String(index);

          results.push({
            id,
            name: nameEl?.textContent?.trim() || "Unknown Event",
            date: dateEl?.textContent?.trim() || "TBD",
            time: timeEl?.textContent?.trim() || undefined,
            venue: venueEl?.textContent?.trim() || "Unknown Venue",
            city: cityEl?.textContent?.trim() || "Unknown Location",
            state: undefined,
            url: href.startsWith("http")
              ? href
              : `https://www.ticketmaster.com${href}`,
            imageUrl: imgEl?.src || undefined,
            priceRange: priceEl?.textContent?.trim() || undefined,
            genre: genreEl?.textContent?.trim() || undefined,
            status: "on-sale",
          });
        });

        return results;
      },
      Math.min(maxResults, 50)
    );

    await saveCookies(context);
    return events;
  } catch (error) {
    throw new Error(
      `Failed to search events: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ─── Event Details ────────────────────────────────────────────────────────────

export async function getEventDetails(
  eventIdOrUrl: string
): Promise<EventResult & { description?: string; ageRestriction?: string }> {
  const { page, context } = await initBrowser();

  try {
    const url = eventIdOrUrl.startsWith("http")
      ? eventIdOrUrl
      : `${TM_BASE_URL}/event/${eventIdOrUrl}`;

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });
    await randomDelay();

    await waitForPageOrQueue(
      page,
      '[data-testid="event-header"], [class*="EventHeader"], h1',
      10000
    );

    const details = await page.evaluate(() => {
      const nameEl = document.querySelector(
        '[data-testid="event-name"], [class*="EventName"], h1'
      );
      const dateEl = document.querySelector(
        '[data-testid="event-date"], [class*="EventDate"], time'
      );
      const venueEl = document.querySelector(
        '[data-testid="venue-name"], [class*="VenueName"]'
      );
      const cityEl = document.querySelector(
        '[data-testid="event-location"], [class*="EventLocation"]'
      );
      const descEl = document.querySelector(
        '[data-testid="event-description"], [class*="EventDescription"]'
      );
      const priceEl = document.querySelector(
        '[data-testid="price-range"], [class*="PriceRange"]'
      );
      const imgEl = document.querySelector(
        '[data-testid="event-image"], .event-image img, [class*="EventImage"] img'
      ) as HTMLImageElement | null;
      const ageEl = document.querySelector(
        '[class*="age-restriction"], [data-testid="age-restriction"]'
      );

      const href = window.location.href;
      const id = href.match(/event\/([A-Z0-9]+)/i)?.[1] || "unknown";

      return {
        id,
        name: nameEl?.textContent?.trim() || "Unknown Event",
        date: dateEl?.textContent?.trim() || "TBD",
        venue: venueEl?.textContent?.trim() || "Unknown Venue",
        city: cityEl?.textContent?.trim() || "Unknown Location",
        url: href,
        imageUrl: imgEl?.src || undefined,
        priceRange: priceEl?.textContent?.trim() || undefined,
        status: "on-sale",
        description: descEl?.textContent?.trim() || undefined,
        ageRestriction: ageEl?.textContent?.trim() || undefined,
      };
    });

    await saveCookies(context);
    return details;
  } catch (error) {
    throw new Error(
      `Failed to get event details: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ─── Venue Search ─────────────────────────────────────────────────────────────

export async function getVenuesNearLocation(
  location: string,
  maxResults = 10
): Promise<VenueResult[]> {
  const { page, context } = await initBrowser();

  try {
    const params = new URLSearchParams({ q: location, type: "venue" });
    const searchUrl = `${TM_BASE_URL}/search?${params.toString()}`;

    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });
    await randomDelay();

    await waitForPageOrQueue(
      page,
      '[data-testid="venue-card"], [class*="VenueCard"], [class*="venue-listing"]',
      8000
    );
    await randomDelay(500, 1000);

    const venues = await page.evaluate(
      (max: number) => {
        const cards = document.querySelectorAll(
          '[data-testid="venue-card"], [class*="VenueCard"], [class*="venue-listing"]'
        );
        const results: VenueResult[] = [];

        cards.forEach((card, index) => {
          if (index >= max) return;

          const nameEl = card.querySelector(
            '[data-testid="venue-name"], [class*="VenueName"], h2, h3'
          );
          const addrEl = card.querySelector(
            '[data-testid="venue-address"], [class*="Address"]'
          );
          const cityEl = card.querySelector(
            '[data-testid="venue-city"], [class*="City"]'
          );
          const linkEl = card.querySelector("a[href]");

          const href = linkEl?.getAttribute("href") || "";
          const id =
            href.match(/venue\/([A-Z0-9]+)/i)?.[1] ||
            card.getAttribute("data-venue-id") ||
            String(index);

          results.push({
            id,
            name: nameEl?.textContent?.trim() || "Unknown Venue",
            address: addrEl?.textContent?.trim() || "",
            city: cityEl?.textContent?.trim() || location,
            url: href.startsWith("http")
              ? href
              : `https://www.ticketmaster.com${href}`,
          });
        });

        return results;
      },
      Math.min(maxResults, 20)
    );

    await saveCookies(context);
    return venues;
  } catch (error) {
    throw new Error(
      `Failed to get venues: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ─── Venue Details ────────────────────────────────────────────────────────────

export async function getVenueDetails(
  venueIdOrUrl: string
): Promise<VenueResult> {
  const { page, context } = await initBrowser();

  try {
    const url = venueIdOrUrl.startsWith("http")
      ? venueIdOrUrl
      : `${TM_BASE_URL}/venue/${venueIdOrUrl}`;

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });
    await randomDelay();

    const details = await page.evaluate(() => {
      const nameEl = document.querySelector(
        '[data-testid="venue-name"], [class*="VenueName"], h1'
      );
      const addrEl = document.querySelector(
        '[data-testid="venue-address"], [class*="Address"]'
      );
      const cityEl = document.querySelector(
        '[data-testid="venue-city"], [class*="City"]'
      );
      const stateEl = document.querySelector(
        '[data-testid="venue-state"], [class*="State"]'
      );
      const zipEl = document.querySelector(
        '[data-testid="venue-zip"], [class*="Zip"]'
      );
      const capacityEl = document.querySelector(
        '[data-testid="venue-capacity"], [class*="Capacity"]'
      );

      const href = window.location.href;
      const id = href.match(/venue\/([A-Z0-9]+)/i)?.[1] || "unknown";

      return {
        id,
        name: nameEl?.textContent?.trim() || "Unknown Venue",
        address: addrEl?.textContent?.trim() || "",
        city: cityEl?.textContent?.trim() || "",
        state: stateEl?.textContent?.trim() || undefined,
        postalCode: zipEl?.textContent?.trim() || undefined,
        url: href,
        capacity: capacityEl?.textContent?.trim() || undefined,
      };
    });

    await saveCookies(context);
    return details;
  } catch (error) {
    throw new Error(
      `Failed to get venue details: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ─── Ticket Availability ──────────────────────────────────────────────────────

export async function checkTicketAvailability(
  eventIdOrUrl: string
): Promise<TicketAvailability> {
  const { page, context } = await initBrowser();

  try {
    const url = eventIdOrUrl.startsWith("http")
      ? eventIdOrUrl
      : `${TM_BASE_URL}/event/${eventIdOrUrl}`;

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });
    await randomDelay();

    const issue = await detectQueueOrCaptcha(page);
    if (issue === "queue") {
      return {
        eventId: eventIdOrUrl,
        eventName: "Unknown",
        available: false,
        message:
          "Currently in Ticketmaster queue. High demand event - please try again shortly.",
      };
    }
    if (issue === "captcha") {
      return {
        eventId: eventIdOrUrl,
        eventName: "Unknown",
        available: false,
        message: "CAPTCHA verification required. Manual intervention needed.",
      };
    }

    await randomDelay(500, 1200);

    const availability = await page.evaluate(() => {
      const nameEl = document.querySelector(
        '[data-testid="event-name"], [class*="EventName"], h1'
      );
      const soldOutEl = document.querySelector(
        '[class*="sold-out"], [data-testid="sold-out"], :text("Sold Out")'
      );
      const buyBtn = document.querySelector(
        '[data-testid="buy-tickets"], button:has-text("Buy Tickets"), a:has-text("Buy Tickets")'
      );
      const sectionEls = document.querySelectorAll(
        '[data-testid="section"], [class*="Section"], [class*="section-row"]'
      );

      const sections: SectionInfo[] = [];
      sectionEls.forEach((s) => {
        const secNameEl = s.querySelector(
          '[class*="section-name"], [data-testid="section-name"]'
        );
        const secPriceEl = s.querySelector(
          '[class*="price"], [data-testid="price"]'
        );
        const unavailableEl = s.querySelector(
          '[class*="unavailable"], [class*="sold-out"]'
        );

        sections.push({
          name: secNameEl?.textContent?.trim() || "Unknown Section",
          available: !unavailableEl,
          priceRange: secPriceEl?.textContent?.trim() || undefined,
        });
      });

      return {
        eventName: nameEl?.textContent?.trim() || "Unknown Event",
        available: !soldOutEl && buyBtn !== null,
        sections: sections.length > 0 ? sections : undefined,
        message: soldOutEl ? "This event is sold out" : undefined,
      };
    });

    const id = eventIdOrUrl.startsWith("http")
      ? eventIdOrUrl.match(/event\/([A-Z0-9]+)/i)?.[1] || eventIdOrUrl
      : eventIdOrUrl;

    await saveCookies(context);

    return {
      eventId: id,
      ...availability,
    };
  } catch (error) {
    throw new Error(
      `Failed to check availability: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ─── Price Ranges ─────────────────────────────────────────────────────────────

export async function getEventPrices(
  eventIdOrUrl: string
): Promise<PriceInfo> {
  const { page, context } = await initBrowser();

  try {
    const url = eventIdOrUrl.startsWith("http")
      ? eventIdOrUrl
      : `${TM_BASE_URL}/event/${eventIdOrUrl}`;

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });
    await randomDelay();

    const issue = await detectQueueOrCaptcha(page);
    if (issue === "queue") {
      throw new Error(
        "Currently in Ticketmaster queue. Please try again shortly."
      );
    }

    await randomDelay(500, 1200);

    const priceData = await page.evaluate(() => {
      const nameEl = document.querySelector(
        '[data-testid="event-name"], [class*="EventName"], h1'
      );
      const priceRangeEl = document.querySelector(
        '[data-testid="price-range"], [class*="PriceRange"], [class*="price-range"]'
      );
      const minPriceEl = document.querySelector(
        '[data-testid="min-price"], [class*="MinPrice"]'
      );
      const maxPriceEl = document.querySelector(
        '[data-testid="max-price"], [class*="MaxPrice"]'
      );
      const feesEl = document.querySelector(
        '[class*="fees"], [data-testid="fees"]'
      );

      // Try to extract price ranges from listing sections
      const priceEls = document.querySelectorAll(
        '[class*="price-tier"], [data-testid="price-tier"], [class*="ticket-type"]'
      );
      const priceRanges: PriceRange[] = [];

      priceEls.forEach((el) => {
        const typeEl = el.querySelector("[class*='type'], [class*='name']");
        const priceEl = el.querySelector("[class*='price']");
        const priceText = priceEl?.textContent?.trim() || "";
        const matches = priceText.match(/\$?([\d.]+)/g);

        if (matches) {
          priceRanges.push({
            type: typeEl?.textContent?.trim() || "Standard",
            min: matches[0] || "0",
            max: matches[matches.length - 1] || matches[0] || "0",
            currency: "USD",
          });
        }
      });

      const priceText = priceRangeEl?.textContent?.trim() || "";
      const priceMatches = priceText.match(/\$?([\d.]+)/g);

      return {
        eventName: nameEl?.textContent?.trim() || "Unknown Event",
        minPrice: minPriceEl?.textContent?.trim() || priceMatches?.[0] || undefined,
        maxPrice:
          maxPriceEl?.textContent?.trim() ||
          priceMatches?.[priceMatches.length - 1] ||
          undefined,
        priceRanges,
        fees: feesEl?.textContent?.trim() || undefined,
      };
    });

    const id = eventIdOrUrl.startsWith("http")
      ? eventIdOrUrl.match(/event\/([A-Z0-9]+)/i)?.[1] || eventIdOrUrl
      : eventIdOrUrl;

    await saveCookies(context);

    return {
      eventId: id,
      ...priceData,
    };
  } catch (error) {
    throw new Error(
      `Failed to get prices: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ─── Seat Selection ───────────────────────────────────────────────────────────

export async function selectSeats(
  eventIdOrUrl: string,
  quantity: number,
  section?: string,
  maxPrice?: number
): Promise<SelectedTickets> {
  const { page, context } = await initBrowser();

  try {
    const url = eventIdOrUrl.startsWith("http")
      ? eventIdOrUrl
      : `${TM_BASE_URL}/event/${eventIdOrUrl}`;

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });
    await randomDelay();

    const issue = await detectQueueOrCaptcha(page);
    if (issue === "queue") {
      throw new Error(
        "Currently in Ticketmaster queue. High demand event - please try again shortly."
      );
    }
    if (issue === "captcha") {
      throw new Error("CAPTCHA verification required. Manual intervention needed.");
    }

    // Click Buy Tickets
    const buyBtn = await page.$(
      '[data-testid="buy-tickets"], button:has-text("Buy Tickets"), a:has-text("Buy Tickets")'
    );

    if (!buyBtn) {
      throw new Error(
        "No tickets available for purchase on this event page."
      );
    }

    await randomDelay();
    await buyBtn.click();

    // Wait for ticket selection interface
    await waitForPageOrQueue(
      page,
      '[data-testid="ticket-quantity"], [class*="TicketSelector"], select[name*="quantity"], [class*="quantity-select"]',
      15000
    );
    await randomDelay();

    // Set quantity
    const quantitySelect = await page.$(
      'select[name*="quantity"], [data-testid="ticket-quantity"], [class*="QuantitySelect"]'
    );
    if (quantitySelect) {
      await quantitySelect.selectOption(String(quantity));
      await randomDelay();
    }

    // If section specified, try to select it
    if (section) {
      const sectionOption = await page.$(
        `[data-section="${section}"], option:has-text("${section}"), [class*="section"]:has-text("${section}")`
      );
      if (sectionOption) {
        await sectionOption.click();
        await randomDelay();
      }
    }

    // Try to filter by max price if specified
    if (maxPrice) {
      const priceFilter = await page.$(
        '[data-testid="price-filter"], [class*="PriceFilter"] input, input[name*="max-price"]'
      );
      if (priceFilter) {
        await priceFilter.fill(String(maxPrice));
        await randomDelay();
      }
    }

    // Extract selected ticket info
    const ticketInfo = await page.evaluate(() => {
      const secEl = document.querySelector(
        '[data-testid="selected-section"], [class*="SelectedSection"], [class*="section-name"]'
      );
      const rowEl = document.querySelector(
        '[data-testid="selected-row"], [class*="SelectedRow"], [class*="row"]'
      );
      const seatsEl = document.querySelector(
        '[data-testid="selected-seats"], [class*="SelectedSeats"], [class*="seats"]'
      );
      const priceEl = document.querySelector(
        '[data-testid="ticket-price"], [class*="TicketPrice"], [class*="price-each"]'
      );
      const totalEl = document.querySelector(
        '[data-testid="total-price"], [class*="TotalPrice"], [class*="total"]'
      );
      const qtyEl = document.querySelector(
        'select[name*="quantity"], [data-testid="ticket-quantity"]'
      ) as HTMLSelectElement | null;

      return {
        section: secEl?.textContent?.trim() || "Best Available",
        row: rowEl?.textContent?.trim() || undefined,
        seats: seatsEl?.textContent?.trim() || "TBD",
        priceEach: priceEl?.textContent?.trim() || "Unknown",
        total: totalEl?.textContent?.trim() || "Unknown",
        quantity: qtyEl
          ? parseInt(qtyEl.value || "1", 10)
          : 1,
      };
    });

    await saveCookies(context);

    const id = eventIdOrUrl.startsWith("http")
      ? eventIdOrUrl.match(/event\/([A-Z0-9]+)/i)?.[1] || eventIdOrUrl
      : eventIdOrUrl;

    return {
      eventId: id,
      ...ticketInfo,
      seats: ticketInfo.seats.split(",").map((s: string) => s.trim()),
    };
  } catch (error) {
    throw new Error(
      `Failed to select seats: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ─── Cart Operations ──────────────────────────────────────────────────────────

export async function addToCart(
  eventIdOrUrl: string,
  quantity: number,
  section?: string
): Promise<{ success: boolean; message: string; cartCount?: number }> {
  const { page, context } = await initBrowser();

  try {
    // First select seats
    await selectSeats(eventIdOrUrl, quantity, section);

    // Then click Add to Cart
    const addBtn = await page.$(
      '[data-testid="add-to-cart"], button:has-text("Add to Cart"), button:has-text("Add Tickets")'
    );

    if (!addBtn) {
      // On Ticketmaster, sometimes checkout is direct - look for Continue button
      const continueBtn = await page.$(
        'button:has-text("Continue"), button:has-text("Checkout"), [data-testid="continue"]'
      );
      if (continueBtn) {
        await randomDelay();
        await continueBtn.click();
        await randomDelay(1000, 2000);

        await saveCookies(context);
        return {
          success: true,
          message: `Added ${quantity} ticket(s) to cart. Proceeding to checkout.`,
        };
      }
      throw new Error("Could not find add to cart or checkout button");
    }

    await randomDelay();
    await addBtn.click();
    await randomDelay(1200, 2500);

    // Get cart count if available
    const cartBadge = await page.$(
      '[data-testid="cart-count"], [class*="CartCount"], [class*="cart-badge"]'
    );
    const cartCountText = cartBadge ? await cartBadge.textContent() : null;
    const cartCount = cartCountText
      ? parseInt(cartCountText.trim(), 10)
      : undefined;

    await saveCookies(context);

    return {
      success: true,
      message: `Successfully added ${quantity} ticket(s) to cart`,
      cartCount,
    };
  } catch (error) {
    throw new Error(
      `Failed to add to cart: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function viewCart(): Promise<CartSummary> {
  const { page, context } = await initBrowser();

  try {
    await page.goto(`${TM_BASE_URL}/cart`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });
    await randomDelay();

    // Check for empty cart
    const emptyEl = await page.$(
      '[class*="empty-cart"], [data-testid="empty-cart"], :text("Your cart is empty"), :text("No items")'
    );
    if (emptyEl) {
      return {
        items: [],
        subtotal: "$0.00",
        total: "$0.00",
        itemCount: 0,
      };
    }

    const cartData = await page.evaluate(() => {
      const cartItems = document.querySelectorAll(
        '[data-testid="cart-item"], [class*="CartItem"], [class*="cart-item"], [class*="order-item"]'
      );
      const items: CartItem[] = [];

      cartItems.forEach((item) => {
        const nameEl = item.querySelector(
          '[data-testid="event-name"], [class*="EventName"], [class*="item-name"]'
        );
        const dateEl = item.querySelector(
          '[data-testid="event-date"], [class*="EventDate"], [class*="date"]'
        );
        const venueEl = item.querySelector(
          '[data-testid="venue"], [class*="Venue"], [class*="venue"]'
        );
        const sectionEl = item.querySelector(
          '[data-testid="section"], [class*="Section"]'
        );
        const rowEl = item.querySelector(
          '[data-testid="row"], [class*="Row"]'
        );
        const seatsEl = item.querySelector(
          '[data-testid="seats"], [class*="Seats"]'
        );
        const qtyEl = item.querySelector(
          '[data-testid="quantity"], [class*="Quantity"]'
        );
        const priceEl = item.querySelector(
          '[data-testid="price"], [class*="Price"]'
        );

        items.push({
          eventName: nameEl?.textContent?.trim() || "Unknown Event",
          date: dateEl?.textContent?.trim() || "TBD",
          venue: venueEl?.textContent?.trim() || "Unknown Venue",
          section: sectionEl?.textContent?.trim() || "Unknown Section",
          row: rowEl?.textContent?.trim() || undefined,
          seats: seatsEl?.textContent?.trim() || "TBD",
          quantity: parseInt(qtyEl?.textContent?.trim() || "1", 10),
          price: priceEl?.textContent?.trim() || "Unknown",
        });
      });

      const subtotalEl = document.querySelector(
        '[data-testid="subtotal"], [class*="Subtotal"]'
      );
      const feesEl = document.querySelector(
        '[data-testid="fees"], [class*="Fees"], [class*="service-fee"]'
      );
      const taxEl = document.querySelector(
        '[data-testid="tax"], [class*="Tax"]'
      );
      const totalEl = document.querySelector(
        '[data-testid="total"], [class*="Total"]:not([class*="Subtotal"])'
      );

      const extractPrice = (el: Element | null): string => {
        if (!el) return "";
        const text = el.textContent || "";
        const match = text.match(/\$[\d.,]+/);
        return match ? match[0] : "";
      };

      return {
        items,
        subtotal: extractPrice(subtotalEl) || "$0.00",
        fees: extractPrice(feesEl) || undefined,
        tax: extractPrice(taxEl) || undefined,
        total: extractPrice(totalEl) || "$0.00",
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
      };
    });

    await saveCookies(context);
    return cartData;
  } catch (error) {
    throw new Error(
      `Failed to view cart: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ─── Checkout ─────────────────────────────────────────────────────────────────

export async function checkout(
  confirm: boolean
): Promise<
  | OrderResult
  | { requiresConfirmation: true; cart: CartSummary; message: string }
> {
  if (!confirm) {
    const cart = await viewCart();
    return {
      requiresConfirmation: true,
      cart,
      message:
        "Order not placed. Call ticketmaster_checkout with confirm=true to complete purchase. " +
        "IMPORTANT: Only do this with explicit user confirmation.",
    };
  }

  const { page, context } = await initBrowser();

  try {
    // Navigate to checkout
    await page.goto(`${TM_BASE_URL}/checkout`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });
    await randomDelay();

    const issue = await detectQueueOrCaptcha(page);
    if (issue === "captcha") {
      throw new Error("CAPTCHA verification required during checkout. Manual intervention needed.");
    }

    // Wait for checkout page to load
    await waitForPageOrQueue(
      page,
      '[data-testid="checkout-form"], [class*="CheckoutForm"], [class*="payment-section"]',
      15000
    );
    await randomDelay();

    // Look for Place Order button
    const placeOrderBtn = await page.$(
      '[data-testid="place-order"], button:has-text("Place Order"), button:has-text("Complete Purchase"), button:has-text("Buy Now")'
    );

    if (!placeOrderBtn) {
      throw new Error(
        "Could not find place order button. Verify payment method and delivery options are set."
      );
    }

    await randomDelay();
    await placeOrderBtn.click();

    // Wait for confirmation
    await page.waitForURL(
      (url) =>
        url.href.includes("/confirmation") ||
        url.href.includes("/order-confirmation") ||
        url.href.includes("/thank-you"),
      { timeout: 30000 }
    );
    await randomDelay(1500, 2500);

    // Extract confirmation details
    const confirmation = await page.evaluate(() => {
      const orderIdEl = document.querySelector(
        '[data-testid="order-id"], [class*="OrderId"], [class*="order-number"]'
      );
      const eventNameEl = document.querySelector(
        '[data-testid="event-name"], [class*="EventName"], h1'
      );
      const dateEl = document.querySelector(
        '[data-testid="event-date"], [class*="EventDate"]'
      );
      const venueEl = document.querySelector(
        '[data-testid="venue"], [class*="Venue"]'
      );
      const sectionEl = document.querySelector(
        '[data-testid="section"], [class*="Section"]'
      );
      const seatsEl = document.querySelector(
        '[data-testid="seats"], [class*="Seats"]'
      );
      const totalEl = document.querySelector(
        '[data-testid="total"], [class*="Total"]'
      );
      const deliveryEl = document.querySelector(
        '[data-testid="delivery-method"], [class*="DeliveryMethod"]'
      );

      return {
        orderId: orderIdEl?.textContent?.trim() || "Unknown",
        eventName: eventNameEl?.textContent?.trim() || "Unknown Event",
        date: dateEl?.textContent?.trim() || "TBD",
        venue: venueEl?.textContent?.trim() || "Unknown Venue",
        section: sectionEl?.textContent?.trim() || "Unknown Section",
        seats: seatsEl?.textContent?.trim() || "Unknown",
        total: totalEl?.textContent?.trim() || "Unknown",
        deliveryMethod: deliveryEl?.textContent?.trim() || undefined,
        confirmationUrl: window.location.href,
      };
    });

    await saveCookies(context);
    return confirmation;
  } catch (error) {
    throw new Error(
      `Checkout failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ─── Order History ────────────────────────────────────────────────────────────

export async function getOrders(maxResults = 20): Promise<OrderHistoryItem[]> {
  const { page, context } = await initBrowser();

  try {
    await page.goto(`${TM_BASE_URL}/my-account/orders`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });
    await randomDelay();

    // Check if login is required
    const signInEl = await page.$(
      '[data-testid="sign-in"], button:has-text("Sign In"), [href*="/login"]'
    );
    if (signInEl) {
      throw new Error(
        "Login required to view orders. Use ticketmaster_login first."
      );
    }

    await waitForPageOrQueue(
      page,
      '[data-testid="order-item"], [class*="OrderItem"], [class*="order-card"]',
      10000
    );
    await randomDelay(500, 1000);

    const orders = await page.evaluate(
      (max: number) => {
        const orderEls = document.querySelectorAll(
          '[data-testid="order-item"], [class*="OrderItem"], [class*="order-card"]'
        );
        const results: OrderHistoryItem[] = [];

        orderEls.forEach((order, index) => {
          if (index >= max) return;

          const orderIdEl = order.querySelector(
            '[data-testid="order-id"], [class*="OrderId"]'
          );
          const nameEl = order.querySelector(
            '[data-testid="event-name"], [class*="EventName"]'
          );
          const dateEl = order.querySelector(
            '[data-testid="event-date"], [class*="EventDate"]'
          );
          const venueEl = order.querySelector(
            '[data-testid="venue"], [class*="Venue"]'
          );
          const qtyEl = order.querySelector(
            '[data-testid="quantity"], [class*="Quantity"]'
          );
          const totalEl = order.querySelector(
            '[data-testid="total"], [class*="Total"]'
          );
          const statusEl = order.querySelector(
            '[data-testid="status"], [class*="Status"]'
          );
          const orderDateEl = order.querySelector(
            '[data-testid="order-date"], [class*="OrderDate"]'
          );

          results.push({
            orderId: orderIdEl?.textContent?.trim() || `Order-${index}`,
            eventName: nameEl?.textContent?.trim() || "Unknown Event",
            date: dateEl?.textContent?.trim() || "TBD",
            venue: venueEl?.textContent?.trim() || "Unknown Venue",
            quantity: parseInt(qtyEl?.textContent?.trim() || "1", 10),
            total: totalEl?.textContent?.trim() || "Unknown",
            status: statusEl?.textContent?.trim() || "Completed",
            orderDate: orderDateEl?.textContent?.trim() || "Unknown",
          });
        });

        return results;
      },
      Math.min(maxResults, 50)
    );

    await saveCookies(context);
    return orders;
  } catch (error) {
    throw new Error(
      `Failed to get orders: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ─── Process Cleanup ──────────────────────────────────────────────────────────

process.on("exit", () => {
  if (browser) {
    browser.close().catch(() => {});
  }
});

process.on("SIGINT", async () => {
  await closeBrowser();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeBrowser();
  process.exit(0);
});
