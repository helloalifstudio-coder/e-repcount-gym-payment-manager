#!/usr/bin/env node
// Safe customer-install check: reads only PUBLIC frontend variables.
// Does not print keys, handle passwords, or write to customer databases.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

if (process.argv.includes('--help')) {
  console.log('npm run setup:check [-- --remote] : validate per-gym .env.local and optionally ping published functions.');
  process.exit(0);
}
const opts = new Map(Object.entries(process.env).filter(([k])=>k.startsWith('VITE_')));
try {
  const raw = await readFile(join(process.cwd(), '.env.local'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*(VITE_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !opts.has(match[1])) {
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1,-1);
      opts.set(match[1],value);
    }
  }
} catch { /* Vercel and CI provide environment variables directly. */ }
const problems=[];
const url = String(opts.get('VITE_SUPABASE_URL')||'').replace(/\/$/,'');
const key = String(opts.get('VITE_SUPABASE_PUBLISHABLE_KEY')||'');
const mode = String(opts.get('VITE_REPCOUNT_DEMO_MODE')||'');
const matched = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(url);
if (!matched) problems.push('VITE_SUPABASE_URL must be the FULL URL of THIS GYM\'S Supabase project (https://<project-ref>.supabase.co).');
if (!key || /PASTE|PLACEHOLDER|REPLACE|BUILD_CHECK/i.test(key) || !(key.startsWith('sb_publishable_') || key.startsWith('eyJ'))) {
  problems.push('VITE_SUPABASE_PUBLISHABLE_KEY must be this gym\'s real publishable / legacy anon key, not a secret or template.');
}
if (mode !== 'false') problems.push('VITE_REPCOUNT_DEMO_MODE must be explicitly false for a live gym.');
if (['VITE_SUPABASE_SERVICE_ROLE_KEY','VITE_SUPABASE_SECRET_KEY','VITE_DATABASE_URL'].some(k=>opts.has(k))) {
  problems.push('Never put service-role keys or database credentials in a browser VITE_* variable.');
}
if (problems.length) {
  console.error('RepCount gym configuration FAIL:');
  for (const p of problems) console.error(' - '+p);
  console.error('Copy .env.example to .env.local, fill it with this client\'s project settings, and rerun.');
  process.exitCode=1;
} else {
  console.log('PASS: frontend points to a well-formed Supabase project URL (ref '+matched[1]+').');
  console.log('PASS: publishable key is present and demo mode is disabled.');
  if (process.argv.includes('--remote')) {
    const endpoints=[
      ['Supabase Auth',url+'/auth/v1/health','GET'],
      ['secure-login Edge Function',url+'/functions/v1/secure-login','OPTIONS'],
      ['admin-users Edge Function',url+'/functions/v1/admin-users','OPTIONS'],
    ];
    let failed=false;
    for (const [name,endpoint,method] of endpoints){
      try{
        const response=await fetch(endpoint,{method,headers:{apikey:key,Origin:'http://localhost:5173'},signal:AbortSignal.timeout(7000)});
        if (!response.ok) {console.error('FAIL: '+name+' responded HTTP '+response.status);failed=true;}
        else console.log('PASS: '+name+' responds (HTTP '+response.status+').');
      }catch(error){console.error('FAIL: '+name+' unavailable: '+error.message);failed=true;}
    }
    if(failed)process.exitCode=1;
    else console.log('These checks confirm reachability, not a valid Admin password or member write permissions.');
  }
}
