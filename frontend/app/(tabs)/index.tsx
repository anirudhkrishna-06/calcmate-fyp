import { useCallback,useState } from "react";
import { router } from "expo-router";
import { View } from "react-native";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { GradeSelector } from "@/components/GradeSelector";
import { Section,ActionRow,LocalStatus } from "@/components/Workspace";
import { FormStatus } from "@/components/FormStatus";
import { classroomSummary } from "@/services/classroomService";
import { useLocalData } from "@/hooks/useLocalData";
import { useGrade } from "@/hooks/useGrade";
import { today } from "@/services/database";
import { colors } from "@/theme";
import { signOut } from '@/services/authService';
export default function HomeScreen(){
  const {grade,setGrade,error:gradeError}=useGrade();
  const loader=useCallback(()=>classroomSummary(grade),[grade]);
  const {data,error,loading,reload}=useLocalData(loader);
  const [loggingOut,setLoggingOut]=useState(false);const [logoutError,setLogoutError]=useState('');
  async function logout(){setLoggingOut(true);setLogoutError('');try{await signOut();router.replace('/welcome');}catch(e){setLogoutError(e instanceof Error?e.message:'Could not log out. Try again.');setLoggingOut(false);}}
  const openClassroom=(section:string)=>router.push({pathname:"/students",params:{grade:String(grade),section}});
  const plan=data?.plan;
  return <Screen>
    <View style={{flexDirection:'row',alignItems:'flex-start',gap:12}}><View style={{flex:1,minWidth:0,gap:4}}><AppText variant="small" muted>{new Date(`${today()}T12:00:00`).toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long"})}</AppText>
      <AppText variant="title">{data ? `Hello, ${data.teacher.name.split(" ")[0]}` : "Your teaching day"}</AppText>
      <AppText muted>{data?.teacher.schoolName ?? "Opening your classroom"} | Maths</AppText>
    </View><Button label={loggingOut?'Logging out...':'Log out'} icon="log-out-outline" variant="secondary" disabled={loggingOut} onPress={()=>void logout()}/></View>
    <GradeSelector grade={grade} onSelect={setGrade}/>
    <FormStatus message={logoutError||error||gradeError} error/>{error ? <Button label="Retry" icon="refresh-outline" onPress={()=>void reload()}/> : null}
    {loading&&!data ? <AppText muted>Opening classroom...</AppText> : null}
    {data ? <>
      {data.mode==="demo" ? <LocalStatus text="Demo"/> : null}
      {data.rotation?<Section title={data.rotation.selection.date===today()?"Today's schedule":"Next classroom schedule"}><ActionRow title={`${data.rotation.selection.availableMinutes} min · Grades ${data.rotation.selection.grades.join(', ')}`} detail={data.rotation.selection.date} onPress={()=>router.push(`/general-schedule/${data.rotation!.id}`)}/></Section>:null}
      <Section title="Today's teaching" detail={`Grade ${grade} | ${data.students} enrolled`}>
        <AppText style={{color:colors.forest}}>{!data.students ? "Add students to begin your register." : data.recorded===data.students ? `Attendance complete | ${data.present} present` : `${data.recorded} of ${data.students} attendance entries saved`}</AppText>
        <View style={{flexDirection:"row",flexWrap:"wrap",gap:8}}>
          <Button label="Mark attendance" icon="checkbox-outline" onPress={()=>openClassroom("attendance")} style={{flexGrow:1}}/>
          <Button label="Record marks" icon="create-outline" variant="secondary" onPress={()=>openClassroom("assessments")} style={{flexGrow:1}}/>
        </View>
        <ActionRow title="Create schedule" detail="Rotate between your grades" onPress={()=>router.push('/general-schedule/new')}/>
        <ActionRow title="Create lesson plan" onPress={()=>router.push({pathname:"/schedule/generated",params:{grade:String(grade)}})}/>
        <ActionRow title="Ask Assistant" detail={`Maths teaching support for Grade ${grade}`} onPress={()=>router.push({pathname:"/chatbot",params:{grade:String(grade)}})}/>
      </Section>
      <Section title="Students needing help" detail={`${data.revision} need revision`}>
        {data.revisionStudents.length ? data.revisionStudents.map((student,i)=><ActionRow key={`${student.id}-${i}`} title={student.name} detail={`${student.concept} | Needs revision`} onPress={()=>router.push(`/students/${student.id}`)}/>) : <AppText muted>{data.students ? "No revision gaps recorded." : "Add students and record marks."}</AppText>}
        <Button label="Review class progress" variant="quiet" onPress={()=>openClassroom("progress")}/>
      </Section>
      <Section title={data.upcoming ? "Next lesson" : "Recently saved plan"}>
        {plan ? <ActionRow title={`Grade ${plan.selection.grade} | ${plan.selection.date}`} detail={`${plan.selection.availableMinutes} minutes | ${plan.label==="DEMO/MOCK" ? "Local mock planner" : "Scheduling engine"}`} onPress={()=>router.push(`/schedule/${plan.id}`)}/> : <AppText muted>No plans yet.</AppText>}
      </Section>
      <View style={{flexDirection:"row",flexWrap:"wrap",gap:24,paddingVertical:8,borderTopWidth:1,borderColor:colors.line}}>
        <View><AppText variant="subheading">{data.students}</AppText><AppText variant="small" muted>Enrolled</AppText></View>
        <View><AppText variant="subheading">{data.present}/{data.recorded}</AppText><AppText variant="small" muted>Present / marked</AppText></View>
        <View><AppText variant="subheading">{data.revision}</AppText><AppText variant="small" muted>Need revision</AppText></View>
      </View>
    </> : null}
  </Screen>;
}
