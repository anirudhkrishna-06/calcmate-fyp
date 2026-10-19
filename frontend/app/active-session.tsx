/**
 * Active Session — In-Class view (refined for Review 3).
 *
 * Key refinements:
 *  • Period-aware timer: shows which 40-min school period is active
 *    based on wall-clock time (09:00, 09:45, 10:50, 11:35, 13:00)
 *  • Block progress bar with overtime indicator
 *  • Styled cohort cards: guided (forest accent) vs independent (subtle)
 *  • Mastery urgency chip per grade activity
 *  • Knowledge Graph quick-link per activity
 *  • AI Copilot shortcut contextualised to current block concept
 *  • Cleaner attendance modal with student search
 */
import { useState, useRef, useCallback } from "react";
import { View, StyleSheet, Modal, Pressable } from "react-native";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Screen } from "@/components/Screen";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { FormStatus } from "@/components/FormStatus";
import { LoadingState } from "@/components/LoadingState";
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
  effectiveElapsedSeconds,
} from "@/services/sessionService";
import { loadGeneralSchedule } from "@/services/generalScheduleService";
import { loadStudents } from "@/services/storageService";
import type { GeneralSchedule, RotationBlock } from "@/types/generalSchedule";
import type { ClassSessionRecord, SessionAttendanceEventRecord } from "@/services/database";

// ─── Period time slots (wall-clock minutes from midnight) ─────────────────────
const SCHOOL_PERIODS = [
  { label: "Period 1", startHHMM: "09:00", endHHMM: "09:40" },
  { label: "Period 2", startHHMM: "09:45", endHHMM: "10:25" },
  { label: "Period 3", startHHMM: "10:50", endHHMM: "11:30" },
  { label: "Period 4", startHHMM: "11:35", endHHMM: "12:15" },
  { label: "Period 5", startHHMM: "13:00", endHHMM: "13:40" },
];

function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Returns the current school period label based on wall clock, or null */
function getCurrentPeriodLabel(): string | null {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (const p of SCHOOL_PERIODS) {
    if (nowMin >= parseHHMM(p.startHHMM) && nowMin < parseHHMM(p.endHHMM)) {
      return p.label;
    }
  }
  return null;
}

/** Minutes remaining in the current school period, or null */
function minutesLeftInPeriod(): number | null {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (const p of SCHOOL_PERIODS) {
    if (nowMin >= parseHHMM(p.startHHMM) && nowMin < parseHHMM(p.endHHMM)) {
      return parseHHMM(p.endHHMM) - nowMin;
    }
  }
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(totalSec: number): string {
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function blockProgress(elapsedInBlock: number, targetSec: number): number {
  return Math.min(1, elapsedInBlock / Math.max(1, targetSec));
}

// ─── Block Progress Bar ───────────────────────────────────────────────────────
function BlockProgressBar({ progress, overtime }: { progress: number; overtime: boolean }) {
  return (
    <View style={progressStyles.track}>
      <View
        style={[
          progressStyles.fill,
          {
            width: `${Math.min(100, Math.round(progress * 100))}%` as any,
            backgroundColor: overtime ? colors.danger : progress > 0.8 ? colors.attention : colors.forest,
          },
        ]}
      />
    </View>
  );
}

const progressStyles = StyleSheet.create({
  track: { height: 6, backgroundColor: colors.line, borderRadius: 3, overflow: "hidden" },
  fill:  { height: "100%", borderRadius: 3 },
});

// ─── Cohort Activity Card ─────────────────────────────────────────────────────
function CohortCard({ activity, isGuided, gradeNeed }: {
  activity: RotationBlock["activities"][0];
  isGuided: boolean;
  gradeNeed?: { weak: number; attending: number; prerequisiteGap: boolean };
}) {
  const urgency = gradeNeed && gradeNeed.attending > 0
    ? gradeNeed.weak / gradeNeed.attending > 0.5 ? "high"
    : gradeNeed.weak > 0 ? "medium" : "low"
    : "low";

  const urgencyColor = urgency === "high" ? colors.danger : urgency === "medium" ? colors.attention : colors.forest;

  return (
    <View style={[cohortStyles.card, isGuided ? cohortStyles.guided : cohortStyles.independent]}>
      {/* Grade + urgency */}
      <View style={cohortStyles.cardHeader}>
        <View style={[cohortStyles.gradeBadge, { backgroundColor: isGuided ? colors.forest : colors.sageLight }]}>
          <AppText style={{ fontWeight: "900", fontSize: 13, color: isGuided ? colors.white : colors.forest }}>
            G{activity.grade}
          </AppText>
        </View>

        <View style={{ flex: 1 }}>
          <View style={cohortStyles.conceptRow}>
            <AppText style={{ fontWeight: "700", fontSize: 14, color: isGuided ? colors.forest : colors.text }}>
              {activity.concept}
            </AppText>
            {isGuided && (
              <View style={cohortStyles.guidedPill}>
                <AppText style={{ fontSize: 10, fontWeight: "800", color: colors.white }}>GUIDED</AppText>
              </View>
            )}
            {!isGuided && activity.activityType && <View style={cohortStyles.activityTypePill}><AppText style={{ fontSize: 10, fontWeight: "800", color: colors.forest }}>{activity.activityType.toUpperCase()}</AppText></View>}
            {gradeNeed && gradeNeed.weak > 0 && (
              <View style={[cohortStyles.urgencyPill, { backgroundColor: urgency === "high" ? "#FDE8E8" : "#FFF3CD" }]}>
                <AppText style={{ fontSize: 10, fontWeight: "700", color: urgencyColor }}>
                  {gradeNeed.weak} need support
                </AppText>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Activity */}
      <AppText style={{ fontSize: 13, color: colors.charcoal, marginLeft: 42 }}>{activity.activity}</AppText>

      {/* Objective */}
      <AppText variant="small" muted style={{ marginLeft: 42, fontSize: 12 }}>
        Objective: {activity.objective}
      </AppText>

      {/* Knowledge graph link */}
      {activity.conceptId && (
        <Pressable
          onPress={() =>
            router.push({
              pathname: "/curriculum",
              params: { grade: String(activity.grade), conceptId: activity.conceptId, origin: "active-session" },
            })
          }
          style={cohortStyles.graphLink}
          accessibilityRole="button"
          accessibilityLabel={`Open knowledge graph for ${activity.concept}`}
        >
          <AppText style={{ fontSize: 12, color: colors.forest, fontWeight: "600" }}>Knowledge Graph</AppText>
        </Pressable>
      )}
    </View>
  );
}

const cohortStyles = StyleSheet.create({
  card: {
    borderRadius: 10,
    padding: 12,
    gap: 6,
    borderWidth: 1,
  },
  guided: {
    backgroundColor: colors.sageLight,
    borderColor: colors.sage,
    borderLeftWidth: 4,
    borderLeftColor: colors.forest,
  },
  independent: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderLeftWidth: 4,
    borderLeftColor: colors.line,
  },
  cardHeader: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  gradeBadge: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
  },
  conceptRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  guidedPill: {
    backgroundColor: colors.forest, borderRadius: 12,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  urgencyPill: {
    borderRadius: 12, paddingHorizontal: 7, paddingVertical: 2,
  },
  activityTypePill: { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: colors.primarySurface },
  graphLink: {
    marginLeft: 42, alignSelf: "flex-start",
    backgroundColor: colors.surface, borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: colors.line,
  },
});

// ─── Types ────────────────────────────────────────────────────────────────────
interface ActiveSessionData {
  session: ClassSessionRecord;
  schedule: GeneralSchedule | null;
  students: { id: string; name: string; grade: number; roll: string }[];
  events: SessionAttendanceEventRecord[];
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ActiveSessionScreen() {
  const params = useLocalSearchParams<{ sessionId?: string; scheduleId?: string }>();

  const loader = useCallback(async (): Promise<ActiveSessionData> => {
    let currentSession: ClassSessionRecord | null = null;
    if (params.sessionId) {
      currentSession = await getSessionById(params.sessionId);
      if (!currentSession) throw new Error("The requested class session is no longer available.");
    }
    if (!currentSession) currentSession = await getActiveSession();
    if (!currentSession && params.scheduleId) currentSession = await startClassSession(params.scheduleId);
    if (!currentSession) throw new Error("No active session found. Please start a session from your schedule.");

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
  const [actionError, setActionError]       = useState("");
  const [actionBusy, setActionBusy]         = useState(false);
  const actionPending                        = useRef(false);
  const currentBlockIndex                    = data?.session.current_block_index ?? 0;
  const status                               = data?.session.status ?? "active";

  // Period label (wall-clock)
  const [periodLabel, setPeriodLabel]       = useState(getCurrentPeriodLabel);
  const [minsLeft, setMinsLeft]             = useState(minutesLeftInPeriod);

  // Attendance modal
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [selectedStudentId, setSelectedStudentId]     = useState("");
  const [attendanceMsg, setAttendanceMsg]             = useState("");
  const [studentSearch, setStudentSearch]             = useState("");

  useFocusEffect(useCallback(() => {
    const current = data?.session;
    if (!current || loading || loadError || actionBusy) return;
    setElapsedSeconds(effectiveElapsedSeconds(current));
    if (current.status !== "active") return;

    let cancelled = false, syncing = false, ticks = 0;
    const timer = setInterval(() => {
      if (cancelled) return;
      const next = effectiveElapsedSeconds(current);
      setElapsedSeconds(next);
      setPeriodLabel(getCurrentPeriodLabel());
      setMinsLeft(minutesLeftInPeriod());
      ticks++;
      if (ticks < 10 || syncing) return;
      ticks = 0; syncing = true;
      void updateSessionProgress(current.id, current.current_block_index, next)
        .catch(e => {
          if (cancelled) return;
          clearInterval(timer);
          setActionError(e instanceof Error ? e.message : "Failed to save session progress.");
          void reload();
        })
        .finally(() => { syncing = false; });
    }, 1000);
    (timer as any).unref?.();
    return () => { cancelled = true; clearInterval(timer); };
  }, [data?.session, loading, loadError, actionBusy, reload]));

  async function handlePauseResume() {
    if (!data?.session || status === "completed" || actionPending.current) return;
    actionPending.current = true; setActionBusy(true); setActionError("");
    try {
      if (status === "active") await pauseClassSession(data.session.id, effectiveElapsedSeconds(data.session));
      else await resumeClassSession(data.session.id);
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to change session status.");
      await reload();
    } finally { actionPending.current = false; setActionBusy(false); }
  }

  async function handleChangeBlock(index: number) {
    if (!data?.schedule || !data?.session || status === "completed" || actionPending.current) return;
    if (index < 0 || index >= data.schedule.blocks.length) return;
    actionPending.current = true; setActionBusy(true); setActionError("");
    try {
      await updateSessionProgress(data.session.id, index, effectiveElapsedSeconds(data.session));
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to change rotation block.");
      await reload();
    } finally { actionPending.current = false; setActionBusy(false); }
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
    const go = () =>
      router.push({
        pathname: "/post-class-review",
        params: { sessionId: data.session.id, scheduleId: data.schedule?.id ?? "" },
      });
    if (status === "completed") { go(); return; }
    go();
  }

  if (loading && !data) {
    return <Screen topInset={false}><LoadingState label="Opening your active classroom" /></Screen>;
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

  const schedule         = data.schedule;
  const currentBlock     = schedule?.blocks[currentBlockIndex] as RotationBlock | undefined;
  const blockStartSec    = (schedule?.blocks.slice(0, currentBlockIndex).reduce((a, b) => a + b.durationMinutes, 0) ?? 0) * 60;
  const blockTargetSec   = (currentBlock?.durationMinutes ?? 0) * 60;
  const elapsedInBlock   = Math.max(0, elapsedSeconds - blockStartSec);
  const blockOvertime    = elapsedInBlock > blockTargetSec;
  const progress         = blockProgress(elapsedInBlock, blockTargetSec);
  const currentNeed      = schedule?.needs?.find(n => n.grade === currentBlock?.teacherGrade);

  const filteredStudents = data.students.filter(s =>
    !studentSearch || s.name.toLowerCase().includes(studentSearch.toLowerCase()) || s.roll.includes(studentSearch)
  );

  return (
    <Screen
      topInset={false}
      footer={
        <View style={styles.footerRow}>
          <Button
            label={status === "active" ? "Pause" : status === "completed" ? "Done" : "Resume"}
            icon={status === "active" ? "pause-outline" : "play-outline"}
            variant="secondary"
            disabled={loading || actionBusy || status === "completed"}
            onPress={() => void handlePauseResume()}
            style={{ flex: 1 }}
          />
          <Button
            label="Attendance"
            icon="people-outline"
            variant="quiet"
            disabled={loading || actionBusy || status === "completed"}
            onPress={() => setShowAttendanceModal(true)}
            style={{ flex: 1 }}
          />
          <Button
            label={status === "completed" ? "Review" : "End & Review"}
            icon="checkmark-done-outline"
            disabled={loading || actionBusy}
            onPress={handleFinishClass}
            style={{ flex: 1 }}
          />
        </View>
      }
    >
      {/* ── Session Header ── */}
      <View style={styles.sessionHeader}>
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="title">In-Class</AppText>
          {schedule && (
            <AppText muted>Grades {schedule.selection.grades.join(", ")} · {schedule.selection.availableMinutes} min</AppText>
          )}
          {periodLabel && (
            <View style={styles.periodBadge}>
              <AppText style={{ fontSize: 12, fontWeight: "700", color: colors.forest }}>
                {periodLabel}{minsLeft !== null ? ` · ${minsLeft} min left` : ""}
              </AppText>
            </View>
          )}
        </View>

        {/* Timer */}
        <View style={[styles.timerBox, { backgroundColor: status === "active" ? colors.sageLight : colors.line }]}>
          <AppText style={styles.timerText}>{formatTime(elapsedSeconds)}</AppText>
          <AppText variant="small" style={{ color: status === "active" ? colors.forest : colors.charcoal, fontWeight: "700", fontSize: 11 }}>
            {status.toUpperCase()}
          </AppText>
        </View>
      </View>

      <FormStatus message={actionError} error />

      {/* ── Block navigation ── */}
      {schedule && (
        <View style={styles.blockNav}>
          <Button
            label="← Prev"
            variant="quiet"
            disabled={loading || actionBusy || status === "completed" || currentBlockIndex <= 0}
            onPress={() => void handleChangeBlock(currentBlockIndex - 1)}
            style={{ minWidth: 0, paddingHorizontal: 12 }}
          />
          <View style={{ alignItems: "center", flex: 1 }}>
            <AppText variant="subheading" style={{ fontSize: 15 }}>
              Block {currentBlockIndex + 1} / {schedule.blocks.length}
            </AppText>
            <AppText variant="small" muted>
              {currentBlock?.durationMinutes ?? 0} min planned · {formatTime(elapsedInBlock)} elapsed
            </AppText>
            <BlockProgressBar progress={progress} overtime={blockOvertime} />
          </View>
          <Button
            label="Next →"
            variant="quiet"
            disabled={loading || actionBusy || status === "completed" || currentBlockIndex >= schedule.blocks.length - 1}
            onPress={() => void handleChangeBlock(currentBlockIndex + 1)}
            style={{ minWidth: 0, paddingHorizontal: 12 }}
          />
        </View>
      )}

      {/* ── Overtime alert ── */}
      {blockOvertime && (
        <View style={styles.overtimeBanner}>
          <AppText style={{ fontWeight: "700", color: colors.danger }}>⏰ Rotation time reached!</AppText>
          <AppText variant="small" style={{ color: colors.charcoal }}>
            {currentBlock?.durationMinutes} min block complete. Wrap up and transition.
          </AppText>
        </View>
      )}

      {/* ── Current block ── */}
      <View style={styles.classSummaryCard}>
        <View style={styles.summaryHeader}><AppText variant="subheading">Class Summary</AppText><AppText variant="small" muted>{data.students.length} learners in this rotation</AppText></View>
        <View style={styles.summaryStats}><View><AppText style={styles.summaryValue}>{currentBlock?.teacherGrade ? `G${currentBlock.teacherGrade}` : 'All'}</AppText><AppText variant="small" muted>teacher focus</AppText></View><View><AppText style={styles.summaryValue}>{currentNeed?.weak ?? 0}</AppText><AppText variant="small" muted>need attention</AppText></View><View><AppText style={styles.summaryValue}>{data.events.length}</AppText><AppText variant="small" muted>attendance events</AppText></View></View>
        <AppText variant="small" muted>{currentNeed?.concept ? `${currentNeed.concept} is the current learning focus. Other groups are continuing their independent activity.` : 'Keep the teacher focus visible and check the independent groups before moving on.'}</AppText>
      </View>

      {currentBlock && (
        <View style={styles.blockCard}>
          {/* Teacher focus */}
          <View style={styles.teacherSection}>
            <View style={styles.teacherHeader}>
              <View style={styles.teacherBadge}>
                <AppText style={styles.teacherBadgeText}>
                  {currentBlock.teacherGrade
                    ? `TEACHER  →  GRADE ${currentBlock.teacherGrade}`
                    : currentBlock.kind === "transition" ? "TRANSITION" : "ALL GRADES"}
                </AppText>
              </View>
              {currentNeed && currentNeed.weak > 0 && (
                <View style={[styles.urgencyBadge, { backgroundColor: currentNeed.weak > currentNeed.attending / 2 ? "#FDE8E8" : "#FFF3CD" }]}>
                  <AppText style={{ fontSize: 11, fontWeight: "700", color: currentNeed.weak > currentNeed.attending / 2 ? colors.danger : colors.attention }}>
                    {currentNeed.weak} need support
                  </AppText>
                </View>
              )}
            </View>
            <AppText style={{ fontWeight: "700", fontSize: 15, color: colors.forest, marginTop: 6 }}>
              {currentBlock.teacherActivity}
            </AppText>
            <AppText variant="small" muted style={{ marginTop: 2 }}>{currentBlock.reason}</AppText>
          </View>

          {/* Grade cohort cards */}
          <View style={{ gap: 8 }}>
            <AppText variant="subheading" style={{ fontSize: 14 }}>Grade Cohorts</AppText>
            {currentBlock.activities.map(a => (
              <CohortCard
                key={a.grade}
                activity={a}
                isGuided={a.grade === currentBlock.teacherGrade}
                gradeNeed={schedule?.needs?.find(n => n.grade === a.grade)}
              />
            ))}
          </View>
        </View>
      )}

      {/* ── AI Copilot ── */}
      <Button
        label="Ask AI Copilot about this class"
        icon="chatbubble-ellipses-outline"
        variant="quiet"
        onPress={() =>
          router.push({
            pathname: "/chatbot",
            params: {
              screenContext: "active_session",
              conceptId: currentBlock?.activities.find(a => a.grade === currentBlock.teacherGrade)?.conceptId ?? "",
            },
          })
        }
      />

      {/* ── Attendance Modal ── */}
      <Modal visible={showAttendanceModal} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <AppText variant="subheading">Mid-Session Attendance</AppText>
                <AppText variant="small" muted>Log arrival or departure.</AppText>
              </View>
              <Pressable
                onPress={() => { setShowAttendanceModal(false); setAttendanceMsg(""); void reload(); }}
                style={styles.closeBtn}
              >
                <AppText style={{ color: colors.forest, fontWeight: "700", fontSize: 18 }}>✕</AppText>
              </Pressable>
            </View>

            {attendanceMsg ? (
              <AppText style={{ color: colors.forest, fontWeight: "700" }}>{attendanceMsg}</AppText>
            ) : null}

            {/* Student list */}
            <View style={styles.studentGrid}>
              {filteredStudents.map(s => (
                <Pressable
                  key={s.id}
                  onPress={() => setSelectedStudentId(s.id)}
                  accessibilityRole="radio"
                  accessibilityLabel={s.name}
                  accessibilityState={{ selected: selectedStudentId === s.id }}
                  style={[
                    styles.studentChip,
                    selectedStudentId === s.id && styles.studentChipSelected,
                  ]}
                >
                  <AppText style={{ fontWeight: "700", fontSize: 11, color: selectedStudentId === s.id ? colors.white : colors.charcoal }}>
                    G{s.grade}
                  </AppText>
                  <AppText style={{ fontSize: 12, color: selectedStudentId === s.id ? colors.white : colors.text }} numberOfLines={1}>
                    {s.name}
                  </AppText>
                </Pressable>
              ))}
            </View>

            {/* Actions */}
            <View style={styles.attendanceActions}>
              {(["arrived", "left", "returned"] as const).map(evt => (
                <Button
                  key={evt}
                  label={evt[0].toUpperCase() + evt.slice(1)}
                  variant="secondary"
                  disabled={!selectedStudentId}
                  onPress={() => void handleRecordAttendance(evt)}
                  style={{ flex: 1 }}
                />
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  classSummaryCard: { gap: 10, padding: 14, borderRadius: 14, backgroundColor: colors.paperWarm, borderWidth: 1, borderColor: colors.lineLight },
  summaryHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  summaryStats: { flexDirection: "row", justifyContent: "space-between" },
  summaryValue: { fontSize: 17, fontWeight: "900", color: colors.primary },
  sessionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderColor: colors.line,
    gap: 12,
  },
  periodBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.sageLight,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  timerBox: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    minWidth: 80,
  },
  timerText: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.forest,
    fontVariant: ["tabular-nums"],
  },
  blockNav: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 10,
    gap: 8,
  },
  overtimeBanner: {
    backgroundColor: "#FDE8E8",
    borderLeftWidth: 4,
    borderColor: colors.danger,
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  blockCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    borderLeftWidth: 5,
    padding: 14,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  teacherSection: {
    backgroundColor: colors.sageLight,
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  teacherHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  teacherBadge: {
    backgroundColor: colors.forest,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  teacherBadgeText: {
    color: colors.white,
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 0.5,
  },
  urgencyBadge: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  footerRow: {
    flexDirection: "row",
    gap: 8,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.xl,
    gap: 12,
    maxHeight: "75%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.sageLight,
    alignItems: "center", justifyContent: "center",
  },
  studentGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  studentChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    minWidth: 80,
    maxWidth: 120,
  },
  studentChipSelected: {
    backgroundColor: colors.forest,
    borderColor: colors.forest,
  },
  attendanceActions: {
    flexDirection: "row",
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: colors.line,
  },
});
