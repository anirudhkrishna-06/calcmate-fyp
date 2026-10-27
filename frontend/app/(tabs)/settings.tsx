import { useState } from "react";
import { router } from "expo-router";
import { Alert,View } from "react-native";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { Section,ActionRow,LocalStatus } from "@/components/Workspace";
import { Screen } from "@/components/Screen";
import { FormStatus } from "@/components/FormStatus";
import { createLocalBackup,lastBackup,selectBackup } from "@/services/backupService";
import { restoreBackupJson } from "@/services/restoreService";
import { getSession } from "@/services/authService";
import { installReviewClassroom } from "@/services/workspaceService";
import { storageSummary } from "@/services/storageService";
import { useLocalData } from "@/hooks/useLocalData";
async function loadSettings(){return {session:await getSession(),backup:await lastBackup(),storage:await storageSummary()};}
export default function SettingsScreen(){
  const {data,error,reload}=useLocalData(loadSettings);
  const [status,setStatus]=useState("");const [failed,setFailed]=useState(false);const [busy,setBusy]=useState(false);
  async function backup(){setBusy(true);try{const result=await createLocalBackup();setStatus(result.status==="cancelled"?"Backup cancelled.":"Backup saved and verified.");setFailed(false);await reload();}catch(e){setStatus(e instanceof Error?e.message:"Could not create backup.");setFailed(true);}finally{setBusy(false);}}
  async function restore(){setBusy(true);try{
    const selected=await selectBackup();if(!selected){setStatus("No backup selected.");setFailed(false);return;}
    Alert.alert("Replace classroom records?",`${selected.students} students | Backup from ${new Date(selected.exportedAt).toLocaleDateString("en-IN")}\nCurrent records will be replaced. Create a backup first to keep current edits.`,[
      {text:"Cancel",style:"cancel"},{text:"Replace records",style:"destructive",onPress:()=>void applyRestore(selected.json)}
    ]);
  }catch(e){setStatus(e instanceof Error?e.message:"Could not read backup.");setFailed(true);}finally{setBusy(false);}}
  async function applyRestore(json:string){setBusy(true);try{const result=await restoreBackupJson(json);setStatus(["Classroom restored. Open Home to see your records.",...(result?.warnings??[])].join(" "));setFailed(false);await reload();}catch(e){setStatus(e instanceof Error?e.message:"Restore failed; current records were retained.");setFailed(true);}finally{setBusy(false);}}
  async function loadReviewClassroom(){
    const session=data?.session;
    if(!session||session.mode==="demo"){setStatus("Sign in to a teacher profile before loading review data.");setFailed(true);return;}
    Alert.alert("Load review classroom?","This replaces the current local students, attendance, marks, observations, and saved schedules with a complete review classroom. Create a backup first if you need to keep current records.",[{
      text:"Cancel",style:"cancel"
    },{text:"Load review data",style:"destructive",onPress:()=>void (async()=>{setBusy(true);try{const result=await installReviewClassroom(session);setStatus(`Review classroom loaded: ${result.students} students, ${result.assessments} assessment records, attendance through ${result.installedAt}.`);setFailed(false);await reload();}catch(e){setStatus(e instanceof Error?e.message:"Review classroom could not be loaded.");setFailed(true);}finally{setBusy(false);}})()}]);
  }
  return <Screen><AppText variant="title">Settings</AppText><FormStatus message={error} error/>
    <Section title="Server connection"><Button label="Server connection" icon="link-outline" variant="secondary" onPress={()=>router.push('/connection')}/></Section>
    <Section title="Teacher profile"><ActionRow title="Profile and teaching grades" onPress={()=>router.push("/profile")}/><AppText variant="small" muted>{data?.session?.mode==="demo"?"Demo workspace":data?.session?"Approved teacher account":"Opening account..."}</AppText></Section>
    <Section title="Offline storage"><LocalStatus/>
      {data ? <AppText>{data.storage.students} students | {data.storage.assessments} assessments | {data.storage.plans} schedules and plans</AppText> : <AppText muted>Reading local storage...</AppText>}
      <AppText variant="small" muted>New Assistant answers need a server connection.</AppText>
      {data?.session?.validUntil ? <AppText variant="small" muted>Cached account access valid until {new Date(data.session.validUntil).toLocaleString("en-IN")}. Reconnect and log in after expiry.</AppText> : null}
    </Section>
    <Section title="Backup and recovery" detail={data?.backup?`Last backup: ${new Date(data.backup).toLocaleString("en-IN")}`:"No backup created yet"}>
      <View style={{flexDirection:"row",flexWrap:"wrap",gap:8}}><Button label={busy?"Please wait...":"Create backup"} icon="archive-outline" disabled={busy} onPress={()=>void backup()} style={{flexGrow:1}}/><Button label="Restore backup" icon="download-outline" variant="secondary" disabled={busy} onPress={()=>void restore()} style={{flexGrow:1}}/></View>
      <AppText variant="small" muted>Backups include classroom records and exclude passwords and account tokens. Keep files private.</AppText><FormStatus message={status} error={failed}/>
    </Section>
    <Section title="Review classroom" detail="Load a complete multi-grade classroom into this teacher profile.">
      <Button label={busy?"Loading review data...":"Load review classroom"} icon="school-outline" variant="secondary" disabled={busy||!data?.session||data.session.mode==="demo"} onPress={()=>void loadReviewClassroom()} />
      <AppText variant="small" muted>Includes South Indian student names, June-to-date attendance, assignments, quizzes, observations, concept evidence, and learner states. Existing local classroom records are replaced.</AppText>
    </Section>
    <Section title="About CalcMate"><AppText>Maths - Grades 1-5</AppText><AppText variant="small" muted>Version 0.1.0</AppText></Section>
  </Screen>;
}
