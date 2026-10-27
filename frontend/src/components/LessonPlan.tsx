import { View } from "react-native";
import { AppText } from "./AppText";
import { SavedPlan } from "@/types/planning";
import { colors } from "@/theme";
export function LessonPlan({ plan }: { plan:SavedPlan }) {
  return <View style={{ gap:16 }}>
    <AppText variant="subheading" style={{ color:colors.forest }}>{plan.label} | Grade {plan.selection.grade} Maths</AppText>
    <AppText muted>{plan.selection.date} | {plan.selection.availableMinutes} minutes | {plan.summary.eligible} students</AppText>
    {plan.summary.missing.map(note => <AppText muted key={note}>{note}</AppText>)}
    {plan.lessons.map(lesson => <View key={lesson.order} style={{ gap:8,paddingVertical:12,borderTopWidth:1,borderColor:colors.line }}>
      <AppText variant="subheading">{lesson.order}. {lesson.title}</AppText>
      <AppText muted>{lesson.durationMinutes} minutes | {lesson.studentIds.length} students</AppText>
      <AppText variant="small" muted>Objective</AppText><AppText>{lesson.objective}</AppText>
      <AppText variant="small" muted>Activities</AppText>
      {lesson.activities.map(activity => <AppText key={activity}>- {activity}</AppText>)}
      <AppText variant="small" style={{ color:colors.forest }}>Why this block</AppText>
      {lesson.reasons.map(reason => <AppText key={reason} muted>{reason}</AppText>)}
    </View>)}
  </View>;
}
