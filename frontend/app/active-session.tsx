import { useState, useRef, useCallback } from "react";
import { View, StyleSheet, Modal, Alert } from "react-native";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Screen } from "@/components/Screen";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { FormStatus } from "@/components/FormStatus";
import { useLocalData } from "@/hooks/useLocalData";
import { colors, spacing } from "@/theme";
import {
  startClassSession,
  getActiveSession,
  getSessionById,
  updateSessionProgress,
  pauseClassSession,
  resumeClassSession,
  recordSessionAttendanceEvent,
  getSessionAttendanceEvents,
  effectiveElapsedSeconds
} from "@/services/sessionService";
import { loadGeneralSchedule } from "@/services/generalScheduleService";
import { loadStudents } from "@/services/storageService";
import type { GeneralSchedule, RotationBlock } from "@/types/generalSchedule";
import type { ClassSessionRecord, SessionAttendanceEventRecord } from "@/services/database";

interface ActiveSessionData {
  session: ClassSessionRecord;
  schedule: GeneralSchedule | null;
  students: { id: string; name: string; grade: number; roll: string }[];
  events: SessionAttendanceEventRecord[];
}

export default function ActiveSessionScreen() {
  const params = useLocalSearchParams<{ sessionId?: string; scheduleId?: string }>();

  const loader = useCallback(async (): Promise<ActiveSessionData> => {
    let currentSession: ClassSessionRecord | null = null;
    if (params.sessionId) {
      currentSession = await getSessionById(params.sessionId);
      if (!currentSession) throw new Error("The requested class session is no longer available.");
    }
    if (!currentSession) {
      currentSession = await getActiveSession();
    }
    if (!currentSession && params.scheduleId) {
      currentSession = await startClassSession(params.scheduleId);
    }
    if (!currentSession) {
      throw new Error("No active session found. Please start a session from your schedule.");
    }

    let loadedSchedule: GeneralSchedule | null = null;
    let involvedStudents: { id: string; name: string; grade: number; roll: string }[] = [];
    if (currentSession.schedule_id) {
      loadedSchedule = await loadGeneralSchedule(currentSession.schedule_id);
      const allStudents = await loadStudents();
      const filtered = allStudents.filter(s => loadedSchedule!.selection.grades.includes(s.grade));
      involvedStudents = filtered.map(s => ({ id: s.id, name: s.name, grade: s.grade, roll: s.rollNumber }));
    }

    const events = await getSessionAttendanceEvents(currentSession.id);
    return { session: currentSession, schedule: loadedSchedule, students: involvedStudents, events };
  }, [params.sessionId, params.scheduleId]);

  const { data, error: loadError, loading, reload } = useLocalData(loader);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const actionPending = useRef(false);
  const currentBlockIndex = data?.session.current_block_index ?? 0;
  const status = data?.session.status ?? "active";

  // Attendance modal state
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [attendanceMsg, setAttendanceMsg] = useState("");

  // Stack screens stay mounted behind the review. Only the focused screen may
  // sync progress; useLocalData reloads the persisted status on every focus.
  useFocusEffect(useCallback(() => {
    const current = data?.session;
    if (!current || loading || loadError || actionBusy) return;
    setElapsedSeconds(effectiveElapsedSeconds(current));
    if (current.status !== "active") return;

    let cancelled = false;
    let syncing = false;
    let ticks = 0;
    const timer = setInterval(() => {
      if (cancelled) return;
      const next = effectiveElapsedSeconds(current);
      setElapsedSeconds(next);
      ticks += 1;
      if (ticks < 10 || syncing) return;
      ticks = 0;
      syncing = true;
      void updateSessionProgress(current.id, current.current_block_index, next)
        .catch(e => {
          if (cancelled) return;
          clearInterval(timer);
          setActionError(e instanceof Error ? e.message : "Failed to save session progress.");
          void reload();
        })
        .finally(() => { syncing = false; });
    }, 1000);
    const maybeNodeTimer = timer as unknown as { unref?: () => void };
    maybeNodeTimer.unref?.();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [data?.session, loading, loadError, actionBusy, reload]));

  async function handlePauseResume() {
    if (!data?.session || status === "completed" || actionPending.current) return;
    actionPending.current = true;
    setActionBusy(true);
    setActionError("");
    try {
      if (status === "active") {
        await pauseClassSession(data.session.id, effectiveElapsedSeconds(data.session));
      } else {
        await resumeClassSession(data.session.id);
      }
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to change session status.");
      await reload();
    } finally {
      actionPending.current = false;
      setActionBusy(false);
    }
  }

  async function handleChangeBlock(index: number) {
    if (!data?.schedule || !data?.session || status === "completed" || actionPending.current || index < 0 || index >= data.schedule.blocks.length) return;
    actionPending.current = true;
    setActionBusy(true);
    setActionError("");
    try {
      await updateSessionProgress(data.session.id, index, effectiveElapsedSeconds(data.session));
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to change rotation block.");
      await reload();
    } finally {
      actionPending.current = false;
      setActionBusy(false);
    }
  }

  async function handleRecordAttendance(eventType: "arrived" | "left" | "returned") {
    if (!data?.session || !selectedStudentId) return;
    try {
      await recordSessionAttendanceEvent(data.session.id, selectedStudentId, eventType);
      const st = data.students.find(s => s.id === selectedStudentId);
      setAttendanceMsg(`${st?.name ?? "Student"} marked as ${eventType}.`);
      setSelectedStudentId("");
    } catch (e) {
      setAttendanceMsg(e instanceof Error ? e.message : "Failed to record event.");
    }
  }

  function handleFinishClass() {
    if (!data?.session) return;
    const openReview = () => router.push({
      pathname: "/post-class-review",
      params: { sessionId: data.session.id, scheduleId: data.schedule?.id ?? "" }
    });
    if (status === "completed") {
      openReview();
      return;
    }
    Alert.alert(
      "Finish Class Session",
      "Are you ready to conclude this class and proceed to the post-class review?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Proceed to Review",
          onPress: openReview
        }
      ]
    );
  }

  const formatTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  if (loading && !data) {
    return (
      <Screen topInset={false}>
        <AppText>Opening active session...</AppText>
      </Screen>
    );
  }

  if (loadError || !data?.session) {
    return (
      <Screen topInset={false}>
        <AppText variant="title">Active Class</AppText>
        <FormStatus message={loadError || "Session not found."} error />
        <Button label="Back to Schedules" onPress={() => router.replace("/(tabs)/schedule")} />
      </Screen>
    );
  }

  const schedule = data.schedule;
  const currentBlock: RotationBlock | undefined = schedule?.blocks[currentBlockIndex];
  const blockStartMin = schedule?.blocks.slice(0, currentBlockIndex).reduce((acc, b) => acc + b.durationMinutes, 0) ?? 0;
  const blockTargetSec = (currentBlock?.durationMinutes ?? 0) * 60;
  const elapsedInBlock = Math.max(0, elapsedSeconds - blockStartMin * 60);
  const blockOvertime = elapsedInBlock > blockTargetSec;

  return (
    <Screen
      topInset={false}
      footer={
        <View style={styles.footerControls}>
          <Button
            label={status === "completed" ? "Completed" : status === "active" ? "Pause" : "Resume"}
            icon={status === "active" ? "pause-outline" : "play-outline"}
            variant="secondary"
            disabled={loading || actionBusy || status === "completed"}
            onPress={() => void handlePauseResume()}
            style={{ flex: 1 }}
          />
          <Button
            label="Attendance note"
            disabled={loading || actionBusy || status === "completed"}
            icon="people-outline"
            variant="quiet"
            onPress={() => setShowAttendanceModal(true)}
            style={{ flex: 1 }}
          />
          <Button
            label={status === "completed" ? "View class review" : "End & Review"}
            disabled={loading || actionBusy}
            icon="checkmark-done-outline"
            onPress={handleFinishClass}
            style={{ flex: 1 }}
          />
        </View>
      }
    >
      <View style={styles.sessionHeader}>
        <View style={{ flex: 1 }}>
          <AppText variant="title">Active Class Execution</AppText>
          <AppText muted>
            {schedule ? `Grades ${schedule.selection.grades.join(", ")} · ${schedule.selection.availableMinutes} min planned` : "In-class mode"}
          </AppText>
        </View>
        <View style={[styles.timerBadge, { backgroundColor: status === "active" ? colors.sageLight : colors.line }]}>
          <AppText style={styles.timerText}>{formatTime(elapsedSeconds)}</AppText>
          <AppText variant="small" style={{ color: status === "active" ? colors.forest : colors.charcoal, fontWeight: "700" }}>
            {status.toUpperCase()}
          </AppText>
        </View>
      </View>

      <FormStatus message={actionError} error />

      {schedule ? (
        <View style={styles.blockNav}>
          <Button
            label="← Prev"
            variant="quiet"
            disabled={loading || actionBusy || status === "completed" || currentBlockIndex <= 0}
            onPress={() => void handleChangeBlock(currentBlockIndex - 1)}
          />
          <View style={{ alignItems: "center" }}>
            <AppText variant="subheading">
              {`Block ${currentBlockIndex + 1} of ${schedule.blocks.length}`}
            </AppText>
            <AppText variant="small" muted>
              Planned: {currentBlock?.durationMinutes ?? 0} min · Block elapsed: {formatTime(elapsedInBlock)}
            </AppText>
          </View>
          <Button
            label="Next →"
            variant="quiet"
            disabled={loading || actionBusy || status === "completed" || currentBlockIndex >= schedule.blocks.length - 1}
            onPress={() => void handleChangeBlock(currentBlockIndex + 1)}
          />
        </View>
      ) : null}

      {blockOvertime ? (
        <View style={styles.alertBanner}>
          <AppText style={{ color: colors.attention, fontWeight: "700" }}>
            ⏰ Rotation Time Reached!
          </AppText>
          <AppText style={{ color: colors.charcoal }}>
            Target block duration of {currentBlock?.durationMinutes} min completed. Wrap up guided group work and transition.
          </AppText>
        </View>
      ) : null}

      {currentBlock ? (
        <View style={styles.blockCard}>
          <View style={styles.teacherFocusSection}>
            <View style={styles.badgeRow}>
              <View style={styles.teacherBadge}>
                <AppText style={styles.teacherBadgeText}>
                  {currentBlock.teacherGrade ? `TEACHER WITH GRADE ${currentBlock.teacherGrade}` : "TEACHER TRANSITION"}
                </AppText>
              </View>
            </View>
            <AppText variant="subheading" style={{ color: colors.forest, marginTop: 4 }}>
              {currentBlock.teacherActivity}
            </AppText>
            <AppText variant="small" muted style={{ marginTop: 2 }}>
              Rationale: {currentBlock.reason}
            </AppText>
          </View>

          <View style={styles.unattendedSection}>
            <AppText variant="subheading" style={{ fontSize: 15, marginBottom: 6 }}>
              Synchronized Student Cohorts
            </AppText>
            {currentBlock.activities.map(a => {
              const isTeacherGrade = a.grade === currentBlock.teacherGrade;
              return (
                <View
                  key={a.grade}
                  style={[
                    styles.cohortRow,
                    isTeacherGrade ? styles.cohortTeacherActive : styles.cohortIndependent
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <AppText style={{ fontWeight: "700", color: isTeacherGrade ? colors.forest : colors.charcoal }}>
                      Grade {a.grade}: {a.concept} {isTeacherGrade ? "· (Guided Attention)" : "· (Self-Directed / Peer Practice)"}
                    </AppText>
                    <AppText style={{ marginTop: 2 }}>{a.activity}</AppText>
                    <AppText variant="small" muted style={{ marginTop: 2 }}>
                      Objective: {a.objective}
                    </AppText>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      <Button
        label="Ask Copilot for Teaching Tips"
        icon="chatbubble-ellipses-outline"
        variant="quiet"
        onPress={() =>
          router.push({
            pathname: "/chatbot",
            params: {
              screenContext: "active_session",
              conceptId: currentBlock?.activities[0]?.concept
            }
          })
        }
      />

      <Modal visible={showAttendanceModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <AppText variant="title">Record Mid-Session Event</AppText>
            <AppText muted>Log arrival or departure without overwriting daily attendance.</AppText>
            {attendanceMsg ? <AppText style={{ color: colors.forest, marginVertical: 4 }}>{attendanceMsg}</AppText> : null}

            <View style={{ maxHeight: 200, marginVertical: 10 }}>
              {data.students.map(s => (
                <Button
                  key={s.id}
                  label={`Gr ${s.grade} · Roll ${s.roll} · ${s.name}`}
                  variant={selectedStudentId === s.id ? "primary" : "quiet"}
                  onPress={() => setSelectedStudentId(s.id)}
                  style={{ marginBottom: 6 }}
                />
              ))}
            </View>

            <View style={{ flexDirection: "row", gap: 8, marginVertical: 8 }}>
              <Button
                label="Arrived Late"
                disabled={!selectedStudentId}
                variant="secondary"
                onPress={() => void handleRecordAttendance("arrived")}
                style={{ flex: 1 }}
              />
              <Button
                label="Left Early"
                disabled={!selectedStudentId}
                variant="secondary"
                onPress={() => void handleRecordAttendance("left")}
                style={{ flex: 1 }}
              />
              <Button
                label="Returned"
                disabled={!selectedStudentId}
                variant="secondary"
                onPress={() => void handleRecordAttendance("returned")}
                style={{ flex: 1 }}
              />
            </View>

            <Button
              label="Close"
              variant="quiet"
              onPress={() => {
                setShowAttendanceModal(false);
                setAttendanceMsg("");
                void reload();
              }}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sessionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderColor: colors.line
  },
  timerBadge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center"
  },
  timerText: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.forest,
    fontVariant: ["tabular-nums"]
  },
  blockNav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.surface,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line
  },
  alertBanner: {
    backgroundColor: colors.sageLight,
    borderLeftWidth: 4,
    borderColor: colors.attention,
    padding: 12,
    borderRadius: 6,
    gap: 4
  },
  blockCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    padding: spacing.md,
    gap: spacing.md
  },
  teacherFocusSection: {
    backgroundColor: colors.sageLight,
    padding: spacing.md,
    borderRadius: 6,
    borderLeftWidth: 4,
    borderColor: colors.forest
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center"
  },
  teacherBadge: {
    backgroundColor: colors.forest,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4
  },
  teacherBadgeText: {
    color: colors.white,
    fontWeight: "800",
    fontSize: 12
  },
  unattendedSection: {
    gap: 8
  },
  cohortRow: {
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.line
  },
  cohortTeacherActive: {
    borderLeftWidth: 4,
    borderLeftColor: colors.forest,
    backgroundColor: colors.surface
  },
  cohortIndependent: {
    borderLeftWidth: 4,
    borderLeftColor: colors.line,
    backgroundColor: colors.surface
  },
  footerControls: {
    flexDirection: "row",
    gap: 8
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
    gap: 8
  }
});
