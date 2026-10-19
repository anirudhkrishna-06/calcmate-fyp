/**
 * Planner tab — redesigned for Review 3.
 *
 * New structure:
 *   1. Weekly Classroom Plan  (NEW — primary entry point)
 *   2. Single Period / General Schedule
 *   3. Curriculum Knowledge Graph
 *   4. Saved weekly schedules list
 *   5. Saved general schedules list
 *   6. Lesson plans (legacy)
 */
import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Section, ActionRow, EmptyState } from "@/components/Workspace";
import { FormStatus } from "@/components/FormStatus";
import { LoadingState } from "@/components/LoadingState";
import { useLocalData } from "@/hooks/useLocalData";
import { useGrade } from "@/hooks/useGrade";
import { getScheduleSummary } from "@/services/scheduleService";
import { listGeneralSchedules } from "@/services/generalScheduleService";
import { listWeeklySchedules } from "@/services/weeklyScheduleService";
import { listPendingClassEntries } from "@/services/sessionService";
import { colors, spacing } from "@/theme";

async function loadPlanner() {
  const [lessons, general, weekly, pending] = await Promise.all([
    getScheduleSummary(),
    listGeneralSchedules(),
    listWeeklySchedules(),
    listPendingClassEntries(),
  ]);
  return { ...lessons, general, weekly, pending };
}

// ─── Week range label: "21 Oct – 25 Oct 2026" ────────────────────────────────
function weekRangeLabel(mondayISO: string): string {
  const mon = new Date(`${mondayISO}T12:00:00Z`);
  const fri = new Date(mon); fri.setUTCDate(mon.getUTCDate() + 4);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${fmt(mon)} – ${fmt(fri)} ${fri.getUTCFullYear()}`;
}

export default function PlannerScreen() {
  const { grade, setGrade, error: gradeError } = useGrade();
  const { data, error, loading, reload } = useLocalData(loadPlanner);
  const plans = useMemo(
    () => data?.plans.filter(plan => plan.selection.grade === grade) ?? [],
    [data, grade],
  );

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><AppText variant="title">Planner</AppText><Button label="Updates" icon="notifications-outline" variant="quiet" onPress={() => router.push("/notifications")} /></View>
      <FormStatus message={error || gradeError} error />

      {data?.pending.length ? <Section title="Post-class entry pending" detail="These completed classes still need a short delivery record. Your learning state is not updated until you save it.">
        {data.pending.slice(0, 3).map(entry => <ActionRow key={entry.sessionId} title={`${entry.date} · Class record`} detail={`${entry.completedBlocks}/${entry.totalBlocks} blocks recorded · Add what was delivered`} onPress={() => router.push({ pathname: "/post-class-review", params: { sessionId: entry.sessionId, scheduleId: entry.scheduleId } })} />)}
      </Section> : null}

      {/* ── Weekly Classroom Plan — primary CTA ── */}
      <View style={primaryStyles.card}>
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="subheading" style={{ color: colors.forest }}>Weekly Classroom Plan</AppText>
          <AppText variant="small" muted>
            Mon–Fri · 5 periods · 40 min each · AI-adapted to current knowledge states
          </AppText>
        </View>
        <Button
          label="Create"
          icon="calendar-outline"
          onPress={() => router.push("/weekly-schedule/new")}
          style={{ minWidth: 0, paddingHorizontal: 18 }}
        />
      </View>

      {/* ── Saved weekly schedules ── */}
      <Section title="Weekly Schedules" detail="Saved plans for this week and upcoming weeks">
        {!loading && !error && !data?.weekly.length ? (
          <EmptyState title="No weekly schedules yet" detail="Create your first Mon–Fri plan above." />
        ) : null}
        {data?.weekly.map(ws => (
          <ActionRow
            key={ws.id}
            title={weekRangeLabel(ws.weekStartDate)}
            detail={`Grades ${ws.grades.join(", ")} · ${ws.daysWithSchedule}/5 days · ${ws.totalPeriods} periods`}
            onPress={() => router.push(`/weekly-schedule/${ws.id}`)}
          />
        ))}
      </Section>

      {/* ── Single period / general schedule ── */}
      <Section title="Single Period" detail="One teacher, multiple grades — one period at a time">
        <Button
          label="Pre-Class Briefing"
          icon="newspaper-outline"
          variant="secondary"
          onPress={() => router.push("/general-schedule/new")}
        />
      </Section>

      {/* ── Curriculum Knowledge Graph ── */}
      <Section title="Knowledge Graph" detail="Explore concept prerequisites and learning gap readiness">
        <Button
          label="View Prerequisite Graph"
          icon="git-network-outline"
          variant="secondary"
          onPress={() => router.push({ pathname: "/curriculum", params: { grade: String(grade), origin: "planner" } })}
        />
      </Section>

      {/* ── Saved general schedules ── */}
      <Section title="Saved Period Schedules">
        {!loading && !error && !data?.general.length ? (
          <EmptyState title="No period schedules yet" detail="Plan your classroom rotation." />
        ) : null}
        {data?.general.map(s => (
          <ActionRow
            key={s.id}
            title={`${s.selection.date} · ${s.selection.availableMinutes} min`}
            detail={`Grades ${s.selection.grades.join(", ")} · ${s.blocks.filter(b => b.status === "completed").length}/${s.blocks.length} blocks done`}
            onPress={() => router.push(`/general-schedule/${s.id}`)}
          />
        ))}
      </Section>

      {loading && !data ? <LoadingState label="Reading your classroom plans" /> : null}
      {error ? <Button label="Reload" variant="quiet" onPress={() => void reload()} /> : null}
    </Screen>
  );
}

const primaryStyles = {
  card: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    backgroundColor: colors.sageLight,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.sage,
    borderLeftWidth: 5,
    borderLeftColor: colors.forest,
    padding: 14,
  },
};
