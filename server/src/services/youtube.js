import { config } from '../config.js';
import { contentStems, uniq } from './textUtil.js';

/** ISO-8601 duration ("PT1H2M3S", "P0D") -> seconds; null if unparseable. */
export function parseIsoDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(iso || ''));
  if (!m) return null;
  const [, d = 0, h = 0, min = 0, s = 0] = m;
  return Number(d) * 86400 + Number(h) * 3600 + Number(min) * 60 + Number(s);
}

/** search.list (ids) then videos.list (duration + statistics). `fetchImpl` injectable. */
export async function fetchYouTubeVideos(query, { fetchImpl = fetch, apiKey = config.youtubeApiKey, maxResults = 15 } = {}) {
  if (!apiKey) throw new Error('YOUTUBE_API_KEY is not configured');
  const get = async (url) => {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(config.searchTimeoutMs) });
    if (!res.ok) throw new Error(`YouTube API responded ${res.status}`);
    return res.json();
  };
  const search = await get(
    'https://www.googleapis.com/youtube/v3/search?' +
      new URLSearchParams({ part: 'snippet', type: 'video', q: query, maxResults: String(maxResults), videoEmbeddable: 'true', relevanceLanguage: 'en', safeSearch: 'moderate', key: apiKey })
  );
  const ids = (search.items || []).map((i) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const details = await get(
    'https://www.googleapis.com/youtube/v3/videos?' + new URLSearchParams({ part: 'snippet,contentDetails,statistics', id: ids.join(','), key: apiKey })
  );
  return (details.items || []).map((v) => ({
    videoId: v.id,
    title: v.snippet?.title || '',
    channel: v.snippet?.channelTitle || '',
    publishedAt: v.snippet?.publishedAt || null,
    seconds: parseIsoDuration(v.contentDetails?.duration),
    views: Number(v.statistics?.viewCount ?? 0),
    url: `https://www.youtube.com/watch?v=${v.id}`,
    thumbnail: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || null,
  }));
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * Own ranking. HARD filters: duration inside [minMinutes, maxMinutes], and at least one query term in the title.
 * Score = weighted sum (weights normalised):
 *   title   share of query stems present in the title
 *   views   log10(views+1)/6  (1M views = 1.0)
 *   recency 1/(1 + ageYears/3)
 *   duration 1.0 at 14 min, falling to 0.5 at the edges of the allowed range
 */
export function rankVideos(videos, queryText, { now = new Date(), limit = config.ytMaxResults, weights, minMinutes = config.ytMinMinutes, maxMinutes = config.ytMaxMinutes } = {}) {
  const w = weights || { title: config.ytWeightTitle, views: config.ytWeightViews, recency: config.ytWeightRecency, duration: config.ytWeightDuration };
  const wSum = w.title + w.views + w.recency + w.duration || 1;
  const qStems = uniq(contentStems(queryText));
  const seen = new Set();
  const ranked = [];

  for (const v of videos) {
    if (seen.has(v.videoId)) continue;
    seen.add(v.videoId);
    if (v.seconds == null) continue;
    const minutes = v.seconds / 60;
    if (minutes < minMinutes || minutes > maxMinutes) continue;

    const titleStems = new Set(contentStems(v.title));
    const titleMatch = qStems.length ? qStems.filter((s) => titleStems.has(s)).length / qStems.length : 0;
    if (titleMatch === 0) continue;

    const viewScore = clamp01(Math.log10(v.views + 1) / 6);
    const ageYears = v.publishedAt ? Math.max(0, (now - new Date(v.publishedAt)) / (365.25 * 86400e3)) : 8;
    const recency = 1 / (1 + ageYears / 3);
    const halfRange = Math.max(14 - minMinutes, maxMinutes - 14);
    const duration = clamp01(1 - 0.5 * (Math.abs(minutes - 14) / halfRange));

    const score = (w.title * titleMatch + w.views * viewScore + w.recency * recency + w.duration * duration) / wSum;
    ranked.push({
      ...v,
      minutes: Math.round(minutes * 10) / 10,
      score: Math.round(score * 1000) / 1000,
      scoreBreakdown: { title: round(titleMatch), views: round(viewScore), recency: round(recency), duration: round(duration) },
    });
  }
  return ranked.sort((a, b) => b.score - a.score).slice(0, limit);
}
const round = (x) => Math.round(x * 100) / 100;
