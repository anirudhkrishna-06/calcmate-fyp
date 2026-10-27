import { useCallback, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { GradeSelector } from "@/components/GradeSelector";
import { FormStatus } from "@/components/FormStatus";
import { LocalStatus } from "@/components/Workspace";
import { Screen } from "@/components/Screen";
import { classroomSummary } from "@/services/classroomService";
import { useLocalData } from "@/hooks/useLocalData";
import { useGrade } from "@/hooks/useGrade";
import { today } from "@/services/database";
import { colors } from "@/theme";
import { signOut } from "@/services/authService";
import { getTodaysWeeklyPlan } from "@/services/weeklyScheduleService";

const dateLabel = () => new Date(`${today()}T12:00:00`).toLocaleDateString("en-IN", {
  weekday: "long", day: "numeric", month: "long"
});

export default function HomeScreen() {
  const { grade, setGrade, error: gradeError } = useGrade();
  const loader = useCallback(async () => {
    const [summary, weekly] = await Promise.all([classroomSummary(grade), getTodaysWeeklyPlan()]);
    return { ...summary, weekly };
  }, [grade]);
  const { data, error, loading, reload } = useLocalData(loader);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  async function logout() {
    setLoggingOut(true); setLogoutError("");
    try { await signOut(); router.replace("/welcome"); }
    catch (e) { setLogoutError(e instanceof Error ? e.message : "Could not log out. Try again."); setLoggingOut(false); }
  }

  const openClassroom = (section: string) => router.push({ pathname: "/students", params: { grade: String(grade), section } });
  const markedPercent = data?.students ? Math.round((data.recorded / data.students) * 100) : 0;
  const attendanceDone = !!data?.students && data.recorded === data.students;
  const firstName = data?.teacher.name.split(" ")[0] ?? "teacher";

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.brandLine}><View style={styles.brandMark}><Ionicons name="school" size={17} color={colors.white} /></View><AppText style={styles.brand}>CALCMATE</AppText></View>
        <Button label={loggingOut ? "Signing out" : "Log out"} icon="log-out-outline" variant="quiet" disabled={loggingOut} onPress={() => void logout()} />
      </View>

      <View style={styles.dateRow}>
        <View><AppText variant="small" style={styles.eyebrow}>{dateLabel().toUpperCase()}</AppText><AppText variant="title">Good morning, {firstName}</AppText></View>
        {data?.mode === "demo" ? <View style={styles.demoPill}><View style={styles.liveDot} /><AppText style={styles.demoText}>Demo classroom</AppText></View> : null}
      </View>

      <View style={styles.gradePanel}>
        <GradeSelector grade={grade} onSelect={setGrade} />
      </View>

      <FormStatus message={logoutError || error || gradeError} error />
      {error ? <Button label="Retry classroom" icon="refresh-outline" onPress={() => void reload()} /> : null}
      {loading && !data ? <View style={styles.loading}><Ionicons name="sparkles-outline" size={20} color={colors.primary} /><AppText muted>Preparing your classroom...</AppText></View> : null}

      {data ? <>
        <View style={styles.hero}>
          <View style={styles.heroGlow} />
          <View style={styles.heroCopy}>
            <AppText variant="small" style={styles.heroEyebrow}>TODAY IN YOUR CLASSROOM</AppText>
            <AppText variant="heading" style={styles.heroTitle}>Small actions. Stronger learning.</AppText>
            <AppText style={styles.heroBody}>{attendanceDone ? `${data.present} learners are present and your register is complete.` : data.students ? `${data.students - data.recorded} attendance ${data.students - data.recorded === 1 ? "entry" : "entries"} left to close the loop.` : "Add your learners to start building a clear classroom picture."}</AppText>
            <View style={styles.heroActions}>
              <Button label={attendanceDone ? "Review attendance" : "Mark attendance"} icon="checkbox-outline" onPress={() => openClassroom("attendance")} style={styles.heroButton} />
              <Pressable accessibilityRole="button" accessibilityLabel="Open class progress" onPress={() => openClassroom("progress")} style={styles.textAction}><AppText style={styles.textActionLabel}>View class pulse</AppText><Ionicons name="arrow-forward" size={16} color={colors.white} /></Pressable>
            </View>
          </View>
          <View style={styles.heroIllustration}><Ionicons name="book-outline" size={35} color={colors.gold} /><View style={styles.illustrationLine} /><View style={styles.illustrationLineShort} /><View style={styles.sunDot} /></View>
        </View>

        <TodayPlanCard
          weekly={data.weekly}
          hasActiveSession={!!data.activeSession}
          onOpen={() => {
            const item = data.weekly;
            if (item?.state === "in-class" && item.schedule) {
              router.push({ pathname: "/active-session", params: { scheduleId: item.schedule.id } });
            } else if (item?.state === "pre-class" && item.schedule) {
              router.push(`/general-schedule/${item.schedule.id}`);
            } else if (item?.state === "post-class" && data.activeSession) {
              router.push({ pathname: "/post-class-review", params: { sessionId: data.activeSession.id, scheduleId: item.schedule?.id ?? data.activeSession.schedule_id ?? "" } });
            } else {
              router.push("/(tabs)/schedule");
            }
          }}
        />

        <View style={styles.pulsePanel}>
          <View style={styles.panelHeading}><View><AppText variant="subheading">Classroom pulse</AppText><AppText variant="small" muted>Grade {grade} · {data.students} learners</AppText></View><AppText style={styles.pulseHint}>{markedPercent}% recorded</AppText></View>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.min(100, markedPercent)}%` }]} /></View>
          <View style={styles.metrics}>
            <Metric icon="people-outline" value={String(data.students)} label="Learners" />
            <Metric icon="checkmark-circle-outline" value={String(data.present)} label="Present" />
            <Metric icon="flag-outline" value={String(data.revision)} label="To revisit" tone="gold" />
          </View>
        </View>

        {data.activeSession ? <View style={styles.sessionBanner}><View style={styles.sessionIcon}><Ionicons name="play" size={17} color={colors.white} /></View><View style={{ flex: 1 }}><AppText style={styles.sessionTitle}>Class in progress</AppText><AppText variant="small" muted>Your live classroom is {data.activeSession.status}.</AppText></View><Button label="Resume" variant="secondary" onPress={() => router.push({ pathname: "/active-session", params: { sessionId: data.activeSession!.id, scheduleId: data.activeSession!.schedule_id ?? "" } })} /></View> : null}

        <View style={styles.sectionHeading}><View><AppText variant="subheading">Your next move</AppText><AppText variant="small" muted>Keep the day moving with one useful action.</AppText></View><Ionicons name="compass-outline" size={22} color={colors.gold} /></View>
        <View style={styles.actionGrid}>
          <QuickAction icon="create-outline" label="Record marks" detail="Update learning evidence" tone="gold" onPress={() => openClassroom("assessments")} />
          <QuickAction icon="calendar-outline" label="Plan a rotation" detail="Balance your grades" tone="teal" onPress={() => router.push("/general-schedule/new")} />
          <QuickAction icon="git-network-outline" label="Explore curriculum" detail="Follow prerequisite flow" tone="purple" onPress={() => router.push({ pathname: "/curriculum", params: { grade: String(grade), origin: "home" } })} />
          <QuickAction icon="chatbubble-ellipses-outline" label="Ask the assistant" detail="Get teaching support" tone="blue" onPress={() => router.push({ pathname: "/chatbot", params: { grade: String(grade) } })} />
        </View>

        <View style={styles.sectionHeading}><View><AppText variant="subheading">A little more attention</AppText><AppText variant="small" muted>{data.revision ? `${data.revision} learners have evidence worth revisiting.` : "Your class is moving steadily."}</AppText></View><Pressable accessibilityRole="button" accessibilityLabel="Review class progress" onPress={() => openClassroom("progress")}><AppText style={styles.link}>See all</AppText></Pressable></View>
        <View style={styles.attentionPanel}>
          {data.revisionStudents.length ? data.revisionStudents.slice(0, 3).map((student, index) => <AttentionRow key={`${student.id}-${index}`} name={student.name} concept={student.concept} index={index} onPress={() => router.push(`/students/${student.id}`)} />) : <View style={styles.emptyAttention}><View style={styles.checkCircle}><Ionicons name="checkmark" size={17} color={colors.white} /></View><View><AppText style={{ fontWeight: "700" }}>No learners need a follow-up yet</AppText><AppText variant="small" muted>Keep collecting small pieces of evidence.</AppText></View></View>}
        </View>

        {data.rotation || data.plan ? <View style={styles.lessonPanel}><View style={styles.lessonIcon}><Ionicons name="sunny-outline" size={21} color={colors.gold} /></View><View style={{ flex: 1 }}><AppText variant="small" style={styles.eyebrow}>{data.rotation ? "UPCOMING ROTATION" : "SAVED LESSON"}</AppText><AppText style={styles.lessonTitle}>{data.rotation ? `${data.rotation.selection.availableMinutes} minutes across Grades ${data.rotation.selection.grades.join(", ")}` : `Grade ${data.plan!.selection.grade} lesson plan`}</AppText><AppText variant="small" muted>{data.rotation?.selection.date ?? data.plan?.selection.date}</AppText></View><Pressable accessibilityRole="button" accessibilityLabel="Open next lesson" onPress={() => router.push(data.rotation ? `/general-schedule/${data.rotation!.id}` : `/schedule/${data.plan!.id}`)} style={styles.circleArrow}><Ionicons name="arrow-forward" size={17} color={colors.primary} /></Pressable></View> : null}
        <LocalStatus text="Your classroom data is saved on this device" />
      </> : null}
    </Screen>
  );
}

function TodayPlanCard({ weekly, hasActiveSession, onOpen }: { weekly: Awaited<ReturnType<typeof getTodaysWeeklyPlan>>; hasActiveSession: boolean; onOpen: () => void }) {
  const schedule = weekly?.schedule;
  const slot = weekly?.slot;
  const lead = schedule?.selection.focusGrade ?? schedule?.blocks.find(block => block.kind === "instruction")?.teacherGrade;
  const leadNeed = lead ? schedule?.needs.find(need => need.grade === lead) : undefined;
  const eyebrow = weekly?.state === "pre-class" ? "PRE-CLASS BRIEFING" : weekly?.state === "in-class" ? "IN CLASS NOW" : weekly?.state === "post-class" ? "POST-CLASS RECORD" : "PLAN YOUR TEACHING DAY";
  const title = weekly?.state === "outside" ? "Review the planner" : schedule?.needs.find(need => need.grade === lead)?.concept ?? (weekly ? "Teaching day complete" : "Create your weekly plan");
  const detail = weekly?.state === "pre-class" ? `${slot?.startTime}–${slot?.endTime} · Review the focus, activities and prerequisite first.`
    : weekly?.state === "in-class" ? `${slot?.startTime}–${slot?.endTime} · Teacher focus: Grade ${lead}${leadNeed?.prerequisiteGap ? " · prerequisite first" : ""}`
    : weekly?.state === "post-class" ? (hasActiveSession ? "Record what was delivered and capture the next learning evidence." : "Open the planner to review the day and add any missed entry.")
    : "Outside the teaching window · open Planner to review or prepare the next plan.";
  return <Pressable accessibilityRole="button" accessibilityLabel="Open today's weekly plan" onPress={onOpen} style={styles.todayPlan}>
    <View style={styles.todayPlanIcon}><Ionicons name="calendar-outline" size={21} color={colors.primary} /></View>
    <View style={{ flex: 1, gap: 3 }}>
      <AppText variant="small" style={styles.eyebrow}>{eyebrow}</AppText>
      <AppText style={styles.todayPlanTitle}>{title}</AppText>
      <AppText variant="small" muted>{detail}</AppText>
    </View>
    <Ionicons name="chevron-forward" size={18} color={colors.primary} />
  </Pressable>;
}

function Metric({ icon, value, label, tone = "teal" }: { icon: keyof typeof Ionicons.glyphMap; value: string; label: string; tone?: "teal" | "gold" }) {
  const color = tone === "gold" ? colors.gold : colors.primary;
  return <View style={styles.metric}><Ionicons name={icon} size={19} color={color} /><View><AppText style={styles.metricValue}>{value}</AppText><AppText variant="small" muted>{label}</AppText></View></View>;
}

function QuickAction({ icon, label, detail, tone, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; detail: string; tone: "gold" | "teal" | "purple" | "blue"; onPress: () => void }) {
  const palette = { gold: [colors.goldLight, colors.gold], teal: [colors.primarySurface, colors.primary], purple: ["#EEE9F8", "#67528F"], blue: ["#E7F1F6", "#3C7187"] }[tone];
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.quickAction, pressed && styles.quickPressed]}><View style={[styles.quickIcon, { backgroundColor: palette[0] }]}><Ionicons name={icon} size={20} color={palette[1]} /></View><View style={{ flex: 1 }}><AppText style={styles.quickLabel}>{label}</AppText><AppText variant="small" muted>{detail}</AppText></View><Ionicons name="chevron-forward" size={17} color={colors.charcoalLight} /></Pressable>;
}

function AttentionRow({ name, concept, index, onPress }: { name: string; concept: string; index: number; onPress: () => void }) {
  const initials = name.split(" ").map(part => part[0]).slice(0, 2).join("");
  return <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={onPress} style={({ pressed }) => [styles.attentionRow, pressed && styles.quickPressed]}><View style={[styles.avatar, { backgroundColor: index % 2 ? colors.goldLight : colors.primarySurface }]}><AppText style={{ color: index % 2 ? colors.gold : colors.primary, fontWeight: "800" }}>{initials}</AppText></View><View style={{ flex: 1 }}><AppText style={styles.attentionName}>{name}</AppText><AppText variant="small" muted>{concept} · worth a revisit</AppText></View><Ionicons name="chevron-forward" size={18} color={colors.charcoalLight} /></Pressable>;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandLine: { flexDirection: "row", alignItems: "center", gap: 8 }, brandMark: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, brand: { fontSize: 13, letterSpacing: 2, fontWeight: "800", color: colors.primary },
  dateRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }, eyebrow: { color: colors.primary, fontWeight: "800", letterSpacing: 1.2, fontSize: 11 }, demoPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.goldLight }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.gold }, demoText: { color: colors.gold, fontSize: 11, fontWeight: "800" },
  gradePanel: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 12, borderRadius: 16, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.lineLight }, panelLabel: { color: colors.charcoalMuted, fontWeight: "800", letterSpacing: 1, fontSize: 10 }, loading: { flexDirection: "row", gap: 9, alignItems: "center", padding: 18, borderRadius: 14, backgroundColor: colors.primarySurface },
  hero: { minHeight: 238, overflow: "hidden", borderRadius: 24, padding: 22, backgroundColor: colors.primary, flexDirection: "row", gap: 12 }, heroGlow: { position: "absolute", width: 200, height: 200, borderRadius: 100, right: -72, top: -80, backgroundColor: colors.forestSoft, opacity: 0.7 }, heroCopy: { flex: 1, zIndex: 1, gap: 9 }, heroEyebrow: { color: colors.sage, fontWeight: "800", letterSpacing: 1.1, fontSize: 10 }, heroTitle: { color: colors.white, fontSize: 23, lineHeight: 29 }, heroBody: { color: "#D9E8E5", lineHeight: 21 }, heroActions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12, marginTop: 7 }, heroButton: { backgroundColor: colors.gold }, textAction: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 10 }, textActionLabel: { color: colors.white, fontWeight: "800", fontSize: 13 }, heroIllustration: { width: 70, height: 94, marginTop: 22, borderRadius: 18, backgroundColor: "#FDF3DC", alignItems: "center", justifyContent: "center", gap: 5, transform: [{ rotate: "5deg" }] }, illustrationLine: { width: 35, height: 3, borderRadius: 2, backgroundColor: colors.gold }, illustrationLineShort: { width: 24, height: 3, borderRadius: 2, backgroundColor: "#E6C77A" }, sunDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gold, position: "absolute", top: 9, right: 9 },
  pulsePanel: { padding: 16, borderRadius: 18, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.lineLight, gap: 13 }, panelHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, pulseHint: { color: colors.primary, fontWeight: "800", fontSize: 12 }, progressTrack: { height: 7, borderRadius: 4, backgroundColor: colors.lineLight, overflow: "hidden" }, progressFill: { height: "100%", borderRadius: 4, backgroundColor: colors.gold }, metrics: { flexDirection: "row", justifyContent: "space-between" }, metric: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 80 }, metricValue: { fontSize: 18, fontWeight: "800", color: colors.charcoal },
  todayPlan: { flexDirection: "row", alignItems: "center", gap: 11, padding: 15, borderRadius: 18, backgroundColor: colors.paperWarm, borderWidth: 1, borderColor: colors.goldLight }, todayPlanIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.goldLight }, todayPlanTitle: { fontWeight: "800", color: colors.charcoal }, sessionBanner: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 15, backgroundColor: colors.attentionSurface }, sessionIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" }, sessionTitle: { fontWeight: "800", color: colors.charcoal }, sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }, actionGrid: { gap: 9 }, quickAction: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, minHeight: 67, borderRadius: 15, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.lineLight }, quickPressed: { backgroundColor: colors.sagePale }, quickIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" }, quickLabel: { fontWeight: "800", color: colors.charcoal }, link: { color: colors.primary, fontWeight: "800" },
  attentionPanel: { borderRadius: 17, borderWidth: 1, borderColor: colors.lineLight, backgroundColor: colors.paper, overflow: "hidden" }, attentionRow: { flexDirection: "row", alignItems: "center", gap: 11, padding: 12, minHeight: 67, borderBottomWidth: 1, borderBottomColor: colors.lineLight }, avatar: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" }, attentionName: { fontWeight: "800", color: colors.charcoal }, emptyAttention: { flexDirection: "row", alignItems: "center", gap: 11, padding: 16 }, checkCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, lessonPanel: { flexDirection: "row", alignItems: "center", gap: 11, padding: 14, borderRadius: 17, backgroundColor: colors.paperWarm, borderWidth: 1, borderColor: colors.lineLight }, lessonIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.goldLight, alignItems: "center", justifyContent: "center" }, lessonTitle: { fontWeight: "800", color: colors.charcoal }, circleArrow: { width: 35, height: 35, borderRadius: 18, backgroundColor: colors.primarySurface, alignItems: "center", justifyContent: "center" }
});
