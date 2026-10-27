import { getDatabase } from "./database";
import { Grade } from "@/types/domain";
let grade:Grade=1;
let initialized:Promise<void>|undefined;
const listeners=new Set<()=>void>();
export const currentGrade=()=>grade;
export function subscribeGrade(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};}
export function initializeGrade(){
  initialized??=(async()=>{
    const row=await (await getDatabase()).getFirstAsync<{value:string}>("SELECT value FROM app_meta WHERE key='selected-grade-v1'");
    if(row && [1,2,3,4,5].includes(Number(row.value)))grade=Number(row.value) as Grade;
    listeners.forEach(fn=>fn());
  })().catch(error=>{initialized=undefined;throw error;});
  return initialized;
}
export async function selectGrade(value:number){
  if(![1,2,3,4,5].includes(value))throw new Error("Choose Grade 1 to 5.");
  await (await getDatabase()).runAsync("INSERT INTO app_meta(key,value) VALUES('selected-grade-v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",String(value));
  grade=value as Grade;listeners.forEach(fn=>fn());
}
