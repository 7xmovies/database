# 🎬 7xMovies Static JSON Movie Database

A high-performance, two-tier partitioned JSON database and automated scraper pipeline for movies, series, and download links. Designed for instant CDN queries and AI agents.

---

## 📁 Repository Structure

```
7xmovies/database/
├── .github/
│   └── workflows/
│       └── scraper.yml         # GitHub Actions Batch Scraper Workflow
├── scripts/
│   ├── bulk-scraper.js         # Scraper engine (CLI, concurrency, auto-resume)
│   └── metadataParser.js       # High-speed link & metadata extraction parser
├── hollywood/                  # Hollywood partitioned chunks (100 movies per file)
│   └── .gitkeep
├── bollywood/                  # Bollywood partitioned chunks (100 movies per file)
│   └── .gitkeep
├── xprimehub/                  # 18+ Adult partitioned chunks (100 movies per file)
│   └── .gitkeep
├── hollywood-index.json        # Hollywood master search index
├── bollywood-index.json        # Bollywood master search index
├── xprimehub-index.json        # 18+ Adult master search index
├── vegamovieshomepage.json     # Live snapshot of latest VegaMovies releases
├── rogmovieshomepage.json      # Live snapshot of latest RogMovies releases
├── xprimehubhomepage.json      # Live snapshot of latest XPrimeHub releases
├── scraper-history.json        # Progress checkpoint (records last page scraped)
├── package.json                # Dependencies and runner scripts
└── README.md                   # Repository documentation and schema specification
```

---

## 🏛️ Architecture & Data Tiers

### 1. Master Search Indexes (`*-index.json`)
Lightweight index containing only the fields required for fast searching and chunk resolution (`id`, `title`, `poster`, `chunk`, `year`, `quality`):
```json
[
  {
    "id": "download-spider-man-brand-new-day-2026",
    "title": "Spider-Man: Brand New Day (2026) Dual Audio {Hindi-English} 480p | 720p | 1080p",
    "poster": "https://image.tmdb.org/t/p/w500/example.jpg",
    "chunk": 1,
    "year": "2026",
    "quality": "1080p"
  }
]
```

### 2. Partitioned Chunks (`{category}/chunk-{n}.json`)
To avoid giant JSON files that cause latency and exceed memory/context limits, detailed movie records are partitioned into chunks of **100 movies each**:
```json
{
  "download-spider-man-brand-new-day-2026": {
    "id": "download-spider-man-brand-new-day-2026",
    "fullTitle": "Download Spider-Man: Brand New Day (2026) Dual Audio {Hindi-English} ...",
    "cleanTitle": "Spider-Man: Brand New Day (2026)",
    "poster": "https://image.tmdb.org/t/p/w500/example.jpg",
    "sourceUrl": "https://vegamovies.gallery/download-spider-man-brand-new-day-2026/",
    "year": "2026",
    "downloadLinks": [
      {
        "label": "1080p 10Bit HEVC [2.1GB] - G-Direct",
        "url": "https://nexdrive.fit/genxfm...",
        "quality": "1080p HEVC 10Bit",
        "size": "2.1GB",
        "audio": "Dual Audio",
        "server": "G-Direct"
      }
    ]
  }
}
```

### 3. Live Homepage Feeds (`{source-slug}homepage.json`)
Auto-updated snapshot of the latest 20 releases on page 1 of each source. Used to render instant homepages without scraping live sites:
- `vegamovieshomepage.json` (Hollywood)
- `rogmovieshomepage.json` (Bollywood)
- `xprimehubhomepage.json` (18+ Adult)

```json
[
  {
    "id": "download-love-of-your-life-2026",
    "title": "Download Love of Your Life (2026) PrimeVideo : Dual Audio ...",
    "poster": "https://image.tmdb.org/t/p/w500/dL3Tcv4FU2K85bgnGRBgLjFSrLr.jpg",
    "sourceUrl": "https://vegamovies.gallery/download-love-of-your-life-2026/",
    "chunk": 1,
    "year": "2026",
    "quality": "1080p",
    "updatedAt": "2026-10-14T18:00:00.000Z"
  }
]
```

### 4. Progress Tracker (`scraper-history.json`)
Records the last page scraped for each category so batch runs continue incrementally without re-crawling old pages:
```json
{
  "hollywood": 0,
  "bollywood": 0,
  "xprimehub": 0
}
```

---

## ⚡ Automated Scraper (GitHub Actions)

This repository includes a GitHub Actions workflow (`.github/workflows/scraper.yml`) configured for scheduled and on-demand cloud execution.

### How to Run:
1. Open this repository on GitHub.
2. Go to the **Actions** tab.
3. Select **"Batch Movie Scraper & Database Sync"**.
4. Click **Run workflow** and choose your options:
   - **Source**: `all`, `vegamovies`, `rogmovies`, `xprimehub`, or `homepage` (for 5s homepage-only refresh).
   - **Mode**: `auto` (incremental resume from `scraper-history.json`) or `custom` (specific page range).
   - **Concurrency**: Parallel worker threads (`3`, `5`, `8`, `10`).
   - **Request Delay**: Millisecond delay between movie detail scrapes (default: 400ms).
   - **Commit Changes**: Automatically commits and pushes updated chunks and indexes back to `main`.

*(Scheduled to run automatically daily at 02:00 UTC).*

---

## 🌐 Raw GitHub CDN Endpoints

Fetch directly using raw GitHub URLs or global CDNs (e.g., jsDelivr):

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

## 🛠️ Local Scraper Commands

```bash
# Install dependencies
npm install

# Check scraper progress
npm run history

# Refresh homepage feeds only
npm run homepage

# Scrape 10 pages for all categories
node scripts/bulk-scraper.js --source=all --count=10 --concurrency=5
```
