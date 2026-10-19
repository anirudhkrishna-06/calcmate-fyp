/**
 * Post-Class Review — refined for Review 3.
 *
 * Three clear sections:
 *   1. Session Summary — duration, block count, mid-session events
 *   2. Rotation Block Delivery — per-block checklist with notes + status chips
 *   3. Student Interventions — student picker, exit scores, grade-concept pairs
 *   4. Classroom Observation — free-text note saved to all focused students
 *
 * Visual improvements:
 *  • Block cards with status colour coding (delivered=forest, postponed=muted)
 *  • Mastery impact preview chip on exit assessment
 *  • Grade-concept selectors styled as pills
 *  • Success screen with next-action buttons
 */
import { useState, useCallback } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Screen } from "@/components/Screen";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { FormStatus } from "@/components/FormStatus";
import { LoadingState } from "@/components/LoadingState";
import { Section } from "@/components/Workspace";
import { useLocalData } from "@/hooks/useLocalData";
import { colors, spacing } from "@/theme";
import {
  getSessionById,
  getActiveSession,
  saveSessionOutcomes,
  getSessionAttendanceEvents,
} from "@/services/sessionService";
import { loadGeneralSchedule } from "@/services/generalScheduleService";
import { loadStudents } from "@/services/storageService";
import type { GeneralSchedule, RotationBlock, GradeNeed } from "@/types/generalSchedule";
import type { ClassSessionRecord, SessionAttendanceEventRecord } from "@/services/database";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ReviewData {
  session: ClassSessionRecord;
  schedule: GeneralSchedule | null;
  students: { id: string; name: string; grade: number; roll: string }[];
  events: SessionAttendanceEventRecord[];
}

// ─── Block Delivery Card ──────────────────────────────────────────────────────
function BlockCard({
  block,
  index,
  delivered,
  note,
  onToggle,
  onNoteChange,
}: {
  block: RotationBlock;
  index: number;
  delivered: boolean;
  note: string;
  onToggle: () => void;
  onNoteChange: (v: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View
      style={[
        blockStyles.card,
        { borderLeftColor: delivered ? colors.forest : colors.attention, opacity: delivered ? 1 : 0.8 },
      ]}
    >
      {/* Header row */}
      <Pressable onPress={() => setExpanded(e => !e)} accessibilityRole="button" style={blockStyles.cardHeader}>
        {/* Status pill */}
        <View style={[blockStyles.statusPill, { backgroundColor: delivered ? colors.sageLight : "#FFF3CD" }]}>
          <AppText style={{ fontSize: 12, fontWeight: "800", color: delivered ? colors.forest : colors.attention }}>
            {delivered ? "✓ Delivered" : "⏭ Postponed"}
          </AppText>
        </View>

        <View style={{ flex: 1 }}>
          <AppText style={{ fontWeight: "700", fontSize: 14, color: colors.text }}>
            Block {index + 1}
            {block.teacherGrade ? ` · Teacher → Grade ${block.teacherGrade}` : block.kind === "transition" ? " · Transition" : ""}
            {` (${block.durationMinutes} min)`}
          </AppText>
          <AppText variant="small" muted numberOfLines={expanded ? undefined : 1}>
            {block.teacherActivity}
          </AppText>
        </View>

        <AppText style={{ color: colors.charcoalMuted, fontSize: 18 }}>{expanded ? "↑" : "↓"}</AppText>
      </Pressable>

      {/* Expanded: toggle + note */}
      {expanded && (
        <View style={blockStyles.expanded}>
          <View style={blockStyles.toggleRow}>
            <Button
              label={delivered ? "Mark as Postponed" : "Mark as Delivered"}
              variant={delivered ? "secondary" : "primary"}
              onPress={onToggle}
              style={{ flex: 1 }}
            />
          </View>

          {/* Grade activities */}
          <View style={{ gap: 6 }}>
            {block.activities.map(a => (
              <View key={a.grade} style={blockStyles.activityLine}>
                <View style={[blockStyles.gradeTag, { backgroundColor: a.grade === block.teacherGrade ? colors.sageLight : colors.background }]}>
                  <AppText style={{ fontSize: 11, fontWeight: "700", color: a.grade === block.teacherGrade ? colors.forest : colors.charcoalMuted }}>
                    G{a.grade}
                  </AppText>
                </View>
                <AppText variant="small" style={{ flex: 1, color: colors.charcoal }}>{a.activity}</AppText>
              </View>
            ))}
          </View>

          <TextField
            label="Block notes (optional)"
            value={note}
            onChangeText={onNoteChange}
            multiline
            placeholder="e.g., Grade 2 needed extra time on place value."
          />
        </View>
      )}
    </View>
  );
}

const blockStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderLeftWidth: 5,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
  },
  statusPill: {
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  expanded: {
    padding: 12,
    gap: 10,
    borderTopWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.background,
  },
  toggleRow: {
    flexDirection: "row",
    gap: 8,
  },
  activityLine: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  gradeTag: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function PostClassReviewScreen() {
  const params = useLocalSearchParams<{ sessionId?: string; scheduleId?: string }>();

  const loader = useCallback(async (): Promise<ReviewData> => {
    let s: ClassSessionRecord | null = null;
    if (params.sessionId) {
      s = await getSessionById(params.sessionId);
      if (!s) throw new Error("The requested class session is no longer available.");
    }
    if (!s) s = await getActiveSession();
    if (!s) throw new Error("Session record not found.");

    const schedId = params.scheduleId || s.schedule_id;
    let sched: GeneralSchedule | null = null;
    let relevant: { id: string; name: string; grade: number; roll: string }[] = [];

    if (schedId) {
      sched = await loadGeneralSchedule(schedId);
      const allStudents = await loadStudents();
      relevant = allStudents
        .filter(st => sched!.selection.grades.includes(st.grade))
        .map(st => ({ id: st.id, name: st.name, grade: st.grade, roll: st.rollNumber }));
    }

    const evs = await getSessionAttendanceEvents(s.id);
    return { session: s, schedule: sched, students: relevant, events: evs };
  }, [params.sessionId, params.scheduleId]);

  const { data, error: loadError, loading } = useLocalData(loader);

  // State
  const [deliveryMap, setDeliveryMap]           = useState<Record<string, boolean>>({});
  const [blockNotes, setBlockNotes]             = useState<Record<string, string>>({});
  const [focusedStudents, setFocusedStudents]   = useState<string[]>([]);
  const [attentionReviews, setAttentionReviews] = useState<Record<string, "resolved" | "continue">>({});
  const [exitScores, setExitScores]             = useState<Record<string, string>>({});
  const [exitConcepts, setExitConcepts]         = useState<Record<string, string>>({});
  const [exitMaximum, setExitMaximum]           = useState("10");
  const [observation, setObservation]           = useState("");
  const [saving, setSaving]                     = useState(false);
  const [saveError, setSaveError]               = useState("");
  const [saved, setSaved]                       = useState(false);
  const [initializedDelivery, setInitialized]   = useState(false);

  if (data?.schedule && !initializedDelivery) {
    const initial: Record<string, boolean> = {};
    data.schedule.blocks.forEach(b => { initial[b.id] = b.status !== "postponed"; });
    setDeliveryMap(initial);
    setInitialized(true);
  }

  function toggleStudent(id: string) {
    setFocusedStudents(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  async function handleSave() {
    if (!data?.session) return;
    setSaving(true); setSaveError("");
    try {
      const outcomes = (data.schedule?.blocks ?? []).map(b => ({
        blockId: b.id,
        delivered: deliveryMap[b.id] ?? true,
        notes: blockNotes[b.id] ?? undefined,
      }));

      const exitList = focusedStudents
        .filter(id => exitScores[id]?.trim())
        .map(id => {
          const student = data.students.find(s => s.id === id)!;
          const conceptId = exitConcepts[id] || data.schedule?.needs?.find(n => n.grade === student.grade)?.conceptId;
          const block = data.schedule?.blocks.find(b =>
            b.activities.some(a => a.grade === student.grade && a.conceptId === conceptId)
          );
          const activity = block?.activities.find(a => a.grade === student.grade);
          if (!block || !activity?.conceptId)
            throw new Error("Select a concept from this schedule for each exit assessment.");
          return {
            studentId: id,
            conceptId: activity.conceptId,
            blockId: block.id,
            score: Number(exitScores[id]),
            maximum: Number(exitMaximum),
          };
        });

      await saveSessionOutcomes(
        data.session.id,
        outcomes,
        focusedStudents,
        observation,
        exitList,
        true,
        Object.entries(attentionReviews)
          .filter(([, resolution]) => resolution === "resolved" || resolution === "continue")
          .map(([key, resolution]) => {
            const [gradeText, conceptId, blockId] = key.split("|");
            return { grade: Number(gradeText), conceptId, blockId, resolution: resolution as "resolved" | "continue" };
          }),
      );
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save post-class review.");
    } finally {
      setSaving(false);
    }
  }

  // ── Success screen ──
  if (saved) {
    const deliveredCount = Object.values(deliveryMap).filter(Boolean).length;
    const total = data?.schedule?.blocks.length ?? 0;
    return (
      <Screen topInset={false}>
        <View style={styles.successCard}>
          <AppText style={{ fontSize: 20, fontWeight: '800', color: colors.forest }}>Class complete</AppText>
          <AppText variant="title" style={{ textAlign: "center" }}>Session Complete</AppText>
          <AppText style={{ color: colors.charcoal, textAlign: "center" }}>
            {deliveredCount}/{total} blocks delivered · {focusedStudents.length} students noted
          </AppText>
          <View style={styles.successActions}>
            <Button
              label="Plan Next Class"
              icon="calendar-outline"
              onPress={() => router.push("/general-schedule/new")}
              style={{ flex: 1 }}
            />
            <Button
              label="Weekly Schedule"
              icon="calendar-outline"
              variant="secondary"
              onPress={() => router.push("/weekly-schedule/new")}
              style={{ flex: 1 }}
            />
          </View>
          <Button
            label="Back to Home"
            icon="home-outline"
            variant="quiet"
            onPress={() => router.replace("/(tabs)")}
          />
        </View>
      </Screen>
    );
  }

  if (loading && !data) {
    return <Screen topInset={false}><LoadingState label="Opening the post-class record" /></Screen>;
  }
  if (loadError || !data?.session) {
    return (
      <Screen topInset={false}>
        <AppText variant="title">Post-Class Review</AppText>
        <FormStatus message={loadError || "Session not found."} error />
        <Button label="Back to Schedules" onPress={() => router.replace("/(tabs)/schedule")} />
      </Screen>
    );
  }

  const elapsedMins    = Math.round((data.session.elapsed_seconds ?? 0) / 60);
  const blocksTotal    = data.schedule?.blocks.length ?? 0;
  const eventsCount    = data.events.length;
  const deliveredCount = Object.values(deliveryMap).filter(Boolean).length;

  return (
    <Screen
      topInset={false}
      footer={
        <Button
          label={saving ? "Saving…" : "Save & Conclude Session"}
          icon="checkmark-done-outline"
          disabled={saving}
          onPress={() => void handleSave()}
        />
      }
    >
      {/* ── Header ── */}
      <View style={styles.pageHeader}>
        <AppText variant="title">Post-Class Review</AppText>
        <AppText muted>Record what happened and update student learning estimates.</AppText>
      </View>

      <FormStatus message={saveError} error />

      {/* ── Session summary chips ── */}
      <View style={styles.summaryRow}>
        <SummaryChip icon="⏱" value={`${elapsedMins} min`} label="Duration" />
        <SummaryChip icon="Delivered" value={`${deliveredCount}/${blocksTotal}`} label="Delivered" />
        <SummaryChip icon="Events" value={String(eventsCount)} label="Mid-session" />
        <SummaryChip icon="Students" value={String(focusedStudents.length)} label="Noted" />
      </View>

      {/* ── Section 1: Block delivery ── */}
      <Section title="Rotation Block Delivery" detail="Tap a block to expand, toggle delivery and add notes">
        {data.schedule?.blocks.map((block, idx) => (
          <BlockCard
            key={block.id}
            block={block}
            index={idx}
            delivered={deliveryMap[block.id] ?? true}
            note={blockNotes[block.id] ?? ""}
            onToggle={() => setDeliveryMap(prev => ({ ...prev, [block.id]: !prev[block.id] }))}
            onNoteChange={txt => setBlockNotes(prev => ({ ...prev, [block.id]: txt }))}
          />
        ))}
      </Section>

      {/* ── Section 2: Student interventions ── */}
      <Section
        title="Attention Follow-up"
        detail="For each flagged area, say whether the class resolved it or it should remain in the next plan."
      >
        {data.schedule?.needs?.filter(need => need.conceptId).map(need => {
          const block = data.schedule?.blocks.find(candidate => candidate.activities.some(activity => activity.grade === need.grade && activity.conceptId === need.conceptId));
          const key = `${need.grade}|${need.conceptId}|${block?.id ?? ""}`;
          const selected = attentionReviews[key];
          return <View key={key} style={styles.attentionReview}>
            <View style={{ flex: 1, gap: 2 }}><AppText style={styles.attentionTitle}>Grade {need.grade} · {need.concept}</AppText><AppText variant="small" muted>{need.weak ? `${need.weak} learners need attention` : "Assessment gap to check"}{need.prerequisiteGap ? " · prerequisite first" : ""}</AppText></View>
            <View style={styles.reviewChoices}>
              {(["resolved", "continue"] as const).map(value => <Pressable key={value} onPress={() => setAttentionReviews(old => ({ ...old, [key]: value }))} accessibilityRole="radio" accessibilityState={{ selected: selected === value }} style={[styles.reviewChoice, selected === value && styles.reviewChoiceSelected]}><AppText style={[styles.reviewChoiceText, selected === value && styles.reviewChoiceTextSelected]}>{value === "resolved" ? "Resolved" : "Continue"}</AppText></Pressable>)}
            </View>
          </View>;
        })}
      </Section>

      <Section
        title="Student Interventions"
        detail="Select students who received focused teacher attention"
      >
        <View style={styles.studentGrid}>
          {data.students.map(s => {
            const sel = focusedStudents.includes(s.id);
            return (
              <Pressable
                key={s.id}
                onPress={() => toggleStudent(s.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: sel }}
                style={[styles.studentChip, sel && styles.studentChipSelected]}
              >
                <AppText style={{ fontSize: 11, fontWeight: "700", color: sel ? colors.white : colors.charcoalMuted }}>
                  G{s.grade} · {s.roll}
                </AppText>
                <AppText style={{ fontSize: 12, color: sel ? colors.white : colors.text, fontWeight: sel ? "700" : "400" }} numberOfLines={1}>
                  {s.name}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </Section>

      {/* ── Section 3: Exit assessments ── */}
      {data.schedule && focusedStudents.length > 0 && (
        <Section title="Exit Assessments" detail="Optional: enter marks to update BKT learning estimates">
          <TextField
            label="Maximum marks"
            value={exitMaximum}
            onChangeText={setExitMaximum}
            keyboardType="decimal-pad"
          />
          {data.students.filter(s => focusedStudents.includes(s.id)).map(student => {
            const gradeNeeds = data.schedule?.needs?.filter(n => n.grade === student.grade) ?? [];
            const selectedConcept = exitConcepts[student.id];
            return (
              <View key={student.id} style={styles.exitCard}>
                <View style={styles.exitHeader}>
                  <View style={styles.exitGradeBadge}>
                    <AppText style={{ fontWeight: "900", color: colors.forest, fontSize: 13 }}>G{student.grade}</AppText>
                  </View>
                  <AppText style={{ fontWeight: "700", fontSize: 14, flex: 1 }}>{student.name}</AppText>
                </View>

                {/* Concept picker */}
                <AppText variant="small" muted>Concept assessed:</AppText>
                <View style={styles.conceptPills}>
                  {gradeNeeds.map(n => (
                    <Pressable
                      key={n.conceptId}
                      onPress={() => setExitConcepts(old => ({ ...old, [student.id]: n.conceptId ?? "" }))}
                      accessibilityRole="radio"
                      style={[
                        styles.conceptPill,
                        selectedConcept === n.conceptId && styles.conceptPillSelected,
                      ]}
                    >
                      <AppText style={{ fontSize: 12, fontWeight: "700", color: selectedConcept === n.conceptId ? colors.white : colors.forest }}>
                        {n.concept}
                      </AppText>
                    </Pressable>
                  ))}
                </View>

                <TextField
                  label={`Score for ${student.name} (out of ${exitMaximum})`}
                  value={exitScores[student.id] ?? ""}
                  onChangeText={v => setExitScores(old => ({ ...old, [student.id]: v }))}
                  keyboardType="decimal-pad"
                  placeholder="Leave blank to save notes only"
                />

                {exitScores[student.id] && exitMaximum && (
                  <View style={styles.masteryPreview}>
                    <AppText variant="small" style={{ color: colors.forest }}>
                      Mastery estimate update:{" "}
                      <AppText style={{ fontWeight: "700" }}>
                        {Math.round((Number(exitScores[student.id]) / Number(exitMaximum)) * 100)}%
                      </AppText>
                    </AppText>
                  </View>
                )}
              </View>
            );
          })}
        </Section>
      )}

      {/* ── Section 4: Observation ── */}
      <Section
        title="Classroom Observation"
        detail="Saved as a teacher note against all selected students"
      >
        <TextField
          label="Learning observation"
          value={observation}
          multiline
          onChangeText={setObservation}
          placeholder="e.g., Grade 3 grasped 3-digit subtraction. Two students need concrete counters tomorrow."
        />
      </Section>
    </Screen>
  );
}

// ─── Helper component ─────────────────────────────────────────────────────────
function SummaryChip({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <View style={styles.summaryChip}>
      <AppText style={{ fontSize: 18 }}>{icon}</AppText>
      <AppText style={{ fontWeight: "800", fontSize: 16, color: colors.forest }}>{value}</AppText>
      <AppText variant="small" style={{ color: colors.charcoalMuted, fontSize: 11 }}>{label}</AppText>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  pageHeader: { gap: 6 },
  summaryRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  summaryChip: {
    flex: 1,
    minWidth: 72,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 10,
    alignItems: "center",
    gap: 3,
  },
  studentGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  studentChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    minWidth: 90,
    maxWidth: 140,
    gap: 2,
  },
  studentChipSelected: {
    backgroundColor: colors.forest,
    borderColor: colors.forest,
  },
  exitCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    gap: 8,
  },
  attentionReview: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.lineLight },
  attentionTitle: { fontWeight: "800", color: colors.charcoal },
  reviewChoices: { flexDirection: "row", gap: 5 },
  reviewChoice: { paddingHorizontal: 8, paddingVertical: 7, borderRadius: 9, backgroundColor: colors.paperWarm, borderWidth: 1, borderColor: colors.lineLight },
  reviewChoiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  reviewChoiceText: { fontSize: 10, fontWeight: "800", color: colors.charcoalMuted },
  reviewChoiceTextSelected: { color: colors.white },
  exitHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  exitGradeBadge: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.sageLight,
    alignItems: "center", justifyContent: "center",
  },
  conceptPills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  conceptPill: {
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.sageLight,
    borderWidth: 1,
    borderColor: colors.sage,
  },
  conceptPillSelected: {
    backgroundColor: colors.forest,
    borderColor: colors.forest,
  },
  masteryPreview: {
    backgroundColor: colors.sageLight,
    borderRadius: 8,
    padding: 8,
  },
  successCard: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: spacing.xl,
  },
  successActions: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
});
