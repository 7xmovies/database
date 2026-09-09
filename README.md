# 🎬 7xmovies Database (AI Agent & Developer Guide)

A high-performance, partitioned static JSON database repository for movies, web series, metadata, and direct download links. 

This repository is specifically architected to be **AI Agent friendly**, allowing Large Language Models (LLMs), AI coding assistants, scrapers, and bot workflows to search thousands of titles with minimal token usage and retrieve deep streaming/download links on demand.

---

## 📑 Table of Contents
- [Architecture & Design Rationale](#architecture--design-rationale)
- [Repository File Map](#repository-file-map)
- [Data Schemas](#data-schemas)
  - [1. Index Schema (`*-index.json`)](#1-index-schema--indexjson)
  - [2. Movie Chunk Schema (`{category}/chunk-{n}.json`)](#2-movie-chunk-schema-categorychunk-njson)
  - [3. Scraper History Schema (`scraper-history.json`)](#3-scraper-history-schema-scraper-historyjson)
- [How an AI Agent Should Query This Database](#how-an-ai-agent-should-query-this-database)
- [Raw GitHub & CDN Endpoints](#raw-github--cdn-endpoints)
- [Ready-to-Use Code Examples](#ready-to-use-code-examples)
  - [Python Example](#python-example)
  - [TypeScript / Node.js Example](#typescript--nodejs-example)
- [AI Tool / Function Calling Definition](#ai-tool--function-calling-definition)
- [Data Ingestion & Scraper Rules for AI Agents](#data-ingestion--scraper-rules-for-ai-agents)

---

## 🏛️ Architecture & Design Rationale

Standard JSON databases often store thousands of heavy records in a single multi-megabyte file. For AI agents:
- Large JSON files exceed prompt context limits and cost unnecessary tokens.
- Fetching full objects for every query is slow and bandwidth-intensive.

This database uses a **Two-Tier Partitioned Architecture**:

```
                  ┌────────────────────────┐
                  │   User or AI Agent     │
                  └──────────┬─────────────┘
                             │
            Step 1: Search by title in index (< 100 KB)
                             ▼
                ┌────────────────────────┐
                │  hollywood-index.json  │
                │  bollywood-index.json  │
                │  xprimehub-index.json  │
                └────────────┬───────────┘
                             │
       Found match! Has "chunk": 2 and "id": "avatar-2009"
                             │
            Step 2: Fetch only target chunk (~ 50 KB)
                             ▼
                ┌────────────────────────┐
                │  hollywood/chunk-2.json│
                └────────────┬───────────┘
                             │
            Step 3: Extract download & stream links
```

1. **Lightweight Indexes (`*-index.json`)**:
   Contains only minimal search attributes (`id`, `title`, `poster`, `chunk`). An AI agent can download this tiny file or filter it with regex to locate any movie in milliseconds.
2. **Partitioned Chunks (`chunk-{n}.json`)**:
   Contains comprehensive metadata and direct download link matrices grouped into chunks of **100 movies each**. The AI agent only fetches the single chunk containing the desired movie.

---

## 📁 Repository File Map

```
7xmovies/database/
├── README.md                 # This documentation for AI agents and developers
├── hollywood-index.json      # Hollywood / Dual Audio search index
├── bollywood-index.json      # Bollywood search index
├── xprimehub-index.json      # Adult / X-Prime search index
├── scraper-history.json      # Progress pointer tracking last page scraped
├── hollywood/
│   ├── chunk-1.json          # Movies 1 - 100
│   ├── chunk-2.json          # Movies 101 - 200
│   └── ...
├── bollywood/
│   └── chunk-1.json
└── xprimehub/
    └── chunk-1.json
```

---

## 📜 Data Schemas

### 1. Index Schema (`*-index.json`)
The index file is an array of objects:

```json
[
  {
    "id": "avatar-the-way-of-water-2022",
    "title": "Avatar: The Way of Water (2022) Dual Audio {Hindi-English} 480p | 720p | 1080p",
    "poster": "https://img.example.com/posters/avatar2.jpg",
    "chunk": 1,
    "category": "hollywood",
    "sourceUrl": "https://vegamovies.im/download-avatar-2/",
    "scrapedAt": "2026-09-09T14:30:00.000Z"
  }
]
```

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique URL-friendly slug / identifier |
| `title` | `string` | Full release title including quality and audio tags |
| `poster` | `string` | URL to the movie poster/cover thumbnail |
| `chunk` | `number` | The chunk number where full details are stored (e.g. `1` means `hollywood/chunk-1.json`) |
| `category` | `string` | `'hollywood'` \| `'bollywood'` \| `'xprimehub'` |
| `sourceUrl` | `string` | Upstream URL where the content originated |
| `scrapedAt` | `string` | ISO 8601 timestamp of data capture |

---

### 2. Movie Chunk Schema (`{category}/chunk-{n}.json`)
Each chunk file is an array of full movie objects:

```json
[
  {
    "id": "avatar-the-way-of-water-2022",
    "title": "Avatar: The Way of Water (2022)",
    "poster": "https://img.example.com/posters/avatar2.jpg",
    "overview": "Set more than a decade after the events of the first film...",
    "rating": "7.6",
    "year": "2022",
    "genres": ["Action", "Adventure", "Sci-Fi"],
    "sourceUrl": "https://vegamovies.im/download-avatar-2/",
    "downloadLinks": [
      {
        "resolution": "720p",
        "size": "1.4GB",
        "links": [
          {
            "name": "Fast Cloud (V-Cloud)",
            "url": "https://vcloud.example.com/file/xyz123",
            "direct": true,
            "note": "Resume supported"
          },
          {
            "name": "HubCloud VIP",
            "url": "https://hubcloud.example.com/drive/abc789",
            "direct": true,
            "note": "No ads"
          }
        ]
      },
      {
        "resolution": "1080p",
        "size": "3.2GB",
        "links": [
          {
            "name": "HubCloud 1080p 10bit",
            "url": "https://hubcloud.example.com/drive/1080p-xyz",
            "direct": true
          }
        ]
      }
    ],
    "category": "hollywood",
    "chunk": 1
  }
]
```

---

### 3. Scraper History Schema (`scraper-history.json`)
Tracks the latest page scraped per source to enable incremental scraping:

```json
{
  "vegamovies": 15,
  "rogmovies": 8,
  "xprimehub": 4
}
```

---

## 🤖 How an AI Agent Should Query This Database

When an AI Agent is tasked with **"Find download links for movie X"**:

1. **Identify the Category**:
   - Hollywood / English / Dubbed $\rightarrow$ `hollywood-index.json`
   - Bollywood / Hindi / Indian $\rightarrow$ `bollywood-index.json`
   - Adult / 18+ $\rightarrow$ `xprimehub-index.json`
2. **Fetch the Index**:
   - Download the corresponding `*-index.json` file.
3. **Filter**:
   - Search the array using case-insensitive substring or token matching against the `title` field.
4. **Locate Target Chunk**:
   - Read the `chunk` attribute of the matched movie (e.g., `chunk: 3`).
5. **Fetch Chunk**:
   - Load `https://raw.githubusercontent.com/7xmovies/database/main/{category}/chunk-{chunk}.json`.
6. **Extract Details**:
   - Find the item where `item.id === match.id`.
   - Access `item.downloadLinks` to return the download URLs, sizes, and server names to the user.

---

## 🌐 Raw GitHub & CDN Endpoints

### Fast CDN URLs (Recommended for Production & High Traffic)
Using jsDelivr CDN bypasses GitHub rate limits and caches globally:

- **Hollywood Index**:
  `https://cdn.jsdelivr.net/gh/7xmovies/database@main/hollywood-index.json`
- **Bollywood Index**:
  `https://cdn.jsdelivr.net/gh/7xmovies/database@main/bollywood-index.json`
- **XPrimeHub Index**:
  `https://cdn.jsdelivr.net/gh/7xmovies/database@main/xprimehub-index.json`
- **Chunk Template**:
  `https://cdn.jsdelivr.net/gh/7xmovies/database@main/{category}/chunk-{n}.json`

### Direct Raw GitHub URLs
- **Hollywood Index**:
  `https://raw.githubusercontent.com/7xmovies/database/main/hollywood-index.json`
- **Bollywood Index**:
  `https://raw.githubusercontent.com/7xmovies/database/main/bollywood-index.json`
- **XPrimeHub Index**:
  `https://raw.githubusercontent.com/7xmovies/database/main/xprimehub-index.json`
- **Chunk Template**:
  `https://raw.githubusercontent.com/7xmovies/database/main/{category}/chunk-{n}.json`

---

## 💻 Ready-to-Use Code Examples

### Python Example

```python
import requests

BASE_URL = "https://raw.githubusercontent.com/7xmovies/database/main"

def search_movie(query: str, category: str = "hollywood"):
    """
    Search index, find movie chunk, and return full movie download links.
    """
    # 1. Fetch index
    index_url = f"{BASE_URL}/{category}-index.json"
    resp = requests.get(index_url)
    if resp.status_code != 200:
        return {"error": f"Failed to fetch {category} index"}
    
    index = resp.json()
    
    # 2. Match titles
    matches = [m for m in index if query.lower() in m.get("title", "").lower()]
    if not matches:
        return {"message": f"No movies found matching '{query}'"}
    
    target = matches[0]
    chunk_num = target.get("chunk", 1)
    
    # 3. Fetch exact chunk
    chunk_url = f"{BASE_URL}/{category}/chunk-{chunk_num}.json"
    chunk_resp = requests.get(chunk_url)
    if chunk_resp.status_code != 200:
        return {"error": f"Failed to fetch chunk {chunk_num}"}
    
    chunk_data = chunk_resp.json()
    movie_details = next((item for item in chunk_data if item.get("id") == target.get("id")), None)
    
    return movie_details or target

# Test
if __name__ == "__main__":
    result = search_movie("Avatar", "hollywood")
    print(result)
```

---

### TypeScript / Node.js Example

```typescript
const BASE_URL = "https://cdn.jsdelivr.net/gh/7xmovies/database@main";

export interface IndexItem {
  id: string;
  title: string;
  poster: string;
  chunk: number;
  category: string;
  sourceUrl?: string;
}

export interface MovieDetails extends IndexItem {
  overview?: string;
  rating?: string;
  year?: string;
  downloadLinks: Array<{
    resolution: string;
    size: string;
    links: Array<{ name: string; url: string; direct?: boolean; note?: string }>;
  }>;
}

export async function findMovieWithLinks(query: string, category = "hollywood"): Promise<MovieDetails | null> {
  // 1. Fetch search index
  const indexRes = await fetch(`${BASE_URL}/${category}-index.json`);
  if (!indexRes.ok) throw new Error(`Could not load ${category} index`);
  const index: IndexItem[] = await indexRes.json();

  // 2. Find matching movie
  const matched = index.find(item => item.title.toLowerCase().includes(query.toLowerCase()));
  if (!matched) return null;

  // 3. Fetch only the chunk containing the movie
  const chunkRes = await fetch(`${BASE_URL}/${category}/chunk-${matched.chunk}.json`);
  if (!chunkRes.ok) throw new Error(`Could not load chunk ${matched.chunk}`);
  const chunk: MovieDetails[] = await chunkRes.json();

  return chunk.find(m => m.id === matched.id) || null;
}
```

---

## 🛠️ AI Tool / Function Calling Definition

If you are configuring a custom AI Assistant (OpenAI Assistant, LangChain, Anthropic Tool, or Google Gemini Function Calling), you can expose this database using the schema below:

```json
{
  "name": "search_movie_database",
  "description": "Searches the 7xmovies database and returns movie details including direct download links and resolutions.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Movie title or franchise name to search for (e.g. 'Oppenheimer', 'Avengers', 'Inception')."
      },
      "category": {
        "type": "string",
        "enum": ["hollywood", "bollywood", "xprimehub"],
        "description": "The category of movie. Defaults to hollywood if uncertain."
      }
    },
    "required": ["query"]
  }
}
```

---

## ⚙️ Data Ingestion & Scraper Rules for AI Agents

When building an automated scraper or AI agent that appends data to this repository:

1. **Chunk Limit**:
   - Maintain a maximum of **100 movies per `chunk-{n}.json`**.
   - When `chunk-N.json` reaches 100 entries, start `chunk-(N+1).json`.
2. **Deduplication**:
   - Check `*-index.json` before inserting. If `item.id` or `item.sourceUrl` already exists, skip it or update existing details.
3. **Keep Index Lean**:
   - Never put large metadata arrays or download links directly in `*-index.json`. The index must only have `id`, `title`, `poster`, `chunk`, `category`, and `sourceUrl`.
4. **Update Progress**:
   - Always record the last scraped page in `scraper-history.json` so the next job continues incrementally without re-scraping old pages.
5. **Atomic Commit Flow**:
   ```bash
   git pull origin main
   # write updated index and chunk files
   git add -A
   git commit -m "Add {count} movies to {category} database"
   git push origin main
   ```

---

## 📄 License & Disclaimer
This database and documentation are provided for educational, research, and indexing demonstration purposes. The repository contains metadata references and does not host copyrighted media files.
