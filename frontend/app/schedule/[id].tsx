import { useCallback } from "react";
import { useLocalSearchParams } from "expo-router";
import { Screen } from "@/components/Screen";
import { AppText } from "@/components/AppText";
import { FormStatus } from "@/components/FormStatus";
import { PlanTimeline } from "@/components/PlanTimeline";
import { useLocalData } from "@/hooks/useLocalData";
import { loadSavedPlan } from "@/services/scheduleService";
export default function SavedScheduleScreen() {
  const { id } = useLocalSearchParams<{ id:string }>();
  const loader = useCallback(() => loadSavedPlan(id),[id]);
  const { data,error,loading } = useLocalData(loader);
  return <Screen topInset={false}><AppText variant="title" style={{ marginBottom:16 }}>Lesson plan</AppText>
    <FormStatus message={error} error />{loading && !data ? <AppText>Loading saved plan...</AppText> : null}
    {data ? <PlanTimeline key={data.id} plan={data} /> : null}
  </Screen>;
}
