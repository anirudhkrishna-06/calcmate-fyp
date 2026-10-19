import { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Screen } from "@/components/Screen";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { FormStatus } from "@/components/FormStatus";
import { LoadingState } from "@/components/LoadingState";
import { useLocalData } from "@/hooks/useLocalData";
import { colors, spacing } from "@/theme";
import { loadWeeklySchedule, regenerateWeeklySchedule, isWeeklyScheduleOutdated } from "@/services/weeklyScheduleService";
import type { WeeklySchedule, DaySchedule } from "@/types/weeklySchedule";
import type { GeneralSchedule } from "@/types/generalSchedule";

function dateLabel(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
}

function PlanDay({ day, onOpen }: { day: DaySchedule; onOpen: (schedule: GeneralSchedule) => void }) {
  const periods = day.slots.filter(slot => slot.kind === "period" && slot.periodIndex !== undefined);
  return <View style={styles.dayCard}>
    <View style={styles.dayHeader}><View><AppText style={styles.dayName}>{day.dayLabel}</AppText><AppText variant="small" muted>{dateLabel(day.date)}</AppText></View><AppText variant="small" style={styles.dayCount}>{periods.length} teaching blocks</AppText></View>
    <View style={styles.dayBody}>{periods.map((slot, index) => {
      const plan = day.periodSchedules[slot.periodIndex!];
      const lead = plan?.selection.focusGrade ?? plan?.blocks.find(block => block.kind === "instruction")?.teacherGrade;
      const need = lead ? plan?.needs.find(item => item.grade === lead) : undefined;
      return <Pressable key={slot.periodIndex} onPress={() => plan && onOpen(plan)} style={({ pressed }) => [styles.period, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`${day.dayLabel} ${slot.label}`}>
        <View style={styles.periodTime}><AppText style={styles.periodNumber}>{index + 1}</AppText><AppText variant="small" muted>{slot.startTime}</AppText></View>
        <View style={{ flex: 1, gap: 3 }}><AppText style={styles.concept}>{need?.concept ?? "Classroom learning block"}</AppText><AppText variant="small" muted>{lead ? `Teacher focus: Grade ${lead}` : "Multi-grade activity"}{need?.prerequisiteGap ? " · prerequisite first" : ""}</AppText><AppText variant="small" style={styles.reason}>{need?.reason ?? "Follow the planned classroom activity."}</AppText></View>
        <View style={styles.startMark}><AppText style={styles.startMarkText}>Briefing</AppText></View>
      </Pressable>;
    })}</View>
  </View>;
}

export default function WeeklyScheduleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  console.info("[WeeklySchedule] detail:route", { id });
  const loader = useCallback(async () => {
    console.info("[WeeklySchedule] detail:loader-start", { id });
    try {
      const result = await loadWeeklySchedule(id);
      console.info("[WeeklySchedule] detail:loader-complete", { id });
      return result;
    } catch (error) {
      console.error("[WeeklySchedule] detail:loader-error", { id, error });
      throw error;
    }
  }, [id]);
  const { data: ws, error, loading, reload } = useLocalData(loader);
  const [outdated, setOutdated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    console.info("[WeeklySchedule] detail:outdated-effect", { id });
    if (id) void isWeeklyScheduleOutdated(id).then(setOutdated).catch(error => console.error("[WeeklySchedule] detail:outdated-error", { id, error }));
  }, [id, ws?.updatedAt]);

  async function regenerate() {
    setBusy(true); setActionError("");
    try { await regenerateWeeklySchedule(id); setOutdated(false); await reload(); }
    catch (e) { setActionError(e instanceof Error ? e.message : "Could not refresh the weekly plan."); }
    finally { setBusy(false); }
  }

  if (loading && !ws) return <Screen topInset={false}><LoadingState label="Reading the saved classroom plan" /></Screen>;
  if (error || !ws) return <Screen topInset={false}><AppText variant="title">Weekly Classroom Plan</AppText><FormStatus message={error || "Plan not found."} error /><Button label="Back to planner" onPress={() => router.back()} /></Screen>;

  return <Screen topInset={false}>
    <View style={styles.header}><View style={{ flex: 1, gap: 4 }}><AppText variant="title">Weekly Classroom Plan</AppText><AppText muted>{dateLabel(ws.weekStartDate)} to Friday · Grades {ws.grades.join(", ")}</AppText></View><Button label={busy ? "Refreshing" : "Refresh"} icon="refresh-outline" variant="secondary" disabled={busy} onPress={() => void regenerate()} style={{ minWidth: 0, paddingHorizontal: 13 }} /></View>
    {outdated ? <View style={styles.alert}><AppText variant="small" style={styles.alertText}>Classroom evidence has changed. Refresh this plan before teaching.</AppText></View> : null}
    <FormStatus message={actionError} error />
    <View style={styles.explainer}><AppText variant="subheading">A living plan for this classroom</AppText><AppText variant="small" muted>Each period has a teacher-led focus chosen from current BKT evidence, attendance, prerequisite pressure and unfinished curriculum. Other grades receive a concrete independent activity.</AppText></View>
    {ws.days.map(day => <PlanDay key={day.date} day={day} onOpen={schedule => router.push(`/general-schedule/${schedule.id}`)} />)}
  </Screen>;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: spacing.sm },
  explainer: { gap: 5, padding: 14, borderRadius: 16, backgroundColor: colors.primarySurface, borderWidth: 1, borderColor: colors.sage },
  alert: { padding: 11, borderRadius: 12, backgroundColor: colors.attentionSurface, borderWidth: 1, borderColor: colors.attention },
  alertText: { color: colors.attention, fontWeight: "700" },
  dayCard: { borderRadius: 18, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.lineLight, overflow: "hidden" },
  dayHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 15, backgroundColor: colors.paperWarm },
  dayName: { fontSize: 17, fontWeight: "800", color: colors.primary },
  dayCount: { color: colors.charcoalMuted },
  dayBody: { paddingHorizontal: 12 },
  period: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.lineLight },
  pressed: { opacity: 0.65 },
  periodTime: { width: 43, alignItems: "center", gap: 2 },
  periodNumber: { width: 26, height: 26, textAlign: "center", textAlignVertical: "center", borderRadius: 13, backgroundColor: colors.primarySurface, color: colors.primary, fontWeight: "800", overflow: "hidden" },
  concept: { fontWeight: "800", color: colors.charcoal },
  reason: { color: colors.primary, fontSize: 11 },
  startMark: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.goldLight },
  startMarkText: { color: colors.gold, fontSize: 11, fontWeight: "800" },
});
