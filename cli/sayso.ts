#!/usr/bin/env node
// sayso: run your shop from the terminal, or let your own AI agent run it for you.
// A thin client over the shop's MCP endpoint, so the terminal, MCP clients and the web app share the
// same tools and the same say-so rules. No dependencies; Node 22.18+ runs this file directly.
//
//   node cli/sayso.ts help

import { readFile, mkdir, writeFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { createInterface } from 'node:readline';

const VERSION = '0.3.0'; // kept in step with package.json by tests/about.test.ts
const CONFIG_DIR = process.env.SAYSO_HOME ?? join(homedir(), '.sayso');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

// Exit codes agents can branch on.
const EXIT = { ok: 0, error: 1, usage: 2, waiting: 3, refused: 4 } as const;

interface Config {
  url: string;
  key?: string;
  shop?: string;
}

class CliError extends Error {
  readonly code: number;
  constructor(message: string, code: number = EXIT.error) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------------------------
// Arguments

interface Args {
  positional: string[];
  flags: Record<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const [name, inline] = a.slice(2).split(/=(.*)/s, 2);
      const next = argv[i + 1];
      if (inline !== undefined) flags[name] = inline;
      else if (next !== undefined && !next.startsWith('--') && VALUE_FLAGS.has(name)) flags[name] = argv[++i];
      else flags[name] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

const VALUE_FLAGS = new Set(['url', 'key', 'reason', 'status', 'limit', 'name', 'text', 'file', 'currency', 'country', 'label', 'query', 'max-price', 'note', 'deposit', 'due']);

function flag(args: Args, name: string): string | undefined {
  const v = args.flags[name];
  return typeof v === 'string' ? v : undefined;
}

// ---------------------------------------------------------------------------------------------
// Config

async function loadConfig(args: Args): Promise<Config> {
  let saved: Partial<Config> = {};
  if (existsSync(CONFIG_FILE)) {
    try {
      saved = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
    } catch {
      throw new CliError(`Could not read ${CONFIG_FILE}; delete it and run "sayso login" again`);
    }
  }
  return {
    url: (flag(args, 'url') ?? process.env.SAYSO_URL ?? saved.url ?? 'http://localhost:3000').replace(/\/$/, ''),
    key: flag(args, 'key') ?? process.env.SAYSO_KEY ?? saved.key,
    shop: saved.shop,
  };
}

async function saveConfig(config: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  await chmod(CONFIG_FILE, 0o600).catch(() => {}); // best effort on Windows
}

// ---------------------------------------------------------------------------------------------
// Talking to the shop

let rpcId = 0;

async function rpc(config: Config, method: string, params?: unknown): Promise<any> {
  if (!config.key) throw new CliError('Not signed in. Run: sayso login --key sk_agent_... [--url https://your-sayso]', EXIT.usage);
  let res: Response;
  try {
    res = await fetch(`${config.url}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}`, 'X-Sayso-Channel': 'cli' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    });
  } catch {
    throw new CliError(`Can't reach ${config.url}. Is the server running?`);
  }
  const body = (await res.json().catch(() => ({}))) as any;
  if (res.status === 401) throw new CliError('This agent key was rejected (wrong or revoked). Ask the owner for a new one.', EXIT.usage);
  if (body.error) throw new CliError(body.error.message ?? `Server error ${res.status}`);
  return body.result;
}

async function tool(config: Config, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const result = await rpc(config, 'tools/call', { name, arguments: dropUndefined(args) });
  const text = result?.content?.[0]?.text ?? '';
  if (result?.isError) throw new CliError(text || `${name} failed`);
  return result.structuredContent?.result ?? result.structuredContent ?? JSON.parse(text);
}

function dropUndefined(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

// ---------------------------------------------------------------------------------------------
// Output

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  dim: (s: string) => (color ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (color ? `\x1b[1m${s}\x1b[0m` : s),
  green: (s: string) => (color ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (color ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (color ? `\x1b[31m${s}\x1b[0m` : s),
};

const STATUS: Record<string, (s: string) => string> = {
  verified: (s) => c.green(`done: ${s}`),
  unverified: (s) => c.yellow(`sent, not yet confirmed by PayPal: ${s}`),
  executed: (s) => c.green(`sent: ${s}`),
  pending_approval: (s) => c.yellow(`waiting for the owner: ${s}`),
  denied: (s) => c.red(`refused: ${s}`),
  rejected: (s) => c.red(`owner said no: ${s}`),
  failed: (s) => c.red(`failed: ${s}`),
};

/** Print a say-so result and return the exit code that matches it. */
function printSayso(r: any): number {
  const label = `${r.action}${r.amount ? ` ${r.amount}` : ''} (${r.say_so_id})`;
  console.log((STATUS[r.status] ?? ((s: string) => `${r.status}: ${s}`))(label));
  for (const e of r.what_happens ?? []) console.log(c.dim(`  ${e}`));
  for (const w of r.why ?? []) console.log(`  why: ${w}`);
  if (r.not_understood?.length) console.log(c.yellow(`  not understood: ${r.not_understood.join('; ')}`));
  if (r.next) console.log(c.dim(`  ${r.next}`));
  return exitFor(r);
}

function table(rows: Record<string, unknown>[], columns: string[]): void {
  if (rows.length === 0) return console.log(c.dim('(none)'));
  const cells = rows.map((r) => columns.map((k) => String(r[k] ?? '-')));
  const widths = columns.map((k, i) => Math.min(48, Math.max(k.length, ...cells.map((row) => row[i].length))));
  const line = (vals: string[]) => vals.map((v, i) => v.slice(0, widths[i]).padEnd(widths[i])).join('  ');
  console.log(c.bold(line(columns)));
  for (const row of cells) console.log(line(row));
}

function print(value: unknown, indent = ''): void {
  if (Array.isArray(value)) {
    if (value.length === 0) console.log(`${indent}${c.dim('(none)')}`);
    for (const v of value) {
      if (v && typeof v === 'object') {
        console.log(`${indent}-`);
        print(v, `${indent}  `);
      } else console.log(`${indent}- ${v}`);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined || v === null) continue;
      if (typeof v === 'object') {
        console.log(`${indent}${c.dim(k)}:`);
        print(v, `${indent}  `);
      } else console.log(`${indent}${c.dim(k)}: ${v}`);
    }
    return;
  }
  console.log(`${indent}${value}`);
}

// ---------------------------------------------------------------------------------------------
// Commands

type Command = (args: Args, config: Config, json: boolean) => Promise<number | void>;

const out = (json: boolean, value: unknown, human: () => void) => (json ? console.log(JSON.stringify(value, null, 2)) : human());

const commands: Record<string, { usage: string; summary: string; run: Command }> = {
  init: {
    usage: 'sayso init [photos...] [--text "what you sell, prices"] [--file notes.txt] [--name "Shop name"] [--currency USD] [--country US]',
    summary: 'Create a shop from photos and notes (AI drafts the catalog; you review and publish)',
    async run(args, config, json) {
      let text = flag(args, 'text');
      const file = flag(args, 'file');
      if (file) text = [text, await readFile(file, 'utf8')].filter(Boolean).join('\n\n');
      const images = await Promise.all(args.positional.map(imageDataUrl));
      if (!text && images.length === 0) throw new CliError('Give me photos and/or --text "what you sell and for how much"', EXIT.usage);

      const res = await fetch(`${config.url}/api/shops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, images, shop_name: flag(args, 'name'), currency: flag(args, 'currency'), country: flag(args, 'country'), agent_label: flag(args, 'label') ?? 'cli' }),
      }).catch(() => {
        throw new CliError(`Can't reach ${config.url}`);
      });
      const body = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new CliError(body.message ?? `Server error ${res.status}`);

      await saveConfig({ url: config.url, key: body.agent_key, shop: body.shop.slug });
      if (json) {
        console.log(JSON.stringify(body, null, 2));
        return;
      }
      console.log(c.green(`Drafted ${body.shop.name} with ${body.products} product(s).`));
      if (body.questions.length) {
        console.log('\nBefore you publish, check:');
        for (const q of body.questions) console.log(`  - ${q}`);
      }
      console.log(`\n${c.bold('Owner secret')} (shown once; it is what approves money moves, keep it off this machine's agents):`);
      console.log(`  ${body.owner_secret}`);
      console.log(`\nReview and publish: ${body.review_url}  (shop: ${body.shop.slug})`);
      console.log(c.dim(`This terminal is now signed in with an agent key for ${body.shop.slug}.`));
    },
  },
  login: {
    usage: 'sayso login --key sk_agent_... [--url https://your-sayso]',
    summary: 'Sign this machine in with an agent key from the owner dashboard',
    async run(args, config, json) {
      const key = flag(args, 'key');
      if (!key?.startsWith('sk_agent_')) throw new CliError('Pass an agent key: --key sk_agent_...', EXIT.usage);
      const next = { ...config, key };
      const overview = await tool(next, 'shop_overview');
      await saveConfig({ url: next.url, key, shop: overview.shop.slug });
      out(json, overview.shop, () => console.log(c.green(`Signed in to ${overview.shop.name} (${overview.shop.slug}) at ${next.url}`)));
    },
  },
  logout: {
    usage: 'sayso logout',
    summary: 'Forget the saved agent key',
    async run(_args, config) {
      await saveConfig({ url: config.url });
      console.log('Signed out.');
    },
  },
  status: {
    usage: 'sayso status',
    summary: 'Orders, say-so requests waiting for the owner, low stock, missed demand',
    async run(_args, config, json) {
      const o = await tool(config, 'shop_overview');
      out(json, o, () => {
        console.log(`${c.bold(o.shop.name)} ${c.dim(`${o.shop.slug} · ${o.shop.status}`)}`);
        console.log(`orders: ${o.orders.paid} paid, ${o.orders.awaiting_owner} waiting for owner, ${o.orders.awaiting_buyer} waiting for buyer`);
        if (o.waiting_for_owner.length) {
          console.log(c.yellow(`\n${o.waiting_for_owner.length} waiting for the owner's say-so:`));
          for (const r of o.waiting_for_owner) console.log(`  ${r.say_so_id}  ${r.action} ${r.amount ?? ''}  ${r.why.join(' ')}`);
        }
        if (o.low_stock.length) console.log(`\nlow stock: ${o.low_stock.map((v: any) => `${v.name} (${v.stock})`).join(', ')}`);
        if (o.missed_demand.length) console.log(`\nbuyers couldn't get: ${o.missed_demand.map((m: any) => m.message).join(' | ')}`);
      });
    },
  },
  products: {
    usage: 'sayso products',
    summary: 'Catalog with variant ids, prices and stock',
    async run(_args, config, json) {
      const view = await tool(config, 'list_products');
      out(json, view, () =>
        table(
          view.products.flatMap((p: any) => p.variants.map((v: any) => ({ product: p.name, variant: v.title, id: v.variant_id, price: v.price, stock: v.in_stock }))),
          ['product', 'variant', 'id', 'price', 'stock'],
        ),
      );
    },
  },
  price: {
    usage: 'sayso price <variant_id> <amount>',
    summary: 'Change a price',
    async run(args, config, json) {
      const [variant, price] = args.positional;
      if (!variant || !price) throw new CliError(this.usage, EXIT.usage);
      const v = await tool(config, 'update_variant', { variant_id: variant, price });
      out(json, v, () => console.log(`${v.title}: ${v.price}`));
    },
  },
  market: {
    usage: 'sayso market <variant_id>',
    summary: 'What similar items sell for at other stores, against your price',
    async run(args, config, json) {
      const [variant] = args.positional;
      if (!variant) throw new CliError(this.usage, EXIT.usage);
      const ref = await tool(config, 'price_check', { variant_id: variant });
      out(json, ref, () => {
        console.log(ref.summary);
        for (const e of ref.examples ?? []) console.log(c.dim(`  ${e.price}  ${e.title} (${e.store})`));
      });
    },
  },
  stock: {
    usage: 'sayso stock <variant_id> <quantity>',
    summary: 'Set stock',
    async run(args, config, json) {
      const [variant, qty] = args.positional;
      if (!variant || qty === undefined || !/^\d+$/.test(qty)) throw new CliError(this.usage, EXIT.usage);
      const v = await tool(config, 'update_variant', { variant_id: variant, stock: Number(qty) });
      out(json, v, () => console.log(`${v.title}: ${v.in_stock} in stock`));
    },
  },
  orders: {
    usage: 'sayso orders [--status paid|awaiting_owner|awaiting_buyer|needs_info|released] [--limit 25]',
    summary: 'Recent orders',
    async run(args, config, json) {
      const orders = await tool(config, 'list_orders', { status: flag(args, 'status'), limit: flag(args, 'limit') ? Number(flag(args, 'limit')) : undefined });
      out(json, orders, () =>
        table(
          orders.map((o: any) => ({ id: o.id, number: o.number, status: o.status, total: o.total, items: o.items.map((i: any) => `${i.quantity}x ${i.name ?? i.variant_id}`).join(', '), via: o.channel })),
          ['id', 'number', 'status', 'total', 'items', 'via'],
        ),
      );
    },
  },
  order: {
    usage: 'sayso order <order_id>',
    summary: 'One order with its payment history',
    async run(args, config, json) {
      if (!args.positional[0]) throw new CliError(this.usage, EXIT.usage);
      const o = await tool(config, 'get_order', { order_id: args.positional[0] });
      out(json, o, () => print(o));
    },
  },
  refund: {
    usage: 'sayso refund <order_id> [amount] --reason "why"',
    summary: 'Refund an order (goes through the owner\'s say-so rules)',
    async run(args, config, json) {
      const [order, amount] = args.positional;
      const reason = flag(args, 'reason');
      if (!order || !reason) throw new CliError(this.usage, EXIT.usage);
      const r = await tool(config, 'refund_order', { order_id: order, amount, reason });
      return json ? printJson(r) : printSayso(r);
    },
  },
  track: {
    usage: 'sayso track <order_id> <carrier> <tracking_number>',
    summary: 'Add shipment tracking (PayPal shows it to the buyer)',
    async run(args, config, json) {
      const [order, carrier, number] = args.positional;
      if (!order || !carrier || !number) throw new CliError(this.usage, EXIT.usage);
      const o = await tool(config, 'add_tracking', { order_id: order, carrier, tracking_number: number });
      out(json, o, () => console.log(`Tracking ${o.tracking.carrier} ${o.tracking.number} added to ${o.number ?? o.id}.`));
    },
  },
  invoice: {
    usage: 'sayso invoice <email> "<item>" <price> ["<item>" <price> ...] [--note "..."] [--deposit 31.00] [--due 0|10|15|30] [--name "Grace"]',
    summary: 'Invoice a custom order through PayPal (goes through the owner\'s say-so rules)',
    async run(args, config, json) {
      const [email, ...rest] = args.positional;
      if (!email || rest.length < 2 || rest.length % 2) throw new CliError(this.usage, EXIT.usage);
      const items = [];
      for (let i = 0; i < rest.length; i += 2) items.push({ name: rest[i], price: rest[i + 1] });
      const due = flag(args, 'due');
      const r = await tool(config, 'send_invoice', {
        email,
        name: flag(args, 'name'),
        items,
        note: flag(args, 'note'),
        deposit: flag(args, 'deposit'),
        due_in_days: due !== undefined ? Number(due) : undefined,
      });
      if (json) return printJson(r);
      const code = printSayso(r);
      if (r.invoice?.payer_url) console.log(`  invoice ${r.invoice.number}: ${r.invoice.payer_url}`);
      return code;
    },
  },
  invoices: {
    usage: 'sayso invoices',
    summary: 'Invoices for custom orders, with their live status in PayPal',
    async run(_args, config, json) {
      const list = await tool(config, 'list_invoices');
      out(json, list, () =>
        table(
          list.map((i: any) => ({ number: i.number ?? '-', to: i.to, total: i.total, status: i.status, items: i.items })),
          ['number', 'to', 'total', 'status', 'items'],
        ),
      );
    },
  },
  approvals: {
    usage: 'sayso approvals',
    summary: 'What is waiting for the owner (only the owner can approve, on their own device)',
    async run(_args, config, json) {
      const list = await tool(config, 'list_approvals');
      out(json, list, () => (list.length ? list.forEach((r: any) => printSayso(r)) : console.log(c.dim('Nothing waiting for the owner.'))));
    },
  },
  check: {
    usage: 'sayso check <say_so_id>',
    summary: 'Status of one say-so request',
    async run(args, config, json) {
      if (!args.positional[0]) throw new CliError(this.usage, EXIT.usage);
      const r = await tool(config, 'get_say_so', { say_so_id: args.positional[0] });
      return json ? printJson(r) : printSayso(r);
    },
  },
  policy: {
    usage: 'sayso policy [propose "refunds over $30 need my OK; invoices to new clients need my OK"]',
    summary: 'Show the say-so rules, or propose new ones (the owner approves them)',
    async run(args, config, json) {
      if (args.positional[0] === 'propose') {
        const text = args.positional.slice(1).join(' ');
        if (!text) throw new CliError(this.usage, EXIT.usage);
        const r = await tool(config, 'propose_policy', { rules: text });
        return json ? printJson(r) : printSayso(r);
      }
      const p = await tool(config, 'get_policy');
      out(json, p, () => {
        if (p.source) console.log(c.dim(`"${p.source}"`));
        for (const r of p.rules) console.log(`  - ${r}`);
      });
    },
  },
  audit: {
    usage: 'sayso audit [--limit 20]',
    summary: 'Audit log with hash-chain checks',
    async run(args, config, json) {
      const log = await tool(config, 'audit_log', { limit: flag(args, 'limit') ? Number(flag(args, 'limit')) : undefined });
      out(json, log, () =>
        table(
          log.map((r: any) => ({ id: r.say_so_id, at: r.at.slice(0, 19).replace('T', ' '), action: r.action, amount: r.amount, status: r.status, chain: r.chain_intact ? 'ok' : 'TAMPERED' })),
          ['id', 'at', 'action', 'amount', 'status', 'chain'],
        ),
      );
    },
  },
  tools: {
    usage: 'sayso tools',
    summary: 'List the raw tools this key can call',
    async run(_args, config, json) {
      const { tools } = await rpc(config, 'tools/list');
      out(json, tools, () => tools.forEach((t: any) => console.log(`${c.bold(t.name)}  ${c.dim(t.description)}`)));
    },
  },
  call: {
    usage: "sayso call <tool> ['{\"json\":\"arguments\"}']",
    summary: 'Call any tool with JSON arguments',
    async run(args, config) {
      const [name, raw] = args.positional;
      if (!name) throw new CliError(this.usage, EXIT.usage);
      let input: Record<string, unknown> = {};
      try {
        input = raw ? JSON.parse(raw) : {};
      } catch {
        throw new CliError('Arguments must be JSON', EXIT.usage);
      }
      const r = await tool(config, name, input);
      console.log(JSON.stringify(r, null, 2));
      return r && typeof r === 'object' && 'say_so_id' in r ? exitFor(r) : EXIT.ok;
    },
  },
  mcp: {
    usage: 'sayso mcp',
    summary: 'Serve the seller tools to a local MCP client over stdio',
    async run(_args, config) {
      await stdioBridge(config);
    },
  },
};

function printJson(r: { status?: string }): number {
  console.log(JSON.stringify(r, null, 2));
  return exitFor(r);
}

function exitFor(r: { status?: string }): number {
  return r.status === 'pending_approval' ? EXIT.waiting : r.status === 'denied' || r.status === 'rejected' || r.status === 'failed' ? EXIT.refused : EXIT.ok;
}

async function imageDataUrl(path: string): Promise<string> {
  const types: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
  const type = types[extname(path).toLowerCase()];
  if (!type) throw new CliError(`${basename(path)}: photos must be .jpg, .png, .webp or .gif`, EXIT.usage);
  const data = await readFile(path).catch(() => {
    throw new CliError(`Can't read ${path}`, EXIT.usage);
  });
  if (data.length > 4_500_000) throw new CliError(`${basename(path)} is over 4.5 MB; resize it first`, EXIT.usage);
  return `data:${type};base64,${data.toString('base64')}`;
}

/** Newline-delimited JSON-RPC on stdin/stdout, forwarded to the remote MCP endpoint. Logs go to stderr. */
async function stdioBridge(config: Config): Promise<void> {
  if (!config.key) throw new CliError('Not signed in. Run: sayso login --key sk_agent_...', EXIT.usage);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let queue = Promise.resolve();
  process.stderr.write(`sayso mcp: forwarding to ${config.url}/api/mcp\n`);

  for await (const line of lines) {
    if (!line.trim()) continue;
    queue = queue.then(async () => {
      let id: unknown = null;
      try {
        id = JSON.parse(line).id ?? null;
        const res = await fetch(`${config.url}/api/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}`, 'X-Sayso-Channel': 'mcp-stdio' },
          body: line,
        });
        if (res.status === 202) return;
        process.stdout.write(`${JSON.stringify(await res.json())}\n`);
      } catch (err) {
        if (id === null) return;
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: `sayso: ${err instanceof Error ? err.message : 'bridge error'}` } })}\n`);
      }
    });
  }
  await queue;
}

function help(): void {
  console.log(`${c.bold('sayso')} ${VERSION}: run your shop, or let your AI agent run it. Money only moves with the owner's say-so.\n`);
  for (const [name, cmd] of Object.entries(commands)) console.log(`  ${name.padEnd(10)} ${cmd.summary}`);
  console.log(`\nGlobal: --json (machine-readable output), --url <server>, --key <sk_agent_...>. Env: SAYSO_URL, SAYSO_KEY.`);
  console.log(`Exit codes: 0 ok, 1 error, 2 usage, 3 waiting for the owner, 4 refused.`);
  console.log(`Help for one command: sayso help <command>`);
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const [name, ...rest] = args.positional;
  if (!name || name === 'help') {
    const cmd = rest[0] ? commands[rest[0]] : undefined;
    if (cmd) console.log(`usage: ${cmd.usage}\n${cmd.summary}`);
    else help();
    return EXIT.ok;
  }
  if (name === 'version' || args.flags.version) {
    console.log(VERSION);
    return EXIT.ok;
  }
  const cmd = commands[name];
  if (!cmd) throw new CliError(`Unknown command "${name}". Try: sayso help`, EXIT.usage);
  if (args.flags.help) {
    console.log(`usage: ${cmd.usage}\n${cmd.summary}`);
    return EXIT.ok;
  }
  const config = await loadConfig(args);
  return (await cmd.run({ ...args, positional: rest }, config, Boolean(args.flags.json))) ?? EXIT.ok;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    if (err instanceof CliError) {
      console.error(c.red(err.message));
      process.exitCode = err.code;
    } else {
      console.error(err);
      process.exitCode = EXIT.error;
    }
  },
);
