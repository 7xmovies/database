/**
 * Metadata and Download Link Parser
 * Extracts structured quality, season, episode, file size, audio, server, and category information
 * from movie/series posts and download links.
 */

/**
 * Parses a download link and its contextual header text to extract structured fields.
 * 
 * @param {string} rawText - The anchor text combined with nearby header context
 * @param {string} href - The target download or intermediary URL
 * @param {object} [postContext] - Optional context from the overall post (e.g. postTitle, postSeason)
 * @returns {object} Structured link details
 */
export function parseLinkDetails(rawText, href, postContext = {}) {
  const text = (rawText || '').trim();
  const lower = text.toLowerCase();

  // 1. Joint SxxExx or separate Season / Episode detection
  let season = null;
  let episode = null;
  let isBatch = false;

  // Check joint SxxExx (e.g. S01E05, S2 E12, S03-EP04)
  const jointMatch = text.match(/\bS0*(\d{1,2})[-.\s_]*E(?:p(?:isode)?)?0*(\d{1,3})\b/i);
  if (jointMatch) {
    season = parseInt(jointMatch[1], 10);
    episode = parseInt(jointMatch[2], 10);
  } else {
    // Separate season match
    const sMatch = text.match(/(?:\bSeason[-.\s_]*0*(\d{1,2})|\bS0*(\d{1,2})\b)/i);
    if (sMatch) {
      season = parseInt(sMatch[1] || sMatch[2], 10);
    } else if (postContext.season) {
      season = postContext.season;
    }

    // Episode or Batch/Zip detection
    if (/\b(?:batch|zip|complete|all\s*episodes|full\s*season|pack)\b/i.test(text)) {
      isBatch = true;
      episode = 'Batch/Zip';
    } else {
      const epMatch = text.match(/(?:\bEpisode[-.\s_]*0*(\d{1,3})|\bEp[-.\s_]*0*(\d{1,3})|\bE0*(\d{1,3})\b)/i);
      if (epMatch) {
        episode = parseInt(epMatch[1] || epMatch[2] || epMatch[3], 10);
      }
    }
  }

  // 2. Resolution & Quality detection
  const qualities = [];
  if (/\b(?:2160p|4k|uhd)\b/i.test(text)) qualities.push('4K UHD');
  else if (/\b1440p\b/i.test(text)) qualities.push('1440p');
  else if (/\b1080p\b/i.test(text)) qualities.push('1080p');
  else if (/\b720p\b/i.test(text)) qualities.push('720p');
  else if (/\b480p\b/i.test(text)) qualities.push('480p');
  else if (/\b360p\b/i.test(text)) qualities.push('360p');

  if (/\b(?:10bit|10-bit)\b/i.test(text)) qualities.push('10Bit');
  if (/\b(?:hevc|x265)\b/i.test(text)) qualities.push('HEVC');
  else if (/\bx264\b/i.test(text)) qualities.push('x264');
  if (/\b(?:hdr|hdr10\+?)\b/i.test(text)) qualities.push('HDR');
  if (/\b(?:bluray|blu-ray|imax-bluray)\b/i.test(text)) qualities.push('BluRay');
  else if (/\bweb-dl\b/i.test(text)) qualities.push('WEB-DL');
  else if (/\bwebrip\b/i.test(text)) qualities.push('WEBRip');
  else if (/\bhdtc|hdtv\b/i.test(text)) qualities.push('HDTV');

  let quality = qualities.join(' ');
  if (!quality) {
    quality = postContext.primaryQuality || 'Standard HD';
  }

  // 3. File size detection
  let size = null;
  const sizeMatch = text.match(/\[\s*([\d.]+\s*(?:GB|MB)(?:\/[A-Za-z]+)?)\s*\]/i) ||
                    text.match(/\b([\d.]+\s*(?:GB|MB)(?:\/[A-Za-z]+)?)\b/i);
  if (sizeMatch) {
    size = sizeMatch[1].trim();
  }

  // 4. Audio & Language detection
  let audio = null;
  const audioBracket = text.match(/\{([^}]+)\}/);
  if (audioBracket) {
    audio = audioBracket[1].trim();
  } else {
    const aMatch = text.match(/\b(Dual\s*Audio|Multi\s*Audio|Hindi(?:\s*Dubbed|\s*DD5\.1)?|English(?:\s*DD5\.1)?|ORG\s*DD5\.1)\b/i);
    if (aMatch) audio = aMatch[1].trim();
    else if (postContext.audio) audio = postContext.audio;
  }

  // 5. Server / Host detection
  let server = 'Direct';
  if (/v-cloud|vcloud/i.test(text) || (href && href.includes('vcloud'))) server = 'V-Cloud';
  else if (/g-direct|fastdl/i.test(text) || (href && href.includes('fastdl'))) server = 'G-Direct';
  else if (/hubcloud/i.test(text) || (href && href.includes('hubcloud'))) server = 'HubCloud';
  else if (/nexdrive/i.test(text) || (href && href.includes('nexdrive'))) server = 'NexDrive';
  else if (/mega(?:\.nz|\.io)?\b/i.test(text) || (href && href.includes('mega'))) server = 'Mega';
  else if (/gdrive|google\s*drive/i.test(text) || (href && href.includes('drive.google'))) server = 'Google Drive';
  else if (/shareus/i.test(text) || (href && href.includes('shareus'))) server = 'ShareUs';

  // 6. Clean label text
  let label = text
    .replace(/\[\s*[\d.]+\s*(?:GB|MB)(?:\/[A-Za-z]+)?\s*\]/gi, '')
    .replace(/\{[^}]+\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!label || label.length < 3) {
    label = `${server} ${quality}`;
  }

  return {
    label,
    url: href,
    quality,
    season,
    episode,
    isBatch,
    size,
    audio,
    server
  };
}

/**
 * Extracts categories/genres and keywords from context.
 */
export function extractCategories($, postTitle = '', sourceUrl = '') {
  const categories = new Set();

  $('a[rel="category tag"], .category a, .cat-links a').each((_, el) => {
    const cat = $(el).text().trim();
    if (cat && cat.length > 2 && !cat.toLowerCase().includes('uncategorized')) {
      categories.add(cat);
    }
  });

  const title = (postTitle || '').toLowerCase();
  const genres = [
    'Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime',
    'Documentary', 'Drama', 'Family', 'Fantasy', 'Film-Noir', 'History',
    'Horror', 'Music', 'Musical', 'Mystery', 'Romance', 'Sci-Fi', 'Short',
    'Sport', 'Thriller', 'War', 'Western', 'Anime', 'K-Drama'
  ];

  genres.forEach(genre => {
    const regex = new RegExp(`\\b${genre.replace('-', '[- ]?')}\\b`, 'i');
    if (regex.test(title)) {
      categories.add(genre);
    }
  });

  if (title) {
    if (/\b(?:Dual\s*Audio)\b/i.test(title)) categories.add('Dual Audio');
    if (/\b(?:Multi\s*Audio)\b/i.test(title)) categories.add('Multi Audio');
    if (/\b(?:Hindi(?:\s*Dubbed)?)\b/i.test(title)) categories.add('Hindi Dubbed');
    if (/\b(?:Netflix)\b/i.test(title)) categories.add('Netflix');
    if (/\b(?:Amazon\s*Prime|Prime\s*Video)\b/i.test(title)) categories.add('Amazon Prime');
    if (/\b(?:Disney\+?|Hotstar)\b/i.test(title)) categories.add('Disney+ Hotstar');
    if (/\b(?:Apple\s*TV)\b/i.test(title)) categories.add('Apple TV+');
    if (/\b(?:JioCinema)\b/i.test(title)) categories.add('JioCinema');
    if (/\b(?:SonyLIV)\b/i.test(title)) categories.add('SonyLIV');
    if (/\b(?:Zee5)\b/i.test(title)) categories.add('Zee5');
    if (/\b(?:2160p|4k)\b/i.test(title)) categories.add('4K UHD');
    if (/\b1080p\b/i.test(title)) categories.add('1080p');
    if (/\b720p\b/i.test(title)) categories.add('720p');
    if (/\b480p\b/i.test(title)) categories.add('480p');
  }

  if (sourceUrl) {
    if (sourceUrl.includes('rogmovies')) categories.add('Bollywood');
    if (sourceUrl.includes('vegamovies')) categories.add('Hollywood');
    if (sourceUrl.includes('xprime')) categories.add('18+ Adult');
  }

  return Array.from(categories);
}

/**
 * Extracts post-level overview, year, season, and primary quality.
 */
export function extractPostMetadata($, postTitle = '') {
  const title = postTitle || $('h1').first().text().trim() || $('title').text().trim();

  // Year
  let year = null;
  const yMatch = title.match(/\b(19\d{2}|20\d{2})\b/);
  if (yMatch) year = yMatch[1];

  // Season
  let season = null;
  const sMatch = title.match(/(?:\bSeason\s*0*(\d{1,2})|\bS0*(\d{1,2})\b)/i);
  if (sMatch) season = parseInt(sMatch[1] || sMatch[2], 10);

  const isSeries = Boolean(season || /\b(?:Series|Episode|Episodes|Complete\s*Season)\b/i.test(title));

  // Primary Quality (highest detected)
  let primaryQuality = 'HD';
  if (/\b(?:2160p|4k)\b/i.test(title)) primaryQuality = '4K UHD';
  else if (/\b1080p\b/i.test(title)) primaryQuality = '1080p';
  else if (/\b720p\b/i.test(title)) primaryQuality = '720p';
  else if (/\b480p\b/i.test(title)) primaryQuality = '480p';

  return {
    year,
    season,
    isSeries,
    primaryQuality
  };
}
