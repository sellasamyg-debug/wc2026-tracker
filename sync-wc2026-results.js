#!/usr/bin/env node
// WC2026 Result Auto-Sync — uses football-data.org (free tier)
// Reads credentials ONLY from environment variables.

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_KEY      = process.env.SUPABASE_KEY;
const FOOTBALL_DATA_KEY = process.env.FOOTBALL_DATA_KEY;
const TABLE_NAME = 'results';

if (!SUPABASE_URL || !SUPABASE_KEY || !FOOTBALL_DATA_KEY) {
    console.error('Missing env vars: SUPABASE_URL, SUPABASE_KEY and FOOTBALL_DATA_KEY must all be set.');
    process.exit(1);
}

async function fetchFinishedMatches() {
    const url = 'https://api.football-data.org/v4/competitions/WC/matches?status=FINISHED';
    const res = await fetch(url, { headers: { 'X-Auth-Token': FOOTBALL_DATA_KEY } });
    if (!res.ok) {
          const body = await res.text();
          throw new Error('football-data.org HTTP ' + res.status + ': ' + body);
    }
    const data = await res.json();
    if (data.errorCode) throw new Error('football-data.org error: ' + data.message);
    return data.matches || [];
}

// Map football-data.org stage names to the short codes the frontend uses
function mapRound(stage) {
    const map = {
          'GROUP_STAGE':          'group',
          'ROUND_OF_32':          'r32',
          'ROUND_OF_16':          'r16',
          'QUARTER_FINALS':       'qf',
          'SEMI_FINALS':          'sf',
          'THIRD_PLACE':          '3rd',
          'THIRD_PLACE_PLAYOFF':  '3rd',
          'FINAL':                'final',
    };
    return map[stage] || stage.toLowerCase();
}

// Normalize football-data.org team names to match the frontend's PLAYERS list
function normalizeTeamName(name) {
    const map = {
          'Bosnia-Herzegovina':   'Bosnia and Herzegovina',
          'Bosnia & Herzegovina': 'Bosnia and Herzegovina',
    };
    return map[name] || name;
}

function toRow(m) {
    const winner = m.score?.winner; // 'HOME_TEAM', 'AWAY_TEAM', 'DRAW', null
  return {
        id:          m.id,                           // football-data.org fixture ID -> primary key
        team1:       normalizeTeamName(m.homeTeam.name),
        team2:       normalizeTeamName(m.awayTeam.name),
        score1:      m.score?.fullTime?.home ?? null,
        score2:      m.score?.fullTime?.away ?? null,
        status:      m.status,
        match_date:  m.utcDate,
        round:       mapRound(m.stage),              // e.g. 'group', 'r16', 'qf', 'final'
        home_winner: winner === 'HOME_TEAM',
        away_winner: winner === 'AWAY_TEAM',
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
    if (!res.ok) {
          const body = await res.text();
          throw new Error('Supabase upsert HTTP ' + res.status + ': ' + body);
    }
    return rows.length;
}

async function main() {
    console.log('[' + new Date().toISOString() + '] WC2026 sync starting (football-data.org)');
    let matches;
    try {
          matches = await fetchFinishedMatches();
    } catch (err) {
          console.error('Failed to fetch matches:', err.message);
          process.exit(1);
    }
    console.log('Finished matches found: ' + matches.length);
    if (matches.length === 0) {
          console.log('Nothing to sync.');
          return;
    }
    matches.forEach(m => console.log(
          '  ' + m.homeTeam.name + ' ' +
          (m.score?.fullTime?.home ?? '?') + '-' + (m.score?.fullTime?.away ?? '?') +
          ' ' + m.awayTeam.name + ' [' + m.stage + ' -> ' + mapRound(m.stage) + ']'
        ));
    const rows = matches.map(toRow);
    try {
          const count = await upsertRows(rows);
          console.log('Upserted ' + count + ' rows to ' + TABLE_NAME);
    } catch (err) {
          console.error('Supabase upsert failed:', err.message);
          process.exit(1);
    }
    console.log('[done]');
}

main();
