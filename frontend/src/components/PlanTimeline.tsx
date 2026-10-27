import { useState } from "react";
import { router } from "expo-router";
import { View } from "react-native";
import { AppText } from "./AppText";
import { Button } from "./Button";
import { TextField } from "./TextField";
import { Choices } from "./Choices";
import { FormStatus } from "./FormStatus";
import { LocalStatus,Section } from "./Workspace";
import { Lesson,SavedPlan } from "@/types/planning";
import { savePlanLessons } from "@/services/scheduleService";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { colors } from "@/theme";
const statuses=[{value:"planned",label:"Planned"},{value:"completed",label:"Completed"},{value:"partial",label:"Partially completed"},{value:"postponed",label:"Postponed"}];
export function PlanTimeline({plan}:{plan:SavedPlan}){
  const [lessons,setLessons]=useState(plan.lessons);const [saved,setSaved]=useState(plan.lessons);
  const [editing,setEditing]=useState<number|null>(null);const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");const [message,setMessage]=useState("");
  const dirty=JSON.stringify(lessons)!==JSON.stringify(saved);useUnsavedChanges(dirty);
  function update(index:number,patch:Partial<Lesson>){setLessons(old=>old.map((lesson,i)=>i===index?{...lesson,...patch}:lesson));setMessage("");}
  function move(index:number,direction:number){setLessons(old=>{const next=[...old];const other=index+direction;[next[index],next[other]]=[next[other],next[index]];return next;});setEditing(null);setMessage("");}
  async function save(){setBusy(true);setError("");try{const next=await savePlanLessons(plan.id,lessons);setLessons(next.lessons);setSaved(next.lessons);setEditing(null);setMessage("Lesson timeline and progress saved on this device.");}catch(e){setError(e instanceof Error?e.message:"Could not save lesson changes.");}finally{setBusy(false);}}
  return <View style={{gap:16}}>
    <AppText variant="subheading">Grade {plan.selection.grade} Maths | {plan.selection.date}</AppText>
    <LocalStatus text={`${plan.label==="DEMO/MOCK"?"Local mock-generated plan":"Scheduling engine plan"} · ${lessons.reduce((sum,l)=>sum+l.durationMinutes,0)} minutes · ${lessons.filter(l=>l.status==="completed").length}/${lessons.length} completed`}/>
    <FormStatus message={error||message} error={!!error}/>
    {dirty ? <Button label={busy?"Saving...":"Save lesson changes"} icon="save-outline" disabled={busy} onPress={()=>void save()}/> : null}
    {plan.summary.missing.length ? <Section title="Evidence to collect">{plan.summary.missing.map(note=><AppText variant="small" muted key={note}>{note}</AppText>)}</Section> : null}
    {lessons.map((lesson,index)=>{
      const start=lessons.slice(0,index).reduce((sum,l)=>sum+l.durationMinutes,0);
      const end=start+lesson.durationMinutes;
      const students=lesson.studentIds.map(id=>plan.payload.students.find(s=>s.id===id)?.name).filter(Boolean);
      return <View key={lesson.order} style={{borderTopWidth:1,borderColor:colors.line,paddingTop:14,gap:10}}>
        <AppText variant="small" muted>{index+1} · {start}–{end} min · {statuses.find(s=>s.value===(lesson.status??"planned"))?.label}</AppText>
        {editing===index ? <>
          <TextField label="Activity title" value={lesson.title} onChangeText={title=>update(index,{title})} editable={!busy}/>
          <TextField label="Duration (minutes)" value={Number.isNaN(lesson.durationMinutes)?"":String(lesson.durationMinutes)} onChangeText={value=>update(index,{durationMinutes:value.trim()?Number(value):NaN})} keyboardType="number-pad" editable={!busy}/>
          <TextField label="Learning objective" value={lesson.objective} onChangeText={objective=>update(index,{objective})} multiline editable={!busy}/>
          <TextField label="Activity description (one step per line)" value={lesson.activities.join("\n")} onChangeText={text=>update(index,{activities:text.split("\n")})} multiline editable={!busy} style={{minHeight:100}}/>
          <View style={{flexDirection:"row",flexWrap:"wrap",gap:8}}><Button label="Move earlier" variant="quiet" disabled={busy||index===0} onPress={()=>move(index,-1)}/><Button label="Move later" variant="quiet" disabled={busy||index===lessons.length-1} onPress={()=>move(index,1)}/><Button label="Done editing" variant="quiet" onPress={()=>setEditing(null)}/></View>
        </> : <>
          <AppText variant="subheading">{lesson.title}</AppText><AppText>{lesson.objective}</AppText>
          {lesson.activities.map((activity,i)=><AppText key={i}>{i+1}. {activity}</AppText>)}
          <AppText variant="small" muted>Why this activity</AppText>{lesson.reasons.map(reason=><AppText key={reason} variant="small" muted>{reason}</AppText>)}
          <AppText variant="small" muted>{students.length?`Student group: ${students.join(", ")}`:"No named student group recorded."}</AppText>
          <View style={{flexDirection:"row",flexWrap:"wrap",gap:8}}><Button label="Edit activity" variant="quiet" disabled={busy} onPress={()=>setEditing(index)}/>{lesson.conceptId ? <Button label="Open concept graph" variant="quiet" onPress={()=>router.push({pathname:"/curriculum",params:{grade:String(plan.selection.grade),conceptId:lesson.conceptId,origin:"plan_timeline"}})}/> : null}<Button label="Ask about this recommendation" variant="quiet" onPress={()=>router.push({pathname:"/chatbot",params:{grade:String(plan.selection.grade),prompt:`For Grade ${plan.selection.grade} Maths, explain this lesson activity: ${lesson.title}. Objective: ${lesson.objective}. Planning reasons: ${lesson.reasons.join(" ")}. Suggest a practical way to teach it.`,conceptId:lesson.conceptId??undefined,screenContext:"plan_timeline"}})}/></View>
        </>}
        <Choices values={statuses.map(s=>({...s,disabled:busy}))} selected={[lesson.status??"planned"]} onSelect={status=>update(index,{status:status as Lesson["status"]})}/>
      </View>;
    })}
    <Button label={busy?"Saving...":"Save lesson changes"} icon="save-outline" disabled={busy||!dirty} onPress={()=>void save()}/>
    <LocalStatus text={dirty?"Unsaved lesson changes":"Lesson timeline saved locally"}/>
  </View>;
}
