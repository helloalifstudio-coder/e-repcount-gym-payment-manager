#!/usr/bin/env node
// RepCount installer — prepares local, gitignored SQL and deployment instructions.
// Intentionally does not connect to Supabase, hold tokens, or create Auth passwords.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import process from 'node:process';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaultDestination = join(root, '.repcount-setup');
const flags = new Map();
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--help' || process.argv[i] === '-h') flags.set('help', true);
  else if (['--gym', '--admin-email', '--project-ref', '--out'].includes(process.argv[i])) {
    const name = process.argv[i].slice(2);
    if (!process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw new Error('Missing value for ' + process.argv[i]);
    flags.set(name, process.argv[++i]);
  } else throw new Error('Unrecognized option: ' + process.argv[i]);
}
if (flags.get('help')) {
  console.log('RepCount setup: npm run setup:gym [-- --gym "Name" --admin-email "owner@example.com" --project-ref abcdefghijklmnopqrst]');
  console.log('Prompts for missing values. No passwords, API keys, or network access are needed.');
  process.exit(0);
}
const interactive = Boolean(process.stdin.isTTY);
const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
async function required(option, prompt) {
  const value = flags.get(option) ?? (rl ? await rl.question(prompt + ': ') : '');
  if (!value.trim()) throw new Error('Missing --' + option + '. Run from a terminal or supply the flag.');
  return value.trim();
}
try {
  const gymName = await required('gym', 'Gym business name');
  const adminEmail = (await required('admin-email', 'First Admin email (the gym owner controls this inbox)')).toLowerCase();
  const ref = (await required('project-ref', 'New Supabase project reference')).toLowerCase();
  if (gymName.length > 100 || /[\x00-\x1f]/.test(gymName)) throw new Error('Gym name must be at most 100 printable characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) || adminEmail.length > 254) throw new Error('Enter a valid Admin email address.');
  if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error('Supabase project reference must be 20 lowercase letters/digits (Project Settings → General).');
  const out = resolve(flags.get('out') || defaultDestination);
  const migrationsFolder = join(root, 'supabase/migrations');
  const filenames = (await readdir(migrationsFolder)).filter(name => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (filenames.length < 11 || !filenames.some(x=>x.includes('indexed_bounded_directory_api'))) {
    throw new Error('Required migrations are missing. Restore a complete RepCount fork before running setup.');
  }
  const parts = await Promise.all(filenames.map(async name => {
    const content = await readFile(join(migrationsFolder,name),'utf8');
    if (!content.trim()) throw new Error('Empty migration: ' + name);
    return '-- >>> BEGIN MIGRATION: ' + name + '\n' + content.trim() + '\n-- <<< END MIGRATION: ' + name;
  }));
  const schema = '-- RepCount fresh installation SQL for: ' + gymName +
    '\n-- Generated locally. For a NEW empty Supabase project ONLY. Do not rerun on an existing gym.\n' +
    '-- Run as the Supabase SQL Editor database owner. Keep this file out of Git.\n\nBEGIN;\n\n' +
    parts.join('\n\n') + '\n\nCOMMIT;\n';
  const originalBootstrap = await readFile(join(root, 'supabase/bootstrap_admin.sql'), 'utf8');
  if (!originalBootstrap.includes('REPLACE_WITH_FIRST_ADMIN_EMAIL') || !originalBootstrap.includes('REPLACE_WITH_GYM_NAME')) {
    throw new Error('Unexpected first-Admin bootstrap file. No setup files were written.');
  }
  const escapeSql = value => value.replaceAll("'", "''");
  const bootstrap = '-- STEP TWO: Create and auto-confirm this Admin account in Supabase Auth > Users FIRST.\n' +
    '-- Then run this file exactly once in the SQL Editor. Never enter or paste its password here.\n' +
    originalBootstrap.replaceAll('REPLACE_WITH_FIRST_ADMIN_EMAIL',escapeSql(adminEmail))
      .replaceAll('REPLACE_WITH_GYM_NAME',escapeSql(gymName));
  const vars = '# Vercel → Project → Settings → Environment Variables (Production)\n' +
    '# Do not paste a service_role, secret API key, database URL or password into VITE_* values.\n' +
    'VITE_SUPABASE_URL=https://' + ref + '.supabase.co\n' +
    'VITE_SUPABASE_PUBLISHABLE_KEY=PASTE_THIS_PROJECTS_PUBLISHABLE_KEY_FROM_SUPABASE_API_KEYS\n' +
    'VITE_REPCOUNT_DEMO_MODE=false\n';
  const checklist = `# ${gymName}: setup steps

**Project:** [Supabase project](https://supabase.com/dashboard/project/${ref})
**Admin inbox:** ${adminEmail} (must be controlled by the gym owner)
**Deploy:** [Vercel new project](https://vercel.com/new)

1. SQL Editor → New query: paste and run \`01_create_database.sql\` in an **empty project**.
2. Authentication → Users → Add user. Use **${adminEmail}**, choose a strong UNIQUE password privately, and enable Auto Confirm User for this one account.
3. SQL Editor → New query: paste and run \`02_create_first_admin.sql\`. It creates the gym and gives the existing Auth user its Admin role.
4. In a terminal, from the forked repository run:
   \`npx supabase login\`
   \`npx supabase link --project-ref ${ref}\`
   \`npx supabase functions deploy admin-users\`
   \`npx supabase functions deploy secure-login\`
   Both functions are REQUIRED for user management and password login. The secure-login endpoint has verify_jwt=false only because it runs BEFORE a user gets a JWT.
5. Supabase Authentication → Providers → Email: disable public signups. Authentication → URL Configuration: set the SITE URL to the deployed Vercel domain and allowlist \`https://YOUR-VERCEL-DOMAIN/reset-password\`.
6. Vercel → Add New → Project → import **this gym owner's fork**, framework **Vite**, root \`./\`, then add **all 3** values in \`03_vercel_environment.txt\` for **Production**, replacing the publishable-key placeholder with the value from this SAME Supabase project.
7. Deploy / redeploy on Vercel after saving environment values. Run \`npm run setup:check\` locally after copying the three values into \`.env.local\`. Vercel builds embed VITE_* values at BUILD TIME.
8. Sign in as the Admin. Create a membership plan, add a sample member with first payment, verify next-renewal date and manual WhatsApp reminder, invite a Staff account from Settings, then remove sample data before launch.

**Never paste customer passwords, service-role keys, database passwords, personal access tokens, or login links into GitHub or support chats.** Let the gym owner register and own their service accounts; Alif Growth Media can be invited as a collaborator.

**Important:** This SQL-Editor path is easiest for first-time clients. It does not populate Supabase's CLI migration ledger. For future schema changes, continue through ordered SQL Editor migrations; do not blindly run \`supabase db push\` against a SQL-Editor-initialized project. For developer-managed CLI installations use \`supabase link --project-ref ...\` followed by \`supabase db push\` INSTEAD of step 1, then use the Admin bootstrap in step 3.
`;
  await mkdir(out, {recursive:true});
  await Promise.all([
    writeFile(join(out,'01_create_database.sql'),schema,{flag:'w',mode:0o600}),
    writeFile(join(out,'02_create_first_admin.sql'),bootstrap,{flag:'w',mode:0o600}),
    writeFile(join(out,'03_vercel_environment.txt'),vars,{flag:'w',mode:0o600}),
    writeFile(join(out,'04_setup_checklist.md'),checklist,{flag:'w',mode:0o600}),
  ]);
  console.log('RepCount gym setup files generated in: '+out);
  console.log('  01_create_database.sql — '+filenames.length+' optimized, security-scoped migrations');
  console.log('  02_create_first_admin.sql — gym name and Admin email (no passwords)');
  console.log('  03_vercel_environment.txt — exactly three frontend values');
  console.log('  04_setup_checklist.md — full clickable installation walkthrough');
  console.log('No Supabase project or customer records were changed.');
} finally { rl?.close(); }
