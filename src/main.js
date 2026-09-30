import { Actor, log } from 'apify';
import { discoverFeeds, looksLikeFeed, normalizeUrl, parseFeed, parseSince, selectItems } from './lib.js';

const EVENT = 'item';
const UA = 'Mozilla/5.0 (compatible; rss-feed-reader/1.0; Apify actor; +https://apify.com/mmaker-bot)';
const MAX_BYTES = 8_000_000;

async function readCapped(res) {
    const reader = res.body?.getReader();
    if (!reader) return '';
    const chunks = [];
    let size = 0;
    while (size < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
    }
    reader.cancel().catch(() => {});
    return Buffer.concat(chunks).toString('utf8');
}

async function get(url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            redirect: 'follow',
            signal: ctrl.signal,
            headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5' },
        });
        if (res.status >= 400) {
            await res.body?.cancel().catch(() => {});
            return { status: res.status, url: res.url || url, text: '' };
        }
        return { status: res.status, url: res.url || url, text: await readCapped(res) };
    } catch (err) {
        throw new Error(err.name === 'AbortError' ? 'timeout' : (err.cause?.code || err.message));
    } finally {
        clearTimeout(timer);
    }
}

/** Fetch a feed (or discover it from a website). Returns { feedUrl, parsed }. Throws with a short reason. */
async function loadFeed(url, timeoutMs) {
    const first = await get(url, timeoutMs);
    if (first.status >= 400) throw new Error(`http_${first.status}`);
    if (looksLikeFeed(first.text)) return { feedUrl: first.url, parsed: parseFeed(first.text, first.url) };
    const candidates = discoverFeeds(first.text, first.url).slice(0, 10);
    for (const c of candidates) {
        try {
            const r = await get(c, timeoutMs);
            if (r.status < 400 && looksLikeFeed(r.text)) return { feedUrl: r.url, parsed: parseFeed(r.text, r.url) };
        } catch { /* try next candidate */ }
    }
    throw new Error('no_feed_found');
}

await Actor.init();
const input = (await Actor.getInput()) || {};
const raw = [...(input.feeds || []), ...(input.startUrls || []).map((s) => (typeof s === 'string' ? s : s?.url))];
const feeds = [];
let invalid = 0;
for (const r of raw) {
    if (!String(r ?? '').trim()) continue;
    const u = normalizeUrl(r);
    if (!u) { invalid++; log.warning(`Skipping invalid URL: ${r}`); continue; }
    if (!feeds.includes(u)) feeds.push(u);
}
if (!feeds.length) throw new Error('Give at least one URL in "feeds".');
const sinceMs = parseSince(input.since);
if (Number.isNaN(sinceMs)) throw new Error(`"since" is not a valid date: ${input.since}`);
const opts = {
    maxItemsPerFeed: Math.min(Math.max(Number(input.maxItemsPerFeed) || 50, 1), 10000),
    sinceMs,
    keywords: input.keywords,
    dedupe: input.dedupe !== false,
    includeContent: input.includeContent === true,
};
const timeoutMs = Math.min(Math.max(Number(input.timeoutSecs) || 20, 3), 90) * 1000;
const concurrency = Math.min(Math.max(Number(input.concurrency) || 10, 1), 50);
log.info(`${feeds.length} sources (${invalid} invalid skipped), concurrency ${concurrency}`);

const seen = new Set();
let next = 0;
let done = 0;
let failed = 0;
let itemCount = 0;
let limitReached = false;
async function worker() {
    while (next < feeds.length && !limitReached) {
        const url = feeds[next++];
        try {
            const { feedUrl, parsed } = await loadFeed(url, timeoutMs);
            const rows = selectItems(parsed, feedUrl, opts, seen);
            for (const row of rows) {
                if (limitReached) break;
                const c = await Actor.pushData(row, EVENT);
                itemCount++;
                if (c?.eventChargeLimitReached) limitReached = true;
            }
        } catch (err) {
            failed++;
            log.warning(`${url}: ${err.message}`);
            await Actor.pushData({ feedUrl: url, error: err.message });
        }
        if (++done % 10 === 0) await Actor.setStatusMessage(`Read ${done}/${feeds.length} feeds, ${itemCount} items`);
    }
}
await Promise.all(Array.from({ length: concurrency }, worker));
await Actor.setValue('SUMMARY', { feeds: feeds.length, feedsFailed: failed, itemsPushed: itemCount, invalidUrlsSkipped: invalid, stoppedAtChargeLimit: limitReached });
if (limitReached) log.info('Stopped at the maximum charge set for this run.');
await Actor.setStatusMessage(`Finished: ${itemCount} items from ${feeds.length - failed} feeds, ${failed} failed (failed feeds are free)`, { isStatusMessageTerminal: true });
await Actor.exit();
