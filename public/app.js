import { mcp } from "/mcp.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ── Tabs ───────────────────────────────────────────────
function activateTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$("section.panel").forEach((p) => {
    p.hidden = p.id !== `panel-${name}`;
  });
}
$$(".tab").forEach((t) =>
  t.addEventListener("click", () => activateTab(t.dataset.tab))
);

// ── Toast ──────────────────────────────────────────────
const toastEl = $("#toast");
let toastTimer;
function toast(msg, kind = "info") {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.className = `toast ${kind}`;
  toastEl.hidden = false;
  toastTimer = setTimeout(() => (toastEl.hidden = true), 4000);
}
function errToast(err) {
  const suffix = err.suggestion ? ` — ${err.suggestion}` : "";
  toast(`${err.message}${suffix}`, "error");
}

// ── Auth pill ──────────────────────────────────────────
const authPill = $("#auth-pill");
async function refreshAuthPill() {
  try {
    const data = await mcp.status();
    const live = data.session;
    if (live?.isLoggedIn) {
      const who = live.userEmail || live.userName || "logged in";
      authPill.textContent = who;
      authPill.className = "auth logged-in";
    } else {
      authPill.textContent = "Not logged in";
      authPill.className = "auth logged-out";
    }
    return data;
  } catch (err) {
    authPill.textContent = "Status unavailable";
    authPill.className = "auth logged-out";
    throw err;
  }
}

// ── Search ─────────────────────────────────────────────
const searchForm = $("#search-form");
const searchResults = $("#search-results");

function setLoading(el, msg = "Loading…") {
  el.innerHTML = `<p class="muted"><span class="spinner"></span>${msg}</p>`;
}

searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(searchForm);
  const args = {
    keyword: fd.get("keyword")?.toString().trim(),
    location: fd.get("location")?.toString().trim() || undefined,
    startDate: fd.get("startDate")?.toString() || undefined,
    endDate: fd.get("endDate")?.toString() || undefined,
    maxResults: Number(fd.get("maxResults")) || 20,
  };
  if (!args.keyword) return;

  setLoading(searchResults, "Searching events…");
  try {
    const data = await mcp.searchEvents(args);
    renderSearchResults(data.events || []);
  } catch (err) {
    searchResults.innerHTML = `<p class="muted">${escape(err.message)}</p>`;
    errToast(err);
  }
});

function renderSearchResults(events) {
  if (!events.length) {
    searchResults.innerHTML = `<p class="muted">No events found.</p>`;
    return;
  }
  searchResults.innerHTML = "";
  events.forEach((ev) => {
    const card = document.createElement("div");
    card.className = "event-card";
    card.dataset.eventId = ev.id;
    card.innerHTML = `
      <div class="event-row">
        <div>
          <div class="event-name">${escape(ev.name)}</div>
          <div class="event-meta">
            ${escape(ev.date)}${ev.time ? ` · ${escape(ev.time)}` : ""}
            · ${escape(ev.venue)} · ${escape(ev.city)}
          </div>
        </div>
        <div class="event-price">${escape(ev.priceRange || "—")}</div>
      </div>
      <div class="event-detail" hidden></div>
    `;
    card.addEventListener("click", (e) => {
      if (e.target.closest(".event-detail") || e.target.closest("button") || e.target.closest("input")) return;
      toggleEventDetail(card, ev);
    });
    searchResults.appendChild(card);
  });
}

async function toggleEventDetail(card, ev) {
  const detail = $(".event-detail", card);
  if (!detail.hidden) {
    detail.hidden = true;
    card.classList.remove("expanded");
    return;
  }
  card.classList.add("expanded");
  detail.hidden = false;
  detail.innerHTML = `<p class="muted"><span class="spinner"></span>Loading event details…</p>`;

  try {
    const [det, avail, prices] = await Promise.allSettled([
      mcp.getEvent(ev.id),
      mcp.checkAvailability(ev.id),
      mcp.getPrices(ev.id),
    ]);
    detail.innerHTML = renderEventDetail(ev, det, avail, prices);
    wireBuyForm(detail, ev);
  } catch (err) {
    detail.innerHTML = `<p class="muted">${escape(err.message)}</p>`;
  }
}

function renderEventDetail(ev, detRes, availRes, pricesRes) {
  const det = detRes.status === "fulfilled" ? detRes.value.event : {};
  const availPayload = availRes.status === "fulfilled" ? availRes.value : null;
  const av = availPayload?.availability || {};
  const prices = pricesRes.status === "fulfilled" ? pricesRes.value.prices : null;

  const infoBlock = `
    <div class="detail-block">
      <h3>Event</h3>
      <dl>
        <dt>Date</dt><dd>${escape(det.date || ev.date || "—")}</dd>
        <dt>Venue</dt><dd>${escape(det.venue || ev.venue || "—")}</dd>
        <dt>City</dt><dd>${escape(det.city || ev.city || "—")}</dd>
        ${det.ageRestriction ? `<dt>Ages</dt><dd>${escape(det.ageRestriction)}</dd>` : ""}
        <dt>Status</dt><dd>${
          av.available
            ? '<span style="color: var(--success)">Available</span>'
            : av.message
              ? `<span style="color: var(--warning)">${escape(av.message)}</span>`
              : "—"
        }</dd>
      </dl>
    </div>
  `;

  const priceBlock = `
    <div class="detail-block">
      <h3>Pricing</h3>
      <dl>
        ${prices?.minPrice ? `<dt>From</dt><dd>${escape(prices.minPrice)}</dd>` : ""}
        ${prices?.maxPrice ? `<dt>To</dt><dd>${escape(prices.maxPrice)}</dd>` : ""}
        ${prices?.fees ? `<dt>Fees</dt><dd>${escape(prices.fees)}</dd>` : ""}
      </dl>
      ${
        prices?.priceRanges?.length
          ? `<div class="muted" style="margin-top:6px;font-size:12px;">
                ${prices.priceRanges
                  .map(
                    (p) =>
                      `${escape(p.type)}: $${escape(p.min)}–$${escape(p.max)}`
                  )
                  .join(" · ")}
            </div>`
          : ""
      }
    </div>
  `;

  const buyBlock = `
    <form class="buy-form" data-event-id="${escape(ev.id)}">
      <h3>Add to cart</h3>
      <div class="row">
        <label class="small">
          <span>Quantity</span>
          <input name="quantity" type="number" min="1" max="10" value="2" required />
        </label>
        <label>
          <span>Section (optional)</span>
          <input name="section" type="text" placeholder="Best available" />
        </label>
        <label class="small">
          <span>Max price</span>
          <input name="maxPrice" type="number" min="0" placeholder="—" />
        </label>
        <button class="ghost" data-action="select">Select seats</button>
        <button class="primary" data-action="cart">Add to cart</button>
      </div>
      <div class="buy-status" style="margin-top:10px;"></div>
    </form>
  `;

  return infoBlock + priceBlock + buyBlock;
}

function wireBuyForm(detail, ev) {
  const form = $("form.buy-form", detail);
  if (!form) return;
  const status = $(".buy-status", form);

  form.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    e.preventDefault();
    const fd = new FormData(form);
    const args = {
      eventId: ev.id,
      quantity: Number(fd.get("quantity")) || 1,
      section: fd.get("section")?.toString().trim() || undefined,
      maxPrice: fd.get("maxPrice") ? Number(fd.get("maxPrice")) : undefined,
    };

    btn.disabled = true;
    status.innerHTML = `<span class="spinner"></span>Working…`;
    try {
      if (btn.dataset.action === "select") {
        const r = await mcp.selectSeats(args);
        status.innerHTML = `Selected: <strong>${escape(r.selected.section)}</strong> × ${r.selected.quantity} — ${escape(r.selected.total || r.selected.priceEach || "")}`;
      } else {
        const r = await mcp.addToCart(args);
        status.innerHTML = r.success
          ? `<span style="color:var(--success)">${escape(r.message)}</span>`
          : `<span style="color:var(--danger)">${escape(r.message)}</span>`;
        if (r.success) toast("Added to cart", "success");
      }
    } catch (err) {
      status.innerHTML = `<span style="color:var(--danger)">${escape(err.message)}</span>`;
      errToast(err);
    } finally {
      btn.disabled = false;
    }
  });
}

// ── Cart ───────────────────────────────────────────────
const cartBody = $("#cart-body");
$("#cart-refresh").addEventListener("click", loadCart);

async function loadCart() {
  setLoading(cartBody, "Loading cart…");
  try {
    const data = await mcp.viewCart();
    renderCart(data.cart);
  } catch (err) {
    cartBody.innerHTML = `<p class="muted">${escape(err.message)}</p>`;
    errToast(err);
  }
}

function renderCart(cart) {
  if (!cart || !cart.items?.length) {
    cartBody.innerHTML = `<p class="muted">Cart is empty.</p>`;
    return;
  }
  const items = cart.items
    .map(
      (it) => `
    <div class="cart-item">
      <div>
        <div class="event-name">${escape(it.eventName)}</div>
        <div class="event-meta">
          ${escape(it.date)} · ${escape(it.venue)}<br />
          ${escape(it.section)}${it.row ? ` · Row ${escape(it.row)}` : ""} · Seats ${escape(it.seats)} · Qty ${it.quantity}
        </div>
      </div>
      <div class="event-price">${escape(it.price)}</div>
    </div>
  `
    )
    .join("");

  cartBody.innerHTML = `
    <div class="cart-list">${items}</div>
    <div class="cart-totals">
      <div>Subtotal</div><div>${escape(cart.subtotal)}</div>
      ${cart.fees ? `<div>Fees</div><div>${escape(cart.fees)}</div>` : ""}
      ${cart.tax ? `<div>Tax</div><div>${escape(cart.tax)}</div>` : ""}
      <div class="total">Total</div><div class="total">${escape(cart.total)}</div>
    </div>
    <div class="cart-actions">
      <button class="ghost" id="cart-preview">Preview checkout</button>
      <button class="danger" id="cart-buy">Place order…</button>
    </div>
  `;
  $("#cart-preview").addEventListener("click", previewCheckout);
  $("#cart-buy").addEventListener("click", openConfirmModal);
}

async function previewCheckout() {
  try {
    const data = await mcp.checkout(false);
    if (data.requiresConfirmation) {
      toast(data.message || "Preview ready — click Place order to confirm", "info");
    }
  } catch (err) {
    errToast(err);
  }
}

// ── Confirm-purchase modal ─────────────────────────────
const modal = $("#confirm-modal");
const confirmCart = $("#confirm-cart");
$("#confirm-cancel").addEventListener("click", () => (modal.hidden = true));
$("#confirm-go").addEventListener("click", placeOrder);

async function openConfirmModal() {
  modal.hidden = false;
  confirmCart.innerHTML = `<p class="muted"><span class="spinner"></span>Loading preview…</p>`;
  try {
    const data = await mcp.checkout(false);
    const cart = data.cart;
    const items = (cart?.items || [])
      .map((i) => `<li>${escape(i.eventName)} — ${i.quantity} × ${escape(i.price)}</li>`)
      .join("");
    confirmCart.innerHTML = `
      <ul style="margin:8px 0;padding-left:20px;">${items || "<li>(empty)</li>"}</ul>
      <p><strong>Total: ${escape(cart?.total || "—")}</strong></p>
    `;
  } catch (err) {
    confirmCart.innerHTML = `<p class="muted">${escape(err.message)}</p>`;
  }
}

async function placeOrder() {
  const goBtn = $("#confirm-go");
  goBtn.disabled = true;
  goBtn.innerHTML = `<span class="spinner"></span>Placing order…`;
  try {
    const data = await mcp.checkout(true);
    modal.hidden = true;
    toast(data.message || "Order placed", "success");
    loadCart();
  } catch (err) {
    errToast(err);
  } finally {
    goBtn.disabled = false;
    goBtn.textContent = "Place order";
  }
}

// ── Orders ─────────────────────────────────────────────
const ordersBody = $("#orders-body");
$("#orders-refresh").addEventListener("click", loadOrders);

async function loadOrders() {
  setLoading(ordersBody, "Loading orders…");
  try {
    const data = await mcp.getOrders(20);
    if (!data.orders?.length) {
      ordersBody.innerHTML = `<p class="muted">No orders found.</p>`;
      return;
    }
    ordersBody.innerHTML = data.orders
      .map(
        (o) => `
      <div class="cart-item">
        <div>
          <div class="event-name">${escape(o.eventName)}</div>
          <div class="event-meta">
            ${escape(o.date)} · ${escape(o.venue)}<br />
            Order ${escape(o.orderId)} · ${escape(o.orderDate)} · Qty ${o.quantity}
          </div>
        </div>
        <div>
          <div class="event-price">${escape(o.total)}</div>
          <div class="event-meta" style="text-align:right;">${escape(o.status)}</div>
        </div>
      </div>
    `
      )
      .join("");
  } catch (err) {
    ordersBody.innerHTML = `<p class="muted">${escape(err.message)}</p>`;
    errToast(err);
  }
}

// ── Account ────────────────────────────────────────────
const accountBody = $("#account-body");
const loginInstructions = $("#login-instructions");
$("#account-status").addEventListener("click", loadAccount);
$("#account-login").addEventListener("click", doLogin);
$("#account-logout").addEventListener("click", doLogout);

async function loadAccount() {
  setLoading(accountBody, "Checking session…");
  try {
    const data = await refreshAuthPill();
    const live = data.session;
    accountBody.innerHTML = `
      <dl class="detail-block">
        <dt>Logged in</dt><dd>${live?.isLoggedIn ? "Yes" : "No"}</dd>
        ${live?.userEmail ? `<dt>Email</dt><dd>${escape(live.userEmail)}</dd>` : ""}
        ${live?.userName ? `<dt>Name</dt><dd>${escape(live.userName)}</dd>` : ""}
        <dt>Last checked</dt><dd>${escape(live?.lastUpdated || "—")}</dd>
        <dt>Config dir</dt><dd><code>${escape(data.configDir || "—")}</code></dd>
      </dl>
    `;
  } catch (err) {
    accountBody.innerHTML = `<p class="muted">${escape(err.message)}</p>`;
    errToast(err);
  }
}

async function doLogin() {
  loginInstructions.hidden = false;
  loginInstructions.textContent = "Requesting login link…";
  try {
    const data = await mcp.login();
    loginInstructions.textContent = `${data.instructions}\n\n${data.loginUrl}`;
  } catch (err) {
    loginInstructions.textContent = `Error: ${err.message}`;
    errToast(err);
  }
}

async function doLogout() {
  try {
    const data = await mcp.logout();
    toast(data.message || "Logged out", "success");
    refreshAuthPill();
    loadAccount();
  } catch (err) {
    errToast(err);
  }
}

function escape(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// ── Boot ───────────────────────────────────────────────
refreshAuthPill().catch(() => {});
loadAccount();
