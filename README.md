# 🎬 7xMovies Static JSON Movie Database

A high-performance, two-tier partitioned JSON database, automated scraping engine, and TMDB metadata enrichment pipeline for movies, TV series, and direct download links. Designed for instant CDN queries, edge caching, and streaming frontends.

---

## 📁 Repository Structure

```
7xmovies/database/
├── .github/
│   └── workflows/
│       ├── scraper.yml             # Automated batch scraper & database sync (daily / on-demand)
│       └── backfill-tmdb.yml       # One-click workflow to backfill TMDB IDs for existing records
├── scripts/
│   ├── bulk-scraper.js             # Core scraper engine (multi-worker concurrency, auto-resume)
│   ├── tmdbService.js              # TMDB API lookup service with smart title cleaner & rate limiter
│   ├── backfill-tmdb.js            # Automated, resumable TMDB & IMDb ID backfiller for existing data
│   └── metadataParser.js           # Regex parser for qualities, seasons, audio, sizes & server hosts
├── hollywood/                      # Partitioned Hollywood movies (100 movies per chunk)
│   ├── chunk-1.json
│   └── ...
├── bollywood/                      # Partitioned Bollywood movies (100 movies per chunk)
│   ├── chunk-1.json
│   └── ...
├── xprimehub/                      # Partitioned 18+ Adult items (100 movies per chunk)
│   ├── chunk-1.json
│   └── ...
├── hollywood-index.json            # Hollywood master search index (with TMDB IDs & ratings)
├── bollywood-index.json            # Bollywood master search index (with TMDB IDs & ratings)
├── xprimehub-index.json            # 18+ Adult master search index
├── vegamovieshomepage.json         # Real-time homepage snapshot with direct download links & TMDB IDs
├── rogmovieshomepage.json          # Real-time homepage snapshot with direct download links & TMDB IDs
├── xprimehubhomepage.json          # Real-time homepage snapshot with direct download links
├── scraper-history.json            # Checkpoint file recording the last crawled page per category
├── package.json                    # Dependencies and CLI runner scripts
└── README.md                       # Comprehensive architecture and API documentation
```

---

## 🏛️ Architecture & Data Tiers

To eliminate memory bloat, high CDN bandwidth costs, and slow parse times, the database is split into two complementary tiers:

### 1. Master Search Indexes (`*-index.json`)
Lightweight index containing only the essential fields needed for instant client-side search, filtering, and chunk resolution:
```json
[
  {
    "id": "download-spider-man-brand-new-day-2026-hindi-dubbed-full-movie-480p-720p-1080p-2160p-web-dl",
    "title": "Download Spider-Man: Brand New Day (2026) iMAX-WEB-DL {Hindi-English} 480p | 720p | 1080p | 2160p 4K",
    "poster": "https://image.tmdb.org/t/p/original/iPOn6DinuVyLY17YM9mKuPofV08.jpg",
    "chunk": 41,
    "year": "2026",
    "quality": "4K UHD",
    "tmdbId": 969681,
    "mediaType": "movie",
    "rating": 8.5
  }
]
```

### 2. Partitioned Chunks (`{category}/chunk-{n}.json`)
Detailed movie records (including direct download mirrors, sizes, servers, overview, and IMDb IDs) partitioned into chunks of **100 movies each**:
```json
{
  "download-spider-man-brand-new-day-2026-hindi-dubbed-full-movie-480p-720p-1080p-2160p-web-dl": {
    "id": "download-spider-man-brand-new-day-2026-hindi-dubbed-full-movie-480p-720p-1080p-2160p-web-dl",
    "fullTitle": "Download Spider-Man: Brand New Day (2026) iMAX-WEB-DL {Hindi-English} ...",
    "cleanTitle": "Spider-Man: Brand New Day (2026)",
    "poster": "https://image.tmdb.org/t/p/original/iPOn6DinuVyLY17YM9mKuPofV08.jpg",
    "sourceUrl": "https://vegamovies.gallery/download-spider-man-brand-new-day-2026-hindi-dubbed-full-movie-480p-720p-1080p-2160p-web-dl/",
    "year": "2026",
    "tmdbId": 969681,
    "imdbId": "tt22084616",
    "mediaType": "movie",
    "rating": 8.5,
    "downloadLinks": [
      {
        "label": "1080p 10Bit HEVC [2.1GB] - G-Direct",
        "url": "https://nexdrive.fit/genxfm...",
        "quality": "1080p HEVC 10Bit",
        "size": "2.1GB",
        "audio": "Hindi-English",
        "server": "G-Direct"
      }
    ]
  }
}
```

### 3. Live Homepage Feeds (`{source-slug}homepage.json`)
Auto-updated snapshot of page 1 releases with resolved direct download links and TMDB identifiers for zero-latency home feeds:
- `vegamovieshomepage.json` (Hollywood releases)
- `rogmovieshomepage.json` (Bollywood releases)
- `xprimehubhomepage.json` (18+ Adult releases)

```json
[
  {
    "id": "download-insidious-out-of-the-further-2026-hindi-dubbed-full-movie-480p-720p-1080p-web-dl",
    "title": "Download Insidious: Out of the Further (2026) WEB-DL Dual Audio ...",
    "poster": "https://image.tmdb.org/t/p/original/4tTrW9dXCByS5wt2pXVb58zNjz.jpg",
    "sourceUrl": "https://vegamovies.gallery/download-insidious-out-of-the-further-2026-hindi-dubbed-full-movie-480p-720p-1080p-web-dl/",
    "chunk": 41,
    "year": "2026",
    "tmdbId": 1291595,
    "imdbId": "tt32393988",
    "mediaType": "movie",
    "rating": 7.7,
    "downloadLinks": [ ... ],
    "updatedAt": "2026-11-02T08:00:00.000Z"
  }
]
```

### 4. Progress Tracker (`scraper-history.json`)
Stores the last successfully scraped page number for each category so batch runs continue incrementally without re-crawling old pages:
```json
{
  "hollywood": 41,
  "bollywood": 74,
  "xprimehub": 69
}
```

---

## 🍿 TMDB Integration & Rate-Limit Safeguards

Every scraped post automatically queries **The Movie Database (TMDB)** using `scripts/tmdbService.js`:

1. **Title Normalization**: Strips technical descriptors (`480p`, `720p`, `1080p`, `4K UHD`, `x264`, `x265`, `HEVC`), audio tags (`Dual Audio`, `Hindi Dubbed`), OTT watermarks (`PrimeVideo`, `Netflix`, `JioHotstar`), and bracketed metadata to extract the pristine movie title and release year.
2. **Metadata Enrichment**: Attaches `tmdbId`, `imdbId`, `mediaType` (`movie` or `tv`), and official TMDB `rating`.
3. **Automatic Base64 Unwrapping**: VegaMovies wraps TMDB image links into proxy URLs (`.../poster.webp?u=aHR0cHM6Ly9pbWFnZS50bWRi...`). The scraper automatically base64-decodes the `u` parameter to link directly to official TMDB CDNs (`https://image.tmdb.org/t/p/original/...`), preventing broken image DNS errors.
4. **Rate Limit Handling**:
   - Concurrency is throttled (3–5 workers) with pacing (~40ms per call), operating well under TMDB's ~50 req/sec ceiling.
   - Built-in automatic retry on HTTP `429 (Too Many Requests)` that reads the `Retry-After` header and resumes safely.
   - In-memory caching prevents duplicate queries during the same run.

---

## ⚡ GitHub Actions Automation

This repository includes two GitHub Actions workflows:

### 1. `scraper.yml` — Batch Movie Scraper & Database Sync
- **Scheduled**: Runs automatically every day at 02:00 UTC.
- **On-Demand**: Go to **Actions** $\rightarrow$ **Batch Movie Scraper & Database Sync** $\rightarrow$ **Run workflow**.
- **Inputs**:
  - `source`: `all`, `vegamovies`, `rogmovies`, `xprimehub`, or `homepage` (homepage-only feed update).
  - `mode`: `auto` (increments from `scraper-history.json`) or `custom` (specific page ranges).
  - `page_count`: Number of pages to crawl (e.g. `10`).
  - `concurrency`: Worker threads (`3`, `5`, `8`).

### 2. `backfill-tmdb.yml` — Backfill TMDB IDs for Existing Records
Enriches all existing historical movies that were scraped before TMDB integration:
- Go to **Actions** $\rightarrow$ **🔄 Backfill TMDB IDs for Existing Database** $\rightarrow$ **Run workflow**.
- **Inputs**:
  - `category`: `hollywood`, `bollywood`, or `all`.
  - `limit`: Number of movies to process (e.g. `500`, `1000`, `2000`, or `all`).
  - `concurrency`: Worker pool (default: `4`).
- **Resumable**: Only processes movies missing `tmdbId` (`!item.tmdbId`). Safely run in batches at any time.

---

## 🌐 Raw GitHub CDN Endpoints

Fetch live data directly in frontend applications using GitHub raw endpoints or global CDNs (e.g., jsDelivr, Statically):

| Resource | Raw GitHub Endpoint |
|---|---|
| **Hollywood Index** | `https://raw.githubusercontent.com/7xmovies/database/main/hollywood-index.json` |
| **Bollywood Index** | `https://raw.githubusercontent.com/7xmovies/database/main/bollywood-index.json` |
| **18+ Adult Index** | `https://raw.githubusercontent.com/7xmovies/database/main/xprimehub-index.json` |
| **VegaMovies Homepage** | `https://raw.githubusercontent.com/7xmovies/database/main/vegamovieshomepage.json` |
| **RogMovies Homepage** | `https://raw.githubusercontent.com/7xmovies/database/main/rogmovieshomepage.json` |
| **XPrimeHub Homepage** | `https://raw.githubusercontent.com/7xmovies/database/main/xprimehubhomepage.json` |
| **Movie Chunks** | `https://raw.githubusercontent.com/7xmovies/database/main/{category}/chunk-{n}.json` |

---

## 🛠️ CLI Runner Commands

```bash
# 1. Install dependencies
npm install

# 2. View current scraping progress
npm run history

# 3. Refresh live homepage feeds (with direct download links & TMDB IDs)
npm run homepage

# 4. Scrape 10 new pages across all categories
node scripts/bulk-scraper.js --source=all --count=10 --concurrency=5

# 5. Backfill TMDB IDs for existing Hollywood records (e.g. 500 movies)
node scripts/backfill-tmdb.js --category=hollywood --limit=500

# 6. Backfill TMDB IDs for Bollywood records
node scripts/backfill-tmdb.js --category=bollywood --limit=1000

# 7. Run general backfill shortcut
npm run backfill
```

---

## ⚙️ Environment Variables

Configure these locally in `.env` or in GitHub repository secrets (**Settings** $\rightarrow$ **Secrets and variables** $\rightarrow$ **Actions**):

| Variable | Description | Default |
|---|---|---|
| `TMDB_API_KEY` | TMDB API v3 key for movie/series ID lookup | Built-in fallback |
| `GITHUB_TOKEN` | Personal Access Token with repo write scope for Git pushes | Automatically injected by Actions |
| `VEGAMOVIES_DOMAIN` | Target mirror URL for VegaMovies | `https://vegamovies.gallery` |
| `ROGMOVIES_DOMAIN` | Target mirror URL for RogMovies | `https://rogmovies.one` |
| `XPRIME_DOMAIN` | Target mirror URL for XPrimeHub | `https://xprimehub.pics` |
| `DATA_DIR` | Custom output directory for database files | `.` (or `./data`) |

---

## 📄 License

MIT © [7xMovies](https://github.com/7xmovies)
