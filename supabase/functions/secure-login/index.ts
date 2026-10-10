import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";
import { loginBucketMaterial } from "../_shared/loginThrottle.ts";

const MAX_FAILED_ATTEMPTS=3;
const MAX_BODY_BYTES=4096;

function getKeyFromMap(value:string|undefined):string|null {
 if(!value)return null;
 try {
  const parsed=JSON.parse(value);
  if(parsed&&typeof parsed==="object"){
   if(typeof parsed.default==="string")return parsed.default;
   const first=Object.values(parsed).find((v)=>typeof v==="string");
   if(typeof first==="string")return first;
  }
 } catch { return value; }
 return null;
}
function isAllowedOrigin(origin:string):boolean {
 const extras=(Deno.env.get("APP_ALLOWED_ORIGINS")??"").split(",").map(x=>x.trim()).filter(Boolean);
 if(extras.includes(origin))return true;
 try{
  const u=new URL(origin),h=u.hostname.toLowerCase();
  if(u.protocol==="https:"&&(h==="vercel.app"||h.endsWith(".vercel.app")))return true;
  return u.protocol==="http:"&&(h==="localhost"||h==="127.0.0.1")&&["5173","4173"].includes(u.port);
 }catch{return false;}
}
function headers(req:Request):Record<string,string>{
 const origin=req.headers.get("Origin")??"";
 return {"Access-Control-Allow-Origin":origin&&isAllowedOrigin(origin)?origin:"null",
 "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
 "Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Max-Age":"600","Vary":"Origin",
 "Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Pragma":"no-cache",
 "X-Content-Type-Options":"nosniff"};
}
function json(req:Request,status:number,body:Record<string,unknown>):Response {
 return new Response(JSON.stringify(body),{status,headers:headers(req)});
}
function rows<T>(v:unknown):T[]{return Array.isArray(v)?v as T[]:v&&typeof v==="object"?[v as T]:[];}
async function makeBucketHash(secret:string,req:Request,email:string):Promise<string>{
 const ip=req.headers.get("cf-connecting-ip")?.trim()||req.headers.get("x-real-ip")?.trim()||
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown-ip";
 // Client-supplied browser IDs, Origin and User-Agent are never a security boundary.
 const material=new TextEncoder().encode(loginBucketMaterial(email,ip));
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const bytes=new Uint8Array(await crypto.subtle.sign("HMAC",key,material));
 return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}
function lockRow(data:unknown):{is_locked?:boolean;attempts?:number;locked_until?:string|null}|null{
 return rows<{is_locked?:boolean;attempts?:number;locked_until?:string|null}>(data)[0]??null;
}
function unavailable(req:Request){return json(req,503,{code:"LOGIN_SECURITY_UNAVAILABLE",message:"Secure sign-in is temporarily unavailable. Please try again later."});}

Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("Origin");
 if(origin&&!isAllowedOrigin(origin))return json(req,403,{code:"ORIGIN_NOT_ALLOWED",message:"This sign-in origin is not allowed."});
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:headers(req)});
 if(req.method!=="POST")return json(req,405,{code:"METHOD_NOT_ALLOWED",message:"Use POST to sign in."});
 const contentLength=Number(req.headers.get("content-length")??"0");
 if(Number.isFinite(contentLength)&&contentLength>MAX_BODY_BYTES)return json(req,413,{code:"REQUEST_TOO_LARGE",message:"The sign-in request is too large."});
 let body:Record<string,unknown>;
 try{body=await req.json();}catch{return json(req,400,{code:"INVALID_REQUEST",message:"Invalid sign-in request."});}
 const email=typeof body.email==="string"?body.email.trim().toLowerCase():"";
 const password=typeof body.password==="string"?body.password:"";
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||password.length<1||password.length>1024){
  return json(req,400,{code:"INVALID_REQUEST",message:"Enter a valid email address and password."});
 }
 const url=Deno.env.get("SUPABASE_URL");
 const publishable=getKeyFromMap(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"))??Deno.env.get("SUPABASE_ANON_KEY");
 const secret=getKeyFromMap(Deno.env.get("SUPABASE_SECRET_KEYS"))??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!publishable||!secret)return unavailable(req);
 const auth=createClient(url,publishable,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 try{
  const bucket=await makeBucketHash(secret,req,email);
  const {data:lockData,error:lockError}=await admin.rpc("login_lock_status",{p_bucket_hash:bucket});
  if(lockError)return unavailable(req);
  const current=lockRow(lockData);
  if(current?.is_locked&&current.locked_until)return json(req,429,{code:"LOGIN_LOCKED",
    message:"Too many failed sign-in attempts. Sign-in is blocked for this account and network for 24 hours.",lockedUntil:current.locked_until,attemptsRemaining:0});
  const {data:authData,error:authError}=await auth.auth.signInWithPassword({email,password});
  if(authError||!authData.user||!authData.session){
   const status=Number((authError as {status?:number}|null)?.status??0);
   if(authError&&status!==400&&status!==401)return unavailable(req);
   const {data:failureData,error:failureError}=await admin.rpc("login_record_failure",{p_bucket_hash:bucket});
   if(failureError)return unavailable(req);
   const failure=lockRow(failureData),attempts=Number(failure?.attempts??MAX_FAILED_ATTEMPTS),until=failure?.locked_until??null;
   if(until)return json(req,429,{code:"LOGIN_LOCKED",message:"Too many failed sign-in attempts. This browser is locked for 24 hours.",lockedUntil:until,attemptsRemaining:0});
   return json(req,401,{code:"INVALID_CREDENTIALS",message:"Invalid email or password.",attemptsRemaining:Math.max(0,MAX_FAILED_ATTEMPTS-attempts)});
  }
  const {data:membership,error:membershipError}=await admin.from("gym_users").select("user_id, role, status")
   .eq("user_id",authData.user.id).eq("status","active").maybeSingle();
  if(membershipError){await auth.auth.signOut().catch(()=>undefined);return unavailable(req);}
  if(!membership){
   await admin.rpc("login_clear_failures",{p_bucket_hash:bucket});
   await auth.auth.signOut().catch(()=>undefined);
   return json(req,403,{code:"ACCOUNT_NOT_ASSIGNED",message:"This account does not have active RepCount access. Contact the workspace administrator."});
  }
  const {error:clearError}=await admin.rpc("login_clear_failures",{p_bucket_hash:bucket});
  if(clearError){await auth.auth.signOut().catch(()=>undefined);return unavailable(req);}
  // Never log this response: the browser needs these tokens to persist the verified Auth session.
  return json(req,200,{session:{access_token:authData.session.access_token,refresh_token:authData.session.refresh_token}});
 }catch(error){
  console.error("[secure-login] Request failed:",error instanceof Error?error.name:"UnknownError");
  return unavailable(req);
 }
});
