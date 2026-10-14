/**
 * STRIDES YouTube Coaching Media Retrieval Service (Methodology Only)
 * 
 * STRICT CONSTRAINT:
 * Sourced results feed ONLY the "machine methodology" framing layer (how a drill/cue is taught).
 * It must NEVER be treated as medical or peer-reviewed scientific evidence.
 * Kept in a separate context bucket from the peer-reviewed scientific literature pipeline.
 */

export interface CoachingMediaItem {
  id: string;
  title: string;
  channelTitle: string;
  description: string;
  url: string;
  cueType: 'acceleration' | 'max_velocity' | 'hurdles' | 'jumps' | 'throws' | 'strength_conditioning' | 'mobility';
}

const VERIFIED_CHANNELS: Record<string, string> = {
  'Coach K (Kevin Schexnayder)': 'UC-dummy-coach-k', // Placeholder as not found
  'Track All-Access': 'UCFDSJeaf61ele8xkIxMwpWw',
  'Tone and Tighten': 'UCJASBOyF4Fkd26SIwRhLuZw',
  'L.O. Johnson': 'UCGC7uFZc6X1vSQMfYilIqiA',
  'Andreas Behm': 'UCDIK1uJZ9rSMtXmCL1dHRRw',
  'Leif Olav Alnes': 'UCw2sNZjEmqv17mcvFbB0bPA',
  'Bob Kersee': 'UCc0FsOVPzB4SXATcJu_j_cg',
  'Mike Holloway': 'UCk7P77__ffbTjwTId16Ar3g',
  'Rana Reider': 'UCl5tPYqgRIYXwWnbIbCTTvA',
  'Lance Brauman': 'UCmHz1GB_L2MmwonomXgkWPQ',
  'Garage Strength': 'UCZEEC1w4jP1cV2dibuDFwIQ',
  'AthleanX': 'UCe0TLA0EsQbE-MjuHXevj2A',
  'Overtime Athletes': 'UCM4GEVa1Qi1CTdJg0ljdoow',
  'ThenX': 'UCqjwF8rxRsotnojGl4gM0Zw',
  'The Movement System': 'UCNtTZc6bcWyzkn-eXGqYjlg',
  'Fisionline': 'UC6iRiXWScChTr6uNLXjJYFQ',
  'E3 Rehab': 'UCkb9jgRxR2D5bc1fSDofwtA',
  '[P]rehab': 'UCZOrpZTHi21RZpnxXdlJbgQ'
};

const CHANNEL_IDS = Object.values(VERIFIED_CHANNELS).filter(id => !id.startsWith('UC-dummy'));

/**
 * Searches YouTube Data API v3 for technical breakdowns from verified channels.
 */
export async function fetchCoachingMediaMethodology(query: string): Promise<CoachingMediaItem[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const lowerQ = query.toLowerCase();

  if (!apiKey) {
    console.warn('[YouTubeMediaPipeline] No API key, skipping media retrieval.');
    return [];
  }

  try {
    // If query targets core/abs/lumbar/spine, prioritize AthleanX channel ID
    const isCoreOrLumbarQuery = /core|abs|abdominal|lumbar|spine|lower\s*back|lowerback|oblique|pelvic/i.test(query);
    const athleanChannelId = VERIFIED_CHANNELS['AthleanX'];

    let targetChannels: string[];
    if (isCoreOrLumbarQuery && athleanChannelId) {
      const otherChannels = CHANNEL_IDS.filter(id => id !== athleanChannelId).sort(() => 0.5 - Math.random()).slice(0, 2);
      targetChannels = [athleanChannelId, ...otherChannels];
    } else {
      targetChannels = [...CHANNEL_IDS].sort(() => 0.5 - Math.random()).slice(0, 3);
    }
    const mediaItems: CoachingMediaItem[] = [];

    const fetchPromises = targetChannels.map(async (channelId) => {
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&q=${encodeURIComponent(query)}&type=video&maxResults=2&key=${apiKey}`;
      const res = await fetch(searchUrl, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        const items = data.items || [];
        for (const item of items) {
          if (item.id?.videoId) {
            mediaItems.push({
              id: item.id.videoId,
              title: item.snippet?.title || 'Coaching Drill Breakdown',
              channelTitle: item.snippet?.channelTitle || 'Track & Field Coach',
              description: item.snippet?.description || 'Technical cueing and exercise demonstration',
              url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
              cueType: lowerQ.includes('throw') ? 'throws' : lowerQ.includes('jump') ? 'jumps' : lowerQ.includes('hurdle') ? 'hurdles' : 'max_velocity'
            });
          }
        }
      }
    });

    await Promise.allSettled(fetchPromises);
    return mediaItems.slice(0, 3); // Return top 3 matched videos
  } catch (err) {
    console.error('[YouTubeMediaPipeline] Live API error:', err);
    return [];
  }
}
