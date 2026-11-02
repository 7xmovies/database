import axios from 'axios';

// Default TMDB API Key provided by user
export const DEFAULT_TMDB_API_KEY = 'b18089699b30648f171528029de6292a';

// In-memory cache to avoid duplicate API calls during bulk scraping
const tmdbCache = new Map();

/**
 * Strips formatting, resolutions, qualities, audio labels, and release group tags
 * to extract the clean searchable title, release year, and series flag.
 */
export function cleanTitleForTmdb(rawTitle) {
    if (!rawTitle) return { searchTitle: '', year: null, isSeries: false };
    let title = rawTitle.trim();

    // 1. Detect if TV Show / Series
    const isSeries = Boolean(/\b(?:Season\s*\d+|S\d+|Episode|Episodes|TV-Show|Series|Serial)\b/i.test(title));

    // 2. Remove "Download" prefix
    title = title.replace(/^Download\s+/i, '');

    // 3. Extract Year
    let year = null;
    const yParenMatch = title.match(/\(\s*(19\d{2}|20\d{2})\s*\)/);
    if (yParenMatch) {
        year = yParenMatch[1];
        title = title.replace(/\(\s*(19\d{2}|20\d{2})\s*\)/, ' ');
    } else {
        const yMatch = title.match(/\b(19\d{2}|20\d{2})\b/);
        if (yMatch) {
            year = yMatch[1];
            title = title.replace(/\b(19\d{2}|20\d{2})\b/, ' ');
        }
    }

    // 4. Remove content inside brackets, braces, and parentheses
    title = title
        .replace(/\{[^}]*\}/g, ' ')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\([^)]*\)/g, ' ');

    // 5. Cut off OTT platform prefixes / channel labels (including JioHotstar, Disney+ Hotstar, etc.)
    const ottKeywords = ['prime\\s*video', 'primevideo', 'netflix', 'disney\\+?\\s*hotstar', 'disney\\+?', 'jio\\s*hotstar', 'jiohotstar', 'hotstar', 'jiocinema', 'jio\\s*cinema', 'sonyliv', 'sony\\s*liv', 'zee5', 'apple\\s*tv'];
    for (const ott of ottKeywords) {
        const regex = new RegExp(`(?::|–|-|\\|)?\\s*\\b${ott}\\b.*$`, 'i');
        title = title.replace(regex, ' ');
    }

    // 6. Remove technical qualities, audio descriptors, and noise words
    title = title
        .replace(/\b(?:Dual\s*Audio|Multi\s*Audio|Hindi\s*Dubbed|Dubbed|ORG|Full\s*Movie|WEB-DL|Blu[- ]?Ray|HDRip|WEBRip|BRRip|HDTC|HDTV|HD|Season\s*\d+|S\d+|Episode\s*\d+|E\d+|Series|Adult|Short\s*Film|TV-Show|Show)\b/gi, ' ')
        .replace(/\b(?:Hindi|English|Punjabi|Tamil|Telugu|Kannada|Malayalam|Bengali|Marathi|Gujarati|Bhojpuri|Urdu|Spanish|Korean|Chinese|Japanese)\b/gi, ' ')
        .replace(/\b(?:2160p|4k|1080p|720p|480p|360p|x264|x265|hevc|10bit|imax|sdr|hdr|60fps|proper)\b/gi, ' ')
        .replace(/\b(?:Added|Complete|Episodes?|All\s*Episodes)\b/gi, ' ')
        .replace(/[()[\]{}:\-–—|&]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return { searchTitle: title, year, isSeries };
}

/**
 * Searches TMDB for a movie or TV show and returns its TMDB ID, IMDb ID, media type,
 * rating, poster path, and overview.
 *
 * @param {string} rawTitle - Raw title from site/feed
 * @param {object} [options] - Options (apiKey, explicitYear, explicitIsSeries)
 * @returns {Promise<object|null>} Structured TMDB metadata
 */
export async function fetchTmdbMetadata(rawTitle, options = {}) {
    const apiKey = options.apiKey || process.env.TMDB_API_KEY || DEFAULT_TMDB_API_KEY;
    if (!apiKey) return null;

    const { searchTitle, year: parsedYear, isSeries: parsedIsSeries } = cleanTitleForTmdb(rawTitle);
    if (!searchTitle || searchTitle.length < 2) return null;

    const year = options.year || parsedYear;
    const isSeries = options.isSeries !== undefined ? options.isSeries : parsedIsSeries;

    const cacheKey = `${searchTitle.toLowerCase()}_${year || 'any'}_${isSeries ? 'tv' : 'movie'}`;
    if (tmdbCache.has(cacheKey)) {
        return tmdbCache.get(cacheKey);
    }

    const primaryEndpoint = isSeries ? 'tv' : 'movie';
    const secondaryEndpoint = isSeries ? 'movie' : 'tv';

    async function searchTmdb(endpoint, useYear) {
        try {
            const params = { api_key: apiKey, query: searchTitle };
            if (useYear && year) {
                if (endpoint === 'movie') params.year = year;
                else params.first_air_date_year = year;
            }
            const res = await axios.get(`https://api.themoviedb.org/3/search/${endpoint}`, {
                params,
                timeout: 6000
            });
            return res.data?.results || [];
        } catch {
            return [];
        }
    }

    try {
        let results = await searchTmdb(primaryEndpoint, true);
        if (!results.length) results = await searchTmdb(primaryEndpoint, false);
        if (!results.length) results = await searchTmdb(secondaryEndpoint, true);
        if (!results.length) results = await searchTmdb(secondaryEndpoint, false);

        if (!results.length) {
            tmdbCache.set(cacheKey, null);
            return null;
        }

        const match = results[0];
        const mediaType = match.title ? 'movie' : 'tv';
        const tmdbId = match.id;
        const rating = match.vote_average ? Math.round(match.vote_average * 10) / 10 : null;
        const posterUrl = match.poster_path ? `https://image.tmdb.org/t/p/w500${match.poster_path}` : null;
        const backdropUrl = match.backdrop_path ? `https://image.tmdb.org/t/p/w1280${match.backdrop_path}` : null;

        // Fetch external IDs for IMDb ID
        let imdbId = null;
        try {
            const extRes = await axios.get(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}/external_ids`, {
                params: { api_key: apiKey },
                timeout: 4000
            });
            if (extRes.data?.imdb_id) {
                imdbId = extRes.data.imdb_id;
            }
        } catch {}

        const result = {
            tmdbId,
            imdbId,
            mediaType,
            rating,
            posterUrl,
            backdropUrl,
            overview: match.overview || null,
            releaseDate: match.release_date || match.first_air_date || null
        };

        tmdbCache.set(cacheKey, result);
        return result;
    } catch {
        tmdbCache.set(cacheKey, null);
        return null;
    }
}
