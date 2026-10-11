import { useCallback,useRef,useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Alert } from "react-native";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { AppText } from "@/components/AppText";
import { GradeSelector } from "@/components/GradeSelector";
import { AttendanceWorkspace } from "@/components/AttendanceWorkspace";
import { FormStatus } from "@/components/FormStatus";
import { useGrade } from "@/hooks/useGrade";
export default function Attendance(){
  const params=useLocalSearchParams<{grade?:string}>();const {grade,setGrade,error}=useGrade(Number(params.grade));
  const [form,setForm]=useState({dirty:false,busy:false,count:0,canSave:false});
  const saveAction=useRef<(()=>Promise<void>)|null>(null);
  const bindSave=useCallback((save:(()=>Promise<void>)|null)=>{saveAction.current=save;},[]);
  const formState=useCallback((dirty:boolean,busy:boolean,count:number,canSave:boolean)=>setForm(old=>old.dirty===dirty&&old.busy===busy&&old.count===count&&old.canSave===canSave?old:{dirty,busy,count,canSave}),[]);
  return <Screen topInset={false} footer={<Button label={form.busy?"Saving...":`Save attendance (${form.count} changes)`} disabled={form.busy||!form.canSave} onPress={()=>void saveAction.current?.()}/>}><AppText variant="title">Class attendance</AppText><FormStatus message={error} error/>
    <GradeSelector grade={grade} disabled={form.busy} onSelect={value=>{if(value===grade)return;if(form.dirty)Alert.alert("Discard unsaved attendance?","Save to keep your register changes.",[{text:"Keep editing",style:"cancel"},{text:"Discard",style:"destructive",onPress:()=>setGrade(value)}]);else setGrade(value);}}/>
    <AttendanceWorkspace key={grade} grade={grade} onStateChange={formState} onSaveAction={bindSave}/>
  </Screen>;
}
