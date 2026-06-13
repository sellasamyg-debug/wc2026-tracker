#!/usr/bin/env node
// WC2026 Result Auto-Sync — reads credentials from environment variables only.
// Set SUPABASE_URL, SUPABASE_KEY, and API_FOOTBALL_KEY as GitHub Actions secrets.
const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_KEY;
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
const TABLE_NAME = 'results';

if (!SUPABASE_URL || !SUPABASE_KEY || !API_FOOTBALL_KEY) {
  console.error('Missing env vars: SUPABASE_URL, SUPABASE_KEY and API_FOOTBALL_KEY must all be set.');
  process.exit(1);
}

async function fetchFinishedFixtures() {
  const statuses = ['FT', 'AET', 'PEN'];
  const all = [];
  for (const status of statuses) {
    const url = 'https://v3.football.api-sports.io/fixtures?league=1&season=2026&status=' + status;
    const res = await fetch(url, { headers: { 'x-apisports-key': API_FOOTBALL_KEY } });
    if (!res.ok) { const body = await res.text(); throw new Error('API-Football HTTP ' + res.status + ': ' + body); }
    const data = await res.json();
    if (data.errors && Object.keys(data.errors).length > 0) throw new Error('API-Football error: ' + JSON.stringify(data.errors));
    all.push(...(data.response || []));
    console.log('  status=' + status + ': ' + (data.response || []).length + ' fixture(s).');
  }
  return all;
}

function toRow(f) {
  return {
    fixture_id:  f.fixture.id,
    home_team:   f.teams.home.name,
    away_team:   f.teams.away.name,
    home_score:  f.goals.home,
    away_score:  f.goals.away,
    status:      f.fixture.status.short,
    match_date:  f.fixture.date,
    round:       f.league.round,
    home_winner: f.teams.home.winner,
    away_winner: f.teams.away.winner,
    updated_at:  new Date().toISOString(),
  };
}

async function upsertRows(rows) {
  if (rows.length === 0) return 0;
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + TABLE_NAME, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) { const body = await res.text(); throw new Error('Supabase upsert HTTP ' + res.status + ': ' + body); }
  return rows.length;
}

async function main() {
  console.log('[' + new Date().toISOString() + '] WC2026 sync starting');
  let fixtures;
  try { fixtures = await fetchFinishedFixtures(); }
  catch (err) { console.error('Failed to fetch:', err.message); process.exit(1); }
  console.log('Total finished fixtures: ' + fixtures.length);
  if (fixtures.length === 0) { console.log('Nothing to sync.'); return; }
  fixtures.forEach(f => console.log(
    '  ' + f.teams.home.name + ' ' + f.goals.home + '-' + f.goals.away + ' ' + f.teams.away.name + ' [' + f.league.round + ']'
  ));
  const rows = fixtures.map(toRow);
  try { const count = await upsertRows(rows); console.log('Upserted ' + count + ' rows to ' + TABLE_NAME); }
  catch (err) { console.error('Supabase upsert failed:', err.message); process.exit(1); }
  console.log('[done]');
}

main();
