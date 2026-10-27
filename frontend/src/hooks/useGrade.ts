import { useEffect,useState,useSyncExternalStore } from "react";
import { currentGrade,initializeGrade,selectGrade,subscribeGrade } from "@/services/gradePreference";
export function useGrade(initial?:number){
  const grade=useSyncExternalStore(subscribeGrade,currentGrade,currentGrade);
  const [error,setError]=useState("");
  useEffect(()=>{initializeGrade().then(()=>{if(initial && [1,2,3,4,5].includes(initial))return selectGrade(initial);}).catch(e=>setError(e instanceof Error ? e.message : "Could not remember this class."));},[initial]);
  function setGrade(value:number){setError("");void selectGrade(value).catch(e=>setError(e instanceof Error ? e.message : "Could not save class selection."));}
  return {grade,setGrade,error};
}
