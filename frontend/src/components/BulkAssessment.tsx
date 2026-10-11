import { useCallback,useEffect,useRef,useState } from "react";
import { Alert,TextInput,View } from "react-native";
import { AppText } from "./AppText";
import { Button } from "./Button";
import { Choices } from "./Choices";
import { DateField } from "./DateField";
import { TextField } from "./TextField";
import { FormStatus } from "./FormStatus";
import { EmptyState,LocalStatus } from "./Workspace";
import { classLearningEvidence } from "@/services/classroomService";
import { saveClassAssessments } from "@/services/storageService";
import { today } from "@/services/database";
import { useLocalData } from "@/hooks/useLocalData";
import { useWorkspaceDraft } from "@/hooks/useWorkspaceDraft";
import { recoverMarksDraft } from "@/services/classroomDrafts";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { colors } from "@/theme";
export function BulkAssessment({grade,onStateChange,onSaveAction}:{grade:number;onStateChange?:(dirty:boolean,busy:boolean,count:number,canSave:boolean)=>void;onSaveAction?:(save:(()=>Promise<void>)|null)=>void}){
  const {value:draft,setValue:setDraft,error:draftError}=useWorkspaceDraft(`marks-${grade}`,{concept:"",date:today(),maximum:"10",marks:{} as Record<string,string>},recoverMarksDraft);
  const {concept,date,maximum,marks}=draft;
  const setConcept=(concept:string)=>setDraft(old=>({...old,concept}));
  const setDate=(date:string)=>setDraft(old=>({...old,date}));
  const setMaximum=(maximum:string)=>setDraft(old=>({...old,maximum}));
  const setMarks=(next:Record<string,string>|((old:Record<string,string>)=>Record<string,string>))=>setDraft(old=>({...old,marks:typeof next==="function"?next(old.marks):next}));
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");const [failed,setFailed]=useState(false);
  const inputs=useRef<Record<string,TextInput|null>>({});
  const loader=useCallback(()=>classLearningEvidence(grade),[grade]);
  const {data,error,loading,reload}=useLocalData(loader);
  const count=Object.values(marks).filter(mark=>mark.trim()!=="").length;
  const selected=concept||data?.concepts[0]?.id||"";
  useUnsavedChanges(count>0);
  const canSave=count>0&&!loading&&!error&&!!selected;
  useEffect(()=>{onStateChange?.(count>0,busy,count,canSave);return ()=>onStateChange?.(false,false,0,false);},[count,busy,canSave,onStateChange]);
  function changeConcept(value:string){
    if(value===selected)return;
    const change=()=>{setMarks({});setConcept(value);setMessage("");};
    if(count)Alert.alert("Change assessment concept?","Entered marks will be cleared. Save them first to keep this assessment.",[{text:"Keep editing",style:"cancel"},{text:"Change concept",style:"destructive",onPress:change}]);else change();
  }
  const save=useCallback(async()=>{
    setBusy(true);setMessage("");
    try{
      const entries=Object.entries(marks).filter(([,mark])=>mark.trim()!=="").map(([studentId,score])=>({studentId,score:Number(score)}));
      await saveClassAssessments({grade,conceptId:selected,date,maximum:Number(maximum),entries});
      setDraft(old=>({...old,marks:{}}));await reload();setMessage(`${entries.length} marks saved on this device. Learning progress updated.`);setFailed(false);
    }catch(e){setMessage(e instanceof Error?e.message:"Marks could not be saved.");setFailed(true);}finally{setBusy(false);}
  },[marks,grade,selected,date,maximum,reload,setDraft]);
  useEffect(()=>{onSaveAction?.(save);return ()=>onSaveAction?.(null);},[onSaveAction,save]);
  return <View style={{gap:12}}>
    <AppText muted>Leave marks blank for students not assessed.</AppText>
    <AppText variant="small" muted>Maths concept</AppText>
    <Choices values={(data?.concepts??[]).map(c=>({value:c.id,label:c.title,disabled:busy}))} selected={[selected]} onSelect={changeConcept}/>
    <View style={{flexDirection:"row",flexWrap:"wrap",gap:12}}><View style={{flex:1,minWidth:150}}><DateField label="Assessment date" value={date} onChange={setDate} maxDate={today()} disabled={busy}/></View><View style={{flex:1,minWidth:100}}><TextField label="Maximum marks" value={maximum} onChangeText={setMaximum} keyboardType="decimal-pad" editable={!busy}/></View></View>
    <FormStatus message={error||draftError||message} error={!!error||!!draftError||failed}/>
    {error ? <Button label="Reload class" variant="quiet" onPress={()=>void reload()}/> : null}
    {loading&&!data ? <AppText muted>Reading class evidence...</AppText> : null}
    {!loading&&!data?.students.length&&!error ? <EmptyState title="No students to assess" detail="Add students to this grade before entering class marks."/> : null}
    <View style={{flexDirection:"row",justifyContent:"space-between",paddingVertical:8,borderBottomWidth:1,borderColor:colors.line}}><AppText variant="small" muted>STUDENT</AppText><AppText variant="small" muted>MARK / {maximum||"—"}</AppText></View>
    {data?.students.map((student,index)=><View key={student.id} style={{flexDirection:"row",alignItems:"center",gap:12,paddingVertical:6,borderBottomWidth:1,borderColor:colors.line}}>
      <View style={{flex:1,minWidth:0}}><AppText>{student.name}</AppText><AppText variant="small" muted>Roll {student.roll}</AppText></View>
      <TextInput ref={input=>{inputs.current[student.id]=input;}} accessibilityLabel={`Marks for ${student.name}`} value={marks[student.id]??""} onChangeText={mark=>setMarks(old=>({...old,[student.id]:mark}))}
        keyboardType="decimal-pad" maxLength={16} placeholder="—" placeholderTextColor={colors.charcoalMuted} editable={!busy} selectTextOnFocus returnKeyType="next" submitBehavior="submit"
        onSubmitEditing={()=>inputs.current[data.students[index+1]?.id]?.focus()}
        style={{width:76,minHeight:48,padding:8,textAlign:"center",fontSize:16,color:colors.charcoal,borderWidth:1,borderColor:marks[student.id]&&(!Number.isFinite(Number(marks[student.id]))||Number(marks[student.id])<0||Number(marks[student.id])>Number(maximum))?colors.danger:colors.line,borderRadius:4,backgroundColor:colors.paper}}/>
    </View>)}
    {!onSaveAction ? <Button label={busy?"Saving marks...":`Save marks (${count} students)`} icon="save-outline" disabled={busy||loading||!!error||!selected||!count} onPress={()=>void save()}/> : null}
    <LocalStatus text={count?`${count} unsaved marks`:"Saved on device"}/>
  </View>;
}
