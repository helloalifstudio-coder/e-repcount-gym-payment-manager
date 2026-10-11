import { useEffect, useState } from 'react';
import { sdk } from '@/services/sdk';
import { Input } from '@/components/ui/input';

// The picker searches the server and NEVER downloads the whole membership list.
// The selected ID is preserved when the user edits their search text.
export default function MemberPicker({value,onChange,disabled=false,id='member-selector'}) {
  const [search,setSearch]=useState('');
  const [query,setQuery]=useState('');
  const [picked,setPicked]=useState(null);
  const [data,setData]=useState({rows:[],total:0});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    const timer=setTimeout(()=>setQuery(search.trim()),250);
    return ()=>clearTimeout(timer);
  },[search]);
  useEffect(()=>{
    let live=true;
    setLoading(true);
    setError('');
    sdk.directory.search(query,25).then(result=>{
      if(live){setData(result);setLoading(false);}
    }).catch(e=>{
      if(live){setError(e.message||'Could not search members');setLoading(false);}
    });
    return ()=>{live=false;};
  },[query]);
  const choices=data.rows.some(x=>String(x.Id)===String(value))
    ? data.rows
    : picked&&String(picked.Id)===String(value)?[picked,...data.rows]:data.rows;
  function choose(id){
    const member=choices.find(m=>String(m.Id)===String(id))??null;
    setPicked(member);
    onChange(id);
  }
  return <div className="space-y-2">
    <Input aria-label="Find a gym member" placeholder="Type member name, phone or email…" value={search}
      onChange={e=>setSearch(e.target.value)} disabled={disabled} autoComplete="off"/>
    <select id={id} value={value||''} onChange={e=>choose(e.target.value)}
      className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" disabled={disabled||loading} required>
      <option value="">{loading?'Finding members…':'Choose a member'}</option>
      {choices.map(m=><option key={m.Id} value={m.Id}>{m.Name} · {m.phone_c||'No phone'}</option>)}
    </select>
    {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
    {!loading&&!error&&<p className="text-xs text-muted-foreground">
      Showing {data.rows.length} of {data.total.toLocaleString('en-IN')} matches. Type more characters to find any member.
    </p>}
  </div>;
}
