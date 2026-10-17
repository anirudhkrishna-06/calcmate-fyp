import { useCallback } from "react";
import { router } from "expo-router";
import { View } from "react-native";
import { AppText } from "./AppText";
import { Button } from "./Button";
import { Section,ActionRow,EmptyState } from "./Workspace";
import { FormStatus } from "./FormStatus";
import { useLocalData } from "@/hooks/useLocalData";
import { classLearningEvidence } from "@/services/classroomService";
export function ClassProgress({grade}:{grade:number}){
  const loader=useCallback(()=>classLearningEvidence(grade),[grade]);
  const {data,error,loading,reload}=useLocalData(loader);
  return <View style={{gap:16}}><FormStatus message={error} error/>
    {error ? <Button label="Reload progress" variant="quiet" onPress={()=>void reload()}/> : null}
    {loading&&!data ? <AppText muted>Reading progress...</AppText> : null}
    {!loading&&!data?.students.length&&!error ? <EmptyState title="No learning evidence yet" detail="Enroll students and record an assessment to see class strengths and gaps."/> : null}
    {data?.progress.map(item=><Section key={item.concept.id} title={item.concept.title} detail={`${item.secure} secure · ${item.practicing} practicing · ${item.revision.length} need revision · ${item.missing} not assessed`}>
      <AppText>{item.revision.length?'Model another example, then check understanding.':item.recorded?'Continue practice and check understanding.':'No marks yet. Start with a readiness check.'}</AppText>
      {item.revision.map(student=><ActionRow key={student.id} title={student.name} detail={`Roll ${student.roll} · Open progress and teacher notes`} onPress={()=>router.push({pathname:"/students/[id]",params:{id:student.id,tab:"observations"}})}/>)}
      <Button label="Explain this concept" variant="quiet" onPress={()=>router.push({pathname:"/chatbot",params:{grade:String(grade),prompt:`Explain ${item.concept.title.toLowerCase()} for Grade ${grade} Maths. Suggest one concrete classroom activity and one understanding check.`,conceptId:item.concept.id,screenContext:"class_progress"}})}/>
    </Section>)}
  </View>;
}
