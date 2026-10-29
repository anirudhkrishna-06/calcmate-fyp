/**
 * Student Detail — redesigned for Review 3.
 *
 * Sections:
 *  Overview  — summary card, collapsible concept knowledge cards (BKT bar, prereq gap)
 *  Attendance — clean date list with edit-in-place
 *  Marks      — assessment timeline grouped by concept, score trend chip
 *  Notes      — observation history
 *  Edit       — student editor + delete
 */
import { useCallback, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, Pressable, View, StyleSheet, ScrollView } from "react-native";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { DateField } from "@/components/DateField";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { Choices } from "@/components/Choices";
import { FormStatus } from "@/components/FormStatus";
import { StudentEditor } from "@/components/StudentEditor";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { useLocalData } from "@/hooks/useLocalData";
import {
  loadStudents, localRepository,
  saveAttendance, saveAssessment, removeAssessment,
  saveCompetency, saveObservation,
} from "@/services/storageService";
import { today, AttendanceRecord, AssessmentRecord } from "@/services/database";
import {
  getStudentKnowledgeView, stateLabel, sufficiencyLabel,
  type StudentKnowledgeView, type ConceptWithState,
} from "@/services/learnerStateService";
import { colors, spacing } from "@/theme";
import { StudentAiBar } from "@/components/StudentAiBar";

// ─── Mastery helpers ──────────────────────────────────────────────────────────
function masteryColor(m: number | null): string {
  if (m === null) return colors.masteryNone;
  return m >= 0.70 ? colors.masteryHigh : m >= 0.60 ? colors.masteryMid : colors.masteryLow;
}
function masteryBg(m: number | null): string {
  if (m === null) return colors.lineLight;
  return m >= 0.70 ? colors.sageLight : m >= 0.60 ? colors.goldLight : colors.dangerLight;
}

// ─── Concept Knowledge Card ───────────────────────────────────────────────────
function ConceptCard({ c }: { c: ConceptWithState }) {
  const [open, setOpen] = useState(false);
  const st = c.state;
  const m  = st?.mastery_estimate ?? null;
  const pct = m !== null ? Math.round(m * 100) : null;
  const statusTxt = st ? stateLabel(st.state_status) : "Not assessed";
  const mColor = masteryColor(m);
  const mBg    = masteryBg(m);

  return (
    <View style={[cStyles.card, { borderLeftColor: mColor }]}>
      <Pressable
        onPress={() => setOpen(o => !o)}
        accessibilityRole="button"
        accessibilityLabel={`${c.concept_title}, ${statusTxt}${pct !== null ? `, ${pct}%` : ""}`}
        style={cStyles.header}
      >
        {/* Grade chip */}
        <View style={[cStyles.gradeChip, { backgroundColor: mBg }]}>
          <AppText style={{ fontSize: 11, fontWeight: "800", color: mColor }}>G{c.concept_grade}</AppText>
        </View>

        <View style={{ flex: 1, gap: 3 }}>
          <AppText style={{ fontWeight: "700", fontSize: 14, color: colors.charcoal }} numberOfLines={open ? undefined : 1}>
            {c.concept_title}
          </AppText>
          {/* Mini mastery bar */}
          <View style={cStyles.barRow}>
            <View style={cStyles.barTrack}>
              {pct !== null && (
                <View style={[cStyles.barFill, { width: `${pct}%` as any, backgroundColor: mColor }]} />
              )}
            </View>
            <AppText style={[cStyles.pct, { color: mColor }]}>
              {pct !== null ? `${pct}%` : "—"}
            </AppText>
          </View>
        </View>

        {/* Status chip */}
        <View style={[cStyles.statusChip, { backgroundColor: mBg }]}>
          <AppText style={{ fontSize: 11, fontWeight: "700", color: mColor }}>{statusTxt}</AppText>
        </View>

        <AppText style={{ color: colors.sage, fontSize: 18 }}>{open ? "↑" : "↓"}</AppText>
      </Pressable>

      {open && (
        <View style={cStyles.body}>
          {st && (
            <AppText variant="small" style={{ color: colors.charcoalMuted }}>
              {sufficiencyLabel(st.evidence_sufficiency)} · {st.evidence_count} assessment{st.evidence_count !== 1 ? "s" : ""}
              {st.last_evidence_at ? ` · Last: ${st.last_evidence_at}` : ""}
            </AppText>
          )}
          {c.prerequisite_gap && (
            <View style={cStyles.gapAlert}>
              <AppText style={{ fontWeight: "700", fontSize: 13, color: colors.gold }}>⚠ Prerequisite Gap</AppText>
              <AppText variant="small" style={{ color: colors.charcoal }}>
                One or more prerequisite concepts need revision before advancing to this topic.
              </AppText>
            </View>
          )}
          <Button
            label="Teaching ideas from AI Copilot"
            icon="chatbubble-ellipses-outline"
            variant="quiet"
            style={{ alignSelf: "flex-start" }}
            onPress={() =>
              router.push({
                pathname: "/chatbot",
                params: {
                  conceptId: c.concept_id,
                  screenContext: "student_detail",
                  prompt: `Suggest a concrete activity for ${c.concept_title}.`,
                },
              })
            }
          />
        </View>
      )}
    </View>
  );
}

const cStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.paper,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.lineLight,
    borderLeftWidth: 5,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
  },
  gradeChip: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
  },
  barRow:  { flexDirection: "row", alignItems: "center", gap: 6 },
  barTrack:{ flex: 1, height: 5, backgroundColor: colors.lineLight, borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3 },
  pct:     { fontSize: 12, fontWeight: "700", width: 30, textAlign: "right" },
  statusChip: {
    borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3,
    alignSelf: "center",
  },
  body: {
    padding: 12, paddingTop: 4, gap: 8,
    borderTopWidth: 1, borderColor: colors.lineLight,
    backgroundColor: colors.paperWarm,
  },
  gapAlert: {
    backgroundColor: colors.goldLight, borderRadius: 8, borderLeftWidth: 3,
    borderColor: colors.gold, padding: 10, gap: 3,
  },
});

// ─── Summary stat chip ────────────────────────────────────────────────────────
function StatChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={sumStyles.chip}>
      <AppText style={[sumStyles.val, color ? { color } : {}]}>{value}</AppText>
      <AppText variant="small" style={sumStyles.lbl}>{label}</AppText>
    </View>
  );
}
const sumStyles = StyleSheet.create({
  chip: {
    flex: 1, minWidth: 72, alignItems: "center", gap: 2,
    backgroundColor: colors.paper, borderRadius: 10,
    borderWidth: 1, borderColor: colors.lineLight,
    padding: 10,
  },
  val: { fontSize: 20, fontWeight: "800", color: colors.forest },
  lbl: { color: colors.charcoalMuted, textAlign: "center" },
});

// ─── Tab bar ──────────────────────────────────────────────────────────────────
const TABS = [
  { value: "overview",   label: "Overview" },
  { value: "attendance", label: "Attendance" },
  { value: "assessments",label: "Marks" },
  { value: "observations",label: "Notes" },
];

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function StudentDetailsScreen() {
  const { id, tab: initialTab } = useLocalSearchParams<{ id: string; tab?: string }>();

  const loader = useCallback(async () => {
    const student      = (await loadStudents()).find(s => s.id === id);
    const concepts     = await (await localRepository("concepts")).list();
    const attendance   = (await (await localRepository("attendance")).list())
      .filter(a => a.student_id === id)
      .sort((a, b) => b.date.localeCompare(a.date));
    const assessments  = (await (await localRepository("assessments")).list())
      .filter(a => a.student_id === id)
      .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
    const competencies = (await (await localRepository("competencies")).list())
      .filter(c => c.student_id === id);
    const observations = (await (await localRepository("observations")).list())
      .filter(o => o.student_id === id);
    let knowledgeView: StudentKnowledgeView | null = null;
    if (student) {
      try { knowledgeView = await getStudentKnowledgeView(id); } catch { /* silent */ }
    }
    return { student, concepts, attendance, assessments, competencies, observations, knowledgeView };
  }, [id]);

  const { data, error, loading, reload } = useLocalData(loader);

  const validTabs = TABS.map(t => t.value);
  const [tab, setTab]           = useState(validTabs.includes(initialTab ?? "") ? initialTab! : "overview");
  const [date, setDate]         = useState(today());
  const [status, setStatus]     = useState<AttendanceRecord["status"]>("present");
  const [concept, setConcept]   = useState("");
  const [score, setScore]       = useState("");
  const [maximum, setMaximum]   = useState("10");
  const [assessmentId, setAssessmentId] = useState<string | undefined>();
  const [note, setNote]         = useState("");
  const [observationId, setObsId] = useState<string | undefined>();
  const [message, setMessage]   = useState("");
  const [failed, setFailed]     = useState(false);
  const [busy, setBusy]         = useState(false);
  const [showAllConcepts, setShowAll] = useState(false);

  useUnsavedChanges(!busy && (!!note.trim() || !!score.trim()));

  function confirmRemoval(work: () => Promise<unknown>) {
    Alert.alert("Remove this record?", "Learning summaries will update after removal.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void doAction(work) },
    ]);
  }

  function changeTab(value: string) {
    const go = () => { setTab(value); setMessage(""); setNote(""); setScore(""); setAssessmentId(undefined); setObsId(undefined); };
    if (note.trim() || score.trim()) {
      Alert.alert("Discard unsaved input?", "", [
        { text: "Keep editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: go },
      ]);
    } else go();
  }

  async function doAction(work: () => Promise<unknown>) {
    setBusy(true); setMessage("");
    try { await work(); await reload(); setMessage("Saved on device."); setFailed(false); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Could not save."); setFailed(true); }
    finally { setBusy(false); }
  }

  function editAssessment(a: AssessmentRecord) {
    setTab("assessments"); setAssessmentId(a.id);
    setConcept(a.concept_id); setDate(a.date);
    setScore(String(a.score)); setMaximum(String(a.maximum));
  }

  const student = data?.student;
  const kv      = data?.knowledgeView;
  const titleOf = (cid: string) => data?.concepts.find(c => c.id === cid)?.title ?? cid;

  // Concepts split by state for overview
  const needsSupport  = kv?.concepts.filter(c => c.state?.state_status === "needs_support") ?? [];
  const likelyReady   = kv?.concepts.filter(c => c.state?.state_status === "likely_ready") ?? [];
  const unassessed    = kv?.concepts.filter(c => !c.state || c.state.state_status === "unknown") ?? [];
  const displayList   = showAllConcepts ? kv?.concepts ?? [] : [...needsSupport, ...(kv?.concepts.filter(c => c.prerequisite_gap) ?? [])].filter((v,i,a) => a.findIndex(x => x.concept_id === v.concept_id) === i);

  return (
    <Screen topInset={false}>
      <FormStatus message={error} error />
      {loading && !data ? <AppText muted>Loading student…</AppText> : null}
      {!loading && !student ? <AppText>Student not found in this workspace.</AppText> : null}

      {student ? (
        <View style={{ gap: 16 }}>
          {/* ── Hero header ── */}
          <View style={styles.heroCard}>
            <View style={styles.heroAvatar}>
              <AppText style={styles.heroAvatarText}>{student.name[0]}</AppText>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <AppText variant="title" style={{ fontSize: 20 }}>{student.name}</AppText>
              <AppText style={{ color: colors.charcoalMuted }}>Grade {student.grade} · Roll {student.rollNumber}</AppText>
              <AppText variant="small" style={{ color: colors.charcoalMuted }}>
                Last seen: {student.lastSeenLabel}
              </AppText>
            </View>
          </View>

          <StudentAiBar
            studentName={student.name}
            grade={student.grade}
            knowledge={kv ?? null}
            onSubmit={() => router.push({pathname:"/student-ai",params:{studentId:student.id,studentName:student.name,studentThread:"true",grade:String(student.grade)}})}
          />

          {/* ── Summary stats ── */}
          {kv && (
            <View style={styles.statsRow}>
              <StatChip label="Assessed"    value={String(kv.assessed_count)} />
              <StatChip label="On Track"    value={String(kv.likely_ready_count)}   color={colors.masteryHigh} />
              <StatChip label="Needs Help"  value={String(kv.needs_support_count)}  color={kv.needs_support_count > 0 ? colors.masteryLow : colors.masteryHigh} />
              <StatChip label="Not Tested"  value={String(kv.unassessed_count)}     color={kv.unassessed_count > 0 ? colors.gold : colors.masteryHigh} />
            </View>
          )}

          {/* ── Tab bar ── */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBar}>
            {TABS.map(t => (
              <Pressable
                key={t.value}
                onPress={() => changeTab(t.value)}
                accessibilityRole="tab"
                style={[styles.tabItem, tab === t.value && styles.tabItemActive]}
              >
                <AppText style={[styles.tabLabel, tab === t.value && styles.tabLabelActive]}>
                  {t.label}
                </AppText>
              </Pressable>
            ))}
            <Pressable
              onPress={() => changeTab("edit")}
              accessibilityRole="tab"
              style={[styles.tabItem, tab === "edit" && styles.tabItemActive]}
            >
              <AppText style={[styles.tabLabel, tab === "edit" && styles.tabLabelActive]}>Edit</AppText>
            </Pressable>
          </ScrollView>

          <FormStatus message={message} error={failed} />

          {/* ══ OVERVIEW ══ */}
          {tab === "overview" && (
            <View style={{ gap: 16 }}>
              {/* Observation banner */}
              {data?.observations[0] && (
                <View style={styles.obsBanner}>
                  <AppText style={{ fontSize: 12, fontWeight: "700", color: colors.forest }}>TEACHER NOTE</AppText>
                  <AppText style={{ fontSize: 14, color: colors.charcoal, marginTop: 2 }}>
                    {data.observations[0].note}
                  </AppText>
                </View>
              )}

              {/* Priority concepts */}
              {needsSupport.length > 0 && (
                <View style={{ gap: 8 }}>
                  <View style={styles.sectionHeader}>
                    <AppText variant="subheading">Needs Support ({needsSupport.length})</AppText>
                    <View style={styles.sectionBadge}>
                      <AppText style={{ fontSize: 11, fontWeight: "700", color: colors.danger }}>ACTION NEEDED</AppText>
                    </View>
                  </View>
                  {needsSupport.map(c => <ConceptCard key={c.concept_id} c={c} />)}
                </View>
              )}

              {/* Prerequisite gap concepts */}
              {kv?.concepts.filter(c => c.prerequisite_gap && c.state?.state_status !== "needs_support").map(c => (
                <ConceptCard key={c.concept_id} c={c} />
              ))}

              {/* Separator + all concepts toggle */}
              <View style={{ gap: 8 }}>
                <View style={styles.sectionHeader}>
                  <AppText variant="subheading">All Concepts ({kv?.concepts.length ?? 0})</AppText>
                  <Button
                    label={showAllConcepts ? "Show less" : "Show all"}
                    variant="quiet"
                    onPress={() => setShowAll(v => !v)}
                    style={{ paddingHorizontal: 10, minHeight: 36 }}
                  />
                </View>

                {showAllConcepts && kv?.concepts.map(c => <ConceptCard key={c.concept_id} c={c} />)}

                {!showAllConcepts && likelyReady.length > 0 && (
                  <View style={styles.readySummary}>
                    <AppText style={{ fontWeight: "700", color: colors.forest }}>
                      ✓ {likelyReady.length} concept{likelyReady.length !== 1 ? "s" : ""} on track
                    </AppText>
                    <AppText variant="small" style={{ color: colors.charcoalMuted }}>
                      {likelyReady.slice(0, 3).map(c => c.concept_title).join(", ")}
                      {likelyReady.length > 3 ? ` +${likelyReady.length - 3} more` : ""}
                    </AppText>
                  </View>
                )}
              </View>

              {/* AI shortcut */}
              {needsSupport[0] && (
                <Button
                  label="Ask AI Copilot for teaching ideas"
                  icon="chatbubble-ellipses-outline"
                  variant="quiet"
                  onPress={() =>
                    router.push({
                      pathname: "/chatbot",
                      params: {
                        grade: String(student.grade),
                        prompt: `Suggest a concrete activity for ${needsSupport[0].concept_title} in Grade ${student.grade}.`,
                        studentId: student.id,
                        studentName: student.name,
                        studentThread: "true",
                        conceptId: needsSupport[0].concept_id,
                        screenContext: "student_detail",
                      },
                    })
                  }
                />
              )}
            </View>
          )}

          {/* ══ ATTENDANCE ══ */}
          {tab === "attendance" && (
            <View style={{ gap: 12 }}>
              <DateField label="Date" value={date} onChange={setDate} maxDate={today()} disabled={busy} />
              <Choices
                values={["present", "absent", "late"].map(s => ({
                  value: s, label: s[0].toUpperCase() + s.slice(1),
                }))}
                selected={[status]}
                onSelect={s => setStatus(s as AttendanceRecord["status"])}
              />
              <Button
                label="Save"
                icon="checkmark-outline"
                disabled={busy}
                onPress={() => void doAction(() => saveAttendance(id, date, status))}
              />

              <View style={{ gap: 0 }}>
                {data?.attendance.map(a => {
                  const isPresent = a.status === "present";
                  const isLate    = a.status === "late";
                  return (
                    <View key={a.id} style={attStyles.row}>
                      <View style={[attStyles.dot, {
                        backgroundColor: isPresent ? colors.masteryHigh : isLate ? colors.gold : colors.masteryLow,
                      }]} />
                      <AppText style={{ flex: 1, fontWeight: "600" }}>{a.date}</AppText>
                      <View style={[attStyles.pill, {
                        backgroundColor: isPresent ? colors.sageLight : isLate ? colors.goldLight : colors.dangerLight,
                      }]}>
                        <AppText style={{ fontSize: 12, fontWeight: "700", color: isPresent ? colors.forest : isLate ? colors.gold : colors.danger }}>
                          {a.status}
                        </AppText>
                      </View>
                      <Button
                        label="Edit"
                        variant="quiet"
                        style={{ minHeight: 36, paddingHorizontal: 10 }}
                        onPress={() => { setDate(a.date); setStatus(a.status); }}
                      />
                      <Button
                        label="✕"
                        variant="quiet"
                        disabled={busy}
                        style={{ minHeight: 36, paddingHorizontal: 10 }}
                        onPress={() => confirmRemoval(async () => (await localRepository("attendance")).remove(a.id))}
                      />
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* ══ MARKS ══ */}
          {tab === "assessments" && (
            <View style={{ gap: 12 }}>
              {/* Add / edit form */}
              <View style={styles.formCard}>
                <AppText variant="subheading" style={{ marginBottom: 4 }}>
                  {assessmentId ? "Edit assessment" : "Record marks"}
                </AppText>
                <Choices
                  values={data!.concepts.map(c => ({ value: c.id, label: `G${c.grade}: ${c.title}` }))}
                  selected={[concept]}
                  onSelect={setConcept}
                />
                <DateField label="Date" value={date} onChange={setDate} maxDate={today()} disabled={busy} />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <TextField label="Score" value={score} onChangeText={setScore} keyboardType="decimal-pad" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField label="Out of" value={maximum} onChangeText={setMaximum} keyboardType="decimal-pad" />
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button
                    label={busy ? "Saving…" : assessmentId ? "Update" : "Save marks"}
                    icon="save-outline"
                    disabled={busy || !concept || !score.trim() || !maximum.trim()}
                    onPress={() =>
                      void doAction(async () => {
                        await saveAssessment({ student_id: id, concept_id: concept, date, score: Number(score), maximum: Number(maximum) }, assessmentId);
                        setAssessmentId(undefined); setScore("");
                      })
                    }
                    style={{ flex: 1 }}
                  />
                  {assessmentId && (
                    <Button
                      label="Cancel"
                      variant="secondary"
                      onPress={() => { setAssessmentId(undefined); setScore(""); }}
                      style={{ flex: 1 }}
                    />
                  )}
                </View>
              </View>

              {/* Assessment timeline grouped by concept */}
              <AppText variant="subheading">Assessment history ({data?.assessments.length})</AppText>
              {data?.concepts
                .filter(c => data.assessments.some(a => a.concept_id === c.id))
                .map(c => {
                  const history = data.assessments.filter(a => a.concept_id === c.id);
                  const latest  = history[0];
                  const latestPct = Math.round((latest.score / latest.maximum) * 100);
                  const earliest  = history[history.length - 1];
                  const earliestPct = Math.round((earliest.score / earliest.maximum) * 100);
                  const trend = latestPct > earliestPct ? "↑" : latestPct < earliestPct ? "↓" : "→";
                  const trendColor = latestPct > earliestPct ? colors.masteryHigh : latestPct < earliestPct ? colors.masteryLow : colors.charcoalMuted;

                  return (
                    <View key={c.id} style={styles.conceptGroup}>
                      <View style={styles.conceptGroupHeader}>
                        <AppText style={{ fontWeight: "700", flex: 1 }}>{c.title}</AppText>
                        <AppText style={{ fontWeight: "800", color: trendColor, fontSize: 15 }}>
                          {trend} {latestPct}%
                        </AppText>
                      </View>
                      {history.map(a => {
                        const pct = Math.round((a.score / a.maximum) * 100);
                        return (
                          <View key={a.id} style={markStyles.row}>
                            <View style={[markStyles.dot, { backgroundColor: masteryColor(a.score / a.maximum) }]} />
                            <AppText style={{ flex: 1, color: colors.charcoal }}>{a.date}</AppText>
                            <View style={[markStyles.scorePill, { backgroundColor: masteryBg(a.score / a.maximum) }]}>
                              <AppText style={{ fontWeight: "700", fontSize: 12, color: masteryColor(a.score / a.maximum) }}>
                                {a.score}/{a.maximum} ({pct}%)
                              </AppText>
                            </View>
                            <Button label="Edit" variant="quiet" style={{ minHeight: 36, paddingHorizontal: 10 }} onPress={() => editAssessment(a)} />
                            <Button label="✕" variant="quiet" disabled={busy} style={{ minHeight: 36, paddingHorizontal: 10 }}
                              onPress={() => confirmRemoval(() => removeAssessment(a.id))} />
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
            </View>
          )}

          {/* ══ OBSERVATIONS ══ */}
          {tab === "observations" && (
            <View style={{ gap: 12 }}>
              <View style={styles.formCard}>
                <TextField
                  label="Teacher observation"
                  value={note}
                  onChangeText={setNote}
                  multiline
                  maxLength={2000}
                  placeholder="e.g., Needs concrete objects for place value. Participates well in group work."
                />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button
                    label={busy ? "Saving…" : observationId ? "Update note" : "Save note"}
                    icon="save-outline"
                    disabled={busy || !note.trim()}
                    onPress={() =>
                      void doAction(async () => {
                        await saveObservation(id, note, observationId);
                        setNote(""); setObsId(undefined);
                      })
                    }
                    style={{ flex: 1 }}
                  />
                  {observationId && (
                    <Button label="Cancel" variant="secondary" onPress={() => { setNote(""); setObsId(undefined); }} style={{ flex: 1 }} />
                  )}
                </View>
              </View>

              {data?.observations.map(o => (
                <View key={o.id} style={styles.obsCard}>
                  <AppText style={{ fontSize: 14, color: colors.charcoal, lineHeight: 22 }}>{o.note}</AppText>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                    <AppText variant="small" style={{ color: colors.charcoalMuted }}>{o.updated_at.slice(0, 10)}</AppText>
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      <Button label="Edit" variant="quiet" style={{ minHeight: 36, paddingHorizontal: 10 }}
                        onPress={() => { setNote(o.note); setObsId(o.id); }} />
                      <Button label="Remove" variant="quiet" disabled={busy} style={{ minHeight: 36, paddingHorizontal: 10 }}
                        onPress={() => confirmRemoval(async () => (await localRepository("observations")).remove(o.id))} />
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* ══ EDIT ══ */}
          {tab === "edit" && (
            <View style={{ gap: 12 }}>
              <Button label="← Back to overview" variant="quiet" onPress={() => setTab("overview")} style={{ alignSelf: "flex-start" }} />
              <StudentEditor key={student.id} student={student} onSaved={() => { void reload(); setTab("overview"); }} />
              <Button
                label="Delete student"
                icon="trash-outline"
                variant="quiet"
                disabled={busy}
                style={{ borderColor: colors.danger }}
                onPress={() =>
                  Alert.alert("Delete student?", "Attendance, marks and notes will also be deleted.", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () =>
                        void doAction(async () => {
                          await (await localRepository("students")).remove(id);
                          router.replace("/students");
                        }),
                    },
                  ])
                }
              />
            </View>
          )}
        </View>
      ) : null}
    </Screen>
  );
}

const attStyles = StyleSheet.create({
  row: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.lineLight,
  },
  dot:  { width: 10, height: 10, borderRadius: 5 },
  pill: { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
});
const markStyles = StyleSheet.create({
  row: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.lineLight,
  },
  dot:       { width: 8, height: 8, borderRadius: 4 },
  scorePill: { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
});
const styles = StyleSheet.create({
  heroCard: {
    flexDirection: "row", gap: 14, alignItems: "center",
    backgroundColor: colors.sageLight, borderRadius: 14, padding: 14,
  },
  heroAvatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.forest, alignItems: "center", justifyContent: "center",
  },
  heroAvatarText: { fontSize: 24, fontWeight: "900", color: colors.white },
  statsRow: {
    flexDirection: "row", gap: 6, flexWrap: "wrap",
  },
  tabBar: { gap: 4, paddingVertical: 4 },
  tabItem: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
    backgroundColor: colors.lineLight, borderWidth: 1, borderColor: "transparent",
  },
  tabItemActive: { backgroundColor: colors.forest, borderColor: colors.forest },
  tabLabel:      { fontWeight: "600", color: colors.charcoalMuted, fontSize: 13 },
  tabLabelActive: { color: colors.white },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionBadge: {
    backgroundColor: colors.dangerLight, borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  obsBanner: {
    backgroundColor: colors.sageLight, borderRadius: 10,
    borderLeftWidth: 4, borderColor: colors.forest, padding: 12,
  },
  readySummary: {
    backgroundColor: colors.sageLight, borderRadius: 10,
    borderLeftWidth: 4, borderColor: colors.forest, padding: 12, gap: 4,
  },
  formCard: {
    backgroundColor: colors.paperWarm, borderRadius: 10,
    borderWidth: 1, borderColor: colors.lineLight, padding: 14, gap: 10,
  },
  obsCard: {
    backgroundColor: colors.paper, borderRadius: 10,
    borderWidth: 1, borderColor: colors.lineLight, padding: 14,
  },
  conceptGroup: {
    borderWidth: 1, borderColor: colors.lineLight,
    borderRadius: 10, overflow: "hidden",
  },
  conceptGroupHeader: {
    flexDirection: "row", alignItems: "center",
    padding: 10, backgroundColor: colors.paperWarm,
    borderBottomWidth: 1, borderColor: colors.lineLight,
  },
});
