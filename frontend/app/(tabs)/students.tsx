import { useCallback,useEffect,useRef,useState } from "react";
import { router,useLocalSearchParams } from "expo-router";
import { Alert,View,ScrollView,Pressable } from "react-native";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { ClassroomSections,classroomSections as sections } from '@/components/ClassroomSections';
import { GradeSelector } from "@/components/GradeSelector";
import { StudentRow } from "@/components/StudentRow";
import { FormStatus } from "@/components/FormStatus";
import { EmptyState } from "@/components/Workspace";
import { AttendanceWorkspace } from "@/components/AttendanceWorkspace";
import { BulkAssessment } from "@/components/BulkAssessment";
import { ClassProgress } from "@/components/ClassProgress";
import { loadStudents } from "@/services/storageService";
import { useLocalData } from "@/hooks/useLocalData";
import { useGrade } from "@/hooks/useGrade";
import { colors } from '@/theme';
export default function ClassroomScreen(){
  const params=useLocalSearchParams<{grade?:string;section?:string}>();
  const {grade,setGrade,error:gradeError}=useGrade(Number(params.grade));
  const [section,setSection]=useState(sections.some(s=>s.value===params.section)?params.section!:"students");
  const sectionRef=useRef(section);
  const [form,setForm]=useState({dirty:false,busy:false,count:0,canSave:false});const formRef=useRef(form);
  const [search,setSearch]=useState("");const [status,setStatus]=useState("all");
  useEffect(()=>{sectionRef.current=section;formRef.current=form;},[section,form]);
  const saveAction=useRef<(()=>Promise<void>)|null>(null);
  const bindSave=useCallback((save:(()=>Promise<void>)|null)=>{saveAction.current=save;},[]);
  const formState=useCallback((dirty:boolean,busy:boolean,count:number,canSave:boolean)=>setForm(old=>old.dirty===dirty&&old.busy===busy&&old.count===count&&old.canSave===canSave?old:{dirty,busy,count,canSave}),[]);
  useEffect(()=>{if(params.section&&params.section!==sectionRef.current&&sections.some(s=>s.value===params.section)){
    if(formRef.current.dirty)Alert.alert("Keep your unsaved class records?","Save the current section before changing workspaces.",[{text:"Keep editing",style:"cancel"},{text:"Discard changes",style:"destructive",onPress:()=>setSection(params.section!)}]);else setSection(params.section);
  }},[params.section]);
  function change(work:()=>void){if(form.busy)return;if(form.dirty)Alert.alert("Discard unsaved changes?","Classroom records stay unchanged until you save.",[{text:"Keep editing",style:"cancel"},{text:"Discard changes",style:"destructive",onPress:work}]);else work();}
  return <Screen footer={section==="attendance"||section==="assessments" ? <Button label={form.busy?"Saving...":section==="attendance"?`Save attendance (${form.count} changes)`:`Save marks (${form.count} students)`} icon="save-outline" disabled={form.busy||!form.canSave} onPress={()=>void saveAction.current?.()}/> : undefined}><AppText variant="title">Classroom</AppText>
    <GradeSelector grade={grade} disabled={form.busy} onSelect={value=>{if(value!==grade)change(()=>setGrade(value));}}/>
    <FormStatus message={gradeError} error/>
    <ClassroomSections selected={section} disabled={form.busy} onSelect={value=>{if(value!==section)change(()=>{setSection(value);router.setParams({section:value});});}}/>
    {section==="students" ? <StudentRegister grade={grade} search={search} setSearch={setSearch} status={status} setStatus={setStatus}/> : null}
    {section==="attendance" ? <AttendanceWorkspace key={`attendance-${grade}`} grade={grade} onStateChange={formState} onSaveAction={bindSave}/> : null}
    {section==="assessments" ? <BulkAssessment key={`marks-${grade}`} grade={grade} onStateChange={formState} onSaveAction={bindSave}/> : null}
    {section==="progress" ? <ClassProgress grade={grade}/> : null}
  </Screen>;
}
function StudentRegister({grade,search,setSearch,status,setStatus}:{grade:number;search:string;setSearch:(value:string)=>void;status:string;setStatus:(value:string)=>void}){
  const loader=useCallback(()=>loadStudents('',grade),[grade]);
  const {data,error,loading,reload}=useLocalData(loader);
  const matchesStatus=(s:NonNullable<typeof data>[number],value:string)=>value==='all'||(value==='unassessed'?s.hasEvidence===false:value==='revision'?s.hasEvidence!==false&&(s.needsRevision||s.mastery<0.6):value==='secure'?s.hasEvidence!==false&&!s.needsRevision&&s.mastery>=0.8:s.hasEvidence!==false&&!s.needsRevision&&s.mastery>=0.6&&s.mastery<0.8);
  const query=search.trim().toLocaleLowerCase();
  const students=data?.filter(s=>(!query||s.name.toLocaleLowerCase().includes(query)||s.rollNumber.toLocaleLowerCase().includes(query))&&matchesStatus(s,status));
  const filters=[{value:'all',label:'All'},{value:'revision',label:'Needs revision'},{value:'secure',label:'Secure'},{value:'practicing',label:'Practicing'},{value:'unassessed',label:'Not assessed'}];
  return <View style={{gap:12}}>
    <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8}}><View style={{flex:1,minWidth:0}}><AppText variant="subheading">Grade {grade} register</AppText><AppText variant="small" muted>{`${students?.length??0} of ${data?.length??0} students`}</AppText></View><Button label="Add student" icon="person-add-outline" variant="secondary" onPress={()=>router.push({pathname:"/students/new",params:{grade:String(grade)}})}/></View>
    <TextField label="Search name or roll number" value={search} onChangeText={setSearch} placeholder="Name or roll" autoCapitalize="none" autoCorrect={false} returnKeyType="search"/>
    <ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled" contentContainerStyle={{gap:8,paddingVertical:2}}>
      {filters.map(filter=>{const active=status===filter.value;const count=data?.filter(s=>matchesStatus(s,filter.value)).length??0;return <Pressable key={filter.value} accessibilityRole="radio" accessibilityLabel={`${filter.label}, ${count} students`} accessibilityState={{selected:active}} onPress={()=>setStatus(filter.value)} style={{minHeight:48,paddingHorizontal:12,paddingVertical:10,borderWidth:1,borderColor:active?colors.primary:colors.border,borderRadius:6,backgroundColor:active?colors.primarySurface:colors.surface,flexDirection:'row',alignItems:'center',gap:8}}><AppText variant="small" style={{color:active?colors.primary:colors.text,fontWeight:active?'700':'500'}}>{filter.label}</AppText><AppText variant="small" muted>{count}</AppText></Pressable>;})}
    </ScrollView>
    {search||status!=='all'?<Button label="Clear filters" variant="quiet" onPress={()=>{setSearch('');setStatus('all');}}/>:null}
    <FormStatus message={error} error/>{error ? <Button label="Reload students" variant="quiet" onPress={()=>void reload()}/> : null}
    {loading&&!data ? <AppText muted>Opening register...</AppText> : null}
    {students?.length?<View style={{borderTopWidth:1,borderColor:colors.border}}>{students.map(student=><StudentRow key={student.id} student={student}/>)}</View>:null}
    {!loading&&!error&&students?.length===0 ? <EmptyState title={data?.length?"No matching students":"Your class register is empty"} detail={data?.length?"Try another name, roll number or learning filter.":"Enroll a student to begin recording attendance and marks."}/> : null}
  </View>;
}
