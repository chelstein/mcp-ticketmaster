#!/usr/bin/env node

/**
 * Strider Labs Ticketmaster MCP Server
 *
 * MCP server that gives AI agents the ability to search events, check ticket
 * availability, select seats, and purchase tickets on Ticketmaster via browser automation.
 * https://striderlabs.ai
 */

import express from "express";
import type { Request, Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  checkLoginStatus,
  initiateLogin,
  closeBrowser,
  searchEvents,
  getEventDetails,
  getVenuesNearLocation,
  getVenueDetails,
  checkTicketAvailability,
  getEventPrices,
  selectSeats,
  addToCart,
  viewCart,
  checkout,
  getOrders,
  withBrowserLock,
} from "./browser.js";
import { loadSessionInfo, clearAuthData, getConfigDir } from "./auth.js";

function createMcpServer(): Server {
  const server = new Server(
    { name: "strider-ticketmaster", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "ticketmaster_status",
        description:
          "Check Ticketmaster login status and session info. Use this to verify authentication before performing other actions.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "ticketmaster_login",
        description:
          "Initiate Ticketmaster login flow. Returns a URL and instructions for the user to complete login manually. After logging in, use ticketmaster_status to verify.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "ticketmaster_logout",
        description:
          "Clear saved Ticketmaster session and cookies. Use this to log out or reset authentication state.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "ticketmaster_search_events",
        description:
          "Search for events on Ticketmaster. Returns event names, dates, venues, and price ranges.",
        inputSchema: {
          type: "object",
          properties: {
            keyword: { type: "string", description: "Search keyword (e.g., 'Taylor Swift', 'NBA Lakers', 'Hamilton')" },
            location: { type: "string", description: "Location to search near (e.g., 'New York, NY', 'Los Angeles', '90001')" },
            startDate: { type: "string", description: "Start date filter in YYYY-MM-DD format" },
            endDate: { type: "string", description: "End date filter in YYYY-MM-DD format" },
            maxResults: { type: "number", description: "Maximum number of results to return (default: 20, max: 50)" },
          },
          required: ["keyword"],
        },
      },
      {
        name: "ticketmaster_get_event",
        description: "Get detailed information about a specific event by event ID or URL.",
        inputSchema: {
          type: "object",
          properties: {
            eventId: { type: "string", description: "Ticketmaster event ID (e.g., 'Z698xZC2Z17aVaQe') or full event URL" },
          },
          required: ["eventId"],
        },
      },
      {
        name: "ticketmaster_get_venues",
        description: "Search for venues near a location.",
        inputSchema: {
          type: "object",
          properties: {
            location: { type: "string", description: "Location to search near (e.g., 'New York, NY', 'Chicago', '60601')" },
            maxResults: { type: "number", description: "Maximum number of results (default: 10)" },
          },
          required: ["location"],
        },
      },
      {
        name: "ticketmaster_get_venue",
        description: "Get detailed information about a specific venue by venue ID or URL.",
        inputSchema: {
          type: "object",
          properties: {
            venueId: { type: "string", description: "Ticketmaster venue ID or full venue URL" },
          },
          required: ["venueId"],
        },
      },
      {
        name: "ticketmaster_check_availability",
        description:
          "Check ticket availability for a specific event. Returns availability status and section info.",
        inputSchema: {
          type: "object",
          properties: {
            eventId: { type: "string", description: "Ticketmaster event ID or full event URL" },
          },
          required: ["eventId"],
        },
      },
      {
        name: "ticketmaster_get_prices",
        description:
          "Get price ranges for a specific event, including all ticket tiers and fee estimates.",
        inputSchema: {
          type: "object",
          properties: {
            eventId: { type: "string", description: "Ticketmaster event ID or full event URL" },
          },
          required: ["eventId"],
        },
      },
      {
        name: "ticketmaster_select_seats",
        description:
          "Select seats/tickets for an event. Returns selected ticket details. Does NOT add to cart yet.",
        inputSchema: {
          type: "object",
          properties: {
            eventId: { type: "string", description: "Ticketmaster event ID or full event URL" },
            quantity: { type: "number", description: "Number of tickets to select" },
            section: { type: "string", description: "Preferred section name (optional - will use best available if not specified)" },
            maxPrice: { type: "number", description: "Maximum price per ticket in USD (optional)" },
          },
          required: ["eventId", "quantity"],
        },
      },
      {
        name: "ticketmaster_add_to_cart",
        description: "Add tickets to the Ticketmaster cart for an event.",
        inputSchema: {
          type: "object",
          properties: {
            eventId: { type: "string", description: "Ticketmaster event ID or full event URL" },
            quantity: { type: "number", description: "Number of tickets to add" },
            section: { type: "string", description: "Preferred section (optional - will use best available if not specified)" },
          },
          required: ["eventId", "quantity"],
        },
      },
      {
        name: "ticketmaster_view_cart",
        description: "View current Ticketmaster cart contents, including events, seats, and totals.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "ticketmaster_checkout",
        description:
          "Purchase tickets. IMPORTANT: Set confirm=true only when you have explicit user confirmation. Without confirm=true, this returns a cart preview instead of purchasing.",
        inputSchema: {
          type: "object",
          properties: {
            confirm: {
              type: "boolean",
              description:
                "Set to true to actually purchase the tickets. If false or omitted, returns cart preview. NEVER set to true without explicit user confirmation.",
            },
          },
        },
      },
      {
        name: "ticketmaster_get_orders",
        description: "Get Ticketmaster order history. Requires being logged in.",
        inputSchema: {
          type: "object",
          properties: {
            maxResults: { type: "number", description: "Maximum number of orders to return (default: 20)" },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "ticketmaster_status": {
          const sessionInfo = loadSessionInfo();
          const liveStatus = await withBrowserLock(() => checkLoginStatus());

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    session: liveStatus,
                    savedSession: sessionInfo,
                    configDir: getConfigDir(),
                    message: liveStatus.isLoggedIn
                      ? `Logged in${liveStatus.userEmail ? ` as ${liveStatus.userEmail}` : liveStatus.userName ? ` as ${liveStatus.userName}` : ""}`
                      : "Not logged in. Use ticketmaster_login to authenticate.",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "ticketmaster_login": {
          const result = await withBrowserLock(() => initiateLogin());
          return {
            content: [
              { type: "text", text: JSON.stringify({ success: true, ...result }, null, 2) },
            ],
          };
        }

        case "ticketmaster_logout": {
          clearAuthData();
          await closeBrowser();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: true,
                  message: "Logged out. Session and cookies cleared.",
                }),
              },
            ],
          };
        }

        case "ticketmaster_search_events": {
          const { keyword, location, startDate, endDate, maxResults = 20 } = args as {
            keyword: string;
            location?: string;
            startDate?: string;
            endDate?: string;
            maxResults?: number;
          };
          const events = await withBrowserLock(() =>
            searchEvents(keyword, location, startDate, endDate, Math.min(maxResults, 50))
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { success: true, keyword, location, count: events.length, events },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "ticketmaster_get_event": {
          const { eventId } = args as { eventId: string };
          const event = await withBrowserLock(() => getEventDetails(eventId));
          return {
            content: [
              { type: "text", text: JSON.stringify({ success: true, event }, null, 2) },
            ],
          };
        }

        case "ticketmaster_get_venues": {
          const { location, maxResults = 10 } = args as {
            location: string;
            maxResults?: number;
          };
          const venues = await withBrowserLock(() =>
            getVenuesNearLocation(location, Math.min(maxResults, 20))
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { success: true, location, count: venues.length, venues },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "ticketmaster_get_venue": {
          const { venueId } = args as { venueId: string };
          const venue = await withBrowserLock(() => getVenueDetails(venueId));
          return {
            content: [
              { type: "text", text: JSON.stringify({ success: true, venue }, null, 2) },
            ],
          };
        }

        case "ticketmaster_check_availability": {
          const { eventId } = args as { eventId: string };
          const availability = await withBrowserLock(() => checkTicketAvailability(eventId));
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    availability,
                    message: availability.available
                      ? "Tickets are available for this event."
                      : availability.message || "Tickets are not available.",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "ticketmaster_get_prices": {
          const { eventId } = args as { eventId: string };
          const prices = await withBrowserLock(() => getEventPrices(eventId));
          return {
            content: [
              { type: "text", text: JSON.stringify({ success: true, prices }, null, 2) },
            ],
          };
        }

        case "ticketmaster_select_seats": {
          const { eventId, quantity, section, maxPrice } = args as {
            eventId: string;
            quantity: number;
            section?: string;
            maxPrice?: number;
          };
          const selected = await withBrowserLock(() =>
            selectSeats(eventId, quantity, section, maxPrice)
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    selected,
                    note: "Seats selected. Use ticketmaster_add_to_cart to add them to your cart.",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "ticketmaster_add_to_cart": {
          const { eventId, quantity, section } = args as {
            eventId: string;
            quantity: number;
            section?: string;
          };
          const result = await withBrowserLock(() => addToCart(eventId, quantity, section));
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: result.success,
                    message: result.message,
                    cartCount: result.cartCount,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "ticketmaster_view_cart": {
          const cart = await withBrowserLock(() => viewCart());
          return {
            content: [
              { type: "text", text: JSON.stringify({ success: true, cart }, null, 2) },
            ],
          };
        }

        case "ticketmaster_checkout": {
          const { confirm = false } = args as { confirm?: boolean };
          const result = await withBrowserLock(() => checkout(confirm));

          if ("requiresConfirmation" in result) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      success: true,
                      requiresConfirmation: true,
                      cart: result.cart,
                      message: result.message,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    orderPlaced: true,
                    order: result,
                    message: `Order ${result.orderId} placed successfully! Your tickets for ${result.eventName} have been purchased.`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "ticketmaster_get_orders": {
          const { maxResults = 20 } = args as { maxResults?: number };
          const orders = await withBrowserLock(() => getOrders(Math.min(maxResults, 50)));
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { success: true, count: orders.length, orders },
                  null,
                  2
                ),
              },
            ],
          };
        }

        default:
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ success: false, error: `Unknown tool: ${name}` }),
              },
            ],
            isError: true,
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: false,
                error: errorMessage,
                suggestion:
                  errorMessage.includes("login") ||
                  errorMessage.includes("auth") ||
                  errorMessage.includes("sign in")
                    ? "Try running ticketmaster_login to authenticate"
                    : errorMessage.includes("queue")
                    ? "Ticketmaster queue detected. This is a high-demand event - try again shortly."
                    : errorMessage.includes("captcha") || errorMessage.includes("CAPTCHA")
                    ? "CAPTCHA detected. Manual browser interaction may be required."
                    : errorMessage.includes("timeout")
                    ? "The page took too long to load. Try again."
                    : undefined,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

const app = express();
app.use(express.json({ limit: "4mb" }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "strider-ticketmaster-mcp" });
});

app.use(express.static(publicDir));

app.post("/mcp", async (req: Request, res: Response) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

const port = parseInt(process.env.PORT ?? "3000", 10);
const httpServer = app.listen(port, () => {
  console.error(`Strider Ticketmaster MCP HTTP server listening on :${port}`);
  console.error(`Config directory: ${getConfigDir()}`);
});

async function shutdown(signal: string) {
  console.error(`Received ${signal}, shutting down...`);
  httpServer.close();
  await closeBrowser();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
