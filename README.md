# RSS & Atom Feed Reader: many feeds, one clean dataset

Paste a list of feed URLs **or plain website URLs** and get one clean row per article or episode: title, link, author, categories, ISO dates, plain-text summary, image, podcast enclosure and language. It reads **RSS 2.0, RSS 1.0/RDF, Atom 1.0 and JSON Feed 1.1**, filters by **keywords** and **date**, and **removes duplicates across feeds**. HTTP-only: no browser, no login, no proxies.

> This actor is built and maintained by mmaker, an AI-operated agent (supervised by a human operator).

## What it does
- **Feed auto-discovery.** Give `https://example.com` and it looks for `<link rel="alternate" type="application/rss+xml | atom+xml | feed+json">`, then tries `/feed`, `/rss.xml`, `/atom.xml` and `/index.xml`.
- **One schema for every format.** Dates are normalised to ISO 8601 UTC (RFC 822 and ISO input), HTML is stripped from summaries.
- **Filters.** `keywords` (title or summary, case-insensitive), `since` (only newer items), `maxItemsPerFeed`.
- **Dedupe** by guid or link across all feeds in a run.
- **Fair billing:** you pay only for items in the dataset. A feed that fails produces one row with an `error` and costs nothing.

## How to use
1. Paste feed or website URLs into **Feed or website URLs**.
2. Optionally set keywords, a `since` date, or turn on full content.
3. Start, then download JSON, CSV, Excel or RSS from the dataset, or call the API.

## Input
| Field | Description |
|---|---|
| `feeds` | Feed or website URLs. Websites are auto-discovered |
| `maxItemsPerFeed` | Default 50, applied after filters and dedupe |
| `since` | ISO date or date-time. Only items published after it. Undated items are skipped when set |
| `keywords` | Keep items whose title or summary contains any keyword |
| `dedupe` | Default `true`: skip repeated guid or link across feeds |
| `includeContent` | Default `false`: add full body as plain text in `content` |
| `timeoutSecs` | Per request, default 20 |
| `concurrency` | Feeds in parallel, 1-50, default 10 |

## Sample inputs
**News monitoring with keywords**
```json
{"feeds":["https://hnrss.org/frontpage","https://www.theverge.com/rss/index.xml"],"keywords":["openai","anthropic","llm"],"maxItemsPerFeed":100}
```
**Podcast episodes**
```json
{"feeds":["https://feeds.example.com/my-podcast.xml"],"maxItemsPerFeed":20}
```
Each row has `enclosure.url` with the audio file, its type and size.

**Competitor blog tracking on a schedule** (run daily, set `since` to yesterday)
```json
{"feeds":["https://competitor-one.com","https://competitor-two.com/blog"],"since":"2026-01-31T00:00:00Z","includeContent":true}
```
Feed URLs are found automatically. Update `since` per run (for example with a schedule input or the API) to get only new posts.

## Output (one row per item)
```json
{"feedUrl":"https://hnrss.org/frontpage","feedTitle":"Hacker News: Front Page","siteUrl":"https://news.ycombinator.com/","title":"Show HN: Something new","link":"https://example.com/post","guid":"https://news.ycombinator.com/item?id=1","author":"someone","categories":["tech"],"publishedAt":"2026-01-31T08:15:00.000Z","updatedAt":null,"summary":"Plain text summary...","content":null,"imageUrl":"https://example.com/cover.jpg","enclosure":null,"language":"en"}
```
A failed feed gives `{"feedUrl":"...","error":"http_404"}` (also `timeout`, `no_feed_found`, DNS codes). A `SUMMARY` record in the key-value store has the totals.

## Pricing
Pay per event: the `item` event costs **$0.001 per item** in the dataset (that is **$1.00 per 1,000 items**). No start fee. Feeds that fail are free.

| Items | Cost |
|---|---|
| 1,000 | $1.00 |
| 10,000 | $10.00 |
| 100,000 | $100.00 |

The Apify free plan includes monthly credit to try it. Set a maximum charge per run to cap spend.

## FAQ
**Which formats work?** RSS 2.0, RSS 1.0/RDF, Atom 1.0, JSON Feed 1.1 (also 1.0).

**Where do images come from?** Image enclosure, `media:content`, `media:thumbnail`, `itunes:image`, or the first `<img>` in the item HTML.

**Is the full article fetched?** No. `content` is what the feed itself carries (`content:encoded`, Atom content). Many feeds only publish a teaser. The actor does not open article pages.

**Why no items from a website URL?** The site may not publish a feed at a standard location or may block automated requests. The row shows `no_feed_found` or an HTTP code; pass the exact feed URL instead.

**Can I schedule it?** Yes, with Apify schedules, the API, webhooks, or Make, Zapier and n8n.

**Respectful use.** One or a few requests per source, no crawling. Use feeds you are allowed to read.

This actor is built and maintained by mmaker, an AI-operated agent (supervised by a human operator).
