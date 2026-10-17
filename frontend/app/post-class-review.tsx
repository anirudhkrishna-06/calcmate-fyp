import { useState, useCallback } from "react";
import { View, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Screen } from "@/components/Screen";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { FormStatus } from "@/components/FormStatus";
import { Section } from "@/components/Workspace";
import { useLocalData } from "@/hooks/useLocalData";
import { colors, spacing } from "@/theme";
import {
  getSessionById,
  getActiveSession,
  completeClassSession,
  saveSessionOutcomes,
  getSessionAttendanceEvents
} from "@/services/sessionService";
import { loadGeneralSchedule, saveGeneralBlocks } from "@/services/generalScheduleService";
import { loadStudents } from "@/services/storageService";
import type { GeneralSchedule, RotationBlock } from "@/types/generalSchedule";
import type { ClassSessionRecord, SessionAttendanceEventRecord } from "@/services/database";

interface ReviewData {
  session: ClassSessionRecord;
  schedule: GeneralSchedule | null;
  students: { id: string; name: string; grade: number; roll: string }[];
  events: SessionAttendanceEventRecord[];
}

export default function PostClassReviewScreen() {
  const params = useLocalSearchParams<{ sessionId?: string; scheduleId?: string }>();

  const loader = useCallback(async (): Promise<ReviewData> => {
    let s: ClassSessionRecord | null = null;
    if (params.sessionId) {
      s = await getSessionById(params.sessionId);
      if (!s) throw new Error("The requested class session is no longer available.");
    }
    if (!s) {
      s = await getActiveSession();
    }
    if (!s) throw new Error("Session record not found.");

    const schedId = params.scheduleId || s.schedule_id;
    let sched: GeneralSchedule | null = null;
    let relevant: { id: string; name: string; grade: number; roll: string }[] = [];

    if (schedId) {
      sched = await loadGeneralSchedule(schedId);
      const allStudents = await loadStudents();
      const filtered = allStudents.filter(st => sched!.selection.grades.includes(st.grade));
      relevant = filtered.map(st => ({ id: st.id, name: st.name, grade: st.grade, roll: st.rollNumber }));
    }

    const evs = await getSessionAttendanceEvents(s.id);
    return { session: s, schedule: sched, students: relevant, events: evs };
  }, [params.sessionId, params.scheduleId]);

  const { data, error: loadError, loading } = useLocalData(loader);

  const [deliveryMap, setDeliveryMap] = useState<Record<string, boolean>>({});
  const [blockNotes, setBlockNotes] = useState<Record<string, string>>({});
  const [focusedStudents, setFocusedStudents] = useState<string[]>([]);
  const [observation, setObservation] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const [initializedDelivery, setInitializedDelivery] = useState(false);

  if (data?.schedule && !initializedDelivery) {
    const initial: Record<string, boolean> = {};
    data.schedule.blocks.forEach(b => {
      initial[b.id] = b.status !== "postponed";
    });
    setDeliveryMap(initial);
    setInitializedDelivery(true);
  }

  function toggleDelivery(blockId: string) {
    setDeliveryMap(prev => ({ ...prev, [blockId]: !prev[blockId] }));
  }

  function toggleStudentFocus(studentId: string) {
    setFocusedStudents(prev => {
      if (prev.includes(studentId)) {
        return prev.filter(id => id !== studentId);
      }
      return [...prev, studentId];
    });
  }

  async function handleSaveReview() {
    if (!data?.session) return;
    setSaving(true);
    setSaveError("");
    try {
      await completeClassSession(data.session.id);

      const outcomes = (data.schedule?.blocks ?? []).map(b => ({
        blockId: b.id,
        delivered: deliveryMap[b.id] ?? true,
        notes: blockNotes[b.id] ?? undefined
      }));

      await saveSessionOutcomes(
        data.session.id,
        outcomes,
        focusedStudents,
        observation
      );

      if (data.schedule) {
        const updatedBlocks = data.schedule.blocks.map(b => ({
          ...b,
          status: (deliveryMap[b.id] ? "completed" : "postponed") as RotationBlock["status"]
        }));
        await saveGeneralBlocks(data.schedule.id, updatedBlocks);
      }

      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save post-class review.");
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <Screen topInset={false}>
        <View style={styles.successContainer}>
          <AppText variant="title">Review Saved!</AppText>
          <AppText style={{ color: colors.forest, marginTop: 8 }}>
            Class session closed. Outcomes, block deliveries, and student learning notes have been recorded.
          </AppText>
          <Button
            label="Return to Classroom Home"
            icon="home-outline"
            style={{ marginTop: 24 }}
            onPress={() => router.replace("/(tabs)")}
          />
        </View>
      </Screen>
    );
  }

  if (loading && !data) {
    return (
      <Screen topInset={false}>
        <AppText>Opening post-class review...</AppText>
      </Screen>
    );
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

  const elapsedMins = Math.round((data.session.elapsed_seconds ?? 0) / 60);

  return (
    <Screen
      topInset={false}
      footer={
        <Button
          label={saving ? "Saving review..." : "Save Review & Conclude"}
          icon="checkmark-done-outline"
          disabled={saving}
          onPress={() => void handleSaveReview()}
        />
      }
    >
      <AppText variant="title">Post-Class Review</AppText>
      <AppText muted>
        Verify planned vs delivered instruction and record student intervention notes.
      </AppText>
      <FormStatus message={saveError} error />

      <View style={styles.statRow}>
        <View>
          <AppText variant="subheading">{elapsedMins} min</AppText>
          <AppText variant="small" muted>Class duration</AppText>
        </View>
        <View>
          <AppText variant="subheading">{data.schedule?.blocks.length ?? 0}</AppText>
          <AppText variant="small" muted>Rotation blocks</AppText>
        </View>
        <View>
          <AppText variant="subheading">{data.events.length}</AppText>
          <AppText variant="small" muted>Mid-class events</AppText>
        </View>
      </View>

      <Section title="Rotation Block Delivery" detail="Check blocks that were successfully delivered">
        {data.schedule?.blocks.map((block, idx) => {
          const isDelivered = deliveryMap[block.id] ?? true;
          return (
            <View key={block.id} style={styles.reviewCard}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <AppText style={{ fontWeight: "700" }}>
                    {`Block ${idx + 1}: ${block.teacherGrade ? `Teacher → Grade ${block.teacherGrade}` : "Transition"} (${block.durationMinutes} min)`}
                  </AppText>
                  <AppText variant="small" muted>{block.teacherActivity}</AppText>
                </View>
                <Button
                  label={isDelivered ? "Delivered ✓" : "Postponed ✕"}
                  variant={isDelivered ? "primary" : "secondary"}
                  onPress={() => toggleDelivery(block.id)}
                />
              </View>
              <TextField
                label="Block notes (optional)"
                value={blockNotes[block.id] ?? ""}
                onChangeText={txt => setBlockNotes(prev => ({ ...prev, [block.id]: txt }))}
              />
            </View>
          );
        })}
      </Section>

      <Section title="Individual Attention Receipts" detail="Select students who received focused teacher intervention">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {data.students.map(s => {
            const isSelected = focusedStudents.includes(s.id);
            return (
              <Button
                key={s.id}
                label={`Gr ${s.grade} · ${s.name}`}
                variant={isSelected ? "primary" : "quiet"}
                onPress={() => toggleStudentFocus(s.id)}
              />
            );
          })}
        </View>
      </Section>

      <Section title="Classroom Learning Observation" detail="Feeds directly into student profiles & next session planning">
        <TextField
          label="Learning observation"
          value={observation}
          multiline
          onChangeText={setObservation}
          placeholder="e.g., Grade 3 grasped 3-digit subtraction, but 2 students need concrete counters tomorrow."
        />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statRow: {
    flexDirection: "row",
    gap: 24,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderTopWidth: 1,
    borderColor: colors.line
  },
  reviewCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 8
  },
  successContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    gap: 12
  }
});
