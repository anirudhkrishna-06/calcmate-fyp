import { Dispatch,SetStateAction,useCallback,useEffect,useRef,useState } from "react";
import { getDatabase } from "@/services/database";
import { requireSession } from "@/services/authService";

// Classroom drafts are scoped locally and intentionally excluded from backups.
export function useWorkspaceDraft<T>(name:string,initial:T,recover?:(value:unknown)=>value is T){
  const [value,setValue]=useState(initial);const [error,setError]=useState("");
  const [key,setKey]=useState<string|null>(null);const edited=useRef(false);
  const update:Dispatch<SetStateAction<T>>=useCallback(next=>{edited.current=true;setValue(next);},[]);
  useEffect(()=>{
    let current=true;
    requireSession().then(async session=>{
      const storageKey=`draft-v1:${session.workspaceId}:${name}`;
      const record=await (await getDatabase()).getFirstAsync<{value:string}>("SELECT value FROM app_meta WHERE key=?",storageKey);
      if(current){if(record&&!edited.current){try{const draft:unknown=JSON.parse(record.value);if(!recover||recover(draft))setValue(draft as T);}catch{/* Retain sensible defaults for malformed drafts. */}}setKey(storageKey);}
    }).catch(e=>{if(current)setError(e instanceof Error?e.message:"Draft could not be reopened.");});
    return ()=>{current=false;};
  },[name,recover]);
  useEffect(()=>{
    if(!key)return;
    // Also flush on unmount, so changing tabs/classes cannot lose recent input.
    const save=()=>{void getDatabase().then(db=>db.runAsync("INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",key,JSON.stringify(value))).catch(()=>setError("Draft could not be saved. Save your classroom records before leaving."));};
    const timer=setTimeout(save,400);
    return ()=>{clearTimeout(timer);save();};
  },[key,value]);
  return {value,setValue:update,error};
}
