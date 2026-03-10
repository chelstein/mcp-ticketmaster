# @striderlabs/mcp-ticketmaster

MCP server for Ticketmaster — let AI agents search events, check ticket availability, select seats, and purchase tickets via browser automation.

Built by [Strider Labs](https://striderlabs.ai).

## Features

- **Event Search** — Search events by keyword, location, and date range
- **Event & Venue Details** — Get comprehensive info about events and venues
- **Ticket Availability** — Real-time availability checks with section details
- **Price Ranges** — Full price tier breakdown including fees
- **Seat Selection** — Choose specific sections or best available
- **Cart Management** — Add tickets and view cart contents
- **Secure Purchase** — Checkout with explicit confirmation gate
- **Order History** — View past Ticketmaster orders
- **Session Persistence** — Cookies saved to `~/.strider/ticketmaster/`
- **Bot Detection Handling** — Random delays, stealth patches, queue detection
- **CAPTCHA Awareness** — Gracefully reports when manual intervention needed

## Installation

```bash
npm install -g @striderlabs/mcp-ticketmaster
npx playwright install chromium
```

## Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ticketmaster": {
      "command": "striderlabs-mcp-ticketmaster"
    }
  }
}
```

Or with npx:

```json
{
  "mcpServers": {
    "ticketmaster": {
      "command": "npx",
      "args": ["-y", "@striderlabs/mcp-ticketmaster"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `ticketmaster_status` | Check login status and session info |
| `ticketmaster_login` | Initiate login flow (returns URL for manual login) |
| `ticketmaster_logout` | Clear session and cookies |
| `ticketmaster_search_events` | Search events by keyword, location, date |
| `ticketmaster_get_event` | Get detailed event information |
| `ticketmaster_get_venues` | Find venues near a location |
| `ticketmaster_get_venue` | Get venue details |
| `ticketmaster_check_availability` | Check ticket availability for an event |
| `ticketmaster_get_prices` | Get price ranges for an event |
| `ticketmaster_select_seats` | Select seats/tickets (preview, no cart yet) |
| `ticketmaster_add_to_cart` | Add tickets to cart |
| `ticketmaster_view_cart` | View cart contents and totals |
| `ticketmaster_checkout` | Purchase tickets (requires `confirm=true`) |
| `ticketmaster_get_orders` | Get order history |

## Usage Examples

### Search for events

```
ticketmaster_search_events(keyword="Taylor Swift", location="New York, NY")
```

### Check availability and prices

```
ticketmaster_check_availability(eventId="Z698xZC2Z17aVaQe")
ticketmaster_get_prices(eventId="Z698xZC2Z17aVaQe")
```

### Buy tickets flow

```
1. ticketmaster_search_events(keyword="Coldplay", location="Los Angeles")
2. ticketmaster_check_availability(eventId="<id from search>")
3. ticketmaster_get_prices(eventId="<id>")
4. ticketmaster_add_to_cart(eventId="<id>", quantity=2)
5. ticketmaster_view_cart()
6. ticketmaster_checkout(confirm=true)  // Only after explicit user confirmation!
```

## Authentication Flow

Ticketmaster requires manual login (no automated login supported):

1. Run `ticketmaster_login` — returns the login URL
2. Open the URL in your browser and log in with your Ticketmaster account
3. Run `ticketmaster_status` to verify the session was captured
4. Session cookies are saved to `~/.strider/ticketmaster/` for future use

## Bot Detection & Queue Handling

Ticketmaster actively detects automation. This server includes:

- **Random delays** (800–2500ms) between actions to simulate human behavior
- **Stealth patches** that mask webdriver fingerprints
- **Custom user agent** mimicking real Chrome on macOS
- **Queue detection** — if placed in a queue for high-demand events, waits up to 60 seconds
- **CAPTCHA detection** — reports when CAPTCHA is encountered (manual intervention required)

> **Note:** For high-demand events (major artists, playoffs, etc.), Ticketmaster's anti-bot systems
> may block automated access. If this happens, consider completing the purchase manually.

## Purchase Safety

`ticketmaster_checkout` requires `confirm=true` to actually purchase tickets:

```
// Preview only (default):
ticketmaster_checkout()

// Actually purchase:
ticketmaster_checkout(confirm=true)  // Only with explicit user approval!
```

**NEVER** call `ticketmaster_checkout(confirm=true)` without getting explicit confirmation from the user first.

## Configuration Directory

Sessions are stored at: `~/.strider/ticketmaster/`

```
~/.strider/ticketmaster/
├── cookies.json    # Browser session cookies
└── session.json    # Session metadata (email, login status)
```

## Technical Details

- **Browser automation:** Playwright (headless Chromium)
- **Stealth:** Masks `navigator.webdriver`, spoofs plugin count, sets realistic user agent
- **Transport:** MCP stdio
- **Language:** TypeScript (compiled to `dist/`)

## Limitations

- Login must be completed manually (Ticketmaster blocks automated form submission)
- CAPTCHA requires human intervention
- High-demand events may be subject to queue systems
- DOM selectors may break if Ticketmaster updates their UI
- Delivery method and payment info must be pre-configured in your account

## Troubleshooting

**"Login required"** — Run `ticketmaster_login` and complete login in your browser.

**"CAPTCHA detected"** — Open Ticketmaster in your browser, complete the CAPTCHA, then retry.

**"Currently in queue"** — High demand event. The server waits up to 60s. If it times out, try again.

**"Could not find buy tickets button"** — Event may be sold out or not yet on sale.

**Prices show as "Unknown"** — Ticketmaster may require login to display prices.

## Development

```bash
git clone https://github.com/striderlabs/mcp-ticketmaster
cd mcp-ticketmaster
npm install
npx playwright install chromium
npm run build
npm start
```

## License

MIT — [Strider Labs](https://striderlabs.ai)
