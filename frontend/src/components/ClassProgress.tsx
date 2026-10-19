import { useCallback } from "react";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { AppText } from "./AppText";
import { Button } from "./Button";
import { Section, ActionRow, EmptyState } from "./Workspace";
import { FormStatus } from "./FormStatus";
import { useLocalData } from "@/hooks/useLocalData";
import { classLearningEvidence } from "@/services/classroomService";
import { colors } from "@/theme";

export function ClassProgress({ grade }: { grade: number }) {
  const loader = useCallback(() => classLearningEvidence(grade), [grade]);
  const { data, error, loading, reload } = useLocalData(loader);
  const covered = data?.progress.filter(item => item.recorded > 0) ?? [];
  const remaining = data?.progress.filter(item => item.recorded === 0) ?? [];
  const frontier = remaining[0];

  return <View style={styles.container}>
    <View style={styles.intro}>
      <View style={{ flex: 1 }}>
        <AppText variant="subheading">Learning flow</AppText>
        <AppText variant="small" muted>Follow the class sequence: covered work, the next frontier, and the portion still ahead.</AppText>
      </View>
      <View style={styles.legend}><View style={styles.dot} /><AppText variant="small" muted>covered</AppText></View>
    </View>
    <FormStatus message={error} error />
    {error ? <Button label="Reload progress" variant="quiet" onPress={() => void reload()} /> : null}
    {loading && !data ? <AppText muted>Reading progress...</AppText> : null}
    {!loading && !data?.students.length && !error ? <EmptyState title="No learning evidence yet" detail="Enroll students and record an assessment to see the classroom sequence." /> : null}

    {data && data.progress.length > 0 ? <View style={styles.summary}>
      <View><AppText style={styles.summaryValue}>{covered.length}</AppText><AppText variant="small" muted>covered</AppText></View>
      <View><AppText style={[styles.summaryValue, { color: colors.gold }]}>{remaining.length}</AppText><AppText variant="small" muted>remaining</AppText></View>
      <View style={{ flex: 1 }}><AppText style={styles.frontierLabel}>CURRENT FRONTIER</AppText><AppText style={styles.frontierTitle}>{frontier?.concept.title ?? "Portion complete"}</AppText></View>
    </View> : null}

    {covered.length ? <Section title="Covered so far" detail={covered.length + " concepts with evidence. These are the topics the class has reached."}>
      {covered.map(item => <Section key={item.concept.id} title={item.concept.title} detail={item.secure + " secure · " + item.practicing + " practising · " + item.revision.length + " need support · " + item.missing + " not assessed"}>
        <View style={styles.distribution}>
          <View style={[styles.segment, { flex: item.secure || 0.1, backgroundColor: colors.primary }]} />
          <View style={[styles.segment, { flex: item.practicing || 0.1, backgroundColor: colors.gold }]} />
          <View style={[styles.segment, { flex: item.revision.length || 0.1, backgroundColor: colors.danger }]} />
          <View style={[styles.segment, { flex: item.missing || 0.1, backgroundColor: colors.masteryNone }]} />
        </View>
        <AppText>{item.revision.length ? "Model another example, then check understanding." : "Continue practice and check understanding."}</AppText>
        {item.revision.map(student => <ActionRow key={student.id} title={student.name} detail={"Roll " + student.roll + " · Open progress and teacher notes"} onPress={() => router.push({ pathname: "/students/[id]", params: { id: student.id, tab: "observations" } })} />)}
        <Button label="Explain this concept" variant="quiet" onPress={() => router.push({ pathname: "/chatbot", params: { grade: String(grade), prompt: "Explain " + item.concept.title.toLowerCase() + " for Grade " + grade + " Maths. Suggest one concrete classroom activity and one understanding check.", conceptId: item.concept.id, screenContext: "class_progress" } })} />
      </Section>)}
    </Section> : null}

    {remaining.length ? <Section title="Remaining portion" detail="These concepts have no class evidence yet. They are not presented as taught.">
      {remaining.map((item, index) => <View key={item.concept.id} style={styles.remainingRow}>
        <View style={styles.sequence}><AppText style={styles.sequenceText}>{index + 1}</AppText></View>
        <View style={{ flex: 1 }}><AppText style={styles.remainingTitle}>{item.concept.title}</AppText><AppText variant="small" muted>{index === 0 ? "Next learning frontier" : "Waiting in sequence"}</AppText></View>
        <AppText variant="small" style={styles.notStarted}>Not started</AppText>
      </View>)}
    </Section> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 14 },
  intro: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, backgroundColor: colors.primarySurface },
  legend: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  summary: { flexDirection: "row", alignItems: "center", gap: 18, padding: 14, borderRadius: 14, backgroundColor: colors.paperWarm, borderWidth: 1, borderColor: colors.lineLight },
  summaryValue: { fontSize: 20, fontWeight: "800", color: colors.primary },
  frontierLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 1, color: colors.charcoalMuted },
  frontierTitle: { fontSize: 13, fontWeight: "800", color: colors.charcoal, marginTop: 2 },
  distribution: { height: 8, flexDirection: "row", gap: 2, borderRadius: 4, overflow: "hidden" },
  segment: { height: "100%", borderRadius: 4 },
  remainingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.lineLight },
  sequence: { width: 28, height: 28, borderRadius: 10, backgroundColor: colors.sagePale, alignItems: "center", justifyContent: "center" },
  sequenceText: { fontSize: 12, fontWeight: "800", color: colors.primary },
  remainingTitle: { fontWeight: "700", color: colors.charcoalMid },
  notStarted: { color: colors.charcoalLight, fontWeight: "700" },
});
