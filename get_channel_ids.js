const channels = [
  'Coach K (Kevin Schexnayder)',
  'L.O. Johnson',
  'Andreas Behm',
  'Leif Olav Alnes',
  'Bob Kersee',
  'Mike Holloway',
  'Rana Reider',
  'Lance Brauman',
  'Garage Strength',
  'AthleanX',
  'Overtime Athletes',
  'ThenX',
  'The Movement System',
  'Fisionline',
  'E3 Rehab',
  '[P]rehab'
];

async function run() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) { console.log("No API key"); return; }
  for (const c of channels) {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(c)}&key=${apiKey}`);
    const data = await res.json();
    if (data.items && data.items.length > 0) {
      console.log(`'${c}': '${data.items[0].snippet.channelId}',`);
    } else {
      console.log(`'${c}': 'NOT_FOUND',`);
    }
  }
}
run();
