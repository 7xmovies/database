import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';

// Resolve metadata parser from same directory or ../server/
let parseLinkDetails, extractCategories, extractPostMetadata;
try {
    const localParser = await import('./metadataParser.js');
    parseLinkDetails = localParser.parseLinkDetails;
    extractCategories = localParser.extractCategories;
    extractPostMetadata = localParser.extractPostMetadata;
} catch (e) {
    const serverParser = await import('../server/metadataParser.js');
    parseLinkDetails = serverParser.parseLinkDetails;
    extractCategories = serverParser.extractCategories;
    extractPostMetadata = serverParser.extractPostMetadata;
}

// Resolve TMDB Service
let fetchTmdbMetadata;
try {
    const tmdbModule = await import('./tmdbService.js');
    fetchTmdbMetadata = tmdbModule.fetchTmdbMetadata;
} catch (e) {
    try {
        const tmdbModule = await import('../scripts/tmdbService.js');
        fetchTmdbMetadata = tmdbModule.fetchTmdbMetadata;
    } catch {}
}

/**
 * ============================================================================
 * BULK SCRAPER CONFIGURATION
 * Supports CLI flags, positional arguments, and environment variables.
 * ============================================================================
 */

// Parse CLI arguments
const rawArgs = process.argv.slice(2);
const namedArgs = {};
const positionalArgs = [];

for (const arg of rawArgs) {
    if (arg.startsWith('--')) {
        const [k, v] = arg.slice(2).split('=');
        namedArgs[k.toLowerCase()] = v === undefined ? true : v;
    } else {
        positionalArgs.push(arg);
    }
}

// Stop signal handler
process.on('SIGINT', () => {
    console.log('\n\n🛑 Stop signal received! Scraping paused.');
    console.log('✅ Progress up to the last completed page has been saved to history.');
    process.exit(0);
});

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
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const HISTORY_FILE = path.join(DATA_DIR, 'scraper-history.json');

function getHistory() {
    if (fs.existsSync(HISTORY_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        } catch {
            return {};
        }
    }
    return {};
}

function updateHistory(categoryKey, pageNum) {
    const history = getHistory();
    if (!history[categoryKey] || pageNum > history[categoryKey]) {
        history[categoryKey] = pageNum;
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    }
}

// History inspection mode
const sourceParam = (namedArgs['source'] || positionalArgs[0] || process.env.SOURCE || 'vegamovies').toLowerCase();
if (sourceParam === 'history') {
    const history = getHistory();
    console.log("📊 Scraper History (Last scraped pages):");
    if (Object.keys(history).length === 0) {
        console.log("  No history entries found.");
    } else {
        Object.entries(history).forEach(([cat, page]) => {
            console.log(`  - ${cat}: Page ${page}`);
        });
    }
    process.exit(0);
}

// Helper to delay between requests
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function generateIdFromUrl(url) {
    const parts = url.split('/').filter(Boolean);
    let slug = parts[parts.length - 1];
    return slug.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
}

/**
 * Bulletproof poster extractor that ignores lazy-loading base64/SVG placeholders
 * and retrieves real high-res images from data-src, srcset, or direct URLs.
 */
function extractCleanPoster(imgEl) {
    if (!imgEl || imgEl.length === 0) return '';
    const candidates = [
        imgEl.attr('data-src'),
        imgEl.attr('data-lazy-src'),
        imgEl.attr('data-original'),
        imgEl.attr('data-cfsrc'),
        imgEl.attr('data-fallback-src'),
        imgEl.attr('src')
    ];
    const srcset = imgEl.attr('data-srcset') || imgEl.attr('srcset');
    if (srcset) {
        const firstSrc = srcset.split(',')[0]?.trim().split(' ')[0]?.trim();
        if (firstSrc) candidates.push(firstSrc);
    }
    for (const c of candidates) {
        if (c && typeof c === 'string') {
            const trimmed = c.trim();
            // Discard base64 placeholders, SVGs, and transparent spacer GIFs
            if (trimmed.startsWith('data:') || trimmed.includes(';base64,') || trimmed.includes('.svg') || trimmed.includes('blank.gif')) {
                continue;
            }
            let resolvedUrl = trimmed;
            if (resolvedUrl.startsWith('//')) {
                resolvedUrl = 'https:' + resolvedUrl;
            }
            if (resolvedUrl.startsWith('http://') || resolvedUrl.startsWith('https://')) {
                // If VegaMovies wraps a TMDB image in ?u=base64, unwrap it directly
                if (resolvedUrl.includes('?u=') || resolvedUrl.includes('&u=')) {
                    try {
                        const parsed = new URL(resolvedUrl);
                        const u = parsed.searchParams.get('u');
                        if (u) {
                            const decoded = Buffer.from(u, 'base64').toString('utf8');
                            if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
                                return decoded;
                            }
                        }
                    } catch {}
                }
                return resolvedUrl;
            }
        }
    }
    return '';
}

/**
 * Scrapes a single movie post page to extract fullTitle, poster, and downloadLinks
 */
async function scrapeMoviePage(url) {
    const cleanUrl = url.trim().replace(/([^:])\/\/+/g, '$1/');
    const response = await axios.get(cleanUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 15000,
        maxRedirects: 5
    });

    const $ = cheerio.load(response.data);
    const fullTitle = $('h1').first().text().trim() || $('title').text().trim();
    const categories = extractCategories($, fullTitle, cleanUrl);
    const postMeta = extractPostMetadata($, fullTitle);

    const downloadLinks = [];
    const content = $('article').length ? $('article') : $('main').length ? $('main') : $('.entry-content').length ? $('.entry-content') : $('body');

    content.find('a').each((i, el) => {
        const linkUrl = $(el).attr('href');
        if (!linkUrl || !linkUrl.startsWith('http') || linkUrl.includes('vegamovies-apk')) return;

        const text = $(el).text().trim() || $(el).find('button').text().trim();
        const hasBtn = $(el).find('button').length > 0;
        const hasBtnClass = $(el).hasClass('btn') || $(el).hasClass('button') || $(el).hasClass('dwd-button') || $(el).hasClass('maxbutton');
        const textLower = text.toLowerCase();
        const isKnownLink = linkUrl.includes('nexdrive') || linkUrl.includes('vcloud') || linkUrl.includes('api.shareus.in') || linkUrl.includes('fastdl') || linkUrl.includes('hubcloud');
        const isButtonText = textLower.includes('download') || textLower.includes('v-cloud') || textLower.includes('g-direct') || textLower.includes('batch') || textLower.includes('episode') || textLower.includes('instant');

        if (isKnownLink || hasBtn || hasBtnClass || isButtonText) {
            let combinedText = text;
            let prev = $(el).parent().prev();
            let steps = 0;
            while (prev.length > 0 && steps < 6) {
                const pText = prev.text().trim();
                if (prev.is('h1, h2, h3, h4, h5, h6, p')) {
                    if (pText.length > 5 && pText.length < 160) {
                        combinedText = `${pText} - ${combinedText}`;
                        break;
                    }
                }
                prev = prev.prev();
                steps++;
            }

            const parsed = parseLinkDetails(combinedText, linkUrl, {
                season: postMeta.season,
                primaryQuality: postMeta.primaryQuality
            });

            downloadLinks.push(parsed);
        }
    });

    let pagePoster = $('meta[property="og:image"]').attr('content') ||
                     $('meta[name="twitter:image"]').attr('content') ||
                     extractCleanPoster($('img.wp-post-image')) ||
                     extractCleanPoster($('.entry-content img').first()) ||
                     extractCleanPoster($('article img').first());

    if (pagePoster && (pagePoster.startsWith('data:') || pagePoster.includes(';base64,') || pagePoster.includes('.svg') || !pagePoster.startsWith('http'))) {
        pagePoster = '';
    } else if (pagePoster && (pagePoster.includes('?u=') || pagePoster.includes('&u='))) {
        try {
            const parsed = new URL(pagePoster);
            const u = parsed.searchParams.get('u');
            if (u) {
                const decoded = Buffer.from(u, 'base64').toString('utf8');
                if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
                    pagePoster = decoded;
                }
            }
        } catch {}
    }

    // TMDB metadata enrichment
    let tmdbData = null;
    if (fetchTmdbMetadata) {
        try {
            tmdbData = await fetchTmdbMetadata(fullTitle, {
                year: postMeta.year,
                isSeries: postMeta.isSeries,
                apiKey: namedArgs['tmdb-key'] || process.env.TMDB_API_KEY
            });
        } catch {}
    }

    // Always prioritize official direct TMDB poster over site-hosted or compressed images
    if (tmdbData?.posterUrl) {
        pagePoster = tmdbData.posterUrl;
    }

    return {
        fullTitle,
        poster: pagePoster,
        categories,
        postMeta,
        downloadLinks,
        ...(tmdbData?.tmdbId && { tmdbId: tmdbData.tmdbId }),
        ...(tmdbData?.imdbId && { imdbId: tmdbData.imdbId }),
        ...(tmdbData?.mediaType && { mediaType: tmdbData.mediaType }),
        ...(tmdbData?.rating && { rating: tmdbData.rating }),
        ...(tmdbData?.overview && { overview: tmdbData.overview })
    };
}
async function updateHomepageJson(source, baseUrl, dataDir) {
    let category = 'hollywood';
    if (source === 'rogmovies' || source === 'bollywood') category = 'bollywood';
    else if (source === 'xprimehub' || source === 'xprime') category = 'xprimehub';

    const cleanBase = baseUrl.replace(/\/+$/, '');
    console.log(`\n🏠 Auto-updating ${source}homepage.json from ${cleanBase}...`);

    try {
        const response = await axios.get(cleanBase, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            timeout: 15000,
            maxRedirects: 5
        });

        const $ = cheerio.load(response.data);
        const indexPath = path.join(dataDir, `${category}-index.json`);
        let indexMap = new Map();
        if (fs.existsSync(indexPath)) {
            try {
                const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
                idx.forEach(m => indexMap.set(m.id, m));
            } catch {}
        }

        const homepageRawItems = [];
        const seenUrls = new Set();

        $('article, .post-item, .poster-card, .post, [class*="post"], h2, h3').each((_, el) => {
            let link = $(el).find('a').attr('href') || $(el).attr('href') || $(el).find('meta[itemprop="url"]').attr('content');
            if (!link || !link.startsWith('http') || link.includes('/category/') || link.includes('/tag/') || link.includes('/page/') || seenUrls.has(link)) return;

            let title = $(el).find('a').text().trim() || $(el).text().trim();
            if (!title || title.length < 5 || title.includes('Vegamovies') || title.includes('Rogmovies')) return;

            let imgEl = $(el).find('img').length ? $(el).find('img') : $(el).parent().find('img');
            let poster = extractCleanPoster(imgEl);

            seenUrls.add(link);
            homepageRawItems.push({ title, link, poster });
        });

        console.log(`  ⚡ Fetching download links for ${homepageRawItems.length} homepage posts...`);
        const homepagePosts = [];
        let itemIndex = 0;
        const workerConcurrency = 5;

        const workers = Array.from({ length: Math.min(workerConcurrency, homepageRawItems.length) }, async () => {
            while (itemIndex < homepageRawItems.length) {
                const idx = itemIndex++;
                const item = homepageRawItems[idx];
                const id = generateIdFromUrl(item.link);
                const matched = indexMap.get(id);

                let downloadLinks = [];
                let pageTitle = item.title;
                let pagePoster = item.poster;

                let postDetails = null;

                // Check local chunk first if available
                if (matched && matched.chunk) {
                    const chunkFile = path.join(dataDir, category, `chunk-${matched.chunk}.json`);
                    if (fs.existsSync(chunkFile)) {
                        try {
                            const chunkData = JSON.parse(fs.readFileSync(chunkFile, 'utf8'));
                            if (chunkData[id] && chunkData[id].downloadLinks && chunkData[id].downloadLinks.length > 0) {
                                downloadLinks = chunkData[id].downloadLinks;
                                if (chunkData[id].fullTitle) pageTitle = chunkData[id].fullTitle;
                                if (chunkData[id].poster) pagePoster = chunkData[id].poster;
                                postDetails = chunkData[id];
                            }
                        } catch {}
                    }
                }

                // If no local chunk links, scrape post page directly
                if (downloadLinks.length === 0) {
                    try {
                        const details = await scrapeMoviePage(item.link);
                        postDetails = details;
                        downloadLinks = details.downloadLinks || [];
                        if (details.fullTitle) pageTitle = details.fullTitle;
                        if (details.poster) pagePoster = details.poster;
                    } catch (e) {
                        console.warn(`    ⚠️ Could not fetch details for ${id}:`, e.message);
                    }
                }

                // If TMDB ID is not yet resolved, query TMDB
                let tmdbId = postDetails?.tmdbId || matched?.tmdbId || null;
                let imdbId = postDetails?.imdbId || null;
                let mediaType = postDetails?.mediaType || null;
                let rating = postDetails?.rating || null;

                if (!tmdbId && fetchTmdbMetadata) {
                    try {
                        const tmdb = await fetchTmdbMetadata(pageTitle, {
                            year: matched?.year,
                            isSeries: matched?.isSeries,
                            apiKey: namedArgs['tmdb-key'] || process.env.TMDB_API_KEY
                        });
                        if (tmdb) {
                            tmdbId = tmdb.tmdbId;
                            imdbId = tmdb.imdbId;
                            mediaType = tmdb.mediaType;
                            rating = tmdb.rating;
                            if (tmdb.posterUrl) {
                                pagePoster = tmdb.posterUrl;
                            }
                        }
                    } catch {}
                }

                const yMatch = pageTitle.match(/\b(19\d{2}|20\d{2})\b/);
                const year = matched?.year || (yMatch ? yMatch[1] : undefined);

                let quality = matched?.quality;
                if (!quality) {
                    if (/\b(?:2160p|4k)\b/i.test(pageTitle)) quality = '4K UHD';
                    else if (/\b1080p\b/i.test(pageTitle)) quality = '1080p';
                    else if (/\b720p\b/i.test(pageTitle)) quality = '720p';
                    else if (/\b480p\b/i.test(pageTitle)) quality = '480p';
                }

                homepagePosts.push({
                    id,
                    title: pageTitle,
                    poster: pagePoster || item.poster || matched?.poster || '',
                    sourceUrl: item.link,
                    chunk: matched?.chunk || null,
                    ...(year && { year }),
                    ...(quality && { quality }),
                    ...(matched?.season && { season: matched.season }),
                    ...(matched?.isSeries && { isSeries: true }),
                    ...(tmdbId && { tmdbId }),
                    ...(imdbId && { imdbId }),
                    ...(mediaType && { mediaType }),
                    ...(rating && { rating }),
                    downloadLinks,
                    updatedAt: new Date().toISOString()
                });
            }
        });

        await Promise.all(workers);

        if (homepagePosts.length > 0) {
            const fileName = `${source}homepage.json`;
            fs.writeFileSync(path.join(dataDir, fileName), JSON.stringify(homepagePosts, null, 2));
            console.log(`✅ Successfully updated ${fileName} with ${homepagePosts.length} posts & direct download links!`);
        }
    } catch (err) {
        console.warn(`⚠️ Warning: Could not update ${source}homepage.json:`, err.message);
    }
}

/**
 * Scrape a specific category
 */
async function scrapeCategory({
    source,
    startPageInput,
    endPageInput,
    pageCountInput,
    concurrencyInput,
    requestDelayInput,
    customDomainInput,
    dryRun = false
}) {
    let CATEGORY = 'hollywood';
    let defaultBaseUrl = 'https://vegamovies.gallery';

    if (source === 'rogmovies' || source === 'bollywood') {
        CATEGORY = 'bollywood';
        defaultBaseUrl = 'https://rogmovies.one';
    } else if (source === 'xprimehub' || source === 'xprime') {
        CATEGORY = 'xprimehub';
        defaultBaseUrl = 'https://xprimehub.pics';
    }

    const domainEnv = process.env[`${source.toUpperCase()}_DOMAIN`] || process.env.BASE_URL;
    const BASE_URL = customDomainInput || domainEnv || defaultBaseUrl;

    const history = getHistory();
    const lastScraped = history[CATEGORY] || 0;

    let START_PAGE = parseInt(startPageInput);
    if (isNaN(START_PAGE) || START_PAGE <= 0) {
        START_PAGE = lastScraped + 1;
    }

    const PAGE_COUNT = parseInt(pageCountInput) || 10;
    let END_PAGE = parseInt(endPageInput);
    if (isNaN(END_PAGE) || END_PAGE < START_PAGE) {
        END_PAGE = START_PAGE + PAGE_COUNT - 1;
    }

    const CONCURRENCY = Math.max(1, parseInt(concurrencyInput) || 5);
    const REQUEST_DELAY = Math.max(100, parseInt(requestDelayInput) || 400);
    const MOVIES_PER_CHUNK = 100;

    const INDEX_FILE = path.join(DATA_DIR, `${CATEGORY}-index.json`);
    const CHUNK_DIR = path.join(DATA_DIR, CATEGORY);

    if (!dryRun && !fs.existsSync(CHUNK_DIR)) {
        fs.mkdirSync(CHUNK_DIR, { recursive: true });
    }

    function readIndex() {
        if (fs.existsSync(INDEX_FILE)) {
            try {
                return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
            } catch {
                return [];
            }
        }
        return [];
    }

    function saveIndex(data) {
        if (!dryRun) {
            fs.writeFileSync(INDEX_FILE, JSON.stringify(data, null, 2));
        }
    }

    function getTargetChunkFile(indexData) {
        let maxChunkId = 1;
        indexData.forEach(item => {
            if (item.chunk > maxChunkId) {
                maxChunkId = item.chunk;
            }
        });
        const countInMaxChunk = indexData.filter(item => item.chunk === maxChunkId).length;
        if (countInMaxChunk >= MOVIES_PER_CHUNK) {
            maxChunkId++;
        }
        return maxChunkId;
    }

    function saveMovieToChunk(chunkId, id, detailData) {
        if (dryRun) return;
        const chunkFile = path.join(CHUNK_DIR, `chunk-${chunkId}.json`);
        let chunkData = {};
        if (fs.existsSync(chunkFile)) {
            try {
                chunkData = JSON.parse(fs.readFileSync(chunkFile, 'utf8'));
            } catch {}
        }
        chunkData[id] = detailData;
        fs.writeFileSync(chunkFile, JSON.stringify(chunkData, null, 2));
    }



    console.log(`\n=================================================================`);
    console.log(`🎬 Target Category: ${CATEGORY.toUpperCase()} (${source})`);
    console.log(`🌐 Base URL:        ${BASE_URL}`);
    console.log(`📁 Data Directory:  ${DATA_DIR}`);
    console.log(`📄 Target Pages:    ${START_PAGE} to ${END_PAGE} (${END_PAGE - START_PAGE + 1} pages)`);
    console.log(`⏱️  Last Scraped:    Page ${lastScraped}`);
    console.log(`⚡ Concurrency:     ${CONCURRENCY} workers | Request Delay: ${REQUEST_DELAY}ms`);
    if (dryRun) console.log(`🔍 Dry Run Mode:    ENABLED (No files will be written)`);
    console.log(`=================================================================\n`);

    // Auto-update {source}homepage.json with the latest homepage posts
    if (!dryRun) {
        await updateHomepageJson(source, BASE_URL, DATA_DIR);
    }

    let indexData = readIndex();
    const existingIds = new Set(indexData.map(m => m.id));
    let totalAdded = 0;
    let totalSkipped = 0;

    for (let page = START_PAGE; page <= END_PAGE; page++) {
        const cleanBase = BASE_URL.replace(/\/+$/, '');
        const pageUrl = page === 1 ? cleanBase : `${cleanBase}/page/${page}/`;
        console.log(`\n[PAGE ${page}/${END_PAGE}] Fetching: ${pageUrl}`);

        try {
            const response = await axios.get(pageUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                timeout: 20000,
                maxRedirects: 5
            });

            const $ = cheerio.load(response.data);
            const movieArticles = $('article, .post-item, .poster-card, .post, [class*="poster-card"]');
            const moviesOnPage = [];

            movieArticles.each((i, el) => {
                let link = $(el).find('h2 a, h3 a, a').attr('href') || 
                           $(el).find('meta[itemprop="url"]').attr('content') ||
                           $(el).closest('a').attr('href') || 
                           $(el).parent('a').attr('href') || 
                           ($(el).is('a') ? $(el).attr('href') : null);
                
                let title = $(el).find('h2 a, h3 a, h2, h3, .post-title, .poster-title, .title').first().text().trim();
                if (!title) title = $(el).find('img').attr('alt')?.trim();
                
                let poster = extractCleanPoster($(el).find('img'));

                if (title && link) {
                    moviesOnPage.push({ title, link, poster });
                }
            });

            console.log(`  Found ${moviesOnPage.length} items on page ${page}.`);

            const newMovies = moviesOnPage.filter(movie => {
                const id = generateIdFromUrl(movie.link);
                if (existingIds.has(id)) {
                    totalSkipped++;
                    return false;
                }
                return true;
            });

            if (newMovies.length === 0) {
                console.log(`  ℹ️  All ${moviesOnPage.length} items on page ${page} are already indexed (duplicates skipped).`);
            } else {
                console.log(`  ⚡ Scraping ${newMovies.length} new items with ${CONCURRENCY} workers...`);

                let currentIndex = 0;
                const workerCount = Math.min(CONCURRENCY, newMovies.length);

                const workers = Array.from({ length: workerCount }, async (_, workerId) => {
                    await delay(workerId * 200);

                    while (currentIndex < newMovies.length) {
                        const idx = currentIndex++;
                        const movie = newMovies[idx];
                        const id = generateIdFromUrl(movie.link);

                        try {
                            const details = await scrapeMoviePage(movie.link);
                            const targetChunk = getTargetChunkFile(indexData);

                            // Prioritize high-resolution inner page poster or verified listing poster
                            let finalPoster = '';
                            if (details.poster && details.poster.startsWith('http') && !details.poster.startsWith('data:')) {
                                finalPoster = details.poster;
                            } else if (movie.poster && movie.poster.startsWith('http') && !movie.poster.startsWith('data:')) {
                                finalPoster = movie.poster;
                            }

                            const indexEntry = {
                                id,
                                title: movie.title,
                                poster: finalPoster,
                                chunk: targetChunk,
                                ...(details.tmdbId && { tmdbId: details.tmdbId }),
                                ...(details.mediaType && { mediaType: details.mediaType }),
                                ...(details.rating && { rating: details.rating })
                            };
                            if (details.postMeta?.primaryQuality) indexEntry.quality = details.postMeta.primaryQuality;
                            if (details.postMeta?.season) indexEntry.season = details.postMeta.season;
                            if (details.postMeta?.year) indexEntry.year = details.postMeta.year;
                            if (details.postMeta?.isSeries) indexEntry.isSeries = true;

                            saveMovieToChunk(targetChunk, id, {
                                id,
                                fullTitle: details.fullTitle,
                                cleanTitle: movie.title,
                                poster: finalPoster,
                                sourceUrl: movie.link,
                                ...(details.postMeta?.isSeries && { isSeries: true }),
                                ...(details.postMeta?.season && { season: details.postMeta.season }),
                                ...(details.postMeta?.year && { year: details.postMeta.year }),
                                ...(details.tmdbId && { tmdbId: details.tmdbId }),
                                ...(details.imdbId && { imdbId: details.imdbId }),
                                ...(details.mediaType && { mediaType: details.mediaType }),
                                ...(details.rating && { rating: details.rating }),
                                ...(details.overview && { overview: details.overview }),
                                downloadLinks: details.downloadLinks
                            });

                            indexData.push(indexEntry);
                            saveIndex(indexData);
                            existingIds.add(id);
                            totalAdded++;

                            console.log(`  ✅ [${idx + 1}/${newMovies.length}] Saved -> chunk-${targetChunk}.json (${details.downloadLinks.length} links) | ${movie.title.substring(0, 50)}...`);

                            await delay(REQUEST_DELAY);
                        } catch (err) {
                            console.error(`  ⚠️ [${idx + 1}/${newMovies.length}] Failed ${movie.title}: ${err.message}`);
                        }
                    }
                });

                await Promise.all(workers);
            }

            // Update history file
            if (!dryRun) {
                updateHistory(CATEGORY, page);
            }
            await delay(800);

        } catch (error) {
            console.error(`❌ Error scraping page ${page}: ${error.message}`);
            break;
        }
    }

    console.log(`\n🎉 Finished ${CATEGORY}: ${totalAdded} added, ${totalSkipped} duplicates skipped. Total in index: ${indexData.length}\n`);
}

/**
 * Main execution controller
 */
async function main() {
    const startPage = namedArgs['start'] || positionalArgs[1] || process.env.START_PAGE;
    const endPage = namedArgs['end'] || positionalArgs[2] || process.env.END_PAGE;
    const pageCount = namedArgs['count'] || process.env.PAGE_COUNT || '10';
    const concurrency = namedArgs['concurrency'] || positionalArgs[3] || process.env.CONCURRENCY || '5';
    const requestDelay = namedArgs['delay'] || process.env.REQUEST_DELAY || '400';
    const dryRun = Boolean(namedArgs['dry-run'] || process.env.DRY_RUN === 'true');

    // Standalone homepage refresh mode
    if (sourceParam === 'homepage' || namedArgs['homepage-only']) {
        console.log("🏠 Refreshing homepage JSON files for all sources...\n");
        const defaultSources = [
            { source: 'vegamovies', url: process.env.VEGAMOVIES_DOMAIN || 'https://vegamovies.gallery' },
            { source: 'rogmovies', url: process.env.ROGMOVIES_DOMAIN || 'https://rogmovies.one' },
            { source: 'xprimehub', url: process.env.XPRIME_DOMAIN || 'https://xprimehub.pics' }
        ];
        for (const s of defaultSources) {
            await updateHomepageJson(s.source, s.url, DATA_DIR);
        }
        console.log("\n✨ All homepage JSON files updated successfully!");
        return;
    }

    if (sourceParam === 'all') {
        console.log("🚀 Starting Bulk Scraper across ALL sources (Hollywood -> Bollywood -> XPrimeHub)...\n");
        const sources = ['vegamovies', 'rogmovies', 'xprimehub'];
        for (const s of sources) {
            await scrapeCategory({
                source: s,
                startPageInput: startPage,
                endPageInput: endPage,
                pageCountInput: pageCount,
                concurrencyInput: concurrency,
                requestDelayInput: requestDelay,
                customDomainInput: namedArgs[`${s}-domain`] || process.env[`${s.toUpperCase()}_DOMAIN`],
                dryRun
            });
        }
    } else {
        await scrapeCategory({
            source: sourceParam,
            startPageInput: startPage,
            endPageInput: endPage,
            pageCountInput: pageCount,
            concurrencyInput: concurrency,
            requestDelayInput: requestDelay,
            customDomainInput: namedArgs['domain'] || process.env.CUSTOM_DOMAIN,
            dryRun
        });
    }

    console.log("✨ All scrape operations completed successfully!");
}

main().catch(err => {
    console.error("Fatal scraper error:", err);
    process.exit(1);
});
