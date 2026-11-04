// The cart card assistants can show instead of a bare link (MCP Apps, which ChatGPT renders): the shop's
// items and totals and a PayPal button that opens the buyer's PayPal approval. Self-contained HTML with no
// outside requests; it reads the tool result the host passes in (the same JSON the model gets) and never
// talks to Sayso itself, so it can't change anything. Hosts without UI keep the approval_url in the text.

export const CART_WIDGET_URI = 'ui://sayso/cart-v1.html';
export const MCP_APP_MIME = 'text/html;profile=mcp-app';
/** Tools whose result is a cart the card can show. */
export const CART_TOOLS = new Set(['create_cart', 'update_cart']);

/** What tools/list adds to a cart tool so a host knows to render the card. */
export const cartToolMeta = {
  ui: { resourceUri: CART_WIDGET_URI },
  'openai/outputTemplate': CART_WIDGET_URI,
  'openai/toolInvocation/invoking': 'Pricing the cart with the shop…',
  'openai/toolInvocation/invoked': 'Cart priced by the shop',
};

/** The resource as resources/list and resources/read describe it. */
export const cartWidgetResource = {
  uri: CART_WIDGET_URI,
  name: 'sayso-cart',
  title: 'Sayso cart',
  description: "A shop's cart with its totals and a PayPal button.",
  mimeType: MCP_APP_MIME,
};

export function cartWidgetContents() {
  return {
    uri: CART_WIDGET_URI,
    mimeType: MCP_APP_MIME,
    text: CART_WIDGET_HTML,
    _meta: {
      ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
      'openai/widgetPrefersBorder': true,
      'openai/widgetDescription': "Shows the shop's cart and a PayPal button to pay for it.",
    },
  };
}

const CART_WIDGET_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: light dark; --ink:#1d1b19; --soft:#6b645d; --rule:#e8e2da; --bg:#fffdfa; --hold:#8a6400; --hold-bg:#f8eecb; }
  @media (prefers-color-scheme: dark) { :root { --ink:#f2ede7; --soft:#b3aaa1; --rule:#3a342f; --bg:#1f1b18; --hold:#e6c25a; --hold-bg:#3a3020; } }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: transparent; }
  .card { padding: 16px 18px; background: var(--bg); border-radius: 14px; display: grid; gap: 12px; }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .head b { font-size: 16px; } .head span { color: var(--soft); font-size: 13px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  li { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: baseline; }
  .q { color: var(--soft); font-variant-numeric: tabular-nums; } .p { font-variant-numeric: tabular-nums; }
  .sum { border-top: 1px solid var(--rule); padding-top: 10px; display: grid; grid-template-columns: 1fr auto; gap: 4px; color: var(--soft); font-size: 14px; font-variant-numeric: tabular-nums; }
  .sum .t { color: var(--ink); font-weight: 700; font-size: 18px; }
  .sum span:nth-child(even) { text-align: right; }
  .issue { background: var(--hold-bg); color: var(--hold); border-radius: 10px; padding: 10px 12px; font-size: 14px; }
  .pp { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; height: 46px; border: 0; border-radius: 23px; background: #ffc439; color: #111; font: 600 16px ui-sans-serif, system-ui, sans-serif; cursor: pointer; text-decoration: none; }
  .pp:hover { filter: brightness(.96); }
  .pp .w { font: italic 800 18px Verdana, ui-sans-serif, sans-serif; letter-spacing: -.3px; } .pp .w i { color: #003087; font-style: inherit; } .pp .w em { color: #009cde; font-style: inherit; }
  .fine { color: var(--soft); font-size: 12px; text-align: center; }
  .empty { color: var(--soft); }
</style></head>
<body><div class="card" id="card"><span class="empty">Pricing the cart…</span></div>
<script>
(function () {
  var card = document.getElementById('card');
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var money = function (m) { if (!m) return ''; var v = Number(m.value); return (m.currency_code === 'USD' ? '$' : m.currency_code + ' ') + (isNaN(v) ? m.value : v.toFixed(2)); };
  var rpcId = 1;
  var send = function (msg) { try { window.parent.postMessage(Object.assign({ jsonrpc: '2.0' }, msg), '*'); } catch (e) {} };
  var resize = function () { send({ method: 'ui/notifications/size-changed', params: { height: document.documentElement.scrollHeight } }); };
  var open = function (url) {
    if (window.openai && window.openai.openExternal) return window.openai.openExternal({ href: url });
    send({ id: ++rpcId, method: 'ui/open-link', params: { url: url } });
  };
  function render(cart) {
    if (!cart || !cart.items) return;
    var t = cart.totals || {};
    var issues = (cart.validation_issues || []).map(function (i) { return '<div class="issue">' + esc(i.user_message || i.message) + '</div>'; }).join('');
    var rows = cart.items.map(function (i) { return '<li><span class="q">' + esc(i.quantity) + '×</span><span>' + esc(i.name) + '</span><span class="p">' + money(i.price) + '</span></li>'; }).join('');
    var sum = '<div class="sum"><span>Subtotal</span><span>' + money(t.subtotal) + '</span>' +
      (t.shipping ? '<span>Shipping</span><span>' + money(t.shipping) + '</span>' : '') +
      (t.tax ? '<span>Tax</span><span>' + money(t.tax) + '</span>' : '') +
      '<span class="t">Total</span><span class="t">' + money(t.total) + '</span></div>';
    var pay = cart.approval_url && cart.status !== 'COMPLETED'
      ? '<a class="pp" id="pay" href="' + esc(cart.approval_url) + '" target="_blank" rel="noopener">Pay with <span class="w"><i>Pay</i><em>Pal</em></span></a><div class="fine">You approve in PayPal. The shop priced this cart, not the assistant.</div>'
      : (cart.status === 'COMPLETED' ? '<div class="fine">Paid. Ask the assistant where it is any time.</div>' : '');
    card.innerHTML = '<div class="head"><b>' + esc(cart.shop ? cart.shop.replace(/-/g, ' ').replace(/\\b\\w/g, function (c) { return c.toUpperCase(); }) : 'Your cart') + '</b><span>Sayso · PayPal</span></div><ul>' + rows + '</ul>' + issues + sum + pay;
    var a = document.getElementById('pay');
    if (a) a.addEventListener('click', function (e) { e.preventDefault(); open(cart.approval_url); });
    resize();
  }
  // ChatGPT passes the result as window.openai.toolOutput (and updates it); MCP Apps hosts send it as a notification.
  var fromOpenAI = function () { if (window.openai && window.openai.toolOutput) render(window.openai.toolOutput); };
  window.addEventListener('openai:set_globals', fromOpenAI);
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || m.jsonrpc !== '2.0') return;
    if (m.method === 'ui/notifications/tool-result' && m.params) render(m.params.structuredContent);
    if (m.id === 1 && m.result) send({ method: 'ui/notifications/initialized', params: {} });
  });
  send({ id: 1, method: 'ui/initialize', params: { protocolVersion: '2025-06-18', appInfo: { name: 'sayso-cart', version: '1' }, appCapabilities: {} } });
  fromOpenAI();
})();
</script></body></html>`;
