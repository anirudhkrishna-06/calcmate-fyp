import { useCallback,useEffect,useState } from "react";
import { Alert,Pressable,View,StyleSheet } from "react-native";
import { AppText } from "./AppText";
import { Button } from "./Button";
import { DateField } from "./DateField";
import { FormStatus } from "./FormStatus";
import { EmptyState,LocalStatus } from "./Workspace";
import { useLocalData } from "@/hooks/useLocalData";
import { useWorkspaceDraft } from "@/hooks/useWorkspaceDraft";
import { recoverAttendanceDraft } from "@/services/classroomDrafts";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { attendanceRegister,saveClassAttendance } from "@/services/classroomService";
import { AttendanceRecord,today } from "@/services/database";
import { colors } from "@/theme";
type Status=AttendanceRecord["status"];
export function AttendanceWorkspace({grade,onStateChange,onSaveAction}:{grade:number;onStateChange?:(dirty:boolean,busy:boolean,count:number,canSave:boolean)=>void;onSaveAction?:(save:(()=>Promise<void>)|null)=>void}){
  const {value:draft,setValue:setDraft,error:draftError}=useWorkspaceDraft(`attendance-${grade}`,{date:today(),changes:{} as Record<string,Status>},recoverAttendanceDraft);
  const {date,changes}=draft;
  const setDate=(date:string)=>setDraft(old=>({...old,date}));
  const setChanges=(next:Record<string,Status>|((old:Record<string,Status>)=>Record<string,Status>))=>setDraft(old=>({...old,changes:typeof next==="function"?next(old.changes):next}));
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [failed,setFailed]=useState(false);
  const [undo,setUndo]=useState<Record<string,Status>|null>(null);
  const loader=useCallback(()=>attendanceRegister(grade,date),[grade,date]);
  const {data,error,loading,reload}=useLocalData(loader);
  const dirty=Object.keys(changes).length>0;
  useUnsavedChanges(dirty);
  const count=Object.keys(changes).length;const canSave=dirty&&!loading&&!error;
  useEffect(()=>{onStateChange?.(dirty,busy,count,!!canSave);return ()=>onStateChange?.(false,false,0,false);},[dirty,busy,count,canSave,onStateChange]);
  function changeDate(value:string){
    const apply=()=>{setChanges({});setUndo(null);setMessage("");setDate(value);};
    if(dirty)Alert.alert("Discard unsaved attendance?","Saved records will stay unchanged.",[{text:"Keep editing",style:"cancel"},{text:"Discard",style:"destructive",onPress:apply}]);else apply();
  }
  const save=useCallback(async()=>{
    setBusy(true);setMessage("");
    try{await saveClassAttendance(grade,date,Object.entries(changes).map(([studentId,status])=>({studentId,status})));setDraft(old=>({...old,changes:{}}));setUndo(null);await reload();setMessage("Attendance saved on this device.");setFailed(false);}
    catch(e){setMessage(e instanceof Error?e.message:"Unable to save attendance.");setFailed(true);}finally{setBusy(false);}
  },[grade,date,changes,reload,setDraft]);
  useEffect(()=>{onSaveAction?.(save);return ()=>onSaveAction?.(null);},[onSaveAction,save]);
  function markAll(){
    Alert.alert("Mark all present?","Review exceptions before saving the register.",[{text:"Cancel",style:"cancel"},{text:"Mark all",onPress:()=>{setUndo({...changes});setChanges(Object.fromEntries((data??[]).map(s=>[s.id,"present"])));}}]);
  }
  const recorded=data?.filter(s=>changes[s.id]||s.status).length??0;
  const present=(data??[]).filter(s=>(changes[s.id]??s.status)==="present").length;
  const absent=(data??[]).filter(s=>(changes[s.id]??s.status)==="absent").length;
  const late=(data??[]).filter(s=>(changes[s.id]??s.status)==="late").length;
  return <View style={styles.container}>
    <View style={styles.heading}>
      <View style={{flex:1}}><AppText variant="subheading">Daily register</AppText><AppText variant="small" muted>Make the exception visible, then save once.</AppText></View>
      <View style={styles.dateBadge}><AppText style={styles.dateBadgeText}>{date.slice(5).replace("-"," / ")}</AppText></View>
    </View>
    <DateField label="Attendance date" value={date} onChange={changeDate} maxDate={today()} disabled={busy}/>
    <View style={styles.summary}>
      <View><AppText style={styles.summaryValue}>{present}</AppText><AppText variant="small" muted>Present</AppText></View>
      <View><AppText style={[styles.summaryValue,{color:colors.danger}]}>{absent}</AppText><AppText variant="small" muted>Absent</AppText></View>
      <View><AppText style={[styles.summaryValue,{color:colors.attention}]}>{late}</AppText><AppText variant="small" muted>Late</AppText></View>
      <View style={{marginLeft:"auto"}}><AppText style={styles.summaryValue}>{data?.length??0}</AppText><AppText variant="small" muted>Total</AppText></View>
    </View>
    <View style={{flexDirection:"row",flexWrap:"wrap",alignItems:"center",justifyContent:"space-between",gap:8}}>
      <AppText variant="small" muted>{recorded}/{data?.length??0} marked{dirty?` · ${Object.keys(changes).length} unsaved`:""}</AppText>
      <Button label="Mark all present" variant="quiet" disabled={busy||loading||!!error||!data?.length} onPress={markAll}/>
    </View>
    {undo ? <Button label="Undo mark all" variant="quiet" onPress={()=>{setChanges(undo);setUndo(null);}} disabled={busy}/> : null}
    <FormStatus message={error||draftError||message} error={!!error||!!draftError||failed}/>
    {error ? <Button label="Reload register" variant="quiet" onPress={()=>void reload()}/> : null}
    {loading&&!data ? <AppText muted>Opening register...</AppText> : null}
    {!loading&&!data?.length&&!error ? <EmptyState title="No students in this class" detail="Add students in Classroom."/> : null}
    <AppText variant="small" muted>P = Present · A = Absent · L = Late</AppText>
    {data?.map(student=><View key={student.id} style={styles.studentCard}>
      <View style={{flex:1,minWidth:0}}><AppText>{student.name}</AppText><AppText variant="small" muted>Roll {student.rollNumber}</AppText></View>
      <View style={styles.statusGroup}>{(["present","absent","late"] as Status[]).map(status=>{
        const selected=(changes[student.id]??student.status)===status;
        return <Pressable key={status} accessibilityRole="radio" accessibilityLabel={`${status} for ${student.name}`} accessibilityState={{selected,disabled:busy||loading}} disabled={busy||loading} onPress={()=>setChanges(old=>({...old,[student.id]:status}))} style={[styles.statusButton,selected&&{backgroundColor:status==="absent"?colors.danger:status==="late"?colors.attention:colors.forest,borderColor:"transparent"}]}><AppText style={{color:selected?colors.white:colors.charcoalMuted,fontWeight:"700"}}>{status[0].toUpperCase()}</AppText></Pressable>;
      })}</View>
    </View>)}
    {!onSaveAction ? <Button label={busy?"Saving...":`Save attendance (${Object.keys(changes).length} changes)`} icon="save-outline" disabled={busy||!dirty||loading||!!error} onPress={()=>void save()}/> : null}
    <LocalStatus text={dirty?"Unsaved changes":"Saved on device"}/>
  </View>;
}
const styles=StyleSheet.create({
  container:{gap:12}, heading:{flexDirection:"row",alignItems:"center",gap:12}, dateBadge:{backgroundColor:colors.primarySurface,borderRadius:10,paddingHorizontal:10,paddingVertical:8}, dateBadgeText:{color:colors.primary,fontWeight:"800"},
  summary:{flexDirection:"row",gap:20,padding:14,borderRadius:14,backgroundColor:colors.paperWarm,borderWidth:1,borderColor:colors.lineLight}, summaryValue:{fontSize:20,fontWeight:"800",color:colors.primary},
  studentCard:{padding:10,borderRadius:12,borderWidth:1,borderColor:colors.lineLight,backgroundColor:colors.paper,flexDirection:"row",alignItems:"center",gap:8}, statusGroup:{flexDirection:"row",gap:4}, statusButton:{width:42,minHeight:42,alignItems:"center",justifyContent:"center",borderRadius:9,borderWidth:1,borderColor:colors.line,backgroundColor:colors.paperWarm}
});
