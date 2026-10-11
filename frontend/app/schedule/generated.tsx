import { useState } from "react";
import { router,useLocalSearchParams } from "expo-router";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { FormStatus } from "@/components/FormStatus";
import { TextField } from "@/components/TextField";
import { GradeSelector } from "@/components/GradeSelector";
import { DateField } from "@/components/DateField";
import { Section,LocalStatus } from "@/components/Workspace";
import { generateSchedule,readPlanningPayload } from "@/services/scheduleService";
import { summarizePlanning } from "@/services/mockPlanner";
import { today } from "@/services/database";
import { PlanningPayload } from "@/types/planning";
import { useGrade } from "@/hooks/useGrade";
export default function NewPlanScreen(){
  const params=useLocalSearchParams<{grade?:string}>();const {grade,setGrade,error:gradeError}=useGrade(Number(params.grade));
  const [date,setDate]=useState(today());const [minutes,setMinutes]=useState("60");
  const [payload,setPayload]=useState<PlanningPayload|null>(null);
  const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  async function review(){setBusy(true);setError("");try{const value=await readPlanningPayload({grade,subject:"Math",date,availableMinutes:Number(minutes)});summarizePlanning(value);setPayload(value);}catch(e){setError(e instanceof Error?e.message:"Could not read class evidence.");}finally{setBusy(false);}}
  async function generate(){if(!payload)return;setBusy(true);setError("");try{const plan=await generateSchedule(payload);router.replace(`/schedule/${plan.id}`);}catch(e){setError(e instanceof Error?e.message:"Unable to save plan.");}finally{setBusy(false);}}
  const summary=payload?summarizePlanning(payload):null;
  return <Screen topInset={false}><AppText variant="title">{payload?"Review learning needs":"Create lesson plan"}</AppText><LocalStatus text="Local mock planner | Works offline; not a live AI scheduling service"/>
    <FormStatus message={error||gradeError} error/>
    {!payload ? <>
      <GradeSelector grade={grade} onSelect={setGrade} disabled={busy}/>
      <DateField label="Lesson date" value={date} onChange={setDate} disabled={busy}/>
      <TextField label="Available lesson time (minutes)" value={minutes} onChangeText={setMinutes} keyboardType="number-pad" editable={!busy}/>
      <Button label={busy?"Reading evidence...":"Review learning needs"} disabled={busy} onPress={()=>void review()}/>
    </> : summary ? <>
      <AppText variant="subheading">Grade {payload.selection.grade} Maths | {payload.selection.date}</AppText>
      <AppText>{payload.selection.availableMinutes} minutes | {summary.eligible} available students</AppText>
      <Section title="What needs attention">
        {summary.weakConcepts.length?summary.weakConcepts.map(c=><AppText key={c.id}>{c.title}: {c.students} students need revision.</AppText>):<AppText muted>No weak concepts recorded. The plan will include practice and readiness checks.</AppText>}
        {summary.missing.map(note=><AppText key={note} variant="small" muted>{note}</AppText>)}
      </Section>
      <AppText variant="small" muted>{summary.assessmentCount} assessments | {summary.attendanceRecorded} attendance entries. Missing evidence is not treated as poor performance.</AppText>
      <Button label={busy?"Saving plan...":"Generate plan"} icon="calendar-outline" disabled={busy||!summary.eligible} onPress={()=>void generate()}/>
      <Button label="Change class or time" variant="quiet" disabled={busy} onPress={()=>setPayload(null)}/>
    </> : null}
  </Screen>;
}
