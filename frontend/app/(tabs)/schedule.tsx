import { useMemo } from "react";
import { router } from "expo-router";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { ScheduleBlock } from "@/components/ScheduleBlock";
import { Screen } from "@/components/Screen";
import { GradeSelector } from "@/components/GradeSelector";
import { Section,ActionRow,EmptyState } from "@/components/Workspace";
import { FormStatus } from "@/components/FormStatus";
import { getScheduleSummary } from "@/services/scheduleService";
import { useLocalData } from "@/hooks/useLocalData";
import { useGrade } from "@/hooks/useGrade";
import { listGeneralSchedules } from '@/services/generalScheduleService';
async function loadPlanner(){const [lessons,general]=await Promise.all([getScheduleSummary(),listGeneralSchedules()]);return {...lessons,general};}
export default function PlannerScreen(){
  const {grade,setGrade,error:gradeError}=useGrade();
  const {data,error,loading,reload}=useLocalData(loadPlanner);
  const plans=useMemo(()=>data?.plans.filter(plan=>plan.selection.grade===grade)??[],[data,grade]);
  return <Screen><AppText variant="title">Planner</AppText><FormStatus message={error||gradeError} error/>
    <Section title="Curriculum Knowledge Graph" detail="Explore prerequisites & learning gap readiness"><Button label="View Prerequisite Graph" icon="git-network-outline" variant="secondary" onPress={()=>router.push({pathname:'/curriculum',params:{grade:String(grade),origin:'planner'}})}/></Section>
    <Section title="General schedule" detail="One teacher, multiple grades"><Button label="Create General Schedule" icon="calendar-outline" onPress={()=>router.push('/general-schedule/new')}/></Section>
    <Section title="Saved general schedules">
      {!loading&&!error&&!data?.general.length?<EmptyState title="No schedules yet" detail="Plan your classroom rotation."/>:null}
      {data?.general.map(s=><ActionRow key={s.id} title={`${s.selection.date} | ${s.selection.availableMinutes} min`} detail={`Grades ${s.selection.grades.join(', ')} | ${s.blocks.filter(b=>b.status==='completed').length}/${s.blocks.length} completed`} onPress={()=>router.push(`/general-schedule/${s.id}`)}/>)}
    </Section>
    <Section title="Lesson plan" detail="Detailed activities for one grade"><GradeSelector grade={grade} onSelect={setGrade}/><Button label="Create Lesson Plan" icon="add-outline" variant="secondary" onPress={()=>router.push({pathname:"/schedule/generated",params:{grade:String(grade)}})}/></Section>
    {loading&&!data ? <AppText muted>Opening plans...</AppText> : null}
    {error ? <Button label="Reload plans" variant="quiet" onPress={()=>void reload()}/> : null}
    <Section title="Saved lesson plans" detail={`Grade ${grade} Maths`}>
      {!loading&&!error&&!plans.length ? <EmptyState title="No plans yet" detail={`Grade ${grade} Maths`}/> : null}
      {plans.map(plan=>{
        const completed=plan.lessons.filter(l=>l.status==="completed").length;
        return <ActionRow key={plan.id} title={`${plan.selection.date} | ${plan.selection.availableMinutes} minutes`} detail={`${completed}/${plan.lessons.length} activities completed | ${plan.label==="DEMO/MOCK"?"Local mock planner":"Scheduling engine"}`} onPress={()=>router.push(`/schedule/${plan.id}`)}/>;
      })}
    </Section>
    {data?.legacy.filter(item=>item.grade===grade).map(item=><Section key={item.id} title="Earlier revision block" detail="Demo / mock"><ScheduleBlock item={item}/></Section>)}
  </Screen>;
}
