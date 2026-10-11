import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../',import.meta.url));
const setup = join(root,'scripts/setup-gym.mjs');
const check = join(root,'scripts/check-setup.mjs');
const projectRef='abcdefghijklmnopqrst';
const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('VITE_')));

test('fork installer creates complete SQL, isolated first Admin and Vercel guide',()=>{
 const temp=mkdtempSync(join(tmpdir(),'repcount-fork-test-'));
 try {
  const r=spawnSync(process.execPath,[setup,'--gym',"O'Brien Fitness",'--admin-email','Owner+Gym@Example.com',
    '--project-ref',projectRef,'--out',temp],{cwd:root,encoding:'utf8',env:safeEnv});
  assert.equal(r.status,0,r.stderr);
  assert.deepEqual(readdirSync(temp).sort(),[
   '01_create_database.sql','02_create_first_admin.sql','03_vercel_environment.txt','04_setup_checklist.md']);
  const sql=readFileSync(join(temp,'01_create_database.sql'),'utf8');
  const committed=readFileSync(join(root,'supabase/install.sql'),'utf8');
  assert.ok(committed.includes('repcount_members_page'));
  assert.ok(committed.includes('202610100001_initial_schema.sql'));
  assert.ok(committed.includes('20261011121500_fix_search_escaping.sql'));

  assert.equal((sql.match(/BEGIN MIGRATION/g)??[]).length,11);
  assert.ok(sql.includes('202610100001_initial_schema.sql'));
  assert.ok(sql.includes('20261011121500_fix_search_escaping.sql'));
  assert.ok(sql.includes('repcount_members_page'));
  assert.ok(sql.includes('membership_renewals'));
  assert.ok(sql.includes('CREATE EXTENSION IF NOT EXISTS pg_trgm'));
  assert.ok(sql.includes('BEGIN;'));
  assert.ok(sql.includes('COMMIT;'));
  assert.ok(!sql.includes('mnflpbdtfvksbxjdsvdf'));
  const admin=readFileSync(join(temp,'02_create_first_admin.sql'),'utf8');
  assert.ok(admin.includes("O''Brien Fitness"));
  assert.ok(admin.includes('owner+gym@example.com'));
  assert.ok(!admin.includes('REPLACE_WITH_GYM_NAME'));
  const vars=readFileSync(join(temp,'03_vercel_environment.txt'),'utf8');
  assert.ok(vars.includes('VITE_SUPABASE_URL=https://'+projectRef+'.supabase.co'));
  assert.ok(vars.includes('VITE_REPCOUNT_DEMO_MODE=false'));
  assert.ok(!vars.includes('SERVICE_ROLE_KEY='));
 } finally {rmSync(temp,{recursive:true,force:true});}
});

test('installer refuses missing/unsafe client parameters before touching a backend',()=>{
 const r=spawnSync(process.execPath,[setup,'--gym','Gym','--admin-email','admin@gmail.com',
   '--project-ref','not-a-project-ref'],{cwd:root,encoding:'utf8',env:safeEnv});
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/project reference/i);
});

test('configuration preflight accepts only gym-scoped publishable keys and real mode',()=>{
 const good=spawnSync(process.execPath,[check],{
   cwd:root,encoding:'utf8',
   env:{...safeEnv,VITE_SUPABASE_URL:'https://'+projectRef+'.supabase.co',
   VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+ 'a'.repeat(30),VITE_REPCOUNT_DEMO_MODE:'false'}});
 assert.equal(good.status,0,good.stderr);
 const danger=spawnSync(process.execPath,[check],{
   cwd:root,encoding:'utf8',
   env:{...safeEnv,VITE_SUPABASE_URL:'https://'+projectRef+'.supabase.co',
   VITE_SUPABASE_PUBLISHABLE_KEY:'PLACEHOLDER',VITE_REPCOUNT_DEMO_MODE:'true',
   VITE_SUPABASE_SERVICE_ROLE_KEY:'should-not-be-in-browser'}});
 assert.notEqual(danger.status,0);
 assert.match(danger.stderr,/demo mode is disabled|must be explicitly false/i);
 assert.match(danger.stderr,/service-role/i);
});
