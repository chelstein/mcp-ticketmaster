// Minimal MCP-over-HTTP client.
// Calls POST /mcp with JSON-RPC, parses either application/json or
// text/event-stream responses, returns the parsed tool payload.

let nextId = 1;

async function rpc(method, params) {
  const body = { jsonrpc: "2.0", id: nextId++, method, params };
  const res = await fetch("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const ct = res.headers.get("content-type") || "";
  let envelope;
  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    envelope = parseFirstSseMessage(text);
  } else {
    envelope = await res.json();
  }

  if (!envelope) throw new Error("Empty MCP response");
  if (envelope.error) {
    throw new Error(envelope.error.message || "MCP error");
  }
  return envelope.result;
}

function parseFirstSseMessage(text) {
  // Looks for the first `data: <json>` block.
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      const json = line.slice(5).trim();
      if (json) return JSON.parse(json);
    }
  }
  return null;
}

// Tool calls return { content: [{ type: "text", text: "<json>" }] }.
// Unwrap to the parsed payload.
async function callTool(name, args = {}) {
  const result = await rpc("tools/call", { name, arguments: args });
  const part = result?.content?.[0];
  if (!part || part.type !== "text") {
    throw new Error("Unexpected tool response shape");
  }
  let payload;
  try {
    payload = JSON.parse(part.text);
  } catch {
    throw new Error("Tool returned non-JSON text");
  }
  if (payload.success === false) {
    const err = new Error(payload.error || "Tool reported failure");
    err.suggestion = payload.suggestion;
    throw err;
  }
  return payload;
}

export const mcp = {
  status: () => callTool("ticketmaster_status"),
  login: () => callTool("ticketmaster_login"),
  logout: () => callTool("ticketmaster_logout"),
  searchEvents: (args) => callTool("ticketmaster_search_events", args),
  getEvent: (eventId) => callTool("ticketmaster_get_event", { eventId }),
  getVenues: (location, maxResults) =>
    callTool("ticketmaster_get_venues", { location, maxResults }),
  getVenue: (venueId) => callTool("ticketmaster_get_venue", { venueId }),
  checkAvailability: (eventId) =>
    callTool("ticketmaster_check_availability", { eventId }),
  getPrices: (eventId) => callTool("ticketmaster_get_prices", { eventId }),
  selectSeats: (args) => callTool("ticketmaster_select_seats", args),
  addToCart: (args) => callTool("ticketmaster_add_to_cart", args),
  viewCart: () => callTool("ticketmaster_view_cart"),
  checkout: (confirm) => callTool("ticketmaster_checkout", { confirm: !!confirm }),
  getOrders: (maxResults) =>
    callTool("ticketmaster_get_orders", { maxResults }),
};
