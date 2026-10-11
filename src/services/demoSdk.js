import { nextRenewalDate, parseDay, todayKey, renewalStatus, renewalStats } from './renewalLogic.js';

// DEMONSTRATION ONLY: this adapter never authenticates against Supabase.
// The fixed password is intentionally public; this mode must never access real records.
// All customer-facing sample data is held in this visitor's browser.
export const DEMO_LOGIN = Object.freeze({ email: 'admin@gmail.com', password: 'admin@123' });
const SESSION_KEY = 'repcount.demo.session.v1';
const DATA_KEY = 'repcount.demo.data.v2';
const DEMO_USER = Object.freeze({
  id: 'demo-admin', Id: 'demo-admin', userId: 'demo-admin',
  gymId: 'demo-gym', profile: 'Admin_c',
  firstName: 'Demo', lastName: 'Administrator',
  emailAddress: DEMO_LOGIN.email,
});

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}
function seed() {
  const plans = [
    { Id:'plan-basic',Name:'Monthly Fitness',duration_c:'1 month',price_c:1299,description_c:'Gym access and cardio equipment',active_c:true },
    { Id:'plan-pro',Name:'Quarterly Strength',duration_c:'3 months',price_c:3499,description_c:'Strength training and equipment access',active_c:true },
    { Id:'plan-premium',Name:'Annual Unlimited',duration_c:'12 months',price_c:11999,description_c:'Full-year gym access',active_c:true },
  ];
  const members = [
    {Id:'member-1',Name:'Arjun Sharma',phone_c:'9876500011',email_c:'arjun@example.com',plan_c:'plan-pro',join_date_c:dateOffset(-90),due_date_c:dateOffset(0),status_c:'Due soon',notes_c:''},
    {Id:'member-2',Name:'Priya Mehta',phone_c:'9876500022',email_c:'priya@example.com',plan_c:'plan-basic',join_date_c:dateOffset(-60),due_date_c:dateOffset(7),status_c:'Active',notes_c:''},
    {Id:'member-3',Name:'Rahul Nair',phone_c:'9876500033',email_c:'rahul@example.com',plan_c:'plan-premium',join_date_c:dateOffset(-130),due_date_c:dateOffset(235),status_c:'Active',notes_c:''},
    {Id:'member-4',Name:'Sneha Patel',phone_c:'9876500044',email_c:'sneha@example.com',plan_c:'plan-basic',join_date_c:dateOffset(-45),due_date_c:dateOffset(-3),status_c:'Overdue',notes_c:''},
    {Id:'member-5',Name:'Vikram Singh',phone_c:'9876500055',email_c:'vikram@example.com',plan_c:'plan-pro',join_date_c:dateOffset(-30),due_date_c:dateOffset(12),status_c:'Active',notes_c:''},
  ];
  // Memberships are normally paid upfront. An expired renewal is NOT an unpaid fee.
  // Legacy fee-cycle data starts empty; it remains available for exceptional credit cases.
  const dues = [];
  const payments = [
    {Id:'payment-1',Name:'REN-001',member_c:'member-1',due_c:null,amount_c:3499,paid_on_c:dateOffset(-90),method_c:'UPI',status_c:'Paid',notes_c:'Membership renewal: Quarterly Strength'},
    {Id:'payment-2',Name:'REN-002',member_c:'member-2',due_c:null,amount_c:1299,paid_on_c:dateOffset(-23),method_c:'Cash',status_c:'Paid',notes_c:'Membership renewal: Monthly Fitness'},
    {Id:'payment-3',Name:'REN-003',member_c:'member-3',due_c:null,amount_c:11999,paid_on_c:dateOffset(-130),method_c:'Card',status_c:'Paid',notes_c:'Membership renewal: Annual Unlimited'},
    {Id:'payment-4',Name:'REN-004',member_c:'member-5',due_c:null,amount_c:3499,paid_on_c:dateOffset(-78),method_c:'UPI',status_c:'Paid',notes_c:'Membership renewal: Quarterly Strength'},
  ];
  const renewals = [
    {id:'renewal-1',request_id:'seed-1',member_id:'member-1',plan_id:'plan-pro',payment_id:'payment-1',paid_on:dateOffset(-90),started_on:dateOffset(-90),next_renewal_on:dateOffset(0),amount:3499,created_at:dateOffset(-90)},
    {id:'renewal-2',request_id:'seed-2',member_id:'member-2',plan_id:'plan-basic',payment_id:'payment-2',paid_on:dateOffset(-23),started_on:dateOffset(-23),next_renewal_on:dateOffset(7),amount:1299,created_at:dateOffset(-23)},
    {id:'renewal-3',request_id:'seed-3',member_id:'member-3',plan_id:'plan-premium',payment_id:'payment-3',paid_on:dateOffset(-130),started_on:dateOffset(-130),next_renewal_on:dateOffset(235),amount:11999,created_at:dateOffset(-130)},
    {id:'renewal-4',request_id:'seed-4',member_id:'member-5',plan_id:'plan-pro',payment_id:'payment-4',paid_on:dateOffset(-78),started_on:dateOffset(-78),next_renewal_on:dateOffset(12),amount:3499,created_at:dateOffset(-78)},
  ];
  return {
    plans_c:plans, gym_members_c:members, membership_dues_c:dues, payments_c:payments, renewals,
    users:[
      {id:'demo-admin',userId:'demo-admin',name:'Demo Administrator',email:DEMO_LOGIN.email,profile:{name:'Admin_c'},status:'active',createdOn:dateOffset(-90)},
      {id:'demo-manager',userId:'demo-manager',name:'Neha Manager',email:'neha.demo@example.com',profile:{name:'Manager_c'},status:'active',createdOn:dateOffset(-45)},
      {id:'demo-staff',userId:'demo-staff',name:'Karan Staff',email:'karan.demo@example.com',profile:{name:'Staff_c'},status:'active',createdOn:dateOffset(-20)},
    ],
  };
}
let fallback = null;
function load() {
  if (fallback) return fallback;
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if(raw) {
      const data = JSON.parse(raw);
      if(data && ['plans_c','gym_members_c','membership_dues_c','payments_c','renewals','users'].every(k=>Array.isArray(data[k]))) return (fallback = data);
    }
  } catch { /* disabled storage: keep the in-memory demo */ }
  return (fallback ??= seed());
}
function save(data) {
  fallback = data;
  try { localStorage.setItem(DATA_KEY,JSON.stringify(data)); } catch { /* optional persistence */ }
}
function reset() {
  fallback = null;
  try { localStorage.removeItem(DATA_KEY); } catch { /* optional persistence */ }
  return load();
}
function authenticated() {
  try { return sessionStorage.getItem(SESSION_KEY) === 'yes'; } catch { return Boolean(fallback?.loggedIn); }
}
function setAuthenticated(value) {
  if(fallback) fallback.loggedIn = value;
  try { if(value) sessionStorage.setItem(SESSION_KEY,'yes'); else sessionStorage.removeItem(SESSION_KEY); } catch { /* in-memory fallback */ }
}
const relationTypes = {
  gym_members_c:{plan_c:'plans_c'},
  membership_dues_c:{member_c:'gym_members_c',plan_c:'plans_c'},
  payments_c:{member_c:'gym_members_c',due_c:'membership_dues_c'},
};
function resolve(row, field, table, db, depth=0) {
  if(!row || depth>3) return undefined;
  const [first,...rest] = String(field).split('.');
  const key = first === 'id' ? 'Id' : first === 'name' ? 'Name' : first;
  let value = row[key];
  const lookup = relationTypes[table]?.[key];
  if(lookup && typeof value==='string') value=db[lookup].find(r=>String(r.Id)===String(value));
  if(rest.length) return resolve(value,rest.join('.'),lookup??table,db,depth+1);
  return value;
}
function projected(row,table,db) {
  const output={...row};
  for(const [field,rel] of Object.entries(relationTypes[table]??{})) {
    const ref=row[field];
    output[field]=ref ? (db[rel].find(x=>String(x.Id)===String(ref)) ?? null) : null;
    if(output[field]) output[field]=projected(output[field],rel,db);
  }
  return output;
}
function passes(row,cond,table,db) {
  if(!cond) return true;
  if(cond.op==='and') return (cond.clauses??[]).every(x=>passes(row,x,table,db));
  if(cond.op==='or') return (cond.clauses??[]).some(x=>passes(row,x,table,db));
  if(cond.op==='not') return !passes(row,cond.clause,table,db);
  const actual=resolve(row,cond.field,table,db);
  const a=typeof actual==='object'?actual?.Id:actual;
  const b=cond.value;
  switch(cond.op) {
    case 'eq': return String(a??'')===String(b??'');
    case 'neq': return String(a??'')!==String(b??'');
    case 'gt': return a>b;
    case 'gte': return a>=b;
    case 'lt': return a<b;
    case 'lte': return a<=b;
    case 'between': return a>=cond.lower&&a<=cond.upper;
    case 'ilike': {
      const fragment=String(b??'').replace(/%/g,'').replace(/\\,/g,',').toLowerCase();
      const candidate=String(a??'').toLowerCase();
      const pattern=String(b??'');
      return pattern.startsWith('%')&&pattern.endsWith('%')?candidate.includes(fragment):
        pattern.endsWith('%')?candidate.startsWith(fragment):pattern.startsWith('%')?candidate.endsWith(fragment):candidate===fragment;
    }
    case 'is': return b===null?a==null:String(a)===String(b);
    case 'not.is': return b===null?a!=null:String(a)!==String(b);
    case 'in': return (b??[]).some(x=>String(x)===String(a));
    default:return true;
  }
}
function recalc(db) {
  for(const due of db.membership_dues_c) {
    const paid=db.payments_c.filter(p=>p.due_c===due.Id&&p.status_c==='Paid')
      .reduce((sum,p)=>sum+Number(p.amount_c||0),0);
    due.amount_paid_c=paid;
    due.balance_c=Math.max(0,Number(due.amount_due_c)-paid);
    due.status_c=due.status_c==='Waived'?'Waived':due.balance_c===0?'Paid':paid>0?'Partially paid':'Unpaid';
  }
}
function validate(table,row,db,existingId=null) {
  if(!String(row.Name??'').trim()) throw new Error('Name is required.');
  if(table==='plans_c'&&!(Number(row.price_c)>0)) throw new Error('Plan price must be greater than zero.');
  if(table==='gym_members_c'&&!String(row.phone_c??'').trim()) throw new Error('Member phone is required.');
  if(table==='membership_dues_c') {
    if(!db.gym_members_c.some(m=>m.Id===row.member_c)) throw new Error('Choose a valid gym member.');
    if(!(Number(row.amount_due_c)>0)) throw new Error('Amount due must be greater than zero.');
    if(!row.due_date_c) throw new Error('Choose a due date.');
  }
  if(table==='payments_c') {
    if(!db.gym_members_c.some(m=>m.Id===row.member_c)) throw new Error('Choose a valid gym member.');
    if(!(Number(row.amount_c)>0)) throw new Error('Payment amount must be greater than zero.');
    if(row.due_c) {
      const due=db.membership_dues_c.find(d=>d.Id===row.due_c);
      if(!due||due.member_c!==row.member_c) throw new Error('Payment and fee cycle must belong to the same member.');
      const otherPaid=db.payments_c.filter(p=>p.Id!==existingId&&p.due_c===due.Id&&p.status_c==='Paid').reduce((v,p)=>v+Number(p.amount_c),0);
      if(row.status_c==='Paid'&&otherPaid+Number(row.amount_c)>Number(due.amount_due_c)) throw new Error('Payment exceeds the fee cycle balance.');
    }
  }
}
class DemoQuery {
  constructor(table) {
    if(!['plans_c','gym_members_c','membership_dues_c','payments_c'].includes(table)) throw new Error('Unknown demo table.');
    this.table=table;this.conditions=[];this.orders=[];this.offset=0;this.count=100;
    this.aggregateSpecs=null;
  }
  select(fields) {this.fields=fields;return this;}
  where(cond) {this.conditions.push(cond);return this;}
  orderBy(field) {this.orders.push([field,true]);return this;}
  orderByDesc(field) {this.orders.push([field,false]);return this;}
  page(n,size) {this.count=Math.max(1,Number(size)||25);this.offset=(Math.max(1,Number(n)||1)-1)*this.count;return this;}
  limit(n,offset=0) {this.count=Math.max(1,Number(n)||1);this.offset=Math.max(0,Number(offset)||0);return this;}
  aggregate(specs) {this.aggregateSpecs=specs;return this;}
  async fetch() {
    if(!authenticated()) return {success:false,data:[],total:0,hasMore:false,message:'Sign in to the demo first.'};
    const db=load(),rows=db[this.table].filter(r=>this.conditions.every(c=>passes(r,c,this.table,db)));
    for(const [field,ascending] of this.orders.slice().reverse()) rows.sort((a,b)=>{
      const x=resolve(a,field,this.table,db),y=resolve(b,field,this.table,db);
      return (ascending?1:-1)*(typeof x==='number'&&typeof y==='number'?x-y:String(x??'').localeCompare(String(y??'')));
    });
    if(this.aggregateSpecs) {
      return {success:true,data:[],total:0,hasMore:false,aggregators:this.aggregateSpecs.map(spec=>{
        const fx=spec.fields?.[0]??{field:'Id',fn:'Count'};
        const subset=spec.where?rows.filter(row=>passes(row,spec.where,this.table,db)):rows;
        const value=fx.fn==='Count'?subset.length:subset.reduce((sum,row)=>sum+Number(resolve(row,fx.field,this.table,db)||0),0);
        return {id:spec.id,data:{count:value},count:value};
      })};
    }
    const page=rows.slice(this.offset,this.offset+this.count);
    return {success:true,data:page.map(r=>projected(r,this.table,db)),total:rows.length,hasMore:this.offset+page.length<rows.length};
  }
  async get(id) {
    if(!authenticated()) return {success:false,data:null,message:'Sign in to the demo first.'};
    const db=load(),record=db[this.table].find(r=>String(r.Id)===String(id));
    return {success:true,data:record?projected(record,this.table,db):null};
  }
  async create(record) {
    try {
      if(!authenticated()) throw new Error('Sign in to the demo first.');
      const db=load(),row={...record,Id:crypto.randomUUID()};
      if(this.table==='membership_dues_c'){row.amount_paid_c=0;row.balance_c=Number(row.amount_due_c);row.status_c='Unpaid';}
      if(this.table==='payments_c'&&!row.status_c)row.status_c='Paid';
      validate(this.table,row,db);
      db[this.table].push(row);
      if(this.table==='payments_c'||this.table==='membership_dues_c')recalc(db);
      save(db);
      return {success:true,data:[projected(row,this.table,db)],messages:[]};
    }catch(e){return {success:false,data:[],messages:[e.message],message:e.message};}
  }
  async update(record) {
    try {
      if(!authenticated()) throw new Error('Sign in to the demo first.');
      const db=load(),row=db[this.table].find(r=>String(r.Id)===String(record.Id??record.id));
      if(!row)throw new Error('This record does not exist.');
      const old={...row};
      const update={...record};delete update.Id;delete update.id;
      Object.assign(row,update);
      for(const [k,rel] of Object.entries(relationTypes[this.table]??{})){
        if(row[k]&&typeof row[k]==='object') row[k]=row[k].Id??row[k].id;
      }
      try {validate(this.table,row,db,old.Id);}catch(e){Object.assign(row,old);throw e;}
      if(this.table==='payments_c'||this.table==='membership_dues_c')recalc(db);
      save(db);
      return {success:true,data:[projected(row,this.table,db)],messages:[]};
    }catch(e){return {success:false,data:[],messages:[e.message],message:e.message};}
  }
  async remove(id) {
    try {
      if(!authenticated()) throw new Error('Sign in to the demo first.');
      const db=load(),rows=db[this.table],i=rows.findIndex(r=>String(r.Id)===String(id));
      if(i<0)throw new Error('Record not found.');
      if(this.table==='plans_c'&&(db.gym_members_c.some(m=>m.plan_c===id)||db.membership_dues_c.some(d=>d.plan_c===id)))throw new Error('Unassign this plan from members and fee cycles before deleting it.');
      if(this.table==='gym_members_c'&&(db.membership_dues_c.some(d=>d.member_c===id)||db.payments_c.some(p=>p.member_c===id)))throw new Error('Remove the member’s fee cycles and payments first.');
      if(this.table==='membership_dues_c'&&db.payments_c.some(p=>p.due_c===id))throw new Error('Remove linked payments before deleting this fee cycle.');
      const [row]=rows.splice(i,1);
      if(this.table==='payments_c')recalc(db);
      save(db);return {success:true,data:[{Id:row.Id}],messages:[]};
    }catch(e){return {success:false,data:[],messages:[e.message],message:e.message};}
  }
}
export function createDemoSdk() {
  function ensureLogin(){if(!authenticated())throw new Error('Sign in to the demo first.');}
  const renewals = {
    async list(limit = 100) {
      ensureLogin();
      return load().renewals.slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0,Math.min(500,Math.max(1,Number(limit)||100)));
    },
    async record({ memberId, planId, paidOn, method = 'UPI', requestId }) {
      ensureLogin();
      const db = load();
      const req = requestId || crypto.randomUUID();
      const duplicate = db.renewals.find(r=>r.request_id===req);
      if(duplicate) return {id:duplicate.id,paymentId:duplicate.payment_id,startDate:duplicate.started_on,nextRenewalDate:duplicate.next_renewal_on,alreadyRecorded:true};
      const member = db.gym_members_c.find(m=>m.Id===memberId);
      const plan = db.plans_c.find(p=>p.Id===planId && p.active_c);
      if(!member || !plan) throw new Error('Select an existing member and active plan.');
      if(!parseDay(paidOn) || paidOn>todayKey() || paidOn<dateOffset(-365)) throw new Error('Choose a valid payment date within the last year.');
      if(!['Cash','UPI','Card','Bank transfer'].includes(method)) throw new Error('Choose a valid payment method.');
      const {start,next} = nextRenewalDate({currentRenewalDate:member.due_date_c,paidOn,duration:plan.duration_c});
      const id=crypto.randomUUID(),paymentId=crypto.randomUUID();
      const payment={Id:paymentId,Name:'REN-'+crypto.randomUUID().replace(/-/g,''),member_c:memberId,due_c:null,amount_c:Number(plan.price_c),paid_on_c:paidOn,method_c:method,status_c:'Paid',notes_c:'Membership renewal: '+plan.Name};
      validate('payments_c',payment,db);
      db.payments_c.push(payment);
      member.plan_c=planId;
      member.due_date_c=next;
      member.status_c='Active';
      db.renewals.push({id,request_id:req,member_id:memberId,plan_id:planId,payment_id:paymentId,paid_on:paidOn,started_on:start,next_renewal_on:next,amount:Number(plan.price_c),created_at:new Date().toISOString()});
      save(db);
      return {id,paymentId,startDate:start,nextRenewalDate:next,alreadyRecorded:false};
    },
  };
  const teams={
    async getMembers(start=0,limit=100) {ensureLogin();const rows=load().users;return {data:rows.slice(start,start+limit),total:rows.length,hasMore:start+limit<rows.length};},
    async createMember({email,firstName='',lastName='',profileName='Staff_c'}) {
      ensureLogin();
      const db=load(),normalized=String(email).toLowerCase().trim();
      if(db.users.some(u=>u.email===normalized))throw new Error('That demo email is already listed.');
      const row={id:crypto.randomUUID(),userId:crypto.randomUUID(),name:[firstName,lastName].filter(Boolean).join(' ')||normalized,email:normalized,profile:{name:profileName},status:'active',createdOn:dateOffset(0)};
      row.userId=row.id;db.users.push(row);save(db);return row;
    },
    async updateMemberProfile(id,{profile}){ensureLogin();const db=load(),u=db.users.find(r=>r.id===id);if(!u)throw new Error('User not found.');if(u.id==='demo-admin')throw new Error('Cannot change the demo Admin role.');u.profile={name:profile};save(db);return {ok:true};},
    async deleteMember(id){ensureLogin();if(id==='demo-admin')throw new Error('Cannot remove the demo Admin.');const db=load();db.users=db.users.filter(u=>u.id!==id);save(db);return {ok:true};},
  };
  return {
    isDemo:true,isConfigured:true,isSupabase:false,
    demo:{reset,credentials:DEMO_LOGIN},
    session:{
      initFailed:false,configurationError:null,user:()=>authenticated()?DEMO_USER:null,
      getUser:async()=>authenticated()?DEMO_USER:null,
      async login({email,password}) {
        if(String(email).trim().toLowerCase()!==DEMO_LOGIN.email||password!==DEMO_LOGIN.password)return {ok:false,error:{message:'Invalid demo email or password.'}};
        setAuthenticated(true);load();return {ok:true,value:DEMO_USER};
      },
      subscribe:()=>()=>{},
      async logout(){setAuthenticated(false);},
      async sendResetLink(){return {ok:false,error:{message:'Password recovery is not used in the demo. Sign in with the published demo credentials.'}};},
      async resetPassword(){return {ok:false,error:{message:'Demo passwords cannot be changed.'}};},
    },
    table:name=>new DemoQuery(name),
    directory: {
      async list({search='',state='all',page=1,pageSize=25}={}) {
        ensureLogin();
        const db=load(),today=todayKey();
        const query=String(search).trim().toLowerCase();
        const filtered=db.gym_members_c.filter(m=>{
          const current=renewalStatus(m,today);
          return (state==='all'||current===state||(state==='soon'&&current==='today'))
            && (!query || [m.Name,m.phone_c,m.email_c].some(f=>String(f??'').toLowerCase().includes(query)));
        }).sort((a,b)=>String(a.due_date_c??'9999').localeCompare(String(b.due_date_c??'9999'))||String(a.Name).localeCompare(String(b.Name))||String(a.Id).localeCompare(String(b.Id)));
        const size=Math.min(100,Math.max(1,Number(pageSize)||25));
        const currentPage=Math.max(1,Number(page)||1);
        const from=(currentPage-1)*size;
        return {
          rows:filtered.slice(from,from+size).map(m=>({...projected(m,'gym_members_c',db),renewalState:renewalStatus(m,today)})),
          stats:renewalStats(db.gym_members_c,today),total:filtered.length,
          hasMore:from+size<filtered.length,
        };
      },
      async search(term,pageSize=25) {return this.list({search:term,page:1,pageSize});},
    },
    ledger: {
      async list({kind,search='',status='All',period='all',page=1,pageSize=25}={}) {
        ensureLogin();
        if(!['payments','dues'].includes(kind)) throw new Error('Invalid ledger type');
        const db=load(),table=kind==='payments'?'payments_c':'membership_dues_c';
        const q=String(search).trim().toLowerCase(),today=todayKey();
        const date=new Date(today+'T12:00:00');
        date.setDate(date.getDate()+((7-(date.getDay()||7))%7));
        const weekEnd=todayKey(date);
        const filtered=db[table].filter(row=>{
          const member=db.gym_members_c.find(m=>m.Id===row.member_c);
          const matches=!q||[row.Name,row.method_c,member?.Name,member?.phone_c].some(v=>String(v??'').toLowerCase().includes(q));
          if(!matches)return false;
          if(kind==='payments')return (status==='All'||row.status_c===status)&&(period==='all'||row.paid_on_c===today);
          return Number(row.balance_c)>0&&row.status_c!=='Waived'&&
            (period==='all'||period==='today'&&row.due_date_c===today||
              period==='overdue'&&row.due_date_c<today||
              period==='week'&&row.due_date_c>today&&row.due_date_c<=weekEnd);
        }).sort((a,b)=>{
          const dateKey=kind==='payments'?'paid_on_c':'due_date_c',direction=kind==='payments'?-1:1;
          return direction*String(a[dateKey]??'').localeCompare(String(b[dateKey]??''))||String(a.Id).localeCompare(String(b.Id));
        });
        const size=Math.min(100,Math.max(1,Number(pageSize)||25)),offset=(Math.max(1,Number(page)||1)-1)*size;
        return {rows:filtered.slice(offset,offset+size).map(row=>projected(row,table,db)),
          total:filtered.length,hasMore:offset+size<filtered.length};
      },
    },
    renewals,
    teams,
    admin:{async fetch(entity,options={}){if(entity!=='user')throw new Error('Unsupported entity.');const v=await teams.getMembers(options.pagingInfo?.offset??0,options.pagingInfo?.limit??100);
      return {data:v.data.map(u=>({Id:u.id,Name:u.name,FirstName:u.name.split(' ')[0],LastName:u.name.split(' ').slice(1).join(' '),Email:u.email,AvatarUrl:''})),total:v.total,hasMore:v.hasMore};}},
    functions:{async invoke(){return {ok:false,error:{message:'External functions are unavailable in demo mode.'}};}},
    async dashboardSummary(today) {
      ensureLogin();const db=load(),dues=db.membership_dues_c,payments=db.payments_c;
      return {
        outstanding:dues.filter(d=>d.status_c!=='Waived').reduce((sum,d)=>sum+Number(d.balance_c||0),0),
        dueTodayBalance:dues.filter(d=>d.due_date_c===today&&d.status_c!=='Waived').reduce((sum,d)=>sum+Number(d.balance_c||0),0),
        collectedToday:payments.filter(p=>p.paid_on_c===today&&p.status_c==='Paid').reduce((sum,p)=>sum+Number(p.amount_c||0),0),
      };
    },
    storage:{
      validate(file,config={}) {
        if(!file)return {valid:false,message:'Choose a file.'};
        if(config.maxValue&&file.size>Number(config.maxValue)*1024)return {valid:false,message:'File too large.'};
        return {valid:true};
      },
      async upload(file,options={}){ensureLogin();options.onProgress?.(100);return {success:true,data:{Id:'demo-file-'+crypto.randomUUID(),Name:file.name,Path:'demo-only/'+file.name,Size:file.size,Type:file.type}};},
      toCreateFormat:v=>v??[],toUpdateFormat:v=>v??[],
    }
  };
}
