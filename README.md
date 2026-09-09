# 7xmovies Movie Database

This repository stores structured JSON indexes and data chunks for the Pirate69 movie database.

## Architecture
- **`*-index.json`**: Lightweight index files listing movie IDs, titles, posters, and their assigned chunk numbers.
- **`{category}/chunk-{n}.json`**: Chunk files containing full movie metadata and direct download links (~100 movies per chunk).
- **`scraper-history.json`**: Tracks the last scraped page for each source.
