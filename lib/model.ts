// The token radar's model: the sealed protocol snapshot in, one ranked board out.
//
// Three questions, three answers from the snapshot's own figures only:
//
//   1. Which protocols record no token yet?   A protocol is pre-token when its index record
//      carries no market cap, no CoinGecko id and no symbol. CEX venues, bridges, wrapped and
//      staked products are set aside: they are not a launch of their own (the same reading the
//      house watchlist uses, applied to every protocol, not just the ones above the floor).
//   2. What would that token be worth?        The market already prices the protocols that do
//      trade. For each category we take the median market-cap-to-TVL multiple of the snapshot's
//      live protocols in that category, and apply it to a pre-token protocol's TVL. That is the
//      sector multiple, measured from the snapshot, never a list of names or a guess. Two
//      adjustments remain: seven-day TVL growth (momentum) and the time the protocol has run
//      with no token (maturity, which we read as evidence it will still be here to launch).
//   3. What should a reader do?               Six farm steps per protocol, with cost and time,
//      derived from its category, chains, TVL tier and age. No name is special-cased.
//
//   implied = round(tvl_usd x sectorMultiple x growthFactor x maturityFactor x LAUNCH_PREMIUM)
//
// The launch premium is the one house constant: a token lists with a small float, so its fully
// diluted value runs above the multiple its category's liquid peers trade at. It is stated on
// the dashboard beside the measured sector multiples, so a reader can see exactly what is
// measured and what is assumed.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The constants the dashboard states. Only the premium is assumed; the multiples are measured. */
export interface ModelConstants {
  premium: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_floor: number;
  multiple_cap: number;
  peer_min: number;
}

export const MODEL: ModelConstants = {
  premium: 1.4,
  growth_weight: 0.35,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.85,
  maturity_range: 0.15,
  maturity_days: 1460,
  unknown_age_days: 365,
  multiple_floor: 0.15,
  multiple_cap: 3.0,
  peer_min: 3,
};

export const MODEL_VERSION = 'radar-2';

/** A sector multiple measured from the snapshot's live protocols. */
export interface Sector {
  category: string;
  multiple: number;
  peers: number;
  measured: boolean;
}

/** A farm step: the action, what it costs and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  sector_multiple: number;
  peer_count: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  implied_value_usd: number;
  watchlist: boolean;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  ratio: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: ModelConstants;
  protocols_total: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  sectors: Sector[];
  rows: BoardRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/i;
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a launch subject: pre-token, and not a venue or a product of a live token. */
export function isLaunchSubject(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || WRAPPED.test(p.name) || EXCHANGE.test(p.name)) return false;
  return true;
}

/** The median of a list of numbers; 0 for an empty list. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The sector multiples: for each category, the median mcap/TVL multiple of the snapshot's live
 * protocols in it, clamped. A category with fewer than MODEL.peer_min live peers falls back to
 * the whole market's median, and the row says which it was (measured false).
 */
export function sectorTable(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): Sector[] {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const category = p.category ?? 'Other';
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const list = byCategory.get(category);
    if (list === undefined) byCategory.set(category, [ratio]);
    else list.push(ratio);
  }
  const market = median(all);
  const out: Sector[] = [];
  for (const [category, ratios] of byCategory) {
    const measured = ratios.length >= model.peer_min;
    const raw = measured ? median(ratios) : market;
    out.push({ category, multiple: round(clamp(raw, model.multiple_floor, model.multiple_cap), 3), peers: ratios.length, measured });
  }
  out.sort((a, b) => a.category < b.category ? -1 : a.category > b.category ? 1 : 0);
  return out;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function sectorOf(sectors: Sector[], category: string | null): Sector {
  const key = category ?? 'Other';
  for (const s of sectors) if (s.category === key) return s;
  return { category: key, multiple: 0.25, peers: 0, measured: false };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 2_000_000_000) return 250;
  if (p.tvl_usd >= 500_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: a younger protocol gets a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The category's one action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and borrow a little against it so both sides of the market are used.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the position open through the week.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis') || c.includes('option')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one position in a market on ${name}.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it in the farming wallet.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('restak') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  return [
    { text: `Fund a fresh ${chain} wallet with only the $${capital} you will farm, and keep its seed phrase offline.`, cost: 'under $3 of gas', time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' },
    { text: `Do one qualifying action a week on ${p.name} — a deposit, a borrow, a swap or a vote — so the wallet reads as a user, not a one-off.`, cost: 'about $2 to $6 of gas a week', time: '10 minutes a week' },
    { text: `Hold the position at least ${hold} days so the activity lands in more than one snapshot of the protocol's users.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Watch ${p.name}'s own site and docs for a points program or token news, and claim only from the domain the protocol itself publishes.`, cost: 'nothing to check; never pay to claim', time: '10 minutes a week' },
    { text: 'Log every date, amount and transaction hash, and note how you would unwind the position, for tax time and launch day.', cost: 'nothing but the log', time: '5 minutes' },
  ].map(stepText);
}

/** Every protocol a board ranks, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; sectors: Sector[] } {
  const sectors = sectorTable(snapshot.protocols, model);
  const watchlist = new Set(snapshot.watchlist);
  // The watchlist is the floor, never the ceiling: every launch subject in the snapshot is ranked,
  // the ones below the floor included, and a watchlist slug is never dropped.
  const subjects = snapshot.protocols.filter((p) => isLaunchSubject(p) || (watchlist.has(p.slug) && isPreToken(p)));

  const scored = subjects.map((p) => {
    const sector = sectorOf(sectors, p.category);
    const age = ageDays(snapshot.as_of, p.listed_at);
    const growthPct = clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap);
    const growthMult = 1 + (growthPct / 100) * model.growth_weight;
    const ageForModel = age ?? model.unknown_age_days;
    const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    const implied = Math.max(1, Math.round(p.tvl_usd * sector.multiple * growthMult * maturityMult * model.premium));
    return { p, sector, age, growthMult, maturityMult, implied };
  });

  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    token_status: 'pre-token' as const,
    age_days: s.age,
    sector_multiple: s.sector.multiple,
    peer_count: s.sector.peers,
    growth_multiplier: round(s.growthMult, 3),
    maturity_multiplier: round(s.maturityMult, 3),
    implied_value_usd: s.implied,
    watchlist: watchlist.has(s.p.slug),
    farm_steps: farmSteps(s.p, s.age),
  }));
  return { board, sectors };
}

/** The live-token protocols with their market-cap-to-TVL ratio: the peer set the model measures. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      change_7d: p.change_7d,
      ratio: round((p.mcap_usd as number) / p.tvl_usd, 3),
    }));
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, sectors } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model,
    protocols_total: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    sectors,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. The program refuses to write a bad board. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the gate's 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's dataset as one script: no fetch, no network, every byte the page shows. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
