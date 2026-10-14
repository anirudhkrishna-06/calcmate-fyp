import { useCallback, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, View } from "react-native";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { DateField } from "@/components/DateField";
import { Section,LocalStatus } from "@/components/Workspace";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { Choices } from "@/components/Choices";
import { FormStatus } from "@/components/FormStatus";
import { StudentEditor } from "@/components/StudentEditor";
import { loadStudents, localRepository, saveAttendance, saveAssessment, removeAssessment, saveCompetency, saveObservation } from "@/services/storageService";
import { today, AttendanceRecord, AssessmentRecord } from "@/services/database";
import { useLocalData } from "@/hooks/useLocalData";
import { getStudentKnowledgeView, stateLabel, sufficiencyLabel, StudentKnowledgeView } from "@/services/learnerStateService";


export default function StudentDetailsScreen() {
  const { id,tab:initialTab } = useLocalSearchParams<{ id:string;tab?:string }>();
  const loader = useCallback(async () => {
    const student = (await loadStudents()).find(s => s.id === id);
    const concepts = await (await localRepository("concepts")).list();
    const attendance = (await (await localRepository("attendance")).list()).filter(a => a.student_id === id);
    const assessments = (await (await localRepository("assessments")).list()).filter(a => a.student_id === id).sort((a,b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
    const competencies = (await (await localRepository("competencies")).list()).filter(c => c.student_id === id);
    const observations = (await (await localRepository("observations")).list()).filter(o => o.student_id === id);
    let knowledgeView: StudentKnowledgeView | null = null;
    if (student) {
      try {
        knowledgeView = await getStudentKnowledgeView(id);
      } catch (err) {
        console.warn("Could not load knowledge view", err);
      }
    }
    return { student,concepts,attendance,assessments,competencies,observations,knowledgeView };
  },[id]);

  const { data,error,loading,reload } = useLocalData(loader);
  const [tab,setTab] = useState(["overview","attendance","assessments","observations"].includes(initialTab??"")?initialTab!:"overview"); const [date,setDate] = useState(today());
  const [status,setStatus] = useState<AttendanceRecord["status"]>("present");
  const [concept,setConcept] = useState(""); const [score,setScore] = useState(""); const [maximum,setMaximum] = useState("10");
  const [assessmentId,setAssessmentId] = useState<string | undefined>(); const [percentage,setPercentage] = useState("");
  const [note,setNote] = useState(""); const [observationId,setObservationId] = useState<string | undefined>();
  const [message,setMessage] = useState(""); const [failed,setFailed] = useState(false); const [busy,setBusy] = useState(false);
  useUnsavedChanges(!busy && (!!note.trim()||!!score.trim()||!!percentage.trim()));
  function confirmRemoval(work:()=>Promise<unknown>){Alert.alert("Remove this record?","The learning and attendance summaries will update after removal.",[{text:"Cancel",style:"cancel"},{text:"Remove",style:"destructive",onPress:()=>void action(work)}]);}
  function changeTab(value:string){const change=()=>{setTab(value);setMessage("");setNote("");setScore("");setPercentage("");setObservationId(undefined);setAssessmentId(undefined);};if(note.trim()||score.trim()||percentage.trim())Alert.alert("Discard unsaved input?","Save this record before changing sections.",[{text:"Keep editing",style:"cancel"},{text:"Discard",style:"destructive",onPress:change}]);else change();}
  async function action(work:()=>Promise<unknown>) {
    setBusy(true); setMessage("");
    try { await work(); await reload(); setMessage("Saved on this device."); setFailed(false); }
    catch(e) { setMessage(e instanceof Error ? e.message : "Record could not be saved."); setFailed(true); }
    finally { setBusy(false); }
  }
  function editAssessment(a: AssessmentRecord) { setTab("assessments"); setAssessmentId(a.id); setConcept(a.concept_id); setDate(a.date); setScore(String(a.score)); setMaximum(String(a.maximum)); }
  function removeStudent() {
    Alert.alert("Delete student?", "Attendance, assessments and observations will also be deleted.", [
      { text:"Cancel",style:"cancel" },
      { text:"Delete",style:"destructive",onPress:() => void action(async () => { await (await localRepository("students")).remove(id); router.replace("/students"); }) }
    ]);
  }
  const student = data?.student;
  const title = (conceptId:string) => data?.concepts.find(c => c.id === conceptId)?.title ?? conceptId;
  const weak = data?.competencies.filter(c => c.mastery < 0.6) ?? [];
  return <Screen topInset={false}><View style={{ gap:14 }}>
    <FormStatus message={error} error />
    {loading && !data ? <AppText>Loading student...</AppText> : null}
    {!loading && !student ? <AppText>Student not found in this workspace.</AppText> : null}
    {student ? <>
      <AppText variant="title">{student.name}</AppText><AppText muted>Grade {student.grade} | Roll {student.rollNumber}</AppText><LocalStatus/>
      <Button label="Edit student" icon="create-outline" variant="quiet" onPress={()=>setTab("edit")} />
      <Choices values={[{value:"overview",label:"Progress"},{value:"attendance",label:"Attendance"},{value:"assessments",label:"Marks"},{value:"observations",label:"Notes"}]} selected={[tab==="competency" ? "assessments" : tab]} onSelect={changeTab} />
      <FormStatus message={message} error={failed} />
      {tab === "overview" ? <>
        <Section title="Learning progress"><AppText>{student.hasEvidence ? (student.needsRevision||student.mastery<0.6) ? "Needs revision: revisit the recorded weak concepts with concrete examples." : student.mastery>=0.8 ? "Secure in recorded concepts. Continue with independent practice." : "Practicing: give guided examples and check reasoning." : "Not assessed yet. Record a short Maths assessment before judging progress."}</AppText></Section>
        <AppText muted>{data?.assessments.length} assessments recorded | Last present: {student.lastSeenLabel}</AppText>

        {data?.knowledgeView ? <Section title="Curriculum Knowledge State">
          <AppText muted>
            {`Assessed: ${data.knowledgeView.assessed_count} · Likely ready: ${data.knowledgeView.likely_ready_count} · Needs revision: ${data.knowledgeView.needs_support_count} · Not assessed: ${data.knowledgeView.unassessed_count}`}
          </AppText>
          <View style={{ gap: 10, marginTop: 6 }}>
            {data.knowledgeView.concepts.map(c => {
              const st = c.state;
              const hasState = st && st.state_status !== "unknown" && st.mastery_estimate !== null;
              return (
                <View key={c.concept_id} style={{ padding: 10, borderRadius: 8, borderWidth: 1, borderColor: c.prerequisite_gap ? "#f59e0b" : "#e2e8f0", backgroundColor: "#fff", gap: 4 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <AppText style={{ fontWeight: "600", flex: 1 }}>{c.concept_id}: {c.concept_title}</AppText>
                    <AppText style={{
                      fontWeight: "700",
                      color: !hasState ? "#64748b" : st.state_status === "likely_ready" ? "#16a34a" : st.state_status === "needs_support" ? "#dc2626" : "#d97706"
                    }}>
                      {hasState ? `${Math.round(st.mastery_estimate! * 100)}%` : "Unknown"}
                    </AppText>
                  </View>
                  <AppText variant="small" muted>
                    {hasState
                      ? `${stateLabel(st.state_status)} · ${sufficiencyLabel(st.evidence_sufficiency)} (${st.evidence_count} mark${st.evidence_count === 1 ? "" : "s"})`
                      : "No assessment recorded (State unknown · Not zero mastery)"}
                  </AppText>
                  {c.prerequisite_gap ? (
                    <AppText variant="small" style={{ color: "#d97706", fontWeight: "600" }}>
                      ⚠️ Prerequisite Gap: Foundational concepts need revision before advancing.
                    </AppText>
                  ) : null}
                </View>
              );
            })}
          </View>
        </Section> : null}

        <AppText variant="subheading">What to revisit</AppText>
        {weak.length ? weak.map(c => <View key={c.id} style={{gap:4}}><AppText>{title(c.concept_id)}: {Math.round(c.mastery*100)}% recorded evidence</AppText><AppText variant="small" muted>Model a concrete example, ask the student to explain it, then record a short check.</AppText><Button label="Teaching ideas" variant="quiet" onPress={()=>router.push({pathname:"/chatbot",params:{grade:String(student.grade),prompt:`Suggest a concrete teaching activity and three practice questions for ${title(c.concept_id)} in Grade ${student.grade} Maths.`}})}/></View>) : <AppText muted>No recorded weak concepts.</AppText>}
        <AppText variant="subheading">Assessment progress</AppText>
        {data?.concepts.filter(c => data.assessments.some(a => a.concept_id === c.id)).map(c => {
          const history = data.assessments.filter(a => a.concept_id === c.id);
          const first = history[history.length-1]; const last = history[0];
          return <AppText key={c.id}>{c.title}: {Math.round(first.score/first.maximum*100)}% to {Math.round(last.score/last.maximum*100)}%</AppText>;
        })}
      </> : null}

      {tab === "edit" ? <>
        <Button label="Back to overview" icon="arrow-back-outline" variant="quiet" onPress={()=>setTab("overview")} />
        <StudentEditor key={student.id} student={student} onSaved={() => { void reload(); setTab("overview"); }} />
        <Button label="Delete student" icon="trash-outline" variant="quiet" disabled={busy} onPress={removeStudent} />
      </> : null}
      {tab === "attendance" ? <>
        <DateField label="Attendance date" value={date} onChange={setDate} maxDate={today()} disabled={busy}/>
        <Choices values={["present","absent","late"].map(s => ({value:s,label:s[0].toUpperCase()+s.slice(1)}))} selected={[status]} onSelect={s => setStatus(s as AttendanceRecord["status"])} />
        <Button label="Save attendance" icon="checkmark-outline" disabled={busy} onPress={() => void action(() => saveAttendance(id,date,status))} />
        {data?.attendance.sort((a,b) => b.date.localeCompare(a.date)).map(a => <View key={a.id} style={{ gap:6, paddingVertical:8 }}>
          <AppText>{a.date} | {a.status}</AppText>
          <Button label="Edit" icon="create-outline" variant="quiet" onPress={() => { setDate(a.date); setStatus(a.status); }} />
          <Button label="Remove" icon="trash-outline" variant="quiet" disabled={busy} onPress={() => confirmRemoval(async () => (await localRepository("attendance")).remove(a.id))} />
        </View>)}
      </> : null}
      {tab === "assessments" || tab === "competency" ? <>
        <AppText variant="subheading">Maths concept</AppText>
        <Choices values={data!.concepts.map(c => ({value:c.id,label:`G${c.grade}: ${c.title}`}))} selected={[concept]} onSelect={setConcept} />
        {tab === "assessments" ? <>
          <Button label="Teacher competency" icon="school-outline" variant="quiet" onPress={()=>setTab("competency")} />
          <DateField label="Assessment date" value={date} onChange={setDate} maxDate={today()} disabled={busy}/>
          <TextField label="Score" value={score} onChangeText={setScore} keyboardType="decimal-pad" />
          <TextField label="Maximum score" value={maximum} onChangeText={setMaximum} keyboardType="decimal-pad" />
          <Button label={assessmentId ? "Update assessment" : "Save assessment"} icon="save-outline" disabled={busy || !concept || !score.trim() || !maximum.trim()} onPress={() => void action(async () => {
            await saveAssessment({ student_id:id,concept_id:concept,date,score:Number(score),maximum:Number(maximum) },assessmentId);
            setAssessmentId(undefined); setScore("");
          })} />
          {assessmentId ? <Button label="Cancel edit" variant="quiet" onPress={() => { setAssessmentId(undefined); setScore(""); }} /> : null}
          <AppText variant="subheading">Assessment history</AppText>
          {data?.assessments.map(a => <View key={a.id} style={{ paddingVertical:10, gap:6 }}>
            <AppText>{title(a.concept_id)} | {a.score}/{a.maximum}</AppText><AppText muted>{a.date}</AppText>
            <View style={{ flexDirection:"row",gap:8 }}>
              <Button label="Edit" icon="create-outline" variant="quiet" onPress={() => editAssessment(a)} />
              <Button label="Remove" icon="trash-outline" variant="quiet" disabled={busy} onPress={() => confirmRemoval(() => removeAssessment(a.id))} />
            </View>
          </View>)}
        </> : <>
          <Button label="Back to assessments" icon="arrow-back-outline" variant="quiet" onPress={()=>setTab("assessments")} />
          <TextField label="Competency (%)" value={percentage} onChangeText={setPercentage} keyboardType="decimal-pad" />
          <Button label="Save competency" icon="save-outline" disabled={busy || !concept || !percentage.trim()} onPress={() => void action(async () => {await saveCompetency(id,concept,Number(percentage));setPercentage("");})} />
          {data?.competencies.map(c => <View key={c.id} style={{ gap:6 }}>
            <AppText>{title(c.concept_id)} | {Math.round(c.mastery*100)}%</AppText>
            <Button label="Edit" icon="create-outline" variant="quiet" onPress={() => { setConcept(c.concept_id); setPercentage(String(Math.round(c.mastery*100))); }} />
            <Button label="Remove" icon="trash-outline" variant="quiet" disabled={busy} onPress={() => confirmRemoval(async () => (await localRepository("competencies")).remove(c.id))} />
          </View>)}
        </>}
      </> : null}
      {tab === "observations" ? <>
        <TextField label="Teacher observation" value={note} onChangeText={setNote} multiline maxLength={2000} />
        <Button label={observationId ? "Update observation" : "Save observation"} icon="save-outline" disabled={busy||!note.trim()} onPress={() => void action(async () => { await saveObservation(id,note,observationId); setNote(""); setObservationId(undefined); })} />
        {observationId ? <Button label="Cancel edit" variant="quiet" onPress={() => { setNote(""); setObservationId(undefined); }} /> : null}
        {data?.observations.map(o => <View key={o.id} style={{ gap:6,paddingVertical:12 }}>
          <AppText>{o.note}</AppText><AppText muted>{o.updated_at.slice(0,10)}</AppText>
          <Button label="Edit" icon="create-outline" variant="quiet" onPress={() => { setNote(o.note); setObservationId(o.id); }} />
          <Button label="Remove" icon="trash-outline" variant="quiet" disabled={busy} onPress={() => confirmRemoval(async () => (await localRepository("observations")).remove(o.id))} />
        </View>)}
      </> : null}
    </> : null}
  </View></Screen>;
}
