import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchTmdbMetadata, DEFAULT_TMDB_API_KEY } from './tmdbService.js';

// Parse CLI flags
const rawArgs = process.argv.slice(2);
const namedArgs = {};
for (const arg of rawArgs) {
    if (arg.startsWith('--')) {
        const [k, v] = arg.slice(2).split('=');
        namedArgs[k.toLowerCase()] = v === undefined ? true : v;
    }
}

const TMDB_API_KEY = namedArgs['tmdb-key'] || process.env.TMDB_API_KEY || DEFAULT_TMDB_API_KEY;
const TARGET_CATEGORY = namedArgs['category'] || 'all'; // 'hollywood', 'bollywood', 'xprimehub', 'all'
const LIMIT = namedArgs['limit'] ? parseInt(namedArgs['limit'], 10) : Infinity;
const CONCURRENCY = namedArgs['concurrency'] ? parseInt(namedArgs['concurrency'], 10) : 4;
const DELAY_MS = namedArgs['delay'] ? parseInt(namedArgs['delay'], 10) : 40;

// Resolve DATA_DIR
let DATA_DIR = namedArgs['data-dir'] || process.env.DATA_DIR;
if (!DATA_DIR) {
    if (fs.existsSync(path.join(process.cwd(), 'hollywood-index.json'))) {
        DATA_DIR = process.cwd();
    } else {
        DATA_DIR = path.join(process.cwd(), 'data');
    }
}
DATA_DIR = path.resolve(DATA_DIR);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function backfillCategory(category) {
    const indexPath = path.join(DATA_DIR, `${category}-index.json`);
    const chunkDir = path.join(DATA_DIR, category);

    if (!fs.existsSync(indexPath)) {
        console.log(`⚠️ Index file not found for ${category}: ${indexPath}`);
        return;
    }

    console.log(`\n======================================================`);
    console.log(`🎬 Backfilling TMDB IDs for: ${category.toUpperCase()}`);
    console.log(`======================================================`);

    const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const missingItems = indexData.filter(m => !m.tmdbId);

    console.log(`📊 Total items: ${indexData.length} | Missing TMDB: ${missingItems.length}`);
    if (missingItems.length === 0) {
        console.log(`✅ All items in ${category} already have TMDB IDs!`);
        return;
    }

    const itemsToProcess = missingItems.slice(0, LIMIT);
    console.log(`⚡ Processing ${itemsToProcess.length} items (concurrency: ${CONCURRENCY}, pace: ${DELAY_MS}ms)...\n`);

    let processedCount = 0;
    let matchedCount = 0;
    let indexModified = false;

    // Cache open chunk files to avoid frequent disk rewrites
    const dirtyChunks = new Map();

    function getChunkData(chunkId) {
        if (dirtyChunks.has(chunkId)) return dirtyChunks.get(chunkId);
        const chunkPath = path.join(chunkDir, `chunk-${chunkId}.json`);
        let data = {};
        if (fs.existsSync(chunkPath)) {
            try {
                data = JSON.parse(fs.readFileSync(chunkPath, 'utf8'));
            } catch {}
        }
        dirtyChunks.set(chunkId, data);
        return data;
    }

    function flushChunks() {
        for (const [chunkId, data] of dirtyChunks.entries()) {
            const chunkPath = path.join(chunkDir, `chunk-${chunkId}.json`);
            fs.writeFileSync(chunkPath, JSON.stringify(data, null, 2));
        }
        dirtyChunks.clear();
    }

    let currentIndex = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, itemsToProcess.length) }, async (_, workerId) => {
        await sleep(workerId * 50);

        while (currentIndex < itemsToProcess.length) {
            const idx = currentIndex++;
            const item = itemsToProcess[idx];

            try {
                const tmdb = await fetchTmdbMetadata(item.title, {
                    year: item.year,
                    isSeries: item.isSeries,
                    apiKey: TMDB_API_KEY
                });

                if (tmdb && tmdb.tmdbId) {
                    item.tmdbId = tmdb.tmdbId;
                    item.mediaType = tmdb.mediaType;
                    if (tmdb.rating) item.rating = tmdb.rating;
                    if (tmdb.posterUrl) item.poster = tmdb.posterUrl;
                    matchedCount++;
                    indexModified = true;

                    // Update corresponding chunk record
                    if (item.chunk) {
                        const chunkData = getChunkData(item.chunk);
                        if (chunkData[item.id]) {
                            chunkData[item.id].tmdbId = tmdb.tmdbId;
                            if (tmdb.imdbId) chunkData[item.id].imdbId = tmdb.imdbId;
                            chunkData[item.id].mediaType = tmdb.mediaType;
                            if (tmdb.rating) chunkData[item.id].rating = tmdb.rating;
                            if (tmdb.overview) chunkData[item.id].overview = tmdb.overview;
                            if (tmdb.posterUrl) chunkData[item.id].poster = tmdb.posterUrl;
                        }
                    }

                    console.log(`  ✅ [${idx + 1}/${itemsToProcess.length}] TMDB ${tmdb.tmdbId} (${tmdb.mediaType}) | ${item.title.substring(0, 50)}...`);
                } else {
                    console.log(`  ⚪ [${idx + 1}/${itemsToProcess.length}] No match | ${item.title.substring(0, 50)}...`);
                }
            } catch (e) {
                console.warn(`  ⚠️ [${idx + 1}/${itemsToProcess.length}] Error for ${item.id}:`, e.message);
            }

            processedCount++;

            // Periodically flush chunk files and index every 25 items
            if (processedCount % 25 === 0) {
                flushChunks();
                if (indexModified) {
                    fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
                    indexModified = false;
                }
            }

            await sleep(DELAY_MS);
        }
    });

    await Promise.all(workers);

    // Final flush
    flushChunks();
    if (indexModified) {
        fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
    }

    console.log(`\n🎉 Finished ${category}: ${matchedCount}/${itemsToProcess.length} matched and updated in index and chunks!`);
}

async function main() {
    if (TARGET_CATEGORY === 'all') {
        await backfillCategory('hollywood');
        await backfillCategory('bollywood');
    } else {
        await backfillCategory(TARGET_CATEGORY);
    }
}

main().catch(err => {
    console.error('Fatal backfill error:', err);
    process.exit(1);
});
