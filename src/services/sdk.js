import { createClient } from '@supabase/supabase-js';
import { createDemoSdk } from './demoSdk.js';

export const isDemoMode = import.meta.env.VITE_REPCOUNT_DEMO_MODE === 'true';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  publishableKey &&
  !supabaseUrl.includes('replace_with') &&
  !publishableKey.includes('replace_with'),
);

let supabaseInitializationError = null;
export let supabase = null;

// A bad Vercel environment value must not throw during module import: if it does,
// React never mounts and the static HTML loader remains on screen indefinitely.
if (isSupabaseConfigured && !isDemoMode) {
  try {
    supabase = createClient(supabaseUrl, publishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    });
  } catch (error) {
    supabaseInitializationError = error instanceof Error ? error.message : String(error);
    console.error('[RepCount] Supabase client initialization failed:', supabaseInitializationError);
  }
}

function getSupabaseConfigurationError() {
  if (!supabaseUrl || supabaseUrl.includes('replace_with')) {
    return 'VITE_SUPABASE_URL is missing or still a placeholder in Vercel. Add the Supabase project URL and redeploy.';
  }
  if (!publishableKey || publishableKey.includes('replace_with')) {
    return 'VITE_SUPABASE_PUBLISHABLE_KEY is missing or still a placeholder in Vercel. Add the project publishable key and redeploy.';
  }
  if (supabaseInitializationError) {
    return 'The Supabase client could not start. Check VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in Vercel. Details: ' + supabaseInitializationError;
  }
  return "Supabase is not ready. Verify the project's Vercel environment variables and redeploy.";
}

const TABLES = {
  plans_c: 'membership_plans',
  gym_members_c: 'gym_members',
  membership_dues_c: 'membership_dues',
  payments_c: 'payments',
};

const RELATIONS = {
  gym_members: {
    plan_c: { table: 'membership_plans', fields: ['id', 'name', 'price_c', 'duration_c', 'active_c'] },
  },
  membership_dues: {
    member_c: { table: 'gym_members', fields: ['id', 'name', 'phone_c'] },
    plan_c: { table: 'membership_plans', fields: ['id', 'name', 'price_c', 'duration_c', 'active_c'] },
  },
  payments: {
    member_c: { table: 'gym_members', fields: ['id', 'name', 'phone_c'] },
    due_c: { table: 'membership_dues', fields: ['id', 'name', 'balance_c', 'status_c', 'due_date_c'] },
  },
};

const ROLE_TO_DB = { Admin_c: 'admin', Manager_c: 'manager', Staff_c: 'staff' };
const DB_TO_ROLE = { admin: 'Admin_c', manager: 'Manager_c', staff: 'Staff_c' };

function requireSupabase() {
  if (!supabase) throw new Error(getSupabaseConfigurationError());
  return supabase;
}

async function readSecureLoginError(error) {
  try {
    const response = error?.context;
    if (response?.clone) return await response.clone().json();
    if (response?.json) return await response.json();
  } catch { /* use a generic message */ }
  return null;
}

function formatSecureLoginError(body) {
  if (body?.code === 'LOGIN_LOCKED') {
    const until = body.lockedUntil && Number.isFinite(Date.parse(body.lockedUntil))
      ? new Date(body.lockedUntil).toLocaleString() : null;
    return until ? `Too many failed attempts. Sign-in for this account and network is blocked until ${until}.`
      : 'Too many failed attempts. Sign-in for this account and network is blocked for 24 hours.';
  }
  if (body?.code === 'INVALID_CREDENTIALS') {
    const remaining = Number(body.attemptsRemaining);
    if (Number.isFinite(remaining) && remaining > 0) {
      return `Invalid email or password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before sign-in for this account and network is locked for 24 hours.`;
    }
    return 'Invalid email or password. Sign-in for this account and network is blocked for 24 hours.';
  }
  if (body?.code === 'ACCOUNT_NOT_ASSIGNED') {
    return 'Your credentials are valid, but this account has no active RepCount workspace. Contact the workspace administrator.';
  }
  if (body?.code === 'LOGIN_SECURITY_UNAVAILABLE') return 'Secure sign-in is temporarily unavailable. Please try again later.';
  return typeof body?.message === 'string' ? body.message : 'Sign-in failed. Please check your credentials and try again.';
}

function toDbField(field) {
  if (field === 'Id' || field === 'id') return 'id';
  if (field === 'Name') return 'name';
  if (field === 'CreatedOn') return 'created_at';
  if (field === 'ModifiedOn') return 'updated_at';
  if (typeof field !== 'string') return field;
  return field
    .replace(/^(member_c|plan_c|due_c)\.Name$/, '$1.name')
    .replace(/^(member_c|plan_c|due_c)\.Id$/, '$1.id')
    .replace(/^(member_c|plan_c|due_c)\.phone_c$/, '$1.phone_c');
}

function fromDbRecord(record) {
  if (Array.isArray(record)) return record.map(fromDbRecord);
  if (!record || typeof record !== 'object') return record;
  const mapped = {};
  for (const [key, value] of Object.entries(record)) {
    const nextKey = key === 'id' ? 'Id'
      : key === 'name' ? 'Name'
      : key === 'created_at' ? 'CreatedOn'
      : key === 'updated_at' ? 'ModifiedOn'
      : key;
    mapped[nextKey] = fromDbRecord(value);
  }
  return mapped;
}

function toDbRecord(tableName, record, appUser, isCreate = false) {
  const output = {};
  for (const [originalKey, originalValue] of Object.entries(record ?? {})) {
    if (['Owner', 'CreatedBy', 'CreatedOn', 'ModifiedOn', 'gym_id', 'created_by', 'created_at', 'updated_at'].includes(originalKey)) continue;
    const key = toDbField(originalKey);
    let value = originalValue;
    if (['member_c', 'plan_c', 'due_c'].includes(key) && value && typeof value === 'object') {
      value = value.Id ?? value.id ?? null;
    }
    if (value === undefined) continue;
    output[key] = value;
  }

  if (isCreate) {
    if (!appUser?.gymId || !appUser?.userId) {
      throw new Error('Your gym workspace is not ready. Sign out and sign in again.');
    }
    output.gym_id = appUser.gymId;
    output.created_by = appUser.userId;
  }
  return output;
}

function selectionFor(tableName, fields) {
  const requested = Array.isArray(fields) && fields.length ? fields : ['*'];
  const scalarFields = new Set();
  const relationFields = new Map();
  const relationMap = RELATIONS[tableName] ?? {};

  for (const fieldSpec of requested) {
    const field = typeof fieldSpec === 'string' ? fieldSpec : fieldSpec?.field;
    if (!field || field === '*') {
      scalarFields.add('*');
      continue;
    }
    const relation = relationMap[field];
    if (relation) {
      const existing = relationFields.get(field) ?? new Set();
      relation.fields.forEach(name => existing.add(name));
      if (fieldSpec && typeof fieldSpec === 'object' && fieldSpec.ref) {
        existing.add(toDbField(fieldSpec.ref));
      }
      relationFields.set(field, existing);
      continue;
    }

    // Also support explicit lookup columns such as "member_c.Name".
    const dotIndex = field.indexOf('.');
    const relationAlias = dotIndex > 0 ? field.slice(0, dotIndex) : '';
    const nestedRelation = relationMap[relationAlias];
    if (nestedRelation) {
      const existing = relationFields.get(relationAlias) ?? new Set();
      nestedRelation.fields.forEach(name => existing.add(name));
      existing.add(toDbField(field.slice(dotIndex + 1)));
      relationFields.set(relationAlias, existing);
      continue;
    }
    if (typeof fieldSpec === 'object' && fieldSpec.ref) {
      throw new Error('Unknown relationship field ' + field + ' on ' + tableName + '.');
    }
    scalarFields.add(toDbField(field));
  }

  const output = [...scalarFields];
  for (const [alias, selection] of relationFields) {
    const relation = relationMap[alias];
    output.push(alias + ':' + relation.table + '(' + [...selection].join(',') + ')');
  }
  return output.join(',');
}

function safeFilterText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/[()]/g, '');
}

function expression(op, field, value) {
  return { __repCountFilter: true, op, field, value };
}

export const CoreSDK = {
  eq: (field, value) => expression('eq', field, value),
  ne: (field, value) => expression('neq', field, value),
  gt: (field, value) => expression('gt', field, value),
  gte: (field, value) => expression('gte', field, value),
  lt: (field, value) => expression('lt', field, value),
  lte: (field, value) => expression('lte', field, value),
  contains: (field, value) => expression('ilike', field === 'member_c' ? 'member_c.Name' : field, '%' + safeFilterText(value) + '%'),
  notContains: (field, value) => expression('not.ilike', field, '%' + safeFilterText(value) + '%'),
  startsWith: (field, value) => expression('ilike', field, safeFilterText(value) + '%'),
  endsWith: (field, value) => expression('ilike', field, '%' + safeFilterText(value)),
  isNull: field => expression('is', field, null),
  isNotNull: field => expression('not.is', field, null),
  hasValue: field => expression('not.is', field, null),
  doesNotHaveValue: field => expression('is', field, null),
  isIn: (field, values) => expression('in', field, values ?? []),
  includes: (field, value) => expression('cs', field, value),
  excludes: (field, value) => expression('not.cs', field, value),
  and: (...clauses) => ({ __repCountFilter: true, op: 'and', clauses: clauses.flat().filter(Boolean) }),
  or: (...clauses) => ({ __repCountFilter: true, op: 'or', clauses: clauses.flat().filter(Boolean) }),
  not: clause => ({ __repCountFilter: true, op: 'not', clause }),
  between: (field, lower, upper) => ({ __repCountFilter: true, op: 'between', field, lower, upper }),
  dateExact: (field, value) => expression('eq', field, value),
};

window.RepCountSDK = { ...(window.RepCountSDK ?? {}), CoreSDK };

function relationNameForFilter(tableName, field) {
  const mapped = toDbField(field);
  const topLevel = String(mapped).split('.')[0];
  return RELATIONS[tableName]?.[topLevel] ? mapped : mapped;
}

function applyOneFilter(query, tableName, condition) {
  if (!condition || typeof condition !== 'object') return query;

  if (condition.op === 'and') {
    return (condition.clauses ?? []).reduce((current, child) => applyOneFilter(current, tableName, child), query);
  }
  if (condition.op === 'or') {
    const parts = (condition.clauses ?? []).map(child => filterToPostgrest(tableName, child)).filter(Boolean);
    return parts.length ? query.or(parts.join(',')) : query;
  }
  if (condition.op === 'not') {
    const clause = condition.clause;
    if (!clause) return query;
    if (clause.op === 'and' || clause.op === 'or') {
      const op = clause.op === 'and' ? 'and' : 'or';
      const inner = (clause.clauses ?? []).map(child => filterToPostgrest(tableName, child)).filter(Boolean).join(',');
      return query.not(op, '()', '(' + inner + ')');
    }
    const field = relationNameForFilter(tableName, clause.field);
    return query.not(field, clause.op, clause.value);
  }

  const field = relationNameForFilter(tableName, condition.field);
  switch (condition.op) {
    case 'eq': return query.eq(field, condition.value);
    case 'neq': return query.neq(field, condition.value);
    case 'gt': return query.gt(field, condition.value);
    case 'gte': return query.gte(field, condition.value);
    case 'lt': return query.lt(field, condition.value);
    case 'lte': return query.lte(field, condition.value);
    case 'ilike': return query.ilike(field, condition.value);
    case 'is': return query.is(field, condition.value);
    case 'in': return query.in(field, condition.value);
    case 'between': return query.gte(field, condition.lower).lte(field, condition.upper);
    default: return query.filter(field, condition.op, condition.value);
  }
}

function filterToPostgrest(tableName, condition) {
  if (!condition) return '';
  if (condition.op === 'and' || condition.op === 'or') {
    const inner = (condition.clauses ?? []).map(child => filterToPostgrest(tableName, child)).filter(Boolean);
    return condition.op + '(' + inner.join(',') + ')';
  }
  const field = relationNameForFilter(tableName, condition.field);
  if (condition.op === 'in') {
    const values = (condition.value ?? []).map(value => '"' + String(value).replace(/"/g, '\\"') + '"').join(',');
    return field + '.in.(' + values + ')';
  }
  if (condition.op === 'between') return field + '.gte.' + condition.lower + ',' + field + '.lte.' + condition.upper;
  const value = condition.value === null ? 'null' : safeFilterText(condition.value);
  return field + '.' + condition.op + '.' + value;
}

function mapStorageResult(path, file) {
  return {
    Id: path,
    Name: file.name,
    Path: path,
    Size: file.size,
    Type: file.type,
  };
}

class SupabaseQueryBuilder {
  constructor(tableName) {
    if (!TABLES[tableName]) throw new Error('Unknown RepCount table: ' + tableName);
    this.uiTableName = tableName;
    this.tableName = TABLES[tableName];
    this.fields = ['*'];
    this.filters = [];
    this.orders = [];
    this.pageNumber = null;
    this.pageSize = null;
    this.limitCount = null;
    this.offset = 0;
    this.aggregations = null;
  }

  select(fields) {
    this.fields = Array.isArray(fields) && fields.length ? fields : ['*'];
    return this;
  }

  where(condition) {
    if (condition) this.filters.push(condition);
    return this;
  }

  orderBy(field) {
    this.orders.push({ field: toDbField(field), ascending: true });
    return this;
  }

  orderByDesc(field) {
    this.orders.push({ field: toDbField(field), ascending: false });
    return this;
  }

  page(pageNumber, pageSize) {
    this.pageNumber = Math.max(1, Number(pageNumber) || 1);
    this.pageSize = Math.max(1, Number(pageSize) || 25);
    this.limitCount = null;
    this.offset = (this.pageNumber - 1) * this.pageSize;
    return this;
  }

  limit(limit, offset = 0) {
    this.limitCount = Math.max(1, Number(limit) || 1);
    this.offset = Math.max(0, Number(offset) || 0);
    this.pageNumber = null;
    this.pageSize = null;
    return this;
  }

  aggregate(aggregations) {
    this.aggregations = Array.isArray(aggregations) ? aggregations : [];
    return this;
  }

  async fetch() {
    try {
      const client = requireSupabase();
      if (this.aggregations) return await this.fetchAggregates(client);

      const selectString = selectionFor(this.tableName, this.fields);
      const { from, to } = this.getRange();
      let query = client.from(this.tableName).select(selectString, { count: 'exact' });
      query = this.filters.reduce((current, filter) => applyOneFilter(current, this.tableName, filter), query);
      for (const order of this.orders) {
        query = query.order(order.field, { ascending: order.ascending, nullsFirst: false });
      }
      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) return { success: false, data: [], total: 0, hasMore: false, message: error.message };
      const rows = (data ?? []).map(fromDbRecord);
      const total = Number(count ?? rows.length);
      return {
        success: true,
        data: rows,
        total,
        hasMore: from + rows.length < total,
      };
    } catch (error) {
      return { success: false, data: [], total: 0, hasMore: false, message: error instanceof Error ? error.message : 'Database query failed.' };
    }
  }

  async fetchAggregates(client) {
    const aggregators = [];
    for (const item of this.aggregations ?? []) {
      const fieldSpec = item.fields?.[0] ?? { field: 'Id', fn: 'Count', alias: 'count' };
      const field = toDbField(fieldSpec.field ?? 'Id');
      let query = client.from(this.tableName).select(field, { count: 'exact' });
      const conditions = [...this.filters, ...(item.where ? [item.where] : [])];
      query = conditions.reduce((current, filter) => applyOneFilter(current, this.tableName, filter), query);
      if (fieldSpec.fn === 'Count') {
        const { count, error } = await query.limit(1);
        if (error) throw error;
        aggregators.push({ id: item.id, data: { count: Number(count ?? 0) }, count: Number(count ?? 0) });
      } else {
        const { data, error } = await query.limit(10000);
        if (error) throw error;
        const total = (data ?? []).reduce((sum, row) => sum + Number(row[field] ?? 0), 0);
        aggregators.push({ id: item.id, data: { count: total }, count: total });
      }
    }
    return { success: true, data: [], total: 0, hasMore: false, aggregators };
  }

  getRange() {
    if (this.pageNumber !== null) {
      return { from: this.offset, to: this.offset + this.pageSize - 1 };
    }
    if (this.limitCount !== null) {
      return { from: this.offset, to: this.offset + this.limitCount - 1 };
    }
    return { from: 0, to: 24 };
  }

  async get(id) {
    try {
      const client = requireSupabase();
      const selectString = selectionFor(this.tableName, this.fields);
      let query = client.from(this.tableName).select(selectString).eq('id', id);
      query = this.filters.reduce((current, filter) => applyOneFilter(current, this.tableName, filter), query);
      const { data, error } = await query.maybeSingle();
      if (error) return { success: false, data: null, message: error.message };
      if (!data) return { success: false, data: null, message: 'Record not found or you do not have access.' };
      return { success: true, data: fromDbRecord(data) };
    } catch (error) {
      return { success: false, data: null, message: error instanceof Error ? error.message : 'Record query failed.' };
    }
  }

  async create(record) {
    try {
      const client = requireSupabase();
      const appUser = await resolveCurrentAppUser();
      const values = toDbRecord(this.tableName, record, appUser, true);
      const { data, error } = await client.from(this.tableName).insert(values).select('*');
      if (error) return { success: false, data: [], messages: [error.message], message: error.message };
      return { success: true, data: fromDbRecord(data ?? []), messages: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Create failed.';
      return { success: false, data: [], messages: [message], message };
    }
  }

  async update(record) {
    try {
      const client = requireSupabase();
      const id = record?.Id ?? record?.id;
      if (!id) return { success: false, data: [], messages: ['A record ID is required for an update.'] };
      const appUser = await resolveCurrentAppUser();
      const values = toDbRecord(this.tableName, record, appUser, false);
      delete values.id;
      const { data, error } = await client.from(this.tableName).update(values).eq('id', id).select('*');
      if (error) return { success: false, data: [], messages: [error.message], message: error.message };
      return { success: true, data: fromDbRecord(data ?? []), messages: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update failed.';
      return { success: false, data: [], messages: [message], message };
    }
  }

  async remove(id) {
    try {
      const client = requireSupabase();
      const { data, error } = await client.from(this.tableName).delete().eq('id', id).select('id');
      if (error) return { success: false, data: [], messages: [error.message], message: error.message };
      return { success: true, data: fromDbRecord(data ?? []), messages: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delete failed.';
      return { success: false, data: [], messages: [message], message };
    }
  }
}

async function resolveAppUser(authUser) {
  if (!authUser?.id || !supabase) return null;
  const { data: membership, error: membershipError } = await supabase
    .from('gym_users')
    .select('gym_id, role, status')
    .eq('user_id', authUser.id)
    .eq('status', 'active')
    .maybeSingle();

  if (membershipError) throw membershipError;
  if (!membership) return null;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('email, first_name, last_name')
    .eq('id', authUser.id)
    .maybeSingle();

  if (profileError) throw profileError;
  const firstName = profile?.first_name ?? authUser.user_metadata?.first_name ?? '';
  const lastName = profile?.last_name ?? authUser.user_metadata?.last_name ?? '';
  return {
    userId: authUser.id,
    id: authUser.id,
    Id: authUser.id,
    gymId: membership.gym_id,
    profile: DB_TO_ROLE[membership.role] ?? '',
    firstName,
    lastName,
    emailAddress: profile?.email ?? authUser.email ?? '',
  };
}

let cachedAppUser = null;
let cachedAuthUserId = null;

async function resolveCurrentAppUser() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    cachedAppUser = null;
    cachedAuthUserId = null;
    throw new Error('Your session expired. Sign in again.');
  }
  if (cachedAppUser?.userId === data.user.id && cachedAppUser?.gymId) return cachedAppUser;
  const appUser = await resolveAppUser(data.user);
  if (!appUser) throw new Error('Your account is not assigned to an active RepCount workspace.');
  cachedAppUser = appUser;
  cachedAuthUserId = data.user.id;
  return appUser;
}

async function invokeAdminAction(action, payload = {}) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke('admin-users', {
    body: { action, ...payload },
  });
  if (error) {
    let detail = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) detail = body.error;
    } catch {
      // Keep the safe default service error.
    }
    throw new Error(detail || 'The account-management function failed.');
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

const session = {
  ui: undefined,
  get initFailed() { return !isSupabaseConfigured || !supabase; },
  get configurationError() { return getSupabaseConfigurationError(); },

  user() {
    return cachedAppUser;
  },

  async getUser() {
    const client = requireSupabase();
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session?.user) {
      cachedAppUser = null;
      cachedAuthUserId = null;
      return null;
    }

    // getSession reads persisted client state; getUser verifies the access token with Supabase Auth.
    const { data: verifiedData, error: verifiedError } = await client.auth.getUser();
    if (verifiedError || !verifiedData.user) {
      await client.auth.signOut();
      cachedAppUser = null;
      cachedAuthUserId = null;
      return null;
    }

    const appUser = await resolveAppUser(verifiedData.user);
    if (!appUser) {
      await client.auth.signOut();
      cachedAppUser = null;
      cachedAuthUserId = null;
      return null;
    }
    cachedAppUser = appUser;
    cachedAuthUserId = verifiedData.user.id;
    return appUser;
  },

  subscribe(callback) {
    if (!supabase) return () => {};
    const { data } = supabase.auth.onAuthStateChange((event, authSession) => {
      cachedAuthUserId = authSession?.user?.id ?? null;
      setTimeout(async () => {
        if (authSession?.user) {
          try {
            const appUser = await resolveAppUser(authSession.user);
            cachedAppUser = appUser;
            callback(appUser
              ? { status: 'authenticated', user: appUser }
              : { status: 'anonymous', user: null });
          } catch {
            cachedAppUser = null;
            callback({ status: 'anonymous', user: null });
          }
        } else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
          cachedAppUser = null;
          callback({ status: 'anonymous', user: null });
        }
      }, 0);
    });
    return () => data.subscription.unsubscribe();
  },

  async login({ email, password }) {
    try {
      const client = requireSupabase();
      const { data, error } = await client.functions.invoke('secure-login', {
        body: {
          email: String(email ?? '').trim().toLowerCase(),
          password: String(password ?? ''),
        },
      });
      if (error) {
        const body = await readSecureLoginError(error);
        return { ok: false, error: { message: formatSecureLoginError(body), code: body?.code } };
      }
      if (data?.error || !data?.session?.access_token || !data?.session?.refresh_token) {
        return { ok: false, error: { message: formatSecureLoginError(data), code: data?.code } };
      }
      const { data: sessionData, error: sessionError } = await client.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      if (sessionError || !sessionData.session) {
        return { ok: false, error: { message: 'Secure sign-in could not establish a session. Please try again.' } };
      }
      const { data: verifiedData, error: verifiedError } = await client.auth.getUser();
      if (verifiedError || !verifiedData.user) {
        await client.auth.signOut();
        return { ok: false, error: { message: 'The sign-in session could not be verified. Please try again.' } };
      }
      const appUser = await resolveAppUser(verifiedData.user);
      if (!appUser) {
        await client.auth.signOut();
        cachedAppUser = null;
        cachedAuthUserId = null;
        return { ok: false, error: { message: 'Your account has no active RepCount workspace. Contact the workspace administrator.' } };
      }
      cachedAppUser = appUser;
      cachedAuthUserId = verifiedData.user.id;
      return { ok: true, value: appUser };
    } catch (error) {
      return { ok: false, error: { message: error instanceof Error ? error.message : 'Secure sign-in is temporarily unavailable.' } };
    }
  },

  async sendResetLink({ email }) {
    try {
      const client = requireSupabase();
      const normalizedEmail = String(email ?? '').trim().toLowerCase();
      if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return { ok: false, error: { message: 'Enter a valid email address.' } };
      }
      // Supabase requires the exact production/reset redirect to be allowlisted
      // in Authentication > URL Configuration. Never expose privileged keys.
      const redirectTo = new URL('/reset-password', window.location.origin).toString();
      const { error } = await client.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
      if (error) return { ok: false, error: { message: 'Unable to send the reset email right now. Please try again later.' } };
      // A generic success response avoids revealing which emails have accounts.
      return { ok: true };
    } catch {
      return { ok: false, error: { message: 'Password recovery is temporarily unavailable. Please try again later.' } };
    }
  },

  async resetPassword({ newPassword }) {
    try {
      const client = requireSupabase();
      if (typeof newPassword !== 'string' || newPassword.length < 12) {
        return { ok: false, error: { message: 'Use a password with at least 12 characters.' } };
      }
      // A recovery link establishes a temporary Supabase Auth session via PKCE.
      // Without a valid session, updateUser cannot change any password.
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError || !sessionData.session) {
        return { ok: false, error: { message: 'Your password reset link is missing or expired. Request a new one.' } };
      }
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) return { ok: false, error: { message: error.message || 'Password reset failed.' } };
      await client.auth.signOut();
      cachedAppUser = null;
      cachedAuthUserId = null;
      return { ok: true };
    } catch {
      return { ok: false, error: { message: 'Password reset failed. Request a new reset link and try again.' } };
    }
  },

  async logout() {
    const client = requireSupabase();
    const { error } = await client.auth.signOut();
    cachedAppUser = null;
    cachedAuthUserId = null;
    if (error) throw error;
  },


};

const teams = {
  async getMembers(start = 0, limit = 100) {
    const result = await invokeAdminAction('list');
    const rows = result.data ?? [];
    const offset = Math.max(0, Number(start) || 0);
    const size = Math.max(1, Number(limit) || 100);
    return { data: rows.slice(offset, offset + size), total: rows.length, hasMore: offset + size < rows.length };
  },
  async createMember({ email, password, firstName = '', lastName = '', profileName }) {
    const result = await invokeAdminAction('create', { email, password, firstName, lastName, profileName });
    return result.data;
  },
  async updateMemberProfile(userId, { profile }) {
    return invokeAdminAction('update-role', { userId, profileName: profile });
  },
  async deleteMember(userId) {
    return invokeAdminAction('delete', { userId });
  },
};

const liveSdk = {
  session,
  teams,
  isConfigured: isSupabaseConfigured,
  isSupabase: true,
  table: tableName => new SupabaseQueryBuilder(tableName),

  // Compatibility for existing app components that need to render workspace people.
  // This reads active workspace memberships through the server-side Admin API; it never queries auth.users from the browser.
  admin: {
    async fetch(entity, options = {}) {
      if (entity !== 'user') throw new Error('Only workspace users are supported by this adapter.');
      const offset = Math.max(0, Number(options.pagingInfo?.offset) || 0);
      const limit = Math.max(1, Number(options.pagingInfo?.limit) || 100);
      const result = await teams.getMembers(offset, limit);
      const users = (result.data ?? []).map(member => {
        const parts = String(member.name ?? '').trim().split(/\\s+/).filter(Boolean);
        return {
          Id: member.id,
          Name: member.name ?? member.email ?? 'User',
          FirstName: parts[0] ?? '',
          LastName: parts.slice(1).join(' '),
          Email: member.email ?? '',
          AvatarUrl: member.avatarUrl ?? '',
        };
      });
      return { data: users, total: result.total ?? users.length, hasMore: Boolean(result.hasMore) };
    },
  },

  functions: {
    async invoke(functionName, body, options = {}) {
      const client = requireSupabase();
      const { data, error } = await client.functions.invoke(functionName, {
        body,
        headers: options.headers,
        signal: options.signal,
        region: options.region,
      });
      if (error) {
        return { ok: false, error: { message: error.message || 'Function call failed.' } };
      }
      return { ok: true, value: data };
    },
  },

  directory: {
    async list({ search = '', state = 'all', page = 1, pageSize = 25 } = {}) {
      const client = requireSupabase();
      const { data, error } = await client.rpc('repcount_members_page', {
        p_search: String(search).trim().slice(0,80),
        p_state: state,
        p_page: page,
        p_page_size: pageSize,
      });
      if (error) throw new Error(error.message || 'Could not load the member directory.');
      const rows = data?.rows ?? [], total = Number(data?.total ?? 0);
      return { rows, total, stats: data?.stats ?? {}, hasMore: page * pageSize < total };
    },
    async search(term, pageSize = 25) {
      return this.list({ search: term, page: 1, pageSize: Math.min(100,pageSize) });
    },
  },
  ledger: {
    async list({kind, search = '',status='All',period='all',page=1,pageSize=25}) {
      const client = requireSupabase();
      const {data,error} = await client.rpc('repcount_ledger_page',{
        p_kind:kind,p_search:String(search).trim().slice(0,80),
        p_status:status,p_period:period,p_page:page,p_page_size:pageSize,
      });
      if (error) throw new Error(error.message || 'Could not load the payment records.');
      const rows=data?.rows??[],total=Number(data?.total??0);
      return {rows,total,hasMore:page*pageSize<total};
    },
  },
  renewals: {
    async record({ memberId, planId, paidOn, method = 'UPI', requestId }) {
      const client = requireSupabase();
      await resolveCurrentAppUser(); // Ensure verified workspace membership before RPC.
      const { data, error } = await client.rpc('record_membership_renewal', {
        p_member_id: memberId,
        p_plan_id: planId,
        p_paid_on: paidOn,
        p_method: method,
        p_request_id: requestId ?? crypto.randomUUID(),
      });
      if (error) throw new Error(error.message || 'Could not record renewal. Check the renewal migration.');
      return data;
    },
    async list(limit = 100) {
      const client = requireSupabase();
      await resolveCurrentAppUser();
      const { data, error } = await client.from('membership_renewals')
        .select('id,member_id,plan_id,payment_id,paid_on,started_on,next_renewal_on,amount,created_at')
        .order('created_at', { ascending: false })
        .limit(Math.min(500, Math.max(1, Number(limit) || 100)));
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  },
  async dashboardSummary(today) {
    const client = requireSupabase();
    const { data, error } = await client.rpc('dashboard_summary', { p_today: today });
    if (error) throw error;
    return {
      outstanding: Number(data?.outstanding ?? 0),
      dueTodayBalance: Number(data?.due_today_balance ?? 0),
      collectedToday: Number(data?.collected_today ?? 0),
    };
  },

  storage: {
    validate(file, config = {}) {
      if (!file) return { valid: false, message: 'Choose a file.' };
      const extensions = config.supportedExtensions ?? [];
      if (extensions.length) {
        const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
        if (!extensions.map(value => String(value).toLowerCase()).includes(extension)) {
          return { valid: false, message: 'This file type is not allowed.' };
        }
      }
      if (config.maxValue && file.size > Number(config.maxValue) * 1024) {
        return { valid: false, message: 'This file is larger than the allowed size.' };
      }
      return { valid: true };
    },

    async upload(file, options = {}) {
      const client = requireSupabase();
      const appUser = await resolveCurrentAppUser();
      const path = `${appUser.gymId}/${appUser.userId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { data, error } = await client.storage.from('repcount-files').upload(path, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });
      if (error) throw error;
      options.onProgress?.(100);
      return { success: true, data: mapStorageResult(data.path ?? path, file) };
    },

    toCreateFormat(value) { return value ?? []; },
    toUpdateFormat(value) { return value ?? []; },
  },
};

// A demo build never reads, authenticates against or mutates the production Supabase project.
export const sdk = isDemoMode ? createDemoSdk() : liveSdk;
