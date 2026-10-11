import { Choices } from "./Choices";
export function GradeSelector({grade,onSelect,disabled=false}:{grade:number;onSelect:(grade:number)=>void;disabled?:boolean}){
  return <Choices values={[1,2,3,4].map(g=>({value:String(g),label:`Grade ${g}`,disabled}))} selected={[String(grade)]} onSelect={value=>onSelect(Number(value))}/>;
}
